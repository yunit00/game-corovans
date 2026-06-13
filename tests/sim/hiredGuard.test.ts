import { describe, expect, it } from 'vitest';
import {
  canHireGuard,
  coerceHiredGuards,
  HIRE_COST,
  isValidHiredGuard,
  MAX_HIRED_GUARDS,
  nextGuardSlot,
  type HiredGuardSave,
} from '../../src/sim/hiredGuard';

describe('hiredGuard: чистая логика найма стражников', () => {
  it('константы баланса: цена 120, лимит 2', () => {
    expect(HIRE_COST).toBe(120);
    expect(MAX_HIRED_GUARDS).toBe(2);
  });

  describe('canHireGuard — хватает ли монет и места', () => {
    it('нанимает, когда монет ≥ цены и есть свободный слот', () => {
      expect(canHireGuard(HIRE_COST, 0)).toBe(true);
      expect(canHireGuard(HIRE_COST, 1)).toBe(true);
      expect(canHireGuard(500, 0)).toBe(true);
    });

    it('отказ при нехватке монет', () => {
      expect(canHireGuard(HIRE_COST - 1, 0)).toBe(false);
      expect(canHireGuard(0, 0)).toBe(false);
    });

    it('отказ при достигнутом лимите, даже с грудой монет', () => {
      expect(canHireGuard(9999, MAX_HIRED_GUARDS)).toBe(false);
      expect(canHireGuard(9999, MAX_HIRED_GUARDS + 1)).toBe(false);
    });
  });

  describe('nextGuardSlot — подбор свободного слота кольца', () => {
    it('пустое кольцо — слот 0', () => {
      expect(nextGuardSlot([])).toBe(0);
    });

    it('возвращает первый незанятый индекс', () => {
      expect(nextGuardSlot([0])).toBe(1);
      expect(nextGuardSlot([1])).toBe(0); // дыра в начале
    });

    it('все слоты заняты — -1 (лимит)', () => {
      expect(nextGuardSlot([0, 1])).toBe(-1);
    });
  });

  describe('isValidHiredGuard — проверка формы записи из сейва', () => {
    it('валидная запись (slot в диапазоне, hp>0)', () => {
      expect(isValidHiredGuard({ slot: 0, hp: 90 })).toBe(true);
      expect(isValidHiredGuard({ slot: 1, hp: 1 })).toBe(true);
    });

    it('отбраковывает слот вне диапазона, павшего, не-числа и не-объекты', () => {
      expect(isValidHiredGuard({ slot: -1, hp: 90 })).toBe(false);
      expect(isValidHiredGuard({ slot: MAX_HIRED_GUARDS, hp: 90 })).toBe(false);
      expect(isValidHiredGuard({ slot: 0, hp: 0 })).toBe(false); // павший
      expect(isValidHiredGuard({ slot: 0, hp: -5 })).toBe(false);
      expect(isValidHiredGuard({ slot: NaN, hp: 90 })).toBe(false);
      expect(isValidHiredGuard({ slot: 0, hp: Infinity })).toBe(false);
      expect(isValidHiredGuard(null)).toBe(false);
      expect(isValidHiredGuard([{ slot: 0, hp: 90 }])).toBe(false);
      expect(isValidHiredGuard('oops')).toBe(false);
    });
  });

  describe('coerceHiredGuards — восстановление списка из сейва', () => {
    it('не-массив → пустой список', () => {
      expect(coerceHiredGuards(undefined)).toEqual([]);
      expect(coerceHiredGuards(null)).toEqual([]);
      expect(coerceHiredGuards({ slot: 0, hp: 90 })).toEqual([]);
    });

    it('валидный список сохраняется как есть', () => {
      const list: HiredGuardSave[] = [{ slot: 0, hp: 90 }, { slot: 1, hp: 40 }];
      expect(coerceHiredGuards(list)).toEqual(list);
    });

    it('отбрасывает битые записи и дубли слотов, обрезает до лимита', () => {
      const dirty = [
        { slot: 0, hp: 50 },
        { slot: 0, hp: 70 }, // дубль слота 0
        { slot: 1, hp: 33 },
        { slot: 1, hp: 99 }, // дубль слота 1
        { slot: 9, hp: 40 }, // вне диапазона
        { slot: 0, hp: 0 }, // павший
        'oops',
      ];
      expect(coerceHiredGuards(dirty)).toEqual([
        { slot: 0, hp: 50 },
        { slot: 1, hp: 33 },
      ]);
    });

    it('никогда не возвращает больше MAX_HIRED_GUARDS', () => {
      const many = [
        { slot: 0, hp: 90 },
        { slot: 1, hp: 90 },
        // если бы кто-то добавил мифический слот 2 — он вне диапазона и отсеется
        { slot: 2, hp: 90 },
      ];
      const out = coerceHiredGuards(many);
      expect(out.length).toBeLessThanOrEqual(MAX_HIRED_GUARDS);
      expect(out).toEqual([{ slot: 0, hp: 90 }, { slot: 1, hp: 90 }]);
    });

    it('сейв-роундтрип: coerce(coerce(x)) стабилен (идемпотентен)', () => {
      const list: HiredGuardSave[] = [{ slot: 1, hp: 12 }, { slot: 0, hp: 88 }];
      const once = coerceHiredGuards(list);
      expect(coerceHiredGuards(once)).toEqual(once);
    });
  });
});
