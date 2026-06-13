import { describe, expect, it } from 'vitest';
import {
  addRobberyHeat,
  coolHeat,
  HEAT_MAX,
  makeHeat,
  PUNITIVE_CHANCE_MAX,
  PUNITIVE_CHANCE_MIN,
  PUNITIVE_HEAT_HIGH,
  PUNITIVE_HEAT_MIN,
  punitiveDifficultyBonus,
  punitiveRaidChance,
  ROBBERY_HEAT,
} from '../../src/sim/heat';

describe('addRobberyHeat', () => {
  it('жар растёт по рангу корована: poor < merchant < royal', () => {
    const h = makeHeat();
    addRobberyHeat(h, 'poor');
    expect(h.value).toBeCloseTo(ROBBERY_HEAT.poor);
    addRobberyHeat(h, 'merchant');
    expect(h.value).toBeCloseTo(ROBBERY_HEAT.poor + ROBBERY_HEAT.merchant);
    addRobberyHeat(h, 'royal');
    expect(h.value).toBeCloseTo(ROBBERY_HEAT.poor + ROBBERY_HEAT.merchant + ROBBERY_HEAT.royal);
  });

  it('кап: жар не растёт выше HEAT_MAX даже при серии royal-грабежей', () => {
    const h = makeHeat();
    for (let i = 0; i < 10; i++) addRobberyHeat(h, 'royal');
    expect(h.value).toBe(HEAT_MAX);
  });
});

describe('coolHeat', () => {
  it('остывание: −1 жара за 120 с', () => {
    const h = makeHeat();
    h.value = 5;
    coolHeat(h, 120);
    expect(h.value).toBeCloseTo(4);
  });

  it('малые тики складываются в то же остывание, что и один большой', () => {
    const h = makeHeat();
    h.value = 5;
    const DT = 1 / 60;
    for (let i = 0; i < 120 * 60; i++) coolHeat(h, DT);
    expect(h.value).toBeCloseTo(4, 6);
  });

  it('не уходит ниже нуля', () => {
    const h = makeHeat();
    h.value = 0.5;
    coolHeat(h, 600);
    expect(h.value).toBe(0);
  });
});

describe('punitiveRaidChance', () => {
  it('ниже порога — ровно 0 (мелкие грабежи дворец не замечает)', () => {
    const h = makeHeat();
    expect(punitiveRaidChance(h)).toBe(0);
    h.value = PUNITIVE_HEAT_MIN - 0.01;
    expect(punitiveRaidChance(h)).toBe(0);
  });

  it('на пороге сразу 0.25, при максимуме 0.6', () => {
    const h = makeHeat();
    h.value = PUNITIVE_HEAT_MIN;
    expect(punitiveRaidChance(h)).toBeCloseTo(PUNITIVE_CHANCE_MIN);
    h.value = HEAT_MAX;
    expect(punitiveRaidChance(h)).toBeCloseTo(PUNITIVE_CHANCE_MAX);
  });

  it('линейность: в середине отрезка — середина диапазона шансов', () => {
    const h = makeHeat();
    h.value = (PUNITIVE_HEAT_MIN + HEAT_MAX) / 2;
    expect(punitiveRaidChance(h)).toBeCloseTo((PUNITIVE_CHANCE_MIN + PUNITIVE_CHANCE_MAX) / 2);
  });

  it('монотонность: больше жара — шанс не меньше', () => {
    const h = makeHeat();
    let prev = punitiveRaidChance(h);
    for (let v = 0; v <= HEAT_MAX; v += 0.25) {
      h.value = v;
      const chance = punitiveRaidChance(h);
      expect(chance).toBeGreaterThanOrEqual(prev);
      prev = chance;
    }
  });
});

describe('punitiveDifficultyBonus', () => {
  it('ступени: 0 до порога, +1 с PUNITIVE_HEAT_MIN, +2 с PUNITIVE_HEAT_HIGH', () => {
    const h = makeHeat();
    expect(punitiveDifficultyBonus(h)).toBe(0);
    h.value = PUNITIVE_HEAT_MIN - 0.01;
    expect(punitiveDifficultyBonus(h)).toBe(0);
    h.value = PUNITIVE_HEAT_MIN;
    expect(punitiveDifficultyBonus(h)).toBe(1);
    h.value = PUNITIVE_HEAT_HIGH - 0.01;
    expect(punitiveDifficultyBonus(h)).toBe(1);
    h.value = PUNITIVE_HEAT_HIGH;
    expect(punitiveDifficultyBonus(h)).toBe(2);
    h.value = HEAT_MAX;
    expect(punitiveDifficultyBonus(h)).toBe(2);
  });
});
