import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/data/items';
import { addItem, equip, makeInventory } from '../../src/sim/inventory';
import {
  buy,
  buyPrice,
  canBuy,
  canSell,
  isRoyal,
  sell,
  sellPrice,
  shopItemName,
  ARROWS_PACK_ID,
  ARROWS_PACK_PRICE,
  SELL_FRACTION,
  ROYAL_SELL_FRACTION,
  SHOP_STOCK,
  TRAVELER_STOCK,
  TRAVELER_MARKUP,
  DEFAULT_SHOP,
  TRAVELER_SHOP,
} from '../../src/sim/shop';

describe('isRoyal', () => {
  it('royal-предметы распознаются по суффиксу id', () => {
    expect(isRoyal('sword_royal')).toBe(true);
    expect(isRoyal('armor_royal')).toBe(true);
    expect(isRoyal('sword_1handed')).toBe(false);
    expect(isRoyal('caravan_bell')).toBe(false);
  });
});

describe('ассортимент SHOP_STOCK', () => {
  it('не содержит royal-предметов (их игрок добывает сам)', () => {
    for (const id of SHOP_STOCK) {
      expect(isRoyal(id)).toBe(false);
    }
  });

  it('все товары существуют в ITEMS, кроме виртуальной пачки стрел', () => {
    for (const id of SHOP_STOCK) {
      if (id === ARROWS_PACK_ID) continue;
      expect(ITEMS[id]).toBeDefined();
    }
  });

  it('содержит зелья, пачку стрел и снаряжение', () => {
    expect(SHOP_STOCK).toContain('potion_small');
    expect(SHOP_STOCK).toContain(ARROWS_PACK_ID);
    expect(SHOP_STOCK).toContain('sword_1handed');
    expect(SHOP_STOCK).toContain('armor_leather');
  });
});

describe('buyPrice / sellPrice', () => {
  it('цена покупки = price из ITEMS', () => {
    expect(buyPrice('sword_1handed')).toBe(ITEMS.sword_1handed!.price);
    expect(buyPrice(ARROWS_PACK_ID)).toBe(ARROWS_PACK_PRICE);
    expect(buyPrice('нет такого')).toBe(0);
  });

  it('обычная вещь продаётся за 50% (округление вниз)', () => {
    // caravan_bell price 60 → 30
    expect(sellPrice('caravan_bell')).toBe(Math.floor(60 * SELL_FRACTION));
    // potion_swift price 35 → floor(17.5) = 17
    expect(sellPrice('potion_swift')).toBe(17);
  });

  it('royal-вещь продаётся за 60% (округление вниз)', () => {
    // sword_royal price 320 → 192
    expect(sellPrice('sword_royal')).toBe(Math.floor(320 * ROYAL_SELL_FRACTION));
    expect(sellPrice('armor_royal')).toBe(Math.floor(300 * ROYAL_SELL_FRACTION));
  });

  it('минимум 1 монета у дешёвой вещи и 0 у неизвестной', () => {
    // potion_small price 12 → floor(6) = 6, гарантированно >= 1
    expect(sellPrice('potion_small')).toBeGreaterThanOrEqual(1);
    expect(sellPrice('нет такого')).toBe(0);
  });

  it('капстоун «Хозяин троп»: sellMul поднимает выкуп (×1.2, округление вниз)', () => {
    // caravan_bell price 60 → база 30 → ×1.2 = 36.
    expect(sellPrice('caravan_bell', 1.2)).toBe(Math.floor(60 * SELL_FRACTION * 1.2));
    // royal sword 320 → база 192 → ×1.2 = floor(230.4) = 230.
    expect(sellPrice('sword_royal', 1.2)).toBe(Math.floor(320 * ROYAL_SELL_FRACTION * 1.2));
    // sellMul по умолчанию 1 — без наценки.
    expect(sellPrice('caravan_bell')).toBe(sellPrice('caravan_bell', 1));
  });
});

describe('canBuy / buy', () => {
  it('покупка при нехватке монет запрещена', () => {
    const inv = makeInventory();
    expect(canBuy(inv, 5, 'sword_1handed')).toBe('poor');
    const r = buy(inv, 5, 'sword_1handed');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('poor');
    expect(r.coins).toBe(5);
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  it('покупка при отсутствии места запрещена', () => {
    const inv = makeInventory(1);
    addItem(inv, 'dagger', 1); // единственный слот занят нестекуемым
    expect(canBuy(inv, 999, 'sword_1handed')).toBe('full');
    const r = buy(inv, 999, 'sword_1handed');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('full');
    expect(r.coins).toBe(999);
  });

  it('успешная покупка списывает монеты и кладёт предмет', () => {
    const inv = makeInventory();
    const price = buyPrice('sword_1handed');
    const r = buy(inv, 200, 'sword_1handed');
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(200 - price);
    expect(inv.slots[0]).toEqual({ id: 'sword_1handed', count: 1 });
  });

  it('покупка стекуемого зелья добивает существующий стек', () => {
    const inv = makeInventory(2);
    addItem(inv, 'potion_small', 1);
    const r = buy(inv, 999, 'potion_small');
    expect(r.ok).toBe(true);
    expect(inv.slots[0]).toEqual({ id: 'potion_small', count: 2 });
  });

  it('неизвестный товар — error unknown', () => {
    const inv = makeInventory();
    expect(canBuy(inv, 999, 'нет такого')).toBe('unknown');
    const r = buy(inv, 999, 'нет такого');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unknown');
  });
});

describe('canSell / sell', () => {
  it('пустой слот продать нельзя', () => {
    const inv = makeInventory();
    expect(canSell(inv, 0)).toBe(false);
    const r = sell(inv, 100, 0);
    expect(r.ok).toBe(false);
    expect(r.coins).toBe(100);
  });

  it('экипированный предмет в slots не лежит — продать его нельзя', () => {
    const inv = makeInventory();
    addItem(inv, 'sword_1handed', 1);
    expect(equip(inv, 0)).toBe(true);
    // Меч теперь в equipment.weapon, слоты пусты → нечего продавать.
    expect(inv.equipment.weapon).toBe('sword_1handed');
    expect(canSell(inv, 0)).toBe(false);
    const r = sell(inv, 0, 0);
    expect(r.ok).toBe(false);
  });

  it('продажа одной штуки начисляет sellPrice и снимает из стека', () => {
    const inv = makeInventory();
    addItem(inv, 'caravan_bell', 3);
    const price = sellPrice('caravan_bell');
    const r = sell(inv, 0, 0);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(price);
    // Снялась одна штука — осталось 2.
    expect(inv.slots[0]).toEqual({ id: 'caravan_bell', count: 2 });
  });

  it('продажа последней штуки очищает слот', () => {
    const inv = makeInventory();
    addItem(inv, 'caravan_bell', 1);
    const r = sell(inv, 50, 0);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(50 + sellPrice('caravan_bell'));
    expect(inv.slots[0]).toBeNull();
  });

  it('royal-добыча сдаётся дороже обычной вещи той же цены', () => {
    // sword_royal (320) против обычной 320: royal даёт 60%, обычная — 50%
    const royal = sellPrice('sword_royal');
    expect(royal).toBe(Math.floor(320 * ROYAL_SELL_FRACTION));
    expect(royal).toBeGreaterThan(Math.floor(320 * SELL_FRACTION));
  });

  it('капстоун «Хозяин троп»: sell с sellMul начисляет повышенный выкуп', () => {
    const inv = makeInventory();
    addItem(inv, 'caravan_bell', 1);
    const boosted = sellPrice('caravan_bell', 1.2);
    const r = sell(inv, 0, 0, 1.2);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(boosted);
    expect(boosted).toBeGreaterThan(sellPrice('caravan_bell'));
  });
});

describe('shopItemName', () => {
  it('пачка стрел имеет собственное имя, прочее — из ITEMS', () => {
    expect(shopItemName(ARROWS_PACK_ID)).toContain('стрел');
    expect(shopItemName('sword_1handed')).toBe(ITEMS.sword_1handed!.name);
  });
});

describe('странствующий торговец (наценка ×1.25)', () => {
  it('деревенская лавка — без наценки (markup 1)', () => {
    expect(DEFAULT_SHOP.markup).toBe(1);
    expect(DEFAULT_SHOP.stock).toBe(SHOP_STOCK);
  });

  it('ассортимент торговца — мини-набор: зелья + стрелы + 1-2 предмета', () => {
    expect(TRAVELER_STOCK.length).toBeGreaterThanOrEqual(3);
    expect(TRAVELER_STOCK.length).toBeLessThanOrEqual(6);
    expect(TRAVELER_STOCK).toContain('potion_small');
    expect(TRAVELER_STOCK).toContain(ARROWS_PACK_ID);
    // Royal-предметов у торговца тоже нет.
    for (const id of TRAVELER_STOCK) expect(isRoyal(id)).toBe(false);
  });

  it('цена у торговца дороже деревни: ×markup с округлением вверх', () => {
    expect(TRAVELER_MARKUP).toBeGreaterThan(1);
    // potion_small price 12 → ceil(12 * 1.25) = 15 > 12
    const base = buyPrice('potion_small');
    const traveler = buyPrice('potion_small', TRAVELER_MARKUP);
    expect(traveler).toBe(Math.ceil(base * TRAVELER_MARKUP));
    expect(traveler).toBeGreaterThan(base);
  });

  it('TRAVELER_SHOP несёт свой ассортимент и наценку', () => {
    expect(TRAVELER_SHOP.markup).toBe(TRAVELER_MARKUP);
    expect(TRAVELER_SHOP.stock).toBe(TRAVELER_STOCK);
  });

  it('пачка стрел у торговца тоже дороже (наценка применяется)', () => {
    const traveler = buyPrice(ARROWS_PACK_ID, TRAVELER_MARKUP);
    expect(traveler).toBe(Math.ceil(ARROWS_PACK_PRICE * TRAVELER_MARKUP));
    expect(traveler).toBeGreaterThan(ARROWS_PACK_PRICE);
  });

  it('покупка по наценке списывает дороже', () => {
    const inv = makeInventory();
    const base = buyPrice('potion_small');
    const up = buyPrice('potion_small', TRAVELER_MARKUP);
    const r = buy(inv, 1000, 'potion_small', TRAVELER_MARKUP);
    expect(r.ok).toBe(true);
    expect(r.coins).toBe(1000 - up);
    expect(up).toBeGreaterThan(base);
  });

  it('canBuy по наценке учитывает дорогую цену (бедность считается с markup)', () => {
    const inv = makeInventory();
    const base = buyPrice('potion_small'); // 12
    // Денег ровно на базовую цену, но не на наценённую → poor у торговца.
    expect(canBuy(inv, base, 'potion_small', 1)).toBeNull();
    expect(canBuy(inv, base, 'potion_small', TRAVELER_MARKUP)).toBe('poor');
  });
});
