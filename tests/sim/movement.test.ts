import { describe, expect, it } from 'vitest';
import {
  COYOTE_SEC,
  JUMP_BUFFER_SEC,
  makeJumpTimers,
  moveDirFromKeys,
  stepAngle,
  stepJumpTimers,
  yawFromDir,
} from '../../src/sim/movement';

const keys = (s: string) => ({
  forward: s.includes('w'),
  back: s.includes('s'),
  left: s.includes('a'),
  right: s.includes('d'),
});

describe('moveDirFromKeys', () => {
  it('yaw=0 (камера смотрит в -Z): W → (0,-1)', () => {
    const d = moveDirFromKeys(keys('w'), 0);
    expect(d.x).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(-1);
  });

  it('yaw=π/2 (камера смотрит в -X): W → (-1,0)', () => {
    const d = moveDirFromKeys(keys('w'), Math.PI / 2);
    expect(d.x).toBeCloseTo(-1);
    expect(d.z).toBeCloseTo(0);
  });

  it('диагональ нормализована', () => {
    const d = moveDirFromKeys(keys('wd'), 0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
  });

  it('противоположные клавиши гасятся', () => {
    const d = moveDirFromKeys(keys('ws'), 1.23);
    expect(d.x).toBe(0);
    expect(d.z).toBe(0);
  });

  it('S — строго назад от W', () => {
    const w = moveDirFromKeys(keys('w'), 0.7);
    const s = moveDirFromKeys(keys('s'), 0.7);
    expect(s.x).toBeCloseTo(-w.x);
    expect(s.z).toBeCloseTo(-w.z);
  });
});

describe('yawFromDir / stepAngle', () => {
  it('персонаж, идущий в -Z, имеет yaw=π... то есть atan2(0,-1)', () => {
    expect(yawFromDir(0, -1)).toBeCloseTo(Math.PI);
    expect(yawFromDir(1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('stepAngle идёт кратчайшим путём через 2π', () => {
    const a = stepAngle(0.1, Math.PI * 2 - 0.1, 0.05);
    expect(a).toBeCloseTo(0.05); // короткий путь — назад через 0
  });

  it('stepAngle достигает цели при достаточном шаге', () => {
    expect(stepAngle(0, 1, 5)).toBe(1);
  });
});

describe('stepJumpTimers (буфер прыжка + койот-тайм)', () => {
  const DT = 1 / 60;

  it('нажатие на земле → наземный прыжок в тот же шаг', () => {
    const s = makeJumpTimers();
    expect(stepJumpTimers(s, DT, true, true)).toBe('ground');
  });

  it('без нажатия прыжка нет, сколько ни стой на земле', () => {
    const s = makeJumpTimers();
    for (let i = 0; i < 30; i++) {
      expect(stepJumpTimers(s, DT, false, true)).toBe('none');
    }
  });

  it('буфер: нажатие в воздухе срабатывает при приземлении внутри окна', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, true, false); // нажали в полёте
    // падаем ещё ~0.1 с (< JUMP_BUFFER_SEC с учётом шага нажатия)
    for (let i = 0; i < 5; i++) {
      expect(stepJumpTimers(s, DT, false, false)).toBe('none');
    }
    expect(stepJumpTimers(s, DT, false, true)).toBe('ground'); // коснулись земли
  });

  it('буфер: протухает, если приземлились позже окна', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, true, false);
    const steps = Math.ceil(JUMP_BUFFER_SEC / DT) + 1;
    for (let i = 0; i < steps; i++) stepJumpTimers(s, DT, false, false);
    expect(stepJumpTimers(s, DT, false, true)).toBe('none');
  });

  it('койот: нажатие чуть после схода с края срабатывает', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, false, true); // стояли на земле
    // сошли с края, падаем меньше COYOTE_SEC
    for (let i = 0; i < 4; i++) {
      expect(stepJumpTimers(s, DT, false, false)).toBe('none');
    }
    expect(stepJumpTimers(s, DT, true, false)).toBe('ground');
  });

  it('койот: протухает после окна — нажатие в свободном падении без прыжка глухо', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, false, true);
    const steps = Math.ceil(COYOTE_SEC / DT) + 1;
    for (let i = 0; i < steps; i++) stepJumpTimers(s, DT, false, false);
    // окно земли закрыто, прыжка ещё не было (просто сошли с края) → ни ground,
    // ни air: воздушный заряд доступен лишь ПОСЛЕ наземного прыжка.
    expect(stepJumpTimers(s, DT, true, false)).toBe('none');
  });

  it('прыжок потребляет оба окна: нет второго прыжка с остатка буфера', () => {
    const s = makeJumpTimers();
    expect(stepJumpTimers(s, DT, true, true)).toBe('ground');
    expect(s.buffer).toBe(0);
    expect(s.coyote).toBe(0);
    // следующий шаг ещё на земле (KCC обновит grounded позже) — прыжка нет
    expect(stepJumpTimers(s, DT, false, true)).toBe('none');
  });
});

describe('stepJumpTimers (двойной/воздушный прыжок)', () => {
  const DT = 1 / 60;

  it('двойной прыжок: наземный, затем один воздушный по второму нажатию в полёте', () => {
    const s = makeJumpTimers();
    expect(stepJumpTimers(s, DT, true, true)).toBe('ground'); // оторвались с земли
    // в воздухе (grounded=false), окна койота нет после потребления
    for (let i = 0; i < 5; i++) stepJumpTimers(s, DT, false, false);
    expect(stepJumpTimers(s, DT, true, false)).toBe('air'); // второе нажатие → воздушный
  });

  it('воздушный прыжок ровно один: третье нажатие в полёте — глухо', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, true, true); // ground
    stepJumpTimers(s, DT, true, false); // air (сразу следующим шагом тоже ок)
    expect(s.airJumpsUsed).toBe(1);
    expect(stepJumpTimers(s, DT, true, false)).toBe('none'); // лимит исчерпан
    expect(stepJumpTimers(s, DT, true, false)).toBe('none');
  });

  it('сброс на земле: после приземления воздушный заряд снова доступен', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, true, true); // ground
    expect(stepJumpTimers(s, DT, true, false)).toBe('air'); // потратили воздушный
    // приземлились — счётчик обнуляется
    stepJumpTimers(s, DT, false, true);
    expect(s.airJumpsUsed).toBe(0);
    // снова прыгаем с земли и снова можем во второй раз
    expect(stepJumpTimers(s, DT, true, true)).toBe('ground');
    for (let i = 0; i < 3; i++) stepJumpTimers(s, DT, false, false);
    expect(stepJumpTimers(s, DT, true, false)).toBe('air');
  });

  it('койот-прыжок тоже наземный, и после него доступен один воздушный', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, false, true); // стояли
    stepJumpTimers(s, DT, false, false); // сошли с края (койот ещё открыт)
    expect(stepJumpTimers(s, DT, true, false)).toBe('ground'); // койот-прыжок
    for (let i = 0; i < 3; i++) stepJumpTimers(s, DT, false, false);
    expect(stepJumpTimers(s, DT, true, false)).toBe('air'); // двойной всё ещё есть
    expect(stepJumpTimers(s, DT, true, false)).toBe('none'); // больше нет
  });

  it('воздушный прыжок только по явному нажатию — буфер его не вызывает сам', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, true, true); // ground (потратил буфер)
    // в полёте без нажатия — ни одного воздушного прыжка не должно «дотечь»
    for (let i = 0; i < 10; i++) {
      expect(stepJumpTimers(s, DT, false, false)).toBe('none');
    }
    expect(s.airJumpsUsed).toBe(0);
  });

  it('сход с уступа без прыжка: нажатие в воздухе НЕ тратит воздушный (буферится)', () => {
    const s = makeJumpTimers();
    stepJumpTimers(s, DT, false, true); // стояли
    const steps = Math.ceil(COYOTE_SEC / DT) + 1;
    for (let i = 0; i < steps; i++) stepJumpTimers(s, DT, false, false); // ушёл койот
    // прыжка не было (jumped=false) → нажатие не воздушный прыжок, а буфер
    expect(stepJumpTimers(s, DT, true, false)).toBe('none');
    expect(s.airJumpsUsed).toBe(0);
    // и оно срабатывает как буфер при касании земли в окне
    expect(stepJumpTimers(s, DT, false, true)).toBe('ground');
  });
});
