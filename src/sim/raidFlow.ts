// Фазовый автомат набега: calm → announce → active → cleared → (announce → …).
// Чистая sim-логика: только числа и plain-объекты, никаких Three/Hud/промисов —
// тестируется в node. Баннеры, спавн юнитов и подсчёт живых делает RaidDirector.
import type { AiState } from './fsm';

/** Пауза между баннером «НАБИГАЮТ!» и первой волной, с. */
export const ANNOUNCE_DURATION_SEC = 3;
/** Первый автонабег после старта игры, с. */
export const FIRST_RAID_DELAY_SEC = 120;
/** Пауза после отбитого набега до следующего announce, с. */
export const NEXT_RAID_DELAY_SEC = 240;
/** Рейдер в flee дальше этого от деревни считается «убежавшим» (см. isRunawayRaider). */
export const RUNAWAY_DIST = 150;

export type RaidPhase = 'calm' | 'announce' | 'active' | 'cleared';

export interface RaidFlow {
  phase: RaidPhase;
  /** Обратный отсчёт фазы: calm/cleared — до announce, announce — до active. */
  timer: number;
  /** Время от начала active — от него считаются delaySec волн. */
  raidT: number;
  /** Сколько волн уже отдано на спавн. */
  wavesSpawned: number;
}

export interface RaidFlowInputs {
  /** Автозапуск набегов по таймеру (false при noraids=1). */
  autoStart: boolean;
  /** delaySec волн текущего плана (см. planRaid). */
  waveDelays: readonly number[];
  /** Живые рейдеры ПЛЮС спавны в полёте: cleared только когда 0. */
  raidersLeft: number;
}

/** Событие тика для RaidDirector. 'wave' — спавнить волну с индексом wavesSpawned-1. */
export type RaidFlowEvent = 'announce' | 'wave' | 'cleared' | null;

export function makeRaidFlow(): RaidFlow {
  return { phase: 'calm', timer: FIRST_RAID_DELAY_SEC, raidT: 0, wavesSpawned: 0 };
}

/** Немедленный announce из любой фазы (debugSpawnRaid) — план волн ставит вызывающий. */
export function forceAnnounce(flow: RaidFlow): void {
  flow.phase = 'announce';
  flow.timer = ANNOUNCE_DURATION_SEC;
  flow.raidT = 0;
  flow.wavesSpawned = 0;
}

/**
 * Шаг автомата: мутирует flow, возвращает не больше одного события за тик.
 * Одного достаточно: волны разнесены на десятки секунд и в один фикс-тик (1/60 с)
 * два события не попадают, а одиночный литерал не аллоцирует список в фикс-цикле.
 */
export function stepRaidFlow(flow: RaidFlow, dt: number, inp: RaidFlowInputs): RaidFlowEvent {
  switch (flow.phase) {
    case 'calm':
    case 'cleared': {
      // noraids=1: таймер заморожен, а не сброшен — ручной startRaid работает всегда
      if (!inp.autoStart) return null;
      flow.timer -= dt;
      if (flow.timer > 0) return null;
      forceAnnounce(flow);
      return 'announce';
    }

    case 'announce': {
      flow.timer -= dt;
      if (flow.timer > 0) return null;
      flow.phase = 'active';
      flow.raidT = 0;
      // Волну 0 (delaySec = 0) отдаём этим же тиком — переход и спавн не расходятся
      return dueWave(flow, inp);
    }

    case 'active': {
      flow.raidT += dt;
      const wave = dueWave(flow, inp);
      if (wave) return wave;
      // Отбито: все волны отданы и не осталось ни живых, ни спавнов в полёте
      if (flow.wavesSpawned >= inp.waveDelays.length && inp.raidersLeft <= 0) {
        flow.phase = 'cleared';
        flow.timer = NEXT_RAID_DELAY_SEC;
        return 'cleared';
      }
      return null;
    }
  }
}

/**
 * «Застрявший» рейдер: убежал в flee дальше RUNAWAY_DIST от деревни. Такого игроку
 * уже не найти — без принудительной смерти набег никогда не стал бы cleared.
 * Только flee: погоню за игроком (chase) на любой дистанции обрывать нельзя.
 */
export function isRunawayRaider(state: AiState, x: number, z: number, cx: number, cz: number): boolean {
  return state === 'flee' && Math.hypot(x - cx, z - cz) > RUNAWAY_DIST;
}

function dueWave(flow: RaidFlow, inp: RaidFlowInputs): RaidFlowEvent {
  const i = flow.wavesSpawned;
  if (i < inp.waveDelays.length && flow.raidT >= inp.waveDelays[i]!) {
    flow.wavesSpawned = i + 1;
    return 'wave';
  }
  return null;
}
