import * as THREE from 'three';
import type { InstancedModel } from '../core/meshUtils';

/** Размер офскрин-спрайта одного варианта сосны (узкий, вытянутый по вертикали). */
const SPRITE_W = 128;
const SPRITE_H = 256;

// Скретчи — без аллокаций при ленивом рендере спрайтов (один раз на старте, но всё же)
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * Спрайт-импостор одного merged-варианта сосны: вид сбоку, отрендеренный в
 * офскрин RenderTarget. Хранит текстуру и её аспект (ширина/высота кадра модели),
 * чтобы билборд получил верную пропорцию плоскости.
 */
export interface TreeSprite {
  texture: THREE.Texture;
  /** Аспект кадра = ширина_модели / высота_модели (для ширины билборда). */
  aspect: number;
}

/**
 * Рендерит каждый вариант сосны сбоку в текстуру 128×256 для билбордов вдали.
 * Отдельная мини-сцена с ортокамерой и нейтральным светом, прозрачный фон —
 * один раз на старте (renderer появляется только в tick, поэтому ленивый вызов).
 *
 * Почему вид сбоку и статичный yaw билборда (не вертим к камере): при тумане
 * 140–750 м подмену не видно, а экономия — целый кадровый поворот матриц.
 */
export function renderTreeSprites(
  renderer: THREE.WebGLRenderer,
  variants: (InstancedModel | null)[],
): (TreeSprite | null)[] {
  // Мини-сцена: нейтральный свет, чтобы спрайт не зависел от времени суток сцены
  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(0.4, 1, 0.7);
  scene.add(ambient, dir);

  const cam = new THREE.OrthographicCamera();
  const target = new THREE.WebGLRenderTarget(SPRITE_W, SPRITE_H, {
    // depthBuffer нужен — у сосны самоперекрытие веток; magFilter Linear сглаживает
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });

  // Состояние рендерера, которое временно меняем (вернём как было)
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);

  const out: (TreeSprite | null)[] = variants.map((model) => {
    if (!model) return null;

    const mesh = new THREE.Mesh(
      model.geometry,
      model.materials.length === 1 ? model.materials[0]! : model.materials,
    );
    // Материалы хвои Kenney — MeshStandard с alphaTest на листве; для спрайта
    // важно, чтобы прозрачные края резались по тому же порогу (alphaTest на месте).
    scene.add(mesh);

    _box.setFromObject(mesh);
    _box.getSize(_size);
    _box.getCenter(_center);

    // Ортокамера смотрит по −Z на модель: ширина кадра = горизонт. габарит,
    // высота = вертикальный. Небольшой запас, чтобы крона не упёрлась в край.
    const halfW = (_size.x * 1.06) / 2;
    const halfH = (_size.y * 1.04) / 2;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.near = 0.01;
    cam.far = _size.z * 4 + 10;
    cam.position.set(_center.x, _center.y, _center.z + _size.z * 2 + 5);
    cam.lookAt(_center);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);

    // Копируем пиксели в самостоятельную DataTexture: RenderTarget переиспользуем
    // под следующий вариант, а каждому билборду нужна своя независимая карта.
    const pixels = new Uint8Array(SPRITE_W * SPRITE_H * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SPRITE_W, SPRITE_H, pixels);
    const tex = new THREE.DataTexture(pixels, SPRITE_W, SPRITE_H, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;

    scene.remove(mesh);
    return { texture: tex, aspect: halfW / halfH };
  });

  // Возврат состояния рендерера + чистка временных ресурсов
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  target.dispose();
  ambient.dispose();
  dir.dispose();

  return out;
}
