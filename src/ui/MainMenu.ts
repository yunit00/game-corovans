// Главное меню (Фаза 6, волна 6A; переоформлено в Фазе 6.6): полноэкранный
// оверлей при старте. За ним живёт 3D-облёт деревни (камеру ведёт CameraRig из
// Game) — поэтому фон оверлея ПОЛУПРОЗРАЧНЫЙ с виньеткой по краям, мир просвечивает.
// Заголовок «КОРОВАНЫ» декоративным шрифтом Forum, подзаголовок «по мотивам
// одного ТЗ», панель-пергамент с гербовыми кнопками. Чистый DOM поверх #ui.
// НИКАКОГО обращения к Game — только колбэки onContinue/onNewGame.
//
// Звук: меню видно ДО первого жеста пользователя, но WebAudio стартует только
// по клику кнопки — сам клик и есть нужный жест (AudioEngine.resume вешает
// интегратор на onContinue/onNewGame). Поэтому здесь — только колбэки.

export interface MainMenuCallbacks {
  /** «Продолжить» — загрузить существующий сейв (кнопка активна только если есть сейв). */
  onContinue(): void;
  /** «Новая игра» — начать заново (с подтверждением, если сейв есть). */
  onNewGame(): void;
}

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Тёплая средневековая палитра: пергамент, золото, тёмное дерево. */
    .menu-overlay {
      position: absolute; inset: 0;
      display: none; align-items: center; justify-content: center;
      /* Только виньетка по краям — центр прозрачен, чтобы за меню был виден
         3D-облёт деревни. Лёгкая тёплая тонировка + затемнение к краям. */
      background:
        radial-gradient(ellipse 120% 90% at 50% 42%, rgba(8, 10, 14, 0) 40%, rgba(6, 8, 12, 0.62) 78%, rgba(3, 4, 7, 0.9) 100%),
        linear-gradient(rgba(20, 14, 6, 0.12), rgba(8, 6, 3, 0.22));
      pointer-events: auto;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f0e6cf;
      opacity: 1;
      transition: opacity 0.6s ease-out;
    }
    .menu-overlay.menu-on { display: flex; }
    .menu-overlay.menu-fading { opacity: 0; }

    /* Панель-пергамент по центру: тёмное дерево с золотой каймой и тиснением. */
    .menu-panel {
      position: relative;
      display: flex; flex-direction: column; align-items: center;
      width: min(92vw, 460px);
      padding: 38px 40px 30px;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(60, 44, 22, 0.55), rgba(20, 14, 8, 0.78) 70%),
        linear-gradient(180deg, rgba(28, 20, 12, 0.9), rgba(14, 10, 6, 0.94));
      border: 1px solid rgba(196, 152, 70, 0.55);
      border-radius: 12px;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.5),
        0 18px 60px rgba(0, 0, 0, 0.7),
        inset 0 0 60px rgba(0, 0, 0, 0.55),
        inset 0 1px 0 rgba(255, 220, 150, 0.18);
      /* Двойная золотая рамка-орнамент через outline + псевдоэлемент-уголки */
      backdrop-filter: blur(3px);
    }
    /* Тонкая внутренняя золотая рамка (гербовый кант). */
    .menu-panel::before {
      content: '';
      position: absolute; inset: 8px;
      border: 1px solid rgba(196, 152, 70, 0.28);
      border-radius: 7px;
      pointer-events: none;
    }

    .menu-title {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: clamp(46px, 12vw, 92px);
      font-weight: 400; line-height: 0.95;
      letter-spacing: 0.06em;
      margin: 0;
      /* Золото с лёгким градиентом и тиснением */
      background: linear-gradient(180deg, #ffe9a8 0%, #f4c75a 45%, #b9821f 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #f4c75a;
      text-shadow: 0 2px 1px rgba(0, 0, 0, 0.35);
      filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 22px rgba(255, 200, 70, 0.22));
    }
    /* Декоративные «усики» под заголовком: ◆ — — — ◆ */
    .menu-rule {
      display: flex; align-items: center; gap: 10px;
      margin: 12px 0 4px; color: rgba(196, 152, 70, 0.8);
      font-size: 12px; letter-spacing: 0.3em;
    }
    .menu-rule::before, .menu-rule::after {
      content: ''; width: 56px; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(196, 152, 70, 0.7), transparent);
    }
    .menu-sub {
      font-size: 15px; color: #c8b58a;
      letter-spacing: 0.04em; margin: 6px 0 26px;
      font-style: italic;
    }

    .menu-buttons { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 280px; }

    /* Гербовая кнопка: пергаментная заливка, золотая рамка со скошенными углами,
       свечение и сдвиг при наведении. */
    .menu-btn {
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
    /* Уголки-засечки гербовой рамки (CSS, без растров). */
    .menu-btn::before, .menu-btn::after {
      content: ''; position: absolute; width: 8px; height: 8px;
      border: 1px solid rgba(255, 222, 150, 0.75);
      pointer-events: none;
    }
    .menu-btn::before { left: 4px; top: 4px; border-right: 0; border-bottom: 0; }
    .menu-btn::after { right: 4px; bottom: 4px; border-left: 0; border-top: 0; }
    .menu-btn:hover:not(:disabled) {
      background: linear-gradient(180deg, rgba(110, 84, 42, 0.7), rgba(64, 46, 22, 0.7));
      color: #fff0c4;
      transform: translateY(-1px);
      box-shadow:
        inset 0 1px 0 rgba(255, 230, 170, 0.25),
        0 0 18px rgba(255, 200, 80, 0.35),
        0 4px 14px rgba(0, 0, 0, 0.5);
    }
    .menu-btn:active:not(:disabled) { transform: translateY(0); }
    .menu-btn:disabled {
      opacity: 0.42; cursor: default;
      color: #9a907a; border-color: rgba(196, 152, 70, 0.25);
      box-shadow: none;
    }
    .menu-btn:disabled::before, .menu-btn:disabled::after { opacity: 0.3; }

    /* Панель «Об игре» — скрытая по умолчанию, разворачивается под кнопками */
    .menu-about {
      display: none;
      margin-top: 22px; width: 100%; max-width: 360px;
      background: rgba(10, 8, 5, 0.6);
      border: 1px solid rgba(196, 152, 70, 0.22);
      border-radius: 6px; padding: 14px 18px;
      font-size: 13px; line-height: 1.55; color: #cabd9c;
    }
    .menu-about.menu-about-on { display: block; }
    .menu-about h3 {
      margin: 0 0 8px; font-size: 12px; color: #f4c75a;
      letter-spacing: 0.14em; text-transform: uppercase;
      font-weight: 700;
    }
    .menu-keys { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; }
    .menu-key { color: #f4c75a; font-weight: 700; }

    /* Разделитель секций внутри «Об игре». */
    .menu-about-sep {
      margin: 14px 0 0; border-top: 1px solid rgba(196, 152, 70, 0.18);
      padding-top: 12px;
    }
    /* Кредиты ассетов — мелким списком внутри «Об игре». */
    .menu-credits { font-size: 12px; line-height: 1.5; color: rgba(202, 189, 156, 0.85); }
    .menu-credits b { color: #e8c474; font-weight: 700; }
    /* Заметная ссылка на телеграм-канал внутри «Об игре». */
    .menu-about-channel {
      display: inline-block; margin-top: 10px;
      color: #f4d98a; text-decoration: none;
      font-size: 13px; font-weight: 700; letter-spacing: 0.03em;
      padding: 5px 12px;
      border: 1px solid rgba(196, 152, 70, 0.5); border-radius: 5px;
      background: rgba(60, 44, 22, 0.4);
      pointer-events: auto; cursor: pointer;
      transition: color 0.15s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .menu-about-channel:hover {
      color: #ffe9b0; border-color: rgba(255, 222, 150, 0.8);
      background: rgba(90, 68, 34, 0.5);
      box-shadow: 0 0 12px rgba(244, 199, 90, 0.4);
    }

    /* Подвал главного экрана — только ссылка на канал, мелко по центру. */
    .menu-foot {
      margin-top: 22px; text-align: center;
      letter-spacing: 0.03em; line-height: 1.5;
    }
    /* Ссылка на канал — заметная строка внизу главного экрана. */
    .menu-foot .menu-channel {
      display: block; margin: 4px 0;
      color: #e8c474; text-decoration: none; font-size: 12px;
      letter-spacing: 0.04em; pointer-events: auto; cursor: pointer;
      transition: color 0.15s, text-shadow 0.15s;
    }
    .menu-foot .menu-channel:hover {
      color: #ffe9b0; text-shadow: 0 0 10px rgba(244, 199, 90, 0.45);
      text-decoration: underline;
    }
  `;
  root.appendChild(style);
}

export class MainMenu {
  private root: HTMLElement;
  private cb: MainMenuCallbacks;
  private overlay: HTMLElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private newGameBtn: HTMLButtonElement | null = null;
  private aboutEl: HTMLElement | null = null;
  /** Есть ли сейв — влияет на доступность «Продолжить» и подтверждение «Новой игры». */
  private hasSave = false;
  /**
   * Готов ли мир (loading-errors): пока false — «Играть»/«Продолжить» заблокированы
   * с подписью «Загрузка…», чтобы клик в ещё не построенный мир не «молчал». Game
   * зовёт markReady() в конце init (после initCombat). Текст кнопок ниже выбирается
   * с учётом этого флага.
   */
  private ready = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private _visible = false;

  constructor(root: HTMLElement, cb: MainMenuCallbacks) {
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
    overlay.className = 'menu-overlay';

    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'КОРОВАНЫ';

    const rule = document.createElement('div');
    rule.className = 'menu-rule';
    rule.textContent = '◆';

    const sub = document.createElement('div');
    sub.className = 'menu-sub';
    sub.textContent = 'по мотивам одного ТЗ';

    const buttons = document.createElement('div');
    buttons.className = 'menu-buttons';

    const cont = document.createElement('button');
    cont.className = 'menu-btn';
    cont.textContent = 'Продолжить';
    cont.disabled = true; // активируется в refreshButtons (нужны сейв И готовый мир)
    cont.addEventListener('click', () => {
      if (!cont.disabled) this.cb.onContinue();
    });

    const fresh = document.createElement('button');
    fresh.className = 'menu-btn';
    fresh.textContent = 'Загрузка…';
    fresh.disabled = true; // активируется в refreshButtons, когда мир готов
    fresh.addEventListener('click', () => {
      if (!fresh.disabled) this.onNewGameClick();
    });

    const about = document.createElement('button');
    about.className = 'menu-btn';
    about.textContent = 'Об игре';
    about.addEventListener('click', () => this.toggleAbout());

    buttons.append(cont, fresh, about);

    panel.append(title, rule, sub, buttons, this.buildAbout(), this.buildFoot());
    overlay.appendChild(panel);
    this.root.appendChild(overlay);

    this.overlay = overlay;
    this.continueBtn = cont;
    this.newGameBtn = fresh;
  }

  private buildAbout(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'menu-about';

    const controlsTitle = document.createElement('h3');
    controlsTitle.textContent = 'Управление';
    const keys = document.createElement('div');
    keys.className = 'menu-keys';
    const rows: [string, string][] = [
      ['WASD', 'движение'],
      ['Shift', 'бег'],
      ['Space', 'прыжок'],
      ['ЛКМ', 'удар / выстрел'],
      ['ПКМ', 'прицел'],
      ['E', 'взаимодействие'],
      ['I', 'инвентарь'],
      ['P', 'таланты'],
      ['Esc', 'пауза'],
      ['M', 'звук вкл/выкл'],
      ['1 2 3', 'зелья с пояса'],
    ];
    for (const [k, v] of rows) {
      const key = document.createElement('span');
      key.className = 'menu-key';
      key.textContent = k;
      const val = document.createElement('span');
      val.textContent = v;
      keys.append(key, val);
    }

    box.append(controlsTitle, keys, this.buildCredits());
    this.aboutEl = box;
    return box;
  }

  /** Кредиты ассетов + ссылка на телеграм-канал — внутри «Об игре». */
  private buildCredits(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'menu-about-sep';

    const title = document.createElement('h3');
    title.textContent = 'Благодарности';

    const credits = document.createElement('div');
    credits.className = 'menu-credits';
    // Движок + источники ассетов (всё CC0/OFL). Без эмодзи — текст и точки-буллеты.
    credits.innerHTML =
      '<b>Движок:</b> Three.js, Rapier<br>' +
      '<b>3D-ассеты (CC0):</b> KayKit (Kay Lousberg), Kenney, Quaternius<br>' +
      '<b>Текстуры (CC0):</b> Poly Haven<br>' +
      '<b>Музыка (CC0):</b> RandomMind / OpenGameArt<br>' +
      '<b>Шрифты (OFL):</b> Forum, Philosopher';

    // Канал создателей — тот же, что на табличке у спавна (TelegramSign).
    const channel = document.createElement('a');
    channel.className = 'menu-about-channel';
    channel.href = 'https://t.me/TochkiNadAI';
    channel.target = '_blank';
    channel.rel = 'noopener';
    channel.textContent = 'Канал «Точки над ИИ» — t.me/TochkiNadAI';

    sep.append(title, credits, channel);
    return sep;
  }

  /** Подвал главного экрана — только ссылка на телеграм-канал. */
  private buildFoot(): HTMLElement {
    const foot = document.createElement('div');
    foot.className = 'menu-foot';

    // Канал создателей — тот же, что на табличке у спавна (TelegramSign).
    const channel = document.createElement('a');
    channel.className = 'menu-channel';
    channel.href = 'https://t.me/TochkiNadAI';
    channel.target = '_blank';
    channel.rel = 'noopener';
    channel.textContent = 'Игра канала «Точки над ИИ» — t.me/TochkiNadAI';

    foot.append(channel);
    return foot;
  }

  private toggleAbout(): void {
    this.aboutEl?.classList.toggle('menu-about-on');
  }

  private onNewGameClick(): void {
    // Подтверждение только при наличии сейва — иначе сразу новый забег.
    if (this.hasSave) {
      const ok = window.confirm('Начать новую игру? Текущий прогресс будет перезаписан.');
      if (!ok) return;
    }
    this.cb.onNewGame();
  }

  /** Сообщить меню, есть ли сейв: включает «Продолжить» и подтверждение «Новой игры». */
  setHasSave(hasSave: boolean): void {
    this.ensureBuilt();
    this.hasSave = hasSave;
    this.refreshButtons();
  }

  /**
   * Мир построен (loading-errors): снять блок «Загрузка…» с кнопок. До этого
   * вызова «Играть»/«Продолжить» задизейблены — клик в недостроенный мир «молчал».
   */
  markReady(): void {
    this.ensureBuilt();
    this.ready = true;
    this.refreshButtons();
  }

  /**
   * Привести доступность/подписи кнопок в соответствие с (ready, hasSave).
   * Пока мир не готов — обе игровые кнопки заблокированы, главная зовётся
   * «Загрузка…». После готовности: «Продолжить» активна только при наличии сейва,
   * вторая кнопка — «Новая игра» (есть сейв) или «Играть» (чистый старт).
   */
  private refreshButtons(): void {
    if (this.continueBtn) this.continueBtn.disabled = !this.ready || !this.hasSave;
    if (this.newGameBtn) {
      this.newGameBtn.disabled = !this.ready;
      this.newGameBtn.textContent = !this.ready ? 'Загрузка…' : this.hasSave ? 'Новая игра' : 'Играть';
    }
  }

  show(): void {
    this.ensureBuilt();
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this._visible = true;
    this.overlay?.classList.add('menu-on');
    this.overlay?.classList.remove('menu-fading');
  }

  /** Скрыть с лёгким fade (0.6 с): сначала гасим прозрачность, затем display:none. */
  hide(): void {
    if (!this._visible || !this.overlay) return;
    this._visible = false;
    const overlay = this.overlay;
    overlay.classList.add('menu-fading');
    this.fadeTimer = setTimeout(() => {
      overlay.classList.remove('menu-on', 'menu-fading');
      this.fadeTimer = null;
    }, 600);
  }
}
