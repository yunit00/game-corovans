import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { planRaid, planRaidOfSize, raidBudget, type RaidWave } from '../../src/sim/raid';

const totalUnits = (waves: RaidWave[]): number =>
  waves.reduce((s, w) => s + w.units.reduce((u, e) => u + e.count, 0), 0);

const archetypes = (waves: RaidWave[]): string[] =>
  waves.flatMap((w) => w.units.map((u) => u.archetype));

describe('raidBudget', () => {
  it('растёт с difficulty и капится на 16', () => {
    expect(raidBudget(1)).toBe(6);
    expect(raidBudget(2)).toBe(8);
    expect(raidBudget(3)).toBe(10);
    expect(raidBudget(5)).toBe(14);
    expect(raidBudget(6)).toBe(16);
    expect(raidBudget(100)).toBe(16); // кап
    for (let d = 1; d < 20; d++) {
      expect(raidBudget(d + 1)).toBeGreaterThanOrEqual(raidBudget(d)); // монотонность
    }
  });
});

describe('planRaid', () => {
  it('детерминизм: одинаковый сид → одинаковый план', () => {
    for (let d = 1; d <= 6; d++) {
      const a = planRaid(d, mulberry32(42));
      const b = planRaid(d, mulberry32(42));
      expect(a).toEqual(b);
    }
  });

  it('сумма юнитов по волнам == raidBudget(difficulty)', () => {
    for (let d = 1; d <= 8; d++) {
      for (let seed = 0; seed < 50; seed++) {
        expect(totalUnits(planRaid(d, mulberry32(seed)))).toBe(raidBudget(d));
      }
    }
  });

  it('волн 1–3, с d3 всегда несколько; delaySec неубывающие из {0,20,40}', () => {
    for (let d = 1; d <= 8; d++) {
      for (let seed = 0; seed < 50; seed++) {
        const waves = planRaid(d, mulberry32(seed));
        expect(waves.length).toBeGreaterThanOrEqual(1);
        expect(waves.length).toBeLessThanOrEqual(3);
        if (d >= 3) expect(waves.length).toBeGreaterThanOrEqual(2);
        expect(waves[0]!.delaySec).toBe(0); // первая волна — сразу
        for (let i = 0; i < waves.length; i++) {
          expect([0, 20, 40]).toContain(waves[i]!.delaySec);
          if (i > 0) expect(waves[i]!.delaySec).toBeGreaterThanOrEqual(waves[i - 1]!.delaySec);
        }
      }
    }
  });

  it('все счётчики юнитов > 0, волны непустые', () => {
    for (let d = 1; d <= 8; d++) {
      for (let seed = 0; seed < 50; seed++) {
        for (const wave of planRaid(d, mulberry32(seed))) {
          expect(wave.units.length).toBeGreaterThan(0);
          for (const unit of wave.units) expect(unit.count).toBeGreaterThan(0);
        }
      }
    }
  });

  it('d1 — только skeleton_raider, без brute и стражи', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const a of archetypes(planRaid(1, mulberry32(seed)))) {
        expect(a).toBe('skeleton_raider');
      }
    }
  });

  it('d2 — только скелеты (стражи нет), brute иногда примешивается', () => {
    let sawBrute = false;
    for (let seed = 0; seed < 200; seed++) {
      for (const a of archetypes(planRaid(2, mulberry32(seed)))) {
        expect(a.startsWith('skeleton_')).toBe(true);
        if (a === 'skeleton_brute') sawBrute = true;
      }
    }
    expect(sawBrute).toBe(true);
  });

  it('planRaidOfSize: одна волна без задержки, ровно size скелетов', () => {
    for (const size of [1, 3, 4, 12, 16]) {
      const waves = planRaidOfSize(size);
      expect(waves.length).toBe(1);
      expect(waves[0]!.delaySec).toBe(0);
      expect(totalUnits(waves)).toBe(size);
      for (const a of archetypes(waves)) expect(a.startsWith('skeleton_')).toBe(true);
      for (const u of waves[0]!.units) expect(u.count).toBeGreaterThan(0);
    }
    expect(archetypes(planRaidOfSize(12))).toContain('skeleton_brute'); // каждый четвёртый
  });

  it('d3+ может содержать стражу дворца, и она идёт отдельной волной', () => {
    let sawGuard = false;
    for (let seed = 0; seed < 200; seed++) {
      const waves = planRaid(3, mulberry32(seed));
      for (const wave of waves) {
        const kinds = new Set(wave.units.map((u) => u.archetype.split('_')[0]));
        expect(kinds.size).toBe(1); // волна не смешивает фракции
        if (kinds.has('guard')) sawGuard = true;
      }
    }
    expect(sawGuard).toBe(true);
  });
});
