import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { deterministicScale, tintCharacter, type TintPalette } from '../src/core/meshUtils';

/**
 * Имитация клона скиннед-модели из общего GLB-кэша: меши делят ОДИН инстанс
 * материала (так и приходит из AssetLoader.cloneSkinned — SkeletonUtils.clone не
 * клонирует материалы). Возвращаем root и общий материал, чтобы проверить кэш.
 */
function makeCharacter(sharedMat: THREE.MeshStandardMaterial): {
  root: THREE.Group;
  meshes: THREE.Mesh[];
} {
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const body = new THREE.Mesh(geo, sharedMat);
  const head = new THREE.Mesh(geo, sharedMat); // ещё один меш на том же материале
  root.add(body, head);
  return { root, meshes: [body, head] };
}

describe('tintCharacter', () => {
  it('клонирует материалы: исходный материал из кэша не мутирует', () => {
    const cacheMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const originalColor = cacheMat.color.clone();
    const { root, meshes } = makeCharacter(cacheMat);

    tintCharacter(root, { hue: 0.33, sat: 0.3, light: -0.1 });

    // Кэш-материал не тронут (другие NPC на той же модели не перекрасились).
    expect(cacheMat.color.equals(originalColor)).toBe(true);
    // Меши получили НЕ тот инстанс, что в кэше.
    for (const m of meshes) expect(m.material).not.toBe(cacheMat);
  });

  it('перекрашивает заметно (цвет клона отличается от исходного)', () => {
    const cacheMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const { root, meshes } = makeCharacter(cacheMat);

    tintCharacter(root, { hue: 0.33, sat: 0.3, light: 0.0 });

    const tinted = (meshes[0]!.material as THREE.MeshStandardMaterial).color;
    // Сдвиг тона/насыщенности даёт ощутимую разницу по компонентам.
    const delta =
      Math.abs(tinted.r - 0.5) + Math.abs(tinted.g - 0.5) + Math.abs(tinted.b - 0.5);
    expect(delta).toBeGreaterThan(0.05);
  });

  it('два персонажа с разными палитрами имеют разные инстансы и разные цвета', () => {
    // Общий кэш-материал на обоих (как один GLB на всех NPC модели).
    const cacheMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const a = makeCharacter(cacheMat);
    const b = makeCharacter(cacheMat);

    const paletteA: TintPalette = { hue: 0.04, sat: 0.34, light: -0.04 }; // терракот
    const paletteB: TintPalette = { hue: 0.33, sat: 0.28, light: -0.12 }; // тёмно-зелёный
    tintCharacter(a.root, paletteA);
    tintCharacter(b.root, paletteB);

    const matA = a.meshes[0]!.material as THREE.MeshStandardMaterial;
    const matB = b.meshes[0]!.material as THREE.MeshStandardMaterial;
    // Разные инстансы материалов.
    expect(matA).not.toBe(matB);
    // И заметно разные цвета.
    expect(matA.color.equals(matB.color)).toBe(false);
  });

  it('общий материал на нескольких мешах клонируется один раз (единый инстанс на тело)', () => {
    const cacheMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const { root, meshes } = makeCharacter(cacheMat);

    tintCharacter(root, { hue: 0.1 });

    // Оба меша делили один кэш-материал → должны получить один и тот же клон.
    expect(meshes[0]!.material).toBe(meshes[1]!.material);
  });

  it('пустая палитра всё равно клонирует материал (свой инстанс у каждого)', () => {
    const cacheMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const { root, meshes } = makeCharacter(cacheMat);

    tintCharacter(root, {});

    expect(meshes[0]!.material).not.toBe(cacheMat);
    // Цвет без сдвигов остаётся прежним.
    expect((meshes[0]!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x808080);
  });

  it('массив материалов на меше тоже клонируется поэлементно', () => {
    const m0 = new THREE.MeshStandardMaterial({ color: 0x884422 });
    const m1 = new THREE.MeshStandardMaterial({ color: 0x224488 });
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [m0, m1]);
    root.add(mesh);

    tintCharacter(root, { hue: 0.2 });

    const mats = mesh.material as THREE.MeshStandardMaterial[];
    expect(mats[0]).not.toBe(m0);
    expect(mats[1]).not.toBe(m1);
    // Кэш-материалы целы.
    expect(m0.color.getHex()).toBe(0x884422);
    expect(m1.color.getHex()).toBe(0x224488);
  });
});

describe('deterministicScale', () => {
  it('стабилен для одного id и лежит в диапазоне', () => {
    const a = deterministicScale('lesli', 0.94, 1.08);
    const b = deterministicScale('lesli', 0.94, 1.08);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0.94);
    expect(a).toBeLessThanOrEqual(1.08);
  });

  it('разные id дают разный рост (нет глобального клонирования роста)', () => {
    const ids = ['mirne', 'brandt', 'lesli', 'hermit', 'forester', 'fisher', 'quartermaster', 'miller', 'sentry'];
    const scales = ids.map((id) => deterministicScale(id, 0.94, 1.08));
    // Достаточно разнообразия: уникальных значений почти столько же, сколько id.
    expect(new Set(scales.map((s) => s.toFixed(4))).size).toBeGreaterThanOrEqual(ids.length - 1);
  });
});
