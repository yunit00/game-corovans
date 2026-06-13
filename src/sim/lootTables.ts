// Взвешенные лут-таблицы. Чистые функции, seeded RNG.
import type { Rng } from '../core/rng';

export interface LootEntry {
  itemId: string | null; // null — пустой дроп
  weight: number;
  min: number;
  max: number;
}

export interface LootDrop {
  itemId: string;
  count: number;
}

export const LOOT_TABLES: Record<string, LootEntry[]> = {
  skeleton_minion: [
    { itemId: 'coins', weight: 65, min: 4, max: 10 },
    { itemId: 'potion_small', weight: 12, min: 1, max: 1 },
    { itemId: null, weight: 23, min: 0, max: 0 },
  ],
  skeleton_rogue: [
    { itemId: 'coins', weight: 60, min: 8, max: 16 },
    { itemId: 'potion_small', weight: 15, min: 1, max: 1 },
    { itemId: 'dagger', weight: 6, min: 1, max: 1 },
    { itemId: null, weight: 19, min: 0, max: 0 },
  ],
  // Подвижные AI Фазы 4 (см. data/archetypes.ts)
  skeleton_raider: [
    { itemId: 'coins', weight: 62, min: 4, max: 12 },
    { itemId: 'potion_small', weight: 14, min: 1, max: 1 },
    { itemId: 'dagger', weight: 5, min: 1, max: 1 },
    { itemId: null, weight: 19, min: 0, max: 0 },
  ],
  skeleton_brute: [
    { itemId: 'coins', weight: 60, min: 6, max: 12 },
    { itemId: 'potion_small', weight: 12, min: 1, max: 1 },
    { itemId: 'axe_2handed', weight: 6, min: 1, max: 1 },
    { itemId: null, weight: 22, min: 0, max: 0 },
  ],
  guard_soldier: [
    { itemId: 'coins', weight: 60, min: 10, max: 20 },
    { itemId: 'potion_small', weight: 12, min: 1, max: 1 },
    { itemId: 'sword_1handed', weight: 7, min: 1, max: 1 },
    { itemId: 'armor_leather', weight: 5, min: 1, max: 1 },
    { itemId: null, weight: 16, min: 0, max: 0 },
  ],
  guard_crossbow: [
    { itemId: 'coins', weight: 60, min: 10, max: 18 },
    { itemId: 'crossbow_2handed', weight: 7, min: 1, max: 1 },
    { itemId: 'potion_small', weight: 12, min: 1, max: 1 },
    { itemId: null, weight: 21, min: 0, max: 0 },
  ],
  // Стража замка злодея (пакет villain-castle): щедрее рядовых скелетов — это
  // труднодоступный финальный контент. Рядовой даёт 30-60 монет, элита — больше
  // и с шансом на броню/тяжёлое оружие.
  villain_guard: [
    { itemId: 'coins', weight: 62, min: 30, max: 60 },
    { itemId: 'potion_small', weight: 14, min: 1, max: 2 },
    { itemId: 'sword_1handed', weight: 8, min: 1, max: 1 },
    { itemId: 'armor_leather', weight: 6, min: 1, max: 1 },
    { itemId: null, weight: 10, min: 0, max: 0 },
  ],
  villain_elite: [
    { itemId: 'coins', weight: 55, min: 60, max: 110 },
    { itemId: 'potion_big', weight: 18, min: 1, max: 2 },
    { itemId: 'sword_2handed', weight: 12, min: 1, max: 1 },
    { itemId: 'armor_royal', weight: 9, min: 1, max: 1 },
    { itemId: null, weight: 6, min: 0, max: 0 },
  ],
  // Корованы по тирам
  caravan_poor: [
    { itemId: 'coins', weight: 70, min: 25, max: 50 },
    { itemId: 'potion_small', weight: 30, min: 1, max: 2 },
  ],
  caravan_merchant: [
    { itemId: 'coins', weight: 55, min: 60, max: 120 },
    { itemId: 'potion_big', weight: 20, min: 1, max: 2 },
    { itemId: 'sword_2handed', weight: 12, min: 1, max: 1 },
    { itemId: 'armor_leather', weight: 13, min: 1, max: 1 },
  ],
  caravan_royal: [
    { itemId: 'coins', weight: 45, min: 150, max: 300 },
    { itemId: 'armor_royal', weight: 15, min: 1, max: 1 },
    { itemId: 'sword_royal', weight: 15, min: 1, max: 1 },
    { itemId: 'potion_big', weight: 25, min: 2, max: 3 },
  ],
  // Спрятанные сундуки
  chest_common: [
    { itemId: 'coins', weight: 60, min: 30, max: 70 },
    { itemId: 'potion_small', weight: 25, min: 1, max: 2 },
    { itemId: 'dagger', weight: 15, min: 1, max: 1 },
  ],
  chest_rare: [
    { itemId: 'coins', weight: 40, min: 80, max: 160 },
    { itemId: 'potion_big', weight: 25, min: 1, max: 2 },
    { itemId: 'axe_2handed', weight: 15, min: 1, max: 1 },
    { itemId: 'armor_leather', weight: 20, min: 1, max: 1 },
  ],
  chest_epic: [
    { itemId: 'coins', weight: 30, min: 200, max: 400 },
    { itemId: 'sword_royal', weight: 25, min: 1, max: 1 },
    { itemId: 'armor_royal', weight: 25, min: 1, max: 1 },
    { itemId: 'trinket_wolf', weight: 20, min: 1, max: 1 },
  ],
};

export function rollLoot(tableId: string, rng: Rng, rolls = 1): LootDrop[] {
  const table = LOOT_TABLES[tableId];
  if (!table) return [];
  const total = table.reduce((s, e) => s + e.weight, 0);
  const out: LootDrop[] = [];
  for (let i = 0; i < rolls; i++) {
    let r = rng() * total;
    for (const entry of table) {
      r -= entry.weight;
      if (r <= 0) {
        if (entry.itemId) {
          const count = entry.min + Math.floor(rng() * (entry.max - entry.min + 1));
          out.push({ itemId: entry.itemId, count });
        }
        break;
      }
    }
  }
  // Слить стаки одинаковых предметов
  const merged = new Map<string, number>();
  for (const d of out) merged.set(d.itemId, (merged.get(d.itemId) ?? 0) + d.count);
  return [...merged.entries()].map(([itemId, count]) => ({ itemId, count }));
}
