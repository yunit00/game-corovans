// Лодка на главном озере (Фаза 6D, волна 2). Чистая физика скольжения и предикаты
// посадки/высадки (sim/boat) node-тестируемы БЕЗ three. Глубину в границах берём из
// РЕАЛЬНОГО рельефа (Terrain.height против уровня глади озера) — так проверяем, что
// причал валиден и лодка не выходит за зеркало на настоящей карте. Образец —
// tests/sim/lakes.test.ts (тот же seed 42 = дефолтный мир) и tests/sim/caravan.test.ts
// (детерминизм шага). Покрываем:
//   (а) step-физика: разгон под тягой к установившейся скорости, инерция после
//       отпускания, торможение задним ходом, поворот руля (эффективнее на ходу);
//   (б) границы: лодка из любого направления НЕ выходит за судоходную воду (глубина
//       под ней всегда ≥ BOAT_BANK_DEPTH), у кромки тормозит/скользит;
//   (в) посадка: предикат canBoard по радиусу; высадка: findDisembarkPoint даёт
//       валидную точку берега у причала и null в середине озера;
//   (г) причал: точка BOAT_DOCK на реальном рельефе — мелководье (глубина 0.3–1 м) и
//       до берега ≤4 м; курс носа — к центру озера;
//   (д) детерминизм: тот же state+input+depth → тот же результат; сейв-инвариант
//       resetBoat возвращает лодку к причалу в покое.
import { describe, expect, it } from 'vitest';
import {
  makeBoat,
  resetBoat,
  stepBoat,
  boatSpeed,
  boatForward,
  canBoard,
  findDisembarkPoint,
  isNavigable,
  boatYawToward,
  BOAT_MAX_FWD,
  BOAT_MAX_BACK,
  BOAT_BANK_DEPTH,
  BOAT_BOARD_RADIUS,
  BOAT_DISEMBARK_REACH,
  type BoatInput,
  type DepthFn,
} from '../../src/sim/boat';
import {
  LAKES,
  lakeCenter,
  lakeOuterRadius,
  BOAT_DOCK,
  boatDockWaterY,
  boatDockYaw,
} from '../../src/sim/lakes';
import { Terrain } from '../../src/world/Terrain';
import { flattenFactor, WORLD_SIZE } from '../../src/world/WorldData';

// Дефолтный мир игры — seed 42 (Game.seed): причал подобран под него (как lakes.test
// фиксирует свои инварианты на своём seed). Один Terrain на все тесты (чистая функция).
const SEED = 42;
const terrain = new Terrain({
  size: WORLD_SIZE,
  segments: 256,
  seed: SEED,
  amplitude: 13,
  noiseScale: 150,
  flattenMask: flattenFactor,
});
const lake = LAKES.find((l) => l.id === 'west')!;
const center = lakeCenter(lake);
const outerR = lakeOuterRadius(lake);
const waterY = boatDockWaterY();
/** Глубина воды (waterY − рельеф) — тот же callback, что Game подаёт в stepBoat. */
const depthAt: DepthFn = (x, z) => waterY - terrain.height(x, z);

const DT = 1 / 60;
const NO_INPUT: BoatInput = { forward: false, back: false, left: false, right: false };
const FWD: BoatInput = { forward: true, back: false, left: false, right: false };
const BACK: BoatInput = { forward: false, back: true, left: false, right: false };

/** Прогнать N секунд с заданным вводом и плоской «бесконечной водой» (глубина велика). */
const DEEP: DepthFn = () => 10;
function run(b: ReturnType<typeof makeBoat>, sec: number, input: BoatInput, depth: DepthFn = DEEP): void {
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++) stepBoat(b, DT, input, depth);
}

describe('boat: причал у главного озера', () => {
  it('точка причала на реальном рельефе — мелководье 0.3–1 м', () => {
    const d = depthAt(BOAT_DOCK.x, BOAT_DOCK.z);
    expect(d).toBeGreaterThanOrEqual(0.3);
    expect(d).toBeLessThanOrEqual(1.0);
  });

  it('от причала до берега ≤4 м (можно дотянуться/выйти)', () => {
    const pt = findDisembarkPoint(makeBoat(BOAT_DOCK.x, BOAT_DOCK.z, boatDockYaw()), depthAt);
    expect(pt).not.toBeNull();
    const dist = Math.hypot(pt!.x - BOAT_DOCK.x, pt!.z - BOAT_DOCK.z);
    expect(dist).toBeLessThanOrEqual(BOAT_DISEMBARK_REACH + 0.5); // +шаг на сушу
  });

  it('причал — судоходная вода у кромки (берег рядом, не на суше)', () => {
    // На воде (глубина под лодкой ≥ порога мели), но недалеко от центра (на озере, не
    // в стороне). outerR — лишь грубая оценка формы (озеро из перекрытых дисков шире
    // по диагонали), поэтому проверяем именно судоходность, а не радиус.
    expect(isNavigable(depthAt, BOAT_DOCK.x, BOAT_DOCK.z)).toBe(true);
    const distC = Math.hypot(BOAT_DOCK.x - center.x, BOAT_DOCK.z - center.z);
    expect(distC).toBeLessThan(outerR + 8); // в водной зоне озера
  });

  it('курс носа на причале направлен к центру озера', () => {
    const expected = boatYawToward(BOAT_DOCK.x, BOAT_DOCK.z, center.x, center.z);
    expect(boatDockYaw()).toBeCloseTo(expected, 5);
    // Нос (forward) указывает в сторону центра: скалярное произведение > 0.
    const f = boatForward(boatDockYaw());
    const dx = center.x - BOAT_DOCK.x;
    const dz = center.z - BOAT_DOCK.z;
    expect(f.x * dx + f.z * dz).toBeGreaterThan(0);
  });
});

describe('boat: step-физика (разгон/инерция/торможение/поворот)', () => {
  it('тяга вперёд разгоняет к установившейся скорости ≈ потолку', () => {
    const b = makeBoat(0, 0, 0);
    run(b, 6, FWD);
    const s = boatSpeed(b);
    expect(s).toBeGreaterThan(BOAT_MAX_FWD * 0.85);
    expect(s).toBeLessThanOrEqual(BOAT_MAX_FWD + 1e-6);
    // Движение строго по носу (yaw=0 → +Z): vx≈0, vz>0.
    expect(Math.abs(b.vx)).toBeLessThan(0.05);
    expect(b.vz).toBeGreaterThan(0);
  });

  it('после отпускания скорость затухает (инерция, не мгновенный стоп)', () => {
    const b = makeBoat(0, 0, 0);
    run(b, 6, FWD);
    const moving = boatSpeed(b);
    // Через 0.3 с без тяги лодка ещё заметно едет (инерция), но медленнее.
    run(b, 0.3, NO_INPUT);
    const coasting = boatSpeed(b);
    expect(coasting).toBeGreaterThan(0.5); // не встала колом
    expect(coasting).toBeLessThan(moving); // но замедлилась
    // А за несколько секунд почти останавливается.
    run(b, 5, NO_INPUT);
    expect(boatSpeed(b)).toBeLessThan(0.3);
  });

  it('задний ход медленнее переднего', () => {
    const f = makeBoat(0, 0, 0);
    run(f, 6, FWD);
    const r = makeBoat(0, 0, 0);
    run(r, 6, BACK);
    expect(boatSpeed(r)).toBeLessThan(boatSpeed(f));
    expect(boatSpeed(r)).toBeLessThanOrEqual(BOAT_MAX_BACK + 1e-6);
  });

  it('поворот эффективнее на ходу, чем на месте', () => {
    // На месте (без тяги): малый поворот за 1 с.
    const still = makeBoat(0, 0, 0);
    const yaw0 = still.yaw;
    run(still, 1, { forward: false, back: false, left: false, right: true });
    const turnStill = Math.abs(still.yaw - yaw0);
    // На полном ходу: тот же поворот, но руль эффективнее (BOAT_TURN_GAIN).
    const moving = makeBoat(0, 0, 0);
    run(moving, 4, FWD); // разогнались
    const yaw1 = moving.yaw;
    run(moving, 1, { forward: true, back: false, left: false, right: true });
    const turnMoving = Math.abs(moving.yaw - yaw1);
    expect(turnMoving).toBeGreaterThan(turnStill);
  });

  it('крен наклоняется в сторону поворота на ходу (visual-only)', () => {
    const b = makeBoat(0, 0, 0);
    run(b, 4, FWD);
    run(b, 0.5, { forward: true, back: false, left: false, right: true });
    // right turn → крен в одну сторону (знак ненулевой и стабильный).
    expect(Math.abs(b.roll)).toBeGreaterThan(0.02);
  });
});

describe('boat: границы зеркала (не выходит на сушу)', () => {
  it('из 8 направлений от центра лодка ВСЕГДА остаётся в судоходной воде', () => {
    for (let d = 0; d < 8; d++) {
      const yaw = (d / 8) * Math.PI * 2;
      const b = makeBoat(center.x, center.z, yaw);
      let everLeft = false;
      for (let i = 0; i < 12 * 60; i++) {
        stepBoat(b, DT, FWD, depthAt);
        if (depthAt(b.x, b.z) < BOAT_BANK_DEPTH - 1e-3) {
          everLeft = true;
          break;
        }
      }
      expect(everLeft, `направление ${d} вышло за воду`).toBe(false);
    }
  });

  it('у кромки лодка тормозит/скользит, а не пробивает берег', () => {
    // Ставим лодку у причала носом к берегу (от центра наружу) и жмём вперёд.
    const outX = BOAT_DOCK.x - center.x;
    const outZ = BOAT_DOCK.z - center.z;
    const yawOut = boatYawToward(0, 0, outX, outZ);
    const b = makeBoat(BOAT_DOCK.x, BOAT_DOCK.z, yawOut);
    run(b, 4, FWD, depthAt);
    // Осталась в судоходной воде (на берег не выехала).
    expect(isNavigable(depthAt, b.x, b.z)).toBe(true);
  });
});

describe('boat: посадка/высадка-предикаты', () => {
  it('canBoard истинен в радиусе и ложен за ним', () => {
    expect(canBoard(0, 0, BOAT_BOARD_RADIUS - 0.1, 0)).toBe(true);
    expect(canBoard(0, 0, BOAT_BOARD_RADIUS + 0.1, 0)).toBe(false);
    expect(canBoard(0, 0, 0, 0)).toBe(true);
  });

  it('высадка у причала даёт валидную точку берега (суша)', () => {
    const b = makeBoat(BOAT_DOCK.x, BOAT_DOCK.z, boatDockYaw());
    const pt = findDisembarkPoint(b, depthAt);
    expect(pt).not.toBeNull();
    // Точка на суше: глубина там ≤ 0 (дно выше воды).
    expect(depthAt(pt!.x, pt!.z)).toBeLessThanOrEqual(0);
    // И в пределах досягаемости от лодки.
    expect(Math.hypot(pt!.x - b.x, pt!.z - b.z)).toBeLessThanOrEqual(BOAT_DISEMBARK_REACH + 0.5);
  });

  it('в середине озера высадка невозможна (берега нет в радиусе)', () => {
    const b = makeBoat(center.x, center.z, 0);
    expect(findDisembarkPoint(b, depthAt)).toBeNull();
  });
});

describe('boat: детерминизм и сейв-инвариант', () => {
  it('тот же state+input+depth → тот же результат', () => {
    const a = makeBoat(center.x, center.z, 0.3);
    const b = makeBoat(center.x, center.z, 0.3);
    const seq: BoatInput[] = [FWD, FWD, { forward: true, back: false, left: false, right: true }, NO_INPUT];
    for (let i = 0; i < 300; i++) {
      const inp = seq[i % seq.length]!;
      stepBoat(a, DT, inp, depthAt);
      stepBoat(b, DT, inp, depthAt);
    }
    expect(a.x).toBe(b.x);
    expect(a.z).toBe(b.z);
    expect(a.yaw).toBe(b.yaw);
    expect(a.vx).toBe(b.vx);
    expect(a.vz).toBe(b.vz);
  });

  it('resetBoat возвращает лодку к причалу в полном покое (сейв-инвариант)', () => {
    const b = makeBoat(BOAT_DOCK.x, BOAT_DOCK.z, boatDockYaw());
    run(b, 5, FWD, depthAt); // уплыли и разогнались
    resetBoat(b, BOAT_DOCK.x, BOAT_DOCK.z, boatDockYaw());
    expect(b.x).toBe(BOAT_DOCK.x);
    expect(b.z).toBe(BOAT_DOCK.z);
    expect(b.yaw).toBe(boatDockYaw());
    expect(boatSpeed(b)).toBe(0);
    expect(b.roll).toBe(0);
  });

  it('можно доплыть от причала до середины озера (критерий игрока)', () => {
    const b = makeBoat(BOAT_DOCK.x, BOAT_DOCK.z, boatDockYaw());
    run(b, 10, FWD, depthAt);
    const distC = Math.hypot(b.x - center.x, b.z - center.z);
    expect(distC).toBeLessThan(outerR / 2); // ближе половины радиуса = «середина»
  });
});
