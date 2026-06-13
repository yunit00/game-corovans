// Точки спавна волны набега. Чистая sim-логика: только числа и plain-объекты,
// никаких Three/Rapier — тестируется в node. Сектора и центр задаёт RaidDirector.
import { randRange, type Rng } from '../core/rng';

export interface SpawnPoint {
  x: number;
  z: number;
}

/**
 * Раскладывает count точек по дуге сектора [azFrom..azTo] на дистанции [rMin..rMax]
 * от центра. Азимут в конвенции yawFromDir: atan2(x, z), т.е. 0 — это +Z, π/2 — +X.
 *
 * Дуга делится на равные слоты, точка — в центре слота с джиттером в полслота:
 * волна выходит «цепью» (юниты не слипаются в одну кучу), но при этом гарантированно
 * не вылезает из сектора при любом rng.
 */
export function waveSpawnPoints(
  count: number,
  cx: number,
  cz: number,
  azFrom: number,
  azTo: number,
  rMin: number,
  rMax: number,
  rng: Rng,
): SpawnPoint[] {
  const out: SpawnPoint[] = [];
  if (count <= 0) return out;
  const span = azTo - azFrom;
  for (let i = 0; i < count; i++) {
    const az = azFrom + (span * (i + 0.5)) / count + ((rng() - 0.5) * span) / count;
    const r = randRange(rng, rMin, rMax);
    out.push({ x: cx + Math.sin(az) * r, z: cz + Math.cos(az) * r });
  }
  return out;
}
