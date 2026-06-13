import { describe, expect, it } from 'vitest';
import { arrowKillDamage, segmentSphereHit, stepProjectile, type ProjState } from '../../src/sim/projectile';
import { ARCHETYPES } from '../../src/data/archetypes';
import { WEAPONS } from '../../src/data/weapons';

describe('stepProjectile', () => {
  it('gravity=0: прямолинейный полёт, скорость не меняется', () => {
    const p: ProjState = { x: 1, y: 2, z: 3, vx: 4, vy: -2, vz: 6 };
    const q = stepProjectile(p, 0.5, 0);
    expect(q.x).toBeCloseTo(3);
    expect(q.y).toBeCloseTo(1);
    expect(q.z).toBeCloseTo(6);
    expect(q.vx).toBeCloseTo(4);
    expect(q.vy).toBeCloseTo(-2);
    expect(q.vz).toBeCloseTo(6);
  });

  it('семи-неявный Эйлер: позиция учитывает уже обновлённую vy', () => {
    // Из покоя, dt=1, g=-10: vy → -10, затем y += vy*dt → -10 (явный Эйлер дал бы 0).
    const q = stepProjectile({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, 1, -10);
    expect(q.vy).toBeCloseTo(-10);
    expect(q.y).toBeCloseTo(-10);
  });

  it('падение из покоя за n мелких шагов ≈ g·t²/2', () => {
    const g = -9.81;
    const n = 1000;
    const dt = 1 / n;
    let p: ProjState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < n; i++) p = stepProjectile(p, dt, g);
    // Семи-неявный Эйлер слегка перелетает: ошибка ~ g·t²/(2n).
    expect(p.y).toBeCloseTo((g * 1 * 1) / 2, 1);
    expect(p.vy).toBeCloseTo(g);
  });

  it('не мутирует исходный объект', () => {
    const p: ProjState = { x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6 };
    stepProjectile(p, 0.1);
    expect(p).toEqual({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6 });
  });
});

describe('segmentSphereHit', () => {
  it('явный промах → null', () => {
    expect(segmentSphereHit(5, 5, 5, 6, 6, 6, 0, 0, 0, 1)).toBeNull();
  });

  it('лобовое попадание: A=(0,0,-2) → B=(0,0,2), сфера (0,0,0) r=1 → t=0.25', () => {
    expect(segmentSphereHit(0, 0, -2, 0, 0, 2, 0, 0, 0, 1)).toBeCloseTo(0.25);
  });

  it('старт внутри сферы → 0', () => {
    expect(segmentSphereHit(0.2, 0, 0, 5, 0, 0, 0, 0, 0, 1)).toBe(0);
  });

  it('касательная (дистанция ровно r) считается попаданием в точке касания', () => {
    // Сегмент по X на высоте y=1 над сферой r=1: дискриминант 0 → t точки касания.
    expect(segmentSphereHit(-2, 1, 0, 2, 1, 0, 0, 0, 0, 1)).toBeCloseTo(0.5);
  });

  it('сегмент заканчивается до сферы → null', () => {
    // Вход был бы при z=-1 (t=1.5 за пределами сегмента).
    expect(segmentSphereHit(0, 0, -4, 0, 0, -2, 0, 0, 0, 1)).toBeNull();
  });

  it('возвращает ближайшую из двух точек пересечения (вход, не выход)', () => {
    // Сегмент насквозь: вход t=0.25, выход t=0.75.
    const t = segmentSphereHit(0, 0, -2, 0, 0, 2, 0, 0, 0, 1);
    expect(t).toBeCloseTo(0.25);
    expect(t).not.toBeCloseTo(0.75);
  });
});

describe('arrowKillDamage (летальность стрелы игрока)', () => {
  const LETHAL = WEAPONS.crossbow_2handed!.lethalMaxHp!;

  it('у арбалета игрока задан порог летальности', () => {
    expect(LETHAL).toBeGreaterThan(0);
  });

  it('рядовой враг (HP ≤ порога) валится с ОДНОГО попадания', () => {
    // Урон ≥ maxHp рядового — takeDamage(maxHp) уводит hp в 0.
    for (const hp of [40, 50, 70, LETHAL]) {
      expect(arrowKillDamage(hp, LETHAL)).toBeGreaterThanOrEqual(hp);
    }
  });

  it('громила (HP > порога) переживает первую стрелу, но не вторую', () => {
    const brute = 80;
    const perArrow = arrowKillDamage(brute, LETHAL);
    expect(perArrow).toBeLessThan(brute); // одна стрела НЕ убивает
    expect(perArrow * 2).toBeGreaterThanOrEqual(brute); // две — добивают
  });

  it('конкретные архетипы: рядовые ваншот, brute двухшот', () => {
    const raider = ARCHETYPES.skeleton_raider!.hp; // 40
    const soldier = ARCHETYPES.guard_soldier!.hp; // 70
    const crossbow = ARCHETYPES.guard_crossbow!.hp; // 50
    const brute = ARCHETYPES.skeleton_brute!.hp; // 80
    // Рядовые — одна стрела наповал.
    expect(arrowKillDamage(raider, LETHAL)).toBeGreaterThanOrEqual(raider);
    expect(arrowKillDamage(soldier, LETHAL)).toBeGreaterThanOrEqual(soldier);
    expect(arrowKillDamage(crossbow, LETHAL)).toBeGreaterThanOrEqual(crossbow);
    // Громила — две.
    expect(arrowKillDamage(brute, LETHAL)).toBeLessThan(brute);
    expect(arrowKillDamage(brute, LETHAL) * 2).toBeGreaterThanOrEqual(brute);
  });
});
