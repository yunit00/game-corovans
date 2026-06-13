// Чистый стиринг AI в плоскости XZ: из позиций и целей считаем желаемую скорость (м/с).
// Только числа и plain-объекты — Three/Rapier сюда не попадают, модуль тестируется в node.
// Все функции пишут результат в out-параметр и возвращают его же: вызывающий держит
// скретч-объекты (как в ProjectileSystem), и фикс-цикл AI не аллоцирует.

export interface Steer {
  x: number;
  z: number;
}

/** Желаемая скорость прямо на цель с полным ходом. Совпадение с целью → ноль (не NaN). */
export function seek(px: number, pz: number, tx: number, tz: number, maxSpeed: number, out: Steer): Steer {
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  out.x = (dx / dist) * maxSpeed;
  out.z = (dz / dist) * maxSpeed;
  return out;
}

/**
 * Как seek, но внутри slowRadius скорость линейно падает до нуля в цели —
 * иначе агент бесконечно «перепрыгивает» цель и дёргается вокруг неё.
 */
export function arrive(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  maxSpeed: number,
  slowRadius: number,
  out: Steer,
): Steer {
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist === 0) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  // slowRadius <= 0 означает «без торможения» — деление на ноль не допускаем
  const speed = slowRadius > 0 ? maxSpeed * Math.min(1, dist / slowRadius) : maxSpeed;
  out.x = (dx / dist) * speed;
  out.z = (dz / dist) * speed;
  return out;
}

/**
 * Как arrive, но цель — не точка, а кольцо радиуса stopDist вокруг (tx, tz):
 * агент идёт к поверхности «тела» цели и ОСТАНАВЛИВАЕТСЯ на stopDist, а не лезет
 * в центр. Нужно для chase: тело игрока — KCC и теперь игнорирует кинематические
 * капсулы (не выталкивается ими), поэтому остановить NPC у тела игрока должен сам
 * стиринг, иначе капсула NPC въедет в игрока. stopDist = сумма радиусов капсул
 * (плюс зазор). Внутри stopDist желание нулевое (агент уже «на месте»), в кольце
 * [stopDist, stopDist+slowRadius] скорость линейно растёт от 0 до maxSpeed.
 */
export function arriveStop(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  maxSpeed: number,
  stopDist: number,
  slowRadius: number,
  out: Steer,
): Steer {
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  // Уже на стоп-кольце или внутри него — стоим (и не делим на ноль)
  if (dist <= stopDist || dist === 0) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  // Остаточная дистанция до кольца; тормозим на последних slowRadius метрах
  const rem = dist - stopDist;
  const speed = slowRadius > 0 ? maxSpeed * Math.min(1, rem / slowRadius) : maxSpeed;
  out.x = (dx / dist) * speed;
  out.z = (dz / dist) * speed;
  return out;
}

/**
 * Отталкивание от соседей ближе radius: вклад каждого ∝ 1/dist по направлению «от соседа»,
 * поэтому ближний давит сильнее дальнего. Итог клампится длиной maxPush.
 * Сосед ровно в нашей точке (dist = 0) не даёт направления — толкаем по +X на полную силу:
 * сторона произвольна, важно, что агенты расходятся и нет NaN.
 */
export function separation(
  px: number,
  pz: number,
  neighbors: readonly { x: number; z: number }[],
  radius: number,
  maxPush: number,
  out: Steer,
): Steer {
  let x = 0;
  let z = 0;
  for (const n of neighbors) {
    const dx = px - n.x;
    const dz = pz - n.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= radius) continue;
    if (dist === 0) {
      x += maxPush;
      continue;
    }
    // нормированное направление (dx/dist) с весом 1/dist → итого делим на dist²
    x += dx / (dist * dist);
    z += dz / (dist * dist);
  }
  const len = Math.hypot(x, z);
  if (len > maxPush && len !== 0) {
    const k = maxPush / len;
    x *= k;
    z *= k;
  }
  out.x = x;
  out.z = z;
  return out;
}

/**
 * Детерминированный угол «слота» атакующего вокруг цели (радианы, конвенция atan2(x, z)).
 * Атакующие распределяются по кольцу золотым углом по своему id: соседние id уходят
 * в разные сектора, кольцо заполняется равномерно при любом числе бойцов — без общего
 * счётчика и без согласования между NPC. Без этого 3+ NPC в attack встают в одну точку
 * у цели и слипаются. baseAngle поворачивает всё кольцо; AISystem передаёт 0 (слоты
 * абсолютны в мире), чтобы точка стояния не зависела от текущего пеленга и боец сходился
 * к ней, а не орбитировал вокруг цели.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39968 рад

export function attackSlotAngle(id: number, baseAngle: number): number {
  return baseAngle + id * GOLDEN_ANGLE;
}

/**
 * Точка стояния атакующего: на кольце standoff вокруг цели под углом slotAngle.
 * standoff берётся чуть меньше дальности удара (вызывающий передаёт уже сжатое
 * значение), чтобы боец на своём слоте доставал до цели. Пишет результат в out.
 * Конвенция направления — atan2(x, z): x = sin(angle), z = cos(angle).
 */
export function attackStandoff(
  tx: number,
  tz: number,
  slotAngle: number,
  standoff: number,
  out: Steer,
): Steer {
  out.x = tx + Math.sin(slotAngle) * standoff;
  out.z = tz + Math.cos(slotAngle) * standoff;
  return out;
}

/**
 * Объезд препятствий лучами: центральный луч по нормированной скорости на lookAhead вперёд.
 * Попали — уклоняемся перпендикулярно скорости, сторону выбираем «усами» ±30°
 * (уходим туда, где свободнее), сила ∝ (1 − dist/lookAhead) и масштабируется
 * текущей скоростью — быстрому агенту нужен более резкий манёвр.
 * castRay возвращает дистанцию до препятствия вдоль луча или null при промахе.
 */
export function avoidObstacles(
  px: number,
  pz: number,
  vx: number,
  vz: number,
  lookAhead: number,
  castRay: (ox: number, oz: number, dx: number, dz: number, maxDist: number) => number | null,
  out: Steer,
): Steer {
  out.x = 0;
  out.z = 0;
  const speed = Math.hypot(vx, vz);
  // стоим на месте или смотреть некуда — уклоняться не от чего (и не делим на ноль)
  if (speed === 0 || lookAhead <= 0) return out;
  const dx = vx / speed;
  const dz = vz / speed;
  const hit = castRay(px, pz, dx, dz, lookAhead);
  if (hit === null) return out;
  // на краю lookAhead сила 0, вплотную — 1; кламп страхует от hit вне [0, lookAhead]
  const strength = Math.min(1, Math.max(0, 1 - hit / lookAhead));
  // Поворот вокруг Y, конвенция как в movement.ts: x' = x·cos + z·sin, z' = −x·sin + z·cos
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  const plus = castRay(px, pz, dx * cos30 + dz * sin30, -dx * sin30 + dz * cos30, lookAhead);
  const minus = castRay(px, pz, dx * cos30 - dz * sin30, dx * sin30 + dz * cos30, lookAhead);
  // null = луч свободен; при равенстве берём сторону +30° — выбор должен быть детерминирован,
  // иначе агент дрожит между сторонами от кадра к кадру
  const side = (plus ?? Infinity) >= (minus ?? Infinity) ? 1 : -1;
  // перпендикуляр со стороны +30° — это поворот скорости на +90°: (dz, −dx)
  const push = strength * speed;
  out.x = side * dz * push;
  out.z = side * -dx * push;
  return out;
}

/**
 * Взвешенная сумма стирингов с клампом длины до maxSpeed — итоговая желаемая скорость.
 * Сумма копится в локалах, out пишется в конце — он может совпадать с одним из parts[i].s.
 */
export function combineSteering(
  parts: readonly { s: Steer; w: number }[],
  maxSpeed: number,
  out: Steer,
): Steer {
  let x = 0;
  let z = 0;
  for (const p of parts) {
    x += p.s.x * p.w;
    z += p.s.z * p.w;
  }
  const len = Math.hypot(x, z);
  if (len > maxSpeed && len !== 0) {
    const k = maxSpeed / len;
    x *= k;
    z *= k;
  }
  out.x = x;
  out.z = z;
  return out;
}
