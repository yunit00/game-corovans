import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { PALACE } from './WorldData';
import type { Terrain } from './Terrain';

/** Дворец на севере — резиденция охраны, откуда выезжают корованы. Пока декорация. */
export class Palace {
  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    terrain: Terrain,
  ): Promise<void> {
    const { x: cx, z: cz } = PALACE;

    const castle = (await assets.model('/assets/world/hexagon/building_castle_blue.glb')).scene.clone();
    // 55 м — заметно крупнее домов деревни (9.5–11.5 м), читается как дворец
    const s = scaleToFootprint(castle, 55);
    castle.scale.setScalar(s);
    const y = terrain.height(cx, cz);
    castle.position.set(cx, 0, cz);
    castle.position.y = y - bboxOf(castle).min.y;
    enableShadows(castle);
    scene.add(castle);

    const size = bboxOf(castle).getSize(new THREE.Vector3());
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x * 0.38, size.y / 2, size.z * 0.38)
        .setTranslation(cx, y + size.y / 2, cz)
        .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
    );

    // Флаги по углам и палатки стражи — раскладка отодвинута ×1.3 вместе с замком,
    // иначе при footprint 55 (полуширина bbox ~27.5 м) флаги на ±26 утонут в стенах
    const flagGltf = await assets.model('/assets/world/hexagon/flag_blue.glb');
    for (const [dx, dz] of [[-34, -34], [34, -34], [-34, 34], [34, 34]] as const) {
      const flag = flagGltf.scene.clone();
      flag.scale.setScalar(scaleToFootprint(flag, 1.6) * 3);
      flag.position.set(cx + dx, 0, cz + dz);
      flag.position.y = terrain.height(cx + dx, cz + dz) - bboxOf(flag).min.y;
      enableShadows(flag);
      scene.add(flag);
    }
    const tentGltf = await assets.model('/assets/world/hexagon/tent.glb');
    for (const [dx, dz] of [[-44, 13], [-48, 26], [47, 18]] as const) {
      const tent = tentGltf.scene.clone();
      tent.scale.setScalar(scaleToFootprint(tent, 5));
      tent.position.set(cx + dx, 0, cz + dz);
      tent.rotation.y = Math.atan2(-dx, -dz);
      tent.position.y = terrain.height(cx + dx, cz + dz) - bboxOf(tent).min.y;
      enableShadows(tent);
      scene.add(tent);
    }
  }
}
