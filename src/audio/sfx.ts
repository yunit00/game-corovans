// Одноразовые синтезированные эффекты: шумовые burst'ы, частотные свипы и
// простые тоны. Каждый метод тихо выходит, пока нет AudioContext (до первого
// жеста). Узлы create-and-forget: после stop() WebAudio собирает их сам,
// ссылок не храним.
import { randRange, type Rng } from '../core/rng';
import { semitoneRatio } from '../sim/audioSeq';
import type { AudioEngine } from './AudioEngine';
import { TONIC_HZ } from './music';

export class Sfx {
  constructor(
    private readonly engine: AudioEngine,
    private readonly rng: Rng,
  ) {}

  /** Шаг: шумовой burst ~60 мс через lowpass 400–700 Гц (грунт/трава). */
  footstep(): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    const g = this.env(r.ctx, r.out, t, randRange(this.rng, 0.16, 0.24), 0.005, 0.055);
    const lp = r.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = randRange(this.rng, 400, 700);
    lp.connect(g);
    this.noiseBurst(r.ctx, lp, t, 0.08);
  }

  /** Взмах оружия: bandpass-свип шума сверху вниз. */
  swingWoosh(): void {
    this.sweepNoise(1200, 300, 0.16, 0.28);
  }

  /** Прыжок: тот же woosh, но тише и вверх — «воздух подхватил». */
  jumpWoosh(): void {
    this.sweepNoise(350, 900, 0.14, 0.1);
  }

  /** Приземление: мягкий низкий тук (sine 80 Гц + глухой шум). */
  landThud(): void {
    this.thud(80, 0.3, 0.1, 0.16);
  }

  /** Попадание по телу: шум + sine 90 Гц. vol 0..1 — rolloff от слушателя. */
  hitThud(vol = 1): void {
    if (vol <= 0) return;
    this.thud(90, 0.42 * vol, 0.12, 0.22 * vol);
  }

  /** Выстрел арбалета: щелчок спуска + woosh тетивы вверх. */
  crossbowShot(): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    // Щелчок: короткий высокочастотный шум
    const click = this.env(r.ctx, r.out, t, 0.35, 0.002, 0.03);
    const hp = r.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    hp.connect(click);
    this.noiseBurst(r.ctx, hp, t, 0.05);
    // Тетива: быстрый свип полосы вверх
    this.sweepNoise(700, 2000, 0.1, 0.22);
  }

  /** Монета: «динь» sine 1320 → 1760 Гц (скачок на чистую кварту вверх). */
  coin(): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    const osc = r.ctx.createOscillator(); // sine по умолчанию
    osc.frequency.setValueAtTime(1320, t);
    osc.frequency.setValueAtTime(1760, t + 0.06);
    const g = this.env(r.ctx, r.out, t, 0.25, 0.003, 0.35);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  /** Урон игроку: короткий «ох» — saw с падающим питчем + глухой шум. */
  playerHurt(): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    const osc = r.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(90, t + 0.13);
    const lp = r.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const g = this.env(r.ctx, r.out, t, 0.3, 0.01, 0.15);
    osc.connect(lp);
    lp.connect(g);
    osc.start(t);
    osc.stop(t + 0.2);
    const ng = this.env(r.ctx, r.out, t, 0.15, 0.005, 0.06);
    const nlp = r.ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 900;
    nlp.connect(ng);
    this.noiseBurst(r.ctx, nlp, t, 0.08);
  }

  /** Смерть игрока: нисходящее арпеджио d-минора D5→A4→F4→D4. */
  deathSting(): void {
    const r = this.ready();
    if (!r) return;
    const semis = [12, 7, 3, 0];
    for (let i = 0; i < semis.length; i++) {
      const t = r.ctx.currentTime + 0.02 + i * 0.14;
      this.tone(r.ctx, r.out, TONIC_HZ * semitoneRatio(semis[i]!), t, 0.32, 0.5);
    }
  }

  /** Смерть врага: короткий стинг из двух нисходящих нот октавой выше. */
  killSting(vol: number): void {
    if (vol <= 0) return;
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime + 0.02;
    this.tone(r.ctx, r.out, TONIC_HZ * 2 * semitoneRatio(12), t, 0.18 * vol, 0.25);
    this.tone(r.ctx, r.out, TONIC_HZ * 2 * semitoneRatio(7), t + 0.085, 0.18 * vol, 0.25);
  }

  /** Рог набега: пара расстроенных sawtooth 220→330 Гц на 1.2 с с вибрато. */
  raidHorn(): void {
    this.horn(220, 330, 0.4);
  }

  /**
   * Колокол тревоги (явная подача набега): 3 мягких удара сигнального колокола с
   * шагом 0.55 с (по отзывам игроков — прежний был громким и резким). Несущая ниже
   * (~392 Гц, G4), модуляция ГАРМОНИЧНАЯ (ratio 2.0 = октава) с малой глубиной —
   * меньше высоких/негармоничных партиалов, тёплый тон без металлического клацанья.
   * Гейн примерно на треть ниже, затухание длиннее — удары перетекают мягким гулом.
   */
  raidBell(): void {
    const r = this.ready();
    if (!r) return;
    const t0 = r.ctx.currentTime;
    const strikes = 3;
    const step = 0.55;
    for (let i = 0; i < strikes; i++) {
      // Последний удар тише — звон мягко угасает, не обрывается резко.
      const peak = i === strikes - 1 ? 0.32 : 0.4;
      this.bellStrike(r.ctx, r.out, t0 + i * step, 392, peak);
    }
  }

  /**
   * Один удар мягкого колокола в момент when. Несущая carrier с лёгкой ГАРМОНИЧНОЙ
   * частотной модуляцией (ratio 2.0 = октава, малая глубина) — тёплый колокольный
   * тон без негармоничного «металла». Длинное экспоненциальное затухание. Все ноды
   * create-and-forget, после stop() их собирает сам WebAudio (ссылок не храним).
   */
  private bellStrike(
    ctx: AudioContext,
    out: AudioNode,
    when: number,
    carrierHz: number,
    peak: number,
  ): void {
    // Длиннее прежнего (1.6 → 2.4): мягкий, долго тающий хвост вместо резкого звона.
    const decay = 2.4;
    // Несущая: основной тон колокола, экспоненциальное затухание.
    const g = this.env(ctx, out, when, peak, 0.004, decay);
    const carrier = ctx.createOscillator(); // sine
    carrier.frequency.value = carrierHz;

    // Модулятор: ratio 2.0 — чистая октава (гармоника), а не √2: убирает биения и
    // металлический клац. Малая глубина (0.6× против 1.8×) и быстрый спад — лишь
    // тёплый окрас атаки, минимум высоких партиалов.
    const mod = ctx.createOscillator();
    mod.frequency.value = carrierHz * 2.0;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(carrierHz * 0.6, when);
    modGain.gain.exponentialRampToValueAtTime(carrierHz * 0.02, when + decay * 0.35);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    carrier.connect(g);
    carrier.start(when);
    carrier.stop(when + decay + 0.05);
    mod.start(when);
    mod.stop(when + decay + 0.05);

    // Призвук «языка»: тихий октавный партиал (2.0× — гармоника) только на атаке,
    // мягкий и короткий. Тише прежнего (0.18× против 0.4×) и без негармоники 2.76×,
    // чтобы дать чёткость удара без резкого верха.
    const ping = ctx.createOscillator();
    ping.frequency.value = carrierHz * 2.0;
    const pg = this.env(ctx, out, when, peak * 0.18, 0.002, 0.18);
    ping.connect(pg);
    ping.start(when);
    ping.stop(when + 0.28);
  }

  /**
   * Рог корована: тот же синтез, но ниже (D3→G3, в тонике мира) и тише —
   * «торговый выезд», а не тревога набега; игрок различает их на слух.
   */
  caravanHorn(): void {
    this.horn(TONIC_HZ / 2, (TONIC_HZ / 2) * semitoneRatio(5), 0.2);
  }

  /** Общий синтез рога: пара расстроенных sawtooth f0→f1 на 1.2 с с вибрато. */
  private horn(f0: number, f1: number, peak: number): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    const lp = r.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = r.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.12);
    g.gain.setValueAtTime(peak, t + 0.85);
    g.gain.linearRampToValueAtTime(0, t + 1.2);
    lp.connect(g);
    g.connect(r.out);
    // Вибрато подключается к частоте обоих осцилляторов, въезжает не сразу
    const lfo = r.ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = r.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(7, t + 0.5);
    lfo.connect(depth);
    for (const detune of [-7, 7]) {
      const osc = r.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.linearRampToValueAtTime(f1, t + 0.45);
      depth.connect(osc.frequency);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + 1.25);
    }
    lfo.start(t);
    lfo.stop(t + 1.25);
  }

  // ---- Общие кирпичики ----

  /**
   * Контекст и шина; null до первого жеста — метод-вызыватель молчит.
   * Гейт по running, а не по наличию контекста (как в AmbientBed.frame):
   * на suspended-контексте currentTime стоит, stop-время нод никогда не
   * наступает — они копились бы всю сессию и выстрелили бы разом при resume.
   */
  private ready(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.engine.running) return null;
    const ctx = this.engine.context;
    const out = this.engine.busGain('sfx');
    return ctx && out ? { ctx, out } : null;
  }

  /** Гейн-огибающая (линейная атака, экспоненциальное затухание), уже на шине. */
  private env(
    ctx: AudioContext,
    out: AudioNode,
    when: number,
    peak: number,
    attack: number,
    decay: number,
  ): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.001, when + attack + decay);
    g.connect(out);
    return g;
  }

  /**
   * Кусок ОБЩЕГО буфера белого шума (новых буферов не создаём): случайное
   * смещение старта — burst'ы не звучат одинаково; loop страхует край буфера.
   */
  private noiseBurst(ctx: AudioContext, dest: AudioNode, when: number, dur: number): void {
    const buf = this.engine.noise('white');
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    src.start(when, randRange(this.rng, 0, Math.max(0.01, buf.duration - dur - 0.05)));
    src.stop(when + dur);
  }

  /** Woosh: шум через bandpass со свипом частоты f0→f1. */
  private sweepNoise(f0: number, f1: number, dur: number, peak: number): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    const g = this.env(r.ctx, r.out, t, peak, dur * 0.3, dur * 0.9);
    const bp = r.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + dur);
    bp.connect(g);
    this.noiseBurst(r.ctx, bp, t, dur + 0.1);
  }

  /** Тук: sine низкой частоты + глухой шумовой щелчок. */
  private thud(freq: number, toneVol: number, toneDecay: number, noiseVol: number): void {
    const r = this.ready();
    if (!r) return;
    const t = r.ctx.currentTime;
    const osc = r.ctx.createOscillator(); // sine по умолчанию
    osc.frequency.value = freq;
    const g = this.env(r.ctx, r.out, t, toneVol, 0.004, toneDecay);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + toneDecay + 0.05);
    if (noiseVol > 0.01) {
      const ng = this.env(r.ctx, r.out, t, noiseVol, 0.004, 0.05);
      const lp = r.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 450;
      lp.connect(ng);
      this.noiseBurst(r.ctx, lp, t, 0.07);
    }
  }

  /** Нота стинга: triangle с огибающей щипка. */
  private tone(
    ctx: AudioContext,
    out: AudioNode,
    freq: number,
    when: number,
    vel: number,
    decay: number,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = this.env(ctx, out, when, vel, 0.005, decay);
    osc.connect(g);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  }
}
