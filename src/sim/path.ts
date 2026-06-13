// Чистое движение по полилинии дороги (плоскость XZ): предрасчёт длин дуги,
// позиция/направление на расстоянии s от начала. Для корованов на тракте.

export interface PathPoint {
  x: number;
  z: number;
}

export interface Path {
  points: readonly PathPoint[];
  /** cumLen[i] — длина дуги от начала до i-й точки; cumLen[0] = 0. */
  cumLen: readonly number[];
  /** Полная длина маршрута (= cumLen последней точки). */
  total: number;
}

/** Предрасчёт длин дуги, чтобы posAt не считал hypot по всем сегментам каждый кадр. */
export function buildPath(points: readonly PathPoint[]): Path {
  const cumLen: number[] = new Array(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
    }
    cumLen[i] = total;
  }
  return { points, cumLen, total };
}

/**
 * Позиция и направление на расстоянии s метров от начала; s клампится в [0, total].
 * Пишет в out и возвращает его же — без аллокаций, можно звать каждый кадр.
 * Нулевые сегменты (точки-дубликаты подряд) пропускаются, чтобы dir не давал NaN;
 * на стыке сегментов возвращается направление входящего сегмента.
 * Точек в дороге < 30, поэтому линейный проход дешевле бинарного поиска по cumLen.
 */
export function posAt(
  path: Path,
  s: number,
  out: { x: number; z: number; dirX: number; dirZ: number },
): typeof out {
  const pts = path.points;
  const cum = path.cumLen;
  const sc = Math.min(path.total, Math.max(0, s));
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = cum[i + 1]! - cum[i]!; // = |b−a|, т.к. cumLen построен по евклидовым длинам
    if (len > 0 && sc <= cum[i + 1]!) {
      const t = (sc - cum[i]!) / len;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      out.x = a.x + (b.x - a.x) * t;
      out.z = a.z + (b.z - a.z) * t;
      out.dirX = (b.x - a.x) / len;
      out.dirZ = (b.z - a.z) / len;
      return out;
    }
  }
  // Вырожденный маршрут (0–1 точка или все точки совпадают): стоим на месте, dir — заглушка.
  const p0 = pts[0];
  out.x = p0 ? p0.x : 0;
  out.z = p0 ? p0.z : 0;
  out.dirX = 1;
  out.dirZ = 0;
  return out;
}

/** Обратный маршрут (возврат тем же трактом). Зовётся редко — аллокации допустимы. */
export function reversePath(path: Path): Path {
  const pts: PathPoint[] = [];
  for (let i = path.points.length - 1; i >= 0; i--) {
    const p = path.points[i]!;
    pts.push({ x: p.x, z: p.z });
  }
  return buildPath(pts);
}
