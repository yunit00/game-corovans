import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../../src/data/weapons';
import { RangedAttack, type RangedAnim, type Vec3Like } from '../../src/systems/RangedAttack';

// hitAt 0.25, cooldown 1.0, projectileSpeed 40, damage 18
const CROSSBOW = WEAPONS.crossbow_2handed!;
const STEP = 1 / 60;

const animStub = (dur: number, actionBusy = false): RangedAnim => ({ actionBusy, playOneShot: () => dur });

const O: Vec3Like = { x: 1, y: 2, z: 3 };
const D: Vec3Like = { x: 0, y: 0, z: 1 };

/** Крутит fixedUpdate до спавна, возвращает число шагов и аргументы спавна. */
function stepUntilSpawn(r: RangedAttack, maxSteps = 200) {
  let spawned: { origin: Vec3Like; dir: Vec3Like; speed: number; damage: number } | null = null;
  let steps = 0;
  while (!spawned && steps < maxSteps) {
    r.fixedUpdate(STEP, (origin, dir, speed, damage) => {
      spawned = { origin, dir, speed, damage };
    });
    steps++;
  }
  return { spawned: spawned as { origin: Vec3Like; dir: Vec3Like; speed: number; damage: number } | null, steps };
}

describe('RangedAttack', () => {
  it('спавнит стрелу один раз, в момент hitAt·длительность, с параметрами оружия', () => {
    const r = new RangedAttack(CROSSBOW);
    expect(r.tryShoot(animStub(2), O, D)).toBe(true);
    const { spawned, steps } = stepUntilSpawn(r);
    // 2 c × 0.25 = 0.5 c → 30-й шаг (± шаг на накопленную погрешность float)
    expect(steps).toBeGreaterThanOrEqual(30);
    expect(steps).toBeLessThanOrEqual(31);
    expect(spawned!.speed).toBe(40);
    expect(spawned!.damage).toBe(18);
    // Второго спавна нет
    let extra = 0;
    for (let i = 0; i < 120; i++) r.fixedUpdate(STEP, () => extra++);
    expect(extra).toBe(0);
  });

  it('снимок прицела: мутация исходных векторов после tryShoot не влияет на выстрел', () => {
    const r = new RangedAttack(CROSSBOW);
    const origin = { ...O };
    const dir = { ...D };
    r.tryShoot(animStub(2), origin, dir);
    origin.x = 999;
    dir.z = -1;
    const { spawned } = stepUntilSpawn(r);
    expect(spawned!.origin).toEqual(O);
    expect(spawned!.dir).toEqual(D);
  });

  it('кулдаун: второй выстрел не раньше weapon.cooldown', () => {
    const r = new RangedAttack(CROSSBOW);
    const anim = animStub(2);
    expect(r.tryShoot(anim, O, D)).toBe(true);
    expect(r.tryShoot(anim, O, D)).toBe(false);
    // 0.9 c — ещё рано
    for (let i = 0; i < 54; i++) r.fixedUpdate(STEP, () => {});
    expect(r.tryShoot(anim, O, D)).toBe(false);
    // добор до >1.0 c — можно снова
    for (let i = 0; i < 8; i++) r.fixedUpdate(STEP, () => {});
    expect(r.tryShoot(anim, O, D)).toBe(true);
  });

  it('занятый аниматор (one-shot в процессе) — отказ без pending', () => {
    const r = new RangedAttack(CROSSBOW);
    expect(r.tryShoot(animStub(2, true), O, D)).toBe(false);
    const { spawned } = stepUntilSpawn(r, 120);
    expect(spawned).toBeNull();
  });

  it('клипа нет (длительность 0) — фоллбэк ~0.3 с, выстрел всё равно случается', () => {
    const r = new RangedAttack(CROSSBOW);
    expect(r.tryShoot(animStub(0), O, D)).toBe(true);
    const { spawned, steps } = stepUntilSpawn(r);
    expect(spawned).not.toBeNull();
    expect(steps).toBeGreaterThanOrEqual(18);
    expect(steps).toBeLessThanOrEqual(19);
  });
});
