// elicitation.mjs'in stdio MCP sunucusu (madde 8). Araçlar çağrılınca istemciden form ya da adres ister.
// Ürün kodu değil. Günlük: ORT_ELIC_LOG (satır başına JSON)
import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

const LOG = process.env.ORT_ELIC_LOG;
const log = (o) => LOG && fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...o }) + '\n');

const server = new Server({ name: 'elic', version: '1.0.0' }, { capabilities: { tools: {} } });
server.oninitialized = () => log({ ev: 'client', capabilities: server.getClientCapabilities(), info: server.getClientVersion() });

const SCHEMA = {
  type: 'object',
  properties: {
    ad: { type: 'string', title: 'Adınız', description: 'Tam ad', minLength: 2 },
    eposta: { type: 'string', title: 'E-posta', format: 'email' },
    yas: { type: 'integer', title: 'Yaş', minimum: 0, maximum: 150 },
    oran: { type: 'number', title: 'Oran' },
    onay: { type: 'boolean', title: 'Koşulları kabul ediyorum', default: false },
    renk: { type: 'string', title: 'Renk', enum: ['kirmizi', 'mavi'], enumNames: ['Kırmızı', 'Mavi'] },
    boy: { type: 'string', title: 'Boy', oneOf: [{ const: 's', title: 'Küçük' }, { const: 'l', title: 'Büyük' }] },
    etiketler: { type: 'array', title: 'Etiketler', items: { type: 'string', enum: ['a', 'b', 'c'] } },
  },
  required: ['ad', 'onay'],
};

const TOOLS = [
  { name: 'form_iste', description: 'Kullanıcıdan form ister', inputSchema: { type: 'object', properties: {} }, _meta: { 'anthropic/alwaysLoad': true } },
  { name: 'adres_iste', description: 'Kullanıcıdan adres kipinde onay ister', inputSchema: { type: 'object', properties: {} }, _meta: { 'anthropic/alwaysLoad': true } },
  { name: 'adres_hatasi', description: 'UrlElicitationRequired (-32042) hatası atar', inputSchema: { type: 'object', properties: {} }, _meta: { 'anthropic/alwaysLoad': true } },
  { name: 'izin_iste', description: 'permissionDisplay _meta ile form', inputSchema: { type: 'object', properties: {} }, _meta: { 'anthropic/alwaysLoad': true } },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const name = req.params.name;
  log({ ev: 'call', name });
  try {
    if (name === 'form_iste') {
      const r = await server.elicitInput({ mode: 'form', message: 'Lütfen bilgilerinizi girin', requestedSchema: SCHEMA }, { timeout: Number(process.env.ORT_ELIC_TIMEOUT || 60000) });
      log({ ev: 'result', name, r });
      return { content: [{ type: 'text', text: 'FORM ' + JSON.stringify(r) }] };
    }
    if (name === 'izin_iste') {
      const r = await server.elicitInput({ mode: 'form', message: 'İşlemi onaylıyor musunuz?', requestedSchema: { type: 'object', properties: { onay: { type: 'boolean', title: 'Onay' } } },
        _meta: { 'anthropic/permissionDisplay': { title: 'Ödeme onayı', displayName: 'Banka', description: '100 TL gönderilecek' } } });
      log({ ev: 'result', name, r });
      return { content: [{ type: 'text', text: 'IZIN ' + JSON.stringify(r) }] };
    }
    if (name === 'adres_iste') {
      const elicitationId = 'el-' + Math.random().toString(36).slice(2, 8);
      const r = await server.elicitInput({ mode: 'url', message: 'Hesabınızı bağlamak için sayfayı açın', url: 'https://example.com/baglan?x=1', elicitationId });
      log({ ev: 'result', name, r });
      if (r.action === 'accept') {
        await new Promise((res) => setTimeout(res, 1500));
        try { await server.createElicitationCompletionNotifier(elicitationId)(); log({ ev: 'complete-sent', elicitationId }); } catch (e) { log({ ev: 'complete-err', m: e.message }); }
      }
      return { content: [{ type: 'text', text: 'ADRES ' + JSON.stringify(r) }] };
    }
    if (name === 'adres_hatasi') {
      throw new McpError(-32042, 'Bu işlem için yetki gerekiyor', { elicitations: [{ mode: 'url', message: 'Yetki verin', url: 'https://example.com/yetki', elicitationId: 'el-hata1' }] });
    }
  } catch (e) {
    log({ ev: 'error', name, m: e.message, code: e.code });
    throw e;
  }
  return { content: [{ type: 'text', text: 'bilinmeyen' }] };
});
await server.connect(new StdioServerTransport());
log({ ev: 'start' });
