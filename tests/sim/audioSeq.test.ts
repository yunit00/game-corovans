import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import {
  buildPhrase,
  DEFAULT_PHRASE,
  semitoneRatio,
  SYL_DUR_MS,
  SYL_GAP_MS,
  SYL_JITTER,
} from '../../src/sim/audioSeq';

describe('semitoneRatio', () => {
  it('0 — унисон, 12 — октава, 7 — чистая квинта', () => {
    expect(semitoneRatio(0)).toBe(1);
    expect(semitoneRatio(12)).toBe(2);
    expect(semitoneRatio(7)).toBeCloseTo(1.4983, 3);
  });
});

describe('buildPhrase', () => {
  it('детерминизм: одинаковый seed — одинаковая фраза', () => {
    expect(buildPhrase(mulberry32(3))).toEqual(buildPhrase(mulberry32(3)));
  });

  it('число слогов, длительности и паузы в заявленных диапазонах', () => {
    for (let seed = 0; seed < 50; seed++) {
      const syls = buildPhrase(mulberry32(seed));
      expect(syls.length).toBeGreaterThanOrEqual(DEFAULT_PHRASE.minSyllables);
      expect(syls.length).toBeLessThanOrEqual(DEFAULT_PHRASE.maxSyllables);
      for (const s of syls) {
        expect(s.durMs).toBeGreaterThanOrEqual(SYL_DUR_MS.min);
        expect(s.durMs).toBeLessThanOrEqual(SYL_DUR_MS.max);
        expect(s.gapMs).toBeGreaterThanOrEqual(SYL_GAP_MS.min);
        expect(s.gapMs).toBeLessThanOrEqual(SYL_GAP_MS.max);
        // Питч слога = контур × джиттер — в пределах джиттера вокруг контура
        expect(s.pitchMul).toBeGreaterThanOrEqual(s.contour * SYL_JITTER.min);
        expect(s.pitchMul).toBeLessThanOrEqual(s.contour * SYL_JITTER.max);
      }
    }
  });

  it('интонация: контур стартует с 1 и монотонно идёт вверх (endRise) или вниз', () => {
    const up = buildPhrase(mulberry32(5), { minSyllables: 5, maxSyllables: 7, endRise: true });
    expect(up[0]!.contour).toBe(1);
    for (let i = 1; i < up.length; i++) expect(up[i]!.contour).toBeGreaterThan(up[i - 1]!.contour);
    expect(up[up.length - 1]!.contour).toBeGreaterThan(1);

    const down = buildPhrase(mulberry32(6), { minSyllables: 5, maxSyllables: 7, endRise: false });
    expect(down[0]!.contour).toBe(1);
    for (let i = 1; i < down.length; i++) expect(down[i]!.contour).toBeLessThan(down[i - 1]!.contour);
    expect(down[down.length - 1]!.contour).toBeLessThan(1);
  });
});
