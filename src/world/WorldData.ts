// Карта мира: ключевые локации, дороги, маски выравнивания. Чистый TS (без three).
import { distToPolyline, type P2 } from '../sim/geom';
import { smoothstep } from '../sim/noise';
import { lakeWaterDiscs } from '../sim/lakes';

export const WORLD_SIZE = 1000;

/** Деревня эльфов — юго-центр. */
export const VILLAGE = { x: 0, z: 120, radius: 48 };
/** Дворец — север. */
export const PALACE = { x: 0, z: -380, radius: 70 };
/** Точка спавна игрока — у деревни. */
export const SPAWN = { x: 8, z: 138 };

/**
 * Дороги (полилинии). ROADS[0] — главный тракт дворец→деревня→юг,
 * по нему ездят корованы. Остальные — ответвления.
 */
export const ROADS: P2[][] = [
  [
    { x: 0, z: -380 },
    { x: 6, z: -300 },
    { x: -18, z: -210 },
    { x: -10, z: -120 },
    { x: 4, z: -30 },
    { x: -4, z: 60 },
    { x: 0, z: 120 },
    { x: 10, z: 210 },
    { x: -2, z: 320 },
    { x: 4, z: 470 },
  ],
  [
    { x: 4, z: -30 },
    { x: 90, z: -20 },
    { x: 180, z: -55 },
    { x: 290, z: -35 },
    { x: 400, z: -70 },
    { x: 470, z: -70 },
  ],
  [
    { x: -4, z: 60 },
    { x: -100, z: 85 },
    { x: -200, z: 60 },
    { x: -320, z: 95 },
    { x: -470, z: 85 },
  ],
  // Северо-восточный просёлок к мельнице: ответвление от тракта у (6,-300)
  // в пустой северо-восточный квадрант, упирается в горное кольцо.
  [
    { x: 6, z: -300 },
    { x: 110, z: -300 },
    { x: 230, z: -330 },
    { x: 360, z: -340 },
    { x: 470, z: -350 },
  ],
];

export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const road of ROADS) {
    const d = distToPolyline({ x, z }, road);
    if (d < best) best = d;
  }
  return best;
}

const radialFactor = (x: number, z: number, cx: number, cz: number, r: number): number =>
  smoothstep(r * 0.75, r * 1.7, Math.hypot(x - cx, z - cz));

/**
 * Множитель амплитуды рельефа: 0 — плоско (деревня/дворец), 1 — полный шум.
 * Дороги сглажены до 18% — лёгкие уклоны остаются.
 */
export function flattenFactor(x: number, z: number): number {
  const village = radialFactor(x, z, VILLAGE.x, VILLAGE.z, VILLAGE.radius);
  const palace = radialFactor(x, z, PALACE.x, PALACE.z, PALACE.radius);
  const road = 0.18 + 0.82 * smoothstep(8, 22, roadDistance(x, z));
  return Math.min(village, palace, road);
}

/**
 * Расчистка под холм (150,90) (пакет hills-parkour): на вершине пологого холма —
 * rare-сундук, небольшую полянку вокруг него лесом не засаживаем, чтобы деревья не
 * заслоняли приз и подход. Паркур-редизайн перенёс трассу со «крутого» холма на
 * скальную стену (Parkour.ts), прыгать тут уже не надо — поэтому круг уменьшен до
 * полянки на вершине. Центр совпадает с PARKOUR_HILL в Terrain.ts (источник высоты);
 * дублируем как plain-число здесь, чтобы isClear не зависел от Terrain (он тянет
 * three и создал бы цикл импортов). Согласованность центра проверяет юнит-тест.
 */
export const PARKOUR_CLEARING = { x: 150, z: 90, r: 14 } as const;

/**
 * Круги расчистки под озёра (Фаза 6D, волна 1): зеркало воды + берег. Лес/камни/звери
 * не лезут в воду и в полосу берега (прошлая жалоба на пруды — без нагромождения у
 * кромки). Радиус = внешний радиус озера + LAKE_BANK (берег). Центры/радиусы берём из
 * единственного источника истины sim/lakes (LAKES) — никакого дублирования координат.
 */
const LAKE_BANK = 5;
export const LAKE_CLEARINGS: readonly { x: number; z: number; r: number }[] = lakeWaterDiscs().map(
  (d) => ({ x: d.x, z: d.z, r: d.r + LAKE_BANK }),
);

/** Можно ли тут сажать лес/камни: вне деревни, дворца, дорог, паркур-холма и озёр. */
export function isClear(x: number, z: number, margin = 0): boolean {
  if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.radius + 12 + margin) return false;
  if (Math.hypot(x - PALACE.x, z - PALACE.z) < PALACE.radius + 15 + margin) return false;
  if (roadDistance(x, z) < 10 + margin) return false;
  if (Math.max(Math.abs(x), Math.abs(z)) > 435) return false; // не лезть на горную стену (профиль с d=425)
  // Паркур-холм: круг расчистки леса (трасса из ящиков/брёвен наверх).
  if (Math.hypot(x - PARKOUR_CLEARING.x, z - PARKOUR_CLEARING.z) < PARKOUR_CLEARING.r + margin) return false;
  // Озёра: зеркало воды + берег — деревья/камни/звери в воде не растут.
  for (const lake of LAKE_CLEARINGS) {
    if (Math.hypot(x - lake.x, z - lake.z) < lake.r + margin) return false;
  }
  return true;
}
