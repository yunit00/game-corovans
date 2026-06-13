import { describe, expect, it } from 'vitest';
import { pickTreasureTree, TREASURE_ANCHOR, TREASURE_HEIGHT } from '../../src/sim/hiddenTreasure';

interface T { x: number; z: number }

describe('pickTreasureTree', () => {
  it('выбирает дерево, ближайшее к фиксированной точке-якорю (детерминированно)', () => {
    const trees: T[] = [
      { x: TREASURE_ANCHOR.x + 100, z: TREASURE_ANCHOR.z },
      { x: TREASURE_ANCHOR.x + 3, z: TREASURE_ANCHOR.z - 2 }, // ближайшее
      { x: TREASURE_ANCHOR.x - 40, z: TREASURE_ANCHOR.z + 40 },
    ];
    const pick = pickTreasureTree(trees);
    expect(pick).not.toBeNull();
    expect(pick!.index).toBe(1);
    expect(pick!.tree).toBe(trees[1]);
  });

  it('один и тот же массив всегда даёт тот же выбор (детерминизм)', () => {
    const trees: T[] = [
      { x: -500, z: 500 },
      { x: TREASURE_ANCHOR.x - 1, z: TREASURE_ANCHOR.z + 1 },
      { x: 200, z: 200 },
    ];
    const a = pickTreasureTree(trees);
    const b = pickTreasureTree(trees);
    expect(a!.index).toBe(b!.index);
    expect(a!.index).toBe(1);
  });

  it('пустой лес — null (нечего украшать)', () => {
    expect(pickTreasureTree([])).toBeNull();
  });

  it('якорь и высота подвески — разумные константы', () => {
    // Высота ~1.7 м (вешаем на ствол, не у земли и не на кроне).
    expect(TREASURE_HEIGHT).toBeGreaterThan(1.4);
    expect(TREASURE_HEIGHT).toBeLessThan(2.2);
    // Якорь — глубоко в лесу (вдали от центра/осей), но в играбельной зоне (cheb<420).
    expect(Math.max(Math.abs(TREASURE_ANCHOR.x), Math.abs(TREASURE_ANCHOR.z))).toBeLessThan(420);
  });
});
