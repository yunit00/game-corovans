// Чистая логика слухов трактирщика (Фаза 6B). Трактирщик за эль «сливает» точный
// слух о следующем короване: тир и время до выезда. Только числа/строки — без
// Three/Rapier/DOM. Расписание/тиры берёт CaravanDirector; здесь — цена, формат
// слуха и реплики. Тестируется в node.

import type { CaravanTier } from './caravan';

/** Цена угощения трактирщика элем, монет. */
export const ALE_COST = 10;

/** Краткое описание следующего корована для слуха (из CaravanDirector). */
export interface NextCaravanInfo {
  tier: CaravanTier;
  /** Сколько секунд до выезда (≥0). */
  secondsLeft: number;
}

/** Русское название тира для реплик. */
export function tierName(tier: CaravanTier): string {
  switch (tier) {
    case 'royal':
      return 'королевский';
    case 'merchant':
      return 'купеческий';
    default:
      return 'бедняцкий';
  }
}

/** «через 1 мин 20 с» / «вот-вот» — человекочитаемое время до выезда. */
export function formatEta(secondsLeft: number): string {
  const s = Math.max(0, Math.round(secondsLeft));
  if (s < 10) return 'вот-вот';
  if (s < 60) return `через ${s} с`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `через ${m} мин` : `через ${m} мин ${rem} с`;
}

/**
 * Реплика трактирщика со слухом о следующем короване. Игрок ПЛАТИТ ALE_COST и
 * СТАВИТ трактирщику кружку эля — тот в благодарность делится слухом. Поэтому
 * реплика всегда начинается с «Ты ставишь трактирщику кружку эля…», чтобы механика
 * угощения читалась однозначно. Королевский обоз получает отдельную «сочную»
 * подачу — он самый жирный куш. info=null (расписание молчит, корован уже в пути) —
 * трактирщик берёт кружку, но честно говорит, что новостей пока нет.
 */
export function rumorLine(info: NextCaravanInfo | null): string {
  const toast = 'Ты ставишь трактирщику кружку эля.';
  if (!info) {
    return `${toast} Он отхлёбывает и разводит руками: «Покуда тихо на тракте, ни одного обоза не сладили. Загляни попозже».`;
  }
  const eta = formatEta(info.secondsLeft);
  if (info.tier === 'royal') {
    return `${toast} Он подмигивает и шепчет: «По секрету — из дворца ${eta} выкатят КОРОЛЕВСКИЙ обоз, золота полны сундуки да охрана злая. Удачи, лиходей!»`;
  }
  return `${toast} Он подмигивает: «Следующий корован — ${tierName(info.tier)}, выйдет ${eta}. Готовь засаду».`;
}

/** Короткая строка слуха в тикер (без «сочности» — суть в одну строку). */
export function rumorTicker(info: NextCaravanInfo | null): string {
  if (!info) return 'Трактирщик: новостей о корованах пока нет';
  return `Слух: следующий корован — ${tierName(info.tier)}, ${formatEta(info.secondsLeft)}`;
}
