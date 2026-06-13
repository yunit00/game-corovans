import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { tintCharacter, type TintPalette } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_NPC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { bus } from '../core/EventBus';
import type { DefenderStats } from '../sim/damage';
import type { AiState } from '../sim/fsm';
import { stepAngle, yawFromDir } from '../sim/movement';
import { WEAPONS, type WeaponDef } from '../data/weapons';
import type { ArchetypeDef } from '../data/archetypes';
import { AnimationController } from './AnimationController';
import { CAPSULE_HALF, CAPSULE_RADIUS, CENTER_Y, Character, type Team } from './Character';

/** Высота террейна в точке — NPC «приклеен» к земле, вертикальную физику не считаем. */
export type HeightFn = (x: number, z: number) => number;

/** Диапазон детерминированного разброса роста боевых юнитов (строй не клонами). */
const COMBAT_SCALE = { min: 0.97, max: 1.05 } as const;
/** Амплитуда покадрового дрожания тона/яркости от spawn-id (мягкая — лица не портим). */
const JITTER_HUE = 0.05;
const JITTER_LIGHT = 0.07;

/**
 * Детерминированный внешний вид боевого юнита от spawn-id: базовая палитра архетипа
 * + мелкий разброс тона/яркости, чтобы строй из одинаковых моделей не выглядел
 * клонами. Два независимых хеша id дают раскоррелированные сдвиги hue/light и рост.
 */
function unitAppearance(base: TintPalette | undefined, id: number): { tint: TintPalette; scale: number } {
  // Два разных хеша одного id → независимые [0..1) для тона и для роста/яркости.
  const h1 = ((Math.imul(id ^ 0x9e3779b1, 0x85ebca6b) >>> 0) % 10000) / 10000;
  const h2 = ((Math.imul(id ^ 0x27d4eb2f, 0xc2b2ae35) >>> 0) % 10000) / 10000;
  const tint: TintPalette = {
    hue: (base?.hue ?? 0) + (h1 - 0.5) * 2 * JITTER_HUE,
    sat: base?.sat ?? 0,
    light: (base?.light ?? 0) + (h2 - 0.5) * 2 * JITTER_LIGHT,
  };
  const scale = COMBAT_SCALE.min + h2 * (COMBAT_SCALE.max - COMBAT_SCALE.min);
  return { tint, scale };
}

/**
 * Цель в рабочей памяти мозга. Структурно подходят PlayerCharacter, Skeleton,
 * House и сам NpcCharacter — AI, стрелы и милишка работают с одним контрактом.
 */
export interface NpcTarget {
  feet: THREE.Vector3;
  alive: boolean;
  hp: number;
  /** Максимум HP — порог летальности стрелы игрока (sim/projectile.arrowKillDamage). */
  maxHp: number;
  team: Team;
  defenseStats: DefenderStats;
  /** Радиус «тела» по XZ для больших целей (дом): дистанции AI считаются до стены, не до центра. */
  targetRadius?: number;
  takeDamage(n: number): void;
}

/**
 * Рабочая память мозга. Живёт прямо в NPC, а не в Map системы: нет лукапов
 * и нет аллокаций в тике — AISystem только мутирует поля.
 */
export interface BrainState {
  state: AiState;
  target: NpcTarget | null;
  /** Точка спавна — центр патрульного круга. */
  spawnX: number;
  spawnZ: number;
  /** Текущая точка маршрута патруля. */
  patrolX: number;
  patrolZ: number;
  /** Пауза в idle между точками патруля, с. */
  waitLeft: number;
  /** Кулдаун атаки, с. */
  cooldownLeft: number;
  /** Время до момента удара/выстрела начатой атаки, с (< 0 — атаки нет). */
  pendingT: number;
}

/**
 * Подвижный AI-персонаж Фазы 4. Тело kinematicPositionBased БЕЗ KCC:
 * полный character controller на 12 штук дорог, а NPC хватает «приклейки»
 * к высоте террейна + обхода препятствий стирингом (AISystem).
 */
export class NpcCharacter extends Character {
  readonly id: number;
  readonly def: ArchetypeDef;
  readonly weapon: WeaponDef;
  readonly brain: BrainState;
  /** Game инкрементит после смерти, по таймауту зовёт dispose. */
  corpseTimer = 0;

  private readonly heightAt: HeightFn;
  /** Скорость по XZ за последний фикс-шаг (для выбора анимации). */
  private lastSpeed = 0;
  private targetYaw: number;

  private constructor(id: number, def: ArchetypeDef, heightAt: HeightFn, faceYaw: number) {
    super();
    this.id = id;
    this.def = def;
    const weapon = WEAPONS[def.weaponId];
    if (!weapon) throw new Error(`archetype ${def.id}: неизвестное оружие ${def.weaponId}`);
    this.weapon = weapon;
    this.heightAt = heightAt;
    this.team = def.team;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.targetYaw = faceYaw;
    this.brain = {
      state: 'idle',
      target: null,
      spawnX: 0,
      spawnZ: 0,
      patrolX: 0,
      patrolZ: 0,
      waitLeft: 0,
      cooldownLeft: 0,
      pendingT: -1,
    };
  }

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    pos: THREE.Vector3, // ноги
    def: ArchetypeDef,
    id: number,
    heightAt: HeightFn,
    faceYaw = 0,
  ): Promise<NpcCharacter> {
    const npc = new NpcCharacter(id, def, heightAt, faceYaw);
    npc.brain.spawnX = pos.x;
    npc.brain.spawnZ = pos.z;
    npc.brain.patrolX = pos.x;
    npc.brain.patrolZ = pos.z;

    const gltf = await assets.model(`/assets/characters/${def.model}`);
    const model = AssetLoader.cloneSkinned(gltf.scene);
    // Детерминированный разброс тона/роста от spawn-id: строй из одинаковых моделей
    // не выглядит клонами. Материалы клонируются внутри tintCharacter — кэш GLB цел.
    const look = unitAppearance(def.tint, id);
    model.scale.setScalar(look.scale);
    tintCharacter(model, look.tint);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    npc.visual.add(model);
    npc.visual.position.copy(pos);
    npc.visual.rotation.y = faceYaw;
    npc.anim = new AnimationController(model, gltf.animations);
    npc.anim.setLocomotion('idle');
    await npc.attachWeaponMesh(assets, model);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      pos.x,
      pos.y + CENTER_Y,
      pos.z,
    );
    npc.body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(
      groups(GROUP_NPC, ALL_GROUPS),
    );
    npc.collider = physics.world.createCollider(colDesc, npc.body);

    return npc;
  }

  /**
   * Меш оружия в правую кисть. У KayKit-моделей есть сокет-кость handslot.r;
   * GLTFLoader вырезает точку из имени (PropertyBinding.sanitizeNodeName),
   * поэтому ищем и «handslotr». Нет сокета — NPC ходит с пустыми руками.
   */
  private async attachWeaponMesh(assets: AssetLoader, model: THREE.Object3D): Promise<void> {
    if (!this.weapon.mesh) return;
    const socket =
      model.getObjectByName('handslotr') ??
      model.getObjectByName('handslot.r') ??
      model.getObjectByName('hand_r') ??
      model.getObjectByName('handr');
    if (!socket) return;
    const gltf = await assets.model(`/assets/weapons/${this.weapon.mesh}.glb`);
    const mesh = gltf.scene.clone(true);
    // castShadow у оружия не включаем: тень от мелкого меша у тела неразличима,
    // а в shadow pass это лишний draw call на каждого NPC (модели и так по
    // 10–15 примитивов; полный merge GLB — отложен до Фазы 7, перф-аудит)
    socket.add(mesh);
  }

  /** Куда смотрит визуал — для конуса восприятия и милишного сектора. */
  get yaw(): number {
    return this.visual.rotation.y;
  }

  /** Повернуться к точке, не двигаясь (состояние attack). */
  face(x: number, z: number): void {
    const f = this.feet;
    const dx = x - f.x;
    const dz = z - f.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) this.targetYaw = yawFromDir(dx, dz);
  }

  /** Фикс-шаг: желаемая скорость из стиринга → кинематический перенос по террейну. */
  fixedUpdate(stepSec: number, vx: number, vz: number): void {
    if (!this.alive) return;
    const t = this.body.translation();
    const nx = t.x + vx * stepSec;
    const nz = t.z + vz * stepSec;
    // y всегда из террейна: NPC не прыгает и не падает, зато никогда не тонет в земле
    this.body.setNextKinematicTranslation({ x: nx, y: this.heightAt(nx, nz) + CENTER_Y, z: nz });
    this.lastSpeed = Math.hypot(vx, vz);
    if (this.lastSpeed > 0.05) this.targetYaw = yawFromDir(vx, vz);
  }

  /** Покадровый визуал: позиция из тела, поворот к targetYaw, локомоция по скорости. */
  update(dt: number): void {
    const t = this.body.translation();
    this.visual.position.set(t.x, t.y - CENTER_Y, t.z);
    this.visual.rotation.y = stepAngle(this.visual.rotation.y, this.targetYaw, dt * 10);

    if (!this.anim.busy) {
      if (this.lastSpeed > 0.5) {
        // Клип Running_A снят под ~4 м/с: масштабируем темп под скорость архетипа,
        // чтобы медленный brute не «скользил» по земле
        this.anim.setLocomotion('run', 0.18, Math.min(1.2, Math.max(0.7, this.lastSpeed / 4)));
      } else {
        this.anim.setLocomotion('idle');
      }
    }
    this.anim.update(dt);
  }

  /**
   * Тихая смерть «убежавшего» рейдера (RaidDirector): БЕЗ enemy:died — ни лута,
   * ни XP за юнита, которого игрок не убивал. Труп убирает Game по corpseTimer.
   */
  despawn(): void {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.collider.setEnabled(false);
    this.anim.playOneShot('death', { clamp: true, fade: 0.08 });
  }

  protected onDeath(): void {
    // Труп не блокирует проход и не ловит стрелы
    this.collider.setEnabled(false);
    this.anim.playOneShot('death', { clamp: true, fade: 0.08 });
    const f = this.feet;
    bus.emit('enemy:died', {
      id: this.id,
      archetype: this.def.id,
      pos: { x: f.x, y: f.y, z: f.z },
      xp: this.def.xp,
    });
  }

  dispose(scene: THREE.Scene, physics: PhysicsWorld): void {
    scene.remove(this.visual);
    // Коллайдер удалится вместе с телом
    physics.world.removeRigidBody(this.body);
  }
}
