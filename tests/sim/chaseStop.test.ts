// Проверяет, что NPC в chase (arriveStop) НЕ въезжает капсулой в игрока:
// после фикса игрока KCC не выталкивает NPC, поэтому непроход держит стиринг.
// Тут чистая интеграция steering + кинематический перенос (как NpcCharacter.fixedUpdate),
// без Rapier — нам важна геометрия остановки.
import { describe, expect, it } from 'vitest';
import { arriveStop } from '../../src/sim/steering';

const CAPSULE_RADIUS = 0.35;
const CHASE_BODY_GAP = 0.1;
const STOP_DIST = CAPSULE_RADIUS * 2 + CHASE_BODY_GAP; // 0.8
const SLOW_RADIUS = 0.8;

describe('chase: NPC паркуется у тела игрока, не въезжает в центр', () => {
  it('NPC, идущий прямо на игрока, останавливается на стоп-кольце (капсулы не перекрываются)', () => {
    const speed = 3;
    const stepSec = 1 / 60;
    let nx = -5; // NPC слева
    const nz = 0;
    const px = 0; // игрок в нуле
    const pz = 0;
    const out = { x: 0, z: 0 };
    for (let i = 0; i < 600; i++) {
      arriveStop(nx, nz, px, pz, speed, STOP_DIST, SLOW_RADIUS, out);
      nx += out.x * stepSec;
      // nz не двигается (цель по оси X)
    }
    const dist = Math.abs(px - nx);
    // Остановился у стоп-кольца, не дальше и не въехал внутрь (допуск на шаг)
    expect(dist).toBeGreaterThan(STOP_DIST - 0.06);
    expect(dist).toBeLessThan(STOP_DIST + 0.06);
    // Капсулы (2*0.35=0.7) НЕ перекрываются: между телами зазор
    expect(dist).toBeGreaterThanOrEqual(CAPSULE_RADIUS * 2 - 0.01);
  });

  it('NPC не «проскакивает» игрока: остаётся со своей стороны (X<0)', () => {
    const speed = 6; // быстрый — провокация на проскок
    const stepSec = 1 / 60;
    let nx = -3;
    const out = { x: 0, z: 0 };
    let minSignedX = nx;
    for (let i = 0; i < 600; i++) {
      arriveStop(nx, 0, 0, 0, speed, STOP_DIST, SLOW_RADIUS, out);
      nx += out.x * stepSec;
      if (nx < minSignedX) minSignedX = nx;
    }
    // Никогда не зашёл за игрока (nx остаётся отрицательным, около -STOP_DIST)
    expect(nx).toBeLessThan(0);
    expect(nx).toBeGreaterThan(-STOP_DIST - 0.06);
  });
});
