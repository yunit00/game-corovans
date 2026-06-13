import { describe, expect, it } from 'vitest';
import {
  menuOrbitPos,
  MENU_ORBIT_HEIGHT,
  MENU_ORBIT_PERIOD,
  MENU_ORBIT_RADIUS,
  type XYZ,
} from '../../src/systems/CameraRig';

/** Центр деревни (VILLAGE) на высоте террейна — типичный вход облёта. */
const CX = 0;
const CY = 5;
const CZ = 120;

function pos(t: number): XYZ {
  return menuOrbitPos({ x: 0, y: 0, z: 0 }, CX, CY, CZ, t);
}

describe('menuOrbitPos', () => {
  it('камера на высоте center.y + height независимо от времени', () => {
    for (const t of [0, 7, 15, 30, 45, 60, 123]) {
      expect(pos(t).y).toBeCloseTo(CY + MENU_ORBIT_HEIGHT, 6);
    }
  });

  it('радиус облёта вокруг центра постоянен и равен MENU_ORBIT_RADIUS', () => {
    for (const t of [0, 5, 12.5, 30, 47]) {
      const p = pos(t);
      const r = Math.hypot(p.x - CX, p.z - CZ);
      expect(r).toBeCloseTo(MENU_ORBIT_RADIUS, 4);
    }
  });

  it('в t=0 камера на оси +X от центра (cos0=1, sin0=0)', () => {
    const p = pos(0);
    expect(p.x).toBeCloseTo(CX + MENU_ORBIT_RADIUS, 6);
    expect(p.z).toBeCloseTo(CZ, 6);
  });

  it('за полный период камера возвращается в исходную точку', () => {
    const a = pos(0);
    const b = pos(MENU_ORBIT_PERIOD);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.z).toBeCloseTo(a.z, 4);
  });

  it('за четверть периода проходит четверть круга (на ось +Z от центра)', () => {
    const p = pos(MENU_ORBIT_PERIOD / 4);
    expect(p.x).toBeCloseTo(CX, 4);
    expect(p.z).toBeCloseTo(CZ + MENU_ORBIT_RADIUS, 4);
  });

  it('пишет в переданный out без аллокации нового объекта', () => {
    const out: XYZ = { x: 0, y: 0, z: 0 };
    const ret = menuOrbitPos(out, CX, CY, CZ, 10);
    expect(ret).toBe(out); // тот же объект
  });

  it('кастомные радиус/высота/период учитываются', () => {
    const out: XYZ = { x: 0, y: 0, z: 0 };
    menuOrbitPos(out, 0, 0, 0, 0, 100, 50, 30);
    expect(out.x).toBeCloseTo(100, 6); // радиус
    expect(out.y).toBeCloseTo(50, 6); // высота
    // Половина кастомного периода (15) → противоположная точка по X
    menuOrbitPos(out, 0, 0, 0, 15, 100, 50, 30);
    expect(out.x).toBeCloseTo(-100, 4);
  });

  it('константы облёта в разумных пределах ТЗ (радиус ~55-70, высота ~22-30, период ~60)', () => {
    expect(MENU_ORBIT_RADIUS).toBeGreaterThanOrEqual(55);
    expect(MENU_ORBIT_RADIUS).toBeLessThanOrEqual(70);
    expect(MENU_ORBIT_HEIGHT).toBeGreaterThanOrEqual(22);
    expect(MENU_ORBIT_HEIGHT).toBeLessThanOrEqual(30);
    expect(MENU_ORBIT_PERIOD).toBeCloseTo(60, 0);
  });
});
