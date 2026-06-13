// Каталог сайд-квестов жителей деревни (Фаза 6B). Чистые данные без Three/Rapier:
// id квеста, житель-выдатель, тип цели и счётчик, награды, реплики и звено цепочки.
// Логика переходов состояний — в sim/quests.ts, выдача и прогресс — в Game через
// QuestSystem. Тексты живые и короткие, в духе деревни эльфов.
//
// Цепочки: после сдачи квеста QuestSystem через CHAIN_DELAY_SEC предлагает next
// (если он есть) или снова делает repeatable-квест доступным. Одновременно у
// игрока активен ровно ОДИН квест — взять второй нельзя (житель просит закончить).

/** Тип цели квеста. */
export type QuestGoalKind =
  | 'kill' // убить N врагов команды villain (скелеты/стража форта) — событие enemy:died
  | 'collect' // принести N предметов inventory-id (при сдаче изымаются)
  | 'visit' // дойти до POI-места (kind из Landmarks) ближе VISIT_RADIUS
  | 'deliver'; // отнести N предметов ДРУГОМУ NPC (deliverTo) и сдать у него (предметы изымаются)

/**
 * Выдатели квестов (id привязан к моделям/позициям).
 *  - деревня (Villagers): mirne/brandt/lesli;
 *  - мировые локации (WorldNpcs, волна B): hermit (водопад), forester (лес),
 *    fisher (пирс), quartermaster (дворец).
 */
export type VillagerId =
  | 'mirne'
  | 'brandt'
  | 'lesli'
  | 'hermit'
  | 'forester'
  | 'fisher'
  | 'quartermaster'
  | 'miller' // мельник на ферме у конца северо-восточного просёлка
  | 'sentry'; // дозорный на сторожевой заставе у конца восточного тракта

/** Подмножество — деревенские жители (Villagers): только их Villagers и спавнит. */
export type VillageNpcId = 'mirne' | 'brandt' | 'lesli';

/** Описание одного квеста. */
export interface QuestDef {
  id: string;
  /** Кто выдаёт (для фильтра «этот житель про этот квест»). */
  giver: VillagerId;
  /** Заголовок строки HUD и диалога. */
  title: string;
  goal: {
    kind: QuestGoalKind;
    /** Сколько нужно (kill/collect/deliver — счётчик; visit — всегда 1). */
    count: number;
    /** kill: префикс архетипа цели ('' — любой villain). collect/deliver: id предмета. visit: kind POI. */
    target: string;
    /** deliver: кому отнести (id NPC-получателя, сдача — у него, не у выдатчика). */
    deliverTo?: VillagerId;
  };
  reward: {
    coins: number;
    xp: number;
    /** Предметная награда (id из data/items + count) — опционально. */
    item?: { id: string; count: number };
  };
  /** Реплика при предложении квеста. */
  offerText: string;
  /** Подсказка «ещё не готово» при разговоре во время active. */
  progressText: string;
  /** Реплика при сдаче готового квеста. */
  doneText: string;
  /** Повторяемый: после сдачи снова можно взять (через CHAIN_DELAY_SEC). */
  repeatable?: boolean;
  /** id следующего квеста цепочки (предлагается после сдачи этого). */
  next?: string;
  /**
   * Финал цепочки мирового NPC — «ключ к логову злодея» (Фаза 8 гейтит босса
   * собранными ключами). Сдача такого квеста копит его id в QuestState.fortKeys.
   * В игровых текстах ключи НЕ называются прямо — только тикер «ещё один шаг…».
   */
  fortKey?: boolean;
}

/** Радиус «осмотра» места для visit-квеста, м. */
export const VISIT_RADIUS = 9;
/** Задержка перед предложением следующего/повторного квеста после сдачи, с. */
export const CHAIN_DELAY_SEC = 60;

/**
 * 5 квестов, по 1–2 на жителя, связаны в цепочки:
 *  - Мирне-травница: cobweb_kill → caravan_bell collect (награда — зелье прыти).
 *  - Брандт-плотник: visit руин башни → kill скелетов (повторяемый «оборона»).
 *  - Лесли-пастушка: kill скелетов у пастбища (одиночный, монеты+XP).
 */
export const QUESTS: Record<string, QuestDef> = {
  // --- Мирне-травница ---
  mirne_cull: {
    id: 'mirne_cull',
    giver: 'mirne',
    title: 'Извести нежить',
    goal: { kind: 'kill', count: 5, target: 'skeleton' },
    reward: { coins: 60, xp: 30 },
    offerText:
      'Травы у опушки топчет нежить — пятерых костяных упокой, и я отблагодарю.',
    progressText: 'Ещё бродят костяные у опушки. Вернись, когда управишься.',
    doneText: 'Тише стало у опушки. Вот тебе за труды — и моя признательность.',
    next: 'mirne_bells',
  },
  mirne_bells: {
    id: 'mirne_bells',
    giver: 'mirne',
    title: 'Бубенцы корована',
    goal: { kind: 'collect', count: 3, target: 'caravan_bell' },
    reward: { coins: 90, xp: 45, item: { id: 'potion_swift', count: 1 } },
    offerText:
      'Принеси три бубенчика с корованов — звон отгоняет хворь. В долгу не останусь, дам зелье прыти.',
    progressText: 'Мне нужно три бубенчика корована. Загляни в корзину, как соберёшь.',
    doneText: 'Звонкие! Спасибо. Держи зелье прыти — пригодится в дороге.',
    repeatable: true,
  },

  // --- Брандт-плотник ---
  brandt_scout: {
    id: 'brandt_scout',
    giver: 'brandt',
    title: 'Осмотреть руины башни',
    goal: { kind: 'visit', count: 1, target: 'tower_ruin' },
    reward: { coins: 40, xp: 20 },
    offerText:
      'Старую башню на пустоши давно никто не видал. Сходи, глянь, цел ли там камень — мне на сруб сгодится.',
    progressText: 'Башня всё ещё стоит без присмотра. Дойди да осмотрись.',
    doneText: 'Камень, говоришь, добрый? Отлично. Вот за разведку.',
    next: 'brandt_defend',
  },
  brandt_defend: {
    id: 'brandt_defend',
    giver: 'brandt',
    title: 'Оборона деревни',
    goal: { kind: 'kill', count: 8, target: 'skeleton' },
    reward: { coins: 120, xp: 70 },
    offerText:
      'Костяные лезут к домам — выкоси восьмерых, пока я ставни латаю. Заплачу щедро.',
    progressText: 'Скелеты ещё топчутся у домов. Дай им отпор — потом и потолкуем.',
    doneText: 'Знатно ты их проредил! Держи кошель — заслужил.',
    repeatable: true,
  },

  // --- Лесли-пастушка ---
  lesli_wolves: {
    id: 'lesli_wolves',
    giver: 'lesli',
    title: 'Защитить пастбище',
    goal: { kind: 'kill', count: 4, target: 'skeleton' },
    reward: { coins: 50, xp: 25 },
    offerText:
      'Костяные пугают моих овец! Убей четверых, и стадо снова уснёт спокойно.',
    progressText: 'Овцы всё ещё жмутся в кучу. Разгони костяных, прошу.',
    doneText: 'Слышишь, как затихли? Спасибо тебе. Вот, держи за помощь.',
    repeatable: true,
  },

  // === Мировые NPC (волна B): локации вне деревни. Цепочки ведут к походу на
  //     злодея — финал каждой помечен fortKey (копится в сейв, гейтинг Фазы 8). ===

  // --- Лесник у хижины в чаще ---
  forester_trails: {
    id: 'forester_trails',
    giver: 'forester',
    title: 'Тропы охотника',
    goal: { kind: 'visit', count: 1, target: 'hunter_camp' },
    reward: { coins: 55, xp: 30 },
    offerText:
      'Хочешь ходить по этим землям тихо — выучи тропы. Найди старую стоянку охотника в чаще и осмотрись там.',
    progressText: 'Стоянку охотника так и не нашёл? Она в глуши, поодаль от дорог. Ищи.',
    doneText: 'Запомнил тропу? Добро. Теперь чаща тебя не обманет. Держи за труды.',
    next: 'forester_warden',
  },
  forester_warden: {
    id: 'forester_warden',
    giver: 'forester',
    title: 'Расчистить чащу',
    goal: { kind: 'kill', count: 7, target: 'skeleton' },
    reward: { coins: 140, xp: 80 },
    offerText:
      'Нежить расплодилась в лесу — семерых упокой. Кто пойдёт на злодея, тот сперва очистит дорогу к нему.',
    progressText: 'Костяные ещё бродят меж сосен. Проредь их, тогда и поговорим.',
    doneText: 'Чаща дышит легче. Ты готов идти дальше прежнего — это чувствуется.',
    fortKey: true,
  },

  // --- Отшельник у водопада ---
  hermit_undead: {
    id: 'hermit_undead',
    giver: 'hermit',
    title: 'Слабость нежити',
    goal: { kind: 'kill', count: 6, target: 'skeleton' },
    reward: { coins: 90, xp: 50 },
    offerText:
      'Кость ломка, а воля в ней чужая. Срази шестерых костяных — и увидишь, как легко гаснет их сила. Это знание тебе пригодится.',
    progressText: 'Мало ещё повержено. Бей в кость без колебаний — она того и боится.',
    doneText: 'Видел, как они рассыпаются? Запомни это. Вот тебе за урок.',
    next: 'hermit_ward',
  },
  hermit_ward: {
    id: 'hermit_ward',
    giver: 'hermit',
    title: 'Оберег у воды',
    goal: { kind: 'collect', count: 2, target: 'caravan_bell' },
    reward: { coins: 130, xp: 75, item: { id: 'potion_big', count: 1 } },
    offerText:
      'Принеси два бубенчика с корованов — звон их я вплету в оберег. С ним ты ступишь туда, где другие не выстоят.',
    progressText: 'Мне нужны два звонких бубенчика. Сними их с корована и возвращайся.',
    doneText: 'Звон чист. Оберег готов — и ты теперь ближе к логову, чем думаешь.',
    fortKey: true,
  },

  // --- Рыбак у пирса (deliver: отнести улов-обмен квартирмейстеру) ---
  fisher_parcel: {
    id: 'fisher_parcel',
    giver: 'fisher',
    title: 'Посылка к дворцу',
    goal: { kind: 'deliver', count: 2, target: 'caravan_bell', deliverTo: 'quartermaster' },
    reward: { coins: 150, xp: 85 },
    offerText:
      'Снеси два бубенчика квартирмейстеру у дворца — он давно их ждёт для своих обозов. В долгу не останусь, да и он тебя приметит.',
    progressText: 'Бубенчики ещё у тебя? Квартирмейстер стоит у палаток дворца. Снеси ему.',
    doneText: 'Доставил? Вот спасибо. Квартирмейстер таких людей помнит — а это дорогого стоит.',
    fortKey: true,
  },

  // --- Квартирмейстер у дворца ---
  quart_supply: {
    id: 'quart_supply',
    giver: 'quartermaster',
    title: 'Снабжение обозов',
    goal: { kind: 'collect', count: 3, target: 'caravan_bell' },
    reward: { coins: 110, xp: 60 },
    offerText:
      'Обозам нужны бубенцы — три штуки, и я закрою наряд. Принесёшь — сочтёмся, и разговор пойдёт серьёзнее.',
    progressText: 'Три бубенчика, не меньше. Без них наряд не закрыть.',
    doneText: 'Наряд закрыт. Дельно. Похоже, на тебя и впрямь можно положиться.',
    next: 'quart_recon',
  },
  quart_recon: {
    id: 'quart_recon',
    giver: 'quartermaster',
    title: 'Разведка обозного пути',
    goal: { kind: 'visit', count: 1, target: 'broken_cart' },
    reward: { coins: 160, xp: 95 },
    offerText:
      'Один обоз застрял на пустоши — осмотри развалины телеги и доложи. Тот, кто пойдёт на логово, должен знать дороги наперёд.',
    progressText: 'Развалины телеги ещё не осмотрены. Найди их на пустоши.',
    doneText: 'Путь ясен. Теперь и до логова злодея дорога открыта — почти.',
    fortKey: true,
  },

  // --- Мельник на ферме (конец северо-восточного просёлка) ---
  miller_bells: {
    id: 'miller_bells',
    giver: 'miller',
    title: 'Бубенцы для оберега',
    goal: { kind: 'collect', count: 2, target: 'caravan_bell' },
    reward: { coins: 70, xp: 35 },
    offerText:
      'Мыши да нежить повадились на ферму. Старики говорят: звон бубенца с корована отгоняет беду. Принеси два — повешу над амбаром.',
    progressText: 'Два бубенчика с корована, не меньше. Сними их и возвращайся на ферму.',
    doneText: 'Звонкие! Теперь над амбаром будет покойно. Держи за труды.',
    next: 'miller_grain',
  },
  miller_grain: {
    id: 'miller_grain',
    giver: 'miller',
    title: 'Зерно квартирмейстеру',
    goal: { kind: 'deliver', count: 3, target: 'caravan_bell', deliverTo: 'quartermaster' },
    reward: { coins: 130, xp: 70 },
    offerText:
      'Я смолол муку для дворцовых обозов, да расплата — бубенцами. Снеси три квартирмейстеру у дворца, он рассчитается, а меня знают как честного мельника.',
    progressText: 'Три бубенчика квартирмейстеру у палаток дворца. Снеси — и дело сделано.',
    doneText: 'Доставил? Вот спасибо. С дворцом у меня теперь лад — и у тебя там доброе слово.',
    repeatable: true,
  },

  // --- Дозорный на сторожевой заставе (конец восточного тракта) ---
  sentry_patrol: {
    id: 'sentry_patrol',
    giver: 'sentry',
    title: 'Расчистить подступы',
    goal: { kind: 'kill', count: 6, target: 'skeleton' },
    reward: { coins: 80, xp: 45 },
    offerText:
      'С заставы видно: костяные стягиваются к восточному тракту — разведка злодея. Положи шестерых, пока они не осмелели. Это первый шаг к его логову.',
    progressText: 'Костяные ещё рыщут у тракта. Проредь их — потом доложишь.',
    doneText: 'Чисто на подступах. Злодей не дождётся своих глаз тут. Держи за службу.',
    next: 'sentry_vanguard',
  },
  sentry_vanguard: {
    id: 'sentry_vanguard',
    giver: 'sentry',
    title: 'Сломить дозор злодея',
    goal: { kind: 'kill', count: 9, target: 'skeleton' },
    reward: { coins: 170, xp: 100 },
    offerText:
      'Кто идёт на форт, тот сперва ломает его дозоры. Срази ещё девятерых костяных — и путь к логову будет открыт, а злодей ослепнет на этом направлении.',
    progressText: 'Дозор злодея ещё держится. Бей костяных без счёта — нам нужно девять.',
    doneText: 'Дозор сломлен! Теперь к форту можно подойти незамеченным. Ты готов к самому злодею.',
    fortKey: true,
  },
};

/** Какие квесты этого жителя — в порядке выдачи (первый «корневой», дальше цепочка). */
export const QUESTS_BY_GIVER: Record<VillagerId, string[]> = {
  mirne: ['mirne_cull', 'mirne_bells'],
  brandt: ['brandt_scout', 'brandt_defend'],
  lesli: ['lesli_wolves'],
  // Мировые NPC (волна B):
  forester: ['forester_trails', 'forester_warden'],
  hermit: ['hermit_undead', 'hermit_ward'],
  fisher: ['fisher_parcel'],
  quartermaster: ['quart_supply', 'quart_recon'],
  miller: ['miller_bells', 'miller_grain'],
  sentry: ['sentry_patrol', 'sentry_vanguard'],
};

/** Имя и роль выдатчика — для диалога и подписи. */
export const VILLAGERS: Record<VillagerId, { name: string; role: string }> = {
  mirne: { name: 'Мирне', role: 'травница' },
  brandt: { name: 'Брандт', role: 'плотник' },
  lesli: { name: 'Лесли', role: 'пастушка' },
  // Мировые NPC (волна B):
  hermit: { name: 'Эадрик', role: 'отшельник' },
  forester: { name: 'Корвин', role: 'лесник' },
  fisher: { name: 'Тобиас', role: 'рыбак' },
  quartermaster: { name: 'Дунмар', role: 'квартирмейстер' },
  miller: { name: 'Гаррет', role: 'мельник' },
  sentry: { name: 'Освальд', role: 'дозорный' },
};

// Проверка целостности каталога на старте: giver валиден, next ссылается на
// существующий квест, collect/предметы указывают на реальные id. Падать на
// старте лучше, чем ловить undefined в диалоге.
for (const q of Object.values(QUESTS)) {
  if (!QUESTS_BY_GIVER[q.giver]) {
    throw new Error(`QUESTS["${q.id}"]: неизвестный житель-выдатель "${q.giver}"`);
  }
  if (q.next && !QUESTS[q.next]) {
    throw new Error(`QUESTS["${q.id}"]: next ссылается на несуществующий квест "${q.next}"`);
  }
  // deliver: получатель должен быть реальным NPC (иначе квест нечем сдать).
  if (q.goal.kind === 'deliver' && (!q.goal.deliverTo || !QUESTS_BY_GIVER[q.goal.deliverTo])) {
    throw new Error(`QUESTS["${q.id}"]: deliver.deliverTo ссылается на неизвестного NPC "${q.goal.deliverTo}"`);
  }
}
