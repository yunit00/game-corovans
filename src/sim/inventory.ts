// Чистая логика инвентаря (Фаза 6, волна 6A): только числа/plain-объекты и id
// предметов — никакого Three/мешей. Смена визуала оружия живёт в рендере, читая
// эти id. Форма плоская и JSON-совместима (без Map/Set/классов) — сериализуется
// целиком в сейв. Тестируется в node.
import { ITEMS, type ItemKind } from '../data/items';

/** Слот сумки: id предмета (см. data/items.ts) и стак. null — пустой слот. */
export interface ItemStack {
  id: string;
  count: number;
}

/**
 * Слоты экипировки. Хранят id предмета или null (ничего не надето).
 * weapon — милишка, ranged — лук/арбалет, armor — броня, trinket — безделушка.
 */
export interface Inventory {
  /** Фиксированная длина (для UI-сетки); null — пусто. */
  slots: (ItemStack | null)[];
  equipment: {
    weapon: string | null;
    ranged: string | null;
    armor: string | null;
    trinket: string | null;
  };
}

/** Ключи ячеек экипировки = поднабор ItemKind, который можно носить. */
export type EquipKey = 'weapon' | 'ranged' | 'armor' | 'trinket';

/** Какие kind кладутся в какую ячейку (1:1). */
const EQUIP_KEYS: readonly EquipKey[] = ['weapon', 'ranged', 'armor', 'trinket'];

/** kind → ключ ячейки, либо null если предмет не экипируется (potion/junk). */
function equipKeyOf(kind: ItemKind): EquipKey | null {
  return (EQUIP_KEYS as readonly string[]).includes(kind) ? (kind as EquipKey) : null;
}

/** По умолчанию 24 слота (из ROADMAP: «инвентарь 24 слота»). */
export function makeInventory(slots = 24): Inventory {
  return {
    slots: new Array<ItemStack | null>(slots).fill(null),
    equipment: { weapon: null, ranged: null, armor: null, trinket: null },
  };
}

/** Лимит стека предмета; неизвестный id трактуем как нестекуемый (1). */
function stackLimit(id: string): number {
  return ITEMS[id]?.stack ?? 1;
}

/**
 * Добавляет count штук id: сначала добивает существующие стеки, затем занимает
 * пустые слоты. Возвращает остаток, который НЕ влез (0 — всё поместилось).
 */
export function addItem(inv: Inventory, id: string, count: number): number {
  if (count <= 0) return 0;
  const limit = stackLimit(id);
  let left = count;
  // Сначала добиваем неполные стеки этого же предмета.
  for (const slot of inv.slots) {
    if (left <= 0) break;
    if (slot && slot.id === id && slot.count < limit) {
      const put = Math.min(limit - slot.count, left);
      slot.count += put;
      left -= put;
    }
  }
  // Затем раскладываем по пустым слотам.
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i] === null) {
      const put = Math.min(limit, left);
      inv.slots[i] = { id, count: put };
      left -= put;
    }
  }
  return left;
}

/**
 * Снимает count штук id из слотов (с конца — дробим хвостовые стеки первыми).
 * Возвращает false и не меняет инвентарь, если предмета недостаточно.
 */
export function removeItem(inv: Inventory, id: string, count: number): boolean {
  if (count <= 0) return true;
  if (countItem(inv, id) < count) return false;
  let left = count;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const slot = inv.slots[i];
    if (slot && slot.id === id) {
      const take = Math.min(slot.count, left);
      slot.count -= take;
      left -= take;
      if (slot.count === 0) inv.slots[i] = null;
    }
  }
  return true;
}

/** Сколько всего штук id лежит в слотах (экипировку не считаем). */
export function countItem(inv: Inventory, id: string): number {
  let total = 0;
  for (const slot of inv.slots) {
    if (slot && slot.id === id) total += slot.count;
  }
  return total;
}

function inRange(inv: Inventory, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < inv.slots.length;
}

/**
 * Перемещает стек from→to. Если в to лежит тот же предмет — сливает стеки
 * (с учётом лимита, остаток остаётся в from). Иначе — меняет местами (swap).
 */
export function moveSlot(inv: Inventory, from: number, to: number): void {
  if (from === to || !inRange(inv, from) || !inRange(inv, to)) return;
  const src = inv.slots[from];
  if (!src) return; // тащить нечего
  // inRange гарантирует валидный индекс; ?? null убирает undefined из типа.
  const dst = inv.slots[to] ?? null;
  if (dst && dst.id === src.id) {
    // Слияние одинаковых стеков до лимита.
    const move = Math.min(stackLimit(src.id) - dst.count, src.count);
    dst.count += move;
    src.count -= move;
    if (src.count === 0) inv.slots[from] = null;
    return;
  }
  // Разные предметы (или пустой to) — простой обмен.
  inv.slots[to] = src;
  inv.slots[from] = dst;
}

/**
 * Экипирует предмет из слота slotIndex в подходящую ячейку. Ранее надетый
 * предмет возвращается в освободившийся слот. potion/junk/неизвестный → false.
 */
export function equip(inv: Inventory, slotIndex: number): boolean {
  if (!inRange(inv, slotIndex)) return false;
  const stack = inv.slots[slotIndex];
  if (!stack) return false;
  const def = ITEMS[stack.id];
  if (!def) return false;
  const key = equipKeyOf(def.kind);
  if (!key) return false; // зелья/хлам не носятся
  // Снаряжение нестекуемое: в ячейку — id, прежний возвращаем в тот же слот.
  const prev = inv.equipment[key];
  inv.equipment[key] = stack.id;
  inv.slots[slotIndex] = prev ? { id: prev, count: 1 } : null;
  return true;
}

/** Снимает экипировку key в свободный слот. Нет места → false (остаётся надетым). */
export function unequip(inv: Inventory, key: EquipKey): boolean {
  const id = inv.equipment[key];
  if (!id) return false;
  const free = inv.slots.indexOf(null);
  if (free < 0) return false;
  inv.slots[free] = { id, count: 1 };
  inv.equipment[key] = null;
  return true;
}

/**
 * Сводные модификаторы от надетого снаряжения: damageMul/speedMul
 * перемножаются, defense суммируется. weapon-statMods учитываются, если заданы.
 */
export function totalStatMods(inv: Inventory): { damageMul: number; defense: number; speedMul: number } {
  let damageMul = 1;
  let defense = 0;
  let speedMul = 1;
  for (const key of EQUIP_KEYS) {
    const id = inv.equipment[key];
    if (!id) continue;
    const mods = ITEMS[id]?.statMods;
    if (!mods) continue;
    if (mods.damageMul !== undefined) damageMul *= mods.damageMul;
    if (mods.defense !== undefined) defense += mods.defense;
    if (mods.speedMul !== undefined) speedMul *= mods.speedMul;
  }
  return { damageMul, defense, speedMul };
}
