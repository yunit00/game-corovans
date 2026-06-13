import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { ALL_GROUPS, GROUP_NPC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { bus } from '../core/EventBus';
import { AnimationController } from './AnimationController';
import { CAPSULE_HALF, CAPSULE_RADIUS, CENTER_Y, Character } from './Character';

export type SkeletonArchetype = 'skeleton_minion' | 'skeleton_rogue' | 'skeleton_warrior';

/** HP по архетипу. */
const HP_BY_ARCHETYPE: Record<SkeletonArchetype, number> = {
  skeleton_minion: 30,
  skeleton_rogue: 45,
  skeleton_warrior: 70,
};

/** Скелет-манекен Фазы 3: стоит на месте, получает урон, умирает. Двигаться начнёт в Фазе 4. */
export class Skeleton extends Character {
  readonly id: number;
  readonly archetype: SkeletonArchetype;
  /** Game инкрементит после смерти, по таймауту зовёт dispose. */
  corpseTimer = 0;

  private constructor(id: number, archetype: SkeletonArchetype) {
    super();
    this.id = id;
    this.archetype = archetype;
    this.team = 'villain';
    this.maxHp = HP_BY_ARCHETYPE[archetype];
    this.hp = this.maxHp;
  }

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    pos: THREE.Vector3, // ноги
    archetype: SkeletonArchetype,
    id: number,
    faceYaw?: number,
  ): Promise<Skeleton> {
    const s = new Skeleton(id, archetype);

    const gltf = await assets.model(`/assets/characters/${archetype}.glb`);
    const model = AssetLoader.cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    s.visual.add(model);
    s.visual.position.copy(pos);
    s.visual.rotation.y = faceYaw ?? 0;
    s.anim = new AnimationController(model, gltf.animations);
    s.anim.setLocomotion('idle');

    // Фиксированное тело: манекен не двигается
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + CENTER_Y, pos.z);
    s.body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(
      groups(GROUP_NPC, ALL_GROUPS),
    );
    s.collider = physics.world.createCollider(colDesc, s.body);

    return s;
  }

  protected onDeath(): void {
    // Труп не блокирует проход и не ловит стрелы
    this.collider.setEnabled(false);
    this.anim.playOneShot('death', { clamp: true, fade: 0.08 });
    const f = this.feet;
    bus.emit('enemy:died', {
      id: this.id,
      archetype: this.archetype,
      pos: { x: f.x, y: f.y, z: f.z },
      xp: 10,
    });
  }

  /** Только анимации — манекен стоит на месте. */
  update(dt: number): void {
    this.anim.update(dt);
  }

  dispose(scene: THREE.Scene, physics: PhysicsWorld): void {
    scene.remove(this.visual);
    // Коллайдер удалится вместе с телом
    physics.world.removeRigidBody(this.body);
  }
}
