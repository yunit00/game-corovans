import { describe, expect, it } from 'vitest';
import { fbm2, smoothstep, valueNoise2D } from '../../src/sim/noise';

describe('noise', () => {
  it('детерминизм: одинаковые входы → одинаковый выход', () => {
    expect(valueNoise2D(3.7, -2.1, 42)).toBe(valueNoise2D(3.7, -2.1, 42));
    expect(fbm2(10.5, 20.25, 7)).toBe(fbm2(10.5, 20.25, 7));
  });

  it('разные сиды → разные поля', () => {
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      if (Math.abs(fbm2(i * 0.7, i * 1.3, 1) - fbm2(i * 0.7, i * 1.3, 2)) > 1e-9) diff++;
    }
    expect(diff).toBeGreaterThan(45);
  });

  it('value noise в [0,1], fbm в [-1,1]', () => {
    for (let i = 0; i < 2000; i++) {
      const x = (i % 50) * 0.37 - 9;
      const y = Math.floor(i / 50) * 0.53 - 11;
      const v = valueNoise2D(x, y, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const f = fbm2(x, y, 5);
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('плавность: соседние точки близки (нет разрывов)', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.211;
      const y = i * 0.173;
      const d = Math.abs(fbm2(x, y, 9) - fbm2(x + 0.01, y, 9));
      expect(d).toBeLessThan(0.06);
    }
  });

  it('smoothstep: края и середина', () => {
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 5)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});
