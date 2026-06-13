// Чистая математика стрелки-указателя на деревню для HUD набега. Без three/DOM —
// юнит-тестируется. Возвращает угол поворота экранной стрелки ▲ (CSS rotate),
// где 0 — «прямо вверх» (цель ровно по курсу камеры), а положительный угол —
// по часовой стрелке (цель справа).

/** Тип результата проверки «показывать ли стрелку и куда». */
export interface RaidArrowHint {
  /** Дальше ли игрок порога от деревни (стрелку показываем только тогда). */
  show: boolean;
  /** Угол поворота экранной стрелки ▲, рад. 0 — вверх, по часовой — вправо. */
  angleRad: number;
  /** Дистанция до деревни, м (для «N м» при желании). */
  distance: number;
}

/**
 * Экранный угол стрелки на цель относительно направления камеры.
 *
 * Конвенция yaw — как в movement.ts: при yaw=0 камера смотрит в −Z, и «вперёд»
 * на экране = мировое направление (−sin(yaw), −cos(yaw)). Угол отсчитываем по
 * часовой стрелке от «вверх» (цель по курсу → 0), вправо — положительный.
 *
 * Чистая функция, без аллокаций: только числа.
 *
 * @param px,pz   позиция игрока (мир)
 * @param tx,tz   позиция цели (центр деревни)
 * @param cameraYaw  yaw камеры (CameraRig.yaw)
 */
export function bearingToScreenAngle(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  cameraYaw: number,
): number {
  const dx = tx - px;
  const dz = tz - pz;
  // Мировой азимут на цель в той же конвенции, что yaw: atan2(x, z) → 0 при +Z.
  const targetYaw = Math.atan2(dx, dz);
  // Камера «смотрит вперёд» по направлению (−sin yaw, −cos yaw); его азимат в
  // конвенции atan2(x, z) равен cameraYaw + π. Экранный угол = насколько цель
  // отклонена от курса камеры по часовой стрелке.
  const rel = targetYaw - (cameraYaw + Math.PI);
  // Нормализуем в (−π, π], чтобы стрелка крутилась кратчайшим путём.
  return normalizeAngle(rel);
}

/** Нормализация угла в полуинтервал (−π, π]. */
export function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Показывать ли стрелку и куда: игрок дальше distThreshold от деревни → стрелка
 * на деревню относительно курса камеры. Иначе show=false (рядом — стрелка не нужна).
 */
export function raidArrowHint(
  px: number,
  pz: number,
  villageX: number,
  villageZ: number,
  cameraYaw: number,
  distThreshold: number,
): RaidArrowHint {
  const distance = Math.hypot(villageX - px, villageZ - pz);
  return {
    show: distance > distThreshold,
    angleRad: bearingToScreenAngle(px, pz, villageX, villageZ, cameraYaw),
    distance,
  };
}
