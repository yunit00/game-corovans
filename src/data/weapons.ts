import type { AnimState } from './animClipMap';

export interface WeaponDef {
  id: string;
  name: string;
  kind: 'melee' | 'ranged';
  damage: number;
  /** Дальность милишки, м. */
  range?: number;
  /** Полный угол сектора милишки, градусы. */
  arcDeg?: number;
  /** Момент удара в долях длительности анимации. */
  hitAt: number;
  anims: AnimState[];
  cooldown: number; // сек
  /**
   * Множитель темпа анимации УДАРА ИГРОКА (CombatSystem). >1 — резче и короче
   * свинг: клипы KayKit длиной ~1–1.3 с при timeScale 1 ощущаются затянутыми, а
   * busy-флаг аниматора держит игрока до конца клипа (даже если cooldown меньше).
   * NPC бьют в своём темпе (AISystem не читает это поле). По умолчанию 1.
   */
  attackTimeScale?: number;
  projectileSpeed?: number;
  /**
   * Порог летальности стрелы по maxHp цели (Фаза 6.6). Цель с maxHp ≤ этого порога
   * падает с ОДНОГО попадания, выше — с двух (см. sim/projectile.arrowKillDamage).
   * Только у арбалета ИГРОКА: его стрелы конечны — это баланс за убойность. У NPC
   * поля нет, их стрелы бьют по обычной формуле (computeHit).
   */
  lethalMaxHp?: number;
  /** Меш в public/assets/weapons (для экипировки, Фаза 6). */
  mesh?: string;
}

export const WEAPONS: Record<string, WeaponDef> = {
  dagger: {
    id: 'dagger', name: 'Кинжал', kind: 'melee', damage: 9, range: 2.1, arcDeg: 110,
    // Кинжал — самое быстрое оружие: резкий короткий тычок. timeScale 1.8 ужимает
    // ~1-секундный клип до ~0.55 с, hitAt 0.3 — попадание ближе к визуальному
    // контакту, cooldown 0.4 синхронен длине свинга (можно бить почти без пауз).
    hitAt: 0.3, anims: ['attackMelee1', 'attackMelee2', 'attackStab'], cooldown: 0.4,
    attackTimeScale: 1.8, mesh: 'dagger',
  },
  sword_1handed: {
    id: 'sword_1handed', name: 'Меч стражи', kind: 'melee', damage: 14, range: 2.2, arcDeg: 120,
    hitAt: 0.36, anims: ['attackMelee1', 'attackMelee2', 'attackMelee3'], cooldown: 0.5,
    attackTimeScale: 1.5, mesh: 'sword_1handed',
  },
  sword_2handed: {
    id: 'sword_2handed', name: 'Двуручный меч', kind: 'melee', damage: 24, range: 2.6, arcDeg: 150,
    hitAt: 0.42, anims: ['attackMelee3'], cooldown: 0.85, attackTimeScale: 1.25, mesh: 'sword_2handed',
  },
  axe_2handed: {
    id: 'axe_2handed', name: 'Секира', kind: 'melee', damage: 28, range: 2.4, arcDeg: 130,
    hitAt: 0.48, anims: ['attackMelee3'], cooldown: 1.0, attackTimeScale: 1.2, mesh: 'axe_2handed',
  },
  sword_royal: {
    id: 'sword_royal', name: 'Королевский клинок', kind: 'melee', damage: 34, range: 2.3, arcDeg: 130,
    hitAt: 0.36, anims: ['attackMelee1', 'attackMelee2'], cooldown: 0.5,
    attackTimeScale: 1.6, mesh: 'sword_1handed',
  },
  crossbow_2handed: {
    id: 'crossbow_2handed', name: 'Арбалет', kind: 'ranged', damage: 18,
    hitAt: 0.25, anims: ['shootRanged'], cooldown: 1.0, projectileSpeed: 40,
    // Рядовые (raider 40, guard_soldier 70, guard_crossbow 50) валятся с одной
    // стрелы; громила (skeleton_brute 80 > 75) — с двух. См. arrowKillDamage.
    lethalMaxHp: 75, mesh: 'crossbow_2handed',
  },
};
