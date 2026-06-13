// Замок злодея в юго-восточном горном кольце (пакет villain-castle). Финал игры
// (задел Фазы 8: босс в форте) — труднодоступная цитадель на плато, к которому
// ведёт серпантин-тропа от подножия у лагеря злодея. Терраформинг плато/тропы —
// в Terrain.ts (CASTLE), здесь только сборка зданий по тем же константам и выдача
// якорей охраны (ворота/двор/серпантин) наружу — Game спавнит NPC через spawnNpc.
//
// Сборка по образцу RoadEnds.buildSentry/buildStockade: GLB на terrain.height с
// box-коллайдерами (shrink ~0.42), стены fence_stone периметром, ворота к выходу
// тропы, флаги/факелы/палатки/кострище во дворе. InstancedMesh не нужен — объектов
// немного, но дешёвые декор-элементы ставим collider:'none'.
import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { CASTLE, type Terrain } from './Terrain';

/** Якоря охраны замка для Game (спавн через spawnNpc в initCombat). */
export interface CastleAnchors {
  /** Центр двора (мир) — патруль 4 рядовых. */
  courtyard: { x: number; z: number };
  /** Точка снаружи ворот (мир) — патруль 2 элиты у входа. */
  gate: { x: number; z: number };
  /** Поворот ворот/двора (рад) — мордой к выходу тропы. */
  faceYaw: number;
  /** Точки вдоль серпантина (мир) — пары рядовых на подъёме. */
  trailPosts: { x: number; z: number }[];
}

/** Полуразмер двора (от центра до стены), м → двор ~2·halfW по стороне. */
const HALF_W = 15;
/** Длина секции каменной стены (footprint), м. */
const WALL_SEG = 4.5;

export class VillainCastle {
  /** Грубый счётчик мешей (proxy draw calls) — для перф-чека. */
  drawCalls = 0;
  /** Якоря охраны — заполняются в build, наружу для спавна NPC. */
  anchors: CastleAnchors | null = null;

  async build(scene: THREE.Scene, physics: PhysicsWorld, assets: AssetLoader, terrain: Terrain): Promise<CastleAnchors> {
    const cx = CASTLE.cx;
    const cz = CASTLE.cz;
    // Тропа входит на плато последним сегментом — ворота смотрят НАВСТРЕЧУ ей.
    const trail = CASTLE.trail;
    const entry = trail[trail.length - 2]!; // предпоследняя точка — направление подхода
    const faceYaw = Math.atan2(entry.x - cx, entry.z - cz); // forward (sin,cos) к выходу тропы

    const off = offsetter({ x: cx, z: cz }, faceYaw); // локальные (вправо,вперёд) → мир

    // --- Каменный периметр с воротами к выходу тропы ---
    await this.buildPerimeter(scene, physics, assets, terrain, { x: cx, z: cz }, faceYaw);

    // --- Замок в глубине двора (в тылу, −Z), доминанта ---
    const [bx, bz] = off(0, -HALF_W + 9);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_castle_red.glb', bx, bz, {
      footprint: 22, rot: faceYaw, collider: 'box', shrinkXZ: 0.42,
    });

    // --- 4 башни по углам двора (силуэт цитадели) ---
    const towerOff = HALF_W - 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const [tx, tz] = off(sx * towerOff, sz * towerOff);
      await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/building_tower_b_red.glb', tx, tz, {
        footprint: 10, rot: faceYaw, collider: 'box', shrinkXZ: 0.4,
      });
    }

    // --- Флаги на углах фронта + у замка ---
    for (const [fx, fz] of [[-HALF_W + 3, HALF_W - 2], [HALF_W - 3, HALF_W - 2], [0, -HALF_W + 4]] as const) {
      const [flx, flz] = off(fx, fz);
      await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/flag_red.glb', flx, flz, {
        footprint: 3.2, rot: faceYaw, collider: 'none',
      });
    }

    // --- Гарнизон во дворе: стойка с оружием, 2 палатки, кострище ---
    const [wrx, wrz] = off(4, -2);
    await this.place(scene, physics, assets, terrain, '/assets/world/hexagon/weaponrack.glb', wrx, wrz, {
      footprint: 1.8, rot: faceYaw + Math.PI / 2, collider: 'none',
    });
    const [t1x, t1z] = off(-6, 2);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/tent.glb', t1x, t1z, {
      footprint: 4.5, rot: faceYaw + Math.PI, collider: 'box', shrinkXZ: 0.42,
    });
    const [t2x, t2z] = off(7, 4);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/tent.glb', t2x, t2z, {
      footprint: 4.5, rot: faceYaw + Math.PI, collider: 'box', shrinkXZ: 0.42,
    });
    const [pfx, pfz] = off(-1, 4);
    await this.place(scene, physics, assets, terrain, '/assets/world/survival/campfire-pit.glb', pfx, pfz, {
      footprint: 1.4, rot: 0, collider: 'none',
    });

    // --- Факелы по бокам ворот (декор, освещают въезд) ---
    for (const dx of [-3.2, 3.2]) {
      const [tlx, tlz] = off(dx, HALF_W);
      await this.place(scene, physics, assets, terrain, '/assets/props/torch_lit.glb', tlx, tlz, {
        footprint: 0.6, rot: faceYaw, collider: 'none',
      });
    }

    // --- Якоря охраны наружу ---
    const [gx, gz] = off(0, HALF_W + 4); // точка снаружи ворот (на выходе тропы)
    // Посты на серпантине — середины 2 средних сегментов (пары рядовых на подъёме).
    const mid = (a: { x: number; z: number }, b: { x: number; z: number }) => ({
      x: +((a.x + b.x) / 2).toFixed(2),
      z: +((a.z + b.z) / 2).toFixed(2),
    });
    const trailPosts = [mid(trail[1]!, trail[2]!), mid(trail[2]!, trail[3]!)];

    this.anchors = {
      courtyard: { x: cx, z: cz },
      gate: { x: +gx.toFixed(2), z: +gz.toFixed(2) },
      faceYaw,
      trailPosts,
    };
    return this.anchors;
  }

  /**
   * Каменный периметр двора 2·HALF_W × 2·HALF_W из секций fence_stone_straight,
   * во фронтальной стене (к выходу тропы, +dz) — ворота fence_stone_straight_gate.
   * Каждая секция — на terrain.height в своей точке (двор на склоне не тонет).
   */
  private async buildPerimeter(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    center: { x: number; z: number },
    yaw: number,
  ): Promise<void> {
    const off = offsetter(center, yaw);
    const stone = '/assets/world/hexagon/fence_stone_straight.glb';
    const gate = '/assets/world/hexagon/fence_stone_straight_gate.glb';
    const ALONG_Z = yaw; // боковые стены (±X) тянутся вдоль forward(Z)
    const ALONG_X = yaw + Math.PI / 2; // тыловая/фронтальная вдоль right(X)
    const wall = async (dx: number, dz: number, rot: number, path = stone): Promise<void> => {
      const [wx, wz] = off(dx, dz);
      await this.place(scene, physics, assets, terrain, path, wx, wz, {
        footprint: WALL_SEG, rot, collider: 'box', shrinkXZ: 0.46,
      });
    };
    // 6 секций на сторону: равномерно по 2·HALF_W (центры в ±HALF_W·{1/6..5/6}).
    const n = Math.max(2, Math.round((HALF_W * 2) / WALL_SEG));
    const ticks: number[] = [];
    for (let i = 0; i < n; i++) ticks.push(-HALF_W + HALF_W * 2 * ((i + 0.5) / n));
    for (const d of ticks) {
      await wall(-HALF_W, d, ALONG_Z); // левая (−X)
      await wall(HALF_W, d, ALONG_Z); // правая (+X)
      await wall(d, -HALF_W, ALONG_X); // тыловая (−Z)
    }
    // Фронтальная стена (+Z, к выходу тропы) с воротами по центру.
    await wall(0, HALF_W, ALONG_X, gate); // ворота — секция-проём, обращена к тропе
    for (const d of ticks) {
      if (Math.abs(d) < WALL_SEG * 0.75) continue; // центральную секцию занимают ворота
      await wall(d, HALF_W, ALONG_X);
    }
  }

  /** Установка GLB на рельеф с опц. box-коллайдером (как RoadEnds.place). */
  private async place(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
    path: string,
    x: number,
    z: number,
    opts: { footprint: number; rot: number; collider?: 'box' | 'none'; shrinkXZ?: number },
  ): Promise<void> {
    let gltf;
    try {
      gltf = await assets.model(path);
    } catch {
      console.warn(`[castle] модель не загрузилась: ${path}`);
      return;
    }
    const obj = gltf.scene.clone();
    obj.scale.setScalar(scaleToFootprint(obj, opts.footprint));
    const y = terrain.height(x, z);
    obj.position.set(x, 0, z);
    obj.rotation.y = opts.rot;
    obj.position.y = y - bboxOf(obj).min.y; // пивоты Kenney в центре — основание на землю
    enableShadows(obj);
    scene.add(obj);
    this.drawCalls++;

    if ((opts.collider ?? 'none') === 'box') {
      const box = bboxOf(obj);
      const size = box.getSize(new THREE.Vector3());
      const q = new THREE.Quaternion().setFromEuler(obj.rotation);
      const shrink = opts.shrinkXZ ?? 0.42;
      physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(size.x * shrink, size.y / 2, size.z * shrink)
          .setTranslation(x, y + size.y / 2, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
      );
    }
  }
}

/** Замыкание «локальный сдвиг (вправо,вперёд) → мир» вокруг точки по yaw. */
function offsetter(loc: { x: number; z: number }, yaw: number): (dx: number, dz: number) => [number, number] {
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  return (dx, dz) => [loc.x + rightX * dx + fwdX * dz, loc.z + rightZ * dx + fwdZ * dz];
}
