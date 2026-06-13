import { describe, expect, it } from 'vitest';
import { HINT_SHOOT_GOAL, nextShootHint, xpBarFraction } from '../../src/ui/hudLogic';

describe('xpBarFraction', () => {
  it('старт уровня — бар пуст', () => {
    expect(xpBarFraction(100, 100, 300)).toBe(0);
  });

  it('середина — половина', () => {
    expect(xpBarFraction(200, 100, 300)).toBe(0.5);
  });

  it('у самого порога следующего уровня — почти полный', () => {
    expect(xpBarFraction(299, 100, 300)).toBeCloseTo(0.995, 3);
  });

  it('опыт сверх порога не переливается за 1', () => {
    expect(xpBarFraction(9999, 100, 300)).toBe(1);
  });

  it('опыт ниже порога текущего уровня не уходит в минус', () => {
    expect(xpBarFraction(0, 100, 300)).toBe(0);
  });

  it('кап (следующий порог == текущего) — бар полон', () => {
    expect(xpBarFraction(5000, 5000, 5000)).toBe(1);
    expect(xpBarFraction(5000, 5000, 4000)).toBe(1);
  });
});

describe('nextShootHint', () => {
  it('первые выстрелы накапливают счётчик, подсказка ещё жива', () => {
    let r = nextShootHint(0);
    expect(r).toEqual({ shots: 1, done: false });
    r = nextShootHint(r.shots);
    expect(r).toEqual({ shots: 2, done: false });
  });

  it(`на ${HINT_SHOOT_GOAL}-м выстреле подсказка гаснет навсегда`, () => {
    const r = nextShootHint(HINT_SHOOT_GOAL - 1);
    expect(r.shots).toBe(HINT_SHOOT_GOAL);
    expect(r.done).toBe(true);
  });

  it('после цели счётчик не растёт и остаётся done (идемпотентность)', () => {
    const r = nextShootHint(HINT_SHOOT_GOAL);
    expect(r).toEqual({ shots: HINT_SHOOT_GOAL, done: true });
    const r2 = nextShootHint(HINT_SHOOT_GOAL + 5);
    expect(r2.done).toBe(true);
  });

  it('ровно три засчитанных выстрела доводят до done', () => {
    let shots = 0;
    let done = false;
    for (let i = 0; i < HINT_SHOOT_GOAL; i++) {
      const r = nextShootHint(shots);
      shots = r.shots;
      done = r.done;
    }
    expect(shots).toBe(HINT_SHOOT_GOAL);
    expect(done).toBe(true);
  });
});
