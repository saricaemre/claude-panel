// Yardımcı süreç: bir hesabın (CLAUDE_CONFIG_DIR) geçmiş oturumlarını listeler ya da mesajlarını okur;
// danışma (danis.js) için oturumun bir anından dal açar (fork) ve dalı siler (delete). Asıl oturum dosyasına yazılmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSessions, getSessionMessages, forkSession, deleteSession } from '@anthropic-ai/claude-agent-sdk';

const payload = JSON.parse(process.argv[2] || '{}');

// Dalın dosyası: SDK kaynağın klasörüne yazar; yeri bilinsin diye projects altında aranır (çökmede temizlenecek yol)
function findFile(sessionId) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return null; }
  for (const n of names) {
    const f = path.join(root, n, sessionId + '.jsonl');
    if (fs.existsSync(f)) return fs.realpathSync(f);
  }
  return null;
}

try {
  if (payload.op === 'list') {
    const sessions = await listSessions({ dir: payload.dir, limit: 30, includeProgrammatic: true });
    process.stdout.write(JSON.stringify({ ok: true, sessions }));
  } else if (payload.op === 'messages') {
    const messages = await getSessionMessages(payload.sessionId, { dir: payload.dir });
    process.stdout.write(JSON.stringify({ ok: true, messages }));
  } else if (payload.op === 'fork') {
    const { sessionId } = await forkSession(payload.sessionId, { dir: payload.dir, upToMessageId: payload.upTo || undefined, title: payload.title || 'octopus-danisma' });
    process.stdout.write(JSON.stringify({ ok: true, sessionId, file: findFile(sessionId) }));
  } else if (payload.op === 'delete') {
    await deleteSession(payload.sessionId, { dir: payload.dir });
    process.stdout.write(JSON.stringify({ ok: true }));
  } else {
    process.stdout.write(JSON.stringify({ ok: false, error: 'bilinmeyen işlem' }));
  }
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.message || String(err) }));
}
