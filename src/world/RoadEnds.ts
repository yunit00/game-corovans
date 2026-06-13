// Локации на концах четырёх дорог (Фаза 6B волна B+). Дороги ROADS упираются в
// горное кольцо и выглядели тупиками — на каждом конце ставим осмысленную локацию:
//   - inn      ПОСТОЯЛЫЙ ДВОР: таверна-оболочка стоит ПРЯМО в торце дороги (дорога
//              упирается в фасад), перед фасадом — открытая ТЕРРАСА: навес со
//              столом, лавкой и бочками, под которым стоит трактирщик (слухи о
//              корованах). Рядом — мини-лавка странствующего торговца;
//   - forester ЛЕСНИЧЕСТВО: хижина лесника (NPC ставит WorldNpcs);
//   - mill     МЕЛЬНИЦА/ФЕРМА: ветряк + амбар + ограда (мельник — WorldNpcs);
//   - sentry   СТОРОЖЕВАЯ ЗАСТАВА: пост с навесом/частоколом и знаменем (дозорный
//              — WorldNpcs).
//
// Позиции концов дорог выбирает чистая логика sim/roadEnds (отступ от стены вдоль
// дороги). Сборка сцен — по образцу Village/Waterfall (assets.model + коллайдеры).
// Бюджет: суммарно ≤ +60 draw calls на все 4 локации (считаем в drawCalls).
import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { planRoadEnds, type RoadEnd, type RoadEndKind } from '../sim/roadEnds';
import { ROADS } from './WorldData';
import type { Terrain } from './Terrain';

/** Назначение типов локаций концам дорог (индекс в ROADS). Порядок ROADS:
 *  0 — главный тракт (юг), 1 — восточный, 2 — западный, 3 — северо-восточный. */
const ASSIGN: { road: number; kind: RoadEndKind }[] = [
  { road: 0, kind: 'inn' }, // постоялый двор на главном тракте у южного кольца
  { road: 1, kind: 'sentry' }, // застава на восточном тракте
  { road: 2, kind: 'forester' }, // лесничество на западном тракте
  { road: 3, kind: 'mill' }, // мельница/ферма на северо-восточном просёлке
];

/** Сдвиг здания «вбок» от оси дороги, м — чтобы фасад стоял у тракта, не на нём
 *  (для лесничества/мельницы/заставы; постоялый двор ставим прямо в торец). */
const SIDE_OFFSET = 8;

/** Насколько отодвинуть оболочку таверны ОТ торца дороги наружу (к стене), м —
 *  чтобы дорога упёрлась в фасад, а перед ним осталось место под террасу. */
const INN_SHELL_BACK = 10;

/** Готовая локация конца дороги: тип, центр, точки интеракции. */
export interface RoadEndLocation {
  kind: RoadEndKind;
  x: number;
  z: number;
  faceYaw: number;
  road: number;
}

/** Локации концов дорог: здания/интерьеры + точки интеракции для Game. */
export class RoadEnds {
  /** Грубый счётчик добавленных мешей (proxy draw calls) — для перф-чека. */
  drawCalls = 0;
  /** Выбранные локации (для debugState/смоуков). */
  readonly locations: RoadEndLocation[] = [];

  /** Точка внутри постоялого двора, где стоит трактирщик (слухи о корованах). null — двор не построен. */
  innKeeperPos: { x: number; z: number } | null = null;
  /** Точка у прилавка мини-лавки внутри постоялого двора (странствующий торговец). null — нет. */
  innShopPos: { x: number; z: number } | null = null;
  /** Якоря NPC концов дорог (лесник/мельник/дозорный) — для WorldNpcs. */
  readonly npcAnchors: {
    forester: { x: number; z: number; faceYaw: number } | null;
    miller: { x: number; z: number; faceYaw: number } | null;
    sentry: { x: number; z: number; faceYaw: number } | null;
  } = { forester: null, miller: null, sentry: null };

  async build(scene: THREE.Scene, physics: PhysicsWorld, assets: AssetLoader, terrain: Terrain): Promise<void> {
    const ends = planRoadEnds(ROADS, ASSIGN);
    for (const end of ends) {
      // Постоялый двор ставим ПРЯМО в торец дороги (без бокового сдвига): оболочку —
      // на оси дороги, отодвинув наружу за торец, чтобы дорога упёрлась в фасад.
      // Остальные локации сдвигаем вбок от оси: «вправо» относительно входа (faceYaw).
      const fwdX = Math.sin(end.faceYaw);
      const fwdZ = Math.cos(end.faceYaw);
      let bx: number, bz: number;
      if (end.kind === 'inn') {
        // Оболочка — наружу от торца (−forward, к стене); сама точка loc — центр
        // оболочки. Фасад «смотрит» внутрь зоны вдоль дороги (faceYaw).
        bx = +(end.x - fwdX * INN_SHELL_BACK).toFixed(2);
        bz = +(end.z - fwdZ * INN_SHELL_BACK).toFixed(2);
      } else {
        const sideX = Math.cos(end.faceYaw); // перпендикуляр к (sin,cos)=(вход)
        const sideZ = -Math.sin(end.faceYaw);
        bx = +(end.x + sideX * SIDE_OFFSET).toFixed(2);
        bz = +(end.z + sideZ * SIDE_OFFSET).toFixed(2);
      }
      const loc: RoadEndLocation = { kind: end.kind, x: bx, z: bz, faceYaw: end.faceYaw, road: end.road };
      this.locations.push(loc);

      switch (end.kind) {
        case 'inn':
          await this.buildInn(scene, physics, assets, terrain, loc);
          break;
        case 'forester':
          await this.buildForesterLodge(scene, physics, assets, terrain, loc, end);
          break;
        case 'mill':
          await this.buildMill(scene, physics, assets, terrain, loc, end);
          break;
        case 'sentry':
          await this.buildSentry(scene, physics, assets, terrain, loc, end);
          break;
      }
    }
  }

  /**
   * Установка мелкого GLB-пропа на ЗАДАННОЙ высоте y (без коллайдера) — для мебели
   * на террасе (бутылки на столе, доска-сиденье на ящиках), что стоит не на земле, а
   * на другой поверхности. baseY — низ модели (её min.y садим на baseY).
   */
  private async placeProp(
    scene: THREE.Scene,
    assets: AssetLoader,
    path: string,
    x: number,
    baseY: number,
    z: number,
    footprint: number,
    rot: number,
  ): Promise<void> {
    let gltf;
    try {
      gltf = await assets.model(path);
    } catch {
      console.warn(`[roadends] проп не загрузился: ${path}`);
      return;
    }
    const obj = gltf.scene.clone();
    obj.scale.setScalar(scaleToFootprint(obj, footprint));
    obj.position.set(x, 0, z);
    obj.rotation.y = rot;
    obj.position.y = baseY - bboxOf(obj).min.y;
    enableShadows(obj);
    scene.add(obj);
    this.drawCalls++;
  }

  /** Универсальная установка GLB-модели на рельеф с опц. box-коллайдером (как Village). */
  private async place(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    path: string,
    x: number,
    z: number,
    opts: { footprint: number; rot: number; collider?: 'box' | 'none'; shrinkXZ?: number },
  ): Promise<void> {
    let gltf;
    try {
      gltf = await assets.model(path);
    } catch {
      console.warn(`[roadends] модель не загрузилась: ${path}`);
      return;
    }
    const obj = gltf.scene.clone();
    obj.scale.setScalar(scaleToFootprint(obj, opts.footprint));
    const y = terrain.height(x, z);
    obj.position.set(x, 0, z);
    obj.rotation.y = opts.rot;
    obj.position.y = y - bboxOf(obj).min.y;
    enableShadows(obj);
    scene.add(obj);
    this.drawCalls++;

    if ((opts.collider ?? 'none') === 'box') {
      const box = bboxOf(obj);
      const size = box.getSize(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromEuler(obj.rotation);
      const shrink = opts.shrinkXZ ?? 0.42;
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size.x * shrink, size.y / 2, size.z * shrink)
          .setTranslation(x, y + size.y / 2, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
      );
    }
  }

  // ---- Постоялый двор (inn): оболочка в торце дороги + терраса перед фасадом ----

  /**
   * Постоялый двор: таверна-оболочка стоит ПРЯМО в торце дороги (loc — её центр,
   * отодвинутый наружу от торца на INN_SHELL_BACK; дорога упирается в фасад).
   * Никакого фальш-интерьера из стен — оболочка цельная, заходить внутрь не нужно.
   * Перед фасадом, между дорогой и зданием, — открытая ТЕРРАСА: навес (tent-canvas-
   * half) у стены, под ним стол с бутылками, лавка (доска на двух ящиках) и бочки,
   * рядом факел. Трактирщик стоит под навесом за столом, лицом к дороге.
   */
  private async buildInn(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    loc: RoadEndLocation,
  ): Promise<void> {
    const yaw = loc.faceYaw;
    // Локальный сдвиг → мир (X — «вправо», Z — «вперёд» к дороге/торцу).
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const world = (dx: number, dz: number): [number, number] => [
      loc.x + rightX * dx + fwdX * dz,
      loc.z + rightZ * dx + fwdZ * dz,
    ];

    // Оболочка-таверна в торце дороги: центр на loc, фасад (+Z, к дороге). Footprint
    // 12.5 → глубина ~12.5, фасад выходит примерно на +6 от центра; дорога (торец на
    // ~+INN_SHELL_BACK) упирается в фасад.
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_tavern_green.glb', loc.x, loc.z, {
      footprint: 12.5,
      rot: yaw, // фасадом к дороге (вдоль forward)
      collider: 'box',
    });
    // Знамя сбоку от фасада — метка локации, видна с дороги.
    const [bnx, bnz] = world(-6.5, 5);
    await this.place(scene, physics, assets, terrain, '/assets/world/town/banner-green.glb', bnx, bnz, {
      footprint: 2.4,
      rot: yaw,
      collider: 'none',
    });

    // --- Терраса перед фасадом: навес у стены, под ним стол/лавка/бочки/факел ---
    // Локальный +Z — «к дороге». Навес ставим у фасада (≈+6.5), стол чуть ближе к
    // дороге под навесом, трактирщик — за столом лицом к дороге (faceYaw).
    const groundY = terrain.height(loc.x, loc.z);

    // Навес-полупалатка у фасада, проёмом к дороге (footprint ~6).
    const [cnx, cnz] = world(0, 6.4);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/tent-canvas-half.glb', cnx, cnz, {
      footprint: 6, rot: yaw, collider: 'none',
    });
    // Стол под навесом с парой бутылок.
    const [stx, stz] = world(0, 6.0);
    await this.place(scene, physics, assets, terrain, '/assets/props/table_small.glb', stx, stz, {
      footprint: 1.5, rot: yaw, collider: 'none',
    });
    const bottleY = groundY + 0.78; // примерная высота столешницы
    const [bl1x, bl1z] = world(-0.35, 6.0);
    await this.placeProp(scene, assets, '/assets/props/bottle_a_brown.glb', bl1x, bottleY, bl1z, 0.3, yaw);
    const [bl2x, bl2z] = world(0.1, 6.2);
    await this.placeProp(scene, assets, '/assets/props/bottle_b_brown.glb', bl2x, bottleY, bl2z, 0.3, yaw + 0.6);
    const [bl3x, bl3z] = world(0.4, 5.85);
    await this.placeProp(scene, assets, '/assets/props/bottle_a_green.glb', bl3x, bottleY, bl3z, 0.3, yaw - 0.8);

    // Лавка: горизонтальная доска (resource-planks) на двух ящиках (box.glb) — сбоку
    // от стола, вдоль дороги. Ящики держат доску на ~0.45 м.
    await this.buildBench(scene, assets, world(-2.4, 6.0), yaw, groundY);

    // Две бочки у края террасы (декор без коллизии — мелочь у стены).
    const [b1x, b1z] = world(2.6, 6.6);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/barrel.glb', b1x, b1z, {
      footprint: 1.0, rot: yaw, collider: 'none',
    });
    const [b2x, b2z] = world(3.1, 5.7);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/barrel.glb', b2x, b2z, {
      footprint: 1.0, rot: yaw + 0.4, collider: 'none',
    });

    // Факел у навеса + тёплая точка света над столом.
    const [thx, thz] = world(2.0, 7.0);
    await this.place(scene, physics, assets, terrain, '/assets/props/torch_lit.glb', thx, thz, {
      footprint: 0.6, rot: yaw, collider: 'none',
    });
    const [lx, lz] = world(0, 6.2);
    const lamp = new THREE.PointLight(0xffd9a0, 7, 9, 1.6);
    lamp.position.set(lx, groundY + 2.4, lz);
    scene.add(lamp);
    this.drawCalls++;

    // Трактирщик — за столом под навесом, лицом к дороге (faceYaw). Точка интеракции
    // совпадает с ним; терраса открытая, INN_TALK_DIST 3.5 м хватит подойти.
    const [kx, kz] = world(0, 6.9);
    this.innKeeperPos = { x: +kx.toFixed(2), z: +kz.toFixed(2) };
    await this.placeKeeper(scene, assets, terrain, kx, kz, yaw);

    // Мини-лавка странствующего торговца — сбоку у бочек, у края террасы.
    const [shx, shz] = world(3.0, 6.1);
    this.innShopPos = { x: +shx.toFixed(2), z: +shz.toFixed(2) };
  }

  /**
   * Лавка террасы: горизонтальная доска (resource-planks) на двух ящиках (box.glb).
   * pos — мировой центр лавки; доска лежит на высоте ящиков, вдоль «правой» оси yaw.
   */
  private async buildBench(
    scene: THREE.Scene,
    assets: AssetLoader,
    pos: [number, number],
    yaw: number,
    groundY: number,
  ): Promise<void> {
    const [cx, cz] = pos;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    // Два ящика-ножки по краям лавки (вдоль right на ±0.6 м), стоят на земле.
    for (const s of [-0.65, 0.65]) {
      await this.placeProp(scene, assets, '/assets/world/survival/box.glb', cx + rightX * s, groundY, cz + rightZ * s, 0.55, yaw);
    }
    // Доска-сиденье поверх ящиков (тонкий настил), повёрнута вдоль right.
    await this.placeProp(scene, assets, '/assets/world/survival/resource-planks.glb', cx, groundY + 0.45, cz, 1.6, yaw + Math.PI / 2);
  }

  /** Трактирщик под навесом постоялого двора: статичный персонаж в покое (без блуждания). */
  private async placeKeeper(
    scene: THREE.Scene,
    assets: AssetLoader,
    terrain: Terrain,
    x: number,
    z: number,
    faceYaw: number,
  ): Promise<void> {
    let gltf;
    try {
      gltf = await assets.model('/assets/characters/rogue.glb');
    } catch {
      console.warn('[roadends] трактирщик не загрузился');
      return;
    }
    const model = AssetLoader.cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    model.position.set(x, terrain.height(x, z) + 0.06, z);
    model.rotation.y = faceYaw;
    scene.add(model);
    this.drawCalls++;
  }

  // ---- Лесничество (forester): хижина у конца западной дороги ----

  private async buildForesterLodge(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    loc: RoadEndLocation,
    end: RoadEnd,
  ): Promise<void> {
    const yaw = loc.faceYaw;
    // Хижина-палатка (закрытая декорация с коллайдером) + кострище + дрова + ограда.
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/tent-canvas.glb', loc.x, loc.z, {
      footprint: 6.5, rot: yaw, collider: 'box',
    });
    const off = offsetter(loc, yaw);
    const [fx, fz] = off(2.5, 2.6);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/campfire-stand.glb', fx, fz, {
      footprint: 1.6, rot: 0, collider: 'none',
    });
    const [wx, wz] = off(-2.4, 2.2);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/resource-wood.glb', wx, wz, {
      footprint: 1, rot: yaw, collider: 'none',
    });
    const [dx, dz] = off(3.4, 0.5);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/trees_a_medium.glb', dx, dz, {
      footprint: 4, rot: yaw, collider: 'none',
    });
    // NPC-якорь лесника — у входа в хижину, лицом к тракту.
    this.npcAnchors.forester = { x: end.x, z: end.z, faceYaw: yaw };
  }

  // ---- Мельница/ферма (mill): ветряк + амбар + ограда ----

  private async buildMill(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    loc: RoadEndLocation,
    end: RoadEnd,
  ): Promise<void> {
    const yaw = loc.faceYaw;
    const off = offsetter(loc, yaw);
    // Ветряная мельница — доминанта локации (закрытая декорация с коллайдером).
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_windmill_green.glb', loc.x, loc.z, {
      footprint: 11, rot: yaw, collider: 'box',
    });
    // Амбар-зернохранилище рядом. Сдвигаем дальше (7→8.5): мельница 9→11 и
    // амбар 6→7.5 крупнее — больший зазор между их box-коллайдерами.
    const [gx, gz] = off(8.5, 1);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_grain.glb', gx, gz, {
      footprint: 7.5, rot: yaw + Math.PI / 2, collider: 'box',
    });
    // Сено/мешки/телега у амбара — «живая» ферма.
    const [hx, hz] = off(3.5, 4);
    await this.place(scene, physics, assets, terrain, '/assets/world/town/cart.glb', hx, hz, {
      footprint: 3.6, rot: yaw, collider: 'none',
    });
    const [sx, sz] = off(-4, 3);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/sack.glb', sx, sz, {
      footprint: 1.8, rot: yaw, collider: 'none',
    });
    // Ограда-частокол вдоль фронта (две секции дерева).
    const [feX, feZ] = off(-5, 5);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/fence_wood_straight.glb', feX, feZ, {
      footprint: 4, rot: yaw + Math.PI / 2, collider: 'none',
    });
    this.npcAnchors.miller = { x: end.x, z: end.z, faceYaw: yaw };
  }

  // ---- Сторожевая застава (sentry): пост с навесом, частоколом и знаменем ----

  private async buildSentry(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    loc: RoadEndLocation,
    end: RoadEnd,
  ): Promise<void> {
    const yaw = loc.faceYaw;
    const off = offsetter(loc, yaw);
    // Полноценное укрепление: крупная главная башня (доминанта) + вторая башня +
    // катапульта во дворе, по периметру — каменная стена с воротами к тракту.
    // Локальные координаты (dx=вправо, dz=вперёд к тракту/центру). Рыцарь-дозорный
    // (его якорь в WorldNpcs) стоит у end = local(-SIDE_OFFSET, 0) от loc — ворота
    // и двор кладём так, чтобы он оказался во дворе у ворот.

    // --- Каменный периметр с воротами к тракту ---
    // Двор ~18×18 центрируем между loc и якорем дозорного (end ≈ local(-8,0)):
    // сдвигаем центр двора влево на 4 м, чтобы рыцарь стоял внутри у ворот, а не
    // на линии стены. Все объекты ниже считаем в координатах ДВОРА (yard),
    // halfW=9 → стороны двора по local dx∈[-9,9], объекты держим в этом квадрате.
    const yardCenter = ((): RoadEndLocation => {
      const [yx, yz] = off(-4, 0);
      return { ...loc, x: yx, z: yz };
    })();
    const halfW = 9;
    await this.buildStockade(scene, physics, assets, terrain, yardCenter, yaw, halfW);
    const yard = offsetter(yardCenter, yaw); // локальные сдвиги вокруг центра двора

    // Главная башня дозора — крупная (footprint 5.5→10), в тыловом углу двора.
    const [mtx, mtz] = yard(4, -3.5);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_tower_base_green.glb', mtx, mtz, {
      footprint: 10, rot: yaw, collider: 'box',
    });
    // Вторая башня (tower_a) в противоположном тыловом углу — силуэт крепости.
    const [t2x, t2z] = yard(-5.5, -4.5);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_tower_a_green.glb', t2x, t2z, {
      footprint: 6, rot: yaw + Math.PI / 2, collider: 'box',
    });
    // Катапульта (4→7) — у правой стены двора, дулом к тракту.
    const [cx, cz] = yard(5, 2);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_tower_catapult_green.glb', cx, cz, {
      footprint: 7, rot: yaw, collider: 'box',
    });

    // Стойка с оружием и флаг во дворе у главной башни — «гарнизон».
    const [wrx, wrz] = yard(1, -2);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/weaponrack.glb', wrx, wrz, {
      footprint: 1.8, rot: yaw + Math.PI / 2, collider: 'none',
    });
    const [flx, flz] = yard(-3, -2);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/flag_green.glb', flx, flz, {
      footprint: 3.2, rot: yaw, collider: 'none',
    });
    // Навес-палатка для дозорного + кострище во дворе (у его якоря, yard≈(-4,0)).
    const [tx, tz] = yard(-5, 2);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/tent.glb', tx, tz, {
      footprint: 3.5, rot: yaw, collider: 'none',
    });
    const [pfx, pfz] = yard(-1.5, 3.5);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/campfire-pit.glb', pfx, pfz, {
      footprint: 1.4, rot: 0, collider: 'none',
    });
    // Факелы по бокам ворот — освещают въезд (декор, без коллизии).
    const [tl1x, tl1z] = yard(-3.4, halfW);
    await this.place(scene, physics, assets, terrain, '/assets/props/torch_lit.glb', tl1x, tl1z, {
      footprint: 0.6, rot: yaw, collider: 'none',
    });
    const [tl2x, tl2z] = yard(3.4, halfW);
    await this.place(scene, physics, assets, terrain, '/assets/props/torch_lit.glb', tl2x, tl2z, {
      footprint: 0.6, rot: yaw, collider: 'none',
    });
    // Красное знамя — тревожная метка заставы, видна с дороги у ворот.
    const [bx, bz] = off(5, 7);
    await this.place(scene, physics, assets, terrain, '/assets/world/town/banner-red.glb', bx, bz, {
      footprint: 2.4, rot: yaw, collider: 'none',
    });
    this.npcAnchors.sentry = { x: end.x, z: end.z, faceYaw: yaw };
  }

  /**
   * Каменный периметр заставы: квадратный двор 2·halfW × 2·halfW (halfW=9 → ~18×18)
   * из секций стены fence_stone_straight, во фронтальной стене (к тракту, +dz) —
   * проём с воротами fence_stone_straight_gate. Каждая секция ставится на
   * terrain.height в своей точке (двор на склоне не тонет/не парит). Площадка
   * расчистки соразмерна: стены кладём по периметру 2·halfW, дозорный (end) у ворот
   * попадает во двор.
   */
  private async buildStockade(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    loc: RoadEndLocation,
    yaw: number,
    halfW: number,
  ): Promise<void> {
    const off = offsetter(loc, yaw);
    const seg = 4.5; // длина секции стены (footprint), м
    const stone = '/assets/world/hexagon/fence_stone_straight.glb';
    const gate = '/assets/world/hexagon/fence_stone_straight_gate.glb';
    // Длинная ось секции забора — локальный Z модели. rot=yaw → секция тянется
    // вдоль forward(Z), rot=yaw+90° → вдоль right(X).
    const ALONG_Z = yaw; // для левой/правой стен (тянутся вдоль forward)
    const ALONG_X = yaw + Math.PI / 2; // для тыловой/фронтальной (тянутся вдоль right)
    // Секция стены: позиция в локальных (dx,dz), поворот вдоль линии стены.
    const wall = async (dx: number, dz: number, rot: number, path = stone): Promise<void> => {
      const [wx, wz] = off(dx, dz);
      await this.place(scene, physics, assets, terrain, path, wx, wz, {
        footprint: seg, rot, collider: 'box', shrinkXZ: 0.46,
      });
    };
    // По 4 секции на сторону: центры в −3q/2,−q/2,+q/2,+3q/2 (равномерно по 2·halfW).
    const q = halfW / 2;
    const ticks = [-1.5 * q, -0.5 * q, 0.5 * q, 1.5 * q];
    for (const d of ticks) {
      await wall(-halfW, d, ALONG_Z); // левая (−X), тянется вдоль Z
      await wall(halfW, d, ALONG_Z); // правая (+X), тянется вдоль Z
      await wall(d, -halfW, ALONG_X); // тыловая (−Z), тянется вдоль X
    }
    // Фронтальная стена (+Z, к тракту) с воротами по центру: ворота на оси,
    // по бокам — по секции стены (проём по центру обращён к дороге).
    await wall(0, halfW, ALONG_X, gate); // ворота — секция-проём, обращена к дороге
    await wall(-1.5 * q, halfW, ALONG_X); // левая секция фронта
    await wall(1.5 * q, halfW, ALONG_X); // правая секция фронта
  }
}

/** Замыкание «локальный сдвиг (вправо,вперёд) → мир» вокруг точки loc по yaw. */
function offsetter(loc: { x: number; z: number }, yaw: number): (dx: number, dz: number) => [number, number] {
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  return (dx, dz) => [loc.x + rightX * dx + fwdX * dz, loc.z + rightZ * dx + fwdZ * dz];
}
