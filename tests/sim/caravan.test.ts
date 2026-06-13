import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import {
  caravanInterval,
  escortFormation,
  escortHeatBonus,
  planCaravan,
  planCaravanOfTier,
  type CaravanPlan,
  type CaravanTier,
} from '../../src/sim/caravan';

const soldierCount = (plan: CaravanPlan): number =>
  plan.escort.find((u) => u.archetype === 'guard_soldier')?.count ?? 0;

const crossbowCount = (plan: CaravanPlan): number =>
  plan.escort.find((u) => u.archetype === 'guard_crossbow')?.count ?? 0;

const totalEscort = (plan: CaravanPlan): number => plan.escort.reduce((s, u) => s + u.count, 0);

// Частоты тиров на детерминированных сидах: тест баланса без флака.
const tierCounts = (heat: number, runs: number): Record<CaravanTier, number> => {
  const counts: Record<CaravanTier, number> = { poor: 0, merchant: 0, royal: 0 };
  for (let seed = 0; seed < runs; seed++) counts[planCaravan(heat, mulberry32(seed)).tier]++;
  return counts;
};

describe('escortHeatBonus', () => {
  it('+1 мечник за каждые 2 полных heat, кап +4', () => {
    expect(escortHeatBonus(0)).toBe(0);
    expect(escortHeatBonus(1)).toBe(0);
    expect(escortHeatBonus(2)).toBe(1);
    expect(escortHeatBonus(3)).toBe(1);
    expect(escortHeatBonus(4)).toBe(2);
    expect(escortHeatBonus(7)).toBe(3);
    expect(escortHeatBonus(8)).toBe(4);
    expect(escortHeatBonus(100)).toBe(4); // кап
    for (let h = 0; h < 20; h++) {
      expect(escortHeatBonus(h + 1)).toBeGreaterThanOrEqual(escortHeatBonus(h)); // монотонность
    }
  });
});

describe('planCaravan', () => {
  it('детерминизм: одинаковый сид → одинаковый план', () => {
    for (let heat = 0; heat <= 8; heat++) {
      const a = planCaravan(heat, mulberry32(42));
      const b = planCaravan(heat, mulberry32(42));
      expect(a).toEqual(b);
    }
  });

  it('тиры смещаются с heat: на heat 0 доминируют бедные, на heat 5 — купеческие', () => {
    const cold = tierCounts(0, 200); // ожидание ~140/50/10
    const hot = tierCounts(5, 200); // ожидание ~60/90/50

    expect(cold.poor).toBeGreaterThan(cold.merchant);
    expect(cold.merchant).toBeGreaterThan(cold.royal);
    expect(cold.poor).toBeGreaterThanOrEqual(110); // ~70%
    expect(cold.royal).toBeLessThanOrEqual(25); // ~5%

    expect(hot.merchant).toBeGreaterThan(hot.poor);
    expect(hot.merchant).toBeGreaterThan(hot.royal);
    expect(hot.royal).toBeGreaterThanOrEqual(30); // ~25%
    expect(hot.poor).toBeLessThanOrEqual(90); // ~30%

    // Богатые становятся чаще, бедные — реже.
    expect(hot.royal).toBeGreaterThan(cold.royal);
    expect(hot.poor).toBeLessThan(cold.poor);
  });

  it('шансы тиров капятся на heat 5: дальше распределение не меняется', () => {
    expect(tierCounts(5, 200)).toEqual(tierCounts(50, 200));
  });

  it('состав эскорта: база по тиру плюс heat-бонус мечниками', () => {
    const baseSoldiers: Record<CaravanTier, number> = { poor: 2, merchant: 2, royal: 3 };
    const baseCrossbows: Record<CaravanTier, number> = { poor: 0, merchant: 1, royal: 2 };
    for (const heat of [0, 1, 2, 3, 4, 5, 7, 8, 9, 12]) {
      for (let seed = 0; seed < 50; seed++) {
        const plan = planCaravan(heat, mulberry32(seed));
        expect(soldierCount(plan)).toBe(baseSoldiers[plan.tier] + escortHeatBonus(heat));
        expect(crossbowCount(plan)).toBe(baseCrossbows[plan.tier]);
        for (const unit of plan.escort) expect(unit.count).toBeGreaterThan(0); // нет пустых записей
      }
    }
  });

  it('эскорт растёт с heat, капится и всегда влезает в формацию (<= 9)', () => {
    const baseSoldiers: Record<CaravanTier, number> = { poor: 2, merchant: 2, royal: 3 };
    for (let seed = 0; seed < 50; seed++) {
      // Тир на разных heat может отличаться (шансы смещаются), поэтому рост
      // меряем как бонус сверх базы собственного тира плана.
      const cold = planCaravan(0, mulberry32(seed));
      const hot = planCaravan(8, mulberry32(seed));
      const capped = planCaravan(20, mulberry32(seed));
      expect(soldierCount(cold)).toBe(baseSoldiers[cold.tier]); // бонуса нет
      expect(soldierCount(hot)).toBe(baseSoldiers[hot.tier] + 4); // полный бонус
      // С heat 5 шансы тиров заморожены ⇒ на одном сиде тир совпадает: чистый кап.
      expect(capped.tier).toBe(hot.tier);
      expect(soldierCount(capped)).toBe(soldierCount(hot)); // кап +4
      expect(totalEscort(capped)).toBeLessThanOrEqual(9);
      expect(escortFormation(totalEscort(capped)).length).toBe(totalEscort(capped));
    }
  });

  it('лут, xp и скорость соответствуют тиру', () => {
    const lootRange: Record<CaravanTier, [number, number]> = {
      poor: [25, 40],
      merchant: [60, 90],
      royal: [150, 220],
    };
    const xpByTier: Record<CaravanTier, number> = { poor: 20, merchant: 45, royal: 100 };
    const speedByTier: Record<CaravanTier, number> = { poor: 2.4, merchant: 2.2, royal: 1.9 };
    const seen = new Set<CaravanTier>();
    for (const heat of [0, 3, 6, 10]) {
      for (let seed = 0; seed < 100; seed++) {
        const plan = planCaravan(heat, mulberry32(seed));
        seen.add(plan.tier);
        const [min, max] = lootRange[plan.tier];
        expect(plan.lootCoins).toBeGreaterThanOrEqual(min);
        expect(plan.lootCoins).toBeLessThanOrEqual(max);
        expect(Number.isInteger(plan.lootCoins)).toBe(true); // монеты — целые
        expect(plan.xp).toBe(xpByTier[plan.tier]);
        expect(plan.speed).toBe(speedByTier[plan.tier]);
      }
    }
    expect(seen.size).toBe(3); // все три тира реально выпадают
  });
});

describe('planCaravanOfTier', () => {
  it('тир задан явно и не зависит от heat/rng', () => {
    for (const tier of ['poor', 'merchant', 'royal'] as const) {
      for (const heat of [0, 3, 8]) {
        for (let seed = 0; seed < 30; seed++) {
          expect(planCaravanOfTier(tier, heat, mulberry32(seed)).tier).toBe(tier);
        }
      }
    }
  });

  it('состав и награды совпадают с planCaravan того же тира', () => {
    const baseSoldiers: Record<CaravanTier, number> = { poor: 2, merchant: 2, royal: 3 };
    const baseCrossbows: Record<CaravanTier, number> = { poor: 0, merchant: 1, royal: 2 };
    for (const tier of ['poor', 'merchant', 'royal'] as const) {
      for (const heat of [0, 4, 9]) {
        const plan = planCaravanOfTier(tier, heat, mulberry32(7));
        expect(soldierCount(plan)).toBe(baseSoldiers[tier] + escortHeatBonus(heat));
        expect(crossbowCount(plan)).toBe(baseCrossbows[tier]);
        expect(totalEscort(plan)).toBeLessThanOrEqual(9); // влезает в формацию
      }
    }
  });

  it('детерминизм: одинаковый сид → одинаковый план', () => {
    expect(planCaravanOfTier('royal', 5, mulberry32(11))).toEqual(
      planCaravanOfTier('royal', 5, mulberry32(11)),
    );
  });
});

describe('caravanInterval', () => {
  it('детерминизм: одинаковый сид → одинаковый интервал', () => {
    for (let heat = 0; heat <= 8; heat++) {
      expect(caravanInterval(heat, mulberry32(7))).toBe(caravanInterval(heat, mulberry32(7)));
    }
  });

  it('при heat < 6 интервал в 100–140 с', () => {
    for (const heat of [0, 2, 5]) {
      for (let seed = 0; seed < 100; seed++) {
        const sec = caravanInterval(heat, mulberry32(seed));
        expect(sec).toBeGreaterThanOrEqual(100);
        expect(sec).toBeLessThanOrEqual(140);
      }
    }
  });

  it('при heat >= 6 корованы на 25% реже: интервал 125–175 с', () => {
    for (const heat of [6, 8, 12]) {
      for (let seed = 0; seed < 100; seed++) {
        const sec = caravanInterval(heat, mulberry32(seed));
        expect(sec).toBeGreaterThanOrEqual(125);
        expect(sec).toBeLessThanOrEqual(175);
      }
    }
    // Множитель ровно 1.25: на одном сиде «горячий» интервал = базовый * 1.25.
    for (let seed = 0; seed < 20; seed++) {
      expect(caravanInterval(6, mulberry32(seed))).toBeCloseTo(
        caravanInterval(0, mulberry32(seed)) * 1.25,
        10,
      );
    }
  });
});

describe('escortFormation', () => {
  it('возвращает ровно n позиций для 0..9, дальше капится на 9', () => {
    for (let n = 0; n <= 9; n++) expect(escortFormation(n).length).toBe(n);
    expect(escortFormation(10).length).toBe(9);
    expect(escortFormation(100).length).toBe(9);
  });

  it('детерминированная раскладка: префикс не меняется с ростом n', () => {
    const full = escortFormation(9);
    for (let n = 0; n <= 9; n++) expect(escortFormation(n)).toEqual(full.slice(0, n));
  });

  it('без дублей и в пределах ±2 м вбок', () => {
    const slots = escortFormation(9);
    const keys = new Set(slots.map((s) => `${s.dx}:${s.ds}`));
    expect(keys.size).toBe(slots.length); // все позиции уникальны
    for (const s of slots) expect(Math.abs(s.dx)).toBeLessThanOrEqual(2);
  });

  it('с 4 охранников есть и передний, и задний дозор', () => {
    const slots = escortFormation(4);
    expect(slots.some((s) => s.ds > 0)).toBe(true);
    expect(slots.some((s) => s.ds < 0)).toBe(true);
  });

  it('возвращает копии: мутация результата не портит таблицу слотов', () => {
    const a = escortFormation(3);
    a[0]!.dx = 999;
    a[0]!.ds = 999;
    expect(escortFormation(3)[0]).toEqual({ dx: -1.8, ds: 0 });
  });
});
