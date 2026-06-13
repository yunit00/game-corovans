import { describe, expect, it } from 'vitest';
import { generateScatter, type ScatterSpec } from '../../src/sim/scatter';
import { inPondWater, type WaterDisc } from '../../src/sim/water';
import { isClear, WORLD_SIZE } from '../../src/world/WorldData';

const DISCS: WaterDisc[] = [
  { x: 0, z: 0, r: 10 },
  { x: 100, z: 50, r: 8 },
];

describe('inPondWater', () => {
  it('центр пруда — в воде', () => {
    const inside = inPondWater(DISCS, 3);
    expect(inside(0, 0)).toBe(true);
    expect(inside(100, 50)).toBe(true);
  });

  it('точка у кромки внутри радиуса — в воде', () => {
    const inside = inPondWater(DISCS, 0);
    expect(inside(9.9, 0)).toBe(true); // r=10, чуть внутри
    expect(inside(10.1, 0)).toBe(false); // чуть снаружи (буфер 0)
  });

  it('буфер берега расширяет зону исключения', () => {
    const noBuf = inPondWater(DISCS, 0);
    const withBuf = inPondWater(DISCS, 3);
    // Точка на 12 м от центра (r=10): вне воды, но в буфере 3 м
    expect(noBuf(12, 0)).toBe(false);
    expect(withBuf(12, 0)).toBe(true);
    // За пределами буфера — свободно
    expect(withBuf(13.1, 0)).toBe(false);
  });

  it('точка вдали от всех прудов — свободна', () => {
    const inside = inPondWater(DISCS, 3);
    expect(inside(500, 500)).toBe(false);
    expect(inside(-50, -50)).toBe(false);
  });

  it('проверяет КАЖДЫЙ пруд (объединение дисков)', () => {
    const inside = inPondWater(DISCS, 3);
    // Близко ко второму пруду, далеко от первого
    expect(inside(100, 56)).toBe(true); // 6 м от центра второго (r=8)
    expect(inside(100, 62)).toBe(false); // 12 м — за радиусом+буфером (8+3=11)
  });

  it('пустой список прудов — всё свободно', () => {
    const inside = inPondWater([], 3);
    expect(inside(0, 0)).toBe(false);
  });

  it('детерминированна: тот же вход → тот же результат', () => {
    const a = inPondWater(DISCS, 3);
    const b = inPondWater(DISCS, 3);
    for (const [x, z] of [[0, 0], [12, 0], [100, 50], [500, 500]] as const) {
      expect(a(x, z)).toBe(b(x, z));
    }
  });
});

const SPEC: ScatterSpec = {
  id: 'pine',
  variants: 5,
  cell: 9.5,
  threshold: 0.46,
  noiseScale: 130,
  minH: 7,
  maxH: 12,
};

describe('лес: исключение воды прудов', () => {
  // Диски подальше от деревни/дворца/дорог, чтобы пересекаться с лесом.
  const discs: WaterDisc[] = [
    { x: 200, z: -150, r: 12 },
    { x: -180, z: 200, r: 10 },
  ];
  const inWater = inPondWater(discs, 3);
  const clearOfWater = (x: number, z: number): boolean => isClear(x, z) && !inWater(x, z);

  it('ни одного дерева в воде/буфере прудов', () => {
    const masked = generateScatter(42, WORLD_SIZE, SPEC, clearOfWater);
    for (const inst of masked) {
      expect(inWater(inst.x, inst.z)).toBe(false);
    }
  });

  it('маска воды не двигает остальной лес: masked — подмножество базового', () => {
    const base = generateScatter(42, WORLD_SIZE, SPEC, isClear);
    const masked = generateScatter(42, WORLD_SIZE, SPEC, clearOfWater);
    const key = (i: { x: number; z: number }) => `${i.x.toFixed(3)}|${i.z.toFixed(3)}`;
    const baseSet = new Set(base.map(key));
    for (const inst of masked) expect(baseSet.has(key(inst))).toBe(true);
    // И убрали только то, что в воде — остальное на месте
    const removed = base.filter((i) => inWater(i.x, i.z));
    expect(base.length - masked.length).toBe(removed.length);
  });
});
