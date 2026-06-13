// Большие озёра в крупных пустых зонах карты (Фаза 6D, волна 1). Чистая планировка-
// раскладка sim/lakes node-тестируема. Проверяем инварианты «пустого места» и формы
// чаши (образец: tests/world-hills-terrain.test.ts и tests/sim/waterfall.test.ts):
//   (а) центры озёр на РЕАЛЬНО пустых местах: ≥45 м от дорог, ≥60 м от деревни/дворца/
//       лагеря/замка/водопада/паркура/прудов/POI/концов дорог, cheb<400;
//   (б) озёра не пересекаются между собой/с прудами/с озером водопада;
//   (в) форма чаши: глубина центра 2.5–4 м, дно у кромки выше уровня воды (вода не
//       «вытекает» за rimR), пологий подводный вход (производная глубины мала);
//   (г) дно ниже уровня воды по всей чаше; вне озёр height() не изменилась;
//   (д) расчистка леса (isClear) покрывает зеркало воды и берег;
//   (е) детерминизм (сид-независимость) — те же координаты дают ту же высоту.
import { describe, expect, it } from 'vitest';
import { LAKES, lakeCenter, lakeOuterRadius, carveLakes, lakeWaterDiscs } from '../../src/sim/lakes';
import { findPondSites, pondRadius } from '../../src/world/Ponds';
import { findFortPos } from '../../src/world/VillainFort';
import { Terrain } from '../../src/world/Terrain';
import { lakePlacement } from '../../src/world/Waterfall';
import { fbm2, smoothstep } from '../../src/sim/noise';
import {
  roadDistance,
  flattenFactor,
  WORLD_SIZE,
  VILLAGE,
  PALACE,
  ROADS,
  isClear,
} from '../../src/world/WorldData';
import { distToPolyline } from '../../src/sim/geom';

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

/** Базовая высота БЕЗ холмов/озёр/замка — копия Terrain.baseHeight по чистым функциям. */
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

// Занятые места карты (выверенные координаты мира / WorldData / Landmarks / RoadEnds / fort).
const CAMP = { x: 330, z: 350 }; // лагерь злодея
const CASTLE = { x: 445, z: 360 }; // замок злодея в горах
const WATERFALL = { x: -438, z: 300 }; // низ потока у подножия стены
const PARKOUR = { x: -428, z: -40 }; // якорь скальной паркур-трассы
// Якоря POI-лендмарков (sim/landmarks ANCHORS).
const POI = [
  { x: -260, z: -250 },
  { x: -150, z: 110 },
  { x: 230, z: -8 },
  { x: 300, z: 250 },
  { x: 270, z: -270 },
  { x: -300, z: 240 },
  { x: 40, z: 360 },
];
const ROAD_ENDS = ROADS.map((r) => r[r.length - 1]!);

const terrain = makeTerrain();
const fort = findFortPos(terrain);
// Реальные пруды (sim seed 1337) — координаты выводятся из рельефа, не хардкод.
const ponds = findPondSites(terrain, fort).map((s) => ({ x: s.x, z: s.z, r: pondRadius(SEED, s) }));
const wfLake = lakePlacement(); // озеро водопада у подножия стены

const minDist = (x: number, z: number, pts: { x: number; z: number }[]): number =>
  Math.min(...pts.map((p) => Math.hypot(x - p.x, z - p.z)));

describe('lakes: центры озёр на крупных пустых местах', () => {
  it('3 озера; главное (id west) — большое (effR ≥ 30 м), два поменьше', () => {
    expect(LAKES.length).toBe(3);
    const main = LAKES.find((l) => l.id === 'west')!;
    expect(main).toBeDefined();
    expect(lakeOuterRadius(main)).toBeGreaterThanOrEqual(30);
    for (const l of LAKES) {
      if (l.id === 'west') continue;
      const r = lakeOuterRadius(l);
      expect(r, `${l.id} меньше главного`).toBeLessThan(lakeOuterRadius(main));
      expect(r, `${l.id} effR в 12–28`).toBeGreaterThanOrEqual(12);
      expect(r, `${l.id} effR в 12–28`).toBeLessThanOrEqual(28);
    }
  });

  it('каждый центр: ≥45 м от дорог, ≥60 м от деревни/дворца/лагеря/замка/водопада/паркура/POI/концов', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      const roadD = Math.min(...ROADS.map((r) => distToPolyline(c, r)));
      expect(roadD, `${l.id} до дороги`).toBeGreaterThanOrEqual(45);
      expect(Math.hypot(c.x - VILLAGE.x, c.z - VILLAGE.z), `${l.id} до деревни`).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(c.x - PALACE.x, c.z - PALACE.z), `${l.id} до дворца`).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(c.x - CAMP.x, c.z - CAMP.z), `${l.id} до лагеря`).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(c.x - CASTLE.x, c.z - CASTLE.z), `${l.id} до замка`).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(c.x - WATERFALL.x, c.z - WATERFALL.z), `${l.id} до водопада`).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(c.x - PARKOUR.x, c.z - PARKOUR.z), `${l.id} до паркура`).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(c.x - fort.x, c.z - fort.z), `${l.id} до форта`).toBeGreaterThanOrEqual(60);
      expect(minDist(c.x, c.z, POI), `${l.id} до POI`).toBeGreaterThanOrEqual(60);
      expect(minDist(c.x, c.z, ROAD_ENDS), `${l.id} до концов дорог`).toBeGreaterThanOrEqual(60);
    }
  });

  it('каждый центр внутри играбельной зоны (cheb < 400) и вне сектора замка', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      expect(Math.max(Math.abs(c.x), Math.abs(c.z)), `${l.id} cheb`).toBeLessThan(400);
      expect(c.x > 360 && c.z > 300, `${l.id} в секторе замка`).toBe(false);
    }
  });

  it('дорога не заходит в воду: внешняя кромка озера ≥ 15 м от любой дороги', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      const R = lakeOuterRadius(l);
      const roadD = Math.min(...ROADS.map((r) => distToPolyline(c, r)));
      expect(roadD - R, `${l.id} кромка→дорога`).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('lakes: непересечение с другими водоёмами', () => {
  it('озёра не пересекаются между собой (внешние радиусы + запас)', () => {
    for (let i = 0; i < LAKES.length; i++) {
      for (let j = i + 1; j < LAKES.length; j++) {
        const a = lakeCenter(LAKES[i]!);
        const b = lakeCenter(LAKES[j]!);
        const gap = Math.hypot(a.x - b.x, a.z - b.z) - lakeOuterRadius(LAKES[i]!) - lakeOuterRadius(LAKES[j]!);
        expect(gap, `${LAKES[i]!.id}-${LAKES[j]!.id}`).toBeGreaterThan(20);
      }
    }
  });

  it('озёра не пересекаются с прудами и с озером водопада (зазор кромок > 10 м)', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      const R = lakeOuterRadius(l);
      for (const p of ponds) {
        const gap = Math.hypot(c.x - p.x, c.z - p.z) - R - p.r;
        expect(gap, `${l.id}↔пруд(${p.x.toFixed(0)},${p.z.toFixed(0)})`).toBeGreaterThan(10);
      }
      const gapWf = Math.hypot(c.x - wfLake.x, c.z - wfLake.z) - R - wfLake.r;
      expect(gapWf, `${l.id}↔озеро водопада`).toBeGreaterThan(10);
    }
  });
});

describe('lakes: форма чаши (под лодку волны 2)', () => {
  // terrain.height уже зовёт carveLakes; чтобы не карвить дважды, форму чаши считаем по
  // «сырой» базе (base + ridge, без холмов — у озёр вклад холмов ноль) и карвим один раз.
  const rawBase = (x: number, z: number): number => baseHeight(x, z, SEED);
  const carvedBed = (x: number, z: number): number => carveLakes(x, z, rawBase(x, z));

  it('глубина центра каждого озера 2.5–4 м', () => {
    for (const l of LAKES) {
      let maxDepth = 0;
      for (const disc of l.discs) {
        const depth = l.waterY - carvedBed(disc.x, disc.z);
        if (depth > maxDepth) maxDepth = depth;
      }
      expect(maxDepth, `${l.id} глубина центра`).toBeGreaterThanOrEqual(2.5);
      expect(maxDepth, `${l.id} глубина центра`).toBeLessThanOrEqual(4);
    }
  });

  it('дно ниже уровня воды по всей чаше (внутри ровного дна каждого диска)', () => {
    for (const l of LAKES) {
      for (const disc of l.discs) {
        for (let a = 0; a < Math.PI * 2; a += 0.4) {
          for (let r = 0; r <= disc.flatR; r += 2) {
            const x = disc.x + Math.cos(a) * r;
            const z = disc.z + Math.sin(a) * r;
            expect(carvedBed(x, z), `${l.id} дно над водой @(${x.toFixed(0)},${z.toFixed(0)})`).toBeLessThan(l.waterY);
          }
        }
      }
    }
  });

  it('вода не вытекает за кромку: дно у rimR каждого диска выше уровня воды (шор)', () => {
    for (const l of LAKES) {
      for (const disc of l.discs) {
        for (let a = 0; a < Math.PI * 2; a += 0.25) {
          const x = disc.x + Math.cos(a) * disc.rimR;
          const z = disc.z + Math.sin(a) * disc.rimR;
          // Пропускаем точки кромки, попавшие внутрь другого диска (внутренний шов).
          const insideOther = l.discs.some(
            (o) => o !== disc && Math.hypot(x - o.x, z - o.z) < o.rimR - 0.5,
          );
          if (insideOther) continue;
          expect(carvedBed(x, z), `${l.id} затопление за кромкой @(${x.toFixed(0)},${z.toFixed(0)})`).toBeGreaterThanOrEqual(
            l.waterY,
          );
        }
      }
    }
  });

  it('пологий подводный вход: средний наклон дна в зоне глубины 0.2–1.5 м ≤ 30°', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      const slopes: number[] = [];
      for (let a = 0; a < Math.PI * 2; a += 0.2) {
        let prevDepth: number | null = null;
        for (let d = 0.5; d < 45; d += 0.5) {
          const x = c.x + Math.cos(a) * d;
          const z = c.z + Math.sin(a) * d;
          const depth = l.waterY - carvedBed(x, z);
          if (
            prevDepth !== null &&
            prevDepth > 0.2 && prevDepth < 1.5 &&
            depth > 0.2 && depth < 1.5
          ) {
            slopes.push(Math.abs((depth - prevDepth) / 0.5));
          }
          prevDepth = depth;
        }
      }
      const mean = slopes.length ? slopes.reduce((a, b) => a + b, 0) / slopes.length : 0;
      const deg = (Math.atan(mean) * 180) / Math.PI;
      expect(deg, `${l.id} вход у берега`).toBeLessThanOrEqual(30);
    }
  });
});

describe('lakes: врезка в рельеф и расчистка', () => {
  it('вне озёр height() == базовая формула (контрольные точки)', () => {
    const far: [number, number][] = [
      [0, 120], // деревня
      [0, -380], // дворец
      [8, 138], // спавн
      [330, 350], // лагерь
      [-438, 300], // водопад
      [445, -360], // зеркальный угол горного кольца
      [-150, -100], // холм nw (там свой вклад, но НЕ озеро — проверяем что carveLakes=0)
    ];
    for (const [x, z] of far) {
      // carveLakes не должен трогать рельеф вне внешних радиусов озёр.
      const raw = baseHeight(x, z, SEED);
      expect(carveLakes(x, z, raw), `carveLakes @(${x},${z})`).toBe(raw);
    }
  });

  it('карвинг реально опускает дно в центрах озёр (терраин стал ниже базового)', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      const raw = baseHeight(c.x, c.z, SEED);
      const carved = carveLakes(c.x, c.z, raw);
      expect(carved, `${l.id} дно опущено`).toBeLessThan(raw);
    }
  });

  it('расчистка леса (isClear) покрывает зеркало воды и берег каждого озера', () => {
    for (const l of LAKES) {
      const c = lakeCenter(l);
      const R = lakeOuterRadius(l);
      // Центр и кольцо по кромке воды — лес там сажать нельзя.
      expect(isClear(c.x, c.z), `${l.id} центр свободен для леса?`).toBe(false);
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const x = c.x + Math.cos(a) * (R - 1);
        const z = c.z + Math.sin(a) * (R - 1);
        expect(isClear(x, z), `${l.id} кромка свободна для леса?`).toBe(false);
      }
    }
  });

  it('lakeWaterDiscs совпадают с центрами/внешними радиусами LAKES', () => {
    const discs = lakeWaterDiscs();
    expect(discs.length).toBe(LAKES.length);
    for (let i = 0; i < LAKES.length; i++) {
      const c = lakeCenter(LAKES[i]!);
      expect(discs[i]!.x).toBeCloseTo(c.x, 6);
      expect(discs[i]!.z).toBeCloseTo(c.z, 6);
      expect(discs[i]!.r).toBeCloseTo(lakeOuterRadius(LAKES[i]!), 6);
    }
  });

  it('детерминирован: те же координаты дают ту же высоту', () => {
    const t2 = makeTerrain();
    for (const l of LAKES) {
      const c = lakeCenter(l);
      expect(t2.height(c.x, c.z)).toBe(terrain.height(c.x, c.z));
    }
  });
});
