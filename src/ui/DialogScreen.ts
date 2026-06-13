// Экран диалога с жителем (Фаза 6B): пергаментная плашка в стиле меню/паузы
// (Forum для имени, Philosopher для текста — шрифты подключены @font-face).
// Имя+роль жителя, текст реплики, кнопки-варианты. Блокирует ввод как другие
// экраны (Game ставит screenOpen/снимает pointer lock через onShow/onHide).
// НИКАКОГО обращения к Game — только колбэки и метод open(): что показать и какие
// кнопки активны решает Game (по состоянию квеста), экран лишь рисует и эмитит клик.

/** Действие кнопки диалога. */
export type DialogAction = 'take' | 'turnin' | 'leave';

/** Одна кнопка-вариант: подпись + действие + основная ли (золотая акцентная). */
export interface DialogOption {
  label: string;
  action: DialogAction;
  primary?: boolean;
}

/** Содержимое одной реплики диалога. */
export interface DialogContent {
  /** Имя жителя (заголовок). */
  name: string;
  /** Роль/ремесло — мелкой строкой под именем. */
  role: string;
  /** Текст реплики. */
  text: string;
  /** Кнопки-варианты в порядке отрисовки. */
  options: DialogOption[];
}

export interface DialogCallbacks {
  /** Клик по варианту: Game решает, что делать (взять/сдать/уйти) и закрыть ли. */
  onChoose(action: DialogAction): void;
  /** Экран показан/скрыт — Game ставит паузу-блокировку ввода и pointer lock. */
  onShow?(): void;
  onHide?(): void;
}

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .dlg-overlay {
      position: absolute; inset: 0;
      display: none; align-items: flex-end; justify-content: center;
      background: radial-gradient(ellipse 120% 90% at 50% 60%, rgba(7, 9, 13, 0.18) 40%, rgba(5, 6, 10, 0.4) 100%);
      pointer-events: none;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f0e6cf;
      z-index: 28;
    }
    .dlg-overlay.dlg-on { display: flex; }

    .dlg-panel {
      position: relative;
      pointer-events: auto;
      display: flex; flex-direction: column;
      width: min(92vw, 540px);
      margin-bottom: 8vh;
      padding: 24px 30px 22px;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(60, 44, 22, 0.5), rgba(20, 14, 8, 0.82) 70%),
        linear-gradient(180deg, rgba(30, 22, 13, 0.94), rgba(15, 11, 6, 0.96));
      border: 1px solid rgba(196, 152, 70, 0.55);
      border-radius: 12px;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.5),
        0 18px 60px rgba(0, 0, 0, 0.7),
        inset 0 0 60px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 220, 150, 0.18);
    }
    .dlg-panel::before {
      content: '';
      position: absolute; inset: 8px;
      border: 1px solid rgba(196, 152, 70, 0.26);
      border-radius: 7px;
      pointer-events: none;
    }

    .dlg-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
    .dlg-name {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: clamp(26px, 5vw, 36px);
      font-weight: 400; letter-spacing: 0.06em; margin: 0;
      background: linear-gradient(180deg, #ffe9a8 0%, #f4c75a 50%, #b9821f 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #f4c75a;
      filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.55));
    }
    .dlg-role {
      font-size: 14px; font-style: italic; color: #b6a988; letter-spacing: 0.03em;
    }
    .dlg-text {
      font-size: 17px; line-height: 1.5; color: #ece2cb;
      margin: 0 0 20px; min-height: 2.6em;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }
    .dlg-buttons { display: flex; flex-wrap: wrap; gap: 12px; }
    .dlg-btn {
      position: relative;
      pointer-events: auto;
      flex: 1 1 auto; min-width: 120px;
      background: linear-gradient(180deg, rgba(48, 38, 22, 0.5), rgba(28, 20, 12, 0.55));
      border: 1px solid rgba(196, 152, 70, 0.4);
      border-radius: 4px; padding: 11px 16px;
      color: #d8caa2;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      font-size: 16px; font-weight: 400; letter-spacing: 0.04em;
      cursor: pointer; text-align: center;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      box-shadow: inset 0 1px 0 rgba(255, 220, 150, 0.12), inset 0 0 16px rgba(0, 0, 0, 0.4);
      transition: background 0.16s ease-out, color 0.16s ease-out, box-shadow 0.16s ease-out, transform 0.1s ease-out;
    }
    .dlg-btn:hover {
      background: linear-gradient(180deg, rgba(90, 70, 36, 0.65), rgba(54, 40, 20, 0.65));
      color: #fff0c4; transform: translateY(-1px);
      box-shadow: inset 0 1px 0 rgba(255, 230, 170, 0.2), 0 4px 14px rgba(0, 0, 0, 0.45);
    }
    .dlg-btn:active { transform: translateY(0); }
    /* Основное действие (взять/сдать) — золотое, заметнее «Уйти». */
    .dlg-btn.dlg-primary {
      color: #f4d98a; font-weight: 700;
      border-color: rgba(196, 152, 70, 0.7);
      background: linear-gradient(180deg, rgba(74, 56, 30, 0.6), rgba(40, 28, 14, 0.65));
    }
    .dlg-btn.dlg-primary:hover {
      background: linear-gradient(180deg, rgba(110, 84, 42, 0.75), rgba(64, 46, 22, 0.75));
      color: #fff0c4; box-shadow: inset 0 1px 0 rgba(255, 230, 170, 0.25), 0 0 16px rgba(255, 200, 80, 0.3);
    }
  `;
  root.appendChild(style);
}

/** Диалоговый оверлей жителя. Кнопки пересобираются на каждый open (их состав меняется). */
export class DialogScreen {
  private root: HTMLElement;
  private cb: DialogCallbacks;
  private overlay: HTMLElement | null = null;
  private nameEl: HTMLElement | null = null;
  private roleEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private buttonsEl: HTMLElement | null = null;
  private _visible = false;

  constructor(root: HTMLElement, cb: DialogCallbacks) {
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
    overlay.className = 'dlg-overlay';

    const panel = document.createElement('div');
    panel.className = 'dlg-panel';

    const head = document.createElement('div');
    head.className = 'dlg-head';
    this.nameEl = document.createElement('h2');
    this.nameEl.className = 'dlg-name';
    this.roleEl = document.createElement('span');
    this.roleEl.className = 'dlg-role';
    head.append(this.nameEl, this.roleEl);

    this.textEl = document.createElement('p');
    this.textEl.className = 'dlg-text';

    this.buttonsEl = document.createElement('div');
    this.buttonsEl.className = 'dlg-buttons';

    panel.append(head, this.textEl, this.buttonsEl);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);
    this.overlay = overlay;
  }

  /** Показать реплику с заданными кнопками. Если уже открыт — просто перерисует. */
  open(content: DialogContent): void {
    this.ensureBuilt();
    if (this.nameEl) this.nameEl.textContent = content.name;
    if (this.roleEl) this.roleEl.textContent = content.role;
    if (this.textEl) this.textEl.textContent = content.text;
    this.renderButtons(content.options);
    if (!this._visible) {
      this._visible = true;
      this.overlay?.classList.add('dlg-on');
      this.cb.onShow?.();
    }
  }

  private renderButtons(options: DialogOption[]): void {
    if (!this.buttonsEl) return;
    const els = options.map((opt) => {
      const btn = document.createElement('button');
      btn.className = opt.primary ? 'dlg-btn dlg-primary' : 'dlg-btn';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => this.cb.onChoose(opt.action));
      return btn;
    });
    this.buttonsEl.replaceChildren(...els);
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.overlay?.classList.remove('dlg-on');
    this.cb.onHide?.();
  }
}
