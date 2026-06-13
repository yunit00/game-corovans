// Мировые NPC-квестодатели (волна B): отшельник у водопада, лесник в чаще,
// рыбак у пирса, квартирмейстер у дворца. По образцу Villagers, но статичнее:
// слоняются в радиусе 3 м у своего места, в бою не участвуют, при набеге НЕ
// прячутся (они вне деревни). По [E] — общий DialogScreen и та же квест-механика
// (один активный квест на всех, общий с деревенскими).
//
// Логика блуждания живёт здесь (мала): детерминированный rng от seed, точки в
// пределах радиуса, пауза-idle между ними. Тело — kinematic без коллайдера (как
// фауна/жители): сквозь NPC можно пройти, стрелы их не задевают.
import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { animClipMap } from '../data/animClipMap';
import { mulberry32, randRange, type Rng } from '../core/rng';
import { bboxOf, deterministicScale, enableShadows, scaleToFootprint, tintCharacter, type TintPalette } from '../core/meshUtils';
import { PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { stepAngle, yawFromDir } from '../sim/movement';
import type { Terrain } from './Terrain';
import { HERMIT_OFFSET, WATERFALL } from './Waterfall';
import { PALACE } from './WorldData';

/** Мировые NPC — подмножество VillagerId (мировые локации). */
export type WorldNpcId = 'hermit' | 'forester' | 'fisher' | 'quartermaster' | 'miller' | 'sentry';

/** Координаты NPC локаций концов дорог (приходят из Game по planRoadEnds). */
export interface RoadEndAnchors {
  /** Лесник переехал к концу западной дороги (заменяет старую точку в чаще). */
  forester: { x: number; z: number; faceYaw: number } | null;
  /** Мельник на ферме у конца северо-восточного просёлка. */
  miller: { x: number; z: number; faceYaw: number } | null;
  /** Дозорный на сторожевой заставе у конца восточного тракта. */
  sentry: { x: number; z: number; faceYaw: number } | null;
}

/** Высота капсулы над ногами. */
const CENTER_Y = 0.9;
/** Радиус блуждания вокруг места (статичнее жителей: 3 м). */
const WANDER_RADIUS = 3;
/** Скорость прогулочного шага, м/с. */
const WALK_SPEED = 1.2;
/** Дистанция «дошёл до цели», м. */
const ARRIVE_DIST = 0.5;
/** Пауза-idle между точками блуждания, диапазон с (дольше жителей — они вдумчивее). */
const IDLE_PAUSE = { min: 4, max: 9 } as const;

/**
 * Фоллбэк-точка лесника в чаще (если road-end не передан): историческая позиция.
 * Обычно лесник переезжает к концу западной дороги (лесничество), координата
 * приходит из Game (planRoadEnds). Декор-хижину строим там же, где встаёт NPC.
 */
const FORESTER_FALLBACK = { x: -150, z: 250 } as const;

/** Логические клипы — спокойный набор. */
type NpcClip = 'idle' | 'walk';

/**
 * Внешний вид NPC: модель + палитра перекраски. Модели делятся с жителями и игроком,
 * поэтому каждому даём свой тон (tintCharacter клонирует материалы — кэш цел). Пары
 * на одной модели разводим заметно: hermit (mage) пепельно-серый против лиловой mirne;
 * forester (rogue_hooded) тёмно-зелёный против терракотовой lesli и эталонного игрока;
 * quartermaster (knight) золотистый против стально-синего sentry; miller (barbarian)
 * мучнисто-светлый против рыжего brandt; fisher (rogue) болотный против зелёного
 * village_guard. Рост — deterministicScale от id (SCALE_RANGE).
 */
const APPEARANCE: Record<WorldNpcId, { model: string; tint: TintPalette }> = {
  hermit: { model: 'mage.glb', tint: { hue: 0, sat: -0.5, light: -0.06 } }, // отшельник — пепельно-серый
  forester: { model: 'rogue_hooded.glb', tint: { hue: 0.33, sat: 0.28, light: -0.12 } }, // лесник — тёмно-зелёный
  fisher: { model: 'rogue.glb', tint: { hue: 0.24, sat: 0.22, light: -0.08 } }, // рыбак — болотный
  quartermaster: { model: 'knight.glb', tint: { hue: 0.11, sat: 0.32, light: 0.06 } }, // квартирмейстер — золотистая отделка
  miller: { model: 'barbarian.glb', tint: { hue: 0.08, sat: -0.35, light: 0.16 } }, // мельник — мучнисто-светлый
  sentry: { model: 'knight.glb', tint: { hue: 0.58, sat: 0.26, light: -0.04 } }, // дозорный — стально-синий
};

/** Диапазон детерминированной вариации роста NPC. */
const SCALE_RANGE = { min: 0.94, max: 1.08 } as const;

/** Куда смотрит NPC в покое (мировой yaw на «интересную» точку). */
interface NpcAnchor {
  id: WorldNpcId;
  x: number;
  z: number;
  /** Куда повёрнут лицом (на воду/тропу/дворец). */
  faceYaw: number;
}

/** Один мировой NPC: визуал + kinematic-тело + память блуждания. */
class WorldNpc {
  readonly id: WorldNpcId;
  readonly visual = new THREE.Group();
  readonly homeX: number;
  readonly homeZ: number;

  private body!: RAPIER.RigidBody;
  private mixer!: THREE.AnimationMixer;
  private readonly actions = new Map<NpcClip, THREE.AnimationAction>();
  private current: NpcClip | null = null;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly rng: Rng;
  private readonly _feet = new THREE.Vector3();

  private targetX: number;
  private targetZ: number;
  private idleLeft: number;
  private targetYaw: number;
  private lastSpeed = 0;

  private constructor(anchor: NpcAnchor, heightAt: (x: number, z: number) => number, seed: number) {
    this.id = anchor.id;
    this.homeX = anchor.x;
    this.homeZ = anchor.z;
    this.heightAt = heightAt;
    this.rng = mulberry32(seed);
    this.targetX = anchor.x;
    this.targetZ = anchor.z;
    this.targetYaw = anchor.faceYaw;
    this.idleLeft = randRange(this.rng, IDLE_PAUSE.min, IDLE_PAUSE.max);
  }

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    anchor: NpcAnchor,
    heightAt: (x: number, z: number) => number,
    seed: number,
  ): Promise<WorldNpc> {
    const n = new WorldNpc(anchor, heightAt, seed);
    const look = APPEARANCE[anchor.id];
    const gltf = await assets.model(`/assets/characters/${look.model}`);
    const model = AssetLoader.cloneSkinned(gltf.scene);
    model.scale.setScalar(deterministicScale(anchor.id, SCALE_RANGE.min, SCALE_RANGE.max));
    // Свой тон одежды (материалы клонируются — кэш GLB и другие NPC не перекрашиваются).
    tintCharacter(model, look.tint);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    n.visual.add(model);
    const y = heightAt(anchor.x, anchor.z);
    n.visual.position.set(anchor.x, y, anchor.z);
    n.visual.rotation.y = anchor.faceYaw;

    n.mixer = new THREE.AnimationMixer(model);
    const clips: Record<NpcClip, RegExp> = { idle: animClipMap.idle, walk: animClipMap.walk };
    for (const [state, re] of Object.entries(clips) as [NpcClip, RegExp][]) {
      const clip = gltf.animations.find((c) => re.test(c.name));
      if (clip) n.actions.set(state, n.mixer.clipAction(clip));
    }
    n.setClip('idle');

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(anchor.x, y + CENTER_Y, anchor.z);
    n.body = physics.world.createRigidBody(bodyDesc);
    return n;
  }

  get feet(): THREE.Vector3 {
    const t = this.body.translation();
    return this._feet.set(t.x, t.y - CENTER_Y, t.z);
  }

  private setClip(state: NpcClip, fade = 0.18): void {
    const action = this.actions.get(state);
    if (!action) return;
    if (this.current === state) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    this.current = state;
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
    if (prev && prev !== action) prev.fadeOut(fade);
  }

  /** Фикс-шаг: лёгкое блуждание у места, kinematic-перенос по террейну. */
  fixedUpdate(stepSec: number): void {
    const t = this.body.translation();
    const fx = t.x;
    const fz = t.z;
    const dx = this.targetX - fx;
    const dz = this.targetZ - fz;
    const dist = Math.hypot(dx, dz);

    if (dist > ARRIVE_DIST) {
      const inv = 1 / dist;
      const vx = dx * inv * WALK_SPEED;
      const vz = dz * inv * WALK_SPEED;
      const nx = fx + vx * stepSec;
      const nz = fz + vz * stepSec;
      this.body.setNextKinematicTranslation({ x: nx, y: this.heightAt(nx, nz) + CENTER_Y, z: nz });
      this.lastSpeed = WALK_SPEED;
      this.targetYaw = yawFromDir(vx, vz);
      return;
    }
    this.lastSpeed = 0;
    this.idleLeft -= stepSec;
    if (this.idleLeft <= 0) {
      this.idleLeft = randRange(this.rng, IDLE_PAUSE.min, IDLE_PAUSE.max);
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * WANDER_RADIUS;
      this.targetX = this.homeX + Math.cos(a) * r;
      this.targetZ = this.homeZ + Math.sin(a) * r;
    }
  }

  update(dt: number): void {
    const t = this.body.translation();
    this.visual.position.set(t.x, t.y - CENTER_Y, t.z);
    this.visual.rotation.y = stepAngle(this.visual.rotation.y, this.targetYaw, dt * 7);
    this.setClip(this.lastSpeed > 0.2 ? 'walk' : 'idle');
    this.mixer.update(dt);
  }
}

/**
 * Менеджер мировых NPC: спавн у локаций, апдейт, поиск ближайшего для [E].
 * Места: отшельник на берегу озера у подножия водопада-стены, лесник у хижины в чаще, рыбак у пирса
 * (координата приходит из Game — пирс сид-зависимый), квартирмейстер у палаток дворца.
 */
export class WorldNpcs {
  private readonly list: WorldNpc[] = [];

  /**
   * @param pierPos позиция пирса (POI из Landmarks) — рыбака ставим рядом. null —
   *        прудов/пирса нет, рыбак и его удочка пропускаются.
   */
  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    pierPos: { x: number; z: number } | null,
    roadEnds: RoadEndAnchors = { forester: null, miller: null, sentry: null },
  ): Promise<void> {
    const heightAt = (x: number, z: number): number => terrain.height(x, z);
    const anchors = this.computeAnchors(pierPos, roadEnds);

    // Декор лесника (хижина): если лесник переехал к концу дороги — там же ставим
    // палатку; иначе декор уже строит RoadEnds-локация (лесничество). Удочку рыбака
    // строим у пирса. Декор до NPC — чтобы NPC встал у своего реквизита.
    if (!roadEnds.forester) await this.buildForesterHut(scene, assets, terrain, FORESTER_FALLBACK);
    if (pierPos) this.buildFishingRod(scene, terrain, pierPos);

    let i = 0;
    for (const anchor of anchors) {
      try {
        const n = await WorldNpc.create(
          physics,
          assets,
          anchor,
          heightAt,
          (seed ^ 0x3c0de ^ (i * 0x9e37)) >>> 0,
        );
        this.list.push(n);
      } catch {
        console.warn(`[worldnpcs] не загрузился NPC ${anchor.id}`);
      }
      i++;
    }
  }

  /** Координаты NPC у их локаций (рыбак — у пирса, лесник/мельник/дозорный — концы дорог). */
  private computeAnchors(
    pierPos: { x: number; z: number } | null,
    roadEnds: RoadEndAnchors,
  ): NpcAnchor[] {
    const anchors: NpcAnchor[] = [];

    // Отшельник — на ОТКРЫТОМ берегу озера у подножия стены (со стороны центра карты,
    // НЕ на склоне горы), сдвинут от WATERFALL на HERMIT_OFFSET по орту к центру. Лицом
    // к стене/потоку (к WATERFALL, против орта к центру). Орт к центру = −WATERFALL/|·|.
    const wd = Math.hypot(WATERFALL.x, WATERFALL.z) || 1;
    const toCx = -WATERFALL.x / wd;
    const toCz = -WATERFALL.z / wd;
    const hx = WATERFALL.x + toCx * HERMIT_OFFSET;
    const hz = WATERFALL.z + toCz * HERMIT_OFFSET;
    anchors.push({
      id: 'hermit',
      x: hx,
      z: hz,
      faceYaw: Math.atan2(WATERFALL.x - hx, WATERFALL.z - hz),
    });

    // Лесник — у лесничества на конце западной дороги (если задано), иначе фоллбэк
    // в чащу. Лицом вдоль дороги к центру (faceYaw road-end).
    if (roadEnds.forester) {
      anchors.push({ id: 'forester', x: roadEnds.forester.x, z: roadEnds.forester.z, faceYaw: roadEnds.forester.faceYaw });
    } else {
      anchors.push({
        id: 'forester',
        x: FORESTER_FALLBACK.x + 2.5,
        z: FORESTER_FALLBACK.z + 1,
        faceYaw: Math.atan2(-FORESTER_FALLBACK.x, -FORESTER_FALLBACK.z),
      });
    }

    // Мельник — у фермы/мельницы на конце северо-восточного просёлка.
    if (roadEnds.miller) {
      anchors.push({ id: 'miller', x: roadEnds.miller.x, z: roadEnds.miller.z, faceYaw: roadEnds.miller.faceYaw });
    }
    // Дозорный — на сторожевой заставе у конца восточного тракта.
    if (roadEnds.sentry) {
      anchors.push({ id: 'sentry', x: roadEnds.sentry.x, z: roadEnds.sentry.z, faceYaw: roadEnds.sentry.faceYaw });
    }

    // Рыбак — у пирса (если есть), лицом к воде (к пруду от берега).
    if (pierPos) {
      anchors.push({
        id: 'fisher',
        x: pierPos.x + 1.5,
        z: pierPos.z + 1.5,
        faceYaw: Math.atan2(pierPos.x - (pierPos.x + 1.5), pierPos.z - (pierPos.z + 1.5)),
      });
    }

    // Квартирмейстер — у палаток дворца (палатки на dx≈-44..-48, z+13..26), лицом к замку.
    const qx = PALACE.x - 42;
    const qz = PALACE.z + 20;
    anchors.push({
      id: 'quartermaster',
      x: qx,
      z: qz,
      faceYaw: Math.atan2(PALACE.x - qx, PALACE.z - qz),
    });

    return anchors;
  }

  /** Хижина лесника (фоллбэк в чаще): палатка + кострище + дрова. */
  private async buildForesterHut(
    scene: THREE.Scene,
    assets: AssetLoader,
    terrain: Terrain,
    at: { x: number; z: number },
  ): Promise<void> {
    const place = async (path: string, x: number, z: number, footprint: number, rot: number): Promise<void> => {
      let gltf;
      try {
        gltf = await assets.model(path);
      } catch {
        console.warn(`[worldnpcs] декор лесника не загрузился: ${path}`);
        return;
      }
      const obj = gltf.scene.clone();
      obj.scale.setScalar(scaleToFootprint(obj, footprint));
      obj.position.set(x, 0, z);
      obj.rotation.y = rot;
      obj.position.y = terrain.height(x, z) - bboxOf(obj).min.y;
      enableShadows(obj);
      scene.add(obj);
    };
    const { x, z } = at;
    const rot = Math.atan2(-x, -z); // вход к центру карты
    await place('/assets/world/survival/tent-canvas.glb', x, z, 4.5, rot);
    await place('/assets/world/survival/campfire-stand.glb', x + 3.5, z + 1.5, 1.6, 0);
    await place('/assets/world/survival/resource-wood.glb', x - 2.2, z + 1.8, 1, rot);
  }

  /** Удочка рыбака: тонкая «палка» под наклоном у пирса (Cylinder, дёшево). */
  private buildFishingRod(scene: THREE.Scene, terrain: Terrain, pierPos: { x: number; z: number }): void {
    const rx = pierPos.x + 1.5;
    const rz = pierPos.z + 1.5;
    const geo = new THREE.CylinderGeometry(0.015, 0.03, 2.2, 5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a28, roughness: 0.9 });
    const rod = new THREE.Mesh(geo, mat);
    const y = terrain.height(rx, rz);
    // Наклон удочки к воде (~35° от вертикали), комель у ног рыбака.
    rod.position.set(rx, y + 1.0, rz);
    rod.rotation.z = 0.6;
    rod.castShadow = true;
    scene.add(rod);
  }

  addToScene(scene: THREE.Scene): void {
    for (const n of this.list) scene.add(n.visual);
  }

  fixedUpdate(stepSec: number): void {
    for (const n of this.list) n.fixedUpdate(stepSec);
  }

  update(dt: number): void {
    for (const n of this.list) n.update(dt);
  }

  /**
   * Ближайший NPC к точке в пределах radius (для [E]-диалога) — id и дистанция.
   * null, если никого нет ближе radius. Не аллоцирует.
   */
  nearest(x: number, z: number, radius: number): { id: WorldNpcId; dist: number } | null {
    let bestId: WorldNpcId | null = null;
    let bestDist = radius;
    for (const n of this.list) {
      const f = n.feet;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bestDist) {
        bestDist = d;
        bestId = n.id;
      }
    }
    return bestId ? { id: bestId, dist: bestDist } : null;
  }

  /** Сколько мировых NPC реально заспавнилось (для смоуков). */
  get count(): number {
    return this.list.length;
  }
}
