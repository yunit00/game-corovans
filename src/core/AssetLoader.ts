import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assetUrl } from './assetUrl';

/** Снимок прогресса загрузки ассетов для экрана загрузки (LoadingScreen). */
export interface LoadProgress {
  /** Сколько уникальных загрузок (моделей/текстур/HDRI) запрошено к этому моменту. */
  requested: number;
  /** Сколько из них завершилось (успешно или с ошибкой — счётчик доходит до requested). */
  completed: number;
}

export class AssetLoader {
  private gltfLoader = new GLTFLoader();
  private hdrLoader = new HDRLoader();
  private texLoader = new THREE.TextureLoader();
  private gltfCache = new Map<string, Promise<GLTF>>();
  private texCache = new Map<string, Promise<THREE.Texture>>();

  /** Реестр загруженных моделей — для __game.dumpClips() */
  readonly loaded = new Map<string, GLTF>();

  /**
   * Счётчики прогресса: requested растёт при первом запросе уникального ассета
   * (кэш-хиты повторно не считаются — иначе total «раздувался» бы), completed —
   * при завершении его промиса. Колбэк onProgress дёргается на каждом завершении.
   */
  private requested = 0;
  private completed = 0;
  /** Подписчик прогресса (LoadingScreen). Один — больше потребителей нет. */
  onProgress: ((p: LoadProgress) => void) | null = null;

  constructor() {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Текущий снимок прогресса (для опроса извне без подписки). */
  get progress(): LoadProgress {
    return { requested: this.requested, completed: this.completed };
  }

  /** Зарегистрировать новый уникальный запрос (до старта реальной загрузки). */
  private trackRequest(): void {
    this.requested++;
  }

  /**
   * Обернуть промис загрузки: по завершении (resolve ИЛИ reject) инкрементит
   * completed и зовёт onProgress, затем пробрасывает результат/ошибку дальше.
   * reject тоже считается «завершением» — иначе полоса застрянет на битом ассете.
   */
  private trackDone<T>(p: Promise<T>): Promise<T> {
    const finish = () => {
      this.completed++;
      this.onProgress?.(this.progress);
    };
    p.then(finish, finish);
    return p;
  }

  model(path: string): Promise<GLTF> {
    let p = this.gltfCache.get(path);
    if (!p) {
      this.trackRequest();
      p = this.trackDone(
        this.gltfLoader.loadAsync(assetUrl(path)).then((gltf) => {
          const key = path.split('/').pop()!.replace(/\.(glb|gltf)$/i, '');
          this.loaded.set(key.toLowerCase(), gltf);
          return gltf;
        }),
      );
      this.gltfCache.set(path, p);
    }
    return p;
  }

  /** Клон скиннед-модели с собственным скелетом (для NPC из одного GLTF). */
  static cloneSkinned(scene: THREE.Object3D): THREE.Object3D {
    return SkeletonUtils.clone(scene);
  }

  texture(path: string, opts?: { srgb?: boolean; repeat?: number }): Promise<THREE.Texture> {
    const key = `${path}|${JSON.stringify(opts ?? {})}`;
    let p = this.texCache.get(key);
    if (!p) {
      this.trackRequest();
      p = this.trackDone(
        this.texLoader.loadAsync(assetUrl(path)).then((tex) => {
          if (opts?.srgb) tex.colorSpace = THREE.SRGBColorSpace;
          if (opts?.repeat) {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(opts.repeat, opts.repeat);
          }
          tex.anisotropy = 8;
          return tex;
        }),
      );
      this.texCache.set(key, p);
    }
    return p;
  }

  hdri(path: string): Promise<THREE.DataTexture> {
    // HDRI не кэшируется (зовётся один раз за init), но в прогресс входит — это
    // самый тяжёлый файл неба, без него полоса стартовала бы «не с нуля».
    this.trackRequest();
    return this.trackDone(
      this.hdrLoader.loadAsync(assetUrl(path)).then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return tex;
      }),
    );
  }
}
