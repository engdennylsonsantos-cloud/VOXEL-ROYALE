export class InputController {
  private pressed     = new Set<string>();
  private justPressed = new Set<string>(); // fire-once por keydown (sem repeat)

  constructor(target: Window = window) {
    target.addEventListener("keydown", this.handleKeyDown);
    target.addEventListener("keyup",   this.handleKeyUp);
  }

  /** Tecla atualmente segurada. */
  isPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Verdadeiro somente no frame em que a tecla FOI apertada (não ao segurar). */
  isJustPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /** Deve ser chamado no final de cada frame para limpar o estado one-shot. */
  clearJustPressed(): void {
    this.justPressed.clear();
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Impede comportamento padrão de teclas usadas pelo jogo
    if (event.code === "Tab" || event.code === "Space") {
      event.preventDefault();
    }
    if (!event.repeat) {
      // event.repeat == true quando é repetição de tecla segurada — ignora
      this.justPressed.add(event.code);
    }
    this.pressed.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };
}
