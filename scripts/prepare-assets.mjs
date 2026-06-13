// Копирует нужные модели из vendor/ в public/assets/, пакуя .gltf в самодостаточные
// meshopt-сжатые .glb (gltf-transform). Пишет public/assets/asset-manifest.json.
// Идемпотентен: пропускает уже готовые файлы (dst новее src).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
const OUT = path.join(ROOT, 'public', 'assets');
const GLTF_TRANSFORM = path.join(ROOT, 'node_modules', '.bin', 'gltf-transform');

// ---------------- Манифест желаемых ассетов ----------------
// kind: 'model' → gltf-transform meshopt → .glb; 'file' → копия как есть.
// root — подпапка vendor/ для поиска; find — regex по имени файла (basename, lowercase).
const WANT = [
  // Персонажи (KayKit Adventurers + Skeletons) — обязательные
  ...['knight', 'barbarian', 'mage', 'rogue', 'rogue_hooded'].map((n) => ({
    key: `char:${n}`, kind: 'model', root: 'KayKit-Character-Pack-Adventures-1.0',
    find: new RegExp(`^${n}(\\.gltf)?\\.(glb|gltf)$`, 'i'), out: `characters/${n}.glb`, required: true,
  })),
  ...['skeleton_warrior', 'skeleton_mage', 'skeleton_rogue', 'skeleton_minion'].map((n) => ({
    key: `char:${n}`, kind: 'model', root: 'KayKit-Character-Pack-Skeletons-1.0',
    find: new RegExp(`^${n}(\\.gltf)?\\.(glb|gltf)$`, 'i'), out: `characters/${n}.glb`, required: true,
  })),

  // Оружие (KayKit Adventurers): два обязательных, остальные — что найдётся
  { key: 'weapon:sword_1handed', kind: 'model', root: 'KayKit-Character-Pack-Adventures-1.0',
    find: /^sword_1handed(\.gltf)?\.(glb|gltf)$/i, out: 'weapons/sword_1handed.glb', required: true },
  { key: 'weapon:crossbow_2handed', kind: 'model', root: 'KayKit-Character-Pack-Adventures-1.0',
    find: /^crossbow_2handed(\.gltf)?\.(glb|gltf)$/i, out: 'weapons/crossbow_2handed.glb', required: true },
  { key: 'weapons:misc', kind: 'model-all', root: 'KayKit-Character-Pack-Adventures-1.0',
    find: /^(sword_2handed|axe_1handed|axe_2handed|dagger|crossbow_1handed|arrow|arrow_bundle|quiver|shield_round|shield_square|shield_spikes)(\.gltf)?\.(glb|gltf)$/i,
    outDir: 'weapons', required: false },

  // Лут и пропы (KayKit Dungeon Remastered)
  { key: 'prop:chest', kind: 'model', root: 'KayKit-Dungeon-Remastered-1.0',
    find: /^chest(\.gltf)?\.(glb|gltf)$/i, out: 'props/chest.glb', required: true },
  { key: 'prop:chest_gold', kind: 'model', root: 'KayKit-Dungeon-Remastered-1.0',
    find: /^chest_gold(\.gltf)?\.(glb|gltf)$/i, out: 'props/chest_gold.glb', required: true },
  { key: 'props:misc', kind: 'model-all', root: 'KayKit-Dungeon-Remastered-1.0',
    find: /^(coin|coin_stack_small|coin_stack_medium|coin_stack_large|key|keyring|barrel_small|barrel_large|crates_stacked|crate|torch_lit|torch|bottle_[abc]_(brown|green)|table_small|banner)(\.gltf)?\.(glb|gltf)$/i,
    outDir: 'props', required: false },

  // Мир: KayKit Medieval Hexagon — дома, замок, деревья, скалы, заборы
  { key: 'world:hexagon', kind: 'model-all', root: 'KayKit-Medieval-Hexagon-Pack-1.0',
    find: /^(building_[a-z0-9_]+|tree_single_[a-z]|trees_[a-z]_(small|medium|large)|rock_single_[a-z]|fence_[a-z0-9_]+|gate_?[a-z0-9_]*|tent(_[a-z0-9_]+)?|sack(_[a-z0-9_]+)?|wheelbarrow|weaponrack|flag_[a-z0-9_]+|watermill|windmill)(\.gltf)?\.(glb|gltf)$/i,
    outDir: 'world/hexagon', required: false },
  // Минимум для деревни — обязательный дом и дерево
  { key: 'world:home_a', kind: 'model', root: 'KayKit-Medieval-Hexagon-Pack-1.0',
    find: /^building_home_a([_.].*)?(\.gltf)?\.(glb|gltf)$/i, out: 'world/hexagon/building_home_A.glb', required: true },

  // Kenney Nature Kit — лесная растительность (Фаза 2)
  { key: 'world:nature', kind: 'model-all', root: 'kenney_nature-kit',
    find: /^(tree_pine[\w-]*|tree_oak[\w-]*|tree_default[\w-]*|tree_simple[\w-]*|rock_large[\w-]*|rock_small[\w-]*|plant_bush[\w-]*|mushroom_red[\w-]*|stump_[\w-]+|log_?[\w-]*|cliff_block[\w-]*)\.(glb|gltf)$/i,
    outDir: 'world/nature', required: false },

  // Kenney Fantasy Town — рыночные пропы для деревни
  { key: 'world:town', kind: 'model-all', root: 'kenney_fantasy-town-kit',
    find: /^(stall[\w-]*|cart[\w-]*|crate[\w-]*|barrel[\w-]*|well[\w-]*|lantern[\w-]*|banner[\w-]*|overhang[\w-]*|pole[\w-]*|wheel[\w-]*|planks[\w-]*|fountain[\w-]*)\.(glb|gltf)$/i,
    outDir: 'world/town', required: false },

  // Kenney Survival — груз корована
  { key: 'world:survival', kind: 'model-all', root: 'kenney_survival-kit',
    find: /^(crate[\w-]*|barrel[\w-]*|resource[\w-]*|campfire[\w-]*|tent[\w-]*|box[\w-]*)\.(glb|gltf)$/i,
    outDir: 'world/survival', required: false },

  // Телега-корован (poly.pizza CDN)
  { key: 'world:cart', kind: 'model', root: 'polypizza',
    find: /^cart\.glb$/i, out: 'world/cart.glb', required: true },

  // Tier B: животные и лук (Quaternius, опциональные)
  ...['horse', 'donkey', 'wolf', 'deer', 'stag', 'fox', 'cow', 'bull'].map((n) => ({
    key: `animal:${n}`, kind: 'model', root: 'quaternius_animals',
    find: new RegExp(`^${n}(\\.gltf)?\\.(glb|gltf)$`, 'i'), out: `animals/${n}.glb`, required: false,
  })),
  { key: 'weapon:bow', kind: 'model', root: 'quaternius_weapons',
    find: /^(?!.*cross)(bow(_\w+)?|\w*_bow)(\.gltf)?\.(glb|gltf)$/i, out: 'weapons/bow.glb', required: false },

  // Небо и текстуры (Poly Haven)
  { key: 'hdri:sky', kind: 'file', root: 'polyhaven', find: /^sky_day_2k\.hdr$/i,
    out: 'hdri/sky_day_2k.hdr', required: true },
  ...['grass', 'dirt', 'rock'].flatMap((t) =>
    ['diff', 'nor_gl', 'rough'].map((m) => ({
      key: `tex:${t}_${m}`, kind: 'file', root: 'polyhaven',
      find: new RegExp(`^${t}_${m}_1k\\.jpg$`, 'i'), out: `textures/${t}_${m}_1k.jpg`,
      required: t === 'grass' && m === 'diff',
    }))),
];

// ---------------- Индексация vendor/ ----------------
function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.git') continue;
      walk(p, acc);
    } else acc.push(p);
  }
  return acc;
}

function scorePath(p) {
  // Предпочитаем glb > gltf, и пути с 'gltf' в директории; избегаем fbx/obj/source
  const lower = p.toLowerCase();
  let s = 0;
  if (lower.endsWith('.glb')) s += 10;
  if (lower.includes('gltf')) s += 5;
  if (/\b(fbx|obj|source|blend)\b/.test(lower)) s -= 100;
  s -= p.length / 1000;
  return s;
}

const allFiles = walk(VENDOR, []);
const byRoot = new Map();
for (const f of allFiles) {
  const rel = path.relative(VENDOR, f);
  const root = rel.split(path.sep)[0];
  if (!byRoot.has(root)) byRoot.set(root, []);
  byRoot.get(root).push(f);
}

function findIn(root, regex) {
  const files = byRoot.get(root) ?? [];
  const matches = files.filter((f) => regex.test(path.basename(f)));
  matches.sort((a, b) => scorePath(b) - scorePath(a));
  return matches;
}

// ---------------- Обработка ----------------
const manifest = [];
const jobs = [];

function needsUpdate(src, dst) {
  if (!fs.existsSync(dst)) return true;
  try { return fs.statSync(src).mtimeMs > fs.statSync(dst).mtimeMs; } catch { return true; }
}

function addJob(key, kind, src, outRel, required) {
  const dst = path.join(OUT, outRel);
  manifest.push({ key, path: `assets/${outRel}`, required, src: src ? path.relative(ROOT, src) : null });
  if (!src) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (!needsUpdate(src, dst)) return;
  if (kind === 'file') {
    jobs.push(async () => fs.copyFileSync(src, dst));
  } else {
    jobs.push(async () => {
      try {
        await execFileP(GLTF_TRANSFORM, ['meshopt', src, dst], { timeout: 120_000 });
      } catch (err) {
        if (src.toLowerCase().endsWith('.glb')) {
          console.warn(`WARN: gltf-transform failed for ${path.basename(src)}, raw copy. ${err.message?.slice(0, 120)}`);
          fs.copyFileSync(src, dst);
        } else {
          console.warn(`WARN: cannot convert ${path.basename(src)}: ${err.message?.slice(0, 200)}`);
          throw err;
        }
      }
    });
  }
}

for (const want of WANT) {
  if (want.kind === 'model-all') {
    const matches = findIn(want.root, want.find);
    const seen = new Set();
    for (const m of matches) {
      const base = path.basename(m).toLowerCase().replace(/(\.gltf)?\.(glb|gltf)$/i, '');
      if (seen.has(base)) continue;
      seen.add(base);
      addJob(`${want.key}/${base}`, 'model', m, `${want.outDir}/${base}.glb`, false);
    }
    if (matches.length === 0) console.warn(`WARN: ${want.key}: ничего не найдено в ${want.root}`);
  } else {
    const m = findIn(want.root, want.find)[0] ?? null;
    if (!m && want.required) console.warn(`WARN: REQUIRED ${want.key} не найден в ${want.root}`);
    addJob(want.key, want.kind, m, want.out, want.required);
  }
}

// Пул на 6 параллельных задач
const POOL = 6;
let idx = 0;
let failed = 0;
async function worker() {
  while (idx < jobs.length) {
    const job = jobs[idx++];
    try { await job(); } catch { failed++; }
  }
}
console.log(`prepare-assets: ${jobs.length} файлов к обработке...`);
await Promise.all(Array.from({ length: POOL }, worker));

// Финальный манифест: отметить наличие на диске
for (const entry of manifest) {
  entry.ok = fs.existsSync(path.join(ROOT, 'public', entry.path));
  delete entry.src;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'asset-manifest.json'), JSON.stringify({ generated: true, entries: manifest }, null, 1));

const okCount = manifest.filter((e) => e.ok).length;
const missingRequired = manifest.filter((e) => e.required && !e.ok);
console.log(`prepare-assets: готово ${okCount}/${manifest.length} (конвертаций упало: ${failed})`);
if (missingRequired.length) {
  console.error('ОТСУТСТВУЮТ ОБЯЗАТЕЛЬНЫЕ:', missingRequired.map((e) => e.key).join(', '));
  process.exit(1);
}
