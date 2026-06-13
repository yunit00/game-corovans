// Чистая логика боезапаса стрел: только числа, без Three/DOM.
// Старт 20, потолок 99. Трата — на состоявшийся выстрел, покупка — пачкой за
// монеты на рынке, дроп — с убитых арбалетчиков. Game держит счётчик и зовёт
// эти функции; всё тестируется в node (tests/sim/ammo.test.ts).

/** Стартовый боезапас нового забега. */
export const ARROWS_START = 20;
/** Потолок боезапаса — больше не накапливается (лишнее при покупке/дропе пропадает). */
export const ARROWS_MAX = 99;
/** Сколько стрел даёт одна покупка на рынке. */
export const ARROWS_PER_BUY = 10;
/** Цена одной покупки пачки стрел, монет. */
export const ARROWS_BUY_COST = 15;
/** Дроп с убитого арбалетчика дворца: 3..5 стрел. */
export const ARROWS_DROP_MIN = 3;
export const ARROWS_DROP_MAX = 5;

/** Клампнуть боезапас в [0, ARROWS_MAX]; не-число/NaN → 0. */
export function clampArrows(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(ARROWS_MAX, Math.floor(n)));
}

/** Добавить count стрел с учётом потолка. Возвращает новый боезапас. */
export function addArrows(current: number, count: number): number {
  return clampArrows(clampArrows(current) + Math.max(0, Math.floor(count)));
}

/** Хватает ли стрел на выстрел (нужна хотя бы одна). */
export function canShoot(arrows: number): boolean {
  return clampArrows(arrows) >= 1;
}

/**
 * Покупка пачки стрел за монеты. Возвращает новый кошелёк/боезапас и факт сделки.
 * Не покупает, если не хватает монет или боезапас уже на потолке. cost — цена пачки
 * (по умолчанию ARROWS_BUY_COST; странствующий торговец передаёт наценённую — он
 * дороже деревни и на стрелах).
 */
export function buyArrows(
  coins: number,
  arrows: number,
  cost = ARROWS_BUY_COST,
): { ok: boolean; coins: number; arrows: number } {
  const a = clampArrows(arrows);
  if (coins < cost || a >= ARROWS_MAX) {
    return { ok: false, coins, arrows: a };
  }
  return { ok: true, coins: coins - cost, arrows: addArrows(a, ARROWS_PER_BUY) };
}
