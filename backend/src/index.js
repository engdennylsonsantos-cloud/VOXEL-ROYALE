import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { BattleRoom } from "./rooms/BattleRoom.js";
import { loadLocalEnv } from "./loadEnv.js";
import { ensureProfile, getCatalog, getSupabaseAdmin, getUserFromRequest } from "./supabaseAdmin.js";

loadLocalEnv();

const port = Number(process.env.PORT || 2567);
const app = express();
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(express.json());
app.use((request, response, next) => {
  response.header("Access-Control-Allow-Origin", corsOrigin);
  response.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  next();
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "voxel-royale-backend" });
});

app.get("/api/catalog", async (_request, response) => {
  const catalog = await getCatalog();
  response.json({ catalog });
});

app.post("/api/session/bootstrap", async (request, response) => {
  const user = await getUserFromRequest(request);
  const catalog = await getCatalog();

  console.log("[auth] /api/session/bootstrap", {
    authorizationHeader: request.headers.authorization ? "present" : "absent",
    resolvedUser: user?.id ?? null
  });

  if (!user) {
    const guestId = typeof request.body?.guestId === "string" && request.body.guestId
      ? request.body.guestId
      : crypto.randomUUID();

    response.json({
      mode: "guest",
      guest: {
        id: guestId,
        display_name: `Convidado-${guestId.slice(0, 6)}`
      },
      profile: null,
      ads_enabled: true,
      catalog
    });
    return;
  }

  try {
    const profile = await ensureProfile(user);
    response.json({
      mode: "authenticated",
      guest: null,
      profile,
      ads_enabled: !profile.is_vip,
      catalog
    });
  } catch (error) {
    console.error("Failed to bootstrap session.", error);
    response.status(500).json({ error: "bootstrap_failed" });
  }
});

app.post("/api/matchmaking/join", async (request, response) => {
  const displayName = typeof request.body?.displayName === "string" && request.body.displayName.trim()
    ? request.body.displayName.trim().slice(0, 24)
    : "Player";

  try {
    const reservation = await matchMaker.joinOrCreate("battle", {
      displayName
    });

    response.json({
      room: {
        name: reservation.name,
        roomId: reservation.roomId,
        processId: reservation.processId
      },
      sessionId: reservation.sessionId,
      reconnectionToken: reservation.reconnectionToken,
      devMode: reservation.devMode,
      publicAddress: reservation.publicAddress,
      protocol: reservation.protocol
    });
  } catch (error) {
    console.error("Failed to create/join battle room.", error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "matchmaking_failed"
    });
  }
});

app.get("/api/me", async (request, response) => {
  const user = await getUserFromRequest(request);
  if (!user) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const profile = await ensureProfile(user);
    response.json({
      profile,
      ads_enabled: !profile.is_vip
    });
  } catch (error) {
    console.error("Failed to load profile.", error);
    response.status(500).json({ error: "profile_load_failed" });
  }
});

app.post("/api/me/display-name", async (request, response) => {
  const user = await getUserFromRequest(request);
  const displayName = typeof request.body?.displayName === "string" ? request.body.displayName.trim() : "";

  if (!user) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  if (!displayName || displayName.length < 3 || displayName.length > 24) {
    response.status(400).json({ error: "invalid_display_name" });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    response.status(500).json({ error: "supabase_not_configured" });
    return;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);

  if (error) {
    console.error("Failed to update display name.", error);
    response.status(500).json({ error: "display_name_update_failed" });
    return;
  }

  const profile = await ensureProfile(user);
  response.json({ profile });
});

app.post("/api/me/equip-skin", async (request, response) => {
  const user = await getUserFromRequest(request);
  const skinId = typeof request.body?.skinId === "string" ? request.body.skinId : "";

  if (!user) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  if (!skinId) {
    response.status(400).json({ error: "invalid_skin_id" });
    return;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    response.status(500).json({ error: "supabase_not_configured" });
    return;
  }

  const { data: ownedSkin, error: ownedSkinError } = await supabaseAdmin
    .from("user_skins")
    .select("skin_id")
    .eq("user_id", user.id)
    .eq("skin_id", skinId)
    .maybeSingle();

  if (ownedSkinError) {
    console.error("Failed to validate owned skin.", ownedSkinError);
    response.status(500).json({ error: "skin_validation_failed" });
    return;
  }

  if (!ownedSkin) {
    response.status(403).json({ error: "skin_not_owned" });
    return;
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ equipped_skin_id: skinId })
    .eq("id", user.id);

  if (error) {
    console.error("Failed to equip skin.", error);
    response.status(500).json({ error: "equip_skin_failed" });
    return;
  }

  const profile = await ensureProfile(user);
  response.json({ profile });
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server
  })
});

gameServer.define("battle", BattleRoom);

gameServer.listen(port);
console.log(`Colyseus ouvindo em http://localhost:${port}`);
