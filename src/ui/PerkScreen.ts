// Экран талантов (Фаза 6B, ветка прокачек): визуальный граф-дерево «как в играх».
// Корень ветви — внизу, ступени поднимаются вверх, на 3-й ступени развилка из двух
// узлов, наверху — капстоун. Узлы-медальоны соединены SVG-линиями связей. Три
// состояния: изучен (золото), доступен (пульсирующий контур), закрыт (тускло +
// замок-штрих). Ховер — карточка с описанием/стоимостью. Клик по доступному —
// взять (списание очков делает Game через onUnlock). Чистый DOM/SVG поверх #ui,
// БЕЗ обращения к Game и БЕЗ эмодзи. Палитра пергамент/золото как у MainMenu.
import { PERKS, perkCost, type PerkId, type PerkDef, type PerkBranch } from '../sim/progression';

/** Состояние одного перка для отрисовки (вычислено снаружи через canUnlock). */
export type PerkSlotState = 'unlocked' | 'available' | 'locked' | 'noPoints';

export interface PerkCallbacks {
  /** ЛКМ по доступному перку — взять (списание очка делает Game). */
  onUnlock(id: PerkId): void;
  /** Экран показан/скрыт — интегратор ставит паузу логики и pointer lock. */
  onShow?(): void;
  onHide?(): void;
}

/** Снимок для refresh: состояние каждого перка + прогресс уровня. */
export interface PerkRefresh {
  /** Состояние всех перков по id (Game считает через canUnlock/unlocked). */
  states: Record<PerkId, PerkSlotState>;
  /** Нерастраченные очки. */
  points: number;
  level: number;
  /** Текущий накопленный опыт. */
  xp: number;
  /** Кумулятивный опыт до следующего уровня (на капе равен текущему порогу). */
  xpNext: number;
}

/** Ветви в порядке колонок (слева направо). */
const BRANCHES: readonly PerkBranch[] = ['Стрелок', 'Воин', 'Следопыт'];

/** Подпись состояния перка для карточки-ховера. */
const STATE_LABEL: Record<PerkSlotState, string> = {
  unlocked: 'изучен',
  available: 'можно изучить',
  locked: 'нужна предыдущая ступень',
  noPoints: 'не хватает очков',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// ─── Геометрия графа (единые координаты viewBox) ───
const COL_W = 250; // ширина колонки ветви
const FORK_DX = 58; // смещение узлов развилки от центра
const NODE_R = 26; // радиус медальона
const VIEW_W = COL_W * 3;
const VIEW_H = 560;
/** Y-координаты ступеней (корень внизу, капстоун вверху). */
const TIER_Y: Record<number, number> = { 1: 500, 2: 388, 3: 268, 4: 150, 5: 48 };

/**
 * Иконки перков — рисованные штриховые SVG (наследуют currentColor). По одной на
 * перк, чтобы граф читался без подписей. Без эмодзи (запрет игрока).
 */
const PERK_ICON: Record<PerkId, string> = {
  // Стрелок — глаз, снежинка-крит, тяжёлый болт, прицел, череп-залп, пробой
  marksman1: '<circle cx="0" cy="0" r="8"/><circle cx="0" cy="0" r="2.5"/><path d="M-13 0 Q0 -9 13 0 Q0 9 -13 0Z"/>',
  marksman2:
    '<path d="M0 -11 V11 M-9.5 -5.5 L9.5 5.5 M9.5 -5.5 L-9.5 5.5"/><path d="M0 -11 l-3 3 M0 -11 l3 3 M0 11 l-3 -3 M0 11 l3 -3"/>',
  marksman3a:
    '<path d="M0 -12 L4 -4 L0 0 L-4 -4 Z" fill="currentColor"/><line x1="0" y1="0" x2="0" y2="12"/><line x1="-3" y1="9" x2="0" y2="12"/><line x1="3" y1="9" x2="0" y2="12"/>',
  marksman3b: '<circle cx="0" cy="0" r="10"/><line x1="0" y1="-13" x2="0" y2="-6"/><line x1="0" y1="6" x2="0" y2="13"/><line x1="-13" y1="0" x2="-6" y2="0"/><line x1="6" y1="0" x2="13" y2="0"/><circle cx="0" cy="0" r="2"/>',
  marksman4: '<path d="M-7 -6 a7 7 0 1 1 14 0 v4 a7 8 0 0 1 -14 0 Z"/><circle cx="-3" cy="-4" r="1.6" fill="currentColor"/><circle cx="3" cy="-4" r="1.6" fill="currentColor"/><path d="M-4 6 l2 4 M0 6 v5 M4 6 l-2 4"/>',
  marksmanCap:
    '<line x1="-13" y1="0" x2="13" y2="0"/><path d="M13 0 l-5 -3 M13 0 l-5 3"/><circle cx="-6" cy="0" r="4"/><circle cx="4" cy="0" r="4"/>',
  // Воин — кулак, кора дуба, берсерк-молнии, доспех, сердце, второе дыхание
  warrior1: '<path d="M-6 -8 h10 a3 3 0 0 1 3 3 v9 a4 4 0 0 1 -4 4 h-8 a3 3 0 0 1 -3 -3 v-3 M-6 -2 h6 M-6 2 h6"/>',
  warrior2: '<path d="M0 -12 C6 -6 7 0 0 12 C-7 0 -6 -6 0 -12 Z"/><line x1="0" y1="-6" x2="0" y2="9"/><line x1="0" y1="-1" x2="4" y2="-4"/><line x1="0" y1="3" x2="-4" y2="0"/>',
  warrior3a: '<path d="M-2 -12 L-7 0 L-1 0 L-4 12 L8 -2 L1 -2 L4 -12 Z" fill="currentColor"/>',
  warrior3b: '<path d="M0 -12 L11 -7 V2 Q11 10 0 13 Q-11 10 -11 2 V-7 Z"/><path d="M-5 -2 L0 2 L5 -2"/><line x1="0" y1="2" x2="0" y2="8"/>',
  warrior4: '<path d="M0 11 C-12 1 -10 -10 -3 -9 C-1 -8.6 0 -7 0 -6 C0 -7 1 -8.6 3 -9 C10 -10 12 1 0 11 Z"/>',
  warriorCap:
    '<circle cx="0" cy="2" r="7"/><path d="M0 -5 V-12 M-3 -9 L0 -12 L3 -9"/><path d="M-9 8 Q-13 4 -10 0 M9 8 Q13 4 10 0"/>',
  // Следопыт — след, нюх зверя, ветер, кошель-монеты, ухо, тропа-компас
  ranger1: '<ellipse cx="0" cy="4" rx="5" ry="7"/><circle cx="-5" cy="-6" r="2"/><circle cx="0" cy="-8" r="2"/><circle cx="5" cy="-6" r="2"/>',
  ranger2: '<path d="M-9 -7 L-5 2 M9 -7 L5 2 M-7 3 Q0 -2 7 3 Q0 12 -7 3 Z"/><circle cx="-3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="4" r="1.2" fill="currentColor"/>',
  ranger3a: '<path d="M-12 -4 Q2 -8 8 -4 a3 3 0 1 1 -3 4 M-12 2 Q4 -2 11 2 a3 3 0 1 1 -3 4"/>',
  ranger3b:
    '<circle cx="0" cy="2" r="9"/><path d="M-4 2 h8 M0 -2 v8" /><path d="M-5 -7 Q0 -10 5 -7"/>',
  ranger4: '<path d="M-4 -9 Q7 -11 7 0 Q7 9 -2 9 M-4 -9 Q-9 -4 -6 4 Q-4 9 -2 9" /><circle cx="0" cy="0" r="2.5"/>',
  rangerCap:
    '<circle cx="0" cy="0" r="11"/><path d="M0 -7 L3 0 L0 7 L-3 0 Z" fill="currentColor"/><line x1="0" y1="-11" x2="0" y2="-13"/><line x1="0" y1="11" x2="0" y2="13"/>',
};

/** Локальная цветовая метка ветви — лёгкий оттенок свечения доступного узла. */
const BRANCH_HUE: Record<PerkBranch, string> = {
  Стрелок: '#7fd0ff',
  Воин: '#ff9a6b',
  Следопыт: '#9be08a',
};

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .perk-overlay {
      position: absolute; inset: 0;
      display: none; align-items: center; justify-content: center;
      background:
        radial-gradient(ellipse 120% 90% at 50% 40%, rgba(8,10,14,0.35) 30%, rgba(5,7,11,0.78) 80%, rgba(2,3,6,0.92) 100%);
      pointer-events: none;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
    }
    .perk-overlay.perk-on { display: flex; }
    .perk-window {
      pointer-events: auto;
      position: relative;
      display: flex; flex-direction: column;
      width: min(94vw, 1180px); max-height: 92vh;
      padding: 22px 26px 18px;
      color: #f0e6cf;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(60,44,22,0.5), rgba(20,14,8,0.82) 70%),
        linear-gradient(180deg, rgba(28,20,12,0.94), rgba(12,9,5,0.96));
      border: 1px solid rgba(196,152,70,0.55);
      border-radius: 12px;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 18px 60px rgba(0,0,0,0.7),
        inset 0 0 70px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,150,0.16);
    }
    .perk-window::before {
      content: ''; position: absolute; inset: 7px;
      border: 1px solid rgba(196,152,70,0.26); border-radius: 8px; pointer-events: none;
    }
    .perk-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 20px; margin-bottom: 6px;
    }
    .perk-title {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: 26px; letter-spacing: 0.14em; margin: 0;
      background: linear-gradient(180deg, #ffe9a8 0%, #f4c75a 50%, #b9821f 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #f4c75a;
    }
    .perk-points {
      font-size: 15px; color: #f4c75a; letter-spacing: 0.04em;
      border: 1px solid rgba(196,152,70,0.5); border-radius: 20px;
      padding: 4px 14px; background: rgba(40,28,12,0.5);
    }
    .perk-points b { color: #ffe9a8; font-weight: 700; }
    /* Полоса опыта */
    .perk-xp {
      position: relative; width: 100%; height: 14px;
      border-radius: 7px; background: rgba(0,0,0,0.45);
      border: 1px solid rgba(196,152,70,0.3);
      margin: 4px 0 8px; overflow: hidden;
    }
    .perk-xp-fill {
      height: 100%; background: linear-gradient(90deg, #b9821f, #f4c75a);
      transition: width 0.3s ease-out; box-shadow: 0 0 8px rgba(244,199,90,0.5);
    }
    .perk-xp-text {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: #f0e6cf; letter-spacing: 0.05em;
      text-shadow: 0 1px 2px rgba(0,0,0,0.9);
    }
    /* Холст графа — вписан по высоте окна (скролл лишь как страховка на узких экранах) */
    .perk-graph-wrap {
      overflow: auto; flex: 1 1 auto;
      display: flex; align-items: center; justify-content: center;
      min-height: 0;
    }
    .perk-graph {
      display: block; height: auto; width: auto;
      max-width: 100%; max-height: 64vh; min-width: 640px;
    }

    /* Подписи ветвей */
    .perk-branch-label {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: 16px; letter-spacing: 0.18em; fill: #c8b58a;
      text-anchor: middle; text-transform: uppercase;
    }
    /* Линии связей */
    .perk-link { stroke: rgba(150,120,70,0.4); stroke-width: 2.5; fill: none; }
    .perk-link.perk-link-on { stroke: rgba(244,199,90,0.85); stroke-width: 3; }

    /* Узлы */
    .perk-node { cursor: default; }
    .perk-node-disc {
      fill: rgba(18,14,9,0.92); stroke: rgba(120,100,60,0.55); stroke-width: 2;
      transition: stroke 0.2s, fill 0.2s;
    }
    .perk-node-icon { fill: none; stroke: #8a8068; stroke-width: 1.7;
      stroke-linecap: round; stroke-linejoin: round; transition: stroke 0.2s; }
    .perk-node-cost {
      font-size: 11px; font-weight: 700; text-anchor: middle;
      fill: #c8b58a; font-family: 'Philosopher', sans-serif;
    }
    .perk-node-name {
      font-size: 11px; text-anchor: middle; fill: #b8ac8d;
      font-family: 'Philosopher', sans-serif; letter-spacing: 0.02em;
    }

    /* Состояние «изучен» — золотая заливка */
    .perk-node.is-unlocked .perk-node-disc {
      fill: rgba(120,86,28,0.92); stroke: #f4c75a; stroke-width: 2.5;
      filter: drop-shadow(0 0 6px rgba(244,199,90,0.5));
    }
    .perk-node.is-unlocked .perk-node-icon { stroke: #ffe9a8; }
    .perk-node.is-unlocked .perk-node-name { fill: #f0e6cf; }

    /* Состояние «доступен» — подсвеченный контур + пульс */
    .perk-node.is-available { cursor: pointer; }
    .perk-node.is-available .perk-node-disc {
      stroke: #f4c75a; stroke-width: 2.5;
      animation: perk-pulse 1.5s ease-in-out infinite;
    }
    .perk-node.is-available .perk-node-icon { stroke: #ffe9a8; }
    .perk-node.is-available .perk-node-name { fill: #f0e6cf; }
    .perk-node.is-available:hover .perk-node-disc { fill: rgba(80,58,22,0.95); }
    @keyframes perk-pulse {
      0%,100% { filter: drop-shadow(0 0 2px rgba(244,199,90,0.35)); }
      50% { filter: drop-shadow(0 0 10px rgba(244,199,90,0.9)); }
    }

    /* Состояние «закрыто» — тускло + замок */
    .perk-node.is-locked, .perk-node.is-noPoints { opacity: 0.5; }
    .perk-node.is-locked .perk-node-disc, .perk-node.is-noPoints .perk-node-disc {
      stroke-dasharray: 4 3;
    }
    .perk-lock { stroke: #8a8068; stroke-width: 1.6; fill: none; }

    /* Карточка-ховер */
    .perk-tip {
      position: absolute; z-index: 5; max-width: 240px;
      padding: 10px 12px; pointer-events: none;
      background: linear-gradient(180deg, rgba(36,26,14,0.98), rgba(18,13,7,0.98));
      border: 1px solid rgba(196,152,70,0.6); border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      opacity: 0; transition: opacity 0.12s; transform: translate(-50%, -100%);
    }
    .perk-tip.perk-tip-on { opacity: 1; }
    .perk-tip-name { font-size: 14px; color: #ffe9a8; margin-bottom: 4px; letter-spacing: 0.03em; }
    .perk-tip-desc { font-size: 12px; color: #d8cdb0; line-height: 1.35; }
    .perk-tip-meta { font-size: 11px; margin-top: 7px; letter-spacing: 0.03em; }
    .perk-tip-cost { color: #f4c75a; }
    .perk-tip-state { color: #c8b58a; }
    .perk-tip-state.s-available { color: #7ac87a; }
    .perk-tip-state.s-unlocked { color: #f4c75a; }
    .perk-tip-state.s-locked, .perk-tip-state.s-noPoints { color: #b08a6a; }

    .perk-hint {
      font-size: 12px; color: #9a8c6a; margin-top: 8px; text-align: center;
      letter-spacing: 0.04em;
    }
  `;
  root.appendChild(style);
}

/** Узел графа — DOM-группа <g> и его данные. */
interface NodeView {
  def: PerkDef;
  group: SVGGElement;
  cx: number;
  cy: number;
}

export class PerkScreen {
  private root: HTMLElement;
  private cb: PerkCallbacks;
  private overlay: HTMLElement | null = null;
  private pointsEl: HTMLElement | null = null;
  private xpFillEl: HTMLElement | null = null;
  private xpTextEl: HTMLElement | null = null;
  private svg: SVGSVGElement | null = null;
  private tip: HTMLElement | null = null;
  /** Узлы по id (refresh меняет классы, не пересоздаёт DOM). */
  private nodes = new Map<PerkId, NodeView>();
  /** Линии связей: ключ — «from→to», значение — элемент линии (для подсветки). */
  private links: { from: PerkId; to: PerkId; el: SVGPathElement }[] = [];
  /** Последний снимок состояний — для подсветки связей и карточки. */
  private lastStates: Record<PerkId, PerkSlotState> | null = null;
  private _visible = false;

  constructor(root: HTMLElement, cb: PerkCallbacks) {
    this.root = root;
    this.cb = cb;
    injectStyles(root);
  }

  get visible(): boolean {
    return this._visible;
  }

  /** Центр X колонки ветви по её индексу. */
  private branchCx(index: number): number {
    return index * COL_W + COL_W / 2;
  }

  /** Координаты центра узла перка в системе viewBox. */
  private nodePos(def: PerkDef): { cx: number; cy: number } {
    const bi = BRANCHES.indexOf(def.branch);
    const baseX = this.branchCx(bi);
    const cy = TIER_Y[def.tier]!;
    // Развилка tier-3: левый узел — id с суффиксом 'a', правый — 'b'.
    if (def.tier === 3) {
      const dx = def.id.endsWith('a') ? -FORK_DX : FORK_DX;
      return { cx: baseX + dx, cy };
    }
    return { cx: baseX, cy };
  }

  private ensureBuilt(): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'perk-overlay';

    const win = document.createElement('div');
    win.className = 'perk-window';

    // Шапка: заголовок + счётчик очков
    const head = document.createElement('div');
    head.className = 'perk-head';
    const title = document.createElement('h2');
    title.className = 'perk-title';
    title.textContent = 'ДЕРЕВО ТАЛАНТОВ';
    const points = document.createElement('div');
    points.className = 'perk-points';
    points.innerHTML = 'Очки: <b>0</b>';
    head.append(title, points);

    // Полоса опыта
    const xp = document.createElement('div');
    xp.className = 'perk-xp';
    const xpFill = document.createElement('div');
    xpFill.className = 'perk-xp-fill';
    xpFill.style.width = '0%';
    const xpText = document.createElement('div');
    xpText.className = 'perk-xp-text';
    xp.append(xpFill, xpText);

    // Граф
    const graphWrap = document.createElement('div');
    graphWrap.className = 'perk-graph-wrap';
    const svg = this.buildGraph();
    graphWrap.appendChild(svg);

    const hint = document.createElement('div');
    hint.className = 'perk-hint';
    hint.textContent = 'Наведи на узел — описание. ЛКМ по доступному (золотой контур) — изучить.';

    // Карточка-ховер (позиционируется внутри окна)
    const tip = document.createElement('div');
    tip.className = 'perk-tip';

    win.append(head, xp, graphWrap, hint, tip);
    overlay.appendChild(win);
    this.root.appendChild(overlay);

    this.overlay = overlay;
    this.pointsEl = points.querySelector('b');
    this.xpFillEl = xpFill;
    this.xpTextEl = xpText;
    this.svg = svg;
    this.tip = tip;
  }

  /** Собрать SVG-граф: подписи ветвей, линии связей, узлы-медальоны. */
  private buildGraph(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'perk-graph');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Подписи ветвей вверху каждой колонки
    BRANCHES.forEach((branch, i) => {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('class', 'perk-branch-label');
      label.setAttribute('x', String(this.branchCx(i)));
      label.setAttribute('y', '20');
      label.textContent = branch;
      svg.appendChild(label);
    });

    // Линии связей (рисуем ПОД узлами): от каждого предтечи к перку.
    for (const def of Object.values(PERKS)) {
      const to = this.nodePos(def);
      for (const reqId of def.requiresAny ?? []) {
        const from = this.nodePos(PERKS[reqId]);
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('class', 'perk-link');
        // Плавная кривая снизу вверх (предтеча ниже зависимого узла).
        const midY = (from.cy + to.cy) / 2;
        path.setAttribute('d', `M ${from.cx} ${from.cy} C ${from.cx} ${midY}, ${to.cx} ${midY}, ${to.cx} ${to.cy}`);
        svg.appendChild(path);
        this.links.push({ from: reqId, to: def.id, el: path });
      }
    }

    // Узлы-медальоны поверх линий
    for (const def of Object.values(PERKS)) {
      const pos = this.nodePos(def);
      const group = this.buildNode(def, pos.cx, pos.cy);
      svg.appendChild(group);
      this.nodes.set(def.id, { def, group, cx: pos.cx, cy: pos.cy });
    }

    return svg;
  }

  /** Один узел: диск + иконка + стоимость + подпись имени; вешает ховер/клик. */
  private buildNode(def: PerkDef, cx: number, cy: number): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'perk-node');
    g.setAttribute('transform', `translate(${cx} ${cy})`);

    const disc = document.createElementNS(SVG_NS, 'circle');
    disc.setAttribute('class', 'perk-node-disc');
    disc.setAttribute('r', String(NODE_R));
    g.appendChild(disc);

    // Иконка перка (внутренний currentColor через stroke на самой группе иконки)
    const icon = document.createElementNS(SVG_NS, 'g');
    icon.setAttribute('class', 'perk-node-icon');
    icon.innerHTML = PERK_ICON[def.id];
    g.appendChild(icon);

    // Стоимость в очках — мелкая бирка у правого нижнего края медальона
    const cost = document.createElementNS(SVG_NS, 'text');
    cost.setAttribute('class', 'perk-node-cost');
    cost.setAttribute('x', String(NODE_R - 2));
    cost.setAttribute('y', String(NODE_R + 1));
    cost.textContent = `${perkCost(def.id)}`;
    g.appendChild(cost);

    // Замок (виден только в закрытом состоянии — через opacity класса)
    const lock = document.createElementNS(SVG_NS, 'g');
    lock.setAttribute('class', 'perk-lock perk-node-lock');
    lock.innerHTML =
      '<rect x="-5" y="0" width="10" height="8" rx="1.5"/><path d="M-3 0 V-2.5 A3 3 0 0 1 3 -2.5 V0"/>';
    lock.style.display = 'none';
    g.appendChild(lock);

    // Подпись имени под медальоном
    const name = document.createElementNS(SVG_NS, 'text');
    name.setAttribute('class', 'perk-node-name');
    name.setAttribute('x', '0');
    name.setAttribute('y', String(NODE_R + 16));
    name.textContent = def.name;
    g.appendChild(name);

    // Ховер — карточка; клик — взять (только если доступен).
    g.addEventListener('mouseenter', () => this.showTip(def, cx, cy));
    g.addEventListener('mouseleave', () => this.hideTip());
    g.addEventListener('click', () => {
      if (g.classList.contains('is-available')) this.cb.onUnlock(def.id);
    });

    return g;
  }

  /** Показать карточку перка над узлом (координаты узла → пиксели внутри окна). */
  private showTip(def: PerkDef, cx: number, cy: number): void {
    if (!this.tip || !this.svg) return;
    const st = this.lastStates?.[def.id] ?? 'locked';
    const cost = perkCost(def.id);
    this.tip.innerHTML =
      `<div class="perk-tip-name">${def.name}</div>` +
      `<div class="perk-tip-desc">${def.desc}</div>` +
      `<div class="perk-tip-meta"><span class="perk-tip-cost">Стоимость: ${cost} ` +
      `${cost === 1 ? 'очко' : cost < 5 ? 'очка' : 'очков'}</span> · ` +
      `<span class="perk-tip-state s-${st}">${STATE_LABEL[st]}</span></div>`;
    // Перевести координаты viewBox узла в пиксели относительно окна.
    const rect = this.svg.getBoundingClientRect();
    const winRect = this.overlay!.querySelector('.perk-window')!.getBoundingClientRect();
    const px = rect.left - winRect.left + (cx / VIEW_W) * rect.width;
    const py = rect.top - winRect.top + (cy / VIEW_H) * rect.height - NODE_R - 6;
    this.tip.style.left = `${px}px`;
    this.tip.style.top = `${py}px`;
    this.tip.classList.add('perk-tip-on');
  }

  private hideTip(): void {
    this.tip?.classList.remove('perk-tip-on');
  }

  /** Перерисовать по снимку состояния (Game считает states/points/xp). */
  refresh(data: PerkRefresh): void {
    this.ensureBuilt();
    this.lastStates = data.states;
    if (this.pointsEl) this.pointsEl.textContent = String(data.points);

    // Полоса опыта: доля до следующего порога. На капе xpNext === xp → полная.
    if (this.xpFillEl && this.xpTextEl) {
      const frac = data.xpNext > 0 ? Math.max(0, Math.min(1, data.xp / data.xpNext)) : 1;
      this.xpFillEl.style.width = `${frac * 100}%`;
      this.xpTextEl.textContent = `Уровень ${data.level} · ${Math.round(data.xp)} / ${Math.round(data.xpNext)} опыта`;
    }

    // Узлы: класс состояния + бранч-оттенок доступного + замок у закрытых.
    for (const [id, view] of this.nodes) {
      const st = data.states[id];
      view.group.classList.remove('is-unlocked', 'is-available', 'is-locked', 'is-noPoints');
      view.group.classList.add(`is-${st}`);
      const lock = view.group.querySelector('.perk-node-lock') as SVGElement | null;
      if (lock) lock.style.display = st === 'locked' || st === 'noPoints' ? '' : 'none';
      // Оттенок свечения доступного узла под цвет ветви.
      const disc = view.group.querySelector('.perk-node-disc') as SVGElement | null;
      if (disc) {
        if (st === 'available') disc.style.stroke = BRANCH_HUE[view.def.branch];
        else disc.style.removeProperty('stroke');
      }
    }

    // Подсветка связей: линия «горит», если оба её конца изучены.
    for (const link of this.links) {
      const on = data.states[link.from] === 'unlocked' && data.states[link.to] === 'unlocked';
      link.el.classList.toggle('perk-link-on', on);
    }
  }

  show(): void {
    this.ensureBuilt();
    if (this._visible) return;
    this._visible = true;
    this.overlay?.classList.add('perk-on');
    this.cb.onShow?.();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.hideTip();
    this.overlay?.classList.remove('perk-on');
    this.cb.onHide?.();
  }

  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }
}
