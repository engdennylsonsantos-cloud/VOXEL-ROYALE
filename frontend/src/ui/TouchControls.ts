/**
 * TouchControls — HUD de controles touch para smartphones.
 *
 * Layout paisagem (landscape):
 *   ESQUERDA inferior  → Joystick flutuante (moveX / moveZ)
 *   DIREITA            → Área de câmera (lookDeltaX / lookDeltaY)
 *   Botões direita inf → ATIRAR (grande), PULAR, MIRA, RECARREGAR
 *   Centro inf         → INTERAGIR
 *   Esquerda inf       → SPRINT (toggle, acima da zona do joystick)
 *   Topo direita       → INVENTÁRIO, RANKING
 *   Topo esquerda      → TELA CHEIA / ORIENTAÇÃO
 *
 * FIX PRINCIPAL: lookArea é inserido ANTES do joystick no DOM para não
 * interceptar os eventos de toque na base do joystick.
 */

const JOYSTICK_RADIUS = 72; // px — raio do anel do joystick
const DEAD_ZONE       = 0.07;

// Zona esquerda da tela onde o joystick pode ser iniciado (porcentagem de largura)
const JOY_ZONE_MAX_X  = 0.42;
// Zona vertical onde o joystick pode ser iniciado (porcentagem de altura)
const JOY_ZONE_MIN_Y  = 0.35;

export class TouchControls {
  readonly element: HTMLDivElement;

  // ── Entradas de movimento (lidas pelo GameApp a cada frame) ────────────
  moveX = 0; // -1 (esquerda) … +1 (direita)
  moveZ = 0; // -1 (frente)   … +1 (trás)

  // ── Rotação de câmera acumulada por frame (resetada após leitura) ──────
  lookDeltaX = 0;
  lookDeltaY = 0;

  // ── Estado de botões ───────────────────────────────────────────────────
  isFireHeld             = false;
  isFireJustPressed      = false;
  isAimHeld              = false;
  isJumpJustPressed      = false;
  isSprintActive         = false;
  isReloadJustPressed    = false;
  isInteractJustPressed  = false;
  isInventoryJustPressed = false;
  isScoreboardHeld       = false;

  // ── Private ────────────────────────────────────────────────────────────
  private joystickId      : number | null = null;
  private joystickCenter  = { x: 0, y: 0 };
  private lookId          : number | null = null;
  private lookPrev        = { x: 0, y: 0 };
  private readonly knob   : HTMLDivElement;
  private readonly base   : HTMLDivElement;
  private isFullscreen    = false;
  private btnFullscreen   : HTMLDivElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: absolute; inset: 0;
      pointer-events: none;
      z-index: 200;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    `;

    // ── 1. Área de câmera (PRIMEIRO no DOM = atrás de tudo) ───────────────
    // Ocupa toda a metade direita da tela; blocos de botões ficam por cima.
    const lookArea = document.createElement("div");
    lookArea.style.cssText = `
      position: absolute;
      top: 0; right: 0;
      width: ${Math.round((1 - JOY_ZONE_MAX_X) * 100)}%;
      height: 100%;
      pointer-events: auto;
      touch-action: none;
    `;
    this.element.appendChild(lookArea); // inserido ANTES do joystick

    // ── 2. Joystick base (visualmente fixo mas ativado ao toque na zona esq) ─
    this.base = document.createElement("div");
    this.base.style.cssText = `
      position: absolute;
      bottom: 90px; left: 24px;
      width: ${JOYSTICK_RADIUS * 2}px;
      height: ${JOYSTICK_RADIUS * 2}px;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      border: 2px solid rgba(255,255,255,0.25);
      pointer-events: none;          /* toque capturado pela zona-esq abaixo */
      touch-action: none;
      box-sizing: border-box;
      transition: opacity 0.15s;
      opacity: 0;                    /* oculto até o toque iniciar */
    `;

    this.knob = document.createElement("div");
    this.knob.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      width: 52px; height: 52px;
      border-radius: 50%;
      background: rgba(255,255,255,0.55);
      pointer-events: none;
    `;
    this.base.appendChild(this.knob);
    this.element.appendChild(this.base);

    // ── 3. Zona de toque do joystick (esquerda da tela) ───────────────────
    const joyZone = document.createElement("div");
    joyZone.style.cssText = `
      position: absolute;
      bottom: 0; left: 0;
      width: ${Math.round(JOY_ZONE_MAX_X * 100)}%;
      height: ${Math.round((1 - JOY_ZONE_MIN_Y) * 100)}%;
      pointer-events: auto;
      touch-action: none;
    `;
    this.element.appendChild(joyZone);

    // ── 4. Botões de ação (direita inferior) ──────────────────────────────
    // Hierarquia ergonômica: botões maiores para as ações mais frequentes
    // ATIRAR — grande, canto direito (polegar direito)
    const btnFire = this._btn("🔥", `bottom:28px; right:20px;`, "#c0392b", "80px", "26px");
    // PULAR — acima e à esquerda do fire
    const btnJump = this._btn("↑",  `bottom:120px; right:28px;`, "#27ae60", "64px", "28px");
    // MIRA (ADS) — ao lado esquerdo do fire
    const btnAim  = this._btn("🎯", `bottom:28px; right:116px;`, "#1a6fa8", "64px", "22px");
    // RECARREGAR — acima da mira
    const btnReload = this._btn("R", `bottom:104px; right:116px;`, "#8e44ad", "52px", "20px");

    // SPRINT (toggle) — esquerda, acima da zona do joystick
    const btnSprint = this._btn("⚡", `bottom:${90 + JOYSTICK_RADIUS * 2 + 16}px; left:24px;`, "#e67e22", "52px", "24px");

    // INTERAGIR — centro inferior
    const btnInteract = this._btn("[E]", `bottom:28px; left:50%; transform:translateX(-50%);`, "#2c3e50", "60px", "13px");

    // ── 5. Botões de menu (topo direita) ──────────────────────────────────
    const btnInv   = this._btn("🎒", `top:14px; right:68px;`,  "rgba(0,0,0,0.5)", "46px", "22px");
    const btnScore = this._btn("🏆", `top:14px; right:14px;`,  "rgba(0,0,0,0.5)", "46px", "22px");

    // ── 6. Botão de tela cheia + orientação (topo esquerda) ───────────────
    this.btnFullscreen = this._btn("⛶",  `top:14px; left:14px;`, "rgba(0,0,0,0.6)", "46px", "22px");

    [btnFire, btnJump, btnAim, btnReload, btnSprint, btnInteract,
     btnInv, btnScore, this.btnFullscreen]
      .forEach(b => this.element.appendChild(b));

    container.appendChild(this.element);

    // ── Event wiring ───────────────────────────────────────────────────────
    this._wireJoystick(joyZone);
    this._wireLook(lookArea);

    this._wireBtn(btnFire,
      () => { this.isFireHeld = true;  this.isFireJustPressed = true; },
      () => { this.isFireHeld = false; }
    );
    this._wireBtn(btnAim,
      () => { this.isAimHeld = true; },
      () => { this.isAimHeld = false; }
    );
    this._wireBtn(btnJump,     () => { this.isJumpJustPressed = true; });
    this._wireBtn(btnReload,   () => { this.isReloadJustPressed = true; });
    this._wireBtn(btnSprint,   () => { this.isSprintActive = !this.isSprintActive; this._styleSprint(btnSprint); });
    this._wireBtn(btnInteract, () => { this.isInteractJustPressed = true; });
    this._wireBtn(btnInv,      () => { this.isInventoryJustPressed = true; });
    this._wireBtn(btnScore,
      () => { this.isScoreboardHeld = true; },
      () => { this.isScoreboardHeld = false; }
    );
    this._wireBtn(this.btnFullscreen, () => { void this._toggleFullscreen(); });

    // Atualiza ícone quando o fullscreen mudar (botão de voltar nativo)
    document.addEventListener("fullscreenchange", () => { this._onFullscreenChange(); });
  }

  /** Deve ser chamado no final de cada frame para limpar estados one-shot. */
  clearFrameState(): void {
    this.isFireJustPressed     = false;
    this.isJumpJustPressed     = false;
    this.isReloadJustPressed   = false;
    this.isInteractJustPressed = false;
    this.isInventoryJustPressed = false;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  // ── Helpers privados ─────────────────────────────────────────────────────

  private _btn(
    label: string,
    pos: string,
    bg: string,
    size: string,
    fontSize = "22px"
  ): HTMLDivElement {
    const b = document.createElement("div");
    b.style.cssText = `
      position: absolute;
      ${pos}
      width: ${size}; height: ${size};
      border-radius: 50%;
      background: ${bg};
      border: 2px solid rgba(255,255,255,0.28);
      display: flex; align-items: center; justify-content: center;
      font-size: ${fontSize}; color: #fff;
      pointer-events: auto;
      touch-action: none;
      user-select: none; -webkit-user-select: none;
      box-shadow: 0 2px 10px rgba(0,0,0,0.45);
    `;
    b.textContent = label;
    return b;
  }

  private _styleSprint(btn: HTMLDivElement): void {
    btn.style.background = this.isSprintActive ? "#e67e22" : "rgba(0,0,0,0.5)";
    btn.style.borderColor = this.isSprintActive ? "#f39c12" : "rgba(255,255,255,0.28)";
  }

  // ── Joystick flutuante ───────────────────────────────────────────────────
  // O joystick é ativado em qualquer ponto da zona esquerda.
  // A base se posiciona onde o polegar pousou para melhor conforto.
  private _wireJoystick(zone: HTMLElement): void {
    zone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.joystickId !== null) return;
      const t = e.changedTouches[0];
      this.joystickId = t.identifier;
      this.joystickCenter = { x: t.clientX, y: t.clientY };

      // Move a base visual para onde o polegar pousou
      const shellRect = this.element.getBoundingClientRect();
      const relX = t.clientX - shellRect.left - JOYSTICK_RADIUS;
      const relY = t.clientY - shellRect.top  - JOYSTICK_RADIUS;
      this.base.style.left   = `${relX}px`;
      this.base.style.bottom = "";
      this.base.style.top    = `${relY}px`;
      this.base.style.opacity = "1";
      this.knob.style.transform = "translate(-50%,-50%)";
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== this.joystickId) continue;
        const dx = t.clientX - this.joystickCenter.x;
        const dy = t.clientY - this.joystickCenter.y;
        const len  = Math.sqrt(dx * dx + dy * dy) || 1;
        const norm = Math.min(len, JOYSTICK_RADIUS) / JOYSTICK_RADIUS;
        const nx = (dx / len) * norm;
        const ny = (dy / len) * norm;
        this.moveX = Math.abs(nx) > DEAD_ZONE ? nx : 0;
        this.moveZ = Math.abs(ny) > DEAD_ZONE ? ny : 0;
        const clamp = Math.min(len, JOYSTICK_RADIUS);
        this.knob.style.transform = `translate(calc(-50% + ${(dx / len) * clamp}px), calc(-50% + ${(dy / len) * clamp}px))`;
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
        this.base.style.opacity = "0";
      }
    }, { passive: true });
  }

  // ── Câmera (olhar) ────────────────────────────────────────────────────────
  private _wireLook(area: HTMLElement): void {
    const LOOK_SENS = 0.005;

    area.addEventListener("touchstart", (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.lookId !== null) continue;
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

  // ── Botões genéricos ──────────────────────────────────────────────────────
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

  // ── Tela cheia + bloqueio de orientação ───────────────────────────────────
  private async _toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        // Tenta bloquear em modo paisagem (nem todos os browsers suportam)
        try { await (screen.orientation as ScreenOrientation & { lock(o: string): Promise<void> }).lock("landscape"); }
        catch { /* browser não suporta lock — ignorado */ }
      } else {
        await document.exitFullscreen();
        try { screen.orientation.unlock(); } catch { /* ignorado */ }
      }
    } catch (err) {
      console.warn("Fullscreen error:", err);
    }
  }

  private _onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;
    this.btnFullscreen.textContent = this.isFullscreen ? "✕" : "⛶";
    this.btnFullscreen.title = this.isFullscreen ? "Sair da tela cheia" : "Tela cheia";
  }
}
