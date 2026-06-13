import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { bboxOf, enableShadows, scaleToFootprint } from '../core/meshUtils';
import { ALL_GROUPS, GROUP_STATIC, groups, PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { mulberry32 } from '../core/rng';
import type { Hud } from '../ui/Hud';
import { House, REPAIR_COST } from './House';
import { VILLAGE } from './WorldData';
import type { Terrain } from './Terrain';

/**
 * Дистанция интеракции ремонта руины, м — от КРАЯ дома (targetRadius), не от
 * центра: коллайдер руины не пускает игрока ближе ~5 м к центру крупного дома,
 * фиксированный порог от центра был бы недостижим.
 */
const REPAIR_DIST = 2.5;
/** Период проверки дистанции, с — раз в ~0.2 с, не каждый кадр. */
const REPAIR_CHECK_PERIOD = 0.2;

/**
 * Радиус торговой точки стрел на рыночной площади, м. Лотки стоят в 10 м от
 * центра-фонтана (см. build), берём чуть шире, чтобы продавец ловил у любого лотка.
 */
const MARKET_DIST = 13;

const HOUSE_VARIANTS = [
  'building_home_a_green',
  'building_home_b_green',
  'building_home_a_yellow',
  'building_home_b_yellow',
];

/** Дистанция [E]-интеракции у доски найма/трактирщика, м (узкие точки). */
export const SERVICE_DIST = 3.0;
/**
 * Дистанция [E] у фонтана, м — больше: фонтан крупный (коллайдер-цилиндр ~3 м от
 * центра не пускает игрока ближе), порог от центра 3 м был бы недостижим.
 */
export const FOUNTAIN_DIST = 5.0;

/** Тип службы деревни для [E]-промпта (Фаза 6B): фонтан/доска найма. (Трактирщик
 *  переехал в постоялый двор на конце южного тракта — волна B+, RoadEnds.) */
export type VillageService = 'fountain' | 'hire';

/** Деревня эльфов: кольцо деревянных домиков вокруг рыночной площади с фонтаном. */
export class Village {
  /** Дома — цели набегов Фазы 4 (HP, дым, руины); руину можно отремонтировать (Фаза 6.5). */
  houses: House[] = [];

  /** Игрок у руины (для смоуков/промпта ремонта). */
  nearRuin = false;
  private nearHouse: House | null = null;
  private repairCheckLeft = 0;
  private repairPromptShown = false;

  /** Игрок у торговца на рынке (для смоуков/промпта «Торговать»). */
  nearMarket = false;
  private marketCheckLeft = 0;
  /** Был ли промпт рынка уже показан — чтобы не дёргать HUD каждый чек. */
  private marketPromptShown = false;

  /** Точки служб деревни (Фаза 6B): фонтан-бафф, доска найма. */
  readonly fountainPos = { x: VILLAGE.x, z: VILLAGE.z };
  readonly hirePos = { x: 0, z: 0 };
  /** К какой службе игрок сейчас ближе SERVICE_DIST (для смоуков/промпта). null — ни к какой. */
  nearService: VillageService | null = null;
  private serviceCheckLeft = 0;
  /** Ключ показанного промпта службы (служба+доступность) — гейт перерисовки. */
  private servicePromptKey = '';

  async build(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    assets: AssetLoader,
    seed: number,
    terrain: Terrain,
  ): Promise<void> {
    const rng = mulberry32(seed ^ 0x5e1f);
    const cx = VILLAGE.x;
    const cz = VILLAGE.z;

    const place = async (
      path: string,
      x: number,
      z: number,
      opts: { footprint?: number; faceCenter?: boolean; rot?: number; collider?: 'box' | 'cylinder' | 'none' },
    ): Promise<THREE.Object3D | null> => {
      let gltf;
      try {
        gltf = await assets.model(path);
      } catch {
        console.warn(`[village] не загрузилось: ${path}`);
        return null;
      }
      const obj = gltf.scene.clone();
      const s = opts.footprint ? scaleToFootprint(obj, opts.footprint) : 1;
      obj.scale.setScalar(s);
      const y = terrain.height(x, z);
      obj.position.set(x, 0, z);
      obj.rotation.y = opts.faceCenter ? Math.atan2(cx - x, cz - z) : (opts.rot ?? rng() * Math.PI * 2);
      // Основание модели — точно на землю (пивоты бывают в центре)
      obj.position.y = y - bboxOf(obj).min.y;
      enableShadows(obj);
      scene.add(obj);

      const box = bboxOf(obj);
      const size = box.getSize(new THREE.Vector3());
      const collider = opts.collider ?? 'box';
      if (collider === 'box') {
        const q = new THREE.Quaternion().setFromEuler(obj.rotation);
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(size.x * 0.42, size.y / 2, size.z * 0.42)
            .setTranslation(x, y + size.y / 2, z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
        );
      } else if (collider === 'cylinder') {
        physics.world.createCollider(
          RAPIER.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) * 0.45)
            .setTranslation(x, y + size.y / 2, z)
            .setCollisionGroups(groups(GROUP_STATIC, ALL_GROUPS)),
        );
      }
      return obj;
    };

    // Кольцо домиков
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      // Радиус 32–42 (был 30–40): апскейл домов ×1.15 (до ~13.2 м) — чуть шире
      // кольца под больший зазор. Худшая хорда между соседями
      // 2·32·sin((π/4 − 0.25)/2) ≈ 18.4 м > 13.2 + ~2 м зазора — не налезают.
      // Сдвиг наружу мал, чтобы не подойти к стрельбищу (cx+46, cz−22, footprint 12).
      const r = 32 + rng() * 10;
      const x = cx + Math.sin(angle) * r;
      const z = cz + Math.cos(angle) * r;
      const variant = HOUSE_VARIANTS[Math.floor(rng() * HOUSE_VARIANTS.length)]!;
      const footprint = (9.5 + rng() * 2) * 1.15; // ×1.15 апскейл (~10.9–13.2 м); порядок rng не меняем
      const mesh = await place(`/assets/world/hexagon/${variant}.glb`, x, z, {
        footprint,
        faceCenter: true,
      });
      if (mesh) {
        this.houses.push(new House(`house_${i}`, mesh, scene, x, terrain.height(x, z), z, footprint));
      }
    }

    // Площадь: фонтан, лотки, фонари, телега, мешки
    await place('/assets/world/town/fountain-round-detail.glb', cx, cz, { footprint: 6.5, rot: 0, collider: 'cylinder' });
    const stalls = ['stall-green', 'stall-red', 'stall'];
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + 0.5;
      await place(`/assets/world/town/${stalls[i]}.glb`, cx + Math.sin(angle) * 10, cz + Math.cos(angle) * 10, {
        footprint: 3.8,
        faceCenter: true,
      });
    }
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + 0.25;
      await place('/assets/world/town/lantern.glb', cx + Math.sin(angle) * 14, cz + Math.cos(angle) * 14, {
        footprint: 0.7,
        collider: 'none',
      });
    }
    await place('/assets/world/town/cart.glb', cx + 16, cz + 6, { footprint: 3.8 });
    await place('/assets/world/hexagon/sack.glb', cx - 12, cz + 9, { footprint: 1.9, collider: 'none' });
    await place('/assets/props/crates_stacked.glb', cx - 14, cz + 7, { footprint: 2 });

    // --- Службы трат денег (Фаза 6B): доска найма и уголок трактирщика ---
    // Доска найма стражников — флаг-«призыв к оружию» на СЕВЕРНОМ краю площади
    // (откуда приходят набеги). r=11 от центра: за пределами лотков (r=10), но
    // ближе фонарей (r=14) — игрок подходит вплотную, не задевая рынок-центр.
    {
      const hx = cx;
      const hz = cz - 11;
      this.hirePos.x = hx;
      this.hirePos.z = hz;
      await place('/assets/world/town/banner-red.glb', hx, hz, { footprint: 2.4, faceCenter: true, collider: 'none' });
    }
    // (Трактирщик с уголком бочек переехал в ПОСТОЯЛЫЙ ДВОР на конце южного тракта
    //  — волна B+, RoadEnds. В деревне его уголок убран; служба 'tavern' снята.)

    // Стрельбище эльфов на отшибе. Отодвинуто от кольца домов (r 30–40) и
    // манекенов (x 33–43, z 108): на (46, 98) худший дом кольца в ≥14.6 м,
    // ближайший манекен в ≥10.4 м — крупнее коллайдера даже у квадратного bbox
    await place('/assets/world/hexagon/building_archeryrange_green.glb', cx + 46, cz - 22, {
      footprint: 12,
      faceCenter: true,
    });
  }

  /** Покадровый визуал домов (дым/огонь повреждённых). */
  update(dt: number): void {
    for (const h of this.houses) h.update(dt);
  }

  /**
   * Интеракция ремонта руины (Фаза 6.5): подойти к разрушенному дому ближе
   * REPAIR_DIST, нажать E. Дистанция считается раз в REPAIR_CHECK_PERIOD.
   * onRepair(house) делает Game: проверка/списание монет — вернёт true, если
   * ремонт состоялся (хватило монет). Промпт показывает цену или «нужно N монет».
   * Возвращает true в кадре фактического ремонта (Game пишет сейв/тикер).
   */
  updateRepair(
    dt: number,
    playerX: number,
    playerZ: number,
    interact: boolean,
    hud: Hud,
    canAfford: () => boolean,
    onRepair: (house: House) => boolean,
  ): boolean {
    this.repairCheckLeft -= dt;
    if (this.repairCheckLeft <= 0) {
      this.repairCheckLeft = REPAIR_CHECK_PERIOD;
      let best: House | null = null;
      let bestMargin = 0; // запас до порога: выбираем руину, к которой игрок «глубже» всего подошёл
      for (const h of this.houses) {
        if (h.alive) continue; // ремонтируем только руины
        const d = Math.hypot(playerX - h.pos.x, playerZ - h.pos.z);
        const margin = h.targetRadius + REPAIR_DIST - d;
        if (margin > bestMargin) {
          bestMargin = margin;
          best = h;
        }
      }
      // Текст промпта зависит и от цели, и от платёжеспособности — пересчитываем,
      // когда меняется дом ИЛИ когда у дома сменилась доступность ремонта.
      const affordable = best !== null && canAfford();
      if (best !== this.nearHouse || (best !== null && affordable !== this.repairPromptShown)) {
        this.nearHouse = best;
        this.nearRuin = best !== null;
        if (best) {
          this.repairPromptShown = affordable;
          hud.showPrompt(
            affordable
              ? `[E] Восстановить дом — ${REPAIR_COST} монет`
              : `Нужно ${REPAIR_COST} монет, чтобы восстановить дом`,
          );
        } else {
          hud.hidePrompt();
        }
      }
    }

    if (this.nearHouse && interact && !this.nearHouse.alive) {
      const house = this.nearHouse;
      // Game спишет монеты и позовёт house.repair(); false — не хватило монет.
      if (onRepair(house)) {
        this.nearHouse = null;
        this.nearRuin = false;
        hud.hidePrompt();
        return true;
      }
    }
    return false;
  }

  /**
   * Торговец на рынке (Фаза 6B): у центра площади (фонтан/лотки) по [E] открыть
   * магазин («Торговать»). Поглотил прежний промпт покупки стрел — теперь стрелы
   * один из товаров лавки. Дистанция считается раз в REPAIR_CHECK_PERIOD.
   * onTrade() делает Game (открывает ShopScreen). Промпт рынка и ремонта не
   * конфликтуют: рынок — у центра, руины — на кольце домов.
   */
  updateMarket(
    dt: number,
    playerX: number,
    playerZ: number,
    interact: boolean,
    hud: Hud,
    onTrade: () => void,
    /**
     * Промптом сейчас владеет более близкая служба (фонтан/доска/трактирщик):
     * рынок свою подпись не показывает (но интеракция остаётся доступной — служба
     * «съедает» E сама и сюда interact уже придёт false).
     */
    suppressPrompt = false,
  ): void {
    this.marketCheckLeft -= dt;
    if (this.marketCheckLeft <= 0) {
      this.marketCheckLeft = REPAIR_CHECK_PERIOD;
      const d = Math.hypot(playerX - VILLAGE.x, playerZ - VILLAGE.z);
      const near = d <= MARKET_DIST && !suppressPrompt;
      if (near !== this.marketPromptShown) {
        this.marketPromptShown = near;
        this.nearMarket = near;
        if (near) hud.showPrompt('[E] Торговать');
        else if (!suppressPrompt) hud.hidePrompt();
      }
    }

    if (this.nearMarket && interact) {
      // Открываем лавку и прячем промпт — экран блокирует ввод, [E] на нём не нужен.
      hud.hidePrompt();
      this.marketPromptShown = false;
      onTrade();
    }
  }

  /**
   * Службы трат денег (Фаза 6B): фонтан-бафф / доска найма / трактирщик. Раз в
   * REPAIR_CHECK_PERIOD ищем ближайшую службу в радиусе SERVICE_DIST и показываем
   * её промпт (с ценой/доступностью через labels). Нажатие E у службы зовёт
   * onActivate(service) — Game выполняет действие (бросок монеты/найм/слух). Идёт
   * ДО рынка и приоритетнее него: службы вплотную (≤3 м), рынок — весь центр (13 м).
   * Возвращает true, если в этом кадре активировали службу (Game «съест» E, чтобы
   * не открыть заодно лавку). labels(service) даёт текст промпта по состоянию игры.
   */
  updateServices(
    dt: number,
    playerX: number,
    playerZ: number,
    interact: boolean,
    hud: Hud,
    labels: (service: VillageService) => string,
    onActivate: (service: VillageService) => void,
  ): boolean {
    this.serviceCheckLeft -= dt;
    if (this.serviceCheckLeft <= 0) {
      this.serviceCheckLeft = REPAIR_CHECK_PERIOD;
      const near = this.nearestService(playerX, playerZ);
      // Ключ = служба + её подпись: смена доступности (хватает монет/лимит) перерисует.
      const key = near ? `${near}:${labels(near)}` : '';
      if (key !== this.servicePromptKey) {
        this.servicePromptKey = key;
        this.nearService = near;
        if (near) hud.showPrompt(labels(near));
        else hud.hidePrompt();
      }
    }

    if (this.nearService && interact) {
      const service = this.nearService;
      // Промпт мог смениться диалогом/экраном — сбрасываем ключ, чтобы перерисовать заново.
      this.servicePromptKey = '';
      onActivate(service);
      return true;
    }
    return false;
  }

  /**
   * Ближайшая «перекрытая порогом» служба (или null). Сравниваем по запасу до
   * порога (radius − dist), а не по сырой дистанции: у фонтана порог шире, иначе
   * стоя у фонтана ближняя по сырой дистанции узкая точка перебивала бы его.
   * Без аллокаций.
   */
  private nearestService(px: number, pz: number): VillageService | null {
    let best: VillageService | null = null;
    let bestMargin = 0;
    const consider = (service: VillageService, x: number, z: number, radius: number): void => {
      const margin = radius - Math.hypot(px - x, pz - z);
      if (margin > bestMargin) {
        bestMargin = margin;
        best = service;
      }
    };
    consider('fountain', this.fountainPos.x, this.fountainPos.z, FOUNTAIN_DIST);
    consider('hire', this.hirePos.x, this.hirePos.z, SERVICE_DIST);
    return best;
  }
}
