// Интро-заставка (Фаза 6C): чистая раскадровка кинематографичного облёта уже
// построенного мира под титры-цитаты из «ТЗ» мальчика Кирилла (мем «Можно грабить
// корованы», ~2002). Этот модуль — БЕЗ three и БЕЗ DOM: только структуры сцен,
// тайминги, сплайн-интерполяция камеры и флаг «заставка уже показана» (localStorage).
// Рендер-часть (IntroCinematic.ts) тонкая: читает отсюда позу камеры/титр по времени.
//
// Почему отдельный чистый модуль: тайминги/монотонность/валидность точек мира и
// корректность скипа важны и легко ломаются при правках — их проверяет vitest в
// node без WebGL (tests/cinematic/storyboard.test.ts). Координаты локаций берём из
// констант мира (WorldData/Terrain), чтобы камера всегда снимала реальные здания.

import { VILLAGE, PALACE, SPAWN, ROADS } from '../world/WorldData';
import { CASTLE } from '../world/Terrain';

/** Ключ флага «интро уже показано» в localStorage. */
export const INTRO_SEEN_KEY = 'korovany_intro_seen';

/**
 * Точка тракта корованов для сцены-гэга: узел главного тракта ROADS[0] между
 * дворцом и деревней (z≈-30 — открытый прямой участок, где корован едет на виду).
 * Берём детерминированно из мира, чтобы камера висела ровно над дорогой.
 */
const _caravanNode = ROADS[0]!.find((p) => p.z === -30) ?? ROADS[0]![4]!;
export const CARAVAN_POINT = { x: _caravanNode.x, z: _caravanNode.z } as const;

/**
 * Точка наезда на дерево (мета-шутка про импосторы→3D): край леса западнее
 * деревни, заведомо вне деревни/дворца/дорог. Конкретная сосна не важна — важен
 * наезд камеры из «дальнего плана» в «вблизи», поэтому берём фиксированную опушку.
 */
export const TREE_POINT = { x: -90, z: 40 } as const;

/**
 * Точка в мире (камера/цель). y задаётся как высота НАД террейном в этой точке:
 * рендер прибавит terrain.height(x,z) при сборке абсолютной позы. Так раскадровка
 * остаётся чистой (не зависит от Terrain-меша), а камера всё равно идёт над рельефом.
 */
export interface CamPoint {
  x: number;
  /** Высота над террейном в (x,z), м. */
  y: number;
  z: number;
}

/** Поза камеры в кадре: где стоит (eye) и куда смотрит (target). */
export interface CamPose {
  eye: CamPoint;
  target: CamPoint;
}

/**
 * Одна сцена раскадровки: титр-цитата + облёт камеры от старта к концу за
 * durationSec. eye/target лерпятся по сглаженному t (easeInOutCubic) — без рывков.
 * fadeInSec — длительность затемнения-входа (шторка из чёрного), на стыке сцен
 * даёт кроссфейд. Текст показывается с лёгкой задержкой titleDelaySec и держится
 * titleHoldSec (если 0 — весь остаток сцены).
 */
export interface Scene {
  /** Машинный id сцены (для тестов/отладки). */
  id: string;
  /** Текст титра — ДОСЛОВНАЯ цитата из «ТЗ» (орфография оригинала сохранена). */
  title: string;
  durationSec: number;
  /** Затемнение-вход, с (шторка из чёрного в начале сцены). */
  fadeInSec: number;
  from: CamPose;
  to: CamPose;
  /** Задержка появления титра от начала сцены, с. */
  titleDelaySec: number;
}

/** Высота камеры облёта над целью по умолчанию, м (общие планы). */
const HIGH = 34;

/**
 * Раскадровка интро. Порядок и тексты — строго по сценарию заставки (вторую часть
 * письма про увечья НЕ используем — вне рейтинга). Координаты — из констант мира:
 * VILLAGE (0,120), PALACE (0,-380), CASTLE (445,360), дорога ROADS[0] (тракт корована).
 * Каждая сцена снимает РЕАЛЬНО построенный объект (деревня/дворец/замок/тракт).
 */
export const SCENES: Scene[] = [
  // 1. «Здраствуйте. Я, Кирилл…» — общий рассветный облёт мира над деревней.
  {
    id: 'hello',
    title: 'Здраствуйте. Я, Кирилл. Хотел бы чтобы вы сделали игру, 3Д-экшон суть такова…',
    durationSec: 7,
    fadeInSec: 1.4,
    from: { eye: { x: VILLAGE.x - 70, y: HIGH + 14, z: VILLAGE.z + 90 }, target: { x: VILLAGE.x, y: 4, z: VILLAGE.z } },
    to: { eye: { x: VILLAGE.x + 20, y: HIGH + 6, z: VILLAGE.z + 60 }, target: { x: VILLAGE.x, y: 3, z: VILLAGE.z } },
    titleDelaySec: 1.4,
  },
  // 2. «эльфы в лесу, домики деревяные» — низкий облёт деревни эльфов.
  {
    id: 'village',
    title: 'И если пользователь играет эльфами то эльфы в лесу, домики деревяные…',
    durationSec: 8,
    fadeInSec: 0.9,
    from: { eye: { x: VILLAGE.x - 34, y: 16, z: VILLAGE.z - 30 }, target: { x: VILLAGE.x, y: 2, z: VILLAGE.z } },
    to: { eye: { x: VILLAGE.x + 36, y: 12, z: VILLAGE.z + 26 }, target: { x: VILLAGE.x, y: 2, z: VILLAGE.z } },
    titleDelaySec: 0.6,
  },
  // 3. «набигают солдаты дворца и злодеи» — пролёт к дворцу-источнику набегов.
  {
    id: 'raid',
    title: '…набигают солдаты дворца и злодеи. Можно грабить корованы…',
    durationSec: 8,
    fadeInSec: 0.9,
    // Дворец — крупная модель: ближе ~130 м не влезает в кадр (по скриншотам превью
    // на 92 м шпили резались кромкой letterbox, фасад занимал весь кадр).
    from: { eye: { x: PALACE.x - 85, y: HIGH + 30, z: PALACE.z + 155 }, target: { x: PALACE.x, y: 10, z: PALACE.z } },
    to: { eye: { x: PALACE.x + 70, y: HIGH + 20, z: PALACE.z + 130 }, target: { x: PALACE.x, y: 8, z: PALACE.z } },
    titleDelaySec: 0.7,
  },
  // 4. «Можно грабить корованы…» — ЦЕНТРАЛЬНЫЙ ГЭГ: задерживаемся над трактом, где
  //    ездят корованы (ROADS[0] между дворцом и деревней). Тут берём узел тракта.
  {
    id: 'caravan',
    title: 'Можно грабить корованы…',
    durationSec: 9,
    fadeInSec: 0.9,
    from: { eye: { x: CARAVAN_POINT.x - 26, y: 18, z: CARAVAN_POINT.z + 40 }, target: { x: CARAVAN_POINT.x, y: 1.5, z: CARAVAN_POINT.z } },
    to: { eye: { x: CARAVAN_POINT.x + 18, y: 11, z: CARAVAN_POINT.z + 14 }, target: { x: CARAVAN_POINT.x, y: 1.5, z: CARAVAN_POINT.z - 8 } },
    titleDelaySec: 0.6,
  },
  // 5. «вдали деревья картинкой… преобразовываются в 3-хмерные» — мета-шутка:
  //    наезд на одно дерево у леса (импосторов в кадре нет — обыгрываем наездом).
  {
    id: 'trees',
    title: 'А движок можно поставить так что вдали деревья картинкой, когда подходиш ни преобразовываются в 3-хмерные деревья…',
    durationSec: 8,
    fadeInSec: 0.9,
    from: { eye: { x: TREE_POINT.x - 55, y: 22, z: TREE_POINT.z + 70 }, target: { x: TREE_POINT.x, y: 6, z: TREE_POINT.z } },
    to: { eye: { x: TREE_POINT.x - 8, y: 7, z: TREE_POINT.z + 16 }, target: { x: TREE_POINT.x, y: 8, z: TREE_POINT.z } },
    titleDelaySec: 0.5,
  },
  // 6. «злого (имя я не придумал)… в горах, там есть старый форт…» — облёт замка
  //    злодея на горном плато (CASTLE 445,360).
  {
    id: 'villain',
    title: 'А если за злого (имя я не придумал)… его зона в горах, там есть старый форт…',
    durationSec: 9,
    fadeInSec: 0.9,
    // Замок на плато тоже крупный (4 башни + стены): держим финал ≥110 м, чтобы
    // силуэт читался целиком на фоне гор (та же беда, что у дворца на 58 м).
    from: { eye: { x: CASTLE.cx - 100, y: HIGH + 32, z: CASTLE.cz + 120 }, target: { x: CASTLE.cx, y: 12, z: CASTLE.cz } },
    to: { eye: { x: CASTLE.cx + 30, y: HIGH + 22, z: CASTLE.cz + 110 }, target: { x: CASTLE.cx, y: 10, z: CASTLE.cz } },
    titleDelaySec: 0.6,
  },
  // 7. Финал «Я джва года хочу такую игру.» — камера опускается за спину игрока в
  //    деревне (к точке SPAWN), переход в геймплей. Финальный target — у спавна,
  //    eye позади и выше: на выходе из заставки rig подхватит обычную орбиту.
  {
    id: 'wish',
    title: 'P.S. Я джва года хочу такую игру.',
    durationSec: 7,
    fadeInSec: 1.0,
    from: { eye: { x: SPAWN.x - 18, y: 24, z: SPAWN.z + 40 }, target: { x: SPAWN.x, y: 2, z: SPAWN.z } },
    to: { eye: { x: SPAWN.x, y: 4.2, z: SPAWN.z + 6 }, target: { x: SPAWN.x, y: 1.6, z: SPAWN.z - 4 } },
    titleDelaySec: 1.0,
  },
];

/** Суммарный хронометраж заставки, с (для гейтов/тестов). */
export function totalDurationSec(scenes: Scene[] = SCENES): number {
  return scenes.reduce((sum, s) => sum + s.durationSec, 0);
}

/**
 * Кубическое сглаживание t∈[0,1] (ease-in-out): мягкий старт и торможение облёта,
 * без линейного «рывка» на стыках. Чистая функция, кламп на входе.
 */
export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: CamPoint, b: CamPoint, t: number, out: CamPoint): CamPoint {
  out.x = lerp(a.x, b.x, t);
  out.y = lerp(a.y, b.y, t);
  out.z = lerp(a.z, b.z, t);
  return out;
}

/**
 * Какая сцена идёт в момент timeSec и локальное время внутри неё. Возвращает
 * индекс сцены и local∈[0..durationSec]. За пределами заставки — последняя сцена
 * с local=duration (камера «замерла» на финальной позе до передачи управления).
 */
export function sceneAt(
  timeSec: number,
  scenes: Scene[] = SCENES,
): { index: number; local: number } {
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const d = scenes[i]!.durationSec;
    if (timeSec < acc + d) return { index: i, local: Math.max(0, timeSec - acc) };
    acc += d;
  }
  const last = scenes.length - 1;
  return { index: last, local: scenes[last]!.durationSec };
}

/** Скретч-объекты для evalCamera — без аллокаций в кадре рендера. */
const _eye: CamPoint = { x: 0, y: 0, z: 0 };
const _target: CamPoint = { x: 0, y: 0, z: 0 };
const _pose: CamPose = { eye: _eye, target: _target };

/**
 * Поза камеры в момент timeSec: находит активную сцену и лерпит from→to по
 * сглаженному прогрессу. Пишет в общий _pose (без аллокаций) — рендер сразу
 * прибавит к .y высоту террейна и применит к three-камере.
 */
export function evalCamera(timeSec: number, scenes: Scene[] = SCENES): CamPose {
  const { index, local } = sceneAt(timeSec, scenes);
  const s = scenes[index]!;
  const t = easeInOutCubic(s.durationSec > 0 ? local / s.durationSec : 1);
  lerpPoint(s.from.eye, s.to.eye, t, _eye);
  lerpPoint(s.from.target, s.to.target, t, _target);
  return _pose;
}

/**
 * Прозрачность чёрной шторки поверх сцены в момент timeSec, 0..1. В начале каждой
 * сцены — затемнение fadeInSec (кроссфейд-вход), дальше прозрачно. На самом старте
 * заставки шторка чёрная (вход из меню), в самом конце — гаснет в чёрный перед
 * передачей управления (последние END_FADE с). Чистая функция (для теста плавности).
 */
export const END_FADE_SEC = 1.2;

export function curtainOpacity(timeSec: number, scenes: Scene[] = SCENES): number {
  const total = totalDurationSec(scenes);
  // Финальное затемнение в чёрный перед геймплеем.
  if (timeSec >= total - END_FADE_SEC) {
    return Math.min(1, Math.max(0, (timeSec - (total - END_FADE_SEC)) / END_FADE_SEC));
  }
  const { index, local } = sceneAt(timeSec, scenes);
  const fade = scenes[index]!.fadeInSec;
  if (fade <= 0) return 0;
  // Вход сцены: 1 → 0 за fade секунд (чёрное в начале, проявление кадра).
  return Math.min(1, Math.max(0, 1 - local / fade));
}

/**
 * Прогресс показа титра текущей сцены, 0..1 (для fade-in текста в рендере). 0 — до
 * titleDelaySec и в самом конце сцены (титр уходит вместе с кадром), 1 — держится.
 * Простая трапеция: проявление ~0.6 с, удержание, угасание в последние ~0.6 с сцены.
 */
const TITLE_FADE_SEC = 0.7;

export function titleOpacity(timeSec: number, scenes: Scene[] = SCENES): number {
  const { index, local } = sceneAt(timeSec, scenes);
  const s = scenes[index]!;
  const start = s.titleDelaySec;
  const end = s.durationSec; // держим до конца сцены, гасим в последние секунды
  if (local < start) return 0;
  const inT = Math.min(1, (local - start) / TITLE_FADE_SEC);
  const outT = Math.min(1, Math.max(0, (end - local) / TITLE_FADE_SEC));
  return Math.min(inT, outT);
}

// --- Флаг «интро уже показано» (localStorage) ---

/**
 * Минимальный интерфейс хранилища (подмножество localStorage): тесты подменяют
 * его моком, в браузере прокидывается window.localStorage.
 */
export interface IntroStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Уже показывали заставку в этом браузере? (флаг в хранилище — показ ровно раз.) */
export function hasSeenIntro(storage: IntroStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    // Приватный режим / запрет storage: считаем «не видели» (заставка проиграет,
    // но флаг не запишется — это допустимо, лучше показать лишний раз, чем упасть).
    return false;
  }
}

/** Отметить заставку показанной (после полного проигрывания ИЛИ скипа). */
export function markIntroSeen(storage: IntroStorage | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // Запись недоступна — молча игнорируем (см. hasSeenIntro).
  }
}
