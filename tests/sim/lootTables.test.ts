import { describe, expect, it } from 'vitest';
import { mulberry32, type Rng } from '../../src/core/rng';
import { LOOT_TABLES, rollLoot } from '../../src/sim/lootTables';

describe('rollLoot', () => {
  it('детерминизм: одинаковый сид → одинаковый результат', () => {
    const a = rollLoot('skeleton_rogue', mulberry32(42), 5);
    const b = rollLoot('skeleton_rogue', mulberry32(42), 5);
    expect(a).toEqual(b);
  });

  it('count каждого дропа в пределах [min, max] своей записи', () => {
    for (const [tableId, table] of Object.entries(LOOT_TABLES)) {
      const rng = mulberry32(7);
      for (let i = 0; i < 200; i++) {
        for (const drop of rollLoot(tableId, rng)) {
          const entry = table.find((e) => e.itemId === drop.itemId)!;
          expect(entry, `${tableId}: неизвестный itemId ${drop.itemId}`).toBeDefined();
          expect(drop.count).toBeGreaterThanOrEqual(entry.min);
          expect(drop.count).toBeLessThanOrEqual(entry.max);
        }
      }
    }
  });

  it('null-запись даёт пустой дроп', () => {
    // skeleton_minion: веса 65/12/23 → r = 0.9*100 = 90 попадает в null-хвост
    const rng: Rng = () => 0.9;
    expect(rollLoot('skeleton_minion', rng)).toEqual([]);
  });

  it('неизвестная таблица → []', () => {
    expect(rollLoot('no_such_table', mulberry32(1))).toEqual([]);
  });

  it('слияние стаков при rolls > 1', () => {
    // rng=0 → всегда первая запись (coins) с count = min
    const rng: Rng = () => 0;
    const minCoins = LOOT_TABLES['skeleton_minion']![0]!.min;
    expect(rollLoot('skeleton_minion', rng, 3)).toEqual([
      { itemId: 'coins', count: minCoins * 3 },
    ]);
  });

  it('все таблицы валидны: weight > 0, min <= max, у предметов min >= 1', () => {
    for (const [tableId, table] of Object.entries(LOOT_TABLES)) {
      expect(table.length, `${tableId}: пустая таблица`).toBeGreaterThan(0);
      for (const entry of table) {
        const label = `${tableId}/${entry.itemId ?? 'null'}`;
        expect(entry.weight, `${label}: weight`).toBeGreaterThan(0);
        expect(entry.min, `${label}: min <= max`).toBeLessThanOrEqual(entry.max);
        if (entry.itemId !== null) expect(entry.min, `${label}: min >= 1`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
