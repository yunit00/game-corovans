// Чистая логика выбора локаций на концах дорог (Фаза 6B волна B+). Дороги ROADS
// упираются в горное кольцо (cheb ~470 при играбельной границе ~425), поэтому
// «конец» дороги физически за стеной. Здесь из полилиний выбираем КРАЙНИЕ точки
// у кольца и отступаем вдоль дороги внутрь играбельной зоны — туда ставим здание.
// Только числа/plain-объекты, без Three/Rapier/DOM — тестируется в node.

import type { P2 } from './geom';

/** Тип локации на конце дороги (порядок зданий/NPC привязан к нему). */
export type RoadEndKind =
  | 'inn' // постоялый двор у тракта (интерьер, трактирщик внутри, мини-лавка)
  | 'forester' // лесничество (хижина лесника)
  | 'mill' // мельница/ферма (мельник с квестами)
  | 'sentry'; // сторожевая застава (дозорный с kill-квестами и подсказками о форте)

/** Выбранная локация: тип, позиция здания, поворот «лицом вдоль дороги к центру». */
export interface RoadEnd {
  kind: RoadEndKind;
  /** Позиция здания (точка на дороге, отступя от стены внутрь зоны). */
  x: number;
  z: number;
  /** Yaw «лицом к центру карты вдоль дороги» (для разворота фасада ко входу). */
  faceYaw: number;
  /** Индекс дороги в ROADS, чей конец это (для отладки/тестов). */
  road: number;
}

/**
 * Полупротяжённость играбельной зоны по chebyshev, м: дальше — горная стена
 * (isClear отбрасывает cheb > 435). Локацию отодвигаем внутрь от неё.
 */
export const PLAYABLE_HALF = 435;
/** На сколько отступить от стены вглубь зоны, м (чтобы здание встало на ровном). */
export const WALL_SETBACK = 28;

/**
 * Конец дороги «у кольца» — это её КРАЙНЯЯ точка, если она у стены (cheb близко к
 * краю). Возвращает индекс граничной вершины полилинии (0 или last) и саму точку,
 * либо null, если ни один конец не упирается в стену (внутренняя дорога).
 */
function wallEndOf(road: readonly P2[]): { idx: number; pt: P2 } | null {
  if (road.length < 2) return null;
  const first = road[0]!;
  const last = road[road.length - 1]!;
  const chebFirst = Math.max(Math.abs(first.x), Math.abs(first.z));
  const chebLast = Math.max(Math.abs(last.x), Math.abs(last.z));
  // Конец «у стены» — чей cheb ближе всего к краю и реально велик (> PLAYABLE_HALF).
  const firstAtWall = chebFirst > PLAYABLE_HALF;
  const lastAtWall = chebLast > PLAYABLE_HALF;
  if (!firstAtWall && !lastAtWall) return null;
  if (lastAtWall && (!firstAtWall || chebLast >= chebFirst)) {
    return { idx: road.length - 1, pt: last };
  }
  return { idx: 0, pt: first };
}

/**
 * Отступить от граничной точки конца дороги ВДОЛЬ дороги внутрь зоны так, чтобы
 * cheb позиции стал ≤ PLAYABLE_HALF − WALL_SETBACK. Идём по сегментам от края к
 * центру, пока не выйдем за стену с запасом. Возвращает точку и направление
 * «внутрь» (от стены к следующей вершине — это «к центру вдоль дороги»).
 */
function setbackAlong(road: readonly P2[], wallIdx: number): { x: number; z: number; inX: number; inZ: number } {
  const target = PLAYABLE_HALF - WALL_SETBACK;
  // Соседняя вершина в сторону центра.
  const innerIdx = wallIdx === 0 ? 1 : road.length - 2;
  const end = road[wallIdx]!;
  const inner = road[innerIdx]!;
  let dirX = inner.x - end.x;
  let dirZ = inner.z - end.z;
  const segLen = Math.hypot(dirX, dirZ) || 1;
  dirX /= segLen;
  dirZ /= segLen;

  // Сколько пройти вдоль (dirX,dirZ), чтобы координата оси, что вылезла за стену,
  // вернулась к ±target. Ось в пределах target шага не требует (need=0).
  const need = (coord: number, d: number): number => {
    if (Math.abs(coord) <= target) return 0; // ось уже внутри — двигаться не нужно
    if (Math.abs(d) < 1e-6) return Infinity; // вдоль этой оси не двигаемся, но ось снаружи — фоллбэк
    // coord + d*t = ±target (тот знак, что у coord)
    const want = coord > 0 ? target : -target;
    const t = (want - coord) / d;
    return t > 0 ? t : Infinity;
  };
  // Нужно удовлетворить ОБЕ оси: берём максимум требуемых шагов (та, что снаружи,
  // диктует шаг; ось внутри даёт 0 и не мешает).
  const tx = need(end.x, dirX);
  const tz = need(end.z, dirZ);
  let t = Math.max(Number.isFinite(tx) ? tx : 0, Number.isFinite(tz) ? tz : 0);
  if (t <= 0) t = segLen; // обе оси уже внутри (странный вход) — дойти до вершины
  // Не перелетать соседнюю вершину (иначе позиция уйдёт мимо дороги).
  t = Math.min(t, segLen);
  return {
    x: end.x + dirX * t,
    z: end.z + dirZ * t,
    inX: dirX,
    inZ: dirZ,
  };
}

/**
 * Выбрать локации на концах дорог. ROADS — все полилинии; assign — какой тип
 * локации какому концу дороги назначить (по индексу дороги в ROADS). Возвращает по
 * одной RoadEnd на каждый «упирающийся в стену» конец, в порядке assign. Дороги без
 * стенового конца пропускаются. Позиция отодвинута от стены на WALL_SETBACK вглубь.
 */
export function planRoadEnds(
  roads: readonly (readonly P2[])[],
  assign: readonly { road: number; kind: RoadEndKind }[],
): RoadEnd[] {
  const out: RoadEnd[] = [];
  for (const a of assign) {
    const road = roads[a.road];
    if (!road) continue;
    const wall = wallEndOf(road);
    if (!wall) continue;
    const sb = setbackAlong(road, wall.idx);
    // Лицом «внутрь зоны вдоль дороги»: yaw из вектора входа (как faceCenter).
    const faceYaw = Math.atan2(sb.inX, sb.inZ);
    out.push({
      kind: a.kind,
      x: +sb.x.toFixed(2),
      z: +sb.z.toFixed(2),
      faceYaw: +faceYaw.toFixed(4),
      road: a.road,
    });
  }
  return out;
}
