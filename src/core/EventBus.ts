// Типизированная шина событий — развязывает системы друг от друга.
export interface GameEvents {
  'enemy:died': { id: number; archetype: string; pos: { x: number; y: number; z: number }; xp: number };
  /** NPC впервые увидел врага и пошёл в chase (AISystem; редко, не каждый тик). */
  'npc:aggro': { id: number; archetype: string; pos: { x: number; y: number; z: number } };
  'player:damaged': { hp: number; max: number };
  'player:died': undefined;
  'player:levelup': { level: number };
  'loot:picked': { itemId: string; count: number };
  'raid:incoming': { index: number; seconds: number };
  'raid:started': { index: number };
  /** survived/total — уцелевшие/всего дома деревни (награда за отбитый набег). */
  'raid:ended': { index: number; victory: boolean; survived: number; total: number };
  'caravan:spawned': { tier: string };
  /** Игрок ограбил корован (CaravanDirector); heat — уже после начисления. */
  'caravan:robbed': { tier: string; coins: number; heat: number };
  'house:damaged': { id: string; hp: number; max: number };
  'house:destroyed': { id: string };
  'house:repaired': { id: string };
  'chest:opened': { id: string };
  /** Сайд-квест взят (offered→active) — id квеста (Фаза 6B). */
  'quest:taken': { id: string };
  /** Сайд-квест сдан (ready→done) — id и выданные награды (Фаза 6B). */
  'quest:completed': { id: string; coins: number; xp: number };
}

type Handler<P> = (payload: P) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<unknown>>>();

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    const set = this.handlers.get(key);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus<GameEvents>();
