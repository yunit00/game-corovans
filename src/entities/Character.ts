import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { AnimationController } from './AnimationController';
import type { AttackerStats, DefenderStats } from '../sim/damage';
import { DEFAULT_ATTACKER, DEFAULT_DEFENDER } from '../sim/damage';

export const CAPSULE_HALF = 0.5;
export const CAPSULE_RADIUS = 0.35;
/** Центр капсулы над ногами. */
export const CENTER_Y = CAPSULE_HALF + CAPSULE_RADIUS;

export type Team = 'elf' | 'guard' | 'villain' | 'village';

/**
 * Враждебность команд (симметрична). Базовое правило — «разные команды враждуют»,
 * НО ополчение деревни (village, наёмные стражники Фазы 6B) — особый случай: оно
 * бьёт ТОЛЬКО злодеев (villain) и дружит с игроком-эльфом и стражей дворца. Иначе:
 *  - elf↔guard враждуют (игрок грабит корованы, охрана даёт отпор);
 *  - villain враждует со всеми (набеги на деревню, перехват корованов);
 *  - village дружит с elf/guard, враждует только с villain.
 */
export function areEnemies(a: Team, b: Team): boolean {
  if (a === b) return false;
  // Ополчение деревни задирается только на злодеев, всех остальных не трогает.
  if (a === 'village' || b === 'village') {
    return a === 'villain' || b === 'villain';
  }
  return true;
}

/** Общая база живых существ: HP, команда, тело-капсула, анимации. */
export abstract class Character {
  hp = 100;
  maxHp = 100;
  team: Team = 'villain';
  alive = true;
  attackStats: AttackerStats = { ...DEFAULT_ATTACKER };
  defenseStats: DefenderStats = { ...DEFAULT_DEFENDER };

  body!: RAPIER_NS.RigidBody;
  collider!: RAPIER_NS.Collider;
  visual = new THREE.Group();
  anim!: AnimationController;

  /** Кэш для feet — геттер зовут в горячих фикс-циклах (стрелы, милишка). */
  private readonly _feet = new THREE.Vector3();

  /** Позиция ног (низ капсулы). Возвращает общий кэш-вектор: читать сразу, не хранить. */
  get feet(): THREE.Vector3 {
    const t = this.body.translation();
    return this._feet.set(t.x, t.y - CENTER_Y, t.z);
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.onDeath();
    } else {
      this.onHit();
    }
  }

  protected onHit(): void {
    if (!this.anim.busy) this.anim.playOneShot('hit', { fade: 0.06 });
  }

  protected abstract onDeath(): void;
}
