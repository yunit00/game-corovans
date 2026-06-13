// Тесты озвучки интро-заставки (Фаза 6D). environment: node — без WebAudio/DOM,
// поэтому проверяем:
//   1) согласованность ключей VOICE_LINES с id сцен SCENES (полнота реплик);
//   2) чистую логику манифеста (hasClip/manifestSrc/clipDurationSec);
//   3) контроллер IntroVoice на МОКЕ AudioEngine: смена сцены играет нужный клип,
//      stopAll/dispose останавливают и снимают музыкальную подушку, пустой манифест
//      молчит;
//   4) (по манифесту) длительность реплики ≤ длины сцены — на пустом манифесте скип.

import { describe, expect, it, vi } from 'vitest';
import { SCENES, totalDurationSec } from '../../src/cinematic/storyboard';
import { VOICE_LINES } from '../../src/cinematic/voiceLines';
import {
  IntroVoice,
  VOICE_MANIFEST,
  hasClip,
  manifestSrc,
  clipDurationSec,
  type VoiceManifest,
} from '../../src/cinematic/IntroVoice';

// --- Задача 1: ключи реплик == id сцен ---

describe('voiceLines: согласованность с раскадровкой', () => {
  it('ключи VOICE_LINES ровно совпадают с id SCENES', () => {
    const sceneIds = SCENES.map((s) => s.id).sort();
    const lineKeys = Object.keys(VOICE_LINES).sort();
    expect(lineKeys).toEqual(sceneIds);
  });

  it('у каждой сцены есть непустая реплика', () => {
    for (const s of SCENES) {
      expect(VOICE_LINES[s.id], `реплика для сцены ${s.id}`).toBeTruthy();
      expect(VOICE_LINES[s.id]!.trim().length).toBeGreaterThan(0);
    }
  });
});

// --- Чистая логика манифеста ---

describe('IntroVoice: чистая логика манифеста', () => {
  const manifest: VoiceManifest = {
    hello: { src: '/assets/audio/voice/intro/hello.mp3', durationSec: 5.5 },
  };

  it('hasClip/manifestSrc/clipDurationSec по записи', () => {
    expect(hasClip(manifest, 'hello')).toBe(true);
    expect(manifestSrc(manifest, 'hello')).toBe('/assets/audio/voice/intro/hello.mp3');
    expect(clipDurationSec(manifest, 'hello')).toBe(5.5);
  });

  it('нет записи — false/null (graceful)', () => {
    expect(hasClip(manifest, 'village')).toBe(false);
    expect(manifestSrc(manifest, 'village')).toBeNull();
    expect(clipDurationSec(manifest, 'village')).toBeNull();
  });

  it('манифест в репо ссылается только на существующие сцены', () => {
    // До генерации манифест пуст, после — заполнен скриптом; в обоих состояниях
    // каждый ключ обязан совпадать с id сцены (битых записей не бывает).
    const sceneIds = new Set(SCENES.map((s) => s.id));
    for (const key of Object.keys(VOICE_MANIFEST)) {
      expect(sceneIds.has(key), `клип «${key}» без сцены`).toBe(true);
    }
  });
});

// --- Контроллер на моке AudioEngine ---

/**
 * Мок шины и контекста WebAudio: фиксируем созданные источники и duck музыки.
 * Достаточно интерфейса, который дёргает IntroVoice (createBufferSource/start/stop,
 * busGain('voice'), duckMusic, context/running/whenRunning).
 */
function makeEngineMock(opts: { running: boolean }) {
  interface MockSource {
    buffer: unknown;
    started: boolean;
    stopped: boolean;
    onended: (() => void) | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start(): void;
    stop(): void;
  }
  const sources: MockSource[] = [];
  const voiceBus = { connect: vi.fn() };
  const ctx = {
    createBufferSource(): MockSource {
      const src: MockSource = {
        buffer: null,
        started: false,
        stopped: false,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start() {
          src.started = true;
        },
        stop() {
          src.stopped = true;
        },
      };
      sources.push(src);
      return src;
    },
  };
  const duckMusic = vi.fn();
  const runningCbs: Array<() => void> = [];
  const engine = {
    running: opts.running,
    context: opts.running ? ctx : null,
    busGain: (name: string) => (name === 'voice' && opts.running ? voiceBus : null),
    duckMusic,
    whenRunning(fn: () => void) {
      if (opts.running) fn();
      else runningCbs.push(fn);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { engine: engine as any, sources, duckMusic, voiceBus, runningCbs };
}

describe('IntroVoice: воспроизведение (мок WebAudio)', () => {
  const manifest: VoiceManifest = {
    hello: { src: '/x/hello.mp3', durationSec: 5 },
    village: { src: '/x/village.mp3', durationSec: 6 },
  };

  it('playScene с готовым буфером играет клип на шине voice и дакает музыку', () => {
    const m = makeEngineMock({ running: true });
    const voice = new IntroVoice(m.engine, manifest);
    // Подсунем декодированный буфер вручную (минуя fetch/decode — их в node нет).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (voice as any).buffers.set('hello', { fake: 'buf' });

    voice.playScene('hello');

    expect(m.sources).toHaveLength(1);
    expect(m.sources[0]!.started).toBe(true);
    // Источник подключён ИМЕННО к шине voice (src.connect(out)).
    expect(m.sources[0]!.connect).toHaveBeenCalledWith(m.voiceBus);
    expect(m.duckMusic).toHaveBeenLastCalledWith(true);
  });

  it('нет буфера для сцены — молчит (никаких источников, музыку не дакает)', () => {
    const m = makeEngineMock({ running: true });
    const voice = new IntroVoice(m.engine, manifest);
    voice.playScene('village'); // буфер не положили — клип не готов
    expect(m.sources).toHaveLength(0);
    expect(m.duckMusic).not.toHaveBeenCalledWith(true);
  });

  it('смена сцены останавливает предыдущую реплику и запускает новую', () => {
    const m = makeEngineMock({ running: true });
    const voice = new IntroVoice(m.engine, manifest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (voice as any).buffers.set('hello', { f: 1 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (voice as any).buffers.set('village', { f: 2 });

    voice.playScene('hello');
    voice.playScene('village');

    expect(m.sources).toHaveLength(2);
    expect(m.sources[0]!.stopped).toBe(true); // прошлую остановили
    expect(m.sources[1]!.started).toBe(true); // новую запустили
  });

  it('stopAll глушит реплику и возвращает музыку', () => {
    const m = makeEngineMock({ running: true });
    const voice = new IntroVoice(m.engine, manifest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (voice as any).buffers.set('hello', { f: 1 });

    voice.playScene('hello');
    m.duckMusic.mockClear();
    voice.stopAll();

    expect(m.sources[0]!.stopped).toBe(true);
    expect(m.duckMusic).toHaveBeenLastCalledWith(false); // музыка вернулась
  });

  it('dispose после конца заставки — playScene больше не звучит', () => {
    const m = makeEngineMock({ running: true });
    const voice = new IntroVoice(m.engine, manifest);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (voice as any).buffers.set('hello', { f: 1 });

    voice.dispose();
    voice.playScene('hello');
    expect(m.sources).toHaveLength(0);
  });

  it('пустой манифест: prefetch ничего не качает, playScene молчит', () => {
    const m = makeEngineMock({ running: false });
    const voice = new IntroVoice(m.engine, {});
    voice.prefetch();
    voice.playScene('hello');
    expect(m.sources).toHaveLength(0);
  });
});

// --- Длительность реплики ≤ длины сцены (по манифесту; пустой — скип) ---

describe('IntroVoice: реплика не залезает на следующую сцену', () => {
  const entries = Object.entries(VOICE_MANIFEST);
  const test = entries.length > 0 ? it : it.skip;

  test('каждый клип короче своей сцены', () => {
    for (const [id, meta] of entries) {
      const scene = SCENES.find((s) => s.id === id);
      expect(scene, `сцена для клипа ${id}`).toBeDefined();
      expect(meta.durationSec).toBeLessThanOrEqual(scene!.durationSec);
    }
  });

  it('сумма реплик не превышает хронометраж заставки (sanity)', () => {
    const sumClips = entries.reduce((s, [, m]) => s + m.durationSec, 0);
    expect(sumClips).toBeLessThanOrEqual(totalDurationSec(SCENES));
  });
});
