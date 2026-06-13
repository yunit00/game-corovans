// Мозги простой фауны (Фаза 5.5): автомат проще боевого FSM из sim/fsm.ts.
// Чистый TS — только числа и plain-объекты, без Three/Rapier, тестируется в node.
// Звери декоративные: воюют не друг с другом, а лишь убегают от угрозы (игрок/NPC).
import { mulberry32, type Rng } from '../core/rng';

export type FaunaState = 'graze' | 'wander' | 'flee';

export interface FaunaInputs {
  /** Дистанция до ближайшей угрозы по XZ, м (Infinity — угрозы нет). */
  threatDist: number;
  /** Дошли до точки блуждания (для wander → graze). */
  atWanderPoint: boolean;
  /** Пауза пастьбы истекла (для graze → wander). */
  grazeDone: boolean;
  /** Отбежали на безопасную дистанцию (для flee → graze). */
  safe: boolean;
}

/** Ближе этого зверь срывается в бегство, м. */
export const FLEE_TRIGGER = 9;
/**
 * Дальше этого бегство прекращается, м. Заметно больше FLEE_TRIGGER — гистерезис:
 * иначе на границе срабатывания зверь дёргался бы flee↔graze каждый тик.
 */
export const SAFE_DIST = 28;
/** Радиус точки блуждания вокруг места обитания, м. */
export const WANDER_RADIUS = 15;
/** Точка блуждания достигнута ближе этого, м. */
export const WANDER_DONE_DIST = 1.2;
/** Пауза пастьбы (стоит/ест), с. */
export const GRAZE_MIN = 3;
export const GRAZE_MAX = 8;

/**
 * Переход автомата фауны: бегство — высший приоритет (срывается из любого
 * состояния при близкой угрозе). Чистая функция: таймеры живут в системе,
 * сюда приходят уже как булевы входы.
 */
export function nextFaunaState(cur: FaunaState, inp: FaunaInputs): FaunaState {
  // Угроза рядом — бежим из чего угодно, кроме самого flee (у него свой выход).
  if (cur !== 'flee' && inp.threatDist < FLEE_TRIGGER) return 'flee';

  switch (cur) {
    case 'graze':
      // Угроза близко покрыта выше; иначе отстояли паузу — идём к новой точке.
      return inp.grazeDone ? 'wander' : 'graze';

    case 'wander':
      // Дошли — снова пастись (graze сам заведёт паузу в системе).
      return inp.atWanderPoint ? 'graze' : 'wander';

    case 'flee':
      // Угроза всё ещё близко (< FLEE_TRIGGER) держит во flee; ушли на SAFE_DIST
      // ИЛИ угроза исчезла (safe) — отдышались, возвращаемся к пастьбе.
      if (inp.threatDist < FLEE_TRIGGER) return 'flee';
      return inp.safe ? 'graze' : 'flee';
  }
}

/**
 * Детерминированная точка блуждания в круге radius вокруг (cx, cz). sqrt(rng)
 * по радиусу — равномерно по площади (как у патруля в AISystem). Пишет в out
 * и возвращает его же: вызывающий держит скретч, тик не аллоцирует.
 */
export function wanderPoint(
  rng: Rng,
  cx: number,
  cz: number,
  radius: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const ang = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * radius;
  out.x = cx + Math.sin(ang) * r;
  out.z = cz + Math.cos(ang) * r;
  return out;
}

/** Длительность пастьбы, с — в диапазоне [GRAZE_MIN, GRAZE_MAX]. */
export function grazeDuration(rng: Rng): number {
  return GRAZE_MIN + rng() * (GRAZE_MAX - GRAZE_MIN);
}

// --- Охота (Фаза 6B): зверь становится добычей -------------------------------

export type FaunaSpecies = 'deer' | 'stag' | 'fox';

/**
 * Скорость бегства по виду, м/с. Игрок бегает 5, спринтует 7.6 (PlayerCharacter):
 * лису спринтом НЕ догнать (8.6 > 7.6) — стреляй; оленя/вожака догнать можно
 * (6.0/6.4 < 7.6), но придётся попотеть. Источник истины для FaunaSystem.
 */
export const FLEE_SPEED: Record<FaunaSpecies, number> = { deer: 6.0, stag: 6.4, fox: 8.6 };

/**
 * HP зверя: одно попадание стрелы (≥ её урона) кладёт любого, милишкой — 1–2 удара.
 * Лиса хлипче оленя, но это не важно для стрелы — важно для милишки (один удар
 * кинжалом ≈ 9 свалит лису, оленю нужен второй). Источник истины для урона по фауне.
 */
export const FAUNA_HP: Record<FaunaSpecies, number> = { deer: 14, stag: 16, fox: 10 };

/** Один дроп охоты: id предмета из ITEMS + количество. */
export interface FaunaDrop {
  itemId: string;
  count: number;
}

/**
 * Что падает с добытого зверя ПРЯМО в инвентарь (Game.collectItem с тикером).
 * Олень/вожак — рога + шкура; лиса — ценная шкура; птиц как вида нет (взлетают),
 * перо оставлено в таблице на будущее. Чистые данные — тест сверяет состав.
 */
export const FAUNA_DROPS: Record<FaunaSpecies, readonly FaunaDrop[]> = {
  deer: [
    { itemId: 'deer_antlers', count: 1 },
    { itemId: 'deer_hide', count: 1 },
  ],
  stag: [
    { itemId: 'deer_antlers', count: 1 },
    { itemId: 'deer_hide', count: 1 },
  ],
  fox: [{ itemId: 'fox_pelt', count: 1 }],
};

/**
 * Боковой увод бегущего зверя для зигзага при близкой погоне, м/с. При threatDist
 * ближе ZIGZAG_DIST лиса виляет: к направлению «прочь» добавляется перпендикуляр,
 * меняющий знак с периодом ZIGZAG_PERIOD — рывками вбок, чтобы сбить прицел и не
 * дать срезать угол. Чистая функция от времени: знак = период, амплитуда от близости.
 * Возвращает множитель ∈ [-1, 1] для бокового вектора (perp к направлению бегства).
 */
export const ZIGZAG_DIST = 12;
export const ZIGZAG_PERIOD = 0.45;
export const ZIGZAG_AMPLITUDE = 0.6;

export function zigzagFactor(elapsedSec: number, threatDist: number): number {
  if (threatDist >= ZIGZAG_DIST) return 0; // угроза не вплотную — бежим прямо
  // Близость 0..1: у самой угрозы виляем сильнее, на краю ZIGZAG_DIST — почти нет.
  const closeness = 1 - threatDist / ZIGZAG_DIST;
  // Меандр ±1 по времени: половина периода — вбок в одну сторону, половина — в другую.
  const phase = Math.floor(elapsedSec / ZIGZAG_PERIOD);
  const sign = phase % 2 === 0 ? 1 : -1;
  return sign * closeness * ZIGZAG_AMPLITUDE;
}

// --- Детерминированный спавн фауны -------------------------------------------

export interface FaunaSpawn {
  species: FaunaSpecies;
  x: number;
  z: number;
}

/** Сколько зверей всего на карте (вилка из ТЗ 10–14). */
const HERD_TOTAL_MIN = 10;
const HERD_TOTAL_MAX = 14;
/** Олени держатся группами 2–3 на одной поляне; лиса — одиночка. */
const GROUP_MIN = 2;
const GROUP_MAX = 3;
/** Разброс зверей в группе вокруг центра поляны, м. */
const GROUP_SPREAD = 6;
/** Лимит попыток найти свободный центр поляны — защита от вечного цикла на тесной карте. */
const PLACE_ATTEMPTS = 400;

/**
 * Детерминированный набор зверей на полянах леса. Места выбираются от seed:
 * случайная точка в зоне леса, отсеянная predicate clear (isClear из WorldData
 * + не в форте) — те же поляны, что и у скаттера. Олени/лани идут группами 2–3
 * вокруг центра поляны, лисы — поодиночке. Чистая функция от seed и предиката:
 * Game передаёт реальный clear, тест — свой, и результат воспроизводим.
 *
 * @param halfExtent — половина стороны зоны разброса центров (поляны по всему лесу).
 * @param clear — свободно ли место (вне деревни/дворца/дорог/форта), с запасом margin.
 */
export function planFaunaSpawns(
  seed: number,
  halfExtent: number,
  clear: (x: number, z: number) => boolean,
): FaunaSpawn[] {
  const rng = mulberry32((seed ^ 0xfa0a) >>> 0);
  // Целевое число зверей в [HERD_TOTAL_MIN, HERD_TOTAL_MAX] (включительно).
  const total = HERD_TOTAL_MIN + Math.floor(rng() * (HERD_TOTAL_MAX - HERD_TOTAL_MIN + 1));
  const out: FaunaSpawn[] = [];
  let attempts = 0;

  while (out.length < total && attempts < PLACE_ATTEMPTS) {
    attempts++;
    const cx = (rng() * 2 - 1) * halfExtent;
    const cz = (rng() * 2 - 1) * halfExtent;
    if (!clear(cx, cz)) continue;

    // Лиса (≈30% полян) — одиночка; иначе группа оленей/ланей 2–3 особи.
    if (rng() < 0.3) {
      out.push({ species: 'fox', x: cx, z: cz });
      continue;
    }
    const groupSize = Math.min(
      total - out.length,
      GROUP_MIN + Math.floor(rng() * (GROUP_MAX - GROUP_MIN + 1)),
    );
    for (let i = 0; i < groupSize; i++) {
      const ox = (rng() * 2 - 1) * GROUP_SPREAD;
      const oz = (rng() * 2 - 1) * GROUP_SPREAD;
      const x = cx + ox;
      const z = cz + oz;
      // Особь группы тоже на свободном месте — иначе крайний олень мог бы
      // оказаться на дороге/в деревне у границы поляны.
      if (!clear(x, z)) continue;
      // Stag (вожак) — первый в группе, остальные лани (deer): стадо с одним рогачом.
      out.push({ species: i === 0 ? 'stag' : 'deer', x, z });
    }
  }
  return out;
}
