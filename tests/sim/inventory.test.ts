import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/data/items';
import {
  addItem,
  countItem,
  equip,
  makeInventory,
  moveSlot,
  removeItem,
  totalStatMods,
  unequip,
} from '../../src/sim/inventory';

describe('makeInventory', () => {
  it('по умолчанию 24 пустых слота и голая экипировка', () => {
    const inv = makeInventory();
    expect(inv.slots).toHaveLength(24);
    expect(inv.slots.every((s) => s === null)).toBe(true);
    expect(inv.equipment).toEqual({ weapon: null, ranged: null, armor: null, trinket: null });
  });

  it('кастомный размер', () => {
    expect(makeInventory(8).slots).toHaveLength(8);
  });
});

describe('addItem / countItem', () => {
  it('стекуемый предмет добивает стек до лимита, потом новый слот', () => {
    const inv = makeInventory(24);
    // potion_small: stack 5 → 7 штук = слот 5 + слот 2
    expect(addItem(inv, 'potion_small', 7)).toBe(0);
    expect(inv.slots[0]).toEqual({ id: 'potion_small', count: 5 });
    expect(inv.slots[1]).toEqual({ id: 'potion_small', count: 2 });
    expect(countItem(inv, 'potion_small')).toBe(7);
  });

  it('докидывание добивает неполный стек прежде, чем занять пустой слот', () => {
    const inv = makeInventory(24);
    addItem(inv, 'potion_small', 3); // [3]
    addItem(inv, 'potion_small', 4); // добить до 5, остаток 2 в новый слот
    expect(inv.slots[0]).toEqual({ id: 'potion_small', count: 5 });
    expect(inv.slots[1]).toEqual({ id: 'potion_small', count: 2 });
  });

  it('нестекуемое снаряжение раскладывается по одному слоту на штуку', () => {
    const inv = makeInventory(24);
    addItem(inv, 'dagger', 3); // stack 1
    expect(inv.slots[0]).toEqual({ id: 'dagger', count: 1 });
    expect(inv.slots[1]).toEqual({ id: 'dagger', count: 1 });
    expect(inv.slots[2]).toEqual({ id: 'dagger', count: 1 });
    expect(countItem(inv, 'dagger')).toBe(3);
  });

  it('переполнение: возвращает невлезший остаток, инвентарь забит', () => {
    const inv = makeInventory(2); // 2 слота × stack 5 = 10 мест
    const left = addItem(inv, 'potion_small', 13);
    expect(left).toBe(3);
    expect(countItem(inv, 'potion_small')).toBe(10);
    expect(inv.slots.every((s) => s !== null)).toBe(true);
  });

  it('count <= 0 — no-op, возвращает 0', () => {
    const inv = makeInventory();
    expect(addItem(inv, 'dagger', 0)).toBe(0);
    expect(addItem(inv, 'dagger', -5)).toBe(0);
    expect(countItem(inv, 'dagger')).toBe(0);
  });
});

describe('removeItem', () => {
  it('снимает нужное количество, дробит и чистит хвостовые стеки', () => {
    const inv = makeInventory(24);
    addItem(inv, 'potion_small', 8); // [5,3]
    expect(removeItem(inv, 'potion_small', 4)).toBe(true);
    // снимаем с конца: хвостовой стек (3) обнуляется → null, потом из первого -1
    expect(countItem(inv, 'potion_small')).toBe(4);
    expect(inv.slots[1]).toBeNull();
    expect(inv.slots[0]).toEqual({ id: 'potion_small', count: 4 });
  });

  it('недостаточно предмета → false и без изменений', () => {
    const inv = makeInventory(24);
    addItem(inv, 'potion_small', 3);
    expect(removeItem(inv, 'potion_small', 5)).toBe(false);
    expect(countItem(inv, 'potion_small')).toBe(3);
  });

  it('нет предмета вовсе → false', () => {
    expect(removeItem(makeInventory(), 'dagger', 1)).toBe(false);
  });

  it('count <= 0 — true, без изменений', () => {
    const inv = makeInventory();
    addItem(inv, 'dagger', 1);
    expect(removeItem(inv, 'dagger', 0)).toBe(true);
    expect(countItem(inv, 'dagger')).toBe(1);
  });
});

describe('moveSlot', () => {
  it('swap разных предметов', () => {
    const inv = makeInventory(24);
    addItem(inv, 'dagger', 1); // слот 0
    inv.slots[5] = { id: 'sword_1handed', count: 1 };
    moveSlot(inv, 0, 5);
    expect(inv.slots[5]).toEqual({ id: 'dagger', count: 1 });
    expect(inv.slots[0]).toEqual({ id: 'sword_1handed', count: 1 });
  });

  it('перенос в пустой слот', () => {
    const inv = makeInventory(24);
    addItem(inv, 'dagger', 1);
    moveSlot(inv, 0, 10);
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[10]).toEqual({ id: 'dagger', count: 1 });
  });

  it('merge одинаковых стеков с учётом лимита (остаток в from)', () => {
    const inv = makeInventory(24);
    inv.slots[0] = { id: 'potion_small', count: 4 };
    inv.slots[1] = { id: 'potion_small', count: 3 };
    moveSlot(inv, 0, 1); // в to влезет 2 (до 5), в from останется 2
    expect(inv.slots[1]).toEqual({ id: 'potion_small', count: 5 });
    expect(inv.slots[0]).toEqual({ id: 'potion_small', count: 2 });
  });

  it('полный merge опустошает from', () => {
    const inv = makeInventory(24);
    inv.slots[0] = { id: 'potion_small', count: 2 };
    inv.slots[1] = { id: 'potion_small', count: 1 };
    moveSlot(inv, 0, 1);
    expect(inv.slots[1]).toEqual({ id: 'potion_small', count: 3 });
    expect(inv.slots[0]).toBeNull();
  });

  it('краевые: from===to, пустой from, кривые/дробные индексы — no-op', () => {
    const inv = makeInventory(24);
    addItem(inv, 'dagger', 1);
    moveSlot(inv, 0, 0);
    moveSlot(inv, 3, 5); // from пуст
    moveSlot(inv, -1, 0);
    moveSlot(inv, 0, 99);
    moveSlot(inv, 0, 1.5);
    expect(inv.slots[0]).toEqual({ id: 'dagger', count: 1 });
    expect(countItem(inv, 'dagger')).toBe(1);
  });
});

describe('equip / unequip', () => {
  it('экипирует по kind, освобождая слот', () => {
    const inv = makeInventory(24);
    addItem(inv, 'sword_1handed', 1);
    expect(equip(inv, 0)).toBe(true);
    expect(inv.equipment.weapon).toBe('sword_1handed');
    expect(inv.slots[0]).toBeNull();
  });

  it('каждый kind идёт в свою ячейку', () => {
    const inv = makeInventory(24);
    addItem(inv, 'crossbow_2handed', 1);
    addItem(inv, 'armor_leather', 1);
    addItem(inv, 'trinket_wolf', 1);
    expect(equip(inv, 0)).toBe(true);
    expect(equip(inv, 1)).toBe(true);
    expect(equip(inv, 2)).toBe(true);
    expect(inv.equipment).toEqual({
      weapon: null,
      ranged: 'crossbow_2handed',
      armor: 'armor_leather',
      trinket: 'trinket_wolf',
    });
  });

  it('смена оружия: прежнее возвращается в тот же слот', () => {
    const inv = makeInventory(24);
    addItem(inv, 'dagger', 1);
    equip(inv, 0); // dagger надет, слот 0 пуст
    addItem(inv, 'sword_royal', 1); // ляжет в слот 0
    expect(equip(inv, 0)).toBe(true);
    expect(inv.equipment.weapon).toBe('sword_royal');
    expect(inv.slots[0]).toEqual({ id: 'dagger', count: 1 }); // прежний вернулся
  });

  it('зелья и хлам не экипируются → false', () => {
    const inv = makeInventory(24);
    addItem(inv, 'potion_small', 1);
    addItem(inv, 'caravan_bell', 1);
    expect(equip(inv, 0)).toBe(false);
    expect(equip(inv, 1)).toBe(false);
    expect(inv.equipment.weapon).toBeNull();
  });

  it('краевые equip: пустой слот, кривой индекс, неизвестный id → false', () => {
    const inv = makeInventory(24);
    expect(equip(inv, 0)).toBe(false); // пусто
    expect(equip(inv, -1)).toBe(false);
    expect(equip(inv, 99)).toBe(false);
    inv.slots[0] = { id: 'no_such_item', count: 1 };
    expect(equip(inv, 0)).toBe(false);
  });

  it('unequip кладёт в свободный слот', () => {
    const inv = makeInventory(24);
    addItem(inv, 'armor_royal', 1);
    equip(inv, 0);
    expect(unequip(inv, 'armor')).toBe(true);
    expect(inv.equipment.armor).toBeNull();
    expect(countItem(inv, 'armor_royal')).toBe(1);
  });

  it('unequip без места → false, остаётся надетым', () => {
    const inv = makeInventory(1);
    addItem(inv, 'armor_royal', 1);
    equip(inv, 0); // слот 0 освободился
    addItem(inv, 'caravan_bell', 1); // единственный слот занят
    expect(unequip(inv, 'armor')).toBe(false);
    expect(inv.equipment.armor).toBe('armor_royal');
  });

  it('unequip пустой ячейки → false', () => {
    expect(unequip(makeInventory(), 'weapon')).toBe(false);
  });

  it('цикл equip→unequip→equip сохраняет инвариант', () => {
    const inv = makeInventory(24);
    addItem(inv, 'sword_2handed', 1);
    for (let i = 0; i < 3; i++) {
      const slot = inv.slots.findIndex((s) => s?.id === 'sword_2handed');
      expect(equip(inv, slot)).toBe(true);
      expect(unequip(inv, 'weapon')).toBe(true);
    }
    expect(countItem(inv, 'sword_2handed')).toBe(1);
    expect(inv.equipment.weapon).toBeNull();
  });
});

describe('totalStatMods', () => {
  it('пустая экипировка — нейтральные модификаторы', () => {
    expect(totalStatMods(makeInventory())).toEqual({ damageMul: 1, defense: 0, speedMul: 1 });
  });

  it('агрегация: defense суммируется, speedMul/damageMul перемножаются', () => {
    const inv = makeInventory(24);
    // латы эльфа (def 7, speed 0.93) + амулет волка (dmg 1.1) + оберег дуба (def 2)…
    // но trinket — одна ячейка, поэтому берём волка; защиту даёт броня.
    addItem(inv, 'armor_royal', 1);
    addItem(inv, 'trinket_wolf', 1);
    equip(inv, 0);
    equip(inv, 1);
    const m = totalStatMods(inv);
    expect(m.defense).toBe(7);
    expect(m.damageMul).toBeCloseTo(1.1, 6);
    expect(m.speedMul).toBeCloseTo(0.93, 6);
  });

  it('перемножение speedMul от нескольких источников', () => {
    const inv = makeInventory(24);
    addItem(inv, 'armor_chain', 1); // speedMul 0.97
    addItem(inv, 'trinket_falcon', 1); // speedMul 1.07
    equip(inv, 0);
    equip(inv, 1);
    expect(totalStatMods(inv).speedMul).toBeCloseTo(0.97 * 1.07, 6);
  });
});

describe('ITEMS реестр', () => {
  it('каждый weaponId-предмет имеет kind weapon|ranged', () => {
    for (const def of Object.values(ITEMS)) {
      if (def.weaponId) {
        expect(['weapon', 'ranged'], `${def.id}`).toContain(def.kind);
      }
    }
  });

  it('stack >= 1 и price > 0 у всех предметов', () => {
    for (const def of Object.values(ITEMS)) {
      expect(def.stack, `${def.id}: stack`).toBeGreaterThanOrEqual(1);
      expect(def.price, `${def.id}: price`).toBeGreaterThan(0);
    }
  });
});
