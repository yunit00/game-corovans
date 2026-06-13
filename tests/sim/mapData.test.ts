import { describe, expect, it } from 'vitest';
import { MapProjection, playerArrowAngle } from '../../src/sim/mapData';
import type { P2 } from '../../src/sim/geom';

describe('MapProjection', () => {
  const WORLD = 1000;
  const PX = 800;
  const proj = new MapProjection(WORLD, PX);

  it('центр мира (0,0) проецируется в центр карты', () => {
    const p = proj.project(0, 0);
    expect(p.px).toBeCloseTo(PX / 2, 6);
    expect(p.py).toBeCloseTo(PX / 2, 6);
  });

  it('углы мира попадают в углы карты (X вправо, Z вниз)', () => {
    const half = WORLD / 2;
    // Левый-верхний угол мира (−half, −half) → (0,0) карты.
    const tl = proj.project(-half, -half);
    expect(tl.px).toBeCloseTo(0, 6);
    expect(tl.py).toBeCloseTo(0, 6);
    // Правый-нижний (+half, +half) → (PX, PX).
    const br = proj.project(half, half);
    expect(br.px).toBeCloseTo(PX, 6);
    expect(br.py).toBeCloseTo(PX, 6);
  });

  it('ось Z мира → ось Y карты вниз (север сверху)', () => {
    // Дворец (z<0, север) выше деревни (z>0, юг) на карте → меньший py.
    const palace = proj.project(0, -380);
    const village = proj.project(0, 120);
    expect(palace.py).toBeLessThan(village.py);
    // По X совпадают (оба на оси).
    expect(palace.px).toBeCloseTo(village.px, 6);
  });

  it('масштаб: пиксели на метр и длина в пиксели согласованы', () => {
    expect(proj.scale).toBeCloseTo(PX / WORLD, 9);
    expect(proj.lengthToPx(100)).toBeCloseTo(100 * (PX / WORLD), 6);
    // Радиус 0 м → 0 px.
    expect(proj.lengthToPx(0)).toBe(0);
  });

  it('проекция линейна и монотонна по обеим осям', () => {
    const a = proj.project(-200, 50);
    const b = proj.project(-100, 50);
    const c = proj.project(0, 50);
    // Рост x → рост px, равными шагами (линейность).
    expect(b.px).toBeGreaterThan(a.px);
    expect(c.px).toBeGreaterThan(b.px);
    expect(b.px - a.px).toBeCloseTo(c.px - b.px, 6);
    // py не меняется при фиксированном z.
    expect(a.py).toBeCloseTo(b.py, 6);
  });

  it('точки за пределами мира не обрезаются (вызывающий клампит сам)', () => {
    const p = proj.project(WORLD, 0); // далеко за правым краем
    expect(p.px).toBeGreaterThan(PX);
  });

  it('projectPolyline проецирует все вершины в порядке', () => {
    const road: P2[] = [
      { x: 0, z: 0 },
      { x: 100, z: -100 },
      { x: -50, z: 200 },
    ];
    const pts = proj.projectPolyline(road);
    expect(pts.length).toBe(3);
    for (let i = 0; i < road.length; i++) {
      const direct = proj.project(road[i]!.x, road[i]!.z);
      expect(pts[i]!.px).toBeCloseTo(direct.px, 6);
      expect(pts[i]!.py).toBeCloseTo(direct.py, 6);
    }
  });

  it('разное разрешение карты масштабирует пропорционально', () => {
    const small = new MapProjection(WORLD, 400);
    const big = new MapProjection(WORLD, 800);
    const ps = small.project(100, -100);
    const pb = big.project(100, -100);
    // Вдвое больший canvas → вдвое дальше от центра пропорция.
    expect(pb.px - 400).toBeCloseTo((ps.px - 200) * 2, 6);
    expect(pb.py - 400).toBeCloseTo((ps.py - 200) * 2, 6);
  });
});

describe('playerArrowAngle', () => {
  it('yaw=0 (взгляд на юг, +Z) → стрелка вниз карты (π)', () => {
    expect(playerArrowAngle(0)).toBeCloseTo(Math.PI, 6);
  });

  it('yaw=π (взгляд на север, −Z) → стрелка вверх (0)', () => {
    expect(playerArrowAngle(Math.PI)).toBeCloseTo(0, 6);
  });

  it('поворот камеры меняет угол стрелки на ту же величину (с инверсией знака)', () => {
    const a0 = playerArrowAngle(0);
    const a1 = playerArrowAngle(0.5);
    // angle = π − yaw → разница −0.5.
    expect(a1 - a0).toBeCloseTo(-0.5, 6);
  });
});
