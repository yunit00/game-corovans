// Дирижёр корованов (Фаза 5): расписание из sim/caravan, маршрут из sim/path,
// жар дворца из sim/heat. «Грязный» по образцу RaidDirector — тикеры HUD,
// асинхронные фабрики, шина событий; вся математика — в src/sim/.
import { bus } from '../core/EventBus';
import type { Rng } from '../core/rng';
import type { Caravan } from '../entities/Caravan';
import type { NpcCharacter } from '../entities/NpcCharacter';
import {
  caravanInterval,
  escortFormation,
  planCaravan,
  planCaravanOfTier,
  type CaravanPlan,
  type CaravanTier,
} from '../sim/caravan';
import { addRobberyHeat, PUNITIVE_HEAT_MIN, type HeatState } from '../sim/heat';
import { buildPath, posAt, reversePath, type Path } from '../sim/path';
import type { Hud } from '../ui/Hud';
import { ROADS } from '../world/WorldData';
import type { SpawnUnitFn } from './RaidDirector';

/** Фабрика телеги (Game → Caravan.create): асинхронная — модели грузятся с диска. */
export type MakeCartFn = (
  plan: CaravanPlan,
  path: Path,
  sStart: number,
  sEnd: number,
) => Promise<Caravan>;

/** Первый корован после старта игры, с — игрок успевает осмотреться у деревни. */
const FIRST_CARAVAN_SEC = 45;
/**
 * Отступ старта/финиша от дворцового конца тракта, м: ROADS[0] начинается в
 * ЦЕНТРЕ дворца, и без отступа телега спавнилась бы внутри коллайдера замка
 * (полугабарит ~21 м), а встречный корован — въезжал бы в стену.
 */
const PALACE_GATE_S = 40;
/** Дистанция [E]-грабежа от центра телеги, м (чуть больше таблички — телега крупная). */
const ROB_DIST = 3;
/** Период проверки дистанции до телеги, с — как у TelegramSign, не каждый кадр. */
const CHECK_PERIOD = 0.2;
/** Сколько висит строка тикера слухов, с. */
const TICKER_SEC = 5;

/** Запись эскорта: слот строя фиксируется за юнитом при спавне. */
interface EscortEntry {
  npc: NpcCharacter;
  slot: { dx: number; ds: number };
}

// Скретч posAt — якоря эскорта считаются в фикс-цикле, без аллокаций
const _p = { x: 0, z: 0, dirX: 1, dirZ: 0 };

export class CaravanDirector {
  /** Тракт дворец→юг и обратный — строятся один раз. */
  private readonly pathFwd: Path;
  private readonly pathBack: Path;

  private caravan: Caravan | null = null;
  /**
   * Заранее разыгранный план СЛЕДУЮЩЕГО планового корована (тир/эскорт/лут).
   * Роллится один раз, когда заведён таймер ожидания, и используется при спавне —
   * так слух трактирщика (nextCaravanInfo) совпадает с тем, что реально выедет.
   * null, пока корован в пути (расписание стоит) или ещё не разыгран.
   */
  private nextPlan: CaravanPlan | null = null;
  private readonly escorts: EscortEntry[] = [];
  /** Спавны в полёте — пока > 0, «эскорт мёртв» решать рано (как в RaidDirector). */
  private pendingSpawns = 0;
  /** Телега грузится с диска: расписание стоит, дублей не спавним. */
  private loading = false;
  /**
   * Поколение корована: clearCaravan его инкрементит, и отставшие setTimeout-спавны
   * эскорта по резолву видят чужое поколение и тихо деспавнятся.
   */
  private generation = 0;
  private timerLeft = FIRST_CARAVAN_SEC;
  /** Номер корована с 1: нечётные выезжают из дворца, чётные — прибывают с юга. */
  private caravanIndex = 0;
  /** Тикер «стража вступила в бой» — один раз на корован. */
  private fightAnnounced = false;
  /** Игрок в радиусе грабежа обездвиженной телеги (промпт показан). */
  private nearCart = false;
  private checkLeft = 0;

  constructor(
    private readonly hud: Hud,
    private readonly rng: Rng,
    /** Жар дворца — владелец Game (он же остужает в фикс-шаге), мы читаем/пишем. */
    private readonly heat: HeatState,
    private readonly spawnUnit: SpawnUnitFn,
    private readonly makeCart: MakeCartFn,
    /** Фонтан монет у телеги (LootSystem через Game). */
    private readonly dropLoot: (x: number, y: number, z: number, coins: number) => void,
    private readonly giveXp: (xp: number) => void,
    /** false при noraids=1 — расписание выключено, startCaravan работает всегда. */
    private readonly autoStart: boolean,
  ) {
    this.pathFwd = buildPath(ROADS[0]!);
    this.pathBack = reversePath(this.pathFwd);
  }

  get escortAlive(): number {
    let n = 0;
    for (const e of this.escorts) if (e.npc.alive) n++;
    return n;
  }

  /**
   * Слух о СЛЕДУЮЩЕМ плановом короване для трактирщика (Фаза 6B): тир и время до
   * выезда. Возвращает null, если корован уже в пути (расписание стоит — слухов
   * нет) или автозапуск выключен (noraids). Тир берётся из заранее разыгранного
   * nextPlan, так что слух не врёт о том, что реально выедет.
   */
  nextCaravanInfo(): { tier: CaravanTier; secondsLeft: number } | null {
    // Корован уже едет / грузится — расписание не тикает, предсказывать нечего.
    if (this.caravan !== null || this.loading || !this.autoStart) return null;
    // Ещё не разыграли (первый кадр ожидания) — раскатаем тир заранее для слуха.
    if (this.nextPlan === null) this.nextPlan = planCaravan(this.heat.value, this.rng);
    return { tier: this.nextPlan.tier, secondsLeft: Math.max(0, this.timerLeft) };
  }

  /**
   * Порядковый номер СЛЕДУЮЩЕГО корована (caravanIndex+1): меняется при каждом
   * выезде. Трактирщик дедуплицирует слух по нему — рассказал про N-й, при N+1
   * снова есть что сказать. Нужен Game (повтор угощения до выезда).
   */
  get nextCaravanIndex(): number {
    return this.caravanIndex + 1;
  }

  /**
   * Немедленный корован (__game.spawnCaravan), скип расписания. tier задан —
   * конкретный ранг, иначе ролл по текущему heat. Активный корован убирается
   * сразу: два конвоя на одном тракте дерутся за один debugState и промпт.
   */
  startCaravan(tier?: CaravanTier): void {
    this.clearCaravan();
    this.spawn(
      tier !== undefined
        ? planCaravanOfTier(tier, this.heat.value, this.rng)
        : planCaravan(this.heat.value, this.rng),
    );
  }

  fixedUpdate(stepSec: number): void {
    const cart = this.caravan;
    if (!cart) {
      // Расписание тикает только между корованами: маршрут ~860 м занимает
      // ~6.5 мин, и интервал «во время поездки» копил бы 3–4 конвоя на тракте —
      // debugState и смоуки стали бы неоднозначными. Интервал — от ухода предыдущего.
      if (this.loading || !this.autoStart) return;
      // Разыгрываем план следующего корована ОДИН раз, как только начали ждать —
      // чтобы слух трактирщика совпал с тем, что выедет (тир не перекатывается).
      if (this.nextPlan === null) this.nextPlan = planCaravan(this.heat.value, this.rng);
      this.timerLeft -= stepSec;
      if (this.timerLeft <= 0) {
        const plan = this.nextPlan;
        this.nextPlan = null;
        this.spawn(plan);
      }
      return;
    }

    // Телега стоит, пока ЛЮБОЙ живой эскортник дерётся (chase/attack; flee не
    // держит — беглец конвой не охраняет). Эскорт весь мёртв — стоит навсегда,
    // ждёт грабежа. Дешёвый скан по ≤9 юнитам каждый шаг.
    let alive = 0;
    let fighting = false;
    for (const e of this.escorts) {
      if (!e.npc.alive) continue;
      alive++;
      const st = e.npc.brain.state;
      if (st === 'chase' || st === 'attack') fighting = true;
    }
    const robbable = alive === 0 && this.pendingSpawns === 0;
    cart.setHalted(fighting || robbable);
    if (fighting && !this.fightAnnounced) {
      this.fightAnnounced = true;
      this.hud.showTicker('Стража корована вступила в бой', TICKER_SEC);
    }

    cart.fixedUpdate(stepSec);
    this.anchorEscorts(cart);

    if (cart.state === 'gone') this.clearCaravan();
  }

  /**
   * Покадрово из Game.tick: визуал телеги + [E]-грабёж обездвиженной телеги
   * (по образцу TelegramSign: дистанция раз в CHECK_PERIOD, interact — edge E).
   */
  update(dt: number, playerX: number, playerZ: number, interact: boolean): void {
    const cart = this.caravan;
    if (!cart) return;
    cart.update(dt);

    // Грабёж доступен только у стоящей телеги с мёртвым эскортом
    const robbable =
      cart.state === 'halted' && this.escortAlive === 0 && this.pendingSpawns === 0;
    this.checkLeft -= dt;
    if (this.checkLeft <= 0) {
      this.checkLeft = CHECK_PERIOD;
      const p = cart.pos;
      const near = robbable && Math.hypot(playerX - p.x, playerZ - p.z) < ROB_DIST;
      if (near !== this.nearCart) {
        this.nearCart = near;
        if (near) this.hud.showPrompt('[E] ГРАБИТЬ КОРОВАН');
        else this.hud.hidePrompt();
      }
    }
    if (this.nearCart && interact) this.rob(cart);
  }

  debugInfo(): {
    state: string;
    tier: CaravanTier;
    s: number;
    pos: { x: number; z: number };
    escortAlive: number;
    robbed: boolean;
  } | null {
    const c = this.caravan;
    if (!c) return null;
    const p = c.pos; // кэш-вектор телеги: x/z читаем сразу
    return {
      state: c.state,
      tier: c.plan.tier,
      s: +c.s.toFixed(1),
      pos: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
      escortAlive: this.escortAlive,
      robbed: c.state === 'robbed',
    };
  }

  /** Спавн телеги (async) и эскорта строем вокруг точки старта. */
  private spawn(plan: CaravanPlan): void {
    this.caravanIndex++;
    const fromSouth = this.caravanIndex % 2 === 0;
    const path = fromSouth ? this.pathBack : this.pathFwd;
    // Дворцовый конец урезан с обеих сторон маршрута (см. PALACE_GATE_S)
    const sStart = fromSouth ? 0 : PALACE_GATE_S;
    const sEnd = fromSouth ? path.total - PALACE_GATE_S : path.total;
    const gen = this.generation;

    this.loading = true;
    this.makeCart(plan, path, sStart, sEnd)
      .then((cart) => {
        // Пока грузились, корован отменили (startCaravan): убираем телегу и НЕ
        // трогаем loading — флаг уже принадлежит следующему поколению спавна
        if (gen !== this.generation) {
          cart.dispose();
          return;
        }
        this.loading = false;
        this.caravan = cart;
        this.hud.showTicker(
          fromSouth ? 'Корован прибыл с юга' : 'Корован выехал из дворца',
          TICKER_SEC,
        );
        bus.emit('caravan:spawned', { tier: plan.tier });
        this.spawnEscort(plan, path, sStart, gen);
      })
      .catch((e: unknown) => {
        if (gen !== this.generation) return; // отменённое поколение — см. then
        // Загрузка модели может отказать (сетевой fetch) — расписание не виснет
        this.loading = false;
        this.timerLeft = caravanInterval(this.heat.value, this.rng);
        console.warn('[caravan] спавн телеги не удался', e);
      });
  }

  /** Эскорт по слотам формации; setTimeout размазывает клоны моделей (как в RaidDirector). */
  private spawnEscort(plan: CaravanPlan, path: Path, sStart: number, gen: number): void {
    let total = 0;
    for (const u of plan.escort) total += u.count;
    const slots = escortFormation(total);
    let i = 0;
    for (const u of plan.escort) {
      for (let k = 0; k < u.count; k++) {
        const slot = slots[i]!;
        const p = posAt(path, sStart + slot.ds, _p);
        // Перпендикуляр вправо от направления пути: (dirZ, -dirX)
        const x = p.x + p.dirZ * slot.dx;
        const z = p.z - p.dirX * slot.dx;
        const faceYaw = Math.atan2(p.dirX, p.dirZ); // лицом по ходу конвоя
        const archetype = u.archetype;
        this.pendingSpawns++;
        setTimeout(() => {
          void this.spawnUnit(archetype, x, z, faceYaw)
            .then((npc) => {
              this.pendingSpawns--;
              if (!npc) return;
              // Корован успели отменить — юнит-сирота тихо уходит (без лута/XP)
              if (gen !== this.generation || !this.caravan) {
                npc.despawn();
                return;
              }
              npc.brain.spawnX = x;
              npc.brain.spawnZ = z;
              this.escorts.push({ npc, slot });
            })
            .catch((e: unknown) => {
              this.pendingSpawns--;
              console.warn('[caravan] спавн эскорта не удался', archetype, e);
            });
        }, i * 50);
        i++;
      }
    }
  }

  /**
   * Якорь мозга каждого живого эскортника = мировая позиция его слота при
   * текущем s телеги. Точка маршрута патруля пинится туда же: чистый
   * spawn-якорь давал бы разброс ±10 м (PATROL_RADIUS) и паузы idle 2–4 с —
   * строй разваливался бы на глазах. Пин только в мирных состояниях:
   * chase/attack/flee остаются за FSM — восприятие само агрит на игрока
   * и скелетов, а после боя patrol сам догоняет уехавший слот.
   */
  private anchorEscorts(cart: Caravan): void {
    for (const e of this.escorts) {
      if (!e.npc.alive) continue;
      const p = posAt(cart.path, cart.s + e.slot.ds, _p);
      const x = p.x + p.dirZ * e.slot.dx;
      const z = p.z - p.dirX * e.slot.dx;
      const b = e.npc.brain;
      b.spawnX = x;
      b.spawnZ = z;
      if (b.state === 'idle' || b.state === 'patrol') {
        b.state = 'patrol';
        b.patrolX = x;
        b.patrolZ = z;
      }
    }
  }

  /** Грабёж: фонтан монет + XP + heat + тикеры + событие; телега кренится и ждёт деспавна. */
  private rob(cart: Caravan): void {
    const plan = cart.plan;
    const p = cart.pos;
    this.dropLoot(p.x, p.y, p.z, plan.lootCoins);
    this.giveXp(plan.xp);
    const before = this.heat.value;
    addRobberyHeat(this.heat, plan.tier);
    cart.rob();
    this.nearCart = false;
    this.hud.hidePrompt();
    this.hud.showTicker(`КОРОВАН ОГРАБЛЕН (+${plan.lootCoins} монет)`, TICKER_SEC);
    // Порог карательных набегов пересечён — мир предупреждает игрока заранее
    if (before < PUNITIVE_HEAT_MIN && this.heat.value >= PUNITIVE_HEAT_MIN) {
      this.hud.showTicker('Стража дворца в ярости', TICKER_SEC);
    }
    bus.emit('caravan:robbed', {
      tier: plan.tier,
      coins: plan.lootCoins,
      heat: this.heat.value,
    });
  }

  /** Убрать корован целиком и завести таймер следующего. */
  private clearCaravan(): void {
    this.generation++;
    // Телега в полёте загрузки относится к старому поколению — флаг сбрасываем
    // здесь, а её then/catch по несовпадению generation состояние не трогают
    this.loading = false;
    for (const e of this.escorts) {
      // despawn — тихая смерть без enemy:died (ни лута, ни XP за неубитых);
      // труп уберёт Game по corpseTimer, как у «убежавших» рейдеров
      if (e.npc.alive) e.npc.despawn();
    }
    this.escorts.length = 0;
    this.fightAnnounced = false;
    if (this.nearCart) {
      this.nearCart = false;
      this.hud.hidePrompt();
    }
    if (this.caravan) {
      this.caravan.dispose();
      this.caravan = null;
    }
    this.timerLeft = caravanInterval(this.heat.value, this.rng);
    // Следующий корован разыграется заново при первом кадре ожидания (nextPlan===null).
    this.nextPlan = null;
  }
}
