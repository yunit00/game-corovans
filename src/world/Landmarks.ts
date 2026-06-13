// Заполнение пустот карты: слой рассеянных деталей + рукотворные
// мини-POI в пустых зонах. Детали — детерминированный скаттер (sim/scatter) в
// InstancedMesh по образцу Forest, но крупными «островками» в дополнение к лесу;
// POI собираются из CC0-китов (KayKit/Kenney) по образцу Village/VillainFort.
// Перф-бюджет: ≤ +40 draw calls. Чистая логика размещения POI — в sim/landmarks.
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, extractInstancedModel, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { mulberry32 } from '../core/rng';
import { landmarkClearings, planLandmarks, type PoiSpec } from '../sim/landmarks';
import { generateScatter, type ScatterInstance, type ScatterSpec } from '../sim/scatter';
import { isClear, roadDistance, WORLD_SIZE } from './WorldData';
import type { Terrain } from './Terrain';

/** Сколько наземных POI разложить (без учёта пирса у пруда): 4 + пирс = 5 POI,
 *  в пределах «4–6 мини-POI» ТЗ. Меньше пятна — экономнее по draw calls.
 *  Экспортируется: Forest расчищает лес ровно под те же POI (тот же seed/count). */
export const POI_COUNT = 4;

/** Общий «каменный» материал ступеней/площадки сторожевой башни (один на все). */
const TOWER_STONE_MAT = new THREE.MeshStandardMaterial({ color: 0x8a8073, roughness: 0.95 });

/** Категория деталей: спека скаттера + модели + цилиндр-коллайдер для крупных. */
interface DetailCategory {
  spec: ScatterSpec;
  assets: string[];
  /** Радиус коллайдера как доля высоты (0 — проходимая мелочь). */
  colliderR: number;
  castShadow: boolean;
  /** Растяжка по XZ — плоские модели Kenney при масштабе по высоте выглядят палками. */
  widenXZ?: number;
  /** Подмешать цвет в листву (ягодные кусты — тёмно-багряный налёт), доля [0..1]. */
  tint?: { color: number; amount: number };
}

// Детали в дополнение к лесному скаттеру: валуны (крупнее лесных камней, c/d/e/f —
// Forest берёт только a/b), поваленные стволы и брёвна, ягодные кусты (треугольные
// варианты, которых нет в лесу). Грибные круги и цветочные пятна — отдельным
// процедурным проходом (см. buildPatches). cell крупнее леса — это «островки».
const DETAILS: DetailCategory[] = [
  {
    spec: { id: 'boulder', variants: 3, cell: 70, threshold: 0.5, noiseScale: 110, minH: 1.4, maxH: 2.6 },
    assets: ['rock_largec', 'rock_larged', 'rock_largee'],
    colliderR: 0.4,
    castShadow: true,
  },
  {
    spec: { id: 'fallenlog', variants: 2, cell: 90, threshold: 0.55, noiseScale: 95, minH: 0.7, maxH: 1.1 },
    assets: ['log_large', 'log_stack'],
    colliderR: 0,
    castShadow: true,
    widenXZ: 1.3,
  },
  {
    spec: { id: 'berrybush', variants: 2, cell: 80, threshold: 0.52, noiseScale: 85, minH: 0.6, maxH: 1.0 },
    assets: ['plant_bushtriangle', 'plant_bushlargetriangle'],
    colliderR: 0,
    castShadow: false,
    // Багряный налёт отличает ягодный куст от зелёных лесных — дёшево, без частиц.
    tint: { color: 0x7a1f2b, amount: 0.32 },
  },
];

/** Процедурные «пятна»: грибные круги и цветочные поляны — по 1 InstancedMesh на тип. */
interface PatchSpec {
  spec: ScatterSpec;
  /** Цвет шляпки/лепестка. */
  color: number;
  /** Сколько мелких элементов в одном пятне. */
  perPatch: number;
  /** Радиус пятна, м. */
  patchR: number;
  /** Размер одного элемента, м. */
  size: number;
}

const PATCHES: PatchSpec[] = [
  // Цветочные пятна — тёплые поляны, видны издалека на зелени
  { spec: { id: 'flowers', variants: 1, cell: 60, threshold: 0.5, noiseScale: 75, minH: 0, maxH: 0 }, color: 0xf2c84b, perPatch: 12, patchR: 2.2, size: 0.35 },
  // Грибные круги — кольцо красных шляпок
  { spec: { id: 'fairyring', variants: 1, cell: 130, threshold: 0.62, noiseScale: 70, minH: 0, maxH: 0 }, color: 0xc0392b, perPatch: 9, patchR: 1.6, size: 0.28 },
];

/** Лендмарки: рассеянные детали (InstancedMesh) + мини-POI (модели с коллайдерами). */
export class Landmarks {
  /** Сколько POI реально поставлено (для смоуков/перф-чека). */
  poiCount = 0;
  /** Сколько мешей добавлено: InstancedMesh деталей/пятен + клоны моделей POI.
   *  Грубый proxy GL draw calls (реальные ещё дробятся по material-группам). */
  drawCalls = 0;
  /** Позиции POI — для смоуков (телепорт к ближнему). */
  readonly pois: { kind: string; x: number; z: number }[] = [];
  /**
   * Верхняя площадка сторожевой башни (tower_ruin): точка [E]-«Осмотреться» и её
   * высота. null — башня не построена в этом забеге (якорь не сел). Заполняется в
   * tower_ruin при сборке.
   */
  towerLookout: { x: number; z: number; y: number } | null = null;

  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    fortPos: { x: number; z: number },
    pondCenters: { x: number; z: number; r: number }[],
  ): Promise<void> {
    // Свободно ли место под деталь: общий isClear (вне деревни/дворца/дорог/стены)
    // + не во дворе форта (как у фауны/сундуков). margin приходит из спеки.
    const clear = (x: number, z: number, margin: number): boolean =>
      isClear(x, z, margin) && Math.hypot(x - fortPos.x, z - fortPos.z) > 22 + margin;

    // Расчистка под сами POI (тот же seed/count/clear, что и у buildPois). Валуны,
    // брёвна, ягодники и пятна не должны лезть в башню/лестницу/постройки — поэтому
    // детали и пятна используют clear с вырезом этих кругов. На размещение POI круги
    // НЕ влияют (иначе POI не сел бы рядом с собой) — buildPois получает чистый clear.
    const clearings = landmarkClearings(seed, POI_COUNT, clear, roadDistance);
    const clearDetail = (x: number, z: number, margin: number): boolean =>
      clear(x, z, margin) && !clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);

    await this.buildDetails(scene, physics, assets, seed, terrain, clearDetail);
    this.buildPatches(scene, seed, terrain, clearDetail);
    await this.buildPois(scene, physics, assets, seed, terrain, clear, pondCenters);
  }

  /** Слой рассеянных деталей: один InstancedMesh на (категория, вариант). */
  private async buildDetails(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    clear: (x: number, z: number, margin: number) => boolean,
  ): Promise<void> {
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scaleV = new THREE.Vector3();
    const posV = new THREE.Vector3();

    for (const cat of DETAILS) {
      // margin = радиус деталей: крупный валун не должен утонуть в дереве/дороге.
      const margin = cat.colliderR > 0 ? 2 : 1;
      const instances = generateScatter(seed, WORLD_SIZE, cat.spec, (x, z) => clear(x, z, margin));
      if (instances.length === 0) continue;

      const variants = await Promise.all(
        cat.assets.map(async (name) => {
          try {
            const model = extractInstancedModel(await assets.model(`/assets/world/nature/${name}.glb`));
            // Тонировка ягодных кустов: материал кэша общий, поэтому клонируем
            // перед подмешиванием цвета — не пачкаем тот же материал у других систем.
            if (cat.tint) {
              const t = new THREE.Color(cat.tint.color);
              model.materials = model.materials.map((m) => {
                const c = m.clone();
                const col = (c as THREE.MeshStandardMaterial).color;
                if (col) col.lerp(t, cat.tint!.amount);
                return c;
              });
            }
            return model;
          } catch {
            console.warn(`[landmarks] деталь ${name} не загрузилась — пропуск`);
            return null;
          }
        }),
      );

      // Группируем по варианту → один InstancedMesh на вариант (≤ 4 draw calls/категория).
      const byVariant = new Map<number, ScatterInstance[]>();
      for (const inst of instances) {
        const v = variants[inst.variant % variants.length] ? inst.variant % variants.length
          : variants.findIndex((m) => m !== null);
        if (v < 0) continue;
        let list = byVariant.get(v);
        if (!list) {
          list = [];
          byVariant.set(v, list);
        }
        list.push(inst);
      }

      const widen = cat.widenXZ ?? 1;
      for (const [v, list] of byVariant) {
        const model = variants[v];
        if (!model || list.length === 0) continue;
        const imesh = new THREE.InstancedMesh(
          model.geometry,
          model.materials.length === 1 ? model.materials[0]! : model.materials,
          list.length,
        );
        for (let i = 0; i < list.length; i++) {
          const inst = list[i]!;
          const s = inst.height / model.height;
          quat.setFromAxisAngle(up, inst.rot);
          const baseY = terrain.height(inst.x, inst.z);
          // Пивот Kenney в основании (тонкая «юбка») — origin на землю с заглублением,
          // фоллбэк по minY для центральных пивотов (как в Forest).
          const y = model.minY > -0.3 * model.height
            ? baseY - 0.03 - 0.04 * s
            : baseY - model.minY * s - 0.03;
          mat4.compose(posV.set(inst.x, y, inst.z), quat, scaleV.set(s * widen, s, s * widen));
          imesh.setMatrixAt(i, mat4);
        }
        imesh.castShadow = cat.castShadow;
        imesh.receiveShadow = true;
        imesh.computeBoundingSphere();
        scene.add(imesh);
        this.drawCalls++;
      }

      // Коллайдеры крупных деталей (валуны) — статичный «мир»-набор без тел.
      if (cat.colliderR > 0) {
        for (const inst of instances) {
          const r = Math.max(0.4, inst.height * cat.colliderR);
          const y = terrain.height(inst.x, inst.z);
          physics.world.createCollider(
            RAPIER.ColliderDesc.cylinder(inst.height * 0.5, r)
              .setTranslation(inst.x, y + inst.height * 0.5, inst.z)
              .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
          );
        }
      }
    }
  }

  /**
   * Процедурные пятна: цветочные поляны и грибные круги. Каждый тип — ОДИН
   * InstancedMesh из дешёвой геометрии (конус-лепесток / шляпка), элементы пятна
   * раскиданы по кругу. Без коллайдеров (проходимая мелочь), без шейдеров.
   */
  private buildPatches(
    scene: THREE.Scene,
    seed: number,
    terrain: Terrain,
    clear: (x: number, z: number, margin: number) => boolean,
  ): void {
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scaleV = new THREE.Vector3(1, 1, 1);
    const posV = new THREE.Vector3();

    for (const patch of PATCHES) {
      const centers = generateScatter(seed, WORLD_SIZE, patch.spec, (x, z) => clear(x, z, 1));
      if (centers.length === 0) continue;
      // Отдельный rng на раскладку элементов внутри пятен — стабилен от seed/id.
      const rng = mulberry32((seed ^ hash(patch.spec.id)) >>> 0);
      // Конус как «цветок/гриб»: 5 сегментов — дёшево, читается силуэтом.
      const geo = new THREE.ConeGeometry(0.5, 1, 5);
      const mat = new THREE.MeshStandardMaterial({ color: patch.color, roughness: 0.85 });
      const total = centers.length * patch.perPatch;
      const imesh = new THREE.InstancedMesh(geo, mat, total);
      let idx = 0;
      for (const c of centers) {
        for (let k = 0; k < patch.perPatch; k++) {
          const a = rng() * Math.PI * 2;
          const rad = Math.sqrt(rng()) * patch.patchR;
          const x = c.x + Math.cos(a) * rad;
          const z = c.z + Math.sin(a) * rad;
          const y = terrain.height(x, z);
          const s = patch.size * (0.7 + rng() * 0.6);
          quat.setFromAxisAngle(up, rng() * Math.PI * 2);
          mat4.compose(posV.set(x, y + s * 0.5, z), quat, scaleV.set(s, s * 2, s));
          imesh.setMatrixAt(idx++, mat4);
        }
      }
      imesh.count = idx; // ровно сколько элементов реально расставили
      imesh.castShadow = false;
      imesh.receiveShadow = true;
      imesh.computeBoundingSphere();
      scene.add(imesh);
      this.drawCalls++;
    }
  }

  /** Рукотворные POI: позиции из sim/landmarks + пирс у ближайшего пруда. */
  private async buildPois(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    clear: (x: number, z: number, margin: number) => boolean,
    pondCenters: { x: number; z: number; r: number }[],
  ): Promise<void> {
    const specs = planLandmarks(seed, POI_COUNT, clear, roadDistance);
    // Пирс — у самого крупного пруда (если пруды есть): мостки от берега к воде.
    const pond = pickPond(pondCenters);
    if (pond) specs.push(makePierSpec(pond));

    for (const spec of specs) {
      await this.buildPoi(scene, physics, assets, terrain, spec, pond);
      this.poiCount++;
      this.pois.push({ kind: spec.kind, x: +spec.x.toFixed(1), z: +spec.z.toFixed(1) });
    }
  }

  /** Собрать один POI из моделей кита. place — по образцу Village/VillainFort. */
  private async buildPoi(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    spec: PoiSpec,
    pond: { x: number; z: number; r: number } | null,
  ): Promise<void> {
    const place = async (
      path: string,
      x: number,
      z: number,
      opts: { footprint: number; rot?: number; collider?: 'box' | 'none'; sink?: number; groundY?: number },
    ): Promise<void> => {
      let gltf;
      try {
        gltf = await assets.model(path);
      } catch {
        console.warn(`[landmarks] POI-модель не загрузилась: ${path}`);
        return;
      }
      const obj = gltf.scene.clone();
      obj.scale.setScalar(scaleToFootprint(obj, opts.footprint));
      // groundY задаёт ровную «полку» (пирс над водой) — иначе высота берётся у рельефа.
      const y = opts.groundY ?? terrain.height(x, z);
      obj.position.set(x, 0, z);
      obj.rotation.y = opts.rot ?? spec.rot;
      obj.position.y = y - bboxOf(obj).min.y - (opts.sink ?? 0);
      enableShadows(obj);
      scene.add(obj);
      this.drawCalls++;

      if ((opts.collider ?? 'none') === 'box') {
        const box = bboxOf(obj);
        const size = box.getSize(new THREE.Vector3());
        const q = new THREE.Quaternion().setFromEuler(obj.rotation);
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(size.x * 0.42, size.y / 2, size.z * 0.42)
            .setTranslation(x, y + size.y / 2, z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
        );
      }
    };

    const cx = spec.x;
    const cz = spec.z;
    const dir = spec.rot;
    // Локальный сдвиг → мир по повороту POI (без аллокаций в цикле, POI единичны).
    const off = (dx: number, dz: number): [number, number] => [
      cx + dx * Math.cos(dir) - dz * Math.sin(dir),
      cz + dx * Math.sin(dir) + dz * Math.cos(dir),
    ];

    switch (spec.kind) {
      case 'tower_ruin': {
        // Высокая руина сторожевой башни (~3–4× прежней) с винтовым подъёмом на
        // верхнюю площадку. Тело — стопка башенных секций GLB; подъём — блоки-
        // ступени по спирали с коллизией; наверху — площадка-пол и точка осмотра.
        await this.buildWatchtower(scene, physics, assets, terrain, cx, cz, dir, off);
        break;
      }
      case 'broken_cart': {
        // Опрокинутая телега + рассыпанные ящики и бочка — «застрявший корован»
        await place('/assets/world/town/cart.glb', cx, cz, { footprint: 4, collider: 'box' });
        const [bx, bz] = off(2.2, 1);
        await place('/assets/props/barrel_large.glb', bx, bz, { footprint: 1.1, collider: 'box' });
        const [kx, kz] = off(-1.8, 1.5);
        await place('/assets/props/crates_stacked.glb', kx, kz, { footprint: 1.6, collider: 'box' });
        const [wx, wz] = off(1.5, -1.8);
        await place('/assets/world/town/wheel.glb', wx, wz, { footprint: 1.2, collider: 'none' });
        break;
      }
      case 'shrine': {
        // Придорожный обелиск из секции башни-базы + камни-приношения
        await place('/assets/world/hexagon/building_tower_base_yellow.glb', cx, cz, {
          footprint: 3,
          collider: 'box',
        });
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * Math.PI * 2 + dir;
          const [rx, rz] = [cx + Math.cos(a) * 2.2, cz + Math.sin(a) * 2.2];
          await place(`/assets/world/hexagon/rock_single_${'ac'[i]}.glb`, rx, rz, {
            footprint: 0.8,
            collider: 'none',
          });
        }
        break;
      }
      case 'hunter_camp': {
        // Палатка + кострище + бревно-скамья + дрова: брошенная стоянка
        await place('/assets/world/survival/tent.glb', cx, cz, {
          footprint: 4,
          rot: dir,
          collider: 'box',
        });
        const [fx, fz] = off(0, 3.5);
        await place('/assets/world/survival/campfire-pit.glb', fx, fz, {
          footprint: 1.6,
          collider: 'none',
        });
        const [lx, lz] = off(2.5, 3.5);
        await place('/assets/world/nature/log.glb', lx, lz, {
          footprint: 2,
          rot: dir + Math.PI / 2,
          collider: 'none',
        });
        const [wx, wz] = off(-2.2, 4.2);
        await place('/assets/world/survival/resource-wood.glb', wx, wz, {
          footprint: 1,
          collider: 'none',
        });
        break;
      }
      case 'pier': {
        // Мостки: 3 секции досок от берега к центру пруда + бочка-причал. Полка
        // ровная на высоте берега (groundY) — над водой доски не тонут в дно чаши.
        const toCenter = pond ? Math.atan2(pond.z - cz, pond.x - cx) : dir;
        const deckY = terrain.height(cx, cz) + 0.05;
        for (let i = 0; i < 3; i++) {
          const px = cx + Math.cos(toCenter) * (i * 2.4);
          const pz = cz + Math.sin(toCenter) * (i * 2.4);
          await place('/assets/world/town/planks.glb', px, pz, {
            footprint: 2.6,
            rot: toCenter,
            collider: 'none',
            groundY: deckY,
          });
        }
        const ex = cx + Math.cos(toCenter) * 5.4;
        const ez = cz + Math.sin(toCenter) * 5.4;
        await place('/assets/props/barrel_large.glb', ex, ez, {
          footprint: 1,
          collider: 'none',
          groundY: deckY,
        });
        break;
      }
    }
  }

  /**
   * Высокая сторожевая башня-руина с винтовым подъёмом. Тело — стопка из 3 башенных
   * GLB-секций (≈3.5× прежней одиночной башни), вокруг — спираль из блоков-ступеней
   * с коллизией (можно подняться ногами), наверху — площадка-пол и точка осмотра.
   * Записывает towerLookout (центр площадки + её высота) для [E]-сводки в Game.
   */
  private async buildWatchtower(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    cx: number,
    cz: number,
    dir: number,
    off: (dx: number, dz: number) => [number, number],
  ): Promise<void> {
    const baseY = terrain.height(cx, cz);
    const SECTION_FOOT = 7.5; // ширина секции башни, м
    const SECTIONS = 3; // 3 секции — высокая руина (~3.5× прежней одиночной башни)

    // --- Тело башни: стопка секций. Высоту секции берём из реального bbox первой
    //     загруженной модели (масштаб footprint меняет и высоту). ---
    let sectionH = 4.5; // фоллбэк, уточнится из bbox
    let towerR = SECTION_FOOT * 0.45;
    for (let i = 0; i < SECTIONS; i++) {
      const isTop = i === SECTIONS - 1;
      const path = isTop
        ? '/assets/world/hexagon/building_tower_a_green.glb'
        : '/assets/world/hexagon/building_tower_base_green.glb';
      let gltf;
      try {
        gltf = await assets.model(path);
      } catch {
        console.warn(`[landmarks] секция башни не загрузилась: ${path}`);
        continue;
      }
      const obj = gltf.scene.clone();
      const s = scaleToFootprint(obj, SECTION_FOOT);
      obj.scale.setScalar(s);
      const box = bboxOf(obj);
      const size = box.getSize(new THREE.Vector3());
      if (i === 0) {
        sectionH = size.y;
        towerR = Math.max(size.x, size.z) * 0.42;
      }
      // Ставим секцию так, чтобы её низ сел на верх предыдущей (стопка без щелей).
      const sectionBaseY = baseY + i * (sectionH * 0.96);
      obj.position.set(cx, sectionBaseY - box.min.y, cz);
      obj.rotation.y = dir + i * 0.4; // лёгкая закрутка секций — «осыпавшаяся» руина
      enableShadows(obj);
      scene.add(obj);
      this.drawCalls++;
    }
    const towerTopY = baseY + SECTIONS * (sectionH * 0.96);

    // Цельный цилиндр-коллайдер на всю башню (внутрь не зайти — лезем по спирали).
    physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder((towerTopY - baseY) * 0.5, towerR)
        .setTranslation(cx, baseY + (towerTopY - baseY) * 0.5, cz)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );

    // Верх пола площадки: пол-цилиндр центром towerTopY+0.15, полувысота 0.15 →
    // ходовая поверхность на towerTopY+0.30. Пандус должен прийти ровно к ней.
    const platTopY = towerTopY + 0.3;

    // --- Винтовой подъём: НЕПРЕРЫВНЫЙ пандус из наклонных коробов до пола площадки.
    //     Возвращает угол прихода наверх — там делаем проём в парапете. ---
    const ramp = this.buildSpiralStairs(scene, physics, cx, cz, baseY, platTopY, towerR);

    // --- Верхняя площадка: широкий диск-пол на вершине + зубцы по краю с проёмом
    //     в месте прихода пандуса (topAngle), чтобы зайти с лестницы на площадку. ---
    const platR = towerR + 1.6;
    this.buildTopPlatform(scene, physics, cx, cz, towerTopY, platR, dir, ramp.topAngle);

    // Обломки у подножия — «осыпавшаяся» руина (2 камня, как было).
    for (let i = 0; i < 2; i++) {
      const [rx, rz] = off(Math.cos(i * 2.5) * (towerR + 2.5), Math.sin(i * 2.5) * (towerR + 2.5));
      let g;
      try {
        g = await assets.model(`/assets/world/hexagon/rock_single_${'ac'[i]}.glb`);
      } catch {
        continue;
      }
      const o = g.scene.clone();
      o.scale.setScalar(scaleToFootprint(o, 1.4));
      o.position.set(rx, terrain.height(rx, rz) - bboxOf(o).min.y, rz);
      o.rotation.y = i * 1.7;
      enableShadows(o);
      scene.add(o);
      this.drawCalls++;
    }

    // Точка осмотра — центр верхней площадки, чуть выше пола (рост игрока).
    this.towerLookout = { x: +cx.toFixed(2), z: +cz.toFixed(2), y: +(towerTopY + 0.2).toFixed(2) };
  }

  /**
   * НЕПРЕРЫВНЫЙ винтовой пандус вокруг башни: цепочка наклонных коробов внахлёст
   * (без щелей, как у прежних отдельных ступеней). Геометрия считается чистой
   * spiralRampSegments; здесь — рендер (ОДИН InstancedMesh, 1 draw call), коллайдер
   * на каждый сегмент (наклонный кубоид) и декоративные «ступеньки» поверх пандуса.
   * Ходовая поверхность монотонна, шаг по высоте ≤ авто-степ, наклон ≤ 30°.
   * Возвращает геометрию (нужен topAngle для проёма в парапете площадки).
   */
  private buildSpiralStairs(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    cx: number,
    cz: number,
    baseY: number,
    platTopY: number,
    towerR: number,
  ): RampGeometry {
    const ramp = spiralRampSegments(cx, cz, baseY, platTopY, towerR);
    const { segments, width, thickness } = ramp;

    // ОДИН короб-геометрия на все сегменты пандуса (BoxGeometry: X=ширина, Z=длина).
    const geo = new THREE.BoxGeometry(width, thickness, 1); // длина задаётся масштабом Z
    const imesh = new THREE.InstancedMesh(geo, TOWER_STONE_MAT, segments.length);
    imesh.castShadow = true;
    imesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      // yaw вокруг Y (касательно к спирали) + тангаж вокруг локального X (короб лезет
      // вверх по ходу). Порядок YXZ: сперва тангаж, потом yaw — длинная ось +Z тилтится
      // вверх и поворачивается по касательной. Тот же кватернион — рендеру и коллайдеру.
      euler.set(-s.pitch, s.yaw, 0, 'YXZ');
      quat.setFromEuler(euler);
      m.compose(pos.set(s.x, s.y, s.z), quat, scl.set(1, 1, s.len));
      imesh.setMatrixAt(i, m);
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, thickness / 2, s.len / 2)
          .setTranslation(s.x, s.y, s.z)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
          .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
      );
    }
    imesh.instanceMatrix.needsUpdate = true;
    imesh.computeBoundingSphere();
    scene.add(imesh);
    this.drawCalls++;

    // Декоративные «ступеньки» поверх пандуса — тонкие бортики у поверхности (чисто
    // визуал, без коллизии: ходим по гладкому пандусу). ОДИН InstancedMesh.
    const stepGeo = new THREE.BoxGeometry(width * 0.92, 0.08, 0.28);
    const stepMesh = new THREE.InstancedMesh(stepGeo, TOWER_STONE_MAT, segments.length);
    stepMesh.castShadow = false;
    stepMesh.receiveShadow = true;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      // Бортик на ходовой поверхности (верх короба), у дальнего края сегмента.
      m.compose(pos.set(s.x, s.surfY + 0.04, s.z), quat, new THREE.Vector3(1, 1, 1));
      stepMesh.setMatrixAt(i, m);
    }
    stepMesh.instanceMatrix.needsUpdate = true;
    stepMesh.computeBoundingSphere();
    scene.add(stepMesh);
    this.drawCalls++;

    return ramp;
  }

  /**
   * Верхняя площадка башни: диск-пол (сплошной коллайдер) + кольцо зубцов по краю с
   * ПРОЁМОМ в месте прихода пандуса (rampTopAngle), чтобы зайти с лестницы. Зубцы —
   * ОДИН InstancedMesh; те, что попадают в проём, не ставим (ни меш, ни коллайдер).
   */
  private buildTopPlatform(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    cx: number,
    cz: number,
    topY: number,
    platR: number,
    dir: number,
    rampTopAngle: number,
  ): void {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(platR, platR, 0.3, 16), TOWER_STONE_MAT);
    floor.position.set(cx, topY + 0.15, cz);
    floor.castShadow = true;
    floor.receiveShadow = true;
    scene.add(floor);
    this.drawCalls++;
    // Пол — сплошной цилиндр-коллайдер (проём только в парапете, не в полу).
    physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.15, platR)
        .setTranslation(cx, topY + 0.15, cz)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );
    // Зубцы по краю — силуэт сторожевой башни + парапет (держит на верху). Все
    // одинаковы → ОДИН InstancedMesh, коллайдеры по одному.
    const merlons = 8;
    const mw = 0.5;
    const mh = 0.9;
    const ringR = platR - 0.3;
    // Полуширина проёма по углу: проём ≥ 1.2 м у кольца → угол ≥ 0.6/ringR; берём с
    // запасом, чтобы выкинуть ≥ 1 зубец и гарантировать вход шириной ≥ 1.2 м.
    const gapHalf = Math.max(0.45, 0.7 / ringR + Math.PI / merlons);
    const geo = new THREE.BoxGeometry(mw, mh, mw);
    const imesh = new THREE.InstancedMesh(geo, TOWER_STONE_MAT, merlons);
    imesh.castShadow = true;
    imesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const yTop = topY + 0.6;
    let placed = 0;
    for (let i = 0; i < merlons; i++) {
      const a = (i / merlons) * Math.PI * 2 + dir;
      // Угловая разница до места прихода пандуса (в [−π, π]); внутри проёма — пропуск.
      let d = a - rampTopAngle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < gapHalf) continue;
      const x = cx + Math.cos(a) * ringR;
      const z = cz + Math.sin(a) * ringR;
      quat.setFromAxisAngle(up, a);
      m.compose(pos.set(x, yTop - mh / 2, z), quat, one);
      imesh.setMatrixAt(placed++, m);
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(mw / 2, mh / 2, mw / 2)
          .setTranslation(x, yTop - mh / 2, z)
          .setRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) })
          .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
      );
    }
    imesh.count = placed; // ровно поставленные зубцы (без проёма)
    imesh.instanceMatrix.needsUpdate = true;
    imesh.computeBoundingSphere();
    scene.add(imesh);
    this.drawCalls++;
  }
}

/** Один наклонный сегмент винтового пандуса башни (короб + его коллайдер). */
export interface RampSegment {
  /** Центр короба, мир. */
  x: number;
  y: number;
  z: number;
  /** Высота ВЕРХНЕЙ (ходовой) поверхности короба в его центре, мир. */
  surfY: number;
  /** Поворот вокруг Y — короб развёрнут вдоль касательной к спирали, рад. */
  yaw: number;
  /** Наклон вверх по ходу (тангаж), рад. Капсула идёт по верхней грани. */
  pitch: number;
  /** Длина короба вдоль хода (сегменты внахлёст — длина > шага). */
  len: number;
}

/** Геометрия пандуса целиком: сегменты + размеры короба + угол прихода наверх. */
export interface RampGeometry {
  segments: RampSegment[];
  /** Радиус спирали (центр короба от оси башни), м. */
  R: number;
  /** Ширина короба вдоль радиуса (ширина прохода), м. */
  width: number;
  /** Толщина плиты короба, м. */
  thickness: number;
  /** Угол (рад) последнего сегмента — где пандус приходит к площадке (для проёма). */
  topAngle: number;
}

/** Подъём ходовой поверхности на сегмент, м (≤ авто-степа 0.45 капсулы KCC). */
const RAMP_RISE_PER_SEG = 0.4;
/** Радиальный зазор спирали от стены башни, м (центр короба = towerR + это). */
const RAMP_RADIAL_GAP = 1.3;
/** Ширина прохода пандуса (короб вдоль радиуса), м — широкая опора. */
const RAMP_WIDTH = 2.1;
/** Толщина плиты сегмента, м. */
const RAMP_THICKNESS = 0.35;

/**
 * Геометрия НЕПРЕРЫВНОГО винтового пандуса вокруг башни: цепочка наклонных коробов
 * внахлёст без щелей. Ходовая поверхность (верхняя грань) поднимается монотонно от
 * земли до пола верхней площадки; шаг по высоте между соседними сегментами держим
 * ≤ авто-степа (RAMP_RISE_PER_SEG), уклон ≤ 30°. Чистая геометрия (без three/rapier)
 * — тестируется в node, рендер и коллайдеры строятся в buildSpiralStairs из неё.
 *
 * platTopY — верх пола площадки (мир): последний сегмент стыкуется с ним ≤ 5 см.
 */
export function spiralRampSegments(
  cx: number,
  cz: number,
  baseY: number,
  platTopY: number,
  towerR: number,
): RampGeometry {
  const R = towerR + RAMP_RADIAL_GAP;
  const surfBottom = baseY + 0.2; // первая ступень чуть над землёй (входной шаг)
  const surfTop = platTopY; // верх последнего сегмента = пол площадки (стык ≤ 0)
  const totalRise = surfTop - surfBottom;
  // Сегментов столько, чтобы шаг по высоте не превышал авто-степ. nSeg+1 точек: i=0
  // у земли, i=nSeg ровно на полу площадки → последний сегмент стыкуется идеально.
  const nSeg = Math.max(8, Math.ceil(totalRise / RAMP_RISE_PER_SEG));
  // Обороты — пологий подъём (~5 м/виток), но не меньше 1.5 (иначе винт-колодец).
  const turns = Math.max(1.5, totalRise / 5);
  const segments: RampSegment[] = [];
  let topAngle = 0;
  for (let i = 0; i <= nSeg; i++) {
    const t = i / nSeg;
    const ang = t * turns * Math.PI * 2;
    const surfY = surfBottom + totalRise * t;
    const x = cx + Math.cos(ang) * R;
    const z = cz + Math.sin(ang) * R;
    const yaw = -ang + Math.PI / 2; // касательно к спирали
    // Тангаж из шага хода: дуга на сегмент vs подъём на сегмент.
    const arcPerSeg = (turns * Math.PI * 2 * R) / nSeg;
    const risePerSeg = totalRise / nSeg;
    const pitch = Math.atan2(risePerSeg, arcPerSeg);
    // Длина короба = 3D-расстояние между центрами ×1.6 — гарантированный нахлёст без щелей.
    const span = Math.hypot(arcPerSeg, risePerSeg);
    const len = Math.max(2.4, span * 1.6);
    // Центр короба = ходовая поверхность минус полтолщины по нормали грани (вертикаль ≈ /cos).
    const y = surfY - (RAMP_THICKNESS / 2) / Math.cos(pitch);
    segments.push({ x, y, z, surfY, yaw, pitch, len });
    topAngle = ang;
  }
  return { segments, R, width: RAMP_WIDTH, thickness: RAMP_THICKNESS, topAngle };
}

/** Самый крупный пруд для пирса (или null, если прудов нет). */
function pickPond(
  ponds: { x: number; z: number; r: number }[],
): { x: number; z: number; r: number } | null {
  let best: { x: number; z: number; r: number } | null = null;
  for (const p of ponds) if (!best || p.r > best.r) best = p;
  return best;
}

/** Пирс ставим на берегу пруда лицом к центру (rot — азимут на центр). */
function makePierSpec(pond: { x: number; z: number; r: number }): PoiSpec {
  // Берег с южной стороны (детерминированно), чуть за кромкой воды.
  const bx = pond.x;
  const bz = pond.z + pond.r + 1.5;
  return { kind: 'pier', x: bx, z: bz, rot: Math.atan2(pond.z - bz, pond.x - bx), radius: 6 };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
