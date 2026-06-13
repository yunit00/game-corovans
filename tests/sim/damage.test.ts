import { describe, expect, it } from 'vitest';
import { mulberry32, type Rng } from '../../src/core/rng';
import {
  computeHit,
  DEFAULT_ATTACKER,
  DEFAULT_DEFENDER,
  type AttackerStats,
} from '../../src/sim/damage';

// rng-заглушка: выдаёт значения по порядку (1-й вызов — разброс, 2-й — крит)
const seq =
  (...values: number[]): Rng =>
  () => {
    if (values.length === 0) throw new Error('seq rng исчерпан');
    return values.shift()!;
  };

// Атакующий без крита — чтобы изолировать проверяемый параметр
const noCrit: AttackerStats = { attackBonus: 0, critChance: 0, critMult: 1.8 };

describe('computeHit', () => {
  it('разброс в пределах ±10% от базового урона', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const { damage, crit } = computeHit(100, noCrit, DEFAULT_DEFENDER, rng);
      expect(crit).toBe(false);
      expect(damage).toBeGreaterThanOrEqual(90);
      expect(damage).toBeLessThanOrEqual(110);
    }
  });

  it('минимум 1 урона даже при огромной броне и мизерной базе', () => {
    const { damage } = computeHit(0.01, noCrit, { armor: 10_000 }, seq(0.5, 0.99));
    expect(damage).toBe(1);
  });

  it('крит управляется вторым вызовом rng (1-й — разброс)', () => {
    // разброс 0.5 → множитель ровно 1.0; крит-ролл 0 < 0.08 → крит
    const critHit = computeHit(100, DEFAULT_ATTACKER, DEFAULT_DEFENDER, seq(0.5, 0));
    expect(critHit.crit).toBe(true);
    expect(critHit.damage).toBe(180); // 100 * critMult 1.8

    // крит-ролл 0.99 ≥ 0.08 → обычный удар
    const plainHit = computeHit(100, DEFAULT_ATTACKER, DEFAULT_DEFENDER, seq(0.5, 0.99));
    expect(plainHit.crit).toBe(false);
    expect(plainHit.damage).toBe(100);
  });

  it('броня 100 режет урон вдвое', () => {
    const { damage } = computeHit(100, noCrit, { armor: 100 }, seq(0.5, 0.99));
    expect(damage).toBe(50);
  });

  it('отрицательная броня не усиливает урон', () => {
    const negative = computeHit(100, noCrit, { armor: -50 }, seq(0.5, 0.99));
    const zero = computeHit(100, noCrit, { armor: 0 }, seq(0.5, 0.99));
    expect(negative.damage).toBe(zero.damage);
    expect(negative.damage).toBe(100);
  });

  it('attackBonus — бонус в процентах', () => {
    const { damage } = computeHit(
      100,
      { attackBonus: 50, critChance: 0, critMult: 1.8 },
      DEFAULT_DEFENDER,
      seq(0.5, 0.99),
    );
    expect(damage).toBe(150);
  });

  it('детерминизм: mulberry32(42) → одинаковые результаты', () => {
    const roll = (rng: Rng) =>
      Array.from({ length: 100 }, () => computeHit(37, DEFAULT_ATTACKER, { armor: 25 }, rng));
    expect(roll(mulberry32(42))).toEqual(roll(mulberry32(42)));
  });
});
