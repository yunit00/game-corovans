// Спрятанные сундуки (Фаза 6, спрятаны заметно лучше в волне C+):
// 15 детерминированных от seed точек, упрятанных в укрытия — к валунам, поваленным
// брёвнам, в кусты, за камни у горной стены, подальше от дорог и открытых полян.
// Меш — props/chest.glb (рядовые) / props/chest_gold.glb (эпические; ценнее, но не
// крупнее), с фоллбэком на стилизованный ящик из двух box-геометрий. Интеракция по
// образцу TelegramSign: подойти ближе INTERACT_DIST, нажать E — крышка наклоняется,
// фонтан монет + предмет в инвентарь (ролл по таблице сундука). id сундука в
// openedChests (для сейва), повторно не открывается.
//
// Маскирующий декор (кусты/камни) рядом с каждым сундуком — общими InstancedMesh
// (по образцу Landmarks), чтобы спрятать сундук, не плодя draw calls: со «своей»
// стороны (yaw) сундук читается, а со стороны открытого пространства его прикрывает
// куст/валун.
//
// Координаты НЕ через sim-модуль: точки заданы вручную по укрытиям (CHEST_SPOTS),
// а seed лишь джиттерит их и тасует таблицы лута — так раскладка стабильна между
// перезагрузками одного забега, но «своя» для каждого seed. Пруды (2) и форт (1)
// приходят аргументами и уточняются в build по их фактическим позициям.
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, extractInstancedModel, type InstancedModel } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, RAPIER, type PhysicsWorld } from '../core/PhysicsWorld';
import { mulberry32, randRange, type Rng } from '../core/rng';
import type { Hud } from '../ui/Hud';
import { rollLoot } from '../sim/lootTables';
import { ITEMS } from '../data/items';
import type { Terrain } from './Terrain';

/** Дистанция интеракции, м (как у TelegramSign). */
const INTERACT_DIST = 2.8;
/** Период проверки дистанции, с — раз в ~0.2 с, не каждый кадр. */
const CHECK_PERIOD = 0.2;
/** Масштаб меша сундука (chest.glb ~0.8 м в исходнике). Уменьшен 1.7→1.1: сундуки
 *  стали незаметнее, легче прячутся за куст/камень. Эпические — тот же масштаб. */
const CHEST_SCALE = 1.1;
/** Угол наклона крышки при открытии, рад (≈70°). */
const LID_OPEN_ANGLE = -1.2;
/** Скорость доводки крышки до открытого угла. */
const LID_SPEED = 6;

/** Tier сундука → таблица лута. */
type ChestTier = 'common' | 'rare' | 'epic';
const TIER_TABLE: Record<ChestTier, 'chest_common' | 'chest_rare' | 'chest_epic'> = {
  common: 'chest_common',
  rare: 'chest_rare',
  epic: 'chest_epic',
};

/** Базовая точка сундука: укрытие + джиттер + yaw + tier. */
interface ChestSpot {
  x: number;
  z: number;
  /** Радиус джиттера, м — точка «гуляет» вокруг базовой между разными seed. */
  jitter: number;
  /** Поворот сундука, рад: «спиной» к открытому пространству (лицом к укрытию). */
  yaw: number;
  tier: ChestTier;
}

/**
 * 12 фиксированных укрытий (+ 2 пруда + 1 форт уточняются в build = 15).
 * Все точки: внутри играбельной зоны (cheb ≤ 432 даже с джиттером), ≥ 25 м от любой
 * дороги ROADS, вне деревни/дворца. Каждому — свой yaw «спиной к открытому»:
 * у стены спина к стене (наружу), в лесу спина к ближайшей открытой стороне/тракту.
 *
 * Зоны: за дворцом в чаще (2), глухие лесные сектора (6), у подножия горной
 * стены за валунами (4). Координаты согласованы с WorldData (VILLAGE 0,120;
 * PALACE 0,−380; горная стена |x|/|z|≈420, isClear режет на 435).
 */
export const CHEST_SPOTS: readonly ChestSpot[] = [
  // За дворцом, в чаще — глубоко вне тракта (спина к северной кромке/стене)
  { x: -95, z: -300, jitter: 8, yaw: Math.PI * 0.25, tier: 'rare' },
  { x: 70, z: -250, jitter: 8, yaw: Math.PI * 1.15, tier: 'epic' },
  // Глухие лесные сектора — в кустах/у поваленных брёвен, далеко от дорог
  { x: 205, z: 190, jitter: 12, yaw: Math.PI * 0.6, tier: 'common' },
  { x: -235, z: 165, jitter: 12, yaw: Math.PI * 1.4, tier: 'common' },
  { x: 265, z: -185, jitter: 12, yaw: Math.PI * 0.85, tier: 'rare' },
  { x: -285, z: -205, jitter: 12, yaw: Math.PI * 1.7, tier: 'common' },
  { x: 165, z: 300, jitter: 12, yaw: Math.PI * 0.1, tier: 'rare' },
  { x: -185, z: 330, jitter: 12, yaw: Math.PI * 1.9, tier: 'common' },
  // У подножия горной стены — за валунами, спина к стене (наружу от центра)
  { x: 418, z: 175, jitter: 6, yaw: 0, tier: 'epic' }, // стена на +x → спина к +x
  { x: -418, z: -205, jitter: 6, yaw: Math.PI, tier: 'rare' }, // стена на −x → спина к −x
  { x: 175, z: 418, jitter: 6, yaw: -Math.PI / 2, tier: 'epic' }, // стена на +z → спина к +z
  { x: -115, z: -418, jitter: 6, yaw: Math.PI / 2, tier: 'common' }, // стена на −z → спина к −z
];

/** Один сундук в мире: меш + крышка + физика + состояние открытия. */
interface Chest {
  id: string;
  x: number;
  z: number;
  tier: ChestTier;
  table: 'chest_common' | 'chest_rare' | 'chest_epic';
  lid: THREE.Object3D | null;
  /** Целевой угол крышки: 0 закрыт, LID_OPEN_ANGLE открыт. */
  lidTarget: number;
  opened: boolean;
}

/** Спека маскирующего декора: модель + размер + сколько штук + смещение. */
interface DecorVariant {
  asset: string;
  /** Высота модели в мире, м. */
  height: number;
  /** Радиус коллайдера (0 — проходимая мелочь, кусты не блокируют). */
  colliderR: number;
}

// Маскирующий декор: 2 куста (крупные, прячут силуэт) + 1 камень. На сундук
// ставим 1–2 элемента со стороны открытого пространства (см. addDecorFor).
const DECOR: DecorVariant[] = [
  { asset: 'plant_bushlarge', height: 1.3, colliderR: 0 },
  { asset: 'plant_bushdetailed', height: 1.2, colliderR: 0 },
  { asset: 'rock_smalld', height: 0.8, colliderR: 0.4 },
];

export class Chests {
  /** id уже открытых сундуков — отдаём в сейв, читаем при загрузке. */
  readonly openedIds = new Set<string>();
  /** Игрок у какого-то сундука (для смоуков/промпта). */
  near = false;

  private chests: Chest[] = [];
  /** Ближайший в радиусе интеракции (или null). Обновляется раз в CHECK_PERIOD. */
  private nearChest: Chest | null = null;
  private checkLeft = 0;
  private rng: Rng = mulberry32(1);

  // Ссылки на сцену/физику/шаблоны/террейн — чтобы addChest мог регистрировать
  // сундук в любой момент после build (паркур-холмы кладут призовой сундук).
  private scene: THREE.Scene | null = null;
  private physics: PhysicsWorld | null = null;
  private terrain: Terrain | null = null;
  /** Шаблон меша по tier: epic → chest_gold, остальные → chest. null — фоллбэк-ящик. */
  private templates: { common: THREE.Object3D | null; epic: THREE.Object3D | null } = {
    common: null,
    epic: null,
  };

  /**
   * Построить сундуки. pondCenters/fortPos уточняют 2 «пруда» и 1 «форт» —
   * остальные 12 берутся из CHEST_SPOTS. terrain — высота под сундук/декор.
   */
  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    pondCenters: { x: number; z: number }[],
    fortPos: { x: number; z: number },
  ): Promise<void> {
    this.rng = mulberry32(seed ^ 0xc4e57);
    this.scene = scene;
    this.physics = physics;
    this.terrain = terrain;

    // Полный список точек: пруды (2), форт (1), затем 12 фиксированных укрытий.
    // У прудов/форта сундук тоже прячем в куст рядом — yaw к воде/стене форта.
    const spots: ChestSpot[] = [];
    for (let i = 0; i < 2; i++) {
      const p = pondCenters[i];
      // Нет столько прудов (бывает 2 вместо 3) — добираем лесными точками ниже.
      if (p) {
        const dx = i === 0 ? 16 : -16;
        spots.push({ x: p.x + dx, z: p.z + 12, jitter: 6, yaw: Math.atan2(-12, -dx), tier: 'rare' });
      }
    }
    spots.push({ x: fortPos.x, z: fortPos.z - 9, jitter: 4, yaw: Math.PI, tier: 'epic' });
    for (const s of CHEST_SPOTS) {
      if (spots.length >= 15) break;
      spots.push({ ...s });
    }

    // Прелоад шаблонов: рядовой chest.glb + золотой chest_gold.glb (эпические).
    this.templates.common = await this.loadTemplate(assets, '/assets/props/chest.glb');
    this.templates.epic =
      (await this.loadTemplate(assets, '/assets/props/chest_gold.glb')) ?? this.templates.common;

    // Прелоад моделей декора для инстансинга (общий merged-geometry на вариант).
    const decorModels = await Promise.all(
      DECOR.map(async (d) => {
        try {
          return extractInstancedModel(await assets.model(`/assets/world/nature/${d.asset}.glb`));
        } catch {
          console.warn(`[chests] декор ${d.asset} не загрузился — пропуск`);
          return null;
        }
      }),
    );
    // Накопители матриц декора по варианту → по одному InstancedMesh на вариант.
    const decorMx: THREE.Matrix4[][] = DECOR.map(() => []);

    for (let i = 0; i < spots.length && i < 15; i++) {
      const spot = spots[i]!;
      const id = `chest_${i}`;
      // Джиттер от seed: ищем свободную точку рядом (несколько попыток).
      let x = spot.x;
      let z = spot.z;
      for (let tries = 0; tries < 6; tries++) {
        const a = this.rng() * Math.PI * 2;
        const r = this.rng() * spot.jitter;
        const cx = spot.x + Math.cos(a) * r;
        const cz = spot.z + Math.sin(a) * r;
        // Внутри мира; за горную стену не лезем (террейн там вертикальный).
        if (Math.max(Math.abs(cx), Math.abs(cz)) < 432) {
          x = cx;
          z = cz;
          break;
        }
      }

      this.registerChest(id, x, z, spot.tier, spot.yaw);
      // Маскирующий декор: 1–2 элемента со стороны открытого пространства
      // (противоположной yaw-«лицу» сундука). Матрицы копим, мешим разом ниже.
      this.collectDecorFor(x, z, spot.yaw, decorMx);
    }

    // Один InstancedMesh на вариант декора (≤ 3 draw calls на все 15 сундуков).
    for (let v = 0; v < DECOR.length; v++) {
      const model = decorModels[v];
      const mxs = decorMx[v]!;
      if (model && mxs.length > 0) this.spawnDecorMesh(scene, model, mxs);
    }
  }

  /** Загрузить шаблон сундука (scene GLTF) или null при ошибке. */
  private async loadTemplate(assets: AssetLoader, path: string): Promise<THREE.Object3D | null> {
    try {
      return (await assets.model(path)).scene;
    } catch {
      console.warn(`[chests] ${path} не загрузилось — стилизованный ящик`);
      return null;
    }
  }

  /**
   * Зарегистрировать призовой сундук в любой момент после build (паркур-холмы и др.).
   * x,z — мировые координаты; высота берётся из террейна. yaw по умолчанию случаен
   * от внутреннего rng (детерминирован порядком вызовов в забеге). Возвращает id.
   */
  addChest(x: number, z: number, tier: ChestTier): string {
    if (!this.scene || !this.physics || !this.terrain) {
      throw new Error('Chests.addChest до build');
    }
    const id = `chest_extra_${this.chests.length}`;
    const yaw = this.rng() * Math.PI * 2;
    this.registerChest(id, x, z, tier, yaw);
    return id;
  }

  /** Создать сундук (меш + крышка + коллайдер) и добавить в список. */
  private registerChest(id: string, x: number, z: number, tier: ChestTier, yaw: number): Chest {
    const y = this.terrain!.height(x, z);
    const chest: Chest = {
      id,
      x,
      z,
      tier,
      table: TIER_TABLE[tier],
      lid: null,
      lidTarget: 0,
      opened: false,
    };
    const template = tier === 'epic' ? this.templates.epic : this.templates.common;
    this.spawnMesh(this.scene!, this.physics!, template, chest, x, y, z, yaw);
    this.chests.push(chest);
    return chest;
  }

  /**
   * Набрать матрицы 1–2 декор-элементов со стороны ОТКРЫТОГО пространства сундука.
   * «Лицо» сундука смотрит по yaw (к укрытию), значит открытое — противоположная
   * сторона (yaw + π). Туда и ставим прикрытие: ближний крупный куст + (через раз)
   * камень-валун сбоку. Высота — из террейна, лёгкий случайный разворот/масштаб.
   */
  private collectDecorFor(x: number, z: number, yaw: number, out: THREE.Matrix4[][]): void {
    const openDir = yaw + Math.PI; // куда «открыт» сундук — туда ставим прикрытие
    const place = (variant: number, dist: number, side: number): void => {
      const model = out[variant];
      if (!model) return;
      const ang = openDir + side;
      const dx = Math.cos(ang) * dist;
      const dz = Math.sin(ang) * dist;
      const px = x + dx;
      const pz = z + dz;
      const py = this.terrain!.height(px, pz);
      const spec = DECOR[variant]!;
      // Масштаб задаётся высотой модели — нормируем при сборке меша (см. spawnDecorMesh),
      // здесь кодируем целевую высоту в scale матрицы (model.height учтём там).
      const s = spec.height * (0.85 + this.rng() * 0.3);
      const rot = this.rng() * Math.PI * 2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
        new THREE.Vector3(s, s, s), // временно «целевая высота»; нормируется по model.height
      );
      out[variant]!.push(m);

      // Камень-валун — препятствие: статичный коллайдер (кусты проходимы).
      if (spec.colliderR > 0 && this.physics) {
        this.physics.world.createCollider(
          RAPIER.ColliderDesc.cylinder(s * 0.5, Math.max(0.35, s * spec.colliderR))
            .setTranslation(px, py + s * 0.5, pz)
            .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
        );
      }
    };

    // Крупный куст прямо со стороны открытого пространства, вплотную к сундуку.
    place(0, 0.9, 0);
    // Второй элемент: куст или валун чуть в стороне — прячет силуэт по диагонали.
    const second = this.rng() < 0.5 ? 1 : 2;
    place(second, 1.0, (this.rng() < 0.5 ? 1 : -1) * 0.7);
  }

  /**
   * Один InstancedMesh на вариант декора. В матрицах временно лежит «целевая
   * высота» как однородный scale — нормируем на реальную высоту модели, чтобы
   * куст/камень встали на землю нужного размера (пивот Kenney — в центре модели).
   */
  private spawnDecorMesh(scene: THREE.Scene, model: InstancedModel, mxs: THREE.Matrix4[]): void {
    const imesh = new THREE.InstancedMesh(
      model.geometry,
      model.materials.length === 1 ? model.materials[0]! : model.materials,
      mxs.length,
    );
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (let i = 0; i < mxs.length; i++) {
      const m = mxs[i]!;
      m.decompose(pos, quat, scl);
      const targetH = scl.x; // мы клали целевую высоту в scale
      const s = targetH / model.height;
      // Пивот Kenney обычно в основании/центре — сажаем низ на землю.
      const y = pos.y - model.minY * s - 0.02;
      m.compose(new THREE.Vector3(pos.x, y, pos.z), quat, new THREE.Vector3(s, s, s));
      imesh.setMatrixAt(i, m);
    }
    imesh.instanceMatrix.needsUpdate = true;
    imesh.castShadow = true;
    imesh.receiveShadow = true;
    imesh.computeBoundingSphere();
    scene.add(imesh);
  }

  /** Меш сундука: клон chest.glb/chest_gold.glb (крышка — узел Lid/lid) или box-фоллбэк. */
  private spawnMesh(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    template: THREE.Object3D | null,
    chest: Chest,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = yaw;

    if (template) {
      const obj = template.clone(true);
      obj.scale.setScalar(CHEST_SCALE);
      obj.position.y = -bboxOf(obj).min.y; // основание на землю
      enableShadows(obj);
      // Крышка — отдельный узел KayKit (имя содержит lid); найдём для анимации открытия.
      let lid: THREE.Object3D | null = null;
      obj.traverse((o) => {
        if (!lid && /lid/i.test(o.name)) lid = o;
      });
      chest.lid = lid;
      group.add(obj);
    } else {
      // Фоллбэк: основание + крышка из двух box-геометрий. Золотой tier — окантовка
      // ярче (визуально ценнее, но не крупнее).
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });
      const trimColor = chest.tier === 'epic' ? 0xe8c33a : 0xc9a23a;
      const trim = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.5, metalness: 0.4 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), wood);
      base.position.y = 0.275;
      // Крышка на петле сзади (-z локально): pivot-группа, чтобы вращалась у края.
      const lidPivot = new THREE.Group();
      lidPivot.position.set(0, 0.55, -0.3);
      const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.6), trim);
      lidMesh.position.set(0, 0.09, 0.3);
      lidPivot.add(lidMesh);
      base.castShadow = true;
      base.receiveShadow = true;
      lidMesh.castShadow = true;
      chest.lid = lidPivot;
      group.add(base, lidPivot);
    }

    scene.add(group);

    // Статичный коллайдер-куб (как у реквизита Village): сундук — препятствие.
    // Размер уменьшен пропорционально новому масштабу 1.1 (было 1.7).
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.32, 0.26, 0.26)
        .setTranslation(x, y + 0.26, z)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );
  }

  /**
   * Применить сейв: отметить уже открытые сундуки (крышка сразу наклонена).
   * Зовётся из Game после build, до первого update.
   */
  applyOpened(ids: Iterable<string>): void {
    for (const id of ids) this.openedIds.add(id);
    for (const c of this.chests) {
      if (this.openedIds.has(c.id)) {
        c.opened = true;
        c.lidTarget = LID_OPEN_ANGLE;
        if (c.lid) c.lid.rotation.x = LID_OPEN_ANGLE; // без анимации — уже открыт при загрузке
      }
    }
  }

  /**
   * Покадрово из Game.tick. Дистанция считается раз в CHECK_PERIOD;
   * interact — edge-нажатие E этого кадра. onOpen(chest) делает Game:
   * фонтан монет + предмет в инвентарь + тикер. Возвращает true, если в этом
   * кадре сундук открылся (Game триггерит автосейв).
   */
  update(
    dt: number,
    playerX: number,
    playerZ: number,
    interact: boolean,
    hud: Hud,
    onOpen: (chestId: string, table: string, coins: number, itemId: string | null, itemCount: number) => void,
  ): boolean {
    // Доводка крышек (для всех открытых).
    for (const c of this.chests) {
      if (!c.lid) continue;
      const cur = c.lid.rotation.x;
      if (Math.abs(cur - c.lidTarget) > 0.001) {
        c.lid.rotation.x = THREE.MathUtils.lerp(cur, c.lidTarget, Math.min(1, dt * LID_SPEED));
      }
    }

    this.checkLeft -= dt;
    if (this.checkLeft <= 0) {
      this.checkLeft = CHECK_PERIOD;
      let best: Chest | null = null;
      let bestDist = INTERACT_DIST;
      for (const c of this.chests) {
        if (c.opened) continue;
        const d = Math.hypot(playerX - c.x, playerZ - c.z);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (best !== this.nearChest) {
        this.nearChest = best;
        this.near = best !== null;
        if (best) hud.showPrompt('[E] Открыть сундук');
        else hud.hidePrompt();
      }
    }

    if (this.nearChest && interact && !this.nearChest.opened) {
      const chest = this.nearChest;
      chest.opened = true;
      chest.lidTarget = LID_OPEN_ANGLE;
      this.openedIds.add(chest.id);
      this.nearChest = null;
      this.near = false;
      hud.hidePrompt();

      // Ролл лута: монеты 15–40 ВСЕГДА + ГАРАНТИРОВАННО один предмет по таблице
      // сундука. Категории (зелья/экипировка/тринкет) зашиты весами chest_*; чтобы
      // сундук не выдал «только монеты», перекатываем таблицу, пока не выпадет
      // НЕ-coins предмет (bounded — на случай выродившейся таблицы).
      const coins = Math.floor(randRange(this.rng, 15, 40));
      let itemId: string | null = null;
      let itemCount = 0;
      for (let tries = 0; tries < 12 && !itemId; tries++) {
        for (const d of rollLoot(chest.table, this.rng)) {
          if (d.itemId !== 'coins' && ITEMS[d.itemId]) {
            itemId = d.itemId;
            itemCount = d.count;
            break;
          }
        }
      }
      onOpen(chest.id, chest.table, coins, itemId, itemCount);
      return true;
    }
    return false;
  }

  get count(): number {
    return this.chests.length;
  }

  get openedCount(): number {
    return this.openedIds.size;
  }

  /** Координаты всех сундуков — для смоуков (телепорт к ближнему). */
  positions(): { id: string; x: number; z: number; opened: boolean }[] {
    return this.chests.map((c) => ({
      id: c.id,
      x: +c.x.toFixed(2),
      z: +c.z.toFixed(2),
      opened: c.opened,
    }));
  }
}
