// Yardımcı süreç: bir hesabın (CLAUDE_CONFIG_DIR) geçmiş oturumlarını listeler ya da mesajlarını okur.
import { listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const payload = JSON.parse(process.argv[2] || '{}');

try {
  if (payload.op === 'list') {
    const sessions = await listSessions({ dir: payload.dir, limit: 30, includeProgrammatic: true });
    process.stdout.write(JSON.stringify({ ok: true, sessions }));
  } else if (payload.op === 'messages') {
    const messages = await getSessionMessages(payload.sessionId, { dir: payload.dir });
    process.stdout.write(JSON.stringify({ ok: true, messages }));
  } else {
    process.stdout.write(JSON.stringify({ ok: false, error: 'bilinmeyen işlem' }));
  }
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: err?.message || String(err) }));
}
