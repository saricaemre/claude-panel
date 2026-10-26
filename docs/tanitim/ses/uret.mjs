// Tanıtım videosunun müziği: dış kaynak yok, her şey burada sentezlenir (deterministik).
// Çıktı: ../assets/muzik-ham.wav (48 kHz, stereo, 16 bit). Ses yüksekliği ffmpeg loudnorm ile ayarlanır, m4a yapılır (komut README.md'de).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000, DUR = 24.5, N = Math.round(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);       // kuru
const VL = new Float32Array(N), VR = new Float32Array(N);     // yankıya giden
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

function put(i, l, r, send = 0) {
  if (i < 0 || i >= N) return;
  L[i] += l; R[i] += r; VL[i] += l * send; VR[i] += r * send;
}

// Pad: her nota üç ses (hafif ayrık), yumuşak harmonikler, yavaş giriş/çıkış
function pad(t0, t1, notes, amp) {
  const a = 0.9, rel = 1.1;
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, Math.floor((t1 + rel) * SR));
  for (const m of notes) {
    const f = mtof(m);
    const voices = [-7, 0, 7].map((c, k) => ({ f: f * Math.pow(2, c / 1200), pan: [-0.6, 0, 0.6][k], ph: k * 1.3 + m }));
    for (let i = i0; i < i1; i++) {
      const t = i / SR, u = t - t0;
      let env = Math.min(1, u / a);
      if (t > t1) env *= Math.max(0, 1 - (t - t1) / rel);
      env = env * env * (3 - 2 * env);
      const trem = 1 + 0.08 * Math.sin(2 * Math.PI * 0.23 * t + m);
      for (const v of voices) {
        const w = 2 * Math.PI * v.f * t + v.ph;
        const s = (Math.sin(w) + 0.22 * Math.sin(2 * w) + 0.08 * Math.sin(3 * w)) * env * trem * amp / notes.length;
        put(i, s * (1 - v.pan) * 0.5, s * (1 + v.pan) * 0.5, 0.35);
      }
    }
  }
}

function bass(t0, t1, m, amp) {
  const f = mtof(m), i0 = Math.floor(t0 * SR), i1 = Math.min(N, Math.floor((t1 + 0.6) * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR, u = t - t0;
    let env = Math.min(1, u / 0.5);
    if (t > t1) env *= Math.max(0, 1 - (t - t1) / 0.6);
    const s = Math.sin(2 * Math.PI * f * t) * env * amp;
    put(i, s, s, 0.05);
  }
}

// Zil: inharmonik kısmi sesler, uzun yankı
function bell(t0, m, amp, pan = 0) {
  const f = mtof(m), parts = [[1, 1, 2.2], [2.0, 0.45, 3.2], [2.76, 0.28, 4.5], [5.4, 0.12, 7]];
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + SR * 2.5);
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / SR;
    let s = 0;
    for (const [r, a, d] of parts) s += a * Math.sin(2 * Math.PI * f * r * u) * Math.exp(-u * d);
    s *= amp * Math.min(1, u / 0.003);
    put(i, s * (1 - pan) * 0.5, s * (1 + pan) * 0.5, 0.6);
  }
}

function pluck(t0, m, amp, pan = 0) {
  const f = mtof(m), i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + SR * 0.9);
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / SR, w = 2 * Math.PI * f * u;
    const s = (Math.sin(w) + 0.3 * Math.sin(2 * w) * Math.exp(-u * 18)) * Math.exp(-u * 7) * amp * Math.min(1, u / 0.002);
    put(i, s * (1 - pan) * 0.5, s * (1 + pan) * 0.5, 0.45);
  }
}

// Bas vuruşu: inen sinüs + kısa tık
function boom(t0, amp) {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + SR * 1.6);
  let ph = 0;
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / SR;
    const f = 38 + 62 * Math.exp(-u * 7);
    ph += 2 * Math.PI * f / SR;
    const s = Math.sin(ph) * Math.exp(-u * 2.6) * amp * Math.min(1, u / 0.004) + rnd() * Math.exp(-u * 90) * amp * 0.25;
    put(i, s, s, 0.15);
  }
}

// Whoosh: bant geçiren gürültü, merkezi gezinir (durum değişkenli süzgeç)
function whoosh(t0, dur, amp, f0 = 300, f1 = 3200, pan = 0) {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, Math.floor((t0 + dur) * SR));
  let low = 0, band = 0;
  for (let i = i0; i < i1; i++) {
    const k = (i - i0) / (i1 - i0);
    const fc = f0 * Math.pow(f1 / f0, Math.sin(Math.PI * k * 0.5 + (k > 0.6 ? 0 : 0)));
    const F = 2 * Math.sin(Math.PI * Math.min(fc, 8000) / SR), Q = 0.7;
    const x = rnd();
    low += F * band; const high = x - low - Q * band; band += F * high;
    const env = Math.pow(Math.sin(Math.PI * Math.pow(k, 0.7)), 2);
    const s = band * env * amp;
    const p = pan + 0.5 * Math.sin(Math.PI * 2 * k) * 0.4;
    put(i, s * (1 - p) * 0.5, s * (1 + p) * 0.5, 0.3);
  }
}

function tick(t0, amp, pan = 0) {
  const i0 = Math.floor(t0 * SR), i1 = Math.min(N, i0 + Math.floor(SR * 0.05));
  let prev = 0;
  for (let i = i0; i < i1; i++) {
    const u = (i - i0) / SR, x = rnd(), hp = x - prev; prev = x;
    const s = (hp * 0.6 + Math.sin(2 * Math.PI * 2400 * u) * 0.4) * Math.exp(-u * 160) * amp;
    put(i, s * (1 - pan) * 0.5, s * (1 + pan) * 0.5, 0.2);
  }
}

// ---------- Düzen (saniyeler index.html'deki sahnelerle eş) ----------
const chords = [
  [0.0, 3.0, [50, 57, 60, 64, 65], 38],     // Dm9
  [3.0, 6.6, [53, 60, 64, 67, 69], 41],     // Fmaj9
  [6.6, 10.8, [46, 53, 57, 60, 62], 34],    // B♭maj9
  [10.8, 14.3, [43, 50, 53, 58, 60], 31],   // Gm11
  [14.3, 16.6, [45, 52, 57, 61, 64], 33],   // A
  [16.6, 20.5, [50, 57, 60, 64, 65], 38],   // Dm9
  [20.5, 22.3, [46, 53, 57, 62, 65], 34],   // B♭maj7
  [22.3, 24.5, [50, 57, 62, 66, 69], 38],   // Dmaj9 (aydınlık bitiş)
];
for (const [a, b, notes, root] of chords) { pad(a, b, notes, 0.34); bass(a, b, root, 0.16); }

// Arpejler: sohbet sahnesinde sakin, "her şey yanında" sahnesinde canlı
const arp = (a, b, step, notes, amp) => {
  let k = 0;
  for (let t = a; t < b - 0.05; t += step, k++) pluck(t, notes[k % notes.length] + 12, amp, (k % 2 ? 0.35 : -0.35));
};
arp(6.9, 10.6, 0.25, [58, 62, 65, 69, 65, 62], 0.07);
arp(16.7, 20.4, 0.125, [62, 65, 69, 72, 69, 65, 64, 69], 0.065);
for (let t = 16.7; t < 20.4; t += 0.5) boom(t, 0.18);

// 1. Logo
bell(0.12, 86, 0.16); boom(0.62, 0.55); bell(0.7, 74, 0.12, -0.2); bell(1.45, 93, 0.06, 0.3); bell(1.6, 90, 0.05, -0.3);
// 2. Hesaplar
whoosh(2.55, 0.7, 0.22, 400, 4200);
bell(3.1, 81, 0.11, -0.6); bell(3.25, 86, 0.11, 0); bell(3.4, 88, 0.11, 0.6);
whoosh(6.05, 0.75, 0.2, 2500, 300, -0.4);
// 3. Sohbet
for (let k = 0; k < 9; k++) tick(7.02 + k * 0.075, 0.07, 0.3);
tick(7.75, 0.12);
bell(8.55, 86, 0.08, 0.2); bell(8.95, 88, 0.08, 0.2); bell(9.35, 93, 0.1, 0.2);
// 4. Octopus
whoosh(10.25, 0.8, 0.26, 200, 5000);
boom(10.95, 0.7); bell(11.0, 74, 0.1);
[0, 3, 1, 5, 2, 4].forEach((a, k) => bell(10.9 + 2.0 + k * 0.27 + 0.75, [81, 83, 86, 88, 90, 93][k], 0.09, (a - 2.5) / 3));
whoosh(14.3, 1.0, 0.3, 4000, 150);
boom(14.45, 0.35);
for (let k = 0; k < 3; k++) whoosh(14.75 + k * 0.18, 0.45, 0.12, 800, 3500, 0.5);
bell(16.05, 86, 0.1, 0.4);
// 5. Her şey yanında
whoosh(16.3, 0.6, 0.22, 300, 3800);
for (let k = 0; k < 8; k++) tick(16.75 + k * 0.06, 0.08, (k % 4 - 1.5) / 2);
bell(18.25, 88, 0.06, -0.3); bell(19.05, 93, 0.07, 0.3);
// 6. Tema ve son
whoosh(20.15, 0.6, 0.2, 3000, 300);
whoosh(21.0, 0.85, 0.22, 250, 2500);
bell(21.45, 93, 0.08);
whoosh(22.05, 0.6, 0.22, 2600, 250);
boom(22.55, 0.7); bell(22.6, 74, 0.13); bell(22.62, 81, 0.09, -0.3); bell(22.64, 86, 0.08, 0.3);
bell(23.3, 98, 0.05, 0.4); bell(23.45, 93, 0.05, -0.4);

// ---------- Yankı (Schroeder) ----------
function reverb(inp, off) {
  const combs = [1687, 1601, 1867, 1777].map((d) => ({ d: d + off, buf: new Float32Array(d + off), i: 0, lp: 0 }));
  const alls = [347, 113].map((d) => ({ d: d + off, buf: new Float32Array(d + off), i: 0 }));
  const out = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.lp = y * 0.7 + c.lp * 0.3;
      c.buf[c.i] = inp[n] + c.lp * 0.84;
      c.i = (c.i + 1) % c.d; s += y;
    }
    s *= 0.25;
    for (const a of alls) {
      const y = a.buf[a.i], v = s + y * 0.5;
      a.buf[a.i] = v; a.i = (a.i + 1) % a.d; s = y - v * 0.5;
    }
    out[n] = s;
  }
  return out;
}
const RL = reverb(VL, 0), RR = reverb(VR, 37);

const out = Buffer.alloc(44 + N * 4);
let peak = 0;
const mix = new Float32Array(N * 2);
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const fade = Math.min(1, t / 0.05, (DUR - t) / 0.9);
  mix[2 * n] = Math.tanh((L[n] + RL[n] * 0.55) * 1.1) * fade;
  mix[2 * n + 1] = Math.tanh((R[n] + RR[n] * 0.55) * 1.1) * fade;
  peak = Math.max(peak, Math.abs(mix[2 * n]), Math.abs(mix[2 * n + 1]));
}
const g = 0.89 / peak;
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 4, 40);
for (let k = 0; k < N * 2; k++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[k] * g)) * 32767), 44 + k * 2);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'muzik-ham.wav'), out);
console.log('yazıldı', (out.length / 1e6).toFixed(1), 'MB, tepe', peak.toFixed(2));
