import { describe, expect, it } from 'vitest';
import { distToPolyline, distToSegment, pointAlongPolyline, polylineLength } from '../../src/sim/geom';

describe('geom', () => {
  it('distToSegment: перпендикуляр и концы', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 10, z: 0 };
    expect(distToSegment({ x: 5, z: 3 }, a, b)).toBeCloseTo(3);
    expect(distToSegment({ x: -4, z: 0 }, a, b)).toBeCloseTo(4); // до конца a
    expect(distToSegment({ x: 13, z: 4 }, a, b)).toBeCloseTo(5); // до конца b
  });

  it('distToPolyline берёт ближайший сегмент', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ];
    expect(distToPolyline({ x: 12, z: 5 }, line)).toBeCloseTo(2);
  });

  it('polylineLength суммирует сегменты', () => {
    expect(
      polylineLength([
        { x: 0, z: 0 },
        { x: 3, z: 4 },
        { x: 3, z: 14 },
      ]),
    ).toBeCloseTo(15);
  });

  it('pointAlongPolyline: середина, направление, конец', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ];
    const mid = pointAlongPolyline(line, 5);
    expect(mid.x).toBeCloseTo(5);
    expect(mid.z).toBeCloseTo(0);
    expect(mid.dirX).toBeCloseTo(1);
    expect(mid.done).toBe(false);

    const corner = pointAlongPolyline(line, 15);
    expect(corner.x).toBeCloseTo(10);
    expect(corner.z).toBeCloseTo(5);
    expect(corner.dirZ).toBeCloseTo(1);

    const end = pointAlongPolyline(line, 999);
    expect(end.done).toBe(true);
    expect(end.x).toBeCloseTo(10);
    expect(end.z).toBeCloseTo(10);
  });
});
