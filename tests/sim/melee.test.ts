import { describe, expect, it } from 'vitest';
import { selectMeleeTargets } from '../../src/sim/melee';

const D2R = Math.PI / 180;

describe('selectMeleeTargets', () => {
  it('цель прямо по курсу попадает в сектор (yaw=0 → forward = +Z)', () => {
    const hits = selectMeleeTargets(0, 0, 0, 2, 90, [{ id: 1, x: 0, z: 1 }]);
    expect(hits).toEqual([1]);
  });

  it('цель дальше range не попадает', () => {
    const hits = selectMeleeTargets(0, 0, 0, 2, 90, [{ id: 1, x: 0, z: 2.01 }]);
    expect(hits).toEqual([]);
  });

  it('цель за спиной не попадает', () => {
    const hits = selectMeleeTargets(0, 0, 0, 2, 90, [{ id: 1, x: 0, z: -1 }]);
    expect(hits).toEqual([]);
  });

  it('граница дуги: чуть внутри — попадание, чуть снаружи — промах', () => {
    // arc 90° → полуугол 45°; цели на 44° и 46° от forward (+Z)
    const inside = { id: 1, x: Math.sin(44 * D2R), z: Math.cos(44 * D2R) };
    const outside = { id: 2, x: Math.sin(46 * D2R), z: Math.cos(46 * D2R) };
    expect(selectMeleeTargets(0, 0, 0, 2, 90, [inside, outside])).toEqual([1]);
  });

  it('dist < 0.001 попадает всегда, даже «за спиной»', () => {
    const hits = selectMeleeTargets(5, 5, 0, 2, 90, [
      { id: 1, x: 5, z: 5 }, // в точке атакующего
      { id: 2, x: 5, z: 4.9995 }, // позади, но ближе 0.001
    ]);
    expect(hits).toEqual([1, 2]);
  });

  it('несколько целей сразу: возвращает все попавшие id', () => {
    const hits = selectMeleeTargets(0, 0, 0, 3, 120, [
      { id: 10, x: 0, z: 1 }, // прямо
      { id: 11, x: 1, z: 1.5 }, // в дуге
      { id: 12, x: -0.5, z: 2 }, // в дуге слева
      { id: 13, x: 0, z: -1 }, // за спиной
      { id: 14, x: 0, z: 5 }, // вне range
    ]);
    expect(hits).toEqual([10, 11, 12]);
  });

  it('конвенция yaw = atan2(x, z): yaw=π/2 → forward = +X', () => {
    const yaw = Math.PI / 2;
    expect(selectMeleeTargets(0, 0, yaw, 2, 90, [{ id: 1, x: 1, z: 0 }])).toEqual([1]);
    expect(selectMeleeTargets(0, 0, yaw, 2, 90, [{ id: 2, x: 0, z: 1 }])).toEqual([]);
  });
});
