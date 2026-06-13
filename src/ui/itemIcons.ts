import type { ItemKind } from '../data/items';

/**
 * Рисованные штриховые SVG-иконки типов предметов — вместо эмодзи (запрет
 * игрока, Фаза 6B). Цвет наследуется через currentColor: контейнер задаёт
 * его CSS-свойством color, фон/рамка остаются на контейнере.
 */
const SVG_OPEN =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const PATHS: Record<ItemKind, string> = {
  // Меч остриём вверх: клинок, гарда, рукоять с навершием
  weapon:
    '<path d="M12 2.5 L14 10 L12 12.5 L10 10 Z"/>' +
    '<line x1="8.2" y1="14" x2="15.8" y2="14"/>' +
    '<line x1="12" y1="14" x2="12" y2="19"/>' +
    '<circle cx="12" cy="20.6" r="1.2"/>',
  // Арбалет: дуга, тетива, ложе и болт остриём вверх
  ranged:
    '<path d="M5 8.5 Q12 2.5 19 8.5"/>' +
    '<line x1="5" y1="8.5" x2="19" y2="8.5"/>' +
    '<line x1="12" y1="8.5" x2="12" y2="20"/>' +
    '<path d="M12 3.2 L10.6 6.2 L13.4 6.2 Z" fill="currentColor" stroke="none"/>',
  // Щит с шевроном
  armor:
    '<path d="M12 3 L19 5.5 V12 Q19 17.5 12 21 Q5 17.5 5 12 V5.5 Z"/>' +
    '<path d="M8.5 9.5 L12 12.5 L15.5 9.5"/>',
  // Кольцо с камнем-ромбом
  trinket:
    '<circle cx="12" cy="14.5" r="5.2"/>' +
    '<path d="M12 4 L14.4 6.8 L12 9.6 L9.6 6.8 Z"/>',
  // Колба: горлышко, конус, уровень жидкости
  potion:
    '<line x1="10" y1="3.2" x2="14" y2="3.2"/>' +
    '<path d="M10.8 3.2 V7.5 L6.9 16.8 Q6 19.8 9.2 19.8 H14.8 Q18 19.8 17.1 16.8 L13.2 7.5 V3.2"/>' +
    '<line x1="8.6" y1="13.8" x2="15.4" y2="13.8"/>',
  // Бубенчик: купол, юбка, язычок
  junk:
    '<line x1="12" y1="2.6" x2="12" y2="4"/>' +
    '<path d="M12 4 Q16.8 4 16.8 10.8 Q16.8 14.6 18.8 16.2 H5.2 Q7.2 14.6 7.2 10.8 Q7.2 4 12 4 Z"/>' +
    '<circle cx="12" cy="18.6" r="1.3" fill="currentColor" stroke="none"/>',
};

/** Готовая SVG-разметка иконки типа предмета (вставлять через innerHTML). */
export function kindIconSvg(kind: ItemKind): string {
  return `${SVG_OPEN}${PATHS[kind]}</svg>`;
}

/**
 * Иконки разделов HUD-панели (Фаза 6B волна C): рюкзак (инвентарь), свиток
 * (таланты), карта (мир), прицел (стрельба). Тот же штриховой стиль и
 * currentColor, что у иконок предметов. Ключ — раздел, не ItemKind.
 */
export type HudIconKind = 'backpack' | 'scroll' | 'map' | 'reticle';

const HUD_PATHS: Record<HudIconKind, string> = {
  // Рюкзак: корпус с клапаном, лямки-дуги по бокам, кармашек
  backpack:
    '<path d="M7 8 Q7 4.5 12 4.5 Q17 4.5 17 8 V19 Q17 20 16 20 H8 Q7 20 7 19 Z"/>' +
    '<path d="M9.5 5 Q9.5 2.8 12 2.8 Q14.5 2.8 14.5 5"/>' +
    '<path d="M7 11 H17"/>' +
    '<path d="M10 14 H14 V17 H10 Z"/>',
  // Свиток талантов: пергамент с завитками сверху/снизу и строками текста
  scroll:
    '<path d="M7 6 Q7 4 9 4 H17 Q19 4 19 6 V18 Q19 20 17 20 H8"/>' +
    '<path d="M7 6 Q7 8 5 8 Q7 8 7 6 Z" fill="currentColor" stroke="none"/>' +
    '<path d="M5 8 V18 Q5 20 7 20 Q9 20 9 18 V6"/>' +
    '<path d="M11 9 H16 M11 12 H16 M11 15 H14"/>',
  // Карта: развёрнутый лист со сгибами + извилистая дорога-пунктир
  map:
    '<path d="M3.5 6.5 L9 4.5 L15 6.5 L20.5 4.5 V17.5 L15 19.5 L9 17.5 L3.5 19.5 Z"/>' +
    '<path d="M9 4.5 V17.5 M15 6.5 V19.5"/>' +
    '<path d="M5.5 9 Q9 11 8 14 Q7 16.5 10.5 17.5" stroke-dasharray="1.5 1.6"/>',
  // Прицел арбалета: окружность с засечками-крестом и центральной точкой
  reticle:
    '<circle cx="12" cy="12" r="7.5"/>' +
    '<line x1="12" y1="2.5" x2="12" y2="6"/>' +
    '<line x1="12" y1="18" x2="12" y2="21.5"/>' +
    '<line x1="2.5" y1="12" x2="6" y2="12"/>' +
    '<line x1="18" y1="12" x2="21.5" y2="12"/>' +
    '<circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
};

/** Готовая SVG-разметка иконки раздела HUD (вставлять через innerHTML). */
export function hudIconSvg(kind: HudIconKind): string {
  return `${SVG_OPEN}${HUD_PATHS[kind]}</svg>`;
}
