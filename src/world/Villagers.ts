// НЕбоевые жители деревни (Фаза 6B): 3 эльфа-эльфа стоят/слоняются у своих мест
// и рынка, по [E] дают диалог с сайд-квестами. Это НЕ Character: ни hp/team/урона,
// ни участия в бою — kinematic-тело без коллайдера (как фауна), сквозь них можно
// пройти. Лёгкий wander в радиусе WANDER_RADIUS; при набеге «прячутся» — бегут к
// фонтану и стоят там, пока набег идёт.
//
// Логика блуждания живёт прямо здесь (мала и не нуждается в отдельном sim-файле):
// детерминированный rng от seed, точки внутри home-радиуса, пауза-idle между ними.
import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { animClipMap } from '../data/animClipMap';
import { mulberry32, randRange, type Rng } from '../core/rng';
import { deterministicScale, tintCharacter, type TintPalette } from '../core/meshUtils';
import { PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { stepAngle, yawFromDir } from '../sim/movement';
import { type VillagerId, type VillageNpcId } from '../data/quests';
import { VILLAGE } from './WorldData';
import type { Terrain } from './Terrain';

/** Высота капсулы над ногами (жители ростом с людей, как NPC). */
const CENTER_Y = 0.9;
/** Радиус блуждания вокруг «дома» жителя, м. */
const WANDER_RADIUS = 5;
/** Скорость прогулочного шага, м/с (медленнее боевого NPC). */
const WALK_SPEED = 1.4;
/** Скорость бегства к фонтану при набеге, м/с. */
const FLEE_SPEED = 4.2;
/** Дистанция «дошёл до цели», м. */
const ARRIVE_DIST = 0.6;
/** Пауза-idle между точками блуждания, диапазон с. */
const IDLE_PAUSE = { min: 2.5, max: 6 } as const;
/** Радиус сбора у фонтана при бегстве (жители жмутся к центру по кругу), м. */
const HIDE_RADIUS = 4;

/** Логические клипы жителя — спокойный набор (idle/walk), без боя. */
type VillagerClip = 'idle' | 'walk';

/**
 * Внешний вид жителя: модель + палитра перекраски + детерминированный рост.
 * Модели делятся с мировыми NPC и игроком, поэтому каждому даём свой тон одежды
 * (tintCharacter клонирует материалы — кэш не портится). Игрок носит rogue_hooded
 * БЕЗ перекраски (эталон), а lesli (тоже rogue_hooded) — пыльно-терракотовая, чтобы
 * не путалась с игроком. Рост — deterministicScale от id в диапазоне SCALE_RANGE.
 */
const APPEARANCE: Record<VillageNpcId, { model: string; tint: TintPalette }> = {
  mirne: { model: 'mage.glb', tint: { hue: 0.78, sat: 0.18, light: 0.04 } }, // травница — лиловая мантия
  brandt: { model: 'barbarian.glb', tint: { hue: 0.02, sat: 0.3, light: -0.02 } }, // плотник — рыжий
  lesli: { model: 'rogue_hooded.glb', tint: { hue: 0.04, sat: 0.34, light: -0.04 } }, // пастушка — пыльно-терракотовая
};

/** Диапазон детерминированной вариации роста именованных NPC. */
const SCALE_RANGE = { min: 0.94, max: 1.08 } as const;

/** Один житель: визуал + kinematic-тело + память блуждания. */
class Villager {
  readonly id: VillageNpcId;
  readonly visual = new THREE.Group();
  /** Точка спавна — центр ареала блуждания и «дом» для подписи интеракции. */
  readonly homeX: number;
  readonly homeZ: number;

  private body!: RAPIER.RigidBody;
  private mixer!: THREE.AnimationMixer;
  private readonly actions = new Map<VillagerClip, THREE.AnimationAction>();
  private current: VillagerClip | null = null;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly rng: Rng;
  private readonly _feet = new THREE.Vector3();

  /** Текущая цель блуждания/бегства. */
  private targetX: number;
  private targetZ: number;
  /** Остаток паузы-idle на месте, с. */
  private idleLeft: number;
  private targetYaw: number;
  private lastSpeed = 0;
  /** Прячется ли (набег): бежит к фонтану и стоит там. */
  private hiding = false;
  /** Персональная точка укрытия у фонтана (по кругу — жители не сходятся в одну). */
  private hideX: number;
  private hideZ: number;

  private constructor(id: VillageNpcId, x: number, z: number, heightAt: (x: number, z: number) => number, seed: number, hideAngle: number) {
    this.id = id;
    this.homeX = x;
    this.homeZ = z;
    this.heightAt = heightAt;
    this.rng = mulberry32(seed);
    this.targetX = x;
    this.targetZ = z;
    this.targetYaw = 0;
    // Первая пауза вразнобой — жители не дёргаются синхронно.
    this.idleLeft = randRange(this.rng, IDLE_PAUSE.min, IDLE_PAUSE.max);
    this.hideX = VILLAGE.x + Math.cos(hideAngle) * HIDE_RADIUS;
    this.hideZ = VILLAGE.z + Math.sin(hideAngle) * HIDE_RADIUS;
  }

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    id: VillageNpcId,
    x: number,
    z: number,
    heightAt: (x: number, z: number) => number,
    seed: number,
    hideAngle: number,
  ): Promise<Villager> {
    const v = new Villager(id, x, z, heightAt, seed, hideAngle);
    const look = APPEARANCE[id];
    const gltf = await assets.model(`/assets/characters/${look.model}`);
    const model = AssetLoader.cloneSkinned(gltf.scene);
    model.scale.setScalar(deterministicScale(id, SCALE_RANGE.min, SCALE_RANGE.max));
    // Свой тон одежды (материалы клонируются — кэш GLB и другие NPC не перекрашиваются).
    tintCharacter(model, look.tint);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    v.visual.add(model);
    const y = heightAt(x, z);
    v.visual.position.set(x, y, z);
    // Лицом к центру деревни — жители «общительны».
    v.targetYaw = Math.atan2(VILLAGE.x - x, VILLAGE.z - z);
    v.visual.rotation.y = v.targetYaw;

    // Мини-аниматор по образцу Critter (AnimationController заточен под игрока/NPC,
    // жителю хватает idle/walk). Клипы — общий KayKit-набор (Idle/Walking_A).
    v.mixer = new THREE.AnimationMixer(model);
    const clips: Record<VillagerClip, RegExp> = { idle: animClipMap.idle, walk: animClipMap.walk };
    for (const [state, re] of Object.entries(clips) as [VillagerClip, RegExp][]) {
      const clip = gltf.animations.find((c) => re.test(c.name));
      if (clip) v.actions.set(state, v.mixer.clipAction(clip));
    }
    v.setClip('idle');

    // Kinematic-тело БЕЗ коллайдера: позиция нужна для дистанций/визуала, физикой
    // и стрелами житель не задевается (как фауна).
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + CENTER_Y, z);
    v.body = physics.world.createRigidBody(bodyDesc);
    return v;
  }

  /** Позиция ног — общий кэш-вектор (читать сразу). */
  get feet(): THREE.Vector3 {
    const t = this.body.translation();
    return this._feet.set(t.x, t.y - CENTER_Y, t.z);
  }

  /** Включить/выключить режим бегства к фонтану (по набегу). */
  setHiding(on: boolean): void {
    if (this.hiding === on) return;
    this.hiding = on;
    if (on) {
      this.targetX = this.hideX;
      this.targetZ = this.hideZ;
      this.idleLeft = 0;
    } else {
      // Набег кончился — вернуться к дому и зажить обычной жизнью.
      this.targetX = this.homeX;
      this.targetZ = this.homeZ;
      this.idleLeft = 0;
    }
  }

  private setClip(state: VillagerClip, fade = 0.18): void {
    const action = this.actions.get(state);
    if (!action) return;
    if (this.current === state) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    this.current = state;
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
    if (prev && prev !== action) prev.fadeOut(fade);
  }

  /** Фикс-шаг: движение к цели (wander/flee), кинематический перенос по террейну. */
  fixedUpdate(stepSec: number): void {
    const t = this.body.translation();
    const fx = t.x;
    const fz = t.z;
    const dx = this.targetX - fx;
    const dz = this.targetZ - fz;
    const dist = Math.hypot(dx, dz);
    const speed = this.hiding ? FLEE_SPEED : WALK_SPEED;

    if (dist > ARRIVE_DIST) {
      const inv = 1 / dist;
      const vx = dx * inv * speed;
      const vz = dz * inv * speed;
      const nx = fx + vx * stepSec;
      const nz = fz + vz * stepSec;
      this.body.setNextKinematicTranslation({ x: nx, y: this.heightAt(nx, nz) + CENTER_Y, z: nz });
      this.lastSpeed = speed;
      this.targetYaw = yawFromDir(vx, vz);
      return;
    }

    // Дошли. Прячемся — просто стоим у фонтана. Иначе пауза-idle, затем новая точка.
    this.lastSpeed = 0;
    if (this.hiding) return;
    this.idleLeft -= stepSec;
    if (this.idleLeft <= 0) {
      this.idleLeft = randRange(this.rng, IDLE_PAUSE.min, IDLE_PAUSE.max);
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * WANDER_RADIUS;
      this.targetX = this.homeX + Math.cos(a) * r;
      this.targetZ = this.homeZ + Math.sin(a) * r;
    }
  }

  /** Покадровый визуал: позиция из тела, поворот к цели, клип по скорости. */
  update(dt: number): void {
    const t = this.body.translation();
    this.visual.position.set(t.x, t.y - CENTER_Y, t.z);
    this.visual.rotation.y = stepAngle(this.visual.rotation.y, this.targetYaw, dt * 7);
    this.setClip(this.lastSpeed > 0.2 ? 'walk' : 'idle');
    this.mixer.update(dt);
  }
}

/**
 * Менеджер жителей: спавн 3 эльфов у их мест, покадровый апдейт, поиск ближайшего
 * для [E]-интеракции диалога. Прячет всех на время набега (setRaiding).
 */
export class Villagers {
  /** Жители в порядке спавна. Пуст, пока build не отработал. */
  private readonly list: Villager[] = [];
  /** Идёт ли набег (жители прячутся) — кэш для setRaiding. */
  private raiding = false;

  /** Места жителей у домов/рынка деревни (центр VILLAGE.z=120). Угол укрытия — для расстановки у фонтана. */
  private static readonly SPOTS: { id: VillageNpcId; dx: number; dz: number; hideAngle: number }[] = [
    { id: 'mirne', dx: -14, dz: 6, hideAngle: Math.PI * 0.25 }, // травница — западнее, у домов
    { id: 'brandt', dx: 12, dz: -8, hideAngle: Math.PI * 1.1 }, // плотник — восточнее, ближе к стрельбищу
    { id: 'lesli', dx: 4, dz: 16, hideAngle: Math.PI * 1.7 }, // пастушка — южнее, к выгону
  ];

  async build(physics: PhysicsWorld, assets: AssetLoader, seed: number, terrain: Terrain): Promise<void> {
    const heightAt = (x: number, z: number): number => terrain.height(x, z);
    let i = 0;
    for (const spot of Villagers.SPOTS) {
      const x = VILLAGE.x + spot.dx;
      const z = VILLAGE.z + spot.dz;
      try {
        const v = await Villager.create(
          physics,
          assets,
          spot.id,
          x,
          z,
          heightAt,
          (seed ^ 0x5a17e ^ (i * 0x9e37)) >>> 0,
          spot.hideAngle,
        );
        this.list.push(v);
      } catch {
        console.warn(`[villagers] не загрузился житель ${spot.id}`);
      }
      i++;
    }
  }

  /** Добавить визуалы жителей в сцену (Game зовёт после build). */
  addToScene(scene: THREE.Scene): void {
    for (const v of this.list) scene.add(v.visual);
  }

  /** Фикс-шаг: блуждание/бегство всех жителей. */
  fixedUpdate(stepSec: number): void {
    for (const v of this.list) v.fixedUpdate(stepSec);
  }

  /** Покадровый визуал всех жителей. */
  update(dt: number): void {
    for (const v of this.list) v.update(dt);
  }

  /** Включить/выключить режим набега — жители прячутся у фонтана и обратно. */
  setRaiding(on: boolean): void {
    if (this.raiding === on) return;
    this.raiding = on;
    for (const v of this.list) v.setHiding(on);
  }

  /**
   * Ближайший к точке житель в пределах radius (для [E]-диалога) — id и дистанция.
   * null, если никого нет ближе radius. Не аллоцирует.
   */
  nearest(x: number, z: number, radius: number): { id: VillagerId; dist: number } | null {
    let bestId: VillagerId | null = null;
    let bestDist = radius;
    for (const v of this.list) {
      const f = v.feet;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestId = v.id;
      }
    }
    return bestId ? { id: bestId, dist: bestDist } : null;
  }

  /** Сколько жителей реально заспавнилось (для смоуков). */
  get count(): number {
    return this.list.length;
  }
}
