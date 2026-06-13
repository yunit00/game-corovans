// Чистая боевая математика.
import type { Rng } from '../core/rng';

export interface AttackerStats {
  /** Бонус урона в процентах (от перков/экипировки). */
  attackBonus: number;
  critChance: number; // 0..1
  critMult: number; // например 1.8
}

export interface DefenderStats {
  armor: number; // 0+ — каждые 100 брони режут урон вдвое
}

export interface HitResult {
  damage: number;
  crit: boolean;
}

export const DEFAULT_ATTACKER: AttackerStats = { attackBonus: 0, critChance: 0.08, critMult: 1.8 };
export const DEFAULT_DEFENDER: DefenderStats = { armor: 0 };

export function computeHit(
  baseDamage: number,
  attacker: AttackerStats,
  defender: DefenderStats,
  rng: Rng,
): HitResult {
  const spread = 0.9 + rng() * 0.2; // ±10%
  const crit = rng() < attacker.critChance;
  let damage = baseDamage * (1 + attacker.attackBonus / 100) * spread;
  if (crit) damage *= attacker.critMult;
  damage *= 100 / (100 + Math.max(0, defender.armor));
  return { damage: Math.max(1, Math.round(damage)), crit };
}
