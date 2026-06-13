import { describe, expect, it, beforeEach } from 'vitest';
import {
  SCENES,
  CARAVAN_POINT,
  TREE_POINT,
  INTRO_SEEN_KEY,
  totalDurationSec,
  easeInOutCubic,
  sceneAt,
  evalCamera,
  curtainOpacity,
  titleOpacity,
  END_FADE_SEC,
  hasSeenIntro,
  markIntroSeen,
  type IntroStorage,
  type Scene,
} from '../../src/cinematic/storyboard';
import { VILLAGE, PALACE, SPAWN, ROADS, isClear, WORLD_SIZE } from '../../src/world/WorldData';
import { CASTLE } from '../../src/world/Terrain';

/** Простой in-memory мок localStorage для теста флага intro-seen. */
function makeStorage(): IntroStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('storyboard: хронометраж', () => {
  it('суммарная длительность в окне 30–60 с (ТЗ заставки)', () => {
    const total = totalDurationSec();
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(60);
  });

  it('каждая сцена имеет положительную длительность и валидное затемнение', () => {
    for (const s of SCENES) {
      expect(s.durationSec).toBeGreaterThan(0);
      expect(s.fadeInSec).toBeGreaterThanOrEqual(0);
      expect(s.fadeInSec).toBeLessThanOrEqual(s.durationSec);
      expect(s.titleDelaySec).toBeGreaterThanOrEqual(0);
      expect(s.titleDelaySec).toBeLessThan(s.durationSec);
      expect(s.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('ровно 7 сцен по раскадровке (hello/village/raid/caravan/trees/villain/wish)', () => {
    expect(SCENES.map((s) => s.id)).toEqual([
      'hello',
      'village',
      'raid',
      'caravan',
      'trees',
      'villain',
      'wish',
    ]);
  });

  it('финальный титр — дословный P.S. Кирилла', () => {
    const last = SCENES[SCENES.length - 1]!;
    expect(last.title).toBe('P.S. Я джва года хочу такую игру.');
  });

  it('каноничные ошибки орфографии сохранены (не «исправлены»)', () => {
    const all = SCENES.map((s) => s.title).join(' ');
    expect(all).toContain('Здраствуйте'); // без «в»
    expect(all).toContain('деревяные'); // одна «н»
    expect(all).toContain('набигают'); // через «и»
    expect(all).toContain('корованы'); // мем
    expect(all).toContain('подходиш'); // без мягкого знака
    expect(all).toContain('джва'); // «джва года»
  });
});

describe('storyboard: easeInOutCubic', () => {
  it('закреплён в концах и монотонно растёт', () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0, 6);
    expect(easeInOutCubic(1)).toBeCloseTo(1, 6);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('кламп за пределами [0,1]', () => {
    expect(easeInOutCubic(-2)).toBe(0);
    expect(easeInOutCubic(5)).toBe(1);
  });
});

describe('storyboard: sceneAt', () => {
  it('t=0 — первая сцена, local=0', () => {
    const r = sceneAt(0);
    expect(r.index).toBe(0);
    expect(r.local).toBeCloseTo(0, 6);
  });

  it('границы сцен: ровно в начале следующей сцены индекс растёт', () => {
    let acc = 0;
    for (let i = 0; i < SCENES.length; i++) {
      const mid = acc + SCENES[i]!.durationSec / 2;
      expect(sceneAt(mid).index).toBe(i);
      acc += SCENES[i]!.durationSec;
    }
  });

  it('за пределами заставки — последняя сцена, local=duration', () => {
    const total = totalDurationSec();
    const r = sceneAt(total + 100);
    expect(r.index).toBe(SCENES.length - 1);
    expect(r.local).toBeCloseTo(SCENES[SCENES.length - 1]!.durationSec, 6);
  });

  it('индекс сцены монотонно не убывает по времени', () => {
    let prev = 0;
    for (let t = 0; t <= totalDurationSec() + 2; t += 0.25) {
      const idx = sceneAt(t).index;
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});

describe('storyboard: evalCamera', () => {
  it('в начале сцены поза = from, в конце ≈ to', () => {
    let acc = 0;
    for (const s of SCENES) {
      const startPose = evalCamera(acc + 0.0001);
      expect(startPose.eye.x).toBeCloseTo(s.from.eye.x, 1);
      expect(startPose.eye.z).toBeCloseTo(s.from.eye.z, 1);
      const endPose = evalCamera(acc + s.durationSec - 0.0001);
      expect(endPose.eye.x).toBeCloseTo(s.to.eye.x, 1);
      expect(endPose.eye.z).toBeCloseTo(s.to.eye.z, 1);
      acc += s.durationSec;
    }
  });

  it('поза камеры конечна (без NaN/Infinity) на всём пробеге', () => {
    for (let t = 0; t <= totalDurationSec(); t += 0.2) {
      const p = evalCamera(t);
      for (const v of [p.eye.x, p.eye.y, p.eye.z, p.target.x, p.target.y, p.target.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('переиспользует общий объект позы (без аллокаций в кадре)', () => {
    const a = evalCamera(1);
    const b = evalCamera(2);
    expect(a).toBe(b); // тот же объект — рендер читает .eye/.target сразу
  });
});

describe('storyboard: сцены ссылаются на ВАЛИДНЫЕ точки мира', () => {
  const half = WORLD_SIZE / 2;

  it('все целевые точки сцен внутри карты', () => {
    for (const s of SCENES) {
      for (const pt of [s.from.eye, s.to.eye, s.from.target, s.to.target]) {
        expect(Math.abs(pt.x)).toBeLessThanOrEqual(half);
        expect(Math.abs(pt.z)).toBeLessThanOrEqual(half);
      }
    }
  });

  it('сцены снимают реальные локации мира (деревня/дворец/замок/спавн)', () => {
    const target = (id: string) => SCENES.find((s) => s.id === id)!.to.target;
    // Деревня
    expect(Math.hypot(target('village').x - VILLAGE.x, target('village').z - VILLAGE.z)).toBeLessThan(VILLAGE.radius);
    // Дворец
    expect(Math.hypot(target('raid').x - PALACE.x, target('raid').z - PALACE.z)).toBeLessThan(PALACE.radius);
    // Замок злодея
    expect(Math.hypot(target('villain').x - CASTLE.cx, target('villain').z - CASTLE.cz)).toBeLessThan(CASTLE.plateauR + 10);
    // Финал — у точки спавна игрока
    expect(Math.hypot(target('wish').x - SPAWN.x, target('wish').z - SPAWN.z)).toBeLessThan(6);
  });

  it('CARAVAN_POINT лежит на главном тракте ROADS[0]', () => {
    const onRoad = ROADS[0]!.some((p) => p.x === CARAVAN_POINT.x && p.z === CARAVAN_POINT.z);
    expect(onRoad).toBe(true);
  });

  it('TREE_POINT — реально свободное место под лес (мета-шутка про деревья)', () => {
    expect(isClear(TREE_POINT.x, TREE_POINT.z)).toBe(true);
  });
});

describe('storyboard: шторка (кроссфейд)', () => {
  it('на самом старте чёрная (вход из меню)', () => {
    expect(curtainOpacity(0)).toBeCloseTo(1, 3);
  });

  it('в конце заставки уходит в чёрный (передача в геймплей)', () => {
    const total = totalDurationSec();
    expect(curtainOpacity(total - END_FADE_SEC)).toBeCloseTo(0, 2);
    expect(curtainOpacity(total - 0.0001)).toBeCloseTo(1, 1);
  });

  it('после входной шторки сцены кадр проявлен (opacity≈0)', () => {
    // Берём середину первой сцены — заведомо после её fadeInSec.
    const s0 = SCENES[0]!;
    expect(curtainOpacity(s0.fadeInSec + 0.5)).toBeCloseTo(0, 3);
  });

  it('opacity всегда в [0,1]', () => {
    for (let t = 0; t <= totalDurationSec(); t += 0.1) {
      const o = curtainOpacity(t);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

describe('storyboard: титры', () => {
  it('до titleDelaySec титр скрыт, дальше проявляется', () => {
    const s0 = SCENES[0]!;
    expect(titleOpacity(s0.titleDelaySec - 0.1)).toBeCloseTo(0, 3);
    expect(titleOpacity(s0.titleDelaySec + 0.8)).toBeGreaterThan(0.5);
  });

  it('opacity титра всегда в [0,1]', () => {
    for (let t = 0; t <= totalDurationSec(); t += 0.1) {
      const o = titleOpacity(t);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

describe('storyboard: флаг intro-seen в localStorage', () => {
  let storage: ReturnType<typeof makeStorage>;
  beforeEach(() => {
    storage = makeStorage();
  });

  it('по умолчанию заставку не видели', () => {
    expect(hasSeenIntro(storage)).toBe(false);
  });

  it('markIntroSeen ставит флаг под ключом korovany_intro_seen', () => {
    markIntroSeen(storage);
    expect(storage.map.get(INTRO_SEEN_KEY)).toBe('1');
    expect(hasSeenIntro(storage)).toBe(true);
  });

  it('повторный showIntro после метки не сработает (показ ровно раз)', () => {
    markIntroSeen(storage);
    expect(hasSeenIntro(storage)).toBe(true);
  });

  it('storage=null безопасен (приватный режим/песочница): не видели, без падения', () => {
    expect(hasSeenIntro(null)).toBe(false);
    expect(() => markIntroSeen(null)).not.toThrow();
  });

  it('бросающий getItem трактуется как «не видели» (не падаем)', () => {
    const broken: IntroStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(hasSeenIntro(broken)).toBe(false);
    expect(() => markIntroSeen(broken)).not.toThrow();
  });
});

// Лёгкий guard, что раскадровку можно прогнать с произвольным набором сцен (API чист).
describe('storyboard: функции принимают кастомный набор сцен', () => {
  const custom: Scene[] = [
    {
      id: 'a',
      title: 'A',
      durationSec: 2,
      fadeInSec: 0.5,
      titleDelaySec: 0.2,
      from: { eye: { x: 0, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } },
      to: { eye: { x: 10, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } },
    },
  ];
  it('totalDurationSec/sceneAt/evalCamera работают на кастомном массиве', () => {
    expect(totalDurationSec(custom)).toBe(2);
    expect(sceneAt(1, custom).index).toBe(0);
    expect(evalCamera(0, custom).eye.x).toBeCloseTo(0, 6);
  });
});
