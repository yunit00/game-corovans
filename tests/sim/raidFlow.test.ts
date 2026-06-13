import { describe, expect, it } from 'vitest';
import {
  ANNOUNCE_DURATION_SEC,
  FIRST_RAID_DELAY_SEC,
  forceAnnounce,
  isRunawayRaider,
  makeRaidFlow,
  NEXT_RAID_DELAY_SEC,
  RUNAWAY_DIST,
  stepRaidFlow,
  type RaidFlow,
  type RaidFlowEvent,
  type RaidFlowInputs,
} from '../../src/sim/raidFlow';

const DT = 1 / 60;

function makeInputs(over: Partial<RaidFlowInputs> = {}): RaidFlowInputs {
  return { autoStart: true, waveDelays: [0, 20, 40], raidersLeft: 0, ...over };
}

/** Прогон seconds игрового времени; события собираются с метками времени. */
function run(
  flow: RaidFlow,
  seconds: number,
  inp: RaidFlowInputs,
): { ev: Exclude<RaidFlowEvent, null>; t: number }[] {
  const out: { ev: Exclude<RaidFlowEvent, null>; t: number }[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const ev = stepRaidFlow(flow, DT, inp);
    if (ev) out.push({ ev, t: (i + 1) * DT });
  }
  return out;
}

describe('stepRaidFlow', () => {
  it('первый автонабег: announce ровно после FIRST_RAID_DELAY_SEC', () => {
    const flow = makeRaidFlow();
    const events = run(flow, FIRST_RAID_DELAY_SEC + ANNOUNCE_DURATION_SEC + 1, makeInputs({ raidersLeft: 1 }));
    expect(events[0]!.ev).toBe('announce');
    expect(events[0]!.t).toBeCloseTo(FIRST_RAID_DELAY_SEC, 1);
    expect(flow.phase).toBe('active'); // через 3 c после announce уже active
  });

  it('noraids (autoStart=false): автозапуска нет, таймер заморожен', () => {
    const flow = makeRaidFlow();
    const events = run(flow, 500, makeInputs({ autoStart: false }));
    expect(events).toEqual([]);
    expect(flow.phase).toBe('calm');
    expect(flow.timer).toBe(FIRST_RAID_DELAY_SEC); // не тикал — включение флага не «взорвётся» сразу
  });

  it('forceAnnounce → первая волна (delaySec=0) через ANNOUNCE_DURATION_SEC', () => {
    const flow = makeRaidFlow();
    forceAnnounce(flow);
    const events = run(flow, ANNOUNCE_DURATION_SEC + 0.5, makeInputs({ raidersLeft: 1 }));
    expect(events.length).toBe(1);
    expect(events[0]!.ev).toBe('wave');
    expect(events[0]!.t).toBeCloseTo(ANNOUNCE_DURATION_SEC, 1);
    expect(flow.phase).toBe('active');
    expect(flow.wavesSpawned).toBe(1);
  });

  it('волны по delaySec от старта active', () => {
    const flow = makeRaidFlow();
    forceAnnounce(flow);
    const events = run(flow, ANNOUNCE_DURATION_SEC + 45, makeInputs({ raidersLeft: 1 }));
    const waves = events.filter((e) => e.ev === 'wave');
    expect(waves.length).toBe(3);
    // Метки относительно начала active (= ANNOUNCE_DURATION_SEC)
    expect(waves[0]!.t - ANNOUNCE_DURATION_SEC).toBeCloseTo(0, 1);
    expect(waves[1]!.t - ANNOUNCE_DURATION_SEC).toBeCloseTo(20, 1);
    expect(waves[2]!.t - ANNOUNCE_DURATION_SEC).toBeCloseTo(40, 1);
  });

  it('cleared не раньше, чем отданы ВСЕ волны (даже при raidersLeft=0)', () => {
    const flow = makeRaidFlow();
    forceAnnounce(flow);
    // Все рейдеры «мертвы» всю дорогу — но волны 20 c и 40 c ещё не вышли
    const events = run(flow, ANNOUNCE_DURATION_SEC + 45, makeInputs({ raidersLeft: 0 }));
    const clearedIdx = events.findIndex((e) => e.ev === 'cleared');
    const lastWaveIdx = events.map((e) => e.ev).lastIndexOf('wave');
    expect(clearedIdx).toBeGreaterThan(lastWaveIdx);
    expect(flow.phase).toBe('cleared');
  });

  it('cleared ждёт живых рейдеров и спавнов в полёте', () => {
    const flow = makeRaidFlow();
    forceAnnounce(flow);
    const alive = makeInputs({ raidersLeft: 2 });
    run(flow, ANNOUNCE_DURATION_SEC + 60, alive);
    expect(flow.phase).toBe('active'); // все волны отданы, но живые остались
    const dead = makeInputs({ raidersLeft: 0 });
    const events = run(flow, 1, dead);
    expect(events[0]!.ev).toBe('cleared');
  });

  it('после cleared следующий announce через NEXT_RAID_DELAY_SEC', () => {
    const flow = makeRaidFlow();
    flow.phase = 'cleared';
    flow.timer = NEXT_RAID_DELAY_SEC;
    const events = run(flow, NEXT_RAID_DELAY_SEC + 1, makeInputs({ raidersLeft: 1 }));
    expect(events[0]!.ev).toBe('announce');
    expect(events[0]!.t).toBeCloseTo(NEXT_RAID_DELAY_SEC, 1);
  });

  it('forceAnnounce перезапускает набег из active (debugSpawnRaid работает всегда)', () => {
    const flow = makeRaidFlow();
    forceAnnounce(flow);
    run(flow, ANNOUNCE_DURATION_SEC + 25, makeInputs({ raidersLeft: 5 }));
    expect(flow.wavesSpawned).toBe(2);
    forceAnnounce(flow);
    expect(flow.phase).toBe('announce');
    expect(flow.wavesSpawned).toBe(0);
    const events = run(flow, ANNOUNCE_DURATION_SEC + 0.5, makeInputs({ raidersLeft: 5 }));
    expect(events[0]!.ev).toBe('wave');
  });
});

describe('isRunawayRaider', () => {
  it('flee дальше RUNAWAY_DIST — убежавший', () => {
    expect(isRunawayRaider('flee', RUNAWAY_DIST + 1, 0, 0, 0)).toBe(true);
  });

  it('flee внутри радиуса — ещё не убежавший', () => {
    expect(isRunawayRaider('flee', RUNAWAY_DIST - 1, 0, 0, 0)).toBe(false);
  });

  it('chase на любой дистанции не считается (погоню за игроком не обрываем)', () => {
    expect(isRunawayRaider('chase', RUNAWAY_DIST * 2, 0, 0, 0)).toBe(false);
    expect(isRunawayRaider('patrol', RUNAWAY_DIST * 2, 0, 0, 0)).toBe(false);
  });
});
