// Клавиатура + мышь (pointer lock). Снимается снапшотом раз в кадр.
export class Input {
  private keys = new Set<string>();
  private pressedEdge = new Set<string>();
  private mouseButtons = new Set<number>();
  private mousePressedEdge = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  pointerLocked = false;

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      // Tab по умолчанию уводит фокус на следующий элемент (и выбивает из игры) —
      // глушим это, Tab используется как игровая клавиша (карта мира).
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedEdge.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });

    window.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button);
      this.mousePressedEdge.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    // ПКМ-прицеливание не должно открывать контекстное меню
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('click', () => {
      if (!this.pointerLocked) {
        // В песочнице превью pointer lock запрещён — глушим reject
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** true один раз за нажатие (edge-trigger). */
  pressed(code: string): boolean {
    return this.pressedEdge.has(code);
  }

  /** Кнопка мыши зажата (0=ЛКМ, 2=ПКМ). */
  mouseDown(button: number): boolean {
    return this.mouseButtons.has(button);
  }

  /** true один раз за нажатие кнопки мыши (edge-trigger). */
  mousePressed(button: number): boolean {
    return this.mousePressedEdge.has(button);
  }

  /** Сбросить пер-кадровые аккумуляторы. Вызывается в конце кадра. */
  endFrame(): void {
    this.pressedEdge.clear();
    this.mousePressedEdge.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
