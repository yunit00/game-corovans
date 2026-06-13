// Милишный бой: запуск анимации атаки и отложенный hit-window (момент удара).
import type * as THREE from 'three';
import type { WeaponDef } from '../data/weapons';
import type { AnimationController } from '../entities/AnimationController';
import { computeHit, type AttackerStats, type DefenderStats } from '../sim/damage';
import { selectMeleeTargets } from '../sim/melee';
import { pick, type Rng } from '../core/rng';
import { CAPSULE_RADIUS } from '../entities/Character';

/** Атакующий: позиция ног, взгляд, статы и аниматор. */
export interface MeleeActor {
  feet: THREE.Vector3;
  yaw: number;
  attackStats: AttackerStats;
  anim: AnimationController;
}

/** Цель удара (структурно подходит любой Character). */
export interface CombatTarget {
  id: number;
  alive: boolean;
  feet: THREE.Vector3;
  defenseStats: DefenderStats;
  takeDamage(n: number): void;
}

/** Отложенный удар: сработает через t сек (момент hitAt в анимации). */
interface PendingHit {
  t: number;
  weapon: WeaponDef;
}

export class CombatSystem {
  private cooldownLeft = 0;
  private pendingHits: PendingHit[] = [];

  constructor(
    private readonly rng: Rng,
    /** Колбэк удачного попадания (звук удара в Game) — на каждую задетую цель. */
    private readonly onHit?: (target: CombatTarget) => void,
  ) {}

  /** Начать атаку. false — кулдаун не вышел или аниматор занят one-shot'ом. */
  tryMelee(actor: MeleeActor, weapon: WeaponDef): boolean {
    if (this.cooldownLeft > 0 || actor.anim.busy) return false;
    const anim = pick(this.rng, weapon.anims);
    // timeScale ускоряет свинг игрока: клип короче, busy снимается раньше, бой резче.
    // playOneShot уже делит длительность на timeScale, так что dur — реальное время
    // свинга, и hitAt сдвигается пропорционально (попадание ближе к контакту).
    const dur = actor.anim.playOneShot(anim, { fade: 0.08, timeScale: weapon.attackTimeScale ?? 1 });
    // Если клипа нет (dur=0) — фоллбэк 0.3 с, чтобы удар всё равно сработал.
    this.pendingHits.push({ t: dur > 0 ? dur * weapon.hitAt : 0.3, weapon });
    this.cooldownLeft = weapon.cooldown;
    return true;
  }

  /** Тикает кулдаун и срабатывает накопленные hit-window. */
  fixedUpdate(stepSec: number, actor: MeleeActor, targets: readonly CombatTarget[]): void {
    this.cooldownLeft = Math.max(0, this.cooldownLeft - stepSec);
    if (this.pendingHits.length === 0) return;
    const rest: PendingHit[] = [];
    for (const hit of this.pendingHits) {
      hit.t -= stepSec;
      if (hit.t > 0) {
        rest.push(hit);
        continue;
      }
      this.strike(actor, hit.weapon, targets);
    }
    this.pendingHits = rest;
  }

  /** Сам удар: выбор целей в секторе и нанесение урона. */
  private strike(actor: MeleeActor, weapon: WeaponDef, targets: readonly CombatTarget[]): void {
    const alive = targets.filter((t) => t.alive);
    // radius = CAPSULE_RADIUS: дальность до поверхности тела, не до центра ног. Цель
    // вплотную (центр капсулы дальше range, но тела соприкасаются) — теперь задета.
    const points = alive.map((t) => ({ id: t.id, x: t.feet.x, z: t.feet.z, radius: CAPSULE_RADIUS }));
    const ids = selectMeleeTargets(
      actor.feet.x,
      actor.feet.z,
      actor.yaw,
      weapon.range ?? 2,
      weapon.arcDeg ?? 120,
      points,
    );
    for (const id of ids) {
      const target = alive.find((t) => t.id === id);
      if (!target) continue;
      const { damage } = computeHit(weapon.damage, actor.attackStats, target.defenseStats, this.rng);
      target.takeDamage(damage);
      this.onHit?.(target);
    }
  }
}
