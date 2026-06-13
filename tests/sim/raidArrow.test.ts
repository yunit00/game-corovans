import { describe, expect, it } from 'vitest';
import {
  bearingToScreenAngle,
  normalizeAngle,
  raidArrowHint,
} from '../../src/sim/raidArrow';

describe('normalizeAngle', () => {
  it('держит угол в (−π, π]', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI); // −π сворачиваем к +π
    expect(normalizeAngle(Math.PI * 2 + 0.3)).toBeCloseTo(0.3);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
});

describe('bearingToScreenAngle', () => {
  // Старт игры: cameraYaw = π означает «камера смотрит в +Z» (forward = (0, +1),
  // см. movement.ts: forward = (−sin yaw, −cos yaw)).
  const YAW_LOOK_PZ = Math.PI;

  it('цель прямо по курсу камеры → стрелка вверх (0)', () => {
    // Игрок в (0,0), деревня впереди (+Z), камера смотрит в +Z.
    const a = bearingToScreenAngle(0, 0, 0, 100, YAW_LOOK_PZ);
    expect(a).toBeCloseTo(0);
  });

  it('цель прямо за спиной → стрелка вниз (±π)', () => {
    // Деревня позади (−Z) при взгляде в +Z.
    const a = bearingToScreenAngle(0, 0, 0, -100, YAW_LOOK_PZ);
    expect(Math.abs(a)).toBeCloseTo(Math.PI);
  });

  it('цель слева и справа дают противоположные знаки', () => {
    // Камера смотрит в +Z; цель в +X и в −X должны дать зеркальные углы.
    const right = bearingToScreenAngle(0, 0, 100, 0, YAW_LOOK_PZ);
    const left = bearingToScreenAngle(0, 0, -100, 0, YAW_LOOK_PZ);
    expect(Math.abs(right)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(left)).toBeCloseTo(Math.PI / 2);
    expect(Math.sign(right)).toBe(-Math.sign(left));
  });

  it('поворот камеры на 90° смещает экранный угол на 90°', () => {
    // Цель фиксирована впереди (+Z). Повернём камеру на −π/2 от взгляда в +Z —
    // цель уедет в сторону ровно на π/2 (знак — по конвенции по часовой стрелке).
    const ahead = bearingToScreenAngle(0, 0, 0, 100, YAW_LOOK_PZ);
    const turned = bearingToScreenAngle(0, 0, 0, 100, YAW_LOOK_PZ - Math.PI / 2);
    expect(ahead).toBeCloseTo(0);
    expect(Math.abs(normalizeAngle(turned - ahead))).toBeCloseTo(Math.PI / 2);
  });

  it('инвариант: угол всегда нормализован в (−π, π]', () => {
    for (let yaw = -10; yaw <= 10; yaw += 0.37) {
      const a = bearingToScreenAngle(3, -7, 0, 120, yaw);
      expect(a).toBeGreaterThan(-Math.PI - 1e-9);
      expect(a).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('raidArrowHint', () => {
  it('рядом с деревней (внутри порога) — стрелка скрыта', () => {
    const h = raidArrowHint(0, 110, 0, 120, Math.PI, 60);
    expect(h.show).toBe(false);
    expect(h.distance).toBeCloseTo(10);
  });

  it('вдали от деревни — стрелка видна и указывает на неё', () => {
    // Игрок в (0,0), деревня в (0,120), камера смотрит в +Z → стрелка вверх.
    const h = raidArrowHint(0, 0, 0, 120, Math.PI, 60);
    expect(h.show).toBe(true);
    expect(h.distance).toBeCloseTo(120);
    expect(h.angleRad).toBeCloseTo(0);
  });

  it('ровно на пороге стрелка ещё скрыта (строгое >)', () => {
    const h = raidArrowHint(0, 60, 0, 120, Math.PI, 60);
    expect(h.distance).toBeCloseTo(60);
    expect(h.show).toBe(false);
  });
});
