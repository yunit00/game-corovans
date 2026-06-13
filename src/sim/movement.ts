// Чистая математика движения игрока: input + yaw камеры → направление в мире.

export interface MoveKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Направление движения в мировых координатах (x, z), нормализованное.
 * Конвенция three.js: yaw = поворот камеры вокруг Y; при yaw=0 камера смотрит в -Z,
 * значит «вперёд» = (0, -1).
 */
export function moveDirFromKeys(keys: MoveKeys, yaw: number): { x: number; z: number } {
  let fx = 0;
  let fz = 0;
  if (keys.forward) fz -= 1;
  if (keys.back) fz += 1;
  if (keys.left) fx -= 1;
  if (keys.right) fx += 1;
  if (fx === 0 && fz === 0) return { x: 0, z: 0 };
  const len = Math.hypot(fx, fz);
  fx /= len;
  fz /= len;
  // Поворот локального (fx, fz) на yaw вокруг Y: x' = x·cos + z·sin, z' = -x·sin + z·cos
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: fx * cos + fz * sin, z: -fx * sin + fz * cos };
}

/** Угол поворота персонажа (вокруг Y), чтобы смотреть по направлению движения. */
export function yawFromDir(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** Кратчайший поворот от угла a к углу b, шаг не больше maxStep. */
export function stepAngle(a: number, b: number, maxStep: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return b;
  return a + Math.sign(diff) * maxStep;
}

// --- Прыжок: буфер нажатия + койот-тайм + воздушный прыжок -------------------

/** Буфер прыжка: нажатие чуть ДО приземления срабатывает при касании земли. */
export const JUMP_BUFFER_SEC = 0.12;
/** Койот-тайм: прыжок ещё возможен чуть ПОСЛЕ схода с края. */
export const COYOTE_SEC = 0.1;
/** Сколько прыжков можно сделать В ВОЗДУХЕ после отрыва (двойной прыжок = 1). */
export const MAX_AIR_JUMPS = 1;

/**
 * Результат шага: какой прыжок сработал в этом шаге.
 * - 'none'  — прыжка нет;
 * - 'ground' — обычный прыжок (с земли/буфер/койот);
 * - 'air'    — воздушный (второй) прыжок по нажатию в полёте.
 */
export type JumpKind = 'none' | 'ground' | 'air';

/**
 * Таймеры прыжка — сколько секунд осталось жить каждому окну (0 = окно закрыто).
 * stepJumpTimers мутирует объект на месте: фикс-шаг — горячий цикл, без аллокаций.
 * - airJumpsUsed — счётчик израсходованных воздушных прыжков с момента отрыва;
 * - jumped — был ли наземный/койот-прыжок в текущем полёте. Воздушный прыжок
 *   доступен только ПОСЛЕ него: иначе нажатие при сходе с уступа (буфер до
 *   приземления) ошибочно тратилось бы на «двойной» вместо буфера.
 * Оба сбрасываются, как только персонаж снова на земле (grounded).
 */
export interface JumpTimers {
  buffer: number;
  coyote: number;
  airJumpsUsed: number;
  jumped: boolean;
}

export function makeJumpTimers(): JumpTimers {
  return { buffer: 0, coyote: 0, airJumpsUsed: 0, jumped: false };
}

/**
 * Шаг таймеров прыжка. pressed — нажатие прыжка именно в этом шаге (edge),
 * grounded — на земле ли персонаж по итогам прошлого шага. Возвращает вид
 * сработавшего прыжка ('none' / 'ground' / 'air').
 *
 * Порядок важен: сначала тикаем окна вниз, потом открываем новые — поэтому
 * нажатие и касание земли в одном и том же шаге дают прыжок без задержки.
 *
 * Двойной прыжок: первое нажатие тратит окно земли/койота (ground). Следующее
 * нажатие в воздухе ПОСЛЕ наземного прыжка тратит один воздушный заряд (air) —
 * ровно MAX_AIR_JUMPS раз за полёт. Нажатие в воздухе БЕЗ предшествующего
 * прыжка (сход с уступа) воздушный заряд не тратит — оно ждёт приземления как
 * буфер. Касание земли (grounded) сбрасывает оба счётчика.
 */
export function stepJumpTimers(
  state: JumpTimers,
  dt: number,
  pressed: boolean,
  grounded: boolean,
): JumpKind {
  state.buffer = Math.max(0, state.buffer - dt);
  state.coyote = Math.max(0, state.coyote - dt);
  if (pressed) state.buffer = JUMP_BUFFER_SEC;
  if (grounded) {
    state.coyote = COYOTE_SEC;
    // Снова на земле — воздушные заряды и признак прыжка восстановлены.
    state.airJumpsUsed = 0;
    state.jumped = false;
  }
  if (state.buffer > 0 && state.coyote > 0) {
    // Прыжок потребляет оба окна: иначе остаток буфера дал бы второй прыжок
    // с койота сразу после отрыва.
    state.buffer = 0;
    state.coyote = 0;
    state.jumped = true;
    return 'ground';
  }
  // Воздушный прыжок: явное нажатие В ЭТОМ шаге, уже в воздухе (окна койота нет),
  // и ТОЛЬКО если в этом полёте уже был наземный прыжок (state.jumped) — иначе
  // это буфер перед приземлением, его трогать нельзя. Не из остатка буфера:
  // двойной прыжок — осознанное повторное нажатие, а не «дотекание» старого.
  if (pressed && state.coyote <= 0 && state.jumped && state.airJumpsUsed < MAX_AIR_JUMPS) {
    state.buffer = 0;
    state.airJumpsUsed += 1;
    return 'air';
  }
  return 'none';
}
