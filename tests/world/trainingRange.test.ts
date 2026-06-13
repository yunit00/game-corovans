import { describe, expect, it } from 'vitest';
import { trainingDummyLayout } from '../../src/world/TrainingRange';

describe('trainingDummyLayout', () => {
  it('даёт 5 манекенов: 3 столба полукругом + 2 мишени-стойки', () => {
    const slots = trainingDummyLayout(5);
    expect(slots.length).toBe(5);
    expect(slots.filter((s) => s.kind === 'dummy').length).toBe(3);
    expect(slots.filter((s) => s.kind === 'target').length).toBe(2);
  });

  it('детерминирован: один и тот же вход даёт ту же раскладку', () => {
    expect(trainingDummyLayout(5)).toEqual(trainingDummyLayout(5));
  });

  it('не вырождается в прямой ряд: позиции разнесены по X и Z', () => {
    const slots = trainingDummyLayout(5);
    const xs = new Set(slots.map((s) => Number(s.dx.toFixed(3))));
    const zs = new Set(slots.map((s) => Number(s.dz.toFixed(3))));
    // Разные X у всех — это не цепочка вдоль одной линии.
    expect(xs.size).toBe(5);
    // И минимум 3 разные глубины (полукруг + дальние мишени).
    expect(zs.size).toBeGreaterThanOrEqual(3);
  });

  it('манекены смотрят под разными углами (разброс yaw, не строй)', () => {
    const yaws = trainingDummyLayout(5).map((s) => Number(s.yaw.toFixed(3)));
    // Не все развороты одинаковы — иначе это «строй».
    expect(new Set(yaws).size).toBeGreaterThanOrEqual(4);
  });

  it('столбы полукруга стоят впереди (dz>0), на разумной дистанции тира', () => {
    const dummies = trainingDummyLayout(5).filter((s) => s.kind === 'dummy');
    for (const s of dummies) {
      expect(s.dz).toBeGreaterThan(0);
      expect(Math.hypot(s.dx, s.dz)).toBeLessThan(6);
    }
    // Дальние мишени-стойки отнесены дальше столбов.
    const targets = trainingDummyLayout(5).filter((s) => s.kind === 'target');
    for (const t of targets) expect(t.dz).toBeGreaterThanOrEqual(7);
  });
});
