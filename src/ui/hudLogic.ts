// Чистая логика HUD без DOM: прогресс XP-бара и счётчик обучающей подсказки
// выстрела. Тестируется в node (tests/ui/hudLogic.test.ts), сам Hud.ts вешает
// это на DOM.

/** Сколько успешных выстрелов гасят обучающую подсказку «ЛКМ — выстрел» навсегда. */
export const HINT_SHOOT_GOAL = 3;

/**
 * Доля заполнения XP-бара (0..1) между порогом текущего и следующего уровня.
 * curThreshold — кумулятивный опыт начала уровня, nextThreshold — начала
 * следующего. На капе (nextThreshold <= curThreshold) бар полон (1).
 * Результат всегда клампится в [0,1] — лишний опыт сверх порога не «переливается».
 */
export function xpBarFraction(xp: number, curThreshold: number, nextThreshold: number): number {
  if (nextThreshold <= curThreshold) return 1;
  const frac = (xp - curThreshold) / (nextThreshold - curThreshold);
  return Math.min(1, Math.max(0, frac));
}

/**
 * Состояние подсказки выстрела после засчитанного выстрела.
 * shots — сколько выстрелов было ДО этого. Возвращает новый счётчик и done —
 * отжила ли подсказка (≥ HINT_SHOOT_GOAL). Идемпотентна на done: если уже done,
 * счётчик не растёт.
 */
export function nextShootHint(shots: number): { shots: number; done: boolean } {
  if (shots >= HINT_SHOOT_GOAL) return { shots, done: true };
  const next = shots + 1;
  return { shots: next, done: next >= HINT_SHOOT_GOAL };
}
