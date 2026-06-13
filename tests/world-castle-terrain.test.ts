// Терраформинг под замок злодея (пакет villain-castle): плато в юго-восточном
// горном кольце + серпантин-тропа к нему (Terrain.CASTLE, подмешивается в
// Terrain.height). Проверяем: монотонность высоты вдоль тропы, уклон ≤ 25°,
// плоское плато (разброс ≤ 0.5 м), вне зоны замка высота не изменилась.
import { describe, expect, it } from 'vitest';
import { Terrain, CASTLE } from '../src/world/Terrain';
import { fbm2, smoothstep } from '../src/sim/noise';
import { roadDistance, flattenFactor, WORLD_SIZE } from '../src/world/WorldData';

// Производственный конфиг террейна (как в Game.ts).
const SEED = 1337;
function makeTerrain(): Terrain {
  return new Terrain({
    size: WORLD_SIZE,
    segments: 256,
    seed: SEED,
    amplitude: 13,
    noiseScale: 150,
    flattenMask: flattenFactor,
  });
}

/**
 * Базовая высота БЕЗ плато/тропы замка — копия формулы Terrain.baseHeight (приватной)
 * по тем же экспортируемым чистым функциям. Эталон для проверки «вдали высота не
 * изменилась»: там вклад замкового поля должен быть равен нулю.
 */
function baseHeight(x: number, z: number, seed: number): number {
  const n = fbm2(x / 150, z / 150, seed, 4);
  const mask = flattenFactor(x, z);
  let h = n * 13 * mask;
  const d = Math.max(Math.abs(x), Math.abs(z));
  const t = smoothstep(425, 498, d);
  if (t > 0) {
    const roadGap = smoothstep(12, 50, roadDistance(x, z));
    const ridge = fbm2(x / 45, z / 45, seed ^ 0x9e37, 3);
    h += t * t * 95 * roadGap + t * ridge * 14 * roadGap;
  }
  return h;
}

describe('замковый террейн: серпантин-тропа', () => {
  const terrain = makeTerrain();

  it('высота вдоль тропы монотонно растёт (долина → плато)', () => {
    // Сэмплируем центр тропы плотно по длине дуги (по сегментам полилинии).
    const pts = CASTLE.trail;
    const samples: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      for (let s = 0; s <= 1; s += 0.1) {
        const x = a.x + (b.x - a.x) * s;
        const z = a.z + (b.z - a.z) * s;
        samples.push(terrain.height(x, z));
      }
    }
    // Неубывание с малым допуском на дискретизацию углов зигзага.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]! - 0.05);
    }
    // Реально набрали высоту от долины к плато (не плоская «тропа в никуда»).
    // На cheb-d 445 вал ещё пологий (t≈0.18), плато = вал+4 → подъём порядка 8 м.
    expect(samples[samples.length - 1]! - samples[0]!).toBeGreaterThan(5);
  });

  it('уклон вдоль тропы ≤ 25°', () => {
    const pts = CASTLE.trail;
    const STEP = 1.0; // шаг по горизонтали вдоль сегмента, м
    let maxSlopeDeg = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      const dirX = (b.x - a.x) / segLen;
      const dirZ = (b.z - a.z) / segLen;
      let prevY = terrain.height(a.x, a.z);
      for (let d = STEP; d <= segLen; d += STEP) {
        const x = a.x + dirX * d;
        const z = a.z + dirZ * d;
        const y = terrain.height(x, z);
        const slopeDeg = (Math.atan2(Math.abs(y - prevY), STEP) * 180) / Math.PI;
        maxSlopeDeg = Math.max(maxSlopeDeg, slopeDeg);
        prevY = y;
      }
    }
    expect(maxSlopeDeg).toBeLessThanOrEqual(25);
  });
});

describe('замковый террейн: плато', () => {
  const terrain = makeTerrain();

  it('плато плоское — разброс высоты ≤ 0.5 м в радиусе площадки', () => {
    const heights: number[] = [];
    // Сетка точек строго внутри ровной зоны (радиус plateauR минус край).
    const R = CASTLE.plateauR - 6;
    for (let dx = -R; dx <= R; dx += 4) {
      for (let dz = -R; dz <= R; dz += 4) {
        if (Math.hypot(dx, dz) > R) continue;
        heights.push(terrain.height(CASTLE.cx + dx, CASTLE.cz + dz));
      }
    }
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    expect(max - min).toBeLessThanOrEqual(0.5);
  });

  it('плато приподнято на ~plateauLift над базовым валом в центре', () => {
    const top = terrain.height(CASTLE.cx, CASTLE.cz);
    const base = baseHeight(CASTLE.cx, CASTLE.cz, SEED);
    expect(top - base).toBeCloseTo(CASTLE.plateauLift, 1);
  });
});

describe('замковый террейн: вне зоны замка не изменился', () => {
  const terrain = makeTerrain();

  it('вдали от плато и тропы height() == базовая формула', () => {
    // Точки заведомо вне влияния замка (деревня, дворец, спавн, дальние углы).
    const far: [number, number][] = [
      [0, 120], // деревня
      [0, -380], // дворец
      [8, 138], // спавн
      [-400, -400], // противоположный угол
      [200, -200],
      [-300, 300],
      [445, -360], // зеркальный угол того же кольца (далеко от плато (445,360))
    ];
    for (const [x, z] of far) {
      expect(terrain.height(x, z)).toBeCloseTo(baseHeight(x, z, SEED), 6);
    }
  });

  it('детерминирован: те же координаты дают ту же высоту', () => {
    const t2 = makeTerrain();
    expect(t2.height(CASTLE.cx, CASTLE.cz)).toBe(terrain.height(CASTLE.cx, CASTLE.cz));
    expect(t2.height(400, 320)).toBe(terrain.height(400, 320));
  });
});
