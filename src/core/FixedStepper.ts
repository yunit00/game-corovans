// Аккумулятор фиксированного шага физики. Чистый класс — покрыт unit-тестами.
export class FixedStepper {
  readonly stepSec: number;
  private acc = 0;

  constructor(hz = 60, private maxSubsteps = 5) {
    this.stepSec = 1 / hz;
  }

  /**
   * Прибавляет dt и вызывает step столько раз, сколько целых шагов накопилось
   * (но не больше maxSubsteps — защита от «спирали смерти» после свича вкладки;
   * лишнее время отбрасывается).
   */
  update(dt: number, step: (stepSec: number) => void): { steps: number; alpha: number } {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.stepSec && steps < this.maxSubsteps) {
      step(this.stepSec);
      this.acc -= this.stepSec;
      steps++;
    }
    if (this.acc >= this.stepSec) this.acc = this.stepSec * 0.999;
    return { steps, alpha: this.acc / this.stepSec };
  }
}
