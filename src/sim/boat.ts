// Лодка на главном озере (Фаза 6D, волна 2). ЧИСТАЯ физика скольжения и предикаты
// посадки/высадки — только числа и функции, БЕЗ three/rapier. Рендер/интеграция —
// world/Boat.ts + точки в Game.ts; глубину в границах опрашиваем через callback
// (в игре — Terrain.height + уровень воды озера, в тестах — любая функция). Так шаг
// детерминирован и node-тестируем, как movement/caravan/steering.
//
// Модель управления — «корабельная» (как телега корована, но игрок у руля): у лодки
// собственный yaw, W/S дают тягу вперёд/назад вдоль носа, A/D — поворот руля. Это
// НЕ камеро-относительное движение игрока (moveDirFromKeys): на воде естественнее
// руль + инерция. Скольжение — экспоненциальное затухание скорости (drag), нос
// доворачивает корпус (скорость переносится на новое направление с долей сноса).
//
// Границы зеркала: лодка опрашивает глубину под собой и впереди (depthAt). Где дно
// поднимается выше (waterY − BANK_DEPTH) — это берег/мель: лодку мягко тормозит и
// сносит вдоль кромки, на сушу она не выезжает (мы кламём предполагаемый шаг до
// последней «достаточно глубокой» точки). Так выполняется критерий «лодка не выходит
// за кромку воды», без коллайдера — чистой проверкой глубины.

import { yawFromDir } from './movement';

/** Состояние лодки: позиция/курс/скорость по миру + визуальные крен и фаза качки. */
export interface BoatState {
  x: number;
  z: number;
  /** Курс (нос), рад. Конвенция игры: yawFromDir = atan2(dx, dz), нос при yaw=0 → +Z. */
  yaw: number;
  /** Скорость по миру, м/с (vx, vz). Инерция: затухает экспоненциально, не мгновенно. */
  vx: number;
  vz: number;
  /** Визуальный крен в поворот, рад (только рендер; шаг копит к целевому). */
  roll: number;
  /** Фаза покачивания на воде, с (растёт со временем; рендер берёт sin). */
  bob: number;
}

/** Ввод руля за шаг: тяга (W/S) и поворот (A/D). Булевы — как у игрока (down). */
export interface BoatInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

// --- Константы физики (вынесены: их же читают тесты и отчёт) ---

/** Максимальная скорость вперёд, м/с. Чуть меньше бега игрока (5.0) — «порядка бега». */
export const BOAT_MAX_FWD = 4.5;
/** Максимальная скорость назад, м/с (зад медленнее — как просили). */
export const BOAT_MAX_BACK = 2.0;
/**
 * Ускорение тяги вперёд, м/с². Подобрано так, чтобы установившаяся скорость
 * (accel/drag) была ≈ BOAT_MAX_FWD: тяга разгоняет, drag тормозит, равновесие у
 * потолка. 3.8/0.85 ≈ 4.47 м/с — «порядка бега» (бег игрока 5.0).
 */
export const BOAT_ACCEL = 3.8;
/** Ускорение заднего хода, м/с² (слабее переднего; зад медленнее). */
export const BOAT_ACCEL_BACK = 2.2;
/**
 * Коэффициент линейного затухания скорости, 1/с (экспоненциальное скольжение): без
 * тяги скорость падает как v·e^(−DRAG·dt). ~0.85 → за ~2.5 с почти стоп, лодка
 * заметно «доезжает» по инерции (критерий волны 2). Он же задаёт установившуюся
 * скорость под тягой (accel/drag), см. BOAT_ACCEL.
 */
export const BOAT_DRAG = 0.85;
/** Боковое затухание (снос): поперечная к носу скорость гасится сильнее — корпус «режет» воду. */
export const BOAT_LATERAL_DRAG = 3.2;
/** Скорость поворота на месте/малом ходу, рад/с. */
export const BOAT_TURN_MIN = 0.7;
/** Прибавка к скорости поворота на полном ходу, рад/с (руль эффективнее на скорости). */
export const BOAT_TURN_GAIN = 1.1;
/** Целевой визуальный крен в поворот на полном ходу, рад (~10°). */
export const BOAT_ROLL_MAX = 0.18;
/** Скорость подхода крена к целевому, 1/с. */
export const BOAT_ROLL_LERP = 4.0;
/** Угловая частота покачивания на воде, рад/с (рендер: sin(bob)). */
export const BOAT_BOB_RATE = 1.6;

/**
 * Минимальная глубина под лодкой, при которой вода ещё «судоходна», м. Где дно выше
 * (waterY − BANK_DEPTH) — это мель/берег: туда лодку не пускаем (кламп шага). 0.35 м
 * соответствует осадке низкой лодки и кромке зеркала (за rimR глубина ~0).
 */
export const BOAT_BANK_DEPTH = 0.35;

/** Радиус посадки в лодку с берега/мелководья, м (подсказка «[E] — сесть в лодку»). */
export const BOAT_BOARD_RADIUS = 3.5;
/** Максимум до берега для высадки [E], м: дальше — подсказка «подплыви к берегу». */
export const BOAT_DISEMBARK_REACH = 4.0;

/** Функция глубины воды в точке: waterY − bedHeight(x,z). >0 — под водой, ≤0 — суша/берег. */
export type DepthFn = (x: number, z: number) => number;

/** Создать лодку у причала: позиция/курс заданы, скорость и визуал — в нуле. */
export function makeBoat(x: number, z: number, yaw: number): BoatState {
  return { x, z, yaw, vx: 0, vz: 0, roll: 0, bob: 0 };
}

/** Сбросить лодку на причал (выход в меню/загрузка): тот же инвариант, что makeBoat. */
export function resetBoat(b: BoatState, x: number, z: number, yaw: number): void {
  b.x = x;
  b.z = z;
  b.yaw = yaw;
  b.vx = 0;
  b.vz = 0;
  b.roll = 0;
  b.bob = 0;
}

/** Единичный вектор «нос» по курсу (та же конвенция, что yawFromDir/moveDirFromKeys). */
export function boatForward(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Скорость лодки по модулю, м/с (для рендера крена/звука/HUD). */
export function boatSpeed(b: BoatState): number {
  return Math.hypot(b.vx, b.vz);
}

/**
 * Близок ли игрок к лодке настолько, чтобы сесть (с берега/мелководья). Радиус
 * BOAT_BOARD_RADIUS вокруг лодки в плане XZ. Чистый предикат — Game рисует промпт.
 */
export function canBoard(boatX: number, boatZ: number, px: number, pz: number): boolean {
  return Math.hypot(px - boatX, pz - boatZ) <= BOAT_BOARD_RADIUS;
}

/**
 * Можно ли высадиться: рядом с лодкой есть валидная точка берега (дно выше уровня
 * воды, т.е. depth ≤ 0) в пределах BOAT_DISEMBARK_REACH. Возвращает саму точку или
 * null (тогда подсказка «подплыви к берегу»). Сканирует кольцом вокруг лодки наружу
 * по курсу к ближайшей суше — детерминированно, без three.
 *
 * Берег ищем по 16 румбам на возрастающих радиусах: первая точка с depth ≤ 0 (суша),
 * у которой ПЕРЕД ней (ближе к лодке, на полрадиуса) ещё вода — это валидная кромка,
 * куда игрок шагает с лодки. Точку чуть отодвигаем на сушу (надёжно не в воде).
 */
export function findDisembarkPoint(
  b: BoatState,
  depthAt: DepthFn,
  reach = BOAT_DISEMBARK_REACH,
): { x: number; z: number } | null {
  let best: { x: number; z: number; d: number } | null = null;
  for (let ri = 0; ri < 16; ri++) {
    const ang = (ri / 16) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    for (let r = 0.5; r <= reach; r += 0.25) {
      const x = b.x + dx * r;
      const z = b.z + dz * r;
      if (depthAt(x, z) <= 0) {
        // Шагнём ещё немного на сушу (0.4 м), чтобы гарантированно не остаться в воде/на кромке.
        const ox = x + dx * 0.4;
        const oz = z + dz * 0.4;
        if (depthAt(ox, oz) <= 0 && (best === null || r < best.d)) {
          best = { x: +ox.toFixed(3), z: +oz.toFixed(3), d: r };
        }
        break; // на этом румбе берег найден — дальше по нему не идём
      }
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

/**
 * Глубоко ли вода под точкой (судоходно): depth ≥ BOAT_BANK_DEPTH. Используется в
 * шаге для клампа у кромки зеркала и в тесте границ.
 */
export function isNavigable(depthAt: DepthFn, x: number, z: number): boolean {
  return depthAt(x, z) >= BOAT_BANK_DEPTH;
}

// Скретчи шага — лодка одна, fixedUpdate синхронный, без аллокаций в шаге.
const _fwd = { x: 0, z: 0 };

/**
 * Шаг физики лодки за dt. Детерминирован: тот же state+input+depthAt → тот же
 * результат. Порядок: поворот руля → тяга вдоль носа → инерция/снос (затухание) →
 * перенос с клампом у кромки воды (на сушу не выезжаем) → визуальные крен/качка.
 *
 * Возвращает фактически пройденный путь, м (для звука плеска/HUD; 0 — упёрлись в мель).
 */
export function stepBoat(b: BoatState, dt: number, input: BoatInput, depthAt: DepthFn): number {
  // --- 1. Поворот руля: эффективнее на скорости (BOAT_TURN_MIN + усиление от хода). ---
  const spd = boatSpeed(b);
  const turnRate = BOAT_TURN_MIN + BOAT_TURN_GAIN * Math.min(1, spd / BOAT_MAX_FWD);
  let turn = 0;
  if (input.left) turn -= 1;
  if (input.right) turn += 1;
  b.yaw += turn * turnRate * dt;

  // --- 2. Тяга вдоль носа (W вперёд / S назад, зад слабее). ---
  _fwd.x = Math.sin(b.yaw);
  _fwd.z = Math.cos(b.yaw);
  let thrust = 0;
  if (input.forward) thrust += BOAT_ACCEL;
  if (input.back) thrust -= BOAT_ACCEL_BACK;
  b.vx += _fwd.x * thrust * dt;
  b.vz += _fwd.z * thrust * dt;

  // --- 3. Инерция и снос: разложим скорость на продольную (вдоль носа) и поперечную,
  // гасим их раздельно (поперечную сильнее — корпус режет воду), кламём продольную к
  // пределам вперёд/назад. Так после отпускания W лодка «доезжает» по инерции. ---
  const along = b.vx * _fwd.x + b.vz * _fwd.z; // проекция на нос
  const sideX = b.vx - along * _fwd.x; // поперечная составляющая
  const sideZ = b.vz - along * _fwd.z;
  // Экспоненциальное затухание (стабильно при любом dt): множитель e^(−k·dt).
  let alongDamped = along * Math.exp(-BOAT_DRAG * dt);
  const sideDamp = Math.exp(-BOAT_LATERAL_DRAG * dt);
  // Кламп продольной скорости к пределам (тяга могла превысить).
  if (alongDamped > BOAT_MAX_FWD) alongDamped = BOAT_MAX_FWD;
  if (alongDamped < -BOAT_MAX_BACK) alongDamped = -BOAT_MAX_BACK;
  b.vx = _fwd.x * alongDamped + sideX * sideDamp;
  b.vz = _fwd.z * alongDamped + sideZ * sideDamp;

  // --- 4. Перенос с проверкой кромки: предполагаемая точка должна быть судоходной;
  // иначе — стоп по нормали к берегу и скольжение вдоль кромки (не выезжаем на сушу). ---
  let nx = b.x + b.vx * dt;
  let nz = b.z + b.vz * dt;
  let moved = Math.hypot(nx - b.x, nz - b.z);
  if (!isNavigable(depthAt, nx, nz)) {
    // Кромка впереди: пробуем сдвиг только по X или только по Z (скольжение вдоль берега).
    const tryX = isNavigable(depthAt, b.x + b.vx * dt, b.z);
    const tryZ = isNavigable(depthAt, b.x, b.z + b.vz * dt);
    if (tryX && !tryZ) {
      nx = b.x + b.vx * dt;
      nz = b.z;
      b.vz = 0;
    } else if (tryZ && !tryX) {
      nx = b.x;
      nz = b.z + b.vz * dt;
      b.vx = 0;
    } else {
      // Уткнулись носом — стоп у кромки, гасим скорость (мягкое торможение).
      nx = b.x;
      nz = b.z;
      b.vx *= 0.2;
      b.vz *= 0.2;
    }
    moved = Math.hypot(nx - b.x, nz - b.z);
  }
  b.x = nx;
  b.z = nz;

  // --- 5. Визуал: крен в поворот (по знаку руля и скорости) и фаза качки. ---
  const targetRoll = -turn * BOAT_ROLL_MAX * Math.min(1, spd / BOAT_MAX_FWD);
  const t = Math.min(1, BOAT_ROLL_LERP * dt);
  b.roll += (targetRoll - b.roll) * t;
  b.bob += dt * BOAT_BOB_RATE;

  return moved;
}

/** Курс на точку (для стартовой ориентации носа к центру озера). */
export function boatYawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return yawFromDir(toX - fromX, toZ - fromZ);
}
