// Мозги простой фауны (Фаза 5.5): автомат проще AISystem. Восприятие раунд-робином,
// FSM из sim/fauna.ts, стиринг из sim/steering.ts. Звери НЕ цели боя (их нет в
// meleeTargets/arrowTargets — стрелы их игнорируют): система только пасёт и пугает.
import type { Rng } from '../core/rng';
import {
  grazeDuration,
  nextFaunaState,
  wanderPoint,
  zigzagFactor,
  FLEE_SPEED,
  SAFE_DIST,
  WANDER_DONE_DIST,
  WANDER_RADIUS,
  type FaunaInputs,
} from '../sim/fauna';
import { roundRobinIndices } from '../sim/perception';
import { arrive, seek, type Steer } from '../sim/steering';
import type { Critter } from '../entities/Critter';

/** Угроза для зверя: всё, у чего есть позиция ног и флаг жизни (игрок, NPC, манекены). */
export interface Threat {
  feet: { x: number; z: number };
  alive: boolean;
}

/** Сколько зверей пересчитывают восприятие за фикс-тик (раунд-робин, как в AISystem). */
const PERCEPTION_BUDGET = 4;
/** Дальше этого от игрока зверь «спит»: мозги/анимация замирают. */
const SLEEP_DIST = 120;
/** Период проверки сна, с — не каждый кадр (как скан манекенов в Game). */
const SLEEP_CHECK_PERIOD = 0.5;
/** Скорость пастьбенного блуждания, м/с. */
const WANDER_SPEED = 1.4;
/** Радиус торможения arrive у точки блуждания, м. Скорость бегства — FLEE_SPEED по виду (sim/fauna). */
const WANDER_SLOW_RADIUS = 2.5;

export class FaunaSystem {
  private tick = 0;
  /** Таймер общей проверки сна (дистанция до игрока). */
  private sleepCheckLeft = 0;
  /** Перк «Звериное чутьё» (Фаза 6): фауна не воспринимает угрозу и не убегает. */
  private calm = false;
  /** Накопленное время симуляции, с — фаза зигзага бегущего зверя (zigzagFactor). */
  private elapsed = 0;

  // Скретчи тика — без аллокаций в горячем пути (стиринг пишет в out-параметры).
  private readonly _rrIdx: number[] = [];
  private readonly _inputs: FaunaInputs = {
    threatDist: Infinity,
    atWanderPoint: false,
    grazeDone: false,
    safe: true,
  };
  private readonly _steer: Steer = { x: 0, z: 0 };
  private readonly _wander = { x: 0, z: 0 };

  constructor(
    private readonly critters: readonly Critter[],
    private readonly rng: Rng,
  ) {}

  get count(): number {
    return this.critters.length;
  }

  /** Включить/выключить спокойствие фауны (перк ranger2 «Звериное чутьё»). */
  setCalm(calm: boolean): void {
    this.calm = calm;
  }

  /**
   * Фикс-шаг всех зверей. player + npcs + skeletons — источники угрозы (бегство);
   * сами думают и двигаются только critters. Спящие (далеко от игрока) пропускаются.
   */
  fixedUpdate(
    stepSec: number,
    player: Threat,
    npcs: readonly Threat[],
    skeletons: readonly Threat[],
  ): void {
    if (this.critters.length === 0) return;
    this.elapsed += stepSec; // фаза зигзага бегущего зверя

    // Сон: дальняя от игрока фауна не тикает. Проверяем не каждый шаг — дистанция
    // меняется плавно, а body.translation() Rapier аллоцирует на вызов.
    this.sleepCheckLeft -= stepSec;
    if (this.sleepCheckLeft <= 0) {
      this.sleepCheckLeft = SLEEP_CHECK_PERIOD;
      const pf = player.feet;
      for (const c of this.critters) {
        const cf = c.feet;
        c.asleep = Math.hypot(cf.x - pf.x, cf.z - pf.z) > SLEEP_DIST;
      }
    }

    // Восприятие раунд-робином: PERCEPTION_BUDGET зверей за тик пересчитывают
    // ближайшую угрозу и пишут её в свой brain; остальные бегут от запомненной.
    const idxs = roundRobinIndices(this.tick++, this.critters.length, PERCEPTION_BUDGET, this._rrIdx);
    for (const i of idxs) {
      const c = this.critters[i]!;
      if (c.asleep || c.dying) continue;
      this.perceive(c, player, npcs, skeletons);
    }

    for (const c of this.critters) {
      if (c.asleep || c.dying) continue; // труп не думает и не двигается
      this.think(stepSec, c);
    }
  }

  /** Пересчёт ближайшей живой угрозы → в память зверя (раунд-робин). */
  private perceive(c: Critter, player: Threat, npcs: readonly Threat[], skeletons: readonly Threat[]): void {
    // Спокойная фауна (перк) не видит угроз — пасётся/бродит как будто одна в лесу.
    if (this.calm) {
      c.brain.threatDist = Infinity;
      return;
    }
    const feet = c.feet;
    const r = this.nearestThreat(feet.x, feet.z, player, npcs, skeletons);
    c.brain.threatX = r.x;
    c.brain.threatZ = r.z;
    c.brain.threatDist = r.dist;
  }

  /** Покадровый визуал фауны (позиция/поворот/клип); спящие сами себя пропускают. */
  update(dt: number): void {
    for (const c of this.critters) c.update(dt);
  }

  /** FSM + стиринг одного зверя по запомненной угрозе (perceive обновил её раунд-робином). */
  private think(stepSec: number, c: Critter): void {
    const brain = c.brain;
    const feet = c.feet; // кэш-вектор — значения копируем сразу
    const px = feet.x;
    const pz = feet.z;

    // Дистанция до угрозы освежается лишь по раунд-робину, но угроза может
    // приблизиться между «своими» тиками. Поэтому к ЗАПОМНЕННОЙ точке угрозы
    // дешёво пересчитываем текущую дистанцию каждый тик: координаты те же,
    // расстояние — актуальное, и пугливый зверь не «проспит» подошедшего игрока.
    const tx = brain.threatX;
    const tz = brain.threatZ;
    const threatDist = brain.threatDist === Infinity ? Infinity : Math.hypot(tx - px, tz - pz);

    const inp = this._inputs;
    inp.threatDist = threatDist;
    inp.atWanderPoint = Math.hypot(brain.wanderX - px, brain.wanderZ - pz) < WANDER_DONE_DIST;
    inp.grazeDone = brain.grazeLeft <= 0;
    inp.safe = threatDist > SAFE_DIST;

    const prev = brain.state;
    brain.state = nextFaunaState(brain.state, inp);

    // Вход в graze (из любого состояния) заводит паузу пастьбы; новая точка
    // блуждания берётся при входе в wander.
    if (brain.state === 'graze') {
      if (prev !== 'graze') brain.grazeLeft = grazeDuration(this.rng);
      else brain.grazeLeft -= stepSec;
    } else if (brain.state === 'wander' && prev !== 'wander') {
      const w = wanderPoint(this.rng, brain.homeX, brain.homeZ, WANDER_RADIUS, this._wander);
      brain.wanderX = w.x;
      brain.wanderZ = w.z;
    }

    // Стиринг по состоянию → желаемая скорость. Сепарацию/объезд не считаем:
    // фауна декоративная, сквозь препятствия и друг друга проходит — дёшево.
    let vx = 0;
    let vz = 0;
    switch (brain.state) {
      case 'graze':
        break; // стоит/ест на месте
      case 'wander': {
        const s = arrive(px, pz, brain.wanderX, brain.wanderZ, WANDER_SPEED, WANDER_SLOW_RADIUS, this._steer);
        vx = s.x;
        vz = s.z;
        break;
      }
      case 'flee': {
        // Перевёрнутый seek: бежим прочь от запомненной угрозы на полном ходу.
        // Скорость по виду: лиса (8.6) быстрее спринта игрока (7.6) — не догнать;
        // олень/вожак (6.0/6.4) догоняемы. При близкой угрозе добавляем боковой
        // зигзаг (perp к направлению бегства) — сбивает прицел, не даёт срезать угол.
        const fleeSpeed = FLEE_SPEED[c.species];
        const s = seek(px, pz, tx, tz, fleeSpeed, this._steer);
        const fx = -s.x; // прочь от угрозы
        const fz = -s.z;
        const zig = zigzagFactor(this.elapsed, threatDist);
        if (zig !== 0) {
          // Перпендикуляр к (fx, fz) в плоскости XZ — поворот на 90°: (−fz, fx).
          vx = fx - fz * zig;
          vz = fz + fx * zig;
        } else {
          vx = fx;
          vz = fz;
        }
        break;
      }
    }
    c.fixedUpdate(stepSec, vx, vz);
  }

  /** Ближайшая живая угроза по XZ: игрок + NPC + манекены. */
  private nearestThreat(
    px: number,
    pz: number,
    player: Threat,
    npcs: readonly Threat[],
    skeletons: readonly Threat[],
  ): { dist: number; x: number; z: number } {
    let bestD2 = Infinity;
    let bx = 0;
    let bz = 0;
    const consider = (t: Threat): void => {
      if (!t.alive) return;
      const tf = t.feet;
      const dx = tf.x - px;
      const dz = tf.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bx = tf.x;
        bz = tf.z;
      }
    };
    consider(player);
    for (const n of npcs) consider(n);
    for (const s of skeletons) consider(s);
    return { dist: Math.sqrt(bestD2), x: bx, z: bz };
  }
}
