import type { LobbyStatus } from "../network/MultiplayerClient";

const MAX_PLAYERS = 15;

const TIPS = [
  "💡 Use o joystick esquerdo para se mover e o lado direito para girar a câmera.",
  "⚡ Fique dentro da tempestade ou você perderá HP rapidamente!",
  "🪂 Salte do avião cedo para chegar a locais com melhores armas.",
  "🎯 Headshots causam mais dano — mire na cabeça!",
  "🔄 Você tem 3 vidas — use cada uma com sabedoria.",
  "🤖 Os bots também fogem da tempestade. Use isso a seu favor!",
  "🔫 Recarregue (R) antes de entrar em combate.",
  "🏆 O último sobrevivente vence. Boa sorte!",
];

export class LobbyScreen {
  readonly root: HTMLDivElement;

  private readonly phaseEl: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly countdownRing: SVGCircleElement;
  private readonly rosterGrid: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;

  private onCancelCb?: () => void;
  private tipInterval?: ReturnType<typeof setInterval>;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "lobby-screen";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="lobby-screen__backdrop"></div>
      <div class="lobby-screen__content">

        <div class="lobby-screen__header">
          <span class="lobby-screen__eyebrow">⚡ VOXEL ROYALE · MATCHMAKING</span>
          <h1 class="lobby-screen__title">Sala de Espera</h1>
        </div>

        <div class="lobby-screen__countdown-wrap">
          <svg class="lobby-screen__ring" viewBox="0 0 120 120">
            <circle class="lobby-screen__ring-track" cx="60" cy="60" r="50"/>
            <circle class="lobby-screen__ring-fill" id="lobby-ring-fill" cx="60" cy="60" r="50"/>
          </svg>
          <div class="lobby-screen__countdown-inner">
            <div class="lobby-screen__countdown-num" id="lobby-countdown">--</div>
            <div class="lobby-screen__countdown-label" id="lobby-phase">Aguardando jogadores</div>
          </div>
        </div>

        <div class="lobby-screen__info">
          <div class="lobby-screen__player-count">
            <span id="lobby-player-count">1</span>
            <span class="lobby-screen__player-sep">/</span>
            <span id="lobby-max-players">${MAX_PLAYERS}</span>
            <span class="lobby-screen__player-label">jogadores</span>
          </div>
        </div>

        <div class="lobby-screen__tip" id="lobby-tip"></div>

        <div class="lobby-screen__roster-wrap">
          <div class="lobby-screen__roster-title">Jogadores na sala</div>
          <div class="lobby-screen__roster" id="lobby-roster"></div>
        </div>

        <button class="lobby-screen__cancel" id="lobby-cancel">✕ Cancelar</button>
      </div>
    `;

    this.phaseEl = this.root.querySelector("#lobby-phase")!;
    this.countdownEl = this.root.querySelector("#lobby-countdown")!;
    this.countdownRing = this.root.querySelector("#lobby-ring-fill")!;
    this.rosterGrid = this.root.querySelector("#lobby-roster")!;
    this.cancelBtn = this.root.querySelector("#lobby-cancel")!;

    const tipEl = this.root.querySelector<HTMLElement>("#lobby-tip")!;
    tipEl.textContent = TIPS[this.tipIndex];

    this.cancelBtn.addEventListener("click", () => {
      this.onCancelCb?.();
    });

    // Rotate tips every 5s while visible
    this.tipInterval = setInterval(() => {
      if (this.root.hidden) return;
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      tipEl.style.opacity = "0";
      setTimeout(() => {
        tipEl.textContent = TIPS[this.tipIndex];
        tipEl.style.opacity = "1";
      }, 300);
    }, 5000);
  }

  show(): void {
    this.root.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add("lobby-screen--visible");
    });
  }

  hide(): void {
    this.root.classList.remove("lobby-screen--visible");
    this.root.addEventListener("transitionend", () => {
      this.root.hidden = true;
    }, { once: true });
  }

  /** Animate out then call cb at the end */
  transitionToGame(cb: () => void): void {
    this.root.classList.add("lobby-screen--launching");
    const handler = (e: TransitionEvent) => {
      if (e.target !== this.root) return; // ignora eventos de filhos (bubbling)
      this.root.removeEventListener("transitionend", handler);
      cb();
    };
    this.root.addEventListener("transitionend", handler);
  }

  onCancel(cb: () => void): void {
    this.onCancelCb = cb;
  }

  update(status: LobbyStatus): void {
    const playerCount = this.root.querySelector("#lobby-player-count") as HTMLElement;
    playerCount.textContent = String(status.playerCount);

    // Phase label & countdown
    if (!status.connected && !status.errorMessage) {
      this.phaseEl.textContent = "Conectando ao servidor...";
      this.countdownEl.textContent = "...";
      this.setRing(0);
    } else if (status.phase === "countdown") {
      this.phaseEl.textContent = `Início em`;
      this.countdownEl.textContent = String(status.countdownSeconds);
      this.setRing(status.countdownSeconds / 15);
    } else if (status.phase === "active") {
      this.phaseEl.textContent = "PARTIDA INICIADA!";
      this.countdownEl.textContent = "GO";
      this.setRing(1);
    } else {
      this.phaseEl.textContent = "Aguardando jogadores";
      this.countdownEl.textContent = "--";
      this.setRing(0);
    }

    // Error state
    if (!status.connected && status.errorMessage) {
      this.phaseEl.textContent = status.errorMessage;
      this.countdownEl.textContent = "✕";
    }

    // Roster
    this.rosterGrid.innerHTML = "";
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const slot = document.createElement("div");
      slot.className = "lobby-roster__slot";
      if (i < status.playerNames.length) {
        slot.classList.add("lobby-roster__slot--filled");
        slot.innerHTML = `
          <div class="lobby-roster__avatar">${status.playerNames[i][0]?.toUpperCase() ?? "?"}</div>
          <span class="lobby-roster__name">${escapeHtml(status.playerNames[i])}</span>
        `;
      } else {
        slot.innerHTML = `<div class="lobby-roster__avatar lobby-roster__avatar--empty"></div><span class="lobby-roster__name lobby-roster__name--empty">Aguardando...</span>`;
      }
      this.rosterGrid.appendChild(slot);
    }
  }

  private setRing(progress: number): void {
    const circumference = 2 * Math.PI * 50; // r=50
    const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));
    this.countdownRing.style.strokeDasharray = `${circumference}`;
    this.countdownRing.style.strokeDashoffset = `${offset}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
