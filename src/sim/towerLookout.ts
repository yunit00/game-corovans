// Чистая логика сводки сторожевой башни (Фаза 6B волна B+). Поднявшись на верхнюю
// площадку tower_ruin, игрок жмёт [E] «Осмотреться» — башня выдаёт тикер о
// ближайшем короване (тир/направление/ETA из CaravanDirector) и о том, идёт ли
// набег. Только числа/строки — без Three/Rapier/DOM. Тестируется в node.

import type { CaravanTier } from './caravan';
import { formatEta, tierName } from './tavern';

/** Вход для сводки башни: что знает мир о корованах и набеге. */
export interface LookoutInput {
  /**
   * Активный корован на тракте (если едет сейчас): тир и позиция телеги — для
   * направления. null — никто не едет.
   */
  active: { tier: CaravanTier; x: number; z: number } | null;
  /**
   * Следующий плановый корован (если расписание ждёт): тир и сек до выезда. null —
   * корован уже в пути либо расписание выключено.
   */
  next: { tier: CaravanTier; secondsLeft: number } | null;
  /** Идёт ли сейчас набег на деревню. */
  raidActive: boolean;
  /** Позиция башни (для расчёта направления на активный корован). */
  tower: { x: number; z: number };
}

/** Сторона света по вектору (dx,dz) в плоскости XZ. -z — север, +x — восток. */
export function compassDir(dx: number, dz: number): string {
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return 'рядом';
  const ang = Math.atan2(dx, -dz); // 0 — север (-z), по часовой
  const deg = ((ang * 180) / Math.PI + 360) % 360;
  const names = ['к северу', 'к северо-востоку', 'к востоку', 'к юго-востоку', 'к югу', 'к юго-западу', 'к западу', 'к северо-западу'];
  const idx = Math.round(deg / 45) % 8;
  return names[idx]!;
}

/**
 * Тикер-сводка башни: ближайший корован (направление, если едет; ETA, если ждёт) +
 * флаг набега. Приоритет — активный корован (его видно с башни), затем плановый.
 * Набег упоминается отдельной фразой, если идёт. Всегда возвращает осмысленную
 * строку (даже когда новостей нет).
 */
export function lookoutSummary(input: LookoutInput): string {
  const parts: string[] = [];

  if (input.active) {
    const dir = compassDir(input.active.x - input.tower.x, input.active.z - input.tower.z);
    parts.push(`На тракте ${tierName(input.active.tier)} обоз — ${dir}.`);
  } else if (input.next) {
    parts.push(`Следующий обоз — ${tierName(input.next.tier)}, выйдет ${formatEta(input.next.secondsLeft)}.`);
  } else {
    parts.push('На тракте пока тихо — обозов не видно.');
  }

  if (input.raidActive) {
    parts.push('Тревога: на деревню идёт набег!');
  }

  return parts.join(' ');
}
