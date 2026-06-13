// Конфиг архетипов подвижных AI-персонажей (Фаза 4). Чистые данные без Three/Rapier.
import type { TintPalette } from '../core/meshUtils';
import type { Team } from '../entities/Character';
import { WEAPONS } from './weapons';

export interface ArchetypeDef {
  id: string;
  /** Файл модели в /assets/characters/. */
  model: string;
  hp: number;
  team: Team;
  weaponId: keyof typeof WEAPONS | string;
  /** Максимальная скорость бега, м/с. */
  speed: number;
  perception: { range: number; fovDeg: number };
  /** Порог бегства по доле HP (0 — никогда не бежит), см. sim/fsm.ts. */
  fleeBelow: number;
  /** Таблица из sim/lootTables.ts; без неё Game дропает фоллбэк-монеты. */
  lootTable?: string;
  xp: number;
  /**
   * Базовая перекраска формы юнита (NpcCharacter поверх неё кладёт детерминированный
   * разброс тона/роста от spawn-id — строй не выглядит клонами). Главное — развести
   * пары на одной модели: guard_soldier и guard_crossbow оба knight.glb, но мечник
   * в «дворцовом» тёплом тоне, а арбалетчик — в тёмно-холодном.
   */
  tint?: TintPalette;
}

export const ARCHETYPES: Record<string, ArchetypeDef> = {
  // Скелеты — массовка набегов: raider быстрый и трусоватый, brute медленный танк.
  skeleton_raider: {
    id: 'skeleton_raider', model: 'skeleton_rogue.glb', hp: 40, team: 'villain',
    weaponId: 'dagger', speed: 3.6, perception: { range: 16, fovDeg: 160 },
    fleeBelow: 0.15, lootTable: 'skeleton_raider', xp: 12,
    tint: { hue: 0.04, sat: 0.12, light: -0.04 }, // лёгкий ржаво-бурый налёт на тряпьё
  },
  skeleton_brute: {
    id: 'skeleton_brute', model: 'skeleton_warrior.glb', hp: 80, team: 'villain',
    weaponId: 'axe_2handed', speed: 2.8, perception: { range: 14, fovDeg: 150 },
    fleeBelow: 0, lootTable: 'skeleton_brute', xp: 20,
    tint: { hue: 0.55, sat: 0.1, light: -0.06 }, // холодный сизый — тяжёлый танк
  },
  // Стража дворца: мечник держит линию, арбалетчик хрупкий, но видит дальше всех.
  // Обе формы — knight.glb, поэтому разводим заметно: мечник в дворцовом тёпло-багряном
  // тоне, арбалетчик-стрелок — в тёмно-сизом (другой род войск, легче брони).
  guard_soldier: {
    id: 'guard_soldier', model: 'knight.glb', hp: 70, team: 'guard',
    weaponId: 'sword_1handed', speed: 3.4, perception: { range: 16, fovDeg: 160 },
    fleeBelow: 0.2, lootTable: 'guard_soldier', xp: 18,
    tint: { hue: -0.04, sat: 0.28, light: 0.04 }, // тёпло-багряный дворцовый
  },
  guard_crossbow: {
    id: 'guard_crossbow', model: 'knight.glb', hp: 50, team: 'guard',
    weaponId: 'crossbow_2handed', speed: 3.2, perception: { range: 24, fovDeg: 160 },
    fleeBelow: 0.35, lootTable: 'guard_crossbow', xp: 16,
    tint: { hue: 0.5, sat: 0.2, light: -0.16 }, // тёмно-сизый стрелок
  },
  // Стража замка злодея (пакет villain-castle): гарнизон труднодоступной цитадели
  // в горах — задел финала. Команда villain (враждебна игроку И деревне). С
  // текущим стартовым уроном игрока (болт ~ваншот рядовых 40-70 hp) рядовой 220 hp
  // и элита 380 hp с одного болта НЕ падают (lethalMaxHp 75 — двойной урон только
  // ≤75 maxHp), а толпа из 10 стражей сознательно почти непобедима до прокачки.
  // Обе формы — knight.glb (как дворцовая стража), разводим тоном: рядовой
  // тёмно-багровый, элита почти чёрная с багровым отливом.
  villain_guard: {
    id: 'villain_guard', model: 'knight.glb', hp: 220, team: 'villain',
    weaponId: 'axe_2handed', speed: 3.5, perception: { range: 22, fovDeg: 170 },
    fleeBelow: 0, lootTable: 'villain_guard', xp: 60,
    tint: { hue: -0.02, sat: 0.5, light: -0.28 }, // тёмно-багровый
  },
  villain_elite: {
    id: 'villain_elite', model: 'knight.glb', hp: 380, team: 'villain',
    weaponId: 'sword_royal', speed: 3.0, perception: { range: 24, fovDeg: 170 },
    fleeBelow: 0, lootTable: 'villain_elite', xp: 120,
    tint: { hue: -0.02, sat: 0.42, light: -0.42 }, // почти чёрный с багровым отливом
  },
  // Наёмный стражник деревни (Фаза 6B): эльф-ополченец с мечом, команда village.
  // Бьёт ТОЛЬКО злодеев (areEnemies village↔villain), игрока и стражу не трогает и
  // от heat игрока не агрится. Крепче дворцовой стражи (нанят защищать дом), не
  // бежит (fleeBelow 0 — стоит до конца). lootTable нет: свой не дропает лут/монеты.
  village_guard: {
    id: 'village_guard', model: 'rogue.glb', hp: 90, team: 'village',
    weaponId: 'sword_1handed', speed: 3.4, perception: { range: 18, fovDeg: 170 },
    fleeBelow: 0, xp: 0,
    tint: { hue: 0.32, sat: 0.34, light: 0.0 }, // зелёный «герб деревни» (rogue делит модель с рыбаком-болотным)
  },
};
