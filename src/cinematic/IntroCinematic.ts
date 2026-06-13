// Интро-заставка (Фаза 6C) — рендер-часть. Тонкая обёртка над чистой раскадровкой
// (storyboard.ts): по времени берёт позу камеры и применяет к three-камере (плюс
// высота террейна), рисует DOM-оверлей в стиле пергамента (титры-цитаты из «ТЗ»
// Кирилла), чёрную шторку-кроссфейд и кнопку «Пропустить». Esc/клик — полный скип.
//
// Жизненный цикл: Game строит мир → если заставку ещё не видели, создаёт
// IntroCinematic, прячет HUD, замораживает игровой ввод и КАЖДЫЙ кадр зовёт
// update(dt). Когда заставка кончилась/скипнута — onDone(): Game снимает оверлей,
// возвращает камеру к игроку и отдаёт управление. Вся проверяемая логика (тайминги/
// шторка/титры/флаг localStorage) — в storyboard.ts (node-тесты без WebGL).
//
// Шрифты/палитра — те же, что в меню (Forum/Philosopher, пергамент/золото из
// index.html), новых зависимостей не тянем.

import type * as THREE from 'three';
import {
  curtainOpacity,
  evalCamera,
  markIntroSeen,
  sceneAt,
  SCENES,
  titleOpacity,
  totalDurationSec,
  type IntroStorage,
} from './storyboard';
import type { IntroVoice } from './IntroVoice';

let stylesInjected = false;

function injectStyles(root: HTMLElement): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Полноэкранный слой заставки поверх #ui. Прозрачен в центре (виден облёт мира),
       титры — внизу на полупрозрачном пергаменте; шторка — отдельный чёрный слой. */
    .intro-overlay {
      position: absolute; inset: 0; display: none;
      pointer-events: none; z-index: 70;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      color: #f4e9cf;
    }
    .intro-overlay.intro-on { display: block; }

    /* Чёрная шторка-кроссфейд: opacity ведёт рендер по curtainOpacity (вход сцены /
       финальное затемнение). Лёгкая тёплая тонировка по краям — кинематографичнее. */
    .intro-curtain {
      position: absolute; inset: 0; background: #05060a;
      opacity: 1; pointer-events: none;
      transition: none; /* opacity ставит рендер каждый кадр, CSS-переход не нужен */
    }

    /* Верхняя/нижняя «киношторки» (letterbox) — узкие чёрные полосы для кадра. */
    .intro-bar { position: absolute; left: 0; right: 0; height: 9vh; background: #05060a; }
    .intro-bar-top { top: 0; }
    .intro-bar-bot { bottom: 0; }

    /* Карточка титра — пергамент с золотой каймой, по центру снизу. Рукописный тон
       создаёт курсив Philosopher + лёгкая тень/виньетка (тяжёлый «handwriting»-шрифт
       не тащим — это была бы новая зависимость). */
    .intro-title-wrap {
      position: absolute; left: 0; right: 0; bottom: 13vh;
      display: flex; justify-content: center; padding: 0 6vw;
    }
    .intro-title {
      max-width: min(86vw, 760px);
      padding: 18px 30px;
      text-align: center;
      font-size: clamp(18px, 2.7vw, 30px);
      line-height: 1.5; font-style: italic;
      letter-spacing: 0.01em;
      color: #2a1d0c;
      background:
        radial-gradient(120% 130% at 50% 0%, rgba(247, 233, 200, 0.97), rgba(228, 206, 158, 0.95) 75%),
        linear-gradient(180deg, #f3e6c4, #e6d2a4);
      border: 1px solid rgba(120, 88, 38, 0.6);
      border-radius: 8px;
      box-shadow:
        0 10px 34px rgba(0, 0, 0, 0.55),
        inset 0 0 26px rgba(150, 110, 50, 0.28),
        inset 0 1px 0 rgba(255, 250, 230, 0.7);
      text-shadow: 0 1px 0 rgba(255, 250, 235, 0.5);
      opacity: 0; /* ведёт рендер по titleOpacity */
    }
    /* Декоративная подпись-перо под цитатой Кирилла (тон письма ребёнка). */
    .intro-title::after {
      content: '— из письма Кирилла';
      display: block; margin-top: 8px;
      font-size: 0.62em; font-style: normal;
      letter-spacing: 0.08em; color: rgba(80, 56, 24, 0.75);
    }

    /* Кнопка «Пропустить» — правый нижний угол, гербовый стиль как в меню. */
    .intro-skip {
      position: absolute; right: 22px; bottom: 22px;
      pointer-events: auto; cursor: pointer;
      background: linear-gradient(180deg, rgba(74, 56, 30, 0.7), rgba(40, 28, 14, 0.75));
      border: 1px solid rgba(196, 152, 70, 0.6); border-radius: 5px;
      padding: 9px 16px; color: #f4d98a;
      font-family: 'Philosopher', ui-serif, Georgia, serif;
      font-size: 15px; font-weight: 700; letter-spacing: 0.06em;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
      opacity: 0.85; transition: opacity 0.15s, color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .intro-skip:hover {
      opacity: 1; color: #fff0c4;
      background: linear-gradient(180deg, rgba(110, 84, 42, 0.8), rgba(64, 46, 22, 0.8));
      box-shadow: 0 0 14px rgba(255, 200, 80, 0.35);
    }
    /* Подсказка про Esc — мелко над кнопкой. */
    .intro-skip-hint {
      position: absolute; right: 22px; bottom: 56px;
      font-size: 12px; color: rgba(220, 205, 170, 0.7);
      letter-spacing: 0.04em; pointer-events: none;
    }
  `;
  root.appendChild(style);
}

export interface IntroCallbacks {
  /** Заставка завершена (доиграла ИЛИ скипнута). Game снимает оверлей и стартует игру. */
  onDone(): void;
}

export class IntroCinematic {
  private overlay: HTMLElement;
  private curtainEl: HTMLElement;
  private titleEl: HTMLElement;
  private titleWrap: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  /** Высота террейна в точке — позы раскадровки заданы НАД рельефом. */
  private heightAt: (x: number, z: number) => number;
  private cb: IntroCallbacks;
  private storage: IntroStorage | null;
  /** Закадровый рассказчик (Фаза 6D, озвучка); null — заставка идёт молча. */
  private voice: IntroVoice | null;

  /** Накопленное время заставки, с. */
  private time = 0;
  /** Полный хронометраж (кэш). */
  private readonly total = totalDurationSec(SCENES);
  /** Активна ли заставка (между play и завершением). */
  private active = false;
  /** Индекс показанной сцены — гейт перерисовки текста титра (не каждый кадр). */
  private lastSceneShown = -1;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    root: HTMLElement,
    camera: THREE.PerspectiveCamera,
    heightAt: (x: number, z: number) => number,
    storage: IntroStorage | null,
    cb: IntroCallbacks,
    voice: IntroVoice | null = null,
  ) {
    injectStyles(root);
    this.camera = camera;
    this.heightAt = heightAt;
    this.storage = storage;
    this.cb = cb;
    this.voice = voice;

    const overlay = document.createElement('div');
    overlay.className = 'intro-overlay';

    const curtain = document.createElement('div');
    curtain.className = 'intro-curtain';

    const barTop = document.createElement('div');
    barTop.className = 'intro-bar intro-bar-top';
    const barBot = document.createElement('div');
    barBot.className = 'intro-bar intro-bar-bot';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'intro-title-wrap';
    const title = document.createElement('div');
    title.className = 'intro-title';
    titleWrap.appendChild(title);

    const skipHint = document.createElement('div');
    skipHint.className = 'intro-skip-hint';
    skipHint.textContent = 'Esc — пропустить';

    const skip = document.createElement('button');
    skip.className = 'intro-skip';
    skip.textContent = 'Пропустить ▸';
    skip.addEventListener('click', () => this.skip());

    overlay.append(curtain, barTop, barBot, titleWrap, skipHint, skip);
    root.appendChild(overlay);

    this.overlay = overlay;
    this.curtainEl = curtain;
    this.titleEl = title;
    this.titleWrap = titleWrap;

    // Esc — полный скип. Слушаем на window (pointer lock не нужен — игра ещё не идёт).
    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.active) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.skip();
      }
    };
  }

  /** Идёт ли заставка (Game гейтит игровой ввод/паузу по этому флагу). */
  get playing(): boolean {
    return this.active;
  }

  /** Запустить заставку с нуля. Камеру сразу ставим в стартовую позу первой сцены. */
  play(): void {
    this.active = true;
    this.time = 0;
    this.lastSceneShown = -1;
    this.overlay.classList.add('intro-on');
    window.addEventListener('keydown', this.onKeyDown);
    // Начать скачивать реплики рассказчика заранее (декод — когда ctx оживёт).
    this.voice?.prefetch();
    this.applyCamera(0);
    this.renderOverlay(0);
  }

  /**
   * Шаг заставки: продвинуть время, обновить камеру и оверлей. По достижении
   * конца — finish(). Зовётся каждый кадр из Game.tick, пока playing.
   */
  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    if (this.time >= this.total) {
      // Доиграли: последний кадр (камера в финальной позе, шторка в чёрный) и выход.
      this.applyCamera(this.total);
      this.renderOverlay(this.total);
      this.finish();
      return;
    }
    this.applyCamera(this.time);
    this.renderOverlay(this.time);
  }

  /**
   * Перемотка на момент timeSec (дебаг/скриншоты сцен): кадр применяется сразу,
   * следующий update продолжит с этой точки. К концу не доводим, чтобы не finish().
   */
  seek(timeSec: number): void {
    if (!this.active) return;
    this.time = Math.max(0, Math.min(timeSec, this.total - 0.001));
    this.applyCamera(this.time);
    this.renderOverlay(this.time);
  }

  /** Скип целиком (Esc/клик): мгновенно завершаем заставку. */
  private skip(): void {
    if (!this.active) return;
    this.finish();
  }

  /** Поставить камеру в позу раскадровки на момент timeSec (+высота террейна). */
  private applyCamera(timeSec: number): void {
    const pose = evalCamera(timeSec, SCENES);
    const ey = this.heightAt(pose.eye.x, pose.eye.z) + pose.eye.y;
    const ty = this.heightAt(pose.target.x, pose.target.z) + pose.target.y;
    this.camera.position.set(pose.eye.x, ey, pose.eye.z);
    this.camera.lookAt(pose.target.x, ty, pose.target.z);
  }

  /** Обновить DOM: шторку (opacity), титр (текст по сцене + opacity). */
  private renderOverlay(timeSec: number): void {
    this.curtainEl.style.opacity = curtainOpacity(timeSec, SCENES).toFixed(3);

    const { index } = sceneAt(timeSec, SCENES);
    if (index !== this.lastSceneShown) {
      this.lastSceneShown = index;
      this.titleEl.textContent = SCENES[index]!.title;
      // Смена сцены — заиграть реплику рассказчика этой сцены с начала (тот же гейт
      // ведёт и seek: перемотка → клип сцены с нуля, как в спеке). Нет клипа — молча.
      this.voice?.playScene(SCENES[index]!.id);
    }
    this.titleWrap.style.opacity = titleOpacity(timeSec, SCENES).toFixed(3);
  }

  /** Общий хвост завершения: пометить «видели», снять слушатель, спрятать, onDone. */
  private finish(): void {
    if (!this.active) return;
    this.active = false;
    markIntroSeen(this.storage);
    window.removeEventListener('keydown', this.onKeyDown);
    // Скип/завершение — мгновенно глушим реплику и возвращаем музыку.
    this.voice?.stopAll();
    this.overlay.classList.remove('intro-on');
    this.cb.onDone();
  }

  /** Полностью снять оверлей со страницы (вызывает Game после onDone, если нужно). */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    // Гасим отложенную догрузку/декод реплик после конца заставки.
    this.voice?.dispose();
    this.overlay.remove();
  }
}
