import { describe, expect, it } from 'vitest';
import { buildPath, posAt, reversePath, type PathPoint } from '../../src/sim/path';
import { ROADS } from '../../src/world/WorldData';

/** Г-образный маршрут: сегмент 10 м по X, затем 5 м по Z. */
const L_POINTS: readonly PathPoint[] = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 5 },
];

const mkOut = () => ({ x: 0, z: 0, dirX: 0, dirZ: 0 });

describe('buildPath', () => {
  it('cumLen накапливает длины сегментов, total — вся длина', () => {
    const path = buildPath(L_POINTS);
    expect(path.cumLen).toEqual([0, 10, 15]);
    expect(path.total).toBeCloseTo(15);
  });

  it('точки-дубликаты подряд дают нулевые сегменты без поломки total', () => {
    const path = buildPath([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 0 },
    ]);
    expect(path.cumLen).toEqual([0, 0, 10, 10]);
    expect(path.total).toBeCloseTo(10);
  });

  it('маршрут из одной точки: total = 0', () => {
    const path = buildPath([{ x: 3, z: 4 }]);
    expect(path.cumLen).toEqual([0]);
    expect(path.total).toBe(0);
  });
});

describe('posAt', () => {
  it('середина первого сегмента: позиция и направление вдоль X', () => {
    const o = posAt(buildPath(L_POINTS), 5, mkOut());
    expect(o.x).toBeCloseTo(5);
    expect(o.z).toBeCloseTo(0);
    expect(o.dirX).toBeCloseTo(1);
    expect(o.dirZ).toBeCloseTo(0);
  });

  it('середина второго сегмента: позиция и направление вдоль Z', () => {
    const o = posAt(buildPath(L_POINTS), 12.5, mkOut());
    expect(o.x).toBeCloseTo(10);
    expect(o.z).toBeCloseTo(2.5);
    expect(o.dirX).toBeCloseTo(0);
    expect(o.dirZ).toBeCloseTo(1);
  });

  it('кламп s<0 → старт, s>total → конец (направления крайних сегментов)', () => {
    const path = buildPath(L_POINTS);
    const start = posAt(path, -3, mkOut());
    expect(start.x).toBeCloseTo(0);
    expect(start.z).toBeCloseTo(0);
    expect(start.dirX).toBeCloseTo(1);
    expect(start.dirZ).toBeCloseTo(0);
    const end = posAt(path, 100, mkOut());
    expect(end.x).toBeCloseTo(10);
    expect(end.z).toBeCloseTo(5);
    expect(end.dirX).toBeCloseTo(0);
    expect(end.dirZ).toBeCloseTo(1);
  });

  it('направление нормировано на диагональном сегменте', () => {
    const o = posAt(buildPath([{ x: 0, z: 0 }, { x: 3, z: 4 }]), 2.5, mkOut());
    expect(o.x).toBeCloseTo(1.5);
    expect(o.z).toBeCloseTo(2);
    expect(o.dirX).toBeCloseTo(0.6);
    expect(o.dirZ).toBeCloseTo(0.8);
    expect(Math.hypot(o.dirX, o.dirZ)).toBeCloseTo(1);
  });

  it('возвращает тот же out-объект (без аллокаций)', () => {
    const o = mkOut();
    expect(posAt(buildPath(L_POINTS), 1, o)).toBe(o);
  });

  it('дубликаты подряд: позиция верная, dir без NaN на всём диапазоне s', () => {
    const path = buildPath([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 0 },
    ]);
    const mid = posAt(path, 5, mkOut());
    expect(mid.x).toBeCloseTo(5);
    expect(mid.z).toBeCloseTo(0);
    for (const s of [-1, 0, 0.001, 5, 9.999, 10, 11]) {
      const o = posAt(path, s, mkOut());
      expect(Number.isFinite(o.x), `x при s=${s}`).toBe(true);
      expect(Number.isFinite(o.z), `z при s=${s}`).toBe(true);
      expect(Number.isFinite(o.dirX), `dirX при s=${s}`).toBe(true);
      expect(Number.isFinite(o.dirZ), `dirZ при s=${s}`).toBe(true);
      expect(Math.hypot(o.dirX, o.dirZ)).toBeCloseTo(1);
    }
  });

  it('полностью вырожденный маршрут (все точки совпадают): стоим на месте, dir конечный', () => {
    const path = buildPath([
      { x: 3, z: 4 },
      { x: 3, z: 4 },
      { x: 3, z: 4 },
    ]);
    const o = posAt(path, 7, mkOut());
    expect(o.x).toBe(3);
    expect(o.z).toBe(4);
    expect(Number.isFinite(o.dirX)).toBe(true);
    expect(Number.isFinite(o.dirZ)).toBe(true);
  });
});

describe('reversePath', () => {
  it('та же длина, старт и конец меняются местами', () => {
    const rev = reversePath(buildPath(L_POINTS));
    expect(rev.total).toBeCloseTo(15);
    expect(rev.points[0]).toEqual({ x: 10, z: 5 });
    expect(rev.points[rev.points.length - 1]).toEqual({ x: 0, z: 0 });
  });

  it('позиции зеркальны: posAt(rev, s) = posAt(orig, total−s)', () => {
    const path = buildPath(L_POINTS);
    const rev = reversePath(path);
    for (const s of [0, 2.5, 7, 10, 12.5, 15]) {
      const a = posAt(rev, s, mkOut());
      const b = posAt(path, path.total - s, mkOut());
      expect(a.x, `x при s=${s}`).toBeCloseTo(b.x);
      expect(a.z, `z при s=${s}`).toBeCloseTo(b.z);
    }
  });

  it('направление внутри сегмента инвертируется', () => {
    const rev = reversePath(buildPath(L_POINTS));
    // Первые 5 м обратного маршрута — бывший последний сегмент, теперь идём по −Z.
    const o = posAt(rev, 2.5, mkOut());
    expect(o.x).toBeCloseTo(10);
    expect(o.z).toBeCloseTo(2.5);
    expect(o.dirX).toBeCloseTo(0);
    expect(o.dirZ).toBeCloseTo(-1);
  });

  it('не мутирует исходный маршрут', () => {
    const path = buildPath(L_POINTS);
    reversePath(path);
    expect(path.points[0]).toEqual({ x: 0, z: 0 });
    expect(path.cumLen).toEqual([0, 10, 15]);
  });
});

describe('тракт ROADS[0] (дворец → деревня → юг)', () => {
  it('старт у дворца, конец на юге, длина не меньше прямой между ними', () => {
    const path = buildPath(ROADS[0]!);
    const start = posAt(path, 0, mkOut());
    expect(start.x).toBeCloseTo(0);
    expect(start.z).toBeCloseTo(-380);
    const end = posAt(path, path.total, mkOut());
    expect(end.x).toBeCloseTo(4);
    expect(end.z).toBeCloseTo(470);
    expect(path.total).toBeGreaterThanOrEqual(Math.hypot(4 - 0, 470 - -380));
  });
});
