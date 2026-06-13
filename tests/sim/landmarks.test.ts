import { describe, expect, it } from 'vitest';
import { planLandmarks, POI_GAP, POI_ROAD_MARGIN, type PoiSpec } from '../../src/sim/landmarks';
import { isClear, roadDistance } from '../../src/world/WorldData';

const isClearM = (x: number, z: number, m: number): boolean => isClear(x, z, m);

describe('planLandmarks', () => {
  it('детерминирован сидом', () => {
    const a = planLandmarks(42, 5, isClearM, roadDistance);
    const b = planLandmarks(42, 5, isClearM, roadDistance);
    expect(a).toEqual(b);
  });

  it('другой сид — другая раскладка', () => {
    const a = planLandmarks(42, 5, isClearM, roadDistance);
    const b = planLandmarks(7, 5, isClearM, roadDistance);
    // хотя бы одна точка сместилась (джиттер от seed)
    const same = a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.z === b[i]?.z);
    expect(same).toBe(false);
  });

  it('выдаёт хотя бы 4 POI и не больше запрошенного count', () => {
    const a = planLandmarks(42, 5, isClearM, roadDistance);
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.length).toBeLessThanOrEqual(5);
  });

  it('все POI на свободном месте (вне деревни/дворца/дорог/стены)', () => {
    const a = planLandmarks(42, 5, isClearM, roadDistance);
    for (const p of a) {
      expect(isClear(p.x, p.z, p.radius)).toBe(true);
    }
  });

  it('POI не налезают друг на друга (зазор ≥ радиусы + POI_GAP)', () => {
    for (let seed = 0; seed < 30; seed++) {
      const a = planLandmarks(seed, 5, isClearM, roadDistance);
      for (let i = 0; i < a.length; i++) {
        for (let j = i + 1; j < a.length; j++) {
          const pi = a[i]!;
          const pj = a[j]!;
          const d = Math.hypot(pi.x - pj.x, pi.z - pj.z);
          expect(d).toBeGreaterThanOrEqual(pi.radius + pj.radius + POI_GAP);
        }
      }
    }
  });

  it('не-придорожные POI держат отступ от дороги, придорожные могут быть ближе', () => {
    const a = planLandmarks(42, 5, isClearM, roadDistance);
    const roadside = new Set<PoiSpec['kind']>(['shrine', 'broken_cart']);
    for (const p of a) {
      if (!roadside.has(p.kind)) {
        expect(roadDistance(p.x, p.z)).toBeGreaterThanOrEqual(POI_ROAD_MARGIN);
      }
    }
  });

  it('count=0 → пусто; count меньше доступных якорей соблюдается', () => {
    expect(planLandmarks(42, 0, isClearM, roadDistance).length).toBe(0);
    expect(planLandmarks(42, 2, isClearM, roadDistance).length).toBeLessThanOrEqual(2);
  });

  it('маска «всё занято» → ни одного POI', () => {
    const a = planLandmarks(42, 5, () => false, roadDistance);
    expect(a.length).toBe(0);
  });
});
