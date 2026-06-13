import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface MeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/**
 * Квантованные meshopt-атрибуты (normalized int16) нельзя трансформировать на месте:
 * applyMatrix4 денормализует при чтении, но пишет обратно в int16 — значения за
 * пределами [-1, 1] переполняются, и верхушки сосен «заворачивались» вниз модели.
 * Разворачиваем атрибут в честный float32 перед запеканием трансформов.
 */
function dequantizeAttribute(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0, k = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[k++] = attr.getComponent(i, c);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}

/**
 * Сливает все меши GLTF в минимальное число частей (по материалу),
 * запекая трансформы — для InstancedMesh.
 */
export function extractMeshParts(gltf: GLTF): MeshPart[] {
  gltf.scene.updateMatrixWorld(true);
  const byMat = new Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.Material }>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    // Только position/normal/uv (наборы атрибутов слитых геометрий должны совпадать),
    // каждый — деквантованным float32-клоном
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', dequantizeAttribute(src.attributes.position!));
    if (src.attributes.normal) geo.setAttribute('normal', dequantizeAttribute(src.attributes.normal));
    if (src.attributes.uv) geo.setAttribute('uv', dequantizeAttribute(src.attributes.uv));
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(mesh.matrixWorld);
    const entry = byMat.get(mat.uuid);
    if (entry) entry.geos.push(geo);
    else byMat.set(mat.uuid, { geos: [geo], mat });
  });
  const parts: MeshPart[] = [];
  for (const { geos, mat } of byMat.values()) {
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    if (merged) {
      merged.computeBoundingBox();
      parts.push({ geometry: merged, material: mat });
    }
  }
  return parts;
}

export interface InstancedModel {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  /** Высота модели целиком, м. */
  height: number;
  /** Нижняя точка модели (пивот Kenney — в центре, не в основании!). */
  minY: number;
}

/**
 * Готовит модель к инстансингу: один merged-geometry с material-группами.
 * Масштаб и привязка к земле считаются по габаритам ВСЕЙ модели.
 */
export function extractInstancedModel(gltf: GLTF): InstancedModel {
  const parts = extractMeshParts(gltf);
  if (parts.length === 0) throw new Error('no meshes in gltf');
  // mergeGeometries требует одинаковые наборы атрибутов
  const allHaveUv = parts.every((p) => p.geometry.attributes.uv);
  for (const p of parts) {
    if (!allHaveUv && p.geometry.attributes.uv) p.geometry.deleteAttribute('uv');
  }
  const merged =
    parts.length === 1
      ? parts[0]!.geometry
      : mergeGeometries(parts.map((p) => p.geometry), true);
  if (!merged) throw new Error('mergeGeometries failed');
  merged.computeBoundingBox();
  const box = merged.boundingBox!;
  return {
    geometry: merged,
    materials: parts.map((p) => p.material),
    height: Math.max(0.01, box.max.y - box.min.y),
    minY: box.min.y,
  };
}

/** Габариты объекта (включая детей). */
export function bboxOf(obj: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(obj);
}

/** Масштаб, чтобы максимальный горизонтальный размер стал target (м). */
export function scaleToFootprint(obj: THREE.Object3D, target: number): number {
  const size = bboxOf(obj).getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.z) || 1;
  return target / max;
}

export function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

/**
 * Палитра перекраски персонажа. KayKit-модели красятся одним текстурным атласом
 * (material.map) поверх белого material.color, поэтому самый дешёвый и заметный
 * способ тонировки — модулировать base color: сдвинуть тон/насыщенность (offsetHSL)
 * и приглушить/высветлить яркостью. Полный multiply на тёмный цвет «съел» бы лица
 * и металл, поэтому держим сдвиги мягкими — атлас даёт детали, мы лишь меняем тон одежды.
 */
export interface TintPalette {
  /** Сдвиг тона, доля круга [-0.5..0.5] (0.0 — красный, 0.33 — зелёный, 0.66 — синий). */
  hue?: number;
  /** Сдвиг насыщенности, добавляется к текущей (обычно +0.1..+0.4 для «цветной» одежды). */
  sat?: number;
  /** Сдвиг яркости, добавляется (−0.2 темнее, +0.15 светлее). */
  light?: number;
}

/**
 * Тонирует персонажа по палитре, НЕ трогая общий кэш материалов AssetLoader.
 * Меши клонированной модели (cloneSkinned) делят инстансы материалов с кэшем GLB,
 * поэтому каждый материал сперва клонируем — иначе перекрасились бы ВСЕ NPC этой
 * модели и сам кэш. Клон ставим обратно в меш и модулируем его color.
 *
 * Пустая палитра ({}) — no-op по цвету, но материалы всё равно клонируются: так у
 * каждого персонажа свои инстансы (одинаковые тоже не должны делиться состоянием).
 * Идемпотентность не нужна — зовётся один раз при создании персонажа.
 */
export function tintCharacter(root: THREE.Object3D, palette: TintPalette): void {
  const { hue = 0, sat = 0, light = 0 } = palette;
  // Кэш клонов: один исходный материал может висеть на нескольких мешах модели —
  // клонируем его один раз, чтобы у тела был единый инстанс (меньше материалов).
  const clones = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const map = (src: THREE.Material): THREE.Material => {
      let cl = clones.get(src);
      if (!cl) {
        cl = src.clone();
        const col = (cl as THREE.MeshStandardMaterial).color;
        if (col) col.offsetHSL(hue, sat, light);
        clones.set(src, cl);
      }
      return cl;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(map)
      : map(mesh.material);
  });
}

/**
 * Детерминированный масштаб персонажа из строкового id в диапазоне [min..max].
 * Хеш id (FNV-подобный) → дробь → линейная интерполяция. Даёт стабильный «рост»
 * именованным NPC между сессиями без хранения в данных.
 */
export function deterministicScale(id: string, min: number, max: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return min + ((h >>> 0) / 4294967296) * (max - min);
}
