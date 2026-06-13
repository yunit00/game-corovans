import * as THREE from 'three';
import { fbm2, smoothstep } from '../sim/noise';
import type { P2 } from '../sim/geom';
import { distToPolyline } from '../sim/geom';
import { carveLakes } from '../sim/lakes';
import { roadDistance } from './WorldData';
import type { AssetLoader } from '../core/AssetLoader';
import { GROUP_STATIC, ALL_GROUPS, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';

/**
 * Замок злодея: плато в юго-восточном горном кольце +
 * серпантин-тропа от подножия к нему. Всё детерминировано константами ниже —
 * никаких случайных источников. Геометрия террейна (плато/тропа) подмешивается в
 * Terrain.height() поверх базового рельефа, heightfield-коллайдер сэмплирует ту же
 * height() и подхватывает изменения. VillainCastle.ts ставит здания по этим же
 * константам, поэтому экспортируем их.
 */
export const CASTLE = {
  /** Центр плато (cheb-d=445 — внутри вала smoothstep 425→498). */
  cx: 445,
  cz: 360,
  /** Радиус ровной площадки плато, м (полный спад склона за ~+12 м). */
  plateauR: 36,
  /** Прибавка к высоте вала в центре плато — приподнятая цитадель, м. */
  plateauLift: 4,
  /** Полуширина серпантин-тропы (ровный коридор), м (полоса ~7 м). */
  trailHalf: 3.5,
  /**
   * Серпантин: зигзаг от подножия (≈(372,338), рядом с лагерем (330,350)) до
   * входа на плато (центр). Высота вдоль тропы — монотонный лерп долина→плато по
   * доле длины дуги; уклон держим ≤ 25° длиной зигзага. Детерминирован константами.
   */
  trail: [
    { x: 372, z: 338 }, // подножие у лагеря злодея
    { x: 398, z: 352 },
    { x: 420, z: 337 },
    { x: 434, z: 357 },
    { x: 445, z: 360 }, // вход на плато (центр)
  ] as readonly P2[],
} as const;

/**
 * Холмы на пустых полянах: гауссовы бугры
 * h = H·exp(−d²/2σ²) на РЕАЛЬНО пустых местах карты (проверено инвариантами в
 * tests/world-hills-terrain.test.ts: ≥45 м от дорог, ≥70 м от деревни/дворца/
 * лагеря/водопада/прудов/POI/концов дорог, вне сектора замка, cheb<370). На
 * вершину можно забраться и осмотреться, наверху — rare-сундук. Все четыре холма
 * ПОЛОГИЕ (склон ≤ ~20°, забираться пешком): паркур-трасса вынесена со
 * «крутого» холма на скальную стену (Parkour.ts), а бывший паркур-холм (150,90)
 * стал четвёртым пологим холмом с сокровищем. Высоты подмешиваются в Terrain.height()
 * поверх базового рельефа тем же паттерном, что плато замка; heightfield-коллайдер
 * сэмплирует ту же height() и подхватывает бугры.
 */
export interface HillSpec {
  /** Метка для отладки/тестов. */
  id: string;
  /** Центр холма (вершина), м. */
  cx: number;
  cz: number;
  /** Высота вершины над базовым рельефом, м. */
  height: number;
  /** σ гауссианы, м (шире — положе). */
  sigma: number;
}

export const HILLS: readonly HillSpec[] = [
  // Пологие холмы (склон ≤ ~20°) — забираться пешком, на вершине rare-сундук.
  { id: 'nw', cx: -150, cz: -100, height: 11, sigma: 24 },
  { id: 'south', cx: -100, cz: 330, height: 10, sigma: 24 },
  { id: 'east', cx: 140, cz: -130, height: 12, sigma: 22 },
  // Бывший паркур-холм (150,90) — теперь обычный пологий (паркур ушёл на скальную стену).
  { id: 'parkour', cx: 150, cz: 90, height: 10, sigma: 24 },
] as const;

/** Холм (150,90) — экспорт для WorldData (круг расчистки леса под сундук на вершине). */
export const PARKOUR_HILL: HillSpec = HILLS.find((h) => h.id === 'parkour')!;

/**
 * Прибавка высоты от всех холмов в точке (сумма гауссиан). Чистая функция от
 * (x,z) и констант HILLS — без шума/случайности. Дешёвый ранний выход за 3.2σ
 * (вклад < 0.6% высоты): вне всех бугров возвращает 0, так что height() вдали не
 * меняется. Экспортируется отдельно — тесты сверяют «вне холмов == базовая высота».
 */
export function hillsHeight(x: number, z: number): number {
  let add = 0;
  for (const h of HILLS) {
    const dx = x - h.cx;
    const dz = z - h.cz;
    const d2 = dx * dx + dz * dz;
    const cut = 3.2 * h.sigma;
    if (d2 > cut * cut) continue;
    add += h.height * Math.exp(-d2 / (2 * h.sigma * h.sigma));
  }
  return add;
}

export interface TerrainOptions {
  size: number; // длина стороны, м
  segments: number; // сегментов на сторону
  seed: number;
  amplitude: number; // высота холмов, м
  noiseScale: number; // период шума, м
  /** Опциональная маска выравнивания: 0 → плоско (h=0), 1 → полный шум. */
  flattenMask?: (x: number, z: number) => number;
  /** Сплат-карта: дороги (грунт) и площадки. */
  splat?: { roads: P2[][]; plazas: { x: number; z: number; r: number }[]; roadWidth: number };
}

export class Terrain {
  readonly opts: TerrainOptions;
  mesh!: THREE.Mesh;

  constructor(opts: TerrainOptions) {
    this.opts = opts;
  }

  /** Высота поверхности в точке мира. Чистая функция от (x, z). */
  height(x: number, z: number): number {
    // Базовый рельеф + гауссовы холмы (пустые поляны). Холмы
    // и плато замка не пересекаются (холмы cheb<370, плато cheb=445), но плато
    // блендится поверх в castleHeight, поэтому добавляем бугры до него.
    const h = this.baseHeight(x, z) + hillsHeight(x, z);
    // Котловины озёр: врезаем чаши тем же паттерном, что холмы —
    // только ОПУСКАЕМ рельеф (carveLakes drop ≥ 0). Озёра в пустых зонах cheb<400,
    // не пересекаются ни с холмами, ни с плато замка (cheb=445), поэтому порядок
    // безопасен: чаша садится в (рельеф+холмы), плато замка блендится поверх.
    const withLakes = carveLakes(x, z, h);
    return this.castleHeight(x, z, withLakes);
  }

  /**
   * Базовый рельеф БЕЗ плато/тропы замка: шум + горное кольцо. Замковое поле
   * (castleHeight) ссылается на эту функцию (высота вала в центре плато), поэтому
   * она не должна сама звать height()/castleHeight() — иначе рекурсия.
   */
  private baseHeight(x: number, z: number): number {
    const { seed, amplitude, noiseScale, flattenMask } = this.opts;
    const n = fbm2(x / noiseScale, z / noiseScale, seed, 4);
    const mask = flattenMask ? flattenMask(x, z) : 1;
    let h = n * amplitude * mask;

    // Горное кольцо по периметру: естественная стена, через которую не выйти.
    // Чебышёвская дистанция d = max(|x|,|z|) даёт квадратное кольцо; изрезанность
    // хребта (fbm2) скругляет углы и ломает прямые линии. Вал растёт как t² —
    // склон становится круче к краю (> 55° KCC уже с d≈455, см. отчёт фазы).
    const d = Math.max(Math.abs(x), Math.abs(z));
    const t = smoothstep(425, 498, d);
    if (t > 0) {
      // У дорог горы расступаются ущельями: тракты уходят «за перевал» (корованы
      // там же деспавнятся). roadGap=0 на оси дороги → 1 в 50 м от неё.
      const roadGap = smoothstep(12, 50, roadDistance(x, z));
      const ridge = fbm2(x / 45, z / 45, seed ^ 0x9e37, 3);
      h += t * t * 95 * roadGap + t * ridge * 14 * roadGap;
    }
    return h;
  }

  /**
   * Подмешивает плато под замок и серпантин-тропу к нему (только в зоне замка,
   * вдали возвращает базовую высоту без изменений). Детерминировано константами
   * CASTLE и baseHeight — никакого собственного шума/случайности.
   *
   * Плато: ровная площадка высотой = высота вала в центре + CASTLE.plateauLift,
   * блендится по расстоянию до центра (smoothstep R→R+12). Тропа: монотонный лерп
   * высоты от долины (у подножия) к плато по доле длины дуги; коридор шириной 2·
   * trailHalf ровный, склон рядом плавно подрезается (маска расстояния до полилинии,
   * как roadGap). Плато имеет приоритет над тропой (на входе они сходятся).
   */
  private castleHeight(x: number, z: number, base: number): number {
    const C = CASTLE;
    // Дешёвый ранний выход: вне грубого радиуса влияния замка ничего не трогаем.
    const dCx = x - C.cx;
    const dCz = z - C.cz;
    const trail = C.trail;
    const farPlateau = dCx * dCx + dCz * dCz;
    const distTrail = distToPolyline({ x, z }, trail);
    const PLATEAU_OUTER = C.plateauR + 12;
    if (farPlateau > PLATEAU_OUTER * PLATEAU_OUTER && distTrail > C.trailHalf + 14) {
      return base;
    }

    // Целевая высота плато: высота вала в центре + lift (от baseHeight, без плато).
    const plateauTop = this.baseHeight(C.cx, C.cz) + C.plateauLift;
    // Высота у подножия тропы (долина) — от baseHeight в первой точке тропы.
    const foot = trail[0]!;
    const footH = this.baseHeight(foot.x, foot.z);

    let h = base;

    // --- Тропа: монотонный лерп долина→плато по доле длины дуги ---
    // Доля s∈[0,1] — проекция точки на полилинию по длине. Высота тропы растёт
    // монотонно (footH→plateauTop), что гарантирует уклон одного знака.
    const along = arcFractionAlongPolyline({ x, z }, trail);
    const trailH = footH + (plateauTop - footH) * along;
    // Коридор шириной 2·trailHalf ровный (wTrail=1), за ним плавно сходит на нет.
    const wTrail = 1 - smoothstep(C.trailHalf, C.trailHalf + 9, distTrail);
    if (wTrail > 0) h = h * (1 - wTrail) + trailH * wTrail;

    // --- Плато: ровная площадка, приоритет над тропой у входа ---
    const distPlateau = Math.sqrt(farPlateau);
    const wPlateau = 1 - smoothstep(C.plateauR, PLATEAU_OUTER, distPlateau);
    if (wPlateau > 0) h = h * (1 - wPlateau) + plateauTop * wPlateau;

    return h;
  }

  async buildMesh(assets: AssetLoader): Promise<THREE.Mesh> {
    const { size, segments } = this.opts;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.height(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();

    const repeat = size / 9;
    const [diff, nor, rough, dirt, rock] = await Promise.all([
      assets.texture('/assets/textures/grass_diff_1k.jpg', { srgb: true, repeat }),
      assets.texture('/assets/textures/grass_nor_gl_1k.jpg', { repeat }),
      assets.texture('/assets/textures/grass_rough_1k.jpg', { repeat }),
      assets.texture('/assets/textures/dirt_diff_1k.jpg', { srgb: true, repeat: 1 }),
      assets.texture('/assets/textures/rock_diff_1k.jpg', { srgb: true, repeat: 1 }),
    ]);
    const mat = new THREE.MeshStandardMaterial({
      map: diff,
      normalMap: nor,
      roughnessMap: rough,
      roughness: 1.0,
    });

    if (this.opts.splat) {
      const splatTex = this.buildSplatTexture();
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.splatMap = { value: splatTex };
        shader.uniforms.dirtMap = { value: dirt };
        shader.uniforms.rockMap = { value: rock };
        shader.uniforms.uTerrainSize = { value: this.opts.size };
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec2 vSplatUv;\nvarying float vWNy;\nuniform float uTerrainSize;',
          )
          .replace(
            '#include <uv_vertex>',
            '#include <uv_vertex>\nvSplatUv = position.xz / uTerrainSize + 0.5;\nvWNy = normal.y;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform sampler2D splatMap;\nuniform sampler2D dirtMap;\nuniform sampler2D rockMap;\nvarying vec2 vSplatUv;\nvarying float vWNy;',
          )
          .replace(
            '#include <map_fragment>',
            `
            vec3 sp = texture2D(splatMap, vSplatUv).rgb;
            float wRock = 1.0 - smoothstep(0.72, 0.86, vWNy);
            float wDirt = min(sp.g, 1.0 - wRock);
            float wGrass = max(0.0, 1.0 - wRock - wDirt);
            vec4 blended = texture2D(map, vMapUv) * wGrass
              + texture2D(dirtMap, vMapUv) * wDirt
              + texture2D(rockMap, vMapUv * 0.37) * wRock;
            diffuseColor *= blended;
            `,
          );
      };
    }

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    return this.mesh;
  }

  /** Канвас-сплат: R — трава, G — грунт (дороги/площадки). */
  private buildSplatTexture(): THREE.CanvasTexture {
    const { size, splat } = this.opts;
    const RES = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = RES;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.fillRect(0, 0, RES, RES);

    const toPx = (v: number) => (v / size + 0.5) * RES;
    ctx.strokeStyle = 'rgb(0,255,0)';
    ctx.fillStyle = 'rgb(0,255,0)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (splat!.roadWidth / size) * RES;
    for (const road of splat!.roads) {
      ctx.beginPath();
      ctx.moveTo(toPx(road[0]!.x), toPx(road[0]!.z));
      for (let i = 1; i < road.length; i++) ctx.lineTo(toPx(road[i]!.x), toPx(road[i]!.z));
      ctx.stroke();
    }
    for (const plaza of splat!.plazas) {
      ctx.beginPath();
      ctx.arc(toPx(plaza.x), toPx(plaza.z), (plaza.r / size) * RES, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false; // py = (z/size+0.5) — без переворота, совпадает с vSplatUv
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /** Heightfield-коллайдер на весь террейн (один статический body). */
  buildCollider(physics: PhysicsWorld): void {
    const { size, segments } = this.opts;
    const n = segments;
    const heights = new Float32Array((n + 1) * (n + 1));
    // column-major: колонка i — вдоль x, строка j — вдоль z
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const x = (i / n - 0.5) * size;
        const z = (j / n - 0.5) * size;
        heights[i * (n + 1) + j] = this.height(x, z);
      }
    }
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size })
      .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS));
    physics.world.createCollider(desc, body);

    // Невидимые стены — запасной барьер по периметру (|x|=497 / |z|=497):
    // горный вал держит игрока физически, но у дорожных ущелий горы расступаются,
    // а на крутом скальном меше KCC иногда «прокарабкивается» — стены гарантируют,
    // что за край мира выйти нельзя. Высота 200 перекрывает любой склон.
    const wallBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const wallPos = 497;
    const wallH = 100; // half-height (cuboid задаётся полу-размерами)
    const wallT = 1; // half-толщина 1 → стена 2 м
    const wallHalf = size / 2;
    const wallDescs: [number, number, number, number, number, number][] = [
      // [hx, hy, hz, x, y, z]
      [wallHalf, wallH, wallT, 0, 0, wallPos], // +z
      [wallHalf, wallH, wallT, 0, 0, -wallPos], // -z
      [wallT, wallH, wallHalf, wallPos, 0, 0], // +x
      [wallT, wallH, wallHalf, -wallPos, 0, 0], // -x
    ];
    for (const [hx, hy, hz, px, py, pz] of wallDescs) {
      const wd = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(px, py, pz)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS));
      physics.world.createCollider(wd, wallBody);
    }
  }
}

/**
 * Доля длины дуги полилинии до точки-проекции p (ближайший сегмент + положение на
 * нём). Возвращает s∈[0,1] — 0 в начале полилинии, 1 в конце. Используется для
 * монотонного лерпа высоты вдоль серпантина: т.к. s растёт монотонно вдоль тропы,
 * лерп footH→plateauTop тоже монотонен, а значит уклон одного знака. Чистая функция.
 */
function arcFractionAlongPolyline(p: P2, pts: readonly P2[]): number {
  // Кумулятивная длина начала каждого сегмента + полная длина.
  let total = 0;
  const segLen: number[] = [];
  const cum: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    cum.push(total);
    const l = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.z - pts[i]!.z);
    segLen.push(l);
    total += l;
  }
  if (total === 0) return 0;

  let bestD2 = Infinity;
  let bestArc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
    const dx = p.x - (a.x + abx * t);
    const dz = p.z - (a.z + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestArc = cum[i]! + segLen[i]! * t;
    }
  }
  return bestArc / total;
}
