// Планировщик волн набега. Чистая sim-логика: только числа и plain-объекты,
// никаких Three/Rapier — тестируется в node. Спавном и FSM занимается RaidDirector.
import { randInt, type Rng } from '../core/rng';

export type RaidArchetype =
  | 'skeleton_raider'
  | 'skeleton_brute'
  | 'guard_soldier'
  | 'guard_crossbow';

export interface RaidUnit {
  archetype: RaidArchetype;
  count: number;
}

export interface RaidWave {
  delaySec: number; // от старта набега, не от предыдущей волны
  units: RaidUnit[];
}

// Паузы волн фиксированы: ритм набега должен читаться игроком,
// рандом тут только размазал бы ощущение «передышка → новая волна».
const WAVE_DELAYS_SEC = [0, 20, 40] as const;

/** Награда за один уцелевший дом по итогу отбитого набега, монеты и XP. */
export const REWARD_COINS_PER_HOUSE = 10;
export const REWARD_XP_PER_HOUSE = 8;
/** Бонус-множитель, если уцелели ВСЕ дома деревни («Деревня невредима!»). */
export const FLAWLESS_MULTIPLIER = 1.5;

export interface RaidReward {
  /** Монеты к выдаче. */
  coins: number;
  /** Опыт к выдаче. */
  xp: number;
  /** Уцелевшие/всего домов (для баннера). */
  survived: number;
  total: number;
  /** Все дома целы — бонус ×1.5 и особый баннер. */
  flawless: boolean;
}

/**
 * Награда за отбитый набег пропорционально уцелевшим домам. Чистая функция —
 * тестируется в node. Все дома целы → бонус FLAWLESS_MULTIPLIER (округление вниз).
 * Деревня без домов (total=0) или все разрушены (survived=0) — награда 0, не flawless.
 */
export function raidReward(survived: number, total: number): RaidReward {
  const t = Math.max(0, Math.floor(total));
  const s = Math.max(0, Math.min(t, Math.floor(survived)));
  const flawless = t > 0 && s === t;
  const mul = flawless ? FLAWLESS_MULTIPLIER : 1;
  return {
    coins: Math.floor(s * REWARD_COINS_PER_HOUSE * mul),
    xp: Math.floor(s * REWARD_XP_PER_HOUSE * mul),
    survived: s,
    total: t,
    flawless,
  };
}

// Доля волн со стражей дворца при difficulty >= 3 — «изредка»,
// чтобы стража оставалась сюрпризом, а не нормой набега.
const GUARD_WAVE_CHANCE = 0.3;

// Бюджет юнитов на весь набег. Отдельная функция, чтобы баланс роста
// сложности тестировался без разбора структуры волн.
export function raidBudget(difficulty: number): number {
  const d = Math.max(1, Math.floor(difficulty));
  return Math.min(16, 4 + d * 2);
}

export function planRaid(difficulty: number, rng: Rng): RaidWave[] {
  const d = Math.max(1, Math.floor(difficulty));
  const budget = raidBudget(d);

  // Число волн: на старте одна, с d3 всегда несколько — игрок получает
  // передышку между волнами и нарастающее давление вместо одной толпы.
  const waveCount = d <= 1 ? 1 : d === 2 ? randInt(rng, 1, 2) : randInt(rng, 2, 3);

  // Размеры волн: ровное деление бюджета, остаток уходит в поздние волны —
  // набег нарастает к финалу. budget >= 6 при waveCount <= 3 ⇒ волны непустые.
  const base = Math.floor(budget / waveCount);
  const rem = budget % waveCount;

  const waves: RaidWave[] = [];
  for (let i = 0; i < waveCount; i++) {
    const size = base + (i >= waveCount - rem ? 1 : 0);
    // Стража идёт строго отдельной волной: смешивать фракции в одной волне
    // нельзя — у них разный лут и разная реакция AI на игрока.
    const isGuardWave = d >= 3 && rng() < GUARD_WAVE_CHANCE;
    waves.push({
      delaySec: WAVE_DELAYS_SEC[i]!,
      units: isGuardWave ? splitGuards(size, rng) : splitSkeletons(size, d, rng),
    });
  }
  return waves;
}

/**
 * Дебаг-план ровно из size скелетов одной волной (для __game.spawnRaid(size)):
 * смоуки требуют точного и мгновенного числа юнитов, поэтому без rng и без пауз.
 * Брут — каждый четвёртый: масса остаётся за raider'ами, как в боевых волнах.
 */
export function planRaidOfSize(size: number): RaidWave[] {
  const n = Math.max(1, Math.floor(size));
  const brutes = Math.floor(n / 4);
  const units: RaidUnit[] = [{ archetype: 'skeleton_raider', count: n - brutes }];
  if (brutes > 0) units.push({ archetype: 'skeleton_brute', count: brutes });
  return [{ delaySec: 0, units }];
}

// Скелеты — костяк набега. Brute появляется с d2 и занимает не больше трети
// волны: он танкует, а массовку дают raider'ы, иначе волна слишком медленная.
function splitSkeletons(size: number, difficulty: number, rng: Rng): RaidUnit[] {
  const brutes = difficulty >= 2 ? randInt(rng, 0, Math.floor(size / 3)) : 0;
  const raiders = size - brutes; // brutes <= size/3 ⇒ raiders >= 1 всегда
  const units: RaidUnit[] = [{ archetype: 'skeleton_raider', count: raiders }];
  if (brutes > 0) units.push({ archetype: 'skeleton_brute', count: brutes });
  return units;
}

// Стража дворца: арбалетчиков не больше половины — без линии мечников
// волна разваливается на одиночные тиры и не доходит до деревни.
function splitGuards(size: number, rng: Rng): RaidUnit[] {
  const crossbows = randInt(rng, 0, Math.floor(size / 2));
  const soldiers = size - crossbows; // crossbows <= size/2 ⇒ soldiers >= 1 всегда
  const units: RaidUnit[] = [{ archetype: 'guard_soldier', count: soldiers }];
  if (crossbows > 0) units.push({ archetype: 'guard_crossbow', count: crossbows });
  return units;
}
