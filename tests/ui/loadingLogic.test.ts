import { describe, expect, it } from 'vitest';
import { loadFraction, progressPercent } from '../../src/ui/loadingLogic';

describe('loadFraction', () => {
  it('ничего не запрошено — пусто, а не полно', () => {
    expect(loadFraction(0, 0)).toBe(0);
  });

  it('половина завершена — половина', () => {
    expect(loadFraction(60, 120)).toBe(0.5);
  });

  it('всё завершено — полная', () => {
    expect(loadFraction(120, 120)).toBe(1);
  });

  it('completed сверх total не переливается за 1', () => {
    expect(loadFraction(150, 120)).toBe(1);
  });

  it('отрицательный completed не уходит в минус', () => {
    expect(loadFraction(-5, 120)).toBe(0);
  });
});

describe('progressPercent', () => {
  it('старт — 0%', () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(0, 120)).toBe(0);
  });

  it('34 из 120 — округлённый процент', () => {
    expect(progressPercent(34, 120)).toBe(28);
  });

  it('финиш — ровно 100%', () => {
    expect(progressPercent(120, 120)).toBe(100);
  });

  it('не откатывается назад, когда total вырос быстрее completed', () => {
    // 60/120 = 50%. Затем в очередь докинули ассеты: total=200, completed=70 → 35%,
    // но показанный процент не должен упасть ниже прежних 50%.
    const p1 = progressPercent(60, 120, 0);
    expect(p1).toBe(50);
    const p2 = progressPercent(70, 200, p1);
    expect(p2).toBe(50);
  });

  it('монотонно растёт при докидывании очереди и догрузке', () => {
    let p = 0;
    const steps: [number, number][] = [
      [10, 100],
      [40, 160], // total вырос — процент сырой упал бы до 25, но держим 25? нет — держим max
      [120, 160],
      [160, 160],
    ];
    let prev = 0;
    for (const [done, total] of steps) {
      p = progressPercent(done, total, prev);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(p).toBe(100);
  });

  it('никогда не выходит за [0,100]', () => {
    expect(progressPercent(999, 120)).toBe(100);
    expect(progressPercent(-10, 120)).toBe(0);
  });
});
