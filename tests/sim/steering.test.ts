import { describe, expect, it } from 'vitest';
import {
  arrive,
  arriveStop,
  avoidObstacles,
  combineSteering,
  seek,
  separation,
  type Steer,
} from '../../src/sim/steering';

const len = (s: Steer) => Math.hypot(s.x, s.z);
// Скретч с NaN: если функция забудет записать out, проверки упадут с шумом
const out = (): Steer => ({ x: NaN, z: NaN });

describe('seek', () => {
  it('направление на цель, модуль = maxSpeed', () => {
    const s = seek(0, 0, 3, 4, 5, out());
    expect(s.x).toBeCloseTo(3); // (3,4)/5 · 5
    expect(s.z).toBeCloseTo(4);
    expect(len(s)).toBeCloseTo(5);
  });

  it('цель совпадает с позицией → ноль, без NaN', () => {
    const s = seek(7, -2, 7, -2, 5, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('пишет в out и возвращает его же (контракт без аллокаций)', () => {
    const o = out();
    expect(seek(0, 0, 3, 4, 5, o)).toBe(o);
  });
});

describe('arrive', () => {
  it('далеко за slowRadius — полный ход, как seek', () => {
    const s = arrive(0, 0, 100, 0, 4, 10, out());
    expect(s.x).toBeCloseTo(4);
    expect(s.z).toBeCloseTo(0);
  });

  it('внутри slowRadius скорость падает линейно', () => {
    const s = arrive(0, 0, 5, 0, 4, 10, out()); // половина радиуса → половина скорости
    expect(s.x).toBeCloseTo(2);
    expect(s.z).toBeCloseTo(0);
  });

  it('ровно в цели → ноль, без NaN', () => {
    const s = arrive(1, 1, 1, 1, 4, 10, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('slowRadius = 0 не делит на ноль', () => {
    const s = arrive(0, 0, 3, 0, 4, 0, out());
    expect(s.x).toBeCloseTo(4);
    expect(Number.isNaN(s.z)).toBe(false);
  });
});

describe('arriveStop', () => {
  it('далеко за стоп-кольцом и slowRadius — полный ход к цели', () => {
    // dist=10, stopDist=0.8, slowRadius=0.8 → rem=9.2 >> slowRadius → maxSpeed
    const s = arriveStop(0, 0, 10, 0, 4, 0.8, 0.8, out());
    expect(s.x).toBeCloseTo(4);
    expect(s.z).toBeCloseTo(0);
  });

  it('на стоп-кольце скорость = 0 (агент припаркован у тела цели)', () => {
    const s = arriveStop(0, 0, 0.8, 0, 4, 0.8, 0.8, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('внутри стоп-кольца тоже ноль — NPC не лезет в центр цели', () => {
    const s = arriveStop(0, 0, 0.5, 0, 4, 0.8, 0.8, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('в зоне торможения скорость линейна по остатку до кольца', () => {
    // dist=1.2, stopDist=0.8 → rem=0.4; slowRadius=0.8 → speed = 4 * 0.4/0.8 = 2
    const s = arriveStop(0, 0, 1.2, 0, 4, 0.8, 0.8, out());
    expect(s.x).toBeCloseTo(2);
    expect(s.z).toBeCloseTo(0);
  });

  it('ровно в цели → ноль, без NaN', () => {
    const s = arriveStop(2, 2, 2, 2, 4, 0.7, 0.8, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('slowRadius = 0 → полный ход вплоть до кольца, без деления на ноль', () => {
    const s = arriveStop(0, 0, 3, 0, 4, 0.7, 0, out());
    expect(s.x).toBeCloseTo(4);
    expect(Number.isNaN(s.z)).toBe(false);
  });
});

describe('separation', () => {
  it('пустые соседи → ноль', () => {
    const s = separation(0, 0, [], 5, 10, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('сосед за radius игнорируется', () => {
    const s = separation(0, 0, [{ x: 10, z: 0 }], 5, 10, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('толкает прочь от соседа', () => {
    const s = separation(0, 0, [{ x: -1, z: 0 }], 5, 100, out());
    expect(s.x).toBeGreaterThan(0); // сосед слева → нас вправо
    expect(s.z).toBeCloseTo(0);
  });

  it('ближний сосед давит сильнее дальнего (1/dist)', () => {
    const near = separation(0, 0, [{ x: 1, z: 0 }], 5, 100, out());
    const far = separation(0, 0, [{ x: 2, z: 0 }], 5, 100, out());
    expect(len(near)).toBeGreaterThan(len(far));
  });

  it('итог клампится maxPush', () => {
    const s = separation(0, 0, [{ x: 0.01, z: 0 }, { x: 0.01, z: 0.01 }], 5, 3, out());
    expect(len(s)).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('сосед ровно в нашей точке (dist=0) → толчок без NaN', () => {
    const s = separation(2, 2, [{ x: 2, z: 2 }], 5, 3, out());
    expect(Number.isNaN(s.x)).toBe(false);
    expect(Number.isNaN(s.z)).toBe(false);
    expect(len(s)).toBeGreaterThan(0);
    expect(len(s)).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe('avoidObstacles', () => {
  const free = () => null;

  it('без препятствия → ноль', () => {
    const s = avoidObstacles(0, 0, 0, -3, 10, free, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('нулевая скорость → ноль, лучи не пускаются', () => {
    let calls = 0;
    const s = avoidObstacles(0, 0, 0, 0, 10, () => {
      calls += 1;
      return 1;
    }, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
    expect(calls).toBe(0);
  });

  it('стена по курсу: уход вбок на свободную сторону, перпендикулярно скорости, без NaN', () => {
    // движение в −Z; центральный луч бьёт в 2 м, «ус» −30° (dx > 0) тоже упирается,
    // «ус» +30° (dx < 0) свободен → уклоняемся в −X
    const castRay = (_ox: number, _oz: number, dx: number): number | null => {
      if (Math.abs(dx) < 1e-6) return 2;
      return dx < 0 ? null : 1;
    };
    const s = avoidObstacles(0, 0, 0, -3, 10, castRay, out());
    expect(Number.isNaN(s.x)).toBe(false);
    expect(Number.isNaN(s.z)).toBe(false);
    expect(s.x).toBeLessThan(0); // свободная сторона
    expect(s.z).toBeCloseTo(0); // перпендикуляр к (0,−1)
  });

  it('чем ближе препятствие, тем сильнее уклонение', () => {
    const at = (dist: number) => avoidObstacles(0, 0, 0, -3, 10, () => dist, out());
    expect(len(at(2))).toBeGreaterThan(len(at(8)));
  });
});

describe('combineSteering', () => {
  it('взвешенная сумма без клампа', () => {
    const s = combineSteering(
      [
        { s: { x: 1, z: 0 }, w: 2 },
        { s: { x: 0, z: 1 }, w: 1 },
      ],
      100,
      out(),
    );
    expect(s.x).toBeCloseTo(2);
    expect(s.z).toBeCloseTo(1);
  });

  it('клампит длину до maxSpeed, направление сохраняется', () => {
    const s = combineSteering([{ s: { x: 30, z: 40 }, w: 1 }], 5, out());
    expect(len(s)).toBeCloseTo(5);
    expect(s.x / s.z).toBeCloseTo(30 / 40);
  });

  it('пустой список → ноль', () => {
    const s = combineSteering([], 5, out());
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('нулевая сумма не даёт NaN при клампе', () => {
    const s = combineSteering(
      [
        { s: { x: 1, z: 0 }, w: 1 },
        { s: { x: -1, z: 0 }, w: 1 },
      ],
      5,
      out(),
    );
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
  });

  it('out может совпадать с одним из parts[i].s — сумма не портится', () => {
    // AISystem держит слагаемые и результат в скретчах: алиасинг должен быть безопасен
    const a: Steer = { x: 1, z: 2 };
    const parts = [
      { s: a, w: 1 },
      { s: { x: 3, z: -1 }, w: 1 },
    ];
    const s = combineSteering(parts, 100, a);
    expect(s.x).toBeCloseTo(4);
    expect(s.z).toBeCloseTo(1);
  });
});
