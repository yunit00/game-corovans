// Дирижёр набегов (Фаза 4): фазовый автомат из sim/raidFlow, план волн из sim/raid,
// точки спавна из sim/raidSpawns. Сам он «грязный» — баннеры HUD, асинхронная
// фабрика NPC, шина событий, — поэтому живёт в systems, а математика в src/sim/.
import { bus } from '../core/EventBus';
import { randRange, type Rng } from '../core/rng';
import type { NpcCharacter } from '../entities/NpcCharacter';
import { punitiveDifficultyBonus, punitiveRaidChance, type HeatState } from '../sim/heat';
import { planRaid, planRaidOfSize, type RaidWave } from '../sim/raid';
import {
  ANNOUNCE_DURATION_SEC,
  forceAnnounce,
  isRunawayRaider,
  makeRaidFlow,
  stepRaidFlow,
  type RaidFlowInputs,
  type RaidPhase,
} from '../sim/raidFlow';
import { waveSpawnPoints } from '../sim/raidSpawns';
import type { Hud } from '../ui/Hud';
import { VILLAGE } from '../world/WorldData';

/** Фабрика юнита набега (Game.spawnNpc): асинхронная — модель грузится с диска. */
export type SpawnUnitFn = (
  archetypeId: string,
  x: number,
  z: number,
  faceYaw: number,
) => Promise<NpcCharacter | null>;

/** Кольцо спавна волн, м: за радиусом деревни (48), но сильно ближе RUNAWAY_DIST. */
const SPAWN_R_MIN = 55;
const SPAWN_R_MAX = 70;
/** Полуширина сектора спавна: волна выходит «цепью» со стороны форта злодея. */
const SECTOR_HALF = Math.PI / 4;
/** Задержка карательного набега после грабежа, с — отряд «выходит из форта». */
const PUNITIVE_DELAY_MIN = 25;
const PUNITIVE_DELAY_MAX = 35;

export class RaidDirector {
  /** Растёт на 1 за каждый отбитый набег. */
  difficulty = 1;

  private readonly flow = makeRaidFlow();
  private waves: RaidWave[] = [];
  /**
   * Все юниты текущего набега. Трупы из списка не удаляем (alive=false), даже когда
   * Game убирает их из сцены, — подсчёт живых стабилен и не зависит от уборки.
   */
  private readonly raiders: NpcCharacter[] = [];
  /** Спавны в полёте: без счётчика cleared мог бы сработать раньше появления юнита. */
  private pendingSpawns = 0;
  private raidIndex = 0;
  /** Скретч входов фазового автомата — без аллокаций в фикс-цикле. */
  private readonly _inputs: RaidFlowInputs = { autoStart: true, waveDelays: [], raidersLeft: 0 };
  /** delaySec текущего плана (отдельно от waves: автомату нужны только числа). */
  private readonly _delays: number[] = [];
  /** Азимут деревня→форт (atan2(x,z)) — центр сектора спавна волн. */
  private readonly sectorAz: number;
  /**
   * Обратный отсчёт до запуска карательного набега, с; ≤0 — таймер выключен.
   * Бонус сложности отряда — разовый (постоянную difficulty не трогает).
   */
  private punitiveDelay = 0;
  private punitiveBonus = 0;

  constructor(
    private readonly hud: Hud,
    private readonly rng: Rng,
    private readonly spawnUnit: SpawnUnitFn,
    /** false при noraids=1 — автозапуск выключен, startRaid работает всегда. */
    private readonly autoStart: boolean,
    /** Жар дворца — против него катится шанс карательного набега на грабёж. */
    private readonly heat: HeatState,
    /** Логово злодея: сектор спавна волн смотрит от деревни на форт. */
    fortPos: { x: number; z: number },
    /** Сводка домов на момент отбоя: уцелевшие/всего — для награды (raid:ended). */
    private readonly houseTally: () => { survived: number; total: number },
  ) {
    this.sectorAz = Math.atan2(fortPos.x - VILLAGE.x, fortPos.z - VILLAGE.z);
    // Карательный набег: грабёж корована → бросок punitiveRaidChance(heat).
    // Подписка одна (RaidDirector живёт всю игру) — дублей нет.
    bus.on('caravan:robbed', () => this.onCaravanRobbed());
  }

  get state(): RaidPhase {
    return this.flow.phase;
  }

  get raidersAlive(): number {
    let n = 0;
    for (const r of this.raiders) if (r.alive) n++;
    return n;
  }

  /**
   * Немедленный announce (__game.spawnRaid): size — ровно size скелетов одной волной,
   * без size — обычный план от текущей difficulty. Уже идущий набег не сбрасываем:
   * старые рейдеры остаются в списке и тоже должны умереть до cleared.
   */
  startRaid(size?: number): void {
    forceAnnounce(this.flow);
    this.setPlan(size !== undefined ? planRaidOfSize(size) : planRaid(this.difficulty, this.rng));
    this.announce();
  }

  /**
   * Грабёж корована: бросок шанса по жару. Успех → через PUNITIVE_DELAY карательный
   * отряд «выходит из форта» с разовым бонусом сложности. Если набег уже идёт/объявлен
   * (или карательный таймер уже взведён) — пропуск: карательные набеги не копятся в очередь.
   */
  private onCaravanRobbed(): void {
    if (this.flow.phase !== 'calm' && this.flow.phase !== 'cleared') return;
    if (this.punitiveDelay > 0) return;
    if (this.rng() >= punitiveRaidChance(this.heat)) return;
    this.punitiveDelay = randRange(this.rng, PUNITIVE_DELAY_MIN, PUNITIVE_DELAY_MAX);
    this.punitiveBonus = punitiveDifficultyBonus(this.heat);
    this.hud.showTicker('Карательный отряд вышел из форта!', 5);
  }

  /** Немедленный карательный путь для смоука: бонус по текущему жару, без задержки/броска. */
  debugForcePunitive(): void {
    if (this.flow.phase !== 'calm' && this.flow.phase !== 'cleared') return;
    this.punitiveBonus = punitiveDifficultyBonus(this.heat);
    this.hud.showTicker('Карательный отряд вышел из форта!', 5);
    this.launchPunitive();
  }

  /** Принудительный announce с разовым бонусом сложности (постоянную difficulty не растим). */
  private launchPunitive(): void {
    forceAnnounce(this.flow);
    this.setPlan(planRaid(this.difficulty + this.punitiveBonus, this.rng));
    this.punitiveBonus = 0;
    this.announce();
  }

  fixedUpdate(stepSec: number): void {
    // Карательный таймер тикает только пока набег не начат — иначе announce
    // наложился бы на активный набег. onCaravanRobbed уже это гарантирует, но
    // между взводом и запуском мог стартовать автонабег: тогда таймер сгорает.
    if (this.punitiveDelay > 0) {
      if (this.flow.phase !== 'calm' && this.flow.phase !== 'cleared') {
        this.punitiveDelay = 0;
        this.punitiveBonus = 0;
      } else {
        this.punitiveDelay -= stepSec;
        if (this.punitiveDelay <= 0) {
          this.punitiveDelay = 0;
          this.launchPunitive();
        }
      }
    }

    const inp = this._inputs;
    inp.autoStart = this.autoStart;
    inp.waveDelays = this._delays;
    inp.raidersLeft = this.raidersAlive + this.pendingSpawns;

    switch (stepRaidFlow(this.flow, stepSec, inp)) {
      case 'announce':
        this.setPlan(planRaid(this.difficulty, this.rng));
        this.announce();
        break;
      case 'wave':
        if (this.flow.wavesSpawned === 1) bus.emit('raid:started', { index: this.raidIndex });
        this.spawnWave(this.waves[this.flow.wavesSpawned - 1]!);
        break;
      case 'cleared': {
        // Баннер с наградой за уцелевшие дома показывает Game в обработчике
        // raid:ended (ему доступны кошелёк/XP) — здесь только итог по домам.
        const tally = this.houseTally();
        bus.emit('raid:ended', {
          index: this.raidIndex,
          victory: true,
          survived: tally.survived,
          total: tally.total,
        });
        this.raidIndex++;
        this.difficulty++;
        this.raiders.length = 0;
        break;
      }
    }

    // Анти-зависание: рейдер, убежавший в flee за RUNAWAY_DIST, тихо умирает
    // (despawn — без enemy:died, т.е. без лута и XP). Иначе его не найти,
    // raidersAlive не обнулится и набег никогда не станет cleared.
    if (this.flow.phase === 'active') {
      for (const r of this.raiders) {
        if (!r.alive) continue;
        const f = r.feet;
        if (isRunawayRaider(r.brain.state, f.x, f.z, VILLAGE.x, VILLAGE.z)) r.despawn();
      }
    }
  }

  private setPlan(waves: RaidWave[]): void {
    this.waves = waves;
    this._delays.length = 0;
    for (const w of waves) this._delays.push(w.delaySec);
  }

  private announce(): void {
    // Большой центральный баннер показываем ОДИН раз коротко (~2 с) — без цифр.
    // Дальше за набегом следит компактный чип HUD (showRaidChip + updateRaidChip),
    // где и живут число рейдеров/стрелка. Так баннер не дублирует чип.
    this.hud.showBanner('НАБИГАЮТ!', 2);
    bus.emit('raid:incoming', { index: this.raidIndex, seconds: ANNOUNCE_DURATION_SEC });
  }

  /** Волна выходит цепью в секторе со стороны форта (деревня→форт ±π/4), лицом к деревне. */
  private spawnWave(wave: RaidWave): void {
    let count = 0;
    for (const u of wave.units) count += u.count;
    const pts = waveSpawnPoints(
      count,
      VILLAGE.x,
      VILLAGE.z,
      this.sectorAz - SECTOR_HALF,
      this.sectorAz + SECTOR_HALF,
      SPAWN_R_MIN,
      SPAWN_R_MAX,
      this.rng,
    );
    let i = 0;
    for (const u of wave.units) {
      for (let k = 0; k < u.count; k++) {
        const p = pts[i]!;
        const archetype = u.archetype;
        this.pendingSpawns++;
        // setTimeout размазывает клонирование моделей: GLTF закэширован, и без
        // паузы все 12+ клонов (скиннед-меши, микшеры, тела) выполнились бы в одном
        // microtask-дрейне — фриз на старте волны. Заодно цепь выходит «волной».
        // pendingSpawns учтён уже здесь, поэтому cleared дождётся и отложенных.
        // Весь rng волны уже вызван синхронно выше — порядок случайностей
        // не зависит от того, в каком порядке резолвятся промисы фабрики.
        setTimeout(() => {
          void this.spawnUnit(archetype, p.x, p.z, Math.atan2(VILLAGE.x - p.x, VILLAGE.z - p.z))
            .then((npc) => {
              this.pendingSpawns--;
              if (!npc) return;
              // Центр патруля — деревня: patrol сам тащит рейдера к домам и игроку
              npc.brain.spawnX = VILLAGE.x;
              npc.brain.spawnZ = VILLAGE.z;
              this.raiders.push(npc);
            })
            // Загрузка модели может отказать (сетевой fetch) — без catch счётчик
            // никогда не обнулился бы и набег навсегда завис бы в active
            .catch((e: unknown) => {
              this.pendingSpawns--;
              console.warn('[raid] спавн юнита не удался', archetype, e);
            });
        }, i * 50);
        i++;
      }
    }
  }
}
