// Экран паузы: полупрозрачный
// оверлей поверх замершего мира, в стиле главного меню (пергамент/золото/Forum),
// НО без облёта камеры — пауза остаётся со своей камерой. Заголовок «ПАУЗА»,
// баннер «Прогресс сохранён», кнопки «Продолжить» и «В главное меню». Чистый DOM
// поверх #ui, как MainMenu/Hud.
// НИКАКОГО обращения к Game — только колбэки onResume/onMainMenu. Решение «стоит
// ли симуляция / приглушён ли звук / сделан ли сейв» принимает Game, экран лишь
// показывается и дёргает колбэки.

export interface PauseScreenCallbacks {
  /** «Продолжить» — снять паузу (Game вернёт pointer lock, размьютит звук). */
  onResume(): void;
  /** «В главное меню» — показать главное меню поверх (игра остаётся на паузе). */
  onMainMenu(): void;
}

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .pause-overlay {
      position: absolute; inset: 0;
      display: none; align-items: center; justify-content: center;
      /* Затемнение поверх мира + виньетка по краям (мир под ним остаётся виден). */
      background:
        radial-gradient(ellipse 120% 90% at 50% 45%, rgba(7, 9, 13, 0.35) 35%, rgba(5, 6, 10, 0.66) 80%, rgba(2, 3, 6, 0.85) 100%);
      backdrop-filter: blur(2px);
      pointer-events: auto;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f0e6cf;
      z-index: 30;
    }
    .pause-overlay.pause-on { display: flex; }

    .pause-panel {
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      width: min(92vw, 420px);
      padding: 34px 40px 30px;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(60, 44, 22, 0.5), rgba(20, 14, 8, 0.78) 70%),
        linear-gradient(180deg, rgba(28, 20, 12, 0.9), rgba(14, 10, 6, 0.94));
      border: 1px solid rgba(196, 152, 70, 0.55);
      border-radius: 12px;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.5),
        0 18px 60px rgba(0, 0, 0, 0.7),
        inset 0 0 60px rgba(0, 0, 0, 0.55),
        inset 0 1px 0 rgba(255, 220, 150, 0.18);
    }
    .pause-panel::before {
      content: '';
      position: absolute; inset: 8px;
      border: 1px solid rgba(196, 152, 70, 0.28);
      border-radius: 7px;
      pointer-events: none;
    }

    .pause-title {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: clamp(38px, 9vw, 72px);
      font-weight: 400; letter-spacing: 0.1em;
      margin: 0;
      background: linear-gradient(180deg, #ffe9a8 0%, #f4c75a 45%, #b9821f 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #f4c75a;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 20px rgba(255, 200, 70, 0.2));
    }
    .pause-saved {
      font-size: 14px; color: #8fcf8a;
      letter-spacing: 0.04em; margin: 12px 0 30px;
    }
    .pause-saved::before { content: '✓ '; }

    .pause-buttons { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 280px; }
    .pause-btn {
      position: relative;
      pointer-events: auto;
      display: block; width: 100%;
      background: linear-gradient(180deg, rgba(74, 56, 30, 0.55), rgba(40, 28, 14, 0.6));
      border: 1px solid rgba(196, 152, 70, 0.6);
      border-radius: 4px; padding: 13px 18px;
      color: #f4d98a;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      font-size: 18px; font-weight: 700;
      letter-spacing: 0.08em; cursor: pointer;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
      box-shadow: inset 0 1px 0 rgba(255, 220, 150, 0.15), inset 0 0 18px rgba(0, 0, 0, 0.45);
      transition: background 0.18s ease-out, box-shadow 0.18s ease-out, transform 0.12s ease-out, color 0.18s ease-out;
    }
    .pause-btn::before, .pause-btn::after {
      content: ''; position: absolute; width: 8px; height: 8px;
      border: 1px solid rgba(255, 222, 150, 0.75);
      pointer-events: none;
    }
    .pause-btn::before { left: 4px; top: 4px; border-right: 0; border-bottom: 0; }
    .pause-btn::after { right: 4px; bottom: 4px; border-left: 0; border-top: 0; }
    .pause-btn:hover {
      background: linear-gradient(180deg, rgba(110, 84, 42, 0.7), rgba(64, 46, 22, 0.7));
      color: #fff0c4;
      transform: translateY(-1px);
      box-shadow:
        inset 0 1px 0 rgba(255, 230, 170, 0.25),
        0 0 18px rgba(255, 200, 80, 0.35),
        0 4px 14px rgba(0, 0, 0, 0.5);
    }
    .pause-btn:active { transform: translateY(0); }
    /* «В главное меню» — приглушённее, чтобы «Продолжить» читалось основным */
    .pause-btn.pause-btn-secondary {
      color: #cabd9c; border-color: rgba(196, 152, 70, 0.32);
      background: linear-gradient(180deg, rgba(48, 38, 22, 0.45), rgba(28, 20, 12, 0.5));
      font-weight: 400;
    }
    .pause-btn.pause-btn-secondary:hover { color: #f0e6cf; }
  `;
  root.appendChild(style);
}

export class PauseScreen {
  private root: HTMLElement;
  private cb: PauseScreenCallbacks;
  private overlay: HTMLElement | null = null;
  private _visible = false;

  constructor(root: HTMLElement, cb: PauseScreenCallbacks) {
    this.root = root;
    this.cb = cb;
    injectStyles(root);
  }

  get visible(): boolean {
    return this._visible;
  }

  private ensureBuilt(): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'pause-overlay';

    const panel = document.createElement('div');
    panel.className = 'pause-panel';

    const title = document.createElement('h1');
    title.className = 'pause-title';
    title.textContent = 'ПАУЗА';

    const saved = document.createElement('div');
    saved.className = 'pause-saved';
    saved.textContent = 'Прогресс сохранён';

    const buttons = document.createElement('div');
    buttons.className = 'pause-buttons';

    const resume = document.createElement('button');
    resume.className = 'pause-btn';
    resume.textContent = 'Продолжить';
    resume.addEventListener('click', () => this.cb.onResume());

    const toMenu = document.createElement('button');
    toMenu.className = 'pause-btn pause-btn-secondary';
    toMenu.textContent = 'В главное меню';
    toMenu.addEventListener('click', () => this.cb.onMainMenu());

    buttons.append(resume, toMenu);
    panel.append(title, saved, buttons);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);

    this.overlay = overlay;
  }

  show(): void {
    this.ensureBuilt();
    this._visible = true;
    this.overlay?.classList.add('pause-on');
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.overlay?.classList.remove('pause-on');
  }
}
