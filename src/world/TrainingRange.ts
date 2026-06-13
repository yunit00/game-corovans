// Стрельбище деревни (по отзывам игроков: «в деревне стоят в ряд скелеты»). Заменяет
// 5 скелетов-манекенов на ДЕРЕВЯННЫЕ тренировочные манекены с мишенями — чтобы
// зона читалась как тир, а не как строй нежити. Сборка процедурная (THREE.Group,
// без GLB), сущность наследует протокол Skeleton (id/hp/alive/feet/takeDamage),
// поэтому бой/уборка/счёт/слух «о тире» работают как раньше. id 1-5 сохранены.
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bus } from '../core/EventBus';
import { ALL_GROUPS, GROUP_NPC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { CAPSULE_HALF, CAPSULE_RADIUS, CENTER_Y, Character } from '../entities/Character';
import type { SkeletonArchetype } from '../entities/Skeleton';

/** Раскладка манекена: позиция, разворот и тип («столб» или «мишень-стойка»). */
export interface DummySlot {
  /** Смещение по X относительно точки тира (метры). */
  dx: number;
  /** Смещение по Z относительно точки тира (метры). */
  dz: number;
  /** Разворот вокруг вертикали (радианы): мишенью к стрелку, с разбросом. */
  yaw: number;
  /** Стойка-мишень подальше (для стрельбы издалека) vs манекен-столб вблизи. */
  kind: 'dummy' | 'target';
}

/**
 * Детерминированная раскладка 5 манекенов: 3 столба полукругом вблизи + 2
 * мишени-стойки подальше. Разброс по yaw/позиции выводится из индекса, поэтому
 * раскладка стабильна между сессиями и не вырождается в прямой ряд.
 *
 * Геометрия в локальных координатах тира (Game добавляет VILLAGE.x+38, VILLAGE.z−12).
 * Полукруг развёрнут к деревне: манекены смотрят на стрелка, а не друг на друга.
 */
export function trainingDummyLayout(count = 5): DummySlot[] {
  const slots: DummySlot[] = [];
  // 3 столба полукругом радиусом ~3 м: углы −50°..+50° от направления «к деревне».
  const near = Math.min(3, count);
  for (let i = 0; i < near; i++) {
    const t = near > 1 ? i / (near - 1) : 0.5; // 0..1 вдоль дуги
    const ang = (-50 + t * 100) * (Math.PI / 180); // −50°..+50°
    const r = 3 + ((i * 7) % 3) * 0.45; // лёгкий разброс радиуса от индекса
    slots.push({
      dx: Math.sin(ang) * r,
      dz: Math.cos(ang) * r,
      // Лицом к стрелку (−ang) + детерминированный разброс ±0.18 рад от индекса.
      yaw: -ang + ((i % 2 === 0 ? 1 : -1) * (0.08 + (i % 3) * 0.05)),
      kind: 'dummy',
    });
  }
  // Оставшиеся — мишени-стойки на 7-9 м (стрельба издалека), смещены по X.
  for (let i = near; i < count; i++) {
    const k = i - near;
    slots.push({
      dx: (k === 0 ? -2.2 : 2.6) + k * 0.4,
      dz: 7 + k * 2,
      yaw: (k === 0 ? 0.12 : -0.1),
      kind: 'target',
    });
  }
  return slots;
}

const WOOD_DARK = 0x6b4a2c; // столб/стойка
const WOOD_LIGHT = 0x8a623a; // перекладина-руки
const STRAW = 0xd9c179; // «голова»-сноп
const RING_WHITE = 0xf2efe6;
const RING_RED = 0xc0392b;
const RING_GOLD = 0xe1b341;

/** Круглая мишень с 2-3 концентрическими кольцами (белое/красное/золотое яблочко). */
function buildTargetFace(radius: number): THREE.Group {
  const g = new THREE.Group();
  const disc = (r: number, color: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(r, 24),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide }),
    );
    m.position.z = z; // микро-сдвиг от z-файтинга колец
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  };
  g.add(disc(radius, RING_WHITE, 0));
  g.add(disc(radius * 0.62, RING_RED, 0.004));
  g.add(disc(radius * 0.24, RING_GOLD, 0.008));
  // Обод-рамка из дерева — тонкое кольцо по краю.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, radius * 0.07, 8, 24),
    new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.9 }),
  );
  rim.position.z = -0.01;
  g.add(rim);
  return g;
}

/**
 * Процедурный деревянный манекен (THREE.Group, локальные координаты, ноги в y=0).
 * Столб-цилиндр + перекладина-руки + соломенная «голова» + мишень на груди.
 * variant: 'dummy' — манекен с руками и головой; 'target' — стойка с большой мишенью.
 * lean — детерминированный наклон вперёд (рад), tall — масштаб высоты.
 */
export function buildDummyVisual(
  variant: 'dummy' | 'target',
  lean: number,
  tall: number,
): THREE.Group {
  const g = new THREE.Group();
  const woodPost = new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.92 });
  const woodArm = new THREE.MeshStandardMaterial({ color: WOOD_LIGHT, roughness: 0.9 });

  if (variant === 'dummy') {
    const postH = 1.5 * tall;
    // Столб-туловище
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, postH, 10), woodPost);
    post.position.y = postH / 2;
    post.castShadow = true;
    post.receiveShadow = true;
    g.add(post);
    // Перекладина-руки на высоте плеч
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.05, 8), woodArm);
    arm.rotation.z = Math.PI / 2;
    arm.position.y = postH * 0.78;
    arm.castShadow = true;
    g.add(arm);
    // Соломенная «голова»-сноп
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      new THREE.MeshStandardMaterial({ color: STRAW, roughness: 1 }),
    );
    head.position.y = postH + 0.16;
    head.scale.y = 1.15;
    head.castShadow = true;
    g.add(head);
    // Мишень на груди (смотрит в +Z — туда же, куда «лицо»)
    const face = buildTargetFace(0.34);
    face.position.set(0, postH * 0.55, 0.14);
    g.add(face);
  } else {
    // Стойка-мишень: две косые ноги + крупная мишень на раме
    const legGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.7 * tall, 7);
    for (const sx of [-0.45, 0.45]) {
      const leg = new THREE.Mesh(legGeo, woodPost);
      leg.position.set(sx, 0.78 * tall, 0.18);
      leg.rotation.x = -0.22;
      leg.rotation.z = sx > 0 ? 0.14 : -0.14;
      leg.castShadow = true;
      g.add(leg);
    }
    const backLeg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 1.8 * tall, 7),
      woodPost,
    );
    backLeg.position.set(0, 0.82 * tall, -0.3);
    backLeg.rotation.x = 0.3;
    backLeg.castShadow = true;
    g.add(backLeg);
    const face = buildTargetFace(0.5);
    face.position.set(0, 1.25 * tall, 0.2);
    g.add(face);
  }

  // Детерминированный наклон вперёд — «потрёпанный» вид, не строевая выправка.
  g.rotation.x = lean;
  return g;
}

/** HP по архетипу — повторяет таблицу Skeleton (она не экспортирована): манекен
 *  умирает за то же число попаданий, что и заменённый скелет (баланс тира тот же). */
const HP_BY_ARCHETYPE: Record<SkeletonArchetype, number> = {
  skeleton_minion: 30,
  skeleton_rogue: 45,
  skeleton_warrior: 70,
};

/**
 * Деревянный тренировочный манекен тира. Дублирует ПУБЛИЧНЫЙ протокол Skeleton
 * (id/archetype/corpseTimer/hp/alive/feet/takeDamage/update/dispose), но наследует
 * Character (у Skeleton приватный конструктор — расширять напрямую нельзя). Поэтому
 * структурно присваивается в this.skeletons: Skeleton[], и бой/уборка/счёт/слух
 * «о тире» работают без изменений. Визуал процедурный (без GLB) и без скелетной
 * анимации — манекен «опрокидывается» наклоном Group при смерти.
 */
export class TrainingDummy extends Character {
  readonly id: number;
  readonly archetype: SkeletonArchetype;
  /** Game инкрементит после смерти, по таймауту зовёт dispose (как у скелета). */
  corpseTimer = 0;

  /** Локальный визуал манекена (внутри Character.visual) — его и опрокидываем. */
  private rig!: THREE.Group;
  /** Прогресс падения трупа [0..1] (плавный завал набок при смерти). */
  private fall = 0;
  private falling = false;
  /** Затухающий «вздрог» от попадания (кивок мишени). */
  private hitWobble = 0;

  private constructor(id: number, archetype: SkeletonArchetype) {
    super();
    this.id = id;
    this.archetype = archetype;
    this.team = 'villain';
    this.maxHp = HP_BY_ARCHETYPE[archetype];
    this.hp = this.maxHp;
  }

  static async create(
    physics: PhysicsWorld,
    _assets: AssetLoader,
    pos: THREE.Vector3, // ноги
    archetype: SkeletonArchetype,
    id: number,
    faceYaw = 0,
    kind: 'dummy' | 'target' = 'dummy',
  ): Promise<TrainingDummy> {
    const d = new TrainingDummy(id, archetype);

    // Детерминированный разброс высоты/наклона от id (стабилен между сессиями).
    const lean = ((id * 37) % 7) / 100 - 0.03; // ~−0.03..+0.03 рад
    const tall = 0.92 + (((id * 53) % 11) / 11) * 0.18; // 0.92..1.10
    const rig = buildDummyVisual(kind, lean, tall);
    d.rig = rig;
    d.visual.add(rig);
    d.visual.position.copy(pos);
    d.visual.rotation.y = faceYaw;

    // Фиксированное тело-капсула, как у скелета-манекена: стрелы/милишка попадают
    // ровно так же. Манекен не двигается, поэтому body fixed.
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + CENTER_Y, pos.z);
    d.body = physics.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(
      groups(GROUP_NPC, ALL_GROUPS),
    );
    d.collider = physics.world.createCollider(colDesc, d.body);

    return d;
  }

  // Без скелетной анимации: лёгкий кивок от попадания вместо клипа 'hit'.
  protected override onHit(): void {
    this.hitWobble = 0.18;
  }

  // «Смерть» = манекен опрокидывается набок (анимации нет). Коллайдер гасим,
  // событие enemy:died эмитим как скелет (XP/лут/счёт идут прежним путём).
  protected override onDeath(): void {
    this.collider.setEnabled(false);
    this.falling = true;
    const f = this.feet;
    // Эмит вручную (как Skeleton.onDeath, но без anim): тот же id/archetype/pos/xp,
    // синхронно — XP/лут/квест-счёт обрабатываются ровно как у скелета-манекена.
    bus.emit('enemy:died', {
      id: this.id,
      archetype: this.archetype,
      pos: { x: f.x, y: f.y, z: f.z },
      xp: 10,
    });
  }

  /** Без скелетной анимации: завал трупа + затухание кивка от попадания. */
  update(dt: number): void {
    if (this.hitWobble > 0) {
      this.hitWobble = Math.max(0, this.hitWobble - dt * 1.6);
      // Кивок мишени вокруг X — затухающий.
      this.rig.rotation.z = Math.sin(this.hitWobble * 18) * this.hitWobble * 0.12;
    }
    if (this.falling && this.fall < 1) {
      this.fall = Math.min(1, this.fall + dt * 2.2);
      // Завал набок (вокруг Z) до ~90°, с лёгким переклоном.
      this.rig.rotation.z = (Math.PI / 2) * easeOutBack(this.fall);
    }
  }

  /** Снять визуал и тело — как Skeleton.dispose (Game зовёт по таймауту трупа). */
  dispose(scene: THREE.Scene, physics: PhysicsWorld): void {
    scene.remove(this.visual);
    physics.world.removeRigidBody(this.body);
  }
}

/** Лёгкий «перелёт» в конце падения, чтобы манекен плюхнулся, а не дополз. */
function easeOutBack(x: number): number {
  const c1 = 1.2;
  const c3 = c1 + 1;
  const p = x - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}
