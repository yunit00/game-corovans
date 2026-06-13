import { Game } from './core/Game';
import { LoadingScreen } from './ui/LoadingScreen';

// Uncaught-ошибки из rAF-цикла не видны инструментам — дублируем в console
window.addEventListener('error', (e) => console.error('[uncaught]', e.message, e.error?.stack ?? ''));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled-promise]', e.reason));

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

const ui = document.getElementById('ui');
if (!ui) throw new Error('#ui not found');

// Экран загрузки создаём ДО init: игрок открывает ссылку и видит полосу/стадии
// сразу (мир ~46 МБ + построение грузится не мгновенно), а фатальная ошибка уходит
// не только в console, но и в крупный читаемый блок. Живёт в #ui поверх меню.
const loadingScreen = new LoadingScreen(ui);
loadingScreen.setStage('Готовим мир…');
loadingScreen.show();

// Быстрая проверка WebGL2 ДО init: на старых браузерах/без драйверов three.js упал
// бы где-то в недрах с невнятной ошибкой. Здесь — понятный текст про браузер сразу.
function webgl2Available(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

if (!webgl2Available()) {
  const err = new Error(
    'Браузер не поддерживает WebGL2. Игре нужен WebGL2 — обновите браузер, ' +
      'включите аппаратное ускорение или попробуйте другой браузер (Chrome/Firefox/Edge).',
  );
  console.error('[game] WebGL2 unavailable');
  loadingScreen.showError(err);
} else {
  new Game().init(app, loadingScreen).catch((err) => {
    // console.error оставляем (привычка инструментов), плюс видимый блок для игрока.
    console.error('[game] fatal init error:', err);
    loadingScreen.showError(err);
  });
}
