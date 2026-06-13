// «Жар» — счётчик мести дворца за ограбленные корованы. Растёт с каждым грабежом
// (богаче корован — больше шум), остывает со временем, а от уровня зависят шанс
// и сложность карательного набега. Чистая sim-логика: только числа и plain-объекты,
// тестируется в node. Решение «слать ли karateльный набег» принимает RaidDirector.

/** Потолок жара: дальше дворец уже не может злиться сильнее. */
export const HEAT_MAX = 10;
/** Скорость остывания: −1 жара за 120 с тишины. */
export const HEAT_COOL_PER_SEC = 1 / 120;
/** Ниже этого порога дворец не замечает грабежей — карательных набегов нет. */
export const PUNITIVE_HEAT_MIN = 4;
/** С этого уровня дворец шлёт усиленные отряды (+2 к сложности вместо +1). */
export const PUNITIVE_HEAT_HIGH = 7;
/** Шанс карательного набега на пороге PUNITIVE_HEAT_MIN. */
export const PUNITIVE_CHANCE_MIN = 0.25;
/** Шанс карательного набега при максимальном жаре. */
export const PUNITIVE_CHANCE_MAX = 0.6;

export type CaravanTier = 'poor' | 'merchant' | 'royal';

/** Сколько жара даёт грабёж корована каждого ранга: богаче добыча — громче слух. */
export const ROBBERY_HEAT: Readonly<Record<CaravanTier, number>> = {
  poor: 1,
  merchant: 1.75,
  royal: 3,
};

export interface HeatState {
  /** Текущий жар, 0..HEAT_MAX, дробный (остывание идёт малыми шагами фикс-тика). */
  value: number;
}

export function makeHeat(): HeatState {
  return { value: 0 };
}

/** Грабёж замечен: жар растёт по рангу корована, но не выше потолка. */
export function addRobberyHeat(h: HeatState, tier: CaravanTier): void {
  h.value = Math.min(HEAT_MAX, h.value + ROBBERY_HEAT[tier]);
}

/** Тик остывания: дворец постепенно забывает обиды, но не «в минус». */
export function coolHeat(h: HeatState, dtSec: number): void {
  h.value = Math.max(0, h.value - dtSec * HEAT_COOL_PER_SEC);
}

/**
 * Шанс карательного набега за одну «проверку» RaidDirector.
 * Ниже порога — ровно 0 (мелкие грабежи дворец списывает на разбойников),
 * на пороге сразу 0.25 (скачок — заметность включается рывком, а не плавно),
 * дальше линейно до 0.6 при максимальном жаре.
 */
export function punitiveRaidChance(h: HeatState): number {
  if (h.value < PUNITIVE_HEAT_MIN) return 0;
  const t = (h.value - PUNITIVE_HEAT_MIN) / (HEAT_MAX - PUNITIVE_HEAT_MIN);
  return PUNITIVE_CHANCE_MIN + t * (PUNITIVE_CHANCE_MAX - PUNITIVE_CHANCE_MIN);
}

/** Бонус сложности карательного набега: ступени, чтобы планировщик волн был предсказуем. */
export function punitiveDifficultyBonus(h: HeatState): number {
  if (h.value >= PUNITIVE_HEAT_HIGH) return 2;
  if (h.value >= PUNITIVE_HEAT_MIN) return 1;
  return 0;
}
