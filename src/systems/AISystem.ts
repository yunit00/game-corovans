// Мозги подвижных NPC (Фаза 4): восприятие раунд-робином, FSM из sim/fsm.ts,
// стиринг из sim/steering.ts, атаки по образцу CombatSystem/RangedAttack.
// Вся «грязная» работа с Three/Rapier здесь; чистая математика — в src/sim/.
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { bus } from '../core/EventBus';
import { ALL_GROUPS, GROUP_STATIC, groups, type PhysicsWorld } from '../core/PhysicsWorld';
import { pick, randRange, type Rng } from '../core/rng';
import { computeHit } from '../sim/damage';
import { nextState, type AiInputs } from '../sim/fsm';
import { selectMeleeTargets, type MeleeTarget } from '../sim/melee';
import { inPerceptionCone, roundRobinIndices } from '../sim/perception';
import {
  arrive,
  arriveStop,
  attackSlotAngle,
  attackStandoff,
  avoidObstacles,
  combineSteering,
  seek,
  separation,
  type Steer,
} from '../sim/steering';
import { areEnemies, CAPSULE_RADIUS } from '../entities/Character';
import type { NpcCharacter, NpcTarget } from '../entities/NpcCharacter';
import type { ProjectileSystem } from './ProjectileSystem';

/** Сколько NPC проверяют восприятие за один фикс-тик (раунд-робин). */
const PERCEPTION_BUDGET = 4;
/** Цель забывается, если ушла дальше range * этого фактора. */
const FORGET_FACTOR = 1.5;
/** Дальность атаки арбалетчика, м (у милишки — weapon.range). */
const RANGED_RANGE = 18;
/** Высота груди над ногами — откуда и куда летят стрелы NPC. */
const SHOT_HEIGHT = 1.25;
/** Дисперсия выстрела NPC, ± градусов по yaw и pitch. */
const DISPERSION_DEG = 2;
/** Радиус патруля вокруг точки спавна, м. */
const PATROL_RADIUS = 10;
/** Точка патруля считается достигнутой ближе этого, м. */
const PATROL_DONE_DIST = 1.2;
/** Радиус торможения arrive у точки патруля, м. */
const PATROL_SLOW_RADIUS = 2.5;
/** Пауза в idle между точками патруля, с. */
const WAIT_MIN = 2;
const WAIT_MAX = 4;
/** separation: радиус и потолок отталкивания (м, м/с). */
const SEP_RADIUS = 1.6;
const SEP_MAX_PUSH = 2.5;
/**
 * В бою отталкивание сильнее и шире: иначе атакующие слипаются в кучу у цели,
 * стоя вплотную друг к другу (визуально «толпа в одной точке»). Кольцевые слоты
 * (attackStandoff) разводят их по направлениям, separation держит дистанцию.
 */
const SEP_RADIUS_ATTACK = 2.0;
const SEP_MAX_PUSH_ATTACK = 4.0;
/** Доля attackRange, на которой атакующий встаёт у цели (чуть ближе края — чтобы доставал ударом). */
const STANDOFF_FRAC = 0.8;
/** Радиус торможения arrive у точки стояния в бою, м (мягко подходит, не перелетает слот). */
const ATTACK_SLOW_RADIUS = 1.2;
/**
 * Зазор между капсулами в chase: NPC останавливается, когда центр его капсулы
 * отстоит от центра цели на (radius_NPC + radius_цели + gap). Игрок-KCC теперь
 * не выталкивает кинематические капсулы NPC (EXCLUDE_KINEMATIC), так что не лезть
 * телом в игрока должен сам стиринг — arriveStop тормозит у этой дистанции.
 */
const CHASE_BODY_GAP = 0.1;
const CHASE_STOP_DIST = CAPSULE_RADIUS * 2 + CHASE_BODY_GAP;
/** Радиус торможения arrive у стоп-кольца в chase, м. */
const CHASE_SLOW_RADIUS = 0.8;
/** Дальность «усов» объезда препятствий, м. */
const AVOID_LOOKAHEAD = 3.5;
/** Высота лучей объезда над ногами: выше камней-мелочи, ниже крон. */
const RAY_HEIGHT = 0.9;
/** Лучи объезда видят только статику (деревья, дома) — не друг друга. */
const RAY_GROUPS = groups(ALL_GROUPS, GROUP_STATIC);

// Скретч-векторы спавна стрелы — без аллокаций на выстрел
const _shotOrigin = new THREE.Vector3();
const _shotDir = new THREE.Vector3();

export class AISystem {
  private tick = 0;

  // Скретчи тика: массивы и объекты переиспользуются — в горячем пути фикс-цикла
  // нет new (стиринг и раунд-робин пишут в out-параметры). Редкое исключение —
  // момент удара: selectMeleeTargets возвращает свежий массив раз в кулдаун атаки.
  private readonly _targets: NpcTarget[] = [];
  /** _targets + дома: дома — цели только злодеев (стража с деревней не воюет). */
  private readonly _villainTargets: NpcTarget[] = [];
  private readonly _inputs: AiInputs = {
    hasTarget: false,
    distToTarget: Infinity,
    attackRange: 2,
    hpFrac: 1,
    fleeBelow: 0,
    patrolDone: false,
  };
  /** Пул соседей для separation: pool только растёт, view режется по length. */
  private readonly _neighborPool: { x: number; z: number }[] = [];
  private readonly _neighbors: { x: number; z: number }[] = [];
  /** Пул точек-кандидатов милишного удара + параллельный список целей. */
  private readonly _pointPool: MeleeTarget[] = [];
  private readonly _points: MeleeTarget[] = [];
  private readonly _strikeCands: NpcTarget[] = [];
  /** Индексы раунд-робина восприятия — скретч для roundRobinIndices. */
  private readonly _rrIdx: number[] = [];
  /**
   * Слагаемые combineSteering для движения (patrol/chase/flee):
   * [0] базовое желание (seek/arrive), [1] separation, [2] avoid.
   * Стиринг-функции пишут прямо в эти s — объекты живут всю сессию.
   */
  private readonly _parts: { s: Steer; w: number }[] = [
    { s: { x: 0, z: 0 }, w: 1 },
    { s: { x: 0, z: 0 }, w: 1.2 },
    { s: { x: 0, z: 0 }, w: 1.6 },
  ];
  /** Результат combineSteering — отдельный скретч, не алиасит _parts. */
  private readonly _combined: Steer = { x: 0, z: 0 };
  /** Точка-слот вокруг цели в attack-состоянии (скретч под attackStandoff). */
  private readonly _slot: Steer = { x: 0, z: 0 };
  // Контекст стабильного замыкания _castRay (avoidObstacles зовёт его трижды)
  private readonly _rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly _rayDir = { x: 0, y: 0, z: 0 };
  private _rayExclude: RAPIER_NS.Collider | undefined;
  private readonly _castRay = (
    ox: number,
    oz: number,
    dx: number,
    dz: number,
    maxDist: number,
  ): number | null => {
    this._rayOrigin.x = ox;
    this._rayOrigin.z = oz;
    this._rayDir.x = dx;
    this._rayDir.z = dz;
    return this.physics.raycast(this._rayOrigin, this._rayDir, maxDist, this._rayExclude, RAY_GROUPS);
  };

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly projectiles: ProjectileSystem,
    private readonly rng: Rng,
  ) {}

  /**
   * Фикс-шаг всех мозгов. player, dummies и houses — потенциальные цели наравне
   * с npcs; сами думают и двигаются только npcs. Дома видят только злодеи
   * (areEnemies('villain','elf') — цель набега), стража их игнорирует.
   */
  fixedUpdate(
    stepSec: number,
    player: NpcTarget,
    npcs: readonly NpcCharacter[],
    dummies: readonly NpcTarget[],
    houses: readonly NpcTarget[] = [],
  ): void {
    if (npcs.length === 0) return;

    // Общий список целей тика (length=0 + push — массив переиспользуется)
    this._targets.length = 0;
    this._targets.push(player);
    for (const n of npcs) this._targets.push(n);
    for (const d of dummies) this._targets.push(d);
    this._villainTargets.length = 0;
    for (const t of this._targets) this._villainTargets.push(t);
    for (const h of houses) this._villainTargets.push(h);

    this.perceive(npcs);

    for (const npc of npcs) {
      if (!npc.alive) continue;
      this.think(stepSec, npc, npcs);
    }
  }

  /** Список целей тика для конкретного NPC: злодеям дополнительно «видны» дома. */
  private targetsFor(npc: NpcCharacter): readonly NpcTarget[] {
    return npc.team === 'villain' ? this._villainTargets : this._targets;
  }

  /** Восприятие раунд-робином: PERCEPTION_BUDGET NPC за тик ищут ближайшего врага в конусе. */
  private perceive(npcs: readonly NpcCharacter[]): void {
    const idxs = roundRobinIndices(this.tick++, npcs.length, PERCEPTION_BUDGET, this._rrIdx);
    for (const i of idxs) {
      const npc = npcs[i]!;
      if (!npc.alive) continue;
      const feet = npc.feet;
      const px = feet.x;
      const pz = feet.z;
      let best: NpcTarget | null = null;
      let bestD2 = Infinity;
      for (const t of this.targetsFor(npc)) {
        if ((t as unknown) === npc || !t.alive || !areEnemies(npc.team, t.team)) continue;
        const tf = t.feet;
        const dx = tf.x - px;
        const dz = tf.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= bestD2) continue;
        const r = t.targetRadius ?? 0;
        if (r > 0) {
          // Большая цель (дом): конус не нужен — мимо дома «взглядом не промахнёшься»,
          // дистанция считается до стены, иначе с патрульного круга дома не видно
          if (Math.sqrt(d2) - r > npc.def.perception.range) continue;
        } else if (!inPerceptionCone(px, pz, npc.yaw, npc.def.perception, tf.x, tf.z)) {
          continue;
        }
        best = t;
        bestD2 = d2;
      }
      // Новая цель только если нашлась: пустой скан память не стирает —
      // забывание решается дистанцией/смертью в think()
      if (best) npc.brain.target = best;
    }
  }

  /** FSM + стиринг + атака одного NPC. */
  private think(stepSec: number, npc: NpcCharacter, npcs: readonly NpcCharacter[]): void {
    const brain = npc.brain;
    brain.cooldownLeft = Math.max(0, brain.cooldownLeft - stepSec);

    // Начатый замах/выстрел доводим до конца в любом состоянии — как pendingHits
    // у игрока: анимация уже идёт, отменять её на смене состояния странно выглядит
    if (brain.pendingT >= 0) {
      brain.pendingT -= stepSec;
      if (brain.pendingT < 0) this.executeAttack(npc);
    }

    const feet = npc.feet; // кэш-вектор: значения копируем сразу
    const px = feet.x;
    const py = feet.y;
    const pz = feet.z;

    // Рабочая память: цель умерла или ушла слишком далеко — забываем
    let tx = 0;
    let tz = 0;
    let distToTarget = Infinity;
    if (brain.target) {
      if (!brain.target.alive) {
        brain.target = null;
      } else {
        const tf = brain.target.feet;
        tx = tf.x;
        tz = tf.z;
        // Минус радиус «тела»: к большой цели (дом) attackRange меряется до стены —
        // до центра милишке не дотянуться никогда, и рейдер кружил бы вечно
        distToTarget = Math.hypot(tx - px, tz - pz) - (brain.target.targetRadius ?? 0);
        if (distToTarget > npc.def.perception.range * FORGET_FACTOR) {
          brain.target = null;
          distToTarget = Infinity;
        }
      }
    }

    const weapon = npc.weapon;
    const attackRange = weapon.kind === 'ranged' ? RANGED_RANGE : (weapon.range ?? 2);

    const inp = this._inputs;
    inp.hasTarget = brain.target !== null;
    inp.distToTarget = distToTarget;
    inp.attackRange = attackRange;
    inp.hpFrac = npc.hp / npc.maxHp;
    inp.fleeBelow = npc.def.fleeBelow;
    inp.patrolDone = false; // чередование idle ↔ patrol FSM отдаёт нам (см. ниже)
    const prevState = brain.state;
    brain.state = nextState(brain.state, inp);

    // idle ↔ patrol: дошли до точки — стоим 2–4 с, отстояли — новая точка
    // в круге PATROL_RADIUS вокруг спавна (sqrt — равномерно по площади)
    if (brain.state === 'patrol') {
      if (Math.hypot(brain.patrolX - px, brain.patrolZ - pz) < PATROL_DONE_DIST) {
        brain.state = 'idle';
        brain.waitLeft = randRange(this.rng, WAIT_MIN, WAIT_MAX);
      }
    } else if (brain.state === 'idle') {
      brain.waitLeft -= stepSec;
      if (brain.waitLeft <= 0) {
        const ang = this.rng() * Math.PI * 2;
        const r = Math.sqrt(this.rng()) * PATROL_RADIUS;
        brain.patrolX = brain.spawnX + Math.sin(ang) * r;
        brain.patrolZ = brain.spawnZ + Math.cos(ang) * r;
        brain.state = 'patrol';
      }
    }

    // Возглас агро — только свежий захват цели (мирное состояние → chase),
    // не каждый тик и не дёрганье chase↔attack на границе дальности. Слушает
    // AudioEngine (бурчание «заметил врага»); аллокация payload — раз на агро.
    if (brain.state === 'chase' && (prevState === 'idle' || prevState === 'patrol')) {
      bus.emit('npc:aggro', { id: npc.id, archetype: npc.def.id, pos: { x: px, y: py, z: pz } });
    }

    // Стиринг по состоянию → желаемая скорость. Во всех движущихся состояниях
    // (patrol/chase/flee) к базовому желанию добавляются separation и объезд
    // статики: тело NPC кинематическое, и без «усов» рейдеры шли бы сквозь
    // деревья и стены — весь марш волны к деревне проходит именно в patrol.
    // Бюджет лучей не растёт: avoidObstacles кастует ≤3 луча и только у движущихся.
    let vx = 0;
    let vz = 0;
    switch (brain.state) {
      case 'idle':
        break;
      case 'patrol': {
        arrive(px, pz, brain.patrolX, brain.patrolZ, npc.def.speed, PATROL_SLOW_RADIUS, this._parts[0]!.s);
        const c = this.steerMove(npc, npcs, px, py, pz, SEP_RADIUS, SEP_MAX_PUSH);
        vx = c.x;
        vz = c.z;
        break;
      }
      case 'chase': {
        // arriveStop вместо seek: NPC идёт к телу цели и тормозит на стоп-кольце
        // (сумма радиусов капсул + зазор), а не лезет капсулой в центр игрока.
        // Для большой цели (дом) добавляем её radius — стоп у стены. Игрок-KCC
        // теперь кинематику не выталкивает, поэтому непроход держит этот стоп.
        const tr = brain.target?.targetRadius ?? 0;
        arriveStop(
          px, pz, tx, tz, npc.def.speed,
          CHASE_STOP_DIST + tr, CHASE_SLOW_RADIUS, this._parts[0]!.s,
        );
        const c = this.steerMove(npc, npcs, px, py, pz, SEP_RADIUS, SEP_MAX_PUSH);
        vx = c.x;
        vz = c.z;
        break;
      }
      case 'attack': {
        // Лицом — всегда к цели, чтобы сектор удара/выстрела смотрел на врага.
        npc.face(tx, tz);
        // Милишники распределяются по кольцу вокруг цели: свой угол-слот по id
        // (золотой угол), standoff — чуть внутри дальности удара (+ радиус большой
        // цели вроде дома). arrive к точке слота (тормозит у неё, не топчется сквозь
        // цель) + усиленный separation: 3+ бойцов окружают, а не слипаются в кучу.
        // Стрелок стоит на месте (база = его же точка → arrive ≈ 0); separation
        // только разводит наложившихся лучников, кольцо ему не нужно.
        if (weapon.kind === 'ranged') {
          this._parts[0]!.s.x = 0;
          this._parts[0]!.s.z = 0;
        } else {
          // Угол-слот АБСОЛЮТНЫЙ в мире (база 0), а не относительно текущего пеленга:
          // иначе точка стояния крутилась бы вокруг цели каждый тик и боец орбитировал
          // бы, не сходясь. Фиксированный по id сектор → arrive к неподвижной точке → боец
          // оседает на своём месте кольца. Разные id берут разные секторы (золотой угол).
          const tr = brain.target?.targetRadius ?? 0;
          const slot = attackSlotAngle(npc.id, 0);
          const standoff = tr + attackRange * STANDOFF_FRAC;
          attackStandoff(tx, tz, slot, standoff, this._slot);
          arrive(px, pz, this._slot.x, this._slot.z, npc.def.speed, ATTACK_SLOW_RADIUS, this._parts[0]!.s);
        }
        const c = this.steerMove(npc, npcs, px, py, pz, SEP_RADIUS_ATTACK, SEP_MAX_PUSH_ATTACK);
        vx = c.x;
        vz = c.z;
        break;
      }
      case 'flee': {
        // FSM входит в flee только при видимой цели (см. sim/fsm.ts), так что
        // target здесь есть; if — страховка на будущее. Базовое желание —
        // перевёрнутый seek («от цели»), плюс объезд: беглец тоже не должен
        // пятиться сквозь лес.
        if (brain.target) {
          const b = seek(px, pz, tx, tz, npc.def.speed, this._parts[0]!.s);
          b.x = -b.x;
          b.z = -b.z;
          const c = this.steerMove(npc, npcs, px, py, pz, SEP_RADIUS, SEP_MAX_PUSH);
          vx = c.x;
          vz = c.z;
        }
        break;
      }
    }
    npc.fixedUpdate(stepSec, vx, vz);

    // Запуск атаки: per-NPC кулдаун + свободный аниматор (hit/смерть не прерываем)
    if (brain.state === 'attack' && brain.target && brain.cooldownLeft <= 0 && brain.pendingT < 0 && !npc.anim.busy) {
      const animName = weapon.kind === 'ranged' ? weapon.anims[0] : pick(this.rng, weapon.anims);
      const dur = animName ? npc.anim.playOneShot(animName, { fade: 0.08 }) : 0;
      // Нет клипа (dur=0) — фоллбэк 0.3 с, как в CombatSystem
      brain.pendingT = dur > 0 ? dur * weapon.hitAt : 0.3;
      brain.cooldownLeft = weapon.cooldown;
    }
  }

  /** Момент hitAt начатой атаки: милишный удар по сектору или выстрел в грудь цели. */
  private executeAttack(npc: NpcCharacter): void {
    if (npc.weapon.kind === 'ranged') this.fireArrow(npc);
    else this.strikeMelee(npc);
  }

  /** По образцу CombatSystem.strike: сектор перед NPC, урон каждому врагу в нём. */
  private strikeMelee(npc: NpcCharacter): void {
    const weapon = npc.weapon;
    const feet = npc.feet;
    const ax = feet.x;
    const az = feet.z;

    // Кандидаты — живые враги из списка целей тика; id = индекс в _strikeCands
    let n = 0;
    for (const t of this.targetsFor(npc)) {
      if ((t as unknown) === npc || !t.alive || !areEnemies(npc.team, t.team)) continue;
      let p = this._pointPool[n];
      if (!p) {
        p = { id: 0, x: 0, z: 0 };
        this._pointPool[n] = p;
      }
      const tf = t.feet;
      p.id = n;
      p.x = tf.x;
      p.z = tf.z;
      // Точка удара по большой цели (дом) — на стене по лучу к центру: центр
      // дальше weapon.range, и без проекции сектор удара никогда бы его не накрыл.
      // Дом уже спроецирован на поверхность → его radius для сектора 0; обычная
      // капсула-цель меряется до поверхности тела (CAPSULE_RADIUS), как у игрока,
      // чтобы NPC доставал врага, стоящего вплотную.
      const r = t.targetRadius ?? 0;
      if (r > 0) {
        const dx = tf.x - ax;
        const dz = tf.z - az;
        const d = Math.hypot(dx, dz);
        if (d > r) {
          p.x = tf.x - (dx / d) * r;
          p.z = tf.z - (dz / d) * r;
        } else {
          // Атакующий внутри радиуса (угол бокса) — «стена» прямо тут
          p.x = ax;
          p.z = az;
        }
        p.radius = 0;
      } else {
        p.radius = CAPSULE_RADIUS;
      }
      this._points[n] = p;
      this._strikeCands[n] = t;
      n++;
    }
    this._points.length = n;
    this._strikeCands.length = n;

    const ids = selectMeleeTargets(ax, az, npc.yaw, weapon.range ?? 2, weapon.arcDeg ?? 120, this._points);
    for (const id of ids) {
      const target = this._strikeCands[id]!;
      const { damage } = computeHit(weapon.damage, npc.attackStats, target.defenseStats, this.rng);
      target.takeDamage(damage);
    }
  }

  /** Выстрел в грудь запомненной цели (без упреждения) с дисперсией ±2°. */
  private fireArrow(npc: NpcCharacter): void {
    const target = npc.brain.target;
    if (!target || !target.alive) return; // цель пропала за время замаха — холостой
    const feet = npc.feet;
    const ox = feet.x;
    const oy = feet.y + SHOT_HEIGHT;
    const oz = feet.z;
    const tf = target.feet;
    const dx = tf.x - ox;
    const dy = tf.y + SHOT_HEIGHT - oy;
    const dz = tf.z - oz;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.001) return;

    // Дисперсия в сферических углах: честные ±2° и по yaw, и по pitch
    const spread = (DISPERSION_DEG * Math.PI) / 180;
    const yaw = Math.atan2(dx, dz) + (this.rng() * 2 - 1) * spread;
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (this.rng() * 2 - 1) * spread;
    const cosP = Math.cos(pitch);
    _shotDir.set(Math.sin(yaw) * cosP, Math.sin(pitch), Math.cos(yaw) * cosP);
    _shotOrigin.set(ox, oy, oz);
    this.projectiles.spawn(
      _shotOrigin,
      _shotDir,
      npc.weapon.projectileSpeed ?? 40,
      npc.weapon.damage,
      npc.team,
    );
  }

  /**
   * Общая сумма движения: базовое желание (уже записано в _parts[0].s вызывающим)
   * + separation + объезд статики → _combined. Выделено из веток think, чтобы
   * patrol/chase/flee/attack собирали один и тот же набор слагаемых. В бою
   * separation сильнее (sepRadius/sepMaxPush), чтобы атакующие не слипались.
   */
  private steerMove(
    npc: NpcCharacter,
    npcs: readonly NpcCharacter[],
    px: number,
    py: number,
    pz: number,
    sepRadius: number,
    sepMaxPush: number,
  ): Steer {
    separation(px, pz, this.fillNeighbors(npcs, npc), sepRadius, sepMaxPush, this._parts[1]!.s);
    this._rayOrigin.y = py + RAY_HEIGHT;
    this._rayExclude = npc.collider;
    const b = this._parts[0]!.s;
    avoidObstacles(px, pz, b.x, b.z, AVOID_LOOKAHEAD, this._castRay, this._parts[2]!.s);
    return combineSteering(this._parts, npc.def.speed, this._combined);
  }

  /** Соседи для separation: все живые npc, кроме самого. Пул не сжимается — без аллокаций. */
  private fillNeighbors(npcs: readonly NpcCharacter[], self: NpcCharacter): readonly { x: number; z: number }[] {
    let n = 0;
    for (const o of npcs) {
      if (o === self || !o.alive) continue;
      let p = this._neighborPool[n];
      if (!p) {
        p = { x: 0, z: 0 };
        this._neighborPool[n] = p;
      }
      const f = o.feet;
      p.x = f.x;
      p.z = f.z;
      this._neighbors[n] = p;
      n++;
    }
    this._neighbors.length = n;
    return this._neighbors;
  }
}
