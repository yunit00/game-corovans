import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { extractInstancedModel, type InstancedModel } from '../core/meshUtils';
import { mulberry32 } from '../core/rng';
import { LAKES, lakeCenter, lakeOuterRadius, type LakeSpec } from '../sim/lakes';
import type { Terrain } from './Terrain';

/**
 * Большие озёра в крупных пустых зонах карты (Фаза 6D, волна 1). Рендер-модуль по
 * образцу соседей (Ponds/Waterfall): чистая планировка-раскладка живёт в sim/lakes
 * (LAKES + carveLakes + lakeWaterDiscs), здесь только меши. Котловины УЖЕ врезаны в
 * Terrain.height() (carveLakes), heightfield-коллайдер подхватил их сам — игрок
 * заходит в воду по дну (плавания нет, это ок для волны 1).
 *
 * Вода — в стиле прудов (игрок хвалил её после полировки C1): vertex-color градиент
 * глубины (темнее к центру), полупрозрачная гладь, волнующаяся кромка (синусоида в
 * update без шейдеров), светлая отмель по краю. Озеро неидеально-круглое — оно
 * объединение 2–3 перекрывающихся дисков-чаш (см. LAKES.discs), каждый рисуется
 * своим веером-диском воды (overlap корректно блендится: transparent + depthWrite
 * false). У берегов БЕЗ нагромождения (прошлая жалоба на пруды): редкие камыши и
 * валуны, расставленные кольцом по внешней кромке; деревья в воде не растут
 * (расчистка в WorldData.isClear по кругам озёр).
 *
 * Задел под лодку волны 2: главное озеро (id 'west') большое (effR≈37 м) с ровным
 * дном (~3 м) и пологим входом; waterY/центр/радиус доступны через infos — посадка
 * [E] и скольжение волны 2 опираются на эти числа. Бюджет draw calls скромный:
 * на озеро ~ (число дисков воды) + 1 отмель + ≤2 инстанс-меша берега на ВСЕ озёра.
 */

/** Сегментов по окружности диска воды (и кольца-отмели). */
const RIM_SEG = 40;
/** Цвет глубины (центр) и мелководья (кромка) — как у прудов/озера водопада. */
const DEEP = new THREE.Color(0x2c5468);
const SHALLOW = new THREE.Color(0x5b93a8);

/** Готовое озеро для debugState/смоука/задела под лодку: центр, радиус, уровень воды. */
export interface LakeInfo {
  id: string;
  x: number;
  z: number;
  /** Внешний радиус водной глади, м. */
  r: number;
  /** Y водной поверхности, м (для лодки волны 2 и рыбалки волны 3). */
  waterY: number;
  /** Глубина центра, м (waterY − bedY). */
  depth: number;
}

/**
 * Геометрия диска воды: веер из центра в кромку (XZ-плоскость, пивот в центре). Vertex
 * colors дают градиент глубины (DEEP в центре → SHALLOW к кромке). Кромка — это
 * RIM_SEG+1 последних вершин (кольцо периметра), их Y колышем в update. Тот же стиль,
 * что у Ponds (Ponds.ts не наш файл — держим локальную копию, как Waterfall).
 */
function makeWaterGeometry(r: number): THREE.BufferGeometry {
  const verts = RIM_SEG + 2; // центр + (RIM_SEG+1) по кромке
  const positions = new Float32Array(verts * 3);
  const colors = new Float32Array(verts * 3);
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

export class Lakes {
  /** Готовые озёра (для debugState/смоука/задела под лодку). */
  readonly infos: LakeInfo[] = [];

  /** Диски воды — двигаем Y меша («дыхание») и колышем вершины кромки в update. */
  private waters: { mesh: THREE.Mesh; baseY: number; phase: number; geo: THREE.BufferGeometry }[] = [];
  private elapsed = 0;

  async build(scene: THREE.Scene, assets: AssetLoader, seed: number, terrain: Terrain): Promise<void> {
    // Берег: валуны и камыши из тех же моделей, что лес/пруды (extractInstancedModel),
    // отсутствующие — пропускаются (озеро останется с водой).
    const [rockModel, bushModel] = await Promise.all([
      this.loadModel(assets, '/assets/world/nature/rock_largea.glb'),
      this.loadModel(assets, '/assets/world/nature/plant_bush.glb'),
    ]);

    // Камыши — общая геометрия/материал (тонкий вытянутый конус, как у прудов).
    const reedGeo = new THREE.CylinderGeometry(0.005, 0.02, 1, 5, 1, true);
    const reedMat = new THREE.MeshStandardMaterial({
      color: 0x4a6b35,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });

    // Материал воды — ОДИН на все озёра/диски: полупрозрачная гладь с градиентом
    // глубины через vertex colors. Прозрачная + depthWrite false → перекрытия дисков
    // и берег/камыши не режутся по глубине.
    const waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      roughness: 0.12,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // Светлая отмель по внешней кромке — общий материал (одно кольцо на озеро).
    const shoreMat = new THREE.MeshBasicMaterial({
      color: 0x9fd3da,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const bankRng = mulberry32((seed ^ 0x1a4e) >>> 0);
    let reedTotal = 0;

    for (const lake of LAKES) {
      const c = lakeCenter(lake);
      const outerR = lakeOuterRadius(lake);
      this.infos.push({
        id: lake.id,
        x: +c.x.toFixed(2),
        z: +c.z.toFixed(2),
        r: +outerR.toFixed(2),
        waterY: lake.waterY,
        depth: +(lake.waterY - lake.bedY).toFixed(2),
      });

      // Гладь: по диску воды на каждую составляющую чаши (overlap блендится). Y чуть
      // ниже waterY на 0.02 для отмели, сама вода ровно на waterY.
      for (const disc of lake.discs) {
        const geo = makeWaterGeometry(disc.rimR);
        const water = new THREE.Mesh(geo, waterMat);
        water.position.set(disc.x, lake.waterY, disc.z);
        water.receiveShadow = false; // прозрачная гладь — тень на ней лишь грязнит
        water.renderOrder = 1; // поверх берега/камышей — корректная прозрачность
        scene.add(water);
        const phase = bankRng() * Math.PI * 2;
        this.waters.push({ mesh: water, baseY: lake.waterY, phase, geo });
      }

      // Отмель — тонкое кольцо у внешней кромки озера (мягкий переход вместо края).
      const shoreGeo = new THREE.RingGeometry(outerR - 1.0, outerR + 0.6, RIM_SEG);
      shoreGeo.rotateX(-Math.PI / 2);
      const shore = new THREE.Mesh(shoreGeo, shoreMat);
      shore.position.set(c.x, lake.waterY - 0.03, c.z);
      shore.receiveShadow = false;
      scene.add(shore);

      reedTotal += this.plantReeds(terrain, lake, c, outerR, bankRng);
    }

    // Берег: по одному InstancedMesh валунов/кустов на ВСЕ озёра (редкие, без свалки).
    this.buildBank(scene, rockModel, bushModel, terrain, bankRng);
    // Камыши — один InstancedMesh на все озёра.
    if (reedTotal > 0) this.flushReeds(scene, reedGeo, reedMat, reedTotal);
  }

  /**
   * Живая гладь: «дыхание» меша по Y (±0.03 м, ~4 с) + бегущая волна на кромке (±0.04 м).
   * Дёшево, без шейдеров — как у прудов и озера водопада.
   */
  update(dt: number): void {
    this.elapsed += dt;
    const w = (Math.PI * 2) / 4; // период 4 с
    for (const { mesh, baseY, phase, geo } of this.waters) {
      mesh.position.y = baseY + Math.sin(this.elapsed * w + phase) * 0.03;
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
      console.warn(`[lakes] модель ${path} не загрузилась — пропуск`);
      return null;
    }
  }

  // --- Берег: редкое кольцо валунов/кустов по внешней кромке каждого озера ---

  private rockMats: THREE.Matrix4[] = [];
  private bushMats: THREE.Matrix4[] = [];

  private buildBank(
    scene: THREE.Scene,
    rock: InstancedModel | null,
    bush: InstancedModel | null,
    terrain: Terrain,
    rng: () => number,
  ): void {
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const lake of LAKES) {
      const c = lakeCenter(lake);
      const outerR = lakeOuterRadius(lake);
      // Редко: ~1 объект на 14 м кромки (без нагромождения у воды — прошлая жалоба).
      const count = Math.max(5, Math.round((2 * Math.PI * outerR) / 14));
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rng() * 0.4;
        const dist = outerR + 1.0 + rng() * 2.0; // чуть за кромкой воды — на суше
        const x = c.x + Math.cos(a) * dist;
        const z = c.z + Math.sin(a) * dist;
        const y = terrain.height(x, z);
        const useRock = rng() < 0.6;
        const model = useRock ? rock : bush;
        if (!model) continue;
        const target = useRock ? 1.1 : 0.7; // желаемая высота, м
        const s = target / model.height;
        quat.setFromAxisAngle(up, rng() * Math.PI * 2);
        const mat = new THREE.Matrix4();
        // Пивот Kenney у основания (как в Forest/Ponds) — origin на землю с заглублением.
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

  // --- Камыши: редкие пучки тонких конусов у внешней кромки ---

  private reedMats: THREE.Matrix4[] = [];

  /** Накапливает матрицы редких пучков камышей у кромки озера; возвращает число конусов. */
  private plantReeds(
    terrain: Terrain,
    lake: LakeSpec,
    c: { x: number; z: number },
    outerR: number,
    rng: () => number,
  ): number {
    void lake;
    const clumps = Math.max(4, Math.round((2 * Math.PI * outerR) / 22)); // редко
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let added = 0;
    for (let cl = 0; cl < clumps; cl++) {
      const a = rng() * Math.PI * 2;
      const dist = outerR - 0.6 + rng() * 1.2; // у самой кромки (немного внутрь/наружу)
      const cxp = c.x + Math.cos(a) * dist;
      const czp = c.z + Math.sin(a) * dist;
      const stalks = 2 + Math.floor(rng() * 3); // 2–4 стебля в пучке
      for (let s = 0; s < stalks; s++) {
        const x = cxp + (rng() - 0.5) * 0.5;
        const z = czp + (rng() - 0.5) * 0.5;
        const y = terrain.height(x, z);
        const hgt = 0.9 + rng() * 0.4; // высота 0.9–1.3 м
        quat.setFromAxisAngle(up, rng() * Math.PI * 2);
        const m = new THREE.Matrix4();
        // Геометрия высотой 1, пивот в центре → поднимаем на половину.
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
