// HUD: HP-бар, счётчик монет, уровень+XP, прицел, вспышка урона, затемнение
// смерти, баннер событий, панель иконок разделов (сумка/таланты/карта). Ванильный
// DOM поверх #ui.
import { HINT_SHOOT_GOAL, nextShootHint } from './hudLogic';
import { hudIconSvg, type HudIconKind } from './itemIcons';

/**
 * Одна строка списка активных квестов в HUD (структурно совпадает с
 * ActiveQuestView из sim/quests — Hud не зависит от sim, берём только нужные поля).
 */
export interface QuestLineView {
  title: string;
  progress: number;
  count: number;
  ready: boolean;
}

/** Ключ localStorage: подсказка «ЛКМ — выстрел» убирается навсегда после N выстрелов. */
const HINT_SHOOT_KEY = 'korovany_hint_shoot';

/** Антиспам красной виньетки урона по дому, мс: дома бьют часто — не мигаем чаще. */
const HOUSE_FLASH_COOLDOWN_MS = 2000;
/** Длительность пульса виньетки урона по дому, мс (наплыв + затухание ~1.5 с). */
const HOUSE_FLASH_MS = 1500;
/** Сколько висит один тост важного события, мс (наплыв/уход ~0.32 с входит в счёт). */
const TOAST_MS = 3500;

export class Hud {
  /** Контейнер всех элементов HUD — его display гасит setVisible под меню/паузой. */
  private host!: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private coinsText: HTMLElement;
  private ammoText: HTMLElement;
  private ammoBox: HTMLElement;
  private crosshair: HTMLElement;
  private shootHint: HTMLElement;
  private noArrows: HTMLElement;
  /** Таймер мигания «Нет стрел» у прицела. */
  private noArrowsTimer: ReturnType<typeof setTimeout> | null = null;
  private levelText: HTMLElement;
  private xpFill: HTMLElement;
  private vignette: HTMLElement;
  private deathOverlay: HTMLElement;
  private banner: HTMLElement;
  private prompt: HTMLElement;
  private ticker: HTMLElement;
  /**
   * Тост важных событий (Фаза 6B): карточка-пергамент в верхней трети по центру-
   * справа (корован выехал, квест взят/готов, страж пал). Дингбат + одна строка,
   * ~3.5 с, очередь без наложения. Тикер в углу оставлен для второстепенного.
   */
  private toast: HTMLElement;
  private toastIcon: HTMLElement;
  private toastText: HTMLElement;
  private toastQueue: { icon: string; text: string }[] = [];
  private toastBusy = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Строка активного сайд-квеста (Фаза 6B): «◈ Убей скелетов: 3/5». */
  private questLine: HTMLElement;
  /** Чип баффа «Благословение источника» (Фаза 6B): «✦ Благословение 2:59». */
  private blessingChip: HTMLElement;
  /** Чип набега и его части: подпись, счётчик живых рейдеров, стрелка на деревню. */
  private raidChip: HTMLElement;
  private raidChipCount: HTMLElement;
  private raidChipArrow: HTMLElement;
  /** Красная виньетка урона по дому (отдельно от виньетки урона игроку). */
  private houseVignette: HTMLElement;
  private houseVignetteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Антиспам пульса урона по дому: не чаще раза в HOUSE_FLASH_COOLDOWN_MS. */
  private lastHouseFlash = 0;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private deathTimer: ReturnType<typeof setTimeout> | null = null;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  /** Очередь тикера слухов: показываем по одной строке, остальные ждут. */
  private tickerQueue: { text: string; durSec: number }[] = [];
  private tickerBusy = false;
  /** Сколько успешных выстрелов уже сделано в этой жизни подсказки (persist в localStorage). */
  private shotsForHint = 0;
  /** Подсказка выстрела отжила своё (≥3 выстрелов когда-либо) — больше не показываем. */
  private hintDone = false;

  constructor(root: HTMLElement) {
    // Стили инжектируются один раз
    const style = document.createElement('style');
    style.textContent = `
      .hud-hp {
        position: absolute; left: 16px; bottom: 16px;
        width: 220px; height: 26px;
        background: rgba(0, 0, 0, 0.55);
        border-radius: 6px; padding: 4px;
        box-sizing: border-box;
      }
      .hud-hp-fill {
        height: 100%; width: 100%;
        background: linear-gradient(#d4453a, #a32a22);
        border-radius: 4px;
        transition: width 0.2s ease-out;
      }
      .hud-hp-text {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font: 12px ui-monospace, monospace;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      }
      .hud-coins {
        position: absolute; right: 16px; bottom: 16px;
        display: flex; align-items: center; gap: 8px;
        background: rgba(0, 0, 0, 0.55);
        border-radius: 6px; padding: 5px 12px 5px 8px;
        color: #ffd75e; font: 14px ui-monospace, monospace;
      }
      .hud-coin-icon {
        width: 14px; height: 14px; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, #ffe9a0, #e8b425 60%, #a9780f);
        box-shadow: inset 0 0 0 1.5px rgba(122, 84, 6, 0.6);
      }
      /* Счётчик стрел — над монетами (тот же правый угол), иконка-стрела + число */
      .hud-ammo {
        position: absolute; right: 16px; bottom: 48px;
        display: flex; align-items: center; gap: 8px;
        background: rgba(0, 0, 0, 0.55);
        border-radius: 6px; padding: 5px 12px 5px 8px;
        color: #e8e2d2; font: 14px ui-monospace, monospace;
      }
      /* Стрелка из CSS: древко + наконечник, оперение — пунктиром через box-shadow */
      .hud-ammo-icon {
        position: relative; width: 16px; height: 12px;
      }
      .hud-ammo-icon::before {
        content: ''; position: absolute; left: 0; top: 5px;
        width: 12px; height: 2px; background: #c9c2b0; border-radius: 1px;
      }
      .hud-ammo-icon::after {
        content: ''; position: absolute; right: 0; top: 2px;
        border: 4px solid transparent; border-left-color: #d9d2c0;
      }
      /* Подсветка нуля: число краснеет, когда стрел нет */
      .hud-ammo.hud-empty { color: #ff5c47; }
      /* «Нет стрел» — рядом с прицелом по центру, мигает на пустой выстрел */
      .hud-noarrows {
        position: absolute; left: 50%; top: 50%;
        transform: translate(-50%, 24px);
        background: rgba(120, 12, 6, 0.78);
        border-radius: 4px; padding: 3px 10px;
        color: #ffe1dc; font: 700 13px ui-monospace, monospace;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.15s ease-out;
        pointer-events: none;
      }
      .hud-noarrows.hud-on { opacity: 1; }
      /* Уровень + XP-бар: над HP-баром слева, тонкая полоса прогресса до след. уровня */
      .hud-xp {
        position: absolute; left: 16px; bottom: 48px;
        width: 220px;
        display: flex; align-items: center; gap: 8px;
        color: #ffe9a0; font: 12px ui-monospace, monospace;
        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      }
      .hud-xp-level {
        flex: 0 0 auto; white-space: nowrap;
      }
      .hud-xp-track {
        flex: 1 1 auto; height: 5px;
        background: rgba(0, 0, 0, 0.55);
        border-radius: 3px; overflow: hidden;
      }
      .hud-xp-fill {
        height: 100%; width: 0%;
        background: linear-gradient(#ffd75e, #e8b425);
        border-radius: 3px;
        transition: width 0.25s ease-out;
      }
      /* Прицел появляется ТОЛЬКО в режиме прицеливания (ПКМ); вне aim — пусто */
      .hud-crosshair {
        position: absolute; left: 50%; top: 50%;
        width: 0; height: 0;
        display: none;
      }
      .hud-crosshair.hud-on { display: block; }
      .hud-crosshair span {
        position: absolute; background: rgba(20, 20, 20, 0.85);
        box-shadow: 0 0 1px rgba(255,255,255,0.5);
      }
      /* 4 чёрточки: верх/низ/лево/право + точка */
      .hud-ch-t { left: -1px; top: -11px; width: 2px; height: 6px; }
      .hud-ch-b { left: -1px; top: 5px;   width: 2px; height: 6px; }
      .hud-ch-l { left: -11px; top: -1px; width: 6px; height: 2px; }
      .hud-ch-r { left: 5px;   top: -1px; width: 6px; height: 2px; }
      .hud-ch-dot { left: -1px; top: -1px; width: 2px; height: 2px; border-radius: 50%; }
      /* Обучающая подсказка выстрела — рядом с прицелом (чуть ниже-правее центра),
         видна в aim, пока игрок не сделал HINT_SHOOT_GOAL выстрелов */
      .hud-shoot-hint {
        position: absolute; left: 50%; top: 50%;
        transform: translate(18px, 14px);
        background: rgba(0, 0, 0, 0.55);
        border-radius: 4px; padding: 3px 8px;
        color: #f0ead8; font: 12px ui-monospace, monospace;
        white-space: nowrap;
        display: none;
        pointer-events: none;
      }
      .hud-shoot-hint.hud-on { display: block; }
      /* Панель иконок разделов: правый нижний угол, ряд слотов «как пояс зелий»
         с золотой рамкой и подписью клавиши под каждым. Заменяет текстовую легенду. */
      .hud-shelf {
        position: absolute; right: 16px; bottom: 78px;
        display: flex; align-items: flex-end; gap: 8px;
        pointer-events: none;
      }
      .hud-shelf-slot {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
      }
      .hud-shelf-icon {
        width: 38px; height: 38px;
        display: flex; align-items: center; justify-content: center;
        padding: 7px; box-sizing: border-box;
        background: rgba(20, 14, 8, 0.62);
        border: 1px solid rgba(196, 152, 70, 0.55);
        border-radius: 6px;
        color: #e8d6a4;
        box-shadow: inset 0 1px 0 rgba(255, 220, 150, 0.12), inset 0 0 12px rgba(0, 0, 0, 0.4);
        transition: color 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.12s;
        pointer-events: auto; cursor: default;
      }
      .hud-shelf-icon svg { width: 100%; height: 100%; display: block; }
      .hud-shelf-icon:hover {
        color: #ffe9b0;
        border-color: rgba(255, 222, 150, 0.85);
        box-shadow: inset 0 1px 0 rgba(255, 230, 170, 0.2), 0 0 12px rgba(255, 200, 80, 0.35);
        transform: translateY(-1px);
      }
      .hud-shelf-key {
        color: rgba(232, 210, 150, 0.78);
        font: 700 10px ui-monospace, monospace;
        letter-spacing: 0.04em;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
      }
      /* Компактная подпись стрельбы рядом со слотами (ПКМ прицел / F выстрел). */
      .hud-shelf-shoot {
        margin-left: 4px; padding-bottom: 18px;
        color: rgba(232, 226, 210, 0.7);
        font: 10px ui-monospace, monospace; line-height: 1.5;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        white-space: nowrap;
      }
      .hud-shelf-shoot b { color: rgba(232, 210, 150, 0.9); font-weight: 700; }
      .hud-vignette {
        position: absolute; inset: 0;
        box-shadow: inset 0 0 90px 30px rgba(200, 20, 10, 0.55);
        opacity: 0;
        transition: opacity 0.25s ease-out;
      }
      .hud-death {
        position: absolute; inset: 0;
        background: #000;
        opacity: 0;
        pointer-events: none;
      }
      .hud-banner {
        position: absolute; left: 50%; top: 14%;
        transform: translateX(-50%);
        color: #ff4f3b;
        font: 700 46px ui-monospace, monospace;
        /* clamp + max-width: на узком окне баннер ужимается, а не вылезает за экран */
        font-size: clamp(22px, 7vw, 46px);
        max-width: 92vw;
        letter-spacing: 0.1em; white-space: nowrap;
        text-shadow: 0 2px 6px rgba(0,0,0,0.85), 0 0 22px rgba(255,60,30,0.45);
        opacity: 0;
        transition: opacity 0.35s ease-out;
        pointer-events: none;
      }
      .hud-prompt {
        position: absolute; left: 50%; bottom: 58px;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.6);
        border-radius: 6px; padding: 8px 14px;
        color: #f0ead8; font: 14px ui-monospace, monospace;
        max-width: 92vw; text-align: center;
        display: none;
        pointer-events: none;
      }
      .hud-prompt.hud-on { display: block; }
      /* Чип набега: пульсирующая плашка вверху по центру, НИЖЕ баннера «НАБИГАЮТ!»
         (top 26% против 14% у баннера) — не перекрываются. Видна, пока идёт набег. */
      .hud-raidchip {
        position: absolute; left: 50%; top: 26%;
        transform: translateX(-50%);
        display: none; align-items: center; gap: 8px;
        background: rgba(120, 14, 8, 0.82);
        border: 1px solid rgba(255, 120, 90, 0.55);
        border-radius: 18px; padding: 6px 14px;
        color: #ffe1da; font: 700 15px ui-monospace, monospace;
        letter-spacing: 0.04em; white-space: nowrap;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        box-shadow: 0 0 14px rgba(255, 60, 30, 0.35);
        pointer-events: none;
        animation: hud-raidpulse 1.1s ease-in-out infinite;
      }
      .hud-raidchip.hud-on { display: flex; }
      @keyframes hud-raidpulse {
        0%, 100% { box-shadow: 0 0 10px rgba(255, 60, 30, 0.30); opacity: 0.92; }
        50%      { box-shadow: 0 0 22px rgba(255, 80, 40, 0.62); opacity: 1; }
      }
      /* Счётчик живых рейдеров справа от подписи (скрыт, пока число неизвестно) */
      .hud-raidchip-count { opacity: 0.85; font-weight: 400; }
      /* Стрелка-указатель ▲ на деревню: CSS-треугольник, крутится через rotate.
         Скрыта, пока игрок близко к деревне (стрелка не нужна). */
      .hud-raidchip-arrow {
        width: 0; height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-bottom: 12px solid #ffd0c4;
        display: none;
        /* трансформация задаётся инлайн (rotate) — переход сглаживает поворот */
        transition: transform 0.12s linear;
      }
      .hud-raidchip-arrow.hud-on { display: block; }
      /* Красная виньетка урона по дому: мягкий пульс по краям ~1.5 с. Отдельный
         слой от .hud-vignette (урон игроку) — события не перетирают друг друга. */
      .hud-housevignette {
        position: absolute; inset: 0;
        box-shadow: inset 0 0 120px 40px rgba(190, 24, 12, 0.0);
        opacity: 0;
        pointer-events: none;
      }
      /* Тост важных событий: карточка-пергамент в верхней трети, центр-справа.
         Над тикером слухов (он слева) и ниже баннера «НАБИГАЮТ!» (top 14%) —
         тост на top 22%, не накладывается ни на баннер, ни на чип набега (26%). */
      .hud-toast {
        position: absolute; right: 5vw; top: 22%;
        display: flex; align-items: center; gap: 10px;
        max-width: min(60vw, 360px);
        padding: 11px 16px;
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(64, 47, 23, 0.55), rgba(22, 15, 8, 0.9) 72%),
          linear-gradient(180deg, rgba(34, 25, 14, 0.95), rgba(17, 12, 7, 0.96));
        border: 1px solid rgba(196, 152, 70, 0.55);
        border-radius: 10px;
        box-shadow:
          0 0 0 1px rgba(0, 0, 0, 0.5),
          0 12px 36px rgba(0, 0, 0, 0.6),
          inset 0 1px 0 rgba(255, 220, 150, 0.18);
        color: #f0e6cf;
        font: 15px 'Philosopher', ui-serif, Georgia, serif;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 0.32s ease-out, transform 0.32s ease-out;
        pointer-events: none;
      }
      .hud-toast.hud-on { opacity: 1; transform: translateY(0); }
      /* Дингбат-иконка тоста — золотая, чуть крупнее текста. */
      .hud-toast-icon {
        flex: 0 0 auto;
        font-size: 20px; line-height: 1;
        color: #f4c75a;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.55));
      }
      .hud-toast-text {
        flex: 1 1 auto;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        letter-spacing: 0.02em;
      }
      /* Тикер слухов: узкая строка ВВЕРХУ СЛЕВА — не конфликтует с баннером
         по центру и HP-баром внизу */
      .hud-ticker {
        position: absolute; left: 16px; top: 14px;
        background: rgba(0, 0, 0, 0.45);
        border-radius: 4px; padding: 5px 10px;
        color: #e8e2d2; font: 13px ui-monospace, monospace;
        max-width: 60vw; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
      }
      /* Список активных квестов (до 4): под тикером слухов (top 44 против 14),
         слева. Контейнер — колонка строк; каждая строка: золотой ромбик ◈ +
         заголовок и прогресс «3/5», готовый — зелёный «✔ … — к жителю». */
      .hud-quest {
        position: absolute; left: 16px; top: 44px;
        display: none; flex-direction: column; gap: 3px;
        max-width: 60vw;
        pointer-events: none;
      }
      .hud-quest.hud-on { display: flex; }
      .hud-quest-row {
        background: rgba(0, 0, 0, 0.45);
        border-radius: 4px; padding: 4px 10px;
        color: #ffe9a0; font: 13px ui-monospace, monospace;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      }
      /* Готовый к сдаче квест — зелёная строка «✔», зовёт вернуться к жителю. */
      .hud-quest-row.hud-quest-ready { color: #9ee08f; }
      /* Чип баффа источника: под списком квестов слева (top 144 — ниже 4 строк),
         бирюзовый, с таймером. Только текст и дингбат ✦ — без эмодзи. */
      .hud-blessing {
        position: absolute; left: 16px; top: 144px;
        display: none; align-items: center; gap: 6px;
        background: rgba(8, 40, 46, 0.55);
        border: 1px solid rgba(120, 230, 220, 0.4);
        border-radius: 12px; padding: 4px 11px;
        color: #aef2ea; font: 13px ui-monospace, monospace;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        box-shadow: 0 0 10px rgba(80, 220, 200, 0.18);
        white-space: nowrap; pointer-events: none;
      }
      .hud-blessing.hud-on { display: flex; }
    `;
    root.appendChild(style);

    // Все визуальные элементы HUD живут в одном контейнере host (а не россыпью в
    // общем #ui): так setVisible(false) одним display:none прячет весь игровой
    // интерфейс под меню/паузой, не задевая оверлеи. host растянут на весь экран
    // и прозрачен для кликов — абсолютное позиционирование детей не меняется.
    const host = document.createElement('div');
    host.className = 'hud-host';
    host.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    root.appendChild(host);
    this.host = host;

    // HP-бар
    const hp = document.createElement('div');
    hp.className = 'hud-hp';
    this.hpFill = document.createElement('div');
    this.hpFill.className = 'hud-hp-fill';
    this.hpText = document.createElement('div');
    this.hpText.className = 'hud-hp-text';
    hp.append(this.hpFill, this.hpText);
    host.appendChild(hp);

    // Счётчик монет
    const coins = document.createElement('div');
    coins.className = 'hud-coins';
    const icon = document.createElement('div');
    icon.className = 'hud-coin-icon';
    this.coinsText = document.createElement('span');
    this.coinsText.textContent = '0';
    coins.append(icon, this.coinsText);
    host.appendChild(coins);

    // Счётчик стрел (над монетами): иконка-стрела + число
    this.ammoBox = document.createElement('div');
    this.ammoBox.className = 'hud-ammo';
    const ammoIcon = document.createElement('div');
    ammoIcon.className = 'hud-ammo-icon';
    this.ammoText = document.createElement('span');
    this.ammoText.textContent = '0';
    this.ammoBox.append(ammoIcon, this.ammoText);
    host.appendChild(this.ammoBox);

    // Уровень + XP-бар (над HP-баром)
    const xp = document.createElement('div');
    xp.className = 'hud-xp';
    this.levelText = document.createElement('span');
    this.levelText.className = 'hud-xp-level';
    this.levelText.textContent = 'Ур. 1';
    const xpTrack = document.createElement('div');
    xpTrack.className = 'hud-xp-track';
    this.xpFill = document.createElement('div');
    this.xpFill.className = 'hud-xp-fill';
    xpTrack.appendChild(this.xpFill);
    xp.append(this.levelText, xpTrack);
    host.appendChild(xp);

    // Прицел (скрыт по умолчанию — появляется только в режиме прицеливания)
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'hud-crosshair';
    for (const cls of ['hud-ch-t', 'hud-ch-b', 'hud-ch-l', 'hud-ch-r', 'hud-ch-dot']) {
      const s = document.createElement('span');
      s.className = cls;
      this.crosshair.appendChild(s);
    }
    host.appendChild(this.crosshair);

    // Обучающая подсказка выстрела рядом с прицелом (гаснет после 3 выстрелов)
    this.shootHint = document.createElement('div');
    this.shootHint.className = 'hud-shoot-hint';
    this.shootHint.textContent = 'ЛКМ / F — выстрел';
    host.appendChild(this.shootHint);

    // «Нет стрел» — мигает у прицела на попытку выстрела с пустым боезапасом
    this.noArrows = document.createElement('div');
    this.noArrows.className = 'hud-noarrows';
    this.noArrows.textContent = 'Нет стрел';
    host.appendChild(this.noArrows);
    // Восстанавливаем счётчик выстрелов: ≥ цели — подсказка уже отжила.
    const saved = Number(localStorage.getItem(HINT_SHOOT_KEY) ?? '0');
    this.shotsForHint = Number.isFinite(saved) ? saved : 0;
    this.hintDone = this.shotsForHint >= HINT_SHOOT_GOAL;

    // Панель иконок разделов (правый нижний угол): рюкзак/свиток/карта — слоты
    // с золотой рамкой и подписью клавиши; рядом компактная подпись стрельбы.
    const shelf = document.createElement('div');
    shelf.className = 'hud-shelf';
    const shelfItems: { icon: HudIconKind; key: string; title: string }[] = [
      { icon: 'backpack', key: '[I]', title: 'Сумка' },
      { icon: 'scroll', key: '[P]', title: 'Таланты' },
      { icon: 'map', key: '[Tab]', title: 'Карта' },
    ];
    for (const it of shelfItems) {
      const slot = document.createElement('div');
      slot.className = 'hud-shelf-slot';
      const box = document.createElement('div');
      box.className = 'hud-shelf-icon';
      box.title = it.title;
      box.innerHTML = hudIconSvg(it.icon);
      const key = document.createElement('div');
      key.className = 'hud-shelf-key';
      key.textContent = it.key;
      slot.append(box, key);
      shelf.appendChild(slot);
    }
    const shoot = document.createElement('div');
    shoot.className = 'hud-shelf-shoot';
    shoot.innerHTML = '<b>ПКМ</b> прицел<br><b>F</b> выстрел';
    shelf.appendChild(shoot);
    host.appendChild(shelf);

    // Виньетка урона
    this.vignette = document.createElement('div');
    this.vignette.className = 'hud-vignette';
    host.appendChild(this.vignette);

    // Затемнение смерти (поверх всего HUD)
    this.deathOverlay = document.createElement('div');
    this.deathOverlay.className = 'hud-death';
    host.appendChild(this.deathOverlay);

    // Баннер событий («НАБИГАЮТ!» и т.п.), скрыт по умолчанию
    this.banner = document.createElement('div');
    this.banner.className = 'hud-banner';
    host.appendChild(this.banner);

    // Плашка интеракции (табличка и т.п.), скрыта по умолчанию
    this.prompt = document.createElement('div');
    this.prompt.className = 'hud-prompt';
    host.appendChild(this.prompt);

    // Тост важных событий (Фаза 6B): иконка-дингбат + строка, скрыт по умолчанию
    this.toast = document.createElement('div');
    this.toast.className = 'hud-toast';
    this.toastIcon = document.createElement('span');
    this.toastIcon.className = 'hud-toast-icon';
    this.toastText = document.createElement('span');
    this.toastText.className = 'hud-toast-text';
    this.toast.append(this.toastIcon, this.toastText);
    host.appendChild(this.toast);

    // Тикер слухов (корованы Фазы 5), скрыт по умолчанию
    this.ticker = document.createElement('div');
    this.ticker.className = 'hud-ticker';
    host.appendChild(this.ticker);

    // Строка активного сайд-квеста (Фаза 6B), под тикером, скрыта по умолчанию
    this.questLine = document.createElement('div');
    this.questLine.className = 'hud-quest';
    host.appendChild(this.questLine);

    // Чип баффа «Благословение источника» (Фаза 6B), под строкой квеста, скрыт
    this.blessingChip = document.createElement('div');
    this.blessingChip.className = 'hud-blessing';
    host.appendChild(this.blessingChip);

    // Красная виньетка урона по дому (под чипом/баннером): вспыхивает на house:damaged.
    this.houseVignette = document.createElement('div');
    this.houseVignette.className = 'hud-housevignette';
    host.appendChild(this.houseVignette);

    // Чип набега: стрелка-указатель + подпись + счётчик живых рейдеров. Скрыт,
    // пока набег не идёт. Стрелка появляется только вдали от деревни (updateRaid).
    this.raidChip = document.createElement('div');
    this.raidChip.className = 'hud-raidchip';
    this.raidChipArrow = document.createElement('div');
    this.raidChipArrow.className = 'hud-raidchip-arrow';
    const raidLabel = document.createElement('span');
    raidLabel.textContent = '⚔ НАБЕГ НА ДЕРЕВНЮ';
    this.raidChipCount = document.createElement('span');
    this.raidChipCount.className = 'hud-raidchip-count';
    this.raidChip.append(this.raidChipArrow, raidLabel, this.raidChipCount);
    host.appendChild(this.raidChip);
  }

  /**
   * Показать/скрыть весь HUD одним display:none на host-контейнере. Зовётся из
   * Game: на главном меню и паузе HUD скрыт (не наслаивается на оверлей),
   * в активной игре — виден. Содержимое (HP/монеты/прицел/баннеры) сохраняется.
   */
  setVisible(on: boolean): void {
    this.host.style.display = on ? 'block' : 'none';
  }

  // ---- Набег: чип-индикатор, стрелка на деревню, виньетка урона по дому ----

  /** Показать чип набега (начало набега). Счётчик/стрелку дорисует updateRaidChip. */
  showRaidChip(): void {
    this.raidChip.classList.add('hud-on');
  }

  /** Спрятать чип набега (победа/поражение): и сам чип, и стрелку. */
  hideRaidChip(): void {
    this.raidChip.classList.remove('hud-on');
    this.raidChipArrow.classList.remove('hud-on');
    this.raidChipCount.textContent = '';
  }

  /**
   * Обновить чип набега раз в кадр: число живых рейдеров и стрелку на деревню.
   * arrow=null — игрок близко, стрелка скрыта; иначе angleRad крутит ▲ к деревне
   * (0 — вверх, по часовой — вправо). Меняем DOM только при смене значений —
   * без перерисовок вхолостую каждый кадр.
   */
  updateRaidChip(raidersAlive: number, arrowAngleRad: number | null): void {
    const countText = raidersAlive > 0 ? `· осталось ${raidersAlive}` : '';
    if (this.raidChipCount.textContent !== countText) this.raidChipCount.textContent = countText;
    if (arrowAngleRad === null) {
      if (this.raidChipArrow.classList.contains('hud-on')) {
        this.raidChipArrow.classList.remove('hud-on');
      }
    } else {
      if (!this.raidChipArrow.classList.contains('hud-on')) {
        this.raidChipArrow.classList.add('hud-on');
      }
      // CSS-стрелка ▲ смотрит вверх в покое (border-bottom) — поворачиваем на угол.
      const deg = (arrowAngleRad * 180) / Math.PI;
      this.raidChipArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    }
  }

  /**
   * Красный пульс по краям экрана: дом деревни получил урон. Наплыв и затухание —
   * CSS-transition (~1.5 с). Антиспам: не чаще раза в HOUSE_FLASH_COOLDOWN_MS
   * (дома бьют часто, иначе виньетка не гасла бы). now — Date.now() (тестируемо).
   */
  houseDamageFlash(now = Date.now()): void {
    if (now - this.lastHouseFlash < HOUSE_FLASH_COOLDOWN_MS) return;
    this.lastHouseFlash = now;
    if (this.houseVignetteTimer !== null) clearTimeout(this.houseVignetteTimer);
    // Мгновенный наплыв красного по краям, затем плавное затухание за HOUSE_FLASH_MS.
    this.houseVignette.style.transition = 'none';
    this.houseVignette.style.boxShadow = 'inset 0 0 120px 40px rgba(190, 24, 12, 0.5)';
    this.houseVignette.style.opacity = '1';
    void this.houseVignette.offsetWidth; // reflow — чтобы затухание применилось
    this.houseVignette.style.transition = `opacity ${HOUSE_FLASH_MS}ms ease-out`;
    this.houseVignette.style.opacity = '0';
    this.houseVignetteTimer = setTimeout(() => {
      this.houseVignetteTimer = null;
    }, HOUSE_FLASH_MS);
  }

  /**
   * Тост важного события: карточка-пергамент в верхней трети центр-справа на
   * TOAST_MS с плавным появлением/уходом. Дингбат-иконка (icon, напр. «✦»/«⚔»/«◈»)
   * + одна строка. Залп событий встаёт в очередь и показывается по одному без
   * наложения — следующий ждёт ухода предыдущего. Для второстепенного (подборы/
   * продажи) есть showTicker в углу.
   */
  showToast(icon: string, text: string): void {
    this.toastQueue.push({ icon, text });
    if (!this.toastBusy) this.nextToast();
  }

  private nextToast(): void {
    const msg = this.toastQueue.shift();
    if (!msg) {
      this.toastBusy = false;
      return;
    }
    this.toastBusy = true;
    this.toastIcon.textContent = msg.icon;
    this.toastText.textContent = msg.text;
    // Наплыв (add hud-on запускает opacity/transform transition).
    this.toast.classList.add('hud-on');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    // Держим карточку, затем уводим; через длительность ухода (~0.34 с) — следующий.
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove('hud-on');
      this.toastTimer = setTimeout(() => {
        this.toastTimer = null;
        this.nextToast();
      }, 360);
    }, TOAST_MS);
  }

  /**
   * Строка тикера слухов вверху слева на durSec секунд. Сообщения встают
   * в очередь и показываются по одному с fade in/out (transition 0.3 с) —
   * залп событий («ограблен» + «стража в ярости») не перетирает друг друга.
   */
  showTicker(text: string, durSec: number): void {
    this.tickerQueue.push({ text, durSec });
    if (!this.tickerBusy) this.nextTicker();
  }

  private nextTicker(): void {
    const msg = this.tickerQueue.shift();
    if (!msg) {
      this.tickerBusy = false;
      return;
    }
    this.tickerBusy = true;
    this.ticker.textContent = msg.text;
    this.ticker.style.opacity = '1';
    // Гасим за 0.3 с до конца durSec, затем микропауза 0.15 с между строками,
    // чтобы две подряд не сливались в «мигнувшую» одну
    setTimeout(() => {
      this.ticker.style.opacity = '0';
      setTimeout(() => this.nextTicker(), 450);
    }, Math.max(0, msg.durSec * 1000 - 300));
  }

  /**
   * Список активных сайд-квестов под тикером слухов (Фаза 6B): до 4 строк
   * «◈ Название: N/M», готовый — зелёная «✔ Название — к жителю». Пустой список
   * прячет блок (нет активных квестов). Перерисовываем строки целиком: их мало
   * (≤4) и обновляется только по смене прогресса (Game гейтит ключом).
   */
  setQuestList(views: QuestLineView[]): void {
    if (views.length === 0) {
      this.questLine.classList.remove('hud-on');
      this.questLine.replaceChildren();
      return;
    }
    const rows = views.map((v) => {
      const row = document.createElement('div');
      row.className = v.ready ? 'hud-quest-row hud-quest-ready' : 'hud-quest-row';
      row.textContent = v.ready
        ? `✔ ${v.title} — вернись к жителю`
        : `◈ ${v.title}: ${v.progress}/${v.count}`;
      return row;
    });
    this.questLine.replaceChildren(...rows);
    this.questLine.classList.add('hud-on');
  }

  /**
   * Чип баффа «Благословение источника» (Фаза 6B) с остатком в секундах: дингбат
   * ✦ + «М:СС». Game зовёт раз в секунду (по смене целых секунд). Без эмодзи.
   */
  setBlessing(secondsLeft: number): void {
    const s = Math.max(0, Math.round(secondsLeft));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    const text = `✦ Благословение ${m}:${rem.toString().padStart(2, '0')}`;
    if (this.blessingChip.textContent !== text) this.blessingChip.textContent = text;
    this.blessingChip.classList.add('hud-on');
  }

  /** Спрятать чип баффа источника (истёк/сброшен). */
  clearBlessing(): void {
    this.blessingChip.classList.remove('hud-on');
    this.blessingChip.textContent = '';
  }

  /** Плашка интеракции внизу по центру (над HP-баром). Висит, пока не позовут hidePrompt. */
  showPrompt(text: string): void {
    this.prompt.textContent = text;
    this.prompt.classList.add('hud-on');
  }

  hidePrompt(): void {
    this.prompt.classList.remove('hud-on');
  }

  /**
   * Крупный баннер по центру сверху на durSec секунд: наплыв и затухание —
   * CSS-transition (0.35 с), таймер прячет с учётом наплыва, чтобы суммарно ~durSec.
   */
  showBanner(text: string, durSec: number): void {
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    this.bannerTimer = setTimeout(
      () => {
        this.banner.style.opacity = '0';
        this.bannerTimer = null;
      },
      Math.max(0, durSec * 1000 - 350),
    );
  }

  setHp(hp: number, max: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    this.hpFill.style.width = `${frac * 100}%`;
    this.hpText.textContent = `${Math.max(0, Math.round(hp))} / ${Math.round(max)}`;
  }

  setCoins(total: number): void {
    this.coinsText.textContent = String(total);
  }

  /** Счётчик стрел в HUD. На нуле число краснеет (подсветка пустого боезапаса). */
  setAmmo(arrows: number): void {
    const n = Math.max(0, Math.round(arrows));
    this.ammoText.textContent = String(n);
    this.ammoBox.classList.toggle('hud-empty', n <= 0);
  }

  /** Мигнуть «Нет стрел» у прицела (попытка выстрела с пустым боезапасом). */
  showNoArrows(): void {
    this.noArrows.classList.add('hud-on');
    if (this.noArrowsTimer !== null) clearTimeout(this.noArrowsTimer);
    this.noArrowsTimer = setTimeout(() => {
      this.noArrows.classList.remove('hud-on');
      this.noArrowsTimer = null;
    }, 1100);
  }

  setAiming(on: boolean): void {
    this.crosshair.classList.toggle('hud-on', on);
    // Подсказку выстрела показываем только в aim и только пока не отжила.
    this.shootHint.classList.toggle('hud-on', on && !this.hintDone);
  }

  /** Уровень + доля прогресса XP до следующего уровня (0..1). На капе frac=1. */
  setLevelXp(level: number, frac: number): void {
    this.levelText.textContent = `Ур. ${level}`;
    const pct = Math.max(0, Math.min(1, frac)) * 100;
    this.xpFill.style.width = `${pct}%`;
  }

  /**
   * Засчитать успешный выстрел для обучающей подсказки. После HINT_SHOOT_GOAL
   * выстрелов подсказка гаснет навсегда (флаг и счётчик — в localStorage).
   */
  onShotFired(): void {
    if (this.hintDone) return;
    const r = nextShootHint(this.shotsForHint);
    this.shotsForHint = r.shots;
    try {
      localStorage.setItem(HINT_SHOOT_KEY, String(this.shotsForHint));
    } catch {
      // приватный режим/квота — не критично, подсказка просто не запомнится между сессиями
    }
    if (r.done) {
      this.hintDone = true;
      this.shootHint.classList.remove('hud-on');
    }
  }

  /**
   * Затемнение смерти: чёрный экран наплывает за 0.4 с и тает за 1.1 с (~1.5 с).
   * Чисто визуально — телепорт на спавн Game делает сразу, оверлей прячет рывок камеры.
   */
  deathFade(): void {
    if (this.deathTimer !== null) clearTimeout(this.deathTimer);
    this.deathOverlay.style.transition = 'opacity 0.4s ease-in';
    this.deathOverlay.style.opacity = '1';
    this.deathTimer = setTimeout(() => {
      this.deathOverlay.style.transition = 'opacity 1.1s ease-out';
      this.deathOverlay.style.opacity = '0';
      this.deathTimer = null;
    }, 450);
  }

  /** Красная виньетка: вспыхивает мгновенно, гаснет за ~250 мс. */
  damageFlash(): void {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.vignette.style.transition = 'none';
    this.vignette.style.opacity = '1';
    // Принудительный reflow, чтобы transition применился к затуханию
    void this.vignette.offsetWidth;
    this.vignette.style.transition = 'opacity 0.25s ease-out';
    this.vignette.style.opacity = '0';
    this.flashTimer = setTimeout(() => { this.flashTimer = null; }, 250);
  }
}
