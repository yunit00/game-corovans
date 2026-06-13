// Воспроизводит баг «игрока тащит за врагом» на НАСТОЯЩЕМ Rapier.
//
// Механизм: тело игрока — KCC (computeColliderMovement делает депенетрацию от
// всех пересечённых коллайдеров). Тела NPC — kinematicPositionBased. Когда
// капсула NPC заходит в капсулу игрока (NPC прёт к слоту/толкается separation,
// или его прижало вплотную в attack), KCC выталкивает ИГРОКА из NPC. NPC едет
// дальше — и кадр за кадром толкает игрока перед собой: «тащит без ввода».
//
// Фикс: KCC игрока игнорирует кинематические тела (QueryFilterFlags.EXCLUDE_KINEMATIC).
// Непроход «NPC сквозь игрока / игрок сквозь NPC» удерживает стоп-дистанция стиринга
// (steering.ts) + отталкивание игрока в самом AISystem — это проверяется отдельно.
import { beforeAll, describe, expect, it } from 'vitest';
import { RAPIER, ALL_GROUPS, GROUP_PLAYER, GROUP_NPC, GROUP_STATIC, groups } from '../../src/core/PhysicsWorld';

const CAPSULE_HALF = 0.5;
const CAPSULE_RADIUS = 0.35;
const CENTER_Y = CAPSULE_HALF + CAPSULE_RADIUS;

// Каждый тест поднимает свой мир, но RAPIER.init() нужен один раз на файл.
beforeAll(async () => {
  await RAPIER.init();
});

/** Большой статичный пол под y=0 — чтобы KCC был grounded и не падал. */
function makeGround(world: RAPIER.World): void {
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0);
  const body = world.createRigidBody(desc);
  const col = RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setCollisionGroups(
    groups(GROUP_STATIC, ALL_GROUPS),
  );
  world.createCollider(col, body);
}

interface Kcc {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
}

/** Игрок как в PlayerCharacter.create: KCC-капсула с autostep/snapToGround. */
function makePlayerKcc(world: RAPIER.World, x: number, z: number): Kcc {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, CENTER_Y, z);
  const body = world.createRigidBody(bodyDesc);
  const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(
    groups(GROUP_PLAYER, ALL_GROUPS),
  );
  const collider = world.createCollider(colDesc, body);
  const controller = world.createCharacterController(0.05);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.6);
  controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
  controller.setApplyImpulsesToDynamicBodies(true);
  return { body, collider, controller };
}

/** NPC как в NpcCharacter: kinematicPositionBased капсула без KCC. */
function makeNpc(world: RAPIER.World, x: number, z: number): RAPIER.RigidBody {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, CENTER_Y, z);
  const body = world.createRigidBody(bodyDesc);
  const colDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS).setCollisionGroups(
    groups(GROUP_NPC, ALL_GROUPS),
  );
  world.createCollider(colDesc, body);
  return body;
}

/**
 * Один фикс-шаг игрока: точно как PlayerCharacter.fixedUpdate, но с опциональным
 * filterFlags для KCC (это и есть фикс).
 */
function stepPlayer(
  player: Kcc,
  vx: number,
  vz: number,
  vyVel: number,
  stepSec: number,
  filterFlags?: RAPIER.QueryFilterFlags,
): void {
  const desired = { x: vx * stepSec, y: vyVel * stepSec, z: vz * stepSec };
  player.controller.computeColliderMovement(player.collider, desired, filterFlags);
  const corrected = player.controller.computedMovement();
  const t = player.body.translation();
  player.body.setNextKinematicTranslation({
    x: t.x + corrected.x,
    y: t.y + corrected.y,
    z: t.z + corrected.z,
  });
}

describe('KCC игрока vs кинематическая капсула NPC', () => {
  it('БАГ: без фильтра NPC, проезжающий сквозь игрока, тащит игрока за собой', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    makeGround(world);
    const player = makePlayerKcc(world, 0, 0);
    // NPC стартует слева от игрока и едет на +X прямо сквозь точку игрока
    const npc = makeNpc(world, -2, 0);
    world.step();

    const stepSec = 1 / 60;
    const npcSpeed = 3; // м/с, как def.speed
    const startX = player.body.translation().x;

    // Игрок НИЧЕГО не нажимает (vx=vz=0), только прижим к земле как grounded
    for (let i = 0; i < 200; i++) {
      // NPC ползёт на +X
      const nt = npc.translation();
      npc.setNextKinematicTranslation({ x: nt.x + npcSpeed * stepSec, y: nt.y, z: nt.z });
      stepPlayer(player, 0, 0, -1.5, stepSec);
      world.step();
    }

    const driftX = player.body.translation().x - startX;
    // Без фильтра игрока вытолкнуло по +X (NPC «протащил» его перед собой)
    expect(driftX).toBeGreaterThan(0.3);
  });

  it('ФИКС: с EXCLUDE_KINEMATIC тот же NPC не смещает игрока', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    makeGround(world);
    const player = makePlayerKcc(world, 0, 0);
    const npc = makeNpc(world, -2, 0);
    world.step();

    const stepSec = 1 / 60;
    const npcSpeed = 3;
    const startX = player.body.translation().x;
    const startZ = player.body.translation().z;

    for (let i = 0; i < 200; i++) {
      const nt = npc.translation();
      npc.setNextKinematicTranslation({ x: nt.x + npcSpeed * stepSec, y: nt.y, z: nt.z });
      stepPlayer(player, 0, 0, -1.5, stepSec, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      world.step();
    }

    const driftX = Math.abs(player.body.translation().x - startX);
    const driftZ = Math.abs(player.body.translation().z - startZ);
    // Игрок остался на месте (допуск на численный шум)
    expect(driftX).toBeLessThan(0.02);
    expect(driftZ).toBeLessThan(0.02);
  });

  it('БАГ: NPC, прижатый к игроку и едущий вбок, тащит игрока за собой (без фильтра)', () => {
    // Сценарий жалобы: NPC стоит вплотную (капсулы перекрываются) и ползёт вбок —
    // например, обходит к своему слоту. KCC выталкивает игрока перед капсулой NPC.
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    makeGround(world);
    const player = makePlayerKcc(world, 0, 0);
    // NPC в оверлапе: центры в 0.5 м (< 2*0.35=0.7 → капсулы пересекаются)
    const npc = makeNpc(world, 0.5, 0);
    world.step();

    const stepSec = 1 / 60;
    const startZ = player.body.translation().z;
    // NPC едет по +Z, оставаясь близко по X (как при обходе к слоту)
    for (let i = 0; i < 120; i++) {
      const nt = npc.translation();
      npc.setNextKinematicTranslation({ x: nt.x, y: nt.y, z: nt.z + 2 * stepSec });
      stepPlayer(player, 0, 0, -1.5, stepSec);
      world.step();
    }
    const driftZ = player.body.translation().z - startZ;
    expect(driftZ).toBeGreaterThan(0.2); // игрока поволокло по +Z
  });

  it('ФИКС: тот же прижатый NPC, едущий вбок, игрока НЕ смещает', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    makeGround(world);
    const player = makePlayerKcc(world, 0, 0);
    const npc = makeNpc(world, 0.5, 0);
    world.step();

    const stepSec = 1 / 60;
    const startX = player.body.translation().x;
    const startZ = player.body.translation().z;
    for (let i = 0; i < 120; i++) {
      const nt = npc.translation();
      npc.setNextKinematicTranslation({ x: nt.x, y: nt.y, z: nt.z + 2 * stepSec });
      stepPlayer(player, 0, 0, -1.5, stepSec, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      world.step();
    }
    expect(Math.abs(player.body.translation().x - startX)).toBeLessThan(0.02);
    expect(Math.abs(player.body.translation().z - startZ)).toBeLessThan(0.02);
  });

  it('ФИКС: игрок по-прежнему НЕ проходит сквозь статику (стену)', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    makeGround(world);
    // Стена-куб на +X от игрока
    const wallDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(2, CENTER_Y, 0);
    const wallBody = world.createRigidBody(wallDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 1, 2).setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
      wallBody,
    );
    const player = makePlayerKcc(world, 0, 0);
    world.step();

    const stepSec = 1 / 60;
    // Игрок прёт на +X в стену
    for (let i = 0; i < 120; i++) {
      stepPlayer(player, 5, 0, -1.5, stepSec, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      world.step();
    }
    const px = player.body.translation().x;
    // Стена слева от x≈2-0.5=1.5; игрок (радиус 0.35) упирается, его центр < ~1.2
    expect(px).toBeLessThan(1.25);
  });
});
