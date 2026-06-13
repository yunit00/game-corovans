// Музыкальный режиссёр на записанных CC0-треках: проверяем БЕЗ настоящего WebAudio
// (node-окружение) логику выбора сцены и кроссфейда через лёгкие фейки графа.
// Проверяем: ленивый decode каждого трека ровно один раз, переключение мир↔набег
// по событиям шины, ручной вход в меню/игру и кроссфейд (старый слой уводится,
// новый поднимается) без обрыва графа.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/core/EventBus';
import { MusicDirector } from '../../src/audio/music';

/** Минимальный фейк GainNode: ловим вызовы автоматизации, не считаем DSP. */
function makeGain() {
  return {
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

/** Фейк AudioContext: считает созданные узлы и стартованные источники. */
function makeCtx() {
  const sources: { buffer: unknown; loop: boolean; started: boolean; stoppedAt: number | null; onended: (() => void) | null }[] = [];
  const gains: ReturnType<typeof makeGain>[] = [];
  const ctx = {
    currentTime: 0,
    sources,
    gains,
    createGain() {
      const g = makeGain();
      gains.push(g);
      return g;
    },
    createBufferSource() {
      const s = {
        buffer: null as unknown,
        loop: false,
        started: false,
        stoppedAt: null as number | null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(function (this: typeof s) {
          this.started = true;
        }),
        stop: vi.fn(function (this: typeof s, t: number) {
          this.stoppedAt = t;
        }),
      };
      sources.push(s);
      return s;
    },
    decodeAudioData: vi.fn(async () => ({ fake: 'buffer' })),
  };
  return ctx;
}

/** Фейк AudioEngine: отдаёт фейковый контекст и шину music, зовёт whenRunning сразу. */
function makeEngine(ctx: ReturnType<typeof makeCtx>) {
  const out = makeGain();
  return {
    out,
    context: ctx as unknown as AudioContext,
    busGain: (name: string) => (name === 'music' ? (out as unknown as GainNode) : null),
    whenRunning: (fn: () => void) => fn(),
  };
}

/** Подождать, пока отработают зависшие микротаски fetch→decode. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MusicDirector', () => {
  let ctx: ReturnType<typeof makeCtx>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    bus.clear();
    ctx = makeCtx();
    fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    bus.clear();
  });

  it('на старте контекста заводит мирный трек (explore.ogg), зацикленный', async () => {
    new MusicDirector(makeEngine(ctx) as never);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/assets/music/explore.ogg');
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]!.loop).toBe(true);
    expect(ctx.sources[0]!.started).toBe(true);
  });

  it('raid:started → грузит и играет боевой трек, кроссфейдом поверх мирного', async () => {
    new MusicDirector(makeEngine(ctx) as never);
    await flush();
    const exploreSrc = ctx.sources[0]!;

    bus.emit('raid:started', { index: 0 });
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/assets/music/raid.ogg');
    // Новый слой создан и запущен, старый — уведён в тишину (получил stop в будущем)
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[1]!.loop).toBe(true);
    expect(ctx.sources[1]!.started).toBe(true);
    expect(exploreSrc.stoppedAt).not.toBeNull();
    expect(exploreSrc.stoppedAt!).toBeGreaterThan(0);
  });

  it('raid:ended → возврат на мирный трек без повторной загрузки explore', async () => {
    new MusicDirector(makeEngine(ctx) as never);
    await flush();
    bus.emit('raid:started', { index: 0 });
    await flush();
    const fetchesAfterRaid = fetchMock.mock.calls.length;

    bus.emit('raid:ended', { index: 0, victory: true, survived: 3, total: 4 });
    await flush();

    // explore.ogg уже декодирован — fetch на него больше не зовётся
    const exploreCalls = fetchMock.mock.calls.filter((c) => c[0] === '/assets/music/explore.ogg');
    expect(exploreCalls).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(fetchesAfterRaid);
    // Третий слой = снова explore
    expect(ctx.sources).toHaveLength(3);
    expect(ctx.sources[2]!.started).toBe(true);
  });

  it('повторное событие той же сцены — без нового слоя (идемпотентно)', async () => {
    new MusicDirector(makeEngine(ctx) as never);
    await flush();
    bus.emit('raid:started', { index: 0 });
    await flush();
    bus.emit('raid:started', { index: 1 });
    await flush();
    // Второй raid:started на уже играющий боевой слой ничего не добавляет
    expect(ctx.sources).toHaveLength(2);
  });

  it('enterMenu играет тему меню, enterGameplay возвращает к мирной (вне набега)', async () => {
    const dir = new MusicDirector(makeEngine(ctx) as never);
    await flush();

    dir.enterMenu();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/assets/music/menu.ogg');
    expect(ctx.sources).toHaveLength(2);

    dir.enterGameplay();
    await flush();
    // Вернулись к мирному (raid не активен)
    expect(ctx.sources).toHaveLength(3);
  });

  it('enterGameplay после меню в активном набеге возвращает боевой трек, не мирный', async () => {
    const dir = new MusicDirector(makeEngine(ctx) as never);
    await flush();
    bus.emit('raid:started', { index: 0 });
    await flush();
    dir.enterMenu();
    await flush();
    const raidFetchesBefore = fetchMock.mock.calls.filter((c) => c[0] === '/assets/music/raid.ogg').length;

    dir.enterGameplay();
    await flush();

    // Раз набег ещё идёт — возвращаемся на raid.ogg (буфер уже есть, без нового fetch)
    const raidFetchesAfter = fetchMock.mock.calls.filter((c) => c[0] === '/assets/music/raid.ogg').length;
    expect(raidFetchesAfter).toBe(raidFetchesBefore);
    expect(ctx.sources[ctx.sources.length - 1]!.started).toBe(true);
  });

  it('сбой загрузки трека не роняет игру (нет слоя, нет исключения)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    new MusicDirector(makeEngine(ctx) as never);
    await flush();
    expect(ctx.sources).toHaveLength(0);
  });
});
