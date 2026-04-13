/**
 * BotManager — IA de bots com:
 *   - Skydive do avião (aterrissam em períodos e locais aleatórios)
 *   - Fuga da tempestade em direção ao centro
 *   - Caça a players e outros bots
 *   - Máximo 3 mortes por bot (depois é eliminado)
 */

const BOT_PREFIXES = ["Soldado", "Guerreiro", "Atirador", "Sniper", "Dragão"];
function randomBotGuestName() {
  const prefix = BOT_PREFIXES[Math.floor(Math.random() * BOT_PREFIXES.length)];
  const num = Math.floor(Math.random() * 9999).toString().padStart(4, "0");
  return `${prefix}-${num}`;
}

const WEAPON_IDS   = ["m9", "ak47", "m4a1", "spas12", "awp"];
const TICK_RATE_MS = 100;
const DETECT_RANGE = 40;
const ATTACK_RANGE = 28;
const FLEE_HP      = 30;
const RELOAD_TIME  = 2500;
const REACTION_MIN = 350;
const REACTION_MAX = 800;
const MAX_LIVES    = 3;

// ── Avião ────────────────────────────────────────────────────────────────────
const PLANE_START_X  = -520;
const PLANE_SPEED    = 72;    // m/s
const PLANE_ALTITUDE = 300;
const SKYDIVE_GRAV   = 30;
const SKYDIVE_MAX    = 58;
const CHUTE_HEIGHT   = 45;
const CHUTE_SPEED    = 6;

function smoothNoise(seed, t) {
  const s = Math.sin(seed * 127.1 + t * 1.3) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function getBotGroundHeight(x, z) {
  const WORLD_SIZE = 512;
  const nx = x / (WORLD_SIZE * 0.5);
  const nz = z / (WORLD_SIZE * 0.5);
  const radial    = Math.sqrt(nx * nx + nz * nz);
  const islandMask= Math.max(0, 1 - radial * 1.05);
  const h1 = Math.sin(nx * Math.PI * 2.4 + 1.1) * Math.cos(nz * Math.PI * 2.4 + 0.7);
  const h2 = Math.sin(nx * Math.PI * 5.1 + 2.3) * Math.cos(nz * Math.PI * 5.1 + 1.9);
  const shaped = 3 + islandMask * 6 + (h1 * 0.55 + h2 * 0.2) * 5;
  return Math.max(2, Math.min(18, shaped));
}

function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function normalize3(dx, dy, dz) {
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  return { x: dx/len, y: dy/len, z: dz/len };
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
class Bot {
  constructor(id, displayName, jumpDelayS, jumpX, jumpZ) {
    this.id          = id;
    this.displayName = displayName;

    // ── Skydive ───────────────────────────────────────────────────────────
    this.jumpDelay    = jumpDelayS;  // segundos até pular do avião
    this.jumpX        = jumpX;       // posição X de saída do avião
    this.jumpZ        = jumpZ;       // posição Z de destino (deriva lateral)
    this.skydiving    = true;
    this.parachute    = false;
    this.planeX       = PLANE_START_X; // posição X do avião no momento do salto
    this.planeTimer   = 0;

    // Posição inicial: no avião (não no mundo ainda)
    this.x = PLANE_START_X;
    this.z = jumpZ;
    this.y = PLANE_ALTITUDE;

    this.yaw   = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.hp    = 100;
    this.isDead= false;

    // ── Vidas ─────────────────────────────────────────────────────────────
    this.lives      = MAX_LIVES;
    this.eliminated = false;

    // ── Arma ─────────────────────────────────────────────────────────────
    this.weaponId  = randomFrom(WEAPON_IDS);
    this.ammo      = 30;
    this.maxAmmo   = 30;
    this.armed     = false; // não armado durante skydive
    this.reloading = false;
    this.aiming    = false;

    // ── Máquina de estados ───────────────────────────────────────────────
    this.state        = "skydiving";
    this.targetId     = null;
    this.wanderAngle  = Math.random() * Math.PI * 2;
    this.wanderTimer  = 0;
    this._wanderPaused= false;

    this.reloadTimer   = 0;
    this.reactionTimer = 0;
    this.sightTimer    = 0;
    this.stateTimer    = 0;
    this.shootCooldown = 0;
    this.noiseSeed     = Math.random() * 1000;
    this.t             = 0;

    this.vy             = 0;
    this._onGround      = false;
    this.walking        = false;
    this._deadTimer     = 0;
    this._smoothGroundY = getBotGroundHeight(jumpX, jumpZ);
  }

  snapshot() {
    return {
      x: this.x, y: this.y, z: this.z,
      yaw: this.yaw, pitch: this.pitch,
      walking: this.walking,
      armed: this.armed,
      weaponId: this.weaponId,
      reloading: this.reloading,
      aiming: this.aiming
    };
  }

  respawn() {
    this.lives--;
    if (this.lives <= 0) {
      this.eliminated = true;
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const dist  = 15 + Math.random() * 50;
    this.x      = Math.cos(angle) * dist;
    this.z      = Math.sin(angle) * dist;
    const rg    = getBotGroundHeight(this.x, this.z);
    this._smoothGroundY = rg;
    this.y      = rg + 1.8 + 1;
    this.yaw    = Math.random() * Math.PI * 2;
    this.pitch  = 0;
    this.hp     = 100;
    this.isDead = false;
    this._deadTimer = 0;
    this.vy     = 0;
    this._onGround = false;
    this.state  = "wandering";
    this.targetId = null;
    this.aiming = false;
    this.armed  = true;
    this.ammo   = this.maxAmmo;
    this.reloading = false;
    this.reactionTimer = 0;
    this.sightTimer = 0;
    this.stateTimer = 0;
  }

  takeDamage(amount, part) {
    if (this.isDead || this.skydiving) return;
    const dmg = part === "head" ? 9999 : amount;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp     = 0;
      this.isDead = true;
    }
  }

  /**
   * @param {number} dt
   * @param {Map} allPlayers
   * @param {{ x:number, z:number, radius:number }} storm  — estado da tempestade
   */
  update(dt, allPlayers, storm) {
    this.t += dt;

    // ── Fase skydive ────────────────────────────────────────────────────
    if (this.skydiving) {
      this.planeTimer += dt;

      if (this.planeTimer < this.jumpDelay) {
        // Ainda no avião — avança junto com ele
        this.x = PLANE_START_X + this.planeTimer * PLANE_SPEED;
        this.y = PLANE_ALTITUDE;
        // não processa mais nada
        return [];
      }

      // Pulou! Começa queda livre
      if (!this._jumped) {
        this._jumped = true;
        this.vy      = 0;
        this.armed   = false;
      }

      // Queda livre / paraquedas
      const groundH   = getBotGroundHeight(this.x, this.z);
      const groundCamY= groundH + 1.8;

      if (!this.parachute && this.y - groundH < CHUTE_HEIGHT) {
        this.parachute = true;
      }

      if (this.parachute) {
        this.vy = -CHUTE_SPEED;
      } else {
        this.vy -= SKYDIVE_GRAV * dt;
        this.vy  = Math.max(this.vy, -SKYDIVE_MAX);
      }

      // Deriva lateral em direção ao jumpX/jumpZ
      const driftX = (this.jumpX - this.x) * 0.3;
      const driftZ = (this.jumpZ - this.z) * 0.3;
      this.x += driftX * dt;
      this.z += driftZ * dt;
      this.y += this.vy * dt;

      if (this.y <= groundCamY) {
        this.y         = groundCamY;
        this.vy        = 0;
        this.skydiving = false;
        this.parachute = false;
        this.state     = "wandering";
        this.armed     = true;
        this._onGround = true;
      }
      return [];
    }

    // ── Morto ────────────────────────────────────────────────────────────
    if (this.isDead) return [];

    const events = [];
    this.stateTimer += dt;

    // ── Lista de inimigos ────────────────────────────────────────────────
    const enemies = [];
    for (const [id, p] of allPlayers) {
      if (id === this.id || p.isDead) continue;
      const d = dist2D(this.x, this.z, p.x, p.z);
      enemies.push({ id, ...p, dist: d });
    }

    // ── Fuga da tempestade (prioridade máxima) ────────────────────────────
    if (storm && storm.radius > 0) {
      const distToCenter = dist2D(this.x, this.z, storm.x, storm.z);
      if (distToCenter > storm.radius * 0.88) {
        // Fora da zona segura → corre para o centro
        this.state    = "fleeing_storm";
        this.aiming   = false;
        this.targetId = null;
      } else if (this.state === "fleeing_storm") {
        // Entrou na zona → volta ao wandering
        this.state    = "wandering";
        this.stateTimer = 0;
      }
    }

    // ── Transições de estado (exceto fuga de tempestade) ─────────────────
    if (this.state !== "fleeing_storm") {
      if (this.hp < FLEE_HP && this.state !== "fleeing") {
        this.state      = "fleeing";
        this.stateTimer = 0;
        this.targetId   = null;
      }

      if (this.state !== "fleeing" && this.state !== "reloading") {
        const nearest = enemies.filter(e => e.dist < DETECT_RANGE)
                               .sort((a, b) => a.dist - b.dist)[0];
        if (nearest) {
          if (this.state === "wandering" || this.state === "looting") {
            this.state         = "hunting";
            this.stateTimer    = 0;
            this.reactionTimer = REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
            this.sightTimer    = 0;
          } else if (nearest.id !== this.targetId) {
            this.sightTimer = 0;
          }
          this.targetId = nearest.id;
        } else if (this.state === "hunting" || this.state === "combat") {
          this.state    = "wandering";
          this.targetId = null;
          this.aiming   = false;
          this.sightTimer = 0;
        }
      }
    }

    // ── Reload ───────────────────────────────────────────────────────────
    if (this.reloading) {
      this.reloadTimer -= dt * 1000;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.ammo      = this.maxAmmo;
        if (this.targetId) this.state = "hunting"; else this.state = "wandering";
      }
      this.walking = false;
      return events;
    }
    if (this.ammo <= 0 && !this.reloading) {
      this.reloading   = true;
      this.reloadTimer = RELOAD_TIME + Math.random() * 800;
      this.state       = "reloading";
      this.aiming      = false;
      return events;
    }

    // ── Comportamento por estado ─────────────────────────────────────────
    const SPEED_WALK = 3.5;
    const SPEED_RUN  = 5.8;
    const SPEED_FLEE = 6.5;
    let moveX = 0, moveZ = 0;

    if (this.state === "fleeing_storm" && storm) {
      // Corre em direção ao centro da zona
      const dx = storm.x - this.x;
      const dz = storm.z - this.z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;
      const desiredYaw = Math.atan2(dx, dz);
      const yawDiff    = ((desiredYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += yawDiff * Math.min(1, dt * 4);
      moveX = (dx / len) * SPEED_FLEE;
      moveZ = (dz / len) * SPEED_FLEE;
      this.walking = true;

    } else if (this.state === "wandering") {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderAngle    = Math.random() * Math.PI * 2;
        this.wanderTimer    = 3 + Math.random() * 4;
        this._wanderPaused  = Math.random() < 0.15;
        if (this._wanderPaused) this.wanderTimer = 0.8 + Math.random() * 1.5;
      }
      if (!this._wanderPaused) {
        const noiseYaw = smoothNoise(this.noiseSeed, this.t * 0.25) * 0.5;
        this.yaw = this.wanderAngle + noiseYaw;
        moveX = Math.sin(this.yaw) * SPEED_WALK;
        moveZ = Math.cos(this.yaw) * SPEED_WALK;
        this.walking = true;
        if (this._onGround && Math.random() < 0.001) { this.vy = 7.5; this._onGround = false; }
      } else {
        this.yaw += dt * 0.8;
        this.walking = false;
      }
      this.aiming = false;

    } else if (this.state === "hunting") {
      const target = allPlayers.get(this.targetId);
      if (!target || target.isDead) { this.state = "wandering"; this.targetId = null; return events; }
      const desiredYaw = Math.atan2(target.x - this.x, target.z - this.z);
      const yawDiff    = ((desiredYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += yawDiff * Math.min(1, dt * 3.5);
      const d = dist2D(this.x, this.z, target.x, target.z);
      if (d > ATTACK_RANGE) {
        this.walking = true;
        moveX = Math.sin(this.yaw) * SPEED_RUN;
        moveZ = Math.cos(this.yaw) * SPEED_RUN;
      } else {
        this.state   = "combat";
        this.walking = false;
      }

    } else if (this.state === "combat") {
      const target = allPlayers.get(this.targetId);
      if (!target || target.isDead) { this.state = "wandering"; this.targetId = null; this.aiming = false; return events; }
      const d = dist2D(this.x, this.z, target.x, target.z);
      const desiredYaw  = Math.atan2(target.x - this.x, target.z - this.z);
      const jitterYaw   = smoothNoise(this.noiseSeed + 10, this.t * 4) * 0.04;
      const jitterPitch = smoothNoise(this.noiseSeed + 20, this.t * 4) * 0.03;
      const yawDiff     = ((desiredYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw         += (yawDiff + jitterYaw) * Math.min(1, dt * 5);
      this.pitch         = -0.1 + jitterPitch;
      this.aiming        = true;

      const strafeNoise  = smoothNoise(this.noiseSeed + 30, this.t * 0.5);
      const advanceNoise = smoothNoise(this.noiseSeed + 40, this.t * 0.3);
      const strafeAngle  = this.yaw + Math.PI / 2;
      moveX += Math.sin(strafeAngle) * strafeNoise * SPEED_WALK * 0.8;
      moveZ += Math.cos(strafeAngle) * strafeNoise * SPEED_WALK * 0.8;
      const preferredDist = 14;
      if (d > preferredDist + 4) {
        moveX += Math.sin(this.yaw) * SPEED_WALK * 0.7;
        moveZ += Math.cos(this.yaw) * SPEED_WALK * 0.7;
      } else if (d < preferredDist - 4) {
        moveX -= Math.sin(this.yaw) * SPEED_WALK * 0.6;
        moveZ -= Math.cos(this.yaw) * SPEED_WALK * 0.6;
      } else {
        moveX += Math.sin(this.yaw) * advanceNoise * SPEED_WALK * 0.3;
        moveZ += Math.cos(this.yaw) * advanceNoise * SPEED_WALK * 0.3;
      }
      this.walking = (moveX * moveX + moveZ * moveZ) > 0.5;
      if (this._onGround && Math.random() < 0.004) { this.vy = 7.5; this._onGround = false; }
      if (d > DETECT_RANGE * 1.2) { this.state = "hunting"; this.aiming = false; }

      this.sightTimer += dt;
      if (this.reactionTimer > 0) {
        this.reactionTimer -= dt * 1000;
      } else if (this.sightTimer > 0.8) {
        this.shootCooldown -= dt * 1000;
        if (this.shootCooldown <= 0) {
          const fireCooldownMs = this.weaponId === "awp"    ? 1800 :
                                 this.weaponId === "spas12" ? 900  :
                                 this.weaponId === "ak47"   ? 110  :
                                 this.weaponId === "m4a1"   ? 90   : 180;
          this.shootCooldown = fireCooldownMs + Math.random() * 80;
          this.ammo--;
          const accuracy = this.weaponId === "awp" ? 0.80 : this.weaponId === "spas12" ? 0.60 : 0.50;
          const hitChance  = accuracy * Math.max(0.1, 1 - (d / ATTACK_RANGE) * 0.9);
          const isHit      = Math.random() < hitChance;
          const isHeadshot = isHit && Math.random() < 0.08;
          events.push({
            type: "shot",
            payload: {
              shooterId: this.id,
              targetId:  isHit ? this.targetId : null,
              part:      isHeadshot ? "head" : "body",
              damage:    isHeadshot ? 9999 : (
                           this.weaponId === "awp"    ? 80 :
                           this.weaponId === "spas12" ? 35 :
                           this.weaponId === "ak47"   ? 28 :
                           this.weaponId === "m4a1"   ? 24 : 22
                         ),
              ox: this.x, oy: this.y + 1.6, oz: this.z,
              tx: target.x, ty: (target.y ?? this.y) + 1.0, tz: target.z,
              hit: isHit
            }
          });
        }
      }

    } else if (this.state === "fleeing") {
      const nearest = enemies.sort((a, b) => a.dist - b.dist)[0];
      if (nearest) {
        const fleeYaw = Math.atan2(this.x - nearest.x, this.z - nearest.z);
        const yawDiff = ((fleeYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.yaw += yawDiff * Math.min(1, dt * 4);
      }
      moveX    = Math.sin(this.yaw) * SPEED_FLEE;
      moveZ    = Math.cos(this.yaw) * SPEED_FLEE;
      this.walking = true;
      this.aiming  = false;
      if (this.stateTimer > 8) {
        this.hp    = Math.min(100, this.hp + 20);
        this.state = "wandering";
        this.stateTimer = 0;
      }
    }

    // ── Física ───────────────────────────────────────────────────────────
    this.x += moveX * dt;
    this.z += moveZ * dt;
    this.x  = Math.max(-240, Math.min(240, this.x));
    this.z  = Math.max(-240, Math.min(240, this.z));

    const rawGroundY = getBotGroundHeight(this.x, this.z);
    this._smoothGroundY += (rawGroundY - this._smoothGroundY) * Math.min(1, dt * 6);
    const groundCamY = this._smoothGroundY + 1.8;
    this.vy -= 22 * dt;
    this.y  += this.vy * dt;
    if (this.y <= groundCamY) {
      this.y  = groundCamY;
      this.vy = 0;
      this._onGround = true;
    } else {
      this._onGround = false;
    }
    if (this._onGround && Math.random() < 0.002) { this.vy = 7.5; this._onGround = false; }

    return events;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export class BotManager {
  constructor(room) {
    this.room     = room;
    this.bots     = new Map();
    this.interval = null;
    // Estado da tempestade (atualizado pelo BattleRoom)
    this.storm    = { x: 0, z: 0, radius: 99999 };
  }

  /** Atualiza o estado da tempestade para que os bots fujam dela */
  updateStorm(x, z, radius) {
    this.storm = { x, z, radius };
  }

  /** Preenche até `targetCount` bots com skydive escalonado */
  fillBots(targetCount) {
    const humanCount = this.room.clients.length;
    const botCount   = Math.max(0, targetCount - humanCount);
    console.log(`[BotManager] spawning ${botCount} bots (${humanCount} humans)`);

    for (let i = 0; i < botCount; i++) {
      const id        = `bot_${Date.now()}_${i}`;
      const name      = randomBotGuestName();
      // Salto aleatório: 2s a 25s após o início da partida
      const jumpDelay = 2 + Math.random() * 23;
      // Destino de aterrissagem aleatório
      const angle     = Math.random() * Math.PI * 2;
      const dist      = 20 + Math.random() * 100;
      const jumpX     = Math.cos(angle) * dist;
      const jumpZ     = Math.sin(angle) * dist;

      const bot = new Bot(id, name, jumpDelay, jumpX, jumpZ);
      this.bots.set(id, bot);
      this.room.playerNames.set(id, name);
      // Snapshot inicial: no avião (posição alta)
      this.room.playerSnapshots.set(id, bot.snapshot());

      // Anuncia chegada escalonada — acompanha o jumpDelay
      setTimeout(() => {
        if (!this.bots.has(id)) return;
        this.room.broadcast("player:joined", {
          sessionId:   id,
          displayName: name,
          player:      bot.snapshot()
        });
      }, jumpDelay * 1000);
    }

    this._startTick();
  }

  _startTick() {
    if (this.interval) return;
    let lastMs = Date.now();

    this.interval = this.room.clock.setInterval(() => {
      const now = Date.now();
      const dt  = Math.min((now - lastMs) / 1000, 0.1);
      lastMs    = now;

      const allPlayers = new Map();
      for (const [id, snap] of this.room.playerSnapshots) {
        allPlayers.set(id, { ...snap, isDead: snap.isDead ?? false });
      }
      for (const [id, bot] of this.bots) {
        allPlayers.set(id, { x: bot.x, y: bot.y, z: bot.z, hp: bot.hp, isDead: bot.isDead });
      }

      let changed = false; // detecta eliminações neste tick

      for (const [id, bot] of this.bots) {
        if (bot.eliminated) continue;

        if (bot.isDead) {
          bot._deadTimer += dt;
          if (bot._deadTimer >= 6) {
            bot.respawn();
            if (bot.eliminated) {
              // Bot esgotou as vidas — remove permanentemente
              this.bots.delete(id);
              this.room.playerSnapshots.delete(id);
              this.room.playerNames.delete(id);
              this.room.broadcast("player:left", { sessionId: id });
              this.room.onBotEliminated?.(id);
              changed = true;
            } else {
              this.room.broadcast("player:left",   { sessionId: id });
              this.room.broadcast("player:joined", {
                sessionId:   id,
                displayName: this.room.playerNames.get(id),
                player:      bot.snapshot()
              });
              this.room.playerSnapshots.set(id, { ...bot.snapshot(), isDead: false });
            }
          }
          continue;
        }

        const events = bot.update(dt, allPlayers, this.storm);
        const snap   = bot.snapshot();
        this.room.playerSnapshots.set(id, { ...snap, isDead: false });
        this.room.broadcast("player:update", { sessionId: id, player: snap });

        for (const evt of events) {
          if (evt.type !== "shot") continue;
          const { payload } = evt;
          const eyeY  = payload.oy;
          const rawDir = normalize3(payload.tx - payload.ox, payload.ty - eyeY, payload.tz - payload.oz);
          const jX = (Math.random() - 0.5) * 0.04;
          const jY = (Math.random() - 0.5) * 0.04;
          const jZ = (Math.random() - 0.5) * 0.04;
          const dir = normalize3(rawDir.x + jX, rawDir.y + jY, rawDir.z + jZ);
          const RANGE = 200;
          const ix = payload.hit ? payload.tx : payload.ox + dir.x * RANGE;
          const iy = payload.hit ? payload.ty : eyeY       + dir.y * RANGE;
          const iz = payload.hit ? payload.tz : payload.oz + dir.z * RANGE;

          this.room.broadcast("player:shot", {
            ox: payload.ox, oy: eyeY, oz: payload.oz,
            dx: dir.x, dy: dir.y, dz: dir.z,
            ix, iy, iz, hit: payload.hit,
            attackerId: payload.shooterId
          });

          if (payload.hit && payload.targetId) {
            const targetBot = this.bots.get(payload.targetId);
            if (targetBot) {
              const wasAlive = !targetBot.isDead;
              targetBot.takeDamage(payload.damage, payload.part);
              this.room.broadcast("player:took_damage", {
                sessionId: payload.targetId, attackerId: id,
                damage: payload.damage, part: payload.part
              });
              if (wasAlive && targetBot.isDead) {
                this.room.broadcast("player:died", { sessionId: payload.targetId });
                this.room.playerSnapshots.set(payload.targetId, { ...targetBot.snapshot(), isDead: true });
              }
            } else {
              this.room.broadcast("player:took_damage", {
                sessionId: payload.targetId, attackerId: id,
                damage: payload.damage, part: payload.part
              });
            }
          }
        }
      }

      if (changed) this.room.checkWinCondition?.();
    }, TICK_RATE_MS);
  }

  onPlayerHit(targetId, damage, part, attackerId) {
    const bot = this.bots.get(targetId);
    if (!bot || bot.isDead || bot.skydiving) return;
    const wasAlive = !bot.isDead;
    bot.takeDamage(damage, part);
    if (wasAlive && bot.isDead) {
      this.room.broadcast("player:died", { sessionId: targetId });
      this.room.playerSnapshots.set(targetId, { ...bot.snapshot(), isDead: true });
      this.room.checkWinCondition?.();
    } else {
      if (bot._onGround && Math.random() < 0.6) { bot.vy = 7.5; bot._onGround = false; }
      if (bot.state === "wandering" || bot.state === "looting") {
        bot.targetId      = attackerId;
        bot.state         = "hunting";
        bot.reactionTimer = 150;
        bot.sightTimer    = 0;
      }
    }
  }

  onPlayerDied(sessionId) {
    for (const bot of this.bots.values()) {
      if (bot.targetId === sessionId) {
        bot.state    = "wandering";
        bot.targetId = null;
        bot.aiming   = false;
      }
    }
  }

  /** Número de bots ainda vivos (não eliminados, não mortos) */
  aliveCount() {
    let n = 0;
    for (const bot of this.bots.values()) {
      if (!bot.eliminated && !bot.isDead) n++;
    }
    return n;
  }

  destroy() {
    if (this.interval) { this.interval.clear(); this.interval = null; }
    for (const id of this.bots.keys()) {
      this.room.playerSnapshots.delete(id);
      this.room.playerNames.delete(id);
      this.room.broadcast("player:left", { sessionId: id });
    }
    this.bots.clear();
  }
}
