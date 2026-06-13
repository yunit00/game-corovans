// Наёмные стражники деревни (Фаза 6B): эльф-ополченцы (архетип village_guard,
// команда village), нанятые за монеты у доски объявлений. Патрулируют кольцо
// деревни, рубят рейдеров-скелетов (areEnemies village↔villain), игрока и стражу
// дворца НЕ трогают и от его heat не агрятся. Могут пасть в бою — тогда Game
// показывает тикер и убирает их из списка. Живут между сейвами (slot + hp).
//
// Это тонкий менеджер поверх обычных NpcCharacter: спавн идёт через Game.spawnNpc
// (тот же путь, что рейдеры/эскорт), патруль/бой/уборку трупов делает уже готовая
// машинерия (AISystem + Game.updateNpcs). Здесь — только расстановка по слотам
// кольца, восстановление HP из сейва и сбор снимка для сохранения.
import type { NpcCharacter } from '../entities/NpcCharacter';
import { MAX_HIRED_GUARDS, type HiredGuardSave } from '../sim/hiredGuard';
import { VILLAGE } from './WorldData';

/** Радиус патрульного кольца стражников вокруг центра деревни, м. */
const PATROL_RING = 26;

/** Одна запись живого стражника: NPC + его слот патруля. */
interface GuardEntry {
  npc: NpcCharacter;
  slot: number;
}

/**
 * Менеджер наёмных стражников. Не владеет физикой/сценой: NpcCharacter создаёт и
 * убирает Game (через spawnNpc/updateNpcs), здесь — учёт слотов и состояние.
 */
export class HiredGuards {
  private readonly list: GuardEntry[] = [];

  /** Сколько стражников реально живо (павшие убраны из списка в prune). */
  get count(): number {
    return this.list.length;
  }

  /** Занятые слоты патруля (для подбора свободного при новом найме). */
  usedSlots(): number[] {
    return this.list.map((g) => g.slot);
  }

  /**
   * Мировая точка патрульного слота (центр патрульного круга стражника): слоты
   * равномерно разнесены по кольцу деревни, чтобы стражники прикрывали разные
   * стороны. Детерминирована от индекса слота — переживает сейв.
   */
  static slotPos(slot: number): { x: number; z: number } {
    const ang = (slot / MAX_HIRED_GUARDS) * Math.PI * 2;
    return {
      x: VILLAGE.x + Math.cos(ang) * PATROL_RING,
      z: VILLAGE.z + Math.sin(ang) * PATROL_RING,
    };
  }

  /**
   * Привязать только что заспавненного стражника к слоту: его центр патруля —
   * точка слота на кольце (AISystem гоняет idle↔patrol вокруг spawnX/spawnZ).
   * Вызывает Game после Game.spawnNpc('village_guard', ...).
   */
  register(npc: NpcCharacter, slot: number): void {
    const p = HiredGuards.slotPos(slot);
    npc.brain.spawnX = p.x;
    npc.brain.spawnZ = p.z;
    npc.brain.patrolX = p.x;
    npc.brain.patrolZ = p.z;
    this.list.push({ npc, slot });
  }

  /**
   * Убрать павших стражников из списка. Возвращает число павших в этом кадре —
   * Game показывает тикер «Стражник пал…» за каждого. Труп убирает Game.updateNpcs
   * по corpseTimer (как у рейдеров) — здесь лишь снимаем учёт.
   */
  prune(): number {
    let fallen = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i]!.npc.alive) {
        this.list.splice(i, 1);
        fallen++;
      }
    }
    return fallen;
  }

  /** Снимок живых стражников для сейва: слот + текущее HP (павшие уже убраны prune). */
  toSave(): HiredGuardSave[] {
    const out: HiredGuardSave[] = [];
    for (const g of this.list) {
      if (g.npc.alive) out.push({ slot: g.slot, hp: Math.round(g.npc.hp) });
    }
    return out;
  }

  /** Применить HP из сейва к только что заспавненному стражнику (после register). */
  applyHp(npc: NpcCharacter, hp: number): void {
    npc.hp = Math.max(1, Math.min(npc.maxHp, hp));
  }

  /** Сброс учёта (новый забег): сами NPC убирает Game (killAll/dispose отдельно). */
  reset(): void {
    this.list.length = 0;
  }
}
