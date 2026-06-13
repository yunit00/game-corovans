import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/core/FixedStepper';

describe('FixedStepper', () => {
  it('60 Гц: 50 мс → 3 шага, остаток в alpha', () => {
    const s = new FixedStepper(60, 5);
    let calls = 0;
    const { steps, alpha } = s.update(0.05, () => calls++);
    expect(steps).toBe(3);
    expect(calls).toBe(3);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('кап подшагов: после простоя вкладки не делает 120 шагов', () => {
    const s = new FixedStepper(60, 5);
    let calls = 0;
    const { steps } = s.update(2.0, () => calls++);
    expect(steps).toBe(5);
    expect(calls).toBe(5);
  });

  it('после капа аккумулятор не накапливает долг бесконечно', () => {
    const s = new FixedStepper(60, 5);
    s.update(10, () => {});
    const { steps } = s.update(0.001, () => {});
    // долг сброшен почти до нуля — максимум 1 шаг
    expect(steps).toBeLessThanOrEqual(1);
  });

  it('мелкие dt аккумулируются до целого шага', () => {
    const s = new FixedStepper(60, 5);
    let calls = 0;
    for (let i = 0; i < 10; i++) s.update(1 / 600, () => calls++);
    expect(calls).toBe(1);
  });

  it('шаг всегда ровно 1/hz', () => {
    const s = new FixedStepper(50, 5);
    const dts: number[] = [];
    s.update(0.1, (d) => dts.push(d));
    expect(dts.every((d) => d === 1 / 50)).toBe(true);
  });
});
