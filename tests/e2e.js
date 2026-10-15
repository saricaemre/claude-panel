// Uçtan uca test: uygulamayı gerçek Electron ile açar, Claude Code yerine sahte CLI kullanır.
// Çalıştırma:  npm test        (Linux'ta ekran yoksa: xvfb-run -a npm test)
// Ekran görüntüleri: tests/out/
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const FAKE = path.join(__dirname, 'fake-claude.js');

// Geçici ev klasörü, proje klasörü ve uygulama ayarları
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-panel-test-')));
const HOME = path.join(TMP, 'home');
const PROJECT = path.join(HOME, 'WFC');
const USER_DATA = path.join(TMP, 'userData');
const LOG = path.join(TMP, 'fake.log');
fs.mkdirSync(PROJECT, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
fs.chmodSync(FAKE, 0o755);
fs.writeFileSync(path.join(USER_DATA, 'config.json'), JSON.stringify({ recents: { max: [PROJECT] }, lastAccount: 'max' }));

// Geçmiş oturum testi için örnek bir oturum dosyası (Max hesabının ayar klasöründe)
const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const projDir = path.join(HOME, '.claude-max', 'projects', PROJECT.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(projDir, { recursive: true });
const base = { sessionId: SESSION, cwd: PROJECT, isSidechain: false, userType: 'external', version: '2.1.300', gitBranch: 'main' };
fs.writeFileSync(path.join(projDir, SESSION + '.jsonl'), [
  { ...base, type: 'user', uuid: 'u1', parentUuid: null, timestamp: '2026-10-15T10:00:00.000Z', message: { role: 'user', content: 'Eski oturumdaki ilk mesaj' } },
  { ...base, type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-10-15T10:00:05.000Z', message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Eski yanıt.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm dogrula' } }] } },
  { ...base, type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-10-15T10:00:09.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '13/13 yeşil' }] } },
].map((x) => JSON.stringify(x)).join('\n') + '\n');

const fakeLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const step = (name) => console.log('• ' + name);

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      HOME,
      SHELL: process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
      CLAUDE_PANEL_USER_DATA: USER_DATA,
      CLAUDE_PANEL_CLAUDE_BIN: FAKE,
      FAKE_CLAUDE_LOG: LOG,
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const P = '.acct-pane.active ';

  try {
    step('Açılış: üç hesap ve başlatıcı');
    await page.waitForSelector('.acct');
    assert.equal(await page.locator('.acct').count(), 3);
    await page.waitForSelector(P + '.recent-row');
    await page.screenshot({ path: path.join(OUT, '1-baslatici.png') });

    step('Terminal: hesabın ayar klasörüyle açılıyor');
    await page.evaluate((dir) => launch('max', dir, 'shell'), PROJECT);
    await page.waitForSelector(P + '.term-host.active .xterm');
    await page.waitForTimeout(1500);
    await page.keyboard.type('echo PANEL=$CLAUDE_CONFIG_DIR\n');
    await page.waitForFunction((want) => document.querySelector('.acct-pane.active .term-host.active .xterm-rows')?.innerText.includes(want),
      'PANEL=' + path.join(HOME, '.claude-max'), { timeout: 10000 });
    await page.evaluate(() => closeTab(state.activeTab.max, true));

    step('Sohbet: yeni oturum');
    await page.click(P + '.recent-row .mini.main');
    await page.waitForSelector(P + '.chat-host.active .composer-input');
    await page.waitForFunction(() => document.querySelectorAll('.acct-pane.active .meta-select')[1]?.options.length > 1, null, { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, '2-bos-sohbet.png') });
    await page.fill(P + '.composer-input', 'IS-279 üzerinde devam et');
    await page.press(P + '.composer-input', 'Enter');

    step('İzin kartı → İzin ver');
    await page.waitForSelector(P + '.perm-card:not(.answered):not(.question)', { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, '3-izin.png') });
    await page.click(P + '.perm-card:not(.answered) .primary-btn');

    step('Soru kartı → seçenek ve Cevapla');
    await page.waitForSelector(P + '.perm-card.question:not(.answered)', { timeout: 15000 });
    await page.click(P + '.perm-card.question .q-opt');
    await page.click(P + '.perm-card.question .primary-btn');
    await page.waitForFunction(() => document.querySelector('.acct-pane.active .chat-list')?.textContent.includes('IS-280')
      && !document.querySelector('.acct-pane.active .ct-status.busy'), null, { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, '4-tur-bitti.png') });

    const groups = await page.$$eval(P + '.tool-group .grp-text', (o) => o.map((x) => x.textContent));
    assert.ok(groups.length >= 2, 'araç grupları oluşmadı: ' + JSON.stringify(groups));
    assert.match(groups[0], /dosya okundu/);
    assert.equal((await page.textContent(P + '.side-count')).trim(), '1 / 3');

    step('Efor ve izin modu değişimi SDK\'ya ulaşıyor');
    await page.selectOption(P + '.meta-select >> nth=2', 'xhigh');
    await page.selectOption(P + '.meta-select >> nth=0', 'acceptEdits');
    await page.waitForTimeout(500);
    const log = fakeLog();
    assert.match(log, /"effortLevel":"xhigh"/);
    assert.match(log, /"set_permission_mode","mode":"acceptEdits"/);
    assert.ok(log.includes('CFG ' + path.join(HOME, '.claude-max')), 'yanlış CLAUDE_CONFIG_DIR');
    assert.match(log, /"answers":\{"Kapanışta main'e birleştireyim mi\?":"Evet"\}/);
    assert.match(log, /--setting-sources=user,project,local/);

    step('Slash komut önerisi');
    await page.fill(P + '.composer-input', '/ta');
    await page.dispatchEvent(P + '.composer-input', 'input');
    assert.deepEqual(await page.$$eval(P + '.slash-item', (o) => o.map((x) => x.textContent)), ['/tasarim']);
    await page.fill(P + '.composer-input', '');

    step('Geçmiş: eski oturumu yükle ve devam et');
    await page.click(P + '.tab-add');
    await page.click(P + '.recent-row .mini >> text=Geçmiş');
    await page.waitForSelector('.session-main', { timeout: 20000 });
    await page.click('.session-main');
    await page.waitForSelector(P + '.chat-host.active .chat-divider', { timeout: 20000 });
    assert.ok((await page.textContent(P + '.chat-host.active .chat-list')).includes('Eski oturumdaki ilk mesaj'));
    await page.waitForTimeout(800);
    assert.match(fakeLog(), new RegExp('--resume=' + SESSION));
    await page.screenshot({ path: path.join(OUT, '5-gecmis.png') });

    step('Web görünümü: hesaba özel oturum bölmesi');
    await page.click('.acct.active .chip >> text=Web');
    await page.waitForSelector(P + '.chat-pane webview');
    assert.equal(await page.getAttribute(P + '.chat-pane webview', 'partition'), 'persist:chat-max');

    assert.deepEqual(errors, [], 'arayüz hataları');
    console.log('\n✓ Tüm testler geçti. Ekran görüntüleri: tests/out/');
  } catch (err) {
    await page.screenshot({ path: path.join(OUT, 'hata.png') }).catch(() => {});
    console.error('\n✗ Test başarısız:', err.message);
    if (errors.length) console.error('Arayüz hataları:', errors);
    console.error('Sahte CLI günlüğünün sonu:\n' + fakeLog().slice(-1500));
    process.exitCode = 1;
  } finally {
    const proc = app.process();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    process.exit(process.exitCode || 0);
  }
})();
