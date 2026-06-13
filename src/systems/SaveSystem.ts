// Сейв-система (Фаза 6): мост между Game и чистым контрактом sim/saves.ts.
// Собирает SaveData из живых систем Game, кладёт в localStorage; читает обратно
// и применяет к Game (телепорт/coins/xp/inventory/perks/heat/difficulty/дома/
// сундуки/награда таблички). Сам Game о localStorage не знает — только зовёт
// saveNow()/load()/wipe().
//
// Порядок при загрузке тонкий: seed из сейва должен попасть в мир ДО build
// (см. main.ts — сейв читается там и прокидывается в game.seed). Здесь
// applySave раскладывает остальное уже ПОСЛЕ init, когда системы существуют.
import { deserialize, makeNewSave, serialize, type SaveData } from '../sim/saves';
import type { Game } from '../core/Game';

/** Ключ хранилища забега. */
export const SAVE_KEY = 'korovany_save';

/**
 * Прочитать сырой сейв из localStorage в валидный SaveData (или null).
 * warn=true — залогировать предупреждение о битом сейве (только на ЯВНОЙ загрузке
 * в main/init, а не на каждом poll debugState через hasSave).
 */
export function readSave(warn = false): SaveData | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return null; // приватный режим/квота — играем без сейва
  }
  if (!raw) return null;
  const data = deserialize(raw);
  // Битый/несовместимый сейв: предупреждаем и стартуем новую игру (контракт задачи).
  if (!data && warn) console.warn('[save] битый или несовместимый сейв — новая игра');
  return data;
}

/** Есть ли валидный сейв (для активации «Продолжить» в меню). Тихо (без warn). */
export function hasSave(): boolean {
  return readSave(false) !== null;
}

/** Стереть сейв («Новая игра»). */
export function wipeSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* приватный режим — игнор */
  }
}

/** Собрать SaveData-снимок из текущего состояния Game. */
export function collectSave(game: Game): SaveData {
  const data = makeNewSave(game.seed);
  const feet = game.player.position;
  data.coins = game.coins;
  data.xp = game.xp;
  data.heat = game.heat.value;
  // hp клампится в saves.validate (0..100), но игрок может быть «жив на 0» доли
  // кадра до респауна — берём как есть, deserialize при загрузке выправит.
  data.player = { x: +feet.x.toFixed(2), z: +feet.z.toFixed(2), hp: Math.round(game.player.hp) };
  data.houses = game.village.houses.map((h) => ({ hp: Math.round(h.hp) }));
  data.raidDifficulty = game.raidDifficulty;
  data.inventory = game.inventory;
  data.perks = game.perkState;
  data.openedChests = [...game.chests.openedIds];
  data.tgRewarded = game.tgRewarded;
  data.playedSec = Math.round(game.playedSec);
  data.arrows = game.arrows;
  data.quests = game.questState;
  data.necklaceFound = game.necklaceFound;
  // Нанятые стражники (Фаза 6B): слот патруля + HP живых (павшие убраны в tick).
  data.hiredGuards = game.collectHiredGuards();
  return data;
}

/** Записать снимок Game в localStorage. true — успех. */
export function saveGame(game: Game): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(collectSave(game)));
    return true;
  } catch {
    console.warn('[save] не удалось записать сейв (квота/приватный режим)');
    return false;
  }
}

/**
 * Применить загруженный сейв к уже инициализированному Game.
 * seed применять здесь ПОЗДНО (мир уже построен) — его берут в main.ts до init.
 * Здесь раскладываем всё остальное: позиция/кошелёк/опыт/жар/инвентарь/перки/
 * сундуки/дома/награда таблички/наигранное время.
 */
export function applySave(game: Game, data: SaveData): void {
  game.coins = data.coins;
  game.xp = data.xp;
  game.heat.value = data.heat;
  game.raidDifficulty = data.raidDifficulty;
  game.playedSec = data.playedSec;
  game.tgRewarded = data.tgRewarded;
  game.arrows = data.arrows;
  game.necklaceFound = data.necklaceFound;

  // Инвентарь/перки/квесты — заменяем целиком (deserialize вернул валидные структуры).
  game.inventory = data.inventory;
  game.perkState = data.perks;
  game.questState = data.quests;

  // Дома: HP по индексу (порядок Village.houses стабилен от seed).
  for (let i = 0; i < game.village.houses.length; i++) {
    const saved = data.houses[i];
    if (saved) game.village.houses[i]!.restoreFromSave(saved.hp);
  }

  // Сундуки: отметить открытые (крышки сразу наклонены).
  game.chests.applyOpened(data.openedChests);

  // Нанятые стражники (Фаза 6B): заспавнить заново по слотам с сохранённым HP.
  game.restoreHiredGuards(data.hiredGuards);

  // Игрок: HP и телепорт (terrain.height сам подберёт y).
  game.player.hp = Math.max(0, Math.min(game.player.maxHp, data.player.hp));
  game.teleport(data.player.x, data.player.z);

  // Применить экипировку/перки к статам и поясу, обновить HUD.
  game.afterSaveApplied();
}
