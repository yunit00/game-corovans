import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  VignetteEffect,
} from 'postprocessing';
import { AssetLoader } from './AssetLoader';
import { installDebugApi } from './DebugApi';
import { bus, type GameEvents } from './EventBus';
import { FixedStepper } from './FixedStepper';
import { Input } from './Input';
import { PhysicsWorld, RAPIER } from './PhysicsWorld';
import { hashSeed, mulberry32, randInt, type Rng } from './rng';
import { computeHit, DEFAULT_ATTACKER } from '../sim/damage';
import { type CaravanTier } from '../sim/caravan';
import { coolHeat, makeHeat } from '../sim/heat';
import { LOOT_TABLES, rollLoot } from '../sim/lootTables';
import { moveDirFromKeys, stepAngle } from '../sim/movement';
import {
  addItem,
  countItem,
  equip,
  makeInventory,
  removeItem,
  totalStatMods,
  unequip,
  type EquipKey,
  type Inventory,
} from '../sim/inventory';
import {
  canUnlock,
  levelFromXp,
  makePerkState,
  perkCombatMods,
  perkPointsEarned,
  perkPointsSpent,
  unlockPerk,
  xpForLevel,
  PERKS,
  type PerkId,
  type PerkState,
} from '../sim/progression';
import { ITEMS } from '../data/items';
import {
  addArrows,
  ARROWS_DROP_MAX,
  ARROWS_DROP_MIN,
  ARROWS_MAX,
  ARROWS_PER_BUY,
  ARROWS_START,
  buyArrows,
  canShoot,
  clampArrows,
} from '../sim/ammo';
import { AudioEngine, type AudioFrameInfo } from '../audio/AudioEngine';
import { ARCHETYPES } from '../data/archetypes';
import { WEAPONS } from '../data/weapons';
import { Caravan } from '../entities/Caravan';
import type { Team } from '../entities/Character';
import { Critter, CARCASS_TTL } from '../entities/Critter';
import { NpcCharacter, type NpcTarget } from '../entities/NpcCharacter';
import { PlayerCharacter } from '../entities/PlayerCharacter';
import { Skeleton, type SkeletonArchetype } from '../entities/Skeleton';
import { AISystem } from '../systems/AISystem';
import { CameraRig } from '../systems/CameraRig';
import { CaravanDirector } from '../systems/CaravanDirector';
import { CombatSystem, type CombatTarget } from '../systems/CombatSystem';
import { LootSystem } from '../systems/LootSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { arrowKillDamage } from '../sim/projectile';
import { FaunaSystem } from '../systems/FaunaSystem';
import { RaidDirector } from '../systems/RaidDirector';
import { RangedAttack, type Vec3Like } from '../systems/RangedAttack';
import { saveGame, applySave, readSave, hasSave, wipeSave } from '../systems/SaveSystem';
import type { SaveData } from '../sim/saves';
import { Hud } from '../ui/Hud';
import { xpBarFraction } from '../ui/hudLogic';
import { InventoryScreen, BeltBar, type BeltSlot } from '../ui/InventoryScreen';
import { ShopScreen } from '../ui/ShopScreen';
import { ARROWS_PACK_ID, buy as shopBuy, buyPrice, sell as shopSell, DEFAULT_SHOP, INN_SHOP, TRAVELER_SHOP, type ShopConfig } from '../sim/shop';
import { lookoutSummary } from '../sim/towerLookout';
import { MainMenu } from '../ui/MainMenu';
import { LoadingScreen } from '../ui/LoadingScreen';
import { IntroCinematic } from '../cinematic/IntroCinematic';
import { IntroVoice } from '../cinematic/IntroVoice';
import { hasSeenIntro, type IntroStorage } from '../cinematic/storyboard';
import { PauseScreen } from '../ui/PauseScreen';
import { canPause, canResume } from '../sim/pause';
import { PerkScreen, type PerkSlotState, type PerkRefresh } from '../ui/PerkScreen';
import { DialogScreen, type DialogAction, type DialogContent } from '../ui/DialogScreen';
import { WorldMap, type WorldSnapshot } from '../ui/WorldMap';
import type { MapMarker } from '../sim/mapData';
import {
  activeQuestViews,
  dialogFor,
  fortKeyCount,
  makeQuestState,
  recordDeliver,
  recordKill,
  recordVisit,
  syncCollect,
  takeQuest,
  tickCooldowns,
  turnInQuest,
  type QuestState,
} from '../sim/quests';
import { QUESTS, VILLAGERS, VISIT_RADIUS, type VillagerId } from '../data/quests';
import { Chests } from '../world/Chests';
import { Forest } from '../world/Forest';
import { Landmarks } from '../world/Landmarks';
import { Parkour, caveChest } from '../world/Parkour';
import { HILLS } from '../world/Terrain';
import { RoadEnds } from '../world/RoadEnds';
import { Palace } from '../world/Palace';
import { Ponds } from '../world/Ponds';
import { Lakes } from '../world/Lakes';
import { Boat } from '../world/Boat';
import {
  BOAT_DOCK,
  boatDockWaterY,
  boatDockYaw,
} from '../sim/lakes';
import {
  stepBoat,
  canBoard,
  findDisembarkPoint,
  boatSpeed,
  type BoatInput,
  type DepthFn,
} from '../sim/boat';
import { TelegramSign } from '../world/TelegramSign';
import { Terrain } from '../world/Terrain';
import { TrainingDummy, trainingDummyLayout } from '../world/TrainingRange';
import { Village, type VillageService } from '../world/Village';
import { Villagers } from '../world/Villagers';
import { Waterfall, WATERFALL } from '../world/Waterfall';
import { WorldNpcs } from '../world/WorldNpcs';
import { pickTreasureTree, TREASURE_HEIGHT, TREASURE_PICK_RADIUS } from '../sim/hiddenTreasure';
import { HiredGuards } from '../world/HiredGuard';
import {
  applyBlessing,
  BLESSING_COST,
  BLESSING_DURATION_SEC,
  BLESSING_SPEED_MUL,
  clearBlessing,
  isBlessed,
  makeBlessing,
  tickBlessing,
} from '../sim/blessing';
import { canHireGuard, HIRE_COST, MAX_HIRED_GUARDS, nextGuardSlot } from '../sim/hiredGuard';
import { ALE_COST, rumorLine, rumorTicker } from '../sim/tavern';
import { findFortPos, VillainFort, type FortGuardSpots } from '../world/VillainFort';
import { VillainCastle, type CastleAnchors } from '../world/VillainCastle';
import { flattenFactor, isClear, ROADS, PALACE, SPAWN, VILLAGE, WORLD_SIZE } from '../world/WorldData';
import { planFaunaSpawns, FAUNA_DROPS } from '../sim/fauna';
import { raidReward } from '../sim/raid';
import { raidArrowHint } from '../sim/raidArrow';
import { REPAIR_COST, type House } from '../world/House';

interface DynamicProp {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
}

/** Базовое оружие (фоллбэк, пока ничего не экипировано). */
const DEFAULT_MELEE = WEAPONS.dagger!;
const DEFAULT_CROSSBOW = WEAPONS.crossbow_2handed!;
/** Базовые скорости игрока — экипировка/перки множат их (сохраняем как константы). */
const BASE_SPEED_RUN = 5.0;
const BASE_SPEED_SPRINT = 7.6;
/** Базовый радиус магнита монет (LootSystem) — перк «Звериное чутьё» множит. */
const BASE_MAGNET_DIST = 2.5;
/** Базовый максимум HP игрока — перк «Бычье сердце» прибавляет к нему. */
const BASE_MAX_HP = 100;
/** Кулдаун капстоуна «Второе дыхание», с — между срабатываниями спасения от смерти. */
const SECOND_WIND_COOLDOWN = 90;
/** Длительность неуязвимости после «Второго дыхания», с. */
const SECOND_WIND_INVULN = 2;
/** Период автосейва, с. */
const AUTOSAVE_PERIOD = 30;
/** Сколько труп лежит до уборки, с. */
const CORPSE_TTL = 8;
/** Высота вылета стрелы над ногами (грудь). */
const SHOT_HEIGHT = 1.25;
/** Дальность прицельного рейкаста из камеры, м. */
const AIM_DIST = 250;
/** fov прицеливания / обычный (лёгкий зум без вмешательства в CameraRig). */
const FOV_AIM = 45;
const FOV_DEFAULT = 55;
/** Неуязвимость после респауна, с — спавн может оказаться в гуще набега. */
const RESPAWN_INVULN = 3;
/**
 * Порог дальности до деревни, за которым у чипа набега появляется стрелка-указатель,
 * м. Чуть больше радиуса деревни (48) — рядом стрелка не нужна, набег и так виден.
 */
const RAID_ARROW_DIST = 60;
/** Окно буфера клика милишной атаки, с: клик на кулдауне срабатывает по готовности. */
const ATTACK_BUFFER_SEC = 0.18;
/** Частота мигания визуала игрока в неуязвимости, Гц (переключений visible в секунду). */
const INVULN_BLINK_HZ = 6;
/**
 * Период скана ближайшего манекена для звука, с: потребитель — болтовня
 * VoiceBox, читает раз в 0.5 с; гонять каждый кадр body.translation() Rapier
 * (аллокация на вызов) ради этого незачем.
 */
const SKELETON_SCAN_PERIOD = 0.25;
/**
 * Радиус исключения фауны вокруг форта, м: лагерь злодея занимает ~12 м
 * (палатки/кострище/кольцо камней), звери не должны спавниться у него во дворе.
 */
const FAUNA_FORT_CLEAR = 16;
/**
 * Половина зоны разброса центров полян фауны, м. Меньше горной стены (435 в
 * isClear), чтобы все группы гарантированно попадали в лес, а не в его край.
 */
const FAUNA_HALF_EXTENT = 380;
/** Дистанция [E]-разговора с жителем/мировым NPC, м. */
const VILLAGER_TALK_DIST = 2.6;
/** Дистанция [E]-торговли у странствующего торговца (лагерь охотника), м. */
const TRAVELER_TALK_DIST = 3.0;
/** Дистанция [E]-интеракции на террасе постоялого двора (трактирщик/мини-лавка), м.
 *  Терраса открытая (без стен) — берём пошире, чтобы удобно подойти к навесу. */
const INN_TALK_DIST = 3.5;
/** Дистанция [E]-«Осмотреться» на верхней площадке башни, м (узкая точка). */
const TOWER_LOOKOUT_DIST = 3.5;
/**
 * Радиус, в котором промптом владеет рынок (Village.MARKET_DIST=13 + запас): уходя
 * от жителя в этой зоне, не гасим промпт — его перерисует updateMarket («Торговать»).
 */
const MARKET_PROMPT_DIST = 14;
/** Период проверки близости жителя/осмотра POI, с (не каждый кадр). */
const QUEST_CHECK_PERIOD = 0.2;

// Скретч-векторы боя — без аллокаций на клик/шаг
const _camDir = new THREE.Vector3();
const _aimPoint = new THREE.Vector3();
const _shotOrigin = new THREE.Vector3();
const _shotDir = new THREE.Vector3();
const _dropPos = new THREE.Vector3();
/** Центр облёта меню (центр деревни на высоте террейна) — задаётся один раз в init. */
const _menuOrbitCenter = new THREE.Vector3();
/** Якорь камеры/сиденья лодки (волна 2): без аллокаций каждый кадр при катании. */
const _boatAnchor = new THREE.Vector3();
const _seatWorld = new THREE.Vector3();

/** Общий золотистый материал подвески (один на меш — 2 примитива, дёшево). */
const NECKLACE_MAT = new THREE.MeshStandardMaterial({
  color: 0xd9b24a,
  roughness: 0.32,
  metalness: 0.85,
  emissive: 0x6b4e12,
  emissiveIntensity: 0.35,
});

/**
 * Миниатюрная подвеска (~12 см) для скрытого предмета волны B: тонкое кольцо-
 * цепочка (Torus) + капля-камень (вытянутая сфера) под ним. Золотистый материал с
 * лёгким emissive. Группа без теней (мелочь), издали неразличима.
 */
function makeNecklaceMesh(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16), NECKLACE_MAT);
  ring.rotation.x = Math.PI / 2; // кольцо «висит» в вертикальной плоскости
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), NECKLACE_MAT);
  drop.scale.set(1, 1.5, 1); // лёгкая капля
  drop.position.y = -0.06;
  g.add(ring, drop);
  return g;
}

/** Освободить геометрии группы при снятии меша из сцены (материал общий — не трогаем). */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) m.geometry.dispose();
  });
}

/**
 * Команда по архетипу для квестового фильтра убийств (Фаза 6B): событие
 * enemy:died не несёт team. ARCHETYPES знает NPC-цели (skeleton_raider/brute →
 * villain, guard_* → guard); манекены/стражи форта (Skeleton: skeleton_minion/
 * rogue/warrior) в ARCHETYPES нет — для них фоллбэк по префиксу «skeleton».
 */
function teamOfArchetype(archetype: string): string {
  const def = ARCHETYPES[archetype];
  if (def) return def.team;
  return archetype.startsWith('skeleton') ? 'villain' : 'guard';
}

export class Game {
  readonly assets = new AssetLoader();
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera!: THREE.PerspectiveCamera;
  physics!: PhysicsWorld;
  input = new Input();
  terrain!: Terrain;
  player!: PlayerCharacter;
  rig!: CameraRig;
  village!: Village;
  /** НЕбоевые жители деревни с сайд-квестами (Фаза 6B): диалог по [E]. */
  villagers!: Villagers;
  forest!: Forest;
  /** Скальная паркур-трасса на горной стене: выступы → пещера с epic-сундуком. */
  parkour!: Parkour;
  /** Декоративные водоёмы (Фаза 5.5): 2–3 пруда в природных низинах. */
  ponds!: Ponds;
  /** Большие озёра в пустых зонах (Фаза 6D, волна 1): задел под лодку волны 2. */
  lakes!: Lakes;
  /** Лодка у главного озера (Фаза 6D, волна 2): причал + физика скольжения. */
  boat!: Boat;
  /** Игрок в лодке: контроллер/коллайдер игрока отключены, камера ведёт лодку. */
  private riding = false;
  /** Глубина воды в точке (waterY − рельеф) — для границ лодки/предиката высадки. */
  private boatDepthAt!: DepthFn;
  /** Показан ли промпт «[E] — сесть в лодку» (чтобы не дёргать HUD каждый кадр). */
  private boardPromptShown = false;
  /** Таймер проверки близости к лодке для промпта посадки, с. */
  private boatPromptTimer = 0;
  /** Лендмарки (Фаза 6.5): детали-заполнители пустот + мини-POI. */
  landmarks!: Landmarks;
  /** Водопад у ручья (волна B): сид-независимый POI у горного кольца. */
  waterfall!: Waterfall;
  /** Локации на концах 4 дорог (волна B+): постоялый двор/лесничество/мельница/застава. */
  roadEnds!: RoadEnds;
  /** Мировые NPC-квестодатели (волна B): отшельник/лесник/рыбак/квартирмейстер. */
  worldNpcs!: WorldNpcs;
  /** Логово злодея (Фаза 5): сектор спавна волн и стражи-манекены. */
  fortPos = { x: 0, z: 0 };

  seed = 42;
  autotest = false;
  /** noraids=1 — без автозапуска набегов И корованов (смоуки); __game.spawnRaid/spawnCaravan работают всегда. */
  noraids = false;
  /** seed задан явно через ?seed=… — тогда сейв НЕ перебивает его (для смоуков). */
  private seedExplicit = false;
  /** Сейв, прочитанный main.ts ДО init: его seed уже учтён, остальное применит меню. */
  private pendingSave: SaveData | null = null;

  // Бой (Фаза 3)
  hud!: Hud;
  coins = 0;
  xp = 0;
  /** Боезапас стрел арбалета. 0 — выстрел не происходит, подсказка «Нет стрел». */
  arrows = ARROWS_START;

  /** Жар дворца (Фаза 5): растят грабежи (CaravanDirector), остужает фикс-шаг здесь. */
  readonly heat = makeHeat();

  // --- Персонаж Фазы 6: инвентарь / перки / уровень / прогресс забега ---
  /** Сумка + экипировка игрока. Заменяется целиком при загрузке сейва. */
  inventory: Inventory = makeInventory();
  /** Состояние талантов (взятые перки + свободные очки). */
  perkState: PerkState = makePerkState();
  /** Состояние сайд-квестов жителей (Фаза 6B). Заменяется целиком при загрузке сейва. */
  questState: QuestState = makeQuestState();
  /** Текущий уровень (из xp). Кэш, чтобы ловить пересечение порога для баннера. */
  level = 1;
  /** Награда таблички «Точки над AI» забрана (зеркалит TelegramSign для сейва). */
  tgRewarded = false;
  /** Подобран ли скрытый предмет в лесу (волна B) — один раз за забег, в сейв. */
  necklaceFound = false;
  /** Наигранное время забега, с (для сейва/статистики). */
  playedSec = 0;
  /** Сундуки (Фаза 6): 15 точек, лут, состояние открытия для сейва. */
  chests = new Chests();
  /** Остаток баффа зелья прыти, с (0 — нет баффа). */
  private swiftLeft = 0;
  /** Множитель скорости активного зелья прыти. */
  private swiftMul = 1;
  /** Бафф «Благословение источника» (Фаза 6B): фонтан-бафф, в сейв НЕ пишется. */
  private readonly blessing = makeBlessing();
  /** Накопитель регена HP от баффа источника (целые ед/с применяем по порогу). */
  private blessingHpAcc = 0;
  /** Ключ HUD-чипа баффа источника (целые секунды) — гейт перерисовки таймера. */
  private blessingChipKey = -1;
  /** Наёмные стражники деревни (Фаза 6B): village_guard, патрулируют кольцо. */
  private readonly hiredGuards = new HiredGuards();
  /**
   * Индекс корована, о котором трактирщик уже рассказал (caravanIndexHint): пока
   * не выехал следующий, повторное угощение даёт «я уже всё рассказал». -1 — ещё
   * никому не сливал слух в этот цикл расписания.
   */
  private rumorToldFor = -1;
  /** Уровень, для которого последний раз показан баннер (чтобы не дублировать). */
  private lastLevelShown = 1;
  /** Таймер автосейва, с. */
  private autosaveLeft = AUTOSAVE_PERIOD;
  /** Открыт ли модальный экран (инвентарь/перки): игровой ввод/лок замораживаются. */
  private screenOpen = false;
  /** Текущее милишное/дальнее оружие игрока (из экипировки, иначе дефолт). */
  private playerMelee = DEFAULT_MELEE;
  private inventoryScreen!: InventoryScreen;
  private perkScreen!: PerkScreen;
  private shopScreen!: ShopScreen;
  /** Карта мира (Фаза 6B волна C): оверлей по клавише Tab. */
  private worldMap!: WorldMap;
  /** Кэш снимка мира для карты — строится один раз после готовности мира. */
  private mapSnapshot: WorldSnapshot | null = null;
  /** Экран диалога с жителем (Фаза 6B). */
  private dialogScreen!: DialogScreen;
  /** id жителя, с которым открыт диалог (для выбора реплик/действий). */
  private dialogVillager: VillagerId | null = null;
  /** Таймер проверки близости жителя для [E]-промпта, с. */
  private villagerCheckLeft = 0;
  /** Кэш ключа промпта жителя — чтобы не перерисовывать каждый кадр. */
  private villagerPromptKey = '';
  /** Идёт ли набег для жителей (прячутся) — кэш, чтобы не дёргать setRaiding каждый кадр. */
  private villagersRaiding = false;
  /** Таймер проверки близости мирового NPC для [E]-промпта, с. */
  private worldNpcCheckLeft = 0;
  /** Кэш ключа промпта мирового NPC — гейт перерисовки. */
  private worldNpcPromptKey = '';
  /** Меш скрытого ожерелья на стволе (волна B); null — лес пуст/уже подобрано. */
  private necklaceMesh: THREE.Object3D | null = null;
  /** Точка ствола с ожерельем (для [E]-подбора вплотную). null — нет/подобрано. */
  private necklaceAt: { x: number; z: number } | null = null;
  /** Таймер проверки близости к ожерелью, с. */
  private necklaceCheckLeft = 0;
  /** Показан ли сейчас промпт подбора ожерелья — гейт перерисовки. */
  private necklacePromptShown = false;
  /** Координата лагеря охотника (POI) для странствующего торговца; null — нет POI. */
  private travelerAt: { x: number; z: number } | null = null;
  /** Активна ли сейчас лавка странствующего торговца (наценка), а не деревенская. */
  private shopMarkup = 1;
  /** Таймер проверки близости к торговцу у лагеря, с. */
  private travelerCheckLeft = 0;
  /** Показан ли промпт торговца — гейт перерисовки. */
  private travelerPromptShown = false;
  /** Таймер/гейт промпта трактирщика внутри постоялого двора (волна B+). */
  private innKeeperCheckLeft = 0;
  private innKeeperPromptShown = false;
  /** Таймер/гейт промпта мини-лавки внутри постоялого двора. */
  private innShopCheckLeft = 0;
  private innShopPromptShown = false;
  /** Таймер/гейт промпта «Осмотреться» на верхней площадке башни. */
  private towerCheckLeft = 0;
  private towerPromptShown = false;
  /** Таймер проверки осмотра POI для visit-квестов, с. */
  private visitCheckLeft = 0;
  /** Активные квесты, показанные в HUD последними (ключ строк) — гейт обновления. */
  private questHudKey = '';
  /** id квестов, бывших ready в прошлый updateQuestHud — для тоста «задание готово». */
  private readonly readyQuestIds = new Set<string>();
  private beltBar!: BeltBar;
  /** DOM-узел пояса зелий (.belt-bar): прячется вместе с HUD под меню/паузой. */
  private beltEl: HTMLElement | null = null;
  private mainMenu!: MainMenu;
  /** Экран загрузки (волна loading-errors): полоса/стадии, видимые ошибки. Создаёт
   *  main.ts ДО init и прокидывает сюда — фатальный catch зовёт его showError. */
  private loadingScreen: LoadingScreen | null = null;
  private pauseScreen!: PauseScreen;
  /**
   * Интро-заставка (Фаза 6C): кинематографичный облёт построенного мира под титры
   * из «ТЗ» Кирилла. Создаётся лениво при ПЕРВОМ «Играть»/«Новая игра», если её
   * ещё не видели (флаг korovany_intro_seen в localStorage). Пока playing — мир
   * заморожен (фикс-шаг стоит), HUD скрыт, игровой ввод выключен, камеру ведёт сама
   * заставка. По завершении/скипу — startGame продолжается. null — нет/уже сыграна.
   */
  private intro: IntroCinematic | null = null;
  /** Идёт ли сейчас заставка (кэш intro.playing — гейт ввода/паузы/камеры в tick). */
  private introPlaying = false;
  /** Игра «началась» (меню скрыто, мир активен). До этого ввод/таймеры заморожены. */
  private started = false;
  /**
   * Игра хоть раз стартовала в этой сессии (мир ожил). После этого «Продолжить»
   * из меню НЕ переприменяет pendingSave (он устарел с момента загрузки страницы,
   * см. баг №5(б)) — просто снимаем паузу/меню, мир уже идёт.
   */
  private hasEverStarted = false;
  /** На паузе: фикс-шаг (физика/AI/директора) не тикает, рендер-кадры идут. */
  private paused = false;
  /** Был ли pointer lock на момент входа в паузу — чтобы вернуть его на «Продолжить». */
  private wasPointerLocked = false;

  // Звук (Фаза 4.5): полностью процедурный, контекст — только после жеста
  audio!: AudioEngine;
  /** Снимок кадра для AudioEngine.frame — один объект, без аллокаций в tick. */
  private readonly audioInfo: AudioFrameInfo = {
    x: 0,
    y: 0,
    z: 0,
    speed: 0,
    grounded: true,
    verticalVel: 0,
    airJumped: false,
    landingVel: 0,
    inVillage: false,
    nearestSkeletonDist: Infinity,
  };
  /** Таймер скана ближайшего манекена (см. SKELETON_SCAN_PERIOD). */
  private skelScanLeft = 0;

  private composer!: EffectComposer;
  private stepper = new FixedStepper(60, 5);
  private sun!: THREE.DirectionalLight;
  private dynamicProps: DynamicProp[] = [];
  private lastTime = performance.now();
  private frameTimes: number[] = [];
  private elapsed = 0;
  /** Управление из смоук-тестов: __game.setMove(x, z, sprint) */
  private debugMove: { x: number; z: number; sprint: boolean } | null = null;
  /**
   * Счётчик нажатий прыжка между кадрами рендера и фикс-шагами (см. tick).
   * Именно СЧЁТЧИК, а не булев латч: двойной прыжок — это два отдельных нажатия
   * Space, и второе (в воздухе) не должно «съедаться» латчем первого. Каждый
   * фикс-шаг забирает один заряд; перебор за кадр распределяется по шагам.
   */
  private jumpQueued = 0;
  /**
   * Буфер клика атаки, с. Клик во время кулдауна/занятого аниматора не теряется:
   * латчим окно ~0.18 с и пробуем tryMelee каждый кадр, пока удар не пройдёт или
   * окно не истечёт. Бой ощущается отзывчивым — как буфер прыжка (jumpQueued).
   */
  private attackBuffer = 0;

  private combat!: CombatSystem;
  private ranged!: RangedAttack;
  private projectiles!: ProjectileSystem;
  private loot!: LootSystem;
  private ai!: AISystem;
  private raid!: RaidDirector;
  private caravans!: CaravanDirector;
  /** Декоративная фауна (Фаза 5.5): олени/лани/лисы на полянах. Не цели боя. */
  private fauna!: FaunaSystem;
  private critters: Critter[] = [];
  private skeletons: Skeleton[] = [];
  /** Точки спавна подвижной стражи лагеря — спавн villain_guard в initCombat. */
  private fortGuardSpots: FortGuardSpots | null = null;
  /** Якоря охраны замка злодея (ворота/двор/серпантин) — спавн NPC в initCombat. */
  private castleAnchors: CastleAnchors | null = null;
  private npcs: NpcCharacter[] = [];
  /** id NPC с 100 — не пересекаются с id манекенов (1..5) в милишном выборе целей. */
  private nextNpcId = 100;
  /** Поток случайности боя — отдельный от генерации мира при том же seed. */
  private combatRng: Rng = mulberry32(1);
  private aiming = false;
  /** Идёт ли набег (между raid:started и raid:ended): держит чип-индикатор HUD. */
  private raidActive = false;
  private lastHpShown = -1;
  /** Последний показанный в HUD опыт — гейт обновления XP-бара (как lastHpShown). */
  private lastXpShown = -1;
  /** Остаток респаун-неуязвимости, с; тикается в фикс-шаге. */
  private invulnLeft = 0;
  /** Капстоун «Второе дыхание» взят (читается в горячем чек-смерти без пересчёта модов). */
  private secondWindActive = false;
  /** Остаток кулдауна «Второго дыхания», с; пока >0 — спасение от смерти не сработает. */
  private secondWindCdLeft = 0;
  /** Капстоун «Пробивной болт»: стрелы игрока пробивают первую цель и бьют вторую. */
  private arrowPierce = false;
  /** Капстоун «Хозяин троп»: множитель цены покупки (<1 — скидка торговцев). */
  private buyMul = 1;
  /** Капстоун «Хозяин троп»: множитель цены продажи (>1 — наценка в пользу игрока). */
  private sellMul = 1;
  private tgSign!: TelegramSign;
  // Списки целей тика — переиспользуются (length = 0 + push), без аллокаций в кадре
  private readonly meleeTargets: (Skeleton | NpcCharacter)[] = [];
  private readonly arrowTargets: NpcTarget[] = [];
  /** Цели милишки + живая фауна (охота) — один свинг бьёт и врага, и зверя. */
  private readonly meleeAndHunt: CombatTarget[] = [];

  async init(container: HTMLElement, loadingScreen?: LoadingScreen): Promise<void> {
    this.loadingScreen = loadingScreen ?? null;
    this.parseFlags();

    // Прогресс ассетов → полоса загрузки. Подписываемся ДО первой загрузки (HDRI неба
    // в buildEnvironment) — иначе ранние завершения не попали бы в счётчик стадии.
    if (this.loadingScreen) {
      const ls = this.loadingScreen;
      this.assets.onProgress = (p) => ls.setProgress(p.completed, p.requested);
    }

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1600);

    // info.autoReset=false: композер делает несколько проходов, статистику
    // сбрасываем сами раз в кадр — иначе drawCalls показывает последний проход
    this.renderer.info.autoReset = false;
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new EffectPass(
        this.camera,
        new SMAAEffect(),
        new BloomEffect({ intensity: 0.3, luminanceThreshold: 0.95, mipmapBlur: true }),
        new VignetteEffect({ darkness: 0.42, offset: 0.28 }),
      ),
    );

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    this.loadingScreen?.setStage('Запускаем физику…');
    this.physics = await PhysicsWorld.create();
    this.input.attach(this.renderer.domElement);

    // Главное меню — ПОВЕРХ ещё чёрного/загружающегося мира: рисуем до build,
    // мир грузится в фоне, «Продолжить»/«Новая» применят сейв после init. Кнопки
    // «Играть»/«Продолжить» заблокированы («Загрузка…») до готовности мира —
    // включит markReady() в конце init (иначе нажатие «Играть» уходит в ещё
    // молчащий мир).
    const ui = document.getElementById('ui');
    if (!ui) throw new Error('#ui not found');
    this.mainMenu = new MainMenu(ui, {
      onContinue: () => this.continueFromMenu(),
      onNewGame: () => this.startGame(false),
    });
    this.mainMenu.setHasSave(this.pendingSave !== null);
    this.mainMenu.show();

    // Отдельный rng-поток звука: расход случайности синтеза не двигает мир/бой.
    // attach() ждёт первый НАСТОЯЩИЙ жест (pointerdown/keydown с isTrusted) —
    // до него AudioContext не существует, консоль остаётся чистой.
    this.audio = new AudioEngine(mulberry32(this.seed ^ 0xa0d10));
    this.audio.attach();

    await this.buildEnvironment();

    this.loadingScreen?.setStage('Снаряжаем героя…');
    const spawnY = this.terrain.height(SPAWN.x, SPAWN.z);
    this.player = await PlayerCharacter.create(
      this.physics,
      this.assets,
      new THREE.Vector3(SPAWN.x, spawnY + 0.2, SPAWN.z),
    );
    // Арбалет — во второй (левой) руке, всегда. Видимость поднимает прицеливание.
    await this.player.attachCrossbow(this.assets);
    this.scene.add(this.player.visual);
    this.rig = new CameraRig(this.camera, this.physics);

    // Облёт деревни за главным меню: уводим камеру с игрока на орбиту вокруг
    // центра деревни (мир уже отрисован за оверлеем). При старте игры rig плавно
    // вернёт камеру к игроку (~1 с). Если смоук-флаги стартуют сразу — startGame
    // ниже погасит орбиту, лишнего кадра облёта не будет.
    this.rig.startMenuOrbit(
      _menuOrbitCenter.set(VILLAGE.x, this.terrain.height(VILLAGE.x, VILLAGE.z), VILLAGE.z),
    );

    this.loadingScreen?.setStage('Оживляем обитателей…');
    await this.initCombat();

    installDebugApi(this);
    this.installLifecycleSave();
    this.installPauseListeners();
    this.renderer.setAnimationLoop(() => this.tick());

    // Мир готов: гасим полосу загрузки и включаем кнопки меню (markReady снимает
    // блок «Загрузка…» с «Играть»/«Продолжить»). Снимаем подписку прогресса —
    // дальнейшие ленивые догрузки (если будут) полосу больше не трогают.
    this.assets.onProgress = null;
    this.loadingScreen?.setStage('Готово!');
    this.loadingScreen?.setProgress(1, 1);
    this.loadingScreen?.hide();
    this.mainMenu.markReady();

    // Смоук-флаги (autotest/noraids) запускают игру СРАЗУ, минуя меню: прежние
    // смоук-доки (Фаза 3–5) не знают про экран старта, а ввод им идёт через __game.
    // Сейв при этом применяется как «Продолжить», иначе — чистый забег без стирания.
    if (this.autotest || this.noraids) this.startGame(this.pendingSave !== null);

    console.log('[game] init done, seed =', this.seed);
  }

  /** ?seed=…&autotest=1, с фоллбэком на localStorage.korovany_flags (превью не умеет менять URL). */
  private parseFlags(): void {
    const stored = localStorage.getItem('korovany_flags') ?? '';
    const params = new URLSearchParams(stored);
    for (const [k, v] of new URLSearchParams(location.search)) params.set(k, v);
    const seedParam = params.get('seed');
    if (seedParam) {
      this.seed = /^\d+$/.test(seedParam) ? Number(seedParam) : hashSeed(seedParam);
      this.seedExplicit = true;
    }
    this.autotest = params.get('autotest') === '1';
    this.noraids = params.get('noraids') === '1';

    // Сейв читаем ДО построения мира: его seed должен попасть в Game перед buildEnvironment,
    // чтобы «Продолжить» восстановило ту же деревню/форт/полянки. Явный ?seed= имеет
    // приоритет (смоуки фиксируют мир), иначе seed берётся из сейва.
    this.pendingSave = readSave(true); // warn один раз, если сейв битый
    if (this.pendingSave && !this.seedExplicit) this.seed = this.pendingSave.seed;
  }

  private async buildEnvironment(): Promise<void> {
    this.loadingScreen?.setStage('Поднимаем небо…');
    const sky = await this.assets.hdri('/assets/hdri/sky_day_2k.hdr');
    this.scene.environment = sky;
    this.scene.background = sky;
    this.scene.environmentIntensity = 0.65;
    this.scene.fog = new THREE.Fog(0xd6e4ec, 140, 750);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.far = 250;
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun, this.sun.target);

    this.loadingScreen?.setStage('Лепим ландшафт…');
    this.terrain = new Terrain({
      size: WORLD_SIZE,
      segments: 256,
      seed: this.seed,
      amplitude: 13,
      noiseScale: 150,
      flattenMask: flattenFactor,
      splat: {
        roads: ROADS,
        roadWidth: 9,
        plazas: [
          { x: VILLAGE.x, z: VILLAGE.z, r: 17 },
          { x: PALACE.x, z: PALACE.z, r: 30 },
        ],
      },
    });
    this.scene.add(await this.terrain.buildMesh(this.assets));
    this.terrain.buildCollider(this.physics);

    this.loadingScreen?.setStage('Строим деревню и дворец…');
    this.village = new Village();
    await this.village.build(this.scene, this.physics, this.assets, this.seed, this.terrain);
    // Жители деревни (Фаза 6B): 3 небоевых эльфа у домов/рынка с сайд-квестами.
    this.villagers = new Villagers();
    await this.villagers.build(this.physics, this.assets, this.seed, this.terrain);
    this.villagers.addToScene(this.scene);
    await new Palace().build(this.scene, this.physics, this.assets, this.terrain);

    // Логово злодея: место — детерминированный максимум рельефа в секторе [150..350]².
    // Считаем ДО леса — пруды (и их буфер у воды) выводимы из terrain+fort, лес
    // исключает кроны над водой по тем же местам.
    this.fortPos = findFortPos(this.terrain);

    this.loadingScreen?.setStage('Растим лес…');
    this.forest = new Forest();
    await this.forest.build(this.scene, this.physics, this.assets, this.seed, this.terrain, this.fortPos);

    this.loadingScreen?.setStage('Возводим логово злодея…');
    // Лагерь злодея: точки спавна подвижной стражи вернутся наружу, villain_guard
    // спавнятся в initCombat (нужен spawnNpc/AISystem) — больше никаких стоячих скелетов.
    this.fortGuardSpots = await new VillainFort().build(this.scene, this.physics, this.assets, this.terrain);

    // Замок злодея (пакет villain-castle): цитадель на плато в юго-восточном горном
    // кольце + серпантин-тропа (терраформинг в Terrain.CASTLE). Здания ставятся
    // здесь, охрана спавнится в initCombat по якорям (нужен spawnNpc/AISystem).
    this.castleAnchors = await new VillainCastle().build(this.scene, this.physics, this.assets, this.terrain);

    // Табличка «Точки над AI» у дороги возле спавна (интеракция обновляется в tick)
    this.tgSign = new TelegramSign(this.scene, this.physics, this.terrain);

    this.loadingScreen?.setStage('Расставляем лендмарки и локации…');
    // Водоёмы: 2–3 пруда в природных низинах (после форта — fortPos исключается из мест)
    this.ponds = new Ponds();
    await this.ponds.build(this.scene, this.assets, this.seed, this.terrain, this.fortPos);

    // Большие озёра в крупных пустых зонах (Фаза 6D, волна 1): котловины уже врезаны в
    // Terrain.height (carveLakes), коллайдер их подхватил — рендерим воду/берег. Места
    // сид-независимы (sim/lakes.LAKES), расчистка леса в isClear по кругам озёр уже
    // отработала выше (Forest зовёт isClear). Задел под лодку волны 2 — в lakes.infos.
    this.lakes = new Lakes();
    await this.lakes.build(this.scene, this.assets, this.seed, this.terrain);

    // Лодка у главного озера (Фаза 6D, волна 2): причал на мелководье NE-кромки
    // (BOAT_DOCK — детерминированная точка, см. sim/lakes), курс носа к центру озера.
    // Глубина для границ/высадки — Terrain.height против уровня глади озера (чистый
    // callback в sim/boat). Корпус — тонированные боксы (готовой модели нет).
    const lakeWaterY = boatDockWaterY();
    this.boatDepthAt = (x, z) => lakeWaterY - this.terrain.height(x, z);
    this.boat = new Boat(BOAT_DOCK.x, BOAT_DOCK.z, boatDockYaw(), lakeWaterY);
    this.scene.add(this.boat.visual);

    // Лендмарки (Фаза 6.5): детали-заполнители пустот + мини-POI. После прудов —
    // пирс ставится на берег самого крупного пруда (infos несут радиус).
    this.landmarks = new Landmarks();
    await this.landmarks.build(
      this.scene,
      this.physics,
      this.assets,
      this.seed,
      this.terrain,
      this.fortPos,
      this.ponds.infos.map((p) => ({ x: p.x, z: p.z, r: p.r })),
    );

    // Водопад у ручья (волна B): сид-независимый POI у горного кольца. Ручей тянем
    // к ближайшему пруду (infos несут радиус). ≤ +10 draw calls (проверяем drawCalls).
    this.waterfall = new Waterfall();
    await this.waterfall.build(
      this.scene,
      this.assets,
      this.terrain,
      this.ponds.infos.map((p) => ({ x: p.x, z: p.z, r: p.r })),
      this.physics,
    );

    // Локации на концах 4 дорог (волна B+): постоялый двор (интерьер + трактирщик +
    // мини-лавка), лесничество, мельница/ферма, сторожевая застава. Лесник/мельник/
    // дозорный встают у своих локаций (якоря отдаём в WorldNpcs).
    this.roadEnds = new RoadEnds();
    await this.roadEnds.build(this.scene, this.physics, this.assets, this.terrain);

    // Мировые NPC-квестодатели (волна B): отшельник у водопада, лесник у лесничества
    // (конец западной дороги), рыбак у пирса, квартирмейстер у дворца, мельник на
    // ферме и дозорный на заставе (концы дорог из roadEnds).
    const pier = this.landmarks.pois.find((p) => p.kind === 'pier') ?? null;
    this.worldNpcs = new WorldNpcs();
    await this.worldNpcs.build(
      this.scene,
      this.physics,
      this.assets,
      this.seed,
      this.terrain,
      pier ? { x: pier.x, z: pier.z } : null,
      this.roadEnds.npcAnchors,
    );
    this.worldNpcs.addToScene(this.scene);

    // Странствующий торговец у лагеря охотника (POI): запоминаем точку для [E]-лавки.
    const camp = this.landmarks.pois.find((p) => p.kind === 'hunter_camp') ?? null;
    this.travelerAt = camp ? { x: camp.x, z: camp.z } : null;

    // Скрытый предмет волны B: повесить «ожерелье» на ствол детерминированно
    // выбранной сосны в глухой чаще (не показывать нигде в текстах/маркерах).
    this.buildHiddenNecklace();

    this.loadingScreen?.setStage('Заселяем леса зверьём…');
    // Простая фауна на полянах леса (после форта — fortPos уже известен для исключения)
    await this.spawnFauna();

    // Сундуки (Фаза 6): после прудов/форта — их центры уточняют 2+1 точки
    await this.chests.build(
      this.scene,
      this.physics,
      this.assets,
      this.seed,
      this.terrain,
      this.ponds.infos.map((p) => ({ x: p.x, z: p.z })),
      this.fortPos,
    );

    // Скальная паркур-трасса на горной стене (паркур-редизайн): выступы, врезанные в
    // склон вала, ведут к пещере с epic-сундуком. Призовой сундук ставит Game по
    // caveChest() — он садится на пол кармана пещеры (terrain.height = пол пещеры).
    // Холмы на пустых полянах (hills-parkour): высота уже подмешана в Terrain.height,
    // поэтому деревья/дороги сели на новый рельеф автоматически. Все 4 холма пологие,
    // на вершине — rare-сундук. Сундуки регистрируем ПОСЛЕ chests.build (addChest
    // требует готовый build).
    this.parkour = new Parkour();
    await this.parkour.build(this.scene, this.physics, this.assets, this.terrain);
    const cave = caveChest();
    this.chests.addChest(cave.x, cave.z, 'epic');
    for (const hill of HILLS) {
      this.chests.addChest(hill.cx, hill.cz, 'rare');
    }
  }

  /**
   * Спавн декоративной фауны (Фаза 5.5): детерминированный набор полян от seed,
   * звери приклеены к высоте террейна. FaunaSystem собирается на готовом массиве.
   */
  private async spawnFauna(): Promise<void> {
    // Свободно ли место под зверя: общий isClear (вне деревни/дворца/дорог/стены)
    // + не во дворе форта. margin 2 — поляна, а не вплотную к дереву/камню.
    const clear = (x: number, z: number): boolean =>
      isClear(x, z, 2) && Math.hypot(x - this.fortPos.x, z - this.fortPos.z) > FAUNA_FORT_CLEAR;

    const spawns = planFaunaSpawns(this.seed, FAUNA_HALF_EXTENT, clear);
    for (const s of spawns) {
      const critter = await Critter.create(
        this.physics,
        this.assets,
        new THREE.Vector3(s.x, this.terrain.height(s.x, s.z), s.z),
        s.species,
        this.critters.length,
        (hx, hz) => this.terrain.height(hx, hz),
        Math.atan2(s.x - this.fortPos.x, s.z - this.fortPos.z), // мордой от форта — произвольно, но детерминированно
      );
      this.scene.add(critter.visual);
      this.critters.push(critter);
    }

    // Отдельный rng-поток мозгов фауны: расход случайности пастьбы/блуждания
    // не двигает мир/бой/набеги при том же seed.
    this.fauna = new FaunaSystem(this.critters, mulberry32(this.seed ^ 0xfa00a));
  }

  private async initCombat(): Promise<void> {
    const ui = document.getElementById('ui');
    if (!ui) throw new Error('#ui not found');
    this.hud = new Hud(ui);
    // HUD не наслаивается на меню: пока открыто главное меню (init.show), прячем
    // весь игровой интерфейс. startGame покажет его обратно при входе в игру.
    if (this.mainMenu.visible) this.hud.setVisible(false);
    this.hud.setHp(this.player.hp, this.player.maxHp);
    this.hud.setAmmo(this.arrows);
    this.lastHpShown = this.player.hp;

    this.combatRng = mulberry32(this.seed ^ 0xdead);
    // Звук попадания — на каждую задетую цель; милишка бьёт вплотную, но rolloff
    // оставлен для симметрии с путём стрел
    this.combat = new CombatSystem(this.combatRng, (t) => {
      this.audio.sfx.hitThud(this.audio.rolloffAt(t.feet.x, t.feet.y, t.feet.z));
    });
    this.ranged = new RangedAttack(DEFAULT_CROSSBOW);
    this.projectiles = new ProjectileSystem(this.scene, this.physics);
    this.loot = new LootSystem(this.scene, this.physics);
    this.ai = new AISystem(this.physics, this.projectiles, this.combatRng);
    // Отдельный rng-поток набегов: расход боевой случайности не должен
    // менять планы волн при том же seed
    this.raid = new RaidDirector(
      this.hud,
      mulberry32(this.seed ^ 0x4a1d),
      (id, x, z, yaw) => this.spawnNpc(id, x, z, yaw),
      !this.noraids,
      this.heat,
      this.fortPos,
      () => this.houseTally(),
    );
    // Отдельный rng-поток корованов — по той же причине, что и у набегов.
    // Эскорт идёт через общий spawnNpc: попадает в npcs (цели, killAllEnemies).
    this.caravans = new CaravanDirector(
      this.hud,
      mulberry32(this.seed ^ 0xc0a7),
      this.heat,
      (id, x, z, yaw) => this.spawnNpc(id, x, z, yaw),
      (plan, path, s0, s1) =>
        Caravan.create(this.physics, this.assets, this.scene, plan, path, s0, s1, (hx, hz) =>
          this.terrain.height(hx, hz),
        ),
      (x, y, z, coins) => this.loot.spawnCoins(_dropPos.set(x, y, z), coins, this.combatRng),
      (xp) => {
        this.xp += xp;
      },
      !this.noraids,
    );
    await Promise.all([this.projectiles.init(this.assets), this.loot.init(this.assets)]);

    await this.spawnTrainingDummies();
    // Подвижная стража лагеря и замка злодея: спавн через spawnNpc (NpcCharacter +
    // AISystem-патруль) — попадают в npcs (цели/killAllEnemies), а не в стоячие манекены.
    await this.spawnVillainGuards();
    bus.on('enemy:died', (e) => this.onEnemyDied(e));

    // UI Фазы 6: экраны инвентаря/перков, пояс зелий, главное меню.
    this.buildScreens(ui);

    // Автосейв по событиям мира: грабёж/отбитый набег/левел-ап (сундук — в его update).
    bus.on('caravan:robbed', (e) => this.onCaravanRobbed(e.tier));
    bus.on('raid:ended', (e) => this.onRaidEnded(e));
    bus.on('player:levelup', () => this.saveNow());
    // Важные события — заметным ТОСТОМ (карточка-пергамент вверху центр-справа):
    // корован выехал, дом разрушен. Восстановление дома — второстепенное, в тикер.
    bus.on('caravan:spawned', () => this.hud.showToast('⚔', 'Корован выехал из дворца'));
    bus.on('house:destroyed', () => this.hud.showToast('⚔', 'Скелеты разрушили дом!'));
    bus.on('house:repaired', () => this.hud.showTicker('Дом восстановлен', 3.5));

    // Явная подача набега: чип-индикатор «⚔ НАБЕГ НА ДЕРЕВНЮ» на время
    // набега (колокол на raid:started звучит в AudioEngine). Урон по дому — красный
    // пульс по краям экрана (Hud сам антиспамит, чтобы не мигать на каждый удар).
    bus.on('raid:started', () => {
      this.raidActive = true;
      this.hud.showRaidChip();
    });
    bus.on('house:damaged', () => {
      if (this.raidActive) this.hud.houseDamageFlash();
    });

    // Применить дефолтную экипировку к статам/мешу/поясу (на случай старта без сейва).
    void this.applyEquipment();
    this.refreshBelt();
    this.recomputeLevel(false);
  }

  /** Экраны инвентаря/перков + пояс зелий + меню; колбэки замыкают игровой ввод. */
  private buildScreens(ui: HTMLElement): void {
    this.beltBar = new BeltBar(ui);
    // Узел пояса зелий — чтобы прятать его вместе с HUD под меню/паузой (BeltBar
    // живёт отдельно от host HUD). Берём последний .belt-bar, добавленный выше.
    const belts = ui.querySelectorAll<HTMLElement>('.belt-bar');
    this.beltEl = belts.length > 0 ? belts[belts.length - 1]! : null;
    if (this.mainMenu.visible) this.setHudVisible(false);

    this.inventoryScreen = new InventoryScreen(ui, {
      onEquip: (i) => this.onEquipSlot(i),
      onUse: (i) => this.onUseSlot(i),
      onDrop: (i) => this.onDropSlot(i),
      onUnequip: (key) => this.onUnequip(key),
      onOpenPerks: () => {
        this.inventoryScreen.hide();
        this.openPerks();
      },
      onShow: () => this.onScreenShow(),
      onHide: () => this.onScreenHide(),
    });

    this.perkScreen = new PerkScreen(ui, {
      onUnlock: (id) => this.onUnlockPerk(id),
      onShow: () => this.onScreenShow(),
      onHide: () => this.onScreenHide(),
    });

    this.shopScreen = new ShopScreen(ui, {
      onBuy: (id) => this.onShopBuy(id),
      onSell: (i) => this.onShopSell(i),
      onShow: () => this.onScreenShow(),
      onHide: () => this.onScreenHide(),
    });

    // Диалог жителя (Фаза 6B): клик по варианту делает Game (взять/сдать/уйти).
    this.dialogScreen = new DialogScreen(ui, {
      onChoose: (action) => this.onDialogChoose(action),
      onShow: () => this.onScreenShow(),
      onHide: () => this.onScreenHide(),
    });

    // Карта мира (Фаза 6B волна C): блокирует ввод как I/P, рисуется по снимку мира.
    this.worldMap = new WorldMap(ui, {
      onShow: () => this.onScreenShow(),
      onHide: () => this.onScreenHide(),
    });

    // Экран паузы (Фаза 6.5): «Продолжить» снимает паузу, «В главное меню» —
    // показывает главное меню поверх (игра остаётся на паузе под ним).
    this.pauseScreen = new PauseScreen(ui, {
      onResume: () => this.resumeGame(),
      onMainMenu: () => this.openMainMenuFromPause(),
    });
    // MainMenu уже создан и показан в init (поверх загрузки мира).
  }

  /**
   * Деревянные тренировочные манекены тира у стрельбища (Village ставит его рядом).
   * Раньше тут стоял ряд из 5 скелетов — игрок читал его как «строй нежити». Теперь
   * это полукруг из 3 манекенов-столбов + 2 мишени-стойки подальше (раскладка в
   * world/TrainingRange.ts). id 1-5 и архетипы (HP/счёт) сохранены: TrainingDummy
   * структурно совместим со Skeleton, поэтому стрельба/милишка/слух «о тире» те же.
   */
  private async spawnTrainingDummies(): Promise<void> {
    const archetypes: SkeletonArchetype[] = [
      'skeleton_minion',
      'skeleton_rogue',
      'skeleton_warrior',
      'skeleton_minion',
      'skeleton_rogue',
    ];
    // Якорь тира и направление «к деревне» — полукруг развёрнут к стрелку.
    const ax = VILLAGE.x + 38;
    const az = VILLAGE.z - 12;
    const baseYaw = Math.atan2(VILLAGE.x - ax, VILLAGE.z - az);
    const sin = Math.sin(baseYaw);
    const cos = Math.cos(baseYaw);
    const layout = trainingDummyLayout(archetypes.length);
    for (let i = 0; i < archetypes.length; i++) {
      const slot = layout[i]!;
      // Локальные смещения раскладки → мир: поворот на baseYaw вокруг вертикали.
      const x = ax + slot.dz * sin + slot.dx * cos;
      const z = az + slot.dz * cos - slot.dx * sin;
      const d = await TrainingDummy.create(
        this.physics,
        this.assets,
        new THREE.Vector3(x, this.terrain.height(x, z), z),
        archetypes[i]!,
        i + 1,
        baseYaw + slot.yaw, // мишенью к стрелку + разброс из раскладки
        slot.kind,
      );
      this.scene.add(d.visual);
      // TrainingDummy дублирует весь публичный рантайм-протокол Skeleton (id/hp/
      // alive/feet/takeDamage/update/dispose/corpseTimer/visual/body/collider), но
      // наследует Character, а не Skeleton (у того приватный конструктор). protected
      // onDeath из разных классов рвёт номинальную совместимость — поэтому каст. Все
      // потребители this.skeletons трогают только перечисленный публичный протокол.
      this.skeletons.push(d as unknown as Skeleton);
    }
  }

  /**
   * Подвижная стража злодея (пакет villain-castle): 2 villain_guard вокруг палаток
   * лагеря (вместо стоячих скелетов) + гарнизон замка по якорям VillainCastle —
   * 2 villain_elite у ворот, 4 villain_guard парами на серпантине, 4 villain_guard
   * патруль двора. Спавн через spawnNpc → NpcCharacter + AISystem (патруль ~10 м
   * вокруг точки спавна, агрятся на игрока по восприятию). С толпой ~10 стражей и
   * их HP (220/380) локация сознательно почти непобедима до прокачки игрока.
   */
  private async spawnVillainGuards(): Promise<void> {
    // Лагерь: 2 подвижных стража у палаток (замена id 6-7 скелетов).
    const camp = this.fortGuardSpots;
    if (camp) {
      for (const g of camp.guards) await this.spawnNpc('villain_guard', g.x, g.z, g.faceYaw);
    }
    this.fortGuardSpots = null;

    // Замок: элита у ворот, рядовые на серпантине и во дворе. Локальные сдвиги от
    // якорей (ворота/двор) считаем по faceYaw — пары встают по бокам точки.
    const c = this.castleAnchors;
    if (!c) return;
    const fwdX = Math.sin(c.faceYaw);
    const fwdZ = Math.cos(c.faceYaw);
    const rightX = Math.cos(c.faceYaw);
    const rightZ = -Math.sin(c.faceYaw);
    // 2 элиты у ворот: лицом наружу (к выходу тропы), по бокам от оси ворот.
    for (const dx of [-3, 3]) {
      const gx = c.gate.x + rightX * dx;
      const gz = c.gate.z + rightZ * dx;
      await this.spawnNpc('villain_elite', gx, gz, c.faceYaw);
    }
    // 4 рядовых парами на серпантине (по 2 у каждого поста, лицом вниз к тропе).
    const downYaw = c.faceYaw + Math.PI; // вниз по тропе (наружу от замка)
    for (const post of c.trailPosts) {
      for (const dx of [-2, 2]) {
        await this.spawnNpc('villain_guard', post.x + dx, post.z, downYaw);
      }
    }
    // 4 рядовых патруль двора: по углам внутреннего квадрата вокруг центра.
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) {
      const px = c.courtyard.x + rightX * dx + fwdX * dz;
      const pz = c.courtyard.z + rightZ * dx + fwdZ * dz;
      await this.spawnNpc('villain_guard', px, pz, Math.atan2(c.courtyard.x - px, c.courtyard.z - pz));
    }
  }

  private onEnemyDied(e: GameEvents['enemy:died']): void {
    this.xp += e.xp;
    // У архетипа без таблицы (skeleton_warrior) — разумный фоллбэк монетами.
    const drops = LOOT_TABLES[e.archetype]
      ? rollLoot(e.archetype, this.combatRng)
      : [{ itemId: 'coins', count: randInt(this.combatRng, 5, 15) }];
    let coins = 0;
    for (const d of drops) {
      if (d.itemId === 'coins') coins += d.count;
      // Предметы (зелья/оружие/броня) — СРАЗУ в инвентарь (на земле не дропаем,
      // упрощение Фазы 6); монеты остаются физикой ради «фонтана».
      else this.collectItem(d.itemId, d.count);
    }
    if (coins > 0) {
      this.loot.spawnCoins(_dropPos.set(e.pos.x, e.pos.y, e.pos.z), coins, this.combatRng);
    }
    // Арбалетчики дворца роняют 3-5 стрел — начисляем сразу (упрощение: без подбора
    // с земли, как монеты). Тикер показывает прибыль, HUD-счётчик обновляется.
    if (e.archetype === 'guard_crossbow') {
      const got = randInt(this.combatRng, ARROWS_DROP_MIN, ARROWS_DROP_MAX);
      const before = this.arrows;
      this.arrows = addArrows(this.arrows, got);
      const added = this.arrows - before;
      if (added > 0) {
        this.hud.setAmmo(this.arrows);
        this.hud.showTicker(`+${added} стрел`, 2.5);
      }
    }
    // Сайд-квест «убей N» (Фаза 6B): засчитываем убийство villain-цели. Команда
    // выводится из архетипа (skeleton_* — villain; событие team не несёт). Прогресс
    // изменился — обновляем строку квеста в HUD.
    if (recordKill(this.questState, e.archetype, teamOfArchetype(e.archetype))) {
      this.updateQuestHud();
    }
    // Опыт мог пересечь порог уровня — проверяем и баннерим.
    this.recomputeLevel(true);
  }

  /**
   * Положить предмет в инвентарь с тикером. Переполнен — предмет пропадает
   * (упрощение Фазы 6, отмечено в смоук-доке), тикер «инвентарь полон».
   */
  private collectItem(itemId: string, count: number): void {
    const def = ITEMS[itemId];
    if (!def) return; // неизвестный id (виртуальный 'coins' сюда не попадает)
    const left = addItem(this.inventory, itemId, count);
    const got = count - left;
    if (got > 0) {
      this.hud.showTicker(`+${got} ${def.name}`, 2.5);
      this.refreshBelt();
      this.refreshInventoryIfOpen();
    }
    if (left > 0) this.hud.showTicker('Инвентарь полон', 2.5);
  }

  /** Грабёж корована: royal сверх монет кладёт 1–2 предмета прямо в инвентарь. */
  private onCaravanRobbed(tier: string): void {
    if (tier === 'royal') {
      // Тринкет/латы/royal-меч — по таблице caravan_royal, но БЕЗ монет (их уже выдал директор).
      const drops = rollLoot('caravan_royal', this.combatRng, randInt(this.combatRng, 1, 2));
      for (const d of drops) {
        if (d.itemId !== 'coins') this.collectItem(d.itemId, d.count);
      }
    }
    this.saveNow();
  }

  // ---- Сайд-квесты жителей (Фаза 6B) ----

  /**
   * [E]-диалог с ближайшим жителем (вызывается из tick по близости + нажатию E).
   * Открывает DialogScreen с репликой по состоянию квеста этого жителя (dialogFor):
   * предложить/показать прогресс/сдать. Звук — лёгкая тарабарщина на открытие.
   */
  private openVillagerDialog(id: VillagerId): void {
    this.dialogVillager = id;
    this.hud.hidePrompt();
    this.dialogScreen.open(this.dialogContentFor(id));
    // Дёрнуть существующую болтовню стражи (человеческий тембр) на открытие реплики.
    this.audio.voice.bark('guard', 0);
  }

  /** Собрать реплику и кнопки для жителя по текущему состоянию его квеста. */
  private dialogContentFor(id: VillagerId): DialogContent {
    const who = VILLAGERS[id];
    // have — что в сумке для deliver-получателя (реплика «принеси ещё N» считается
    // по нему); для остальных ролей не используется. Цель возможного квеста узнаём
    // первым проходом dialogFor (have=0), затем считаем недобор и зовём ещё раз.
    const peek = dialogFor(this.questState, id);
    const peekDef = peek.id ? QUESTS[peek.id] : undefined;
    const have = peekDef?.goal.kind === 'deliver' ? countItem(this.inventory, peekDef.goal.target) : 0;
    const { id: questId, role, remaining } = dialogFor(this.questState, id, have);
    const def = questId ? QUESTS[questId] : undefined;
    const leave = { label: 'Уйти', action: 'leave' as DialogAction };

    let text: string;
    const options: DialogContent['options'] = [];
    switch (role) {
      case 'ready':
        text = def?.doneText ?? 'Дело сделано!';
        options.push({ label: 'Готово — сдать', action: 'turnin', primary: true }, leave);
        break;
      case 'active':
        // Получатель deliver-квеста с недобором предметов просит донести остаток —
        // а не отвечает общим «занят/ещё не готово» (раньше выдавал реплику «закончи
        // дело» вместо приёма посылки). remaining > 0 заполняет dialogFor по have.
        if (def?.goal.kind === 'deliver' && def.goal.deliverTo === id && remaining && remaining > 0) {
          text = `Принёс не всё. Донеси ещё ${remaining} — тогда и приму.`;
        } else {
          text = def?.progressText ?? 'Ещё не готово.';
        }
        options.push(leave);
        break;
      case 'offer':
        text = def?.offerText ?? 'Есть для тебя дело.';
        options.push({ label: 'Взять задание', action: 'take', primary: true }, leave);
        break;
      case 'full':
        // У жителя есть дело, но у игрока уже взято максимум квестов.
        text = 'У тебя и так дел по горло. Закончи что-нибудь — тогда и потолкуем.';
        options.push(leave);
        break;
      case 'wait':
        // Жителю есть что предложить позже (звено цепочки/повтор на кулдауне).
        text = 'Пока всё спокойно. Загляни попозже — найдётся работёнка.';
        options.push(leave);
        break;
      default:
        text = 'Доброго пути, странник. Покуда дел для тебя нет.';
        options.push(leave);
    }
    return { name: who.name, role: who.role, text, options };
  }

  /** Клик по варианту диалога: взять/сдать/уйти. Закрывает экран (кроме повторной реплики). */
  private onDialogChoose(action: DialogAction): void {
    const id = this.dialogVillager;
    if (action === 'leave' || !id) {
      this.dialogScreen.hide();
      return;
    }
    const { id: questId, role } = dialogFor(this.questState, id);
    if (action === 'take' && questId && role === 'offer') {
      if (takeQuest(this.questState, questId)) {
        bus.emit('quest:taken', { id: questId });
        const def = QUESTS[questId]!;
        this.hud.showToast('◈', `Задание взято: ${def.title}`);
        this.syncQuestCollect(); // collect-квест мог сразу иметь предметы в сумке
        this.updateQuestHud();
        this.saveNow();
      }
    } else if (action === 'turnin' && questId && role === 'ready') {
      this.completeQuest(questId);
    }
    this.dialogScreen.hide();
  }

  /** Сдать готовый квест: изъять collect-предметы, выдать награды, обновить HUD/сейв. */
  private completeQuest(questId: string): void {
    const def = QUESTS[questId];
    if (!def) return;
    // collect/deliver: изъять ровно count предметов из сумки (квест их «забирает»;
    // у deliver их отдают получателю — тоже списываем).
    if (def.goal.kind === 'collect' || def.goal.kind === 'deliver') {
      removeItem(this.inventory, def.goal.target, def.goal.count);
      this.refreshBelt();
      this.refreshInventoryIfOpen();
    }
    if (!turnInQuest(this.questState, questId)) return;
    // Награды: монеты + опыт (+ предмет у некоторых). Опыт может дать левел-ап.
    this.addCoins(def.reward.coins);
    this.xp += def.reward.xp;
    if (def.reward.item) this.collectItem(def.reward.item.id, def.reward.item.count);
    bus.emit('quest:completed', { id: questId, coins: def.reward.coins, xp: def.reward.xp });
    this.hud.showTicker(`Награда: +${def.reward.coins} монет, +${def.reward.xp} XP`, 3.5);
    // Финал цепочки мирового NPC (fortKey) — нейтральный тикер «шаг к логову»
    // (без прямого упоминания механики ключей). turnInQuest уже скопил ключ.
    if (def.fortKey) {
      const n = fortKeyCount(this.questState);
      this.hud.showTicker(`Ещё один шаг к логову злодея… (${n})`, 4);
    }
    this.recomputeLevel(true);
    this.updateQuestHud();
    this.saveNow();
  }

  /**
   * Пересчитать прогресс ВСЕХ активных collect-квестов по наличию их предметов в
   * сумке. Несколько квестов могут собирать разные (или один и тот же) предмет —
   * синкаем по каждому уникальному target ровно раз (countItem на target).
   */
  private syncQuestCollect(): void {
    let changed = false;
    const seen = new Set<string>();
    for (const id of this.questState.activeIds) {
      const def = QUESTS[id];
      if (!def || def.goal.kind !== 'collect') continue;
      const item = def.goal.target;
      if (seen.has(item)) continue; // syncCollect уже обработал все квесты на этот предмет
      seen.add(item);
      if (syncCollect(this.questState, item, countItem(this.inventory, item))) changed = true;
    }
    if (changed) this.updateQuestHud();
  }

  /**
   * Обновить список активных квестов в HUD (по изменению — без перерисовок
   * вхолостую). При переходе квеста в ready — тост «задание готово» (кроме
   * silent=true: тихая синхронизация при загрузке/сбросе только наполняет учёт
   * readyQuestIds, не тостит уже готовые квесты).
   */
  private updateQuestHud(silent = false): void {
    const views = activeQuestViews(this.questState);
    // Тост на КАЖДЫЙ квест, ставший ready с прошлого раза. Учёт ведём по id, чтобы
    // повторные апдейты (прогресс других квестов) не тостили снова то же готовое.
    for (const v of views) {
      if (v.ready && !this.readyQuestIds.has(v.id)) {
        this.readyQuestIds.add(v.id);
        if (!silent) this.hud.showToast('✔', `Задание готово: ${v.title}`);
      } else if (!v.ready && this.readyQuestIds.has(v.id)) {
        this.readyQuestIds.delete(v.id); // упал ниже цели (collect выбросили) — забываем
      }
    }
    // Сданные/исчезнувшие из активных — вычистить из учёта.
    for (const id of [...this.readyQuestIds]) {
      if (!views.some((v) => v.id === id)) this.readyQuestIds.delete(id);
    }
    const key = views.map((v) => `${v.id}:${v.progress}/${v.count}:${v.ready ? 1 : 0}`).join('|');
    if (key === this.questHudKey) return;
    this.questHudKey = key;
    this.hud.setQuestList(views);
    // Если открыт диалог с этим жителем — реплика могла стать «готово к сдаче».
    if (this.dialogScreen.visible && this.dialogVillager) {
      this.dialogScreen.open(this.dialogContentFor(this.dialogVillager));
    }
  }

  /**
   * [E]-интеракция с жителем: раз в QUEST_CHECK_PERIOD ищем ближайшего в радиусе
   * VILLAGER_TALK_DIST, показываем промпт «[E] Поговорить — Имя». Нажатие E у
   * жителя открывает диалог. Промпт не показываем, если уже открыт какой-то экран
   * или висит другой промпт (рынок/руина обрабатываются раньше и могут владеть им).
   * Возвращает true, если в этом кадре открыли диалог (чтобы вызывающий «съел»
   * [E] и не открыл заодно лавку при совпадении зон).
   */
  private updateVillagerInteract(dt: number, px: number, pz: number, interact: boolean): boolean {
    this.villagerCheckLeft -= dt;
    if (this.villagerCheckLeft <= 0) {
      this.villagerCheckLeft = QUEST_CHECK_PERIOD;
      const near = this.villagers.nearest(px, pz, VILLAGER_TALK_DIST);
      const key = near ? near.id : '';
      if (key !== this.villagerPromptKey) {
        this.villagerPromptKey = key;
        if (near) {
          this.hud.showPrompt(`[E] Поговорить — ${VILLAGERS[near.id].name}`);
        } else if (!this.dialogScreen.visible) {
          // Отошли от жителя: гасим промпт, но НЕ когда игрок в радиусе рынка —
          // там промптом «[E] Торговать» владеет updateMarket (не клобберим его).
          const nearMarket = Math.hypot(px - VILLAGE.x, pz - VILLAGE.z) <= MARKET_PROMPT_DIST;
          if (!nearMarket) this.hud.hidePrompt();
        }
      }
    }
    // Нажали E рядом с жителем — открыть диалог (свежий ближайший, не кэш промпта).
    if (interact && !this.dialogScreen.visible) {
      const near = this.villagers.nearest(px, pz, VILLAGER_TALK_DIST);
      if (near) {
        this.openVillagerDialog(near.id);
        this.villagerPromptKey = ''; // промпт скрыт диалогом — сбросим ключ
        return true;
      }
    }
    return false;
  }

  /**
   * Осмотр POI для активных visit-квестов: раз в QUEST_CHECK_PERIOD проверяем
   * дистанцию до POI (координаты — из Landmarks). Подошёл ближе VISIT_RADIUS к
   * месту нужного типа → засчитываем визит всем активным visit-квестам на этот
   * kind (квест в ready), обновляем HUD/сейв. Несколько visit-квестов параллельно.
   */
  private updateQuestVisit(dt: number, px: number, pz: number): void {
    // Есть ли хоть один активный visit-квест — иначе не сканируем POI вхолостую.
    let anyVisit = false;
    for (const id of this.questState.activeIds) {
      if (QUESTS[id]?.goal.kind === 'visit') {
        anyVisit = true;
        break;
      }
    }
    if (!anyVisit) return;
    this.visitCheckLeft -= dt;
    if (this.visitCheckLeft > 0) return;
    this.visitCheckLeft = QUEST_CHECK_PERIOD;
    let changed = false;
    for (const poi of this.landmarks.pois) {
      if (Math.hypot(px - poi.x, pz - poi.z) > VISIT_RADIUS) continue;
      // recordVisit засчитает осмотр всем активным visit-квестам на этот kind.
      if (recordVisit(this.questState, poi.kind)) changed = true;
    }
    if (changed) {
      this.hud.showTicker('Место осмотрено!', 2.5);
      this.updateQuestHud();
      this.saveNow();
    }
  }

  // ---- Мировые NPC-квестодатели (волна B): диалог + доставка ----

  /**
   * [E]-интеракция с мировым NPC (отшельник/лесник/рыбак/квартирмейстер): по образцу
   * жителя, та же квест-машина и общий DialogScreen. Перед открытием диалога у
   * получателя deliver-квеста засчитываем доставку (recordDeliver), чтобы реплика
   * сразу стала «готово к сдаче». Возвращает true, если открыли диалог (вызывающий
   * «съест» [E]). Идёт ПОСЛЕ деревенских жителей, ДО рынка/служб (NPC вне деревни,
   * пересечений зон нет, но E-приоритет держим).
   */
  private updateWorldNpcInteract(dt: number, px: number, pz: number, interact: boolean): boolean {
    this.worldNpcCheckLeft -= dt;
    if (this.worldNpcCheckLeft <= 0) {
      this.worldNpcCheckLeft = QUEST_CHECK_PERIOD;
      const near = this.worldNpcs.nearest(px, pz, VILLAGER_TALK_DIST);
      // У получателя активного deliver-квеста — засчитать доставку (если хватает
      // предметов в сумке): статус перейдёт в ready ещё до открытия реплики.
      if (near) this.syncDeliverAt(near.id);
      const key = near ? near.id : '';
      if (key !== this.worldNpcPromptKey) {
        this.worldNpcPromptKey = key;
        if (near) this.hud.showPrompt(`[E] Поговорить — ${VILLAGERS[near.id].name}`);
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (interact && !this.dialogScreen.visible) {
      const near = this.worldNpcs.nearest(px, pz, VILLAGER_TALK_DIST);
      if (near) {
        this.syncDeliverAt(near.id);
        this.openVillagerDialog(near.id);
        this.worldNpcPromptKey = '';
        return true;
      }
    }
    return false;
  }

  /**
   * Если среди активных есть deliver-квест(ы) с получателем npcId и в сумке набрано
   * нужное число их предмета — перевести такие квесты в ready (recordDeliver).
   * Обновляет HUD по факту перехода. Изъятие предметов — при сдаче (completeQuest).
   * Синкаем по каждому уникальному предмету доставки ровно раз.
   */
  private syncDeliverAt(npcId: VillagerId): void {
    let changed = false;
    const seen = new Set<string>();
    for (const id of this.questState.activeIds) {
      const def = QUESTS[id];
      if (!def || def.goal.kind !== 'deliver' || def.goal.deliverTo !== npcId) continue;
      const item = def.goal.target;
      if (seen.has(item)) continue; // recordDeliver уже обработал все квесты на этот предмет
      seen.add(item);
      if (recordDeliver(this.questState, npcId, countItem(this.inventory, item))) changed = true;
    }
    if (changed) {
      this.hud.showTicker('Посылка доставлена — поговори, чтобы сдать', 3);
      this.updateQuestHud();
      this.saveNow();
    }
  }

  // ---- Скрытый предмет в лесу (волна B): «ожерелье» на стволе ----

  /**
   * Повесить «Старинное ожерелье» (миниатюрная подвеска) на ствол детерминированно
   * выбранной сосны в глухой чаще. Если уже подобрано (сейв) или лес пуст — ничего
   * не строим. Меш — тонкое кольцо-цепочка + капля-камень, золотистый с лёгким
   * emissive; издали неразличим, [E]-подбор только вплотную. Маркеров нет.
   */
  private buildHiddenNecklace(): void {
    if (this.necklaceFound) return; // уже подобрано в этом забеге — не вешаем
    const pick = pickTreasureTree(this.forest.pineTrees);
    if (!pick) return;
    const { x, z } = pick.tree;
    const baseY = this.terrain.height(x, z);
    const mesh = makeNecklaceMesh();
    // Поднять к высоте глаз на ствол; чуть отступить «наружу» от центра ствола,
    // чтобы подвеска висела на коре, а не внутри меша дерева.
    mesh.position.set(x, baseY + TREASURE_HEIGHT, z + 0.32);
    this.scene.add(mesh);
    this.necklaceMesh = mesh;
    this.necklaceAt = { x, z: z + 0.32 };
  }

  /** Снять текущий меш ожерелья (если есть) и забыть точку — для пересборки/загрузки. */
  private clearNecklaceMesh(): void {
    if (this.necklaceMesh) {
      this.scene.remove(this.necklaceMesh);
      disposeObject(this.necklaceMesh);
      this.necklaceMesh = null;
    }
    this.necklaceAt = null;
    if (this.necklacePromptShown) {
      this.necklacePromptShown = false;
      this.hud.hidePrompt();
    }
  }

  /** Пересоздать ожерелье на дереве (новый забег): снять старый меш и повесить заново. */
  private respawnNecklace(): void {
    this.clearNecklaceMesh();
    this.buildHiddenNecklace();
  }

  /**
   * Согласовать меш ожерелья с загруженным сейвом: подобрано (necklaceFound) —
   * убрать меш; не подобрано — оно должно висеть (повесить, если меша нет).
   */
  private reconcileNecklace(): void {
    if (this.necklaceFound) {
      this.clearNecklaceMesh();
    } else if (!this.necklaceMesh) {
      this.buildHiddenNecklace();
    }
  }

  /**
   * [E]-подбор ожерелья: раз в QUEST_CHECK_PERIOD проверяем близость к стволу
   * (TREASURE_PICK_RADIUS — вплотную). Промпт «[E] Снять с дерева…» только вблизи;
   * нажатие — один раз: предмет в сумку, факт в сейв, меш убираем. Возвращает true
   * при подборе (вызывающий «съест» [E]).
   */
  private updateNecklacePickup(dt: number, px: number, pz: number, interact: boolean): boolean {
    if (!this.necklaceAt || !this.necklaceMesh) return false;
    this.necklaceCheckLeft -= dt;
    const near = Math.hypot(px - this.necklaceAt.x, pz - this.necklaceAt.z) <= TREASURE_PICK_RADIUS;
    if (this.necklaceCheckLeft <= 0) {
      this.necklaceCheckLeft = QUEST_CHECK_PERIOD;
      if (near !== this.necklacePromptShown) {
        this.necklacePromptShown = near;
        if (near) this.hud.showPrompt('[E] Снять с дерева');
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (near && interact) {
      this.pickUpNecklace();
      return true;
    }
    return false;
  }

  /** Подобрать ожерелье: в сумку, факт в сейв, убрать меш и сбросить промпт/точку. */
  private pickUpNecklace(): void {
    this.collectItem('old_necklace', 1);
    this.necklaceFound = true;
    this.clearNecklaceMesh();
    this.saveNow();
  }

  // ---- Странствующий торговец у лагеря охотника (волна B) ----

  /**
   * [E]-торговля у странствующего торговца (лагерь охотника): тот же ShopScreen, но
   * мини-ассортимент с наценкой ×1.25 (деревня выгоднее). Раз в QUEST_CHECK_PERIOD
   * проверяем близость; нажатие открывает лавку в профиле торговца. Возвращает true
   * при открытии лавки.
   */
  private updateTravelerInteract(dt: number, px: number, pz: number, interact: boolean): boolean {
    if (!this.travelerAt) return false;
    this.travelerCheckLeft -= dt;
    const near = Math.hypot(px - this.travelerAt.x, pz - this.travelerAt.z) <= TRAVELER_TALK_DIST;
    if (this.travelerCheckLeft <= 0) {
      this.travelerCheckLeft = QUEST_CHECK_PERIOD;
      if (near !== this.travelerPromptShown) {
        this.travelerPromptShown = near;
        if (near) this.hud.showPrompt('[E] Торговать');
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (near && interact && !this.shopScreen.visible) {
      this.openTravelerShop();
      this.travelerPromptShown = false;
      return true;
    }
    return false;
  }

  /**
   * Применить профиль лавки с учётом капстоунной скидки «Хозяин троп» (buyMul<1):
   * скидка вшивается и в shopMarkup (списание), и в config.markup (показ цен),
   * чтобы отображаемая и реальная цена покупки совпадали. base не мутируется.
   */
  private applyShopConfig(base: ShopConfig): void {
    const markup = base.markup * this.buyMul;
    this.shopMarkup = markup;
    this.shopScreen.configure(this.buyMul === 1 ? base : { ...base, markup });
  }

  /** Открыть лавку странствующего торговца (профиль с наценкой). */
  private openTravelerShop(): void {
    this.applyShopConfig(TRAVELER_SHOP);
    this.refreshShop();
    this.shopScreen.show();
  }

  // ---- Постоялый двор: трактирщик (слухи) + мини-лавка (волна B+) ----

  /**
   * Трактирщик под навесом на террасе постоялого двора: [E] угостить элем → слух о
   * следующем короване. Та же askTavernRumor, что раньше была у деревенского
   * трактирщика (он переехал сюда). Раз в QUEST_CHECK_PERIOD проверяем близость к
   * innKeeperPos. Возвращает true, если в этом кадре открыли реплику (вызывающий
   * «съест» [E]).
   */
  private updateInnKeeperInteract(dt: number, px: number, pz: number, interact: boolean): boolean {
    const at = this.roadEnds?.innKeeperPos;
    if (!at) return false;
    const near = Math.hypot(px - at.x, pz - at.z) <= INN_TALK_DIST;
    this.innKeeperCheckLeft -= dt;
    if (this.innKeeperCheckLeft <= 0) {
      this.innKeeperCheckLeft = QUEST_CHECK_PERIOD;
      if (near !== this.innKeeperPromptShown) {
        this.innKeeperPromptShown = near;
        if (near) this.hud.showPrompt(`[E] Угостить трактирщика элем — ${ALE_COST} монет`);
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (near && interact && !this.dialogScreen.visible) {
      this.askTavernRumor();
      this.innKeeperPromptShown = false;
      return true;
    }
    return false;
  }

  /**
   * Мини-лавка внутри постоялого двора: [E] «Торговать» (профиль двора с наценкой,
   * как у странствующего торговца, но свой заголовок). Раз в QUEST_CHECK_PERIOD
   * проверяем близость к innShopPos. Возвращает true при открытии лавки.
   */
  private updateInnShopInteract(dt: number, px: number, pz: number, interact: boolean): boolean {
    const at = this.roadEnds?.innShopPos;
    if (!at) return false;
    const near = Math.hypot(px - at.x, pz - at.z) <= INN_TALK_DIST;
    this.innShopCheckLeft -= dt;
    if (this.innShopCheckLeft <= 0) {
      this.innShopCheckLeft = QUEST_CHECK_PERIOD;
      if (near !== this.innShopPromptShown) {
        this.innShopPromptShown = near;
        if (near) this.hud.showPrompt('[E] Торговать');
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (near && interact && !this.shopScreen.visible) {
      this.applyShopConfig(INN_SHOP);
      this.refreshShop();
      this.shopScreen.show();
      this.innShopPromptShown = false;
      return true;
    }
    return false;
  }

  // ---- Сторожевая башня: [E]-«Осмотреться» на верхней площадке (волна B+) ----

  /**
   * Верхняя площадка сторожевой башни: подойдя к точке осмотра (на высоте площадки,
   * куда поднимаешься по спирали) и нажав [E], игрок получает бесплатную сводку —
   * ближайший корован (тир/направление, если едет; ETA, если ждёт) и активен ли
   * набег (lookoutSummary из CaravanDirector + raidActive). Близость считаем и по
   * горизонтали, и по высоте (точка наверху, а не у подножия). Возвращает true при
   * выдаче сводки (вызывающий «съест» [E]).
   */
  private updateTowerLookout(dt: number, px: number, py: number, pz: number, interact: boolean): boolean {
    const at = this.landmarks?.towerLookout;
    if (!at) return false;
    // Игрок должен стоять НАВЕРХУ: ноги в пределах ~2 м по высоте от площадки.
    const near = Math.hypot(px - at.x, pz - at.z) <= TOWER_LOOKOUT_DIST && Math.abs(py - (at.y - 0.2)) <= 2.0;
    this.towerCheckLeft -= dt;
    if (this.towerCheckLeft <= 0) {
      this.towerCheckLeft = QUEST_CHECK_PERIOD;
      if (near !== this.towerPromptShown) {
        this.towerPromptShown = near;
        if (near) this.hud.showPrompt('[E] Осмотреться');
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (near && interact) {
      const summary = lookoutSummary({
        active: this.towerActiveCaravan(),
        next: this.caravans.nextCaravanInfo(),
        raidActive: this.raidActive,
        tower: { x: at.x, z: at.z },
      });
      this.hud.showTicker(summary, 7);
      this.towerPromptShown = false;
      return true;
    }
    return false;
  }

  /** Активный корован на тракте для сводки башни (тир + позиция телеги) или null. */
  private towerActiveCaravan(): { tier: CaravanTier; x: number; z: number } | null {
    const info = this.caravans.debugInfo();
    if (!info) return null;
    return { tier: info.tier, x: info.pos.x, z: info.pos.z };
  }

  // ---- Лодка: посадка/высадка [E] и управление на воде (Фаза 6D, волна 2) ----

  /**
   * Промпт/интеракция лодки. На суше: подойдя к лодке (≤BOAT_BOARD_RADIUS) —
   * подсказка «[E] — сесть в лодку», по [E] — посадка (контроллер игрока выключен,
   * камера ведёт лодку). На воде: по [E] высаживаемся, если рядом есть валидный
   * берег (findDisembarkPoint), иначе тикер «подплыви к берегу». Возвращает true,
   * если [E] потреблён (как другие interact-методы — приоритет в цепочке).
   *
   * Зовётся ДО прочих [E] (лодка — отдельная точка у озера, зоны не пересекаются с
   * деревней/NPC), поэтому свой interact не делит ни с кем.
   */
  private updateBoatInteract(dt: number, px: number, pz: number, interact: boolean): boolean {
    if (!this.boat) return false;

    if (this.riding) {
      // На воде [E] — высадка. Промпт держим тихо (HUD занят управлением), но при
      // нажатии проверяем берег.
      if (interact) {
        const pt = findDisembarkPoint(this.boat.state, this.boatDepthAt);
        if (pt) {
          this.disembarkBoat(pt.x, pt.z);
        } else {
          this.hud.showTicker('Подплыви к берегу, чтобы выйти', 2.5);
        }
        return true;
      }
      return false;
    }

    // На суше: промпт по близости к лодке (раз в QUEST_CHECK_PERIOD, не каждый кадр).
    const near = canBoard(this.boat.state.x, this.boat.state.z, px, pz);
    this.boatPromptTimer -= dt;
    if (this.boatPromptTimer <= 0) {
      this.boatPromptTimer = QUEST_CHECK_PERIOD;
      if (near !== this.boardPromptShown) {
        this.boardPromptShown = near;
        if (near) this.hud.showPrompt('[E] — сесть в лодку');
        else if (!this.dialogScreen.visible) this.hud.hidePrompt();
      }
    }
    if (near && interact) {
      this.boardBoat();
      return true;
    }
    return false;
  }

  /** Посадка в лодку: выключаем контроллер игрока, прячем промпт, ведём камеру лодкой. */
  private boardBoat(): void {
    this.riding = true;
    this.boardPromptShown = false;
    this.hud.hidePrompt();
    this.aiming = false; // на воде не целимся
    // Капсула игрока остаётся на берегу (fixedUpdate пропускаем), визуал садим в лодку.
    this.seatPlayerInBoat();
  }

  /**
   * Высадка на берег: возвращаем игрока в точку (x,z) на суше (terrain.height сам
   * подберёт y), включаем контроллер, лодку оставляем на воде (где остановилась).
   */
  private disembarkBoat(x: number, z: number): void {
    this.riding = false;
    this.hud.hidePrompt();
    this.player.teleport(x, this.terrain.height(x, z) + 0.3, z);
    // Визуал игрока вернётся под контроллер в player.update следующего кадра.
  }

  /**
   * Инвариант сейва: при загрузке/новом забеге игрок НЕ в лодке, лодка — на причале.
   * Сейв не хранит состояние лодки (без миграции формата): если игрок сохранился
   * «в лодке», после загрузки он просто стоит там, куда applySave его телепортировал
   * (на берегу), а лодка возвращена к причалу. Зовётся из afterSaveApplied/resetRun.
   */
  private exitBoatToDock(): void {
    this.riding = false;
    this.boardPromptShown = false;
    if (this.boat) this.boat.resetToDock();
  }

  /**
   * Положить модель игрока на банку лодки. Считаем мировую точку сиденья вручную из
   * state (поворот локального seatLocal на курс лодки + позиция лодки на глади) —
   * не зависим от updateMatrixWorld (рендер ещё не прошёл в этом кадре).
   */
  private seatPlayerInBoat(): void {
    const s = this.boat.state;
    const sl = this.boat.seatLocal;
    const cos = Math.cos(s.yaw);
    const sin = Math.sin(s.yaw);
    // Поворот (x,z) на yaw вокруг Y (та же конвенция, что moveDirFromKeys/боат forward).
    const wx = sl.x * cos + sl.z * sin;
    const wz = -sl.x * sin + sl.z * cos;
    _seatWorld.set(s.x + wx, this.boat.visual.position.y + sl.y, s.z + wz);
    this.player.visual.position.copy(_seatWorld);
    this.player.visual.rotation.y = s.yaw;
  }

  /**
   * Показать/скрыть весь игровой HUD: основной интерфейс (host Hud) + пояс зелий
   * (BeltBar живёт отдельным узлом). Зовётся при открытии/закрытии меню и паузы —
   * под оверлеем игрового интерфейса не видно.
   */
  private setHudVisible(on: boolean): void {
    this.hud.setVisible(on);
    if (this.beltEl) this.beltEl.style.display = on ? '' : 'none';
  }

  // ---- Старт игры / меню (Фаза 6) ----

  /**
   * Запустить игру из меню. fromSave=true — «Продолжить» (применяем pendingSave),
   * иначе «Новая игра» (стираем сейв, чистый забег). Идемпотентно: повторный
   * вызов лишь применяет/сбрасывает состояние, мир уже построен.
   */
  startGame(fromSave: boolean): void {
    if (fromSave && this.pendingSave) {
      applySave(this, this.pendingSave);
    } else if (!fromSave) {
      // Новая игра: чистим сейв и состояние (мир/seed остаются — пересборка дорога).
      wipeSave();
      this.resetRun();
    }
    this.started = true;
    this.hasEverStarted = true;
    // Любой старт из меню снимает возможную «паузу под меню» (мир оживает).
    this.paused = false;
    this.audio.duck(false);
    this.audio.music.enterGameplay();
    this.pauseScreen.hide();
    this.mainMenu.hide();
    // Игра ожила: камера возвращается с орбиты к игроку (~1 с), HUD показан.
    // Смоук-старт (autotest/noraids) минует меню и сразу читает cameraPos —
    // возвращаем камеру мгновенно (snap), без переходного кадра облёта.
    this.rig?.stopMenuOrbit(this.autotest || this.noraids);
    this.setHudVisible(true);
    // Меню скрыто — синхронизируем HUD/HP с применённым состоянием.
    this.hud.setCoins(this.coins);
    this.lastHpShown = this.player.hp;
    this.hud.setHp(this.player.hp, this.player.maxHp);

    // Интро-заставка (Фаза 6C): один раз за браузер, при ПЕРВОМ запуске игры. Не
    // для «Продолжить» (fromSave — игрок уже видел мир), не в смоуках (им нужен
    // мгновенный геймплей и стабильный cameraPos). Мир уже построен — заставка его
    // и снимает; пока она идёт, мир заморожен и HUD скрыт (см. maybePlayIntro/tick).
    if (!fromSave && !this.autotest && !this.noraids) this.maybePlayIntro();
  }

  /** Доступ к localStorage с защитой от песочниц без storage (превью/приватный режим). */
  private introStorage(): IntroStorage | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  }

  /**
   * Запустить интро-заставку, если её ещё не видели (флаг korovany_intro_seen).
   * Создаёт IntroCinematic лениво, прячет HUD на время облёта и замораживает мир
   * (introPlaying гейтит фикс-шаг/ввод/обычную камеру в tick). По завершении/скипу
   * onIntroDone вернёт камеру к игроку и покажет HUD.
   */
  private maybePlayIntro(): void {
    const storage = this.introStorage();
    if (hasSeenIntro(storage)) return; // уже видели — сразу геймплей
    this.intro = new IntroCinematic(
      document.getElementById('ui')!,
      this.camera,
      (x, z) => this.terrain.height(x, z),
      storage,
      { onDone: () => this.onIntroDone() },
      // Закадровый рассказчик (Фаза 6D): прокидываем AudioEngine. Без сгенерированных
      // mp3 (репо до генерации) контроллер молчит, ошибок нет.
      new IntroVoice(this.audio),
    );
    this.introPlaying = true;
    // На время заставки прячем HUD, гасим прицел/орбиту меню (камеру ведёт intro).
    this.setHudVisible(false);
    this.rig.stopMenuOrbit(true);
    this.intro.play();
  }

  /** Заставка доиграла/скипнута: вернуть камеру к игроку, показать HUD, отдать управление. */
  private onIntroDone(): void {
    this.introPlaying = false;
    this.intro?.dispose();
    this.intro = null;
    // Камера возвращается к игроку плавно (без snap) — обычная орбита подхватит её
    // на ближайшем кадре rig.update; перед этим вернём fov по умолчанию.
    this.camera.fov = FOV_DEFAULT;
    this.camera.updateProjectionMatrix();
    this.setHudVisible(true);
    this.lastHpShown = this.player.hp;
    this.hud.setHp(this.player.hp, this.player.maxHp);
  }

  /** Дебаг: перемотать идущую заставку на секунду t (детерминированные скриншоты сцен). */
  introSeek(t: number): void {
    this.intro?.seek(t);
  }

  /**
   * «Продолжить» из ГЛАВНОГО меню. Первый старт сессии — применяем pendingSave
   * (это «Продолжить» с экрана старта). Если же мир уже оживал в этой сессии
   * (игрок ушёл в меню из паузы), pendingSave устарел с момента загрузки страницы
   * — переприменять его НЕЛЬЗЯ (баг №5(б): кидало на старую позицию). Просто
   * снимаем меню/паузу: мир уже идёт со своим текущим состоянием.
   */
  continueFromMenu(): void {
    if (this.hasEverStarted) {
      // Возврат в уже идущую сессию: НИКАКОГО applySave. Снимаем меню и паузу.
      this.mainMenu.hide();
      this.audio.music.enterGameplay();
      this.resumeGame();
    } else {
      this.startGame(true);
    }
  }

  /**
   * Поставить игру на паузу: фикс-шаг стоит, звук приглушён, прогресс сохранён.
   * viaLockLoss=true — пришли из pointerlockchange (Esc уже выбил lock): к этому
   * моменту document.pointerLockElement уже null и Input.pointerLocked сброшен
   * (его слушатель зарегистрирован раньше нашего), поэтому факт «лок БЫЛ» берём
   * из самого события потери — иначе «Продолжить» не вернул бы lock.
   */
  private pauseGame(viaLockLoss = false): void {
    if (!canPause({ started: this.started, screenOpen: this.screenOpen, menuOpen: this.mainMenu.visible, paused: this.paused })) {
      return;
    }
    this.paused = true;
    // Запоминаем, был ли pointer lock, чтобы вернуть его на «Продолжить».
    this.wasPointerLocked = viaLockLoss || this.input.pointerLocked || !!document.pointerLockElement;
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.duck(true);
    // HUD не светится под экраном паузы.
    this.setHudVisible(false);
    // Свежий сейв на момент паузы — баннер «Прогресс сохранён» не врёт.
    this.saveNow();
    this.pauseScreen.show();
  }

  /** Снять паузу («Продолжить»). Вернуть pointer lock, если он был, размьютить duck. */
  private resumeGame(): void {
    if (!canResume({ started: this.started, screenOpen: this.screenOpen, menuOpen: this.mainMenu.visible, paused: this.paused })) {
      return;
    }
    this.paused = false;
    this.audio.duck(false);
    this.pauseScreen.hide();
    // Вернулись в игру — HUD снова виден.
    this.setHudVisible(true);
    if (this.wasPointerLocked) {
      // Лок мог быть запрещён песочницей превью — глушим reject, как в Input.
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    }
  }

  /** «В главное меню» из паузы: показать меню поверх, игра остаётся на паузе под ним. */
  private openMainMenuFromPause(): void {
    // Пауза НЕ снимается: мир под меню заморожен (paused остаётся true), облёт НЕ
    // запускаем (пауза остаётся со своей камерой). HUD остаётся скрытым (он уже
    // погашен в pauseGame) — под меню игрового интерфейса не видно.
    this.setHudVisible(false);
    this.audio.music.enterMenu();
    this.pauseScreen.hide();
    this.mainMenu.show();
  }

  /** Сброс прогресса к чистому забегу (для «Новой игры»). Мир/сундуки уже стоят. */
  private resetRun(): void {
    // Новый забег — игрок не в лодке, лодка на причале (как и весь сброс прогресса).
    this.exitBoatToDock();
    this.coins = 0;
    this.xp = 0;
    this.heat.value = 0;
    this.playedSec = 0;
    this.arrows = ARROWS_START;
    this.inventory = makeInventory();
    this.perkState = makePerkState();
    this.questState = makeQuestState();
    // Сброс служб трат денег (Фаза 6B): бафф источника и нанятые стражники.
    clearBlessing(this.blessing);
    this.blessingHpAcc = 0;
    this.updateBlessingChip();
    this.rumorToldFor = -1;
    this.restoreHiredGuards([]); // убрать живых стражников и сбросить учёт
    // Скрытый предмет волны B: новый забег — ожерелье снова на дереве.
    this.necklaceFound = false;
    this.respawnNecklace();
    this.shopMarkup = 1; // вернуть деревенский профиль лавки
    void this.applyEquipment();
    this.refreshBelt();
    this.hud.setAmmo(this.arrows);
    this.recomputeLevel(false);
    // Сбросить строку квеста и режим бегства жителей к чистому забегу.
    this.readyQuestIds.clear();
    this.questHudKey = '__reset__';
    this.updateQuestHud(true);
  }

  /** Колбэк SaveSystem.applySave: разложить экипировку в статы/меш/пояс, обновить уровень. */
  afterSaveApplied(): void {
    // Сейв-инвариант: после загрузки игрок на берегу (его телепортировал applySave),
    // лодка — у причала, riding снят. Сейв «в лодке» не воскрешает катание.
    this.exitBoatToDock();
    void this.applyEquipment();
    this.refreshBelt();
    this.recomputeLevel(false);
    this.hud.setCoins(this.coins);
    this.hud.setAmmo(this.arrows);
    // Скрытый предмет волны B: меш ожерелья согласовать с загруженным флагом.
    this.reconcileNecklace();
    // Загруженный активный квест — в строку HUD (форсируем перерисовку сменой ключа).
    this.readyQuestIds.clear();
    this.questHudKey = '__reload__';
    this.updateQuestHud(true);
  }

  private onScreenShow(): void {
    this.screenOpen = true;
    // Снять pointer lock — иначе мышь крутит камеру под открытым экраном.
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onScreenHide(): void {
    // Экран мог закрыться, пока другой ещё открыт — проверяем все.
    this.screenOpen =
      this.inventoryScreen.visible ||
      this.perkScreen.visible ||
      this.shopScreen.visible ||
      this.dialogScreen.visible ||
      this.worldMap.visible;
    // Диалог закрылся — забываем собеседника, чтобы [E] снова открывал «с нуля».
    if (!this.dialogScreen.visible) this.dialogVillager = null;
  }

  /** I — инвентарь, P — перки (тоггл). Закрытие чужого экрана при открытии другого. */
  private handleScreenKeys(): void {
    if (this.input.pressed('KeyI')) {
      if (this.shopScreen.visible) this.shopScreen.hide();
      if (this.perkScreen.visible) this.perkScreen.hide();
      if (this.inventoryScreen.visible) this.inventoryScreen.hide();
      else {
        this.refreshInventory();
        this.inventoryScreen.show();
      }
    }
    if (this.input.pressed('KeyP')) {
      if (this.shopScreen.visible) this.shopScreen.hide();
      if (this.inventoryScreen.visible) this.inventoryScreen.hide();
      if (this.perkScreen.visible) this.perkScreen.hide();
      else this.openPerks();
    }
    // Tab — карта мира (тоггл). Закрывает чужие экраны при открытии, как I/P.
    if (this.input.pressed('Tab')) {
      if (this.shopScreen.visible) this.shopScreen.hide();
      if (this.inventoryScreen.visible) this.inventoryScreen.hide();
      if (this.perkScreen.visible) this.perkScreen.hide();
      if (this.worldMap.visible) this.worldMap.hide();
      else this.openMap();
    }
    // Зелья с пояса (1/2/3) — даже мимо открытого инвентаря неудобно, но привычно;
    // глушим, если открыт экран (фокус на UI).
    if (!this.screenOpen) {
      if (this.input.pressed('Digit1')) this.drinkBelt(0);
      if (this.input.pressed('Digit2')) this.drinkBelt(1);
      if (this.input.pressed('Digit3')) this.drinkBelt(2);
    }
  }

  private openPerks(): void {
    this.refreshPerks();
    this.perkScreen.show();
  }

  /**
   * Открыть карту мира (Tab). Снимок мира строим один раз (статичные данные:
   * рельеф/дороги/пруды/лес/маркеры), дальше переиспользуем — подложка рисуется
   * в WorldMap единожды. Позиция/стрелка игрока обновляются каждый кадр (updateMap).
   */
  private openMap(): void {
    if (!this.mapSnapshot) this.mapSnapshot = this.buildMapSnapshot();
    const feet = this.player.position;
    this.worldMap.show(this.mapSnapshot, feet.x, feet.z, this.rig.yaw);
  }

  /** Собрать снимок мира для карты из готовых данных (один раз после старта мира). */
  private buildMapSnapshot(): WorldSnapshot {
    const markers: MapMarker[] = [
      { x: VILLAGE.x, z: VILLAGE.z, label: 'Деревня', kind: 'village' },
      { x: PALACE.x, z: PALACE.z, label: 'Дворец', kind: 'palace' },
      { x: this.fortPos.x, z: this.fortPos.z, label: 'Логово злодея', kind: 'fort' },
      { x: WATERFALL.x, z: WATERFALL.z, label: 'Водопад', kind: 'waterfall' },
    ];
    // Замок злодея в горах (цитадель — финал): маркер по центру двора.
    if (this.castleAnchors) {
      markers.push({
        x: this.castleAnchors.courtyard.x,
        z: this.castleAnchors.courtyard.z,
        label: 'Замок злодея',
        kind: 'villain_castle',
      });
    }
    // Локации концов дорог (постоялый двор/лесничество/мельница/застава).
    const ROAD_END_LABEL: Record<string, string> = {
      inn: 'Постоялый двор',
      forester: 'Лесничество',
      mill: 'Мельница',
      sentry: 'Застава',
    };
    for (const loc of this.roadEnds.locations) {
      markers.push({ x: loc.x, z: loc.z, label: ROAD_END_LABEL[loc.kind] ?? '', kind: loc.kind });
    }
    // Открытые рукотворные POI (руины/телега/святилище/лагерь/пирс).
    const POI_LABEL: Record<string, string> = {
      tower_ruin: 'Руины',
      broken_cart: 'Телега',
      shrine: 'Святилище',
      hunter_camp: 'Лагерь',
      pier: 'Пирс',
    };
    for (const poi of this.landmarks.pois) {
      markers.push({ x: poi.x, z: poi.z, label: POI_LABEL[poi.kind] ?? '', kind: 'poi' });
    }
    // Озёра (Фаза 6D, волна 1) рисуются на карте как вода (тот же стиль, что пруды):
    // добавляем их круги в список ponds. У главного озера — подпись «Озеро».
    const lakeCircles = this.lakes.infos.map((l) => ({ x: l.x, z: l.z, r: l.r }));
    const mainLake = this.lakes.infos.find((l) => l.id === 'west');
    if (mainLake) markers.push({ x: mainLake.x, z: mainLake.z, label: 'Озеро', kind: 'poi' });
    // Лодка у главного озера (волна 2): маленький маркер причала (стиль POI).
    markers.push({ x: BOAT_DOCK.x, z: BOAT_DOCK.z, label: 'Лодка', kind: 'poi' });
    return {
      worldSize: WORLD_SIZE,
      height: (x, z) => this.terrain.height(x, z),
      roads: ROADS,
      ponds: [...this.ponds.infos, ...lakeCircles],
      forest: this.forest.pineTrees,
      markers,
    };
  }

  // ---- Экипировка → статы / визуал ----

  /**
   * Применить экипировку и перки к боевым статам/скорости/оружию/мешу.
   * damageMul → attackBonus, defense → armor, speedMul → speedRun/Sprint
   * (база — константы), перки кладутся поверх. Возвращает промис (смена меша async).
   */
  private async applyEquipment(): Promise<void> {
    const mods = totalStatMods(this.inventory);
    const perks = perkCombatMods(this.perkState);

    // Милишное оружие: из экипировки (через ITEMS→WEAPONS), иначе дефолтный кинжал.
    const wId = this.inventory.equipment.weapon;
    const wWeapon = wId ? WEAPONS[ITEMS[wId]?.weaponId ?? ''] : undefined;
    this.playerMelee = wWeapon ?? DEFAULT_MELEE;

    // Дальнее оружие аналогично (RangedAttack хранит снимок — обновляем).
    const rId = this.inventory.equipment.ranged;
    const rWeapon = rId ? WEAPONS[ITEMS[rId]?.weaponId ?? ''] : undefined;
    this.ranged.setWeapon(rWeapon ?? DEFAULT_CROSSBOW);

    // attackBonus в процентах: damageMul предмета 1.1 → +10%. Перки: meleeMul/rangedMul
    // тоже множители урона — берём средний прирост (упрощение: один attackBonus на оба
    // типа), плюс крит дальнего/ближнего боя из веток.
    const dmgMul = mods.damageMul * ((perks.meleeMul + perks.rangedMul) / 2);
    this.player.attackStats.attackBonus = Math.round((dmgMul - 1) * 100);
    // Один attackStats обслуживает и милишку, и стрелы (computeHit) — крит берём
    // максимальный из ranged/melee-прибавок, чтобы ни один тип боя не терял бонус.
    this.player.attackStats.critChance =
      DEFAULT_ATTACKER.critChance + Math.max(perks.rangedCrit, perks.meleeCrit);
    this.player.attackStats.critMult = DEFAULT_ATTACKER.critMult * perks.critMultMul;

    // Защита: armor из брони/тринкетов + перки «Кожа дуба»/«Стальной доспех».
    this.player.defenseStats.armor = (mods.defense + perks.defense) * 10;

    // Запас здоровья: база + капстоунный бонус «Бычье сердце». Текущее hp клампим
    // к новому максимуму (снятие перка не оставит «висящего» hp выше потолка).
    this.player.maxHp = BASE_MAX_HP + perks.bonusMaxHp;
    if (this.player.hp > this.player.maxHp) this.player.hp = this.player.maxHp;

    // Скорость: база × экипировка × перк × зелье прыти × благословение источника.
    const blessMul = isBlessed(this.blessing) ? BLESSING_SPEED_MUL : 1;
    const speedMul = mods.speedMul * perks.speedMul * this.swiftMul * blessMul;
    this.player.speedRun = BASE_SPEED_RUN * speedMul;
    this.player.speedSprint = BASE_SPEED_SPRINT * speedMul;

    // Магнит монет (перк «Звериное чутьё»).
    this.loot.setMagnetDist(BASE_MAGNET_DIST * perks.coinMagnetMul);

    // Фауна не разбегается при ranger2 (капстоун «Хозяин троп» лишь усиливает —
    // calm уже полностью убирает бегство, так что «подпускает ближе» поглощено им).
    this.fauna.setCalm(perks.faunaCalm);

    // Капстоуны, читаемые горячими путями: пробой стрелы и «Второе дыхание».
    this.arrowPierce = perks.arrowPierce;
    this.secondWindActive = perks.secondWind;
    // Скидки/наценки «Хозяина троп» — для лавки/продажи (читаются в buy/sell-колбэках).
    this.buyMul = perks.buyMul;
    this.sellMul = perks.sellMul;

    // Видимый меш: НЕ-кинжальное оружие прячет встроенные кинжалы и вешает свой меш.
    const equippedDef = wId ? ITEMS[wId] : undefined;
    const meshName = equippedDef?.mesh ?? null;
    const hideBuiltin = !!equippedDef && equippedDef.weaponId !== 'dagger';
    await this.player.setWeaponMesh(this.assets, meshName, hideBuiltin);
  }

  /** Строки статов для панели инвентаря (Game считает, UI рисует). */
  private statsLines(): string[] {
    const w = ITEMS[this.inventory.equipment.weapon ?? '']?.name ?? 'Кинжал';
    const dmg = this.playerMelee.damage;
    const bonus = this.player.attackStats.attackBonus;
    const armor = this.player.defenseStats.armor;
    const spd = Math.round(this.player.speedRun * 10) / 10;
    return [
      `Оружие: ${w} (${dmg}${bonus !== 0 ? `, ${bonus > 0 ? '+' : ''}${bonus}%` : ''})`,
      `Защита: ${Math.round(armor)}`,
      `Скорость: ${spd} м/с`,
      `Уровень: ${this.level}`,
    ];
  }

  // ---- Инвентарь: колбэки экрана ----

  private onEquipSlot(i: number): void {
    if (equip(this.inventory, i)) {
      void this.applyEquipment();
      this.refreshInventory();
      this.refreshBelt();
      this.saveNow();
    }
  }

  private onUnequip(key: EquipKey): void {
    if (unequip(this.inventory, key)) {
      void this.applyEquipment();
      this.refreshInventory();
      this.saveNow();
    }
  }

  private onUseSlot(i: number): void {
    const stack = this.inventory.slots[i];
    if (!stack) return;
    if (this.consumePotion(stack.id)) {
      this.refreshInventory();
      this.refreshBelt();
    }
  }

  private onDropSlot(i: number): void {
    const stack = this.inventory.slots[i];
    if (!stack) return;
    // Выброс = удаление стека целиком (на земле предметы не материализуем, упрощение).
    removeItem(this.inventory, stack.id, stack.count);
    void this.applyEquipment();
    this.refreshInventory();
    this.refreshBelt();
  }

  private refreshInventory(): void {
    this.inventoryScreen.refresh(this.inventory, this.statsLines());
  }

  private refreshInventoryIfOpen(): void {
    if (this.inventoryScreen?.visible) this.refreshInventory();
  }

  /** Пояс зелий: первые 3 стека зелий из сумки в порядке слотов. */
  private beltSlots(): BeltSlot[] {
    const out: BeltSlot[] = [];
    for (const s of this.inventory.slots) {
      if (s && ITEMS[s.id]?.kind === 'potion') out.push({ id: s.id, count: s.count });
      if (out.length >= 3) break;
    }
    while (out.length < 3) out.push({ id: null, count: 0 });
    return out;
  }

  private refreshBelt(): void {
    if (this.beltBar) this.beltBar.refresh(this.beltSlots());
  }

  /** Выпить зелье из ячейки пояса index (0..2). */
  private drinkBelt(index: number): void {
    const slot = this.beltSlots()[index];
    if (!slot?.id) return;
    if (this.consumePotion(slot.id)) this.beltBar.flash(index);
    this.refreshBelt();
    this.refreshInventoryIfOpen();
  }

  /**
   * Выпить зелье id из инвентаря: лечение (hp клампится к max) или бафф прыти
   * (таймер в Game). Возвращает true, если зелье было и применилось.
   */
  private consumePotion(id: string): boolean {
    const def = ITEMS[id];
    if (!def || def.kind !== 'potion') return false;
    if (!removeItem(this.inventory, id, 1)) return false;
    // Звук глотка — переиспользуем coin-«динь» (отдельного sfx нет, новые не городим).
    this.audio.sfx.coin();
    if (def.hpRestore) {
      const before = this.player.hp;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.hpRestore);
      const gained = Math.round(this.player.hp - before);
      this.hud.showTicker(`+${gained} hp`, 2);
    }
    if (def.statMods?.speedMul && def.durSec) {
      this.swiftMul = def.statMods.speedMul;
      this.swiftLeft = def.durSec;
      void this.applyEquipment(); // пересчитать скорость с баффом
      this.hud.showTicker(`Прыть +${Math.round((def.statMods.speedMul - 1) * 100)}% на ${def.durSec}с`, 2);
    }
    return true;
  }

  // ---- Перки / уровень ----

  private onUnlockPerk(id: PerkId): void {
    if (unlockPerk(this.perkState, id)) {
      void this.applyEquipment(); // моды перков ложатся на статы
      this.refreshPerks();
      this.saveNow();
    }
  }

  private refreshPerks(): void {
    const states = {} as Record<PerkId, PerkSlotState>;
    for (const id of Object.keys(PERKS) as PerkId[]) {
      // Предтеча отсутствует, если у перка есть requiresAny и НИ ОДИН узел не взят.
      const req = PERKS[id].requiresAny;
      const reqMissing = req !== undefined && req.length > 0 && !req.some((r) => this.perkState.unlocked.includes(r));
      if (this.perkState.unlocked.includes(id)) states[id] = 'unlocked';
      else if (canUnlock(this.perkState, id)) states[id] = 'available';
      else if (reqMissing) states[id] = 'locked'; // «нужен предыдущий» приоритетнее «нет очков»
      else states[id] = 'noPoints'; // предтеча открыта/не нужна, но очков нет
    }
    const next = Math.min(10, this.level + 1);
    const data: PerkRefresh = {
      states,
      points: this.perkState.points,
      level: this.level,
      xp: this.xp,
      xpNext: xpForLevel(next),
    };
    this.perkScreen.refresh(data);
  }

  /**
   * Пересчитать уровень из xp, выдать очки перков за новые уровни, при росте —
   * баннер «УРОВЕНЬ N!» + звон + событие (автосейв). banner=false — тихая
   * синхронизация (загрузка/сброс/старт): очки доливаем, но без баннера/звука.
   */
  private recomputeLevel(banner: boolean): void {
    const newLevel = levelFromXp(this.xp);
    // Очки = заработано за уровень минус ПОТРАЧЕНО на перки (сумма стоимостей, а не
    // число перков: в углублённом дереве перки стоят 1-3 очка).
    const earned = perkPointsEarned(newLevel);
    const spent = perkPointsSpent(this.perkState);
    const targetPoints = Math.max(0, earned - spent);
    if (newLevel > this.level) {
      // Доливаем очки до целевого (за каждый новый уровень — +1).
      this.perkState.points = targetPoints;
    } else if (!banner) {
      // Тихая синхронизация после загрузки: выправить очки под уровень/перки.
      this.perkState.points = targetPoints;
    }
    this.level = newLevel;

    if (banner && newLevel > this.lastLevelShown) {
      for (let lvl = this.lastLevelShown + 1; lvl <= newLevel; lvl++) {
        bus.emit('player:levelup', { level: lvl });
      }
      this.hud.showBanner(`УРОВЕНЬ ${newLevel}!`, 2.2);
      this.audio.sfx.coin(); // лёгкий звон левел-апа (отдельного sfx нет)
      this.refreshInventoryIfOpen();
      if (this.perkScreen?.visible) this.refreshPerks();
    }
    this.lastLevelShown = newLevel;
    // Уровень мог измениться — обновим HUD (XP-бар читает порог следующего уровня).
    this.updateXpHud();
  }

  /**
   * Отдать в HUD уровень и прогресс XP до следующего уровня. Зовётся при смене
   * xp/уровня. На капе (MAX_LEVEL) бар заполнен — следующего порога нет.
   */
  private updateXpHud(): void {
    const cur = xpForLevel(this.level);
    const next = xpForLevel(this.level + 1); // на капе == cur → полный бар (xpBarFraction)
    this.hud.setLevelXp(this.level, xpBarFraction(this.xp, cur, next));
    this.lastXpShown = this.xp;
  }

  // ---- Сундуки / сейв ----

  /** Открытие сундука (колбэк Chests.update): фонтан монет + предмет + тикер + автосейв. */
  private readonly onChestOpened = (
    _id: string,
    _table: string,
    coins: number,
    itemId: string | null,
    itemCount: number,
  ): void => {
    const feet = this.player.position;
    if (coins > 0) {
      this.loot.spawnCoins(_dropPos.set(feet.x, feet.y, feet.z), coins, this.combatRng);
    }
    if (itemId) this.collectItem(itemId, itemCount);
    this.hud.showTicker('Сундук открыт!', 2);
    this.saveNow();
  };

  /** Сводка домов на момент отбоя набега: уцелевшие/всего (для награды RaidDirector). */
  private houseTally(): { survived: number; total: number } {
    let survived = 0;
    for (const h of this.village.houses) if (h.alive) survived++;
    return { survived, total: this.village.houses.length };
  }

  /**
   * Итог отбитого набега (Фаза 6.5): награда за уцелевшие дома + баннер. Все дома
   * целы — особый баннер «Деревня невредима!» и бонус ×1.5 (в raidReward). Монеты
   * и XP начисляются, XP может поднять уровень. Затем автосейв (как раньше).
   */
  private onRaidEnded(e: GameEvents['raid:ended']): void {
    // Набег окончен (победа/поражение) — гасим чип-индикатор и стрелку.
    this.raidActive = false;
    this.hud.hideRaidChip();
    if (!e.victory) return;
    // Угроза ушла — гасим пламя на уцелевших домах (дым-след остаётся). Руины
    // (alive=false) не трогаются: их чинят за монеты через [E].
    for (const h of this.village.houses) h.extinguish();
    const r = raidReward(e.survived, e.total);
    if (r.coins > 0) this.addCoins(r.coins);
    // Сначала баннер набега, затем XP с баннером уровня: если награда подняла
    // уровень — его баннер показывается ПОСЛЕДНИМ и перекрывает баннер набега
    // (левел-ап — более яркое событие). Без левел-апа остаётся баннер набега.
    this.hud.showBanner(
      r.flawless ? 'ДЕРЕВНЯ НЕВРЕДИМА!' : `НАБЕГ ОТБИТ! Уцелело ${r.survived}/${r.total}`,
      3.5,
    );
    if (r.coins > 0 || r.xp > 0) {
      this.hud.showTicker(`Награда: +${r.coins} монет, +${r.xp} XP`, 3.5);
    }
    if (r.xp > 0) {
      this.xp += r.xp;
      this.recomputeLevel(true);
    }
    this.saveNow();
  }

  /**
   * Ремонт руины ([E] у дома, колбэк Village.updateRepair): списать REPAIR_COST,
   * вернуть дом целым, тикер через house:repaired, автосейв. Возвращает false при
   * нехватке монет (Village оставит промпт «нужно N монет», ремонт не случится).
   */
  private readonly onRepairHouse = (house: House): boolean => {
    if (this.coins < REPAIR_COST) return false;
    if (!house.repair()) return false; // дом уже цел — монеты не трогаем
    this.coins -= REPAIR_COST;
    this.hud.setCoins(this.coins);
    bus.emit('house:repaired', { id: house.id });
    this.saveNow();
    return true;
  };

  // ---- Службы трат денег (Фаза 6B): фонтан-бафф / найм стражника / трактирщик ----

  /** Подпись [E]-промпта службы по её типу и текущему состоянию игры (цена/доступность). */
  private serviceLabel(service: VillageService): string {
    switch (service) {
      case 'fountain':
        return isBlessed(this.blessing)
          ? `[E] Обновить благословение — ${BLESSING_COST} монет`
          : `[E] Бросить монету в фонтан — ${BLESSING_COST} монет`;
      case 'hire':
        if (this.hiredGuards.count >= MAX_HIRED_GUARDS) return 'Стражники уже наняты (максимум)';
        return this.coins >= HIRE_COST
          ? `[E] Нанять стражника — ${HIRE_COST} монет`
          : `Нужно ${HIRE_COST} монет, чтобы нанять стражника`;
    }
  }

  /** Активация службы по [E] (колбэк Village.updateServices). */
  private readonly onServiceActivate = (service: VillageService): void => {
    switch (service) {
      case 'fountain':
        this.tossCoinInFountain();
        break;
      case 'hire':
        this.hireGuard();
        break;
    }
  };

  /**
   * Бросить монету в фонтан: списать BLESSING_COST, наложить/обновить бафф
   * «Благословение источника» (скорость + реген), пересчитать скорость, тикер.
   * Повторный бросок не стакается — просто продлевает длительность заново.
   */
  private tossCoinInFountain(): void {
    if (this.coins < BLESSING_COST) {
      this.hud.showTicker(`Нужно ${BLESSING_COST} монет для подношения`, 2.5);
      return;
    }
    this.coins -= BLESSING_COST;
    this.hud.setCoins(this.coins);
    const renew = isBlessed(this.blessing);
    applyBlessing(this.blessing);
    this.blessingHpAcc = 0;
    void this.applyEquipment(); // пересчитать скорость с баффом
    this.audio.sfx.coin();
    this.hud.showTicker(
      renew ? 'Благословение источника продлено' : 'Благословение источника: скорость и реген на 3 мин',
      3,
    );
    this.updateBlessingChip(true);
    this.saveNow();
  }

  /**
   * Нанять стражника: списать HIRE_COST, заспавнить village_guard на свободном
   * слоте патрульного кольца, восстановить полное HP. Лимит MAX_HIRED_GUARDS.
   * Спавн асинхронный (модель грузится) — монеты списываем сразу, при отказе
   * загрузки возвращаем (редкий сетевой сбой).
   */
  private hireGuard(): void {
    if (!canHireGuard(this.coins, this.hiredGuards.count)) {
      if (this.hiredGuards.count >= MAX_HIRED_GUARDS) {
        this.hud.showTicker('Больше стражников нанять нельзя', 2.5);
      } else {
        this.hud.showTicker(`Нужно ${HIRE_COST} монет, чтобы нанять стражника`, 2.5);
      }
      return;
    }
    const slot = nextGuardSlot(this.hiredGuards.usedSlots());
    if (slot < 0) return; // защита: лимит уже проверен canHireGuard
    this.coins -= HIRE_COST;
    this.hud.setCoins(this.coins);
    this.audio.sfx.coin();
    void this.spawnGuardAtSlot(slot, null)
      .then((ok) => {
        if (!ok) {
          // Загрузка модели не удалась — вернуть монеты, чтобы игрок не потерял их зря.
          this.coins += HIRE_COST;
          this.hud.setCoins(this.coins);
          this.hud.showTicker('Стражник не явился (попробуй ещё раз)', 2.5);
          return;
        }
        this.hud.showTicker('Стражник нанят — встал в дозор', 3);
        this.saveNow();
      });
  }

  /**
   * Заспавнить village_guard на слоте патруля. hp=null — полное HP (свежий найм),
   * иначе восстановление из сейва. Возвращает true при успехе. Привязку к слоту
   * (центр патруля) делает HiredGuards.register.
   */
  private async spawnGuardAtSlot(slot: number, hp: number | null): Promise<boolean> {
    const p = HiredGuards.slotPos(slot);
    const faceYaw = Math.atan2(VILLAGE.x - p.x, VILLAGE.z - p.z); // лицом к деревне
    const npc = await this.spawnNpc('village_guard', p.x, p.z, faceYaw);
    if (!npc) return false;
    this.hiredGuards.register(npc, slot);
    if (hp !== null) this.hiredGuards.applyHp(npc, hp);
    return true;
  }

  /**
   * Угостить трактирщика элем: списать ALE_COST, «слить» слух о следующем короване
   * (тир/время до выезда) в тикер и реплику-диалог. Повторное угощение до выезда
   * следующего корована — отказ «я уже всё рассказал».
   */
  private askTavernRumor(): void {
    const nextIdx = this.caravans.nextCaravanIndex;
    if (this.rumorToldFor === nextIdx) {
      this.openTavernDialog('Я уже всё рассказал про этот обоз. Выйдет — загляни за новым слухом.', false);
      return;
    }
    if (this.coins < ALE_COST) {
      this.openTavernDialog(`Эль стоит ${ALE_COST} монет, странник. Звонкой монетой — и язык развяжется.`, false);
      return;
    }
    this.coins -= ALE_COST;
    this.hud.setCoins(this.coins);
    this.audio.sfx.coin();
    this.rumorToldFor = nextIdx;
    const info = this.caravans.nextCaravanInfo();
    this.hud.showTicker(rumorTicker(info), 6);
    this.openTavernDialog(rumorLine(info), info?.tier === 'royal');
  }

  /** Открыть однокнопочную реплику трактирщика (без жителя-NPC — собеседник «трактирщик»). */
  private openTavernDialog(text: string, royal: boolean): void {
    this.dialogVillager = null; // не житель — onDialogChoose отработает только «Уйти»
    this.hud.hidePrompt();
    this.dialogScreen.open({
      name: 'Трактирщик',
      role: royal ? 'шепчет про королевский обоз' : 'разносчик слухов',
      text,
      options: [{ label: 'Понял, спасибо', action: 'leave' }],
    });
    this.audio.voice.bark('guard', 0);
  }

  /**
   * Обновить HUD-чип баффа источника: подпись с остатком в секундах. force —
   * перерисовать сразу (на наложение). Гасит чип, когда бафф истёк.
   */
  private updateBlessingChip(force = false): void {
    if (!isBlessed(this.blessing)) {
      if (this.blessingChipKey !== -1) {
        this.blessingChipKey = -1;
        this.hud.clearBlessing();
      }
      return;
    }
    const sec = Math.ceil(Math.max(0, this.blessing.left));
    if (!force && sec === this.blessingChipKey) return;
    this.blessingChipKey = sec;
    this.hud.setBlessing(sec);
  }

  // ---- Магазин (Фаза 6B): открытие + покупка/продажа ----

  /** Открыть деревенскую лавку ([E] на рынке, колбэк Village.updateMarket). */
  private readonly openShop = (): void => {
    this.applyShopConfig(DEFAULT_SHOP);
    this.refreshShop();
    this.shopScreen.show();
  };

  private refreshShop(): void {
    this.shopScreen.refresh(this.inventory, this.coins, this.arrows, ARROWS_MAX);
  }

  /**
   * Покупка товара id из ассортимента лавки. Стрелы (ARROWS_PACK_ID) идут мимо
   * инвентаря — через ammo.buyArrows к тому же счётчику колчана. Прочее — через
   * sim/shop.buy в инвентарь. Сообщение в окне поясняет отказ (нет монет/места).
   */
  private onShopBuy(id: string): void {
    if (id === ARROWS_PACK_ID) {
      // Стоимость пачки с учётом профиля лавки (торговец дороже деревни).
      const cost = buyPrice(ARROWS_PACK_ID, this.shopMarkup);
      const r = buyArrows(this.coins, this.arrows, cost);
      if (!r.ok) {
        this.shopScreen.setMessage(this.arrows >= ARROWS_MAX ? 'Колчан уже полон.' : 'Не хватает монет.');
        return;
      }
      this.coins = r.coins;
      this.arrows = r.arrows;
      this.hud.setAmmo(this.arrows);
      this.hud.setCoins(this.coins);
      this.audio.sfx.coin();
      this.shopScreen.setMessage(`Куплено: ${ARROWS_PER_BUY} стрел.`);
      this.refreshShop();
      this.saveNow();
      return;
    }
    const r = shopBuy(this.inventory, this.coins, id, this.shopMarkup);
    if (!r.ok) {
      this.shopScreen.setMessage(r.error === 'full' ? 'В сумке нет места.' : 'Не хватает монет.');
      return;
    }
    this.coins = r.coins;
    this.hud.setCoins(this.coins);
    this.audio.sfx.coin();
    this.shopScreen.setMessage(`Куплено: ${ITEMS[id]?.name ?? id}.`);
    this.refreshShop();
    this.refreshInventoryIfOpen();
    this.refreshBelt();
    this.saveNow();
  }

  /** Продажа одной штуки из слота инвентаря: начислить монеты, обновить окна/сейв. */
  private onShopSell(slotIndex: number): void {
    const stack = this.inventory.slots[slotIndex];
    const name = stack ? (ITEMS[stack.id]?.name ?? stack.id) : '';
    // Капстоун «Хозяин троп» (sellMul>1) поднимает выкуп — реальный gain в сообщении.
    const r = shopSell(this.inventory, this.coins, slotIndex, this.sellMul);
    if (!r.ok) return;
    const gain = r.coins - this.coins;
    this.coins = r.coins;
    this.hud.setCoins(this.coins);
    this.audio.sfx.coin();
    this.shopScreen.setMessage(`Продано: ${name} (+${gain}).`);
    this.refreshShop();
    this.refreshInventoryIfOpen();
    this.refreshBelt();
    this.saveNow();
  }

  /** Записать сейв сейчас (автосейв/по событию). Тихо игнорит до старта игры. */
  saveNow(): void {
    if (!this.started) return;
    saveGame(this);
  }

  /**
   * Сейв при уходе со страницы (баг №5(а)): между автосейвами (AUTOSAVE_PERIOD)
   * позиция в localStorage устаревает, и закрытие вкладки теряло перемещение.
   * pagehide/beforeunload — для десктопа; visibilitychange→hidden — для мобильных,
   * где pagehide ненадёжен (приложение свернули — браузер может убить вкладку).
   * saveNow сам тихо игнорит, пока игра не началась.
   */
  private installLifecycleSave(): void {
    const save = (): void => this.saveNow();
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
    });
  }

  /**
   * Слушатели входа в паузу. Esc сам выбивает pointer lock, и keydown при этом
   * может не дойти — поэтому слушаем И pointerlockchange (выход из lock в активной
   * игре без открытых экранов = пауза), И keydown Esc (fallback для режима без
   * lock, как в превью-iframe). canPause гейтит оба пути.
   */
  private installPauseListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      // Идёт интро-заставка (Фаза 6C): Esc её ПРОПУСКАЕТ (слушатель IntroCinematic),
      // паузу при этом НЕ ставим — мир ещё заморожен, игрок не начал играть.
      if (this.introPlaying) return;
      // Esc при открытом экране I/P/лавки/диалога/карты — сначала закрываем экран (а не ставим паузу).
      if (this.screenOpen) {
        if (this.inventoryScreen.visible) this.inventoryScreen.hide();
        if (this.perkScreen.visible) this.perkScreen.hide();
        if (this.shopScreen.visible) this.shopScreen.hide();
        if (this.dialogScreen.visible) this.dialogScreen.hide();
        if (this.worldMap.visible) this.worldMap.hide();
        return;
      }
      // Esc на паузе с открытым меню/экраном паузы — игнор (меню/«Продолжить» рулят).
      this.pauseGame();
    });
    document.addEventListener('pointerlockchange', () => {
      // Лок сняли НЕ нами (Esc браузера). onScreenShow снимает лок осознанно при
      // открытии I/P — там screenOpen уже true, canPause не даст войти в паузу.
      if (document.pointerLockElement) return;
      this.pauseGame(true);
    });
  }

  /** Выстрел по прицелу: рейкаст из камеры по взгляду → точка → стрела из груди игрока. */
  private shootFromCamera(): void {
    this.camera.getWorldDirection(_camDir);
    const hit = this.physics.raycastFull(this.camera.position, _camDir, AIM_DIST, this.player.collider);
    _aimPoint.copy(this.camera.position).addScaledVector(_camDir, hit ? hit.dist : AIM_DIST);
    // CameraRig отодвигает камеру только от статики — NPC может встать между камерой
    // и игроком. Точка прицела позади груди развернула бы выстрел (или дала NaN при
    // нормализации нуля) — тогда стреляем просто по взгляду камеры.
    const feet = this.player.position;
    _shotOrigin.set(feet.x, feet.y + SHOT_HEIGHT, feet.z);
    if (_shotDir.copy(_aimPoint).sub(_shotOrigin).dot(_camDir) <= 0) {
      _aimPoint.copy(_shotOrigin).addScaledVector(_camDir, AIM_DIST);
    }
    this.shootAtPoint(_aimPoint);
  }

  private shootAtPoint(point: THREE.Vector3): void {
    // Нет стрел — выстрел не происходит, подсказка у прицела.
    if (!canShoot(this.arrows)) {
      this.hud.showNoArrows();
      return;
    }
    const feet = this.player.position;
    _shotOrigin.set(feet.x, feet.y + SHOT_HEIGHT, feet.z);
    _shotDir.copy(point).sub(_shotOrigin).normalize();
    // Звук/расход стрелы — только на состоявшийся выстрел (не на кулдаун/занятый аниматор).
    if (this.ranged.tryShoot(this.player.anim, _shotOrigin, _shotDir)) {
      this.arrows = clampArrows(this.arrows - 1);
      this.hud.setAmmo(this.arrows);
      this.audio.sfx.crossbowShot();
      this.hud.onShotFired(); // считает выстрелы для обучающей подсказки выстрела
    }
  }

  /** Спавн стрелы в момент hitAt анимации (колбэк RangedAttack; tryShoot снял снимок прицела). */
  private readonly spawnArrow = (origin: Vec3Like, dir: Vec3Like, speed: number, baseDamage: number): void => {
    this.projectiles.spawn(
      _shotOrigin.set(origin.x, origin.y, origin.z),
      _shotDir.set(dir.x, dir.y, dir.z),
      speed,
      baseDamage,
      this.player.team,
      // Капстоун «Пробивной болт»: 1 пробой — пройти первую цель и добить вторую.
      this.arrowPierce ? 1 : 0,
    );
  };

  /** Единая точка начисления монет (подбор лута, награда таблички): кошелёк + HUD. */
  private readonly addCoins = (amount: number): void => {
    this.coins += amount;
    this.hud.setCoins(this.coins);
    // Звон на ЛЮБОЕ пополнение, включая награду таблички: addCoins — единая
    // точка «кошелёк вырос», и награда без звука ощущалась бы немым кликом
    this.audio.sfx.coin();
  };

  /**
   * Попадание стрелы. Стрелы ИГРОКА с порогом летальности (lethalMaxHp у арбалета)
   * бьют гарантированно: рядовой враг (maxHp ≤ порога) падает с одной стрелы, громила
   * — с двух (arrowKillDamage), мимо брони/разброса — иначе стрел жалко. Стрелы NPC
   * (без lethalMaxHp) — по обычной формуле computeHit.
   */
  private readonly onArrowHit = (target: NpcTarget, baseDamage: number, ownerTeam: Team): void => {
    const isPlayerArrow = ownerTeam === this.player.team;
    const lethalMaxHp = isPlayerArrow ? this.ranged.currentWeapon.lethalMaxHp : undefined;
    let damage: number;
    if (lethalMaxHp !== undefined) {
      // Летальная стрела игрока: фиксированный убойный урон по maxHp цели, без брони/крита.
      damage = arrowKillDamage(target.maxHp, lethalMaxHp);
    } else {
      const attacker = isPlayerArrow ? this.player.attackStats : DEFAULT_ATTACKER;
      damage = computeHit(baseDamage, attacker, target.defenseStats, this.combatRng).damage;
    }
    target.takeDamage(damage);
    // Тук попадания с rolloff (свои стрелы по дальним целям тоже слышны);
    // попадание ПО игроку не дублируем — player:damaged уже даст hurt-звук
    if (target !== this.player) {
      const tf = target.feet;
      this.audio.sfx.hitThud(this.audio.rolloffAt(tf.x, tf.y, tf.z));
    }
  };

  /** Попадание стрелы по зверю (охота): одна стрела = добыча. Дроп начислит updateFauna. */
  private readonly onArrowHuntHit = (beast: Critter): void => {
    if (beast.dying) return;
    beast.takeDamage(beast.maxHp); // стрела кладёт любого зверя наповал
    const tf = beast.feet;
    this.audio.sfx.hitThud(this.audio.rolloffAt(tf.x, tf.y, tf.z));
  };

  /**
   * Начислить трофеи добытого зверя в инвентарь с тикером (раз на зверя). Зовётся из
   * updateFauna при переходе зверя в dying — единая точка для стрелы и милишки.
   */
  private lootBeast(beast: Critter): void {
    if (beast.looted) return;
    beast.looted = true;
    for (const drop of FAUNA_DROPS[beast.species]) {
      this.collectItem(drop.itemId, drop.count);
    }
  }

  /** Спавн подвижного NPC (набеги Фазы 4 и debug-смоуки). */
  async spawnNpc(archetypeId: string, x: number, z: number, faceYaw = 0): Promise<NpcCharacter | null> {
    const def = ARCHETYPES[archetypeId];
    if (!def) {
      console.warn('[game] spawnNpc: неизвестный архетип', archetypeId);
      return null;
    }
    const npc = await NpcCharacter.create(
      this.physics,
      this.assets,
      new THREE.Vector3(x, this.terrain.height(x, z), z),
      def,
      this.nextNpcId++,
      (hx, hz) => this.terrain.height(hx, hz),
      faceYaw,
    );
    this.scene.add(npc.visual);
    this.npcs.push(npc);
    return npc;
  }

  // ---- Наёмные стражники: сейв/восстановление (Фаза 6B) ----

  /** Снимок живых стражников для сейва (SaveSystem). Павшие уже убраны в tick. */
  collectHiredGuards(): ReturnType<HiredGuards['toSave']> {
    return this.hiredGuards.toSave();
  }

  /**
   * Восстановить стражников из сейва: убрать текущих (если applySave зовут с уже
   * нанятыми) и заспавнить заново по слотам с сохранённым HP. Спавн асинхронный —
   * стражники появятся через кадр-другой (как эскорт корована).
   */
  restoreHiredGuards(saved: ReturnType<HiredGuards['toSave']>): void {
    // Убрать живых village-стражников из мира и сбросить учёт.
    for (const n of this.npcs) {
      if (n.team === 'village' && n.alive) n.despawn();
    }
    this.hiredGuards.reset();
    for (const g of saved) {
      void this.spawnGuardAtSlot(g.slot, g.hp);
    }
  }

  /** Цели тика для милишки и стрел: списки переиспользуются, наполняются раз в кадр. */
  private refreshTargetLists(): void {
    this.meleeTargets.length = 0;
    this.arrowTargets.length = 0;
    this.meleeAndHunt.length = 0;
    this.arrowTargets.push(this.player);
    for (const s of this.skeletons) {
      this.meleeTargets.push(s);
      this.arrowTargets.push(s);
    }
    for (const n of this.npcs) {
      // Наёмные стражники деревни (team village) — союзники игрока: его милишка
      // их не задевает (CombatSystem не фильтрует по команде — исключаем из списка).
      // В arrowTargets оставляем: стрелы фильтруют areEnemies сами (свой по своим
      // не попадает), но цель нужна для вражеских стрел/перехвата траектории.
      if (n.team !== 'village') this.meleeTargets.push(n);
      this.arrowTargets.push(n);
    }
    // Милишный список боя = враги + живая фауна (охота милишкой 1-2 удара). id
    // фауны (0..~13) и NPC (от 100) не пересекаются — selectMeleeTargets не путает.
    for (const m of this.meleeTargets) this.meleeAndHunt.push(m);
    for (const c of this.critters) {
      if (c.alive) this.meleeAndHunt.push(c);
    }
  }

  /** Смерть игрока: затемнение прячет рывок, телепорт и HP — сразу (детерминизм смоуков). */
  private respawnPlayer(): void {
    // Смерть в лодке: снимаем катание и возвращаем лодку к причалу ДО телепорта.
    // Иначе riding останется true — камера поведёт лодку (на месте гибели), а не
    // респаунутого игрока (как в afterSaveApplied/resetRun, единый инвариант).
    this.exitBoatToDock();
    this.hud.deathFade();
    bus.emit('player:died', undefined);
    this.teleport(SPAWN.x, SPAWN.z);
    this.player.hp = this.player.maxHp;
    // Спавн может оказаться в гуще набега — без окна неуязвимости получалась
    // «смертельная карусель»: убили на респауне раньше, чем игрок увидел экран
    this.invulnLeft = RESPAWN_INVULN;
    this.player.invulnerable = true;
    // Агро не чистим: мозги забывают цель сами, когда она уходит за range * 1.5
  }

  /** Анимации скелетов + уборка трупов через CORPSE_TTL после смерти. */
  private updateSkeletons(dt: number): void {
    for (let i = this.skeletons.length - 1; i >= 0; i--) {
      const s = this.skeletons[i]!;
      s.update(dt);
      if (s.alive) continue;
      s.corpseTimer += dt;
      if (s.corpseTimer >= CORPSE_TTL) {
        s.dispose(this.scene, this.physics);
        this.skeletons.splice(i, 1);
      }
    }
  }

  /** Визуал NPC + уборка трупов — как у манекенов. */
  private updateNpcs(dt: number): void {
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i]!;
      n.update(dt);
      if (n.alive) continue;
      n.corpseTimer += dt;
      if (n.corpseTimer >= CORPSE_TTL) {
        n.dispose(this.scene, this.physics);
        this.npcs.splice(i, 1);
      }
    }
  }

  /**
   * Визуал фауны (FaunaSystem.update) + охота: начисление трофеев добытому зверю
   * (раз на зверя) и уборка трупа через CARCASS_TTL. Массив critters общий с
   * FaunaSystem (ссылка) — splice виден и ей, мёртвый зверь думать перестаёт.
   */
  private updateFauna(dt: number): void {
    this.fauna.update(dt);
    for (let i = this.critters.length - 1; i >= 0; i--) {
      const c = this.critters[i]!;
      if (!c.dying) continue;
      // Дроп трофеев в момент смерти (lootBeast сам защищён от повтора флагом looted).
      this.lootBeast(c);
      if (c.carcassTimer >= CARCASS_TTL) {
        c.dispose(this.scene, this.physics);
        this.critters.splice(i, 1);
      }
    }
  }

  /**
   * Кадр на паузе: только рендер замершей сцены, без логики/таймеров. Камеру не
   * двигаем (rig стоит вместе с симуляцией), но композер прогоняем — иначе под
   * оверлеем висел бы последний кадр и сменился бы рывком при снятии паузы.
   */
  private renderPausedFrame(): void {
    this.renderer.info.reset();
    this.composer.render();
  }

  private tick(): void {
    const now = performance.now();
    // На паузе симуляция стоит: ни фикс-шаг, ни таймеры (elapsed/playedSec/автосейв)
    // не движутся — рисуем кадр поверх замершего мира и выходим. lastTime двигаем,
    // чтобы первый кадр ПОСЛЕ снятия паузы не получил гигантский dt.
    if (this.paused) {
      this.lastTime = now;
      this.renderPausedFrame();
      this.input.endFrame();
      return;
    }
    const dt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.elapsed += dt;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 300) this.frameTimes.shift();

    // Интро-заставка (Фаза 6C): пока она идёт — мир ЗАМОРОЖЕН (фикс-шаг/AI/директора
    // не тикают), игровой ввод выключен, камеру ведёт сама заставка. Просто двигаем
    // её и рисуем кадр поверх построенного мира. Лёгкая фоновая анимация мира
    // (трава/вода/деревья) тут не критична — кадры облёта читабельны и так. onDone
    // (внутри intro.update) снимет introPlaying — следующий кадр пойдёт обычным путём.
    if (this.introPlaying && this.intro) {
      this.intro.update(dt);
      this.renderer.info.reset();
      this.composer.render();
      this.input.endFrame();
      return;
    }

    // Экраны (инвентарь/перки) и тогглы — обрабатываются ВСЕГДА, даже при открытом
    // экране (чтобы I/P закрывали его). При открытом экране остальной игровой ввод
    // глохнет (uiBlocked), pointer lock снят в onScreenShow.
    if (this.started) this.handleScreenKeys();
    const uiBlocked = this.screenOpen || !this.started;

    if (!uiBlocked) this.rig.applyInput(this.input);

    // Прицел и выстрел в aim — без требования pointer lock: превью-iframe лок
    // не выдаёт, и игрок «не видел прицела». Милишный удар по ЛКМ — только под
    // локом, иначе сам клик захвата мыши бил бы кинжалом.
    const aiming = !uiBlocked && this.input.mouseDown(2);
    if (aiming !== this.aiming) {
      this.aiming = aiming;
      this.rig.aiming = aiming; // over-shoulder сдвиг камеры в прицеливании
      this.hud.setAiming(aiming);
      this.player.setAiming(aiming); // вскинуть арбалет (левая рука) / опустить
    }
    // Выстрел в прицеливании: ЛКМ или F. На трекпаде зажатый ПКМ (aim) блокирует
    // клик ЛКМ — F даёт второй путь к тому же shootFromCamera.
    if (!uiBlocked && aiming && (this.input.mousePressed(0) || this.input.pressed('KeyF'))) {
      this.shootFromCamera();
    } else if (!uiBlocked && !aiming && this.input.mousePressed(0)) {
      // Не aiming: латчим клик в буфер (даже на кулдауне) — удар вылетит сразу по
      // готовности, клик «не проглатывается». Само срабатывание — в drain ниже.
      if (this.input.pointerLocked) this.attackBuffer = ATTACK_BUFFER_SEC;
    }
    // Дренаж буфера атаки: пока окно живо, каждый кадр пробуем ударить. Успех
    // гасит буфер; иначе он истекает за ATTACK_BUFFER_SEC (стейл-клик не висит).
    // Открытый экран/прицел отменяют буфер — не бьём «в инвентаре».
    if (this.attackBuffer > 0) {
      if (uiBlocked || this.aiming) {
        this.attackBuffer = 0;
      } else if (this.combat.tryMelee(this.player, this.playerMelee)) {
        this.attackBuffer = 0;
        this.audio.sfx.swingWoosh();
      } else {
        this.attackBuffer = Math.max(0, this.attackBuffer - dt);
      }
    }

    // M — мьют. Фидбэк баннером: prompt занят интеракцией таблички, а баннер
    // сам гаснет через ~1.5 с
    if (!uiBlocked && this.input.pressed('KeyM')) {
      this.hud.showBanner(this.audio.toggleMute() ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ', 1.5);
    }

    // Лодка ест WASD как руль (нос/тяга/поворот), поэтому на воде движение игрока
    // глохнет — keysDir обнуляется. Ввод лодки берём сырыми клавишами (не через
    // камеру): W/S — тяга вдоль носа, A/D — руль (см. stepBoat).
    const boatInput: BoatInput = {
      forward: !uiBlocked && (this.input.down('KeyW') || this.input.down('ArrowUp')),
      back: !uiBlocked && (this.input.down('KeyS') || this.input.down('ArrowDown')),
      left: !uiBlocked && (this.input.down('KeyA') || this.input.down('ArrowLeft')),
      right: !uiBlocked && (this.input.down('KeyD') || this.input.down('ArrowRight')),
    };
    const keysDir =
      uiBlocked || this.riding
        ? { x: 0, z: 0 }
        : moveDirFromKeys(
            {
              forward: this.input.down('KeyW') || this.input.down('ArrowUp'),
              back: this.input.down('KeyS') || this.input.down('ArrowDown'),
              left: this.input.down('KeyA') || this.input.down('ArrowLeft'),
              right: this.input.down('KeyD') || this.input.down('ArrowRight'),
            },
            this.rig.yaw,
          );
    // pressed('Space') живёт один кадр РЕНДЕРА, а при 120 fps половина кадров
    // не содержит фикс-шага — нажатие съедалось endFrame, не дойдя до физики.
    // Копим до ближайшего фикс-шага (дальше прощает буфер в stepJumpTimers).
    // Счётчик, а не флаг: второе нажатие в воздухе (двойной прыжок) — отдельный
    // заряд, его нельзя терять под уже взведённым латчем первого.
    if (!uiBlocked && this.input.pressed('Space')) this.jumpQueued += 1;
    const intent = {
      dir: this.debugMove ?? keysDir,
      sprint: this.debugMove?.sprint ?? this.input.down('ShiftLeft'),
      jump: false,
    };

    // Списки целей стабильны внутри кадра: спавн — асинхронный (между кадрами),
    // удаление трупов — в updateNpcs/updateSkeletons после фикс-шагов
    this.refreshTargetLists();
    this.stepper.update(dt, (stepSec) => {
      // Таймер респаун-неуязвимости — в фикс-шаге (детерминизм)
      if (this.invulnLeft > 0) {
        this.invulnLeft -= stepSec;
        if (this.invulnLeft <= 0) this.player.invulnerable = false;
      }
      // Кулдаун капстоуна «Второе дыхание» (детерминизм — в фикс-шаге).
      if (this.secondWindCdLeft > 0) this.secondWindCdLeft = Math.max(0, this.secondWindCdLeft - stepSec);
      // Один заряд нажатия на фикс-шаг: edge-нажатие за кадр должно дать ровно
      // одно срабатывание stepJumpTimers, а не «зажатый» прыжок на каждом шаге.
      intent.jump = this.jumpQueued > 0;
      if (this.jumpQueued > 0) this.jumpQueued -= 1;
      // В лодке контроллер игрока выключен (капсула припаркована при посадке) — вместо
      // него шагаем физику лодки (скольжение/границы по глубине, детерминированно).
      if (this.riding) {
        stepBoat(this.boat.state, stepSec, boatInput, this.boatDepthAt);
      } else {
        this.player.fixedUpdate(stepSec, intent);
      }
      this.combat.fixedUpdate(stepSec, this.player, this.meleeAndHunt);
      this.ranged.fixedUpdate(stepSec, this.spawnArrow);
      this.ai.fixedUpdate(stepSec, this.player, this.npcs, this.skeletons, this.village.houses);
      // Фауна после ai: бежит от игрока/NPC/манекенов (их позиции уже за этот шаг).
      this.fauna.fixedUpdate(stepSec, this.player, this.npcs, this.skeletons);
      // Жители: блуждание/бегство к фонтану (kinematic перенос по террейну).
      this.villagers.fixedUpdate(stepSec);
      // Мировые NPC (волна B): лёгкое блуждание у своих локаций.
      this.worldNpcs.fixedUpdate(stepSec);
      this.raid.fixedUpdate(stepSec);
      // Жар остужается всегда (владелец — Game), директор корованов читает/пишет его
      coolHeat(this.heat, stepSec);
      this.caravans.fixedUpdate(stepSec);
      this.projectiles.fixedUpdate(
        stepSec,
        this.arrowTargets,
        this.onArrowHit,
        this.critters,
        this.onArrowHuntHit,
        this.player.team,
      );
      const picked = this.loot.fixedUpdate(stepSec, this.player.position);
      if (picked > 0) this.addCoins(picked);
      this.physics.step();
    });

    // Капстоун «Второе дыхание»: смертельный удар (hp дошёл до 0) НЕ убивает —
    // оставляет 1 HP и даёт короткое окно неуязвимости. Перехватываем до показа
    // нуля в HUD и до респауна. Кулдаун 90 с гейтит повторное спасение.
    if (this.secondWindActive && this.player.hp <= 0 && this.secondWindCdLeft <= 0) {
      this.player.hp = 1;
      this.secondWindCdLeft = SECOND_WIND_COOLDOWN;
      this.invulnLeft = SECOND_WIND_INVULN;
      this.player.invulnerable = true;
      this.hud.showBanner('ВТОРОЕ ДЫХАНИЕ!', 1.6);
    }

    for (const p of this.dynamicProps) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }

    this.player.update(dt);
    // Лодка: применяем state к визуалу (позиция/курс/крен/качка). Игрок «сидит» в
    // лодке — кладём его модель на банку (мировая точка сиденья + курс лодки), чтобы
    // он ехал вместе с ней. Капсула игрока припаркована у причала и не двигается.
    if (this.boat) {
      this.boat.syncVisual();
      if (this.riding) this.seatPlayerInBoat();
    }
    // Мигание модели на время респаун-неуязвимости; по истечении — гарантированно видна
    if (this.invulnLeft > 0) {
      this.player.visual.visible = Math.floor(this.elapsed * INVULN_BLINK_HZ) % 2 === 0;
    } else if (!this.player.visual.visible) {
      this.player.visual.visible = true;
    }
    this.updateSkeletons(dt);
    this.updateNpcs(dt);
    // Наёмные стражники: убрать павших из учёта (трупы убирает updateNpcs выше) и
    // объявить тикером. Сейв на гибель — чтобы перезагрузка не «воскресила» павшего.
    if (this.started) {
      const fallen = this.hiredGuards.prune();
      if (fallen > 0) {
        for (let i = 0; i < fallen; i++) this.hud.showToast('⚔', 'Страж пал в бою…');
        this.saveNow();
      }
    }
    this.updateFauna(dt); // визуал зверей + дроп трофеев + уборка трупов
    this.villagers.update(dt); // визуал жителей деревни (поворот/клип)
    this.worldNpcs.update(dt); // визуал мировых NPC (поворот/клип)
    // Жители прячутся у фонтана на время набега, возвращаются по его окончании.
    if (this.villagersRaiding !== this.raidActive) {
      this.villagersRaiding = this.raidActive;
      this.villagers.setRaiding(this.raidActive);
    }
    this.village.update(dt); // дым повреждённых домов
    this.ponds.update(dt); // лёгкое покачивание глади прудов
    this.lakes.update(dt); // покачивание глади озёр (Фаза 6D, волна 1)
    this.waterfall.update(dt); // скролл струи/ручья + покачивание заводи/пены
    this.forest.update(this.camera, this.renderer); // LOD деревьев: 3D↔билборды по дистанции
    this.projectiles.update(dt);
    this.loot.update(dt);

    // HP в HUD при изменении; вспышка — только на урон
    if (this.player.hp !== this.lastHpShown) {
      if (this.player.hp < this.lastHpShown) {
        this.hud.damageFlash();
        // Событие объявлено в GameEvents с Фазы 3, эмитера не было; теперь его
        // слушает AudioEngine (hurt-звук) — оба пути урона сходятся в hp
        bus.emit('player:damaged', { hp: this.player.hp, max: this.player.maxHp });
      }
      this.lastHpShown = this.player.hp;
      this.hud.setHp(this.player.hp, this.player.maxHp);
    }

    // XP-бар в HUD при изменении опыта (грабёж/убийство капают xp вне recomputeLevel).
    if (this.xp !== this.lastXpShown) this.updateXpHud();

    // Смерть после показа нуля в HUD: затемнение + респаун на SPAWN с полным HP
    if (this.player.hp <= 0) this.respawnPlayer();

    const feet = this.player.position;
    // Интеракции по E: feet — кэш-вектор, x/z читаем до следующего вызова position.
    // pressed — edge-чтение без потребления, всем потребителям достаётся один кадр.
    // При открытом экране/до старта E глохнет (uiBlocked).
    const interactE = !uiBlocked && this.input.pressed('KeyE');
    // Лодка (волна 2): посадка/высадка [E] у главного озера. Идёт ПЕРВОЙ и ест E —
    // при катании остальные интеракции не нужны (мы на воде, вдали от деревни/POI),
    // а при посадке с берега лодка — отдельная точка, зон с другими [E] нет.
    const usedBoat = this.updateBoatInteract(dt, feet.x, feet.z, interactE);
    const interactRest = interactE && !usedBoat;
    this.tgSign.update(dt, feet.x, feet.z, interactRest, this.hud, this.addCoins);
    // Табличка может выдать награду в этот кадр — синхронизируем флаг для сейва.
    if (this.tgSign.rewarded && !this.tgRewarded) {
      this.tgRewarded = true;
      this.saveNow();
    }
    this.caravans.update(dt, feet.x, feet.z, interactRest);
    // Сундуки: открытие в этом кадре → автосейв (Chests.update вернёт true и сам
    // позовёт onChestOpened с монетами/предметом).
    this.chests.update(dt, feet.x, feet.z, interactRest, this.hud, this.onChestOpened);
    // Ремонт руин ([E] у разрушенного дома): списание монет/сейв — в onRepairHouse.
    // Дома стоят в деревне, сундуки/табличка — в стороне: за одну точку отвечает
    // ровно один промпт, поэтому потребители interactRest не конфликтуют.
    this.village.updateRepair(dt, feet.x, feet.z, interactRest, this.hud, () => this.coins >= REPAIR_COST, this.onRepairHouse);
    // Жители деревни ([E] «Поговорить» → диалог с сайд-квестами). Идёт ДО рынка:
    // житель ближе (≤2.6 м) и конкретнее, поэтому его [E] приоритетнее. Если диалог
    // открыт в этом кадре — гасим interactRest для рынка, чтобы не открыть заодно лавку.
    const talkedToVillager = this.updateVillagerInteract(dt, feet.x, feet.z, interactRest);
    // Мировые NPC-квестодатели (волна B): вне деревни, зоны не пересекаются с
    // рынком/службами; держим E-приоритет — съеденный E дальше не сработает.
    const talkedToWorldNpc =
      !talkedToVillager && this.updateWorldNpcInteract(dt, feet.x, feet.z, interactRest);
    // Странствующий торговец у лагеря охотника (волна B): [E] «Торговать» (наценка).
    const tradedTraveler =
      !talkedToVillager &&
      !talkedToWorldNpc &&
      this.updateTravelerInteract(dt, feet.x, feet.z, interactRest && !talkedToWorldNpc);
    // Скрытый предмет в лесу (волна B): [E] подбор вплотную к стволу. Тоже ест E.
    const tookNecklace =
      !talkedToVillager &&
      !talkedToWorldNpc &&
      !tradedTraveler &&
      this.updateNecklacePickup(dt, feet.x, feet.z, interactRest && !talkedToWorldNpc && !tradedTraveler);
    // Трактирщик на террасе постоялого двора (волна B+): [E] угостить элем → слух о
    // короване (та же askTavernRumor, что была в деревне — трактирщик переехал сюда).
    const usedInnKeeper =
      !talkedToVillager &&
      !talkedToWorldNpc &&
      !tradedTraveler &&
      !tookNecklace &&
      this.updateInnKeeperInteract(dt, feet.x, feet.z, interactRest && !talkedToWorldNpc && !tradedTraveler && !tookNecklace);
    // Мини-лавка внутри постоялого двора (волна B+): [E] «Торговать» (профиль двора).
    const usedInnShop =
      !usedInnKeeper &&
      !talkedToVillager &&
      !talkedToWorldNpc &&
      !tradedTraveler &&
      !tookNecklace &&
      this.updateInnShopInteract(dt, feet.x, feet.z, interactRest && !usedInnKeeper && !talkedToWorldNpc && !tradedTraveler && !tookNecklace);
    // Верхняя площадка сторожевой башни (волна B+): [E] «Осмотреться» → сводка о
    // ближайшем короване и набеге (бесплатно, как награда за подъём).
    const usedTower =
      !usedInnKeeper &&
      !usedInnShop &&
      !talkedToVillager &&
      !talkedToWorldNpc &&
      !tradedTraveler &&
      !tookNecklace &&
      this.updateTowerLookout(dt, feet.x, feet.y, feet.z, interactRest && !usedInnKeeper && !usedInnShop && !talkedToWorldNpc && !tradedTraveler && !tookNecklace);
    const usedWorld =
      talkedToWorldNpc || tradedTraveler || tookNecklace || usedInnKeeper || usedInnShop || usedTower;
    // Службы трат денег (фонтан-бафф / доска найма / трактирщик): вплотную (≤3-5 м)
    // и приоритетнее рынка. Идёт после жителя (тот ещё ближе), eats E при активации.
    const usedService = this.village.updateServices(
      dt,
      feet.x,
      feet.z,
      interactRest && !talkedToVillager && !usedWorld,
      this.hud,
      (s) => this.serviceLabel(s),
      this.onServiceActivate,
    );
    // Торговец на рыночной площади ([E] «Торговать» → лавка). Рынок — у центра,
    // руины — на кольце домов: промпты рынка и ремонта не накладываются. Когда у
    // фонтана/доски/трактирщика игрок ближе — рынок уступает им промпт (suppress).
    this.village.updateMarket(
      dt,
      feet.x,
      feet.z,
      interactRest && !talkedToVillager && !usedWorld && !usedService,
      this.hud,
      this.openShop,
      this.village.nearService !== null,
    );
    // Осмотр POI для активного visit-квеста + тик кулдаунов цепочек (раз в кадр).
    this.updateQuestVisit(dt, feet.x, feet.z);
    if (this.started) tickCooldowns(this.questState, dt);
    // collect-квест: прогресс по наличию предмета в сумке (ловит любые изменения
    // инвентаря — подбор/выброс/продажу — без хуков в каждом источнике).
    this.syncQuestCollect();
    // Камера: облёт деревни, пока открыто ГЛАВНОЕ меню до первого старта (мир
    // живёт за оверлеем). Иначе — обычная орбита за игроком (с плавным возвратом
    // с облёта при старте игры, внутри rig.update). Меню-из-паузы сюда не доходит:
    // там paused=true, tick выходит на renderPausedFrame.
    if (this.mainMenu.visible && !this.started) {
      this.rig.updateMenuOrbit(dt);
    } else if (this.riding) {
      // В лодке камера ведёт лодку (а не припаркованную капсулу игрока). Якорь —
      // позиция лодки на глади; исключаем коллайдер игрока, чтобы он не «толкал»
      // рейкаст камеры у причала. Курс камеры мягко доворачивается к носу лодки,
      // чтобы W всегда уводил «от камеры вперёд» (как на суше за спиной).
      _boatAnchor.set(this.boat.state.x, this.boat.visual.position.y, this.boat.state.z);
      this.rig.yaw = stepAngle(this.rig.yaw, this.boat.state.yaw, dt * 3);
      this.rig.update(dt, _boatAnchor, this.player.collider);
    } else {
      this.rig.update(dt, feet, this.player.collider);
    }

    // Карта мира открыта: обновляем позицию/стрелку игрока (yaw камеры уже актуален).
    if (this.worldMap.visible) {
      this.worldMap.updatePlayer(feet.x, feet.z, this.rig.yaw);
    }

    // Чип набега: число живых рейдеров + стрелка на деревню (вдали от неё). Угол
    // считает чистая raidArrowHint от позиции игрока, центра деревни и yaw камеры
    // (rig.update уже отработал — yaw актуален). Близко к деревне стрелка скрыта.
    if (this.raidActive) {
      const hint = raidArrowHint(feet.x, feet.z, VILLAGE.x, VILLAGE.z, this.rig.yaw, RAID_ARROW_DIST);
      this.hud.updateRaidChip(this.raid.raidersAlive, hint.show ? hint.angleRad : null);
    }

    // Опыт от грабежа корованов начисляется в колбэке директора (вне onEnemyDied) —
    // ловим пересечение порога уровня здесь, раз в кадр (дёшево: levelFromXp — цикл по 10).
    if (this.started && levelFromXp(this.xp) > this.level) this.recomputeLevel(true);

    // Бафф прыти: тикаем таймер, по истечении пересчитываем скорость без баффа.
    if (this.swiftLeft > 0) {
      this.swiftLeft -= dt;
      if (this.swiftLeft <= 0) {
        this.swiftLeft = 0;
        this.swiftMul = 1;
        void this.applyEquipment();
      }
    }

    // Бафф источника (Фаза 6B): реген HP + таймер. Реген копим до целой ед.,
    // чтобы не дёргать HUD/hp дробями; по истечении — пересчёт скорости без баффа.
    if (isBlessed(this.blessing)) {
      const wasBlessed = true;
      this.blessingHpAcc += tickBlessing(this.blessing, dt);
      if (this.blessingHpAcc >= 1 && this.player.hp < this.player.maxHp) {
        const heal = Math.floor(this.blessingHpAcc);
        this.blessingHpAcc -= heal;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      }
      if (wasBlessed && !isBlessed(this.blessing)) {
        // Бафф истёк в этом кадре — убрать прибавку скорости и чип.
        this.blessingHpAcc = 0;
        void this.applyEquipment();
        this.hud.showTicker('Благословение источника иссякло', 2.5);
      }
      this.updateBlessingChip();
    }

    // Наигранное время и автосейв раз в AUTOSAVE_PERIOD (только в активной игре).
    if (this.started) {
      this.playedSec += dt;
      this.autosaveLeft -= dt;
      if (this.autosaveLeft <= 0) {
        this.autosaveLeft = AUTOSAVE_PERIOD;
        this.saveNow();
      }
    }

    // Лёгкий зум прицела через fov — CameraRig не трогаем
    const targetFov = this.aiming ? FOV_AIM : FOV_DEFAULT;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }

    this.sun.position.set(feet.x + 30, feet.y + 50, feet.z + 20);
    this.sun.target.position.copy(feet);

    // Снимок кадра для звука: слушатель, темп шагов, фон. Объект переиспользуется
    const af = this.audioInfo;
    af.x = feet.x;
    af.y = feet.y;
    af.z = feet.z;
    af.speed = this.player.speed;
    af.grounded = this.player.grounded;
    af.verticalVel = this.player.verticalVelocity;
    // Одноразовый флаг воздушного прыжка: читаем-и-гасим, иначе «вуш» повторился бы.
    af.airJumped = this.player.consumeAirJump();
    af.landingVel = this.player.lastLandingVel;
    af.inVillage = Math.hypot(feet.x - VILLAGE.x, feet.z - VILLAGE.z) < VILLAGE.radius;
    // Ближайший живой манекен — для болтовни скелетов. По таймеру, не каждый
    // кадр: s.feet — body.translation() Rapier (аллокация на вызов), а VoiceBox
    // читает значение лишь раз в полсекунды (как табличка — раз в 0.2 с)
    this.skelScanLeft -= dt;
    if (this.skelScanLeft <= 0) {
      this.skelScanLeft = SKELETON_SCAN_PERIOD;
      let nearest = Infinity;
      for (const s of this.skeletons) {
        if (!s.alive) continue;
        const sf = s.feet;
        const d = Math.hypot(sf.x - af.x, sf.z - af.z);
        if (d < nearest) nearest = d;
      }
      af.nearestSkeletonDist = nearest;
    }
    this.audio.frame(dt, af);

    this.renderer.info.reset();
    this.composer.render();
    this.input.endFrame();
  }

  // ---- Debug API ----
  fps(): number {
    if (this.frameTimes.length === 0) return 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return Math.round(1 / avg);
  }

  /** Сколько слотов сумки занято (для смоук-проверки сбора лута). */
  private inventoryCount(): number {
    let n = 0;
    for (const s of this.inventory.slots) if (s) n++;
    return n;
  }

  debugState(): Record<string, unknown> {
    const feet = this.player?.position;
    return {
      phase: 6,
      seed: this.seed,
      autotest: this.autotest,
      started: this.started,
      introPlaying: this.introPlaying,
      screenOpen: this.screenOpen,
      shopOpen: this.shopScreen?.visible ?? false,
      mapOpen: this.worldMap?.visible ?? false,
      paused: this.paused,
      menuOpen: this.mainMenu?.visible ?? false,
      elapsed: Math.round(this.elapsed * 10) / 10,
      pos: feet ? { x: +feet.x.toFixed(2), y: +feet.y.toFixed(2), z: +feet.z.toFixed(2) } : null,
      grounded: this.player?.grounded ?? false,
      cameraPos: {
        x: +this.camera.position.x.toFixed(2),
        y: +this.camera.position.y.toFixed(2),
        z: +this.camera.position.z.toFixed(2),
      },
      hp: this.player?.hp ?? 0,
      // Остаток респаун-неуязвимости: пока > 0, hurtPlayer — no-op (смоуки ждут 0)
      invulnLeft: Math.max(0, Math.round(this.invulnLeft * 100) / 100),
      coins: this.coins,
      xp: this.xp,
      level: this.level,
      perkPoints: this.perkState.points,
      perksUnlocked: [...this.perkState.unlocked],
      inventoryCount: this.inventoryCount(),
      chests: {
        opened: this.chests.openedCount,
        total: this.chests.count,
        positions: this.chests.positions(),
      },
      save: {
        exists: hasSave(),
        version: 2,
        playedSec: Math.round(this.playedSec),
      },
      // arrows — снаряды В ПОЛЁТЕ (исторически), ammo — боезапас стрел.
      arrows: this.projectiles?.activeCount ?? 0,
      ammo: this.arrows,
      raid: {
        state: this.raid.state,
        difficulty: this.raid.difficulty,
        raidersAlive: this.raid.raidersAlive,
      },
      caravan: this.caravans.debugInfo(),
      heat: +this.heat.value.toFixed(2),
      fort: { x: this.fortPos.x, z: this.fortPos.z },
      ponds: this.ponds?.infos ?? [],
      lakes: this.lakes?.infos ?? [],
      // Лодка (волна 2): позиция/курс/катание — для смоука «доплыть до середины озера».
      boat: this.boat
        ? {
            x: +this.boat.state.x.toFixed(2),
            z: +this.boat.state.z.toFixed(2),
            yaw: +this.boat.state.yaw.toFixed(3),
            speed: +boatSpeed(this.boat.state).toFixed(2),
            riding: this.riding,
          }
        : null,
      landmarks: {
        poiCount: this.landmarks?.poiCount ?? 0,
        drawCalls: this.landmarks?.drawCalls ?? 0,
        pois: this.landmarks?.pois ?? [],
      },
      tgSign: { near: this.tgSign?.near ?? false, rewarded: this.tgSign?.rewarded ?? false },
      // Локации волны B: водопад (его меши/draw calls), мировые NPC, торговец, тайник.
      world: {
        waterfall: { x: this.waterfall?.pool.x ?? 0, z: this.waterfall?.pool.z ?? 0, drawCalls: this.waterfall?.drawCalls ?? 0 },
        worldNpcs: this.worldNpcs?.count ?? 0,
        traveler: this.travelerAt,
        necklaceFound: this.necklaceFound,
        necklaceAt: this.necklaceAt,
        fortKeys: this.questState ? fortKeyCount(this.questState) : 0,
      },
      audio: this.audio?.debugInfo() ?? { running: false, muted: false },
      nearRuin: this.village?.nearRuin ?? false,
      nearMarket: this.village?.nearMarket ?? false,
      // Службы трат денег (Фаза 6B): близость, бафф источника, нанятые стражники.
      nearService: this.village?.nearService ?? null,
      blessed: isBlessed(this.blessing),
      blessingLeft: Math.round(Math.max(0, this.blessing.left)),
      hiredGuards: this.hiredGuards?.count ?? 0,
      // Квесты (Фаза 6B): активный квест/прогресс + краткие статусы записей.
      quests: this.questState
        ? {
            activeIds: this.questState.activeIds,
            active: activeQuestViews(this.questState),
            dialogVillager: this.dialogVillager,
            villagers: this.villagers?.count ?? 0,
            entries: Object.fromEntries(
              Object.entries(this.questState.entries).map(([id, e]) => [
                id,
                { status: e.status, progress: e.progress, cooldown: +e.cooldown.toFixed(1) },
              ]),
            ),
          }
        : null,
      houses: this.village.houses.map((h) => ({ hp: h.hp, alive: h.alive })),
      enemies: [
        ...this.skeletons.map((s) => ({ id: s.id, archetype: s.archetype, hp: s.hp, alive: s.alive })),
        ...this.npcs.map((n) => {
          const f = n.feet;
          return {
            id: n.id,
            archetype: n.def.id,
            hp: n.hp,
            alive: n.alive,
            state: n.brain.state,
            pos: { x: +f.x.toFixed(2), z: +f.z.toFixed(2) },
          };
        }),
      ],
    };
  }

  debugStats(): { drawCalls: number; triangles: number; bodies: number; ai: number; fauna: number } {
    let ai = 0;
    for (const s of this.skeletons) if (s.alive) ai++;
    for (const n of this.npcs) if (n.alive) ai++;
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      bodies: this.physics?.bodyCount ?? 0,
      ai,
      fauna: this.fauna?.count ?? 0,
    };
  }

  teleport(x: number, z: number): void {
    this.player.teleport(x, this.terrain.height(x, z) + 0.3, z);
  }

  /** Телепорт игрока к причалу лодки и посадка — для смоука «доплыть до середины озера». */
  debugBoardBoat(): void {
    if (!this.boat) return;
    this.boat.resetToDock();
    this.teleport(this.boat.state.x, this.boat.state.z);
    this.boardBoat();
  }

  /** Принудительная высадка (смоук): к ближайшему берегу, иначе no-op. */
  debugDisembarkBoat(): void {
    if (!this.boat || !this.riding) return;
    const pt = findDisembarkPoint(this.boat.state, this.boatDepthAt);
    if (pt) this.disembarkBoat(pt.x, pt.z);
  }

  debugSetMove(x: number, z: number, sprint = false): void {
    const len = Math.hypot(x, z) || 1;
    this.debugMove = { x: x / len, z: z / len, sprint };
  }

  debugStopMove(): void {
    this.debugMove = null;
  }

  /** Милишная атака без мыши — для смоук-тестов (со звуком, как настоящая). */
  debugAttack(): void {
    if (this.combat.tryMelee(this.player, this.playerMelee)) this.audio.sfx.swingWoosh();
  }

  /** Постоянная сложность набегов (для сейва): зеркало RaidDirector.difficulty. */
  get raidDifficulty(): number {
    return this.raid?.difficulty ?? 1;
  }
  set raidDifficulty(v: number) {
    if (this.raid) this.raid.difficulty = v;
  }

  /** Выстрел арбалета в точку (x, z) без мыши и pointer lock — для смоук-тестов. */
  debugShootAt(x: number, z: number): void {
    _aimPoint.set(x, this.terrain.height(x, z) + 1.0, z);
    this.shootAtPoint(_aimPoint);
  }

  /** Немедленный набег: size — ровно size скелетов (каждый 4-й brute), без size — план от difficulty. */
  debugSpawnRaid(size?: number): void {
    this.raid.startRaid(size);
  }

  /** Немедленный карательный набег (скип броска/задержки) — для смоука: баннер+тикер+бонус. */
  debugForcePunitive(): void {
    this.raid.debugForcePunitive();
  }

  /** Немедленный корован (скип расписания): tier задан — конкретный ранг, иначе ролл по heat. */
  debugSpawnCaravan(tier?: string): void {
    if (tier !== undefined && tier !== 'poor' && tier !== 'merchant' && tier !== 'royal') {
      console.warn('[game] spawnCaravan: неизвестный tier', tier);
      return;
    }
    this.caravans.startCaravan(tier as CaravanTier | undefined);
  }

  /** Спавн NPC без await — автотесты затем поллят state().enemies. */
  debugSpawnNpc(archetypeId: string, x: number, z: number): void {
    void this.spawnNpc(archetypeId, x, z);
  }

  /**
   * Урон игроку для теста смерти/респауна. Идёт через takeDamage, поэтому в
   * окне респаун-неуязвимости (RESPAWN_INVULN после смерти) молча игнорируется —
   * как любой урон; смоуки ждут invulnLeft === 0 в debugState().
   */
  debugHurtPlayer(n: number): void {
    this.player.takeDamage(n);
  }

  debugGiveXP(n: number): void {
    this.xp += n;
    // Проверяем пересечение порога уровня (баннер/очки/звон), как при убийстве.
    this.recomputeLevel(true);
  }

  /** Выдать предмет в инвентарь — для смоуков (через тот же путь, что лут). */
  debugGiveItem(id: string, count = 1): void {
    if (!ITEMS[id]) {
      console.warn('[game] giveItem: неизвестный предмет', id);
      return;
    }
    this.collectItem(id, count);
  }

  /** Выдать n стрел (с учётом потолка) — для смоуков выстрела/счётчика. */
  debugGiveArrows(n: number): void {
    this.arrows = addArrows(this.arrows, n);
    this.hud.setAmmo(this.arrows);
  }

  /** Принудительный сейв сейчас (смоук). Возвращает успех. */
  debugSaveNow(): boolean {
    // Смоуки зовут до клика по меню — заставляем сохранить независимо от started.
    return saveGame(this);
  }

  /** Стереть сейв (смоук/«начать с чистого листа»). */
  debugWipeSave(): void {
    wipeSave();
  }

  debugKillAllEnemies(): void {
    for (const s of this.skeletons) if (s.alive) s.takeDamage(99999);
    for (const n of this.npcs) if (n.alive) n.takeDamage(99999);
  }

  /** Пауза/снятие/«в меню» из смоука (без pointer lock). */
  debugPause(): void {
    this.pauseGame();
  }
  debugResume(): void {
    this.resumeGame();
  }
  debugToMainMenu(): void {
    if (this.paused) this.openMainMenuFromPause();
  }

  /** Открыть деревенскую лавку из смоука (без подхода к торговцу). */
  debugOpenShop(): void {
    this.openShop();
  }

  // ---- Локации волны B: debug-хуки (водопад/мировые NPC/торговец/тайник) ----

  /** Открыть лавку странствующего торговца из смоука (профиль с наценкой). */
  debugOpenTravelerShop(): void {
    this.openTravelerShop();
  }

  /** Телепортировать к скрытому ожерелью и подобрать — для смоука (если не подобрано). */
  debugPickNecklace(): void {
    if (!this.necklaceAt) return;
    this.teleport(this.necklaceAt.x, this.necklaceAt.z);
    this.pickUpNecklace();
  }

  /** Снимок локаций волны B: водопад/мировые NPC/торговец/тайник/ключи. */
  debugWorldState(): Record<string, unknown> {
    return {
      waterfall: { x: this.waterfall?.pool.x ?? 0, z: this.waterfall?.pool.z ?? 0, drawCalls: this.waterfall?.drawCalls ?? 0 },
      worldNpcs: this.worldNpcs?.count ?? 0,
      traveler: this.travelerAt,
      shopMarkup: this.shopMarkup,
      necklaceFound: this.necklaceFound,
      necklaceAt: this.necklaceAt,
      fortKeys: this.questState ? fortKeyCount(this.questState) : 0,
      fortKeyIds: this.questState?.fortKeys ?? [],
      // Локации концов дорог (волна B+): координаты зданий + точки интеракций двора.
      roadEnds: {
        drawCalls: this.roadEnds?.drawCalls ?? 0,
        locations: this.roadEnds?.locations ?? [],
        innKeeper: this.roadEnds?.innKeeperPos ?? null,
        innShop: this.roadEnds?.innShopPos ?? null,
        npcAnchors: this.roadEnds?.npcAnchors ?? null,
      },
      // Сторожевая башня: точка/высота верхней площадки для [E]-«Осмотреться».
      towerLookout: this.landmarks?.towerLookout ?? null,
    };
  }

  // ---- Службы трат денег: debug-хуки (Фаза 6B) ----

  /** Бросить монету в фонтан без подхода — для смоука баффа источника. */
  debugTossCoin(): void {
    this.tossCoinInFountain();
  }

  /** Нанять стражника без подхода — для смоука найма/патруля/сейва. */
  debugHireGuard(): void {
    this.hireGuard();
  }

  /** Угостить трактирщика без подхода — для смоука слуха о короване. */
  debugTavernRumor(): void {
    this.askTavernRumor();
  }

  /** Снимок служб трат денег (для смоуков): бафф/стражники/слух. */
  debugServicesState(): Record<string, unknown> {
    return {
      blessingLeft: Math.round(Math.max(0, this.blessing.left)),
      blessed: isBlessed(this.blessing),
      blessingDur: BLESSING_DURATION_SEC,
      hiredGuards: this.hiredGuards.count,
      maxGuards: MAX_HIRED_GUARDS,
      guardSaves: this.hiredGuards.toSave(),
      nearService: this.village?.nearService ?? null,
      rumorToldFor: this.rumorToldFor,
      nextCaravan: this.caravans?.nextCaravanInfo() ?? null,
      nextCaravanIndex: this.caravans?.nextCaravanIndex ?? -1,
    };
  }

  /** Снимок состояния квестов (для смоуков): активный/прогресс/записи. */
  debugQuestState(): Record<string, unknown> {
    return {
      activeIds: this.questState.activeIds,
      active: activeQuestViews(this.questState),
      dialogVillager: this.dialogVillager,
      dialogOpen: this.dialogScreen?.visible ?? false,
      villagers: this.villagers?.count ?? 0,
      entries: { ...this.questState.entries },
    };
  }
}
