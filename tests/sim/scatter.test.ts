import { describe, expect, it } from 'vitest';
import { generateScatter, type ScatterSpec } from '../../src/sim/scatter';
import { isClear, WORLD_SIZE } from '../../src/world/WorldData';

const SPEC: ScatterSpec = {
  id: 'pine',
  variants: 5,
  cell: 9.5,
  threshold: 0.46,
  noiseScale: 130,
  minH: 7,
  maxH: 12,
};

describe('scatter', () => {
  it('детерминирован сидом', () => {
    const a = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    const b = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    expect(a.length).toBe(b.length);
    expect(a[100]).toEqual(b[100]);
  });

  it('другой сид — другой лес', () => {
    const a = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    const b = generateScatter(43, WORLD_SIZE, SPEC, isClear);
    expect(a.length).not.toBe(b.length);
  });

  it('лес густой, но не бесконечный (2000–7000 сосен)', () => {
    const a = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    expect(a.length).toBeGreaterThan(2000);
    expect(a.length).toBeLessThan(7000);
  });

  it('ни одного дерева на дорогах/в деревне/во дворце', () => {
    const a = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    for (const inst of a) {
      expect(isClear(inst.x, inst.z)).toBe(true);
    }
  });

  it('высоты в заданном диапазоне, варианты в пределах', () => {
    const a = generateScatter(7, WORLD_SIZE, SPEC, isClear);
    for (const inst of a) {
      expect(inst.height).toBeGreaterThanOrEqual(SPEC.minH);
      expect(inst.height).toBeLessThanOrEqual(SPEC.maxH);
      expect(inst.variant).toBeGreaterThanOrEqual(0);
      expect(inst.variant).toBeLessThan(SPEC.variants);
    }
  });

  it('маска не влияет на позиции остальных (детерминизм при разных масках)', () => {
    const all = generateScatter(42, WORLD_SIZE, SPEC, () => true);
    const masked = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    // masked — строгое подмножество all по координатам
    const key = (i: { x: number; z: number }) => `${i.x.toFixed(3)}|${i.z.toFixed(3)}`;
    const allSet = new Set(all.map(key));
    for (const inst of masked) expect(allSet.has(key(inst))).toBe(true);
  });
});
