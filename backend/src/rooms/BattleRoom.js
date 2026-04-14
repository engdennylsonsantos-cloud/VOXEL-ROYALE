import { Room } from "@colyseus/core";
import { BotManager } from "../bots/BotManager.js";

const MAX_PLAYERS          = 15;
const MIN_PLAYERS_TO_START = 2;
const COUNTDOWN_SECONDS    = 15;
const MAX_LIVES            = 3;

// ── Tempestade server-side (espelha StormSystem.ts do cliente) ────────────────
// Usada apenas para passar posição/raio aos bots.
class ServerStorm {
  constructor(worldSize) {
    this.worldSize     = worldSize;
    this.isActive      = false;
    this.currentRadius = worldSize;
    this.currentX      = 0;
    this.currentZ      = 0;
    this.targetRadius  = worldSize;
    this.targetX       = 0;
    this.targetZ       = 0;
    this.startRadius   = worldSize;
    this.startX        = 0;
    this.startZ        = 0;
    this.phase         = "waiting";   // waiting | shrinking | paused
    this.phaseTimer    = 20;          // 20s de espera inicial
    this.stormStage    = 0;
  }

  start() {
    this.isActive      = true;
    this.currentRadius = this.worldSize * 0.7;
    this.phase         = "waiting";
    this.phaseTimer    = 20;
    this._setNewTarget();
  }

  _setNewTarget() {
    this.stormStage++;
    this.startX      = this.currentX;
    this.startZ      = this.currentZ;
    this.startRadius = this.currentRadius;
    this.targetRadius = this.stormStage >= 5 ? 15 : Math.max(15, this.currentRadius * 0.5);
    const angle      = Math.random() * Math.PI * 2;
    const maxOffset  = Math.max(0, this.currentRadius - this.targetRadius);
    const r          = Math.random() * maxOffset;
    this.targetX     = this.currentX + Math.cos(angle) * r;
    this.targetZ     = this.currentZ + Math.sin(angle) * r;
  }

  update(dt) {
    if (!this.isActive) return;
    if (this.phase === "waiting") {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) { this.phase = "shrinking"; this.phaseTimer = 60; }
    } else if (this.phase === "shrinking") {
      this.phaseTimer -= dt;
      const t = 1.0 - Math.max(0, this.phaseTimer) / 60;
      this.currentRadius = this.startRadius + (this.targetRadius - this.startRadius) * t;
      this.currentX      = this.startX      + (this.targetX      - this.startX)      * t;
      this.currentZ      = this.startZ      + (this.targetZ      - this.startZ)      * t;
      if (this.phaseTimer <= 0) { this.phase = "paused"; this.phaseTimer = this.stormStage >= 5 ? 9999 : 30; }
    } else if (this.phase === "paused") {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0 && this.stormStage < 5) { this._setNewTarget(); this.phase = "shrinking"; this.phaseTimer = 60; }
    }
  }

  get state() { return { x: this.currentX, z: this.currentZ, radius: this.currentRadius }; }
}

// ── Nomes ─────────────────────────────────────────────────────────────────────
const GHOST_PREFIXES = ["Convidado"];
function randomGuestName() {
  const prefix = GHOST_PREFIXES[Math.floor(Math.random() * GHOST_PREFIXES.length)];
  const num = Math.floor(Math.random() * 9999).toString().padStart(4, "0");
  return `${prefix}-${num}`;
}
let _ghostSeq = 0;
function newGhostId() { return `ghost_${Date.now()}_${++_ghostSeq}`; }

// ─────────────────────────────────────────────────────────────────────────────
export class BattleRoom extends Room {
  countdownInterval   = null;
  countdownRemaining  = COUNTDOWN_SECONDS;
  lobbyPhase          = "waiting";
  playerNames         = new Map();
  playerSnapshots     = new Map();
  botManager          = null;
  lobbyGhosts         = new Map();
  _lobbyGhostInterval = null;
  _firstPlayerTimer   = null;

  // ── Vidas dos players humanos ────────────────────────────────────────────
  playerLives         = new Map();   // sessionId → lives restantes
  _eliminated         = new Set();   // players permanentemente eliminados
  _serverStorm        = null;
  _stormInterval      = null;

  onCreate() {
    this.maxClients = MAX_PLAYERS;
    this.patchRate  = 50;

    // Snapshot periódico
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
      this.broadcast("player:took_damage", {
        sessionId:  message.targetId,
        attackerId: client.sessionId,
        damage:     message.damage,
        part:       message.part
      });
      this.botManager?.onPlayerHit(message.targetId, message.damage, message.part, client.sessionId);
    });

    this.onMessage("player:died", (client) => {
      this.broadcast("player:died", { sessionId: client.sessionId });
      this.botManager?.onPlayerDied(client.sessionId);

      // Desconta vida do jogador humano
      const lives = (this.playerLives.get(client.sessionId) ?? MAX_LIVES) - 1;
      this.playerLives.set(client.sessionId, lives);

      if (lives <= 0) {
        // Eliminado permanentemente
        this._eliminated.add(client.sessionId);
        this.broadcast("player:eliminated", { sessionId: client.sessionId });
        this.checkWinCondition();
      }
      // (se lives > 0 o cliente faz o respawn por conta própria)
    });

    this.onMessage("player:update", (client, message) => {
      if (this.lobbyPhase === "waiting") return;
      const player = this.playerSnapshots.get(client.sessionId);
      if (!player) return;
      player.x        = Number(message.x)        || 0;
      player.y        = Number(message.y)        || 0;
      player.z        = Number(message.z)        || 0;
      player.yaw      = Number(message.yaw)      || 0;
      player.pitch    = Number(message.pitch)    || 0;
      player.walking  = Boolean(message.walking);
      player.armed    = Boolean(message.armed);
      player.weaponId = typeof message.weaponId === "string" ? message.weaponId : "";
      player.reloading= Boolean(message.reloading);
      player.aiming   = Boolean(message.aiming);
      this.broadcast("player:update", { sessionId: client.sessionId, player }, { except: client });
    });
  }

  onJoin(client, options = {}) {
    const displayName = typeof options.displayName === "string" && options.displayName.trim()
      ? options.displayName.trim().slice(0, 24)
      : `Convidado-${Math.floor(Math.random() * 9999).toString().padStart(4, "0")}`;

    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist  = 15 + Math.random() * 65;
    const player = {
      x: Math.cos(spawnAngle) * spawnDist,
      y: 12, z: Math.sin(spawnAngle) * spawnDist,
      yaw: 0, pitch: 0,
      walking: false, armed: false, weaponId: "",
      reloading: false, aiming: false
    };

    this.playerNames.set(client.sessionId, displayName);
    this.playerSnapshots.set(client.sessionId, player);
    this.playerLives.set(client.sessionId, MAX_LIVES);

    this.clock.setTimeout(() => {
      client.send("players:snapshot", {
        players: Array.from(this.playerSnapshots.entries()).map(([sessionId, snapshot]) => ({
          sessionId, player: snapshot,
          displayName: this.playerNames.get(sessionId) || "Player"
        }))
      });
      this.broadcast("player:joined", {
        sessionId: client.sessionId, displayName, player
      }, { except: client });
      this.broadcastLobbyState();
    }, 0);

    if (this.clients.length >= MAX_PLAYERS && this.lobbyPhase !== "active") {
      this.startMatch(); return;
    }
    if (this.clients.length >= MIN_PLAYERS_TO_START && this.lobbyPhase === "waiting") {
      this.beginCountdown();
    }
    if (this.clients.length === 1 && this.lobbyPhase === "waiting" && !this._firstPlayerTimer) {
      this._firstPlayerTimer = this.clock.setTimeout(() => {
        this._firstPlayerTimer = null;
        if (this.lobbyPhase !== "waiting" && this.lobbyPhase !== "countdown") return;
        this._startLobbyGhostFill();
      }, 5000);
    }
  }

  onLeave(client) {
    this.playerSnapshots.delete(client.sessionId);
    this.playerNames.delete(client.sessionId);
    this.playerLives.delete(client.sessionId);
    this._eliminated.delete(client.sessionId);
    this.broadcast("player:left", { sessionId: client.sessionId });
    this.broadcastLobbyState();

    if (this.lobbyPhase === "active") {
      this.checkWinCondition();
      return;
    }
    if (this.clients.length === 0) {
      this.stopCountdown();
      this._stopLobbyGhostFill();
      if (this._firstPlayerTimer) { this._firstPlayerTimer.clear(); this._firstPlayerTimer = null; }
      this.lobbyGhosts.clear();
      this.lobbyPhase = "waiting";
      this.broadcastLobbyState();
      return;
    }
    const visibleCount = this.clients.length + this.lobbyGhosts.size;
    if (visibleCount < MIN_PLAYERS_TO_START) {
      this.stopCountdown();
      this.lobbyPhase = "waiting";
      this.broadcastLobbyState();
      return;
    }
    if (!this.countdownInterval && this.lobbyPhase !== "active") this.beginCountdown();
  }

  onDispose() {
    this.stopCountdown();
    this._stopLobbyGhostFill();
    this._stopStorm();
    if (this._firstPlayerTimer) { this._firstPlayerTimer.clear(); this._firstPlayerTimer = null; }
    this.lobbyGhosts.clear();
    this.botManager?.destroy();
  }

  beginCountdown() {
    if (this.countdownInterval || this.lobbyPhase === "active") return;
    this.lobbyPhase         = "countdown";
    this.countdownRemaining = COUNTDOWN_SECONDS;
    this.broadcastLobbyState();
    this.countdownInterval = this.clock.setInterval(() => {
      if (this.clients.length === 0) {
        this.stopCountdown();
        this.lobbyPhase = "waiting";
        this.broadcastLobbyState();
        return;
      }
      this.countdownRemaining -= 1;
      this.broadcastLobbyState();
      if (this.countdownRemaining <= 0 || this.clients.length >= MAX_PLAYERS) this.startMatch();
    }, 1000);
  }

  stopCountdown() {
    if (this.countdownInterval) { this.countdownInterval.clear(); this.countdownInterval = null; }
    this.countdownRemaining = COUNTDOWN_SECONDS;
  }

  startMatch() {
    this.stopCountdown();
    this._stopLobbyGhostFill();
    this.lobbyPhase = "active";
    this.lock();
    this.lobbyGhosts.clear();
    this.broadcast("match:start", { playerCount: this.clients.length });
    this.broadcastLobbyState();

    const snapshot = {
      players: Array.from(this.playerSnapshots.entries()).map(([sessionId, player]) => ({
        sessionId, player,
        displayName: this.playerNames.get(sessionId) || "Player"
      }))
    };
    this.broadcast("players:snapshot", snapshot);

    // Inicia bots
    this.botManager = new BotManager(this);
    this.botManager.fillBots(MAX_PLAYERS);

    // Inicia tempestade server-side (para guiar bots)
    this._serverStorm = new ServerStorm(512);
    this._serverStorm.start();
    this._stormInterval = this.clock.setInterval(() => {
      if (!this._serverStorm) return;
      this._serverStorm.update(0.5); // tick a cada 500ms
      const s = this._serverStorm.state;
      this.botManager?.updateStorm(s.x, s.z, s.radius);
    }, 500);
  }

  _stopStorm() {
    if (this._stormInterval) { this._stormInterval.clear(); this._stormInterval = null; }
    this._serverStorm = null;
  }

  // ── Condição de vitória ───────────────────────────────────────────────────
  checkWinCondition() {
    if (this.lobbyPhase !== "active") return;

    // Conta players humanos vivos (conectados e não eliminados)
    const humanAlive = this.clients.filter(c => !this._eliminated.has(c.sessionId)).length;
    // Conta bots vivos
    const botAlive   = this.botManager?.aliveCount() ?? 0;
    const totalAlive = humanAlive + botAlive;

    if (totalAlive > 1) return; // partida ainda em andamento

    // Encontra o vencedor
    let winnerId   = null;
    let winnerName = "Desconhecido";

    if (humanAlive === 1) {
      const winner = this.clients.find(c => !this._eliminated.has(c.sessionId));
      if (winner) {
        winnerId   = winner.sessionId;
        winnerName = this.playerNames.get(winner.sessionId) ?? winnerName;
      }
    } else if (botAlive === 1 && this.botManager) {
      for (const [id, bot] of this.botManager.bots) {
        if (!bot.eliminated && !bot.isDead) {
          winnerId   = id;
          winnerName = this.playerNames.get(id) ?? bot.displayName ?? "Bot";
          break;
        }
      }
    }

    this.broadcast("match:winner", { sessionId: winnerId, displayName: winnerName });
    console.log(`[BattleRoom] match:winner → ${winnerName} (${winnerId})`);
  }

  // ── Callback chamado pelo BotManager quando um bot é eliminado ────────────
  onBotEliminated(_botId) {
    this.checkWinCondition();
  }

  // ── Lobby ghosts ──────────────────────────────────────────────────────────
  _startLobbyGhostFill() {
    if (this._lobbyGhostInterval) return;
    this._addLobbyGhost();
    this._lobbyGhostInterval = this.clock.setInterval(() => {
      if (this.lobbyPhase === "active") { this._stopLobbyGhostFill(); return; }
      const total = this.clients.length + this.lobbyGhosts.size;
      if (total >= MAX_PLAYERS) { this._stopLobbyGhostFill(); return; }
      const remaining = this.countdownRemaining;
      const chance = remaining <= 5 ? 0.85 : remaining <= 10 ? 0.55 : 0.30;
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
    if (this.clients.length >= 1 && this.lobbyPhase === "waiting") this.beginCountdown();
  }

  _stopLobbyGhostFill() {
    if (this._lobbyGhostInterval) { this._lobbyGhostInterval.clear(); this._lobbyGhostInterval = null; }
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
