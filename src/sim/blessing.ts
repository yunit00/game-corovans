// Чистая логика баффа «Благословение источника» (Фаза 6B). Бросил монету в фонтан
// деревни — получил на BLESSING_DURATION_SEC прибавку скорости и реген HP. Никаких
// Three/Rapier/DOM: только число-таймер. Бафф короткоживущий и в сейв НЕ пишется
// (перезагрузка его сбрасывает — это нормально). Тестируется в node.

/** Цена броска монеты в фонтан. */
export const BLESSING_COST = 25;
/** Длительность баффа, с (3 минуты). */
export const BLESSING_DURATION_SEC = 180;
/** Множитель скорости от баффа (+15%). */
export const BLESSING_SPEED_MUL = 1.15;
/** Реген HP от баффа, ед/с. */
export const BLESSING_HP_PER_SEC = 1;

/** Состояние баффа источника: остаток длительности, с (0 — баффа нет). */
export interface BlessingState {
  /** Остаток действия баффа, с. 0 — неактивен. */
  left: number;
}

/** Свежее состояние без баффа. */
export function makeBlessing(): BlessingState {
  return { left: 0 };
}

/** Активен ли бафф сейчас. */
export function isBlessed(state: BlessingState): boolean {
  return state.left > 0;
}

/**
 * Бросить монету: обновить (НЕ накопить) длительность до полной. Повторный бросок
 * не стакается — просто продлевает до BLESSING_DURATION_SEC заново. Списание монет
 * делает вызывающий (Game) — здесь только таймер.
 */
export function applyBlessing(state: BlessingState): void {
  state.left = BLESSING_DURATION_SEC;
}

/**
 * Тик баффа на dt секунд. Возвращает реген HP за этот тик (HP_PER_SEC * dt, пока
 * бафф активен; 0 — баффа нет). По истечении left обнуляется ровно в 0 (без минуса).
 */
export function tickBlessing(state: BlessingState, dt: number): number {
  if (state.left <= 0) {
    state.left = 0;
    return 0;
  }
  // Реген считаем за фактически активную долю тика (на стыке истечения не «дарим»
  // лишний реген за неактивную часть кадра).
  const active = Math.min(state.left, dt);
  state.left -= dt;
  if (state.left < 0) state.left = 0;
  return BLESSING_HP_PER_SEC * active;
}

/** Сбросить бафф (новый забег/смерть — короткоживущий бафф не переживает их). */
export function clearBlessing(state: BlessingState): void {
  state.left = 0;
}
