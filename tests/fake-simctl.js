#!/usr/bin/env node
// Sahte `xcrun simctl` (yalnız testler için): birkaç cihaz ve tür listeler, diğer komutları günlüğe yazar.
// iPhone 13 ve iPad listede vardır; panel bunları göstermemeli (yalnız iPhone 14 ve üstü).
const fs = require('fs');
const LOG = process.env.FAKE_CLAUDE_LOG || require('path').join(require('os').tmpdir(), 'fake-claude.log');
const args = process.argv.slice(2);
fs.appendFileSync(LOG, 'SIMCTL ' + JSON.stringify(args) + '\n');
const RT = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const T = (n) => ({ name: n, identifier: 'com.apple.CoreSimulator.SimDeviceType.' + n.replace(/\s+/g, '-') });
if (args[0] === 'list' && args.includes('runtimes')) {
  console.log(JSON.stringify({ runtimes: [{ identifier: RT, name: 'iOS 26.5', version: '26.5', platform: 'iOS', isAvailable: true,
    supportedDeviceTypes: ['iPhone 17 Pro', 'iPhone 16 Pro', 'iPhone 14', 'iPhone 13', 'iPhone Air', 'iPad Pro 13-inch (M5)'].map(T) }] }));
} else if (args[0] === 'list' && args.includes('devices')) {
  const d = (udid, name) => ({ udid, name, state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: T(name).identifier });
  console.log(JSON.stringify({ devices: { [RT]: [d('AAAA-17PRO', 'iPhone 17 Pro'), d('BBBB-13', 'iPhone 13'), d('CCCC-IPAD', 'iPad Pro 13-inch (M5)')] } }));
} else if (args[0] === 'create') {
  console.log('DDDD-NEW');
} else if (args[0] === 'spawn' && args.includes('KeyboardLastUsed')) {
  // Simülatörün son kullanılan klavyesi (Emre'nin simülatöründe olduğu gibi Türkçe Q)
  console.log('tr_TR@sw=Turkish-Q;hw=Automatic;ml=2');
} else if (args[0] === 'pbcopy') {
  // Panoya konan metin (Türkçe harfler bozulmadan gelmeli: LANG UTF-8)
  let input = '';
  process.stdin.on('data', (d) => (input += d)).on('end', () => fs.appendFileSync(LOG, 'SIMCTL PBCOPY ' + JSON.stringify(input) + ' LANG=' + process.env.LANG + '\n'));
}
