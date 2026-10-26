# Claude Panel tanıtım videosu

25 saniyelik tanıtım: HyperFrames (HTML + GSAP → MP4). Ürün kodu değil; `kur.sh` `docs/`'u paketlemez.

- `index.html` — kompozisyonun tamamı (6 sahne: logo, üç hesap, sohbet, Octopus, "hepsi yanında", gece/gün ve son). Renkler `renderer/styles.css` ile aynı, ahtapot `renderer/octopus.js`'in geometrisiyle çizilir.
- `ses/uret.mjs` — müzik ve ses efektleri, dış kaynaksız sentez. Saniyeler `index.html`'deki sahnelerle eş; sahne zamanı değişirse burası da değişir.
- `assets/muzik.m4a` — üretilmiş müzik.

```bash
npx -y hyperframes@0.8.181 lint .
npx -y hyperframes@0.8.181 render -f 60 -q high -o out/claude-panel-tanitim.mp4
```

Müziği yeniden üretmek:

```bash
node ses/uret.mjs && ffmpeg -y -i assets/muzik-ham.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:a aac -b:a 224k assets/muzik.m4a && rm assets/muzik-ham.wav
```
