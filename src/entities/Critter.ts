import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { DEFAULT_DEFENDER, type DefenderStats } from '../sim/damage';
import { stepAngle, yawFromDir } from '../sim/movement';
import { FAUNA_HP, type FaunaSpecies, type FaunaState } from '../sim/fauna';

/** Высота террейна в точке — зверь «приклеен» к земле, вертикали нет. */
export type HeightFn = (x: number, z: number) => number;

/** Виды фауны: олень/лань стадные, лиса одиночка (источник истины — sim/fauna). */
export type Species = FaunaSpecies;

/** Центр капсулы над ногами — звери мельче людей, капсула ниже. */
const CENTER_Y = 0.45;

/**
 * Клипы по виду. У оленя/лани имена с заглавной (Quaternius Ultimate Animals),
 * у лисы суффиксы отличаются — общий animClipMap (заточен под KayKit-людей)
 * сюда не подходит, держим мини-таблицу. Все три вида имеют Idle/Eating/Walk/Gallop.
 */
const CLIP_NAMES: Record<'idle' | 'eat' | 'walk' | 'run', string> = {
  idle: 'Idle',
  eat: 'Eating',
  walk: 'Walk',
  run: 'Gallop',
};

/** Визуальный масштаб модели по виду — лиса заметно мельче оленя. */
const SCALE: Record<Species, number> = { deer: 1.0, stag: 1.1, fox: 0.7 };

/** Темп клипа Gallop снят под крупного зверя — лисе чуть ускоряем. */
const RUN_TIMESCALE: Record<Species, number> = { deer: 1.0, stag: 0.95, fox: 1.25 };

/** Сколько труп зверя лежит на боку, прежде чем исчезнуть, с (~3 с). */
export const CARCASS_TTL = 3;
/** Угол заваливания трупа на бок, рад (≈90°). */
const CARCASS_ROLL = Math.PI / 2;
/** Скорость заваливания трупа, рад/с — падает на бок за ~0.3 с. */
const CARCASS_ROLL_SPEED = CARCASS_ROLL / 0.3;

/** Рабочая память автомата зверя — живёт прямо в Critter, без лукапов в системе. */
export interface CritterBrain {
  state: FaunaState;
  /** Центр ареала (точка спавна) — вокруг неё блуждание. */
  homeX: number;
  homeZ: number;
  /** Текущая цель блуждания. */
  wanderX: number;
  wanderZ: number;
  /** Остаток паузы пастьбы, с. */
  grazeLeft: number;
  /**
   * Последняя замеченная угроза и дистанция до неё: восприятие раунд-робином
   * обновляет их раз в несколько тиков, между ними зверь бежит от ПОСЛЕДНЕЙ
   * точки (память — как target у NPC), направление бегства не дёргается.
   */
  threatX: number;
  threatZ: number;
  threatDist: number;
}

/**
 * Лёгкое декоративное животное (Фаза 5.5). Kinematic-тело БЕЗ коллайдера: фауна
 * не участвует в физике/бою, сквозь неё можно пройти — дёшево и не мешает драке.
 * НЕ наследует Character (нет hp/team/урона): зверю это всё ни к чему.
 */
export class Critter {
  readonly id: number;
  readonly species: Species;
  readonly visual = new THREE.Group();
  readonly brain: CritterBrain;
  /** Спит — далеко от игрока: мозги/анимация не тикают (FaunaSystem решает). */
  asleep = false;

  // --- Охота (Фаза 6B): зверь — добыча. Структурно совместим с CombatTarget/ArrowTarget. ---
  hp: number;
  readonly maxHp: number;
  /** Зверь без брони — стрела/милишка проходят в полную силу. */
  readonly defenseStats: DefenderStats = { ...DEFAULT_DEFENDER };
  /** Сбит с ног: мозги/стиринг стоп, валится на бок, через CARCASS_TTL dispose. */
  dying = false;
  /** Трофеи уже начислены в инвентарь (Game). Защита от двойного дропа за кадр. */
  looted = false;
  /** Таймер трупа после смерти, с (Game убирает по CARCASS_TTL). */
  carcassTimer = 0;
  /** Текущий крен трупа на бок, рад (плавно растёт до CARCASS_ROLL). */
  private carcassRoll = 0;

  private body!: RAPIER.RigidBody;
  private mixer!: THREE.AnimationMixer;
  private readonly actions = new Map<'idle' | 'eat' | 'walk' | 'run', THREE.AnimationAction>();
  private current: 'idle' | 'eat' | 'walk' | 'run' | null = null;
  private readonly heightAt: HeightFn;
  private readonly _feet = new THREE.Vector3();
  /** Скорость по XZ за последний фикс-шаг — для выбора клипа. */
  private lastSpeed = 0;
  private targetYaw: number;

  private constructor(id: number, species: Species, heightAt: HeightFn, faceYaw: number) {
    this.id = id;
    this.species = species;
    this.heightAt = heightAt;
    this.targetYaw = faceYaw;
    this.maxHp = FAUNA_HP[species];
    this.hp = this.maxHp;
    this.brain = {
      state: 'graze',
      homeX: 0,
      homeZ: 0,
      wanderX: 0,
      wanderZ: 0,
      grazeLeft: 0,
      threatX: 0,
      threatZ: 0,
      threatDist: Infinity,
    };
  }

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    pos: THREE.Vector3, // ноги
    species: Species,
    id: number,
    heightAt: HeightFn,
    faceYaw = 0,
  ): Promise<Critter> {
    const critter = new Critter(id, species, heightAt, faceYaw);
    critter.brain.homeX = pos.x;
    critter.brain.homeZ = pos.z;
    critter.brain.wanderX = pos.x;
    critter.brain.wanderZ = pos.z;

    const gltf = await assets.model(`/assets/animals/${species}.glb`);
    const model = AssetLoader.cloneSkinned(gltf.scene);
    model.scale.setScalar(SCALE[species]);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    critter.visual.add(model);
    critter.visual.position.copy(pos);
    critter.visual.rotation.y = faceYaw;

    // Свой мини-аниматор: AnimationController завязан на animClipMap людей.
    critter.mixer = new THREE.AnimationMixer(model);
    for (const [state, name] of Object.entries(CLIP_NAMES) as ['idle' | 'eat' | 'walk' | 'run', string][]) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (clip) critter.actions.set(state, critter.mixer.clipAction(clip));
    }
    critter.setClip('idle');

    // Тело kinematic БЕЗ коллайдера: позиция нужна для дистанций/визуала,
    // но физикой и стрелами зверь не задевается (декорация).
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      pos.x,
      pos.y + CENTER_Y,
      pos.z,
    );
    critter.body = physics.world.createRigidBody(bodyDesc);

    return critter;
  }

  /** Позиция ног (низ тела). Общий кэш-вектор: читать сразу, не хранить. */
  get feet(): THREE.Vector3 {
    const t = this.body.translation();
    return this._feet.set(t.x, t.y - CENTER_Y, t.z);
  }

  /** Куда смотрит визуал — для конуса/направления (системе не нужно, но симметрично NPC). */
  get yaw(): number {
    return this.visual.rotation.y;
  }

  /** Жив, пока hp > 0 и не сбит. Цель охоты исчезает из стрел/милишки после смерти. */
  get alive(): boolean {
    return this.hp > 0 && !this.dying;
  }

  /**
   * Урон по зверю (охота): стрела/милишка. Уводит hp в 0 → dying: мозги/стиринг
   * стоп, зверь валится на бок (update) и через CARCASS_TTL Game его уберёт. Дроп
   * в инвентарь начисляет Game (нужны ITEMS/тикер), здесь — только смерть.
   */
  takeDamage(amount: number): void {
    if (this.dying) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.dying = true;
      this.carcassTimer = 0;
      this.setClip('idle', 0.1); // замираем из бега/пастьбы — дальше валится на бок
    }
  }

  /** Кроссфейд на клип состояния (idle/eat/walk/run); повтор того же — no-op. */
  private setClip(state: 'idle' | 'eat' | 'walk' | 'run', fade = 0.18, timeScale = 1): void {
    const action = this.actions.get(state);
    if (!action) return;
    action.timeScale = timeScale;
    if (this.current === state) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    this.current = state;
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
    if (prev && prev !== action) prev.fadeOut(fade);
  }

  /** Фикс-шаг: желаемая скорость из стиринга → кинематический перенос по террейну. */
  fixedUpdate(stepSec: number, vx: number, vz: number): void {
    if (this.dying) {
      this.lastSpeed = 0;
      return; // труп не двигается
    }
    const t = this.body.translation();
    const nx = t.x + vx * stepSec;
    const nz = t.z + vz * stepSec;
    // y всегда из террейна: зверь не прыгает и не падает, в землю не тонет.
    this.body.setNextKinematicTranslation({ x: nx, y: this.heightAt(nx, nz) + CENTER_Y, z: nz });
    this.lastSpeed = Math.hypot(vx, vz);
    if (this.lastSpeed > 0.05) this.targetYaw = yawFromDir(vx, vz);
  }

  /**
   * Покадровый визуал: позиция из тела, поворот к цели, клип по состоянию/скорости.
   * Спящий зверь (далеко от игрока) визуал не обновляет — кадр экономится.
   */
  update(dt: number): void {
    if (this.dying) {
      // Труп: останавливаем анимацию у первого же кадра смерти и плавно валим на
      // бок (крен вокруг локальной оси Z визуала). Простая реакция без скелетов.
      this.carcassTimer += dt;
      if (this.carcassRoll < CARCASS_ROLL) {
        this.carcassRoll = Math.min(CARCASS_ROLL, this.carcassRoll + CARCASS_ROLL_SPEED * dt);
        this.visual.rotation.z = this.carcassRoll;
        this.mixer.update(dt); // дотягиваем idle до позы покоя, дальше замираем
      }
      return;
    }
    if (this.asleep) return;
    const t = this.body.translation();
    this.visual.position.set(t.x, t.y - CENTER_Y, t.z);
    this.visual.rotation.y = stepAngle(this.visual.rotation.y, this.targetYaw, dt * 8);

    if (this.lastSpeed > 2.2) {
      // Быстрее порога — бег (flee): Gallop с поправкой темпа под вид.
      this.setClip('run', 0.12, RUN_TIMESCALE[this.species]);
    } else if (this.lastSpeed > 0.3) {
      this.setClip('walk');
    } else if (this.brain.state === 'graze') {
      // На месте во время пастьбы — щиплет траву (Eating), иначе просто стоит.
      this.setClip('eat');
    } else {
      this.setClip('idle');
    }
    this.mixer.update(dt);
  }

  dispose(scene: THREE.Scene, physics: PhysicsWorld): void {
    scene.remove(this.visual);
    physics.world.removeRigidBody(this.body);
  }
}
