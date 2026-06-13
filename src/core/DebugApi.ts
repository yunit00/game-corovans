// window.__game — контракт для автоматических смоук-тестов (preview MCP).
// Доступен всегда в dev-сборке; в проде безвреден (только чтение состояния).
import type { Game } from './Game';

export interface DebugApi {
  state: () => Record<string, unknown>;
  fps: () => number;
  stats: () => { drawCalls: number; triangles: number; bodies: number; ai: number };
  dumpClips: (name?: string) => Record<string, string[]>;
  teleport: (x: number, z: number) => void;
  setMove: (x: number, z: number, sprint?: boolean) => void;
  stopMove: () => void;
  attack: () => void;
  shootAt: (x: number, z: number) => void;
  spawnNpc: (archetypeId: string, x: number, z: number) => void;
  hurtPlayer: (n: number) => void;
  spawnRaid: (size?: number) => void;
  forcePunitive: () => void;
  spawnCaravan: (tier?: string) => void;
  giveXP: (n: number) => void;
  giveItem: (id: string, count?: number) => void;
  /** Выдать n стрел в боезапас (с учётом потолка) — для смоуков выстрела/счётчика. */
  giveArrows: (n: number) => void;
  saveNow: () => boolean;
  wipeSave: () => void;
  killAllEnemies: () => void;
  /** Поставить игру на паузу (как Esc) — для смоука без pointer lock. */
  pause: () => void;
  /** Снять паузу (как «Продолжить»). */
  resume: () => void;
  /** «В главное меню» из паузы (меню поверх, игра остаётся на паузе). */
  toMainMenu: () => void;
  /** Открыть лавку у торговца — для смоука покупки/продажи без подхода. */
  openShop: () => void;
  /** Снимок состояния сайд-квестов (Фаза 6B): активный/прогресс/записи жителей. */
  questState: () => Record<string, unknown>;
  /** Бросить монету в фонтан (бафф источника) — для смоука без подхода. */
  tossCoin: () => void;
  /** Нанять стражника деревни — для смоука найма/патруля/сейва. */
  hireGuard: () => void;
  /** Угостить трактирщика элем (слух о короване) — для смоука. */
  tavernRumor: () => void;
  /** Снимок служб трат денег (Фаза 6B): бафф/стражники/слух. */
  servicesState: () => Record<string, unknown>;
  /** Открыть лавку странствующего торговца (наценка ×1.25) — для смоука. */
  openTravelerShop: () => void;
  /** Телепортировать к скрытому ожерелью и подобрать — для смоука. */
  pickNecklace: () => void;
  /** Перемотать идущую заставку на секунду t (скриншоты сцен интро). */
  introSeek: (t: number) => void;
  /** Снимок локаций волны B: водопад/мировые NPC/торговец/тайник/ключи. */
  worldState: () => Record<string, unknown>;
  /** Телепорт к причалу и посадка в лодку (волна 2) — для смоука катания. */
  boardBoat: () => void;
  /** Высадка из лодки на ближайший берег — для смоука. */
  disembarkBoat: () => void;
}

export function installDebugApi(game: Game): void {
  const api: DebugApi = {
    state: () => game.debugState(),
    fps: () => game.fps(),
    stats: () => game.debugStats(),
    dumpClips: (name?: string) => {
      const out: Record<string, string[]> = {};
      for (const [key, gltf] of game.assets.loaded) {
        if (name && !key.includes(name.toLowerCase())) continue;
        out[key] = gltf.animations.map((a) => a.name);
      }
      return out;
    },
    teleport: (x, z) => game.teleport(x, z),
    setMove: (x, z, sprint) => game.debugSetMove(x, z, sprint),
    stopMove: () => game.debugStopMove(),
    attack: () => game.debugAttack(),
    shootAt: (x, z) => game.debugShootAt(x, z),
    spawnNpc: (archetypeId, x, z) => game.debugSpawnNpc(archetypeId, x, z),
    hurtPlayer: (n) => game.debugHurtPlayer(n),
    spawnRaid: (size) => game.debugSpawnRaid(size),
    forcePunitive: () => game.debugForcePunitive(),
    spawnCaravan: (tier) => game.debugSpawnCaravan(tier),
    giveXP: (n) => game.debugGiveXP(n),
    giveItem: (id, count) => game.debugGiveItem(id, count),
    giveArrows: (n) => game.debugGiveArrows(n),
    saveNow: () => game.debugSaveNow(),
    wipeSave: () => game.debugWipeSave(),
    killAllEnemies: () => game.debugKillAllEnemies(),
    pause: () => game.debugPause(),
    resume: () => game.debugResume(),
    toMainMenu: () => game.debugToMainMenu(),
    openShop: () => game.debugOpenShop(),
    questState: () => game.debugQuestState(),
    tossCoin: () => game.debugTossCoin(),
    hireGuard: () => game.debugHireGuard(),
    tavernRumor: () => game.debugTavernRumor(),
    servicesState: () => game.debugServicesState(),
    openTravelerShop: () => game.debugOpenTravelerShop(),
    pickNecklace: () => game.debugPickNecklace(),
    introSeek: (t) => game.introSeek(t),
    worldState: () => game.debugWorldState(),
    boardBoat: () => game.debugBoardBoat(),
    disembarkBoat: () => game.debugDisembarkBoat(),
  };
  (window as unknown as { __game: DebugApi }).__game = api;
  // Сырой доступ для ручной отладки в консоли
  (window as unknown as { __g: Game }).__g = game;
}
