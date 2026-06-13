import { describe, expect, it } from 'vitest';
import { compassDir, lookoutSummary, type LookoutInput } from '../../src/sim/towerLookout';

const TOWER = { x: 0, z: 0 };

describe('compassDir', () => {
  it('-z — север, +x — восток, +z — юг, -x — запад', () => {
    expect(compassDir(0, -10)).toBe('к северу');
    expect(compassDir(10, 0)).toBe('к востоку');
    expect(compassDir(0, 10)).toBe('к югу');
    expect(compassDir(-10, 0)).toBe('к западу');
  });

  it('диагонали', () => {
    expect(compassDir(10, -10)).toBe('к северо-востоку');
    expect(compassDir(-10, 10)).toBe('к юго-западу');
  });

  it('нулевой вектор — «рядом»', () => {
    expect(compassDir(0, 0)).toBe('рядом');
  });
});

describe('lookoutSummary', () => {
  it('активный корован: тир и направление от башни', () => {
    const input: LookoutInput = {
      active: { tier: 'royal', x: 0, z: -100 },
      next: null,
      raidActive: false,
      tower: TOWER,
    };
    const s = lookoutSummary(input);
    expect(s).toContain('королевский');
    expect(s).toContain('к северу');
  });

  it('активный корован приоритетнее планового', () => {
    const input: LookoutInput = {
      active: { tier: 'merchant', x: 50, z: 0 },
      next: { tier: 'royal', secondsLeft: 30 },
      raidActive: false,
      tower: TOWER,
    };
    const s = lookoutSummary(input);
    expect(s).toContain('купеческий');
    expect(s).toContain('к востоку');
    expect(s).not.toContain('выйдет');
  });

  it('нет активного — показывает плановый c ETA', () => {
    const input: LookoutInput = {
      active: null,
      next: { tier: 'poor', secondsLeft: 90 },
      raidActive: false,
      tower: TOWER,
    };
    const s = lookoutSummary(input);
    expect(s).toContain('бедняцкий');
    expect(s).toContain('выйдет');
  });

  it('ни активного, ни планового — «тихо»', () => {
    const input: LookoutInput = { active: null, next: null, raidActive: false, tower: TOWER };
    expect(lookoutSummary(input)).toContain('тихо');
  });

  it('набег добавляет тревожную фразу', () => {
    const input: LookoutInput = { active: null, next: null, raidActive: true, tower: TOWER };
    const s = lookoutSummary(input);
    expect(s).toContain('тихо');
    expect(s).toContain('набег');
  });

  it('без набега тревоги нет', () => {
    const input: LookoutInput = {
      active: null,
      next: { tier: 'poor', secondsLeft: 10 },
      raidActive: false,
      tower: TOWER,
    };
    expect(lookoutSummary(input)).not.toContain('набег');
  });
});
