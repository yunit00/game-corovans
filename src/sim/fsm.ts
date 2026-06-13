// Конечный автомат AI-юнита: текущее состояние + входы восприятия → новое состояние.
// Чистая функция без таймеров и без ссылок на Three/Rapier — время живёт снаружи
// (в AI-системе), поэтому модуль тестируется в node на одних числах.

export type AiState = 'idle' | 'patrol' | 'chase' | 'attack' | 'flee';

export interface AiInputs {
  hasTarget: boolean; // восприятие видит живую цель
  distToTarget: number; // м (Infinity если цели нет)
  attackRange: number; // дальность атаки архетипа, м
  hpFrac: number; // 0..1
  fleeBelow: number; // порог бегства по hpFrac (0 = никогда не бежит)
  patrolDone: boolean; // дошёл до точки маршрута
}

// Гистерезис выхода из attack: цель должна уйти заметно дальше attackRange,
// иначе на границе дальности юнит дёргался бы между chase и attack каждый тик.
const ATTACK_EXIT_FACTOR = 1.25;

// Для выхода из flee нужен запас HP над порогом — без него юнит метался бы
// между flee и patrol, пока hpFrac колеблется около fleeBelow.
const FLEE_EXIT_FACTOR = 1.5;

export function nextState(cur: AiState, inp: AiInputs): AiState {
  // Бегство — высший приоритет: срабатывает из любого состояния, кроме самого flee
  // (внутри flee действует своё условие выхода с гистерезисом).
  // При fleeBelow = 0 условие недостижимо (hpFrac >= 0) — юнит бесстрашен.
  // hasTarget обязателен: HP не регенерирует, и раненый юнит, забывший цель
  // (выход из flee «по потере цели» ниже), иначе влетал бы обратно в flee
  // каждый тик — вечная осцилляция flee↔patrol. Бежать «от никого» и нечего:
  // без цели у бегства нет направления.
  if (cur !== 'flee' && inp.hasTarget && inp.hpFrac < inp.fleeBelow) return 'flee';

  switch (cur) {
    case 'idle':
    case 'patrol':
      // Чередование idle ↔ patrol (в т.ч. по patrolDone) решается снаружи,
      // FSM отвечает только за реакцию на появление цели.
      return inp.hasTarget ? 'chase' : cur;

    case 'chase':
      if (!inp.hasTarget) return 'patrol'; // цель потеряна — обратно к маршруту
      return inp.distToTarget <= inp.attackRange ? 'attack' : 'chase';

    case 'attack':
      if (!inp.hasTarget) return 'patrol';
      // Выход в chase только когда цель ушла дальше attackRange с запасом — гистерезис.
      return inp.distToTarget > inp.attackRange * ATTACK_EXIT_FACTOR ? 'chase' : 'attack';

    case 'flee':
      // Отбежал (цели нет) или отдышался (HP с запасом над порогом) — обратно в patrol.
      if (!inp.hasTarget || inp.hpFrac >= inp.fleeBelow * FLEE_EXIT_FACTOR) return 'patrol';
      return 'flee';
  }
}
