// Контракт раскладки водопада-в-стене (водопад-редизайн): озеро у ПОДНОЖИЯ юго-западной
// горной стены, отшельник на открытом берегу (со стороны центра карты), зев врезан в
// склон на +12–16 м над озером. Проверяем:
//   (а) lakePlacement — чистая функция: детерминизм, радиус, отшельник на берегу (не в
//       воде), центр озера сдвинут к стене, точка падения потока внутри озера;
//   (б) МЕСТО WATERFALL в сплошной юго-западной стене (не в дорожном ущелье) на cheb≈438;
//   (в) ВЫСОТА зева: на MOUTH (вглубь склона) терраин поднят на +12–16 м над уровнем
//       озера у подножия — на РЕАЛЬНОМ террейне с горным валом.
import { describe, expect, it } from 'vitest';
import { lakePlacement, WATERFALL, MOUTH, MOUTH_INWARD, HERMIT_OFFSET } from '../../src/world/Waterfall';
import { Terrain } from '../../src/world/Terrain';
import { flattenFactor, WORLD_SIZE, ROADS, roadDistance } from '../../src/world/WorldData';
import { distToPolyline } from '../../src/sim/geom';

/** Якорь отшельника из WorldNpcs: WATERFALL сдвинут на HERMIT_OFFSET по орту к центру
 *  карты (открытый берег озера, прочь от стены). Орт к центру = −WATERFALL/|WATERFALL|. */
const wd = Math.hypot(WATERFALL.x, WATERFALL.z) || 1;
const HERMIT = {
  x: WATERFALL.x + (-WATERFALL.x / wd) * HERMIT_OFFSET,
  z: WATERFALL.z + (-WATERFALL.z / wd) * HERMIT_OFFSET,
};

function makeTerrain(): Terrain {
  return new Terrain({
    size: WORLD_SIZE,
    segments: 256,
    seed: 1337,
    amplitude: 13,
    noiseScale: 150,
    flattenMask: flattenFactor,
  });
}

describe('lakePlacement (озеро водопада у подножия стены)', () => {
  it('детерминированно: один вход → один центр/радиус', () => {
    const a = lakePlacement();
    const b = lakePlacement();
    expect(a).toEqual(b);
  });

  it('радиус в требуемом диапазоне ~7–9 м', () => {
    const { r } = lakePlacement();
    expect(r).toBeGreaterThanOrEqual(7);
    expect(r).toBeLessThanOrEqual(9);
  });

  it('отшельник стоит на берегу, не в воде (дистанция до центра > радиуса)', () => {
    const lake = lakePlacement();
    const d = Math.hypot(HERMIT.x - lake.x, HERMIT.z - lake.z);
    // Запас берега — отшельник заметно дальше кромки воды.
    expect(d).toBeGreaterThan(lake.r + 1.0);
  });

  it('центр озера сдвинут от WATERFALL прочь от отшельника (к подножию стены)', () => {
    const lake = lakePlacement();
    const dHermitToWaterfall = Math.hypot(HERMIT.x - WATERFALL.x, HERMIT.z - WATERFALL.z);
    const dHermitToLake = Math.hypot(HERMIT.x - lake.x, HERMIT.z - lake.z);
    // Озеро дальше от отшельника, чем сама точка водопада → ушло к стене.
    expect(dHermitToLake).toBeGreaterThan(dHermitToWaterfall);
  });

  it('точка падения потока (WATERFALL) лежит внутри озера (поток бьёт в воду)', () => {
    const lake = lakePlacement();
    const d = Math.hypot(WATERFALL.x - lake.x, WATERFALL.z - lake.z);
    expect(d).toBeLessThan(lake.r);
  });
});

describe('место водопада в юго-западной горной стене', () => {
  it('WATERFALL в юго-западном секторе (x<0, z>0)', () => {
    expect(WATERFALL.x).toBeLessThan(0);
    expect(WATERFALL.z).toBeGreaterThan(0);
  });

  it('подножие у горного кольца: cheb 425–445 (склон уже поднимается)', () => {
    const cheb = Math.max(Math.abs(WATERFALL.x), Math.abs(WATERFALL.z));
    expect(cheb).toBeGreaterThanOrEqual(425);
    expect(cheb).toBeLessThanOrEqual(445);
  });

  it('в СПЛОШНОЙ стене, не в дорожном ущелье (≥45 м от полилиний дорог)', () => {
    const roadD = Math.min(...ROADS.map((r) => distToPolyline(WATERFALL, r)));
    expect(roadD).toBeGreaterThanOrEqual(45);
    // И сам зев вглубь склона тоже вне ущелья (иначе гора там расступилась бы).
    expect(roadDistance(MOUTH.x, MOUTH.z)).toBeGreaterThanOrEqual(45);
  });

  it('зев сдвинут вглубь склона (к −x, в гору) на MOUTH_INWARD', () => {
    expect(MOUTH.z).toBe(WATERFALL.z);
    expect(WATERFALL.x - MOUTH.x).toBeCloseTo(MOUTH_INWARD, 6);
    // Зев глубже в стене — его cheb больше, чем у подножия.
    expect(Math.max(Math.abs(MOUTH.x), Math.abs(MOUTH.z))).toBeGreaterThan(
      Math.max(Math.abs(WATERFALL.x), Math.abs(WATERFALL.z)),
    );
  });
});

describe('высота зева над озером (на реальном террейне)', () => {
  const terrain = makeTerrain();

  it('зев врезан в склон: терраин на MOUTH на +12–16 м выше уровня озера у подножия', () => {
    const footY = terrain.height(WATERFALL.x, WATERFALL.z); // уровень озера у подножия
    const mouthY = terrain.height(MOUTH.x, MOUTH.z); // склон в точке зева
    const rise = mouthY - footY;
    expect(rise).toBeGreaterThanOrEqual(12);
    expect(rise).toBeLessThanOrEqual(16);
  });

  it('подножие реально у троге стены (склон у WATERFALL близок к нулю/низу)', () => {
    // У подножия стены терраин ещё не пошёл в гору — озеро лежит ровно.
    const footY = terrain.height(WATERFALL.x, WATERFALL.z);
    expect(footY).toBeLessThan(3); // не на склоне, у самого основания вала
  });

  it('детерминировано: те же координаты дают ту же высоту', () => {
    const t2 = makeTerrain();
    expect(t2.height(MOUTH.x, MOUTH.z)).toBe(terrain.height(MOUTH.x, MOUTH.z));
  });
});
