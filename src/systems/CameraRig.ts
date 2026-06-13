import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Input } from '../core/Input';
import { GROUP_STATIC, groups, type PhysicsWorld } from '../core/PhysicsWorld';

const SENSITIVITY = 0.0024;
const PITCH_MIN = -0.25;
const PITCH_MAX = 1.25;
const DIST_MIN = 2;
const DIST_MAX = 9;

/** Боковой сдвиг камеры за плечо в режиме прицеливания, м (центр экрана уходит мимо головы). */
export const AIM_SHOULDER = 0.85;
/** Подъём якоря камеры в прицеливании, м (центр чуть выше — стрелять понятнее). */
export const AIM_RAISE = 0.15;
/** Скорость сглаживания over-shoulder перехода (lerp-коэффициент в секунду⁻¹ ≈ переход за ~0.12 с). */
export const AIM_LERP = 8;

/**
 * Сгладить over-shoulder вес к цели (0 — обычный 3-е лицо, 1 — полный сдвиг за плечо).
 * Чистая функция: экспоненциальный lerp, кламп в [0,1]. Тестируется без THREE.
 */
export function stepAimWeight(current: number, target: 0 | 1, dt: number): number {
  const t = Math.min(1, Math.max(0, dt) * AIM_LERP);
  const next = current + (target - current) * t;
  return Math.min(1, Math.max(0, next));
}

/** Радиус облёта деревни в главном меню, м. */
export const MENU_ORBIT_RADIUS = 62;
/** Высота камеры облёта над центром деревни, м. */
export const MENU_ORBIT_HEIGHT = 26;
/** Период полного облёта, с. */
export const MENU_ORBIT_PERIOD = 60;
/** Скорость возврата камеры к игроку при старте игры (lerp-коэффициент в секунду⁻¹ ≈ ~1 с до игрока). */
export const MENU_RETURN_LERP = 4.5;

/** Точка на окружности облёта (без аллокаций пишет в out). */
export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * Позиция камеры облёта меню: точка на окружности радиуса r вокруг (cx,cz) на
 * высоте cy+height, угол растёт линейно по времени (полный круг за period).
 * Чистая функция (пишет в out, без THREE) — тестируется без рендера.
 */
export function menuOrbitPos(
  out: XYZ,
  cx: number,
  cy: number,
  cz: number,
  timeSec: number,
  radius = MENU_ORBIT_RADIUS,
  height = MENU_ORBIT_HEIGHT,
  period = MENU_ORBIT_PERIOD,
): XYZ {
  const angle = (timeSec / period) * Math.PI * 2;
  out.x = cx + Math.cos(angle) * radius;
  out.y = cy + height;
  out.z = cz + Math.sin(angle) * radius;
  return out;
}

/** Камера третьего лица: орбита вокруг головы игрока, рейкаст против стен. */
export class CameraRig {
  yaw = Math.PI; // стартуем за спиной персонажа, смотрящего в -Z
  pitch = 0.35;
  dist = 5;
  /** Прицеливание (ПКМ): включает плавный over-shoulder сдвиг. Ставит Game. */
  aiming = false;

  private smoothedDist = 5;
  /** Вес over-shoulder сдвига 0..1 (сглаживается к aiming каждый кадр). */
  private aimWeight = 0;

  /** Режим облёта деревни в главном меню (камера уведена с игрока). Ставит Game. */
  private menuOrbit = false;
  /** Центр облёта (центр деревни на высоте террейна). */
  private readonly orbitCenter = new THREE.Vector3();
  /** Накопленное время облёта, с (для угла). */
  private orbitTime = 0;
  /**
   * Вес возврата к игроку 0..1: 1 — камера на орбите, 0 — у игрока. При выходе из
   * меню плавно гаснет (~1 с), смешивая позицию орбиты с обычной за-спиной.
   */
  private returnWeight = 0;

  // Скретч-векторы — без аллокаций в update (зовётся каждый кадр)
  private readonly _anchor = new THREE.Vector3();
  private readonly _out = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3(0, 1, 0);
  private readonly _orbitPos = new THREE.Vector3();
  private readonly _camTarget = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private physics: PhysicsWorld,
  ) {}

  applyInput(input: Input): void {
    this.yaw -= input.mouseDX * SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.mouseDY * SENSITIVITY, PITCH_MIN, PITCH_MAX);
    this.dist = THREE.MathUtils.clamp(this.dist + input.wheel * 0.6, DIST_MIN, DIST_MAX);
  }

  /**
   * Включить облёт деревни (главное меню). center — центр деревни (на высоте
   * террейна). Камера сразу прыгает на орбиту (returnWeight=1).
   */
  startMenuOrbit(center: THREE.Vector3): void {
    this.menuOrbit = true;
    this.orbitCenter.copy(center);
    this.returnWeight = 1;
  }

  /**
   * Выключить облёт (старт игры): камера плавно возвращается к игроку за ~1 с.
   * Флаг menuOrbit гаснет сразу, returnWeight тает в update — переход без рывка.
   * snap=true — мгновенный возврат без блендинга (смоуки стартуют минуя меню и
   * сразу читают cameraPos: плавный возврат сбил бы их ожидания позиции камеры).
   */
  stopMenuOrbit(snap = false): void {
    this.menuOrbit = false;
    if (snap) this.returnWeight = 0;
  }

  /** Идёт ли облёт/возврат (для гейта в Game). */
  get inMenuMode(): boolean {
    return this.menuOrbit || this.returnWeight > 0.001;
  }

  /**
   * Кадр облёта меню: камера ведёт круг вокруг центра деревни, смотрит на центр.
   * Зовётся вместо update, пока открыто главное меню (мир рисуется за оверлеем).
   */
  updateMenuOrbit(dt: number): void {
    this.orbitTime += dt;
    const c = this.orbitCenter;
    menuOrbitPos(this._orbitPos, c.x, c.y, c.z, this.orbitTime);
    this.camera.position.copy(this._orbitPos);
    this.camera.lookAt(c.x, c.y + 1.5, c.z); // лёгкий наклон к центру (цель чуть выше земли)
  }

  update(dt: number, playerFeet: THREE.Vector3, exclude?: RAPIER_NS.Collider): void {
    this.aimWeight = stepAimWeight(this.aimWeight, this.aiming ? 1 : 0, dt);

    const anchor = this._anchor.set(
      playerFeet.x,
      playerFeet.y + 1.65 + AIM_RAISE * this.aimWeight,
      playerFeet.z,
    );
    const out = this._out.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    // Вектор «вправо» относительно взгляда (горизонтальный): для бокового сдвига за плечо.
    this._right.crossVectors(out, this._up).normalize();

    // Сдвигаем И якорь, И камеру вбок: при lookAt(anchor) центр экрана (прицел)
    // уходит мимо головы, а камера остаётся параллельной — рейкаст из камеры
    // через её forward летит ровно в прицел.
    anchor.addScaledVector(this._right, AIM_SHOULDER * this.aimWeight);

    // Только статика — чтобы камера не дёргалась от NPC и лута
    const hit = this.physics.raycast(anchor, out, this.dist, exclude, groups(0xffff, GROUP_STATIC));
    const targetDist = hit !== null ? Math.max(0.5, hit * 0.92) : this.dist;

    // Приближаемся к стене мгновенно, отъезжаем плавно
    this.smoothedDist =
      targetDist < this.smoothedDist
        ? targetDist
        : THREE.MathUtils.lerp(this.smoothedDist, targetDist, Math.min(1, dt * 6));

    // Обычная за-спиной позиция камеры (цель возврата).
    const camTarget = this._camTarget.set(
      anchor.x + out.x * this.smoothedDist,
      anchor.y + out.y * this.smoothedDist,
      anchor.z + out.z * this.smoothedDist,
    );

    if (this.returnWeight > 0.001) {
      // Возврат после меню: продолжаем вести облёт (его позиция — старт перехода)
      // и плавно смешиваем к игроку. Вес тает за ~1 с, рывка нет.
      this.orbitTime += dt;
      const c = this.orbitCenter;
      menuOrbitPos(this._orbitPos, c.x, c.y, c.z, this.orbitTime);
      this.returnWeight = Math.max(0, this.returnWeight - dt * MENU_RETURN_LERP);
      const w = this.returnWeight;
      this.camera.position.set(
        THREE.MathUtils.lerp(camTarget.x, this._orbitPos.x, w),
        THREE.MathUtils.lerp(camTarget.y, this._orbitPos.y, w),
        THREE.MathUtils.lerp(camTarget.z, this._orbitPos.z, w),
      );
      // Точка взгляда тоже смешивается: от центра деревни к якорю игрока.
      this.camera.lookAt(
        THREE.MathUtils.lerp(anchor.x, c.x, w),
        THREE.MathUtils.lerp(anchor.y, c.y + 1.5, w),
        THREE.MathUtils.lerp(anchor.z, c.z, w),
      );
      return;
    }

    this.camera.position.copy(camTarget);
    this.camera.lookAt(anchor);
  }
}
