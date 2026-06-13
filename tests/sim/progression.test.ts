import { describe, expect, it } from 'vitest';
import {
  canUnlock,
  levelFromXp,
  makePerkState,
  MAX_LEVEL,
  perkCombatMods,
  perkCost,
  perkPointsEarned,
  perkPointsSpent,
  PERKS,
  type PerkId,
  type PerkState,
  unlockPerk,
  XP_LEVEL2,
  xpForLevel,
} from '../../src/sim/progression';

describe('xpForLevel', () => {
  it('уровень 1 — это старт без опыта', () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it('уровень 2 стоит ровно XP_LEVEL2', () => {
    expect(xpForLevel(2)).toBe(XP_LEVEL2);
  });

  it('кривая строго монотонна вплоть до капа', () => {
    for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
      expect(xpForLevel(lvl + 1)).toBeGreaterThan(xpForLevel(lvl));
    }
  });

  it('каждый следующий шаг дороже предыдущего (ускоряющаяся кривая)', () => {
    let prevStep = xpForLevel(2) - xpForLevel(1);
    for (let lvl = 2; lvl < MAX_LEVEL; lvl++) {
      const step = xpForLevel(lvl + 1) - xpForLevel(lvl);
      expect(step).toBeGreaterThan(prevStep);
      prevStep = step;
    }
  });

  it('выше MAX_LEVEL клампится к порогу капа', () => {
    expect(xpForLevel(MAX_LEVEL + 5)).toBe(xpForLevel(MAX_LEVEL));
  });
});

describe('levelFromXp', () => {
  it('обратно к xpForLevel: на точном пороге уровень совпадает', () => {
    for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
      expect(levelFromXp(xpForLevel(lvl))).toBe(lvl);
    }
  });

  it('опыта чуть меньше порога — остаёмся на предыдущем уровне', () => {
    expect(levelFromXp(xpForLevel(5) - 1)).toBe(4);
  });

  it('опыта чуть больше порога — уже на новом уровне', () => {
    expect(levelFromXp(xpForLevel(3) + 1)).toBe(3);
  });

  it('0 опыта = уровень 1', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it('гора опыта клампится к MAX_LEVEL', () => {
    expect(levelFromXp(xpForLevel(MAX_LEVEL) * 100)).toBe(MAX_LEVEL);
  });
});

describe('perkPointsEarned', () => {
  it('по очку за уровень начиная со 2-го', () => {
    expect(perkPointsEarned(1)).toBe(0);
    expect(perkPointsEarned(2)).toBe(1);
    expect(perkPointsEarned(5)).toBe(4);
    expect(perkPointsEarned(MAX_LEVEL)).toBe(MAX_LEVEL - 1);
  });

  it('выше капа очки не растут', () => {
    expect(perkPointsEarned(MAX_LEVEL + 3)).toBe(MAX_LEVEL - 1);
  });
});

describe('структура дерева', () => {
  it('сохранены id шести исходных перков (старые сейвы)', () => {
    for (const id of ['marksman1', 'marksman2', 'warrior1', 'warrior2', 'ranger1', 'ranger2'] as const) {
      expect(PERKS[id]).toBeDefined();
    }
  });

  it('в каждой ветви 4-5 ступеней (12-15 перков всего)', () => {
    const byBranch: Record<string, number> = {};
    for (const def of Object.values(PERKS)) byBranch[def.branch] = (byBranch[def.branch] ?? 0) + 1;
    expect(byBranch['Стрелок']).toBe(6);
    expect(byBranch['Воин']).toBe(6);
    expect(byBranch['Следопыт']).toBe(6);
    expect(Object.keys(PERKS).length).toBe(18);
  });

  it('у каждой ветви ровно один капстоун (tier 5)', () => {
    const caps = Object.values(PERKS).filter((d) => d.tier === 5);
    expect(caps.length).toBe(3);
    expect(new Set(caps.map((d) => d.branch)).size).toBe(3);
  });

  it('на 3-й ступени каждой ветви развилка из двух узлов', () => {
    const tier3 = Object.values(PERKS).filter((d) => d.tier === 3);
    expect(tier3.length).toBe(6); // по 2 на ветвь
    for (const branch of ['Стрелок', 'Воин', 'Следопыт'] as const) {
      expect(tier3.filter((d) => d.branch === branch).length).toBe(2);
    }
  });

  it('requiresAny всегда указывает на перки той же ветви', () => {
    for (const def of Object.values(PERKS)) {
      for (const req of def.requiresAny ?? []) {
        expect(PERKS[req].branch).toBe(def.branch);
      }
    }
  });

  it('tier-1 перки корневые (без requiresAny)', () => {
    const roots = Object.values(PERKS).filter((d) => d.tier === 1);
    expect(roots.length).toBe(3);
    for (const r of roots) expect(r.requiresAny).toBeUndefined();
  });
});

describe('perkCost', () => {
  it('ступени 1-2 стоят 1 очко', () => {
    expect(perkCost('marksman1')).toBe(1);
    expect(perkCost('marksman2')).toBe(1);
  });

  it('ступени 3-4 стоят 2 очка', () => {
    expect(perkCost('marksman3a')).toBe(2);
    expect(perkCost('marksman3b')).toBe(2);
    expect(perkCost('marksman4')).toBe(2);
  });

  it('капстоун стоит 3 очка', () => {
    expect(perkCost('marksmanCap')).toBe(3);
    expect(perkCost('warriorCap')).toBe(3);
    expect(perkCost('rangerCap')).toBe(3);
  });
});

/** Утиль: накачать состояние очками и взять цепочку перков по порядку. */
function withUnlocked(points: number, ids: PerkId[]): PerkState {
  const s = makePerkState();
  s.points = points;
  for (const id of ids) unlockPerk(s, id);
  return s;
}

describe('canUnlock / unlockPerk', () => {
  it('без очков ничего взять нельзя', () => {
    const s = makePerkState();
    expect(canUnlock(s, 'marksman1')).toBe(false);
    expect(unlockPerk(s, 'marksman1')).toBe(false);
    expect(s.unlocked).toEqual([]);
  });

  it('корневой перк ветви берётся при наличии очка и списывает его', () => {
    const s = makePerkState();
    s.points = 1;
    expect(canUnlock(s, 'warrior1')).toBe(true);
    expect(unlockPerk(s, 'warrior1')).toBe(true);
    expect(s.points).toBe(0);
    expect(s.unlocked).toEqual(['warrior1']);
  });

  it('второй перк ветви требует первого (requiresAny-цепочка)', () => {
    const s = makePerkState();
    s.points = 2;
    expect(canUnlock(s, 'marksman2')).toBe(false);
    expect(unlockPerk(s, 'marksman2')).toBe(false);
    expect(s.points).toBe(2);
    unlockPerk(s, 'marksman1');
    expect(canUnlock(s, 'marksman2')).toBe(true);
    expect(unlockPerk(s, 'marksman2')).toBe(true);
    expect(s.unlocked).toEqual(['marksman1', 'marksman2']);
    expect(s.points).toBe(0);
  });

  it('развилка tier-3: оба узла открываются от одного tier-2 и оба можно взять', () => {
    const s = withUnlocked(10, ['marksman1', 'marksman2']);
    // Оба узла развилки доступны от marksman2.
    expect(canUnlock(s, 'marksman3a')).toBe(true);
    expect(canUnlock(s, 'marksman3b')).toBe(true);
    unlockPerk(s, 'marksman3a');
    // После взятия одного — второй всё ещё доступен (не взаимоисключающие).
    expect(canUnlock(s, 'marksman3b')).toBe(true);
    unlockPerk(s, 'marksman3b');
    expect(s.unlocked).toContain('marksman3a');
    expect(s.unlocked).toContain('marksman3b');
  });

  it('tier-4 открывается ЛЮБЫМ узлом развилки', () => {
    // Только левый узел развилки.
    const sa = withUnlocked(10, ['warrior1', 'warrior2', 'warrior3a']);
    expect(canUnlock(sa, 'warrior4')).toBe(true);
    // Только правый узел развилки.
    const sb = withUnlocked(10, ['warrior1', 'warrior2', 'warrior3b']);
    expect(canUnlock(sb, 'warrior4')).toBe(true);
    // Без развилки tier-4 закрыт.
    const sc = withUnlocked(10, ['warrior1', 'warrior2']);
    expect(canUnlock(sc, 'warrior4')).toBe(false);
  });

  it('капстоун требует tier-4 и стоит 3 очка', () => {
    // Полная ветвь до tier-4: ranger1(1)+ranger2(1)+ranger3a(2)+ranger4(2)=6 очков.
    const s = withUnlocked(6, ['ranger1', 'ranger2', 'ranger3a', 'ranger4']);
    expect(s.unlocked).toContain('ranger4');
    expect(s.points).toBe(0);
    // Без очков капстоун не взять.
    expect(canUnlock(s, 'rangerCap')).toBe(false);
    s.points = 2; // двух мало — капстоун стоит 3
    expect(canUnlock(s, 'rangerCap')).toBe(false);
    s.points = 3;
    expect(canUnlock(s, 'rangerCap')).toBe(true);
    expect(unlockPerk(s, 'rangerCap')).toBe(true);
    expect(s.points).toBe(0);
  });

  it('нехватка очков на дорогой перк блокирует взятие', () => {
    const s = withUnlocked(2, ['marksman1', 'marksman2']);
    // Осталось 0 очков (две ступени по 1) — tier-3 (2 очка) не взять.
    expect(s.points).toBe(0);
    expect(canUnlock(s, 'marksman3a')).toBe(false);
    s.points = 1; // одного очка для tier-3 мало
    expect(canUnlock(s, 'marksman3a')).toBe(false);
    s.points = 2;
    expect(canUnlock(s, 'marksman3a')).toBe(true);
  });

  it('повторно один перк не берётся', () => {
    const s = withUnlocked(5, ['ranger1']);
    expect(canUnlock(s, 'ranger1')).toBe(false);
    expect(unlockPerk(s, 'ranger1')).toBe(false);
  });
});

describe('perkPointsSpent', () => {
  it('пустое состояние — 0 потраченных', () => {
    expect(perkPointsSpent(makePerkState())).toBe(0);
  });

  it('суммирует стоимости, а не число перков', () => {
    // 1 + 1 + 2 + 2 + 2 + 3 = 11 очков на полную ветвь стрелка.
    const s: PerkState = {
      unlocked: ['marksman1', 'marksman2', 'marksman3a', 'marksman3b', 'marksman4', 'marksmanCap'],
      points: 0,
    };
    expect(perkPointsSpent(s)).toBe(11);
  });

  it('неизвестные id игнорируются (защита от мусора в сейве)', () => {
    const s = { unlocked: ['marksman1', 'bogus'] as PerkId[], points: 0 };
    expect(perkPointsSpent(s)).toBe(1);
  });
});

describe('perkCombatMods — базовые статы', () => {
  it('пустое состояние — нейтральные моды', () => {
    const m = perkCombatMods(makePerkState());
    expect(m.meleeMul).toBe(1);
    expect(m.rangedMul).toBe(1);
    expect(m.rangedCrit).toBe(0);
    expect(m.meleeCrit).toBe(0);
    expect(m.critMultMul).toBe(1);
    expect(m.defense).toBe(0);
    expect(m.bonusMaxHp).toBe(0);
    expect(m.speedMul).toBe(1);
    expect(m.coinMagnetMul).toBe(1);
    expect(m.faunaCalm).toBe(false);
    expect(m.arrowPierce).toBe(false);
    expect(m.secondWind).toBe(false);
    expect(m.buyMul).toBe(1);
    expect(m.sellMul).toBe(1);
  });

  it('Стрелок: урон арбалета множится по ступеням, крит складывается', () => {
    const s = withUnlocked(20, ['marksman1', 'marksman2', 'marksman3a', 'marksman3b']);
    const m = perkCombatMods(s);
    expect(m.rangedMul).toBeCloseTo(1.2 * 1.2); // marksman1 × marksman3a
    expect(m.rangedCrit).toBeCloseTo(0.2); // marksman2 + marksman3b
  });

  it('Воин: урон милишки множится, защита складывается', () => {
    const s = withUnlocked(20, ['warrior1', 'warrior2', 'warrior3a', 'warrior3b']);
    const m = perkCombatMods(s);
    expect(m.meleeMul).toBeCloseTo(1.2 * 1.25);
    expect(m.defense).toBe(7); // 3 + 4
  });

  it('Воин tier-4: бонус к запасу здоровья', () => {
    const s = withUnlocked(20, ['warrior1', 'warrior2', 'warrior3a', 'warrior4']);
    expect(perkCombatMods(s).bonusMaxHp).toBe(30);
  });

  it('Следопыт: скорость множится, магнит берёт сильнейший узел', () => {
    const s = withUnlocked(20, ['ranger1', 'ranger2', 'ranger3a', 'ranger3b']);
    const m = perkCombatMods(s);
    expect(m.speedMul).toBeCloseTo(1.1 * 1.1);
    expect(m.coinMagnetMul).toBeCloseTo(2.2); // ranger3b важнее ranger2
    expect(m.faunaCalm).toBe(true);
  });

  it('ranger4 даёт крит обоим видам боя', () => {
    const s = withUnlocked(20, ['ranger1', 'ranger2', 'ranger3a', 'ranger4']);
    const m = perkCombatMods(s);
    expect(m.rangedCrit).toBeCloseTo(0.15);
    expect(m.meleeCrit).toBeCloseTo(0.15);
  });
});

describe('perkCombatMods — капстоуны', () => {
  it('«Смертельный залп» (marksman4) усиливает множитель крита', () => {
    const s = withUnlocked(20, ['marksman1', 'marksman2', 'marksman3a', 'marksman4']);
    expect(perkCombatMods(s).critMultMul).toBeCloseTo(1.25);
  });

  it('«Пробивной болт» (marksmanCap) включает пробой стрелы', () => {
    const s = withUnlocked(30, ['marksman1', 'marksman2', 'marksman3a', 'marksman4', 'marksmanCap']);
    expect(perkCombatMods(s).arrowPierce).toBe(true);
  });

  it('«Второе дыхание» (warriorCap) включает спасение от смерти', () => {
    const s = withUnlocked(30, ['warrior1', 'warrior2', 'warrior3a', 'warrior4', 'warriorCap']);
    expect(perkCombatMods(s).secondWind).toBe(true);
  });

  it('«Хозяин троп» (rangerCap) даёт скидку покупки и наценку продажи', () => {
    const s = withUnlocked(30, ['ranger1', 'ranger2', 'ranger3a', 'ranger4', 'rangerCap']);
    const m = perkCombatMods(s);
    expect(m.buyMul).toBeCloseTo(0.8);
    expect(m.sellMul).toBeCloseTo(1.2);
  });

  it('без капстоунов их эффекты выключены', () => {
    const s = withUnlocked(20, ['marksman1', 'warrior1', 'ranger1']);
    const m = perkCombatMods(s);
    expect(m.arrowPierce).toBe(false);
    expect(m.secondWind).toBe(false);
    expect(m.buyMul).toBe(1);
    expect(m.sellMul).toBe(1);
  });
});

describe('миграция старых сейвов', () => {
  it('состояние с шестью старыми перками читается и даёт корректные моды', () => {
    // Старый сейв до углубления дерева: все шесть исходных перков.
    const old: PerkState = {
      unlocked: ['marksman1', 'marksman2', 'warrior1', 'warrior2', 'ranger1', 'ranger2'],
      points: 0,
    };
    const m = perkCombatMods(old);
    // Базовые эффекты исходных перков сохранены 1:1.
    expect(m.rangedMul).toBeCloseTo(1.2);
    expect(m.rangedCrit).toBeCloseTo(0.1);
    expect(m.meleeMul).toBeCloseTo(1.2);
    expect(m.defense).toBe(3);
    expect(m.speedMul).toBeCloseTo(1.1);
    expect(m.coinMagnetMul).toBeCloseTo(1.6);
    expect(m.faunaCalm).toBe(true);
    // Новые эффекты остаются нейтральными.
    expect(m.bonusMaxHp).toBe(0);
    expect(m.arrowPierce).toBe(false);
  });

  it('баланс очков восстановим: earned(level) − spent даёт неотрицательный остаток', () => {
    const old: PerkState = {
      unlocked: ['marksman1', 'marksman2', 'warrior1', 'warrior2', 'ranger1', 'ranger2'],
      points: 99, // в старом сейве мог быть любой остаток — Game пересчитает
    };
    const spent = perkPointsSpent(old); // 6 × 1 очко = 6 (все исходные tier 1-2)
    expect(spent).toBe(6);
    // На максимальном уровне заработано MAX_LEVEL-1 = 9 очков, остаток неотрицателен.
    const remaining = Math.max(0, perkPointsEarned(MAX_LEVEL) - spent);
    expect(remaining).toBe(3);
  });
});
