import { describe, expect, it } from 'vitest';
import { planRoadEnds, PLAYABLE_HALF, WALL_SETBACK, type RoadEndKind } from '../../src/sim/roadEnds';
import { ROADS } from '../../src/world/WorldData';
import type { P2 } from '../../src/sim/geom';

const ASSIGN: { road: number; kind: RoadEndKind }[] = [
  { road: 0, kind: 'inn' },
  { road: 1, kind: 'sentry' },
  { road: 2, kind: 'forester' },
  { road: 3, kind: 'mill' },
];

describe('planRoadEnds', () => {
  it('даёт по локации на каждый стеновой конец дороги, в порядке assign', () => {
    const ends = planRoadEnds(ROADS, ASSIGN);
    expect(ends.length).toBe(4);
    expect(ends.map((e) => e.kind)).toEqual(['inn', 'sentry', 'forester', 'mill']);
    expect(ends.map((e) => e.road)).toEqual([0, 1, 2, 3]);
  });

  it('позиция отодвинута внутрь от горной стены (cheb ≤ половина − отступ)', () => {
    const ends = planRoadEnds(ROADS, ASSIGN);
    const limit = PLAYABLE_HALF - WALL_SETBACK + 0.01;
    for (const e of ends) {
      const cheb = Math.max(Math.abs(e.x), Math.abs(e.z));
      expect(cheb).toBeLessThanOrEqual(limit);
    }
  });

  it('позиция лежит близко к своей дороге (на полилинии)', () => {
    const ends = planRoadEnds(ROADS, ASSIGN);
    for (const e of ends) {
      const road = ROADS[e.road]!;
      // Минимальная дистанция точки до сегментов полилинии — мала (точка на дороге).
      let best = Infinity;
      for (let i = 0; i + 1 < road.length; i++) {
        best = Math.min(best, distToSeg(e, road[i]!, road[i + 1]!));
      }
      expect(best).toBeLessThan(1);
    }
  });

  it('faceYaw направлен вдоль дороги внутрь зоны (к меньшему |координаты|)', () => {
    const ends = planRoadEnds(ROADS, ASSIGN);
    for (const e of ends) {
      // Шаг 5 м по faceYaw уводит cheb внутрь (ближе к центру), а не к стене.
      const nx = e.x + Math.sin(e.faceYaw) * 5;
      const nz = e.z + Math.cos(e.faceYaw) * 5;
      const chebNow = Math.max(Math.abs(e.x), Math.abs(e.z));
      const chebNext = Math.max(Math.abs(nx), Math.abs(nz));
      expect(chebNext).toBeLessThan(chebNow);
    }
  });

  it('детерминирован (одинаковый вход → одинаковый выход)', () => {
    expect(planRoadEnds(ROADS, ASSIGN)).toEqual(planRoadEnds(ROADS, ASSIGN));
  });

  it('внутренняя дорога без стенового конца пропускается', () => {
    const inner: P2[] = [
      { x: 0, z: 0 },
      { x: 50, z: 10 },
      { x: 100, z: 0 },
    ];
    const ends = planRoadEnds([inner], [{ road: 0, kind: 'mill' }]);
    expect(ends.length).toBe(0);
  });

  it('несуществующий индекс дороги пропускается без падения', () => {
    const ends = planRoadEnds(ROADS, [{ road: 99, kind: 'inn' }]);
    expect(ends.length).toBe(0);
  });
});

function distToSeg(p: P2, a: P2, b: P2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
