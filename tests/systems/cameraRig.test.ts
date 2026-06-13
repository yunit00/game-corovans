import { describe, expect, it } from 'vitest';
import { AIM_SHOULDER, stepAimWeight } from '../../src/systems/CameraRig';

const STEP = 1 / 60;

describe('stepAimWeight', () => {
  it('0 при выключенном прицеле остаётся 0', () => {
    expect(stepAimWeight(0, 0, STEP)).toBe(0);
  });

  it('растёт к 1 при включённом прицеле, но не превышает 1', () => {
    let w = 0;
    for (let i = 0; i < 60; i++) w = stepAimWeight(w, 1, STEP);
    expect(w).toBeGreaterThan(0.9);
    expect(w).toBeLessThanOrEqual(1);
  });

  it('монотонно растёт к цели 1', () => {
    let w = 0;
    let prev = -1;
    for (let i = 0; i < 30; i++) {
      w = stepAimWeight(w, 1, STEP);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it('падает обратно к 0 при отпускании прицела', () => {
    let w = 1;
    for (let i = 0; i < 60; i++) w = stepAimWeight(w, 0, STEP);
    expect(w).toBeLessThan(0.1);
    expect(w).toBeGreaterThanOrEqual(0);
  });

  it('кламп: даже большой dt не выбрасывает вес за [0,1]', () => {
    expect(stepAimWeight(0.9, 1, 10)).toBe(1);
    expect(stepAimWeight(0.1, 0, 10)).toBe(0);
  });

  it('переход за плечо ощутимо быстрый: ~0.12 с до >0.6 веса', () => {
    let w = 0;
    // 8 шагов по 1/60 ≈ 0.13 с
    for (let i = 0; i < 8; i++) w = stepAimWeight(w, 1, STEP);
    expect(w).toBeGreaterThan(0.6);
  });

  it('боковой сдвиг положителен (за правое плечо)', () => {
    expect(AIM_SHOULDER).toBeGreaterThan(0);
  });
});
