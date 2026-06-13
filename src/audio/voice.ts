// Тарабарщина в духе Animalese: фразы из коротких слогов (раскладка —
// sim/audioSeq) на square/triangle через bandpass-«формант». Скелеты скрипят
// ниже и с detune-дребезгом, стража говорит «по-человечески». Громкость падает
// с дистанцией до слушателя (rolloff до ROLLOFF_DIST), одновременно звучат не
// больше MAX_VOICES фраз — иначе толпа рейдеров превращается в кашу.
import { randRange, type Rng } from '../core/rng';
import { buildPhrase, type PhraseOpts } from '../sim/audioSeq';
import type { AudioEngine } from './AudioEngine';

export type VoiceKind = 'skeleton' | 'guard';

/** Дальше этого голоса не слышны (линейный rolloff до нуля). */
export const ROLLOFF_DIST = 25;
/** Потолок одновременных фраз. */
const MAX_VOICES = 2;
/** Базовый питч голоса по типу, Гц. */
const PITCH: Record<VoiceKind, { min: number; max: number }> = {
  skeleton: { min: 90, max: 130 },
  guard: { min: 130, max: 180 },
};
/** Полоса «рта»: у каждой фразы свой формант — как разные гласные. */
const FORMANT_HZ = { min: 700, max: 1400 } as const;
const FORMANT_Q = 1.8;
/** Болтовня манекенов: ближе этого, раз в 8–15 с, проверка раз в полсекунды. */
const CHATTER_DIST = 8;
const CHATTER_PERIOD_SEC = { min: 8, max: 15 } as const;
const CHECK_PERIOD_SEC = 0.5;
/** Дребезг скелетов: быстрый LFO на detune, ± центов. */
const RATTLE_CENTS = 35;
const RATTLE_HZ = 26;
/** Предсмертный вскрик: длительность одного длинного слога. */
const CRY_SEC = 0.3;
/** Общий уровень голоса до rolloff. */
const VOICE_GAIN = 0.85;

export class VoiceBox {
  /** Звучащих фраз сейчас; декремент — по setTimeout на конец фразы. */
  private active = 0;
  private checkLeft = CHECK_PERIOD_SEC;
  /** Первая болтовня — вскоре после старта, дальше 8–15 с. */
  private chatterLeft = 5;

  constructor(
    private readonly engine: AudioEngine,
    private readonly rng: Rng,
  ) {}

  /** Покадрово из AudioEngine.frame: болтовня скелетов-манекенов рядом. */
  frame(dt: number, nearestSkeletonDist: number): void {
    this.checkLeft -= dt;
    if (this.checkLeft > 0) return;
    this.checkLeft += CHECK_PERIOD_SEC;
    this.chatterLeft -= CHECK_PERIOD_SEC;
    if (this.chatterLeft <= 0 && nearestSkeletonDist < CHATTER_DIST) {
      this.say('skeleton', nearestSkeletonDist, {
        minSyllables: 3,
        maxSyllables: 7,
        endRise: this.rng() < 0.4,
      });
      this.chatterLeft = randRange(this.rng, CHATTER_PERIOD_SEC.min, CHATTER_PERIOD_SEC.max);
    }
  }

  /** Возглас агро: короткая «вопросительная» фраза вверх, чуть громче болтовни. */
  bark(kind: VoiceKind, dist: number): void {
    this.say(kind, dist, { minSyllables: 2, maxSyllables: 3, endRise: true }, 1.2);
  }

  /** Предсмертный вскрик: один длинный слог — взлёт питча и падение вниз. */
  deathCry(kind: VoiceKind, dist: number): void {
    const ctx = this.engine.context;
    const out = this.engine.busGain('voice');
    // running, не просто наличие контекста: на suspended копились бы ноды (см. Sfx.ready)
    if (!ctx || !out || !this.engine.running || this.active >= MAX_VOICES) return;
    const roll = 1 - dist / ROLLOFF_DIST;
    if (roll <= 0) return;
    const base = randRange(this.rng, PITCH[kind].min, PITCH[kind].max);
    const t = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = kind === 'skeleton' ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(base * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, t + CRY_SEC);
    const bp = this.formant(ctx);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(roll * VOICE_GAIN, t + 0.02);
    g.gain.linearRampToValueAtTime(0, t + CRY_SEC);
    osc.connect(bp);
    bp.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + CRY_SEC + 0.02);
    this.holdVoice((CRY_SEC + 0.05) * 1000);
  }

  /** Фраза тарабарщины: слоги по раскладке audioSeq через общий формант фразы. */
  private say(kind: VoiceKind, dist: number, opts: PhraseOpts, gainMul = 1): void {
    const ctx = this.engine.context;
    const out = this.engine.busGain('voice');
    // running, не просто наличие контекста: на suspended копились бы ноды (см. Sfx.ready)
    if (!ctx || !out || !this.engine.running || this.active >= MAX_VOICES) return;
    const roll = 1 - dist / ROLLOFF_DIST;
    if (roll <= 0) return;

    const syls = buildPhrase(this.rng, opts);
    const base = randRange(this.rng, PITCH[kind].min, PITCH[kind].max);
    const phraseGain = ctx.createGain();
    phraseGain.gain.value = roll * VOICE_GAIN * gainMul;
    const bp = this.formant(ctx);
    bp.connect(phraseGain);
    phraseGain.connect(out);

    // Дребезг скелетов: один LFO на фразу качает detune всех её слогов
    let rattle: GainNode | null = null;
    let lfo: OscillatorNode | null = null;
    if (kind === 'skeleton') {
      lfo = ctx.createOscillator();
      lfo.frequency.value = RATTLE_HZ;
      rattle = ctx.createGain();
      rattle.gain.value = RATTLE_CENTS;
      lfo.connect(rattle);
    }

    let t = ctx.currentTime + 0.03;
    for (const s of syls) {
      const dur = s.durMs / 1000;
      const osc = ctx.createOscillator();
      osc.type = kind === 'skeleton' ? 'square' : 'triangle';
      osc.frequency.value = base * s.pitchMul;
      if (rattle) {
        // Случайный сдвиг + дрожь: костяная челюсть не держит ноту ровно
        osc.detune.value = randRange(this.rng, -RATTLE_CENTS, RATTLE_CENTS);
        rattle.connect(osc.detune);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.012);
      g.gain.setValueAtTime(1, t + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g);
      g.connect(bp);
      osc.start(t);
      osc.stop(t + dur + 0.01);
      t += dur + s.gapMs / 1000;
    }
    if (lfo) {
      lfo.start();
      lfo.stop(t + 0.05);
    }
    this.holdVoice((t - ctx.currentTime) * 1000 + 80);
  }

  private formant(ctx: AudioContext): BiquadFilterNode {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = randRange(this.rng, FORMANT_HZ.min, FORMANT_HZ.max);
    bp.Q.value = FORMANT_Q;
    return bp;
  }

  /** Учёт занятого «горла» на ms миллисекунд (потолок MAX_VOICES). */
  private holdVoice(ms: number): void {
    this.active++;
    setTimeout(() => {
      this.active--;
    }, ms);
  }
}
