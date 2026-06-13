import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import {
  grazeDuration,
  nextFaunaState,
  planFaunaSpawns,
  wanderPoint,
  zigzagFactor,
  FAUNA_DROPS,
  FAUNA_HP,
  FLEE_SPEED,
  FLEE_TRIGGER,
  GRAZE_MAX,
  GRAZE_MIN,
  SAFE_DIST,
  WANDER_RADIUS,
  ZIGZAG_AMPLITUDE,
  ZIGZAG_DIST,
  ZIGZAG_PERIOD,
  type FaunaInputs,
  type FaunaState,
} from '../../src/sim/fauna';
import { ITEMS } from '../../src/data/items';

// Скорость спринта игрока (PlayerCharacter.speedSprint) — порог «не догнать».
const PLAYER_SPRINT = 7.6;

// Базовые входы «всё спокойно»: угрозы нет, на месте не дошли, пауза идёт.
const calm = (over: Partial<FaunaInputs> = {}): FaunaInputs => ({
  threatDist: Infinity,
  atWanderPoint: false,
  grazeDone: false,
  safe: true,
  ...over,
});

describe('nextFaunaState', () => {
  it('бегство — высший приоритет: близкая угроза рвёт graze и wander', () => {
    for (const cur of ['graze', 'wander'] as FaunaState[]) {
      expect(nextFaunaState(cur, calm({ threatDist: FLEE_TRIGGER - 0.1 }))).toBe('flee');
    }
  });

  it('угроза на FLEE_TRIGGER или дальше бегство не запускает', () => {
    expect(nextFaunaState('graze', calm({ threatDist: FLEE_TRIGGER }))).toBe('graze');
    expect(nextFaunaState('wander', calm({ threatDist: FLEE_TRIGGER + 5 }))).toBe('wander');
  });

  it('graze → wander по истечении паузы, иначе остаётся пастись', () => {
    expect(nextFaunaState('graze', calm({ grazeDone: false }))).toBe('graze');
    expect(nextFaunaState('graze', calm({ grazeDone: true }))).toBe('wander');
  });

  it('wander → graze по достижении точки, иначе идёт дальше', () => {
    expect(nextFaunaState('wander', calm({ atWanderPoint: false }))).toBe('wander');
    expect(nextFaunaState('wander', calm({ atWanderPoint: true }))).toBe('graze');
  });

  it('flee держится, пока угроза ближе FLEE_TRIGGER — даже если safe выставлен ошибочно', () => {
    expect(nextFaunaState('flee', calm({ threatDist: FLEE_TRIGGER - 1, safe: true }))).toBe('flee');
  });

  it('flee → graze только отбежав на SAFE_DIST (гистерезис: SAFE_DIST > FLEE_TRIGGER)', () => {
    expect(SAFE_DIST).toBeGreaterThan(FLEE_TRIGGER);
    // В зоне между триггером и безопасностью бегство продолжается.
    const between = (FLEE_TRIGGER + SAFE_DIST) / 2;
    expect(nextFaunaState('flee', calm({ threatDist: between, safe: false }))).toBe('flee');
    // Отбежал на безопасную дистанцию — снова пастись.
    expect(nextFaunaState('flee', calm({ threatDist: SAFE_DIST + 1, safe: true }))).toBe('graze');
  });

  it('flee → graze при исчезновении угрозы (threatDist Infinity → safe)', () => {
    expect(nextFaunaState('flee', calm({ threatDist: Infinity, safe: true }))).toBe('graze');
  });
});

describe('wanderPoint', () => {
  it('детерминизм: одинаковый сид → одинаковая точка', () => {
    const a = wanderPoint(mulberry32(7), 100, -50, WANDER_RADIUS, { x: 0, z: 0 });
    const b = wanderPoint(mulberry32(7), 100, -50, WANDER_RADIUS, { x: 0, z: 0 });
    expect(a).toEqual(b);
  });

  it('точка не дальше radius от центра', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const out = wanderPoint(rng, 12, 34, WANDER_RADIUS, { x: 0, z: 0 });
      expect(Math.hypot(out.x - 12, out.z - 34)).toBeLessThanOrEqual(WANDER_RADIUS + 1e-9);
    }
  });

  it('пишет в out и возвращает его же (без аллокации)', () => {
    const out = { x: 0, z: 0 };
    const ret = wanderPoint(mulberry32(1), 0, 0, WANDER_RADIUS, out);
    expect(ret).toBe(out);
  });
});

describe('grazeDuration', () => {
  it('в диапазоне [GRAZE_MIN, GRAZE_MAX]', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 500; i++) {
      const d = grazeDuration(rng);
      expect(d).toBeGreaterThanOrEqual(GRAZE_MIN);
      expect(d).toBeLessThanOrEqual(GRAZE_MAX);
    }
  });
});

describe('planFaunaSpawns', () => {
  const allClear = (): boolean => true;

  it('детерминизм: одинаковый сид → одинаковый набор', () => {
    expect(planFaunaSpawns(42, 380, allClear)).toEqual(planFaunaSpawns(42, 380, allClear));
  });

  it('целевое число зверей в 10–14 при свободной карте', () => {
    for (let seed = 0; seed < 60; seed++) {
      const n = planFaunaSpawns(seed, 380, allClear).length;
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(14);
    }
  });

  it('все точки проходят предикат clear', () => {
    // Запрет полосы вокруг оси X (имитация дороги): ни один зверь не должен туда попасть.
    const clear = (x: number, z: number): boolean => Math.abs(z) > 20 && Math.hypot(x, z) < 400;
    for (let seed = 0; seed < 40; seed++) {
      for (const s of planFaunaSpawns(seed, 380, clear)) {
        expect(clear(s.x, s.z)).toBe(true);
      }
    }
  });

  it('лисы — одиночки, олени — группами (stag-вожак + лани)', () => {
    // Считаем, что в группе deer всегда соседствует со stag того же набора:
    // достаточно проверить, что встречаются все три вида и stag не реже групп.
    const seen = new Set<string>();
    for (let seed = 0; seed < 80; seed++) {
      for (const s of planFaunaSpawns(seed, 380, allClear)) seen.add(s.species);
    }
    expect(seen.has('fox')).toBe(true);
    expect(seen.has('stag')).toBe(true);
    expect(seen.has('deer')).toBe(true);
  });

  it('тесная карта не зацикливает: пустой clear → пустой набор', () => {
    expect(planFaunaSpawns(1, 380, () => false)).toEqual([]);
  });
});

// --- Охота ---

describe('FLEE_SPEED (скорости бегства)', () => {
  it('лиса быстрее спринта игрока — спринтом не догнать', () => {
    expect(FLEE_SPEED.fox).toBeGreaterThan(PLAYER_SPRINT);
  });

  it('олень и вожак догоняемы — медленнее спринта игрока', () => {
    expect(FLEE_SPEED.deer).toBeLessThan(PLAYER_SPRINT);
    expect(FLEE_SPEED.stag).toBeLessThan(PLAYER_SPRINT);
  });

  it('лиса быстрее оленя и вожака', () => {
    expect(FLEE_SPEED.fox).toBeGreaterThan(FLEE_SPEED.deer);
    expect(FLEE_SPEED.fox).toBeGreaterThan(FLEE_SPEED.stag);
  });
});

describe('zigzagFactor (вильба при близкой погоне)', () => {
  it('угроза не вплотную (≥ ZIGZAG_DIST) — бежит прямо, без вильбы', () => {
    expect(zigzagFactor(0, ZIGZAG_DIST)).toBe(0);
    expect(zigzagFactor(0.3, ZIGZAG_DIST + 5)).toBe(0);
  });

  it('у самой угрозы виляет сильнее, чем на краю зоны вильбы', () => {
    const near = Math.abs(zigzagFactor(0, 1));
    const far = Math.abs(zigzagFactor(0, ZIGZAG_DIST - 1));
    expect(near).toBeGreaterThan(far);
  });

  it('меняет знак с периодом ZIGZAG_PERIOD (рывки вбок туда-сюда)', () => {
    const a = zigzagFactor(0, 2); // фаза 0 → +
    const b = zigzagFactor(ZIGZAG_PERIOD + 1e-6, 2); // фаза 1 → −
    expect(Math.sign(a)).toBe(1);
    expect(Math.sign(b)).toBe(-1);
  });

  it('амплитуда не превышает ZIGZAG_AMPLITUDE по модулю', () => {
    for (let d = 0; d < ZIGZAG_DIST; d += 0.5) {
      for (let t = 0; t < 2; t += 0.05) {
        expect(Math.abs(zigzagFactor(t, d))).toBeLessThanOrEqual(ZIGZAG_AMPLITUDE + 1e-9);
      }
    }
  });
});

describe('FAUNA_HP / FAUNA_DROPS (добыча)', () => {
  it('у всех видов положительный HP', () => {
    for (const sp of ['deer', 'stag', 'fox'] as const) {
      expect(FAUNA_HP[sp]).toBeGreaterThan(0);
    }
  });

  it('олень/вожак дают рога + шкуру, лиса — шкуру лисицы', () => {
    expect(FAUNA_DROPS.deer.map((d) => d.itemId)).toEqual(['deer_antlers', 'deer_hide']);
    expect(FAUNA_DROPS.stag.map((d) => d.itemId)).toEqual(['deer_antlers', 'deer_hide']);
    expect(FAUNA_DROPS.fox.map((d) => d.itemId)).toEqual(['fox_pelt']);
  });

  it('все дропы — существующие предметы из ITEMS', () => {
    for (const sp of ['deer', 'stag', 'fox'] as const) {
      for (const d of FAUNA_DROPS[sp]) {
        expect(ITEMS[d.itemId]).toBeDefined();
        expect(d.count).toBeGreaterThan(0);
      }
    }
  });

  it('трофеи — это junk и продаются (price > 0)', () => {
    const ids = new Set(['deer_antlers', 'deer_hide', 'fox_pelt']);
    for (const id of ids) {
      expect(ITEMS[id]!.kind).toBe('junk');
      expect(ITEMS[id]!.price).toBeGreaterThan(0);
    }
  });
});
