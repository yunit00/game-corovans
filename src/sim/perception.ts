// Восприятие AI: конус зрения + раунд-робин бюджета проверок. Чистые функции.

/** Конус зрения NPC. */
export interface PerceptionParams {
  /** Дальность обнаружения. */
  range: number;
  /** Полный угол конуса зрения. */
  fovDeg: number;
}

/**
 * Видит/слышит ли наблюдатель цель: дистанция <= range и цель внутри сектора
 * fovDeg вокруг yaw. Вблизи (< range * 0.2) цель «слышно» на 360° — конус не
 * применяется, иначе можно безнаказанно стоять у NPC за спиной вплотную.
 *
 * @param yaw — куда смотрит наблюдатель (как в yawFromDir: atan2(x, z),
 *              та же конвенция, что у selectMeleeTargets в sim/melee.ts)
 */
export function inPerceptionCone(
  px: number,
  pz: number,
  yaw: number,
  params: PerceptionParams,
  tx: number,
  tz: number,
): boolean {
  const dx = tx - px;
  const dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist > params.range) return false;
  // «Слух»: вблизи направление взгляда не важно (заодно покрывает dist≈0,
  // где направление на цель не определено).
  if (dist < params.range * 0.2) return true;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cosHalf = Math.cos(((params.fovDeg / 2) * Math.PI) / 180);
  const dot = (dx / dist) * fx + (dz / dist) * fz;
  return dot >= cosHalf;
}

/**
 * Раунд-робин: какие индексы NPC проверять в этот тик. Окно из min(budget, total)
 * индексов, смещение (tick * budget) % total, с заворачиванием по модулю —
 * за ceil(total / budget) тиков каждый NPC проверяется хотя бы раз.
 * Пишет в out (length=0 + push) и возвращает его же — вызывается каждый
 * фикс-тик, массив-скретч держит вызывающий, чтобы не аллоцировать.
 */
export function roundRobinIndices(tick: number, total: number, budget: number, out: number[]): number[] {
  out.length = 0;
  if (total <= 0 || budget <= 0) return out;
  const count = Math.min(budget, total);
  const offset = (tick * budget) % total;
  for (let i = 0; i < count; i++) out.push((offset + i) % total);
  return out;
}
