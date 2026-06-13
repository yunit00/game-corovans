import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };

// Группы коллизий (16 бит membership << 16 | 16 бит filter)
export const GROUP_STATIC = 0b0001;
export const GROUP_PLAYER = 0b0010;
export const GROUP_NPC = 0b0100;
export const GROUP_LOOT = 0b1000;
export const ALL_GROUPS = 0xffff;

export const groups = (memberships: number, filter: number): number =>
  ((memberships & 0xffff) << 16) | (filter & 0xffff);

export class PhysicsWorld {
  readonly world: RAPIER.World;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  step(): void {
    this.world.step();
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  /**
   * Рейкаст с исключением коллайдера (например, самого игрока).
   * Возвращает дистанцию до попадания или null.
   */
  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    excludeCollider?: RAPIER.Collider,
    filterGroups?: number,
  ): number | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, filterGroups, excludeCollider);
    return hit ? hit.timeOfImpact : null;
  }

  /**
   * Как raycast, но возвращает и коллайдер попадания (для снарядов и т.п.).
   */
  raycastFull(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number,
    excludeCollider?: RAPIER.Collider,
    filterGroups?: number,
  ): { dist: number; collider: RAPIER.Collider } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, filterGroups, excludeCollider);
    return hit ? { dist: hit.timeOfImpact, collider: hit.collider } : null;
  }
}
