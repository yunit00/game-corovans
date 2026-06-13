// Проверяет, что heightfield-коллайдер Rapier ориентирован так же, как
// функция высоты Terrain.height() — рейкаст вниз попадает в ожидаемую высоту.
import { beforeAll, describe, expect, it } from 'vitest';
import { PhysicsWorld, RAPIER } from '../src/core/PhysicsWorld';
import { mulberry32 } from '../src/core/rng';
import { Terrain } from '../src/world/Terrain';

let physics: PhysicsWorld;
let terrain: Terrain;

beforeAll(async () => {
  physics = await PhysicsWorld.create();
  terrain = new Terrain({ size: 200, segments: 128, seed: 42, amplitude: 5, noiseScale: 55 });
  terrain.buildCollider(physics);
  physics.step();
});

describe('heightfield vs height()', () => {
  it('рейкаст вниз совпадает с функцией высоты (20 случайных точек)', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 20; i++) {
      const x = (rng() - 0.5) * 180;
      const z = (rng() - 0.5) * 180;
      const ray = new RAPIER.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 });
      const hit = physics.world.castRay(ray, 300, true);
      expect(hit).not.toBeNull();
      const hitY = 100 - hit!.timeOfImpact;
      const expected = terrain.height(x, z);
      expect(Math.abs(hitY - expected)).toBeLessThan(0.6);
    }
  });

  it('высота детерминирована сидом', () => {
    const t2 = new Terrain({ size: 200, segments: 128, seed: 42, amplitude: 5, noiseScale: 55 });
    expect(t2.height(13.7, -42.1)).toBe(terrain.height(13.7, -42.1));
  });
});
