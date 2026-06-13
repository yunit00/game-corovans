// Дом деревни как цель набега. НЕ Character: телу не нужны капсула/анимации,
// достаточно маленького адаптера под контракт NpcTarget (восприятие AI, милишка) —
// team 'elf' делает дом врагом скелетов через areEnemies('villain','elf').
import * as THREE from 'three';
import { bus } from '../core/EventBus';
import { DEFAULT_DEFENDER, type DefenderStats } from '../sim/damage';
import type { Team } from '../entities/Character';

const MAX_HP = 200;
/** Стоимость ремонта руины, монеты (Фаза 6.5: смысл разрушения домов). */
export const REPAIR_COST = 60;
/** Дым: частиц в руинах (полный буфер) и пока дом только повреждён (drawRange). */
const SMOKE_COUNT = 20;
const SMOKE_DAMAGED_COUNT = 10;
/** Высота столба дыма и скорость подъёма частиц, м и м/с. */
const SMOKE_HEIGHT = 4.5;
const SMOKE_SPEED_MIN = 0.7;
const SMOKE_SPEED_MAX = 1.4;
/** Руины: насколько просаживаем меш в землю и затемняем материалы. */
const RUIN_SINK = 0.6;
const RUIN_DARKEN = 0.35;
/** Огонь: частиц пламени поверх дыма, высота язычков и скорость подъёма, м и м/с. */
const FIRE_COUNT = 14;
const FIRE_HEIGHT = 2.4;
const FIRE_SPEED_MIN = 1.6;
const FIRE_SPEED_MAX = 2.8;

// Один материал дыма на все дома (требование перфа): создаётся лениво при первом
// повреждении — в мирной игре дыма нет и память не тратим.
let smokeMaterial: THREE.PointsMaterial | null = null;
function sharedSmokeMaterial(): THREE.PointsMaterial {
  if (!smokeMaterial) {
    smokeMaterial = new THREE.PointsMaterial({
      color: 0x4a4a4a,
      size: 0.7,
      transparent: true,
      opacity: 0.55,
      depthWrite: false, // полупрозрачные частицы не должны резать друг друга по z
    });
  }
  return smokeMaterial;
}

// Один материал пламени на все дома — оранжевые аддитивные точки поверх дыма.
// Скелеты «поджигают» дом при атаке: игрок видит огонь и бежит спасать.
let fireMaterial: THREE.PointsMaterial | null = null;
function sharedFireMaterial(): THREE.PointsMaterial {
  if (!fireMaterial) {
    fireMaterial = new THREE.PointsMaterial({
      color: 0xff7322,
      size: 0.9,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // язычки светятся, складываясь по яркости
    });
  }
  return fireMaterial;
}

export class House {
  readonly id: string;
  readonly root: THREE.Object3D;
  readonly pos: { x: number; z: number };
  hp = MAX_HP;
  readonly maxHp = MAX_HP;
  alive = true;

  // --- Контракт NpcTarget/CombatTarget ---
  readonly team: Team = 'elf';
  readonly defenseStats: DefenderStats = { ...DEFAULT_DEFENDER };
  /** Радиус «тела» по XZ — милишка AI бьёт по стене, а не по недостижимому центру. */
  readonly targetRadius: number;

  /** Ноги = точка на земле в центре дома (контракт NpcTarget). */
  private readonly _feet: THREE.Vector3;
  private readonly scene: THREE.Scene;
  private smoke: THREE.Points | null = null;
  private smokeSpeeds: Float32Array | null = null;
  private fire: THREE.Points | null = null;
  private fireSpeeds: Float32Array | null = null;
  /** Высота, на которую просел меш руины — чтобы ремонт вернул его точно вверх. */
  private sunk = 0;
  /** Клонированные при ruin() материалы → оригиналы: ремонт возвращает яркость. */
  private readonly origMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();

  constructor(
    id: string,
    root: THREE.Object3D,
    scene: THREE.Scene,
    x: number,
    groundY: number,
    z: number,
    footprint: number,
  ) {
    this.id = id;
    this.root = root;
    this.scene = scene;
    this.pos = { x, z };
    this._feet = new THREE.Vector3(x, groundY, z);
    // 0.42 — тот же коэффициент, что у box-коллайдера дома в Village
    this.targetRadius = footprint * 0.42;
  }

  get feet(): THREE.Vector3 {
    return this._feet;
  }

  /**
   * Восстановить HP из сейва (Фаза 6). Дом строится целым — здесь докручиваем
   * сохранённое состояние: половина HP → дым, ноль → руины. Зовётся один раз
   * после build, до первого update; повторно дым/руины не плодит (гейты по smoke/alive).
   */
  restoreFromSave(hp: number): void {
    const clamped = Math.max(0, Math.min(this.maxHp, Math.round(hp)));
    this.hp = clamped;
    if (clamped <= 0) {
      if (this.alive) {
        this.alive = false;
        this.ruin();
      }
    } else if (clamped <= this.maxHp / 2) {
      if (!this.smoke) this.spawnSmoke();
      if (!this.fire) this.spawnFire();
    }
  }

  takeDamage(n: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - n);
    // Дым с половины HP — игрок издалека видит, какой дом под атакой.
    // Огонь — оттуда же: скелеты «поджигают» дом, пламя зовёт игрока спасать.
    if (this.hp <= this.maxHp / 2) {
      if (!this.smoke) this.spawnSmoke();
      if (!this.fire) this.spawnFire();
    }
    if (this.hp <= 0) {
      this.alive = false;
      this.ruin();
      bus.emit('house:destroyed', { id: this.id });
    } else {
      bus.emit('house:damaged', { id: this.id, hp: this.hp, max: this.maxHp });
    }
  }

  /**
   * Восстановить руину за монеты ([E] у дома): целый меш/материалы/коллайдер
   * (коллайдер при ruin не удалялся), полный HP, огонь и дым гаснут. Зовёт Game
   * после списания монет; повторно (на живом доме) — no-op. Возвращает true при
   * фактическом ремонте — Game пишет сейв/тикер только тогда.
   */
  repair(): boolean {
    if (this.alive) return false;
    this.alive = true;
    this.hp = this.maxHp;
    // Вернуть исходные материалы (клоны ruin'а отбрасываем — их освобождать незачем,
    // общий glTF-материал жив) и поднять меш обратно из земли.
    for (const [obj, mat] of this.origMaterials) (obj as THREE.Mesh).material = mat;
    this.origMaterials.clear();
    this.root.position.y += this.sunk;
    this.sunk = 0;
    this.removeFire();
    this.removeSmoke();
    return true;
  }

  /**
   * Потушить активное пламя на уцелевшем доме (после отбитого набега угроза ушла).
   * Дым остаётся как след повреждения; на руине (alive=false) — no-op (там огня нет).
   */
  extinguish(): void {
    if (this.alive) this.removeFire();
  }

  /** Анимация дыма и огня (зовёт Village.update раз в кадр). Без частиц — бесплатный выход. */
  update(dt: number): void {
    if (this.smoke && this.smokeSpeeds) {
      const attr = this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < SMOKE_COUNT; i++) {
        let y = arr[i * 3 + 1]! + this.smokeSpeeds[i]! * dt;
        if (y > SMOKE_HEIGHT) y -= SMOKE_HEIGHT; // зацикливаем столб, без респауна частиц
        arr[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
    }
    if (this.fire && this.fireSpeeds) {
      const attr = this.fire.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < FIRE_COUNT; i++) {
        let y = arr[i * 3 + 1]! + this.fireSpeeds[i]! * dt;
        if (y > FIRE_HEIGHT) y -= FIRE_HEIGHT; // короткие язычки зацикливаем у основания
        arr[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
    }
  }

  /**
   * Ленивый дым: Points добавляется в сцену (не в root — руины просядут, а дым
   * должен подниматься от земли). Пока дом жив, drawRange режет до половины частиц.
   */
  private spawnSmoke(): void {
    const positions = new Float32Array(SMOKE_COUNT * 3);
    this.smokeSpeeds = new Float32Array(SMOKE_COUNT);
    const r = this.targetRadius * 0.6;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * r;
      positions[i * 3] = Math.sin(ang) * rad;
      positions[i * 3 + 1] = Math.random() * SMOKE_HEIGHT;
      positions[i * 3 + 2] = Math.cos(ang) * rad;
      this.smokeSpeeds[i] = SMOKE_SPEED_MIN + Math.random() * (SMOKE_SPEED_MAX - SMOKE_SPEED_MIN);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, this.alive ? SMOKE_DAMAGED_COUNT : SMOKE_COUNT);
    // Сфера на весь столб один раз — частицы двигаются каждый кадр, авторасчёт не нужен
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, SMOKE_HEIGHT / 2, 0),
      Math.max(this.targetRadius, SMOKE_HEIGHT),
    );
    this.smoke = new THREE.Points(geometry, sharedSmokeMaterial());
    this.smoke.position.set(this._feet.x, this._feet.y + 1.5, this._feet.z);
    this.scene.add(this.smoke);
  }

  /**
   * Ленивое пламя поверх дыма: короткие оранжевые аддитивные язычки у основания.
   * Дёшево (один Points, общий материал) — без точечных светильников на каждый дом.
   */
  private spawnFire(): void {
    const positions = new Float32Array(FIRE_COUNT * 3);
    this.fireSpeeds = new Float32Array(FIRE_COUNT);
    const r = this.targetRadius * 0.7;
    for (let i = 0; i < FIRE_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * r;
      positions[i * 3] = Math.sin(ang) * rad;
      positions[i * 3 + 1] = Math.random() * FIRE_HEIGHT;
      positions[i * 3 + 2] = Math.cos(ang) * rad;
      this.fireSpeeds[i] = FIRE_SPEED_MIN + Math.random() * (FIRE_SPEED_MAX - FIRE_SPEED_MIN);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, FIRE_HEIGHT / 2, 0),
      Math.max(this.targetRadius, FIRE_HEIGHT),
    );
    this.fire = new THREE.Points(geometry, sharedFireMaterial());
    // Пламя сидит ниже дыма — у основания дома, не в столбе.
    this.fire.position.set(this._feet.x, this._feet.y + 0.3, this._feet.z);
    this.scene.add(this.fire);
  }

  /** Убрать пламя со сцены и освободить геометрию (общий материал не трогаем). */
  private removeFire(): void {
    if (!this.fire) return;
    this.scene.remove(this.fire);
    this.fire.geometry.dispose();
    this.fire = null;
    this.fireSpeeds = null;
  }

  /** Убрать дым со сцены и освободить геометрию (общий материал не трогаем). */
  private removeSmoke(): void {
    if (!this.smoke) return;
    this.scene.remove(this.smoke);
    this.smoke.geometry.dispose();
    this.smoke = null;
    this.smokeSpeeds = null;
  }

  /** Руины: затемнить материалы (клоны! исходники общие у всех клонов glTF), просесть, дым гуще. */
  private ruin(): void {
    const cloned = new Map<THREE.Material, THREE.Material>();
    const darken = (m: THREE.Material): THREE.Material => {
      let c = cloned.get(m);
      if (!c) {
        c = m.clone();
        const color = (c as THREE.MeshStandardMaterial).color;
        if (color) color.multiplyScalar(RUIN_DARKEN);
        cloned.set(m, c);
      }
      return c;
    };
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Запоминаем оригинал ДО подмены — ремонт вернёт его (origMaterials).
      this.origMaterials.set(mesh, mesh.material);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(darken) : darken(mesh.material);
    });
    this.root.position.y -= RUIN_SINK;
    this.sunk = RUIN_SINK;
    // В руинах огонь догорает, но дым гуще — пламя гасим, столб дыма на полную.
    this.removeFire();
    if (!this.smoke) this.spawnSmoke();
    else this.smoke.geometry.setDrawRange(0, SMOKE_COUNT);
  }
}
