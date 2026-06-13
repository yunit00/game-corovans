// Экран инвентаря (Фаза 6, волна 6A): оверлей по клавише I.
// Сетка слотов 6×4 + панель экипировки (4 ячейки) + панель статов.
// Чистый DOM поверх #ui, как Hud: инжект стилей один раз, классы inv-*, шрифт
// ui-monospace. НИКАКОГО обращения к Game — только колбэки конструктора и refresh:
// числа статов приходят строками снаружи, инвентарь — готовым Inventory.
//
// Почему так: рендер/боевая математика живут в Game, экран лишь рисует снимок и
// эмитит намерения (экипировать/использовать/выбросить). Pointer lock / паузу
// логики на show/hide ставит интегратор — мы только зовём onShow/onHide.
import type { Inventory, ItemStack } from '../sim/inventory';
import { ITEMS, type ItemKind } from '../data/items';
import { kindIconSvg } from './itemIcons';

/** Колбэки намерений: индексы слотов сумки 0..slots.length-1, key — ячейка экипировки. */
export interface InventoryCallbacks {
  /** ЛКМ по слоту со снаряжением — надеть. */
  onEquip(slotIndex: number): void;
  /** ЛКМ по слоту с зельем — выпить/применить. */
  onUse(slotIndex: number): void;
  /** ПКМ по слоту — выбросить весь стек. */
  onDrop(slotIndex: number): void;
  /** ЛКМ по ячейке экипировки — снять обратно в сумку. */
  onUnequip(key: EquipSlotKey): void;
  /** Кнопка «Перки» в шапке окна — открыть PerkScreen (вешает интегратор). */
  onOpenPerks(): void;
  /** Экран показан/скрыт — интегратор ставит паузу логики и pointer lock. */
  onShow?(): void;
  onHide?(): void;
}

/** Ключи ячеек экипировки = поднабор kind, который носится (1:1 с Inventory.equipment). */
export type EquipSlotKey = 'weapon' | 'ranged' | 'armor' | 'trinket';

const GRID_COLS = 6;
const GRID_ROWS = 4;
/** Сколько слотов рисуем (фиксированная сетка 6×4 из ROADMAP). */
const GRID_SLOTS = GRID_COLS * GRID_ROWS;

/** Подписи ячеек экипировки в порядке отрисовки. */
const EQUIP_SLOTS: readonly { key: EquipSlotKey; label: string }[] = [
  { key: 'weapon', label: 'Оружие' },
  { key: 'ranged', label: 'Арбалет' },
  { key: 'armor', label: 'Броня' },
  { key: 'trinket', label: 'Тринкет' },
];

/** Цвет бейджа по kind; иконка — рисованный SVG из itemIcons (без эмодзи). */
const KIND_STYLE: Record<ItemKind, { color: string }> = {
  weapon: { color: '#c44' },
  ranged: { color: '#48c' },
  armor: { color: '#7a7' },
  trinket: { color: '#b8a' },
  potion: { color: '#5bb' },
  junk: { color: '#996' },
};

/** kind, которые носятся (ЛКМ → onEquip); остальные стекуемые kind пьются (potion → onUse). */
function isEquippable(kind: ItemKind): boolean {
  return kind === 'weapon' || kind === 'ranged' || kind === 'armor' || kind === 'trinket';
}

/** Один раз на документ: чтобы повторное создание экрана не плодило <style>. */
let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .inv-overlay {
      position: absolute; inset: 0;
      display: none; align-items: center; justify-content: center;
      background: rgba(6, 9, 14, 0.55);
      pointer-events: none;
      font: 13px ui-monospace, monospace;
    }
    .inv-overlay.inv-on { display: flex; }
    /* pointer-events: auto только у самого окна — клики мимо панели проходят сквозь */
    .inv-window {
      pointer-events: auto;
      display: flex; gap: 16px;
      background: rgba(10, 14, 20, 0.92);
      border: 1px solid rgba(240, 234, 216, 0.18);
      border-radius: 6px; padding: 16px;
      color: #f0ead8;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
      max-width: 92vw; max-height: 88vh;
    }
    .inv-col { display: flex; flex-direction: column; gap: 10px; }
    .inv-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; margin-bottom: 2px;
    }
    .inv-title { font-size: 15px; letter-spacing: 0.08em; color: #ffd75e; }
    .inv-btn {
      pointer-events: auto;
      background: rgba(255, 215, 94, 0.12);
      border: 1px solid rgba(255, 215, 94, 0.4);
      border-radius: 6px; padding: 5px 10px;
      color: #ffd75e; font: 12px ui-monospace, monospace;
      cursor: pointer;
    }
    .inv-btn:hover { background: rgba(255, 215, 94, 0.22); }
    .inv-grid {
      display: grid;
      grid-template-columns: repeat(${GRID_COLS}, 44px);
      grid-auto-rows: 44px; gap: 6px;
    }
    .inv-slot {
      position: relative;
      border: 1px solid rgba(240, 234, 216, 0.16);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.03);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; user-select: none;
    }
    .inv-slot.inv-empty { cursor: default; }
    .inv-slot:not(.inv-empty):hover { border-color: rgba(255, 215, 94, 0.6); }
    .inv-badge {
      width: 30px; height: 30px; border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      padding: 4px; box-sizing: border-box;
      color: rgba(255, 255, 255, 0.92);
    }
    .inv-count {
      position: absolute; right: 3px; bottom: 2px;
      font-size: 11px; color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    }
    /* Ячейки экипировки крупнее слотов и подписаны */
    .inv-equip { display: flex; flex-direction: column; gap: 8px; }
    .inv-eslot {
      display: flex; align-items: center; gap: 10px;
      border: 1px solid rgba(240, 234, 216, 0.16);
      border-radius: 6px; padding: 6px 8px;
      background: rgba(255, 255, 255, 0.03);
    }
    .inv-eslot.inv-filled { cursor: pointer; }
    .inv-eslot.inv-filled:hover { border-color: rgba(255, 215, 94, 0.6); }
    .inv-elabel { font-size: 11px; color: #9a9486; min-width: 56px; }
    .inv-ename { font-size: 12px; color: #f0ead8; }
    .inv-ename.inv-dim { color: #6a6458; font-style: italic; }
    /* Панель статов */
    .inv-stats {
      border-top: 1px solid rgba(240, 234, 216, 0.12);
      padding-top: 10px; display: flex; flex-direction: column; gap: 4px;
      min-width: 180px;
    }
    .inv-stat { font-size: 12px; color: #cfc9bb; }
    .inv-hint { font-size: 11px; color: #6a6458; margin-top: 6px; }
  `;
  root.appendChild(style);
}

export class InventoryScreen {
  private root: HTMLElement;
  private cb: InventoryCallbacks;
  private overlay: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  /** Кэш ячеек сетки/экипировки, чтобы refresh не пересоздавал DOM каждый кадр. */
  private slotEls: HTMLElement[] = [];
  private equipEls = new Map<EquipSlotKey, HTMLElement>();
  private _visible = false;

  constructor(root: HTMLElement, cb: InventoryCallbacks) {
    this.root = root;
    this.cb = cb;
    injectStyles(root);
  }

  get visible(): boolean {
    return this._visible;
  }

  /** Лениво строим DOM при первом показе — экран может не открыться за весь забег. */
  private ensureBuilt(): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'inv-overlay';

    const win = document.createElement('div');
    win.className = 'inv-window';

    // --- Левая колонка: шапка + сетка ---
    const left = document.createElement('div');
    left.className = 'inv-col';

    const head = document.createElement('div');
    head.className = 'inv-head';
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = 'СУМКА';
    const perksBtn = document.createElement('button');
    perksBtn.className = 'inv-btn';
    perksBtn.textContent = 'Перки [P]';
    perksBtn.addEventListener('click', () => this.cb.onOpenPerks());
    head.append(title, perksBtn);

    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    for (let i = 0; i < GRID_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot inv-empty';
      // ЛКМ — экипировать/использовать (выбор по kind делаем в refresh-данных).
      slot.addEventListener('click', () => this.onSlotClick(i));
      // ПКМ — выбросить; гасим контекстное меню браузера.
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cb.onDrop(i);
      });
      this.slotEls.push(slot);
      grid.appendChild(slot);
    }
    left.append(head, grid);

    // --- Правая колонка: экипировка + статы ---
    const right = document.createElement('div');
    right.className = 'inv-col';

    const equip = document.createElement('div');
    equip.className = 'inv-equip';
    for (const { key, label } of EQUIP_SLOTS) {
      const es = document.createElement('div');
      es.className = 'inv-eslot';
      const lbl = document.createElement('span');
      lbl.className = 'inv-elabel';
      lbl.textContent = label;
      const name = document.createElement('span');
      name.className = 'inv-ename inv-dim';
      name.textContent = '—';
      es.append(lbl, name);
      es.addEventListener('click', () => {
        if (es.classList.contains('inv-filled')) this.cb.onUnequip(key);
      });
      this.equipEls.set(key, es);
      equip.appendChild(es);
    }

    const stats = document.createElement('div');
    stats.className = 'inv-stats';

    const hint = document.createElement('div');
    hint.className = 'inv-hint';
    hint.textContent = 'ЛКМ — надеть/выпить · ПКМ — выбросить';

    right.append(equip, stats, hint);

    win.append(left, right);
    overlay.appendChild(win);
    this.root.appendChild(overlay);

    this.overlay = overlay;
    this.statsEl = stats;
  }

  /** ЛКМ по слоту: ветвим на onEquip/onUse по kind лежащего предмета. */
  private onSlotClick(slotIndex: number): void {
    // Читаем kind из data/items по id, который мы кэшировали в dataset при refresh.
    const el = this.slotEls[slotIndex];
    const id = el?.dataset.itemId;
    if (!id) return;
    const def = ITEMS[id];
    if (!def) return;
    if (isEquippable(def.kind)) this.cb.onEquip(slotIndex);
    else if (def.kind === 'potion') this.cb.onUse(slotIndex);
    // junk: ни надеть, ни выпить — только выбросить ПКМ.
  }

  /**
   * Перерисовать экран по снимку инвентаря и готовым строкам статов.
   * statsText — массив уже отформатированных строк (урон/защита/скорость считает
   * Game через totalStatMods + perkCombatMods, мы их не вычисляем).
   */
  refresh(inv: Inventory, statsText: string[]): void {
    this.ensureBuilt();
    this.renderGrid(inv.slots);
    this.renderEquipment(inv.equipment);
    this.renderStats(statsText);
  }

  private renderGrid(slots: (ItemStack | null)[]): void {
    for (let i = 0; i < this.slotEls.length; i++) {
      const el = this.slotEls[i];
      if (!el) continue;
      // noUncheckedIndexedAccess: за пределами slots трактуем как пустой слот.
      const stack = i < slots.length ? slots[i] ?? null : null;
      this.fillSlot(el, stack);
    }
  }

  private fillSlot(el: HTMLElement, stack: ItemStack | null): void {
    if (!stack) {
      el.className = 'inv-slot inv-empty';
      el.replaceChildren();
      el.removeAttribute('title');
      delete el.dataset.itemId;
      return;
    }
    const def = ITEMS[stack.id];
    const style = def ? KIND_STYLE[def.kind] : KIND_STYLE.junk;
    el.className = 'inv-slot';
    el.dataset.itemId = stack.id;
    el.title = def ? `${def.name} — ${def.desc}` : stack.id;

    const badge = document.createElement('div');
    badge.className = 'inv-badge';
    badge.style.background = style.color;
    badge.innerHTML = kindIconSvg(def ? def.kind : 'junk'); // статичная SVG-строка

    const children: HTMLElement[] = [badge];
    if (stack.count > 1) {
      const count = document.createElement('span');
      count.className = 'inv-count';
      count.textContent = String(stack.count);
      children.push(count);
    }
    el.replaceChildren(...children);
  }

  private renderEquipment(equipment: Inventory['equipment']): void {
    for (const { key } of EQUIP_SLOTS) {
      const el = this.equipEls.get(key);
      if (!el) continue;
      const name = el.querySelector('.inv-ename') as HTMLElement | null;
      if (!name) continue;
      const id = equipment[key];
      const def = id ? ITEMS[id] : undefined;
      if (def) {
        el.classList.add('inv-filled');
        name.classList.remove('inv-dim');
        name.textContent = def.name;
        el.title = `${def.name} — ${def.desc} · ЛКМ снять`;
      } else {
        el.classList.remove('inv-filled');
        name.classList.add('inv-dim');
        name.textContent = '—';
        el.removeAttribute('title');
      }
    }
  }

  private renderStats(statsText: string[]): void {
    if (!this.statsEl) return;
    const rows = statsText.map((line) => {
      const row = document.createElement('div');
      row.className = 'inv-stat';
      row.textContent = line;
      return row;
    });
    this.statsEl.replaceChildren(...rows);
  }

  show(): void {
    this.ensureBuilt();
    if (this._visible) return;
    this._visible = true;
    this.overlay?.classList.add('inv-on');
    this.cb.onShow?.();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.overlay?.classList.remove('inv-on');
    this.cb.onHide?.();
  }

  /** Тоггл по клавише I. */
  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }
}

/**
 * Пояс зелий: 3 ячейки над HP-баром, хоткеи 1/2/3. Микро-класс рядом с
 * инвентарём — интегратор биндит сюда первые 3 стека potion-kind и зовёт
 * flash(index) на нажатие цифры для подсветки. Сам ввод/применение — на Game.
 */
export interface BeltSlot {
  /** id зелья (см. data/items.ts) или null — пустая ячейка. */
  id: string | null;
  count: number;
}

export class BeltBar {
  private cells: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    injectBeltStyles(root);
    const bar = document.createElement('div');
    bar.className = 'belt-bar';
    for (let i = 0; i < 3; i++) {
      const cell = document.createElement('div');
      cell.className = 'belt-cell belt-empty';
      const key = document.createElement('span');
      key.className = 'belt-key';
      key.textContent = String(i + 1);
      const badge = document.createElement('div');
      badge.className = 'belt-badge';
      const count = document.createElement('span');
      count.className = 'belt-count';
      cell.append(key, badge, count);
      this.cells.push(cell);
      bar.appendChild(cell);
    }
    root.appendChild(bar);
  }

  /** Обновить три ячейки пояса по снимку зелий (порядок = клавиши 1/2/3). */
  refresh(slots: BeltSlot[]): void {
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      if (!cell) continue;
      const slot = i < slots.length ? slots[i] : undefined;
      const badge = cell.querySelector('.belt-badge') as HTMLElement | null;
      const count = cell.querySelector('.belt-count') as HTMLElement | null;
      const def = slot?.id ? ITEMS[slot.id] : undefined;
      if (def && slot && slot.count > 0) {
        cell.classList.remove('belt-empty');
        cell.title = `${def.name} — ${def.desc}`;
        if (badge) {
          badge.style.background = KIND_STYLE[def.kind].color;
          badge.innerHTML = kindIconSvg(def.kind); // статичная SVG-строка
        }
        if (count) count.textContent = slot.count > 1 ? String(slot.count) : '';
      } else {
        cell.classList.add('belt-empty');
        cell.removeAttribute('title');
        if (badge) {
          badge.textContent = '';
          badge.style.background = 'transparent';
        }
        if (count) count.textContent = '';
      }
    }
  }

  /** Подсветить нажатую ячейку (index 0..2) короткой вспышкой. */
  flash(index: number): void {
    const cell = this.cells[index];
    if (!cell) return;
    cell.classList.remove('belt-flash');
    // Принудительный reflow, чтобы повторное нажатие перезапустило анимацию.
    void cell.offsetWidth;
    cell.classList.add('belt-flash');
  }
}

let beltStylesInjected = false;

function injectBeltStyles(root: HTMLElement): void {
  if (beltStylesInjected) return;
  beltStylesInjected = true;
  const style = document.createElement('style');
  // Пояс над HP-баром: HP сидит на bottom:16px высотой ~34px → ставим выше.
  style.textContent = `
    .belt-bar {
      position: absolute; left: 16px; bottom: 60px;
      display: flex; gap: 6px;
      pointer-events: none;
    }
    .belt-cell {
      position: relative;
      width: 40px; height: 40px;
      border: 1px solid rgba(240, 234, 216, 0.2);
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.55);
      display: flex; align-items: center; justify-content: center;
      transition: box-shadow 0.15s ease-out, border-color 0.15s ease-out;
    }
    .belt-cell.belt-empty { opacity: 0.5; }
    .belt-key {
      position: absolute; left: 3px; top: 1px;
      font: 10px ui-monospace, monospace; color: #9a9486;
    }
    .belt-badge {
      width: 26px; height: 26px; border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      padding: 3px; box-sizing: border-box;
      color: rgba(255, 255, 255, 0.92);
    }
    .belt-count {
      position: absolute; right: 3px; bottom: 1px;
      font: 11px ui-monospace, monospace; color: #fff;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    }
    .belt-flash {
      border-color: rgba(120, 220, 200, 0.9);
      box-shadow: 0 0 12px rgba(120, 220, 200, 0.6);
      transition: none;
    }
  `;
  root.appendChild(style);
}
