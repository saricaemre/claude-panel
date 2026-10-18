// Claude Panel simülatör yardımcısı.
// Bir iOS simülatörüne bağlanır: ekran karelerini JPEG olarak stdout'a yazar,
// stdin'den gelen JSON satırlarıyla dokunma / düğme / klavye olayı gönderir.
// AXe'nin (brew install cameroncooke/axe/axe) içindeki FBSimulatorControl çatılarını kullanır.
//
// Çıkış çerçevesi: 1 bayt tür ('F' = JPEG kare, 'J' = JSON) + 4 bayt uzunluk (big-endian) + veri.
// Giriş: her satır bir JSON komutu, ör. {"id":3,"cmd":"touch","phase":"down","x":120,"y":300}
// Sürüm: komutlar değişince artar; panel (simulator.js → HELPER_VERSION) eski ikiliyi "ready" mesajından tanıyıp yeniden derler.
let helperVersion = 2

import Foundation
import CoreImage
import IOSurface
import FBControlCore
import FBSimulatorControl

let outLock = NSLock()

func emit(_ kind: UInt8, _ data: Data) {
  outLock.lock(); defer { outLock.unlock() }
  var header = Data([kind])
  var len = UInt32(data.count).bigEndian
  header.append(Data(bytes: &len, count: 4))
  FileHandle.standardOutput.write(header + data)
}

func emitJSON(_ obj: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: obj) { emit(UInt8(ascii: "J"), data) }
}

func fail(_ message: String) -> Never {
  emitJSON(["type": "fatal", "error": message])
  exit(1)
}

// --- Argümanlar ---
var udid = ""
var maxWidth = 750.0
var fps = 30.0
var quality = 0.7
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
  switch a {
  case "--udid": udid = args.next() ?? ""
  case "--max-width": maxWidth = Double(args.next() ?? "") ?? maxWidth
  case "--fps": fps = Double(args.next() ?? "") ?? fps
  case "--quality": quality = Double(args.next() ?? "") ?? quality
  default: break
  }
}
if udid.isEmpty { fail("--udid gerekli") }

// --- Simülatöre bağlan ---
let logger = FBControlCoreGlobalConfiguration.defaultLogger
do {
  try FBSimulatorControlFrameworkLoader.essentialFrameworks.loadPrivateFrameworks(logger)
  try FBSimulatorControlFrameworkLoader.xcodeFrameworks.loadPrivateFrameworks(logger)
} catch { fail("Xcode çatıları yüklenemedi: \(error.localizedDescription)") }

let control: FBSimulatorControl
do {
  control = try FBSimulatorControl.withConfiguration(
    FBSimulatorControlConfiguration(deviceSetPath: nil, logger: logger, reporter: nil))
} catch { fail("CoreSimulator açılamadı: \(error.localizedDescription)") }

guard let simulator = control.set.simulator(withUDID: udid) else { fail("Simülatör bulunamadı: \(udid)") }

let framebuffer: FBFramebuffer
do { framebuffer = try FBFramebuffer.mainScreenSurface(for: simulator, logger: logger) }
catch { fail("Ekran bağlanamadı (simülatör açık mı?): \(error.localizedDescription)") }

let hid: FBSimulatorHID
do { hid = try FBSimulatorHID(for: simulator) }
catch { fail("Dokunma bağlantısı kurulamadı: \(error.localizedDescription)") }

// --- Ekran kareleri ---
final class Screen: NSObject, FBFramebufferConsumer {
  let queue = DispatchQueue(label: "simhelper.frames")
  let ctx = CIContext(options: [.cacheIntermediates: false])
  let space = CGColorSpace(name: CGColorSpace.sRGB)!
  var surface: IOSurface?
  var dirty = true
  var lastSize = CGSize.zero

  func didChange(_ surface: IOSurface?) {
    self.surface = surface
    dirty = true
  }
  func didReceiveDamageRect() { dirty = true }

  func image() -> CIImage? {
    guard let surface else { return nil }
    return CIImage(ioSurface: unsafeBitCast(surface, to: IOSurfaceRef.self))
  }

  // queue üzerinde çağrılır
  func tick() {
    guard dirty, let img = image() else { return }
    dirty = false
    let size = img.extent.size
    if size != lastSize {
      lastSize = size
      emitJSON(["type": "size", "width": size.width, "height": size.height])
    }
    let scale = min(1, maxWidth / size.width)
    let scaled = scale < 1 ? img.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) : img
    let opts = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality]
    if let jpeg = ctx.jpegRepresentation(of: scaled, colorSpace: space, options: opts) {
      emit(UInt8(ascii: "F"), jpeg)
    }
  }

  // turn: ekranı dik göstermek için çevirme ("cw" saat yönünde, "ccw" tersine 90°); kareler hep fiziksel (dikey) gelir
  func png(turn: String) -> Data? {
    var out: Data?
    queue.sync {
      guard var img = image() else { return }
      if turn == "cw" || turn == "ccw" {
        // CoreImage'de y yukarı: görsel olarak saat yönü = -90°
        img = img.transformed(by: CGAffineTransform(rotationAngle: turn == "cw" ? -.pi / 2 : .pi / 2))
        img = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))
      }
      out = ctx.pngRepresentation(of: img, format: .RGBA8, colorSpace: space)
    }
    return out
  }
}

let screen = Screen()
screen.queue.sync { screen.surface = framebuffer.attach(screen, on: screen.queue) }
let timer = DispatchSource.makeTimerSource(queue: screen.queue)
timer.schedule(deadline: .now(), repeating: 1.0 / fps)
timer.setEventHandler { screen.tick() }
timer.resume()

let info = simulator.screenInfo
emitJSON([
  "type": "ready",
  "version": helperVersion,
  "name": simulator.name,
  "widthPixels": info?.widthPixels ?? 0,
  "heightPixels": info?.heightPixels ?? 0,
  "scale": info?.scale ?? 0,
])

// --- Klavye: ABD düzeninde ASCII → HID kodu ---
let shift: UInt32 = 225
func keyCodes(for ch: Character) -> (UInt32, Bool)? {
  let lower = "abcdefghijklmnopqrstuvwxyz"
  if let i = lower.firstIndex(of: ch) { return (UInt32(4 + lower.distance(from: lower.startIndex, to: i)), false) }
  if let i = lower.uppercased().firstIndex(of: ch) {
    return (UInt32(4 + lower.uppercased().distance(from: lower.uppercased().startIndex, to: i)), true)
  }
  let plain: [Character: UInt32] = [
    "1": 30, "2": 31, "3": 32, "4": 33, "5": 34, "6": 35, "7": 36, "8": 37, "9": 38, "0": 39,
    "\n": 40, "\t": 43, " ": 44, "-": 45, "=": 46, "[": 47, "]": 48, "\\": 49, ";": 51, "'": 52,
    "`": 53, ",": 54, ".": 55, "/": 56,
  ]
  if let c = plain[ch] { return (c, false) }
  let shifted: [Character: UInt32] = [
    "!": 30, "@": 31, "#": 32, "$": 33, "%": 34, "^": 35, "&": 36, "*": 37, "(": 38, ")": 39,
    "_": 45, "+": 46, "{": 47, "}": 48, "|": 49, ":": 51, "\"": 52, "~": 53, "<": 54, ">": 55, "?": 56,
  ]
  if let c = shifted[ch] { return (c, true) }
  return nil
}

func textEvents(_ text: String) throws -> FBSimulatorHIDEvent {
  var events: [FBSimulatorHIDEvent] = []
  for ch in text {
    guard let (code, needsShift) = keyCodes(for: ch) else {
      throw NSError(domain: "simhelper", code: 1, userInfo: [NSLocalizedDescriptionKey: "Yazılamayan karakter: \(ch) (yalnız ABD klavyesindeki ASCII)"])
    }
    if needsShift { events.append(.keyboard(direction: .down, keyCode: shift)) }
    events.append(.keyboard(direction: .down, keyCode: code))
    events.append(.keyboard(direction: .up, keyCode: code))
    if needsShift { events.append(.keyboard(direction: .up, keyCode: shift)) }
  }
  return .composite(events)
}

let buttons: [String: FBSimulatorHIDButton] = [
  "home": .homeButton, "lock": .lock, "side": .sideButton, "siri": .siri, "applepay": .applePay,
]

// --- Komutlar (sırayla işlenir) ---
func handle(_ cmd: [String: Any]) async throws -> [String: Any] {
  let name = cmd["cmd"] as? String ?? ""
  func num(_ k: String) -> Double { (cmd[k] as? NSNumber)?.doubleValue ?? 0 }
  switch name {
  case "touch":
    let dir: FBSimulatorHIDDirection = (cmd["phase"] as? String) == "up" ? .up : .down
    try await hid.send(event: .touch(direction: dir, x: num("x"), y: num("y")), logger: logger)
  case "tap":
    try await hid.send(event: .tapAt(x: num("x"), y: num("y")), logger: logger)
  case "swipe":
    let d = cmd["duration"] == nil ? 0.3 : num("duration")
    try await hid.send(event: .swipe(num("x"), yStart: num("y"), xEnd: num("x2"), yEnd: num("y2"), delta: 10, duration: d), logger: logger)
  case "button":
    guard let b = buttons[(cmd["name"] as? String ?? "").lowercased()] else { throw NSError(domain: "simhelper", code: 2, userInfo: [NSLocalizedDescriptionKey: "Bilinmeyen düğme"]) }
    let d = num("duration")
    if d > 0 {
      try await hid.send(event: .composite([.button(direction: .down, button: b), .delay(d), .button(direction: .up, button: b)]), logger: logger)
    } else {
      try await hid.send(event: .shortButtonPress(b), logger: logger)
    }
  case "key":
    let code = UInt32(num("code"))
    // phase verilirse yalnız basma ya da bırakma (panel tuşu Mac'teki gibi basılı tutar; tekrarı iOS yapar)
    if let phase = cmd["phase"] as? String {
      try await hid.send(event: .keyboard(direction: phase == "up" ? .up : .down, keyCode: code), logger: logger)
      break
    }
    // mods: önce basılıp sonra (ters sırayla) bırakılan değiştirici tuşlar, ör. ⌘ = 227
    let mods = (cmd["mods"] as? [NSNumber] ?? []).map { $0.uint32Value }
    var events: [FBSimulatorHIDEvent] = mods.map { .keyboard(direction: .down, keyCode: $0) }
    events += [.keyboard(direction: .down, keyCode: code), .keyboard(direction: .up, keyCode: code)]
    events += mods.reversed().map { .keyboard(direction: .up, keyCode: $0) }
    try await hid.send(event: .composite(events), logger: logger)
  case "touch2":
    // İki parmak (sıkıştırma, döndürme, iki parmakla kaydırma); "move" aynı yönle (down) yeni konum
    let dir: FBSimulatorHIDDirection = (cmd["phase"] as? String) == "up" ? .up : .down
    try await hid.send(event: .twoFingerTouch(direction: dir, finger1: CGPoint(x: num("x1"), y: num("y1")), finger2: CGPoint(x: num("x2"), y: num("y2"))), logger: logger)
  case "orientation":
    let all: [String: FBSimulatorHIDDeviceOrientation] = [
      "portrait": .portrait, "portraitUpsideDown": .portraitUpsideDown, "landscapeLeft": .landscapeLeft, "landscapeRight": .landscapeRight,
    ]
    guard let o = all[cmd["name"] as? String ?? ""] else { throw NSError(domain: "simhelper", code: 5, userInfo: [NSLocalizedDescriptionKey: "Bilinmeyen yön"]) }
    try await hid.send(event: .deviceOrientation(o), logger: logger)
  case "text":
    try await hid.send(event: textEvents(cmd["text"] as? String ?? ""), logger: logger)
  case "screenshot":
    guard let png = screen.png(turn: cmd["turn"] as? String ?? "") else { throw NSError(domain: "simhelper", code: 3, userInfo: [NSLocalizedDescriptionKey: "Ekran görüntüsü alınamadı"]) }
    return ["png": png.base64EncodedString()]
  case "refresh":
    screen.queue.async { screen.dirty = true }
  default:
    throw NSError(domain: "simhelper", code: 4, userInfo: [NSLocalizedDescriptionKey: "Bilinmeyen komut: \(name)"])
  }
  return [:]
}

let (commands, sink) = AsyncStream.makeStream(of: [String: Any].self)
Task {
  for await cmd in commands {
    var reply: [String: Any] = ["type": "reply", "id": cmd["id"] ?? NSNull()]
    do {
      for (k, v) in try await handle(cmd) { reply[k] = v }
      reply["ok"] = true
    } catch {
      reply["ok"] = false
      reply["error"] = error.localizedDescription
    }
    if cmd["id"] != nil { emitJSON(reply) }
  }
}

Thread.detachNewThread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
    sink.yield(obj)
  }
  // Panel kapandı
  framebuffer.detach(screen)
  hid.disconnect()
  exit(0)
}

dispatchMain()
