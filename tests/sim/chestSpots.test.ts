// Инварианты фиксированных укрытий сундуков (Chests.CHEST_SPOTS): сундуки должны
// сидеть в играбельной зоне, далеко от дорог и вне деревни/дворца — даже с учётом
// джиттера от seed (точка «гуляет» в радиусе jitter вокруг базовой). 12 фиксированных
// точек + 2 пруда + 1 форт = 15 сундуков; пруды/форт уточняются в build по их
// рантайм-позициям, поэтому тут проверяем детерминированные 12.
import { describe, expect, it } from 'vitest';
import { CHEST_SPOTS } from '../../src/world/Chests';
import { ROADS, VILLAGE, PALACE } from '../../src/world/WorldData';
import { distToPolyline } from '../../src/sim/geom';

/** Минимальная дистанция точки до всех дорог. */
const roadDist = (x: number, z: number): number => {
  let best = Infinity;
  for (const road of ROADS) best = Math.min(best, distToPolyline({ x, z }, road));
  return best;
};

/** Худший случай по кольцу джиттера: проверяем не только базу, но и её сдвиги. */
const ringSamples = (x: number, z: number, jitter: number): { x: number; z: number }[] => {
  const pts = [{ x, z }];
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2;
    pts.push({ x: x + Math.cos(ang) * jitter, z: z + Math.sin(ang) * jitter });
  }
  return pts;
};

describe('CHEST_SPOTS — инварианты укрытий сундуков', () => {
  it('ровно 12 фиксированных точек (+ 2 пруда + 1 форт в build = 15)', () => {
    expect(CHEST_SPOTS.length).toBe(12);
  });

  it('все точки (с джиттером) внутри карты: cheb ≤ 480', () => {
    for (const s of CHEST_SPOTS) {
      for (const p of ringSamples(s.x, s.z, s.jitter)) {
        const cheb = Math.max(Math.abs(p.x), Math.abs(p.z));
        expect(cheb).toBeLessThanOrEqual(480);
      }
    }
  });

  it('все точки (с джиттером) не лезут за горную стену: cheb < 432', () => {
    // build режет джиттер на cheb<432; базовые точки должны это допускать с запасом.
    for (const s of CHEST_SPOTS) {
      for (const p of ringSamples(s.x, s.z, s.jitter)) {
        const cheb = Math.max(Math.abs(p.x), Math.abs(p.z));
        expect(cheb).toBeLessThan(432);
      }
    }
  });

  it('все точки (с джиттером) ≥ 20 м от любой дороги ROADS', () => {
    for (const s of CHEST_SPOTS) {
      for (const p of ringSamples(s.x, s.z, s.jitter)) {
        expect(roadDist(p.x, p.z)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('все точки (с джиттером) ≥ 25 м от дорог (правило размещения «дальше от дорог»)', () => {
    for (const s of CHEST_SPOTS) {
      for (const p of ringSamples(s.x, s.z, s.jitter)) {
        expect(roadDist(p.x, p.z)).toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('ни одна точка (с джиттером) не в деревне и не во дворце', () => {
    for (const s of CHEST_SPOTS) {
      for (const p of ringSamples(s.x, s.z, s.jitter)) {
        const dv = Math.hypot(p.x - VILLAGE.x, p.z - VILLAGE.z);
        const dp = Math.hypot(p.x - PALACE.x, p.z - PALACE.z);
        expect(dv).toBeGreaterThan(VILLAGE.radius + 12);
        expect(dp).toBeGreaterThan(PALACE.radius + 15);
      }
    }
  });

  it('у каждой точки валидный tier и конечный yaw', () => {
    for (const s of CHEST_SPOTS) {
      expect(['common', 'rare', 'epic']).toContain(s.tier);
      expect(Number.isFinite(s.yaw)).toBe(true);
      expect(s.jitter).toBeGreaterThan(0);
    }
  });

  it('каждый эпический сундук — у горной стены или за дворцом (ценный = опаснее/дальше)', () => {
    const epics = CHEST_SPOTS.filter((s) => s.tier === 'epic');
    expect(epics.length).toBeGreaterThanOrEqual(2);
    for (const s of epics) {
      const cheb = Math.max(Math.abs(s.x), Math.abs(s.z));
      const nearWall = cheb > 380;
      const behindPalace = s.z < -200;
      expect(nearWall || behindPalace).toBe(true);
    }
  });
});
