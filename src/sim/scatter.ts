// Детерминированный скаттер растительности: джиттер-сетка + шумовая маска плотности.
import { mulberry32 } from '../core/rng';
import { fbm2 } from './noise';

export interface ScatterSpec {
  /** Уникальный id категории — участвует в сабсиде. */
  id: string;
  /** Число вариантов модели. */
  variants: number;
  /** Шаг сетки, м (≈ среднее расстояние между объектами). */
  cell: number;
  /** Порог шумовой маски [0..1]: выше — реже. */
  threshold: number;
  /** Период шума плотности, м. */
  noiseScale: number;
  /** Высота объекта, м (диапазон). */
  minH: number;
  maxH: number;
}

export interface ScatterInstance {
  x: number;
  z: number;
  rot: number;
  height: number;
  variant: number;
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function generateScatter(
  seed: number,
  size: number,
  spec: ScatterSpec,
  isClear: (x: number, z: number) => boolean,
): ScatterInstance[] {
  const rng = mulberry32((seed ^ hashId(spec.id)) >>> 0);
  const out: ScatterInstance[] = [];
  const n = Math.floor(size / spec.cell);
  const half = size / 2;
  for (let gx = 0; gx < n; gx++) {
    for (let gz = 0; gz < n; gz++) {
      // RNG тратится на каждую ячейку одинаково — детерминизм не зависит от масок
      const jx = rng();
      const jz = rng();
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      const x = -half + (gx + 0.1 + jx * 0.8) * spec.cell;
      const z = -half + (gz + 0.1 + jz * 0.8) * spec.cell;
      const density = (fbm2(x / spec.noiseScale, z / spec.noiseScale, seed ^ hashId(spec.id)) + 1) / 2;
      if (density < spec.threshold) continue;
      if (!isClear(x, z)) continue;
      out.push({
        x,
        z,
        rot: r1 * Math.PI * 2,
        height: spec.minH + r2 * (spec.maxH - spec.minH),
        variant: Math.min(spec.variants - 1, Math.floor(r3 * spec.variants)),
      });
    }
  }
  return out;
}
