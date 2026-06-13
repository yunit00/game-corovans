import { describe, expect, it } from 'vitest';
import { selectMeleeTargets } from '../../src/sim/melee';
import { inPerceptionCone, roundRobinIndices } from '../../src/sim/perception';

describe('inPerceptionCone', () => {
  const params = { range: 10, fovDeg: 90 };

  it('цель в секторе и в дальности — видна', () => {
    // yaw=0 → взгляд вдоль +Z (конвенция atan2(x, z))
    expect(inPerceptionCone(0, 0, 0, params, 0, 8)).toBe(true);
    // на краю сектора (45° от оси при fov=90) — ещё видна
    expect(inPerceptionCone(0, 0, 0, params, 4, 4.001)).toBe(true);
  });

  it('цель вне сектора — не видна', () => {
    // строго сбоку (90° от взгляда) при fov=90 — за пределами полуугла 45°
    expect(inPerceptionCone(0, 0, 0, params, 8, 0)).toBe(false);
    // строго сзади
    expect(inPerceptionCone(0, 0, 0, params, 0, -8)).toBe(false);
  });

  it('цель за дальностью — не видна даже на оси взгляда', () => {
    expect(inPerceptionCone(0, 0, 0, params, 0, 10.5)).toBe(false);
  });

  it('вплотную сзади — слышно на 360° (< range * 0.2)', () => {
    expect(inPerceptionCone(0, 0, 0, params, 0, -1.5)).toBe(true);
    expect(inPerceptionCone(0, 0, 0, params, -1, -1)).toBe(true);
    // а чуть дальше порога слуха сзади — уже нет
    expect(inPerceptionCone(0, 0, 0, params, 0, -2.5)).toBe(false);
  });

  it('yaw-конвенция согласована с selectMeleeTargets', () => {
    // yaw=π/2 → взгляд вдоль +X; цели дальше порога слуха (>= 2 при range=10),
    // чтобы сравнивался именно конус, а не 360°-слух
    const yaw = Math.PI / 2;
    const cases = [
      { x: 5, z: 0 }, // прямо по взгляду — обе функции дают true
      { x: 0, z: 5 }, // сбоку (90° от взгляда) — обе дают false
      { x: -5, z: 0 }, // сзади — обе дают false
    ];
    for (const c of cases) {
      const melee = selectMeleeTargets(0, 0, yaw, 10, 90, [{ id: 1, x: c.x, z: c.z }]);
      const seen = inPerceptionCone(0, 0, yaw, { range: 10, fovDeg: 90 }, c.x, c.z);
      expect(seen).toBe(melee.length === 1);
    }
  });
});

describe('roundRobinIndices', () => {
  it('за ceil(total/budget) тиков покрывает все индексы', () => {
    const total = 7;
    const budget = 3;
    const seen = new Set<number>();
    for (let tick = 0; tick < Math.ceil(total / budget); tick++) {
      for (const i of roundRobinIndices(tick, total, budget, [])) seen.add(i);
    }
    expect(seen.size).toBe(total);
  });

  it('не выходит за границы и возвращает min(budget, total) индексов', () => {
    for (let tick = 0; tick < 20; tick++) {
      const idx = roundRobinIndices(tick, 7, 3, []);
      expect(idx).toHaveLength(3);
      for (const i of idx) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(7);
        expect(Number.isInteger(i)).toBe(true);
      }
    }
  });

  it('заворачивается по модулю со смещением (tick * budget) % total', () => {
    // tick=2, total=7, budget=3 → offset=6 → [6, 0, 1]
    expect(roundRobinIndices(2, 7, 3, [])).toEqual([6, 0, 1]);
  });

  it('budget >= total — все индексы сразу, без дублей', () => {
    expect(roundRobinIndices(0, 4, 10, [])).toEqual([0, 1, 2, 3]);
    expect(roundRobinIndices(5, 4, 4, [])).toEqual([0, 1, 2, 3]);
  });

  it('total = 0 — пусто', () => {
    expect(roundRobinIndices(3, 0, 5, [])).toEqual([]);
  });

  it('переиспользует out: чистит прошлое содержимое и возвращает тот же массив', () => {
    // Скретч-контракт фикс-цикла AISystem: один массив на всю сессию, без аллокаций
    const scratch = [9, 9, 9, 9, 9];
    const idx = roundRobinIndices(2, 7, 3, scratch);
    expect(idx).toBe(scratch);
    expect(idx).toEqual([6, 0, 1]);
  });
});
