import { describe, expect, it } from 'vitest';
import {
  ALE_COST,
  formatEta,
  rumorLine,
  rumorTicker,
  tierName,
  type NextCaravanInfo,
} from '../../src/sim/tavern';

describe('tavern: слухи трактирщика', () => {
  it('цена эля — 10 монет', () => {
    expect(ALE_COST).toBe(10);
  });

  describe('tierName', () => {
    it('переводит тиры на русский', () => {
      expect(tierName('royal')).toBe('королевский');
      expect(tierName('merchant')).toBe('купеческий');
      expect(tierName('poor')).toBe('бедняцкий');
    });
  });

  describe('formatEta', () => {
    it('меньше 10 с — «вот-вот»', () => {
      expect(formatEta(0)).toBe('вот-вот');
      expect(formatEta(9)).toBe('вот-вот');
    });
    it('меньше минуты — секунды', () => {
      expect(formatEta(25)).toBe('через 25 с');
      expect(formatEta(59)).toBe('через 59 с');
    });
    it('ровно минута — без секунд', () => {
      expect(formatEta(60)).toBe('через 1 мин');
      expect(formatEta(120)).toBe('через 2 мин');
    });
    it('минуты и секунды', () => {
      expect(formatEta(80)).toBe('через 1 мин 20 с');
      expect(formatEta(135)).toBe('через 2 мин 15 с');
    });
    it('отрицательное время не ломает формат (клампится в 0)', () => {
      expect(formatEta(-5)).toBe('вот-вот');
    });
    it('дробные секунды округляются', () => {
      expect(formatEta(24.6)).toBe('через 25 с');
    });
  });

  describe('rumorLine', () => {
    it('всегда начинается с «ставишь трактирщику кружку эля» — механика угощения читается', () => {
      const toast = 'Ты ставишь трактирщику кружку эля.';
      expect(rumorLine(null).startsWith(toast)).toBe(true);
      expect(rumorLine({ tier: 'royal', secondsLeft: 30 }).startsWith(toast)).toBe(true);
      expect(rumorLine({ tier: 'merchant', secondsLeft: 30 }).startsWith(toast)).toBe(true);
    });

    it('null — берёт кружку, но новостей нет', () => {
      const line = rumorLine(null);
      expect(line).toContain('кружку эля');
      expect(line).toContain('тихо');
      expect(line.length).toBeGreaterThan(0);
    });

    it('королевский обоз — отдельная «сочная» реплика с упоминанием королевского', () => {
      const info: NextCaravanInfo = { tier: 'royal', secondsLeft: 90 };
      const line = rumorLine(info);
      expect(line).toContain('подмигивает');
      expect(line).toContain('КОРОЛЕВСКИЙ');
      expect(line).toContain('через 1 мин 30 с');
    });

    it('купеческий обоз — обычная реплика с тиром и временем', () => {
      const info: NextCaravanInfo = { tier: 'merchant', secondsLeft: 40 };
      const line = rumorLine(info);
      expect(line).toContain('подмигивает');
      expect(line).toContain('купеческий');
      expect(line).toContain('через 40 с');
      expect(line).not.toContain('КОРОЛЕВСКИЙ');
    });

    it('бедняцкий обоз — обычная реплика', () => {
      const info: NextCaravanInfo = { tier: 'poor', secondsLeft: 12 };
      const line = rumorLine(info);
      expect(line).toContain('бедняцкий');
      expect(line).toContain('через 12 с');
    });
  });

  describe('rumorTicker', () => {
    it('null — короткая строка про отсутствие новостей', () => {
      expect(rumorTicker(null)).toContain('пока нет');
    });
    it('обычный обоз — суть в одну строку: тир + время', () => {
      const t = rumorTicker({ tier: 'merchant', secondsLeft: 65 });
      expect(t).toContain('купеческий');
      expect(t).toContain('через 1 мин 5 с');
    });
    it('королевский — тикер тоже называет тир', () => {
      const t = rumorTicker({ tier: 'royal', secondsLeft: 5 });
      expect(t).toContain('королевский');
      expect(t).toContain('вот-вот');
    });
  });
});
