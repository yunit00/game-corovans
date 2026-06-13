// Музыкальный фон — НАСТОЯЩИЕ записанные треки (CC0), а не синтез. Игрок забраковал
// и осцилляторный «8-битный» синтез, и Карплус-Стронг («роботизированно»), поэтому
// здесь живая средневековая музыка автора RandomMind с OpenGameArt (лицензия CC0,
// см. scripts/fetch-assets.sh): мирный лютнево-флейтовый трек для исследования и
// напряжённый боевой для набега. Файлы в public/assets/music/ грузятся лениво после
// первого жеста (decodeAudioData), играются зацикленными AudioBufferSourceNode на
// шине music (тише природы — баланс в AudioEngine.BUS_GAIN). Переключение
// мир↔набег (raid:started → raid:ended) — кроссфейд равной мощности на ~2.5 с.
import { assetUrl } from '../core/assetUrl';
import { bus } from '../core/EventBus';
import type { AudioEngine } from './AudioEngine';

/**
 * Тоника лютневого регистра (D4). Раньше отсюда синтезировалась музыка; теперь
 * музыка — файлы, но sfx.ts держит свои стинги «в тон» именно по этой частоте,
 * поэтому константа остаётся точкой согласования высоты эффектов.
 */
export const TONIC_HZ = 293.66;

/** Пути треков на шине music. Сцена → файл; грузятся по требованию. */
const TRACKS = {
  /** Мирное исследование: лютня + флейта (The Bard's Tale, RandomMind, CC0). */
  explore: '/assets/music/explore.ogg',
  /** Набег/бой: напряжённая боевая тема (Medieval: Battle, RandomMind, CC0). */
  raid: '/assets/music/raid.ogg',
  /** Главное меню (опционально): The Old Tower Inn, RandomMind, CC0. */
  menu: '/assets/music/menu.ogg',
} as const;

export type MusicScene = keyof typeof TRACKS;

/** Длительность кроссфейда между сценами, с — плавно, без рывка. */
const CROSSFADE_SEC = 2.5;
/** Очень короткий фейд при первом запуске трека — чтобы не было щелчка атаки. */
const FADE_IN_SEC = 1.2;
/** Тихий фейд-аут при остановке слоя — узел потом отпускаем. */
const FADE_OUT_SEC = 1.0;

/** Один зацикленный музыкальный слой: source → gain → шина music. */
interface Layer {
  scene: MusicScene;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class MusicDirector {
  private raidMode = false;
  /** Текущая желаемая сцена (то, что должно звучать «сейчас»). */
  private scene: MusicScene = 'explore';
  private started = false;

  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  /** Декодированные буферы по сцене — декодируем один раз, лениво. */
  private readonly buffers = new Map<MusicScene, AudioBuffer>();
  /** Идёт ли decode конкретной сцены (чтобы не дёргать fetch дважды). */
  private readonly loading = new Set<MusicScene>();
  /** Активный слой (звучащий трек). Null до первого запуска. */
  private current: Layer | null = null;

  constructor(private readonly engine: AudioEngine) {
    bus.on('raid:started', () => {
      this.raidMode = true;
      this.applyScene();
    });
    bus.on('raid:ended', () => {
      this.raidMode = false;
      this.applyScene();
    });
    engine.whenRunning(() => this.start());
  }

  /**
   * Покадрово из AudioEngine.frame. Кроссфейды живут на таймлайне WebAudio
   * (setTargetAtTime по ctx.currentTime), поэтому здесь делать нечего —
   * метод оставлен для единообразия с другими аудио-модулями.
   */
  frame(_dt: number): void {}

  /** Открыли главное меню поверх игры — играем спокойную тему меню. */
  enterMenu(): void {
    this.setScene('menu');
  }

  /**
   * Вернулись в игру (старт/продолжить): сцену выбирает текущий режим набега,
   * чтобы не оборвать боевую тему, если меню открывали посреди набега.
   */
  enterGameplay(): void {
    this.applyScene();
  }

  /** Сменить сцену: идемпотентно, до старта контекста просто запоминаем. */
  private setScene(scene: MusicScene): void {
    if (this.scene === scene) return;
    this.scene = scene;
    if (this.started) this.transitionTo(scene);
  }

  /** Контекст ожил — запоминаем граф и заводим первый трек. */
  private start(): void {
    if (this.started) return;
    this.started = true;
    this.ctx = this.engine.context;
    this.out = this.engine.busGain('music');
    if (!this.ctx || !this.out) return;
    this.transitionTo(this.scene);
  }

  /** Желаемая сцена из режима набега; переключаем, если контекст уже играет. */
  private applyScene(): void {
    const want: MusicScene = this.raidMode ? 'raid' : 'explore';
    this.scene = want;
    if (this.started) this.transitionTo(want);
  }

  /**
   * Перейти на сцену: лениво декодировать буфер (если ещё нет) и кроссфейдом
   * сменить активный слой. Если буфер ещё грузится — по готовности повторно
   * проверим, что сцена всё ещё актуальна (за время decode могли переключить).
   */
  private transitionTo(scene: MusicScene): void {
    const buf = this.buffers.get(scene);
    if (buf) {
      this.swapLayer(scene, buf);
      return;
    }
    void this.decode(scene).then((decoded) => {
      // За время сетевого decode сцена могла снова смениться — играем актуальную.
      if (decoded && this.scene === scene) this.swapLayer(scene, decoded);
    });
  }

  /** Скачать и декодировать трек один раз; повторные вызовы переиспользуют буфер. */
  private async decode(scene: MusicScene): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    const cached = this.buffers.get(scene);
    if (cached) return cached;
    if (this.loading.has(scene)) return null;
    this.loading.add(scene);
    try {
      const res = await fetch(assetUrl(TRACKS[scene]));
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(data);
      this.buffers.set(scene, buf);
      return buf;
    } catch {
      // Нет файла / ошибка декода — молча без музыки, игра не падает.
      return null;
    } finally {
      this.loading.delete(scene);
    }
  }

  /**
   * Кроссфейд на новый слой: поднять громкость нового от 0, опустить старый в 0
   * и отпустить его. Если уже играет та же сцена — ничего не делаем (на тот же
   * буфер кроссфейдиться незачем).
   */
  private swapLayer(scene: MusicScene, buf: AudioBuffer): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!ctx || !out) return;
    if (this.current && this.current.scene === scene) return;

    const now = ctx.currentTime;
    const fadeIn = this.current ? CROSSFADE_SEC : FADE_IN_SEC;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    // setTargetAtTime: плавный экспоненциальный подъём без щелчка; tau = fade/3
    // даёт ~95% громкости к концу окна кроссфейда.
    gain.gain.setTargetAtTime(1, now, fadeIn / 3);
    gain.connect(out);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start(now);

    if (this.current) this.fadeOutLayer(this.current, CROSSFADE_SEC);
    this.current = { scene, src, gain };
  }

  /** Увести слой в тишину за fade секунд и остановить источник (узлы освободятся). */
  private fadeOutLayer(layer: Layer, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    layer.gain.gain.cancelScheduledValues(now);
    layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
    layer.gain.gain.setTargetAtTime(0, now, fade / 3);
    // Останавливаем с запасом после фейда; onended отцепит граф.
    const stopAt = now + fade + FADE_OUT_SEC;
    try {
      layer.src.stop(stopAt);
    } catch {
      // already stopped
    }
    layer.src.onended = () => {
      layer.src.disconnect();
      layer.gain.disconnect();
    };
  }
}
