import * as THREE from 'three';
import { PhysicsWorld, groups, ALL_GROUPS, GROUP_STATIC } from '../core/PhysicsWorld';
import type { AssetLoader } from '../core/AssetLoader';
import { stepProjectile, segmentSphereHit, type ProjState } from '../sim/projectile';
import { areEnemies, CENTER_Y, type Team } from '../entities/Character';

// Ось модели стрелы — нос вдоль +Z (проверено визуальным смоуком); aimAlong кладёт
// её вдоль вектора полёта. WORLD_UP фиксирует крен оперения (роллфри-ориентация).
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Радиус сферы попадания по цели. */
const TARGET_RADIUS = 0.55;
/** Время жизни летящей стрелы, с. */
const FLY_TTL = 6;
/** Сколько живёт воткнувшаяся стрела, с (~15 с на месте, потом исчезает). */
const STUCK_TTL = 15;

export interface ArrowTarget {
  alive: boolean;
  feet: THREE.Vector3;
  /** Стрела ранит только врагов своего владельца (areEnemies). */
  team: Team;
}

/**
 * Цель охоты (зверь): команды нет — стрела ИГРОКА (ownerTeam === playerTeam) бьёт
 * её без areEnemies-фильтра, стрелы NPC по фауне не стреляют. Отдельный канал, чтобы
 * не вешать на зверя боевую команду и не агрить на него врагов/стражу.
 */
export interface HuntTarget {
  alive: boolean;
  feet: THREE.Vector3;
}

/** Состояние одной стрелы. */
interface Arrow {
  state: ProjState;
  mesh: THREE.Mesh;
  baseDamage: number;
  /** Команда стрелявшего: свои стрелы союзников не задевают. */
  ownerTeam: Team;
  ttl: number;
  stuck: boolean; // воткнулась в статику — не двигается
  dead: boolean; // помечена на удаление после итерации
  /** Сколько боевых целей стрела ещё может ПРОБИТЬ насквозь, не исчезая (капстоун). */
  pierceLeft: number;
  /** id уже пробитых целей за этот шаг — не бить одну и ту же дважды на сегменте. */
  pierced: Set<unknown>;
}

// Скретч-объекты для update/спавна — без аллокаций в кадре.
const _vel = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _target = new THREE.Vector3();

/**
 * Роллфри-ориентация меша по направлению dir (нормированному): нос модели (+Z, AXIS)
 * смотрит вдоль dir, крен (поворот вокруг оси полёта) зафиксирован мировым «верхом».
 * Без этого setFromUnitVectors на смене знака vy у апекса даёт паразитный крен —
 * стрела «болтается». Здесь оперение всегда внизу, полёт ровный. Пишет в outQuat.
 * dir не мутируется — все скретчи внутренние, можно передавать общий _vel.
 *
 * Matrix4.lookAt(eye, target, up) выстраивает локальный −Z от eye к target. Целимся
 * в −dir → локальный −Z вдоль −dir → локальный +Z (нос модели) ложится вдоль +dir.
 * Численно проверено для горизонталей и наклонных траекторий (нос = +dir).
 */
function aimAlong(dir: THREE.Vector3, outQuat: THREE.Quaternion): void {
  // up почти параллелен dir (выстрел строго вверх/вниз) — берём запасную ось,
  // иначе lookAt-базис вырождается (нулевой right-вектор → NaN-кватернион).
  _up.copy(WORLD_UP);
  if (Math.abs(dir.dot(_up)) > 0.999) _up.set(0, 0, 1);
  _mat.lookAt(_pos.set(0, 0, 0), _target.copy(dir).negate(), _up);
  outQuat.setFromRotationMatrix(_mat);
}

/** Кинематические стрелы: баллистика в sim-координатах, сегмент prev→next против туннелирования. */
export class ProjectileSystem {
  private arrows: Arrow[] = [];
  // Общие geometry/material из arrow.glb — экземпляры их не диспоузят
  private arrowGeometry: THREE.BufferGeometry | null = null;
  private arrowMaterial: THREE.Material | THREE.Material[] | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
  ) {}

  /** Прелоад модели стрелы: берём первый Mesh как шаблон. */
  async init(assets: AssetLoader): Promise<void> {
    const gltf = await assets.model('/assets/weapons/arrow.glb');
    gltf.scene.traverse((obj) => {
      if (!this.arrowGeometry && obj instanceof THREE.Mesh) {
        this.arrowGeometry = obj.geometry;
        this.arrowMaterial = obj.material;
      }
    });
  }

  /**
   * Выпустить стрелу из origin по направлению dir (нормализуется внутри). pierce —
   * сколько боевых целей стрела пробивает насквозь, не исчезая (капстоун «Пробивной
   * болт» передаёт 1: пробить первую, добить вторую). По умолчанию 0 — обычная стрела.
   */
  spawn(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    speed: number,
    baseDamage: number,
    ownerTeam: Team,
    pierce = 0,
  ): void {
    const geometry = this.arrowGeometry;
    const material = this.arrowMaterial;
    if (!geometry || !material) return; // init не вызван — молча игнорируем

    const d = dir.clone().normalize();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    aimAlong(d, mesh.quaternion);
    this.scene.add(mesh);

    this.arrows.push({
      state: {
        x: origin.x,
        y: origin.y,
        z: origin.z,
        vx: d.x * speed,
        vy: d.y * speed,
        vz: d.z * speed,
      },
      mesh,
      baseDamage,
      ownerTeam,
      ttl: FLY_TTL,
      stuck: false,
      dead: false,
      pierceLeft: pierce,
      pierced: new Set(),
    });
  }

  /**
   * Фиксированный шаг: полёт, попадания по целям, охота и статика. hunt — фауна:
   * её бьют только стрелы игрока (ownerTeam === playerTeam), по обычной формуле
   * onHuntHit. Передавай пустой массив hunt и любой onHuntHit, если охоты нет.
   */
  fixedUpdate<T extends ArrowTarget, H extends HuntTarget>(
    stepSec: number,
    targets: readonly T[],
    onHit: (target: T, baseDamage: number, ownerTeam: Team) => void,
    hunt: readonly H[],
    onHuntHit: (target: H, baseDamage: number) => void,
    playerTeam: Team,
  ): void {
    for (const arrow of this.arrows) {
      arrow.ttl -= stepSec;
      if (arrow.ttl <= 0) {
        arrow.dead = true;
        continue;
      }
      if (arrow.stuck) continue;

      const prev = arrow.state;
      const next = stepProjectile(prev, stepSec);
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const dz = next.z - prev.z;
      const len = Math.hypot(dx, dy, dz);

      if (len > 1e-9) {
        // a) ближайшая живая боевая цель на сегменте prev→next (уже пробитые
        // капстоуном цели пропускаем — стрела не бьёт одну и ту же дважды).
        let bestT = Infinity;
        let bestTarget: T | null = null;
        for (const target of targets) {
          if (!target.alive || !areEnemies(arrow.ownerTeam, target.team)) continue;
          if (arrow.pierced.has(target)) continue;
          const c = target.feet;
          const t = segmentSphereHit(
            prev.x, prev.y, prev.z,
            next.x, next.y, next.z,
            c.x, c.y + CENTER_Y, c.z,
            TARGET_RADIUS,
          );
          if (t !== null && t < bestT) {
            bestT = t;
            bestTarget = target;
          }
        }

        // a2) ближайший зверь (только для стрел игрока). Сравниваем с bestT в общей шкале t.
        let bestHuntT = Infinity;
        let bestHunt: H | null = null;
        if (arrow.ownerTeam === playerTeam) {
          for (const beast of hunt) {
            if (!beast.alive) continue;
            const c = beast.feet;
            const t = segmentSphereHit(
              prev.x, prev.y, prev.z,
              next.x, next.y, next.z,
              c.x, c.y + CENTER_Y, c.z,
              TARGET_RADIUS,
            );
            if (t !== null && t < bestHuntT) {
              bestHuntT = t;
              bestHunt = beast;
            }
          }
        }

        // b) статика на том же сегменте (дерево/дом/камень/телега-как-статика/земля)
        const inv = 1 / len;
        const hit = this.physics.raycastFull(
          prev,
          { x: dx * inv, y: dy * inv, z: dz * inv },
          len,
          undefined,
          groups(ALL_GROUPS, GROUP_STATIC),
        );
        const tStatic = hit ? hit.dist * inv : Infinity;

        // Кто ближе: боевая цель, зверь или статика — стрела бьёт первого на пути.
        if (bestTarget && bestT <= tStatic && bestT <= bestHuntT) {
          // боевая цель ближе всех — урон. Капстоун «Пробивной болт»: пока есть
          // запас пробоя, стрела не исчезает, а летит дальше сквозь цель (запомнив
          // её, чтобы не ударить повторно) и может добить следующего за ней.
          onHit(bestTarget, arrow.baseDamage, arrow.ownerTeam);
          if (arrow.pierceLeft > 0) {
            arrow.pierceLeft -= 1;
            arrow.pierced.add(bestTarget);
            arrow.state = next; // пролетаем сквозь — продолжаем полёт
            continue;
          }
          arrow.dead = true;
          continue;
        }
        if (bestHunt && bestHuntT <= tStatic) {
          // зверь ближе статики (и боевой цели) — добыча, стрела исчезает
          onHuntHit(bestHunt, arrow.baseDamage);
          arrow.dead = true;
          continue;
        }
        if (tStatic <= 1) {
          // статика ближе — «втыкаемся»: фиксируем точку попадания, гасим скорость
          // и доворачиваем меш по УГЛУ ПРИЛЁТА (последний вектор полёта). Дальше
          // update пропускает stuck-стрелу — ориентация замирает под этим углом.
          arrow.state = {
            x: prev.x + dx * tStatic,
            y: prev.y + dy * tStatic,
            z: prev.z + dz * tStatic,
            vx: 0,
            vy: 0,
            vz: 0,
          };
          // Зафиксировать ориентацию по углу прилёта (последний вектор полёта).
          _vel.set(dx, dy, dz).multiplyScalar(inv);
          aimAlong(_vel, arrow.mesh.quaternion);
          arrow.mesh.position.set(arrow.state.x, arrow.state.y, arrow.state.z);
          arrow.stuck = true;
          arrow.ttl = STUCK_TTL;
          continue;
        }
      }

      arrow.state = next;
    }

    // Удаляем помеченные после итерации; общие geometry/material не диспоузим
    if (this.arrows.some((a) => a.dead)) {
      for (const a of this.arrows) {
        if (a.dead) this.scene.remove(a.mesh);
      }
      this.arrows = this.arrows.filter((a) => !a.dead);
    }
  }

  /** Визуальный шаг: позиция из состояния, ориентация по скорости (роллфри). */
  update(_dt: number): void {
    for (const arrow of this.arrows) {
      if (arrow.stuck) continue; // воткнутая стрела неподвижна — ориентацию не дёргаем
      const s = arrow.state;
      arrow.mesh.position.set(s.x, s.y, s.z);
      const v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
      if (v2 > 1e-12) {
        _vel.set(s.vx, s.vy, s.vz).multiplyScalar(1 / Math.sqrt(v2));
        aimAlong(_vel, arrow.mesh.quaternion);
      }
    }
  }

  get activeCount(): number {
    return this.arrows.length;
  }
}
