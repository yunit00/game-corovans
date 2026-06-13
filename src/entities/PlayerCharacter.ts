import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { AssetLoader } from '../core/AssetLoader';
import { ALL_GROUPS, GROUP_PLAYER, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import {
  DEFAULT_ATTACKER,
  DEFAULT_DEFENDER,
  type AttackerStats,
  type DefenderStats,
} from '../sim/damage';
import { makeJumpTimers, stepAngle, stepJumpTimers, yawFromDir } from '../sim/movement';
import { AnimationController } from './AnimationController';
import type { Team } from './Character';

const CAPSULE_HALF = 0.5;
const CAPSULE_RADIUS = 0.35;
const CENTER_Y = CAPSULE_HALF + CAPSULE_RADIUS; // центр капсулы над ногами

/**
 * Поправка ориентации арбалета в левой кисти (рад). Меш приходит «торчком» вверх,
 * −90° по X кладёт ложе вперёд вдоль взгляда персонажа (−Z) и горизонтально; yaw/roll
 * — мелкая доводка под кость кисти. Точные углы выверены визуальным смоуком прицела.
 */
const CROSSBOW_PITCH = -Math.PI / 2; // ложе из вертикали — в горизонталь, носом вперёд
const CROSSBOW_YAW = 0;
const CROSSBOW_ROLL = 0;
const GRAVITY = -22;
/** Гравитация на спуске сильнее подъёма: быстрый возврат на землю — «платформерная» дуга. */
const GRAVITY_FALL = -30;
const JUMP_VEL = 7.5;
/** Воздушный (второй) прыжок: перезаписывает текущую вертикаль — резкий рывок вверх. */
const AIR_JUMP_VEL = JUMP_VEL * 0.92;
/** Прыжок из спринта чуть мощнее: выше и (за счёт сохранённой горизонтали) дальше. */
const SPRINT_JUMP_VEL = JUMP_VEL * 1.06;
/**
 * Падение медленнее этого при касании земли — не настоящее приземление (шаг
 * по кочке). Общий гейт анимации приземления и звука (AudioEngine.frame).
 */
export const LAND_MIN_FALL_VEL = -3;

export interface PlayerMoveIntent {
  dir: { x: number; z: number };
  sprint: boolean;
  jump: boolean;
}

export class PlayerCharacter {
  body!: RAPIER_NS.RigidBody;
  collider!: RAPIER_NS.Collider;
  controller!: RAPIER_NS.KinematicCharacterController;
  visual = new THREE.Group();
  anim!: AnimationController;

  speedRun = 5.0;
  speedSprint = 7.6;

  /** Сокет правой кисти (handslot.r → handslotr) — туда вешаем меш милишного оружия. */
  private handSocket: THREE.Object3D | null = null;
  /** Сокет левой кисти (handslot.l → handslotl) — туда ВСЕГДА вешаем арбалет (вторая рука). */
  private leftHandSocket: THREE.Object3D | null = null;
  /** Встроенные меши милишного оружия в правой руке (Knife/Throwable) — прячем при экипировке своих. */
  private builtinWeaponMeshes: THREE.Object3D[] = [];
  /** Левый встроенный нож (Knife_Offhand): прячется при экипировке И в позе прицеливания (там арбалет). */
  private builtinOffhandKnife: THREE.Object3D | null = null;
  /** Спрятаны ли встроенные кинжалы из-за экипировки НЕ-кинжального оружия. */
  private hideBuiltinMelee = false;
  /**
   * Встроенные арбалеты модели (1H/2H_Crossbow) висят в ПРАВОЙ руке у самого глифа —
   * там же, где нож. Это и есть жалоба игрока. Прячем их НАВСЕГДА и держим свой
   * арбалет в левой руке (crossbowMesh).
   */
  private builtinCrossbowMeshes: THREE.Object3D[] = [];
  /** Текущий подвешенный меш милишной экипировки (снимаем при смене оружия). */
  private equippedWeaponMesh: THREE.Object3D | null = null;
  /** Меш арбалета во второй (левой) руке. null — арбалет ещё не загружен. */
  private crossbowMesh: THREE.Object3D | null = null;
  /** Подняты ли руки в позе прицеливания (ПКМ). Управляет позой и видимостью арбалета. */
  private aiming = false;

  // Боевые статы (Фаза 3). Игрок намеренно не наследует Character: у него свой
  // KCC-цикл движения и свой респаун вместо onDeath. Поля структурно совместимы
  // с MeleeActor из CombatSystem и NpcTarget из NpcCharacter (цели AI/стрел).
  hp = 100;
  maxHp = 100;
  /** Эльф — против всех (см. areEnemies): и скелеты, и стража его враги. */
  team: Team = 'elf';
  attackStats: AttackerStats = { ...DEFAULT_ATTACKER };
  defenseStats: DefenderStats = { ...DEFAULT_DEFENDER };
  private verticalVel = 0;
  grounded = false;
  /** Скорость по XZ за последний фикс-шаг (для выбора анимации). */
  private lastSpeed = 0;
  private targetYaw = 0;
  /** Буфер нажатия + койот-тайм (см. stepJumpTimers): прыжок прощает ±0.1 с. */
  private readonly jumpTimers = makeJumpTimers();
  /** Поднят в фикс-шаге при касании земли, потребляется в update (анимация приземления). */
  private justLanded = false;
  /** Вертикальная скорость в шаге приземления — отличить падение от шага по кочке. */
  private landingVel = 0;
  /** Поднят в фикс-шаге воздушного (второго) прыжка; читает и гасит звук (см. consumeAirJump). */
  private airJumped = false;

  static async create(
    physics: PhysicsWorld,
    assets: AssetLoader,
    spawn: THREE.Vector3,
  ): Promise<PlayerCharacter> {
    const p = new PlayerCharacter();

    const gltf = await assets.model('/assets/characters/rogue_hooded.glb');
    const model = AssetLoader.cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    p.visual.add(model);
    p.anim = new AnimationController(model, gltf.animations);
    p.anim.setLocomotion('idle');
    p.findWeaponNodes(model);

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawn.x,
      spawn.y + CENTER_Y,
      spawn.z,
    );
    p.body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(
      groups(GROUP_PLAYER, ALL_GROUPS),
    );
    p.collider = physics.world.createCollider(colDesc, p.body);

    p.controller = physics.world.createCharacterController(0.05);
    p.controller.enableAutostep(0.5, 0.2, true);
    p.controller.enableSnapToGround(0.6);
    p.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    p.controller.setApplyImpulsesToDynamicBodies(true);

    return p;
  }

  /**
   * Найти сокеты кистей и встроенные меши оружия модели rogue_hooded.
   * Узлы (по дампу GLB): сокеты handslot.r / handslot.l (GLTFLoader срезает точку →
   * handslotr/handslotl). Встроенное оружие — Knife (правая), Knife_Offhand (левая),
   * 1H_Crossbow/2H_Crossbow/Throwable — все в ПРАВОЙ руке у самого глифа.
   *
   * Канон: нож — в правой, арбалет — в левой, всегда. Поэтому встроенные
   * арбалеты (правая рука) прячем навсегда, а свой арбалет вешаем в левый сокет.
   */
  private findWeaponNodes(model: THREE.Object3D): void {
    this.handSocket =
      model.getObjectByName('handslotr') ??
      model.getObjectByName('handslot.r') ??
      model.getObjectByName('hand_r') ??
      model.getObjectByName('handr') ??
      null;
    this.leftHandSocket =
      model.getObjectByName('handslotl') ??
      model.getObjectByName('handslot.l') ??
      model.getObjectByName('hand_l') ??
      model.getObjectByName('handl') ??
      null;
    // Правая рука (нож/метательное) — прячем при экипировке НЕ-кинжального оружия.
    for (const name of ['Knife', 'Throwable']) {
      const node = model.getObjectByName(name);
      if (node) this.builtinWeaponMeshes.push(node);
    }
    // Левая рука: встроенный нож. Прячется и в прицеливании — там его место занимает арбалет.
    this.builtinOffhandKnife = model.getObjectByName('Knife_Offhand') ?? null;
    // Встроенные арбалеты висят в правой руке — прячем навсегда: арбалет каноном слева.
    for (const name of ['1H_Crossbow', '2H_Crossbow']) {
      const node = model.getObjectByName(name);
      if (node) {
        node.visible = false;
        this.builtinCrossbowMeshes.push(node);
      }
    }
  }

  /**
   * Один раз подвесить арбалет в ЛЕВУЮ руку (вторая рука). Зовётся при создании
   * игрока: арбалет «всегда при себе», видимость переключает setAiming.
   */
  async attachCrossbow(assets: AssetLoader, meshName = 'crossbow_2handed'): Promise<void> {
    if (!this.leftHandSocket || this.crossbowMesh) return;
    try {
      const gltf = await assets.model(`/assets/weapons/${meshName}.glb`);
      const mesh = gltf.scene.clone(true);
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      // Ориентация ложа: по умолчанию меш в сокете кисти встаёт «торчком» вверх
      // (жалоба игрока — арбалет перпендикулярен земле). Доворачиваем ложе ВДОЛЬ
      // ВЗГЛЯДА (вперёд, −Z в системе персонажа) и горизонтально. Кость кисти
      // анимируется (aim вскидывает руку), но локальная поправка едина для обеих
      // поз — арбалет «лежит» в руке естественно и при прицеле смотрит на цель.
      mesh.rotation.set(CROSSBOW_PITCH, CROSSBOW_YAW, CROSSBOW_ROLL);
      this.leftHandSocket.add(mesh);
      // Вне прицеливания арбалет опущен/у бедра — прячем, чтобы не мешал милишке.
      mesh.visible = this.aiming;
      this.crossbowMesh = mesh;
    } catch {
      // Меш не нашёлся — не критично: бой по WEAPONS работает и так.
    }
  }

  /**
   * Поза прицеливания (ПКМ): вскинуть арбалет. Показываем меш арбалета в левой руке
   * и включаем held-клип 2H_Ranged_Aiming (верх тела целится). Выход — обратно в
   * локомоцию. Выстрел проигрывает свой one-shot поверх (RangedAttack).
   */
  setAiming(on: boolean): void {
    if (on === this.aiming) return;
    this.aiming = on;
    if (this.crossbowMesh) this.crossbowMesh.visible = on;
    this.refreshBuiltinMeleeVisibility();
    this.anim.setAiming(on);
  }

  /** Видимость встроенных кинжалов: правый — по экипировке, левый — ещё и не в прицеливании. */
  private refreshBuiltinMeleeVisibility(): void {
    const showMelee = !this.hideBuiltinMelee;
    for (const m of this.builtinWeaponMeshes) m.visible = showMelee;
    // Левый нож уступает место арбалету в позе прицеливания.
    if (this.builtinOffhandKnife) this.builtinOffhandKnife.visible = showMelee && !this.aiming;
  }

  /**
   * Подвесить меш милишного оружия в ПРАВУЮ кисть. meshName — файл в
   * /assets/weapons/ (см. ITEMS.mesh / WeaponDef.mesh). hideBuiltin — спрятать
   * встроенные кинжалы модели (для НЕ-кинжального оружия), иначе они остаются
   * (дефолтный кинжал и есть «встроенный» меш). Арбалет сюда не попадает —
   * он каноном в левой руке (attachCrossbow). Снимает прежний меш.
   */
  async setWeaponMesh(assets: AssetLoader, meshName: string | null, hideBuiltin: boolean): Promise<void> {
    this.hideBuiltinMelee = hideBuiltin;
    // Видимость встроенных кинжалов (левый прячется ещё и в прицеливании).
    this.refreshBuiltinMeleeVisibility();

    // Снять прежде подвешенный меш экипировки.
    if (this.equippedWeaponMesh) {
      this.equippedWeaponMesh.removeFromParent();
      this.equippedWeaponMesh = null;
    }
    if (!meshName || !this.handSocket) return;

    // dagger совпадает со встроенным Knife — отдельный меш не вешаем (иначе двойной).
    if (meshName === 'dagger') return;

    try {
      const gltf = await assets.model(`/assets/weapons/${meshName}.glb`);
      const mesh = gltf.scene.clone(true);
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.handSocket.add(mesh);
      this.equippedWeaponMesh = mesh;
    } catch {
      // Меш не нашёлся — не критично: бой и так работает по WEAPONS.
    }
  }

  /** Кэш для position — геттер зовут каждый кадр и каждый фикс-шаг (лут, камера). */
  private readonly _feet = new THREE.Vector3();

  /** Позиция ног. Возвращает общий кэш-вектор: читать сразу, не хранить. */
  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return this._feet.set(t.x, t.y - CENTER_Y, t.z);
  }

  /** Алиас position под контракт MeleeActor (позиция ног). */
  get feet(): THREE.Vector3 {
    return this.position;
  }

  /** Куда смотрит визуал — направление милишного удара. */
  get yaw(): number {
    return this.visual.rotation.y;
  }

  /** Жив, пока hp > 0; смерть и респаун разруливает Game (hp=0 живёт меньше кадра). */
  get alive(): boolean {
    return this.hp > 0;
  }

  /** Скорость по XZ за последний фикс-шаг — Game отдаёт её звуку (темп шагов). */
  get speed(): number {
    return this.lastSpeed;
  }

  /** Вертикальная скорость за последний фикс-шаг, +вверх — звук отличает прыжок от схода с края. */
  get verticalVelocity(): number {
    return this.verticalVel;
  }

  /** Скорость падения в момент последнего приземления — гейт звука (как у анимации). */
  get lastLandingVel(): number {
    return this.landingVel;
  }

  /**
   * Был ли в этом кадре воздушный (второй) прыжок. ОДНОРАЗОВО: читает и гасит
   * флаг, чтобы звук сыграл ровно один раз. Зовёт Game перед AudioEngine.frame.
   */
  consumeAirJump(): boolean {
    const v = this.airJumped;
    this.airJumped = false;
    return v;
  }

  /**
   * Респаун-неуязвимость (ставит и снимает Game по своему таймеру): гейт здесь,
   * потому что сюда сходятся оба пути урона — милишка NPC (AISystem.strikeMelee)
   * и стрелы (Game.onArrowHit); общей точки в самом Game у них нет.
   */
  invulnerable = false;

  /** Урон без onDeath: Game замечает hp=0 в tick и делает респаун с затемнением. */
  takeDamage(amount: number): void {
    if (this.invulnerable) return;
    this.hp = Math.max(0, Math.min(this.maxHp, this.hp - amount));
  }

  fixedUpdate(stepSec: number, intent: PlayerMoveIntent): void {
    const jump = stepJumpTimers(this.jumpTimers, stepSec, intent.jump, this.grounded);
    if (jump === 'ground') {
      // Прыжок из спринта чуть мощнее: с земли. Горизонталь в полёте мы не режем
      // (air-drag нет — desired по XZ берётся напрямую из intent.dir·speed), так
      // что 7.6 м/с спринта сами по себе дают заметно бóльшую дальность.
      this.verticalVel = intent.sprint ? SPRINT_JUMP_VEL : JUMP_VEL;
      // Не one-shot 'jumpStart': у KayKit-клипа виндап, и busy блокировал бы
      // локомоцию до конца клипа — персонаж «залипал». Сразу поза полёта.
      this.anim.setLocomotion('jumpIdle', 0.08);
    } else if (jump === 'air') {
      // Воздушный (второй) прыжок: ПЕРЕЗАПИСЫВАЕТ вертикаль — резкий рывок вверх
      // независимо от того, поднимались мы или уже падали («более высокий» рывок).
      this.verticalVel = AIR_JUMP_VEL;
      this.airJumped = true;
      this.anim.setLocomotion('jumpIdle', 0.08);
    } else if (this.grounded) {
      this.verticalVel = -1.5; // прижим к земле
    } else {
      this.verticalVel += (this.verticalVel > 0 ? GRAVITY : GRAVITY_FALL) * stepSec;
    }

    const speed = intent.sprint ? this.speedSprint : this.speedRun;
    const desired = {
      x: intent.dir.x * speed * stepSec,
      y: this.verticalVel * stepSec,
      z: intent.dir.z * speed * stepSec,
    };

    // EXCLUDE_KINEMATIC: KCC депенетрируется только от статики (террейн, дома,
    // деревья), но НЕ от кинематических капсул NPC. Иначе движущаяся капсула
    // врага, въезжая в игрока, выталкивала его кадр за кадром — игрока «тащило»
    // за NPC без всякого ввода. Непроход NPC сквозь игрока держит стоп-дистанция
    // стиринга (arriveStop в chase) — NPC сам не лезет телом в игрока.
    this.controller.computeColliderMovement(
      this.collider,
      desired,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
    );
    const corrected = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (!wasGrounded && this.grounded) {
      // verticalVel ещё хранит скорость падения — прижим -1.5 выставится следующим шагом.
      this.justLanded = true;
      this.landingVel = this.verticalVel;
    }

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    });

    this.lastSpeed = Math.hypot(corrected.x, corrected.z) / stepSec;
    if (Math.abs(intent.dir.x) + Math.abs(intent.dir.z) > 0.01) {
      this.targetYaw = yawFromDir(intent.dir.x, intent.dir.z);
    }
  }

  /** Покадровое обновление визуала: позиция, поворот, анимации. */
  update(dt: number): void {
    const t = this.body.translation();
    this.visual.position.set(t.x, t.y - CENTER_Y, t.z);
    this.visual.rotation.y = stepAngle(this.visual.rotation.y, this.targetYaw, dt * 12);

    if (this.justLanded) {
      this.justLanded = false;
      // Приземление стоя после настоящего падения — короткий one-shot
      // (timeScale 1.6: KayKit Jump_Land ужимается до ~0.3 с реального времени).
      // В движении — никакой церемонии: ветка ниже сразу включит run.
      if (this.lastSpeed <= 0.5 && this.landingVel < LAND_MIN_FALL_VEL && !this.anim.busy) {
        this.anim.playOneShot('jumpLand', { fade: 0.06, timeScale: 1.6 });
      }
    }

    if (!this.anim.busy) {
      if (!this.grounded) {
        this.anim.setLocomotion('jumpIdle', 0.12);
      } else if (this.lastSpeed > 6) {
        // Спринт: темп клипа выше — синхронней с участившимися шагами (AudioEngine).
        this.anim.setLocomotion('run', 0.18, 1.3);
      } else if (this.lastSpeed > 0.5) {
        this.anim.setLocomotion('run', 0.18, 1.0);
      } else {
        this.anim.setLocomotion('idle');
      }
    }
    this.anim.update(dt);
  }

  teleport(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y: y + CENTER_Y, z }, true);
    this.verticalVel = 0;
    // Респаун не должен унаследовать буферизованный прыжок или ожидающее приземление.
    this.jumpTimers.buffer = 0;
    this.jumpTimers.coyote = 0;
    this.jumpTimers.airJumpsUsed = 0;
    this.jumpTimers.jumped = false;
    this.justLanded = false;
    this.airJumped = false;
  }
}
