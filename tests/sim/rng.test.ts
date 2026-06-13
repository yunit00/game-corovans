import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, pick, randInt, shuffle } from '../../src/core/rng';

describe('mulberry32', () => {
  it('детерминирован: одинаковый сид → одинаковая последовательность', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it('разные сиды → разные последовательности', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const same = Array.from({ length: 100 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBeLessThan(3);
  });

  it('равномерность: среднее 10k значений ≈ 0.5, все в [0,1)', () => {
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 10_000).toBeGreaterThan(0.48);
    expect(sum / 10_000).toBeLessThan(0.52);
  });

  it('randInt покрывает весь диапазон включительно', () => {
    const rng = mulberry32(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(randInt(rng, 1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('pick всегда возвращает элемент массива', () => {
    const rng = mulberry32(5);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(rng, arr));
  });

  it('shuffle — перестановка без потерь, детерминированная', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const s1 = shuffle(mulberry32(9), arr);
    const s2 = shuffle(mulberry32(9), arr);
    expect(s1).toEqual(s2);
    expect([...s1].sort((x, y) => x - y)).toEqual(arr);
  });

  it('hashSeed стабилен и различает строки', () => {
    expect(hashSeed('корованы')).toBe(hashSeed('корованы'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});
