// Проверяет asset-manifest.json: все ли обязательные ассеты на месте.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'public', 'assets', 'asset-manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('Нет asset-manifest.json — запусти: npm run assets:fetch && npm run assets:prepare');
  process.exit(1);
}

const { entries } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const groups = new Map();
let missingRequired = 0;

for (const e of entries) {
  const exists = fs.existsSync(path.join(ROOT, 'public', e.path));
  const cat = e.key.split(/[:/]/)[0];
  if (!groups.has(cat)) groups.set(cat, { ok: 0, total: 0 });
  const g = groups.get(cat);
  g.total++;
  if (exists) g.ok++;
  if (e.required && !exists) {
    console.error(`MISSING REQUIRED: ${e.key} → ${e.path}`);
    missingRequired++;
  }
}

console.log('Ассеты по категориям:');
for (const [cat, g] of groups) console.log(`  ${cat.padEnd(10)} ${g.ok}/${g.total}`);
console.log(missingRequired ? `\nFAIL: ${missingRequired} обязательных отсутствует` : '\nOK: все обязательные ассеты на месте');
process.exit(missingRequired ? 1 : 0);
