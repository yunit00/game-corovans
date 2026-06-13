// Чистая математика процедурного звука: множитель полутонов (для «в тон» стингов
// sfx) и раскладка слогов «эльфийской» тарабарщины (voice). Без WebAudio — модуль
// тестируется в node на одних числах (tests/sim/audioSeq.test.ts); узлы строит
// src/audio/. Генеративная мелодия/лад и Карплус-Стронг убраны вместе с синтезом
// музыки: фон теперь — записанные CC0-треки (src/audio/music.ts).
import { randInt, randRange, type Rng } from '../core/rng';

/** Множитель частоты для смещения в полутонах (равномерная темперация). */
export function semitoneRatio(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** Границы длительности слога и паузы после него, мс. */
export const SYL_DUR_MS = { min: 70, max: 110 } as const;
export const SYL_GAP_MS = { min: 20, max: 70 } as const;
/** Джиттер питча слога вокруг интонационного контура. */
export const SYL_JITTER = { min: 0.92, max: 1.12 } as const;
/** Куда приходит контур интонации к концу фразы (множитель питча). */
const CONTOUR_RISE_END = 1.3;
const CONTOUR_FALL_END = 0.78;

export interface SyllableSpec {
  durMs: number;
  /** Пауза после слога, мс. */
  gapMs: number;
  /** Интонационный контур без джиттера — тесты проверяют форму фразы по нему. */
  contour: number;
  /** Итоговый множитель питча слога: contour × джиттер. */
  pitchMul: number;
}

export interface PhraseOpts {
  minSyllables: number;
  maxSyllables: number;
  /** Интонация к концу: вверх («вопрос») или вниз («утверждение»). */
  endRise: boolean;
}

export const DEFAULT_PHRASE: PhraseOpts = { minSyllables: 3, maxSyllables: 7, endRise: false };

/** Раскладка фразы тарабарщины: 3–7 слогов с линейным интонационным контуром. */
export function buildPhrase(rng: Rng, opts: PhraseOpts = DEFAULT_PHRASE): SyllableSpec[] {
  const count = randInt(rng, opts.minSyllables, opts.maxSyllables);
  const end = opts.endRise ? CONTOUR_RISE_END : CONTOUR_FALL_END;
  const out: SyllableSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Контур — линейный ход от 1 к end по позиции слога во фразе
    const p = count > 1 ? i / (count - 1) : 1;
    const contour = 1 + (end - 1) * p;
    out.push({
      durMs: randRange(rng, SYL_DUR_MS.min, SYL_DUR_MS.max),
      gapMs: randRange(rng, SYL_GAP_MS.min, SYL_GAP_MS.max),
      contour,
      pitchMul: contour * randRange(rng, SYL_JITTER.min, SYL_JITTER.max),
    });
  }
  return out;
}
