/**
 * TouchControls — HUD completo de controles touch para smartphones.
 *
 * Layout:
 *   - Joystick analógico (esquerda inferior) → moveX / moveZ
 *   - Área de câmera (direita) → lookDeltaX / lookDeltaY
 *   - Botões de ação (direita inferior): ATIRAR, MIRA, PULAR, RECARREGAR
 *   - Botões de menu (direita superior): INVENTÁRIO, RANKING
 *   - Botão central inferior: PEGAR ITEM / INTERAGIR
 *   - Botão sprint (acima do joystick)
 */

const JOYSTICK_RADIUS = 68; // px — raio do anel do joystick
const DEAD_ZONE       = 0.08;

export class TouchControls {
  readonly element: HTMLDivElement;

  // ── Entradas de movimento (lidas pelo GameApp a cada frame) ────────────
  moveX = 0; // -1 (esquerda) … +1 (direita)
  moveZ = 0; // -1 (frente)   … +1 (trás)   — igual ao eixo Z do Three.js

  // ── Rotação de câmera acumulada por frame (resetada após leitura) ──────
  lookDeltaX = 0;
  lookDeltaY = 0;

  // ── Estado de botões ───────────────────────────────────────────────────
  isFireHeld          = false;
  isFireJustPressed   = false;
  isAimHeld           = false;
  isJumpJustPressed   = false;
  isSprintActive      = false;
  isReloadJustPressed    = false;
  isInteractJustPressed  = false;
  isInventoryJustPressed = false;
  isScoreboardHeld       = false;

  // ── Private ────────────────────────────────────────────────────────────
  private joystickId     : number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private lookId         : number | null = null;
  private lookPrev       = { x: 0, y: 0 };
  private readonly knob  : HTMLDivElement;
  private readonly base  : HTMLDivElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: absolute; inset: 0;
      pointer-events: none;
      z-index: 200;
      touch-action: none;
    `;

    // ── Joystick ───────────────────────────────────────────────────────
    this.base = document.createElement("div");
    this.base.style.cssText = `
      position: absolute;
      bottom: 90px; left: 24px;
      width: ${JOYSTICK_RADIUS * 2}px;
      height: ${JOYSTICK_RADIUS * 2}px;
      border-radius: 50%;
      background: rgba(255,255,255,0.10);
      border: 2px solid rgba(255,255,255,0.30);
      pointer-events: auto;
      touch-action: none;
      box-sizing: border-box;
    `;

    this.knob = document.createElement("div");
    this.knob.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      width: 48px; height: 48px;
      border-radius: 50%;
      background: rgba(255,255,255,0.50);
      pointer-events: none;
    `;
    this.base.appendChild(this.knob);
    this.element.appendChild(this.base);

    // ── Área de câmera (fundo — toda a tela, bloqueada por cima pelos botões) ──
    const lookArea = document.createElement("div");
    lookArea.style.cssText = `
      position: absolute; inset: 0;
      pointer-events: auto;
      touch-action: none;
    `;
    this.element.appendChild(lookArea);

    // ── Botões de ação ─────────────────────────────────────────────────
    // ATIRAR
    const btnFire = this._btn("🔥", `bottom:60px; right:24px;`, "#c0392b", "72px");
    // MIRA (ADS)
    const btnAim  = this._btn("🎯", `bottom:60px; right:112px;`, "#1a6fa8", "60px");
    // PULAR
    const btnJump = this._btn("↑", `bottom:148px; right:24px;`, "#27ae60", "56px");
    // RECARREGAR
    const btnReload = this._btn("R", `bottom:148px; right:96px;`, "#8e44ad", "52px");

    // SPRINT (toggle acima do joystick)
    const btnSprint = this._btn("⚡", `bottom:${90 + JOYSTICK_RADIUS * 2 + 12}px; left:24px;`, "#e67e22", "50px");

    // PEGAR / INTERAGIR (centro inferior)
    const btnInteract = this._btn("[E]", `bottom:60px; left:50%; transform:translateX(-50%);`, "#2c3e50", "58px");
    btnInteract.style.fontSize = "14px";

    // INVENTÁRIO (topo direito)
    const btnInv = this._btn("🎒", `top:16px; right:72px;`, "rgba(0,0,0,0.5)", "48px");
    // RANKING
    const btnScore = this._btn("🏆", `top:16px; right:16px;`, "rgba(0,0,0,0.5)", "48px");

    [btnFire, btnAim, btnJump, btnReload, btnSprint, btnInteract, btnInv, btnScore]
      .forEach(b => this.element.appendChild(b));

    container.appendChild(this.element);

    // ── Event wiring ───────────────────────────────────────────────────
    this._wireJoystick();
    this._wireLook(lookArea);
    this._wireBtn(btnFire,
      () => { this.isFireHeld = true;  this.isFireJustPressed = true; },
      () => { this.isFireHeld = false; }
    );
    this._wireBtn(btnAim,
      () => { this.isAimHeld = true; },
      () => { this.isAimHeld = false; }
    );
    this._wireBtn(btnJump,    () => { this.isJumpJustPressed = true; });
    this._wireBtn(btnReload,  () => { this.isReloadJustPressed = true; });
    this._wireBtn(btnSprint,  () => { this.isSprintActive = !this.isSprintActive; this._styleSprint(btnSprint); });
    this._wireBtn(btnInteract, () => { this.isInteractJustPressed = true; });
    this._wireBtn(btnInv,     () => { this.isInventoryJustPressed = true; });
    this._wireBtn(btnScore,
      () => { this.isScoreboardHeld = true; },
      () => { this.isScoreboardHeld = false; }
    );
  }

  /** Deve ser chamado no final de cada frame para limpar estados one-shot. */
  clearFrameState(): void {
    this.isFireJustPressed    = false;
    this.isJumpJustPressed    = false;
    this.isReloadJustPressed  = false;
    this.isInteractJustPressed = false;
    this.isInventoryJustPressed = false;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  // ── Helpers privados ────────────────────────────────────────────────────

  private _btn(label: string, pos: string, bg: string, size: string): HTMLDivElement {
    const b = document.createElement("div");
    b.style.cssText = `
      position: absolute;
      ${pos}
      width: ${size}; height: ${size};
      border-radius: 50%;
      background: ${bg};
      border: 2px solid rgba(255,255,255,0.30);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; color: #fff;
      pointer-events: auto;
      touch-action: none;
      user-select: none; -webkit-user-select: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;
    b.textContent = label;
    return b;
  }

  private _styleSprint(btn: HTMLDivElement): void {
    btn.style.background = this.isSprintActive ? "#e67e22" : "rgba(0,0,0,0.5)";
    btn.style.border = this.isSprintActive
      ? "2px solid #f39c12"
      : "2px solid rgba(255,255,255,0.30)";
  }

  private _wireJoystick(): void {
    const el = this.base;

    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.joystickId !== null) return;
      const t = e.changedTouches[0];
      this.joystickId = t.identifier;
      const r = el.getBoundingClientRect();
      this.joystickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== this.joystickId) continue;
        const dx = t.clientX - this.joystickCenter.x;
        const dy = t.clientY - this.joystickCenter.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const norm = Math.min(len, JOYSTICK_RADIUS) / JOYSTICK_RADIUS;
        const nx = (dx / len) * norm;
        const ny = (dy / len) * norm;
        this.moveX = Math.abs(nx) > DEAD_ZONE ? nx : 0;
        this.moveZ = Math.abs(ny) > DEAD_ZONE ? ny : 0;
        const clamp = Math.min(len, JOYSTICK_RADIUS);
        const kx = (dx / len) * clamp;
        const ky = (dy / len) * clamp;
        this.knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== this.joystickId) continue;
        this.joystickId = null;
        this.moveX = 0;
        this.moveZ = 0;
        this.knob.style.transform = "translate(-50%,-50%)";
      }
    }, { passive: true });
  }

  private _wireLook(area: HTMLElement): void {
    const LOOK_SENS = 0.0045; // sensibilidade de câmera por pixel

    area.addEventListener("touchstart", (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.lookId !== null) continue;
        // Ignora toques na área do joystick (esquerda inferior)
        const inJoyZone =
          t.clientX < window.innerWidth  * 0.45 &&
          t.clientY > window.innerHeight * 0.50;
        if (inJoyZone) continue;
        this.lookId   = t.identifier;
        this.lookPrev = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== this.lookId) continue;
        this.lookDeltaX += (t.clientX - this.lookPrev.x) * LOOK_SENS;
        this.lookDeltaY += (t.clientY - this.lookPrev.y) * LOOK_SENS;
        this.lookPrev = { x: t.clientX, y: t.clientY };
      }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== this.lookId) continue;
        this.lookId = null;
      }
    }, { passive: true });
  }

  private _wireBtn(
    el: HTMLElement,
    onDown: () => void,
    onUp?: () => void
  ): void {
    el.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onDown();
    }, { passive: false });

    el.addEventListener("touchend", (e) => {
      e.preventDefault();
      onUp?.();
    }, { passive: false });

    el.addEventListener("touchcancel", () => { onUp?.(); }, { passive: true });
  }
}
