// Скальная паркур-трасса на ГОРНОЙ СТЕНЕ. Ящики поверх холма отвергнуты — «коробки,
// на холм и так можно зайти». Концепт:
// ЕСТЕСТВЕННЫЕ скальные выступы, врезанные в склон горного вала у западного края
// карты; по ним игрок зигзагом допрыгивает до ПЕЩЕРЫ в середине скалы и забирает приз.
//
// Подножие ANCHOR выбрано на западной стене детерминированно (см. ANCHOR ниже):
// cheb=428 — у начала вала smoothstep(425→498), вдали от водопада/пирса/прудов/дорог/
// дворца/концов дорог и вне сектора замка (инварианты закреплены тестом
// tests/world-parkour.test.ts). Трасса уходит ВГЛУБЬ стены (к −x, где вал растёт) и
// зигзагом по z поднимается полками; в конце — пещера-карман с epic-сундуком.
//
// Раскладка (planRockRoute) — чистая функция от высоты террейна и констант: детермини-
// рована, node-тестируема на инварианты достижимости (первая полка ≤1.2, каждый шаг
// Δh ≤2.2 и горизонталь ≤3.4, монотонный набор высоты). Сборка сцены (build) — по
// образцу Waterfall: cliff/rock-ассеты, тонированные в тёплый серый (clone материалов,
// кэш AssetLoader не трогаем), врезанные в склон + кубоид-коллайдеры по верхней грани.
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import type { Terrain } from './Terrain';

/**
 * Подножие скальной трассы (старт с земли). Западная стена, cheb=428 — у начала вала
 * (Terrain поднимает гору при cheb>425). Инварианты места (закреплены тестом):
 * ≥60 м от водопада(-438,300)/пирса(-295,43)/прудов/концов дорог/дворца, ≥45 м от
 * полилиний дорог, вне сектора замка (НЕ x>360&&z>300), cheb 415-435. Сид-независимо. */
export const ANCHOR = { x: -428, z: -40 } as const;

/** Точка сундука/пещеры на стене: terrain.height(CHEST) = пол кармана пещеры (см. ниже).
 *  Выбрана вглубь стены от подножия (к −x), где вал поднялся до ~+7.6 м — пещера врезана
 *  в склон (высота стены у зева ≥ пол+4). XZ совпадает с последней «полкой»-карманом. */
export const CAVE_CHEST = { x: -456, z: -40 } as const;

/** Число точек трассы: ledge-полки + финальный карман пещеры (последняя точка). */
export const LEDGE_COUNT = 11;
/** Подъём первой полки над землёй у подножия, м (достижима с земли, ≤1.2). */
const FIRST_UP = 1.1;
/** Амплитуда зигзага по z (вдоль стены), м. */
const ZIGZAG_AMP = 1.8;
/** Частота зигзага: число полупериодов синуса вдоль трассы. */
const ZIGZAG_FREQ = 2.5;
/** Минимальный шаг вверх между полками (монотонность лесенки), м. */
const MIN_STEP_UP = 0.05;
/** Глубина зева пещеры за карманом (зев врезан вглубь стены от пола), м. */
const CAVE_MOUTH_DEPTH = 3;
/** Подъём пола пещеры над склоном в точке кармана, м (карман чуть приподнят). */
const CAVE_FLOOR_LIFT = 0.0;

/** GLB-ассеты скальных выступов (Kenny rock_large*) — чередуем по индексу. */
const LEDGE_ASSETS = [
  '/assets/world/nature/rock_largec.glb',
  '/assets/world/nature/rock_larged.glb',
  '/assets/world/nature/rock_largee.glb',
  '/assets/world/nature/rock_largef.glb',
] as const;

/** Зев пещеры. */
const CAVE_ASSET = '/assets/world/nature/cliff_blockcave_stone.glb';
/** Факел у входа в пещеру. */
const TORCH_ASSET = '/assets/props/torch_lit.glb';

/** Footprint (ширина в плане) скального выступа, м — полка ≥1.4 м для удобной стойки. */
const LEDGE_FOOTPRINT = 3.6;

/** Одна точка трассы: полка-выступ (или финальный карман пещеры). */
export interface RockLedge {
  /** Индекс по порядку подъёма (0 — стартовая с земли, последняя — карман пещеры). */
  index: number;
  x: number;
  z: number;
  /** Высота склона (террейн) под полкой, м. */
  groundY: number;
  /** Высота ВЕРХНЕЙ грани полки (куда встаёт игрок), м. */
  topY: number;
  /** true — финальный карман пещеры (там сундук, не выступ). */
  isCave: boolean;
}

/**
 * Разложить точки скальной трассы. heightAt — функция высоты террейна (горный вал).
 * Трасса идёт от ANCHOR (подножие) ВГЛУБЬ стены к CAVE_CHEST (карман пещеры), полки
 * поднимаются линейным лерпом footY+FIRST_UP → floorY (пол пещеры = высота склона в
 * точке CAVE_CHEST), зигзаг по z. Лесенка принудительно монотонна вверх (≥ MIN_STEP_UP).
 * Чистая функция (детерминирована константами + heightAt).
 *
 * Инварианты (проверяются тестом): первая полка достижима с земли (top−ground ≤ 1.2),
 * каждый следующий шаг top−top ≤ 2.2 И горизонталь ≤ 3.4, монотонный набор высоты,
 * последняя точка — карман пещеры на высоте склона CAVE_CHEST.
 */
export function planRockRoute(heightAt: (x: number, z: number) => number): RockLedge[] {
  const N = LEDGE_COUNT;
  const footY = heightAt(ANCHOR.x, ANCHOR.z);
  const floorY = heightAt(CAVE_CHEST.x, CAVE_CHEST.z) + CAVE_FLOOR_LIFT;
  const startTop = footY + FIRST_UP;
  const totalInX = ANCHOR.x - CAVE_CHEST.x; // знак: к −x (вглубь стены)
  const ledges: RockLedge[] = [];
  let prevTop = -Infinity;
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    const last = i === N - 1;
    // X уходит вглубь стены линейно; последняя точка точно в CAVE_CHEST.
    const x = ANCHOR.x - totalInX * f;
    // Зигзаг по z (вдоль стены); карман — точно в CAVE_CHEST.z (вход без бокового сдвига).
    const z = last ? CAVE_CHEST.z : ANCHOR.z + ZIGZAG_AMP * Math.sin(f * Math.PI * ZIGZAG_FREQ);
    const groundY = heightAt(x, z);
    // Верх: первая полка над своим склоном, последняя — пол пещеры, остальные — лерп.
    let topY = i === 0 ? groundY + FIRST_UP : last ? floorY : startTop + (floorY - startTop) * f;
    // Монотонность лесенки: не ниже предыдущей полки (иначе шаг «вниз»).
    if (topY < prevTop + MIN_STEP_UP) topY = prevTop + MIN_STEP_UP;
    prevTop = topY;
    ledges.push({ index: i, x, z, groundY, topY, isCave: last });
  }
  return ledges;
}

/** Координаты сундука внутри пещеры (для призового epic-сундука в Game.ts), м. */
export function caveChest(): { x: number; z: number } {
  return { x: CAVE_CHEST.x, z: CAVE_CHEST.z };
}

/** Скальная паркур-трасса в мире: выступы + пещера-карман + коллайдеры. */
export class Parkour {
  /**
   * Построить трассу: на каждой полке — масштабированный rock_large* GLB (тонированный
   * в тёплый серый), врезанный в склон, и кубоид-коллайдер по ВЕРХНЕЙ грани (игрок стоит
   * на topY). Финальная точка — пещера: зев cliff_blockcave_stone врезан вглубь стены,
   * внутри тёмная полусфера + ровный карман-пол (коллайдер), у входа 2 факела.
   * Возвращает раскладку (для смоук-телепортов).
   */
  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
  ): Promise<RockLedge[]> {
    const ledges = planRockRoute((x, z) => terrain.height(x, z));
    for (const ledge of ledges) {
      if (ledge.isCave) {
        await this.buildCave(scene, physics, assets, terrain, ledge);
      } else {
        await this.placeLedge(scene, physics, assets, ledge);
      }
    }
    return ledges;
  }

  /**
   * Тонировка породы в общий тёплый скальный серый (как в Waterfall): клонируем
   * материалы модели (НЕ мутируя кэш AssetLoader — clone() делит инстансы с GLB) и
   * стягиваем цвет lerp-ом к 0x8a8378. rock_large* у Кенни ПЕСОЧНЫЕ — без тонировки
   * были бы жёлтыми пятнами на сером вале.
   */
  private warmGrey(obj: THREE.Object3D): void {
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
  }

  /**
   * Поставить одну скальную полку: rock_large* масштабируется до footprint, тонируется
   * в тёплый серый, ВРЕЗАЕТСЯ в склон (большая часть камня утоплена в гору — низ меша
   * уходит на 2.2 м ниже склона), верх меша поднимается на topY. Коллайдер — узкий
   * кубоид по верхней грани (полка ≥1.4 м в плане, игрок надёжно встаёт на top).
   */
  private async placeLedge(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    ledge: RockLedge,
  ): Promise<void> {
    let gltf;
    try {
      gltf = await assets.model(LEDGE_ASSETS[ledge.index % LEDGE_ASSETS.length]!);
    } catch {
      console.warn('[parkour] выступ не загрузился, фоллбэк-куб');
      this.placeFallback(scene, physics, ledge);
      return;
    }
    const obj = gltf.scene.clone();
    this.warmGrey(obj);
    obj.scale.setScalar(scaleToFootprint(obj, LEDGE_FOOTPRINT));
    // Лёгкий детерминированный разворот — камни не выглядят штампованными.
    obj.rotation.y = ledge.index * 1.31;
    obj.position.set(ledge.x, 0, ledge.z);
    const box0 = bboxOf(obj);
    // Врезаем в склон: верх меша на topY (полка наружу), низ глубоко в горе.
    obj.position.y = ledge.topY - box0.max.y;
    enableShadows(obj);
    scene.add(obj);

    // Коллайдер: узкий кубоид по верхней грани (стоять на top). Полка-выступ —
    // наружу от склона на 1.5-2.5 м, ширина по XZ ≥1.4. Полная высота вниз до склона.
    const halfH = Math.max(0.6, (ledge.topY - ledge.groundY) * 0.5 + 0.4);
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, halfH, 0.9)
        .setTranslation(ledge.x, ledge.topY - halfH, ledge.z)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );
  }

  /** Каменный куб-заглушка, если rock GLB не загрузился: верх на topY, есть коллайдер. */
  private placeFallback(scene: THREE.Scene, physics: PhysicsWorld, ledge: RockLedge): void {
    const h = Math.max(0.5, ledge.topY - ledge.groundY + 1.2);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, h, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95 }),
    );
    mesh.position.set(ledge.x, ledge.topY - h / 2, ledge.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, h / 2, 0.9)
        .setTranslation(ledge.x, ledge.topY - h / 2, ledge.z)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );
  }

  /**
   * Пещера в середине скалы (~+15 м над подножием): зев cliff_blockcave_stone
   * (тонированный, врезан вглубь стены на CAVE_MOUTH_DEPTH), внутри тёмная полусфера
   * BackSide (как грот водопада) + ровный карман-пол (коллайдер) глубиной ~3-4 м;
   * у входа 2 факела torch_lit + тёплый свет — приметно издалека. Сундук (epic)
   * ставит Game.ts по caveChest() — он сядет на пол кармана (terrain.height = floorY).
   */
  private async buildCave(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    lip: RockLedge,
  ): Promise<void> {
    const floorY = lip.topY; // пол кармана = высота склона в точке CAVE_CHEST
    // Орт «вглубь стены» (к −x от подножия): зев и чернота врезаются туда.
    const inDx = Math.sign(CAVE_CHEST.x - ANCHOR.x) || -1;
    // Фронт зева смотрит НАРУЖУ (к игроку, +x): yaw так, чтобы +Z меша смотрел на +x.
    const faceYaw = Math.atan2(-inDx, 0); // нормаль (+Z) вдоль −in = наружу

    // --- Зев пещеры: cliff_blockcave_stone, врезан вглубь стены, приподнят над полом ---
    const mouthX = CAVE_CHEST.x + inDx * CAVE_MOUTH_DEPTH;
    const mouthZ = CAVE_CHEST.z;
    let mouthY = floorY + 2.2; // ориентир центра зева (фолбэк)
    try {
      const gltf = await assets.model(CAVE_ASSET);
      const obj = gltf.scene.clone();
      this.warmGrey(obj);
      obj.scale.setScalar(scaleToFootprint(obj, 9));
      obj.rotation.y = faceYaw;
      obj.position.set(mouthX, 0, mouthZ);
      const box0 = bboxOf(obj);
      // Зев приподнят: низ блока чуть ниже пола кармана, основная масса над полом.
      obj.position.y = floorY - box0.min.y - 1.0;
      enableShadows(obj);
      scene.add(obj);
      const box = bboxOf(obj);
      mouthY = box.min.y + box.getSize(new THREE.Vector3()).y * 0.45;
      // Коллайдер-стена за зевом (по bbox с усадкой) — спина пещеры непроходима.
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(
          Math.max(0.4, size.x * 0.42),
          Math.max(0.4, size.y * 0.5),
          Math.max(0.4, size.z * 0.42),
        )
          .setTranslation(c.x - inDx * 0.6, c.y, c.z)
          .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
      );
    } catch {
      console.warn('[parkour] зев пещеры не загрузился');
    }

    // --- Чернота пещеры: тёмная полусфера BackSide (вогнутой стороной к игроку) ---
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x05080a, fog: true, side: THREE.BackSide });
    const cave = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
      darkMat,
    );
    cave.scale.set(1.2, 1.3, 1.2);
    cave.rotation.x = Math.PI; // чашей наружу/вверх к зеву
    cave.rotation.y = faceYaw;
    cave.position.set(mouthX, mouthY, mouthZ);
    scene.add(cave);

    // --- Карман-пол: ровная плита-коллайдер глубиной ~3-4 м (на ней стоит сундук) ---
    // Видимая плита (тонированный тёмный камень) + кубоид-коллайдер у floorY.
    const floorGeo = new THREE.BoxGeometry(4.0, 0.4, 3.4);
    const floorMesh = new THREE.Mesh(
      floorGeo,
      new THREE.MeshStandardMaterial({ color: 0x6f6a61, roughness: 0.96 }),
    );
    const floorCx = CAVE_CHEST.x + inDx * 0.6; // карман чуть вглубь от лип
    floorMesh.position.set(floorCx, floorY - 0.2, CAVE_CHEST.z);
    floorMesh.receiveShadow = true;
    floorMesh.castShadow = true;
    scene.add(floorMesh);
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(2.0, 0.5, 1.7)
        .setTranslation(floorCx, floorY - 0.4, CAVE_CHEST.z)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );

    // --- Факелы у входа + тёплый свет (приметно издалека) ---
    const sideZ = 1.6; // факелы по бокам зева, вдоль стены (z)
    await this.placeTorch(scene, assets, terrain, CAVE_CHEST.x - inDx * 0.4, CAVE_CHEST.z + sideZ, floorY);
    await this.placeTorch(scene, assets, terrain, CAVE_CHEST.x - inDx * 0.4, CAVE_CHEST.z - sideZ, floorY);
    const lamp = new THREE.PointLight(0xffd9a0, 9, 14, 1.6);
    lamp.position.set(CAVE_CHEST.x, floorY + 2.2, CAVE_CHEST.z);
    scene.add(lamp);
  }

  /** Поставить факел torch_lit у входа в пещеру (основание на floorY, без коллайдера). */
  private async placeTorch(
    scene: THREE.Scene,
    assets: AssetLoader,
    _terrain: Terrain,
    x: number,
    z: number,
    floorY: number,
  ): Promise<void> {
    try {
      const gltf = await assets.model(TORCH_ASSET);
      const obj = gltf.scene.clone();
      obj.scale.setScalar(scaleToFootprint(obj, 0.6));
      obj.position.set(x, 0, z);
      const box = bboxOf(obj);
      obj.position.y = floorY - box.min.y;
      enableShadows(obj);
      scene.add(obj);
    } catch {
      console.warn('[parkour] факел не загрузился');
    }
  }
}
