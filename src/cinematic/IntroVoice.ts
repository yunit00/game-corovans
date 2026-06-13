// Закадровый рассказчик интро-заставки (Фаза 6D, озвучка). Пре-генерированные
// mp3-реплики (по одной на сцену, scripts/generate-intro-voice.ts → ElevenLabs)
// лежат в public/assets/audio/voice/intro/<id>.mp3 и описаны манифестом
// voiceManifest.json ({ id: { src, durationSec } }). На смене сцены IntroCinematic
// зовёт playScene(id) — клип играет на шине voice AudioEngine, музыка мягко
// дакается на время реплики (engine.duckMusic). Титры внизу — отдельно (канон).
//
// ВАЖНО про надёжность (требование задачи): заставка может идти ДО первого жеста,
// когда AudioContext ещё suspended/не создан. Поэтому:
//   • mp3 качаем fetch'ем СРАЗУ при старте (без ctx) — байты в памяти, ArrayBuffer;
//   • decodeAudioData делаем, когда ctx готов (engine.whenRunning), один раз на клип;
//   • если в момент смены сцены клип ещё не декодирован — сцена просто МОЛЧИТ
//     (никаких очередей-догонялок: реплика короче сцены, догонять нечего; глотнуть
//     одну реплику безопаснее, чем играть её внахлёст со следующей сценой).
//   • манифест пуст / файла нет / 404 / ошибка декода — тишина, без ошибок в консоли.
//
// Чистая логика «есть ли клип для сцены» вынесена в hasClip()/manifestSrc() —
// node-тесты дёргают их без WebAudio/DOM (vitest environment: node).

import type { AudioEngine } from '../audio/AudioEngine';
import { assetUrl } from '../core/assetUrl';
import voiceManifest from './voiceManifest.json';

/** Запись манифеста на одну реплику: путь к mp3 и его длительность. */
export interface VoiceClipMeta {
  /** Путь от корня сайта, напр. /assets/audio/voice/intro/hello.mp3. */
  src: string;
  /** Длительность клипа, с (замеряет скрипт генерации; для тестов ≤ длины сцены). */
  durationSec: number;
}

/** Манифест: id сцены → метаданные клипа. Пустой {} до генерации файлов. */
export type VoiceManifest = Record<string, VoiceClipMeta>;

/** Манифест из репо (пустой, пока файлы не сгенерированы). */
export const VOICE_MANIFEST = voiceManifest as VoiceManifest;

// --- Чистая логика (тестируется в node без WebAudio/DOM) ---

/** Есть ли в манифесте запись (а значит и клип) для сцены sceneId. */
export function hasClip(manifest: VoiceManifest, sceneId: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest, sceneId);
}

/** Путь к mp3 для сцены или null (нет записи). */
export function manifestSrc(manifest: VoiceManifest, sceneId: string): string | null {
  return hasClip(manifest, sceneId) ? manifest[sceneId]!.src : null;
}

/** Длительность клипа сцены, с, или null (нет записи). */
export function clipDurationSec(manifest: VoiceManifest, sceneId: string): number | null {
  return hasClip(manifest, sceneId) ? manifest[sceneId]!.durationSec : null;
}

// --- Контроллер воспроизведения (WebAudio; в node не инстанцируется) ---

export class IntroVoice {
  /** Сырые байты клипов по id — скачиваем сразу, до готовности ctx. */
  private readonly fetched = new Map<string, ArrayBuffer>();
  /** Декодированные буферы по id — один раз, когда ctx ожил. */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Сейчас звучащий источник (один — реплики не накладываются). */
  private current: AudioBufferSourceNode | null = null;
  /** Активна ли музыкальная подушка (чтобы поднять её ровно один раз). */
  private ducking = false;
  /** Снят ли контроллер (dispose) — гасит догрузку/декод после конца заставки. */
  private disposed = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly manifest: VoiceManifest = VOICE_MANIFEST,
  ) {}

  /**
   * Старт предзагрузки: качаем все mp3 манифеста СРАЗУ (даже если ctx ещё спит),
   * а декод повесим на готовность контекста. Пустой манифест — мгновенно no-op
   * (заставка молчит). Вызывается из IntroCinematic.play().
   */
  prefetch(): void {
    for (const id of Object.keys(this.manifest)) {
      void this.fetchClip(id);
    }
    // Декодируем уже скачанное, когда контекст оживёт (после первого жеста).
    this.engine.whenRunning(() => this.decodeFetched());
  }

  /** Скачать байты одного клипа (без декода) — graceful при 404/ошибке. */
  private async fetchClip(id: string): Promise<void> {
    const src = manifestSrc(this.manifest, id);
    if (!src || this.fetched.has(id)) return;
    try {
      const res = await fetch(assetUrl(src));
      if (!res.ok) return; // нет файла (репо до генерации) — молча
      const data = await res.arrayBuffer();
      if (this.disposed) return;
      this.fetched.set(id, data);
      // Контекст мог ожить, пока шла загрузка — декодируем сразу.
      if (this.engine.running) void this.decodeClip(id);
    } catch {
      // Сетевая ошибка / нет файла — без музыки реплики, заставка не падает.
    }
  }

  /** Декодировать всё уже скачанное (зовётся при оживлении контекста). */
  private decodeFetched(): void {
    for (const id of this.fetched.keys()) void this.decodeClip(id);
  }

  /** decodeAudioData одного клипа один раз; ошибка декода — молча пропускаем. */
  private async decodeClip(id: string): Promise<void> {
    const ctx = this.engine.context;
    const data = this.fetched.get(id);
    if (!ctx || !data || this.buffers.has(id) || this.disposed) return;
    try {
      // decodeAudioData «съедает» ArrayBuffer — копируем (slice), чтобы повторный
      // вызов (гонка fetch↔whenRunning) не падал на detached-буфере.
      const buf = await ctx.decodeAudioData(data.slice(0));
      if (this.disposed) return;
      this.buffers.set(id, buf);
    } catch {
      // Битый mp3 — эта сцена просто молчит.
    }
  }

  /**
   * Заиграть реплику сцены sceneId (вызов из IntroCinematic на смене сцены/seek).
   * Останавливает предыдущую реплику (реплики не накладываются), затем, если клип
   * декодирован, играет его на шине voice и дакает музыку. Нет клипа/буфера —
   * молчим (никаких очередей: реплика короче сцены, догонять нечего).
   */
  playScene(sceneId: string): void {
    this.stopCurrent();
    if (this.disposed) return;
    const ctx = this.engine.context;
    const out = this.engine.busGain('voice');
    const buf = this.buffers.get(sceneId);
    if (!ctx || !out || !buf) return; // молча (ctx спит / клип не готов / нет файла)

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    // Музыка уходит на фон под голос; вернётся по окончании клипа (onended/stop).
    this.setDucking(true);
    src.onended = () => {
      if (this.current === src) {
        this.current = null;
        this.setDucking(false);
      }
      src.disconnect();
    };
    src.start();
    this.current = src;
  }

  /** Остановить звучащую реплику и вернуть музыку (скип/смена сцены/завершение). */
  stopAll(): void {
    this.stopCurrent();
  }

  /** Полностью снять контроллер: остановить звук, погасить отложенный декод/догрузку. */
  dispose(): void {
    this.disposed = true;
    this.stopCurrent();
  }

  /** Остановить текущий источник (если есть) и снять музыкальную подушку. */
  private stopCurrent(): void {
    const src = this.current;
    this.current = null;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
    this.setDucking(false);
  }

  /** Идемпотентно поднять/опустить музыкальную подушку на шине music. */
  private setDucking(on: boolean): void {
    if (this.ducking === on) return;
    this.ducking = on;
    this.engine.duckMusic(on);
  }
}
