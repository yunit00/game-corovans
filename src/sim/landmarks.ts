// Размещение рукотворных мини-POI в пустотах карты. Чистая sim-логика: только
// числа и plain-объекты, никаких Three/Rapier — тестируется в node. Идея: набор
// якорей-«кандидатов» в пустых зонах между деревней/дворцом/фортом и краями;
// детерминированно от seed выбираем непересекающиеся точки на свободных местах
// (вне дорог/деревни/дворца/форта/прудов — проверка приходит колбэком).
import { mulberry32 } from '../core/rng';

/** Тип POI — что собирать в Landmarks.build. */
export type PoiKind =
  | 'tower_ruin' // руины каменной башни/стены
  | 'broken_cart' // заброшенная сломанная телега
  | 'shrine' // придорожный обелиск/святилище
  | 'hunter_camp' // охотничий лагерь (костровище + палатка)
  | 'pier'; // пирс/мостки у пруда

export interface PoiSpec {
  kind: PoiKind;
  x: number;
  z: number;
  /** Поворот вокруг Y, рад. */
  rot: number;
  /** Радиус «занятости», м — другие POI не ставятся ближе суммы радиусов. */
  radius: number;
}

/** Минимальный зазор между двумя POI сверх их радиусов, м. */
export const POI_GAP = 8;
/** Минимальная дистанция POI от дороги, м (придорожные святилища — исключение). */
export const POI_ROAD_MARGIN = 14;

/**
 * Радиус расчистки (м) под каждый тип POI — внутри него лес/кусты/детали не сажаем,
 * чтобы деревья не втыкались в постройку и в подъём. У башни спираль идёт по радиусу
 * towerR+1 (~2.7 м) с длиной ступени до ~3 м, плюс площадка platR≈4.8 и обломки у
 * подножия на towerR+2.5; берём 14 м с запасом, чтобы лестница и осыпь были чистыми.
 * Прочим POI хватает их «footprint + проход вокруг».
 */
export const POI_CLEAR_RADIUS: Record<PoiKind, number> = {
  tower_ruin: 14,
  broken_cart: 6,
  shrine: 5,
  hunter_camp: 7,
  pier: 6,
};
/** Радиус джиттера якоря, м — точка «гуляет» вокруг базовой между разными seed. */
const ANCHOR_JITTER = 14;
/** Попыток найти свободную точку у одного якоря. */
const PLACE_TRIES = 8;

/**
 * Якоря-кандидаты POI: базовые координаты в заведомо пустых зонах карты
 * (между деревней z≈120, дворцом z≈−380, фортом x/z≈150..350 и краями ±435).
 * Святилища допускают близость к дороге (придорожные), остальным дорога мешает.
 * Якорей больше, чем нужно POI, — берём первые successful, разнообразие kind'ов
 * обеспечено порядком. Пирс ставится отдельно (нужен реальный центр пруда).
 */
const ANCHORS: { kind: PoiKind; x: number; z: number; radius: number; nearRoad: boolean }[] = [
  // Руины башни — северо-запад, в пустоши между дворцом и западным краем
  { kind: 'tower_ruin', x: -260, z: -250, radius: 9, nearRoad: false },
  // Сломанная телега — у западного тракта (ROADS[2], z≈85), как «застрявший корован»
  { kind: 'broken_cart', x: -150, z: 110, radius: 5, nearRoad: true },
  // Придорожное святилище — у восточного тракта (ROADS[1], z≈−40)
  { kind: 'shrine', x: 230, z: -8, radius: 4, nearRoad: true },
  // Охотничий лагерь — юго-восток, далеко от форта и деревни
  { kind: 'hunter_camp', x: 300, z: 250, radius: 8, nearRoad: false },
  // Запасной якорь руин — северо-восток (если первый не сядет)
  { kind: 'tower_ruin', x: 270, z: -270, radius: 9, nearRoad: false },
  // Запасной охотничий лагерь — юго-запад
  { kind: 'hunter_camp', x: -300, z: 240, radius: 8, nearRoad: false },
  // Запасное святилище — у главного тракта на юге (ROADS[0], z≈320)
  { kind: 'shrine', x: 40, z: 360, radius: 4, nearRoad: true },
];

/** Не налезает ли точка на уже выбранные POI (с учётом радиусов и POI_GAP). */
function fitsAmong(x: number, z: number, radius: number, placed: PoiSpec[]): boolean {
  for (const p of placed) {
    if (Math.hypot(x - p.x, z - p.z) < p.radius + radius + POI_GAP) return false;
  }
  return true;
}

/**
 * Детерминированно разложить наземные POI (без пирса). isClear(x,z,margin) —
 * свободно ли место (вне деревни/дворца/дорог/форта/прудов/стены); roadDist(x,z)
 * — дистанция до ближайшей дороги (для нарушающего margin от дороги). Возвращает
 * до `count` непересекающихся POI разных типов; пирс добавляет вызывающий.
 */
export function planLandmarks(
  seed: number,
  count: number,
  isClear: (x: number, z: number, margin: number) => boolean,
  roadDist: (x: number, z: number) => number,
): PoiSpec[] {
  const rng = mulberry32((seed ^ 0x1a2d3f) >>> 0);
  const placed: PoiSpec[] = [];
  for (const anchor of ANCHORS) {
    if (placed.length >= count) break;
    for (let t = 0; t < PLACE_TRIES; t++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * ANCHOR_JITTER;
      const x = anchor.x + Math.cos(a) * r;
      const z = anchor.z + Math.sin(a) * r;
      const rot = rng() * Math.PI * 2;
      // Площадка под POI крупнее камня — margin = radius. Дорога мешает всем,
      // кроме придорожных (святилище/телега): тем дорога даже желательна рядом.
      if (!isClear(x, z, anchor.radius)) continue;
      if (!anchor.nearRoad && roadDist(x, z) < POI_ROAD_MARGIN) continue;
      if (!fitsAmong(x, z, anchor.radius, placed)) continue;
      placed.push({ kind: anchor.kind, x, z, rot, radius: anchor.radius });
      break;
    }
  }
  return placed;
}

/** Круг расчистки под лендмарк: внутри него лес и детали не сажаются. */
export interface LandmarkClearing {
  x: number;
  z: number;
  r: number;
}

/**
 * Зоны расчистки наземных POI для того же seed/count, что и planLandmarks. Лес
 * строится ДО лендмарков и не знает их позиций — поэтому он спрашивает этот список
 * и не сажает деревья/кусты внутри кругов (радиус по типу из POI_CLEAR_RADIUS).
 * Детерминирован сидом ровно как planLandmarks (тот же rng), так что круги точно
 * совпадают с реальными постройками. Пирс зависит от пруда и расчищается отдельно
 * (в воде леса и так нет); сюда не входит.
 */
export function landmarkClearings(
  seed: number,
  count: number,
  isClear: (x: number, z: number, margin: number) => boolean,
  roadDist: (x: number, z: number) => number,
): LandmarkClearing[] {
  return planLandmarks(seed, count, isClear, roadDist).map((p) => ({
    x: p.x,
    z: p.z,
    r: POI_CLEAR_RADIUS[p.kind],
  }));
}
