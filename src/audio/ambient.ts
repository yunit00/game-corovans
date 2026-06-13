// Природная подложка: ветер (общий розовый шум через lowpass с медленным LFO),
// птицы-глиссандо раз в 4–9 с и лёгкие трели сверчков. Ветер — единственный
// постоянный граф, стартует по whenRunning; птицы и сверчки — одноразовые
// узлы по таймерам frame, без setInterval.
import { randInt, randRange, type Rng } from '../core/rng';
import type { AudioEngine } from './AudioEngine';

/** Ветер: базовый срез lowpass и «дыхание» LFO (порывы). */
const WIND_LP_BASE_HZ = 380;
const WIND_LP_LFO_DEPTH_HZ = 160;
const WIND_LFO_HZ = { min: 0.05, max: 0.2 } as const;
const WIND_GAIN = 0.5;
/** Птицы: период чириканья, с; в деревне поют реже — они в лесу, не на площади. */
const BIRD_PERIOD_SEC = { min: 4, max: 9 } as const;
const VILLAGE_BIRD_MUL = 1.7;
/** Глиссандо чирика: диапазон частот и громкость одной ноты. */
const CHIRP_HZ = { min: 2500, max: 4500 } as const;
const CHIRP_GAIN = 0.09;
/** Сверчки: период трелей и громкость импульса («лёгкие» — едва слышны). */
const CRICKET_PERIOD_SEC = { min: 3, max: 7 } as const;
const CRICKET_GAIN = 0.035;

export class AmbientBed {
  private birdLeft = 3;
  private cricketLeft = 6;
  private started = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly rng: Rng,
  ) {
    engine.whenRunning(() => this.startWind());
  }

  /** Покадрово из AudioEngine.frame: таймеры птиц и сверчков. */
  frame(dt: number, inVillage: boolean): void {
    if (!this.engine.running) return;
    this.birdLeft -= dt;
    if (this.birdLeft <= 0) {
      this.chirp();
      this.birdLeft =
        randRange(this.rng, BIRD_PERIOD_SEC.min, BIRD_PERIOD_SEC.max) * (inVillage ? VILLAGE_BIRD_MUL : 1);
    }
    this.cricketLeft -= dt;
    if (this.cricketLeft <= 0) {
      this.trill();
      this.cricketLeft = randRange(this.rng, CRICKET_PERIOD_SEC.min, CRICKET_PERIOD_SEC.max);
    }
  }

  /** Постоянный ветер: ОДИН зацикленный буфер розового шума — без новых буферов. */
  private startWind(): void {
    if (this.started) return;
    this.started = true;
    const ctx = this.engine.context!;
    const out = this.engine.busGain('ambient')!;
    const buf = this.engine.noise('pink');
    if (!buf) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = WIND_LP_BASE_HZ;
    lp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = WIND_GAIN;
    src.connect(lp);
    lp.connect(g);
    g.connect(out);

    // LFO «порывов»: медленно гуляет срез фильтра — ветер дышит, а не гудит ровно
    const lfo = ctx.createOscillator();
    lfo.frequency.value = randRange(this.rng, WIND_LFO_HZ.min, WIND_LFO_HZ.max);
    const depth = ctx.createGain();
    depth.gain.value = WIND_LP_LFO_DEPTH_HZ;
    lfo.connect(depth);
    depth.connect(lp.frequency);
    src.start();
    lfo.start();
  }

  /** Чирик: 2–4 коротких sine-глиссандо со случайным ходом частоты. */
  private chirp(): void {
    const ctx = this.engine.context!;
    const out = this.engine.busGain('ambient')!;
    const notes = randInt(this.rng, 2, 4);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const f0 = randRange(this.rng, CHIRP_HZ.min, CHIRP_HZ.max);
      const f1 = Math.min(CHIRP_HZ.max, Math.max(CHIRP_HZ.min, f0 + randRange(this.rng, -900, 900)));
      const dur = randRange(this.rng, 0.07, 0.13);
      const osc = ctx.createOscillator(); // sine по умолчанию
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.linearRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(CHIRP_GAIN, t + 0.012);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + randRange(this.rng, 0.03, 0.1);
    }
  }

  /** Трель сверчка: 3–5 высоких импульсов одной частоты. */
  private trill(): void {
    const ctx = this.engine.context!;
    const out = this.engine.busGain('ambient')!;
    const pulses = randInt(this.rng, 3, 5);
    const freq = randRange(this.rng, 4200, 4800);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < pulses; i++) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(CRICKET_GAIN, t + 0.006);
      g.gain.linearRampToValueAtTime(0, t + 0.025);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.03);
      t += 0.05;
    }
  }
}
