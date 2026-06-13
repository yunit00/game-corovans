import { describe, expect, it } from 'vitest';
import { attackSlotAngle, attackStandoff, type Steer } from '../../src/sim/steering';

const TAU = Math.PI * 2;
const out = (): Steer => ({ x: NaN, z: NaN });
// Нормализуем угол в [0, 2π) — для сравнения секторов кольца
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

describe('attackSlotAngle: распределение атакующих по кольцу', () => {
  it('от базового угла зависит детерминированно (один id → один угол)', () => {
    const base = 0.7;
    expect(attackSlotAngle(3, base)).toBe(attackSlotAngle(3, base));
  });

  it('id=0 даёт базовый угол (боец встаёт там, откуда подошёл)', () => {
    const base = 1.234;
    expect(attackSlotAngle(0, base)).toBeCloseTo(base);
  });

  it('три атакующих с разными id расходятся по разным секторам кольца', () => {
    const base = 0;
    const a = wrap(attackSlotAngle(0, base));
    const b = wrap(attackSlotAngle(1, base));
    const c = wrap(attackSlotAngle(2, base));
    // Никакие двое не встают в один сектор: попарная угловая разница заметна
    const sep = (p: number, q: number): number => {
      const d = Math.abs(p - q) % TAU;
      return Math.min(d, TAU - d);
    };
    expect(sep(a, b)).toBeGreaterThan(0.5); // > ~29°
    expect(sep(b, c)).toBeGreaterThan(0.5);
    expect(sep(a, c)).toBeGreaterThan(0.5);
  });

  it('многие бойцы заполняют кольцо равномерно (нет пустых половин)', () => {
    // 8 атакующих: каждый сектор-четверть круга должен быть занят хотя бы раз
    const quadrants = [0, 0, 0, 0];
    for (let id = 0; id < 8; id++) {
      const q = Math.floor(wrap(attackSlotAngle(id, 0)) / (Math.PI / 2)) % 4;
      quadrants[q]! += 1;
    }
    for (const n of quadrants) expect(n).toBeGreaterThan(0);
  });

  it('базовый угол поворачивает всё кольцо целиком (слоты сдвигаются на ту же величину)', () => {
    const d = attackSlotAngle(5, 1) - attackSlotAngle(5, 0);
    expect(d).toBeCloseTo(1);
  });
});

describe('attackStandoff: точка стояния на кольце вокруг цели', () => {
  it('точка лежит на расстоянии standoff от цели', () => {
    const tx = 4;
    const tz = -2;
    const s = attackStandoff(tx, tz, 0.9, 3, out());
    expect(Math.hypot(s.x - tx, s.z - tz)).toBeCloseTo(3);
  });

  it('конвенция направления atan2(x, z): угол 0 → +Z, π/2 → +X', () => {
    const z0 = attackStandoff(0, 0, 0, 2, out());
    expect(z0.x).toBeCloseTo(0);
    expect(z0.z).toBeCloseTo(2);
    const x0 = attackStandoff(0, 0, Math.PI / 2, 2, out());
    expect(x0.x).toBeCloseTo(2);
    expect(x0.z).toBeCloseTo(0);
  });

  it('пишет в out и возвращает его же (контракт без аллокаций)', () => {
    const o = out();
    expect(attackStandoff(1, 1, 0.5, 2, o)).toBe(o);
  });

  it('три бойца с разными слотами встают в РАЗНЫХ точках вокруг цели', () => {
    const base = Math.atan2(0 - 5, -3 - 5); // как в AISystem: цель → атакующий
    const p0 = attackStandoff(5, 5, attackSlotAngle(0, base), 2, out());
    const p1 = attackStandoff(5, 5, attackSlotAngle(1, base), 2, out());
    const p2 = attackStandoff(5, 5, attackSlotAngle(2, base), 2, out());
    const dist = (a: Steer, b: Steer): number => Math.hypot(a.x - b.x, a.z - b.z);
    // Точки разнесены минимум на метр — это и есть «не слипаются в одну точку»
    expect(dist(p0, p1)).toBeGreaterThan(1);
    expect(dist(p1, p2)).toBeGreaterThan(1);
    expect(dist(p0, p2)).toBeGreaterThan(1);
  });
});
