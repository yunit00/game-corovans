// Выбор целей милишной атаки: сектор перед атакующим. Чистая функция.
export interface MeleeTarget {
  id: number;
  x: number;
  z: number;
  /** Радиус «тела» цели по XZ, м. Дистанция меряется до поверхности капсулы, не до центра. */
  radius?: number;
}

/**
 * Цели в секторе перед атакующим (XZ). Сектор задаётся range + arcDeg.
 *
 * Дальность меряется до ПОВЕРХНОСТИ цели: (dist − radius) <= range. Без вычета
 * радиуса удар «проваливался» по цели, стоящей вплотную, — её центр оказывался
 * дальше range, хотя тела соприкасались (две капсулы радиуса ~0.35 ⇒ центры в
 * ~0.7 м друг от друга). Угол сектора проверяется по направлению на центр цели:
 * у поверхности это направление совпадает с направлением на тело.
 *
 * @param yaw — куда смотрит атакующий (как в yawFromDir: atan2(x, z))
 * @param arcDeg — полный угол сектора
 */
export function selectMeleeTargets(
  ax: number,
  az: number,
  yaw: number,
  range: number,
  arcDeg: number,
  targets: readonly MeleeTarget[],
): number[] {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cosHalf = Math.cos(((arcDeg / 2) * Math.PI) / 180);
  const out: number[] = [];
  for (const t of targets) {
    const dx = t.x - ax;
    const dz = t.z - az;
    const dist = Math.hypot(dx, dz);
    // До поверхности тела: цель вплотную (центр дальше range, но капсулы касаются) — попадание
    const reach = dist - (t.radius ?? 0);
    if (reach > range) continue;
    // Внутри тела цели (или ровно в точке атакующего) — направление неопределимо, бьём
    if (dist < 0.001 || reach <= 0) {
      out.push(t.id);
      continue;
    }
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    if (dot >= cosHalf) out.push(t.id);
  }
  return out;
}
