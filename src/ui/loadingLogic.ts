// Чистая логика экрана загрузки без DOM: агрегатор прогресса ассетов
// (завершено/всего → проценты). Тестируется в node (tests/ui/loadingLogic.test.ts),
// сам LoadingScreen.ts вешает результат на DOM (полоса + строка стадии).

/**
 * Доля готовности (0..1) по числу завершённых/запрошенных загрузок.
 * total<=0 — ничего ещё не запрошено: считаем 0 (полоса пуста, а не «полна»).
 * Лишние completed сверх total не переливаются за 1, отрицательные — не уходят в минус.
 */
export function loadFraction(completed: number, total: number): number {
  if (total <= 0) return 0;
  const frac = completed / total;
  return Math.min(1, Math.max(0, frac));
}

/**
 * Процент готовности (0..100, целое) с защитой от «отката назад».
 * prevPercent — ранее показанный процент: новый результат не опускается ниже него,
 * даже если total вырос быстрее completed (ассеты докидываются в очередь по ходу
 * построения мира — без этого полоса дёргалась бы назад). На финише (completed>=total>0)
 * всегда 100.
 */
export function progressPercent(completed: number, total: number, prevPercent = 0): number {
  const raw = total > 0 && completed >= total ? 100 : Math.round(loadFraction(completed, total) * 100);
  return Math.max(prevPercent, raw);
}
