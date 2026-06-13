// Экран магазина (Фаза 6B): оверлей у торговца на рынке («как в Daggerfall»).
// Две колонки — «Купить» (ассортимент из shop.ts) и «Продать» (предметы сумки).
// Стиль — средневековый пергамент/золото, как MainMenu (шрифты Forum/Philosopher).
// Чистый DOM поверх #ui. НИКАКОГО обращения к Game — только колбэки и refresh со
// снимком (инвентарь + монеты): покупку/продажу/списание считает Game через sim/shop.
import type { Inventory, ItemStack } from '../sim/inventory';
import { ITEMS, type ItemKind } from '../data/items';
import { kindIconSvg } from './itemIcons';
import {
  ARROWS_PACK_ID,
  buyPrice,
  sellPrice,
  isRoyal,
  shopItemName,
  shopItemDesc,
  DEFAULT_SHOP,
  type ShopConfig,
} from '../sim/shop';

export interface ShopCallbacks {
  /** ЛКМ по товару в колонке «Купить» — купить одну штуку. */
  onBuy(id: string): void;
  /** ЛКМ по предмету в колонке «Продать» — продать одну штуку из слота. */
  onSell(slotIndex: number): void;
  /** Экран показан/скрыт — интегратор ставит паузу логики и pointer lock. */
  onShow?(): void;
  onHide?(): void;
}

/** Рисованные SVG-иконки по kind (без эмодзи — запрет игрока). */
function kindIcon(kind: ItemKind | undefined): string {
  return kindIconSvg(kind ?? 'junk');
}

/** Один раз на документ, чтобы повторное создание не плодило <style>. */
let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .shop-overlay {
      position: absolute; inset: 0;
      display: none; align-items: center; justify-content: center;
      background:
        radial-gradient(ellipse 120% 90% at 50% 42%, rgba(8, 10, 14, 0) 35%, rgba(6, 8, 12, 0.6) 80%, rgba(3, 4, 7, 0.88) 100%);
      pointer-events: none;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f0e6cf;
    }
    .shop-overlay.shop-on { display: flex; }
    /* pointer-events: auto только у окна — клики мимо проходят сквозь */
    .shop-window {
      pointer-events: auto;
      position: relative;
      display: flex; flex-direction: column;
      width: min(94vw, 760px); max-height: 88vh;
      padding: 22px 26px 20px;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(60, 44, 22, 0.5), rgba(20, 14, 8, 0.8) 70%),
        linear-gradient(180deg, rgba(28, 20, 12, 0.94), rgba(14, 10, 6, 0.96));
      border: 1px solid rgba(196, 152, 70, 0.55);
      border-radius: 12px;
      box-shadow:
        0 18px 60px rgba(0, 0, 0, 0.7),
        inset 0 0 60px rgba(0, 0, 0, 0.5),
        inset 0 1px 0 rgba(255, 220, 150, 0.16);
    }
    .shop-window::before {
      content: ''; position: absolute; inset: 7px;
      border: 1px solid rgba(196, 152, 70, 0.25);
      border-radius: 8px; pointer-events: none;
    }
    .shop-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 16px; margin-bottom: 4px;
    }
    .shop-title {
      font-family: 'Forum', 'Philosopher', ui-serif, Georgia, serif;
      font-size: 26px; letter-spacing: 0.08em;
      background: linear-gradient(180deg, #ffe9a8 0%, #f4c75a 50%, #b9821f 100%);
      -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent; color: #f4c75a;
    }
    .shop-coins { font-size: 16px; color: #f4d98a; letter-spacing: 0.03em; }
    .shop-coins b { color: #ffe9a8; }
    .shop-close {
      pointer-events: auto;
      position: absolute; top: 12px; right: 14px;
      width: 28px; height: 28px;
      background: rgba(74, 56, 30, 0.5);
      border: 1px solid rgba(196, 152, 70, 0.55);
      border-radius: 5px; color: #f4d98a;
      font: 16px 'Philosopher', serif; cursor: pointer; line-height: 1;
    }
    .shop-close:hover { background: rgba(110, 84, 42, 0.7); color: #fff0c4; }
    .shop-rule {
      height: 1px; margin: 8px 0 12px;
      background: linear-gradient(90deg, transparent, rgba(196, 152, 70, 0.55), transparent);
    }
    .shop-cols { display: flex; gap: 18px; min-height: 0; }
    .shop-col {
      flex: 1 1 0; display: flex; flex-direction: column; gap: 8px; min-width: 0;
    }
    .shop-cap {
      font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase;
      color: #c8a85a; font-weight: 700; padding-bottom: 2px;
    }
    .shop-list {
      display: flex; flex-direction: column; gap: 6px;
      overflow-y: auto; padding-right: 4px;
      max-height: 56vh;
    }
    .shop-list::-webkit-scrollbar { width: 8px; }
    .shop-list::-webkit-scrollbar-thumb {
      background: rgba(196, 152, 70, 0.3); border-radius: 4px;
    }
    .shop-empty { font-size: 13px; color: #8a7c58; font-style: italic; padding: 8px 4px; }
    /* Строка товара: иконка, имя/описание, цена-кнопка */
    .shop-row {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 9px; border-radius: 6px;
      background: linear-gradient(180deg, rgba(74, 56, 30, 0.32), rgba(40, 28, 14, 0.4));
      border: 1px solid rgba(196, 152, 70, 0.28);
      cursor: pointer;
      transition: background 0.15s ease-out, border-color 0.15s ease-out, transform 0.1s ease-out;
    }
    .shop-row:hover:not(.shop-disabled) {
      background: linear-gradient(180deg, rgba(110, 84, 42, 0.5), rgba(64, 46, 22, 0.55));
      border-color: rgba(255, 222, 150, 0.6);
      transform: translateY(-1px);
    }
    .shop-row.shop-disabled { opacity: 0.46; cursor: default; }
    .shop-glyph {
      width: 30px; height: 30px; flex: 0 0 30px;
      display: flex; align-items: center; justify-content: center;
      padding: 4px; box-sizing: border-box; border-radius: 5px;
      color: #d3a85e;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(196, 152, 70, 0.25);
    }
    .shop-info { flex: 1 1 auto; min-width: 0; }
    .shop-name {
      font-size: 14px; color: #f0e6cf;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .shop-name .shop-q { color: #c8a85a; font-size: 12px; }
    .shop-desc {
      font-size: 11px; color: #a89870; line-height: 1.25;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .shop-price {
      flex: 0 0 auto; font-size: 14px; font-weight: 700;
      color: #f4d98a; white-space: nowrap;
    }
    .shop-row.shop-disabled .shop-price { color: #9a8a5a; }
    .shop-hint {
      margin-top: 12px; text-align: center;
      font-size: 12px; color: #8a7c58; letter-spacing: 0.03em;
    }
    .shop-msg {
      min-height: 16px; margin-top: 6px; text-align: center;
      font-size: 12px; color: #e0a35a; letter-spacing: 0.02em;
    }
  `;
  root.appendChild(style);
}

export class ShopScreen {
  private root: HTMLElement;
  private cb: ShopCallbacks;
  private overlay: HTMLElement | null = null;
  private coinsEl: HTMLElement | null = null;
  private buyListEl: HTMLElement | null = null;
  private sellListEl: HTMLElement | null = null;
  private msgEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  /** Текущий боезапас/потолок — для блокировки «Пачки стрел» при полном колчане. */
  private ammo = 0;
  private ammoMax = 99;
  /**
   * Профиль лавки (ассортимент/наценка/заголовок). Деревенская по умолчанию;
   * странствующий торговец задаёт свой через configure перед show.
   */
  private config: ShopConfig = DEFAULT_SHOP;
  private _visible = false;

  constructor(root: HTMLElement, cb: ShopCallbacks) {
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
    overlay.className = 'shop-overlay';

    const win = document.createElement('div');
    win.className = 'shop-window';

    const head = document.createElement('div');
    head.className = 'shop-head';
    const title = document.createElement('div');
    title.className = 'shop-title';
    title.textContent = 'ЛАВКА';
    const coins = document.createElement('div');
    coins.className = 'shop-coins';
    coins.innerHTML = 'Кошелёк: <b>0</b>';
    head.append(title, coins);

    const close = document.createElement('button');
    close.className = 'shop-close';
    close.textContent = '✕';
    close.title = 'Закрыть [Esc]';
    close.addEventListener('click', () => this.hide());

    const rule = document.createElement('div');
    rule.className = 'shop-rule';

    const cols = document.createElement('div');
    cols.className = 'shop-cols';

    // Колонка «Купить»
    const buyCol = document.createElement('div');
    buyCol.className = 'shop-col';
    const buyCap = document.createElement('div');
    buyCap.className = 'shop-cap';
    buyCap.textContent = 'Купить';
    const buyList = document.createElement('div');
    buyList.className = 'shop-list';
    buyCol.append(buyCap, buyList);

    // Колонка «Продать»
    const sellCol = document.createElement('div');
    sellCol.className = 'shop-col';
    const sellCap = document.createElement('div');
    sellCap.className = 'shop-cap';
    sellCap.textContent = 'Продать';
    const sellList = document.createElement('div');
    sellList.className = 'shop-list';
    sellCol.append(sellCap, sellList);

    cols.append(buyCol, sellCol);

    const msg = document.createElement('div');
    msg.className = 'shop-msg';

    const hint = document.createElement('div');
    hint.className = 'shop-hint';
    hint.textContent = 'ЛКМ — купить/продать одну штуку · Esc — выйти';

    win.append(head, close, rule, cols, msg, hint);
    overlay.appendChild(win);
    this.root.appendChild(overlay);

    this.overlay = overlay;
    this.coinsEl = coins;
    this.titleEl = title;
    this.buyListEl = buyList;
    this.sellListEl = sellList;
    this.msgEl = msg;
  }

  /**
   * Задать профиль лавки до показа: деревенская (DEFAULT_SHOP) или странствующий
   * торговец (TRAVELER_SHOP, наценка ×1.25, свой мини-набор). Меняет заголовок и
   * влияет на ассортимент/цены колонки «Купить». Продажа от профиля не зависит.
   */
  configure(config: ShopConfig): void {
    this.ensureBuilt();
    this.config = config;
    if (this.titleEl) this.titleEl.textContent = config.title;
  }

  /** Перерисовать обе колонки по снимку инвентаря/кошелька/боезапаса. */
  refresh(inv: Inventory, coins: number, ammo: number, ammoMax: number): void {
    this.ensureBuilt();
    this.ammo = ammo;
    this.ammoMax = ammoMax;
    if (this.coinsEl) this.coinsEl.innerHTML = `Кошелёк: <b>${coins}</b>`;
    this.renderBuy(coins);
    this.renderSell(inv);
  }

  /** Короткое сообщение под колонками (нет монет / нет места / куплено). */
  setMessage(text: string): void {
    if (this.msgEl) this.msgEl.textContent = text;
  }

  private renderBuy(coins: number): void {
    const list = this.buyListEl;
    if (!list) return;
    const rows: HTMLElement[] = [];
    for (const id of this.config.stock) {
      const price = buyPrice(id, this.config.markup);
      const isArrows = id === ARROWS_PACK_ID;
      const def = isArrows ? undefined : ITEMS[id];
      const glyph = kindIcon(isArrows ? 'ranged' : def?.kind);
      // Блокировка: не хватает монет, или (для стрел) колчан полон.
      const poor = coins < price;
      const ammoFull = isArrows && this.ammo >= this.ammoMax;
      const disabled = poor || ammoFull;
      const row = this.makeRow(
        glyph,
        shopItemName(id),
        shopItemDesc(id),
        `${price}`,
        disabled,
        () => this.cb.onBuy(id),
      );
      rows.push(row);
    }
    list.replaceChildren(...rows);
  }

  private renderSell(inv: Inventory): void {
    const list = this.sellListEl;
    if (!list) return;
    const rows: HTMLElement[] = [];
    for (let i = 0; i < inv.slots.length; i++) {
      const stack = inv.slots[i] ?? null;
      if (!stack) continue;
      const price = sellPrice(stack.id);
      if (price <= 0) continue; // нечего выручить (страховка)
      rows.push(this.makeSellRow(i, stack));
    }
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'shop-empty';
      empty.textContent = 'Сумка пуста — нечего продать.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...rows);
  }

  private makeSellRow(slotIndex: number, stack: ItemStack): HTMLElement {
    const def = ITEMS[stack.id];
    const glyph = kindIcon(def?.kind);
    const name = def?.name ?? stack.id;
    const qty = stack.count > 1 ? ` <span class="shop-q">×${stack.count}</span>` : '';
    const price = sellPrice(stack.id);
    const royal = isRoyal(stack.id) ? ' (трофей)' : '';
    return this.makeRow(
      glyph,
      `${name}${qty}`,
      `${def?.desc ?? ''}${royal}`,
      `+${price}`,
      false,
      () => this.cb.onSell(slotIndex),
      true,
    );
  }

  /** Универсальная строка товара (nameHtml допускает разметку количества). */
  private makeRow(
    glyph: string,
    nameHtml: string,
    desc: string,
    price: string,
    disabled: boolean,
    onClick: () => void,
    nameIsHtml = false,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = disabled ? 'shop-row shop-disabled' : 'shop-row';

    const g = document.createElement('div');
    g.className = 'shop-glyph';
    g.innerHTML = glyph; // SVG-разметка из itemIcons (статичные строки, без пользовательского ввода)

    const info = document.createElement('div');
    info.className = 'shop-info';
    const nm = document.createElement('div');
    nm.className = 'shop-name';
    if (nameIsHtml) nm.innerHTML = nameHtml;
    else nm.textContent = nameHtml;
    const ds = document.createElement('div');
    ds.className = 'shop-desc';
    ds.textContent = desc;
    info.append(nm, ds);

    const pr = document.createElement('div');
    pr.className = 'shop-price';
    pr.textContent = price;

    row.append(g, info, pr);
    if (!disabled) row.addEventListener('click', onClick);
    return row;
  }

  show(): void {
    this.ensureBuilt();
    if (this._visible) return;
    this._visible = true;
    this.setMessage('');
    this.overlay?.classList.add('shop-on');
    this.cb.onShow?.();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.overlay?.classList.remove('shop-on');
    this.cb.onHide?.();
  }
}
