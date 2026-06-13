import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { AssetLoader } from '../core/AssetLoader';
import { GROUP_LOOT, GROUP_STATIC, RAPIER, groups, type PhysicsWorld } from '../core/PhysicsWorld';
import type { Rng } from '../core/rng';

const MAX_COINS_PER_DROP = 10;
const COIN_RADIUS = 0.12;
const COIN_SCALE = 1.6; // монета мелкая — увеличиваем меш, чтобы читалась с 10 м
const PICKUP_DIST = 0.6;
const MAGNET_DIST = 2.5;
const MAGNET_SPEED = 6;
const COIN_TTL = 30; // сек до тихого деспауна

interface Coin {
  body: RAPIER_NS.RigidBody;
  mesh: THREE.Mesh;
  value: number;
  age: number;
  magnet: boolean; // уже притягивается к игроку (гравитация выключена)
}

/** Монеты-лут: фонтан из физических монет, магнит-подбор игроком. */
export class LootSystem {
  private coins: Coin[] = [];
  private coinGeo!: THREE.BufferGeometry;
  private coinMat!: THREE.Material | THREE.Material[];
  /** Радиус магнита; перк «Звериное чутьё» (Фаза 6) множит базовый MAGNET_DIST. */
  private magnetDist = MAGNET_DIST;

  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld,
  ) {}

  /** Задать радиус магнита (база × множитель перка). */
  setMagnetDist(dist: number): void {
    this.magnetDist = dist;
  }

  /** Прелоад модели монеты: первый меш GLTF как общий шаблон geometry/material. */
  async init(assets: AssetLoader): Promise<void> {
    const gltf = await assets.model('/assets/props/coin.glb');
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('coin.glb: меш не найден');
    this.coinGeo = (found as THREE.Mesh).geometry;
    this.coinMat = (found as THREE.Mesh).material;
  }

  /** Рассыпать totalValue монетами (не больше 10 тел) фонтаном из точки pos. */
  spawnCoins(pos: THREE.Vector3, totalValue: number, rng: Rng): void {
    if (totalValue <= 0) return;
    const count = Math.min(MAX_COINS_PER_DROP, totalValue);
    // Распределяем номиналы максимально ровно: 23 на 10 → семь по 2 и три по 3
    const base = Math.floor(totalValue / count);
    const extra = totalValue % count; // столько монет получат base+1

    for (let i = 0; i < count; i++) {
      const body = this.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + 0.6, pos.z),
      );
      // Сталкиваются только со статикой — катятся по земле, но не толкают персонажей
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.ball(COIN_RADIUS)
          .setCollisionGroups(groups(GROUP_LOOT, GROUP_STATIC))
          .setRestitution(0.4),
        body,
      );
      // Импульс-фонтан: вверх и слегка в случайную сторону
      body.setLinvel(
        { x: (rng() * 2 - 1) * 2.5, y: 4.5 + rng() * 2, z: (rng() * 2 - 1) * 2.5 },
        true,
      );
      body.setAngvel(
        { x: (rng() * 2 - 1) * 4, y: (rng() * 2 - 1) * 4, z: (rng() * 2 - 1) * 4 },
        true,
      );

      const mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
      mesh.scale.setScalar(COIN_SCALE);
      // Без castShadow: тень от монеты 0.12 м нечитаема, а каждый меш — лишний
      // draw call в shadow-pass (дождь монет пробивал бы бюджет drawCalls < 350)
      this.scene.add(mesh);

      this.coins.push({ body, mesh, value: base + (i < extra ? 1 : 0), age: 0, magnet: false });
    }
  }

  /** Подбор/магнит/деспаун. Возвращает суммарный value подобранного за шаг. */
  fixedUpdate(stepSec: number, playerFeet: THREE.Vector3): number {
    let picked = 0;
    const dead: Coin[] = []; // удаляем после итерации, не во время
    const tx = playerFeet.x;
    const ty = playerFeet.y + 0.5; // целимся в пояс, а не в подошвы
    const tz = playerFeet.z;

    for (const coin of this.coins) {
      coin.age += stepSec;
      if (coin.age > COIN_TTL) {
        dead.push(coin);
        continue;
      }
      const t = coin.body.translation();
      const dx = tx - t.x;
      const dy = ty - t.y;
      const dz = tz - t.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < PICKUP_DIST) {
        picked += coin.value;
        dead.push(coin);
      } else if (dist < this.magnetDist) {
        // Магнит: летим прямо на игрока, гравитация больше не мешает
        if (!coin.magnet) {
          coin.magnet = true;
          coin.body.setGravityScale(0, true);
        }
        const k = MAGNET_SPEED / dist;
        coin.body.setLinvel({ x: dx * k, y: dy * k, z: dz * k }, true);
      } else if (coin.magnet) {
        // Игрок убежал (спринт 7.6 > MAGNET_SPEED): возвращаем гравитацию,
        // иначе монета зависнет в воздухе. Повторный заход в радиус сработает снова.
        coin.magnet = false;
        coin.body.setGravityScale(1, true);
      }
    }

    for (const coin of dead) this.remove(coin);
    return picked;
  }

  /** Синхронизация мешей с телами. */
  update(_dt: number): void {
    for (const coin of this.coins) {
      const t = coin.body.translation();
      const r = coin.body.rotation();
      coin.mesh.position.set(t.x, t.y, t.z);
      coin.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  get activeCount(): number {
    return this.coins.length;
  }

  /** Geometry/material общие — не диспоузим, только убираем меш и тело. */
  private remove(coin: Coin): void {
    this.scene.remove(coin.mesh);
    this.physics.world.removeRigidBody(coin.body);
    const i = this.coins.indexOf(coin);
    if (i !== -1) this.coins.splice(i, 1);
  }
}
