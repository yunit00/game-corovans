// Табличка «Точки над ИИ» у дороги рядом со спавном: полностью процедурная
// (столб + две доски-указателя с надписями через CanvasTexture), без внешних
// ассетов. Интеракция: подойти ближе INTERACT_DIST, нажать E — открывается
// телеграм-канал, разово начисляется награда монетами (флаг в localStorage).
import * as THREE from 'three';
import { ALL_GROUPS, GROUP_STATIC, groups, RAPIER, type PhysicsWorld } from '../core/PhysicsWorld';
import type { Hud } from '../ui/Hud';
import { SPAWN } from './WorldData';
import type { Terrain } from './Terrain';

/** Позиция таблички: у дороги возле SPAWN=(8,138), развёрнута лицом к спавну. */
const SIGN_X = 14;
const SIGN_Z = 132;
/** Дистанция интеракции, м. */
const INTERACT_DIST = 2.6;
/** Период проверки дистанции, с — раз в ~0.2 с, не каждый кадр. */
const CHECK_PERIOD = 0.2;
/** Флаг разовой награды — переживает перезагрузку страницы. */
const REWARD_KEY = 'korovany_tg_reward';
const TG_URL = 'https://t.me/TochkiNadAI';
const REWARD_COINS = 50;
/** Тёмное дерево досок и краска надписей. */
const WOOD_COLOR = 0x6b4a2f;
const PAINT_COLOR = '#f3e6c8';
/** Габариты доски-указателя, м: «стрелка» торчит вбок от столба. */
const BOARD_W = 1.6;
const BOARD_H = 0.45;
const BOARD_T = 0.06;
/** Высота столба и его сдвиг к КРАЮ доски, чтобы не перекрывать надпись.
 *  Доска крепится боком к столбу и торчит в сторону спавна (локально +x). */
const POST_H = 2.4;
const POST_W = 0.18;
/** Зазор: лицевая плоскость доски выдвинута перед столбом (локально +z),
 *  поэтому столб целиком позади надписи и ничего не загораживает. */
const BOARD_FRONT_Z = POST_W / 2 + BOARD_T / 2 + 0.01;
/** Доска смещена так, чтобы её ближний к столбу торец примыкал к нему. */
const BOARD_OFFSET_X = BOARD_W / 2 + POST_W / 2 - 0.05;

export class TelegramSign {
  /** Игрок в радиусе интеракции (обновляется раз в CHECK_PERIOD — для смоуков). */
  near = false;
  /** Награда уже выдана. */
  rewarded: boolean;
  private checkLeft = 0;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, terrain: Terrain) {
    this.rewarded = localStorage.getItem(REWARD_KEY) === '1';

    const y = terrain.height(SIGN_X, SIGN_Z);
    const group = new THREE.Group();
    group.position.set(SIGN_X, y, SIGN_Z);
    group.rotation.y = Math.atan2(SPAWN.x - SIGN_X, SPAWN.z - SIGN_Z); // лицом к спавну

    const wood = new THREE.MeshStandardMaterial({ color: WOOD_COLOR, roughness: 0.9 });
    // Столб в центре группы (x=0): доски-стрелки примыкают к нему торцом и торчат
    // вбок (+x), их лицевая плоскость вынесена вперёд (BOARD_FRONT_Z) — столб
    // позади надписи и не перекрывает её. (Раньше столб был сдвинут в -x на ширину
    // выноса доски — между ним и доской зиял зазор ~0.8 м, табличка «висела в воздухе».)
    const post = new THREE.Mesh(new THREE.BoxGeometry(POST_W, POST_H, POST_W), wood);
    post.position.set(0, POST_H / 2, 0);
    group.add(post);
    // Две доски-стрелки на высоте глаз; верхняя — крупная с названием канала.
    group.add(TelegramSign.makeBoard('Точки над ИИ', wood, 1.78, 0.04));
    group.add(TelegramSign.makeBoard('+50 монет', wood, 1.24, -0.03));

    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(group);

    // Тонкий коллайдер столба — статика, как у реквизита Village. Столб в центре
    // группы, так что коллайдер ставится прямо в (SIGN_X, SIGN_Z) без пересчёта.
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(POST_W / 2, POST_H / 2, POST_W / 2)
        .setTranslation(SIGN_X, y + POST_H / 2, SIGN_Z)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );
  }

  /**
   * Доска-указатель: прямоугольная панель с надписью краской на лицевой грани
   * (+z) и треугольный скошенный наконечник-стрелка на дальнем торце (+x).
   * Панель смещена вбок от столба (+x) и вперёд (+z), столб остаётся позади.
   */
  private static makeBoard(
    text: string,
    wood: THREE.Material,
    height: number,
    tilt: number,
  ): THREE.Object3D {
    // Канвас 4:1 под панель BOARD_W×BOARD_H — пропорции совпадают, текст не жмётся.
    const CW = 512;
    const CH = 128;
    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#6b4a2f'; // фон под цвет дерева — швов на гранях не видно
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = PAINT_COLOR;
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Центр канваса по обеим осям; maxWidth с симметричными отступами по 32px.
    const PAD = 32;
    ctx.fillText(text, CW / 2, CH / 2, CW - PAD * 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    // Порядок материалов BoxGeometry: +x, -x, +y, -y, +z (лицо), -z
    const panel = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_T), [
      wood, wood, wood, wood, front, wood,
    ]);

    // Наконечник-стрелка: треугольная призма у дальнего торца (+x), тех же материалов.
    const tipLen = BOARD_H * 0.6;
    const tip = new THREE.Shape();
    tip.moveTo(0, BOARD_H / 2);
    tip.lineTo(tipLen, 0);
    tip.lineTo(0, -BOARD_H / 2);
    tip.closePath();
    const arrow = new THREE.Mesh(
      new THREE.ExtrudeGeometry(tip, { depth: BOARD_T, bevelEnabled: false }),
      wood,
    );
    // Extrude растёт по +z от 0 — центрируем по толщине и ставим у торца панели.
    arrow.position.set(BOARD_W / 2, 0, -BOARD_T / 2);

    const board = new THREE.Group();
    board.add(panel, arrow);
    // Вынос вбок от столба и вперёд от его плоскости + лёгкий «рукодельный» наклон.
    board.position.set(BOARD_OFFSET_X, height, BOARD_FRONT_Z);
    board.rotation.z = tilt;
    return board;
  }

  /**
   * Покадрово из Game.tick. Дистанция считается раз в CHECK_PERIOD;
   * interact — edge-нажатие E этого кадра, grantCoins — путь начисления монет Game.
   */
  update(
    dt: number,
    playerX: number,
    playerZ: number,
    interact: boolean,
    hud: Hud,
    grantCoins: (amount: number) => void,
  ): void {
    this.checkLeft -= dt;
    if (this.checkLeft <= 0) {
      this.checkLeft = CHECK_PERIOD;
      const near = Math.hypot(playerX - SIGN_X, playerZ - SIGN_Z) < INTERACT_DIST;
      if (near !== this.near) {
        this.near = near;
        if (near) hud.showPrompt(this.promptText());
        else hud.hidePrompt();
      }
    }

    if (this.near && interact) {
      window.open(TG_URL, '_blank');
      if (!this.rewarded) {
        this.rewarded = true;
        localStorage.setItem(REWARD_KEY, '1');
        grantCoins(REWARD_COINS);
        hud.showPrompt(this.promptText()); // плашка сразу переключается на «спасибо»
      }
    }
  }

  private promptText(): string {
    return this.rewarded
      ? '„Точки над ИИ“ — спасибо за подписку!'
      : '[E] Подписаться на „Точки над ИИ“ — +50 монет';
  }
}
