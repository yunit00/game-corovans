// Корован (Фаза 5): телега-кузов на кинематическом теле + лошадь впереди по пути.
// Едет по Path из sim/path.ts; кто и когда его останавливает/грабит — решает
// CaravanDirector, здесь только движение, визуал и собственный фазовый автомат.
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_NPC, groups, RAPIER, type PhysicsWorld } from '../core/PhysicsWorld';
import { hashSeed, mulberry32, type Rng } from '../core/rng';
import type { CaravanPlan } from '../sim/caravan';
import { stepAngle, yawFromDir } from '../sim/movement';
import { posAt, type Path } from '../sim/path';
import type { HeightFn } from './NpcCharacter';

/**
 * rolling — едет по пути; halted — стоит (эскорт дерётся или весь мёртв);
 * robbed — ограблена, накренилась, ждёт деспавна; gone — маршрут пройден или
 * таймер ограбления вышел, директор должен позвать dispose.
 */
export type CaravanState = 'rolling' | 'halted' | 'robbed' | 'gone';

/** Габарит телеги по длинной стороне, м (как footprint реквизита Village). */
const CART_FOOTPRINT = 3.5;
/**
 * Длина лошади по корпусу, м (scaleToFootprint по макс. горизонтали = глубине
 * модели). Рядом с телегой footprint 3.5 прежние 2.6 смотрелись жеребёнком —
 * тянем до реалистичных ~3.2, холка тогда выше бортов.
 */
const HORSE_LENGTH = 3.2;
/** Насколько лошадь впереди телеги по пути, м (корпус длиннее — отодвигаем). */
const HORSE_LEAD = 3.2;
/** Зазор тела над террейном — телега не «вспахивает» сплат дороги. */
const GROUND_CLEAR = 0.1;
/** Скорость доворота телеги/лошади, рад/с: телега инертнее персонажей. */
const TURN_RATE = 2.5;
/** Крен ограбленной телеги (rotation.z) — «разграбили и перекосили». */
const ROBBED_TILT = 0.12;
/** Сколько ограбленная телега стоит до деспавна, с. */
const ROBBED_TTL = 25;
/**
 * Скорость, под которую снят клип Walk лошади, м/с — timeScale подгоняет темп
 * под скорость тира (1.9–2.4), чтобы лошадь не «скользила» по дороге.
 */
const HORSE_WALK_REF_SPEED = 2.0;
/** Кроссфейд Walk↔Idle лошади, с. */
const HORSE_FADE = 0.25;

/** Пути моделей груза — раскладку по тиру задаёт CARGO_BY_TIER. */
const SACK_MODEL = '/assets/world/hexagon/sack.glb';
const CRATES_MODEL = '/assets/props/crates_stacked.glb';
const CHEST_MODEL = '/assets/props/chest_gold.glb';
/** Лёгкий разброс поворота груза в кузове, рад — чтобы мешки лежали «как кинули». */
const CARGO_YAW_JITTER = 0.5;
/**
 * Раскладка груза по тиру (раньше телеги едут пустые). Позиции/повороты — доли
 * внутренних габаритов кузова (см. layoutCargo), модель кладётся на пол кузова.
 * footprint — макс. горизонтальный размер модели, м (масштаб под кузов телеги).
 */
interface CargoItem {
  model: string;
  footprint: number;
  /** Доля длины кузова от центра: -0.5 (зад) … +0.5 (перёд по ходу). */
  alongFrac: number;
  /** Доля ширины кузова от центра: -0.5 (левый борт) … +0.5 (правый). */
  sideFrac: number;
}
const CARGO_BY_TIER: Record<CaravanPlan['tier'], readonly CargoItem[]> = {
  // poor — пара мешков по разным углам кузова
  poor: [
    { model: SACK_MODEL, footprint: 0.9, alongFrac: -0.18, sideFrac: -0.22 },
    { model: SACK_MODEL, footprint: 0.9, alongFrac: 0.2, sideFrac: 0.18 },
  ],
  // merchant — мешок сбоку + уменьшенная стопка ящиков по центру
  merchant: [
    { model: CRATES_MODEL, footprint: 1.5, alongFrac: -0.05, sideFrac: 0 },
    { model: SACK_MODEL, footprint: 0.9, alongFrac: 0.28, sideFrac: -0.2 },
  ],
  // royal — ящики + золотой «сундук» (props/chest_gold.glb)
  royal: [
    { model: CRATES_MODEL, footprint: 1.4, alongFrac: 0.18, sideFrac: 0.12 },
    { model: CHEST_MODEL, footprint: 1.3, alongFrac: -0.18, sideFrac: -0.1 },
  ],
};

// Скретчи модуля — корован один, fixedUpdate синхронный, без аллокаций в шаге
const _p = { x: 0, z: 0, dirX: 1, dirZ: 0 };
const _quat = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

export class Caravan {
  state: CaravanState = 'rolling';
  /** Пройденная дистанция по пути, м (читают директор и debugState). */
  s: number;
  readonly plan: CaravanPlan;
  readonly path: Path;

  body!: RAPIER_NS.RigidBody;
  collider!: RAPIER_NS.Collider;
  /** Корневая группа телеги (позиция/yaw — из тела). */
  readonly visual = new THREE.Group();
  /** Лошадь — отдельный корень: едет впереди по пути, тела не имеет. */
  private readonly horseRoot = new THREE.Group();
  private cartMesh!: THREE.Object3D;
  /**
   * Груз в кузове — child меша телеги (едет и кренится вместе с ней). При robbed
   * прячем целиком (visible=false): телегу обчистили. Без коллайдеров.
   */
  private cargoRoot: THREE.Group | null = null;

  private readonly sEnd: number;
  private readonly heightAt: HeightFn;
  private readonly scene: THREE.Scene;
  private readonly physics: PhysicsWorld;
  private yaw = 0;
  private robbedLeft = ROBBED_TTL;
  /** Позиция лошади из фикс-шага; update только применяет к визуалу. */
  private horseX = 0;
  private horseZ = 0;
  private horseYaw = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private walkAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private horseWalking = false;
  /** Кэш для pos — геттер зовут в покадровой проверке дистанции [E]. */
  private readonly _pos = new THREE.Vector3();

  private constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    plan: CaravanPlan,
    path: Path,
    sStart: number,
    sEnd: number,
    heightAt: HeightFn,
  ) {
    this.scene = scene;
    this.physics = physics;
    this.plan = plan;
    this.path = path;
    this.s = sStart;
    this.sEnd = sEnd;
    this.heightAt = heightAt;
  }

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    scene: THREE.Scene,
    plan: CaravanPlan,
    path: Path,
    sStart: number,
    sEnd: number,
    heightAt: HeightFn,
  ): Promise<Caravan> {
    const c = new Caravan(scene, physics, plan, path, sStart, sEnd, heightAt);

    // Телега: основание модели — в ноль группы (пивоты KayKit бывают в центре)
    const cartGltf = await assets.model('/assets/world/town/cart.glb');
    const cart = cartGltf.scene.clone();
    cart.scale.setScalar(scaleToFootprint(cart, CART_FOOTPRINT));
    cart.position.y = -bboxOf(cart).min.y;
    enableShadows(cart);
    c.cartMesh = cart;
    c.visual.add(cart);

    // Груз в кузов по тиру (раньше телеги едут пустые). rng детерминирован от
    // тира+лута: один и тот же план — одинаковая раскладка, но мешки не «по линейке».
    await c.loadCargo(assets, mulberry32(hashSeed(`${plan.tier}:${plan.lootCoins}`)));

    // Лошадь: скиннед-клон (свой скелет — корованов может быть несколько за сессию)
    const horseGltf = await assets.model('/assets/animals/horse.glb');
    const horse = AssetLoader.cloneSkinned(horseGltf.scene);
    horse.scale.setScalar(scaleToFootprint(horse, HORSE_LENGTH));
    horse.position.y = -bboxOf(horse).min.y;
    enableShadows(horse);
    c.horseRoot.add(horse);
    // Клипы Quaternius: Walk в движении, Idle на остановках; нет клипа — лошадь
    // просто статуэтка, телега едет без анимации (хуже, но не падаем)
    c.mixer = new THREE.AnimationMixer(horse);
    const walkClip = horseGltf.animations.find((a) => a.name === 'Walk');
    const idleClip = horseGltf.animations.find((a) => a.name === 'Idle');
    if (walkClip) {
      c.walkAction = c.mixer.clipAction(walkClip);
      c.walkAction.timeScale = Math.min(1.4, Math.max(0.7, plan.speed / HORSE_WALK_REF_SPEED));
    }
    if (idleClip) c.idleAction = c.mixer.clipAction(idleClip);
    c.idleAction?.play();

    // Стартовая поза — до первого фикс-шага, чтобы не мигнуть в (0,0,0).
    // Скаляры копируем сразу: второй posAt перепишет общий скретч _p
    const p = posAt(path, sStart, _p);
    c.yaw = yawFromDir(p.dirX, p.dirZ);
    const cartX = p.x;
    const cartZ = p.z;
    const y = heightAt(cartX, cartZ) + GROUND_CLEAR;
    const h = posAt(path, sStart + HORSE_LEAD, _p);
    c.horseX = h.x;
    c.horseZ = h.z;
    c.horseYaw = yawFromDir(h.dirX, h.dirZ);
    c.visual.position.set(cartX, y, cartZ);
    c.visual.rotation.y = c.yaw;
    c.horseRoot.position.set(h.x, heightAt(h.x, h.z), h.z);
    c.horseRoot.rotation.y = c.horseYaw;
    scene.add(c.visual, c.horseRoot);

    // Тело kinematicPositionBased, кубоид телеги. Membership — GROUP_NPC, а НЕ
    // GROUP_STATIC, по двум причинам: (1) «усы» объезда AISystem фильтруют только
    // статику — телега в центре строя не распугивала бы собственный эскорт
    // каждый тик; (2) стрелы ProjectileSystem «втыкаются» только в статику —
    // воткнутая стрела зависала бы в воздухе, когда телега уедет из-под неё.
    // Filter ALL: для капсул игрока и NPC телега — честное препятствие.
    const size = bboxOf(cart).getSize(new THREE.Vector3());
    c.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(cartX, y, cartZ)
        .setRotation(_quat.setFromAxisAngle(_UP, c.yaw)),
    );
    c.collider = physics.world.createCollider(
      // 0.42 от габарита — как у box-коллайдеров Village (борта чуть уже меша)
      RAPIER.ColliderDesc.cuboid(size.x * 0.42, size.y / 2, size.z * 0.42)
        .setTranslation(0, size.y / 2, 0) // основание куба — на уровне тела (земля)
        .setCollisionGroups(groups(GROUP_NPC, ALL_GROUPS)),
      c.body,
    );
    return c;
  }

  /**
   * Кладёт груз по тиру в кузов телеги как children меша (едут и кренятся с ней).
   * Раскладка из CARGO_BY_TIER, позиции — доли внутренних габаритов кузова; пол
   * кузова берём как долю высоты телеги (борта/колёса ниже груза). Без коллайдеров,
   * castShadow=false (мелочь, тени с груза только грузят рендер).
   */
  private async loadCargo(assets: AssetLoader, rng: Rng): Promise<void> {
    const items = CARGO_BY_TIER[this.plan.tier];
    // Локальный bbox телеги (уже отмасштабирована, основание в y=0): длина по Z,
    // ширина по X — кузов KayKit ориентирован вдоль модели.
    const cartBox = bboxOf(this.cartMesh);
    const cartSize = cartBox.getSize(new THREE.Vector3());
    // Пол кузова — над колёсами/осями: ~0.42 высоты телеги (низ бортов).
    const bedY = cartBox.min.y + cartSize.y * 0.42;
    // Усадка в кузов: оставляем зазор до бортов, чтобы груз не торчал за габарит.
    const bedLen = cartSize.z * 0.62;
    const bedWid = cartSize.x * 0.5;

    const cargo = new THREE.Group();
    for (const item of items) {
      let gltf;
      try {
        gltf = await assets.model(item.model);
      } catch {
        // Модель груза не загрузилась — пропускаем штуку, телега всё равно едет
        console.warn(`[caravan] груз не загрузился: ${item.model}`);
        continue;
      }
      const mesh = gltf.scene.clone();
      mesh.scale.setScalar(scaleToFootprint(mesh, item.footprint));
      // На пол кузова: основание модели (пивоты бывают в центре) — на bedY
      mesh.position.set(
        item.sideFrac * bedWid,
        bedY - bboxOf(mesh).min.y,
        item.alongFrac * bedLen,
      );
      mesh.rotation.y = (rng() - 0.5) * CARGO_YAW_JITTER;
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
      cargo.add(mesh);
    }
    this.cargoRoot = cargo;
    this.cartMesh.add(cargo);
  }

  /** Центр телеги (низ кузова). Возвращает кэш-вектор: читать сразу, не хранить. */
  get pos(): THREE.Vector3 {
    const t = this.body.translation();
    return this._pos.set(t.x, t.y, t.z);
  }

  /** Остановка/возобновление — только пока корован «жив» (директор зовёт каждый шаг). */
  setHalted(halted: boolean): void {
    if (this.state !== 'rolling' && this.state !== 'halted') return;
    this.state = halted ? 'halted' : 'rolling';
  }

  /** Грабёж состоялся: крен и таймер деспавна. Лут/heat/события — на директоре. */
  rob(): void {
    if (this.state !== 'halted') return;
    this.state = 'robbed';
    this.robbedLeft = ROBBED_TTL;
    // Телегу обчистили — груз исчезает (прячем всю группу разом).
    if (this.cargoRoot) this.cargoRoot.visible = false;
  }

  /** Фикс-шаг: продвижение по пути и кинематический перенос. */
  fixedUpdate(stepSec: number): void {
    if (this.state === 'gone') return;
    if (this.state === 'robbed') {
      this.robbedLeft -= stepSec;
      if (this.robbedLeft <= 0) this.state = 'gone';
      return;
    }
    if (this.state !== 'rolling') return; // halted: тело стоит, лошадь в Idle

    this.s += this.plan.speed * stepSec;
    if (this.s >= this.sEnd) {
      this.s = this.sEnd;
      this.state = 'gone';
      return;
    }
    const p = posAt(this.path, this.s, _p);
    // Доворот в фикс-шаге (детерминизм), телега поворачивает инертнее NPC
    this.yaw = stepAngle(this.yaw, yawFromDir(p.dirX, p.dirZ), stepSec * TURN_RATE);
    this.body.setNextKinematicTranslation({
      x: p.x,
      y: this.heightAt(p.x, p.z) + GROUND_CLEAR,
      z: p.z,
    });
    this.body.setNextKinematicRotation(_quat.setFromAxisAngle(_UP, this.yaw));

    const h = posAt(this.path, this.s + HORSE_LEAD, _p);
    this.horseX = h.x;
    this.horseZ = h.z;
    this.horseYaw = yawFromDir(h.dirX, h.dirZ);
  }

  /** Покадровый визуал: телега из тела, лошадь из полей фикс-шага, анимации. */
  update(dt: number): void {
    if (this.state === 'gone') return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.visual.position.set(t.x, t.y, t.z);
    this.visual.quaternion.set(r.x, r.y, r.z, r.w);

    // Крен ограбленной телеги — плавный, на внутреннем меше (yaw живёт на корне)
    const tilt = this.state === 'robbed' ? ROBBED_TILT : 0;
    if (Math.abs(this.cartMesh.rotation.z - tilt) > 0.001) {
      this.cartMesh.rotation.z += (tilt - this.cartMesh.rotation.z) * Math.min(1, dt * 5);
    }

    this.horseRoot.position.set(this.horseX, this.heightAt(this.horseX, this.horseZ), this.horseZ);
    this.horseRoot.rotation.y = stepAngle(this.horseRoot.rotation.y, this.horseYaw, dt * TURN_RATE * 2);

    const walking = this.state === 'rolling';
    if (walking !== this.horseWalking) {
      this.horseWalking = walking;
      const on = walking ? this.walkAction : this.idleAction;
      const off = walking ? this.idleAction : this.walkAction;
      on?.reset().fadeIn(HORSE_FADE).play();
      off?.fadeOut(HORSE_FADE);
    }
    this.mixer?.update(dt);
  }

  /** Снять с мира. Geometry/material — клоны кэша AssetLoader, их не диспоузим. */
  dispose(): void {
    this.state = 'gone';
    this.scene.remove(this.visual, this.horseRoot);
    this.physics.world.removeRigidBody(this.body);
  }
}
