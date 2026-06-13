// Чистая 2D-геометрия (плоскость XZ).
export interface P2 {
  x: number;
  z: number;
}

export function distToSegment(p: P2, a: P2, b: P2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apz = p.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (apx * abx + apz * abz) / len2));
  const dx = p.x - (a.x + abx * t);
  const dz = p.z - (a.z + abz * t);
  return Math.hypot(dx, dz);
}

export function distToPolyline(p: P2, pts: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = distToSegment(p, pts[i]!, pts[i + 1]!);
    if (d < best) best = d;
  }
  return best;
}

/** Точка на полилинии на расстоянии s от начала (по длине дуги) + направление. */
export function pointAlongPolyline(
  pts: readonly P2[],
  s: number,
): { x: number; z: number; dirX: number; dirZ: number; done: boolean } {
  let rest = s;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (rest <= segLen || i === pts.length - 2) {
      const t = segLen === 0 ? 0 : Math.min(1, rest / segLen);
      const dirX = segLen === 0 ? 1 : (b.x - a.x) / segLen;
      const dirZ = segLen === 0 ? 0 : (b.z - a.z) / segLen;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        dirX,
        dirZ,
        done: i === pts.length - 2 && rest >= segLen,
      };
    }
    rest -= segLen;
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, z: last.z, dirX: 1, dirZ: 0, done: true };
}

export function polylineLength(pts: readonly P2[]): number {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    len += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.z - pts[i]!.z);
  }
  return len;
}
