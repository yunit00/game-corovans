// Выстрел из арбалета: one-shot анимация + отложенный спавн стрелы в момент hitAt.
// Зеркало pendingHits из CombatSystem, но для одного снаряда. Без THREE —
// тайминг покрыт unit-тестом в node (tests/sim/rangedAttack.test.ts).
import type { AnimState } from '../data/animClipMap';
import type { WeaponDef } from '../data/weapons';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Минимум от AnimationController — чтобы тестировать тайминг без AnimationMixer.
 * actionBusy — идёт ли БЛОКИРУЮЩИЙ one-shot (удар/выстрел/смерть). Намеренно НЕ
 * busy: удержание прицела (aim-hold) тоже даёт busy=true, но стрелять из прицела
 * нужно — иначе зажатый ПКМ запретил бы выстрел.
 */
export interface RangedAnim {
  readonly actionBusy: boolean;
  playOneShot(state: AnimState, opts?: { fade?: number }): number;
}

/** Отложенный выстрел: стрела вылетит через t сек (момент hitAt в анимации). */
interface PendingShot {
  t: number;
  origin: Vec3Like;
  dir: Vec3Like;
}

export class RangedAttack {
  private cooldownLeft = 0;
  private pending: PendingShot | null = null;

  // weapon не readonly: экипировка Фазы 6 меняет арбалет игрока на лету.
  constructor(private weapon: WeaponDef) {}

  /** Сменить оружие (экипировка). Кулдаун/отложенный выстрел не сбрасываем. */
  setWeapon(weapon: WeaponDef): void {
    this.weapon = weapon;
  }

  /** Текущее дальнее оружие игрока — Game читает lethalMaxHp для летальности стрелы. */
  get currentWeapon(): WeaponDef {
    return this.weapon;
  }

  /** Начать выстрел. false — кулдаун, аниматор занят или прошлая стрела ещё не вылетела. */
  tryShoot(anim: RangedAnim, origin: Vec3Like, dir: Vec3Like): boolean {
    if (this.cooldownLeft > 0 || this.pending !== null || anim.actionBusy) return false;
    const animName = this.weapon.anims[0];
    if (!animName) return false;
    const dur = anim.playOneShot(animName, { fade: 0.08 });
    // Снимок прицела в момент клика: стрела летит туда, куда целились.
    // Если клипа нет (dur=0) — фоллбэк 0.3 с, как в CombatSystem.
    this.pending = {
      t: dur > 0 ? dur * this.weapon.hitAt : 0.3,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
    };
    this.cooldownLeft = this.weapon.cooldown;
    return true;
  }

  /** Тикает кулдаун; в момент hitAt зовёт spawn со скоростью/уроном оружия. */
  fixedUpdate(
    stepSec: number,
    spawn: (origin: Vec3Like, dir: Vec3Like, speed: number, baseDamage: number) => void,
  ): void {
    this.cooldownLeft = Math.max(0, this.cooldownLeft - stepSec);
    if (this.pending === null) return;
    this.pending.t -= stepSec;
    if (this.pending.t > 0) return;
    const shot = this.pending;
    this.pending = null;
    spawn(shot.origin, shot.dir, this.weapon.projectileSpeed ?? 30, this.weapon.damage);
  }
}
