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
// Artifact protokolü güvenlik testi: kaynak klasörde gizli dosya, varlık ve klasör dışına çıkan symlink
fs.writeFileSync(path.join(PROJECT, '.env'), 'GIZLI=1');
fs.writeFileSync(path.join(PROJECT, 'stil.css'), 'h1 { color: red }');
fs.writeFileSync(path.join(HOME, 'gizli.css'), 'gizli');
fs.symlinkSync(path.join(HOME, 'gizli.css'), path.join(PROJECT, 'kacak.css'));
// Terminal testi: argümanlarını yazan sahte `claude` komutu, giriş kabuğunda PATH'in başında
fs.mkdirSync(path.join(HOME, 'bin'));
fs.writeFileSync(path.join(HOME, 'bin', 'claude'), '#!/bin/sh\necho "CLAUDE_ARGS $*"\n', { mode: 0o755 });
fs.writeFileSync(path.join(HOME, '.zshrc'), 'export PATH="$HOME/bin:$PATH"\n');
fs.writeFileSync(path.join(HOME, '.bashrc'), 'export PATH="$HOME/bin:$PATH"\n');
// Bağlayıcılar: Max hesabının .claude.json'u (genel, klasöre özel ve claude.ai bağlayıcıları)
const CLAUDE_JSON = path.join(HOME, '.claude-max', '.claude.json');
fs.mkdirSync(path.dirname(CLAUDE_JSON), { recursive: true });
fs.writeFileSync(CLAUDE_JSON, JSON.stringify({
  mcpServers: { blender: { type: 'stdio', command: 'blender-mcp' }, 'figma-console': { type: 'stdio', command: 'figma-console-mcp' } },
  claudeAiMcpEverConnected: ['claude.ai Figma'],
  projects: { [PROJECT]: { mcpServers: { 'yerel-mcp': { type: 'stdio', command: 'yerel' } }, allowedTools: [] } },
}));
// Eklentiler: settings.json ortak dosyaya symlink (ayarlari-esitle.sh gibi), kurulu iki eklenti, klasörde yerel bir geçersiz kılma
const SHARED_SETTINGS = path.join(HOME, '.claude', 'settings.json');
fs.mkdirSync(path.dirname(SHARED_SETTINGS), { recursive: true });
fs.writeFileSync(SHARED_SETTINGS, JSON.stringify({ permissions: { allow: ['mcp__pencil'] }, enabledPlugins: { 'guvenlik@resmi': true, 'eski@resmi': false } }));
fs.symlinkSync(SHARED_SETTINGS, path.join(HOME, '.claude-max', 'settings.json'));
const pluginDir = (n) => path.join(HOME, '.claude', 'plugins', 'cache', 'resmi', n, '1.0.0');
for (const [n, d] of [['guvenlik', 'Kod değişikliklerinde güvenlik denetimi'], ['eski', 'Eski bir eklenti']]) {
  fs.mkdirSync(path.join(pluginDir(n), '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir(n), '.claude-plugin', 'plugin.json'), JSON.stringify({ name: n, version: '1.0.0', description: d }));
}
fs.mkdirSync(path.join(HOME, '.claude-max', 'plugins'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude-max', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: Object.fromEntries(
  ['guvenlik', 'eski', 'yerel'].map((n) => [`${n}@resmi`, [{ scope: 'user', installPath: pluginDir(n), version: '1.0.0' }]])) }));
fs.mkdirSync(path.join(PROJECT, '.claude'), { recursive: true });
fs.writeFileSync(path.join(PROJECT, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'yerel@resmi': false } }));
const pluginsOn = () => JSON.parse(fs.readFileSync(SHARED_SETTINGS, 'utf8')).enabledPlugins;
const mcpOff = () => JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')).projects?.[PROJECT]?.disabledMcpServers;
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
    step('Açılış: yan menü (Yeni sohbet + Artifacts), üç hesap ve yeni sohbet ekranı');
    await page.waitForSelector('.acct');
    assert.equal(await page.locator('.acct').count(), 3);
    assert.deepEqual(await page.$$eval('#nav .nav-item', (o) => o.map((x) => x.children[1].textContent)), ['Yeni sohbet', 'Artifacts']);
    await page.waitForSelector(P + '.recent-row');
    assert.ok(await page.locator('#navNew.on').count(), '"Yeni sohbet" seçili görünmüyor');

    step('Terminal: hesabın ayar klasörüyle açılıyor');
    await page.evaluate((dir) => launch('max', dir, 'shell'), PROJECT);
    await page.waitForSelector(P + '.term-host.active .xterm');
    await page.waitForTimeout(1500);
    await page.keyboard.type('echo PANEL=$CLAUDE_CONFIG_DIR\n');
    await page.waitForFunction((want) => document.querySelector('.acct-pane.active .term-host.active .xterm-rows')?.innerText.includes(want),
      'PANEL=' + path.join(HOME, '.claude-max'), { timeout: 10000 });
    await page.evaluate(() => closeTab(state.activeTab.max, true));

    step('Terminalde Claude: Blender ve figma-console izin sormadan (--allowedTools)');
    await page.evaluate((dir) => launch('max', dir, 'new'), PROJECT);
    await page.waitForFunction(() => document.querySelector('.acct-pane.active .term-host.active .xterm-rows')?.innerText.includes('CLAUDE_ARGS'), null, { timeout: 10000 });
    assert.match(await page.innerText(P + '.term-host.active .xterm-rows'), /CLAUDE_ARGS --allowedTools mcp__blender,mcp__figma-console\s/);
    await page.evaluate(() => closeTab(state.activeTab.max, true));

    step('Yeni sohbet ekranı: kullanım halkası ve penceresi (5 saat, haftalık, model bazlı)');
    await page.click('#navNew');
    const N = P + '.new-composer ';
    await page.waitForSelector(N + '.usage-btn[data-level="low"]', { timeout: 20000 });
    assert.match(await page.getAttribute(N + '.usage-btn', 'title'), /%7 kullanıldı/);
    await page.click(N + '.usage-btn');
    await page.waitForSelector('.usage-pop .u-row');
    const urows = await page.$$eval('.usage-pop .u-row', (o) => o.map((x) => x.innerText.replace(/\s+/g, ' ')));
    assert.equal(urows.length, 3);
    assert.match(urows[0], /^Oturum limiti \(5 saat\) %7 kullanıldı Sıfırlanmaya 4 sa \d+ dk$/);
    assert.match(urows[1], /^Haftalık %12 kullanıldı Sıfırlanma: /);
    assert.match(urows[2], /^Haftalık · Opus %31 kullanıldı/);
    assert.match(await page.textContent('.usage-pop .u-foot'), /Max planı/);
    await page.screenshot({ path: path.join(OUT, '1b-kullanim.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.usage-pop').count(), 0);

    step('Yeni sohbet ekranı: model ve efor seçici (modelin desteklediği eforlar)');
    assert.equal((await page.innerText(N + '.model-btn')).trim(), 'Varsayılan model', 'varsayılan model etiketi yanlış');
    await page.click(N + '.model-btn');
    assert.deepEqual(await page.$$eval('.model-menu .pop-item .pop-label > span', (o) => o.map((x) => x.textContent)),
      ['Varsayılan', 'Opus 5.5', 'Sonnet 5.5', 'Varsayılan', 'Düşük', 'Orta', 'Yüksek', 'Çok yüksek', 'Maksimum']);
    await page.click('.model-menu .pop-item:has-text("Sonnet 5.5")');
    await page.click(N + '.model-btn');
    assert.deepEqual(await page.$$eval('.model-menu .pop-item .pop-label > span', (o) => o.slice(3).map((x) => x.textContent)),
      ['Varsayılan', 'Düşük', 'Orta', 'Yüksek'], 'Sonnet\'in desteklemediği efor listede');
    await page.click('.model-menu .pop-item:has-text("Orta")');
    assert.equal((await page.innerText(N + '.model-btn')).replace(/\s+/g, ' ').trim(), 'Sonnet 5.5 Orta');
    await page.screenshot({ path: path.join(OUT, '1c-model-secici.png') });

    step('Yeni sohbet ekranı: bağlayıcılar listelenir; kapatma hesabın .claude.json kaydına (klasöre özel) yazılır');
    const CN = (name) => `.connectors-pop .cn-row[data-name="${name}"]`;
    await page.click(N + '.connectors-btn');
    await page.waitForSelector('.connectors-pop .cn-row');
    assert.deepEqual(await page.$$eval('.connectors-pop .cn-row', (o) => o.map((x) => [x.dataset.name, x.getAttribute('aria-checked'), x.querySelector('small').textContent])), [
      ['yerel-mcp', 'true', 'Yalnız bu klasör'], ['blender', 'true', 'Tüm klasörler'], ['figma-console', 'true', 'Tüm klasörler'], ['claude.ai Figma', 'true', 'claude.ai bağlayıcısı']]);
    await page.click(CN('blender'));
    await page.waitForSelector(CN('blender') + '[aria-checked="false"]');
    assert.deepEqual(mcpOff(), ['blender'], 'kapatma .claude.json\'a yazılmadı');
    assert.equal(JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8')).projects[PROJECT].mcpServers['yerel-mcp'].command, 'yerel', 'proje kaydının diğer alanları bozuldu');
    assert.equal(await page.locator(N + '.connectors-btn.has-off').count(), 1);
    assert.equal(await page.getAttribute(N + '.connectors-btn', 'title'), 'Bağlayıcılar: 3/4 açık');
    await page.screenshot({ path: path.join(OUT, '1d-baglayicilar.png') });
    await page.click(CN('blender'));
    await page.waitForSelector(CN('blender') + '[aria-checked="true"]');
    assert.deepEqual(mcpOff(), []);
    // Okunamayan (ör. o an yazılmakta olan) .claude.json'un üzerine yazılmaz
    const goodJson = fs.readFileSync(CLAUDE_JSON, 'utf8');
    fs.writeFileSync(CLAUDE_JSON, '{"yarim":');
    await page.click(CN('blender'));
    await page.waitForSelector('#toast:not([hidden]):has-text("Bağlayıcı değiştirilemedi")');
    assert.equal(fs.readFileSync(CLAUDE_JSON, 'utf8'), '{"yarim":', 'bozuk .claude.json\'un üzerine yazıldı');
    fs.writeFileSync(CLAUDE_JSON, goodJson);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.connectors-pop').count(), 0);

    step('Eklentileri yönet: kurulu eklentiler; açıp kapama ortak settings.json\'a symlink bozulmadan yazılır');
    const PL = (id) => `.plugins-modal .pl-row[data-id="${id}"] .switch`;
    await page.click(N + '.connectors-btn');
    await page.click('.connectors-pop .cn-plugins');
    assert.equal(await page.locator('.connectors-pop').count(), 0);
    await page.waitForSelector('.plugins-modal .pl-row');
    assert.deepEqual(await page.$$eval('.plugins-modal .pl-row', (o) => o.map((x) => [x.dataset.id, x.querySelector('.switch').getAttribute('aria-checked'), x.querySelector('.switch').disabled])),
      [['eski@resmi', 'false', false], ['guvenlik@resmi', 'true', false], ['yerel@resmi', 'false', true]]);
    assert.match(await page.textContent('.plugins-modal .pl-note'), /^Ortak ayar dosyası \(~\/\.claude\/settings\.json\)/);
    assert.match(await page.textContent('.plugins-modal .pl-row[data-id="yerel@resmi"]'), /settings\.local\.json dosyası belirliyor/);
    await page.click(PL('eski@resmi'));
    await page.waitForSelector(PL('eski@resmi') + '[aria-checked="true"]:not([disabled])');
    assert.deepEqual(pluginsOn(), { 'guvenlik@resmi': true, 'eski@resmi': true }, 'eklenti settings.json\'a yazılmadı');
    assert.deepEqual(JSON.parse(fs.readFileSync(SHARED_SETTINGS, 'utf8')).permissions, { allow: ['mcp__pencil'] }, 'settings.json\'un diğer alanları bozuldu');
    assert.ok(fs.lstatSync(path.join(HOME, '.claude-max', 'settings.json')).isSymbolicLink(), 'settings.json symlink\'i bozuldu');
    await page.screenshot({ path: path.join(OUT, '1e-eklentiler.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.plugins-modal').count(), 0);

    step('Yeni sohbet ekranı: ilk mesajı yazıp Enter → sohbet seçili klasörde, seçili model/eforla başlar ve mesaj gider');
    const LOGGED_OUT = path.join(HOME, '.claude-max', '.fake-logged-out'); // sohbet süreci girişten önce açılmış gibi
    fs.writeFileSync(LOGGED_OUT, '');
    await page.fill(P + '.new-input', 'IS-279 üzerinde devam et');
    await page.screenshot({ path: path.join(OUT, '1-yeni-sohbet.png') });
    await page.press(P + '.new-input', 'Enter');
    await page.waitForSelector(P + '.chat-host.active .composer-input');
    await page.waitForSelector(P + '.chat-host.active .msg-user >> text=IS-279 üzerinde devam et');
    assert.equal(await page.locator('#navNew.on').count(), 0);
    await page.waitForFunction(() => state.tabs.max.at(-1)?.models?.length > 0, null, { timeout: 15000 });
    assert.equal((await page.innerText(P + '.chat-host.active .composer-meta .model-btn')).replace(/\s+/g, ' ').trim(), 'Sonnet 5.5 Orta');
    assert.match(fakeLog(), /ARGS .*"--effort=medium","--model=sonnet"/, 'model/efor SDK\'ya verilmedi');

    step('Kullanım: açık sohbet girişten önce açılmışsa taze yoklama süreciyle okunur');
    fs.unlinkSync(LOGGED_OUT); // "giriş yapıldı"; açık sohbet süreci bunu görmez
    const uinfo = await page.evaluate(async () => { const i = await loadAccountInfo('max', true); return { usage: i.usage, error: i.error }; });
    assert.equal(uinfo.usage?.available, true, 'girişten önce açılmış sohbetin "plan yok" yanıtı gösterildi: ' + JSON.stringify(uinfo));
    assert.equal(uinfo.usage.limits.five_hour.utilization, 7);

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
    const MB = P + '.chat-host.active .composer-meta .model-btn';
    await page.click(MB);
    await page.click('.model-menu .pop-item:has-text("Opus 5.5")');
    await page.click(MB);
    await page.click('.model-menu .pop-item:has-text("Çok yüksek")');
    assert.equal((await page.innerText(MB)).replace(/\s+/g, ' ').trim(), 'Opus 5.5 Çok yüksek');
    await page.selectOption(P + '.meta-select >> nth=0', 'acceptEdits');
    await page.waitForTimeout(500);
    const log = fakeLog();
    assert.match(log, /"effortLevel":"xhigh"/);
    assert.match(log, /"subtype":"set_model","model":"opus"/);
    assert.match(log, /"set_permission_mode","mode":"acceptEdits"/);
    assert.ok(log.includes('CFG ' + path.join(HOME, '.claude-max')), 'yanlış CLAUDE_CONFIG_DIR');
    assert.match(log, /"answers":\{"Kapanışta main'e birleştireyim mi\?":"Evet"\}/);
    assert.match(log, /--setting-sources=user,project,local/);
    assert.match(log, /"--allowedTools=mcp__panel__publish_artifact,mcp__blender,mcp__figma-console"/, 'Blender/figma-console izinsiz değil: ' + (log.match(/ARGS .*setting-sources=user.*/) || [''])[0]);

    step('Slash komut önerisi');
    await page.fill(P + '.composer-input', '/ta');
    await page.dispatchEvent(P + '.composer-input', 'input');
    assert.deepEqual(await page.$$eval(P + '.slash-item', (o) => o.map((x) => x.textContent)), ['/tasarim']);
    await page.fill(P + '.composer-input', '');

    step('Artifacts: Claude\'un yazdığı .html (2 sürüm) ve publish_artifact ile yayımlanan belge');
    const C = P + '.chat-host.active ';
    await page.fill(C + '.composer-input', 'rapor hazırla');
    await page.press(C + '.composer-input', 'Enter');
    await page.waitForFunction(() => document.querySelector('.acct-pane.active .chat-host.active .chat-list')?.textContent.includes('Raporu hazırladım')
      && !document.querySelector('.acct-pane.active .ct-status.busy'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.acct-pane.active .chat-host.active .artifact-card').length === 2, null, { timeout: 10000 });
    const cards = await page.$$eval(C + '.artifact-card', (o) => o.map((x) => x.textContent));
    assert.match(cards[0], /Haftalık rapor.*Sürüm 2/);
    assert.match(cards[1], /Kapı özeti.*Belge/);
    assert.match(fakeLog(), /MCP .*Kapı özeti.*yayımlandı/);

    step('Artifact sohbette yan bölmede açılır (artifact:// protokolü)');
    await page.click(C + '.artifact-card >> nth=0');
    await page.waitForSelector(C + '.chat-art .art-viewer');
    await page.frameLocator(C + '.chat-art iframe').locator('#durum:has-text("Sürüm 2 hazır")').waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, '6-artifact-sohbet.png') });
    await page.click(C + '.chat-art .icon-btn[title="Kapat"]');
    assert.equal(await page.locator(C + '.chat-art .art-viewer').count(), 0);

    step('MCP: Blender kodu kod bloğu, araç sonucundaki görsel sohbette (grup kapalıyken de)');
    await page.fill(C + '.composer-input', 'blender sahnesine küp ekle');
    await page.press(C + '.composer-input', 'Enter');
    await page.waitForFunction(() => document.querySelector('.acct-pane.active .chat-host.active .chat-list')?.textContent.includes('Küp hazır')
      && !document.querySelector('.acct-pane.active .ct-status.busy'), null, { timeout: 15000 });
    const shot = C + '.grp-shots .tool-shot img';
    await page.waitForFunction((s) => document.querySelector(s)?.naturalWidth === 64, shot, { timeout: 5000 });
    assert.equal(await page.locator(shot).count(), 1);
    assert.ok(await page.locator(shot).isVisible(), 'görsel kapalı grubun içinde kaldı');
    assert.match(await page.textContent(C + '.grp-shots figcaption'), /blender · get_viewport_screenshot/);
    const bRow = C + '.tool-row:has(.tool-name:text-is("blender · execute_blender_code"))';
    assert.equal((await page.textContent(bRow + ' .tool-arg')).trim(), 'bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))');
    assert.equal((await page.textContent(bRow + ' .codeblock .code-head span')).trim(), 'python');
    assert.match(await page.textContent(bRow + ' .codeblock pre code'), /^import bpy\n\n# Sahneye küp ekle\nbpy\.ops\.mesh/);
    assert.equal(await page.locator(C + '.tool-pre:has-text("[görsel]")').count(), 0);
    await page.locator(shot).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '6b-mcp-gorsel.png') });
    await page.locator(C + '.tool-group').last().locator('summary').first().click();
    await page.locator(bRow + ' > summary').click();
    await page.locator(shot).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '6c-mcp-kod.png') });

    step('Bağlayıcılar: aynı klasörde açık sohbet varsa kapatma o oturuma da hemen gider (mcp_toggle)');
    await page.click('#navNew');
    await page.click(N + '.connectors-btn');
    await page.click(CN('figma-console'));
    await page.waitForSelector(CN('figma-console') + '[aria-checked="false"]');
    assert.match(fakeLog(), /"subtype":"mcp_toggle","serverName":"figma-console","enabled":false/, 'açık sohbete mcp_toggle gitmedi');
    assert.deepEqual(mcpOff(), ['figma-console']);
    await page.keyboard.press('Escape');

    step('Eklentiler: açık sohbetler eklentileri hemen yeniden yükler (reload_plugins)');
    await page.click(N + '.connectors-btn');
    await page.click('.connectors-pop .cn-plugins');
    await page.click(PL('guvenlik@resmi'));
    await page.waitForSelector(PL('guvenlik@resmi') + '[aria-checked="false"]:not([disabled])');
    assert.match(fakeLog(), /"subtype":"reload_plugins"/, 'açık sohbete reload_plugins gitmedi');
    assert.equal(pluginsOn()['guvenlik@resmi'], false);
    await page.keyboard.press('Escape');

    step('Artifacts galerisi: kartlar ve küçük resimler');
    await page.click('#navArtifacts');
    await page.waitForSelector('.art-card');
    assert.equal(await page.locator('.art-card').count(), 2);
    assert.equal((await page.textContent('#artCount')).trim(), '2');
    await page.waitForFunction(() => [...document.querySelectorAll('.art-card .art-thumb img')].filter((i) => i.naturalWidth > 0).length === 2, null, { timeout: 30000 });
    await page.screenshot({ path: path.join(OUT, '7-artifacts.png') });

    step('artifact:// yalnız kaynak klasördeki varlıkları sunar (.env ve symlink kaçışı yok)');
    const rid = await page.getAttribute('.art-card:has-text("Haftalık rapor")', 'data-id');
    const status = (sub) => app.evaluate(({ net }, u) => net.fetch(u).then((r) => r.status), `artifact://view/${rid}/2/${sub}`);
    assert.equal(await status(''), 200);
    assert.equal(await status('stil.css'), 200);
    assert.equal(await status('.env'), 404, '.env sunuldu');
    assert.equal(await status('kacak.css'), 404, 'symlink ile klasör dışına çıkıldı');
    assert.equal(await status('..%2Fgizli.css'), 404, '.. ile klasör dışına çıkıldı');

    step('Görüntüleyici: sürüm değiştir, kod görünümü, yeniden adlandır');
    await page.click('.art-card:has-text("Haftalık rapor")');
    await page.waitForSelector('#artifactsPage .art-viewer');
    assert.equal(await page.locator('#artifactsPage .av-ver option').count(), 2);
    await page.selectOption('#artifactsPage .av-ver', '1');
    await page.frameLocator('#artifactsPage iframe').locator('#durum:has-text("Sürüm 1")').waitFor({ timeout: 10000 });
    await page.click('#artifactsPage .av-head .icon-btn[title="Yıldızla"]');
    await page.waitForSelector('#artifactsPage .av-head .icon-btn.on[title="Yıldızı kaldır"]');
    assert.equal(await page.inputValue('#artifactsPage .av-ver'), '1', 'depo değişince seçili sürüm kayboldu');
    await page.click('#artifactsPage .av-seg button[data-m="code"]');
    await page.waitForSelector('#artifactsPage .cv-code');
    assert.ok((await page.textContent('#artifactsPage .cv-code')).includes('<h1>Haftalık rapor</h1>'));
    await page.click('#artifactsPage .av-seg button[data-m="preview"]');
    await page.screenshot({ path: path.join(OUT, '8-goruntuleyici.png') });
    await page.click('#artifactsPage .av-head .icon-btn[title="Diğer"]');
    await page.click('.pop-item:has-text("Yeniden adlandır")');
    await page.fill('.dlg-input', 'Rapor taslağı');
    await page.press('.dlg-input', 'Enter');
    await page.waitForSelector('#artifactsPage .av-title:has-text("Rapor taslağı")');

    step('Galeri: sil (onaylı) ve depoya yazıldı');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.art-grid');
    await page.click('.art-card:has-text("Kapı özeti") .card-btn[title="Seçenekler"]');
    await page.click('.pop-item:has-text("Sil")');
    await page.click('.dlg .primary-btn');
    await page.waitForFunction(() => document.querySelectorAll('.art-card').length === 1);
    const stored = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'artifacts', 'index.json'), 'utf8')).items;
    assert.deepEqual(stored.map((a) => [a.title, a.versions.length, a.starred]), [['Rapor taslağı', 2, true]]);
    await page.click('.acct:has-text("Max")');

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
