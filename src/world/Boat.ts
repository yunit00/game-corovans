import * as THREE from 'three';
import {
  BoatState,
  makeBoat,
  resetBoat,
  boatSpeed,
  BOAT_BOB_RATE,
} from '../sim/boat';

/**
 * Лодка на главном озере (Фаза 6D, волна 2) — РЕНДЕР и интеграция визуала. Чистая
 * физика скольжения/предикаты посадки живут в sim/boat.ts; здесь только меши и их
 * привязка к BoatState. Игрок садится/высаживается через Game (контроллер игрока
 * отключается, камера ведёт лодку) — этот модуль лишь строит корпус, держит state и
 * двигает визуал по позиции/курсу + визуальные крен и покачивание на воде.
 *
 * Готовой модели лодки в ассетах нет — собираем низкополигональную лодку из
 * тонированных BoxGeometry (в стиле телеги корована и реквизита деревни: дерево
 * 0x6b4a2f + светлая окантовка). Дёшево по draw calls: один Group, несколько боксов
 * с общими материалами (борта/банки шарят материал). Скелетных анимаций нет.
 */

/** Дерево корпуса/бортов — тёплый коричневый (как доски/телега). */
const WOOD = 0x6b4a2f;
/** Светлая окантовка планширя/банок — выделяет силуэт на тёмной воде. */
const TRIM = 0x9c7a4e;

export class Boat {
  /** Чистое состояние физики (позиция/курс/скорость/крен/качка). Шагает Game через stepBoat. */
  readonly state: BoatState;
  /** Корневая группа лодки (позиция/курс/крен/качка — из state). */
  readonly visual = new THREE.Group();
  /** Точка сидения игрока внутри лодки (локальная, относительно visual). */
  readonly seatLocal = new THREE.Vector3(0, 0.45, -0.15);

  /** Якорь покоя (причал) — для resetBoat при выходе/загрузке. */
  private readonly dockX: number;
  private readonly dockZ: number;
  private readonly dockYaw: number;
  /** Уровень глади озера — Y, на котором покоится лодка (плюс покачивание). */
  private readonly waterY: number;

  constructor(dockX: number, dockZ: number, dockYaw: number, waterY: number) {
    this.dockX = dockX;
    this.dockZ = dockZ;
    this.dockYaw = dockYaw;
    this.waterY = waterY;
    this.state = makeBoat(dockX, dockZ, dockYaw);
    this.buildHull();
    this.syncVisual();
  }

  /** Собрать корпус из тонированных боксов: днище, борта, нос/корма, банки, весло. */
  private buildHull(): void {
    const woodMat = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85, metalness: 0 });
    const trimMat = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.8, metalness: 0 });

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      ry = 0,
      rz = 0,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.rotation.z = rz;
      m.castShadow = true;
      m.receiveShadow = true;
      this.visual.add(m);
      return m;
    };

    // Габарит лодки ~ 2.6 м длина (по Z, нос +Z), 1.1 м ширина, борта 0.35 м.
    const LEN = 2.6;
    const HALF_W = 0.55;
    const SIDE_H = 0.4;

    // Днище — плоский ящик у ватерлинии (чуть утоплен).
    add(new THREE.BoxGeometry(HALF_W * 2, 0.14, LEN), woodMat, 0, -0.05, 0);

    // Борта — два длинных тонких ящика, чуть наклонены наружу (rz) для формы.
    add(new THREE.BoxGeometry(0.1, SIDE_H, LEN), woodMat, HALF_W, 0.15, 0, 0, -0.12);
    add(new THREE.BoxGeometry(0.1, SIDE_H, LEN), woodMat, -HALF_W, 0.15, 0, 0, 0.12);

    // Планширь — светлая окантовка по верху бортов.
    add(new THREE.BoxGeometry(0.12, 0.06, LEN), trimMat, HALF_W + 0.02, 0.34, 0, 0, -0.12);
    add(new THREE.BoxGeometry(0.12, 0.06, LEN), trimMat, -HALF_W - 0.02, 0.34, 0, 0, 0.12);

    // Нос (+Z) и корма (−Z): сужающиеся торцы. Нос — клин (повёрнутый бокс).
    const bow = add(new THREE.BoxGeometry(HALF_W * 1.4, SIDE_H, 0.5), woodMat, 0, 0.13, LEN / 2 - 0.05);
    bow.scale.set(0.5, 1, 1); // нос уже — клин
    add(new THREE.BoxGeometry(HALF_W * 1.7, SIDE_H, 0.18), woodMat, 0, 0.13, -LEN / 2 + 0.06);

    // Две поперечные банки (скамьи) — игрок сидит на задней.
    add(new THREE.BoxGeometry(HALF_W * 1.8, 0.07, 0.22), trimMat, 0, 0.22, 0.5);
    add(new THREE.BoxGeometry(HALF_W * 1.8, 0.07, 0.22), trimMat, 0, 0.22, -0.35);

    // Весло, прислонённое к борту (декор, статичное).
    const oar = add(new THREE.BoxGeometry(0.05, 0.05, 1.8), woodMat, HALF_W - 0.05, 0.3, 0.1, 0, 0.25);
    oar.rotation.x = 0.15;
  }

  /** Сбросить лодку на причал (выход в меню/загрузка): state и визуал к якорю покоя. */
  resetToDock(): void {
    resetBoat(this.state, this.dockX, this.dockZ, this.dockYaw);
    this.syncVisual();
  }

  /**
   * Применить state к визуалу: позиция (на глади + покачивание), курс (yaw), крен
   * (roll), лёгкий тангаж от качки. Зовётся каждый кадр (после stepBoat в фикс-шаге).
   */
  syncVisual(): void {
    const s = this.state;
    const bobY = Math.sin(s.bob) * 0.04;
    const pitch = Math.cos(s.bob * 0.8) * 0.02; // лёгкий тангаж качки (visual-only)
    this.visual.position.set(s.x, this.waterY + bobY, s.z);
    this.visual.rotation.set(pitch, s.yaw, s.roll);
  }

  /** Курсовая скорость, м/с — Game отдаёт её звуку плеска/HUD. */
  get speed(): number {
    return boatSpeed(this.state);
  }

  /** Частота качки (для синхронизации звука/пены, если понадобится). */
  static readonly BOB_RATE = BOAT_BOB_RATE;
}
