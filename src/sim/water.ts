// Чистая геометрия водоёмов: маска «точка в воде/буфере берега».
// Используется лесом, чтобы НЕ сажать деревья в прудах и в полосе берега, не
// меняя порядок вызовов rng (фильтрация по предикату, как исключение дорог).

/** Круглый водоём: центр и радиус водной глади, м. */
export interface WaterDisc {
  x: number;
  z: number;
  r: number;
}

/**
 * Предикат «точка внутри воды или в буфере берега» хотя бы одного пруда.
 * Буфер — полоса вокруг кромки (3 м по умолчанию), чтобы кроны не нависали над
 * водой. Чистая функция: те же входы → тот же результат (node-тестируемо).
 */
export function inPondWater(
  discs: readonly WaterDisc[],
  buffer: number,
): (x: number, z: number) => boolean {
  return (x, z) => {
    for (const d of discs) {
      const dx = x - d.x;
      const dz = z - d.z;
      if (dx * dx + dz * dz < (d.r + buffer) * (d.r + buffer)) return true;
    }
    return false;
  };
}
