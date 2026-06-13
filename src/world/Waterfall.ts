// Водопад в ГОРНОЙ СТЕНЕ: льётся из скалы на краю карты, а не отдельным строением.
// Прежний скальный амфитеатр (композиция
// cliff_block* на пустом месте) снесён — больше никаких «строений». Порода = сама гора:
// зев врезан в склон юго-западного горного кольца на +12–16 м над озером (по образцу
// пещеры паркура, Parkour.ts), поток падает к озеру у ПОДНОЖИЯ стены.
//
// Точка WATERFALL — низ потока у кромки озера, прямо у подножия вала (cheb=438, склон
// там в троге ≈ 0 м). Зев MOUTH — вглубь стены (к −x), где терраин поднялся на +12–16 м
// (см. MOUTH_INWARD; высота подобрана по фактической height() и закреплена тестом).
// В склон врезан cliff_blockcave_stone (тёмная ниша), фронтом наружу к озеру; по бокам
// зева в склон утоплены 2 крупных rock_large* — порода читается одним массивом стены, а
// не коробкой. Поток — две перекрывающиеся вертикальные плоскости со скроллом UV: верх
// привязан к фактическому bbox зева, низ — к поверхности озера.
//
// Озеро — в стиле прудов (vertex-color градиент глубины + волнующаяся кромка), внизу
// облако пены и лёгкий туман. Ручей-лента тянется к ближайшему пруду. Скалам — простые
// кубоид-коллайдеры по bbox. Бюджет: ≤ 20 draw calls (считаем сами в drawCalls).
//
// Тёплый серый: чистый *_stone Кенни холодноват, rock_large* — песочный; материалы
// клонируем (НЕ мутируя кэш AssetLoader) и стягиваем lerp-ом к общему скальному тону,
// чтобы врезанные блоки сливались со склоном вала.
//
// Точка фиксирована, высота берётся у рельефа фактической height() — поток/зев садятся
// на склон, который Terrain поднимает в гору при cheb>425.
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, type PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import type { Terrain } from './Terrain';

/** Фиксированная точка водопада (низ потока, у кромки озера у ПОДНОЖИЯ стены).
 *  Юго-западное горное кольцо, западная грань вала: cheb=438 — в троге у самого
 *  начала подъёма склона (height там ≈ 0 м). Далеко от дорог (≥210 м), прудов (≥305 м),
 *  паркур-трассы (≥340 м от ANCHOR), холмов (≥339 м), дворца/форта. Сид-независима. */
export const WATERFALL = { x: -438, z: 300 } as const;

/** Сдвиг зева вглубь склона от WATERFALL (к −x, в гору), м. На этом удалении терраин
 *  западной грани поднимается на +12–16 м над уровнем озера у подножия (проверено
 *  фактической height(), закреплено тестом waterfall.test). Зев врезается сюда. */
export const MOUTH_INWARD = 16;

/** Точка зева грота (центр врезки в склон). XZ: вглубь стены от WATERFALL. Высота — по
 *  фактическому bbox cave-блока (см. buildMouth), не хардкод. */
export const MOUTH = { x: WATERFALL.x - MOUTH_INWARD, z: WATERFALL.z } as const;

/** Ширина потока у зева, м (книзу слегка расширяется). */
const STREAM_W = 2.4;
/** Ширина ручья-ленты до пруда, м. */
const BROOK_W = 1.6;
/** Скорость скролла UV потока (вниз), 1/с — две плоскости с разной скоростью. */
const FALL_SCROLL_A = 1.5;
const FALL_SCROLL_B = 2.3;
/** Скорость скролла UV ручья (по течению), 1/с. */
const BROOK_SCROLL = 0.22;
/** Максимальная длина ручья до пруда, м (если пруд далеко — обрываем). */
const BROOK_MAX_LEN = 120;
/** Фолбэк-высота зева над озером, если bbox cave-блока недоступен, м. */
const FALL_HEIGHT_FALLBACK = 13;

/** Цвет глубины (центр) и мелководья (кромка) озера — как у прудов. */
const DEEP = new THREE.Color(0x2c5468);
const SHALLOW = new THREE.Color(0x5b93a8);
/** Сегментов по окружности озера (и его кромки). */
const RIM_SEG = 40;

/** Сдвиг центра озера от WATERFALL по линии «отшельник → водопад» и дальше, м. */
const LAKE_EXTRA = 2.5;
/** Запас «берега»: отшельник стоит на столько метров дальше кромки воды. */
const LAKE_SHORE = 1.5;

/** Орт от WATERFALL к центру карты (открытый берег, прочь от стены). Отшельник стоит
 *  на этой стороне озера лицом к стене/потоку; вглубь по −этому орту уходит склон. */
const TO_CENTER = (() => {
  const d = Math.hypot(WATERFALL.x, WATERFALL.z) || 1;
  return { x: -WATERFALL.x / d, z: -WATERFALL.z / d };
})();

/** Якорь отшельника (см. WorldNpcs): WATERFALL сдвинут к центру карты (на открытый
 *  берег озера, НЕ на склон горы) на HERMIT_OFFSET. Лицом к стене/потоку. Дистанция
 *  отшельник→WATERFALL задаёт радиус озера (r = HERMIT_OFFSET + LAKE_EXTRA − LAKE_SHORE),
 *  поэтому 6.5 → пруд ~7.5 м (как у прежнего амфитеатра). */
export const HERMIT_OFFSET = 6.5;
const HERMIT = {
  x: WATERFALL.x + TO_CENTER.x * HERMIT_OFFSET,
  z: WATERFALL.z + TO_CENTER.z * HERMIT_OFFSET,
} as const;

/**
 * Геометрия и параметры озера водопада: центр сдвинут от WATERFALL по линии
 * «отшельник → водопад» ещё на LAKE_EXTRA (озеро прижимается к подножию стены и
 * уходит от отшельника к скале), радиус — так, чтобы отшельник стоял на LAKE_SHORE
 * дальше кромки воды. Чистая функция координат — node-тестируемая (см. waterfall.test).
 */
export function lakePlacement(
  waterfall: { x: number; z: number } = WATERFALL,
  hermit: { x: number; z: number } = HERMIT,
): { x: number; z: number; r: number } {
  const dx = waterfall.x - hermit.x;
  const dz = waterfall.z - hermit.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  // Центр озера: за точкой водопада на LAKE_EXTRA (вглубь от отшельника, к стене).
  const x = waterfall.x + ux * LAKE_EXTRA;
  const z = waterfall.z + uz * LAKE_EXTRA;
  // Дистанция от отшельника до центра = d + LAKE_EXTRA; радиус оставляет берег.
  const r = d + LAKE_EXTRA - LAKE_SHORE;
  return { x, z, r };
}

/**
 * Тонкая «водяная» текстура: вертикальные полупрозрачные полосы-струи на канве.
 * Скроллим её offset.y в update — иллюзия течения без шейдера. Две на поток (разный
 * сид → плоскости не «слипаются»).
 */
function makeWaterTexture(seed = 0): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  // База — холодный голубой полупрозрачный.
  ctx.fillStyle = 'rgba(150, 200, 225, 0.5)';
  ctx.fillRect(0, 0, c.width, c.height);
  // Светлые струйки-полосы (псевдослучайно, но детерминированно по индексу+сиду).
  for (let i = 0; i < c.width; i += 2) {
    const a = 0.25 + (((i * 37 + seed * 13) % 11) / 22); // 0.25..0.75
    ctx.fillStyle = `rgba(235, 248, 255, ${a.toFixed(2)})`;
    ctx.fillRect(i, 0, 1, c.height);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Текстура ручья: в тон воды прудов (холодный сине-зелёный), со светлыми узкими
 * «перекатами» поперёк русла (горизонтальные полосы). Скроллим offset.y в update —
 * перекаты «бегут» по течению. Дёшево, одна текстура на ручей.
 */
function makeBrookTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  // База — в тон пруда (0x3f6f86), полупрозрачная.
  ctx.fillStyle = 'rgba(63, 111, 134, 0.85)';
  ctx.fillRect(0, 0, c.width, c.height);
  // Перекаты — светлые горизонтальные полосы поперёк русла, неравномерно.
  for (let y = 4; y < c.height; y += 9) {
    const yy = y + ((y * 13) % 5) - 2; // лёгкий разброс шага
    ctx.fillStyle = 'rgba(214, 238, 245, 0.55)';
    ctx.fillRect(0, yy, c.width, 1);
    ctx.fillStyle = 'rgba(170, 210, 224, 0.35)';
    ctx.fillRect(0, yy + 1, c.width, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Мягкий радиальный «туман» на канве (белый, гаснущий к краям) — для billboard-спрайтов. */
function makeMistTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(235,245,250,0.22)');
  g.addColorStop(1, 'rgba(235,245,250,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Геометрия озера: веер из центра в кромку (XZ-плоскость, пивот в центре). Vertex
 * colors дают градиент глубины (DEEP в центре → SHALLOW к кромке). Кромка — это
 * RIM_SEG+1 последних вершин (кольцо периметра), их Y колышем в update. Тот же
 * стиль, что у Ponds — локальная копия (Ponds.ts не наш файл).
 */
function makeLakeGeometry(r: number): THREE.BufferGeometry {
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

/** Водопад в стене: зев в склоне + поток + озеро у подножия + ручей + пена/туман. */
export class Waterfall {
  /** Грубый счётчик добавленных мешей (proxy draw calls) — для перф-чека. */
  drawCalls = 0;
  /** Центр озера в мире (для смоука/квестов, если понадобится). */
  readonly pool: { x: number; z: number };

  /** Текстуры со скроллом UV — двигаем offset в update. */
  private fallTexA: THREE.Texture | null = null;
  private fallTexB: THREE.Texture | null = null;
  private brookTex: THREE.Texture | null = null;
  /** Озеро и его геометрия — дыхание по Y и колыхание кромки в update. */
  private lakeMesh: THREE.Mesh | null = null;
  private lakeGeo: THREE.BufferGeometry | null = null;
  private lakeBaseY = 0;
  /** Пена и туман — лёгкое всплывание/пульсация. */
  private foam: THREE.InstancedMesh | null = null;
  private mist: THREE.Sprite[] = [];
  private mistBaseY: number[] = [];
  private elapsed = 0;

  constructor() {
    const lp = lakePlacement();
    this.pool = { x: lp.x, z: lp.z };
  }

  async build(
    scene: THREE.Scene,
    assets: AssetLoader,
    terrain: Terrain,
    pondCenters: { x: number; z: number; r: number }[],
    physics?: PhysicsWorld,
  ): Promise<void> {
    const cx = WATERFALL.x;
    const cz = WATERFALL.z;
    // Уровень озера — высота склона у подножия (трог стены). Поток падает сюда.
    const groundY = terrain.height(cx, cz);

    // Озеро у подножия — центр сдвинут к стене, отшельник остаётся на берегу.
    const lake = lakePlacement();

    // Орт «вглубь стены» (к зеву): от WATERFALL к MOUTH (к −x, в гору). Фронт зева и
    // поток смотрят НАРУЖУ к озеру/игроку (−inDir).
    const inDx = MOUTH.x - cx;
    const inDz = MOUTH.z - cz;
    const inLen = Math.hypot(inDx, inDz) || 1;
    const inX = inDx / inLen;
    const inZ = inDz / inLen;
    // Фронт (нормаль +Z меша) смотрит наружу = вдоль −in.
    const faceYaw = Math.atan2(-inX, -inZ);
    // fwd для совместимости со старым кодом потока: «вперёд к стене» = вдоль in.
    const fwdX = inX;
    const fwdZ = inZ;

    // --- Зев врезан в склон горной стены (порода = гора + утопленные блоки) ---
    await this.buildMouth(scene, assets, terrain, physics, inX, inZ, faceYaw, groundY);

    // --- Падающий поток: две перекрывающиеся плоскости со скроллом UV ---
    this.buildStream(scene, cx, cz, fwdX, fwdZ, groundY);

    // --- Озеро у подножия: диск воды в стиле прудов ---
    this.buildLake(scene, lake, groundY);

    // --- Ручей: узкая водная лента от озера к ближайшему пруду ---
    this.buildBrook(scene, terrain, lake, faceYaw, pondCenters);

    // --- Пена и туман у подножия потока ---
    this.buildFoam(scene, cx, cz, groundY);
    this.buildMist(scene, cx, cz, groundY);
  }

  /** bbox зева в мире — заполняется в buildMouth, читается buildStream. */
  private grotBox: THREE.Box3 | null = null;

  /**
   * Зев водопада, ВРЕЗАННЫЙ в склон горной стены (по образцу пещеры паркура): на точке
   * MOUTH (вглубь стены, где терраин поднялся на +12–16 м) ставим cliff_blockcave_stone,
   * фронтом наружу к озеру, утопленным в склон (низ блока ниже линии склона, основная
   * масса торчит из горы). За зевом — тёмная полусфера (BackSide): читается дыра, из
   * которой бьёт вода. По бокам зева в склон утоплены 2 крупных rock_large* — порода
   * читается одним массивом стены, а не коробкой. Блокам — кубоид-коллайдеры по bbox.
   * Никакого отдельно стоящего амфитеатра: вся «скала» — это сам горный вал.
   */
  private async buildMouth(
    scene: THREE.Scene,
    assets: AssetLoader,
    terrain: Terrain,
    physics: PhysicsWorld | undefined,
    inX: number,
    inZ: number,
    faceYaw: number,
    groundY: number,
  ): Promise<void> {
    // Тёплый серый: клонируем материалы модели (НЕ мутируя кэш AssetLoader — clone()
    // делит инстансы материалов с GLB) и стягиваем lerp-ом к общему скальному тону —
    // врезанные блоки сливаются со склоном вала, а не «холодная коробка / песок».
    const warmGrey = (obj: THREE.Object3D): void => {
      const seen = new Set<THREE.Material>();
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const tint = (src: THREE.Material): THREE.Material => {
          const cl = src.clone();
          const col = (cl as THREE.MeshStandardMaterial).color;
          if (col && !seen.has(cl)) {
            col.lerp(new THREE.Color(0x8a8378), 0.6);
            seen.add(cl);
          }
          return cl;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
      });
    };

    // Боковые орты фронта зева (вдоль стены), для расстановки фланговых валунов.
    const sx = Math.cos(faceYaw + Math.PI / 2);
    const sz = Math.sin(faceYaw + Math.PI / 2);

    // place: ставит cliff/rock-ассет, тонирует, врезает в склон (низ меша ниже линии
    // террейна на sink), опц. кубоид-коллайдер. Возвращает мировой bbox.
    const place = async (
      path: string,
      x: number,
      z: number,
      footprint: number,
      sink: number,
      yaw: number,
      collide: boolean,
    ): Promise<{ obj: THREE.Object3D; box: THREE.Box3 } | null> => {
      let gltf;
      try {
        gltf = await assets.model(path);
      } catch {
        console.warn(`[waterfall] модель скалы не загрузилась: ${path}`);
        return null;
      }
      const obj = gltf.scene.clone();
      warmGrey(obj);
      obj.scale.setScalar(scaleToFootprint(obj, footprint));
      obj.position.set(x, 0, z);
      obj.rotation.y = yaw;
      const gy = terrain.height(x, z);
      let box = bboxOf(obj);
      // Врезаем в склон: верх меша поднят, но блок утоплен в гору на sink (часть массы
      // ниже линии террейна — блок «растёт из» склона, а не стоит коробкой на нём).
      obj.position.y = gy - box.min.y - sink;
      enableShadows(obj);
      scene.add(obj);
      this.drawCalls++;
      box = bboxOf(obj);
      if (collide && physics) {
        const size = box.getSize(new THREE.Vector3());
        const c = box.getCenter(new THREE.Vector3());
        const hx = Math.max(0.3, size.x * 0.42);
        const hy = Math.max(0.3, size.y * 0.5);
        const hz = Math.max(0.3, size.z * 0.42);
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setTranslation(c.x, c.y, c.z)
            .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
        );
      }
      return { obj, box };
    };

    const C = '/assets/world/nature/';

    // --- Зев грота: cliff_blockcave_stone на точке MOUTH, врезан в склон, фронт наружу.
    // Ставим ПЕРВЫМ — его фактический bbox задаёт привязку потока (верх струи у зева).
    // sink=1.2: низ блока ниже линии склона, тёмная ниша торчит из горы выше уровня озера.
    const grot = await place(`${C}cliff_blockcave_stone.glb`, MOUTH.x, MOUTH.z, 9, 1.2, faceYaw, true);
    this.grotBox = grot ? grot.box : null;
    this.buildGrotInterior(scene, grot ? grot.obj : null, MOUTH.x, MOUTH.z, inX, inZ, faceYaw, groundY);

    // --- Фланги зева: 2 крупных rock_large* утоплены в склон по бокам от зева, чуть
    // ниже (порода обнимает дыру и сливается со стеной). Сдвинуты вдоль стены (±s) и
    // чуть наружу к озеру — закрывают стык блока со склоном со смотровой стороны.
    await place(`${C}rock_largee.glb`, MOUTH.x + sx * 4.6 - inX * 1.0, MOUTH.z + sz * 4.6 - inZ * 1.0, 11, 2.0, faceYaw + 0.5, true);
    await place(`${C}rock_largef.glb`, MOUTH.x - sx * 4.8 - inX * 0.8, MOUTH.z - sz * 4.8 - inZ * 0.8, 12, 2.4, faceYaw - 0.7, true);
    // --- Валуны у кромки озера (подножие стены): натуральный переход скала→вода. ---
    await place(`${C}rock_largec.glb`, WATERFALL.x + sx * 4.4, WATERFALL.z + sz * 4.4, 3.4, 0, faceYaw + 0.6, true);
    await place(`${C}rock_larged.glb`, WATERFALL.x - sx * 4.6, WATERFALL.z - sz * 4.6, 3.0, 0, faceYaw + 1.2, true);
  }

  /**
   * Чернота пещеры за зевом: тёмная полусфера, вогнутой стороной к игроку (BackSide) —
   * читается дыра в скале, из которой бьёт вода. Привязана к фактическому bbox cave-блока
   * (центр зева по XZ, верхняя треть высоты блока), чуть утоплена вглубь стены.
   */
  private buildGrotInterior(
    scene: THREE.Scene,
    grot: THREE.Object3D | null,
    mx: number,
    mz: number,
    inX: number,
    inZ: number,
    faceYaw: number,
    groundY: number,
  ): void {
    // Зев — у верхней трети cave-блока (фактический bbox), иначе фолбэк по высотам.
    let mouthY: number;
    if (this.grotBox) {
      const size = this.grotBox.getSize(new THREE.Vector3());
      mouthY = this.grotBox.min.y + size.y * 0.62;
    } else if (grot) {
      mouthY = grot.position.y + 4;
    } else {
      mouthY = groundY + FALL_HEIGHT_FALLBACK;
    }
    // Ниша чуть позади фронта зева, утоплена вглубь стены (вдоль in).
    const back = 1.5;
    const gx = mx + inX * back;
    const gz = mz + inZ * back;
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x05080a, fog: true, side: THREE.BackSide });
    const cave = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), darkMat);
    cave.scale.set(1.15, 1.35, 1);
    cave.rotation.x = Math.PI; // чашей вперёд/вверх к зеву
    cave.position.set(gx, mouthY, gz);
    cave.rotation.y = faceYaw;
    scene.add(cave);
    this.drawCalls++;
  }

  /**
   * Трапециевидная «лента» потока в плоскости XY локального меша: верх шириной wTop,
   * низ — wBot, высота h. Геометрия центрирована по X, низ в y=0, верх в y=h. UV по
   * высоте (v растёт книзу → скролл вниз = падение). Низ слегка вынесен вперёд по +z
   * (в локальных координатах) для наклона потока от стены.
   */
  private static streamGeometry(wTop: number, wBot: number, h: number, leanZ: number): THREE.BufferGeometry {
    const ht = wTop * 0.5;
    const hb = wBot * 0.5;
    // 4 вершины: низ-лево, низ-право, верх-право, верх-лево.
    const positions = new Float32Array([
      -hb, 0, leanZ, // 0 низ-лево (вынесен вперёд на leanZ)
      hb, 0, leanZ, // 1 низ-право
      ht, h, 0, // 2 верх-право (у стены)
      -ht, h, 0, // 3 верх-лево
    ]);
    const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Поток из зева: две перекрывающиеся вертикальные трапеции со скроллом UV (разные
   * скорости/прозрачность). Верх привязан к фактическому зеву (bbox cave-блока), низ —
   * к поверхности озера у подножия (WATERFALL). Падение почти вертикальное у самой
   * стены: XZ-якорь меша — у подножия (WATERFALL), низ слегка вынесен наружу к озеру.
   */
  private buildStream(
    scene: THREE.Scene,
    cx: number,
    cz: number,
    fwdX: number,
    fwdZ: number,
    groundY: number,
  ): void {
    this.fallTexA = makeWaterTexture(0);
    this.fallTexA.repeat.set(1, 3);
    this.fallTexB = makeWaterTexture(5);
    this.fallTexB.repeat.set(1, 4);

    const mkMat = (tex: THREE.Texture, opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: true,
      });

    // Низ потока — поверхность озера у подножия; верх — у зева грота. Высоту берём из
    // фактического bbox cave-блока (зев на ~0.62 высоты блока), иначе фолбэк.
    const lakeSurfaceY = groundY + 0.06;
    const botY = lakeSurfaceY;
    let topY: number;
    if (this.grotBox) {
      const size = this.grotBox.getSize(new THREE.Vector3());
      topY = this.grotBox.min.y + size.y * 0.62;
    } else {
      topY = groundY + FALL_HEIGHT_FALLBACK;
    }
    const h = Math.max(2, topY - botY);

    // Якорь меша — у подножия стены (WATERFALL), чуть выдвинут наружу к озеру (по −fwd),
    // чтобы струя падала в воду, а не в склон. Верх уходит к зеву (по +fwd, в стену).
    const px = cx - fwdX * (STREAM_W * 0.5 + 0.4);
    const pz = cz - fwdZ * (STREAM_W * 0.5 + 0.4);
    // Ориентация: фронт плоскости (нормаль = +Z) смотрит на игрока (наружу, −fwd).
    // +leanZ выносит низ наружу — лёгкий наклон потока ~6° от стены.
    const lean = Math.tan((6 * Math.PI) / 180) * h;
    const rotY = Math.atan2(-fwdX, -fwdZ);

    // Трапеция A — основная: верх ~2.2, низ ~3.2.
    const geoA = Waterfall.streamGeometry(STREAM_W * 0.92, STREAM_W * 1.33, h, lean);
    const planeA = new THREE.Mesh(geoA, mkMat(this.fallTexA, 0.8));
    planeA.position.set(px, botY, pz);
    planeA.rotation.y = rotY;
    scene.add(planeA);
    this.drawCalls++;

    // Трапеция B — поверх, чуть уже вверху и прозрачнее, выдвинута на полметра наружу,
    // быстрее скроллит (иллюзия расходящегося потока).
    const geoB = Waterfall.streamGeometry(STREAM_W * 0.78, STREAM_W * 1.42, h * 0.97, lean * 1.1);
    const planeB = new THREE.Mesh(geoB, mkMat(this.fallTexB, 0.55));
    planeB.position.set(px - fwdX * 0.4, botY, pz - fwdZ * 0.4);
    planeB.rotation.y = rotY;
    planeB.renderOrder = 1;
    scene.add(planeB);
    this.drawCalls++;
  }

  /** Озеро: диск воды со стилем прудов (vertex-color глубина + кромка). */
  private buildLake(scene: THREE.Scene, lake: { x: number; z: number; r: number }, groundY: number): void {
    this.lakeGeo = makeLakeGeometry(lake.r);
    const lakeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      roughness: 0.12,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const water = new THREE.Mesh(this.lakeGeo, lakeMat);
    this.lakeBaseY = groundY + 0.06;
    water.position.set(lake.x, this.lakeBaseY, lake.z);
    water.receiveShadow = false;
    water.renderOrder = 1;
    scene.add(water);
    this.lakeMesh = water;
    this.drawCalls++;

    // Светлая отмель по кромке — тонкое кольцо (приятный переход вместо края).
    const shoreGeo = new THREE.RingGeometry(lake.r - 0.7, lake.r + 0.4, RIM_SEG);
    shoreGeo.rotateX(-Math.PI / 2);
    const shoreMat = new THREE.MeshBasicMaterial({
      color: 0x9fd3da,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shore = new THREE.Mesh(shoreGeo, shoreMat);
    shore.position.set(lake.x, this.lakeBaseY - 0.02, lake.z);
    shore.receiveShadow = false;
    scene.add(shore);
    this.drawCalls++;
  }

  /** Узкая водная лента-меш от озера к ближайшему пруду (или короткий «сток»). */
  private buildBrook(
    scene: THREE.Scene,
    terrain: Terrain,
    lake: { x: number; z: number; r: number },
    faceYaw: number,
    pondCenters: { x: number; z: number; r: number }[],
  ): void {
    const cx = lake.x;
    const cz = lake.z;
    const POOL_R = lake.r;
    // Цель ручья — ближайший пруд (если есть и не дальше BROOK_MAX_LEN); иначе
    // короткий сток по направлению фронта водопада (faceYaw, наружу к центру карты).
    let tx = cx + Math.cos(faceYaw) * 24;
    let tz = cz + Math.sin(faceYaw) * 24;
    let nearest: { x: number; z: number; r: number } | null = null;
    let bestD = BROOK_MAX_LEN;
    for (const p of pondCenters) {
      const d = Math.hypot(p.x - cx, p.z - cz);
      if (d < bestD) {
        bestD = d;
        nearest = p;
      }
    }
    if (nearest) {
      // Тянем до кромки пруда (не до центра — иначе лента ушла бы под воду).
      const a = Math.atan2(nearest.z - cz, nearest.x - cx);
      tx = nearest.x - Math.cos(a) * nearest.r;
      tz = nearest.z - Math.sin(a) * nearest.r;
    }

    const baseA = Math.atan2(tz - cz, tx - cx);
    const ax = POOL_R * Math.cos(baseA);
    const az = POOL_R * Math.sin(baseA);
    const startX = cx + ax;
    const startZ = cz + az;
    const baseLen = Math.hypot(tx - startX, tz - startZ);
    if (baseLen < 2) return; // пруд почти вплотную — ручей не нужен

    // Извилистый ручей: прямая база start→target + поперечное синус-смещение
    // (1–2 плавных изгиба). Амплитуда растёт к середине и гаснет у концов (envelope
    // sin(pi·t)), чтобы исток/устье попадали точно в озеро и кромку пруда.
    const dirBaseX = (tx - startX) / baseLen;
    const dirBaseZ = (tz - startZ) / baseLen;
    const perpBaseX = -dirBaseZ; // нормаль к базе (влево)
    const perpBaseZ = dirBaseX;
    const bends = baseLen > 60 ? 2 : 1; // длинный ручей — два изгиба
    const amp = Math.min(7, baseLen * 0.12); // изгиб ≤ 7 м, скромный
    // Центральная линия как функция t: точка base(t) + perp · offset(t).
    const centerX = (t: number): number =>
      startX + dirBaseX * baseLen * t + perpBaseX * amp * Math.sin(Math.PI * t) * Math.sin(bends * Math.PI * t);
    const centerZ = (t: number): number =>
      startZ + dirBaseZ * baseLen * t + perpBaseZ * amp * Math.sin(Math.PI * t) * Math.sin(bends * Math.PI * t);

    // Лента из сегментов: ширину откладываем по локальной нормали (касательная по
    // конечной разности), чтобы изгибы не «схлопывали» русло.
    const segs = Math.max(6, Math.round(baseLen / 4));
    const half = BROOK_W * 0.5;
    const positions = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    let arcLen = 0;
    let prevX = centerX(0);
    let prevZ = centerZ(0);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const px = centerX(t);
      const pz = centerZ(t);
      if (i > 0) arcLen += Math.hypot(px - prevX, pz - prevZ);
      prevX = px;
      prevZ = pz;
      // Локальная касательная (вперёд/назад по кривой) → нормаль для ширины.
      const tf = Math.min(1, t + 1 / segs);
      const tb = Math.max(0, t - 1 / segs);
      const tanX = centerX(tf) - centerX(tb);
      const tanZ = centerZ(tf) - centerZ(tb);
      const tl = Math.hypot(tanX, tanZ) || 1;
      const perpX = -tanZ / tl;
      const perpZ = tanX / tl;
      const y = terrain.height(px, pz) + 0.05;
      const lx = px + perpX * half;
      const lz = pz + perpZ * half;
      const rx = px - perpX * half;
      const rz = pz - perpZ * half;
      const o = i * 2 * 3;
      positions[o] = lx; positions[o + 1] = y; positions[o + 2] = lz;
      positions[o + 3] = rx; positions[o + 4] = y; positions[o + 5] = rz;
      const uo = i * 2 * 2;
      const v = arcLen / BROOK_W; // UV по фактической длине дуги — течение ровное
      uvs[uo] = 0; uvs[uo + 1] = v;
      uvs[uo + 2] = 1; uvs[uo + 3] = v;
    }
    const indices: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = i * 2;
      const b0 = i * 2 + 1;
      const a1 = (i + 1) * 2;
      const b1 = (i + 1) * 2 + 1;
      indices.push(a0, b0, a1, b0, b1, a1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    this.brookTex = makeBrookTexture();
    this.brookTex.repeat.set(1, 1);
    const brookMat = new THREE.MeshBasicMaterial({
      map: this.brookTex,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: true,
    });
    const brook = new THREE.Mesh(geo, brookMat);
    brook.renderOrder = 1;
    scene.add(brook);
    this.drawCalls++;
  }

  /**
   * Облако пены у подножия потока: 22 мелкие белые «капли» кольцом вокруг точки
   * падения (InstancedMesh — 1 draw call), лёгкое «дыхание» в update.
   */
  private buildFoam(scene: THREE.Scene, cx: number, cz: number, groundY: number): void {
    const geo = new THREE.SphereGeometry(0.13, 6, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xeef7ff, transparent: true, opacity: 0.78, fog: true });
    const count = 22;
    const foam = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 0.4 + 2.0 * (((i * 7) % 5) / 5);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = groundY + 0.1 + (((i * 3) % 4) / 4) * 0.25; // разброс высоты — клубится
      m.makeTranslation(x, y, z);
      foam.setMatrixAt(i, m);
    }
    foam.instanceMatrix.needsUpdate = true;
    foam.computeBoundingSphere();
    scene.add(foam);
    this.foam = foam;
    this.drawCalls++;
  }

  /** Лёгкий туман у подножия: 2 полупрозрачных billboard-спрайта, медленно дышат. */
  private buildMist(scene: THREE.Scene, cx: number, cz: number, groundY: number): void {
    const tex = makeMistTexture();
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        fog: true,
      });
      const spr = new THREE.Sprite(mat);
      const s = 3.6 + i * 1.2;
      spr.scale.set(s, s * 0.7, 1);
      const off = i === 0 ? -0.8 : 0.8;
      const baseY = groundY + 1.3 + i * 0.6;
      spr.position.set(cx + off, baseY, cz + off * 0.5);
      spr.renderOrder = 2;
      scene.add(spr);
      this.mist.push(spr);
      this.mistBaseY.push(baseY);
      this.drawCalls++;
    }
  }

  /** Покадрово: скролл UV потока/ручья + дыхание озера/кромки + всплывание пены/тумана. */
  update(dt: number): void {
    this.elapsed += dt;
    if (this.fallTexA) this.fallTexA.offset.y = (this.fallTexA.offset.y - dt * FALL_SCROLL_A) % 1;
    if (this.fallTexB) this.fallTexB.offset.y = (this.fallTexB.offset.y - dt * FALL_SCROLL_B) % 1;
    if (this.brookTex) this.brookTex.offset.y = (this.brookTex.offset.y - dt * BROOK_SCROLL) % 1;

    // Озеро: дыхание по Y + бегущая по углу волна на кромке (как у прудов).
    if (this.lakeMesh) this.lakeMesh.position.y = this.lakeBaseY + Math.sin(this.elapsed * 1.6) * 0.03;
    if (this.lakeGeo) {
      const pos = this.lakeGeo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i <= RIM_SEG; i++) {
        const ang = (i / RIM_SEG) * Math.PI * 2;
        arr[(i + 1) * 3 + 1] = Math.sin(this.elapsed * 2.2 + ang * 3) * 0.04;
      }
      pos.needsUpdate = true;
    }

    // Пена «дышит» у подножия (один transform всей группы — дёшево).
    if (this.foam) this.foam.position.y = Math.sin(this.elapsed * 2.6) * 0.06;
    // Туман медленно всплывает и пульсирует прозрачностью.
    for (let i = 0; i < this.mist.length; i++) {
      const spr = this.mist[i]!;
      spr.position.y = this.mistBaseY[i]! + Math.sin(this.elapsed * 0.7 + i * 1.6) * 0.25;
      (spr.material as THREE.SpriteMaterial).opacity = 0.26 + 0.1 * (0.5 + 0.5 * Math.sin(this.elapsed * 0.9 + i));
    }
  }
}
