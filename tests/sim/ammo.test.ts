import { describe, expect, it } from 'vitest';
import {
  addArrows,
  ARROWS_BUY_COST,
  ARROWS_MAX,
  ARROWS_PER_BUY,
  ARROWS_START,
  buyArrows,
  canShoot,
  clampArrows,
} from '../../src/sim/ammo';

describe('clampArrows', () => {
  it('держит боезапас в [0, ARROWS_MAX]', () => {
    expect(clampArrows(-5)).toBe(0);
    expect(clampArrows(0)).toBe(0);
    expect(clampArrows(20)).toBe(20);
    expect(clampArrows(ARROWS_MAX)).toBe(ARROWS_MAX);
    expect(clampArrows(ARROWS_MAX + 50)).toBe(ARROWS_MAX);
  });

  it('обрезает дробь и чинит мусор', () => {
    expect(clampArrows(7.9)).toBe(7);
    expect(clampArrows(NaN)).toBe(0);
    expect(clampArrows(Infinity)).toBe(0);
    expect(clampArrows(undefined as unknown as number)).toBe(0);
  });
});

describe('addArrows', () => {
  it('добавляет с учётом потолка', () => {
    expect(addArrows(20, 10)).toBe(30);
    expect(addArrows(ARROWS_MAX - 2, 10)).toBe(ARROWS_MAX);
    expect(addArrows(ARROWS_MAX, 5)).toBe(ARROWS_MAX);
  });

  it('отрицательный count ничего не отнимает', () => {
    expect(addArrows(20, -5)).toBe(20);
  });
});

describe('canShoot', () => {
  it('нужна хотя бы одна стрела', () => {
    expect(canShoot(0)).toBe(false);
    expect(canShoot(1)).toBe(true);
    expect(canShoot(20)).toBe(true);
    expect(canShoot(-3)).toBe(false);
  });
});

describe('buyArrows', () => {
  it('успешная покупка: списывает монеты, прибавляет пачку', () => {
    const r = buyArrows(100, ARROWS_START);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(100 - ARROWS_BUY_COST);
    expect(r.arrows).toBe(ARROWS_START + ARROWS_PER_BUY);
  });

  it('не хватает монет — отказ, ничего не меняется', () => {
    const r = buyArrows(ARROWS_BUY_COST - 1, 5);
    expect(r.ok).toBe(false);
    expect(r.coins).toBe(ARROWS_BUY_COST - 1);
    expect(r.arrows).toBe(5);
  });

  it('боезапас на потолке — покупка не проходит, монеты целы', () => {
    const r = buyArrows(1000, ARROWS_MAX);
    expect(r.ok).toBe(false);
    expect(r.coins).toBe(1000);
    expect(r.arrows).toBe(ARROWS_MAX);
  });

  it('покупка у потолка добивает до ARROWS_MAX без перелива', () => {
    const r = buyArrows(1000, ARROWS_MAX - 3);
    expect(r.ok).toBe(true);
    expect(r.arrows).toBe(ARROWS_MAX);
  });

  it('ровно цены хватает', () => {
    const r = buyArrows(ARROWS_BUY_COST, 0);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(0);
    expect(r.arrows).toBe(ARROWS_PER_BUY);
  });

  it('наценённая цена (странствующий торговец) списывает дороже', () => {
    const cost = ARROWS_BUY_COST + 4; // эмуляция наценки торговца
    const r = buyArrows(100, 0, cost);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(100 - cost);
    expect(r.arrows).toBe(ARROWS_PER_BUY);
  });

  it('наценённая цена: денег на базовую хватает, на наценённую — нет', () => {
    const cost = ARROWS_BUY_COST + 5;
    const r = buyArrows(ARROWS_BUY_COST, 0, cost);
    expect(r.ok).toBe(false);
    expect(r.coins).toBe(ARROWS_BUY_COST);
    expect(r.arrows).toBe(0);
  });
});
