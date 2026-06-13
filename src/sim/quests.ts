// Чистая логика сайд-квестов жителей (Фаза 6B): состояния, прогресс, цепочки.
// Только числа/строки/plain-объекты — никакого Three/Rapier/DOM. Каталог квестов
// (тексты/цели/награды) — в data/quests.ts, выдача наград и интеракция — в Game
// через QuestSystem (систему-мост). Эта структура целиком сериализуется в сейв.
// Тестируется в node.
//
// Правила:
//  - Одновременно АКТИВНЫ до MAX_ACTIVE_QUESTS квестов (active или ready). Взять
//    ещё один, когда лимит достигнут, нельзя — житель вежливо отказывает ('full').
//  - Жизненный цикл одного квеста: idle → active → ready → done.
//    offered («предложен») — это не статус, а вычисляемая доступность: квест можно
//    взять, если он idle, его цепочка-кулдаун истёк и лимит активных не достигнут.
//  - Цепочки: сдал квест с next → у того идёт кулдаун CHAIN_DELAY_SEC, затем он
//    становится доступен. repeatable-квест после сдачи тоже уходит на кулдаун и
//    снова доступен. Сдал квест-«лист» (без next, не repeatable) — он done навсегда.

import { CHAIN_DELAY_SEC, QUESTS, QUESTS_BY_GIVER, type QuestDef, type VillagerId } from '../data/quests';

/** Сколько квестов игрок может вести одновременно (active|ready). */
export const MAX_ACTIVE_QUESTS = 4;

/** Статус одного квеста в забеге. */
export type QuestStatus =
  | 'idle' // ещё не взят (может быть доступен к выдаче, см. isOffered)
  | 'active' // взят, цель не выполнена
  | 'ready' // цель выполнена, можно сдавать
  | 'done'; // сдан (для не-repeatable — навсегда)

/** Снимок одного квеста: статус + прогресс + кулдаун цепочки. JSON-совместимо. */
export interface QuestEntry {
  status: QuestStatus;
  /** Текущий прогресс цели (kill/collect — счётчик; visit — 0/1). */
  progress: number;
  /** Остаток кулдауна цепочки до повторной доступности, с (0 — доступен сейчас). */
  cooldown: number;
}

/** Всё состояние квестов забега: записи по id + список активных квестов. */
export interface QuestState {
  /** Запись на каждый квест каталога (idle по умолчанию). */
  entries: Record<string, QuestEntry>;
  /**
   * id всех активных/готовых квестов (active|ready), до MAX_ACTIVE_QUESTS штук.
   * Порядок — порядок взятия (для стабильной отрисовки HUD-списка).
   */
  activeIds: string[];
  /**
   * Собранные «ключи к логову злодея» — id сданных fortKey-квестов (Фаза 8 гейтит
   * босса их числом). Без дублей. В UI ключи прямо не называются.
   */
  fortKeys: string[];
}

/** Свежее состояние нового забега: корневые квесты сразу доступны, остальные ждут. */
export function makeQuestState(): QuestState {
  const entries: Record<string, QuestEntry> = {};
  for (const id of Object.keys(QUESTS)) {
    entries[id] = { status: 'idle', progress: 0, cooldown: 0 };
  }
  return { entries, activeIds: [], fortKeys: [] };
}

/** Запись квеста (создаёт пустую, если квест новый/отсутствует). */
function entryOf(state: QuestState, id: string): QuestEntry {
  let e = state.entries[id];
  if (!e) {
    e = { status: 'idle', progress: 0, cooldown: 0 };
    state.entries[id] = e;
  }
  return e;
}

/** Лимит активных квестов исчерпан? (active|ready ровно activeIds.length штук). */
export function isAtActiveLimit(state: QuestState): boolean {
  return state.activeIds.length >= MAX_ACTIVE_QUESTS;
}

/**
 * Можно ли СЕЙЧАС предложить этот квест: он idle, кулдаун истёк и лимит активных
 * не достигнут. Корневой квест жителя доступен с самого начала; звенья цепочки/
 * repeatable открываются после сдачи предыдущего (там им выставлен кулдаун) —
 * пока кулдаун > 0, ещё рано.
 */
export function isOffered(state: QuestState, id: string): boolean {
  const def = QUESTS[id];
  if (!def) return false;
  const e = entryOf(state, id);
  if (e.status !== 'idle') return false;
  if (e.cooldown > 0) return false;
  // Лимит активных достигнут — новый брать нельзя.
  if (isAtActiveLimit(state)) return false;
  return true;
}

/**
 * Какой квест связан с этим жителем сейчас и роль для диалога:
 *  - 'ready'  — можно сдать (цель выполнена);
 *  - 'active' — взят, но не выполнен (показываем progressText); сюда же попадает
 *               deliver-квест у получателя с НЕДОБОРОМ предметов (remaining > 0);
 *  - 'offer'  — доступен к выдаче ПРЯМО СЕЙЧАС (лимит не достигнут, кулдаун истёк);
 *  - 'full'   — у жителя есть доступный квест, но лимит активных исчерпан;
 *  - 'wait'   — жителю есть что предложить позже (звено/повтор на кулдауне);
 *  - 'none'   — жителю нечего предложить (всё сдано окончательно).
 */
export type DialogRole = 'ready' | 'active' | 'offer' | 'full' | 'wait' | 'none';

/** Результат dialogFor: id квеста, роль и (для deliver-недобора) остаток предметов. */
export interface DialogInfo {
  id: string | null;
  role: DialogRole;
  /**
   * Сколько ещё предметов не хватает у получателя deliver-квеста (роль 'active'
   * по причине недобора). 0 — недобора нет / квест не deliver. Заполняется только
   * для случая «принеси ещё N» у получателя; Game берёт have из инвентаря и
   * вызывает recordDeliver, поэтому здесь remaining считается по прогрессу записи.
   */
  remaining?: number;
}

export function dialogFor(state: QuestState, giver: VillagerId, have = 0): DialogInfo {
  // Сперва — активные/готовые квесты, которые сдаются/ведутся у ЭТОГО жителя.
  // У deliver-квеста сдача идёт у получателя (deliverTo), а у выдатчика — прогресс.
  for (const id of state.activeIds) {
    const def = QUESTS[id];
    if (!def) continue;
    const e = entryOf(state, id);
    const deliverTo = def.goal.kind === 'deliver' ? def.goal.deliverTo : undefined;

    if (deliverTo) {
      // Deliver-квест. Получатель: сдаёт готовый или подсказывает «принеси ещё N».
      if (deliverTo === giver) {
        if (e.status === 'ready') return { id, role: 'ready' };
        // Активный deliver у получателя: не хватает предметов — показываем недобор,
        // а не свой квест жителя как 'full'. remaining считаем по факту в сумке.
        const remaining = Math.max(0, def.goal.count - Math.max(0, have));
        return { id, role: 'active', remaining };
      }
      // Выдатчик deliver-квеста: показываем прогресс (его тут не сдать).
      if (def.giver === giver) return { id, role: 'active' };
    } else {
      // Обычный квест ведёт и сдаёт его выдатчик.
      if (def.giver === giver) {
        return { id, role: e.status === 'ready' ? 'ready' : 'active' };
      }
    }
  }

  // Что житель мог бы предложить (корень или открывшееся звено его цепочки).
  const offerId = nextOfferOf(state, giver);
  if (!offerId) return { id: null, role: 'none' };
  if (isOffered(state, offerId)) return { id: offerId, role: 'offer' };
  // Есть, но не сейчас: лимит исчерпан → full, иначе ждём кулдауна → wait.
  if (isAtActiveLimit(state)) return { id: offerId, role: 'full' };
  return { id: offerId, role: 'wait' };
}

/**
 * Первый доступный-или-ожидающий квест жителя для предложения: idle-квест его
 * цепочки с истёкшим кулдауном. Если все idle-квесты ещё на кулдауне — вернёт
 * первый из них (для роли 'full'/будущего предложения), чтобы диалог знал, что
 * жителю ЕСТЬ что предложить позже. null — у жителя всё сдано окончательно.
 */
function nextOfferOf(state: QuestState, giver: VillagerId): string | null {
  const ids = QUESTS_BY_GIVER[giver] ?? [];
  // Сперва — реально доступный (idle, cooldown 0): его можно взять.
  for (const id of ids) {
    const e = entryOf(state, id);
    if (e.status === 'idle' && e.cooldown <= 0) return id;
  }
  // Иначе — idle на кулдауне (скоро откроется): жителю есть что предложить позже.
  for (const id of ids) {
    const e = entryOf(state, id);
    if (e.status === 'idle' && e.cooldown > 0) return id;
  }
  // Repeatable-квест жителя (done, но повторяемый) на кулдауне — тоже «позже».
  for (const id of ids) {
    const def = QUESTS[id];
    const e = entryOf(state, id);
    if (def?.repeatable && e.status === 'done') return id;
  }
  return null;
}

/**
 * Взять квест (offered → active). false, если квест недоступен (лимит/не idle/
 * кулдаун). Сбрасывает прогресс на 0 и добавляет квест в список активных.
 */
export function takeQuest(state: QuestState, id: string): boolean {
  if (!isOffered(state, id)) return false;
  const e = entryOf(state, id);
  e.status = 'active';
  e.progress = 0;
  if (!state.activeIds.includes(id)) state.activeIds.push(id);
  return true;
}

/** Цель квеста выполнена по текущему прогрессу? */
function goalMet(def: QuestDef, progress: number): boolean {
  return progress >= def.goal.count;
}

/**
 * Засчитать убийство для ВСЕХ активных kill-квестов сразу. archetype — id архетипа
 * цели, team — её команда (фильтр villain). matchTarget('') ловит любого villain,
 * иначе сверяет префикс ('skeleton' ловит skeleton_raider/brute/…). Один скелет
 * засчитывается каждому подходящему активному квесту (параллельный прогресс).
 * Возвращает true, если изменился хоть один квест (для обновления HUD).
 */
export function recordKill(state: QuestState, archetype: string, team: string): boolean {
  if (team !== 'villain') return false;
  let changed = false;
  for (const id of state.activeIds) {
    const def = QUESTS[id];
    if (!def || def.goal.kind !== 'kill') continue;
    if (!matchTarget(def.goal.target, archetype)) continue;
    const e = entryOf(state, id);
    if (e.status !== 'active') continue;
    e.progress = Math.min(def.goal.count, e.progress + 1);
    if (goalMet(def, e.progress)) e.status = 'ready';
    changed = true;
  }
  return changed;
}

/** Совпадает ли архетип с целью kill: пустая цель — любой; иначе префикс. */
function matchTarget(target: string, archetype: string): boolean {
  if (target === '') return true;
  return archetype.startsWith(target);
}

/**
 * Пересчитать прогресс активного collect-квеста по наличию предметов в сумке.
 * itemId — id предмета, have — сколько его сейчас в сумке (считает Game). Прогресс
 * = min(have, count) у всех активных collect-квестов на ЭТОТ предмет; при цели —
 * ready, при падении ниже — обратно в active. Возвращает true при изменении.
 */
export function syncCollect(state: QuestState, itemId: string, have: number): boolean {
  let changed = false;
  for (const id of state.activeIds) {
    const def = QUESTS[id];
    if (!def || def.goal.kind !== 'collect' || def.goal.target !== itemId) continue;
    const e = entryOf(state, id);
    if (e.status !== 'active' && e.status !== 'ready') continue;
    const next = Math.min(def.goal.count, Math.max(0, have));
    const wasReady = e.status === 'ready';
    if (next !== e.progress) changed = true;
    e.progress = next;
    if (goalMet(def, next)) {
      if (!wasReady) {
        e.status = 'ready';
        changed = true;
      }
    } else if (wasReady) {
      // Предмет ушёл из сумки — квест снова «в работе».
      e.status = 'active';
      changed = true;
    }
  }
  return changed;
}

/**
 * Засчитать осмотр места для активных visit-квестов. poiKind — kind POI, к
 * которому подошёл игрок (Game считает дистанцию). Совпало с целью → прогресс 1
 * и ready у каждого подходящего активного квеста. Возвращает true при изменении.
 */
export function recordVisit(state: QuestState, poiKind: string): boolean {
  let changed = false;
  for (const id of state.activeIds) {
    const def = QUESTS[id];
    if (!def || def.goal.kind !== 'visit' || def.goal.target !== poiKind) continue;
    const e = entryOf(state, id);
    if (e.status !== 'active') continue;
    e.progress = 1;
    e.status = 'ready';
    changed = true;
  }
  return changed;
}

/**
 * Засчитать доставку для активных deliver-квестов: игрок подошёл к NPC-получателю
 * (npcId) с have штуками предмета в сумке. Совпал получатель И предмета хватает
 * (have >= count) → прогресс = count и ready (сдать можно тут же, у получателя).
 * Возвращает true при переходе хоть одного квеста в ready. Изъятие предметов
 * делает Game при сдаче.
 */
export function recordDeliver(state: QuestState, npcId: string, have: number): boolean {
  let changed = false;
  for (const id of state.activeIds) {
    const def = QUESTS[id];
    if (!def || def.goal.kind !== 'deliver' || def.goal.deliverTo !== npcId) continue;
    const e = entryOf(state, id);
    if (e.status !== 'active') continue;
    if (have < def.goal.count) continue;
    e.progress = def.goal.count;
    e.status = 'ready';
    changed = true;
  }
  return changed;
}

/**
 * Сдать готовый квест (ready → done). false, если квест не готов. При успехе:
 *  - убирает квест из activeIds (освобождает слот);
 *  - запускает кулдаун цепочки/повтора: у next-квеста и/или самого repeatable
 *    выставляется CHAIN_DELAY_SEC, по истечении он станет доступен.
 * Выдачу наград и изъятие collect-предметов делает Game ВНЕ этой функции —
 * здесь только переходы состояний.
 */
export function turnInQuest(state: QuestState, id: string): boolean {
  const def = QUESTS[id];
  if (!def) return false;
  const e = entryOf(state, id);
  if (e.status !== 'ready') return false;
  e.status = 'done';
  e.progress = def.goal.count;
  const idx = state.activeIds.indexOf(id);
  if (idx >= 0) state.activeIds.splice(idx, 1);

  // Финал цепочки мирового NPC — копим «ключ» (без дублей). Гейтинг босса Фазы 8.
  if (def.fortKey && !state.fortKeys.includes(id)) state.fortKeys.push(id);

  // Открыть следующее звено цепочки на кулдауне (станет доступно позже).
  if (def.next) {
    const ne = entryOf(state, def.next);
    if (ne.status === 'idle') ne.cooldown = CHAIN_DELAY_SEC;
  }
  // Repeatable: вернуть в idle на кулдауне — снова предложит этот же квест.
  if (def.repeatable) {
    e.status = 'idle';
    e.progress = 0;
    e.cooldown = CHAIN_DELAY_SEC;
  }
  return true;
}

/**
 * Тик кулдаунов цепочек (раз в кадр/секунду — Game вызывает с dt). Уменьшает
 * cooldown всех записей до нуля, по достижении которого квест становится
 * доступен к выдаче (см. isOffered). Не аллоцирует.
 */
export function tickCooldowns(state: QuestState, dt: number): void {
  for (const id in state.entries) {
    const e = state.entries[id]!;
    if (e.cooldown > 0) {
      e.cooldown -= dt;
      if (e.cooldown < 0) e.cooldown = 0;
    }
  }
}

/** Снимок одного активного квеста для HUD: заголовок и прогресс «3/5». */
export interface ActiveQuestView {
  id: string;
  title: string;
  progress: number;
  count: number;
  /** Готов к сдаче (цель выполнена) — HUD подсветит. */
  ready: boolean;
}

/**
 * Список всех активных квестов для HUD (в порядке взятия), до MAX_ACTIVE_QUESTS
 * строк. Пустой — нет активных. Не аллоцирует сверх результирующего массива.
 */
export function activeQuestViews(state: QuestState): ActiveQuestView[] {
  const out: ActiveQuestView[] = [];
  for (const id of state.activeIds) {
    const def = QUESTS[id];
    if (!def) continue;
    const e = entryOf(state, id);
    out.push({
      id,
      title: def.title,
      progress: e.progress,
      count: def.goal.count,
      ready: e.status === 'ready',
    });
  }
  return out;
}

// ---- Ключи к логову злодея (Фаза 8) ----

/** Собран ли «ключ» от конкретного fortKey-квеста (по его id). */
export function hasFortKey(state: QuestState, questId: string): boolean {
  return state.fortKeys.includes(questId);
}

/** Сколько «ключей к логову» собрано (для гейтинга босса Фазы 8 и тикера). */
export function fortKeyCount(state: QuestState): number {
  return state.fortKeys.length;
}

// ---- Сериализация для сейва (валидация формы без классов) ----

const STATUSES: readonly QuestStatus[] = ['idle', 'active', 'ready', 'done'];

function isStatus(v: unknown): v is QuestStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

function isNonNegNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Проверка формы состояния квестов (для validateSave): записи + activeIds. */
export function isValidQuestState(v: unknown): v is QuestState {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  if (typeof s.entries !== 'object' || s.entries === null || Array.isArray(s.entries)) return false;
  const entries = s.entries as Record<string, unknown>;
  for (const id in entries) {
    const e = entries[id];
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
    const er = e as Record<string, unknown>;
    if (!isStatus(er.status)) return false;
    if (!isNonNegNum(er.progress)) return false;
    if (!isNonNegNum(er.cooldown)) return false;
  }
  // activeIds — массив строк (актуальный формат). Старый activeId (string|null)
  // мигрируется coerceQuestState, поэтому здесь требуем именно activeIds.
  if (!Array.isArray(s.activeIds)) return false;
  for (const id of s.activeIds) if (typeof id !== 'string') return false;
  // fortKeys — массив строк (если присутствует; старые сейвы коэрс дольёт пустым).
  if (s.fortKeys !== undefined) {
    if (!Array.isArray(s.fortKeys)) return false;
    for (const k of s.fortKeys) if (typeof k !== 'string') return false;
  }
  return true;
}

/**
 * Восстановить QuestState из кандидата сейва, отбросив записи неизвестных квестов
 * и починив клампы. Стартуем со свежего makeQuestState (все актуальные квесты в
 * idle), затем накладываем сохранённые статусы/прогресс/кулдауны поверх знакомых
 * id. activeIds уважаются, только если квест существует и реально active/ready;
 * лимит MAX_ACTIVE_QUESTS соблюдается. Понимает и старый формат activeId (один
 * квест, string|null), мигрируя его в activeIds. Возвращает валидный QuestState.
 */
export function coerceQuestState(v: unknown): QuestState {
  const fresh = makeQuestState();
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fresh;
  const s = v as Record<string, unknown>;
  const entries = s.entries;
  if (typeof entries === 'object' && entries !== null && !Array.isArray(entries)) {
    const src = entries as Record<string, unknown>;
    for (const id in fresh.entries) {
      const e = src[id];
      if (typeof e !== 'object' || e === null || Array.isArray(e)) continue;
      const er = e as Record<string, unknown>;
      const def = QUESTS[id];
      const count = def ? def.goal.count : Number.MAX_SAFE_INTEGER;
      const status = isStatus(er.status) ? er.status : 'idle';
      const progress = isNonNegNum(er.progress) ? Math.min(count, Math.floor(er.progress)) : 0;
      const cooldown = isNonNegNum(er.cooldown) ? er.cooldown : 0;
      fresh.entries[id] = { status, progress, cooldown };
    }
  }
  // Собрать кандидатов в активные: новый формат activeIds (массив) ИЛИ старый
  // activeId (одна строка) — миграция v4 «один активный» → «несколько активных».
  const candidates: string[] = [];
  if (Array.isArray(s.activeIds)) {
    for (const id of s.activeIds) if (typeof id === 'string') candidates.push(id);
  } else if (typeof s.activeId === 'string') {
    candidates.push(s.activeId);
  }
  // Активным считаем квест, который существует, реально active|ready и помещается
  // в лимит. Дубликаты и лишние — мимо.
  for (const id of candidates) {
    if (fresh.activeIds.length >= MAX_ACTIVE_QUESTS) break;
    if (fresh.activeIds.includes(id)) continue;
    const e = fresh.entries[id];
    if (e && (e.status === 'active' || e.status === 'ready')) fresh.activeIds.push(id);
  }
  // Согласованность: active/ready-записи, не попавшие в activeIds (лишние/за
  // лимитом/осиротевшие), сбрасываем в idle — чтобы HUD/диалог не «теряли» их.
  for (const id in fresh.entries) {
    const e = fresh.entries[id]!;
    if ((e.status === 'active' || e.status === 'ready') && !fresh.activeIds.includes(id)) {
      e.status = 'idle';
      e.progress = 0;
    }
  }
  // Ключи к логову: оставляем только id реальных fortKey-квестов, без дублей.
  if (Array.isArray(s.fortKeys)) {
    for (const k of s.fortKeys) {
      if (typeof k !== 'string') continue;
      const def: QuestDef | undefined = QUESTS[k];
      if (def?.fortKey && !fresh.fortKeys.includes(k)) fresh.fortKeys.push(k);
    }
  }
  return fresh;
}
