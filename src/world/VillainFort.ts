import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { isClear } from './WorldData';
import type { Terrain } from './Terrain';

/**
 * Логово злодея, откуда выходят карательные отряды дворца… то есть наоборот:
 * это лагерь, по которому дворец равняет сектор спавна волн (деревня→форт).
 * Позиция детерминирована рельефом, поэтому считается тем же сканом и в Game.
 */

/** Точки спавна подвижной стражи лагеря (мир) — Game спавнит villain_guard. */
export interface FortGuardSpots {
  /** Центр лагеря (мир) — центр патрульных кругов. */
  center: { x: number; z: number };
  /** Две точки у палаток для патрулирующих стражей. */
  guards: { x: number; z: number; faceYaw: number }[];
}

/** Сектор поиска места форта, м (юго-восток от деревни). */
const SECTOR_MIN = 150;
const SECTOR_MAX = 350;
/** Шаг сетки сканирования места, м. */
const GRID_STEP = 20;
/** Зазор isClear: лагерю нужна площадка крупнее камня/дерева. */
const CLEAR_MARGIN = 30;

/**
 * Детерминированный выбор места: сетка GRID_STEP по сектору [150..350]², берём
 * клетку с максимальной высотой рельефа среди свободных (isClear margin 30).
 * Чистая функция от terrain — Game зовёт её же, чтобы знать fortPos без сборки.
 */
export function findFortPos(terrain: Terrain): { x: number; z: number } {
  let best = { x: SECTOR_MIN, z: SECTOR_MIN };
  let bestH = -Infinity;
  for (let x = SECTOR_MIN; x <= SECTOR_MAX; x += GRID_STEP) {
    for (let z = SECTOR_MIN; z <= SECTOR_MAX; z += GRID_STEP) {
      if (!isClear(x, z, CLEAR_MARGIN)) continue;
      const h = terrain.height(x, z);
      if (h > bestH) {
        bestH = h;
        best = { x, z };
      }
    }
  }
  return best;
}

/**
 * Лагерь злодея: палатки, баннеры, кострище. Вместо двух НЕПОДВИЖНЫХ скелетов у
 * входа (на которых жаловался игрок) возвращаем наружу точки спавна двух подвижных
 * стражей villain_guard — Game спавнит их через spawnNpc (патруль вокруг палаток).
 */
export class VillainFort {
  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
  ): Promise<FortGuardSpots> {
    const pos = findFortPos(terrain);
    const cx = pos.x;
    const cz = pos.z;

    // place по образцу Village: масштаб по footprint, основание на землю, опц. box-коллайдер
    const place = async (
      path: string,
      x: number,
      z: number,
      opts: { footprint: number; faceCenter?: boolean; rot?: number; collider?: 'box' | 'none' },
    ): Promise<void> => {
      let gltf;
      try {
        gltf = await assets.model(path);
      } catch {
        console.warn(`[fort] не загрузилось: ${path}`);
        return;
      }
      const obj = gltf.scene.clone();
      obj.scale.setScalar(scaleToFootprint(obj, opts.footprint));
      const y = terrain.height(x, z);
      obj.position.set(x, 0, z);
      obj.rotation.y = opts.faceCenter ? Math.atan2(cx - x, cz - z) : (opts.rot ?? 0);
      // Пивоты Kenney в центре — сажаем основание на землю
      obj.position.y = y - bboxOf(obj).min.y;
      enableShadows(obj);
      scene.add(obj);

      if ((opts.collider ?? 'box') === 'box') {
        const box = bboxOf(obj);
        const size = box.getSize(new THREE.Vector3());
        const q = new THREE.Quaternion().setFromEuler(obj.rotation);
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(size.x * 0.42, size.y / 2, size.z * 0.42)
            .setTranslation(x, y + size.y / 2, z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
        );
      }
    };

    // 3 палатки полукольцом, обращены внутрь лагеря (footprint 4–5, box-коллайдеры)
    await place('/assets/world/survival/tent.glb', cx - 6, cz - 4, { footprint: 5, faceCenter: true });
    await place('/assets/world/survival/tent-canvas.glb', cx + 6, cz - 4, { footprint: 4.5, faceCenter: true });
    await place('/assets/world/survival/tent.glb', cx, cz - 8, { footprint: 5, faceCenter: true });

    // 2 красных баннера по бокам входа (вход — со стороны деревни, т.е. −z от центра)
    await place('/assets/world/town/banner-red.glb', cx - 4, cz + 6, { footprint: 1.6 });
    await place('/assets/world/town/banner-red.glb', cx + 4, cz + 6, { footprint: 1.6 });

    // Кострище: кольцо мелких камней без коллайдеров (декор, не мешает ходьбе)
    const RING_R = 1.2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      await place('/assets/world/nature/rock_largea.glb', cx + Math.cos(a) * RING_R, cz + Math.sin(a) * RING_R, {
        footprint: 0.5,
        collider: 'none',
      });
    }

    // Точки спавна двух подвижных стражей у входа (вместо стоячих скелетов):
    // лицом наружу (к деревне). Game спавнит villain_guard через spawnNpc, AISystem
    // даёт им патруль вокруг палаток — игрок больше не видит «стоячих скелетов».
    const guards = [-3, 3].map((dx) => {
      const gx = cx + dx;
      const gz = cz + 7;
      return { x: gx, z: gz, faceYaw: Math.atan2(gx - cx, gz - cz) };
    });
    return { center: { x: cx, z: cz }, guards };
  }
}
