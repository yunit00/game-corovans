declare module 'three/examples/jsm/libs/meshopt_decoder.module.js' {
  // Реальный тип задаёт GLTFLoader.setMeshoptDecoder; нам важен только сам объект.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const MeshoptDecoder: any;
}

// window.__game — контракт смоук-тестов (см. core/DebugApi.ts). saveNow()/wipeSave()
// добавлены в Фазе 6 вместе с инвентарём/перками/сундуками/сейвами.
import type { DebugApi } from './core/DebugApi';
declare global {
  interface Window {
    __game?: DebugApi;
  }
}
