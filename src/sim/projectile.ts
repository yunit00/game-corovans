// Чистая баллистика стрел: интеграция полёта и пересечение сегмента со сферой.

/**
 * Летальность стрелы по цели (Фаза 6.6, доводка стрельбы). Стрел конечное число —
 * это и есть баланс, поэтому одна стрела решает: рядовой враг (HP ≤ lethalMaxHp)
 * падает с ОДНОГО попадания, громила (HP > lethalMaxHp) — с ДВУХ (каждая стрела
 * снимает половину его maxHp с запасом). Чистая функция: только числа, тест в node.
 *
 * @param targetMaxHp — максимум HP цели (рядовые ≤ lethalMaxHp, громилы выше).
 * @param lethalMaxHp — порог рядовых из данных арбалета (WeaponDef.lethalMaxHp).
 * @returns урон, гарантированно убивающий рядового за 1 стрелу и громилу за 2.
 */
export function arrowKillDamage(targetMaxHp: number, lethalMaxHp: number): number {
  if (targetMaxHp <= lethalMaxHp) return targetMaxHp; // ваншот рядового
  // Громила: половина maxHp + 1 — две стрелы наверняка добивают (2·(hp/2+1) > hp).
  return Math.ceil(targetMaxHp / 2) + 1;
}

export interface ProjState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Шаг семи-неявного Эйлера: сначала скорость, потом позиция. Не мутирует вход. */
export function stepProjectile(p: ProjState, dt: number, gravity = -9.81): ProjState {
  const vy = p.vy + gravity * dt;
  return {
    x: p.x + p.vx * dt,
    y: p.y + vy * dt,
    z: p.z + p.vz * dt,
    vx: p.vx,
    vy,
    vz: p.vz,
  };
}

/**
 * Точка входа сегмента AB в сферу (центр C, радиус r): t ∈ [0,1] или null при промахе.
 * Решает |A + t·(B−A) − C|² = r², берёт меньший корень (вход).
 * Старт внутри сферы (или ровно на поверхности) → 0; касание (дистанция ровно r) считается попаданием.
 */
export function segmentSphereHit(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const mx = ax - cx;
  const my = ay - cy;
  const mz = az - cz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0; // старт внутри сферы
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return null; // вырожденный сегмент вне сферы
  const b = mx * dx + my * dy + mz * dz;
  const disc = b * b - a * c;
  if (disc < 0) return null; // прямая мимо сферы
  const t = (-b - Math.sqrt(disc)) / a; // меньший корень — точка входа
  return t >= 0 && t <= 1 ? t : null;
}
