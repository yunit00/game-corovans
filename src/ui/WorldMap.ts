// Карта мира (Фаза 6B волна C): пергаментный оверлей-экран по клавише Tab.
// Местность, дороги, пруды, лес рисуются ОДИН раз в offscreen-canvas из данных
// мира (snapshot, переданный при первом show). Маркеры мест и стрелка игрока —
// отдельный лёгкий слой поверх, перерисовывается, пока карта открыта (стрелка
// крутится по yaw). Чистый DOM + Canvas2D поверх #ui, как Hud/PerkScreen.
// НИКАКОГО обращения к Game — только колбэки onShow/onHide и снимок мира.
//
// Проекция координат — в sim/mapData (чистая, тестируется). Здесь только рисунок.
import type { P2 } from '../sim/geom';
import { MapProjection, playerArrowAngle, type MapMarker, type MapMarkerKind } from '../sim/mapData';

export interface WorldMapCallbacks {
  /** Карта показана/скрыта — интегратор ставит паузу логики и pointer lock. */
  onShow?(): void;
  onHide?(): void;
}

/** Снимок мира для разовой отрисовки подложки карты (передаётся в show). */
export interface WorldSnapshot {
  /** Длина стороны квадрата мира, м (WORLD_SIZE). */
  worldSize: number;
  /** Функция высоты рельефа в точке (terrain.height) — для побережий/гор. */
  height: (x: number, z: number) => number;
  /** Дороги — полилинии (ROADS). */
  roads: readonly (readonly P2[])[];
  /** Пруды — центр и радиус, м. */
  ponds: readonly { x: number; z: number; r: number }[];
  /** Точки деревьев леса (для штриховки плотности). */
  forest: readonly { x: number; z: number }[];
  /** Маркеры мест (деревня/дворец/форт/локации/водопад/POI). */
  markers: readonly MapMarker[];
}

/** Сторона квадратного canvas подложки, px (рисуем один раз в этом разрешении). */
const MAP_RES = 760;

/** Дингбат-символ маркера по типу (без эмодзи — требование игрока). */
const MARKER_GLYPH: Record<MapMarkerKind, string> = {
  village: '⌂', // дом — деревня
  palace: '♛', // корона — дворец
  fort: '⚑', // флаг — форт злодея
  villain_castle: '♜', // ладья — замок злодея в горах
  inn: '⌂',
  forester: '♣', // дерево-трилистник — лесничество
  mill: '✦', // мельница
  sentry: '⚔', // застава
  waterfall: '≈', // волны — водопад
  poi: '◈', // прочие POI
};

/** Цвет маркера по типу (золото/красный для важных, тусклее для второстепенных). */
const MARKER_COLOR: Record<MapMarkerKind, string> = {
  village: '#e8c474',
  palace: '#ffe9a8',
  fort: '#e0584a',
  villain_castle: '#8a1f1f', // тёмно-багровый — замок злодея
  inn: '#c9b485',
  forester: '#9fc08a',
  mill: '#c9b485',
  sentry: '#c9b485',
  waterfall: '#8fc7d8',
  poi: '#bcae8a',
};

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .map-overlay {
      position: absolute; inset: 0;
      display: none; align-items: center; justify-content: center;
      background: rgba(6, 8, 12, 0.6);
      pointer-events: none;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
    }
    .map-overlay.map-on { display: flex; }
    /* Пергаментная рама со скруглёнными углами и золотой каймой. */
    .map-frame {
      position: relative;
      pointer-events: auto;
      width: min(86vmin, 760px); height: min(86vmin, 760px);
      box-sizing: border-box;
      padding: 10px;
      background:
        radial-gradient(120% 100% at 50% 0%, rgba(74, 56, 28, 0.6), rgba(26, 18, 10, 0.92) 75%),
        linear-gradient(180deg, rgba(30, 22, 12, 0.95), rgba(16, 11, 6, 0.97));
      border: 1px solid rgba(196, 152, 70, 0.6);
      border-radius: 10px;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.5),
        0 18px 60px rgba(0, 0, 0, 0.7),
        inset 0 0 60px rgba(0, 0, 0, 0.5);
    }
    /* Внутренняя тонкая золотая рамка-кант. */
    .map-frame::before {
      content: '';
      position: absolute; inset: 5px;
      border: 1px solid rgba(196, 152, 70, 0.3);
      border-radius: 7px;
      pointer-events: none;
    }
    /* Слой подложки (рельеф/дороги/пруды/лес) — рисуется один раз. */
    .map-canvas {
      position: absolute; inset: 10px;
      width: calc(100% - 20px); height: calc(100% - 20px);
      border-radius: 4px;
      image-rendering: auto;
    }
    /* Слой маркеров/игрока поверх подложки — перерисовывается, пока карта открыта. */
    .map-overlay-canvas {
      position: absolute; inset: 10px;
      width: calc(100% - 20px); height: calc(100% - 20px);
      pointer-events: none;
    }
    /* Заголовок-картуш сверху по центру. */
    .map-title {
      position: absolute; left: 50%; top: -14px;
      transform: translateX(-50%);
      padding: 3px 18px;
      background: linear-gradient(180deg, rgba(60, 44, 22, 0.95), rgba(28, 20, 12, 0.96));
      border: 1px solid rgba(196, 152, 70, 0.6);
      border-radius: 5px;
      color: #f4d98a; font-size: 15px; letter-spacing: 0.18em;
      text-transform: uppercase; font-weight: 700;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
      white-space: nowrap;
    }
    /* Подсказка закрытия снизу. */
    .map-hint {
      position: absolute; left: 50%; bottom: -13px;
      transform: translateX(-50%);
      padding: 2px 14px;
      background: rgba(16, 11, 6, 0.92);
      border: 1px solid rgba(196, 152, 70, 0.35);
      border-radius: 4px;
      color: rgba(232, 210, 150, 0.8); font-size: 11px;
      letter-spacing: 0.06em; white-space: nowrap;
    }
  `;
  root.appendChild(style);
}

export class WorldMap {
  private root: HTMLElement;
  private cb: WorldMapCallbacks;
  private overlay: HTMLElement | null = null;
  /** Подложка — рельеф/дороги/пруды/лес, рисуется один раз. */
  private baseCanvas: HTMLCanvasElement | null = null;
  /** Контекст слоя маркеров + игрока поверх подложки. */
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private proj = new MapProjection(1000, MAP_RES);
  private snapshot: WorldSnapshot | null = null;
  /** Подложка уже отрисована для текущего снимка (не перерисовываем зря). */
  private baseDrawn = false;
  private _visible = false;

  constructor(root: HTMLElement, cb: WorldMapCallbacks) {
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
    overlay.className = 'map-overlay';

    const frame = document.createElement('div');
    frame.className = 'map-frame';

    const title = document.createElement('div');
    title.className = 'map-title';
    title.textContent = 'Карта земель';

    const base = document.createElement('canvas');
    base.className = 'map-canvas';
    base.width = MAP_RES;
    base.height = MAP_RES;

    const over = document.createElement('canvas');
    over.className = 'map-overlay-canvas';
    over.width = MAP_RES;
    over.height = MAP_RES;

    const hint = document.createElement('div');
    hint.className = 'map-hint';
    hint.textContent = 'Tab или Esc — закрыть';

    frame.append(base, over, title, hint);
    overlay.appendChild(frame);
    this.root.appendChild(overlay);

    this.overlay = overlay;
    this.baseCanvas = base;
    this.overlayCtx = over.getContext('2d');
  }

  /**
   * Показать карту. snapshot — данные мира для разовой отрисовки подложки (если
   * меняется seed — передать новый, подложка перерисуется). yaw — текущий поворот
   * камеры для стрелки игрока. playerX/playerZ — позиция игрока (мир).
   */
  show(snapshot: WorldSnapshot, playerX: number, playerZ: number, yaw: number): void {
    this.ensureBuilt();
    // Сменился снимок (другой seed/размер) — пометим подложку к перерисовке.
    if (snapshot !== this.snapshot) {
      this.snapshot = snapshot;
      this.proj = new MapProjection(snapshot.worldSize, MAP_RES);
      this.baseDrawn = false;
    }
    if (!this.baseDrawn) {
      this.drawBase();
      this.baseDrawn = true;
    }
    this.drawOverlay(playerX, playerZ, yaw);
    if (this._visible) return;
    this._visible = true;
    this.overlay?.classList.add('map-on');
    this.cb.onShow?.();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.overlay?.classList.remove('map-on');
    this.cb.onHide?.();
  }

  /** Обновить положение/стрелку игрока (зовётся каждый кадр, пока карта открыта). */
  updatePlayer(playerX: number, playerZ: number, yaw: number): void {
    if (!this._visible) return;
    this.drawOverlay(playerX, playerZ, yaw);
  }

  // ---- Отрисовка подложки (один раз) ----

  private drawBase(): void {
    const snap = this.snapshot;
    const ctx = this.baseCanvas?.getContext('2d');
    if (!snap || !ctx) return;
    const N = MAP_RES;

    // 1) Рельеф сеткой: суша песочно-пергаментная, побережья/моря и горное кольцо —
    //    тёмным. Сэмплируем height по грубой сетке STEP×STEP, заливаем клетки.
    const STEP = 5; // px клетки (152×152 сэмплов при 760) — дёшево и достаточно
    const half = snap.worldSize / 2;
    for (let py = 0; py < N; py += STEP) {
      for (let px = 0; px < N; px += STEP) {
        // Центр клетки → координаты мира (обратная проекция).
        const wx = (px + STEP / 2) / this.proj.scale - half;
        const wz = (py + STEP / 2) / this.proj.scale - half;
        const h = snap.height(wx, wz);
        ctx.fillStyle = terrainColor(h);
        ctx.fillRect(px, py, STEP, STEP);
      }
    }

    // 2) Лес — лёгкая штриховка: полупрозрачные тёмно-зелёные точки по деревьям.
    //    Грубо (по выборке), плотность сама проступит скоплениями точек.
    ctx.fillStyle = 'rgba(40, 70, 36, 0.22)';
    const stride = Math.max(1, Math.floor(snap.forest.length / 2200)); // ≤ ~2200 точек
    for (let i = 0; i < snap.forest.length; i += stride) {
      const t = snap.forest[i]!;
      const p = this.proj.project(t.x, t.z);
      ctx.fillRect(p.px - 1, p.py - 1, 2, 2);
    }

    // 3) Пруды — кружки с лёгким контуром (голубая гладь).
    for (const pond of snap.ponds) {
      const c = this.proj.project(pond.x, pond.z);
      const r = Math.max(2, this.proj.lengthToPx(pond.r));
      ctx.beginPath();
      ctx.arc(c.px, c.py, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(70, 120, 145, 0.85)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(140, 195, 210, 0.7)';
      ctx.stroke();
    }

    // 4) Дороги — полилинии тёмно-коричневым (грунт тракта).
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(96, 70, 38, 0.9)';
    ctx.lineWidth = 3;
    for (const road of snap.roads) {
      const pts = this.proj.projectPolyline(road);
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.px, pts[0]!.py);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.px, pts[i]!.py);
      ctx.stroke();
    }

    // 5) Виньетка по краям подложки — мягко затемняет к рамке.
    const vg = ctx.createRadialGradient(N / 2, N / 2, N * 0.32, N / 2, N / 2, N * 0.62);
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, 'rgba(20, 12, 4, 0.45)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, N, N);
  }

  // ---- Отрисовка маркеров + игрока (каждый кадр при открытой карте) ----

  private drawOverlay(playerX: number, playerZ: number, yaw: number): void {
    const snap = this.snapshot;
    const ctx = this.overlayCtx;
    if (!snap || !ctx) return;
    const N = MAP_RES;
    ctx.clearRect(0, 0, N, N);

    // Роза ветров в верхнем-левом углу: N/S/E/W вокруг кружка.
    this.drawCompass(ctx, 44, 44, 22);

    // Маркеры мест: дингбат + подпись мелким шрифтом.
    ctx.textAlign = 'center';
    for (const m of snap.markers) {
      const p = this.proj.project(m.x, m.z);
      const color = MARKER_COLOR[m.kind];
      const glyph = MARKER_GLYPH[m.kind];
      // Точка-якорь под глифом.
      ctx.beginPath();
      ctx.arc(p.px, p.py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      // Глиф маркера (с тёмной обводкой для читаемости на любом фоне).
      ctx.font = '700 16px ui-serif, Georgia, serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8, 6, 3, 0.9)';
      ctx.fillStyle = color;
      ctx.textBaseline = 'bottom';
      ctx.strokeText(glyph, p.px, p.py - 3);
      ctx.fillText(glyph, p.px, p.py - 3);
      // Подпись под маркером.
      ctx.font = '11px Philosopher, ui-serif, Georgia, serif';
      ctx.lineWidth = 2.5;
      ctx.textBaseline = 'top';
      ctx.strokeStyle = 'rgba(8, 6, 3, 0.85)';
      ctx.fillStyle = 'rgba(244, 232, 200, 0.92)';
      ctx.strokeText(m.label, p.px, p.py + 5);
      ctx.fillText(m.label, p.px, p.py + 5);
    }

    // Стрелка игрока: красно-золотой треугольник, повёрнут по yaw камеры.
    const pp = this.proj.project(playerX, playerZ);
    const ang = playerArrowAngle(yaw);
    ctx.save();
    ctx.translate(pp.px, pp.py);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -10); // остриё вверх (в покое — на север)
    ctx.lineTo(7, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#f04438';
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Роза ветров: кружок с буквами сторон света. */
  private drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20, 14, 8, 0.6)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(196, 152, 70, 0.6)';
    ctx.stroke();
    // Стрелка «север» — на верх (к −Z), красная.
    ctx.beginPath();
    ctx.moveTo(cx, cy - r + 3);
    ctx.lineTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.closePath();
    ctx.fillStyle = '#d9624f';
    ctx.fill();
    // Буквы сторон света.
    ctx.font = '700 10px ui-serif, Georgia, serif';
    ctx.fillStyle = '#f4d98a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('С', cx, cy - r + 6);
    ctx.fillText('Ю', cx, cy + r - 6);
    ctx.fillText('В', cx + r - 6, cy);
    ctx.fillText('З', cx - r + 6, cy);
  }
}

/**
 * Цвет клетки рельефа по высоте: вода/побережье — синее, низины — болотистый
 * пергамент, холмы — песочный, горы — серо-коричневый камень. Подобрано под
 * палитру меню (тёплый пергамент + золото).
 */
function terrainColor(h: number): string {
  if (h < -0.5) return '#2c4a58'; // глубокая вода/низина-болото
  if (h < 0.6) return '#caa86a'; // равнина (пергамент)
  if (h < 4) return '#bd9a58'; // лёгкие холмы
  if (h < 14) return '#9c7c46'; // предгорья
  if (h < 40) return '#7a6038'; // склоны
  return '#5b4a30'; // горное кольцо (тёмный камень)
}
