// Планировщик корованов (Фаза 5). Чистая sim-логика: только числа и plain-объекты,
// никаких Three/Rapier — тестируется в node. Спавном телеги, эскорта и движением
// по пути занимается директор корованов на стороне Game.
import { randInt, randRange, type Rng } from '../core/rng';

export type CaravanTier = 'poor' | 'merchant' | 'royal';

export type CaravanEscortArchetype = 'guard_soldier' | 'guard_crossbow';

export interface CaravanEscortUnit {
  archetype: CaravanEscortArchetype;
  count: number;
}

export interface CaravanPlan {
  tier: CaravanTier;
  escort: CaravanEscortUnit[];
  /** Сумма монет за грабёж всего корована. */
  lootCoins: number;
  xp: number;
  /** Скорость телеги, м/с. */
  speed: number;
}

// Базовый состав и награды по тирам. Скорость телеги падает с богатством:
// тяжёлый королевский обоз легче перехватить, но риск компенсируется эскортом —
// иначе игрок просто игнорировал бы бедные корованы.
const TIER_DEFS: Record<
  CaravanTier,
  { soldiers: number; crossbows: number; lootMin: number; lootMax: number; xp: number; speed: number }
> = {
  poor: { soldiers: 2, crossbows: 0, lootMin: 25, lootMax: 40, xp: 20, speed: 2.4 },
  merchant: { soldiers: 2, crossbows: 1, lootMin: 60, lootMax: 90, xp: 45, speed: 2.2 },
  royal: { soldiers: 3, crossbows: 2, lootMin: 150, lootMax: 220, xp: 100, speed: 1.9 },
};

// Шансы тиров на краях шкалы heat: на нулевом разогреве почти все корованы бедные,
// к heat 5 королевские перестают быть редкостью — мир «отвечает» на грабежи игрока.
const TIER_CHANCE_COLD = { poor: 0.7, merchant: 0.25 } as const; // royal — остаток (0.05)
const TIER_CHANCE_HOT = { poor: 0.3, merchant: 0.45 } as const; // royal — остаток (0.25)
const TIER_HEAT_MAX = 5; // дальше этого heat шансы тиров не растут

// Линейная интерполяция между «холодными» и «горячими» шансами: плавный рост
// вместо ступеньки, чтобы каждый ограбленный корован заметно что-то менял.
function rollTier(heat: number, rng: Rng): CaravanTier {
  const t = Math.min(1, Math.max(0, heat) / TIER_HEAT_MAX);
  const pPoor = TIER_CHANCE_COLD.poor + (TIER_CHANCE_HOT.poor - TIER_CHANCE_COLD.poor) * t;
  const pMerchant =
    TIER_CHANCE_COLD.merchant + (TIER_CHANCE_HOT.merchant - TIER_CHANCE_COLD.merchant) * t;
  const r = rng();
  if (r < pPoor) return 'poor';
  if (r < pPoor + pMerchant) return 'merchant';
  return 'royal';
}

// +1 мечник за каждые 2 полных heat: дворец усиливает охрану в ответ на грабежи.
// Кап +4 — иначе на больших heat эскорт перерастает формацию (9 слотов) и бой
// превращается в стенку. Отдельная функция, чтобы баланс роста тестировался
// без разбора структуры плана.
export function escortHeatBonus(heat: number): number {
  return Math.min(4, Math.floor(Math.max(0, heat) / 2));
}

export function planCaravan(heat: number, rng: Rng): CaravanPlan {
  const h = Math.max(0, heat);
  // Порядок расхода rng тот же, что и раньше: ролл тира, затем ролл лута.
  return planCaravanOfTier(rollTier(h, rng), h, rng);
}

/**
 * План корована ЗАДАННОГО ранга: тир не разыгрывается, heat влияет только на
 * эскорт. Нужен debug-спавну (__game.spawnCaravan('royal')) и смоукам — без него
 * конкретный тир пришлось бы выбивать перебором сидов.
 */
export function planCaravanOfTier(tier: CaravanTier, heat: number, rng: Rng): CaravanPlan {
  const h = Math.max(0, heat);
  const def = TIER_DEFS[tier];

  // Heat-бонус идёт только в мечников: линия щитов растёт, а урон с дистанции
  // фиксирован тиром — иначе высокий heat делал бы перехват вовсе невозможным.
  const soldiers = def.soldiers + escortHeatBonus(h);
  const escort: CaravanEscortUnit[] = [{ archetype: 'guard_soldier', count: soldiers }];
  if (def.crossbows > 0) escort.push({ archetype: 'guard_crossbow', count: def.crossbows });

  return {
    tier,
    escort,
    lootCoins: randInt(rng, def.lootMin, def.lootMax),
    xp: def.xp,
    speed: def.speed,
  };
}

// Базовый интервал держит ритм «корован раз в ~2 минуты»; разброс нужен, чтобы
// игрок не засекал спавн по часам. При heat >= 6 дворец придерживает торговлю —
// корованы выходят на 25% реже (интервал длиннее).
const INTERVAL_MIN_SEC = 100;
const INTERVAL_MAX_SEC = 140;
const INTERVAL_HOT_HEAT = 6;
const INTERVAL_HOT_MULT = 1.25;

export function caravanInterval(heat: number, rng: Rng): number {
  const base = randRange(rng, INTERVAL_MIN_SEC, INTERVAL_MAX_SEC);
  return heat >= INTERVAL_HOT_HEAT ? base * INTERVAL_HOT_MULT : base;
}

// Слоты эскорта вокруг телеги (телега — начало координат пути): dx — вбок от оси
// (|dx| <= 1.8, чтобы охрана не сходила с дороги в лес), ds — вдоль пути
// (положительное — впереди). Порядок слотов = приоритет занятия: сначала фланги
// вплотную к грузу, затем передний/задний дозор, затем внешнее кольцо.
const FORMATION_SLOTS: readonly { dx: number; ds: number }[] = [
  { dx: -1.8, ds: 0 }, // левый фланг
  { dx: 1.8, ds: 0 }, // правый фланг
  { dx: 0, ds: 3.5 }, // передний дозор
  { dx: 0, ds: -3.5 }, // задний дозор
  { dx: -1.8, ds: 2.5 },
  { dx: 1.8, ds: 2.5 },
  { dx: -1.8, ds: -2.5 },
  { dx: 1.8, ds: -2.5 },
  { dx: 0, ds: 5.5 }, // дальний авангард
];

export function escortFormation(n: number): { dx: number; ds: number }[] {
  // Кап по числу слотов: больше 9 охранников planCaravan не выдаёт
  // (5 базовых у royal + кап бонуса +4), лишних некуда ставить без наложений.
  const count = Math.min(FORMATION_SLOTS.length, Math.max(0, Math.floor(n)));
  const out: { dx: number; ds: number }[] = [];
  // Копии, а не ссылки на таблицу: вызывающий код двигает точки под кривизну пути.
  for (let i = 0; i < count; i++) {
    out.push({ dx: FORMATION_SLOTS[i]!.dx, ds: FORMATION_SLOTS[i]!.ds });
  }
  return out;
}
