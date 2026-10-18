#!/usr/bin/env node
// Sahte simülatör yardımcısı (native/simhelper yerine, yalnız testler için): aynı çerçeve protokolünü konuşur.
// Hazır bilgisi ve tek bir JPEG kare yollar; gelen her komutu günlüğe yazar, ekran görüntüsü için PNG döner.
const fs = require('fs');
const readline = require('readline');
const LOG = process.env.FAKE_CLAUDE_LOG || require('path').join(require('os').tmpdir(), 'fake-claude.log');
const log = (s) => fs.appendFileSync(LOG, 'SIMHELPER ' + s + '\n');
log('ARGS ' + JSON.stringify(process.argv.slice(2)));
const frame = (kind, data) => {
  const head = Buffer.alloc(5);
  head[0] = kind.charCodeAt(0);
  head.writeUInt32BE(data.length, 1);
  process.stdout.write(Buffer.concat([head, data]));
};
const json = (o) => frame('J', Buffer.from(JSON.stringify(o)));
// 40×87 JPEG (gerçek bir simülatör karesinin küçültülmüşü)
const JPEG = Buffer.from('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', 'base64');
json({ type: 'ready', version: 2, name: 'iPhone 17 Pro', widthPixels: 1206, heightPixels: 2622, scale: 3 });
frame('F', JPEG);
const timer = setInterval(() => frame('F', JPEG), 500);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  log('IN ' + line);
  fs.appendFileSync(LOG + '.times', Date.now() + ' ' + line + '\n'); // zamanlı kopya: tuşlar arası bekleme ölçülür
  const reply = { type: 'reply', id: m.id, ok: true };
  // Yatayda dik çevrilmiş görüntü (874×402) döner, gerçek yardımcı gibi
  if (m.cmd === 'screenshot') reply.png = (m.turn ? png(874, 402, [220, 120, 40]) : png(402, 874, [40, 120, 220])).toString('base64');
  json(reply);
}).on('close', () => { log('KAPANDI'); clearInterval(timer); process.exit(0); });
function png(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
