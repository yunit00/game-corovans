import { describe, expect, it } from 'vitest';
import {
  FLAWLESS_MULTIPLIER,
  raidReward,
  REWARD_COINS_PER_HOUSE,
  REWARD_XP_PER_HOUSE,
} from '../../src/sim/raid';

describe('raidReward', () => {
  it('пропорционально уцелевшим домам при потерях (без flawless-бонуса)', () => {
    const r = raidReward(6, 8);
    expect(r.survived).toBe(6);
    expect(r.total).toBe(8);
    expect(r.flawless).toBe(false);
    expect(r.coins).toBe(6 * REWARD_COINS_PER_HOUSE);
    expect(r.xp).toBe(6 * REWARD_XP_PER_HOUSE);
  });

  it('все дома целы → бонус ×1.5 и flawless', () => {
    const r = raidReward(8, 8);
    expect(r.flawless).toBe(true);
    expect(r.coins).toBe(Math.floor(8 * REWARD_COINS_PER_HOUSE * FLAWLESS_MULTIPLIER));
    expect(r.xp).toBe(Math.floor(8 * REWARD_XP_PER_HOUSE * FLAWLESS_MULTIPLIER));
  });

  it('все дома разрушены → нулевая награда, не flawless', () => {
    const r = raidReward(0, 8);
    expect(r.coins).toBe(0);
    expect(r.xp).toBe(0);
    expect(r.flawless).toBe(false);
  });

  it('survived клампится к total и к нулю', () => {
    expect(raidReward(99, 8).survived).toBe(8); // не больше total
    expect(raidReward(99, 8).flawless).toBe(true);
    expect(raidReward(-3, 8).survived).toBe(0);
    expect(raidReward(-3, 8).coins).toBe(0);
  });

  it('деревня без домов (total=0) — пустая награда, не flawless', () => {
    const r = raidReward(0, 0);
    expect(r.coins).toBe(0);
    expect(r.xp).toBe(0);
    expect(r.flawless).toBe(false);
  });

  it('дробные входы округляются вниз и не дают отрицательных значений', () => {
    const r = raidReward(3.9, 8.7);
    expect(r.survived).toBe(3);
    expect(r.total).toBe(8);
    expect(r.coins).toBe(3 * REWARD_COINS_PER_HOUSE);
  });
});
