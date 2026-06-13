// Холмы на пустых полянах (пакет hills-parkour): гауссовы бугры подмешаны в
// Terrain.height. Паркур-редизайн: трасса ушла со «крутого» холма на скальную стену
// (Parkour.ts), все 4 холма теперь ПОЛОГИЕ. Проверяем: (а) центры холмов на РЕАЛЬНО
// пустых местах (дистанции до дорог/деревни/дворца/лагеря/водопада/прудов/POI/концов
// дорог + вне сектора замка + cheb<370), (б) высота вне холмов не изменилась
// (контрольные точки), (в) холмы реально поднимают рельеф, и все склоны ≤ ~22°
// (забираться пешком).
import { describe, expect, it } from 'vitest';
import { Terrain, HILLS, hillsHeight, PARKOUR_HILL } from '../src/world/Terrain';
import { fbm2, smoothstep } from '../src/sim/noise';
import {
  roadDistance,
  flattenFactor,
  WORLD_SIZE,
  VILLAGE,
  PALACE,
  ROADS,
  PARKOUR_CLEARING,
} from '../src/world/WorldData';
import { distToPolyline } from '../src/sim/geom';

const SEED = 1337;
function makeTerrain(): Terrain {
  return new Terrain({
    size: WORLD_SIZE,
    segments: 256,
    seed: SEED,
    amplitude: 13,
    noiseScale: 150,
    flattenMask: flattenFactor,
  });
}

/** Базовая высота БЕЗ холмов/замка — копия Terrain.baseHeight по чистым функциям. */
function baseHeight(x: number, z: number, seed: number): number {
  const n = fbm2(x / 150, z / 150, seed, 4);
  const mask = flattenFactor(x, z);
  let h = n * 13 * mask;
  const d = Math.max(Math.abs(x), Math.abs(z));
  const t = smoothstep(425, 498, d);
  if (t > 0) {
    const roadGap = smoothstep(12, 50, roadDistance(x, z));
    const ridge = fbm2(x / 45, z / 45, seed ^ 0x9e37, 3);
    h += t * t * 95 * roadGap + t * ridge * 14 * roadGap;
  }
  return h;
}

// Ключевые лендмарки/локации, от которых холмы держат дистанцию (выверенные координаты мира
// и WorldData/Landmarks/Chests/RoadEnds — источники истины для пустых мест).
const CAMP = { x: 330, z: 350 }; // лагерь злодея
// Водопад переехал в юго-западную горную стену (водопад-редизайн): низ потока у
// подножия стены (cheb=438). Холмы держат ≥70 м (источник: Waterfall.WATERFALL).
const WATERFALL = { x: -438, z: 300 };
const PONDS = [
  { x: -295, z: 30 },
  { x: -320, z: -145 },
  { x: 280, z: 155 },
];
// Якоря POI-лендмарков (sim/landmarks ANCHORS) — холмы не должны налезать.
const POI = [
  { x: -260, z: -250 },
  { x: -150, z: 110 },
  { x: 230, z: -8 },
  { x: 300, z: 250 },
  { x: 270, z: -270 },
  { x: -300, z: 240 },
  { x: 40, z: 360 },
];
// Концы 4 дорог (локации RoadEnds) — последние точки полилиний ROADS.
const ROAD_ENDS = ROADS.map((r) => r[r.length - 1]!);

const minDist = (x: number, z: number, pts: { x: number; z: number }[]): number =>
  Math.min(...pts.map((p) => Math.hypot(x - p.x, z - p.z)));

describe('hills-parkour: центры холмов на пустых местах', () => {
  it('4 пологих холма (паркур-холм стал обычным после редизайна трассы)', () => {
    expect(HILLS.length).toBe(4);
    // Бывший паркур-холм (150,90) сохранил id 'parkour', но стал пологим холмом.
    expect(PARKOUR_HILL.id).toBe('parkour');
    expect(PARKOUR_HILL.cx).toBe(150);
    expect(PARKOUR_HILL.cz).toBe(90);
  });

  it('каждый центр: ≥45 м от дорог, ≥70 м от деревни/дворца/лагеря/водопада/прудов/POI/концов', () => {
    for (const h of HILLS) {
      const roadD = Math.min(...ROADS.map((r) => distToPolyline({ x: h.cx, z: h.cz }, r)));
      expect(roadD, `${h.id} до дороги`).toBeGreaterThanOrEqual(45);
      expect(Math.hypot(h.cx - VILLAGE.x, h.cz - VILLAGE.z), `${h.id} до деревни`).toBeGreaterThanOrEqual(70);
      expect(Math.hypot(h.cx - PALACE.x, h.cz - PALACE.z), `${h.id} до дворца`).toBeGreaterThanOrEqual(70);
      expect(Math.hypot(h.cx - CAMP.x, h.cz - CAMP.z), `${h.id} до лагеря`).toBeGreaterThanOrEqual(70);
      expect(Math.hypot(h.cx - WATERFALL.x, h.cz - WATERFALL.z), `${h.id} до водопада`).toBeGreaterThanOrEqual(70);
      expect(minDist(h.cx, h.cz, PONDS), `${h.id} до прудов`).toBeGreaterThanOrEqual(70);
      expect(minDist(h.cx, h.cz, POI), `${h.id} до POI`).toBeGreaterThanOrEqual(70);
      expect(minDist(h.cx, h.cz, ROAD_ENDS), `${h.id} до концов дорог`).toBeGreaterThanOrEqual(70);
    }
  });

  it('каждый центр: вне сектора замка/серпантина (x>360 && z>300) и cheb < 370', () => {
    for (const h of HILLS) {
      expect(h.cx > 360 && h.cz > 300, `${h.id} в секторе замка`).toBe(false);
      expect(Math.max(Math.abs(h.cx), Math.abs(h.cz)), `${h.id} cheb`).toBeLessThan(370);
    }
  });

  it('холмы не пересекаются друг с другом (центры разнесены > сумм 3σ)', () => {
    for (let i = 0; i < HILLS.length; i++) {
      for (let j = i + 1; j < HILLS.length; j++) {
        const a = HILLS[i]!;
        const b = HILLS[j]!;
        const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
        expect(d, `${a.id}-${b.id}`).toBeGreaterThan(3 * (a.sigma + b.sigma));
      }
    }
  });

  it('круг расчистки леса PARKOUR_CLEARING совпадает с центром паркур-холма', () => {
    expect(PARKOUR_CLEARING.x).toBe(PARKOUR_HILL.cx);
    expect(PARKOUR_CLEARING.z).toBe(PARKOUR_HILL.cz);
  });
});

describe('hills-parkour: рельеф', () => {
  const terrain = makeTerrain();

  it('вне холмов height() == базовая формула (контрольные точки)', () => {
    const far: [number, number][] = [
      [0, 120], // деревня
      [0, -380], // дворец
      [8, 138], // спавн
      [-400, -400], // дальний угол
      [330, 350], // лагерь
      [-438, 300], // водопад (низ потока у подножия стены)
      [445, -360], // зеркальный угол горного кольца (вне плато замка и холмов)
      [280, 155], // пруд
    ];
    for (const [x, z] of far) {
      // Гарантия: вклад холмов в этих точках строго ноль (3.2σ-отсечка).
      expect(hillsHeight(x, z), `холмы в (${x},${z})`).toBe(0);
      expect(terrain.height(x, z)).toBeCloseTo(baseHeight(x, z, SEED), 6);
    }
  });

  it('на вершине каждого холма рельеф поднят примерно на height холма', () => {
    for (const h of HILLS) {
      const top = terrain.height(h.cx, h.cz);
      const base = baseHeight(h.cx, h.cz, SEED);
      // На вершине вклад холма = h.height (плюс хвосты соседей ≈ 0 — они далеко).
      expect(top - base).toBeCloseTo(h.height, 1);
    }
  });

  it('все холмы пологие (макс. наклон гауссианы ≤ ~22° — забираться пешком)', () => {
    // Макс. наклон гауссианы h=H·exp(−d²/2σ²) достигается при d=σ: tan = (H/σ)·e^-0.5.
    const slopeDeg = (H: number, s: number): number =>
      (Math.atan((H / s) * Math.exp(-0.5)) * 180) / Math.PI;
    for (const h of HILLS) {
      const deg = slopeDeg(h.height, h.sigma);
      expect(deg, `${h.id}`).toBeLessThanOrEqual(22);
    }
  });

  it('детерминирован: те же координаты дают ту же высоту', () => {
    const t2 = makeTerrain();
    for (const h of HILLS) {
      expect(t2.height(h.cx, h.cz)).toBe(terrain.height(h.cx, h.cz));
    }
  });
});
