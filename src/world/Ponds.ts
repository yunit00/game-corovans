import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { extractInstancedModel, type InstancedModel } from '../core/meshUtils';
import { mulberry32 } from '../core/rng';
import type { WaterDisc } from '../sim/water';
import { isClear, PALACE, VILLAGE } from './WorldData';
import type { Terrain } from './Terrain';

/**
 * Декоративные водоёмы (Фаза 5.5): 2–3 симпатичных пруда в природных низинах.
 * Место выбирается детерминированно рельефом (как форт) — чистая функция от
 * terrain.height/isClear, поэтому Game могла бы знать пруды и без сборки мешей.
 * Воды нет смысла делать физической: террейн с amplitude 13 у низин даёт чашу
 * глубиной ~0.45 м (см. отчёт), под капсулу не проваливает — вода чисто визуал.
 */

/** Шаг сетки кандидатов, м. */
const GRID_STEP = 25;
/** Полу-зона поиска, м: |x|,|z| < EXTENT (не лезть к горной стене isClear=435). */
const EXTENT = 420;
/** Минимальная дистанция до деревни/дворца/форта, м. */
const KEEP_AWAY = 60;
/** Минимальная попарная дистанция между прудами, м — разносим по карте. */
const PAIR_DIST = 150;
/** Сколько прудов оставляем (самые глубокие низины). */
const POND_COUNT = 3;
/** Запас isClear под пруд: чаша + берег крупнее камня/куста. */
const CLEAR_MARGIN = 25;

/** Параметры выбранной низины (чистый результат поиска, без three). */
export interface PondSite {
  x: number;
  z: number;
  /** Высота рельефа в самой низкой точке чаши (дно), м. */
  minHeight: number;
}

/** Готовый пруд для debugState и телепорта смоука. */
export interface PondInfo {
  x: number;
  z: number;
  r: number;
}

/** Сегментов по окружности диска воды (и кольца-отмели). */
const RIM_SEG = 40;
/** Цвет глубины (центр) и мелководья (кромка) — лёгкий градиент глади. */
const DEEP = new THREE.Color(0x2c5468);
const SHALLOW = new THREE.Color(0x5b93a8);

/**
 * Геометрия диска воды: веер из центра в кромку (XZ-плоскость, пивот в центре).
 * Vertex colors дают градиент глубины (DEEP в центре → SHALLOW к кромке). Кромка —
 * это RIM_SEG+1 последних вершин (кольцо периметра), их Y колышем в update.
 */
function makeWaterGeometry(r: number): THREE.BufferGeometry {
  const verts = RIM_SEG + 2; // центр + (RIM_SEG+1) по кромке (замкнём дублем)
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
  // Центр
  positions[0] = 0; positions[1] = 0; positions[2] = 0;
  colors[0] = DEEP.r; colors[1] = DEEP.g; colors[2] = DEEP.b;
  for (let i = 0; i <= RIM_SEG; i++) {
    const a = (i / RIM_SEG) * Math.PI * 2;
    const o = (i + 1) * 3;
    positions[o] = Math.cos(a) * r;
    positions[o + 1] = 0;
    positions[o + 2] = Math.sin(a) * r;
    colors[o] = SHALLOW.r; colors[o + 1] = SHALLOW.g; colors[o + 2] = SHALLOW.b;
  }
  const index: number[] = [];
  for (let i = 1; i <= RIM_SEG; i++) index.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Дно чаши: минимум terrain.height в плотной коробке 16 м вокруг центра клетки. */
function bowlMin(terrain: Terrain, cx: number, cz: number): number {
  let min = Infinity;
  for (let dx = -16; dx <= 16; dx += 2) {
    for (let dz = -16; dz <= 16; dz += 2) {
      const h = terrain.height(cx + dx, cz + dz);
      if (h < min) min = h;
    }
  }
  return min;
}

/**
 * Детерминированный выбор низин: сетка GRID_STEP по |x|,|z| < EXTENT, кандидаты —
 * локальные минимумы terrain.height среди свободных (isClear margin 25) и дальше
 * KEEP_AWAY от деревни/дворца/форта. Берём POND_COUNT самых глубоких с попарной
 * дистанцией > PAIR_DIST. Чистая функция от terrain/fort — node-тестируемая.
 */
export function findPondSites(terrain: Terrain, fort: { x: number; z: number }): PondSite[] {
  const farFromHubs = (x: number, z: number): boolean =>
    Math.hypot(x - VILLAGE.x, z - VILLAGE.z) > KEEP_AWAY &&
    Math.hypot(x - PALACE.x, z - PALACE.z) > KEEP_AWAY &&
    Math.hypot(x - fort.x, z - fort.z) > KEEP_AWAY;

  const h = (x: number, z: number): number => terrain.height(x, z);
  const cands: { x: number; z: number; h: number }[] = [];
  for (let x = -EXTENT; x <= EXTENT; x += GRID_STEP) {
    for (let z = -EXTENT; z <= EXTENT; z += GRID_STEP) {
      if (!isClear(x, z, CLEAR_MARGIN)) continue;
      if (!farFromHubs(x, z)) continue;
      const c = h(x, z);
      // Локальный минимум: не выше любого из 8 соседей по сетке
      let isMin = true;
      for (let dx = -1; dx <= 1 && isMin; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (h(x + dx * GRID_STEP, z + dz * GRID_STEP) < c) {
            isMin = false;
            break;
          }
        }
      }
      if (isMin) cands.push({ x, z, h: c });
    }
  }
  // Самые глубокие сначала; жадно набираем с разносом по карте
  cands.sort((a, b) => a.h - b.h);
  const sites: PondSite[] = [];
  for (const c of cands) {
    if (sites.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > PAIR_DIST)) {
      sites.push({ x: c.x, z: c.z, minHeight: bowlMin(terrain, c.x, c.z) });
    }
    if (sites.length === POND_COUNT) break;
  }
  return sites;
}

/** Радиус пруда от seed+места: 8–14 м (детерминированно, разнообразие размеров). */
export function pondRadius(seed: number, site: PondSite): number {
  // Сабсид от координат — каждый пруд свой размер, но воспроизводимо
  const rng = mulberry32((seed ^ (Math.imul(site.x | 0, 73856093) ^ Math.imul(site.z | 0, 19349663))) >>> 0);
  return 8 + rng() * 6;
}

/**
 * Диски прудов (центр + радиус глади) для исключения посадок леса у воды.
 * Чистая функция от terrain/fort/seed — лес вызывает её сам (пруды строятся
 * после леса, поэтому Forest не может взять готовые infos, но места выводимы).
 */
export function pondDiscs(seed: number, terrain: Terrain, fort: { x: number; z: number }): WaterDisc[] {
  return findPondSites(terrain, fort).map((site) => ({
    x: site.x,
    z: site.z,
    r: pondRadius(seed, site),
  }));
}

/**
 * Водоёмы: плоский диск «воды» в каждой низине, кольцо камней/кустов по берегу
 * и пучки камышей у кромки. Вода едва покачивается по Y (±0.03 м, ~4 с) в update.
 */
export class Ponds {
  /** Готовые пруды (для debugState/смоука): центр и радиус. */
  readonly infos: PondInfo[] = [];

  /** Диски воды — двигаем Y меша («дыхание») и колышем вершины кромки в update. */
  private waters: { mesh: THREE.Mesh; baseY: number; phase: number; geo: THREE.BufferGeometry }[] = [];
  /** Накопленное время для синусоиды покачивания, с. */
  private elapsed = 0;

  async build(
    scene: THREE.Scene,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
    fort: { x: number; z: number },
  ): Promise<void> {
    const sites = findPondSites(terrain, fort);

    // Берег и камыши инстансим из тех же моделей, что и лес (extractInstancedModel),
    // отсутствующие модели просто пропускаются — пруд останется с водой и камышами.
    const [rockModel, bushModel] = await Promise.all([
      this.loadModel(assets, '/assets/world/nature/rock_largea.glb'),
      this.loadModel(assets, '/assets/world/nature/plant_bush.glb'),
    ]);

    // Камыши — общая геометрия/материал на все пруды (тонкий вытянутый конус).
    const reedGeo = new THREE.CylinderGeometry(0.005, 0.02, 1, 5, 1, true);
    const reedMat = new THREE.MeshStandardMaterial({
      color: 0x4a6b35,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });

    // Материал воды — общий: полупрозрачная «вода» с градиентом глубины через
    // vertex colors (темнее/мутнее к центру, светлее к кромке). Мягкий блик —
    // низкая шероховатость; vertexColors включает per-vertex окраску.
    const waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      roughness: 0.12,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false, // прозрачная гладь не должна резать камыши/берег по глубине
    });

    // Светлая отмель по кромке — общий материал на все пруды (один тонкий ринг/пруд).
    const shoreMat = new THREE.MeshBasicMaterial({
      color: 0x9fd3da,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    let reedTotal = 0;
    const bankRng = mulberry32((seed ^ 0xb09d) >>> 0);
    for (const site of sites) {
      const r = pondRadius(seed, site);
      this.infos.push({ x: site.x, z: site.z, r: +r.toFixed(2) });

      const baseY = site.minHeight + 0.45;
      // Диск воды: веер от центра с градиентом глубины и кольцом-кромкой, которое
      // мы синусоидально колышем в update (живая поверхность без шейдеров).
      const waterGeo = makeWaterGeometry(r);
      const water = new THREE.Mesh(waterGeo, waterMat);
      water.position.set(site.x, baseY, site.z);
      water.receiveShadow = false; // прозрачная гладь — тень на ней лишь грязнит
      water.renderOrder = 1; // поверх берега/камышей — корректная прозрачность
      scene.add(water);
      // Запоминаем базовые Y вершин кромки для колыхания (последние RIM_SEG+1 вершин).
      const phase = bankRng() * Math.PI * 2;
      this.waters.push({ mesh: water, baseY, phase, geo: waterGeo });

      // Светлая отмель: тонкое кольцо у самой кромки (приятный переход вместо края).
      const shoreGeo = new THREE.RingGeometry(r - 0.6, r + 0.35, RIM_SEG);
      shoreGeo.rotateX(-Math.PI / 2);
      const shore = new THREE.Mesh(shoreGeo, shoreMat);
      shore.position.set(site.x, baseY - 0.02, site.z);
      shore.receiveShadow = false;
      scene.add(shore);

      reedTotal += this.plantReeds(terrain, site, r, bankRng);
    }

    // Берег: по одному InstancedMesh камней и кустов на ВСЕ пруды (мало инстансов).
    this.buildBank(scene, rockModel, bushModel, terrain, sites, seed);

    // Камыши собираем в один InstancedMesh (если хоть один пучок встал)
    if (reedTotal > 0) this.flushReeds(scene, reedGeo, reedMat, reedTotal);
  }

  /**
   * Живая гладь: общее «дыхание» меша по Y (±0.03 м, ~4 с) + лёгкое колыхание
   * вершин кромки (бегущая волна по периметру, ±0.04 м) — дёшево, без шейдеров.
   */
  update(dt: number): void {
    this.elapsed += dt;
    const w = (Math.PI * 2) / 4; // период 4 с
    for (const { mesh, baseY, phase, geo } of this.waters) {
      mesh.position.y = baseY + Math.sin(this.elapsed * w + phase) * 0.03;
      // Кромка — вершины [1 .. RIM_SEG+1]: бегущая по углу волна (фаза = угол·3).
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i <= RIM_SEG; i++) {
        const ang = (i / RIM_SEG) * Math.PI * 2;
        arr[(i + 1) * 3 + 1] = Math.sin(this.elapsed * 2.2 + ang * 3 + phase) * 0.04;
      }
      pos.needsUpdate = true;
    }
  }

  private async loadModel(assets: AssetLoader, path: string): Promise<InstancedModel | null> {
    try {
      return extractInstancedModel(await assets.model(path));
    } catch {
      console.warn(`[ponds] модель ${path} не загрузилась — пропуск`);
      return null;
    }
  }

  // --- Берег: кольцо камней/кустов по окружности каждого пруда ---

  /** Отложенные матрицы берега, копятся по прудам и заливаются разом. */
  private rockMats: THREE.Matrix4[] = [];
  private bushMats: THREE.Matrix4[] = [];

  private buildBank(
    scene: THREE.Scene,
    rock: InstancedModel | null,
    bush: InstancedModel | null,
    terrain: Terrain,
    sites: PondSite[],
    seed: number,
  ): void {
    const rng = mulberry32((seed ^ 0x5a17e) >>> 0);
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const site of sites) {
      const r = pondRadius(seed, site); // тот же детерминированный радиус, что у диска воды
      // 8–12 объектов кольцом чуть за кромкой воды (берег); чередуем камень/куст
      const count = 8 + Math.floor(rng() * 5);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.3;
        const dist = r + 0.8 + rng() * 1.4; // на берегу, чуть отступив от воды
        const x = site.x + Math.cos(a) * dist;
        const z = site.z + Math.sin(a) * dist;
        const y = terrain.height(x, z);
        const useRock = rng() < 0.55;
        const model = useRock ? rock : bush;
        if (!model) continue;
        const target = useRock ? 1.0 : 0.7; // желаемая высота, м
        const s = target / model.height;
        quat.setFromAxisAngle(up, rng() * Math.PI * 2);
        const mat = new THREE.Matrix4();
        // Пивот Kenney у основания (как в Forest) — origin на землю с лёгким заглублением
        const baseY = model.minY > -0.3 * model.height ? y - 0.03 - 0.04 * s : y - model.minY * s - 0.03;
        mat.compose(new THREE.Vector3(x, baseY, z), quat, new THREE.Vector3(s, s, s));
        (useRock ? this.rockMats : this.bushMats).push(mat);
      }
    }
    this.flushBank(scene, rock, this.rockMats, true);
    this.flushBank(scene, bush, this.bushMats, false);
  }

  private flushBank(
    scene: THREE.Scene,
    model: InstancedModel | null,
    mats: THREE.Matrix4[],
    castShadow: boolean,
  ): void {
    if (!model || mats.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      model.geometry,
      model.materials.length === 1 ? model.materials[0]! : model.materials,
      mats.length,
    );
    for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]!);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  // --- Камыши: пучки тонких конусов у кромки ---

  /** Отложенные матрицы камышей (копятся по прудам, заливаются один раз). */
  private reedMats: THREE.Matrix4[] = [];

  /** Накапливает матрицы 6–10 камышей пучками у кромки пруда; возвращает число конусов. */
  private plantReeds(terrain: Terrain, site: PondSite, r: number, rng: () => number): number {
    const clumps = 6 + Math.floor(rng() * 5); // 6–10 «пучков»
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let added = 0;
    for (let c = 0; c < clumps; c++) {
      const a = rng() * Math.PI * 2;
      const dist = r - 0.3 + rng() * 0.8; // у самой кромки (немного внутрь/наружу)
      const cxp = site.x + Math.cos(a) * dist;
      const czp = site.z + Math.sin(a) * dist;
      const stalks = 2 + Math.floor(rng() * 3); // 2–4 стебля в пучке
      for (let s = 0; s < stalks; s++) {
        const jx = (rng() - 0.5) * 0.5;
        const jz = (rng() - 0.5) * 0.5;
        const x = cxp + jx;
        const z = czp + jz;
        const y = terrain.height(x, z);
        const hgt = 0.9 + rng() * 0.4; // высота 0.9–1.3 м
        quat.setFromAxisAngle(up, rng() * Math.PI * 2);
        const m = new THREE.Matrix4();
        // Геометрия высотой 1, пивот в центре → поднимаем на половину, чуть наклоняем
        m.compose(new THREE.Vector3(x, y + hgt / 2, z), quat, new THREE.Vector3(1, hgt, 1));
        this.reedMats.push(m);
        added++;
      }
    }
    return added;
  }

  private flushReeds(
    scene: THREE.Scene,
    geo: THREE.CylinderGeometry,
    mat: THREE.MeshStandardMaterial,
    total: number,
  ): void {
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    for (let i = 0; i < this.reedMats.length; i++) mesh.setMatrixAt(i, this.reedMats[i]!);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}
