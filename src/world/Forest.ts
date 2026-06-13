import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { extractInstancedModel, type InstancedModel } from '../core/meshUtils';
import { GROUP_STATIC, ALL_GROUPS, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { landmarkClearings } from '../sim/landmarks';
import { generateScatter, type ScatterInstance, type ScatterSpec } from '../sim/scatter';
import { inPondWater } from '../sim/water';
import { POI_COUNT } from './Landmarks';
import { pondDiscs } from './Ponds';
import { renderTreeSprites, type TreeSprite } from './TreeImpostors';
import { isClear, roadDistance, WORLD_SIZE } from './WorldData';
import type { Terrain } from './Terrain';

interface Category {
  spec: ScatterSpec;
  assets: string[];
  /** Радиус коллайдера-цилиндра как доля высоты (0 — без коллайдера). */
  colliderR: number;
  castShadow: boolean;
  /** Доп. растяжка по XZ: узкие модели Kenney при масштабе по высоте выглядят палками. */
  widenXZ?: number;
}

// Высоты подобраны под реальные пропорции подготовленных моделей: куст (0.40×0.24 м)
// и камень (1.02×0.26 м) — плоские, масштаб по высоте превращал их в гигантские блины.
const CATEGORIES: Category[] = [
  {
    spec: { id: 'pine', variants: 5, cell: 9.5, threshold: 0.46, noiseScale: 130, minH: 9, maxH: 16 },
    assets: ['tree_pinetalla', 'tree_pinetallb', 'tree_pineroundc', 'tree_pinedefaulta', 'tree_pineroundb'],
    colliderR: 0.045,
    castShadow: true,
    widenXZ: 1.55,
  },
  {
    spec: { id: 'bush', variants: 3, cell: 14, threshold: 0.5, noiseScale: 90, minH: 0.5, maxH: 0.85 },
    assets: ['plant_bush', 'plant_bushdetailed', 'plant_bushlarge'],
    colliderR: 0,
    castShadow: false,
  },
  {
    spec: { id: 'rock', variants: 2, cell: 36, threshold: 0.58, noiseScale: 70, minH: 0.5, maxH: 1.1 },
    assets: ['rock_largea', 'rock_largeb'],
    colliderR: 0.4,
    castShadow: true,
  },
  {
    spec: { id: 'mushroom', variants: 3, cell: 24, threshold: 0.62, noiseScale: 60, minH: 0.35, maxH: 0.7 },
    assets: ['mushroom_red', 'mushroom_redgroup', 'mushroom_redtall'],
    colliderR: 0,
    castShadow: false,
  },
  {
    spec: { id: 'stump', variants: 3, cell: 42, threshold: 0.63, noiseScale: 80, minH: 0.4, maxH: 0.7 },
    assets: ['stump_round', 'log', 'log_large'],
    colliderR: 0,
    castShadow: false,
  },
];

const CHUNKS = 4; // 4×4 чанков по 250 м — фрустум-куллинг

/**
 * Дистанции переключения 3D↔билборд (от камеры до ЦЕНТРА чанка), м.
 * Гистерезис 40 м против мерцания на границе; туман 140–750 маскирует подмену.
 * За FAR — billboard виден, 3D скрыт; ближе NEAR — наоборот.
 */
const IMPOSTOR_FAR = 300;
const IMPOSTOR_NEAR = 260;

/** Геометрия билборда — одна на весь лес (PlaneGeometry лежит в плоскости XY). */
const BILLBOARD_GEO = new THREE.PlaneGeometry(1, 1);

/** Чанк: его 3D-меши (все категории) и билборды сосен — для синхронного show/hide. */
interface ChunkLOD {
  /** Центр чанка по XZ (для дистанции до камеры). */
  cx: number;
  cz: number;
  /** 3D InstancedMesh'и этого чанка (сосны + мелочь). */
  solid: THREE.InstancedMesh[];
  /** Билборды сосен (есть только у чанков с соснами). */
  billboards: THREE.InstancedMesh[];
  /** Текущий режим: true — билборды, false — 3D. Стартуем в 3D. */
  far: boolean;
}

/** Заготовка под билборды сосны: позиции/высоты/повороты варианта чанка. */
interface PineBucket {
  variant: number;
  chunk: number;
  list: ScatterInstance[];
}

/** Лес: детерминированный скаттер, чанкованные InstancedMesh, коллайдеры деревьев. */
export class Forest {
  treeCount = 0;

  /**
   * Позиции стволов сосен (x,z) в порядке генерации — для скрытого контента волны B
   * (детерминированный выбор дерева под «ожерелье»). Заполняется в build из тех же
   * инстансов, что и меши; читается один раз. Лёгкий массив пар, не в горячем пути.
   */
  readonly pineTrees: { x: number; z: number }[] = [];

  /** LOD-данные по чанкам (chunk index → меши/билборды). */
  private chunks = new Map<number, ChunkLOD>();
  /** Спрайты вариантов сосны и заготовки бакетов — для ленивого билд-импосторов. */
  private pineSprites: (TreeSprite | null)[] = [];
  private pineVariants: (InstancedModel | null)[] = [];
  private pineBuckets: PineBucket[] = [];
  /** Доп. растяжка XZ сосен (из CATEGORIES) — ширина билборда её учитывает. */
  private pineWiden = 1;
  /** Билборды собраны (ленивый рендер спрайтов при первом update — нужен renderer). */
  private impostorsBuilt = false;
  /** Сцена держится для отложенного добавления билбордов. */
  private scene: THREE.Scene | null = null;
  /** Террейн держится для высоты под билбордами (строятся лениво в update). */
  private terrain: Terrain | null = null;
  /** Число чанков сейчас в билборд-режиме (для debugStats — геттер ниже). */
  private impostorChunks = 0;

  /** Сколько чанков леса сейчас отрисованы билбордами (перф-метрика). */
  get impostorChunkCount(): number {
    return this.impostorChunks;
  }

  /** Получить/создать LOD-запись чанка. */
  private chunkLOD(chunk: number, chunkSize: number): ChunkLOD {
    let c = this.chunks.get(chunk);
    if (!c) {
      const ci = Math.floor(chunk / CHUNKS);
      const cj = chunk % CHUNKS;
      c = {
        cx: -WORLD_SIZE / 2 + (ci + 0.5) * chunkSize,
        cz: -WORLD_SIZE / 2 + (cj + 0.5) * chunkSize,
        solid: [],
        billboards: [],
        far: false,
      };
      this.chunks.set(chunk, c);
    }
    return c;
  }

  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    fort: { x: number; z: number },
  ): Promise<void> {
    this.scene = scene;
    this.terrain = terrain;
    const chunkSize = WORLD_SIZE / CHUNKS;

    // Исключаем посадки в воде прудов + буфер берега 3 м: кроны не должны нависать
    // над водой. Маска лишь фильтрует предикатом — порядок вызовов rng не меняется
    // (детерминизм леса сохранён, как при исключении дорог через isClear).
    const inWater = inPondWater(pondDiscs(seed, terrain, fort), 3);

    // Расчистка под лендмарки (башня/телега/шрайн/лагерь): лес строится ДО них и не
    // знает позиций, поэтому спрашиваем тот же детерминированный план (seed/count) и
    // не сажаем деревья/кусты внутри кругов — иначе они втыкаются в башню и лестницу.
    // Предикат clear повторяет тот, с которым Landmarks вызывает planLandmarks
    // (isClear + двор форта 22 м), чтобы круги совпали с реальными постройками.
    const clearForPlan = (x: number, z: number, margin: number): boolean =>
      isClear(x, z, margin) && Math.hypot(x - fort.x, z - fort.z) > 22 + margin;
    const clearings = landmarkClearings(seed, POI_COUNT, clearForPlan, roadDistance);
    const inLandmark = (x: number, z: number): boolean =>
      clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r);

    const clearOfWater = (x: number, z: number): boolean =>
      isClear(x, z) && !inWater(x, z) && !inLandmark(x, z);

    for (const cat of CATEGORIES) {
      const isPine = cat.spec.id === 'pine';
      const instances = generateScatter(seed, WORLD_SIZE, cat.spec, clearOfWater);
      if (isPine) {
        this.treeCount = instances.length;
        // Запоминаем стволы сосен для скрытого контента (волна B) — те же позиции,
        // что пойдут в меши; выбор «дерева-тайника» детерминирован от seed.
        for (const inst of instances) this.pineTrees.push({ x: inst.x, z: inst.z });
      }

      // Загружаем варианты; отсутствующие модели просто выпадают из ротации
      const variants: (InstancedModel | null)[] = await Promise.all(
        cat.assets.map(async (name) => {
          try {
            const gltf = await assets.model(`/assets/world/nature/${name}.glb`);
            const model = extractInstancedModel(gltf);
            // Палитра Kenney слишком бирюзовая — греем хвою в лесную зелень
            for (const m of model.materials) {
              const std = m as THREE.MeshStandardMaterial;
              if (/leafs|grass/i.test(m.name) && std.color) {
                std.color.lerp(new THREE.Color(0x3e8a40), 0.55);
              }
            }
            return model;
          } catch {
            console.warn(`[forest] модель ${name} не загрузилась — пропуск`);
            return null;
          }
        }),
      );

      // Группируем: (variant, chunk) → список инстансов
      const buckets = new Map<string, { variant: number; chunk: number; list: ScatterInstance[] }>();
      for (const inst of instances) {
        const v = variants[inst.variant % variants.length] ? inst.variant % variants.length
          : variants.findIndex((p) => p !== null);
        if (v < 0) continue;
        const cx = Math.min(CHUNKS - 1, Math.floor((inst.x + WORLD_SIZE / 2) / chunkSize));
        const cz = Math.min(CHUNKS - 1, Math.floor((inst.z + WORLD_SIZE / 2) / chunkSize));
        const chunk = cx * CHUNKS + cz;
        const key = `${v}|${chunk}`;
        let b = buckets.get(key);
        if (!b) {
          b = { variant: v, chunk, list: [] };
          buckets.set(key, b);
        }
        b.list.push(inst);
      }

      const mat4 = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const widen = cat.widenXZ ?? 1;
      if (isPine) {
        this.pineSprites = variants.map(() => null); // заполнятся при ленивом рендере
        this.pineWiden = widen;
      }
      for (const { variant, chunk, list } of buckets.values()) {
        const model = variants[variant];
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
          // У подготовленных Kenney-моделей пивот в ОСНОВАНИИ, ниже origin лишь тонкая
          // «юбка» (~−0.05 м). Выравнивание по bbox.min при масштабе ×5 подвешивало тело
          // модели в воздух на кончике юбки — ставим origin на землю с заглублением под
          // склон. Фоллбэк по bbox.min — для моделей с настоящим центральным пивотом.
          const baseY = terrain.height(inst.x, inst.z);
          const y = model.minY > -0.3 * model.height
            ? baseY - 0.03 - 0.04 * s
            : baseY - model.minY * s - 0.03;
          mat4.compose(
            new THREE.Vector3(inst.x, y, inst.z),
            quat,
            new THREE.Vector3(s * widen, s, s * widen),
          );
          imesh.setMatrixAt(i, mat4);
        }
        imesh.castShadow = cat.castShadow;
        imesh.receiveShadow = true;
        imesh.computeBoundingSphere();
        scene.add(imesh);
        // Регистрируем 3D-меш в LOD чанка; у сосен запоминаем бакет под билборды.
        this.chunkLOD(chunk, chunkSize).solid.push(imesh);
        if (isPine) this.pineBuckets.push({ variant, chunk, list });
      }
      // Спрайты вариантов сосны рендерим лениво (renderer есть только в update);
      // здесь лишь сохраняем варианты в замыкании заготовки.
      if (isPine) this.pineVariants = variants;

      // Коллайдеры (один статический «мир»-набор без тел)
      if (cat.colliderR > 0) {
        for (const inst of instances) {
          const r = Math.max(0.25, inst.height * cat.colliderR);
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
   * Кадровое LOD-переключение чанков по дистанции камеры до их центра.
   * 16 проверок — дёшево. Билборды строятся лениво при первом вызове (нужен
   * renderer для офскрин-спрайтов, а он живёт в Game, не в build).
   */
  update(camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    if (!this.impostorsBuilt) this.buildImpostors(renderer);

    const cx = camera.position.x;
    const cz = camera.position.z;
    let farCount = 0;
    for (const c of this.chunks.values()) {
      const dx = cx - c.cx;
      const dz = cz - c.cz;
      const dist = Math.hypot(dx, dz);
      // Гистерезис: уходим в far за FAR, возвращаемся в 3D только ближе NEAR.
      // Между порогами режим не меняется — это и гасит мерцание на границе.
      if (c.far) {
        if (dist < IMPOSTOR_NEAR) this.setChunkFar(c, false);
      } else if (dist > IMPOSTOR_FAR) {
        this.setChunkFar(c, true);
      }
      if (c.far) farCount++;
    }
    this.impostorChunks = farCount;
  }

  /** Переключить видимость 3D-мешей и билбордов чанка. */
  private setChunkFar(c: ChunkLOD, far: boolean): void {
    c.far = far;
    for (const m of c.solid) m.visible = !far;
    for (const b of c.billboards) b.visible = far;
  }

  /**
   * Ленивая сборка билбордов: рендерит спрайты вариантов сосны и создаёт по
   * InstancedMesh на (variant, chunk) из тех же позиций/высот, что и 3D.
   * Поворот yaw — статичный случайный (как у 3D-инстанса), к камере не вертим.
   */
  private buildImpostors(renderer: THREE.WebGLRenderer): void {
    this.impostorsBuilt = true; // даже при отсутствии сосен — не пытаемся снова
    const scene = this.scene;
    const terrain = this.terrain;
    if (!scene || !terrain || this.pineBuckets.length === 0) return;

    this.pineSprites = renderTreeSprites(renderer, this.pineVariants);
    const chunkSize = WORLD_SIZE / CHUNKS;

    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const { variant, chunk, list } of this.pineBuckets) {
      const sprite = this.pineSprites[variant];
      const model = this.pineVariants[variant];
      if (!sprite || !model || list.length === 0) continue;

      // fog:true — туман гасит билборды на дальней кромке, как и 3D-лес.
      // alphaTest режет прозрачные края кроны; DoubleSide — спрайт виден с обеих
      // сторон при статичном yaw (к камере не поворачиваем — дёшево, при тумане незаметно).
      const material = new THREE.MeshBasicMaterial({
        map: sprite.texture,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        transparent: false,
        fog: true,
      });
      const bmesh = new THREE.InstancedMesh(BILLBOARD_GEO, material, list.length);
      for (let i = 0; i < list.length; i++) {
        const inst = list[i]!;
        // Высота билборда = высота кроны 3D-дерева; ширина = высота × аспект × widenXZ.
        const h = inst.height;
        const w = h * sprite.aspect * this.pineWiden;
        const baseY = terrain.height(inst.x, inst.z);
        // Пивот плоскости в центре → центр billboard'а на половине высоты над землёй.
        pos.set(inst.x, baseY + h / 2, inst.z);
        quat.setFromAxisAngle(up, inst.rot);
        scl.set(w, h, 1);
        mat4.compose(pos, quat, scl);
        bmesh.setMatrixAt(i, mat4);
      }
      bmesh.castShadow = false;
      bmesh.receiveShadow = false;
      bmesh.visible = false; // стартуем в 3D-режиме — billboard ждёт ухода чанка вдаль
      bmesh.computeBoundingSphere();
      scene.add(bmesh);
      this.chunkLOD(chunk, chunkSize).billboards.push(bmesh);
    }
  }
}
