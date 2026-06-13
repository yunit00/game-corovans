// Скальная паркур-трасса на горной стене (паркур-редизайн): выступы, врезанные в
// склон вала у западного края карты, ведут зигзагом вверх к пещере с epic-сундуком.
// Проверяем на РЕАЛЬНОМ террейне (height с горным валом):
//   (а) инварианты МЕСТА подножия ANCHOR: ≥60 м от водопада/пирса/прудов/концов дорог/
//       дворца, ≥45 м от полилиний дорог, вне сектора замка, cheb 415-435;
//   (б) ДОСТИЖИМОСТЬ: первая полка ≤1.2 над землёй; каждый шаг Δh ≤2.2 И горизонталь
//       ≤3.4; монотонный набор высоты;
//   (в) ПЕЩЕРА врезана в стену: высота склона в точке пещеры ≥ пол пещеры + 4 м;
//   (г) сундук внутри кармана (caveChest == последняя точка трассы).
// Раскладка детерминирована.
import { describe, expect, it } from 'vitest';
import { Terrain } from '../src/world/Terrain';
import { flattenFactor, WORLD_SIZE, ROADS, PALACE } from '../src/world/WorldData';
import { distToPolyline } from '../src/sim/geom';
import { planRockRoute, caveChest, ANCHOR, CAVE_CHEST, LEDGE_COUNT } from '../src/world/Parkour';

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

// Лендмарки/POI, от которых трасса держит дистанцию (выверенные координаты мира).
// Водопад переехал в юго-западную горную стену (водопад-редизайн): низ потока у
// подножия стены на cheb=438 — продублирован plain-числами (источник: Waterfall.WATERFALL).
const WATERFALL = { x: -438, z: 300 };
const PIER = { x: -295, z: 43 };
const PONDS = [
  { x: -295, z: 30 },
  { x: -320, z: -145 },
  { x: 280, z: 155 },
];
const ROAD_ENDS = ROADS.map((r) => r[r.length - 1]!);
const minDist = (x: number, z: number, pts: { x: number; z: number }[]): number =>
  Math.min(...pts.map((p) => Math.hypot(x - p.x, z - p.z)));

describe('паркур-стена: инварианты места подножия (ANCHOR)', () => {
  it('cheb подножия в 415-435 (у начала горного вала)', () => {
    const cheb = Math.max(Math.abs(ANCHOR.x), Math.abs(ANCHOR.z));
    expect(cheb).toBeGreaterThanOrEqual(415);
    expect(cheb).toBeLessThanOrEqual(435);
  });

  it('≥45 м от полилиний дорог', () => {
    const roadD = Math.min(...ROADS.map((r) => distToPolyline(ANCHOR, r)));
    expect(roadD).toBeGreaterThanOrEqual(45);
  });

  it('≥60 м от водопада/пирса/прудов/концов дорог/дворца', () => {
    expect(Math.hypot(ANCHOR.x - WATERFALL.x, ANCHOR.z - WATERFALL.z), 'водопад').toBeGreaterThanOrEqual(60);
    expect(Math.hypot(ANCHOR.x - PIER.x, ANCHOR.z - PIER.z), 'пирс').toBeGreaterThanOrEqual(60);
    expect(minDist(ANCHOR.x, ANCHOR.z, PONDS), 'пруды').toBeGreaterThanOrEqual(60);
    expect(minDist(ANCHOR.x, ANCHOR.z, ROAD_ENDS), 'концы дорог').toBeGreaterThanOrEqual(60);
    expect(Math.hypot(ANCHOR.x - PALACE.x, ANCHOR.z - PALACE.z), 'дворец').toBeGreaterThanOrEqual(60);
  });

  it('вне сектора замка (НЕ x>360 && z>300)', () => {
    expect(ANCHOR.x > 360 && ANCHOR.z > 300).toBe(false);
  });
});

describe('паркур-стена: раскладка и достижимость', () => {
  const terrain = makeTerrain();
  const ledges = planRockRoute((x, z) => terrain.height(x, z));

  it('число точек = LEDGE_COUNT (9-12)', () => {
    expect(ledges.length).toBe(LEDGE_COUNT);
    expect(LEDGE_COUNT).toBeGreaterThanOrEqual(9);
    expect(LEDGE_COUNT).toBeLessThanOrEqual(12);
  });

  it('первая полка достижима с земли (top − ground ≤ 1.2)', () => {
    const first = ledges[0]!;
    expect(first.topY - first.groundY).toBeLessThanOrEqual(1.2);
    expect(first.topY - first.groundY).toBeGreaterThan(0); // реально над землёй
  });

  it('каждый следующий шаг: подъём Δh ≤ 2.2 и горизонталь ≤ 3.4', () => {
    for (let i = 1; i < ledges.length; i++) {
      const a = ledges[i - 1]!;
      const b = ledges[i]!;
      const dh = b.topY - a.topY;
      const horiz = Math.hypot(b.x - a.x, b.z - a.z);
      expect(dh, `шаг ${i} Δh`).toBeLessThanOrEqual(2.2);
      expect(dh, `шаг ${i} Δh неотрицателен`).toBeGreaterThanOrEqual(0);
      expect(horiz, `шаг ${i} горизонталь`).toBeLessThanOrEqual(3.4);
    }
  });

  it('лесенка монотонна вверх (шаги не «ныряют» вниз)', () => {
    for (let i = 1; i < ledges.length; i++) {
      expect(ledges[i]!.topY, `шаг ${i}`).toBeGreaterThanOrEqual(ledges[i - 1]!.topY);
    }
  });

  it('трасса идёт ВГЛУБЬ стены (cheb растёт от подножия к пещере)', () => {
    const first = ledges[0]!;
    const last = ledges[ledges.length - 1]!;
    const chebFirst = Math.max(Math.abs(first.x), Math.abs(first.z));
    const chebLast = Math.max(Math.abs(last.x), Math.abs(last.z));
    expect(chebLast).toBeGreaterThan(chebFirst); // пещера глубже в скале
    expect(last.isCave).toBe(true); // последняя точка — карман пещеры
  });

  it('последняя точка трассы = карман пещеры с сундуком (caveChest)', () => {
    const last = ledges[ledges.length - 1]!;
    const c = caveChest();
    expect(c.x).toBe(CAVE_CHEST.x);
    expect(c.z).toBe(CAVE_CHEST.z);
    expect(last.x).toBe(CAVE_CHEST.x);
    expect(last.z).toBe(CAVE_CHEST.z);
  });

  it('пещера врезана в стену: высота склона в точке пещеры ≥ пол пещеры + 4 м', () => {
    const last = ledges[ledges.length - 1]!;
    const floorY = last.topY; // пол кармана = высота склона в точке CAVE_CHEST
    // Зев пещеры врезан вглубь стены — там склон должен быть минимум на 4 м выше пола.
    const mouthX = CAVE_CHEST.x + Math.sign(CAVE_CHEST.x - ANCHOR.x) * 3;
    const wallAtMouth = terrain.height(mouthX, CAVE_CHEST.z);
    expect(wallAtMouth - floorY).toBeGreaterThanOrEqual(4);
  });

  it('подножие стартует с земли (первая полка у ANCHOR)', () => {
    const first = ledges[0]!;
    expect(first.x).toBe(ANCHOR.x);
    expect(first.z).toBe(ANCHOR.z);
  });

  it('детерминирована: те же высоты дают ту же раскладку', () => {
    const again = planRockRoute((x, z) => terrain.height(x, z));
    expect(again).toEqual(ledges);
  });
});
