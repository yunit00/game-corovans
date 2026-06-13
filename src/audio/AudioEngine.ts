// Ядро процедурного звука (Фаза 4.5). Всё синтезируется из осцилляторов и шума —
// аудиофайлов в проекте нет (лицензии чисты, офлайн-friendly). AudioContext
// создаётся ЛЕНИВО по первому жесту пользователя (pointerdown/keydown): без
// жеста браузер блокирует звук и пишет warning в консоль, поэтому до жеста
// не существует даже контекста — консоль остаётся чистой.
import { bus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import { LAND_MIN_FALL_VEL } from '../entities/PlayerCharacter';
import { AmbientBed } from './ambient';
import { MusicDirector } from './music';
import { Sfx } from './sfx';
import { ROLLOFF_DIST, VoiceBox, type VoiceKind } from './voice';

export type BusName = 'music' | 'ambient' | 'sfx' | 'voice';

/** Общий потолок громкости. */
const MASTER_GAIN = 0.55;
/** Множитель громкости в паузе (duck): звук слышен, но приглушён. */
const DUCK_MUL = 0.25;
/**
 * Мягкое приглушение ТОЛЬКО шины music на время реплики рассказчика заставки
 * (Фаза 6D, озвучка): музыка уходит на фон под голос, не пропадая совсем.
 * Отдельно от глобального duck() (пауза), чтобы голос не глушил сам себя.
 */
const VOICE_DUCK_MUL = 0.4;
/** Балансы шин: музыка и природа — фон, эффекты и голоса — передний план. */
const BUS_GAIN: Record<BusName, number> = { music: 0.34, ambient: 0.42, sfx: 0.9, voice: 0.8 };
/** Длина зацикленных шумовых буферов, с — дальше повтор неотличим на слух. */
const NOISE_SEC = 2;
/**
 * Темп шагов реактивен от фактической скорости: rate = speed·STEP_RATE_PER_SPEED,
 * с клампом [STEP_RATE_MIN, STEP_RATE_MAX]. На бег (5 м/с) даёт ~3.2 шага/с (как
 * было раньше), на спринт (7.6) — ~4.9: шаги заметно чаще. Прямая зависимость от
 * скорости убирает «одинаковый темп» бега и спринта.
 */
const STEP_RATE_PER_SPEED = 0.64; // 5.0·0.64=3.2 (бег), 7.6·0.64≈4.86 (спринт)
/** Кламп темпа шагов: не реже этого (медленный шаг) и не чаще (на любом бусте скорости). */
const STEP_RATE_MIN = 2.2;
const STEP_RATE_MAX = 5.2;
/** Медленнее этого шаги не звучат (стоим/доводка анимации). */
const STEP_MIN_SPEED = 0.5;
/** Фаза первого шага после остановки: почти сразу, как в жизни. */
const STEP_PHASE_RESET = 0.8;

/** Тембр по архетипу: стража говорит по-человечески, всё остальное — скелеты. */
function voiceKindOf(archetype: string): VoiceKind {
  return archetype.startsWith('guard') ? 'guard' : 'skeleton';
}

/** Снимок кадра для звука — Game заполняет один и тот же объект (без аллокаций). */
export interface AudioFrameInfo {
  /** Ноги игрока — позиция «слушателя». */
  x: number;
  y: number;
  z: number;
  /** Скорость игрока по XZ за последний фикс-шаг. */
  speed: number;
  grounded: boolean;
  /** Вертикальная скорость за последний фикс-шаг, +вверх: >0 в кадре отрыва — прыжок. */
  verticalVel: number;
  /** В этом кадре был воздушный (второй) прыжок — отдельный «вуш» чуть выше тоном. */
  airJumped: boolean;
  /** Скорость падения в момент последнего приземления, м/с (отрицательная). */
  landingVel: number;
  /** Игрок в деревне — птицы поют реже. */
  inVillage: boolean;
  /** Дистанция до ближайшего живого скелета-манекена, м (Infinity — нет). */
  nearestSkeletonDist: number;
}

export class AudioEngine {
  readonly sfx: Sfx;
  readonly music: MusicDirector;
  readonly ambient: AmbientBed;
  readonly voice: VoiceBox;

  /** Позиция слушателя (ноги игрока) — голоса считают rolloff от неё. */
  listenerX = 0;
  listenerY = 0;
  listenerZ = 0;

  muted = false;
  /** Приглушение на паузе (Фаза 6.5): множит мастер на DUCK_MUL поверх мьюта. */
  private ducked = false;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<BusName, GainNode> | null = null;
  private whiteBuf: AudioBuffer | null = null;
  private pinkBuf: AudioBuffer | null = null;
  /** Колбэки «контекст запустился» — модули стартуют свои постоянные источники. */
  private readonly onRunning: (() => void)[] = [];

  /** Аккумулятор фазы шагов: на 1.0 — пора шагнуть. */
  private stepPhase = STEP_PHASE_RESET;
  private wasGrounded = true;

  constructor(private readonly rng: Rng) {
    this.sfx = new Sfx(this, rng);
    this.music = new MusicDirector(this);
    this.ambient = new AmbientBed(this, rng);
    this.voice = new VoiceBox(this, rng);
    // Глобальные звуки-реакции через шину: Game и AISystem только эмитят
    // события, о звуке не знают
    bus.on('raid:incoming', () => this.sfx.raidHorn());
    // Старт набега (первая волна вышла) — набат колокола: явная подача нападения.
    bus.on('raid:started', () => this.sfx.raidBell());
    // Корованы (Фаза 5): мягкий рог на выезд, стинг победы на грабёж —
    // переиспользуем killSting на полной громкости (грабёж всегда «в руках»)
    bus.on('caravan:spawned', () => this.sfx.caravanHorn());
    bus.on('caravan:robbed', () => this.sfx.killSting(1));
    bus.on('player:died', () => this.sfx.deathSting());
    bus.on('player:damaged', () => this.sfx.playerHurt());
    bus.on('enemy:died', (e) => {
      const d = this.distToListener(e.pos.x, e.pos.y, e.pos.z);
      this.voice.deathCry(voiceKindOf(e.archetype), d);
      // Тот же rolloff, что у голосов: смерть за полдеревни не звенит в ухо
      this.sfx.killSting(Math.max(0, 1 - d / ROLLOFF_DIST));
    });
    bus.on('npc:aggro', (e) => {
      this.voice.bark(voiceKindOf(e.archetype), this.distToListener(e.pos.x, e.pos.y, e.pos.z));
    });
  }

  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Гейн шины; null до первого жеста (графа ещё нет). */
  busGain(name: BusName): GainNode | null {
    return this.buses?.[name] ?? null;
  }

  /** Общие зацикленные буферы шума: белый — эффекты, розовый — ветер. */
  noise(kind: 'white' | 'pink'): AudioBuffer | null {
    return kind === 'white' ? this.whiteBuf : this.pinkBuf;
  }

  /** Выполнить, когда контекст запущен (сразу, если уже работает). */
  whenRunning(fn: () => void): void {
    if (this.running) fn();
    else this.onRunning.push(fn);
  }

  /** Дистанция от слушателя до точки — для rolloff голосов и дальних эффектов. */
  distToListener(x: number, y: number, z: number): number {
    return Math.hypot(x - this.listenerX, y - this.listenerY, z - this.listenerZ);
  }

  /** Громкость 0..1 по дистанции до слушателя (линейный спад до ROLLOFF_DIST м). */
  rolloffAt(x: number, y: number, z: number): number {
    return Math.max(0, 1 - this.distToListener(x, y, z) / ROLLOFF_DIST);
  }

  /**
   * Подписка на первый жест пользователя. Слушатели на window: клик по канвасу
   * занят pointer lock'ом, а звуку хватает любого pointerdown/keydown.
   * Синтетика (смоуки диспатчат KeyboardEvent) игнорируется: без user
   * activation контекст застрял бы в suspended с warning'ом в консоли. По той же
   * причине нельзя { once: true } — untrusted-событие потратило бы слушатель,
   * и настоящий жест уже никогда не запустил бы звук; снимаем оба вручную,
   * только когда контекст реально заработал.
   */
  attach(): void {
    const kick = (e: Event): void => {
      if (!e.isTrusted) return;
      this.ensureContext();
      if (this.running) {
        window.removeEventListener('pointerdown', kick);
        window.removeEventListener('keydown', kick);
      }
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
  }

  /** Мьют (клавиша M в Game). Возвращает новое состояние. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMasterGain();
    return this.muted;
  }

  /**
   * Приглушить/вернуть звук на паузе (Фаза 6.5). on=true — мастер падает до
   * DUCK_MUL, on=false — назад. Поверх мьюта: на мьюте звука нет независимо от
   * duck. setTargetAtTime — без щелчка, как у мьюта.
   */
  duck(on: boolean): void {
    this.ducked = on;
    this.applyMasterGain();
  }

  /**
   * Мягко приглушить/вернуть ТОЛЬКО шину music (Фаза 6D): на время реплики
   * рассказчика заставки музыка уходит на фон (×VOICE_DUCK_MUL), потом плавно
   * назад к балансу BUS_GAIN.music. Отдельно от duck() (пауза глушит мастер) —
   * иначе голос на шине voice глушился бы вместе с музыкой. setTargetAtTime —
   * без щелчка, как у мьюта/паузы. До первого жеста (графа нет) — no-op.
   */
  duckMusic(on: boolean): void {
    const music = this.buses?.music;
    if (!this.ctx || !music) return;
    const target = BUS_GAIN.music * (on ? VOICE_DUCK_MUL : 1);
    music.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /** Целевая громкость мастера из текущих флагов мьюта/паузы. */
  private targetMasterGain(): number {
    if (this.muted) return 0;
    return MASTER_GAIN * (this.ducked ? DUCK_MUL : 1);
  }

  /** Плавно подвести мастер к целевой громкости (без щелчка). */
  private applyMasterGain(): void {
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.targetMasterGain(), this.ctx.currentTime, 0.02);
    }
  }

  debugInfo(): { running: boolean; muted: boolean } {
    return { running: this.running, muted: this.muted };
  }

  /** Покадровый драйвер из Game.tick: слушатель, шаги/прыжок, секвенсоры. */
  frame(dt: number, info: AudioFrameInfo): void {
    this.listenerX = info.x;
    this.listenerY = info.y;
    this.listenerZ = info.z;

    // Прыжок/приземление — по смене grounded (в PlayerCharacter не лезем).
    // Гейты по вертикальной скорости — те же, что у анимации приземления:
    // grounded мерцает на кочках/autostep, и без них каждая кочка давала бы
    // ложную пару woosh+thud. Вверх движется только прыжок (сход с края — вниз).
    if (this.wasGrounded && !info.grounded) {
      if (info.verticalVel > 0) this.sfx.jumpWoosh();
    } else if (!this.wasGrounded && info.grounded) {
      if (info.landingVel < LAND_MIN_FALL_VEL) this.sfx.landThud();
    }
    // Воздушный (второй) прыжок: персонаж уже в воздухе, смены grounded нет —
    // отдельный «вуш». Тот же jumpWoosh, чтобы не плодить синтез ради нюанса.
    if (info.airJumped) this.sfx.jumpWoosh();
    this.wasGrounded = info.grounded;

    // Шаги: фаза копит темп прямо от скорости (с клампом), на переполнении — звук.
    if (info.grounded && info.speed > STEP_MIN_SPEED) {
      const rate = Math.max(STEP_RATE_MIN, Math.min(STEP_RATE_MAX, info.speed * STEP_RATE_PER_SPEED));
      this.stepPhase += dt * rate;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.sfx.footstep();
      }
    } else {
      this.stepPhase = STEP_PHASE_RESET;
    }

    this.music.frame(dt);
    this.ambient.frame(dt, info.inVillage);
    this.voice.frame(dt, info.nearestSkeletonDist);
  }

  /** Создание контекста и графа шин — только из обработчика жеста. */
  private ensureContext(): void {
    if (this.ctx) {
      // Повторный жест — просто страховочный resume
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    // Учитываем мьют/duck, если их выставили ещё до первого жеста (контекст создаётся позже).
    this.master.gain.value = this.targetMasterGain();
    this.master.connect(ctx.destination);
    this.buses = {
      music: ctx.createGain(),
      ambient: ctx.createGain(),
      sfx: ctx.createGain(),
      voice: ctx.createGain(),
    };
    for (const name of ['music', 'ambient', 'sfx', 'voice'] as const) {
      this.buses[name].gain.value = BUS_GAIN[name];
      this.buses[name].connect(this.master);
    }
    this.buildNoise(ctx);

    // Скрытая вкладка: rAF стоит (мир заморожен), а setTimeout троттлится до
    // 1 раза/с — lookahead музыки (0.4 с) рвался бы дырами, и поверх замершей
    // игры гудел бы один ветер. Честная пауза всего звука; resume без жеста
    // разрешён — user activation уже была при создании контекста.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume().catch(() => {});
    });

    const fire = (): void => {
      for (const fn of this.onRunning.splice(0)) fn();
    };
    // Контекст из жеста обычно сразу running, но resume — дешёвая страховка
    if (ctx.state === 'running') fire();
    else void ctx.resume().then(fire, () => {});
  }

  /** Белый шум + розовый (фильтр Пола Келлета — дешёвые −3 дБ/октаву для ветра). */
  private buildNoise(ctx: AudioContext): void {
    const len = Math.floor(ctx.sampleRate * NOISE_SEC);
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const pink = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    const p = pink.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const v = this.rng() * 2 - 1;
      w[i] = v;
      b0 = 0.99886 * b0 + v * 0.0555179;
      b1 = 0.99332 * b1 + v * 0.0750759;
      b2 = 0.969 * b2 + v * 0.153852;
      b3 = 0.8665 * b3 + v * 0.3104856;
      b4 = 0.55 * b4 + v * 0.5329522;
      b5 = -0.7616 * b5 - v * 0.016898;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + v * 0.5362) * 0.11;
      b6 = v * 0.115926;
    }
    this.whiteBuf = white;
    this.pinkBuf = pink;
  }
}
