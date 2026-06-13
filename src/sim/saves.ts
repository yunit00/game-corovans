// Сейв — plain-JSON снимок забега в localStorage.
// Чистая sim-логика: только числа/строки/plain-объекты, БЕЗ Three/Rapier и
// без классов — снапшот собирает Game из своих систем (coins/xp/heat/игрок/дома/
// инвентарь/перки/сундуки), а при загрузке раскладывает обратно. Тестируется в node.
//
// Версионирование с миграцией: формат меняется между фазами, а сохранёнки игроков
// должны переживать обновление. v1 — гипотетический формат БЕЗ инвентаря/перков/
// сундуков; v2 добавил их; v3 добавил боезапас стрел; v4
// добавил состояние сайд-квестов жителей.
// deserialize молча мигрирует v1/v2/v3 → v4, мусор → null.

import { ARROWS_MAX, ARROWS_START, clampArrows } from './ammo';
import { coerceHiredGuards, type HiredGuardSave } from './hiredGuard';
import { makeInventory, type Inventory, type ItemStack } from './inventory';
import { makePerkState, type PerkState, type PerkId, PERKS } from './progression';
import { coerceQuestState, isValidQuestState, makeQuestState, type QuestState } from './quests';

/** Текущая версия формата. Растёт при несовместимом изменении SaveData. */
export const SAVE_VERSION = 4;

/** Границы клампа игрока (см. PlayerCharacter.maxHp = 100 в бою). */
const HP_MIN = 0;
const HP_MAX = 100;

export interface SaveData {
  version: number;
  /** Seed мира — чтобы перезагрузка восстановила ту же деревню/форт/полянки. */
  seed: number;
  coins: number;
  xp: number;
  /** Жар дворца (heat.value), 0..HEAT_MAX. */
  heat: number;
  player: { x: number; z: number; hp: number };
  /** HP домов деревни в порядке Village.houses (индекс = дом). */
  houses: { hp: number }[];
  /** Текущая сложность волн RaidDirector. */
  raidDifficulty: number;
  inventory: Inventory;
  perks: PerkState;
  /** id уже открытых спрятанных сундуков — чтобы не выдавать лут повторно. */
  openedChests: string[];
  /** Забрана ли одноразовая награда таблички «Точки над AI». */
  tgRewarded: boolean;
  /** Наигранное время забега, с — для статистики/автосейва. */
  playedSec: number;
  /** Боезапас стрел арбалета, 0..ARROWS_MAX. Старые сейвы → ARROWS_START. */
  arrows: number;
  /** Состояние сайд-квестов жителей (v4). Старые сейвы → всё «не начато». */
  quests: QuestState;
  /** Подобран ли скрытый предмет в лесу (один раз за забег). Старые сейвы → false. */
  necklaceFound: boolean;
  /** Нанятые стражники деревни: слот патруля + HP. Старые сейвы → []. */
  hiredGuards: HiredGuardSave[];
}

/** Дефолты нового забега: пустой кошелёк/инвентарь/перки, целые дома будут долиты Game. */
export function makeNewSave(seed: number): SaveData {
  return {
    version: SAVE_VERSION,
    seed,
    coins: 0,
    xp: 0,
    heat: 0,
    player: { x: 0, z: 0, hp: HP_MAX },
    houses: [],
    raidDifficulty: 1,
    inventory: makeInventory(),
    perks: makePerkState(),
    openedChests: [],
    tgRewarded: false,
    playedSec: 0,
    arrows: ARROWS_START,
    quests: makeQuestState(),
    necklaceFound: false,
    hiredGuards: [],
  };
}

export function serialize(d: SaveData): string {
  return JSON.stringify(d);
}

/**
 * Разбор сырой строки в валидный SaveData или null.
 * Сценарии null: невалидный JSON, не объект, неизвестная/будущая версия,
 * структурно битый снимок. v1/v2 молча мигрируются в v3 (migrate).
 */
export function deserialize(raw: string): SaveData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return migrate(parsed);
}

/**
 * Привести произвольный (возможно старый) объект к актуальному SaveData.
 * Возвращает null, если формат не распознан или несовместим. Понимает v1/v2/v3 → v4.
 * Здесь же чинятся клампы (hp/coins/xp/heat/raidDifficulty), чтобы дальше по коду
 * сейв был заведомо в пределах — validate потом лишь подтверждает форму.
 */
export function migrate(data: unknown): SaveData | null {
  if (!isPlainObject(data)) return null;
  const version = data.version;
  if (typeof version !== 'number') return null;

  // v1 — формат Фазы 5 без инвентаря/перков/сундуков. Доливаем пустые поля,
  // боезапас стрел — стартовым значением (поле появилось в v3), квесты — пустыми (v4).
  if (version === 1) {
    const base = readCommonV1(data);
    if (!base) return null;
    const upgraded: SaveData = {
      ...base,
      version: SAVE_VERSION,
      inventory: makeInventory(),
      perks: makePerkState(),
      openedChests: [],
      tgRewarded: false,
      playedSec: 0,
      arrows: ARROWS_START,
      quests: makeQuestState(),
      necklaceFound: false,
      hiredGuards: [],
    };
    return validateSave(upgraded) ? upgraded : null;
  }

  // v2/v3/v4 имеют общую структуру и различаются лишь добавленными полями:
  // arrows появилось в v3 (у v2 его нет → ARROWS_START), quests — в v4 (у v2/v3
  // нет → пустое состояние). coerceCurrent доливает недостающее, сейв не теряется.
  if (version === 2 || version === 3 || version === SAVE_VERSION) {
    const fixed = coerceCurrent(data);
    return fixed && validateSave(fixed) ? fixed : null;
  }

  // Будущая версия (или мусорный номер) — читать не умеем, безопаснее начать заново.
  return null;
}

/**
 * Структурная проверка готового снимка БЕЗ классов: форма верна И значения в
 * пределах (hp 0..100, coins/xp/heat/raidDifficulty/playedSec >= 0, дома/слоты
 * корректны). Используется как type guard после миграции/коэрса.
 */
export function validateSave(d: unknown): d is SaveData {
  if (!isPlainObject(d)) return false;
  if (d.version !== SAVE_VERSION) return false;
  if (!isFiniteNum(d.seed)) return false;
  if (!isNonNegNum(d.coins)) return false;
  if (!isNonNegNum(d.xp)) return false;
  if (!isNonNegNum(d.heat)) return false;
  if (!isNonNegNum(d.raidDifficulty)) return false;
  if (!isNonNegNum(d.playedSec)) return false;
  if (typeof d.tgRewarded !== 'boolean') return false;
  if (typeof d.necklaceFound !== 'boolean') return false;
  if (!isInRange(d.arrows, 0, ARROWS_MAX)) return false;

  const p = d.player;
  if (!isPlainObject(p)) return false;
  if (!isFiniteNum(p.x) || !isFiniteNum(p.z)) return false;
  if (!isInRange(p.hp, HP_MIN, HP_MAX)) return false;

  if (!Array.isArray(d.houses)) return false;
  for (const h of d.houses) {
    if (!isPlainObject(h) || !isNonNegNum(h.hp)) return false;
  }

  if (!Array.isArray(d.openedChests)) return false;
  for (const id of d.openedChests) if (typeof id !== 'string') return false;

  if (!isValidInventory(d.inventory)) return false;
  if (!isValidPerks(d.perks)) return false;
  if (!isValidQuestState(d.quests)) return false;
  if (!Array.isArray(d.hiredGuards)) return false;

  return true;
}

// ---- внутреннее ----

/** Узкое «это plain-объект» (не null, не массив). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Конечное число (отсекает NaN/Infinity). */
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Конечное число >= 0. */
function isNonNegNum(v: unknown): v is number {
  return isFiniteNum(v) && v >= 0;
}

/** Конечное число в [lo, hi]. */
function isInRange(v: unknown, lo: number, hi: number): v is number {
  return isFiniteNum(v) && v >= lo && v <= hi;
}

/** Клампнуть число в [lo, hi]; не-число/NaN → fallback (по умолчанию lo). */
function clampNum(v: unknown, lo: number, hi: number, fallback = lo): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/** Поля, общие для v1 и v2 — читаются и клампятся из произвольного объекта. */
function readCommonV1(data: Record<string, unknown>): Omit<
  SaveData,
  'version' | 'inventory' | 'perks' | 'openedChests' | 'tgRewarded' | 'playedSec' | 'arrows' | 'quests' | 'necklaceFound' | 'hiredGuards'
> | null {
  const p = data.player;
  if (!isPlainObject(p)) return null;
  if (!Array.isArray(data.houses)) return null;

  const houses: { hp: number }[] = [];
  for (const h of data.houses) {
    if (!isPlainObject(h)) return null;
    houses.push({ hp: clampNum(h.hp, 0, Number.MAX_SAFE_INTEGER) });
  }

  return {
    seed: clampNum(data.seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
    coins: clampNum(data.coins, 0, Number.MAX_SAFE_INTEGER),
    xp: clampNum(data.xp, 0, Number.MAX_SAFE_INTEGER),
    heat: clampNum(data.heat, 0, Number.MAX_SAFE_INTEGER),
    player: {
      x: clampNum(p.x, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
      z: clampNum(p.z, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
      hp: clampNum(p.hp, HP_MIN, HP_MAX, HP_MAX),
    },
    houses,
    raidDifficulty: clampNum(data.raidDifficulty, 0, Number.MAX_SAFE_INTEGER, 1),
  };
}

/**
 * Привести объект-кандидат v2/v3 к чистому SaveData с клампами. Возвращает null,
 * если структурно невосстановимо (нет player/houses/инвентаря/перков нужной формы).
 * NaN/отрицательные числа подтягиваются в допустимые пределы, а не роняют сейв.
 * Поле arrows появилось в v3: у v2-сейва его нет (undefined) → ARROWS_START.
 */
function coerceCurrent(data: Record<string, unknown>): SaveData | null {
  const base = readCommonV1(data);
  if (!base) return null;

  const inventory = coerceInventory(data.inventory);
  if (!inventory) return null;
  const perks = coercePerks(data.perks);
  if (!perks) return null;

  const openedChests: string[] = [];
  if (Array.isArray(data.openedChests)) {
    for (const id of data.openedChests) if (typeof id === 'string') openedChests.push(id);
  }

  return {
    ...base,
    version: SAVE_VERSION,
    inventory,
    perks,
    openedChests,
    tgRewarded: data.tgRewarded === true,
    playedSec: clampNum(data.playedSec, 0, Number.MAX_SAFE_INTEGER),
    // arrows отсутствует у v2 — clampArrows(undefined)=0, поэтому явный дефолт.
    arrows: data.arrows === undefined ? ARROWS_START : clampArrows(data.arrows as number),
    // quests отсутствует у v2/v3 — coerceQuestState(undefined) даёт пустое «не начато».
    quests: coerceQuestState(data.quests),
    // necklaceFound отсутствует у v2/v3/раннего v4 — старый сейв → false.
    necklaceFound: data.necklaceFound === true,
    // hiredGuards отсутствует у v2/v3/раннего v4 — старый сейв → [] (никого не нанято).
    hiredGuards: coerceHiredGuards(data.hiredGuards),
  };
}

/** Проверка формы инвентаря (без обращения к классам): слоты + 4 ключа экипировки. */
function isValidInventory(v: unknown): v is Inventory {
  if (!isPlainObject(v)) return false;
  if (!Array.isArray(v.slots)) return false;
  for (const s of v.slots) {
    if (s === null) continue;
    if (!isPlainObject(s)) return false;
    if (typeof s.id !== 'string') return false;
    if (!isNonNegNum(s.count)) return false;
  }
  const eq = v.equipment;
  if (!isPlainObject(eq)) return false;
  for (const k of ['weapon', 'ranged', 'armor', 'trinket'] as const) {
    const slot = eq[k];
    if (slot !== null && typeof slot !== 'string') return false;
  }
  return true;
}

/** Восстановить инвентарь из кандидата, отбросив битые слоты; null — форма не та. */
function coerceInventory(v: unknown): Inventory | null {
  if (!isPlainObject(v) || !Array.isArray(v.slots) || !isPlainObject(v.equipment)) return null;
  const eq = v.equipment;
  const slots: (ItemStack | null)[] = v.slots.map((s) => {
    if (!isPlainObject(s) || typeof s.id !== 'string') return null;
    const count = clampNum(s.count, 0, Number.MAX_SAFE_INTEGER, 0);
    return count > 0 ? { id: s.id, count } : null;
  });
  const equip = (k: string): string | null => (typeof eq[k] === 'string' ? (eq[k] as string) : null);
  return {
    slots,
    equipment: {
      weapon: equip('weapon'),
      ranged: equip('ranged'),
      armor: equip('armor'),
      trinket: equip('trinket'),
    },
  };
}

/** Проверка формы перков: массив id + неотрицательные очки. */
function isValidPerks(v: unknown): v is PerkState {
  if (!isPlainObject(v)) return false;
  if (!Array.isArray(v.unlocked)) return false;
  for (const id of v.unlocked) {
    if (typeof id !== 'string' || !(id in PERKS)) return false;
  }
  if (!isNonNegNum(v.points)) return false;
  return true;
}

/** Восстановить перки, отбросив неизвестные id; null — форма не та. */
function coercePerks(v: unknown): PerkState | null {
  if (!isPlainObject(v) || !Array.isArray(v.unlocked)) return null;
  const unlocked: PerkId[] = [];
  for (const id of v.unlocked) {
    if (typeof id === 'string' && id in PERKS && !unlocked.includes(id as PerkId)) {
      unlocked.push(id as PerkId);
    }
  }
  return { unlocked, points: clampNum(v.points, 0, Number.MAX_SAFE_INTEGER, 0) };
}
