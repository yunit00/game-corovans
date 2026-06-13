// Прокачка персонажа: опыт → уровни → очки перков → ветви талантов.
// Чистая sim-логика: только числа и plain-объекты, тестируется в node.
// Моды перков ложатся на боевую математику из damage.ts (урон, крит, броня)
// и на системы мира (скорость бега, магнит монет, спокойствие фауны) —
// сам аггрегат perkCombatMods читают Game/боевые системы при расчётах.

/** Максимальный уровень: дальше опыт копится, но кривая и очки замораживаются. */
export const MAX_LEVEL = 10;
/** Порог опыта для 2-го уровня; база геометрической прогрессии. */
export const XP_LEVEL2 = 100;
/** Множитель стоимости каждого следующего уровня — кривая растёт, но не взрывается. */
export const XP_GROWTH = 1.45;

/**
 * Кумулятивный опыт, нужный чтобы достичь уровня `level`.
 * Уровень 1 — старт (0 опыта), уровень 2 — XP_LEVEL2, дальше каждый шаг дороже
 * предыдущего в XP_GROWTH раз. Округляем шаги, чтобы пороги были целыми.
 * Выше MAX_LEVEL клампим к уровню кап — лишний опыт «сгорает» в смысле порогов.
 */
export function xpForLevel(level: number): number {
  const lvl = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  let total = 0;
  let step = XP_LEVEL2;
  // Сумма стоимостей переходов 1→2, 2→3, …, (lvl-1)→lvl.
  for (let i = 2; i <= lvl; i++) {
    total += Math.round(step);
    step *= XP_GROWTH;
  }
  return total;
}

/** Текущий уровень по накопленному опыту (обратное к xpForLevel, клампится к капу). */
export function levelFromXp(xp: number): number {
  let level = 1;
  // Идём вверх, пока хватает опыта на следующий порог и не упёрлись в кап.
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * Все перки трёх ветвей. Первые шесть id (marksman1/2, warrior1/2, ranger1/2)
 * СОХРАНЕНЫ из Фазы 6 — старые сейвы не ломаются. Остальные добавлены глубиной
 * дерева (Фаза 6B, ветка талантов): ступени 3-4 и капстоуны.
 */
export type PerkId =
  | 'marksman1'
  | 'marksman2'
  | 'marksman3a'
  | 'marksman3b'
  | 'marksman4'
  | 'marksmanCap'
  | 'warrior1'
  | 'warrior2'
  | 'warrior3a'
  | 'warrior3b'
  | 'warrior4'
  | 'warriorCap'
  | 'ranger1'
  | 'ranger2'
  | 'ranger3a'
  | 'ranger3b'
  | 'ranger4'
  | 'rangerCap';

export type PerkBranch = 'Стрелок' | 'Воин' | 'Следопыт';

export interface PerkDef {
  id: PerkId;
  branch: PerkBranch;
  name: string;
  desc: string;
  /**
   * Глубина в ветви (1-5): 1-2 — базовые, 3-4 — углублённые (3 — развилка из двух
   * узлов на выбор), 5 — капстоун. Определяет стоимость (perkCost) и ряд в графе.
   */
  tier: 1 | 2 | 3 | 4 | 5;
  /**
   * Требование открытия: нужен ЛЮБОЙ из перечисленных перков-предтеч (взят хотя бы
   * один). Пусто/нет — корневой перк ветви (берётся сразу при наличии очка). На
   * развилке (tier 3) оба узла указывают на один tier-2 перк; tier-4 указывает на
   * ОБА узла развилки (любой из них открывает следующую ступень).
   */
  requiresAny?: readonly PerkId[];
}

/**
 * Стоимость перка в очках по глубине: ступени 1-2 → 1, 3-4 → 2, капстоун → 3.
 * Списывается из points при unlockPerk; UI показывает её на карточке/ховере.
 */
export function perkCost(id: PerkId): number {
  const tier = PERKS[id].tier;
  if (tier <= 2) return 1;
  if (tier <= 4) return 2;
  return 3;
}

export const PERKS: Record<PerkId, PerkDef> = {
  // ───────── Стрелок ─────────
  marksman1: {
    id: 'marksman1',
    branch: 'Стрелок',
    name: 'Меткий глаз',
    desc: '+20% урон арбалета',
    tier: 1,
  },
  marksman2: {
    id: 'marksman2',
    branch: 'Стрелок',
    name: 'Хладнокровие',
    desc: '+10% крит-шанс дальнего боя',
    tier: 2,
    requiresAny: ['marksman1'],
  },
  marksman3a: {
    id: 'marksman3a',
    branch: 'Стрелок',
    name: 'Тяжёлый болт',
    desc: 'Ещё +20% урон арбалета',
    tier: 3,
    requiresAny: ['marksman2'],
  },
  marksman3b: {
    id: 'marksman3b',
    branch: 'Стрелок',
    name: 'Острый глаз',
    desc: 'Ещё +10% крит-шанс дальнего боя',
    tier: 3,
    requiresAny: ['marksman2'],
  },
  marksman4: {
    id: 'marksman4',
    branch: 'Стрелок',
    name: 'Смертельный залп',
    desc: '+50% к множителю крита (×2.0 → ×2.5)',
    tier: 4,
    requiresAny: ['marksman3a', 'marksman3b'],
  },
  marksmanCap: {
    id: 'marksmanCap',
    branch: 'Стрелок',
    name: 'Пробивной болт',
    desc: 'Стрела пробивает первую цель насквозь и бьёт вторую за ней',
    tier: 5,
    requiresAny: ['marksman4'],
  },

  // ───────── Воин ─────────
  warrior1: {
    id: 'warrior1',
    branch: 'Воин',
    name: 'Крепкая хватка',
    desc: '+20% урон ближнего боя',
    tier: 1,
  },
  warrior2: {
    id: 'warrior2',
    branch: 'Воин',
    name: 'Кожа дуба',
    desc: '+3 защита',
    tier: 2,
    requiresAny: ['warrior1'],
  },
  warrior3a: {
    id: 'warrior3a',
    branch: 'Воин',
    name: 'Ярость берсерка',
    desc: 'Ещё +25% урон ближнего боя',
    tier: 3,
    requiresAny: ['warrior2'],
  },
  warrior3b: {
    id: 'warrior3b',
    branch: 'Воин',
    name: 'Стальной доспех',
    desc: 'Ещё +4 защита',
    tier: 3,
    requiresAny: ['warrior2'],
  },
  warrior4: {
    id: 'warrior4',
    branch: 'Воин',
    name: 'Бычье сердце',
    desc: '+30 к запасу здоровья',
    tier: 4,
    requiresAny: ['warrior3a', 'warrior3b'],
  },
  warriorCap: {
    id: 'warriorCap',
    branch: 'Воин',
    name: 'Второе дыхание',
    desc: 'Раз в 90 с смертельный удар оставляет 1 HP и даёт 2 с неуязвимости',
    tier: 5,
    requiresAny: ['warrior4'],
  },

  // ───────── Следопыт ─────────
  ranger1: {
    id: 'ranger1',
    branch: 'Следопыт',
    name: 'Лёгкий шаг',
    desc: '+10% скорость бега',
    tier: 1,
  },
  ranger2: {
    id: 'ranger2',
    branch: 'Следопыт',
    name: 'Звериное чутьё',
    desc: 'Фауна не убегает + магнит монет ×1.6',
    tier: 2,
    requiresAny: ['ranger1'],
  },
  ranger3a: {
    id: 'ranger3a',
    branch: 'Следопыт',
    name: 'Ветер в спину',
    desc: 'Ещё +10% скорость бега',
    tier: 3,
    requiresAny: ['ranger2'],
  },
  ranger3b: {
    id: 'ranger3b',
    branch: 'Следопыт',
    name: 'Жадные руки',
    desc: 'Магнит монет ×2.2 (вместо ×1.6)',
    tier: 3,
    requiresAny: ['ranger2'],
  },
  ranger4: {
    id: 'ranger4',
    branch: 'Следопыт',
    name: 'Чуткий слух',
    desc: '+15% крит-шанс ближнего и дальнего боя',
    tier: 4,
    requiresAny: ['ranger3a', 'ranger3b'],
  },
  rangerCap: {
    id: 'rangerCap',
    branch: 'Следопыт',
    name: 'Хозяин троп',
    desc: '−20% цены покупки, +20% продажи; фауна подпускает ближе',
    tier: 5,
    requiresAny: ['ranger4'],
  },
};

export interface PerkState {
  /** Взятые перки. */
  unlocked: PerkId[];
  /** Нерастраченные очки прокачки. */
  points: number;
}

export function makePerkState(): PerkState {
  return { unlocked: [], points: 0 };
}

/** Сколько очков перков всего даёт уровень: по 1 за каждый уровень начиная со 2-го. */
export function perkPointsEarned(level: number): number {
  const lvl = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  return lvl - 1;
}

/**
 * Сумма стоимостей всех взятых перков (по perkCost). Game держит баланс очков как
 * earned(level) − spent: с углублённым деревом перки стоят 1-3 очка, поэтому считать
 * именно сумму стоимостей, а не число перков. Неизвестные id игнорируются.
 */
export function perkPointsSpent(s: PerkState): number {
  let sum = 0;
  for (const id of s.unlocked) {
    if (id in PERKS) sum += perkCost(id);
  }
  return sum;
}

/**
 * Можно ли взять перк: хватает очков на его стоимость, он ещё не взят, и открыт
 * ХОТЯ БЫ ОДИН узел-предтеча (requiresAny). Корневой перк (без requiresAny)
 * открыт всегда — нужны только очки.
 */
export function canUnlock(s: PerkState, id: PerkId): boolean {
  if (s.unlocked.includes(id)) return false;
  if (s.points < perkCost(id)) return false;
  const req = PERKS[id].requiresAny;
  if (req && req.length > 0 && !req.some((r) => s.unlocked.includes(r))) return false;
  return true;
}

/** Взять перк, списав его стоимость. Возвращает true при успехе, false если взять нельзя. */
export function unlockPerk(s: PerkState, id: PerkId): boolean {
  if (!canUnlock(s, id)) return false;
  s.unlocked.push(id);
  s.points -= perkCost(id);
  return true;
}

export interface PerkCombatMods {
  /** Множитель урона ближнего боя (1 = без бонуса). */
  meleeMul: number;
  /** Множитель урона дальнего боя. */
  rangedMul: number;
  /** Прибавка к крит-шансу дальнего боя (доля 0..1). */
  rangedCrit: number;
  /** Прибавка к крит-шансу ближнего боя (доля 0..1). */
  meleeCrit: number;
  /** Множитель множителя крита (база 1 — без изменений; >1 усиливает critMult). */
  critMultMul: number;
  /** Прибавка к броне/защите (в единицах armor из damage.ts). */
  defense: number;
  /** Прибавка к максимуму здоровья (в единицах hp). */
  bonusMaxHp: number;
  /** Множитель скорости бега. */
  speedMul: number;
  /** Множитель радиуса/силы магнита монет. */
  coinMagnetMul: number;
  /** Фауна не разбегается от игрока. */
  faunaCalm: boolean;
  /** Капстоун «Пробивной болт»: стрела пробивает первую цель и бьёт вторую. */
  arrowPierce: boolean;
  /** Капстоун «Второе дыхание»: смертельный удар оставляет 1 HP (раз в кулдаун). */
  secondWind: boolean;
  /** Капстоун «Хозяин троп»: множитель цены ПОКУПКИ у торговцев (<1 — скидка). */
  buyMul: number;
  /** Капстоун «Хозяин троп»: множитель цены ПРОДАЖИ (>1 — наценка в пользу игрока). */
  sellMul: number;
}

/** Агрегат всех модов от взятых перков — один объект для чтения боевыми системами. */
export function perkCombatMods(s: PerkState): PerkCombatMods {
  const has = (id: PerkId): boolean => s.unlocked.includes(id);
  // Урон арбалета: базовый +20% (marksman1) и углублённый +20% (marksman3a) множатся.
  const rangedMul = (has('marksman1') ? 1.2 : 1) * (has('marksman3a') ? 1.2 : 1);
  // Урон милишки: базовый +20% (warrior1) и берсерк +25% (warrior3a) множатся.
  const meleeMul = (has('warrior1') ? 1.2 : 1) * (has('warrior3a') ? 1.25 : 1);
  // Крит дальнего: +10% (marksman2) и +10% (marksman3b) складываются; +15% обоих от ranger4.
  const rangedCrit = (has('marksman2') ? 0.1 : 0) + (has('marksman3b') ? 0.1 : 0) + (has('ranger4') ? 0.15 : 0);
  // Крит ближнего: только общий +15% от ranger4 (милишная ветвь крит не качает).
  const meleeCrit = has('ranger4') ? 0.15 : 0;
  // Защита: +3 (warrior2) и +4 (warrior3b) складываются.
  const defense = (has('warrior2') ? 3 : 0) + (has('warrior3b') ? 4 : 0);
  // Скорость: +10% (ranger1) и +10% (ranger3a) множатся.
  const speedMul = (has('ranger1') ? 1.1 : 1) * (has('ranger3a') ? 1.1 : 1);
  // Магнит: ranger3b (×2.2) важнее ranger2 (×1.6); без ветви — ×1.
  const coinMagnetMul = has('ranger3b') ? 2.2 : has('ranger2') ? 1.6 : 1;
  return {
    meleeMul,
    rangedMul,
    rangedCrit,
    meleeCrit,
    critMultMul: has('marksman4') ? 1.25 : 1,
    defense,
    bonusMaxHp: has('warrior4') ? 30 : 0,
    speedMul,
    coinMagnetMul,
    faunaCalm: has('ranger2'),
    arrowPierce: has('marksmanCap'),
    secondWind: has('warriorCap'),
    buyMul: has('rangerCap') ? 0.8 : 1,
    sellMul: has('rangerCap') ? 1.2 : 1,
  };
}
