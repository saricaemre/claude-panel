// Octopus prototipi: ortak yardımcılar. Claude Code oturum kaydını (JSONL) okuma, soy zinciri, Türkçe arama biçimi.
// Ürün kodu değil; Faz 3'te panelin hafıza modülüne taşınacak (docs/octopus/OCTOPUS-PLANI.md).
import fs from 'node:fs';

export const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

export const textOf = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '');

// Arama biçimi: harf harf Türkçe küçük harf + aksan katlama (İSTANBUL → istanbul, ışık → isik).
// Uzunluk korunur: küçük harfe çevrilince uzunluğu değişen harf olduğu gibi kalır (emoji bozulmaz).
const FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
export function norm(s) {
  let o = '';
  for (const ch of s) {
    const lc = ch.toLocaleLowerCase('tr');
    const c = lc.length === ch.length ? lc : ch;
    o += FOLD[c] || c;
  }
  return o;
}

// Soy zinciri: son mesajdan geriye yürür. Dikkat: sıkıştırmada korunan son mesajlar (preservedMessages) diskte eski
// ebeveynlerini taşır; zincir sınırın üstünden atlayabilir. Bu yüzden bir sınır, kendisi, logicalParentUuid'si ya da
// korunan mesajlarından biri zincirdeyse soya dahil sayılır. Aynı sınır dosyada iki kez geçebilir (dallanma): uuid ile ayıklanır.
export function lineage(rows) {
  const by = new Map();
  for (const o of rows) if (o.uuid && !by.has(o.uuid)) by.set(o.uuid, o);
  const chain = new Set();
  let cur = [...rows].reverse().find((o) => o.uuid && (o.type === 'user' || o.type === 'assistant'));
  while (cur && !chain.has(cur.uuid)) {
    chain.add(cur.uuid);
    cur = by.get(cur.parentUuid) || by.get(cur.logicalParentUuid);
  }
  const seen = new Set(), boundaries = [];
  for (const o of rows) {
    if (o.type !== 'system' || o.subtype !== 'compact_boundary' || seen.has(o.uuid)) continue;
    seen.add(o.uuid);
    const m = o.compactMetadata || {};
    const kept = m.preservedMessages?.allUuids || [];
    if (!(chain.has(o.uuid) || chain.has(o.logicalParentUuid) || kept.some((u) => chain.has(u)))) continue;
    const s = rows.find((x) => x.isCompactSummary && x.parentUuid === o.uuid);
    boundaries.push({ uuid: o.uuid, ts: o.timestamp, trigger: m.trigger, pre: m.preTokens, post: m.postTokens,
      kept: new Set(kept), summaryUuid: s?.uuid, summary: s ? textOf(s.message?.content) : '' });
  }
  boundaries.sort((a, b) => a.ts.localeCompare(b.ts));
  return { by, chain, boundaries };
}

// Kaydın bugünkü bağlamdaki yeri: 0 = bağlamda, 1 = bağlamdan düşmüş (son sıkıştırmadan önce), 2 = başka dal
export function placeOf(o, { chain, boundaries }) {
  if (!chain.has(o.uuid)) return 2;
  const last = boundaries[boundaries.length - 1];
  if (!last) return 0;
  if (o.uuid === last.uuid || o.uuid === last.summaryUuid || last.kept.has(o.uuid)) return 0;
  return (o.timestamp || '') > last.ts ? 0 : 1;
}

export const PLACE = ['', ' [bağlamdan düşmüş]', ' [başka dal]'];
