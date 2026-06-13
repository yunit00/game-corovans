import { describe, expect, it } from 'vitest';
import {
  applyBlessing,
  BLESSING_COST,
  BLESSING_DURATION_SEC,
  BLESSING_HP_PER_SEC,
  BLESSING_SPEED_MUL,
  clearBlessing,
  isBlessed,
  makeBlessing,
  tickBlessing,
} from '../../src/sim/blessing';

describe('blessing: бафф источника', () => {
  it('свежее состояние — без баффа', () => {
    const s = makeBlessing();
    expect(isBlessed(s)).toBe(false);
    expect(s.left).toBe(0);
  });

  it('бросок монеты включает бафф на полную длительность', () => {
    const s = makeBlessing();
    applyBlessing(s);
    expect(isBlessed(s)).toBe(true);
    expect(s.left).toBe(BLESSING_DURATION_SEC);
  });

  it('повторный бросок НЕ стакается — лишь обновляет длительность', () => {
    const s = makeBlessing();
    applyBlessing(s);
    tickBlessing(s, 100);
    expect(s.left).toBeCloseTo(BLESSING_DURATION_SEC - 100, 5);
    // Повторный бросок не складывает (не 2× длительности), а ставит заново.
    applyBlessing(s);
    expect(s.left).toBe(BLESSING_DURATION_SEC);
  });

  it('tick возвращает реген HP за активную долю тика и уменьшает таймер', () => {
    const s = makeBlessing();
    applyBlessing(s);
    const heal = tickBlessing(s, 2);
    expect(heal).toBeCloseTo(BLESSING_HP_PER_SEC * 2, 5);
    expect(s.left).toBeCloseTo(BLESSING_DURATION_SEC - 2, 5);
  });

  it('на стыке истечения реген считается только за активную часть тика', () => {
    const s = makeBlessing();
    applyBlessing(s);
    // Подвести к 1.5 с до конца, затем тикнуть 4 с — активны только 1.5 с.
    s.left = 1.5;
    const heal = tickBlessing(s, 4);
    expect(heal).toBeCloseTo(BLESSING_HP_PER_SEC * 1.5, 5);
    expect(s.left).toBe(0);
    expect(isBlessed(s)).toBe(false);
  });

  it('tick на неактивном баффе — реген 0, left ровно 0', () => {
    const s = makeBlessing();
    expect(tickBlessing(s, 5)).toBe(0);
    expect(s.left).toBe(0);
  });

  it('clearBlessing сбрасывает бафф', () => {
    const s = makeBlessing();
    applyBlessing(s);
    clearBlessing(s);
    expect(isBlessed(s)).toBe(false);
    expect(s.left).toBe(0);
  });

  it('константы баланса в разумных пределах', () => {
    expect(BLESSING_COST).toBe(25);
    expect(BLESSING_DURATION_SEC).toBe(180);
    expect(BLESSING_SPEED_MUL).toBeCloseTo(1.15, 5);
    expect(BLESSING_HP_PER_SEC).toBe(1);
  });
});
