import { describe, expect, it } from 'vitest';
import { canPause, canResume, type PauseContext } from '../../src/sim/pause';

/** Базовый «активная игра, ничего не открыто, не на паузе» — точка мутаций. */
function active(): PauseContext {
  return { started: true, screenOpen: false, menuOpen: false, paused: false };
}

describe('canPause', () => {
  it('в активной игре без экранов/меню и не на паузе — можно', () => {
    expect(canPause(active())).toBe(true);
  });

  it('до старта игры (меню старта) — нельзя', () => {
    expect(canPause({ ...active(), started: false })).toBe(false);
  });

  it('при открытом экране I/P — нельзя (Esc сначала закроет экран)', () => {
    expect(canPause({ ...active(), screenOpen: true })).toBe(false);
  });

  it('при открытом главном меню — нельзя', () => {
    expect(canPause({ ...active(), menuOpen: true })).toBe(false);
  });

  it('уже на паузе — повторно нельзя (идемпотентность Esc + pointerlockchange)', () => {
    expect(canPause({ ...active(), paused: true })).toBe(false);
  });
});

describe('canResume', () => {
  it('на паузе без меню — можно снять', () => {
    expect(canResume({ ...active(), paused: true })).toBe(true);
  });

  it('не на паузе — снимать нечего', () => {
    expect(canResume(active())).toBe(false);
  });

  it('на паузе, но поверх главное меню — «Продолжить» паузы не снимает (рулит startGame)', () => {
    expect(canResume({ ...active(), paused: true, menuOpen: true })).toBe(false);
  });
});
