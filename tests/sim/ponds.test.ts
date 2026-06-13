import { describe, expect, it } from 'vitest';
import { findPondSites } from '../../src/world/Ponds';
import { Terrain } from '../../src/world/Terrain';
import { findFortPos } from '../../src/world/VillainFort';
import { flattenFactor, isClear, PALACE, VILLAGE, WORLD_SIZE } from '../../src/world/WorldData';

/** Тот же террейн, что собирает Game (seed 42, amplitude 13). */
function makeTerrain(seed = 42): Terrain {
  return new Terrain({
    size: WORLD_SIZE,
    segments: 256,
    seed,
    amplitude: 13,
    noiseScale: 150,
    flattenMask: flattenFactor,
  });
}

describe('findPondSites', () => {
  it('детерминированно при одном seed: те же низины', () => {
    const t = makeTerrain(42);
    const fort = findFortPos(t);
    const a = findPondSites(t, fort);
    const b = findPondSites(t, fort);
    expect(a).toEqual(b);
  });

  it('находит до трёх прудов', () => {
    const t = makeTerrain(42);
    const sites = findPondSites(t, findFortPos(t));
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(sites.length).toBeLessThanOrEqual(3);
  });

  it('пруды разнесены по карте (попарная дистанция > 150 м)', () => {
    const t = makeTerrain(42);
    const sites = findPondSites(t, findFortPos(t));
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const d = Math.hypot(sites[i]!.x - sites[j]!.x, sites[i]!.z - sites[j]!.z);
        expect(d).toBeGreaterThan(150);
      }
    }
  });

  it('пруды далеко от деревни/дворца/форта (> 60 м) и на свободном месте', () => {
    const t = makeTerrain(42);
    const fort = findFortPos(t);
    const sites = findPondSites(t, fort);
    for (const p of sites) {
      expect(Math.hypot(p.x - VILLAGE.x, p.z - VILLAGE.z)).toBeGreaterThan(60);
      expect(Math.hypot(p.x - PALACE.x, p.z - PALACE.z)).toBeGreaterThan(60);
      expect(Math.hypot(p.x - fort.x, p.z - fort.z)).toBeGreaterThan(60);
      expect(isClear(p.x, p.z, 25)).toBe(true);
    }
  });

  it('минимумы выбраны по глубине: дно пруда не выше высоты рельефа в его центре', () => {
    const t = makeTerrain(42);
    const sites = findPondSites(t, findFortPos(t));
    for (const p of sites) {
      // bowlMin ищет минимум в коробке — он не может быть выше центра клетки
      expect(p.minHeight).toBeLessThanOrEqual(t.height(p.x, p.z) + 1e-6);
    }
  });

  it('другой seed даёт другой рельеф → другие низины', () => {
    const a = findPondSites(makeTerrain(42), { x: 9999, z: 9999 });
    const b = findPondSites(makeTerrain(7), { x: 9999, z: 9999 });
    // Хотя бы один центр отличается (рельеф полностью пересеян)
    const same = a.length === b.length && a.every((p, i) => p.x === b[i]!.x && p.z === b[i]!.z);
    expect(same).toBe(false);
  });
});
