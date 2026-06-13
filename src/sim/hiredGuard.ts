// Чистая логика найма стражников деревни (Фаза 6B). Только числа/plain-объекты,
// без Three/Rapier — стоимость, лимит, проверки и сериализация для сейва. Спавн
// меша/тела и патруль — в src/world/HiredGuard.ts; интеграция — в Game. Тестируется
// в node.

/** Цена найма одного стражника, монет. */
export const HIRE_COST = 120;
/** Максимум одновременно нанятых стражников. */
export const MAX_HIRED_GUARDS = 2;

/**
 * Снимок одного нанятого стражника для сейва: индекс точки патруля (детерминирует
 * его место в кольце вокруг деревни) и текущее HP. Жив, пока запись есть в массиве —
 * павшего стражника Game убирает из списка ДО сохранения.
 */
export interface HiredGuardSave {
  /** Индекс патрульного слота в кольце деревни (0..MAX-1). */
  slot: number;
  /** Текущее HP стражника. */
  hp: number;
}

/** Хватает ли монет и места под ещё одного стражника. */
export function canHireGuard(coins: number, current: number): boolean {
  return coins >= HIRE_COST && current < MAX_HIRED_GUARDS;
}

/**
 * Свободный слот патруля под нового стражника: первый индекс 0..MAX-1, не занятый
 * текущими стражниками. Возвращает -1, если все слоты заняты (лимит достигнут).
 * usedSlots — список занятых индексов (Game собирает из живых стражников).
 */
export function nextGuardSlot(usedSlots: readonly number[]): number {
  for (let i = 0; i < MAX_HIRED_GUARDS; i++) {
    if (!usedSlots.includes(i)) return i;
  }
  return -1;
}

/** Проверка формы записи стражника из сейва (без классов). */
export function isValidHiredGuard(v: unknown): v is HiredGuardSave {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const g = v as Record<string, unknown>;
  if (typeof g.slot !== 'number' || !Number.isFinite(g.slot)) return false;
  if (g.slot < 0 || g.slot >= MAX_HIRED_GUARDS) return false;
  if (typeof g.hp !== 'number' || !Number.isFinite(g.hp) || g.hp <= 0) return false;
  return true;
}

/**
 * Восстановить список стражников из кандидата сейва: отбросить битые записи и
 * дубли слотов, обрезать до MAX. Возвращает валидный массив (возможно пустой).
 */
export function coerceHiredGuards(v: unknown): HiredGuardSave[] {
  if (!Array.isArray(v)) return [];
  const out: HiredGuardSave[] = [];
  const usedSlots = new Set<number>();
  for (const item of v) {
    if (!isValidHiredGuard(item)) continue;
    if (usedSlots.has(item.slot)) continue; // один слот — один стражник
    usedSlots.add(item.slot);
    out.push({ slot: item.slot, hp: item.hp });
    if (out.length >= MAX_HIRED_GUARDS) break;
  }
  return out;
}
