import { createClient } from "@supabase/supabase-js";

let supabaseAdminInstance = null;
let didWarnAboutEnv = false;

export function getSupabaseAdmin() {
  if (supabaseAdminInstance) {
    return supabaseAdminInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    if (!didWarnAboutEnv) {
      console.warn("Supabase backend environment is incomplete. API routes will use fallbacks where possible.");
      didWarnAboutEnv = true;
    }
    return null;
  }

  supabaseAdminInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return supabaseAdminInstance;
}

export async function getUserFromRequest(request) {
  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  console.log("[auth] getUserFromRequest", {
    hasAuthHeader: Boolean(authHeader),
    hasBearerToken: Boolean(token),
    supabaseConfigured: Boolean(getSupabaseAdmin())
  });

  const supabaseAdmin = getSupabaseAdmin();

  if (!token || !supabaseAdmin) {
    if (!token) {
      console.log("[auth] missing bearer token");
    }
    if (!supabaseAdmin) {
      console.log("[auth] supabase admin client not configured");
    }
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    console.log("[auth] getUser failed", {
      error: error?.message ?? null,
      hasUser: Boolean(data?.user)
    });
    return null;
  }

  console.log("[auth] getUser success", {
    userId: data.user.id,
    email: data.user.email ?? null
  });

  return data.user;
}

export const defaultCatalog = [
  {
    slug: "default-ranger",
    name: "Ranger Azul",
    rarity: "common",
    description: "Visual base para todos os jogadores.",
    price_brl: 0,
    is_vip_only: false,
    preview_color: "#38bdf8"
  },
  {
    slug: "ember-ops",
    name: "Ember Ops",
    rarity: "rare",
    description: "Traje laranja com brilho quente.",
    price_brl: 1290,
    is_vip_only: false,
    preview_color: "#f97316"
  },
  {
    slug: "neon-shadow",
    name: "Neon Shadow",
    rarity: "epic",
    description: "Visual escuro com detalhes em neon.",
    price_brl: 2490,
    is_vip_only: true,
    preview_color: "#8b5cf6"
  }
];

export async function getCatalog() {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return defaultCatalog;
  }

  const { data, error } = await supabaseAdmin
    .from("skins")
    .select("id, slug, name, rarity, description, price_brl, is_vip_only, preview_color")
    .eq("is_active", true)
    .order("price_brl", { ascending: true });

  if (error || !data) {
    console.warn("Unable to load skin catalog from Supabase.", error);
    return defaultCatalog;
  }

  return data;
}

export async function ensureProfile(user) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  const fallbackName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "Player";

  const upsertPayload = {
    id: user.id,
    display_name: fallbackName
  };

  const { error: upsertError } = await supabaseAdmin
    .from("profiles")
    .upsert(upsertPayload, { onConflict: "id", ignoreDuplicates: false });

  if (upsertError) {
    throw upsertError;
  }

  const { data: defaultSkin, error: defaultSkinError } = await supabaseAdmin
    .from("skins")
    .select("id")
    .eq("slug", "default-ranger")
    .maybeSingle();

  if (defaultSkinError) {
    throw defaultSkinError;
  }

  if (defaultSkin?.id) {
    const { error: userSkinError } = await supabaseAdmin
      .from("user_skins")
      .upsert(
        {
          user_id: user.id,
          skin_id: defaultSkin.id,
          source: "starter"
        },
        { onConflict: "user_id,skin_id", ignoreDuplicates: false }
      );

    if (userSkinError) {
      throw userSkinError;
    }
  }

  const [{ data: profile, error: profileError }, { data: skins, error: skinsError }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, display_name, is_vip, vip_until, equipped_skin_id")
      .eq("id", user.id)
      .single(),
    supabaseAdmin
      .from("user_skins")
      .select("skin_id")
      .eq("user_id", user.id)
  ]);

  if (profileError) {
    throw profileError;
  }

  if (skinsError) {
    throw skinsError;
  }

  return {
    ...profile,
    owned_skin_ids: skins.map((entry) => entry.skin_id)
  };
}
