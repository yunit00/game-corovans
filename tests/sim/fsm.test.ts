import { describe, expect, it } from 'vitest';
import { nextState, type AiInputs, type AiState } from '../../src/sim/fsm';

// Дефолтные входы «ничего не происходит»: цели нет, HP полные, порог бегства 0.3.
function inputs(over: Partial<AiInputs> = {}): AiInputs {
  return {
    hasTarget: false,
    distToTarget: Infinity,
    attackRange: 2,
    hpFrac: 1,
    fleeBelow: 0.3,
    patrolDone: false,
    ...over,
  };
}

describe('nextState', () => {
  it('idle при отсутствии всего остаётся idle', () => {
    expect(nextState('idle', inputs())).toBe('idle');
  });

  it('patrol без цели остаётся patrol (чередование idle↔patrol — снаружи)', () => {
    expect(nextState('patrol', inputs())).toBe('patrol');
    // patrolDone не меняет состояние внутри FSM
    expect(nextState('patrol', inputs({ patrolDone: true }))).toBe('patrol');
    expect(nextState('idle', inputs({ patrolDone: true }))).toBe('idle');
  });

  it('idle/patrol при появлении цели → chase', () => {
    const seen = inputs({ hasTarget: true, distToTarget: 10 });
    expect(nextState('idle', seen)).toBe('chase');
    expect(nextState('patrol', seen)).toBe('chase');
  });

  it('chase → attack когда дистанция <= attackRange (граница включительно)', () => {
    expect(nextState('chase', inputs({ hasTarget: true, distToTarget: 2 }))).toBe('attack');
    expect(nextState('chase', inputs({ hasTarget: true, distToTarget: 1 }))).toBe('attack');
  });

  it('chase остаётся chase пока цель дальше attackRange', () => {
    expect(nextState('chase', inputs({ hasTarget: true, distToTarget: 2.01 }))).toBe('chase');
  });

  it('гистерезис: attack держится до attackRange * 1.25, дальше → chase', () => {
    // В «мёртвой зоне» между range и range*1.25 атака не прерывается
    expect(nextState('attack', inputs({ hasTarget: true, distToTarget: 2.2 }))).toBe('attack');
    // Ровно на границе 1.25 — ещё attack (выход строго «дальше»)
    expect(nextState('attack', inputs({ hasTarget: true, distToTarget: 2.5 }))).toBe('attack');
    // За границей — снова догоняем
    expect(nextState('attack', inputs({ hasTarget: true, distToTarget: 2.51 }))).toBe('chase');
  });

  it('гистерезис не дёргается: на границе range пара chase↔attack стабильна', () => {
    // dist = 2.1: chase ещё не атакует, но начатая атака не прерывается
    const edge = inputs({ hasTarget: true, distToTarget: 2.1 });
    expect(nextState('chase', edge)).toBe('chase');
    expect(nextState('attack', edge)).toBe('attack');
  });

  it('потеря цели из chase и attack → patrol', () => {
    const lost = inputs({ hasTarget: false, distToTarget: Infinity });
    expect(nextState('chase', lost)).toBe('patrol');
    expect(nextState('attack', lost)).toBe('patrol');
  });

  it('flee приоритетнее всего: из любого состояния при hpFrac < fleeBelow', () => {
    const hurt = inputs({ hasTarget: true, distToTarget: 1, hpFrac: 0.2 });
    const from: AiState[] = ['idle', 'patrol', 'chase', 'attack'];
    for (const s of from) expect(nextState(s, hurt)).toBe('flee');
  });

  it('flee побеждает даже когда цель в зоне атаки', () => {
    expect(nextState('attack', inputs({ hasTarget: true, distToTarget: 0.5, hpFrac: 0.1 }))).toBe(
      'flee',
    );
  });

  it('fleeBelow = 0 — никогда не бежит, даже при hpFrac = 0', () => {
    const dying = inputs({ hasTarget: true, distToTarget: 1, hpFrac: 0, fleeBelow: 0 });
    expect(nextState('attack', dying)).toBe('attack');
    expect(nextState('chase', dying)).not.toBe('flee');
  });

  it('flee держится пока цель рядом и HP ниже порога выхода', () => {
    expect(nextState('flee', inputs({ hasTarget: true, distToTarget: 5, hpFrac: 0.2 }))).toBe(
      'flee',
    );
    // Чуть ниже порога выхода 0.3 * 1.5 = 0.45 — всё ещё бежим
    expect(nextState('flee', inputs({ hasTarget: true, distToTarget: 5, hpFrac: 0.44 }))).toBe(
      'flee',
    );
  });

  it('выход из flee: hpFrac >= fleeBelow * 1.5 → patrol (граница включительно)', () => {
    // 0.3 * 1.5 = 0.45
    expect(nextState('flee', inputs({ hasTarget: true, distToTarget: 5, hpFrac: 0.45 }))).toBe(
      'patrol',
    );
    expect(nextState('flee', inputs({ hasTarget: true, distToTarget: 5, hpFrac: 1 }))).toBe(
      'patrol',
    );
  });

  it('выход из flee: цели нет → patrol даже при низком HP (отбежал)', () => {
    expect(nextState('flee', inputs({ hasTarget: false, hpFrac: 0.1 }))).toBe('patrol');
  });

  it('без цели в flee не входим: раненый патрулирует, осцилляции flee↔patrol нет', () => {
    // HP не регенерирует: после выхода из flee «по потере цели» hpFrac остаётся
    // ниже порога навсегда — повторный вход без hasTarget зациклил бы автомат.
    const hurtNoTarget = inputs({ hasTarget: false, hpFrac: 0.1 });
    expect(nextState('patrol', hurtNoTarget)).toBe('patrol');
    expect(nextState('idle', hurtNoTarget)).toBe('idle');
    // Полный цикл «убежал → забыл цель»: flee → patrol → patrol (стабильно)
    const afterFlee = nextState('flee', hurtNoTarget);
    expect(afterFlee).toBe('patrol');
    expect(nextState(afterFlee, hurtNoTarget)).toBe('patrol');
  });
});
