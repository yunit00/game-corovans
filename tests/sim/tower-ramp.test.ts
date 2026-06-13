import { describe, expect, it } from 'vitest';
import { spiralRampSegments, type RampGeometry } from '../../src/world/Landmarks';

// Лимит авто-степа KCC игрока: капсула шагает вверх на ≤ 0.5 м, держим запас 0.45.
const AUTOSTEP = 0.45;

// Типичная башня: земля 0, площадка наверху ~13.7 м, towerR ~ 2.4 м (как в разведке).
const BASE_Y = 0;
const TOWER_R = 2.4;
const PLAT_TOP = 13.7; // верх пола площадки (towerTopY + 0.3)

function ramp(): RampGeometry {
  return spiralRampSegments(0, 0, BASE_Y, PLAT_TOP, TOWER_R);
}

describe('spiralRampSegments', () => {
  it('хотя бы 8 сегментов и они есть', () => {
    const r = ramp();
    expect(r.segments.length).toBeGreaterThanOrEqual(8);
  });

  it('детерминирована (одни входы → одна геометрия)', () => {
    const a = spiralRampSegments(10, -5, 0, 13.7, 2.4);
    const b = spiralRampSegments(10, -5, 0, 13.7, 2.4);
    expect(a).toEqual(b);
  });

  it('высоты ходовой поверхности строго монотонны вверх', () => {
    const { segments } = ramp();
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.surfY).toBeGreaterThan(segments[i - 1]!.surfY);
    }
  });

  it('шаг по высоте между соседними сегментами ≤ авто-степ (0.45 м)', () => {
    const { segments } = ramp();
    for (let i = 1; i < segments.length; i++) {
      const d = segments[i]!.surfY - segments[i - 1]!.surfY;
      expect(d).toBeLessThanOrEqual(AUTOSTEP);
    }
  });

  it('первый сегмент стартует у земли (низкий входной шаг)', () => {
    const { segments } = ramp();
    // Ходовая поверхность первого сегмента — в пределах авто-степа от земли.
    expect(segments[0]!.surfY - BASE_Y).toBeLessThanOrEqual(AUTOSTEP);
    expect(segments[0]!.surfY).toBeGreaterThanOrEqual(BASE_Y);
  });

  it('последний сегмент стыкуется с полом площадки ≤ 0.05 м', () => {
    const { segments } = ramp();
    const last = segments[segments.length - 1]!;
    expect(Math.abs(last.surfY - PLAT_TOP)).toBeLessThanOrEqual(0.05);
  });

  it('уклон каждого сегмента ≤ 30°', () => {
    const { segments } = ramp();
    const max = (30 * Math.PI) / 180;
    for (const s of segments) {
      expect(s.pitch).toBeLessThanOrEqual(max);
      expect(s.pitch).toBeGreaterThan(0);
    }
  });

  it('сегменты внахлёст — без щелей (расстояние между центрами < длины короба)', () => {
    const { segments } = ramp();
    for (let i = 1; i < segments.length; i++) {
      const a = segments[i - 1]!;
      const b = segments[i]!;
      const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      // Длина короба заведомо больше шага между центрами → соседи перекрываются.
      expect(dist).toBeLessThan(b.len);
    }
  });

  it('внутренний край пандуса не заходит в цилиндр-коллайдер башни', () => {
    const r = ramp();
    // Центр короба на радиусе R, полуширина width/2 → внутренний край = R − width/2.
    const innerEdge = r.R - r.width / 2;
    expect(innerEdge).toBeGreaterThan(TOWER_R);
  });

  it('выше башня → больше сегментов, шаг всё равно в пределах авто-степа', () => {
    const tall = spiralRampSegments(0, 0, 0, 25, 2.4);
    expect(tall.segments.length).toBeGreaterThan(ramp().segments.length);
    for (let i = 1; i < tall.segments.length; i++) {
      const d = tall.segments[i]!.surfY - tall.segments[i - 1]!.surfY;
      expect(d).toBeLessThanOrEqual(AUTOSTEP);
    }
    const last = tall.segments[tall.segments.length - 1]!;
    expect(Math.abs(last.surfY - 25)).toBeLessThanOrEqual(0.05);
  });
});
