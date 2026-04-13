import { Room } from "@colyseus/core";
import { BotManager } from "../bots/BotManager.js";

const MAX_PLAYERS        = 15;
const MIN_PLAYERS_TO_START = 2;
const COUNTDOWN_SECONDS  = 15;

// ── Nomes de fantasmas igual ao padrão de guest do frontend (Visitante-XXXXXX) ──
function randomGuestName() {
  const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0");
  return `Visitante-${hex}`;
}

// Gera IDs únicos para fantasmas do lobby
let _ghostSeq = 0;
function newGhostId() { return `ghost_${Date.now()}_${++_ghostSeq}`; }

export class BattleRoom extends Room {
  countdownInterval   = null;
  countdownRemaining  = COUNTDOWN_SECONDS;
  lobbyPhase          = "waiting";
  playerNames         = new Map();
  playerSnapshots     = new Map();
  botManager          = null;

  // Fantasmas de lobby: jogam apenas na lista de espera
  lobbyGhosts         = new Map();  // ghostId → displayName
  _lobbyGhostInterval = null;
  _firstPlayerTimer   = null;

  onCreate() {
    this.maxClients = MAX_PLAYERS;
    this.patchRate = 50;

    // Snapshot periódico: limpa ghosts e sincroniza a cada 1s
    this.clock.setInterval(() => {
      if (this.clients.length > 0) {
        this.broadcast("players:snapshot", {
          players: Array.from(this.playerSnapshots.entries()).map(([sessionId, player]) => ({
            sessionId,
            player,
            displayName: this.playerNames.get(sessionId) || "Player"
          }))
        });
      }
    }, 1000);

    this.onMessage("player:shot", (client, message) => {
      this.broadcast("player:shot", message, { except: client });
    });

    this.onMessage("player:hit", (client, message) => {
      // Repassa dano para quem sofreu (e todos na real pra verem status, mas quem processa as consequências é o alvo)
      this.broadcast("player:took_damage", {
        sessionId: message.targetId,
        attackerId: client.sessionId,
        damage: message.damage,
        part: message.part
      });
      // Notifica o BotManager caso o alvo seja um bot
      this.botManager?.onPlayerHit(message.targetId, message.damage, message.part, client.sessionId);
    });

    this.onMessage("player:died", (client) => {
      // Informa todos de que ele morreu, assim os avatares remotos despedaçam
      this.broadcast("player:died", {
        sessionId: client.sessionId
      });
      // Notifica bots para reagirem (largar alvo morto)
      this.botManager?.onPlayerDied(client.sessionId);
    });

    this.onMessage("player:update", (client, message) => {
      if (this.lobbyPhase === "waiting") {
        return;
      }

      const player = this.playerSnapshots.get(client.sessionId);
      if (!player) {
        return;
      }

      player.x = Number(message.x) || 0;
      player.y = Number(message.y) || 0;
      player.z = Number(message.z) || 0;
      player.yaw = Number(message.yaw) || 0;
      player.pitch = Number(message.pitch) || 0;
      player.walking = Boolean(message.walking);
      player.armed = Boolean(message.armed);
      player.weaponId = typeof message.weaponId === "string" ? message.weaponId : "";
      player.reloading = Boolean(message.reloading);
      player.aiming = Boolean(message.aiming);

      this.broadcast("player:update", {
        sessionId: client.sessionId,
        player
      }, { except: client });
    });
  }

  onJoin(client, options = {}) {
    const displayName = typeof options.displayName === "string" && options.displayName.trim()
      ? options.displayName.trim().slice(0, 24)
      : `Player ${this.clients.length}`;

    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist  = 15 + Math.random() * 65;
    const player = {
      x: Math.cos(spawnAngle) * spawnDist,
      y: 12,
      z: Math.sin(spawnAngle) * spawnDist,
      yaw: 0,
      pitch: 0,
      walking: false,
      armed: false,
      weaponId: "",
      reloading: false,
      aiming: false
    };

    this.playerNames.set(client.sessionId, displayName);
    this.playerSnapshots.set(client.sessionId, player);

    // Defer initial sync messages by one tick so the client finishes
    // registering its onMessage handlers before these arrive.
    this.clock.setTimeout(() => {
      client.send("players:snapshot", {
        players: Array.from(this.playerSnapshots.entries()).map(([sessionId, snapshot]) => ({
          sessionId,
          player: snapshot,
          displayName: this.playerNames.get(sessionId) || "Player"
        }))
      });

      this.broadcast("player:joined", {
        sessionId: client.sessionId,
        displayName,
        player
      }, { except: client });

      this.broadcastLobbyState();
    }, 0);

    if (this.clients.length >= MAX_PLAYERS && this.lobbyPhase !== "active") {
      this.startMatch();
      return;
    }

    if (this.clients.length >= MIN_PLAYERS_TO_START && this.lobbyPhase === "waiting") {
      this.beginCountdown();
    }

    // Primeiro jogador real: agenda início gradual de ghost bots após 5s sozinho
    if (this.clients.length === 1 && this.lobbyPhase === "waiting" && !this._firstPlayerTimer) {
      this._firstPlayerTimer = this.clock.setTimeout(() => {
        this._firstPlayerTimer = null;
        if (this.lobbyPhase !== "waiting" && this.lobbyPhase !== "countdown") return;
        this._startLobbyGhostFill();
      }, 5000);
    }
  }

  onLeave(client) {
    // Sem janela de reconexão — remove imediatamente
    this.playerSnapshots.delete(client.sessionId);
    this.playerNames.delete(client.sessionId);
    this.broadcast("player:left", { sessionId: client.sessionId });
    this.broadcastLobbyState();

    if (this.lobbyPhase === "active") return;

    // Se não sobrou nenhum player real, cancela tudo e reseta fantasmas
    if (this.clients.length === 0) {
      this.stopCountdown();
      this._stopLobbyGhostFill();
      if (this._firstPlayerTimer) { this._firstPlayerTimer.clear(); this._firstPlayerTimer = null; }
      this.lobbyGhosts.clear();
      this.lobbyPhase = "waiting";
      this.broadcastLobbyState();
      return;
    }

    // Conta reais + fantasmas para decidir se mantém countdown
    const visibleCount = this.clients.length + this.lobbyGhosts.size;
    if (visibleCount < MIN_PLAYERS_TO_START) {
      this.stopCountdown();
      this.lobbyPhase = "waiting";
      this.broadcastLobbyState();
      return;
    }

    if (!this.countdownInterval && this.lobbyPhase !== "active") {
      this.beginCountdown();
    }
  }

  onDispose() {
    this.stopCountdown();
    this._stopLobbyGhostFill();
    if (this._firstPlayerTimer) { this._firstPlayerTimer.clear(); this._firstPlayerTimer = null; }
    this.lobbyGhosts.clear();
    this.botManager?.destroy();
  }

  beginCountdown() {
    if (this.countdownInterval || this.lobbyPhase === "active") {
      return;
    }

    this.lobbyPhase = "countdown";
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.broadcastLobbyState();

    this.countdownInterval = this.clock.setInterval(() => {
      // Cancela só se não há nenhum player real (ghosts não contam para manter vivo)
      if (this.clients.length === 0) {
        this.stopCountdown();
        this.lobbyPhase = "waiting";
        this.broadcastLobbyState();
        return;
      }

      this.countdownRemaining -= 1;
      this.broadcastLobbyState();

      if (this.countdownRemaining <= 0 || this.clients.length >= MAX_PLAYERS) {
        this.startMatch();
      }
    }, 1000);
  }

  stopCountdown() {
    if (this.countdownInterval) {
      this.countdownInterval.clear();
      this.countdownInterval = null;
    }

    this.countdownRemaining = COUNTDOWN_SECONDS;
  }

  startMatch() {
    this.stopCountdown();
    this._stopLobbyGhostFill();
    this.lobbyPhase = "active";
    this.lock();

    // Remove fantasmas de lobby — serão substituídos por bots reais de combate
    this.lobbyGhosts.clear();

    this.broadcast("match:start", {
      playerCount: this.clients.length
    });
    this.broadcastLobbyState();

    // Reenvia snapshot completo a todos para garantir sincronização inicial
    const snapshot = {
      players: Array.from(this.playerSnapshots.entries()).map(([sessionId, player]) => ({
        sessionId,
        player,
        displayName: this.playerNames.get(sessionId) || "Player"
      }))
    };
    this.broadcast("players:snapshot", snapshot);

    // Preenche com bots de combate até MAX_PLAYERS
    this.botManager = new BotManager(this);
    this.botManager.fillBots(MAX_PLAYERS);
  }

  // ── Preenchimento gradual de fantasmas no lobby ────────────────────────
  _startLobbyGhostFill() {
    if (this._lobbyGhostInterval) return;

    // Adiciona 1 imediatamente para disparar o countdown (se ainda estava em waiting)
    this._addLobbyGhost();

    // Intervalo fixo de 1s — a cadência é controlada dentro do callback
    this._lobbyGhostInterval = this.clock.setInterval(() => {
      if (this.lobbyPhase === "active") { this._stopLobbyGhostFill(); return; }

      const total     = this.clients.length + this.lobbyGhosts.size;
      const remaining = this.countdownRemaining;

      // Sala cheia
      if (total >= MAX_PLAYERS) { this._stopLobbyGhostFill(); return; }

      // Nos últimos 2s: preenche tudo de uma vez
      if (remaining <= 2) {
        const missing = MAX_PLAYERS - total;
        for (let i = 0; i < missing; i++) this._addLobbyGhost();
        this._stopLobbyGhostFill();
        return;
      }

      // Cadência progressiva:
      // > 10s restantes  → ~30% de chance de entrar 1 neste segundo
      // 6-10s restantes  → ~55% de chance
      // ≤ 5s restantes   → sempre entra 1 por segundo
      const chance = remaining <= 5 ? 1.0 : remaining <= 10 ? 0.55 : 0.30;
      if (Math.random() < chance) this._addLobbyGhost();
    }, 1000);
  }

  _addLobbyGhost() {
    const total = this.clients.length + this.lobbyGhosts.size;
    if (total >= MAX_PLAYERS || this.lobbyPhase === "active") return;

    const id   = newGhostId();
    const name = randomGuestName();
    this.lobbyGhosts.set(id, name);
    this.broadcastLobbyState();

    // Se tinha só 1 jogador real, o ghost dispara o countdown
    if (this.clients.length >= 1 && this.lobbyPhase === "waiting") {
      this.beginCountdown();
    }
  }

  _stopLobbyGhostFill() {
    if (this._lobbyGhostInterval) {
      this._lobbyGhostInterval.clear();
      this._lobbyGhostInterval = null;
    }
  }

  broadcastLobbyState() {
    const allNames = [
      ...Array.from(this.playerNames.values()),
      ...Array.from(this.lobbyGhosts.values())
    ];
    this.broadcast("lobby:update", {
      phase:            this.lobbyPhase,
      playerCount:      this.clients.length + this.lobbyGhosts.size,
      countdownSeconds: this.lobbyPhase === "countdown" ? Math.max(0, this.countdownRemaining) : 0,
      playerNames:      allNames
    });
  }
}
