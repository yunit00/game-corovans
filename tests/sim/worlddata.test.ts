import { describe, expect, it } from 'vitest';
import { flattenFactor, isClear, roadDistance, ROADS, PALACE, VILLAGE } from '../../src/world/WorldData';

describe('WorldData', () => {
  it('деревня и дворец плоские (factor ≈ 0 в центре)', () => {
    expect(flattenFactor(VILLAGE.x, VILLAGE.z)).toBeLessThan(0.05);
    expect(flattenFactor(PALACE.x, PALACE.z)).toBeLessThan(0.05);
  });

  it('на дороге рельеф сглажен до ≤ 0.2', () => {
    for (const road of ROADS) {
      for (const p of road) {
        expect(flattenFactor(p.x, p.z)).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('глухой лес — полный рельеф', () => {
    expect(flattenFactor(400, 400)).toBe(1);
    expect(flattenFactor(-420, -100)).toBe(1);
  });

  it('isClear: false в деревне/дворце/на дорогах, true в глуши', () => {
    expect(isClear(VILLAGE.x, VILLAGE.z)).toBe(false);
    expect(isClear(PALACE.x, PALACE.z)).toBe(false);
    for (const road of ROADS) {
      expect(isClear(road[Math.floor(road.length / 2)]!.x, road[Math.floor(road.length / 2)]!.z)).toBe(false);
    }
    expect(isClear(400, 400)).toBe(true);
  });

  it('roadDistance: 0 на вершине дороги, растёт в стороне', () => {
    const p = ROADS[0]![3]!;
    expect(roadDistance(p.x, p.z)).toBeCloseTo(0);
    expect(roadDistance(p.x + 50, p.z)).toBeGreaterThan(20);
  });
});
