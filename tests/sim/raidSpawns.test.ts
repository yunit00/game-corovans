import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { waveSpawnPoints } from '../../src/sim/raidSpawns';

const CX = 0;
const CZ = 120;

describe('waveSpawnPoints', () => {
  it('детерминизм: одинаковый сид → одинаковые точки', () => {
    const a = waveSpawnPoints(8, CX, CZ, Math.PI / 2, Math.PI, 40, 60, mulberry32(7));
    const b = waveSpawnPoints(8, CX, CZ, Math.PI / 2, Math.PI, 40, 60, mulberry32(7));
    expect(a).toEqual(b);
  });

  it('count точек, все в кольце [rMin, rMax] от центра', () => {
    for (let seed = 0; seed < 30; seed++) {
      const pts = waveSpawnPoints(12, CX, CZ, Math.PI / 2, Math.PI, 40, 60, mulberry32(seed));
      expect(pts.length).toBe(12);
      for (const p of pts) {
        const d = Math.hypot(p.x - CX, p.z - CZ);
        expect(d).toBeGreaterThanOrEqual(40 - 1e-9);
        expect(d).toBeLessThanOrEqual(60 + 1e-9);
      }
    }
  });

  it('азимуты не выходят из сектора (джиттер в полслота)', () => {
    const azFrom = Math.PI / 2;
    const azTo = Math.PI;
    for (let seed = 0; seed < 30; seed++) {
      for (const p of waveSpawnPoints(6, CX, CZ, azFrom, azTo, 40, 60, mulberry32(seed))) {
        const az = Math.atan2(p.x - CX, p.z - CZ);
        expect(az).toBeGreaterThanOrEqual(azFrom - 1e-9);
        expect(az).toBeLessThanOrEqual(azTo + 1e-9);
      }
    }
  });

  it('точки размазаны по дуге, а не слиплись в одной (слоты)', () => {
    const pts = waveSpawnPoints(6, CX, CZ, Math.PI / 2, Math.PI, 40, 60, mulberry32(1));
    const azs = pts.map((p) => Math.atan2(p.x - CX, p.z - CZ));
    for (let i = 1; i < azs.length; i++) expect(azs[i]!).toBeGreaterThan(azs[i - 1]!);
  });

  it('count <= 0 — пустой список', () => {
    expect(waveSpawnPoints(0, CX, CZ, 0, 1, 40, 60, mulberry32(1))).toEqual([]);
  });
});
