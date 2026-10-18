#!/usr/bin/env node
// Sahte GitHub CLI (yalnız testler için; CLAUDE_PANEL_GH). PR'nin hâli FAKE_GH_STATE dosyasından okunur, test onu değiştirir.
// Her çağrı FAKE_GH_LOG'a yazılır.
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, 'GH ' + JSON.stringify(args) + ' CWD ' + process.cwd() + '\n');
const st = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
const print = (o) => process.stdout.write(typeof o === 'string' ? o + '\n' : JSON.stringify(o));
if (args[0] === 'pr' && args[1] === 'view') {
  if (!st.pr) { process.stderr.write('no pull requests found for branch "main"\n'); process.exit(1); }
  const n = /^\d+$/.test(args[2] || '') ? +args[2] : null;
  if (n && n !== st.pr.number) { process.stderr.write(`GraphQL: Could not resolve to a PullRequest with the number of ${n}.\n`); process.exit(1); }
  print(st.pr);
} else if (args[0] === 'api' && args.includes('user')) print(st.login);
else if (args[0] === 'api' && /\/pulls\/\d+\/comments/.test(args.find((a) => a.startsWith('repos/')) || '')) print(st.inline || []);
else { process.stderr.write('bilinmeyen komut\n'); process.exit(1); }
