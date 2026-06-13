import { describe, expect, it } from 'vitest';
import {
  activeQuestViews,
  coerceQuestState,
  dialogFor,
  fortKeyCount,
  hasFortKey,
  isAtActiveLimit,
  isOffered,
  isValidQuestState,
  makeQuestState,
  MAX_ACTIVE_QUESTS,
  recordDeliver,
  recordKill,
  recordVisit,
  syncCollect,
  takeQuest,
  tickCooldowns,
  turnInQuest,
} from '../../src/sim/quests';
import { CHAIN_DELAY_SEC, QUESTS } from '../../src/data/quests';

describe('makeQuestState', () => {
  it('создаёт запись на каждый квест каталога в статусе idle, activeIds пуст', () => {
    const s = makeQuestState();
    for (const id of Object.keys(QUESTS)) {
      expect(s.entries[id]).toEqual({ status: 'idle', progress: 0, cooldown: 0 });
    }
    expect(s.activeIds).toEqual([]);
  });
});

describe('isOffered / takeQuest / лимит активных', () => {
  it('корневые квесты доступны сразу', () => {
    const s = makeQuestState();
    expect(isOffered(s, 'mirne_cull')).toBe(true);
    expect(isOffered(s, 'brandt_scout')).toBe(true);
    expect(isOffered(s, 'lesli_wolves')).toBe(true);
  });

  it('взятие квеста переводит offered → active и кладёт в activeIds', () => {
    const s = makeQuestState();
    expect(takeQuest(s, 'mirne_cull')).toBe(true);
    expect(s.entries.mirne_cull!.status).toBe('active');
    expect(s.activeIds).toEqual(['mirne_cull']);
    // Второй квест ТЕПЕРЬ можно взять параллельно (лимит > 1).
    expect(isOffered(s, 'lesli_wolves')).toBe(true);
    expect(takeQuest(s, 'lesli_wolves')).toBe(true);
    expect(s.activeIds).toEqual(['mirne_cull', 'lesli_wolves']);
  });

  it('нельзя взять уже активный/несуществующий квест', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull');
    expect(takeQuest(s, 'mirne_cull')).toBe(false);
    expect(takeQuest(s, 'no_such_quest')).toBe(false);
  });

  it('лимит MAX_ACTIVE_QUESTS: больше взять нельзя, пока что-то не закрыто', () => {
    const s = makeQuestState();
    // Берём ровно лимит из доступных корневых квестов.
    const roots = ['mirne_cull', 'brandt_scout', 'lesli_wolves', 'forester_trails', 'hermit_undead'];
    let taken = 0;
    for (const id of roots) {
      if (taken >= MAX_ACTIVE_QUESTS) break;
      if (takeQuest(s, id)) taken++;
    }
    expect(taken).toBe(MAX_ACTIVE_QUESTS);
    expect(s.activeIds.length).toBe(MAX_ACTIVE_QUESTS);
    expect(isAtActiveLimit(s)).toBe(true);
    // Ещё один корневой — недоступен (лимит).
    expect(isOffered(s, 'hermit_undead')).toBe(false);
    expect(takeQuest(s, 'hermit_undead')).toBe(false);
  });
});

describe('recordKill (параллельный прогресс)', () => {
  it('считает убийства villain по префиксу, переходит в ready на цели', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull'); // kill 5 skeleton
    for (let i = 0; i < 4; i++) {
      expect(recordKill(s, 'skeleton_raider', 'villain')).toBe(true);
    }
    expect(s.entries.mirne_cull!.progress).toBe(4);
    expect(s.entries.mirne_cull!.status).toBe('active');
    expect(recordKill(s, 'skeleton_brute', 'villain')).toBe(true);
    expect(s.entries.mirne_cull!.progress).toBe(5);
    expect(s.entries.mirne_cull!.status).toBe('ready');
  });

  it('один скелет двигает СРАЗУ все активные kill-квесты на него', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull'); // kill 5 skeleton
    takeQuest(s, 'lesli_wolves'); // kill 4 skeleton
    expect(recordKill(s, 'skeleton_raider', 'villain')).toBe(true);
    expect(s.entries.mirne_cull!.progress).toBe(1);
    expect(s.entries.lesli_wolves!.progress).toBe(1);
    // Добиваем lesli до ready, mirne ещё идёт.
    for (let i = 0; i < 3; i++) recordKill(s, 'skeleton_raider', 'villain');
    expect(s.entries.lesli_wolves!.status).toBe('ready');
    expect(s.entries.lesli_wolves!.progress).toBe(4);
    expect(s.entries.mirne_cull!.status).toBe('active');
    expect(s.entries.mirne_cull!.progress).toBe(4);
  });

  it('игнорирует не-villain и нерелевантные/лишние убийства', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull');
    expect(recordKill(s, 'guard_soldier', 'guard')).toBe(false);
    expect(recordKill(s, 'deer', 'villain')).toBe(false);
    expect(s.entries.mirne_cull!.progress).toBe(0);
    for (let i = 0; i < 5; i++) recordKill(s, 'skeleton_raider', 'villain');
    expect(recordKill(s, 'skeleton_raider', 'villain')).toBe(false);
    expect(s.entries.mirne_cull!.progress).toBe(5);
  });

  it('без активного kill-квеста ничего не меняет', () => {
    const s = makeQuestState();
    expect(recordKill(s, 'skeleton_raider', 'villain')).toBe(false);
    takeQuest(s, 'brandt_scout'); // visit, не kill
    expect(recordKill(s, 'skeleton_raider', 'villain')).toBe(false);
  });
});

describe('syncCollect', () => {
  it('прогресс = min(have, count), цель → ready, падение → обратно active', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull');
    for (let i = 0; i < 5; i++) recordKill(s, 'skeleton_raider', 'villain');
    turnInQuest(s, 'mirne_cull');
    tickCooldowns(s, CHAIN_DELAY_SEC);
    expect(takeQuest(s, 'mirne_bells')).toBe(true); // collect 3 caravan_bell

    expect(syncCollect(s, 'caravan_bell', 2)).toBe(true);
    expect(s.entries.mirne_bells!.progress).toBe(2);
    expect(s.entries.mirne_bells!.status).toBe('active');
    expect(syncCollect(s, 'caravan_bell', 5)).toBe(true);
    expect(s.entries.mirne_bells!.progress).toBe(3);
    expect(s.entries.mirne_bells!.status).toBe('ready');
    expect(syncCollect(s, 'caravan_bell', 1)).toBe(true);
    expect(s.entries.mirne_bells!.status).toBe('active');
    expect(s.entries.mirne_bells!.progress).toBe(1);
  });

  it('синкает только collect-квесты на указанный предмет', () => {
    const s = makeQuestState();
    takeQuest(s, 'quart_supply'); // collect 3 caravan_bell
    // Не тот предмет — мимо.
    expect(syncCollect(s, 'other_item', 9)).toBe(false);
    expect(s.entries.quart_supply!.progress).toBe(0);
    expect(syncCollect(s, 'caravan_bell', 3)).toBe(true);
    expect(s.entries.quart_supply!.status).toBe('ready');
  });
});

describe('recordVisit', () => {
  it('осмотр совпавшего POI переводит visit-квест в ready', () => {
    const s = makeQuestState();
    takeQuest(s, 'brandt_scout'); // visit tower_ruin
    expect(recordVisit(s, 'shrine')).toBe(false);
    expect(s.entries.brandt_scout!.status).toBe('active');
    expect(recordVisit(s, 'tower_ruin')).toBe(true);
    expect(s.entries.brandt_scout!.status).toBe('ready');
    expect(s.entries.brandt_scout!.progress).toBe(1);
    expect(recordVisit(s, 'tower_ruin')).toBe(false);
  });
});

describe('turnInQuest + цепочки/кулдауны', () => {
  it('сдача ready → done убирает из activeIds и ставит next на кулдаун', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull');
    for (let i = 0; i < 5; i++) recordKill(s, 'skeleton_raider', 'villain');
    expect(turnInQuest(s, 'mirne_cull')).toBe(true);
    expect(s.entries.mirne_cull!.status).toBe('done');
    expect(s.activeIds).toEqual([]);
    expect(s.entries.mirne_bells!.cooldown).toBe(CHAIN_DELAY_SEC);
    expect(isOffered(s, 'mirne_bells')).toBe(false);
    tickCooldowns(s, CHAIN_DELAY_SEC);
    expect(s.entries.mirne_bells!.cooldown).toBe(0);
    expect(isOffered(s, 'mirne_bells')).toBe(true);
  });

  it('сдача одного из нескольких активных не трогает остальные', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull'); // kill 5
    takeQuest(s, 'lesli_wolves'); // kill 4
    for (let i = 0; i < 5; i++) recordKill(s, 'skeleton_raider', 'villain');
    // Оба готовы (lesli при 4, mirne при 5).
    expect(s.entries.lesli_wolves!.status).toBe('ready');
    expect(s.entries.mirne_cull!.status).toBe('ready');
    expect(turnInQuest(s, 'mirne_cull')).toBe(true);
    expect(s.activeIds).toEqual(['lesli_wolves']);
    expect(s.entries.lesli_wolves!.status).toBe('ready');
  });

  it('нельзя сдать не-ready квест', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull');
    expect(turnInQuest(s, 'mirne_cull')).toBe(false);
  });

  it('repeatable-квест после сдачи возвращается в idle на кулдауне', () => {
    const s = makeQuestState();
    takeQuest(s, 'lesli_wolves');
    for (let i = 0; i < 4; i++) recordKill(s, 'skeleton_raider', 'villain');
    expect(turnInQuest(s, 'lesli_wolves')).toBe(true);
    expect(s.entries.lesli_wolves!.status).toBe('idle');
    expect(s.entries.lesli_wolves!.progress).toBe(0);
    expect(s.entries.lesli_wolves!.cooldown).toBe(CHAIN_DELAY_SEC);
    expect(s.activeIds).toEqual([]);
    expect(isOffered(s, 'lesli_wolves')).toBe(false);
    tickCooldowns(s, CHAIN_DELAY_SEC + 1);
    expect(isOffered(s, 'lesli_wolves')).toBe(true);
    expect(takeQuest(s, 'lesli_wolves')).toBe(true);
  });
});

describe('dialogFor', () => {
  it('предлагает корневой квест, активный показывает прогресс, готовый — сдачу', () => {
    const s = makeQuestState();
    expect(dialogFor(s, 'mirne')).toMatchObject({ id: 'mirne_cull', role: 'offer' });
    takeQuest(s, 'mirne_cull');
    expect(dialogFor(s, 'mirne')).toMatchObject({ id: 'mirne_cull', role: 'active' });
    for (let i = 0; i < 5; i++) recordKill(s, 'skeleton_raider', 'villain');
    expect(dialogFor(s, 'mirne')).toMatchObject({ id: 'mirne_cull', role: 'ready' });
  });

  it('другой житель при свободном слоте предлагает свой квест (offer, не busy)', () => {
    const s = makeQuestState();
    takeQuest(s, 'mirne_cull');
    const d = dialogFor(s, 'lesli');
    expect(d.role).toBe('offer');
    expect(d.id).toBe('lesli_wolves');
  });

  it('при достигнутом лимите житель отвечает full', () => {
    const s = makeQuestState();
    const roots = ['mirne_cull', 'brandt_scout', 'forester_trails', 'hermit_undead'];
    for (const id of roots) takeQuest(s, id);
    expect(isAtActiveLimit(s)).toBe(true);
    // lesli свободна, но у игрока лимит — её квест предлагается как full.
    const d = dialogFor(s, 'lesli');
    expect(d.role).toBe('full');
    expect(d.id).toBe('lesli_wolves');
  });

  it('звено цепочки на кулдауне даёт роль wait, потом offer', () => {
    const s = makeQuestState();
    takeQuest(s, 'brandt_scout');
    recordVisit(s, 'tower_ruin');
    turnInQuest(s, 'brandt_scout');
    expect(dialogFor(s, 'brandt')).toMatchObject({ id: 'brandt_defend', role: 'wait' });
    tickCooldowns(s, CHAIN_DELAY_SEC);
    expect(dialogFor(s, 'brandt')).toMatchObject({ id: 'brandt_defend', role: 'offer' });
  });
});

describe('activeQuestViews', () => {
  it('отдаёт список заголовков и прогресса всех активных квестов в порядке взятия', () => {
    const s = makeQuestState();
    expect(activeQuestViews(s)).toEqual([]);
    takeQuest(s, 'mirne_cull');
    takeQuest(s, 'lesli_wolves');
    recordKill(s, 'skeleton_raider', 'villain');
    const v = activeQuestViews(s);
    expect(v.map((x) => x.id)).toEqual(['mirne_cull', 'lesli_wolves']);
    expect(v[0]!.title).toBe(QUESTS.mirne_cull!.title);
    expect(v[0]!.progress).toBe(1);
    expect(v[0]!.count).toBe(5);
    expect(v[0]!.ready).toBe(false);
  });
});

describe('сериализация (coerce/validate)', () => {
  it('makeQuestState проходит isValidQuestState', () => {
    expect(isValidQuestState(makeQuestState())).toBe(true);
  });

  it('coerce старого сейва без quests даёт свежее состояние', () => {
    const s = coerceQuestState(undefined);
    expect(isValidQuestState(s)).toBe(true);
    expect(s.activeIds).toEqual([]);
    expect(s.entries.mirne_cull!.status).toBe('idle');
  });

  it('МИГРАЦИЯ: старый формат activeId (один квест) → activeIds', () => {
    const raw = {
      entries: {
        mirne_cull: { status: 'active', progress: 3, cooldown: 0 },
      },
      activeId: 'mirne_cull', // старое поле v4 «один активный»
    };
    const s = coerceQuestState(raw);
    expect(s.activeIds).toEqual(['mirne_cull']);
    expect(s.entries.mirne_cull!.status).toBe('active');
    expect(s.entries.mirne_cull!.progress).toBe(3);
    expect(isValidQuestState(s)).toBe(true);
  });

  it('coerce восстанавливает несколько активных и чинит осиротевшие', () => {
    const raw = {
      entries: {
        mirne_cull: { status: 'active', progress: 3, cooldown: 0 },
        lesli_wolves: { status: 'ready', progress: 4, cooldown: 0 },
        unknown_quest: { status: 'active', progress: 9, cooldown: 0 },
        brandt_scout: { status: 'ready', progress: 1, cooldown: 0 }, // не в activeIds → idle
      },
      activeIds: ['mirne_cull', 'lesli_wolves'],
    };
    const s = coerceQuestState(raw);
    expect(s.activeIds).toEqual(['mirne_cull', 'lesli_wolves']);
    expect(s.entries.mirne_cull!.status).toBe('active');
    expect(s.entries.lesli_wolves!.status).toBe('ready');
    expect(s.entries.unknown_quest).toBeUndefined();
    // ready-запись вне activeIds сброшена в idle.
    expect(s.entries.brandt_scout!.status).toBe('idle');
  });

  it('coerce клампит прогресс по count, чинит кулдаун и соблюдает лимит', () => {
    const ok = coerceQuestState({
      entries: { mirne_cull: { status: 'active', progress: 999, cooldown: -5 } },
      activeIds: ['mirne_cull'],
    });
    expect(ok.entries.mirne_cull!.progress).toBe(QUESTS.mirne_cull!.goal.count);
    expect(ok.entries.mirne_cull!.cooldown).toBe(0);
    expect(ok.activeIds).toEqual(['mirne_cull']);

    // Осиротевший active без записи в activeIds → idle.
    const orphan = coerceQuestState({
      entries: { mirne_cull: { status: 'active', progress: 3, cooldown: 0 } },
      activeIds: ['ghost'],
    });
    expect(orphan.activeIds).toEqual([]);
    expect(orphan.entries.mirne_cull!.status).toBe('idle');
    expect(orphan.entries.mirne_cull!.progress).toBe(0);
  });

  it('coerce обрезает activeIds по лимиту, выбрасывая лишние/дубли в idle', () => {
    const entries: Record<string, { status: string; progress: number; cooldown: number }> = {};
    const ids = ['mirne_cull', 'brandt_scout', 'lesli_wolves', 'forester_trails', 'hermit_undead'];
    for (const id of ids) entries[id] = { status: 'active', progress: 1, cooldown: 0 };
    const s = coerceQuestState({ entries, activeIds: [...ids, 'mirne_cull'] }); // 5 + дубль
    expect(s.activeIds.length).toBe(MAX_ACTIVE_QUESTS);
    // Пятый (за лимитом) сброшен в idle.
    const dropped = ids[MAX_ACTIVE_QUESTS]!;
    expect(s.entries[dropped]!.status).toBe('idle');
  });

  it('round-trip через JSON сохраняет несколько активных квестов', () => {
    const s = makeQuestState();
    takeQuest(s, 'lesli_wolves');
    takeQuest(s, 'mirne_cull');
    recordKill(s, 'skeleton_raider', 'villain');
    const restored = coerceQuestState(JSON.parse(JSON.stringify(s)));
    expect(restored.activeIds).toEqual(['lesli_wolves', 'mirne_cull']);
    expect(restored.entries.lesli_wolves!.progress).toBe(1);
    expect(restored.entries.mirne_cull!.progress).toBe(1);
  });
});

describe('recordDeliver (доставка предмета другому NPC)', () => {
  it('переводит deliver-квест в ready только у нужного получателя и при наличии предмета', () => {
    const s = makeQuestState();
    takeQuest(s, 'fisher_parcel'); // deliver 2 caravan_bell → quartermaster
    const def = QUESTS.fisher_parcel!;
    expect(def.goal.kind).toBe('deliver');
    expect(recordDeliver(s, 'hermit', 5)).toBe(false);
    expect(s.entries.fisher_parcel!.status).toBe('active');
    expect(recordDeliver(s, def.goal.deliverTo!, 1)).toBe(false);
    expect(s.entries.fisher_parcel!.status).toBe('active');
    expect(recordDeliver(s, def.goal.deliverTo!, 2)).toBe(true);
    expect(s.entries.fisher_parcel!.status).toBe('ready');
    expect(s.entries.fisher_parcel!.progress).toBe(2);
  });

  it('без активного deliver-квеста ничего не меняет', () => {
    const s = makeQuestState();
    expect(recordDeliver(s, 'quartermaster', 9)).toBe(false);
    takeQuest(s, 'lesli_wolves'); // kill, не deliver
    expect(recordDeliver(s, 'quartermaster', 9)).toBe(false);
  });

  it('БАГ-РЕПРО игрока: рыбак→квартирмейстер сдаётся у получателя через dialogFor', () => {
    const s = makeQuestState();
    // Взял у рыбака.
    expect(takeQuest(s, 'fisher_parcel')).toBe(true);
    const def = QUESTS.fisher_parcel!;
    const recv = def.goal.deliverTo!; // quartermaster

    // Подошёл к квартирмейстеру БЕЗ предметов: получатель не отвечает «занят/закончи
    // дело», а просит донести остаток (роль active с remaining), НЕ предлагает свой
    // квест как busy/full.
    const empty = dialogFor(s, recv, 0);
    expect(empty.role).toBe('active');
    expect(empty.id).toBe('fisher_parcel');
    expect(empty.remaining).toBe(def.goal.count);

    // Частичный набор (1 из 2) — всё ещё «принеси ещё 1».
    const partial = dialogFor(s, recv, 1);
    expect(partial.role).toBe('active');
    expect(partial.remaining).toBe(1);

    // Предметы в инвентаре (2 шт.) — Game вызывает recordDeliver, квест → ready.
    expect(recordDeliver(s, recv, 2)).toBe(true);
    // Теперь у получателя — сдача (ready), у выдатчика (fisher) — прогресс (active).
    expect(dialogFor(s, recv).role).toBe('ready');
    expect(dialogFor(s, recv).id).toBe('fisher_parcel');
    expect(dialogFor(s, 'fisher').role).toBe('active');
    // Сдача проходит у получателя.
    expect(turnInQuest(s, 'fisher_parcel')).toBe(true);
    expect(s.entries.fisher_parcel!.status).toBe('done');
    expect(s.activeIds).toEqual([]);
  });

  it('deliver идёт параллельно с kill-квестом, не блокируя получателя', () => {
    const s = makeQuestState();
    takeQuest(s, 'fisher_parcel'); // deliver → quartermaster
    takeQuest(s, 'lesli_wolves'); // kill 4
    recordKill(s, 'skeleton_raider', 'villain');
    // У получателя deliver всё равно показывается недобор, а не свой квест.
    expect(dialogFor(s, 'quartermaster', 0).id).toBe('fisher_parcel');
    recordDeliver(s, 'quartermaster', 2);
    expect(dialogFor(s, 'quartermaster').role).toBe('ready');
    expect(s.entries.lesli_wolves!.progress).toBe(1); // kill идёт сам по себе
  });
});

describe('fortKeys (ключи к логову злодея)', () => {
  it('сдача fortKey-квеста копит ключ, обычного — нет', () => {
    const s = makeQuestState();
    expect(fortKeyCount(s)).toBe(0);
    takeQuest(s, 'lesli_wolves');
    for (let i = 0; i < 4; i++) recordKill(s, 'skeleton_raider', 'villain');
    turnInQuest(s, 'lesli_wolves');
    expect(fortKeyCount(s)).toBe(0);
    expect(QUESTS.hermit_ward!.fortKey).toBe(true);
    takeQuest(s, 'hermit_undead');
    for (let i = 0; i < QUESTS.hermit_undead!.goal.count; i++) recordKill(s, 'skeleton_raider', 'villain');
    turnInQuest(s, 'hermit_undead');
    expect(fortKeyCount(s)).toBe(0);
    tickCooldowns(s, CHAIN_DELAY_SEC);
    takeQuest(s, 'hermit_ward');
    syncCollect(s, 'caravan_bell', QUESTS.hermit_ward!.goal.count);
    turnInQuest(s, 'hermit_ward');
    expect(hasFortKey(s, 'hermit_ward')).toBe(true);
    expect(fortKeyCount(s)).toBe(1);
  });

  it('ключи переживают round-trip через coerce и не дублируются', () => {
    const s = makeQuestState();
    takeQuest(s, 'fisher_parcel');
    recordDeliver(s, QUESTS.fisher_parcel!.goal.deliverTo!, 2);
    turnInQuest(s, 'fisher_parcel');
    expect(hasFortKey(s, 'fisher_parcel')).toBe(true);
    const restored = coerceQuestState(JSON.parse(JSON.stringify(s)));
    expect(hasFortKey(restored, 'fisher_parcel')).toBe(true);
    expect(fortKeyCount(restored)).toBe(1);
    expect(isValidQuestState(restored)).toBe(true);
  });

  it('coerce отбрасывает неизвестные/не-fortKey id из сохранённого списка', () => {
    const raw = {
      entries: makeQuestState().entries,
      activeIds: [],
      fortKeys: ['hermit_ward', 'ghost_key', 'lesli_wolves'],
    };
    const s = coerceQuestState(raw);
    expect(hasFortKey(s, 'hermit_ward')).toBe(true);
    expect(hasFortKey(s, 'ghost_key')).toBe(false);
    expect(hasFortKey(s, 'lesli_wolves')).toBe(false);
    expect(fortKeyCount(s)).toBe(1);
  });
});
