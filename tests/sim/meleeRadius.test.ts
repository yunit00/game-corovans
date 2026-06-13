import { describe, expect, it } from 'vitest';
import { selectMeleeTargets } from '../../src/sim/melee';

const D2R = Math.PI / 180;
// Радиус капсулы персонажа (CAPSULE_RADIUS в Character.ts) — дублируем числом,
// чтобы тест чистой логики не тянул Three/Rapier.
const BODY_R = 0.35;

describe('selectMeleeTargets: дальность до поверхности тела (radius)', () => {
  it('цель вплотную: центр капсулы ДАЛЬШЕ range, но тело в досягаемости → попадание', () => {
    // range=1.9, центр цели в 2.2 м (дальше range), но с вычетом radius 0.35 → 1.85 ≤ 1.9
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [{ id: 1, x: 0, z: 2.2, radius: BODY_R }]);
    expect(hits).toEqual([1]);
  });

  it('без radius та же цель промахивается (регрессия исходного бага)', () => {
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [{ id: 1, x: 0, z: 2.2 }]);
    expect(hits).toEqual([]);
  });

  it('на границе: (dist − radius) ровно = range → попадание', () => {
    // dist = range + radius = 1.9 + 0.35 = 2.25 → reach = 1.9 = range
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [{ id: 1, x: 0, z: 2.25, radius: BODY_R }]);
    expect(hits).toEqual([1]);
  });

  it('чуть за границей: (dist − radius) > range → промах', () => {
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [{ id: 1, x: 0, z: 2.27, radius: BODY_R }]);
    expect(hits).toEqual([]);
  });

  it('цель вплотную, но СБОКУ за сектором (вне дуги) → промах', () => {
    // дуга 110° → полуугол 55°; цель под 80° от forward, в досягаемости по дистанции
    const ang = 80 * D2R;
    const r = 1.6;
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [
      { id: 1, x: Math.sin(ang) * r, z: Math.cos(ang) * r, radius: BODY_R },
    ]);
    expect(hits).toEqual([]);
  });

  it('цель вплотную, но СПИНОЙ (позади) → промах', () => {
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [{ id: 1, x: 0, z: -1.5, radius: BODY_R }]);
    expect(hits).toEqual([]);
  });

  it('цель в досягаемости И в секторе → попадание (контроль)', () => {
    const ang = 30 * D2R; // внутри полуугла 55°
    const r = 1.7;
    const hits = selectMeleeTargets(0, 0, 0, 1.9, 110, [
      { id: 1, x: Math.sin(ang) * r, z: Math.cos(ang) * r, radius: BODY_R },
    ]);
    expect(hits).toEqual([1]);
  });

  it('атакующий внутри тела цели (reach ≤ 0) → попадание независимо от угла', () => {
    // центр цели ближе её radius — атакующий «внутри» капсулы, направление неопределимо
    const behind = selectMeleeTargets(0, 0, 0, 1.9, 110, [{ id: 1, x: 0, z: -0.2, radius: BODY_R }]);
    expect(behind).toEqual([1]);
  });

  it('radius по умолчанию 0 — старое поведение сохраняется', () => {
    expect(selectMeleeTargets(0, 0, 0, 2, 90, [{ id: 1, x: 0, z: 1 }])).toEqual([1]);
    expect(selectMeleeTargets(0, 0, 0, 2, 90, [{ id: 1, x: 0, z: 2.01 }])).toEqual([]);
  });
});
