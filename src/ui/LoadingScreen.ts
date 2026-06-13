// Экран загрузки: HTML-оверлей в стиле меню
// (пергамент/золото, шрифты Forum/Philosopher из index.html). Реальный кейс:
// игрок открывает ссылку, нажимает «Играть» и уходит — мир (~46 МБ ассетов +
// построение) грузился без индикации, фон до готовности чёрный, фатальные ошибки
// уходили только в console. Этот оверлей: полоса прогресса + строка стадии, а при
// провале — крупный читаемый блок с техдеталями, советами и кнопкой «Скопировать
// отчёт». Лёгкий, без canvas; чистый DOM поверх #ui (под/над меню).
//
// Чистая логика прогресса (проценты, защита от отката) — в ui/loadingLogic.ts
// (тестируется в node без DOM). Здесь — только разметка и обновление DOM.

import { progressPercent } from './loadingLogic';

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Тонкая полоса прогресса внизу — видна СРАЗУ при открытии страницы, под/над
       главным меню (z над виньеткой меню, но прогресс заметен мгновенно). */
    .load-overlay {
      position: absolute; left: 0; right: 0; bottom: 0;
      display: none; flex-direction: column; align-items: center;
      padding: 0 0 22px; pointer-events: none;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f0e6cf; z-index: 50;
      opacity: 1; transition: opacity 0.5s ease-out;
    }
    .load-overlay.load-on { display: flex; }
    .load-overlay.load-fading { opacity: 0; }

    /* Строка стадии над полосой: «Грузим модели… 34/120», «Строим мир…». */
    .load-stage {
      font-size: 15px; letter-spacing: 0.05em; color: #e8d9b0;
      margin-bottom: 10px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
      min-height: 1.2em;
    }
    /* Жёлоб полосы — узкий, золотая кайма как у кнопок меню. */
    .load-track {
      position: relative; width: min(78vw, 460px); height: 10px;
      background: linear-gradient(180deg, rgba(20, 14, 8, 0.85), rgba(8, 6, 3, 0.9));
      border: 1px solid rgba(196, 152, 70, 0.55);
      border-radius: 6px; overflow: hidden;
      box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.7);
    }
    /* Заполнение — золотой градиент с лёгким свечением, анимируется по ширине. */
    .load-fill {
      position: absolute; inset: 0; width: 0%;
      background: linear-gradient(90deg, #b9821f 0%, #f4c75a 60%, #ffe9a8 100%);
      box-shadow: 0 0 10px rgba(255, 200, 80, 0.45);
      transition: width 0.25s ease-out;
    }

    /* Блок ошибки — полноэкранный, перекрывает всё: «молчания» больше нет. */
    .load-error {
      position: absolute; inset: 0; display: none;
      align-items: center; justify-content: center;
      padding: 24px; box-sizing: border-box;
      background:
        radial-gradient(ellipse 120% 90% at 50% 40%, rgba(8, 10, 14, 0.85) 40%, rgba(3, 4, 7, 0.97) 100%);
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f0e6cf; pointer-events: auto; z-index: 60;
      overflow: auto;
    }
    .load-error.load-error-on { display: flex; }
    .load-error-panel {
      width: min(94vw, 620px); max-height: 90vh; overflow: auto;
      padding: 28px 30px 24px;
      background: linear-gradient(180deg, rgba(28, 20, 12, 0.95), rgba(14, 10, 6, 0.97));
      border: 1px solid rgba(196, 152, 70, 0.55); border-radius: 12px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.7), inset 0 0 60px rgba(0, 0, 0, 0.55);
    }
    .load-error-title {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: clamp(26px, 6vw, 38px); font-weight: 400; line-height: 1.1;
      margin: 0 0 6px; letter-spacing: 0.03em;
      background: linear-gradient(180deg, #ffe9a8 0%, #f4c75a 45%, #b9821f 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #f4c75a;
    }
    .load-error-sub { font-size: 15px; color: #c8b58a; margin: 0 0 16px; font-style: italic; }
    .load-error-tips {
      margin: 0 0 16px; padding-left: 20px;
      font-size: 14px; line-height: 1.6; color: #d8cba6;
    }
    .load-error-tips li { margin: 2px 0; }
    /* Техдетали — моноширинный, в рамке, прокручиваемый: для отчёта/баг-репорта. */
    .load-error-details {
      max-height: 220px; overflow: auto;
      margin: 0 0 16px; padding: 12px 14px;
      background: rgba(8, 6, 3, 0.7); border: 1px solid rgba(196, 152, 70, 0.28);
      border-radius: 6px;
      font: 12px/1.5 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      color: #e0b89a; white-space: pre-wrap; word-break: break-word;
    }
    .load-error-actions { display: flex; gap: 12px; flex-wrap: wrap; }
    /* Кнопка «Скопировать отчёт» — гербовая, как в меню. */
    .load-error-btn {
      pointer-events: auto; cursor: pointer;
      background: linear-gradient(180deg, rgba(74, 56, 30, 0.6), rgba(40, 28, 14, 0.65));
      border: 1px solid rgba(196, 152, 70, 0.6); border-radius: 4px;
      padding: 11px 18px; color: #f4d98a;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      font-size: 16px; font-weight: 700; letter-spacing: 0.06em;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
      transition: background 0.18s, color 0.18s, box-shadow 0.18s;
    }
    .load-error-btn:hover {
      background: linear-gradient(180deg, rgba(110, 84, 42, 0.75), rgba(64, 46, 22, 0.75));
      color: #fff0c4; box-shadow: 0 0 16px rgba(255, 200, 80, 0.35);
    }
  `;
  root.appendChild(style);
}

export class LoadingScreen {
  private overlay: HTMLElement;
  private stageEl: HTMLElement;
  private fillEl: HTMLElement;
  private errorEl: HTMLElement;
  private detailsEl!: HTMLElement;
  /** Текст текущей стадии — без счётчика, чтобы прогресс мог дописывать «34/120». */
  private stageText = 'Готовим мир…';
  /** Последний показанный процент — для защиты полосы от отката назад. */
  private percent = 0;
  /** Готовый текст отчёта об ошибке (для «Скопировать отчёт»). null — ошибки нет. */
  private report: string | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    injectStyles(root);

    const overlay = document.createElement('div');
    overlay.className = 'load-overlay';

    const stage = document.createElement('div');
    stage.className = 'load-stage';
    stage.textContent = this.stageText;

    const track = document.createElement('div');
    track.className = 'load-track';
    const fill = document.createElement('div');
    fill.className = 'load-fill';
    track.appendChild(fill);

    overlay.append(stage, track);
    root.appendChild(overlay);

    this.errorEl = this.buildError(root);

    this.overlay = overlay;
    this.stageEl = stage;
    this.fillEl = fill;
  }

  private buildError(root: HTMLElement): HTMLElement {
    const box = document.createElement('div');
    box.className = 'load-error';

    const panel = document.createElement('div');
    panel.className = 'load-error-panel';

    const title = document.createElement('h1');
    title.className = 'load-error-title';
    title.textContent = 'Не получилось запустить игру';

    const sub = document.createElement('p');
    sub.className = 'load-error-sub';
    sub.textContent = 'Что-то пошло не так при загрузке мира.';

    const tips = document.createElement('ul');
    tips.className = 'load-error-tips';
    for (const t of [
      'Обновите страницу (F5) — часто помогает.',
      'Обновите браузер до свежей версии.',
      'Нужна поддержка WebGL2 (Chrome/Firefox/Edge/Safari последних версий).',
      'Попробуйте другой браузер или отключите блокировщики.',
    ]) {
      const li = document.createElement('li');
      li.textContent = t;
      tips.appendChild(li);
    }

    const details = document.createElement('pre');
    details.className = 'load-error-details';
    this.detailsEl = details;

    const actions = document.createElement('div');
    actions.className = 'load-error-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'load-error-btn';
    copyBtn.textContent = 'Скопировать отчёт';
    copyBtn.addEventListener('click', () => this.copyReport(copyBtn));
    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'load-error-btn';
    reloadBtn.textContent = 'Перезагрузить';
    reloadBtn.addEventListener('click', () => location.reload());
    actions.append(copyBtn, reloadBtn);

    panel.append(title, sub, tips, details, actions);
    box.appendChild(panel);
    root.appendChild(box);
    return box;
  }

  show(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.overlay.classList.add('load-on');
    this.overlay.classList.remove('load-fading');
  }

  /** Скрыть полосу с лёгким fade (мир готов). Блок ошибки этим НЕ трогается. */
  hide(): void {
    if (!this.overlay.classList.contains('load-on')) return;
    this.overlay.classList.add('load-fading');
    this.fadeTimer = setTimeout(() => {
      this.overlay.classList.remove('load-on', 'load-fading');
      this.fadeTimer = null;
    }, 500);
  }

  /** Сменить стадию («Строим мир…», «Оживляем обитателей…»). */
  setStage(text: string): void {
    this.stageText = text;
    this.renderStage();
  }

  /**
   * Обновить прогресс по числам done/total. На стадии загрузки моделей дописывает
   * счётчик к строке стадии («Грузим модели… 34/120»). Полоса не откатывается назад
   * (progressPercent держит максимум) — total докидывается по ходу построения мира.
   */
  setProgress(done: number, total: number): void {
    this.percent = progressPercent(done, total, this.percent);
    this.fillEl.style.width = `${this.percent}%`;
    this.renderStage(done, total);
  }

  private renderStage(done?: number, total?: number): void {
    // Счётчик показываем только пока есть что грузить и не всё догружено — иначе
    // «120/120» висело бы поверх стадий построения мира.
    const showCount = done !== undefined && total !== undefined && total > 0 && done < total;
    this.stageEl.textContent = showCount ? `${this.stageText} ${done}/${total}` : this.stageText;
  }

  /**
   * Показать фатальную ошибку: крупный блок «Не получилось запустить игру» +
   * техдетали (message + первые строки stack) + советы + кнопка «Скопировать
   * отчёт». Полосу прогресса прячем — на пути к игре она уже не нужна.
   */
  showError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : '';
    // Первые ~8 строк стека — достаточно для диагностики, без простыни.
    const stackHead = stack.split('\n').slice(0, 8).join('\n');
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)';
    this.report = [
      'КОРОВАНЫ — отчёт об ошибке запуска',
      `Сообщение: ${message}`,
      '',
      stackHead || '(стек недоступен)',
      '',
      `User-Agent: ${ua}`,
      `URL: ${typeof location !== 'undefined' ? location.href : '(no location)'}`,
    ].join('\n');

    this.detailsEl.textContent = `${message}\n\n${stackHead}`;
    // Полосу убираем мгновенно (без fade) — её перекроет блок ошибки.
    this.overlay.classList.remove('load-on', 'load-fading');
    this.errorEl.classList.add('load-error-on');
  }

  private async copyReport(btn: HTMLButtonElement): Promise<void> {
    if (!this.report) return;
    try {
      await navigator.clipboard.writeText(this.report);
      const prev = btn.textContent;
      btn.textContent = 'Скопировано ✓';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1800);
    } catch {
      // Clipboard может быть запрещён (не https / нет жеста) — фоллбэк: выделить
      // текст деталей, чтобы пользователь скопировал вручную (Ctrl+C).
      const sel = window.getSelection?.();
      const range = document.createRange();
      range.selectNodeContents(this.detailsEl);
      sel?.removeAllRanges();
      sel?.addRange(range);
      btn.textContent = 'Выделено — Ctrl+C';
    }
  }
}
