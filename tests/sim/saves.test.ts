import { describe, expect, it } from 'vitest';
import {
  deserialize,
  makeNewSave,
  migrate,
  SAVE_VERSION,
  serialize,
  validateSave,
  type SaveData,
} from '../../src/sim/saves';
import { makeInventory } from '../../src/sim/inventory';
import { makePerkState } from '../../src/sim/progression';
import { ARROWS_MAX, ARROWS_START } from '../../src/sim/ammo';

/** Заполненный валидный сейв v2 — отправная точка для round-trip/мутаций в тестах. */
function sampleSave(): SaveData {
  const s = makeNewSave(1234);
  s.coins = 320;
  s.xp = 540;
  s.heat = 3.75;
  s.player = { x: 12.5, z: -8.25, hp: 73 };
  s.houses = [{ hp: 100 }, { hp: 40 }, { hp: 0 }];
  s.raidDifficulty = 3;
  s.inventory.slots[0] = { id: 'potion_small', count: 5 };
  s.inventory.slots[3] = { id: 'coins', count: 99 };
  s.inventory.equipment.weapon = 'dagger';
  s.inventory.equipment.armor = 'armor_leather';
  s.perks.unlocked = ['marksman1', 'warrior1'];
  s.perks.points = 2;
  s.openedChests = ['chest_waterfall', 'chest_tower'];
  s.tgRewarded = true;
  s.playedSec = 612.5;
  s.hiredGuards = [{ slot: 0, hp: 90 }, { slot: 1, hp: 45 }];
  return s;
}

describe('makeNewSave', () => {
  it('дефолты нового забега: пустые кошелёк/инвентарь/перки/сундуки, hp 100', () => {
    const s = makeNewSave(42);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.seed).toBe(42);
    expect(s.coins).toBe(0);
    expect(s.xp).toBe(0);
    expect(s.heat).toBe(0);
    expect(s.player.hp).toBe(100);
    expect(s.houses).toEqual([]);
    expect(s.openedChests).toEqual([]);
    expect(s.tgRewarded).toBe(false);
    expect(s.playedSec).toBe(0);
    expect(s.perks).toEqual(makePerkState());
    expect(s.inventory).toEqual(makeInventory());
  });

  it('сам по себе валиден', () => {
    expect(validateSave(makeNewSave(7))).toBe(true);
  });
});

describe('serialize/deserialize round-trip', () => {
  it('заполненный сейв переживает сериализацию без потерь', () => {
    const s = sampleSave();
    const back = deserialize(serialize(s));
    expect(back).not.toBeNull();
    expect(back).toEqual(s);
  });

  it('новый сейв тоже переживает round-trip', () => {
    const s = makeNewSave(99);
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('JSON — чистый снимок (нет undefined/функций/классов)', () => {
    const raw = serialize(sampleSave());
    const obj = JSON.parse(raw);
    // Повторная сериализация даёт тот же текст — значит нет несериализуемых полей
    expect(JSON.stringify(obj)).toBe(raw);
  });
});

describe('round-trip позиции игрока (баг №5: «Продолжить кидает на старт»)', () => {
  /**
   * Сим-уровень пути SaveSystem: сохранили позицию (как collectSave —
   * округление до 2 знаков), сериализовали в localStorage, прочитали обратно
   * (как readSave) — applySave телепортнёт в ту же точку. Здесь проверяем, что
   * именно x/z доезжают без потерь, а не сбрасываются в (0,0)/SPAWN.
   */
  it('сохранённая позиция (150, -250) восстанавливается из строки сейва', () => {
    const s = makeNewSave(42);
    // collectSave кладёт +feet.x.toFixed(2) — повторяем округление.
    s.player = { x: +(150).toFixed(2), z: +(-250).toFixed(2), hp: 88 };

    const restored = deserialize(serialize(s));
    expect(restored).not.toBeNull();
    expect(restored!.player.x).toBe(150);
    expect(restored!.player.z).toBe(-250);
    expect(restored!.player.hp).toBe(88);
  });

  it('дробная позиция переживает round-trip с точностью округления collectSave', () => {
    const s = makeNewSave(7);
    const x = +(12.345678).toFixed(2); // 12.35
    const z = +(-8.911111).toFixed(2); // -8.91
    s.player = { x, z, hp: 100 };
    const restored = deserialize(serialize(s));
    expect(restored!.player.x).toBe(12.35);
    expect(restored!.player.z).toBe(-8.91);
  });
});

describe('migrate v1 → v2', () => {
  it('добавляет пустой инвентарь/перки/сундуки и поднимает версию', () => {
    // v1 — формат Фазы 5 БЕЗ inventory/perks/openedChests/tgRewarded/playedSec
    const v1 = {
      version: 1,
      seed: 555,
      coins: 80,
      xp: 120,
      heat: 2.5,
      player: { x: 5, z: 6, hp: 64 },
      houses: [{ hp: 100 }, { hp: 70 }],
      raidDifficulty: 2,
    };
    const migrated = migrate(v1);
    expect(migrated).not.toBeNull();
    const m = migrated as SaveData;
    expect(m.version).toBe(SAVE_VERSION);
    // Перенесённые поля сохранены
    expect(m.coins).toBe(80);
    expect(m.xp).toBe(120);
    expect(m.heat).toBe(2.5);
    expect(m.player).toEqual({ x: 5, z: 6, hp: 64 });
    expect(m.houses).toEqual([{ hp: 100 }, { hp: 70 }]);
    expect(m.raidDifficulty).toBe(2);
    // Долитые v2-поля — пустые дефолты
    expect(m.inventory).toEqual(makeInventory());
    expect(m.perks).toEqual(makePerkState());
    expect(m.openedChests).toEqual([]);
    expect(m.tgRewarded).toBe(false);
    expect(m.playedSec).toBe(0);
    // Результат миграции валиден
    expect(validateSave(m)).toBe(true);
  });

  it('deserialize строки v1 тоже мигрирует', () => {
    const v1raw = JSON.stringify({
      version: 1,
      seed: 1,
      coins: 0,
      xp: 0,
      heat: 0,
      player: { x: 0, z: 0, hp: 100 },
      houses: [],
      raidDifficulty: 1,
    });
    const m = deserialize(v1raw);
    expect(m).not.toBeNull();
    expect(m!.version).toBe(SAVE_VERSION);
    expect(m!.inventory).toEqual(makeInventory());
  });

  it('v1 получает стартовый боезапас стрел', () => {
    const v1 = {
      version: 1,
      seed: 1,
      coins: 0,
      xp: 0,
      heat: 0,
      player: { x: 0, z: 0, hp: 100 },
      houses: [],
      raidDifficulty: 1,
    };
    const m = migrate(v1) as SaveData;
    expect(m.arrows).toBe(ARROWS_START);
  });
});

describe('migrate v2 → v3 (боезапас стрел)', () => {
  it('сейв v2 БЕЗ поля arrows получает ARROWS_START, остальное не теряется', () => {
    // v2 — полноценный сейв Фазы 6A, но без боезапаса (поле появилось в v3).
    const v2: Record<string, unknown> = { ...sampleSave(), version: 2 };
    delete v2.arrows;
    const m = migrate(v2) as SaveData;
    expect(m).not.toBeNull();
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.arrows).toBe(ARROWS_START);
    // Прежние данные на месте.
    expect(m.coins).toBe(320);
    expect(m.inventory.equipment.weapon).toBe('dagger');
    expect(m.openedChests).toEqual(['chest_waterfall', 'chest_tower']);
    expect(validateSave(m)).toBe(true);
  });

  it('deserialize строки v2 без arrows тоже мигрирует (старый сейв не пропадает)', () => {
    const v2obj: Record<string, unknown> = { ...sampleSave(), version: 2 };
    delete v2obj.arrows;
    const m = deserialize(JSON.stringify(v2obj));
    expect(m).not.toBeNull();
    expect(m!.arrows).toBe(ARROWS_START);
  });

  it('v3 сохраняет свой боезапас, клампит мусор', () => {
    const ok = { ...sampleSave(), arrows: 42 };
    expect(migrate(ok)!.arrows).toBe(42);
    // выше потолка → ARROWS_MAX
    expect(migrate({ ...sampleSave(), arrows: 500 })!.arrows).toBe(ARROWS_MAX);
    // NaN/отрицательное → 0
    expect(migrate({ ...sampleSave(), arrows: NaN })!.arrows).toBe(0);
    expect(migrate({ ...sampleSave(), arrows: -10 })!.arrows).toBe(0);
  });
});

describe('migrate v3 → v4 (квесты жителей)', () => {
  it('сейв v3 БЕЗ поля quests получает пустое «не начато», остальное не теряется', () => {
    const v3: Record<string, unknown> = { ...sampleSave(), version: 3 };
    delete v3.quests;
    const m = migrate(v3) as SaveData;
    expect(m).not.toBeNull();
    expect(m.version).toBe(SAVE_VERSION);
    // Квесты дозалиты пустым состоянием.
    expect(m.quests.activeIds).toEqual([]);
    expect(m.quests.entries.mirne_cull!.status).toBe('idle');
    // Прежние данные на месте.
    expect(m.coins).toBe(320);
    expect(m.arrows).toBe(ARROWS_START);
    expect(validateSave(m)).toBe(true);
  });

  it('deserialize строки v3 без quests мигрирует и проходит валидацию', () => {
    const v3obj: Record<string, unknown> = { ...sampleSave(), version: 3 };
    delete v3obj.quests;
    const m = deserialize(JSON.stringify(v3obj));
    expect(m).not.toBeNull();
    expect(m!.quests.activeIds).toEqual([]);
    expect(validateSave(m!)).toBe(true);
  });

  it('v4 сохраняет несколько активных квестов и прогресс через round-trip', () => {
    const s = sampleSave();
    s.quests.entries.lesli_wolves = { status: 'active', progress: 2, cooldown: 0 };
    s.quests.entries.mirne_cull = { status: 'active', progress: 1, cooldown: 0 };
    s.quests.activeIds = ['lesli_wolves', 'mirne_cull'];
    const m = deserialize(serialize(s));
    expect(m).not.toBeNull();
    expect(m!.quests.activeIds).toEqual(['lesli_wolves', 'mirne_cull']);
    expect(m!.quests.entries.lesli_wolves!.progress).toBe(2);
    expect(m!.quests.entries.lesli_wolves!.status).toBe('active');
    expect(m!.quests.entries.mirne_cull!.status).toBe('active');
  });

  it('МИГРАЦИЯ: ранний v4 со старым activeId (один квест) поднимается в activeIds', () => {
    const s = sampleSave();
    s.quests.entries.lesli_wolves = { status: 'active', progress: 2, cooldown: 0 };
    // Эмулируем ранний v4-сейв: поле activeId (строка) вместо activeIds.
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    const q = raw.quests as Record<string, unknown>;
    delete q.activeIds;
    q.activeId = 'lesli_wolves';
    const m = deserialize(JSON.stringify(raw));
    expect(m).not.toBeNull();
    expect(m!.quests.activeIds).toEqual(['lesli_wolves']);
    expect(m!.quests.entries.lesli_wolves!.status).toBe('active');
    expect(validateSave(m!)).toBe(true);
  });

  it('битое поле quests чинится коэрсом, а не роняет сейв', () => {
    const m = migrate({ ...sampleSave(), quests: { entries: 'oops', activeIds: 5 } as unknown });
    expect(m).not.toBeNull();
    expect(m!.quests.activeIds).toEqual([]);
    expect(validateSave(m!)).toBe(true);
  });

  it('собранные fortKeys квестов переживают round-trip', () => {
    const s = sampleSave();
    s.quests.fortKeys = ['hermit_ward'];
    const m = deserialize(serialize(s));
    expect(m).not.toBeNull();
    expect(m!.quests.fortKeys).toEqual(['hermit_ward']);
    expect(validateSave(m!)).toBe(true);
  });
});

describe('скрытый контент: necklaceFound (v4)', () => {
  it('новый сейв — ожерелье не найдено', () => {
    expect(makeNewSave(1).necklaceFound).toBe(false);
  });

  it('сейв без necklaceFound получает false (старые v2/v3/v4 без поля)', () => {
    const v3: Record<string, unknown> = { ...sampleSave(), version: 3 };
    delete v3.necklaceFound;
    const m = migrate(v3) as SaveData;
    expect(m.necklaceFound).toBe(false);
    expect(validateSave(m)).toBe(true);
  });

  it('necklaceFound=true переживает round-trip', () => {
    const s = makeNewSave(5);
    s.necklaceFound = true;
    const m = deserialize(serialize(s));
    expect(m).not.toBeNull();
    expect(m!.necklaceFound).toBe(true);
    expect(validateSave(m!)).toBe(true);
  });

  it('не-булевый necklaceFound коэрсится в false, а не роняет сейв', () => {
    const m = migrate({ ...sampleSave(), necklaceFound: 'yes' as unknown });
    expect(m).not.toBeNull();
    expect(m!.necklaceFound).toBe(false);
    expect(validateSave(m!)).toBe(true);
  });
});

describe('наёмные стражники: hiredGuards (Фаза 6B)', () => {
  it('новый сейв — никого не нанято', () => {
    expect(makeNewSave(1).hiredGuards).toEqual([]);
  });

  it('нанятые стражники (слот+HP) переживают round-trip без потерь', () => {
    const s = makeNewSave(7);
    s.hiredGuards = [{ slot: 0, hp: 90 }, { slot: 1, hp: 33 }];
    const m = deserialize(serialize(s));
    expect(m).not.toBeNull();
    expect(m!.hiredGuards).toEqual([{ slot: 0, hp: 90 }, { slot: 1, hp: 33 }]);
    expect(validateSave(m!)).toBe(true);
  });

  it('сейв без поля hiredGuards (старые v2/v3/v4) получает пустой список', () => {
    const v3: Record<string, unknown> = { ...sampleSave(), version: 3 };
    delete v3.hiredGuards;
    const m = migrate(v3) as SaveData;
    expect(m.hiredGuards).toEqual([]);
    expect(validateSave(m)).toBe(true);
  });

  it('битые записи стражников отбрасываются коэрсом, а не роняют сейв', () => {
    // Мёртвый (hp<=0), чужой слот (>=MAX), дубль слота, не-объект — всё мимо.
    const m = migrate({
      ...sampleSave(),
      hiredGuards: [
        { slot: 0, hp: 50 },
        { slot: 0, hp: 70 }, // дубль слота 0 — отбрасывается
        { slot: 9, hp: 40 }, // слот вне диапазона
        { slot: 1, hp: 0 }, // павший — не сохраняется
        'oops',
      ] as unknown,
    });
    expect(m).not.toBeNull();
    expect(m!.hiredGuards).toEqual([{ slot: 0, hp: 50 }]);
    expect(validateSave(m!)).toBe(true);
  });
});

describe('мусор → null', () => {
  it('невалидный JSON', () => {
    expect(deserialize('не json {{{')).toBeNull();
    expect(deserialize('')).toBeNull();
  });

  it('JSON не-объект (число/массив/строка/null)', () => {
    expect(deserialize('42')).toBeNull();
    expect(deserialize('[1,2,3]')).toBeNull();
    expect(deserialize('"hello"')).toBeNull();
    expect(deserialize('null')).toBeNull();
  });

  it('нет поля version или версия не число', () => {
    expect(migrate({ seed: 1 })).toBeNull();
    expect(migrate({ version: '2', seed: 1 })).toBeNull();
  });

  it('будущая/неизвестная версия — null (читать не умеем)', () => {
    const future = { ...sampleSave(), version: 999 };
    expect(migrate(future)).toBeNull();
  });

  it('структурно битый v2: нет player / houses не массив / инвентарь не той формы', () => {
    expect(migrate({ version: 2, seed: 1 })).toBeNull(); // нет player/houses
    const noHouses = { ...sampleSave(), houses: 'oops' as unknown };
    expect(migrate(noHouses)).toBeNull();
    const badInv = { ...sampleSave(), inventory: { slots: 'no', equipment: {} } as unknown };
    expect(migrate(badInv)).toBeNull();
    const badPerks = { ...sampleSave(), perks: { unlocked: 'no', points: 0 } as unknown };
    expect(migrate(badPerks)).toBeNull();
  });
});

describe('validateSave — структурная проверка значений', () => {
  it('hp вне 0..100 не проходит', () => {
    const lo = sampleSave();
    lo.player.hp = -5;
    expect(validateSave(lo)).toBe(false);
    const hi = sampleSave();
    hi.player.hp = 150;
    expect(validateSave(hi)).toBe(false);
  });

  it('отрицательные coins/xp/heat/playedSec не проходят', () => {
    for (const key of ['coins', 'xp', 'heat', 'playedSec'] as const) {
      const s = sampleSave();
      (s as unknown as Record<string, unknown>)[key] = -1;
      expect(validateSave(s)).toBe(false);
    }
  });

  it('NaN/Infinity в числовых полях не проходят', () => {
    const nan = sampleSave();
    nan.coins = NaN;
    expect(validateSave(nan)).toBe(false);
    const inf = sampleSave();
    inf.player.x = Infinity;
    expect(validateSave(inf)).toBe(false);
  });

  it('неизвестный perk-id не проходит', () => {
    const s = sampleSave();
    (s.perks.unlocked as string[]).push('totally_fake_perk');
    expect(validateSave(s)).toBe(false);
  });
});

describe('migrate — клампы битых значений (а не отказ)', () => {
  it('NaN/отрицательные числа подтягиваются в пределы при коэрсе v2', () => {
    const dirty = {
      ...sampleSave(),
      coins: -100, // → 0
      heat: NaN, // → 0
      player: { x: 1, z: 2, hp: 999 }, // hp → 100
      playedSec: -5, // → 0
    };
    const m = migrate(dirty);
    expect(m).not.toBeNull();
    expect(m!.coins).toBe(0);
    expect(m!.heat).toBe(0);
    expect(m!.player.hp).toBe(100);
    expect(m!.playedSec).toBe(0);
    expect(validateSave(m!)).toBe(true);
  });

  it('hp клампится снизу к 0', () => {
    const dirty = { ...sampleSave(), player: { x: 0, z: 0, hp: -50 } };
    const m = migrate(dirty);
    expect(m!.player.hp).toBe(0);
  });

  it('слот с count<=0 или без id отбрасывается в null', () => {
    const s = sampleSave();
    s.inventory.slots[1] = { id: 'potion_big', count: 0 }; // count 0 → null
    const m = migrate(s);
    expect(m!.inventory.slots[1]).toBeNull();
    // валидный слот уцелел
    expect(m!.inventory.slots[0]).toEqual({ id: 'potion_small', count: 5 });
  });

  it('неизвестные perk-id и не-строки в openedChests отсеиваются при коэрсе', () => {
    const s = sampleSave();
    (s.perks.unlocked as string[]).push('fake_perk');
    (s.openedChests as unknown[]).push(123);
    const m = migrate(s);
    expect(m!.perks.unlocked).toEqual(['marksman1', 'warrior1']);
    expect(m!.openedChests).toEqual(['chest_waterfall', 'chest_tower']);
    expect(validateSave(m!)).toBe(true);
  });
});
