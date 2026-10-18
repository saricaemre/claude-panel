// Octopus prototipi: geçmiş beyne danış (önerilen yol). SDK'nın forkSession(upToMessageId) fonksiyonuyla bir oturumun
// istenen anına kadar (sıkıştırma öncesi dahil) yeni bir dal açar; --onay verilirse o dala tek soru sorar (araçsız,
// ayarsız, kayıtsız); her durumda dalı siler. Asıl oturum dosyasına yazılmaz.
// Kullanım: node danis.mjs <proje-klasörü> <oturum-id> <mesaj-uuid> "<soru>" [--onay]
// --onay olmadan yalnız dal açılır, tahmini bağlam boyutu yazılır ve dal silinir (token harcanmaz).
// Not: resumeSessionAt sıkıştırma sınırını geçemiyor ("No message found"); sessionStore özel CLAUDE_CONFIG_DIR'de giriş taşımıyor.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forkSession, deleteSession, query } from '@anthropic-ai/claude-agent-sdk';
import { readRows, textOf } from './ortak.mjs';

const args = process.argv.slice(2);
const onay = args.includes('--onay');
const [cwd, sid, upTo, soru] = args.filter((x) => x !== '--onay');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
if (!cwd || !soru || !UUID.test(sid || '') || !UUID.test(upTo || '')) {
  console.log('Kullanım: node danis.mjs <proje-klasörü> <oturum-id> <mesaj-uuid> "<soru>" [--onay]');
  process.exit(1);
}
const projDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
const src = path.join(projDir, sid + '.jsonl');
const before = fs.statSync(src);

const { sessionId: fork } = await forkSession(sid, { dir: cwd, upToMessageId: upTo, title: 'octopus-danisma' });
if (!UUID.test(fork) || fork === sid) throw new Error('beklenmeyen dal kimliği: ' + fork);
try {
  const rows = readRows(path.join(projDir, fork + '.jsonl'));
  const msgs = rows.filter((o) => o.type === 'user' || o.type === 'assistant');
  const lastA = [...msgs].reverse().find((o) => o.type === 'assistant' && o.message?.usage);
  const u = lastA?.message?.usage || {};
  const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  const model = lastA?.message?.model;
  const first = msgs.find((o) => o.type === 'user' && textOf(o.message?.content));
  console.log(JSON.stringify({ dal: fork, mesaj: msgs.length, sikistirma_siniri: rows.filter((o) => o.subtype === 'compact_boundary').length,
    son_an: msgs[msgs.length - 1]?.timestamp, tahmini_baglam_token: ctx, model, ilk_mesaj: textOf(first?.message?.content).slice(0, 100) }));
  if (!onay) console.log(`Soru sorulmadı. --onay ile yaklaşık ${ctx} girdi tokenı harcanır.`);
  else {
    const t0 = Date.now();
    const q = query({
      prompt: soru,
      options: {
        cwd, resume: fork, persistSession: false, model, maxTurns: 1,
        settingSources: [], mcpServers: {}, strictMcpConfig: true,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Agent', 'Task', 'WebFetch', 'WebSearch', 'NotebookEdit', 'TodoWrite', 'Skill'],
        canUseTool: async () => ({ behavior: 'deny', message: 'Danışma: araç kullanılmaz.' }),
      },
    });
    for await (const m of q) {
      if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'text') console.log('\n[GEÇMİŞ BEYİN]\n' + b.text);
      if (m.type === 'result') {
        const r = m.usage || {};
        console.log('\n[sonuç]', JSON.stringify({ alt: m.subtype, sure_sn: Math.round((Date.now() - t0) / 1000), onbellek_yazma: r.cache_creation_input_tokens, onbellek_okuma: r.cache_read_input_tokens, cikti: r.output_tokens, api_karsiligi_usd: m.total_cost_usd, hatalar: m.errors }));
      }
    }
  }
} finally {
  await deleteSession(fork, { dir: cwd });
  const after = fs.statSync(src);
  console.log(JSON.stringify({ dal_silindi: !fs.existsSync(path.join(projDir, fork + '.jsonl')), asil_dosya_degismedi: before.size === after.size && before.mtimeMs === after.mtimeMs }));
}
