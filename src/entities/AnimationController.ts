import * as THREE from 'three';
import { animClipMap, type AnimState } from '../data/animClipMap';

/**
 * Обёртка над AnimationMixer: локомоция с кроссфейдом + one-shot действия
 * (атака/смерть/подбор), блокирующие локомоцию до завершения.
 */
export class AnimationController {
  private mixer: THREE.AnimationMixer;
  private actions = new Map<AnimState, THREE.AnimationAction>();
  private locomotion: AnimState | null = null;
  private oneShot: THREE.AnimationAction | null = null;
  private onOneShotDone: (() => void) | null = null;
  /** Удерживаемая поза прицеливания (aimRanged). null — клипа нет или не целимся. */
  private aimHold: THREE.AnimationAction | null = null;
  /** Игрок ХОЧЕТ целиться (ПКМ зажат). Переживает выстрел: после него возвращаем aim-позу. */
  private aimingDesired = false;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [state, regex] of Object.entries(animClipMap) as [AnimState, RegExp][]) {
      const clip = clips.find((c) => regex.test(c.name));
      if (clip) this.actions.set(state, this.mixer.clipAction(clip));
    }
    this.mixer.addEventListener('finished', (e) => {
      if (this.oneShot && e.action === this.oneShot) {
        // Заклампленный one-shot (смерть) застывает в последнем кадре: не гасим
        // и не возвращаем локомоцию. busy остаётся true — труп не встанет в idle.
        if (e.action.clampWhenFinished) return;
        const done = this.onOneShotDone;
        this.oneShot.fadeOut(0.15);
        this.oneShot = null;
        this.onOneShotDone = null;
        // Выстрел в прицеливании — вернуть aim-позу, а не локомоцию.
        if (this.aimingDesired) {
          this.engageAimHold(0.15);
        } else {
          const loco = this.locomotion;
          this.locomotion = null;
          if (loco) this.setLocomotion(loco, 0.15);
        }
        done?.();
      }
    });
  }

  has(state: AnimState): boolean {
    return this.actions.has(state);
  }

  /** Циклическая локомоция (idle/run/...) с кроссфейдом. Игнорируется во время one-shot/aim. */
  setLocomotion(state: AnimState, fade = 0.18, timeScale = 1): void {
    const action = this.actions.get(state);
    if (!action) return;
    action.timeScale = timeScale;
    if (this.locomotion === state && !this.oneShot && !this.aimHold) return;
    if (this.oneShot || this.aimHold) {
      // Идёт one-shot или удержание прицела — запоминаем, применится после выхода.
      this.locomotion = state;
      return;
    }
    const prev = this.locomotion ? this.actions.get(this.locomotion) : null;
    this.locomotion = state;
    action.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
    if (prev && prev !== action) prev.fadeOut(fade);
  }

  /**
   * Одноразовое действие (атака, смерть, подбор). clamp=true — застыть в последнем
   * кадре (смерть). Возвращает длительность клипа в секундах (0 если клипа нет).
   */
  playOneShot(state: AnimState, opts?: { fade?: number; clamp?: boolean; timeScale?: number; onDone?: () => void }): number {
    const action = this.actions.get(state);
    if (!action) return 0;
    const fade = opts?.fade ?? 0.1;
    if (this.oneShot) this.oneShot.fadeOut(fade);
    const prev = this.locomotion ? this.actions.get(this.locomotion) : null;
    if (prev && prev !== action) prev.fadeOut(fade);
    // Aim-поза уступает выстрелу/удару; aimingDesired вернёт её по finished.
    if (this.aimHold && this.aimHold !== action) this.aimHold.fadeOut(fade);
    this.aimHold = null;
    this.oneShot = action;
    this.onOneShotDone = opts?.onDone ?? null;
    action.reset();
    action.timeScale = opts?.timeScale ?? 1;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = opts?.clamp ?? false;
    action.fadeIn(fade).play();
    return action.getClip().duration / (opts?.timeScale ?? 1);
  }

  /**
   * Поза прицеливания: держит клип aimRanged (2H_Ranged_Aiming) залупленным поверх
   * локомоции, чтобы персонаж ВСКИДЫВАЛ арбалет. Клип full-body — на время прицела
   * busy=true, и локомоция его не перебивает (игрок обычно целится стоя). Выстрел
   * (playOneShot shootRanged) гасит aim-hold и сам вернёт позу после (aimingDesired).
   * Нет клипа aimRanged — мягкий no-op (поза останется обычной).
   */
  setAiming(on: boolean): void {
    if (on === this.aimingDesired) return;
    this.aimingDesired = on;
    if (on) {
      // Во время активного one-shot позу не вскидываем — подхватится по finished.
      if (!this.oneShot) this.engageAimHold(0.15);
    } else if (this.aimHold) {
      this.aimHold.fadeOut(0.18);
      this.aimHold = null;
      // Вернуть локомоцию, если не идёт one-shot (иначе вернётся по finished).
      if (!this.oneShot && this.locomotion) {
        const loco = this.locomotion;
        this.locomotion = null;
        this.setLocomotion(loco, 0.18);
      }
    }
  }

  /** Поднять и залупить aim-позу с кроссфейдом. Без клипа aimRanged — no-op. */
  private engageAimHold(fade: number): void {
    const action = this.actions.get('aimRanged');
    if (!action) return;
    const prev = this.locomotion ? this.actions.get(this.locomotion) : null;
    if (prev && prev !== action) prev.fadeOut(fade);
    action.reset().setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.timeScale = 1;
    action.fadeIn(fade).play();
    this.aimHold = action;
  }

  /** Любая поза, блокирующая локомоцию: one-shot ИЛИ удержание прицела. */
  get busy(): boolean {
    return this.oneShot !== null || this.aimHold !== null;
  }

  /**
   * Идёт ли БЛОКИРУЮЩЕЕ действие (one-shot: удар/выстрел/смерть). В отличие от busy
   * НЕ включает aim-hold: из позы прицеливания выстрел должен проходить. Это и есть
   * гейт для RangedAttack — иначе зажатый ПКМ навсегда запретил бы стрелять.
   */
  get actionBusy(): boolean {
    return this.oneShot !== null;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
