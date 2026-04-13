/**
 * TouchControls — HUD de controles touch para smartphones.
 *
 * Layout:
 *   ESQUERDA  → Joystick flutuante (moveX / moveZ)
 *   DIREITA   → Área de câmera (lookDeltaX / lookDeltaY)
 *   Baixo dir → 🔫 Atirar (grande), ↑ Pular, 🎯 Mira, R Recarregar
 *   Centro    → [E] Interagir (acima da hotbar)
 *   Baixo esq → ⚡ Sprint
 *   Topo dir  → 🎒 Inventário, 🏆 Ranking
 *   Topo esq  → ⛶ Tela cheia
 *
 * A faixa inferior (HOTBAR_STRIP_PX) é livre de zonas de toque para
 * que os slots da hotbar recebam eventos normalmente.
 */

const JOYSTICK_RADIUS  = 72;
const DEAD_ZONE        = 0.07;
const JOY_ZONE_MAX_X   = 0.42;   // joystick ocupa esquerda 42%
const JOY_ZONE_MIN_Y   = 0.32;   // começa a 32% do topo
const HOTBAR_STRIP_PX  = 120;    // px do rodapé reservados para a hotbar (passthrough)

export class TouchControls {
  readonly element: HTMLDivElement;

  moveX = 0;
  moveZ = 0;
  lookDeltaX = 0;
  lookDeltaY = 0;

  isFireHeld             = false;
  isFireJustPressed      = false;
  isAimHeld              = false;
  isJumpJustPressed      = false;
  isSprintActive         = false;
  isReloadJustPressed    = false;
  isInteractJustPressed  = false;
  isInventoryJustPressed = false;
  isScoreboardHeld       = false;

  private joystickId     : number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private lookId         : number | null = null;
  private lookPrev       = { x: 0, y: 0 };
  private readonly knob  : HTMLDivElement;
  private readonly base  : HTMLDivElement;
  private btnFullscreen  : HTMLDivElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: absolute; inset: 0;
      pointer-events: none;
      z-index: 200;
      touch-action: none;
      user-select: none; -webkit-user-select: none;
    `;

    // ── 1. Área de câmera (PRIMEIRO no DOM = atrás de tudo) ───────────────
    // Ocupa a metade direita da tela, MAS não entra na faixa da hotbar (rodapé)
    const lookArea = document.createElement("div");
    lookArea.style.cssText = `
      position: absolute;
      top: 0; right: 0;
      width: ${Math.round((1 - JOY_ZONE_MAX_X) * 100)}%;
      bottom: ${HOTBAR_STRIP_PX}px;
      pointer-events: auto;
      touch-action: none;
    `;
    this.element.appendChild(lookArea);

    // ── 2. Base visual do joystick (aparece onde o polegar pousar) ─────────
    this.base = document.createElement("div");
    this.base.style.cssText = `
      position: absolute;
      width: ${JOYSTICK_RADIUS * 2}px;
      height: ${JOYSTICK_RADIUS * 2}px;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      border: 2px solid rgba(255,255,255,0.25);
      pointer-events: none;
      touch-action: none;
      box-sizing: border-box;
      opacity: 0;
      transition: opacity 0.12s;
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

    // ── 3. Zona de toque do joystick (esquerda, acima da hotbar) ──────────
    const joyZone = document.createElement("div");
    joyZone.style.cssText = `
      position: absolute;
      left: 0;
      top: ${Math.round(JOY_ZONE_MIN_Y * 100)}%;
      width: ${Math.round(JOY_ZONE_MAX_X * 100)}%;
      bottom: ${HOTBAR_STRIP_PX}px;
      pointer-events: auto;
      touch-action: none;
    `;
    this.element.appendChild(joyZone);

    // ── 4. Botões de ação (acima da hotbar, lado direito) ─────────────────
    // Posições calculadas para ficarem acima de HOTBAR_STRIP_PX e acima do minimap
    const BTM = HOTBAR_STRIP_PX; // base de posicionamento

    // 🔫 ATIRAR — grande, canto direito
    const btnFire   = this._btn("🔫", `bottom:${BTM + 10}px; right:18px;`,   "#c0392b", "78px", "26px");
    // ↑ PULAR — acima do fire
    const btnJump   = this._btn("↑",  `bottom:${BTM + 100}px; right:24px;`,  "#27ae60", "62px", "28px");
    // 🎯 MIRA — esquerda do fire
    const btnAim    = this._btn("🎯", `bottom:${BTM + 10}px; right:112px;`,  "#1a6fa8", "62px", "22px");
    // R RECARREGAR — acima da mira
    const btnReload = this._btn("R",  `bottom:${BTM + 90}px; right:116px;`,  "#8e44ad", "50px", "20px");

    // ⚡ SPRINT — esquerda, acima da hotbar
    const btnSprint = this._btn("⚡", `bottom:${BTM + 10}px; left:20px;`,    "#e67e22", "52px", "24px");

    // [E] INTERAGIR — centro, logo acima da hotbar
    const btnInteract = this._btn("[E]", `bottom:${BTM + 10}px; left:50%; transform:translateX(-50%);`, "#2c3e50", "58px", "13px");

    // ── 5. Botões de menu (topo direita) ──────────────────────────────────
    const btnInv   = this._btn("🎒", `top:14px; right:68px;`, "rgba(0,0,0,0.5)", "46px", "22px");
    const btnScore = this._btn("🏆", `top:14px; right:14px;`, "rgba(0,0,0,0.5)", "46px", "22px");

    // ── 6. Tela cheia (topo esquerda) ─────────────────────────────────────
    this.btnFullscreen = this._btn("⛶", `top:14px; left:14px;`, "rgba(0,0,0,0.6)", "46px", "22px");

    [btnFire, btnJump, btnAim, btnReload, btnSprint, btnInteract,
     btnInv, btnScore, this.btnFullscreen]
      .forEach(b => this.element.appendChild(b));

    container.appendChild(this.element);

    // ── Wiring ────────────────────────────────────────────────────────────
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

    document.addEventListener("fullscreenchange", () => { this._onFullscreenChange(); });
  }

  clearFrameState(): void {
    this.isFireJustPressed      = false;
    this.isJumpJustPressed      = false;
    this.isReloadJustPressed    = false;
    this.isInteractJustPressed  = false;
    this.isInventoryJustPressed = false;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _btn(label: string, pos: string, bg: string, size: string, fontSize = "22px"): HTMLDivElement {
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
    btn.style.background  = this.isSprintActive ? "#e67e22" : "rgba(0,0,0,0.5)";
    btn.style.borderColor = this.isSprintActive ? "#f39c12" : "rgba(255,255,255,0.28)";
  }

  private _wireJoystick(zone: HTMLElement): void {
    zone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.joystickId !== null) return;
      const t = e.changedTouches[0];
      this.joystickId = t.identifier;
      this.joystickCenter = { x: t.clientX, y: t.clientY };

      const shellRect = this.element.getBoundingClientRect();
      this.base.style.left    = `${t.clientX - shellRect.left - JOYSTICK_RADIUS}px`;
      this.base.style.top     = `${t.clientY - shellRect.top  - JOYSTICK_RADIUS}px`;
      this.base.style.bottom  = "";
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
        const nx   = (dx / len) * norm;
        const ny   = (dy / len) * norm;
        this.moveX = Math.abs(nx) > DEAD_ZONE ? nx : 0;
        this.moveZ = Math.abs(ny) > DEAD_ZONE ? ny : 0;
        const c = Math.min(len, JOYSTICK_RADIUS);
        this.knob.style.transform = `translate(calc(-50% + ${(dx/len)*c}px), calc(-50% + ${(dy/len)*c}px))`;
      }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== this.joystickId) continue;
        this.joystickId = null;
        this.moveX = 0; this.moveZ = 0;
        this.knob.style.transform = "translate(-50%,-50%)";
        this.base.style.opacity = "0";
      }
    }, { passive: true });
  }

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

  private _wireBtn(el: HTMLElement, onDown: () => void, onUp?: () => void): void {
    el.addEventListener("touchstart", (e) => { e.preventDefault(); e.stopPropagation(); onDown(); }, { passive: false });
    el.addEventListener("touchend",   (e) => { e.preventDefault(); onUp?.(); }, { passive: false });
    el.addEventListener("touchcancel", () => { onUp?.(); }, { passive: true });
  }

  private async _toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        try { await (screen.orientation as ScreenOrientation & { lock(o: string): Promise<void> }).lock("landscape"); }
        catch { /* navegador não suporta lock */ }
      } else {
        await document.exitFullscreen();
        try { screen.orientation.unlock(); } catch { /* ignorado */ }
      }
    } catch (err) {
      console.warn("Fullscreen error:", err);
    }
  }

  private _onFullscreenChange(): void {
    const fs = !!document.fullscreenElement;
    this.btnFullscreen.textContent = fs ? "✕" : "⛶";
  }
}
