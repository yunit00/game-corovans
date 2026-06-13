// Чистая логика магазина (Фаза 6B): только числа/id, без Three/DOM. Цены берутся
// из data/items.ts (price). Покупка = price, продажа = доля от price. Game держит
// кошелёк/инвентарь и зовёт buy/sell; всё тестируется в node (tests/sim/shop.test.ts).
import { ITEMS, type ItemDef } from '../data/items';
import { addItem, countItem, removeItem, type Inventory } from './inventory';

/** Доля цены при продаже обычной вещи (округление вниз). */
export const SELL_FRACTION = 0.5;
/** Доля цены при продаже королевской добычи — её выгоднее сбывать (округление вниз). */
export const ROYAL_SELL_FRACTION = 0.6;

/**
 * Королевские предметы — добыча с дворцовых корованов, в магазине НЕ продаются
 * (игрок добывает их сам), зато сдаются дороже обычных. Распознаём по суффиксу id.
 */
export function isRoyal(id: string): boolean {
  return id.endsWith('_royal');
}

/**
 * Ассортимент на продажу игроку (колонка «Купить»). Порядок фиксирован: зелья,
 * стрелы, оружие, броня, тринкеты. Royal-предметы исключены намеренно.
 */
export const SHOP_STOCK: readonly string[] = [
  'potion_small',
  'potion_big',
  'potion_swift',
  'arrows_pack',
  'dagger',
  'sword_1handed',
  'crossbow_2handed',
  'armor_leather',
  'armor_chain',
  'trinket_oak',
  'trinket_falcon',
];

/**
 * Странствующий торговец у лагеря охотника (волна B): мини-ассортимент — зелья,
 * стрелы и пара предметов. Цены ×TRAVELER_MARKUP (округление вверх), так что
 * деревенская лавка остаётся выгоднее. Royal тоже не торгуется.
 */
export const TRAVELER_STOCK: readonly string[] = [
  'potion_small',
  'potion_big',
  'arrows_pack',
  'dagger',
  'trinket_oak',
];

/** Наценка странствующего торговца к базовой цене (деревня выгоднее). */
export const TRAVELER_MARKUP = 1.25;

/** Профиль лавки: ассортимент + наценка покупки. Продажа всегда по базовым долям. */
export interface ShopConfig {
  /** Список id товаров колонки «Купить». */
  stock: readonly string[];
  /** Множитель цены покупки (1 — без наценки). */
  markup: number;
  /** Заголовок окна лавки. */
  title: string;
}

/** Деревенская лавка: полный ассортимент, без наценки. */
export const DEFAULT_SHOP: ShopConfig = { stock: SHOP_STOCK, markup: 1, title: 'ЛАВКА' };

/** Странствующий торговец: мини-набор, наценка ×1.25. */
export const TRAVELER_SHOP: ShopConfig = {
  stock: TRAVELER_STOCK,
  markup: TRAVELER_MARKUP,
  title: 'ТОРГОВЕЦ',
};

/**
 * Лавка постоялого двора (волна B+): тот же мини-ассортимент и наценка, что у
 * странствующего торговца, но свой заголовок — лавка стоит внутри двора у тракта.
 */
export const INN_SHOP: ShopConfig = {
  stock: TRAVELER_STOCK,
  markup: TRAVELER_MARKUP,
  title: 'ПОСТОЯЛЫЙ ДВОР',
};

/**
 * Виртуальный товар «Пачка стрел» — стрелы не лежат в инвентаре (свой счётчик
 * ammo в Game), поэтому это не ItemDef из ITEMS, а спец-запись магазина. Game
 * перехватывает покупку этого id и зовёт buyArrows вместо addItem.
 */
export const ARROWS_PACK_ID = 'arrows_pack';
export const ARROWS_PACK_PRICE = 15;
export const ARROWS_PACK_COUNT = 10;
export const ARROWS_PACK_NAME = 'Пачка стрел ×10';
export const ARROWS_PACK_DESC = 'Десяток арбалетных болтов для колчана.';

/**
 * Цена покупки предмета (price из ITEMS; стрелы — фиксировано). markup>1 —
 * наценка странствующего торговца, округляется ВВЕРХ (Math.ceil), чтобы дороже
 * деревни даже на дешёвых товарах. markup=1 (по умолчанию) — деревенская цена.
 */
export function buyPrice(id: string, markup = 1): number {
  const base = id === ARROWS_PACK_ID ? ARROWS_PACK_PRICE : (ITEMS[id]?.price ?? 0);
  return markup === 1 ? base : Math.ceil(base * markup);
}

/**
 * Цена выкупа предмета у игрока: доля от price, округлённая ВНИЗ (минимум 1 для
 * предметов с ненулевой ценой). Royal — по ROYAL_SELL_FRACTION, прочее — по SELL_FRACTION.
 * sellMul — капстоунная наценка в пользу игрока (1 — без бонуса, 1.2 — «Хозяин троп»).
 */
export function sellPrice(id: string, sellMul = 1): number {
  const base = ITEMS[id]?.price ?? 0;
  if (base <= 0) return 0;
  const frac = isRoyal(id) ? ROYAL_SELL_FRACTION : SELL_FRACTION;
  return Math.max(1, Math.floor(base * frac * sellMul));
}

/** Есть ли в инвентаре свободное место под count штук id (с учётом стеков). */
function hasRoomFor(inv: Inventory, id: string, count: number): boolean {
  const limit = ITEMS[id]?.stack ?? 1;
  let room = 0;
  for (const slot of inv.slots) {
    if (slot === null) room += limit;
    else if (slot.id === id && slot.count < limit) room += limit - slot.count;
    if (room >= count) return true;
  }
  return room >= count;
}

/** Почему покупка невозможна (для внятного сообщения в UI). null — можно купить. */
export type BuyError = 'poor' | 'full' | 'unknown';

/**
 * Проверка покупки предмета из ассортимента (БЕЗ мутаций). Возвращает причину
 * отказа или null. Стрелы (ARROWS_PACK_ID) сюда не передаём — у них своя ёмкость
 * (потолок колчана), её проверяет Game через ammo.buyArrows.
 */
export function canBuy(inv: Inventory, coins: number, id: string, markup = 1): BuyError | null {
  const def = ITEMS[id];
  if (!def) return 'unknown';
  if (coins < buyPrice(id, markup)) return 'poor';
  if (!hasRoomFor(inv, id, 1)) return 'full';
  return null;
}

/** Результат сделки: успех, обновлённый кошелёк, причина отказа при неуспехе. */
export interface TradeResult {
  ok: boolean;
  coins: number;
  error?: BuyError;
}

/**
 * Покупка одной штуки id: списывает price, кладёт предмет в инвентарь. При нехватке
 * монет/места ничего не меняет и возвращает error. Стрелы здесь НЕ обрабатываются.
 */
export function buy(inv: Inventory, coins: number, id: string, markup = 1): TradeResult {
  const err = canBuy(inv, coins, id, markup);
  if (err) return { ok: false, coins, error: err };
  const left = addItem(inv, id, 1);
  if (left > 0) {
    // hasRoomFor сказал «влезет», но на всякий случай не дробим стек: откат.
    removeItem(inv, id, 1 - left);
    return { ok: false, coins, error: 'full' };
  }
  return { ok: true, coins: coins - buyPrice(id, markup) };
}

/**
 * Можно ли продать предмет из слота slotIndex: слот занят, предмет известен и имеет
 * цену. Экипировку продавать нельзя — но она и не лежит в slots (отдельные ячейки
 * equipment), так что проверка слота этого достаточно. Возвращает true/false.
 */
export function canSell(inv: Inventory, slotIndex: number): boolean {
  const slot = inv.slots[slotIndex];
  if (!slot) return false;
  return sellPrice(slot.id) > 0 && countItem(inv, slot.id) > 0;
}

/**
 * Продажа ОДНОЙ штуки из слота slotIndex: снимает предмет, начисляет sellPrice.
 * Продаём по одной — так игрок дозированно сбывает стеки бубенчиков. Нельзя
 * продать (пустой слот/нулевая цена) → ok:false без изменений. sellMul —
 * капстоунная наценка «Хозяин троп» (1 — без бонуса).
 */
export function sell(inv: Inventory, coins: number, slotIndex: number, sellMul = 1): TradeResult {
  const slot = inv.slots[slotIndex];
  if (!slot || sellPrice(slot.id, sellMul) <= 0) return { ok: false, coins };
  const gain = sellPrice(slot.id, sellMul);
  if (!removeItem(inv, slot.id, 1)) return { ok: false, coins };
  return { ok: true, coins: coins + gain };
}

/** Удобный аксессор имени товара (стрелы — спец-имя, прочее — из ITEMS). */
export function shopItemName(id: string): string {
  if (id === ARROWS_PACK_ID) return ARROWS_PACK_NAME;
  return ITEMS[id]?.name ?? id;
}

/** Удобный аксессор описания товара. */
export function shopItemDesc(id: string): string {
  if (id === ARROWS_PACK_ID) return ARROWS_PACK_DESC;
  return ITEMS[id]?.desc ?? '';
}

/** Def товара (стрелы → undefined, у них нет ItemDef). */
export function shopItemDef(id: string): ItemDef | undefined {
  if (id === ARROWS_PACK_ID) return undefined;
  return ITEMS[id];
}
