// Реестр предметов: всё, что лежит в инвентаре игрока или выпадает из лута.
// Оружие-предметы — тонкая обёртка над WEAPONS (см. data/weapons.ts): weaponId
// связывает предмет с боевым описанием, чтобы не дублировать урон/анимации.
import { WEAPONS } from './weapons';

export type ItemKind = 'weapon' | 'ranged' | 'armor' | 'trinket' | 'potion' | 'junk';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** Максимум в одном слоте (1 — нестекуемое снаряжение). */
  stack: number;
  /** Базовая цена продажи в монетах. Грабёж даёт 25–220, сверяемся с этим. */
  price: number;
  /** Для kind 'weapon'|'ranged' — ссылка на WEAPONS. */
  weaponId?: string;
  /** Для зелий лечения — сколько hp вернуть. */
  hpRestore?: number;
  /** Длительность эффекта зелья, сек (для зелья прыти). */
  durSec?: number;
  /** Модификаторы характеристик от снаряжения. */
  statMods?: { damageMul?: number; defense?: number; speedMul?: number };
  /** Меш в public/assets (для отрисовки в мире/на персонаже). */
  mesh?: string;
  desc: string;
}

export const ITEMS: Record<string, ItemDef> = {
  // --- Оружие ближнего боя (weaponId → WEAPONS) ---
  dagger: {
    id: 'dagger', name: 'Кинжал', kind: 'weapon', stack: 1, price: 20,
    weaponId: 'dagger', mesh: 'dagger', desc: 'Лёгкий и быстрый. С него все начинают.',
  },
  sword_1handed: {
    id: 'sword_1handed', name: 'Меч стражи', kind: 'weapon', stack: 1, price: 55,
    weaponId: 'sword_1handed', mesh: 'sword_1handed', desc: 'Надёжный одноручный меч.',
  },
  sword_2handed: {
    id: 'sword_2handed', name: 'Двуручный меч', kind: 'weapon', stack: 1, price: 110,
    weaponId: 'sword_2handed', mesh: 'sword_2handed', desc: 'Медленный, но сносит с ног.',
  },
  axe_2handed: {
    id: 'axe_2handed', name: 'Секира', kind: 'weapon', stack: 1, price: 130,
    weaponId: 'axe_2handed', mesh: 'axe_2handed', desc: 'Тяжёлый удар, долгий замах.',
  },
  sword_royal: {
    id: 'sword_royal', name: 'Королевский клинок', kind: 'weapon', stack: 1, price: 320,
    weaponId: 'sword_royal', mesh: 'sword_1handed', desc: 'Клинок из дворцовой оружейной.',
  },
  // --- Дальний бой ---
  crossbow_2handed: {
    id: 'crossbow_2handed', name: 'Арбалет', kind: 'ranged', stack: 1, price: 90,
    weaponId: 'crossbow_2handed', mesh: 'crossbow_2handed', desc: 'Бьёт издалека, долго перезаряжается.',
  },
  // --- Броня (defense складывается, speedMul перемножается) ---
  armor_leather: {
    id: 'armor_leather', name: 'Кожанка', kind: 'armor', stack: 1, price: 45,
    statMods: { defense: 2, speedMul: 1 }, mesh: 'armor_leather',
    desc: 'Не стесняет движений. Слабая защита.',
  },
  armor_chain: {
    id: 'armor_chain', name: 'Кольчуга', kind: 'armor', stack: 1, price: 120,
    statMods: { defense: 4, speedMul: 0.97 }, mesh: 'armor_chain',
    desc: 'Средняя защита, чуть тяжеловата.',
  },
  armor_royal: {
    id: 'armor_royal', name: 'Латы эльфа', kind: 'armor', stack: 1, price: 300,
    statMods: { defense: 7, speedMul: 0.93 }, mesh: 'armor_royal',
    desc: 'Лучшая защита, заметно сковывает.',
  },
  // --- Тринкеты ---
  trinket_wolf: {
    id: 'trinket_wolf', name: 'Амулет волка', kind: 'trinket', stack: 1, price: 180,
    statMods: { damageMul: 1.1 }, mesh: 'trinket_wolf',
    desc: '+10% к урону. Пахнет добычей.',
  },
  trinket_falcon: {
    id: 'trinket_falcon', name: 'Перо сокола', kind: 'trinket', stack: 1, price: 150,
    statMods: { speedMul: 1.07 }, mesh: 'trinket_falcon',
    desc: '+7% к скорости. Лёгкость в ногах.',
  },
  trinket_oak: {
    id: 'trinket_oak', name: 'Оберег дуба', kind: 'trinket', stack: 1, price: 140,
    statMods: { defense: 2 }, mesh: 'trinket_oak',
    desc: '+2 к защите. Древняя кора не гниёт.',
  },
  // --- Зелья ---
  potion_small: {
    id: 'potion_small', name: 'Малое зелье лечения', kind: 'potion', stack: 5, price: 12,
    hpRestore: 40, mesh: 'potion_small', desc: 'Восстанавливает 40 hp.',
  },
  potion_big: {
    id: 'potion_big', name: 'Среднее зелье лечения', kind: 'potion', stack: 5, price: 30,
    hpRestore: 100, mesh: 'potion_big', desc: 'Восстанавливает 100 hp.',
  },
  potion_swift: {
    id: 'potion_swift', name: 'Зелье прыти', kind: 'potion', stack: 5, price: 35,
    statMods: { speedMul: 1.25 }, durSec: 30, mesh: 'potion_swift',
    desc: '+25% к скорости на 30 секунд.',
  },
  // --- Хлам (продаётся дорого) ---
  caravan_bell: {
    id: 'caravan_bell', name: 'Бубенчик корована', kind: 'junk', stack: 5, price: 60,
    mesh: 'caravan_bell', desc: 'Сувенир с ограбленного корована. Коллекционеры платят щедро.',
  },
  old_necklace: {
    id: 'old_necklace', name: 'Старинное ожерелье', kind: 'junk', stack: 1, price: 1000,
    desc: 'Тонкая работа давно ушедших мастеров.',
  },
  // --- Охотничьи трофеи (Фаза 6B): дроп с фауны, продаются в лавке за 50% ---
  deer_antlers: {
    id: 'deer_antlers', name: 'Рога оленя', kind: 'junk', stack: 5, price: 80,
    desc: 'Ветвистые рога. Резчики и знахари дают за них хорошую цену.',
  },
  deer_hide: {
    id: 'deer_hide', name: 'Шкура оленя', kind: 'junk', stack: 5, price: 24,
    desc: 'Тёплая шкура. Скорняку пригодится.',
  },
  fox_pelt: {
    id: 'fox_pelt', name: 'Шкура лисицы', kind: 'junk', stack: 5, price: 140,
    desc: 'Рыжий мех высокой цены — лису ещё попробуй догони.',
  },
  feather: {
    id: 'feather', name: 'Перо', kind: 'junk', stack: 9, price: 6,
    desc: 'Лёгкое птичье перо. Мелочь, но в хозяйстве сгодится.',
  },
};

// Проверка целостности: weaponId ссылается на существующее оружие.
// Падать на старте лучше, чем ловить undefined в бою.
for (const def of Object.values(ITEMS)) {
  if (def.weaponId && !WEAPONS[def.weaponId]) {
    throw new Error(`ITEMS["${def.id}"]: неизвестный weaponId "${def.weaponId}"`);
  }
}
