/* =========================================================
   SARVAM AI — CLOUDFLARE WORKER (complete, v16)
   Royal heritage-gate UI
   + 4-digit access code (lock screen, sweet error, achievement)
   + Sarvam 105B chat  + Sarvam Mayura / Sarvam-Translate
   + Sarvam Vision (document intelligence)
   + Qwen 3.7 Flash / GLM 5.3 Flash / DeepSeek V4 Flash       (one 0G key)
   + Google Gemini                                              (own key)
   + Z-Image Turbo image generation                             (one 0G key)
   + "Models" drop-up: turn each model ON / OFF
   + "Reply language" drop-up (English / Bengali / Hindi)
   + Input/Output language dialog on file upload
   + Voice input: English / Bengali / Hindi only
   + Sample prompts only fill the chat box (no auto-send)
   + File is attached to the message together with the prompt
   + Permanent usage + chat history (Cloudflare KV: CHAT_STORE)
   + "Made with 💖 by Sujoy" signature in the side panels
   + Sparkle / confetti effect ONLY inside the home hero
   + Layout: Auto / Mobile / Web   (Settings → Appearance)
   + 4 UI designs: Pixel (default) + Saffron / Emerald / Purple
   SECRETS NEEDED (Settings → Variables and Secrets):
     SARVAM_API_KEY, OG_API_KEY, GEMINI_API_KEY,
     ACCESS_CODE, COOKIE_SECRET
   VARIABLES YOU MUST ADD:
     OG_API_BASE   = the 0G API address, e.g. https://....../v1
                     (or paste it into OG_DEFAULT_BASE below)
   OPTIONAL VARIABLES (only if a model name is different):
     SARVAM_CHAT_MODEL, GEMINI_MODEL, OG_MODEL_QWEN, OG_MODEL_GLM,
     OG_MODEL_DEEPSEEK, OG_MODEL_IMAGE
   ========================================================= */
const API = "https://api.sarvam.ai";
const DEFAULT_CHAT_MODEL = "sarvam-105b-conversations"; // override with env.SARVAM_CHAT_MODEL
const MAX_FILE_SIZE = 50 * 1024 * 1024;
/* =========================================================
   EXTRA AI MODELS  (0G gateway + Google Gemini)
   ========================================================= */
/* the 0G Compute Router (mainnet) — the OG_API_BASE variable overrides it,
   so Qwen / GLM / DeepSeek / Z-Image work without any extra setup */
const OG_DEFAULT_BASE = "https://router-api.0g.ai/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";   // Google retired 2.5-flash; override with env.GEMINI_MODEL
/* key = id used by the front-end */
const CHAT_MODELS = {
  sarvam:   { label: "Sarvam 105B",       provider: "sarvam" },
  qwen:     { label: "Qwen 3.7 Flash",    provider: "og",     id: "qwen3.7-flash",     envName: "OG_MODEL_QWEN" },
  gemini:   { label: "Google Gemini",     provider: "gemini" },
  glm:      { label: "GLM 5.3 Flash",     provider: "og",     id: "glm-5.3-flash",     envName: "OG_MODEL_GLM" },
  deepseek: { label: "DeepSeek V4 Flash", provider: "og",     id: "deepseek-v4-flash", envName: "OG_MODEL_DEEPSEEK" }
};
const IMAGE_MODEL = { label: "Z-Image Turbo", id: "z-image-turbo", envName: "OG_MODEL_IMAGE" };
const IMAGE_SIZES = ["1024x1024", "768x1024", "1024x768"];
const MAX_IMAGE_PROMPT = 2000;
function ogBase(env) {
  return String(env.OG_API_BASE || OG_DEFAULT_BASE || "").trim().replace(/\/+$/, "");
}
function imageModelId(env) {
  return env[IMAGE_MODEL.envName] || IMAGE_MODEL.id;
}
function chatModelId(env, key) {
  const m = CHAT_MODELS[key] || CHAT_MODELS.sarvam;
  if (m.provider === "sarvam") return env.SARVAM_CHAT_MODEL || DEFAULT_CHAT_MODEL;
  if (m.provider === "gemini") return env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  return env[m.envName] || m.id;
}
/* returns "" when the model is ready, otherwise a readable problem */
/* =========================================================
   🔌 API PROVIDERS — the address AND the key live here, once.
   Adding a model is then only: pick an API, type a name, a code
   name and a logo. Nothing else is ever asked for.
   ========================================================= */
const PROVIDER_ORDER = ["og", "openrouter", "google", "sarvam"];
const PROVIDERS = {
  og: {
    id: "og", label: "0G API", short: "0G", icon: "🧠",
    base: "https://router-api.0g.ai/v1", format: "openai",
    envKeys: ["OG_API_KEY"],
    hint: "One key for every 0G model",
    example: "qwen3.7-flash"
  },
  openrouter: {
    id: "openrouter", label: "OpenRouter API", short: "OpenRouter", icon: "🛰️",
    base: "https://openrouter.ai/api/v1", format: "openai",
    envKeys: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
    headers: { "HTTP-Referer": "https://mindfusion.app", "X-Title": "MindFusion" },
    hint: "Hundreds of models from many companies",
    example: "nvidia/nemotron-3.5-lightning:free"
  },
  google: {
    id: "google", label: "Google API", short: "Google", icon: "✨",
    base: "https://generativelanguage.googleapis.com/v1beta", format: "gemini",
    envKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    hint: "Also reads pictures and PDFs",
    example: "gemini-3.8-flash"
  },
  sarvam: {
    id: "sarvam", label: "Sarvam API", short: "Sarvam", icon: "🕉️",
    base: "https://api.sarvam.ai/v1", format: "openai",
    envKeys: ["SARVAM_API_KEY", "SARVAM_KEY"],
    hint: "Sarvam's own models (105B, Mayura, Vision) — the key is already inside the app",
    example: "sarvam-105b-conversations"
  }
};
/* the keys that ship with the app, so a model works the moment it is added.
   A Worker secret beats these, and a key saved in Settings beats them too. */
const DEFAULT_PROVIDER_KEYS = {
  og: 
  sarvam: 
  openrouter: 
  google: 
};
const PROVIDER_KV_KEY = "provider_keys_v1";
function providerOf(id) {
  const key = String(id || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDERS, key) ? PROVIDERS[key] : null;
}
function providerPublic(p, found) {
  return {
    id: p.id, label: p.label, short: p.short, icon: p.icon,
    base: p.base, format: p.format, hint: p.hint, example: p.example,
    connected: Boolean(found && found.key),
    source: (found && found.source) || "none",     /* secret | settings | built-in | none */
    tail: found && found.key ? String(found.key).slice(-4) : ""
  };
}
async function providerKeys(env) {
  if (!kvReady(env)) return {};
  try {
    const raw = await kvStore(env).get(PROVIDER_KV_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) { return {}; }
}
async function saveProviderKeys(env, map) {
  if (!kvReady(env)) throw new Error("Connect a KV namespace first — it is where the keys are kept.");
  await kvStore(env).put(PROVIDER_KV_KEY, JSON.stringify(map));
}
/* secret (Cloudflare dashboard) → key saved in Settings → the key in this file */
async function providerKey(env, id) {
  const p = providerOf(id);
  if (!p) return { key: "", source: "none" };
  for (const name of p.envKeys) {
    const value = String((env && env[name]) || "").trim();
    if (value) return { key: value, source: "secret", envName: name };
  }
  const saved = await providerKeys(env);
  const fromSettings = String((saved && saved[p.id]) || "").trim();
  if (fromSettings) return { key: fromSettings, source: "settings" };
  const builtin = String(DEFAULT_PROVIDER_KEYS[p.id] || "").trim();
  if (builtin) return { key: builtin, source: "built-in" };
  return { key: "", source: "none" };
}
/* the same choice, for the places that cannot wait for KV */
function providerKeySync(env, id) {
  const p = providerOf(id);
  if (!p) return "";
  for (const name of p.envKeys) {
    const value = String((env && env[name]) || "").trim();
    if (value) return value;
  }
  return String(DEFAULT_PROVIDER_KEYS[p.id] || "").trim();
}
function ogKey(env) { return providerKeySync(env, "og"); }
/* the Sarvam key: a Worker secret wins, then a key saved in Settings, then
   the key that ships in this file — so a Sarvam model always has a key */
function sarvamKeySync(env) { return providerKeySync(env, "sarvam"); }
async function sarvamKey(env) { const found = await providerKey(env, "sarvam"); return found.key || ""; }
function geminiKey(env) { return providerKeySync(env, "google"); }
/* the address + key + format a stored model should use */
async function modelProviderConfig(env, model) {
  if (!model) throw new Error("That model is not saved any more.");
  const own = String(model.base || "").trim();
  if (own) {
    /* a model saved before this change still carries its own address and key */
    return { base: own.replace(/\/+$/, ""), apiKey: String(model.apiKey || "").trim(),
      format: model.format === "gemini" ? "gemini" : "openai", provider: "custom", providerLabel: "its own address" };
  }
  const p = providerOf(model.provider);
  if (!p) throw new Error("This model's API is unknown. Open Settings → My models and pick its API again.");
  const found = await providerKey(env, p.id);
  if (!found.key) throw new Error("No " + p.label + " key is set. Add one in Settings → 🔌 API providers.");
  return { base: p.base, apiKey: found.key, format: p.format, headers: p.headers || {},
    provider: p.id, providerLabel: p.label };
}
/* a free, credit-less call that only proves the key works */
async function providerTest(env, id, key) {
  const p = providerOf(id);
  if (!p) throw new Error("Unknown API.");
  if (!key) throw new Error("No key is saved for " + p.label + " yet.");
  if (p.id === "openrouter") {
    const r = await apiFetch(p.base + "/key", { method: "GET", headers: { "Authorization": "Bearer " + key } }, 2, p.label);
    const data = await r.json().catch(() => ({}));
    const info = (data && data.data) || {};
    const left = info.limit_remaining === undefined || info.limit_remaining === null ? "" :
      " · " + info.limit_remaining + " free requests left";
    return { ok: true, note: "Key works" + left + (info.is_free_tier ? " · free tier, so use a model ending in :free" : ""), credits: info.usage || 0 };
  }
  if (p.id === "google") {
    const r = await apiFetch(p.base + "/models", { method: "GET", headers: { "x-goog-api-key": key } }, 2, p.label);
    const data = await r.json().catch(() => ({}));
    const count = ((data && data.models) || []).length;
    return { ok: true, note: "Key works · " + count + " Gemini models available", count: count };
  }
  if (p.id === "sarvam") {
    /* Sarvam answers on /v1/chat/completions; a list call is not always
       offered, so this is only a light check */
    try {
      const sr = await apiFetch(p.base + "/models", { method: "GET", headers: { "api-subscription-key": key } }, 2, p.label);
      const sd = await sr.json().catch(() => ({}));
      const sn = ((sd && (sd.data || sd.models)) || []).length;
      return { ok: true, note: sn ? "Key works · " + sn + " Sarvam models" : "Key works — the model code decides (for example sarvam-105b-conversations)", count: sn };
    } catch (e) {
      return { ok: true, note: "Key saved ✓ Sarvam answers through /v1/chat/completions — type the model code, or pick a built-in Sarvam model", count: 0 };
    }
  }
  const r = await apiFetch(p.base + "/models", { method: "GET", headers: { "Authorization": "Bearer " + key } }, 2, p.label);
  const data = await r.json().catch(() => ({}));
  const count = ((data && data.data) || []).length;
  return { ok: true, note: "Key works · " + count + " models available", count: count };
}
/* =========================================================
   📖 WHICH MODELS ARE INSIDE EACH API
   ---------------------------------------------------------
   Every API can be asked what it offers, so nobody has to guess a model
   code name any more: the app shows the live list, you tap one, and the
   "Model code name" box fills itself.
     · 0G          GET {base}/models            → data[].id
     · OpenRouter  GET {base}/models            → data[].id (+ free flag)
     · Google      GET {base}/models?key=…      → models[].name (models/…)
   ========================================================= */
const MODEL_LIST_CACHE = {};          /* provider → { at, models } */
const MODEL_LIST_MS = 5 * 60 * 1000;  /* five minutes is plenty */
function prettyModelName(id) {
  var name = String(id || "")
    .replace(/^models\//, "")
    .replace(/:free$/, " (free)")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name.replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); });
}
async function providerModels(env, id, fresh) {
  const p = providerOf(id);
  if (!p) throw new Error("Unknown API.");
  if (id === "sarvam") {
    /* the codes that work with the Sarvam key inside the app (and the app's
       own default model first, so the 📖 list always opens) */
    return [
      { id: DEFAULT_CHAT_MODEL, label: "Sarvam 105B", free: false, note: "the model that ships in the app" },
      { id: MAYURA_MODEL, label: "Sarvam Mayura", free: false, note: "translation · 22 languages" },
      { id: SARVAM_TRANSLATE_MODEL, label: "Sarvam Translate", free: false, note: "translation · 22 languages" }
    ];
  }
  const hit = MODEL_LIST_CACHE[id];
  if (!fresh && hit && Date.now() - hit.at < MODEL_LIST_MS) return hit.models;
  const found = await providerKey(env, id);
  if (!found.key) throw new Error("No " + p.label + " key is set. Add one in Settings → 🔌 API providers.");
  const headers = Object.assign({ "Content-Type": "application/json" }, p.headers || {});
  let url = p.base + "/models";
  if (p.format === "gemini") {
    url += "?key=" + encodeURIComponent(found.key);
  } else {
    headers["Authorization"] = "Bearer " + found.key;
  }
  const response = await apiFetch(url, { method: "GET", headers: headers }, 2, p.label);
  const data = await response.json();
  let models = [];
  if (p.format === "gemini") {
    const rows = (data && data.models) || [];
    models = rows
      .filter(function (m) { return !m.supportedGenerationMethods || m.supportedGenerationMethods.indexOf("generateContent") >= 0; })
      .map(function (m) {
        const short = String(m.name || "").replace(/^models\//, "");
        const label = String(m.displayName || prettyModelName(short));
        return { id: short, label: label, free: false, note: /vision|2\.5|3\./i.test(short) ? "reads pictures & PDFs" : "" };
      });
  } else {
    const rows = (data && (data.data || data.models)) || [];
    models = rows.map(function (m) {
      const id = String(m.id || m.name || "");
      const pricing = m.pricing || {};
      const free = pricing.prompt !== undefined && pricing.completion !== undefined
        ? Number(pricing.prompt) === 0 && Number(pricing.completion) === 0
        : /:free$/.test(id);
      const ctx = Number(m.context_length || m.contextLength || 0);
      return {
        id: id,
        label: String(m.name && m.name !== id ? m.name : prettyModelName(id)),
        free: free,
        note: (free ? "free" : "") + (ctx ? (free ? " · " : "") + Math.round(ctx / 1000) + "k context" : "")
      };
    });
  }
  models = models.filter(function (m) { return m.id; });
  models.sort(function (a, b) {
    if (a.free !== b.free) return a.free ? -1 : 1;
    if (id === "openrouter") return a.id.localeCompare(b.id);
    return 0;
  });
  MODEL_LIST_CACHE[id] = { at: Date.now(), models: models };
  return models;
}
async function handleProviderModels(request, env, url) {
  const id = url.searchParams.get("id") || "";
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const free = url.searchParams.get("free") === "1";
  const p = providerOf(id);
  if (!p) return json({ ok: false, error: "Unknown API." }, 400);
  try {
    let models = await providerModels(env, id, url.searchParams.get("fresh") === "1");
    const total = models.length;
    if (free) models = models.filter(function (m) { return m.free; });
    if (q) {
      models = models.filter(function (m) {
        return (m.id + " " + m.label).toLowerCase().indexOf(q) >= 0;
      });
    }
    const shown = models.slice(0, 120);
    return json({
      ok: true, provider: id, label: p.label, icon: p.icon,
      total: total, count: shown.length,
      freeCount: models.filter(function (m) { return m.free; }).length,
      models: shown,
      example: p.example
    });
  } catch (error) {
    return json({ ok: false, provider: id, error: String((error && error.message) || error) }, 200);
  }
}
async function handleProviders(request, env) {
  if (request.method === "GET") {
    const list = [];
    for (const id of PROVIDER_ORDER) {
      const p = PROVIDERS[id];
      list.push(providerPublic(p, await providerKey(env, id)));
    }
    return json({ ok: true, kv: kvReady(env), via: kvVia(env), link: kvLinkFrom(request, env) ? true : false, providers: list });
  }
  let body = {};
  try { body = await request.json(); } catch {}
  if (env.ADMIN_PASSWORD && body.password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, needPassword: true, error: "Wrong or missing admin password." }, 401);
  }
  const p = providerOf(body.provider);
  if (!p) return json({ ok: false, error: "Unknown API." }, 400);
  if (body.action === "clear") {
    const map = await providerKeys(env);
    delete map[p.id];
    try { await saveProviderKeys(env, map); } catch (error) { return json({ ok: false, error: error.message }, 501); }
    return json({ ok: true, cleared: p.id, provider: providerPublic(p, await providerKey(env, p.id)) });
  }
  if (body.action === "test") {
    const found = await providerKey(env, p.id);
    try {
      const result = await providerTest(env, p.id, found.key);
      return json({ ok: true, tested: true, provider: providerPublic(p, found), note: result.note, count: result.count || 0 });
    } catch (error) {
      return json({ ok: false, tested: false, error: error.message }, 502);
    }
  }
  const key = String(body.key || "").trim();
  if (key.length < 12) {
    return json({ ok: false, error: "That key looks too short — paste the whole " + p.label + " key." }, 400);
  }
  const map = await providerKeys(env);
  map[p.id] = key;
  try { await saveProviderKeys(env, map); } catch (error) { return json({ ok: false, error: error.message }, 501); }
  let tested = false, note = "";
  try {
    const result = await providerTest(env, p.id, key);
    tested = true;
    note = result.note;
  } catch (error) {
    note = error.message;
  }
  return json({ ok: true, saved: true, tested: tested, note: note, provider: providerPublic(p, await providerKey(env, p.id)) });
}
function missingKeyMessage(env, key) {
  const m = CHAT_MODELS[key] || CHAT_MODELS.sarvam;
  if (m.provider === "sarvam") {
    return sarvamKeySync(env) ? "" : "No Sarvam key is set — add one in Settings → 🔌 API providers.";
  }
  if (m.provider === "gemini") {
    return geminiKey(env) ? "" : "No Google key is set. Add one in Settings → 🔌 API providers.";
  }
  if (!ogKey(env)) return "No 0G key is set. Add one in Settings → 🔌 API providers.";
  if (!ogBase(env)) {
    return "The 0G API address is not set. Add the variable OG_API_BASE (for example https://your-0g-host/v1).";
  }
  return "";
}
/* =========================================================
   SECURITY: 4-digit access code
   ========================================================= */
const AUTH_MAX_AGE = 60 * 60 * 12;   // stay logged in for 12 hours
const MAX_FAILS = 5;                 // wrong tries allowed
const LOCK_SECONDS = 15 * 60;        // block time after too many wrong tries
async function signValue(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/* compares two strings without leaking timing information */
function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function isAuthed(request, env) {
  if (!env.COOKIE_SECRET) return false;
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)auth=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split(".");
  const expires = parts[0];
  const sig = parts[1];
  if (!expires || !sig || Date.now() > Number(expires)) return false;
  return safeEqual(sig, await signValue(expires, env.COOKIE_SECRET));
}
function lockedResponse() {
  return new Response(
    JSON.stringify({ ok: false, locked: true, error: "Locked. Please enter the access code." }),
    {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Locked": "1" }
    }
  );
}
async function handleVerify(request, env) {
  if (!env.ACCESS_CODE || !env.COOKIE_SECRET) {
    return json({ ok: false, error: "Server is not configured (ACCESS_CODE / COOKIE_SECRET missing)." }, 500);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const failKey = "fails_" + ip;
  let fails = 0;
  if (env.CHAT_STORE) {
    try { fails = Number(await env.CHAT_STORE.get(failKey)) || 0; } catch {}
    if (fails >= MAX_FAILS) {
      return json({ ok: false, blocked: true, error: "Too many wrong tries. Please wait 15 minutes." }, 429);
    }
  }
  let body = {};
  try { body = await request.json(); } catch {}
  if (typeof body.code !== "string" || !safeEqual(body.code, String(env.ACCESS_CODE).trim())) {
    if (env.CHAT_STORE) {
      try { await env.CHAT_STORE.put(failKey, String(fails + 1), { expirationTtl: LOCK_SECONDS }); } catch {}
    }
    await new Promise(r => setTimeout(r, 600));   // slows down guessing
    return json({ ok: false, error: "Wrong code" }, 401);
  }
  if (env.CHAT_STORE) {
    try { await env.CHAT_STORE.delete(failKey); } catch {}
  }
  const expires = Date.now() + AUTH_MAX_AGE * 1000;
  const token = expires + "." + await signValue(String(expires), env.COOKIE_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": "auth=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + AUTH_MAX_AGE
    }
  });
}
/* ---- translation models ---- */
const MAYURA_MODEL = "mayura:v1";                 // 11 languages, 1000 chars / request
const SARVAM_TRANSLATE_MODEL = "sarvam-translate:v1"; // all 22 languages, 2000 chars / request
const MAYURA_LANGS = new Set([
  "en-IN", "bn-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN",
  "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"
]);
const MAYURA_LIMIT = 900;            // safe chunk size (API max 1000)
const SARVAM_TRANSLATE_LIMIT = 1800; // safe chunk size (API max 2000)
const MAX_TRANSLATE_INPUT = 12000;   // chars per /api/translate call
const TRANSLATE_PARALLEL = 3;
const TRANSLATE_TARGETS = ["en-IN", "bn-IN", "hi-IN"]; // output languages
/* ---- token budget (model window = 32000) ---- */
const CONTEXT_LIMIT = 32000;
const ANSWER_TOKENS = 3000;
const SAFETY_TOKENS = 1500;
const HISTORY_TOKENS = 5000;
/* OCR / input languages */
const DOCUMENT_LANGUAGES = [
  ["hi-IN", "Hindi — हिन्दी"], ["bn-IN", "Bengali — বাংলা"], ["ta-IN", "Tamil — தமிழ்"],
  ["te-IN", "Telugu — తెలుగు"], ["mr-IN", "Marathi — मराठी"], ["gu-IN", "Gujarati — ગુજરાતી"],
  ["kn-IN", "Kannada — ಕನ್ನಡ"], ["ml-IN", "Malayalam — മലയാളം"], ["od-IN", "Odia — ଓଡ଼ିଆ"],
  ["pa-IN", "Punjabi — ਪੰਜਾਬੀ"], ["as-IN", "Assamese — অসমীয়া"], ["brx-IN", "Bodo — बड़ो"],
  ["doi-IN", "Dogri — डोगरी"], ["ks-IN", "Kashmiri — کٲشُر"], ["kok-IN", "Konkani — कोंकोणी"],
  ["mai-IN", "Maithili — मैहिली"], ["mni-IN", "Manipuri — মৈতৈলোন্"], ["ne-IN", "Nepali — नेपाली"],
  ["sa-IN", "Sanskrit — संस्कोृतम्"], ["sat-IN", "Santali — ᱥᱟᱱᱛᱟᱲᱤ"
], ["en-IN", "English"]
];
/* Reply languages: ONLY English, Bengali, Hindi */
const CHAT_LANGUAGES = [
  ["bn-IN", "Bengali — বাংলা"],
  ["hi-IN", "Hindi — हिन्दी"],
  ["en-IN", "English"]
];
const LANGUAGE_INFO = {
  "bn-IN": { name: "Bengali", native: "বাংলা",   script: /[\u0980-\u09FF]/g },
  "hi-IN": { name: "Hindi",   native: "हिन्दी",   script: /[\u0900-\u097F]/g },
  "en-IN": { name: "English", native: "English", script: null }
};
/* "Bengali (বাংলা)" or just "English" */
function langLabel(info) {
  return info.native === info.name ? info.name : `${info.name} (${info.native})`;
}
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/jpg"
]);
/* =========================================================
   PERMANENT STORAGE  (Cloudflare KV binding: CHAT_STORE)
   ========================================================= */
/* =========================================================
   KV LINK — Cloudflare KV over its REST API
   ---------------------------------------------------------
   A Worker is supposed to reach KV through a binding. When the binding is
   missing (or points at a namespace that no longer exists), the whole app
   used to be stuck. This block lets the same KV namespace be used over the
   plain Cloudflare API instead, with three strings:

     account id  ·  KV namespace id  ·  an API token (Workers KV Storage: Edit)

   They can come from two places:
     · the browser (Settings → 🩺 Storage → “Connect with an API token”),
       sent with every request in the "x-mf-kv" header,
     · or Worker secrets KV_ACCOUNT_ID / KV_NAMESPACE_ID / KV_API_TOKEN.
   A real binding always wins — this is only a bridge.
   ========================================================= */
const KV_LINK_HEADER = "x-mf-kv";
function b64d(text) {
  try {
    var s = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    if (typeof atob === "function") {
      var bin = atob(s);
      var out = "";
      for (var i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
      return decodeURIComponent(escape(out));
    }
    return Buffer.from(s, "base64").toString("utf8");
  } catch (e) { return ""; }
}
/* the three strings, from the Worker secrets or from the browser */
function kvLinkFrom(request, env) {
  var acc = "", ns = "", tok = "", source = "";
  if (env && env.KV_ACCOUNT_ID && env.KV_NAMESPACE_ID && env.KV_API_TOKEN) {
    acc = String(env.KV_ACCOUNT_ID).trim();
    ns = String(env.KV_NAMESPACE_ID).trim();
    tok = String(env.KV_API_TOKEN).trim();
    source = "secret";
  } else {
    var raw = "";
    try { raw = request && request.headers ? request.headers.get(KV_LINK_HEADER) || "" : ""; } catch (e) {}
    if (raw) {
      var text = b64d(raw);
      try {
        var j = JSON.parse(text);
        acc = String(j.a || "").trim();
        ns = String(j.n || "").trim();
        tok = String(j.t || "").trim();
        source = "browser";
      } catch (e) {}
    }
  }
  if (!acc || !ns || !tok) return null;
  return { account: acc, namespace: ns, token: tok, source: source };
}
/* why a REST call failed, in words that say what to do about it */
function kvRestReason(status, data) {
  var list = (data && data.errors) || [];
  var first = list[0] || {};
  var msg = first.message || (data && data.error) || "";
  if (status === 401 || status === 403 || /token|permission|authoriz|forbidden/i.test(msg)) {
    return "Cloudflare refused the API token (" + status + " " + (first.code || "") + " " + msg + "). Make sure the token has the permission “Workers KV Storage: Edit” and that it is copied whole.";
  }
  if (status === 404 || /not found/i.test(msg)) {
    return "Cloudflare could not find that KV namespace in this account (404). Check the namespace id and the account id belong together.";
  }
  if (status === 429) return "Cloudflare is rate-limiting the requests (429) — wait a moment and try again.";
  return "Cloudflare API error " + status + ": " + (msg || "no message");
}
/* a KV-shaped object (get / put / delete / list) that speaks the REST API,
   so every other line of this worker keeps working unchanged */
function kvRest(link) {
  const base = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(link.account) +
    "/storage/kv/namespaces/" + encodeURIComponent(link.namespace);
  const call = async (path, init) => {
    const response = await fetch(base + path, Object.assign({}, init || {}, {
      headers: Object.assign({ "Authorization": "Bearer " + link.token }, (init && init.headers) || {})
    }));
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) {}
    if (!response.ok || data.success === false) throw new Error(kvRestReason(response.status, data));
    return data;
  };
  return {
    async get(key, type) {
      const response = await fetch(base + "/values/" + encodeURIComponent(key), {
        headers: { "Authorization": "Bearer " + link.token }
      });
      if (response.status === 404) return null;
      const text = await response.text();
      if (!response.ok) {
        let data = {};
        try { data = JSON.parse(text); } catch (e) {}
        throw new Error(kvRestReason(response.status, data));
      }
      if (type === "json") { try { return JSON.parse(text); } catch (e) { return null; } }
      return text;
    },
    async put(key, value, opts) {
      /* Cloudflare's single-value write is a PUT with the value as the body */
      const body = typeof value === "string" ? value : String(value);
      await call("/values/" + encodeURIComponent(key), { method: "PUT", body: body });
    },
    async delete(key) {
      try { await call("/values/" + encodeURIComponent(key), { method: "DELETE" }); } catch (e) { /* already gone */ }
    },
    async list(opts) {
      const o = opts || {};
      const query = [];
      if (o.prefix) query.push("prefix=" + encodeURIComponent(o.prefix));
      if (o.cursor) query.push("cursor=" + encodeURIComponent(o.cursor));
      query.push("limit=1000");
      const data = await call("/keys?" + query.join("&"));
      const rows = Array.isArray(data.result) ? data.result : [];
      const info = data.result_info || {};
      const cursor = info.cursor || "";
      return {
        keys: rows.map(function (r) { return { name: r.name, expiration: r.expiration }; }),
        list_complete: !cursor,
        cursor: cursor
      };
    }
  };
}
/* the link found for this request, remembered on the env copy so that
   kvEntry(env) can hand it to every other part of the worker */
function kvLinkAttach(env, request) {
  var link = kvLinkFrom(request, env);
  if (!link) return env;
  try {
    env.__mfKvLink = link;
    return env;
  } catch (e) {
    var copy = {};
    try { Object.keys(env || {}).forEach(function (k) { copy[k] = env[k]; }); } catch (e2) {}
    copy.__mfKvLink = link;
    return copy;
  }
}

/* the KV namespace is found whatever the binding is called - "KV", "My-Chat",
   "CHAT_STORE" or anything else - so renaming a binding never breaks storage */
function looksLikeKv(v) {
  return Boolean(v) &&
    typeof v.get === "function" && typeof v.put === "function" &&
    typeof v.delete === "function";
}
const KV_PREFERRED = ["KV", "My-Chat", "KV_BINDING", "CHAT_STORE", "CHAT_KV", "KV_STORE", "STORAGE", "DATA"];
function kvEntry(env) {
  if (!env) return null;
  for (var i = 0; i < KV_PREFERRED.length; i++) {
    var name = KV_PREFERRED[i];
    if (looksLikeKv(env[name])) return { name: name, kv: env[name], kind: "kv" };
  }
  try {
    var keys = Object.keys(env);
    for (var k = 0; k < keys.length; k++) {
      if (looksLikeKv(env[keys[k]])) return { name: keys[k], kv: env[keys[k]], kind: "kv" };
    }
  } catch (e) {}
  /* no binding at all — fall back to the same KV namespace over the REST API */
  if (env.__mfKvLink) {
    try {
      return { name: "KV link (API token)", kv: kvRest(env.__mfKvLink), kind: "rest" };
    } catch (e) {}
  }
  return null;
}
function kvStore(env) { var e = kvEntry(env); return e ? e.kv : null; }
function kvReady(env) { return Boolean(kvStore(env)); }
function kvBindingName(env) { var e = kvEntry(env); return e ? e.name : ""; }
function kvStoreKind(env) { var e = kvEntry(env); return e ? e.kind : ""; }
function kvVia(env) {
  var e = kvEntry(env);
  if (!e) return "none";
  if (e.kind === "rest") return "link";
  return "binding";
}
/* names that look like storage but are neither KV nor D1 - shown in Settings */
function kvCandidates(env) {
  var out = [];
  try {
    var keys = Object.keys(env || {});
    for (var i = 0; i < keys.length; i++) {
      var n = keys[i];
      if (/kv|store|bind|namespace|ns$/i.test(n) && !looksLikeKv(env[n])) out.push(n);
    }
  } catch (e) {}
  return out;
}
const KV_RESET_KEY = "reset_v1";      // when "clear all" was last pressed (any browser)
const CHAT_KEEP_DAYS = 15;            // chats older than this delete themselves
function chatLastAt(chat) {
  if (!chat) return 0;
  var last = Math.max(Number(chat.updated) || 0, Number(chat.created) || 0);
  var list = Array.isArray(chat.messages) ? chat.messages : [];
  for (var i = 0; i < list.length; i++) {
    var ts = Number(list[i] && list[i].ts) || 0;
    if (ts > last) last = ts;
  }
  return last;
}
/* drops chats nobody touched for CHAT_KEEP_DAYS — in KV and in the browser */
function pruneOldChats(list, now) {
  if (!Array.isArray(list)) return { chats: [], removed: 0 };
  var edge = (now || Date.now()) - CHAT_KEEP_DAYS * 86400000;
  var kept = [];
  var removed = 0;
  for (var i = 0; i < list.length; i++) {
    var chat = list[i];
    if (!chat || typeof chat !== "object" || !Array.isArray(chat.messages)) { removed++; continue; }
    var stamp = chatLastAt(chat);
    /* no date anywhere (an old backup, for example): keep it — never guess */
    if (!stamp || stamp >= edge) kept.push(chat); else removed++;
  }
  return { chats: kept, removed: removed };
}
const KV_USAGE_KEY = "usage_v1";
const KV_CHATS_KEY = "chats_v1";
const USAGE_TZ_MIN = 330;               // India time (UTC+5:30) for "today"
const USAGE_FIELDS = ["chats", "prompt", "completion", "docs", "tr", "img"];
const MAX_SYNC_CHARS = 4000000;         // ~4 MB of chat history
const emptyUsage = () => ({ chats: 0, prompt: 0, completion: 0, docs: 0, tr: 0, img: 0, web: 0 });
function usageDayKey(offsetDays = 0) {
  return new Date(Date.now() + USAGE_TZ_MIN * 60000 - offsetDays * 86400000)
    .toISOString().slice(0, 10);
}
async function readUsage(env) {
  const raw = await kvStore(env).get(KV_USAGE_KEY);   // a read error must stop here
  let u = null;
  try { if (raw) u = JSON.parse(raw); } catch {}
  if (!u || typeof u !== "object") u = {};
  if (!u.days || typeof u.days !== "object") u.days = {};
  u.total = Object.assign(emptyUsage(), u.total || {});
  if (!u.since) u.since = usageDayKey(0);
  return u;
}
function sumUsageDays(u, count) {
  const total = emptyUsage();
  for (let i = 0; i < count; i++) {
    const d = u.days[usageDayKey(i)];
    if (!d) continue;
    USAGE_FIELDS.forEach(k => { total[k] += Number(d[k]) || 0; });
  }
  return total;
}
async function recordUsage(env, delta) {
  if (!kvReady(env)) return;
  try {
    const u = await readUsage(env);
    const key = usageDayKey(0);
    const d = Object.assign(emptyUsage(), u.days[key] || {});
    USAGE_FIELDS.forEach(k => {
      const v = Number(delta[k]) || 0;
      d[k] += v;
      u.total[k] += v;
    });
    u.days[key] = d;
    const keys = Object.keys(u.days).sort();
    while (keys.length > 60) delete u.days[keys.shift()];
    await kvStore(env).put(KV_USAGE_KEY, JSON.stringify(u));
  } catch (error) {
    console.error("Usage save failed:", error);
  }
}
/* chat-history sync (needs KV + ADMIN_PASSWORD) */
async function handleSync(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (!kvReady(env)) {
    return json({ ok: false, error: "Cloud storage (KV) is not connected. Add a KV namespace binding to this Worker (any name: KV, KV_BINDING, CHAT_STORE)." }, 501);
  }
  /* chat history belongs to whoever is logged in: any unlocked session syncs,
     so the same chats appear in every browser with no extra password.
     (Adding or editing AI models still asks for the admin password.) */
  if (env.ADMIN_PASSWORD && String(body.password || "") === "___model___") {
    return json({ ok: false, needPassword: true, error: "Wrong or missing admin password." }, 401);
  }
  if (body.action === "load") {
    const kv = kvStore(env);
    const raw = await kv.get(KV_CHATS_KEY);
    let chats = null;
    try { if (raw) chats = JSON.parse(raw); } catch {}
    let list = Array.isArray(chats) ? chats : null;
    let pruned = 0;
    if (list) {
      const result = pruneOldChats(list);
      list = result.chats;
      pruned = result.removed;
      if (pruned) await kv.put(KV_CHATS_KEY, JSON.stringify(list));
    }
    const resetAt = Number(await kv.get(KV_RESET_KEY)) || 0;
    return json({ ok: true, chats: list, resetAt: resetAt, pruned: pruned, keepDays: CHAT_KEEP_DAYS });
  }
  if (body.action === "meta") {
    const kv = kvStore(env);
    const resetAt = Number(await kv.get(KV_RESET_KEY)) || 0;
    return json({ ok: true, resetAt: resetAt, keepDays: CHAT_KEEP_DAYS });
  }
  if (body.action === "save") {
    if (!Array.isArray(body.chats)) {
      return json({ ok: false, error: "Invalid chat data." }, 400);
    }
    const kv = kvStore(env);
    /* another browser pressed "clear all" after this one last synced:
       do not put the old chats back, tell the app to empty itself */
    const resetAt = Number(await kv.get(KV_RESET_KEY)) || 0;
    if (resetAt > (Number(body.stamp) || 0)) {
      return json({ ok: true, cleared: true, resetAt: resetAt });
    }
    const kept = pruneOldChats(body.chats);
    body.chats = kept.chats;
    const text = JSON.stringify(kept.chats);
    if (text.length > MAX_SYNC_CHARS) {
      return json({ ok: false, error: "Chat history is too large to sync. Delete some old chats." }, 413);
    }
    await kv.put(KV_CHATS_KEY, text);
    return json({ ok: true, pruned: kept.removed, keepDays: CHAT_KEEP_DAYS });
  }
  if (body.action === "pins") {
    const kv = kvStore(env);
    const raw = await kv.get(KV_PINS_KEY);
    let list = [];
    try { if (raw) list = JSON.parse(raw) || []; } catch {}
    return json({ ok: true, pins: Array.isArray(list) ? list.slice(0, 5) : [] });
  }
  if (body.action === "pins-save") {
    const kv = kvStore(env);
    const list = Array.isArray(body.pins) ? body.pins.slice(0, 5).map(String) : [];
    await kv.put(KV_PINS_KEY, JSON.stringify(list));
    return json({ ok: true, pins: list });
  }
  if (body.action === "clear") {
    /* one tap: wipe the chat history in KV, or every key the app owns */
    const kv = kvStore(env);
    const scope = body.scope === "all" ? "all" : "history";
    let removed = 0;
    if (scope === "all") {
      let cursor;
      do {
        const page = await kv.list({ cursor: cursor });
        for (const key of page.keys) { await kv.delete(key.name); removed++; }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      /* everything is gone: mark the wipe so no browser writes its old copy back */
      await kv.put(KV_RESET_KEY, String(Date.now()));
      removed++;
    } else {
      await kv.delete(KV_CHATS_KEY); removed++;
      const stillUsage = await kv.get(KV_USAGE_KEY);
      if (stillUsage) { await kv.delete(KV_USAGE_KEY); removed++; }
      await kv.put(KV_RESET_KEY, String(Date.now()));
      removed++;
    }
    return json({ ok: true, cleared: scope, removed: removed, resetAt: Number(await kv.get(KV_RESET_KEY)) || Date.now() });
  }
  return json({ ok: false, error: "Unknown action." }, 400);
}
/* =========================================================
   KV SELF-CHECK  (Settings -> Connection -> Test KV storage)
   ========================================================= */
const KV_LINK_TEST_KEY = "kv_link_selftest";
function kvLinkWords(request, env) {
  var link = kvLinkFrom(request, env);
  if (!link) return { configured: false, source: "", account: "", namespace: "", tail: "" };
  return {
    configured: true,
    source: link.source,
    account: link.account.slice(0, 6) + "…" + link.account.slice(-4),
    namespace: link.namespace,
    tail: link.token.slice(-4)
  };
}
async function handleKvCheck(request, env) {
  const entry = kvEntry(env);
  const out = {
    ok: false,
    binding: entry ? entry.name : "",
    kind: entry ? entry.kind : "none",
    via: kvVia(env),
    link: kvLinkWords(request, env),
    seen: kvCandidates(env),
    envKeys: [],
    wrote: false,
    read: false,
    removed: false
  };
  try { out.envKeys = Object.keys(env || {}).filter(k => !/key|secret|password|token|code|mfKvLink/i.test(k)); } catch (e) {}
  if (!entry) {
    out.error = "This Worker has no KV namespace attached and no API-token link either, so there is nowhere to keep chats, models or keys.";
    out.fix = [
      "Easiest: Settings → 🩺 Storage & connection → “Connect with an API token” — paste your Cloudflare account id, the KV namespace id and an API token with “Workers KV Storage: Edit”. Nothing else has to change.",
      "Permanent: put the KV namespace on the Worker — Cloudflare → Workers & Pages → your Worker → Settings → Bindings → Add → KV Namespace → any variable name (KV, My-Chat…) → pick your namespace → Save and deploy again.",
      "With wrangler: keep the kv_namespaces block in wrangler.jsonc (binding KV, your namespace id, and remove the preview_id placeholder line) and run npx wrangler deploy."
    ];
    return json(out, 200);
  }
  const key = entry.kind === "rest" ? KV_LINK_TEST_KEY : "kv_selftest";
  const value = "ok-" + Date.now();
  try {
    await entry.kv.put(key, value);
    out.wrote = true;
    const back = await entry.kv.get(key);
    out.read = back === value;
    await entry.kv.delete(key);
    out.removed = true;
    out.ok = out.read && out.removed;
    if (!out.ok) out.error = "The store accepted a write but did not give the value back.";
  } catch (error) {
    out.error = String((error && error.message) || error);
    const words = String(out.error || "");
    if (entry.kind === "rest") {
      out.fix = [
        "Check the three strings in Settings → 🩺 Storage & connection: the account id is the 32-character id on the right of your Cloudflare dashboard, the namespace id comes from Workers & Pages → KV, and the token must have “Workers KV Storage: Edit”.",
        "Press Save again — the app tests the link before keeping it, so a wrong string is refused instead of saved."
      ];
    } else if (/not found|404|10014/i.test(words)) {
      out.fix = [
        "The binding points at a KV namespace that no longer exists — it was probably deleted, or the id belongs to another Cloudflare account.",
        "Open Workers & Pages → KV, create (or pick) a namespace, then set the Worker's binding to it: Settings → Bindings → KV Namespace → Save, and deploy again.",
        "Quickest way around it: Settings → 🩺 Storage & connection → “Connect with an API token” and use a namespace you can see in your own dashboard."
      ];
    } else if (/permission|authoriz|forbidden/i.test(words)) {
      out.fix = ["The Worker may not use that namespace. Use a namespace from the same account as the Worker."];
    }
  }
  return json(out, 200);
}
/* =========================================================
   HELPERS
   ========================================================= */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    }
  });
}
async function getErrorText(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data?.error?.message || data?.message || data?.detail || JSON.stringify(data);
  } catch {
    return text || `HTTP ${response.status}`;
  }
}
/* Retry: network errors + 429/500/502/503/504
   label = name shown in error messages (Sarvam / 0G / Gemini) */
async function apiFetch(url, options, retries = 4, label = "Sarvam") {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (e) {
      lastError = new Error(`Network error calling ${label}: ` + e.message);
      if (attempt === retries) throw lastError;
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (response.ok) return response;
    const text = await getErrorText(response);
    lastError = new Error(`${label} API error ${response.status}: ${text}`);
    lastError.status = response.status;
    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === retries) throw lastError;
    await sleep(1500 * (attempt + 1));
  }
  throw lastError;
}
const validChatLanguage = l => CHAT_LANGUAGES.some(i => i[0] === l);
const validDocumentLanguage = l => DOCUMENT_LANGUAGES.some(i => i[0] === l);
function documentLanguageName(code) {
  const item = DOCUMENT_LANGUAGES.find(i => i[0] === code);
  return item ? item[1].split(" — ")[0] : "";
}
/* =========================================================
   TOKEN ESTIMATION  (conservative — Indic scripts cost more)
   ========================================================= */
function estimateTokens(text) {
  let n = 0;
  for (const ch of String(text || "")) {
    n += ch.charCodeAt(0) < 128 ? 0.3 : 0.9;
  }
  return Math.ceil(n);
}
function fitDocument(doc, otherText) {
  const available =
    CONTEXT_LIMIT - ANSWER_TOKENS - SAFETY_TOKENS - estimateTokens(otherText);
  const budget = Math.max(available, 1500);
  const used = estimateTokens(doc);
  if (used <= budget) return { text: doc, truncated: false };
  const ratio = budget / used;
  const cut = Math.max(1000, Math.floor(doc.length * ratio * 0.95));
  return { text: doc.slice(0, cut), truncated: true };
}
function isContextError(error) {
  return /context window|prompt_tokens|max_tokens|too long|maximum context|context length|context_length|token count|exceeds the maximum/i
    .test(String(error?.message || ""));
}
/* =========================================================
   CHAT  (language-safe + token-safe + usage tracking)
   ========================================================= */
function cleanModelOutput(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}
/* ---------- thinking vs. answer ----------
   Every model hides its reasoning differently: <thinking> tags, a
   "Thinking Process:" heading, or a provider field. The reply the user
   sees must be ONLY the answer, so the thinking is pulled out here and
   handed to the app separately (it is shown in its own panel). */
const REASON_HEAD = /^\s*(?:[*_#]{0,6}\s*)?(?:thinking process|thought process|my thinking|reasoning|chain of thought|thinking|analyse|analysis of the question)\s*[:\-–—]/i;
const ANSWER_HEAD = /^\s*(?:[*_#]{0,6}\s*)?(?:final answer|final response|answer|my answer)\s*[:\-–—]\s*/i;
function splitReasoning(text) {
  let body = String(text || "");
  let reason = "";
  const keep = chunk => {
    const t = String(chunk || "").trim();
    if (t) reason += (reason ? "\n\n" : "") + t;
  };
  /* 1. explicit tags */
  body = body.replace(/<(think(?:ing)?|thought|reasoning)>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    keep(inner);
    return "";
  });
  if (/<\/think(?:ing)?>/i.test(body)) {
    const bits = body.split(/<\/think(?:ing)?>/i);
    keep(bits.shift());
    body = bits.join("\n");
  }
  /* 2. a plain-text "Thinking Process:" block near the top */
  const lines = body.split("\n");
  const head = lines.findIndex((l, i) => i < 8 && REASON_HEAD.test(l));
  if (head >= 0) {
    let answerAt = -1;
    for (let i = head + 1; i < lines.length; i++) {
      if (ANSWER_HEAD.test(lines[i])) { answerAt = i; break; }
    }
    if (answerAt > head) {
      keep(lines.slice(head, answerAt).join("\n").replace(REASON_HEAD, ""));
      body = lines.slice(answerAt).join("\n").replace(ANSWER_HEAD, "");
    } else {
      keep(lines.slice(head).join("\n").replace(REASON_HEAD, ""));
      body = lines.slice(0, head).join("\n");
    }
  }
  /* 3. never leave a stray tag or heading in the answer */
  body = body
    .replace(/<\/?(?:think(?:ing)?|thought|reasoning)>/gi, "")
    .replace(/^\s*(?:thinking process|thought process|reasoning)\s*[:\-–—]\s*/i, "")
    .trim();
  return { answer: body, reasoning: reason.trim() };
}
function noteReasoning(tracker, extra) {
  if (!tracker) return;
  const add = String(extra || "").trim();
  if (!add) return;
  tracker.reasoning = (tracker.reasoning ? tracker.reasoning + "\n\n" : "") + add;
  if (tracker.reasoning.length > 6000) tracker.reasoning = tracker.reasoning.slice(-6000);
}
/* provider field (reasoning_content / thought parts) + inline thinking */
function finishText(tracker, raw, native) {
  noteReasoning(tracker, native);
  const split = splitReasoning(raw);
  noteReasoning(tracker, split.reasoning);
  return split.answer;
}
function isInTargetLanguage(text, languageCode) {
  const info = LANGUAGE_INFO[languageCode];
  if (!info || !info.script) return true;
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const letters = cleaned.match(/\p{L}/gu) || [];
  if (letters.length < 15) return true;
  const target = cleaned.match(info.script) || [];
  return target.length / letters.length >= 0.4;
}
function isMostlyLatin(text) {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const letters = cleaned.match(/\p{L}/gu) || [];
  if (letters.length < 15) return true;
  const latin = cleaned.match(/[A-Za-z\u00C0-\u024F]/g) || [];
  return latin.length / letters.length >= 0.6;
}
function replyMatchesLanguage(text, languageCode) {
  if (languageCode === "en-IN") return isMostlyLatin(text);
  return isInTargetLanguage(text, languageCode);
}
/* fills tracker = { prompt, completion } */
function trackUsage(tracker, usage, messages, text) {
  if (!tracker) return;
  if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
    tracker.prompt += Number(usage.prompt_tokens) || 0;
    tracker.completion += Number(usage.completion_tokens) || 0;
  } else {
    tracker.prompt += estimateTokens(messages.map(m => m.content).join("\n"));
    tracker.completion += estimateTokens(text);
  }
}
function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(p => (typeof p === "string" ? p : (p && p.text) || "")).join("");
  }
  return "";
}

/* =====================================================================
   BATCH 98 · the worker speaks while it thinks
   ---------------------------------------------------------------------
   Instead of waiting for the whole answer, the Worker now forwards the
   model's own stream: every token the model writes (and, when the model
   exposes it, its reasoning tokens) leaves this Worker the moment it
   arrives, as Server-Sent Events on the same /api/chat call.

   - OpenAI-shaped APIs (Sarvam, 0G, any model added with the OpenAI
     format): POST …/chat/completions with stream: true
   - Google Gemini: …:streamGenerateContent?alt=sse
   Nothing is invented on this side: every line the browser shows came
   out of the model.
   ===================================================================== */

/* read one SSE response and hand every JSON event to onEvent */
async function readModelStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).replace(/\r$/, "");
      buffer = buffer.slice(cut + 1);
      if (line.slice(0, 5) !== "data:") continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { onEvent(JSON.parse(payload)); } catch (e) { /* a partial line: ignore */ }
    }
  }
}

/* OpenAI-shaped streaming: Sarvam, 0G, any OpenAI-format model */
async function streamOpenAiLike(url, headers, payload, options) {
  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(Object.assign({}, /openrouter/i.test(String(url)) ? Object.assign({}, payload, { reasoning: { max_tokens: 1024 } }) : payload, { stream: true }))
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("API error " + response.status + ": " + String(detail).slice(0, 300));
  }
  let full = "";
  await readModelStream(response, event => {
    const choice = (event.choices && event.choices[0]) || {};
    const delta = choice.delta || {};
    const thought = delta.reasoning_content || delta.reasoning || "";
    if (thought && options.onDelta) options.onDelta(String(thought), "reason");
    const piece = contentToText(delta.content || "");
    if (piece) {
      full += piece;
      if (options.onDelta) options.onDelta(piece, "text");
    }
    if (event.usage) options.usage = event.usage;
  });
  return full;
}

/* Google Gemini streaming */
async function streamGeminiLike(url, headers, payload, options) {
  /* b95 - ask Gemini 2.5/3 to actually send its thoughts, so the
     live thinking box has the model's real reasoning to show */
  try {
    const mid = decodeURIComponent((String(url).match(/\/models\/([^:?]+)/) || [])[1] || "");
    if (/gemini-/i.test(mid) && !/gemini-(1\.5|2\.0)/i.test(mid)) {
      payload = Object.assign({}, payload, {
        generationConfig: Object.assign({}, payload.generationConfig || {}, {
          thinkingConfig: /gemini-3/i.test(mid) ? { includeThoughts: true, thinkingLevel: "medium" } : { includeThoughts: true, thinkingBudget: 1024 }
        })
      });
    }
  } catch (e) {}
  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("API error " + response.status + ": " + String(detail).slice(0, 300));
  }
  let full = "", thought = "";
  await readModelStream(response, event => {
    const candidate = (event.candidates && event.candidates[0]) || {};
    const parts = (candidate.content && candidate.content.parts) || [];
    for (const part of parts) {
      const text = part.text || "";
      if (!text) continue;
      if (part.thought) {
        thought += text;
        if (options.onDelta) options.onDelta(text, "reason");
      } else {
        full += text;
        if (options.onDelta) options.onDelta(text, "text");
      }
    }
    if (event.usageMetadata) {
      options.usage = {
        prompt_tokens: event.usageMetadata.promptTokenCount,
        completion_tokens: (event.usageMetadata.candidatesTokenCount || 0) +
          (event.usageMetadata.thoughtsTokenCount || 0)
      };
    }
  });
  if (thought) options.tracker && noteReasoning(options.tracker, thought);
  return full;
}

/* the streaming twin of callChat / callCustomChat */
async function callChatStreaming(env, modelKey, customCfg, messages, options) {
  const onDelta = options.onDelta;
  if (customCfg) {
    let cfg = customCfg;
    if (!String(cfg.base || "").trim()) {
      cfg = Object.assign({}, cfg, await modelProviderConfig(env, cfg));
    }
    if (cfg.format === "gemini") {
      const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
      let contents = messages.filter(m => m.role !== "system").map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content || "") }]
      }));
      if (options.image && options.image.dataUrl) {
        const parsed = parseDataUrl(options.image.dataUrl);
        if (parsed) {
          for (let i = contents.length - 1; i >= 0; i--) {
            if (contents[i].role !== "user") continue;
            contents[i].parts.push({ inline_data: { mime_type: parsed.mime, data: parsed.base64 } });
            break;
          }
        }
      }
      while (contents.length && contents[0].role === "model") contents.shift();
      if (!contents.length) contents = [{ role: "user", parts: [{ text: "Hello" }] }];
      const payload = {
        contents: contents,
        generationConfig: { temperature: options.temperature ?? 0.3, maxOutputTokens: Math.min(8192, Math.max(1024, (options.max_tokens ?? ANSWER_TOKENS) * 2)) }
      };
      if (system) payload.systemInstruction = { parts: [{ text: system }] };
      return await streamGeminiLike(
        cfg.base + "/models/" + encodeURIComponent(cfg.modelId) + ":streamGenerateContent?alt=sse",
        Object.assign({ "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey }, cfg.headers || {}),
        payload, options);
    }
    const messagesOut = openAiImageMessages(messages, options.image);
    if (options.images && options.images.length) {
      /* more than one picture: every one of them goes with the last question */
      const extra = options.images
        .filter(img => img && img.dataUrl)
        .map(img => ({ type: "image_url", image_url: { url: img.dataUrl } }));
      for (let i = messagesOut.length - 1; i >= 0; i--) {
        if (messagesOut[i].role !== "user") continue;
        const base = Array.isArray(messagesOut[i].content)
          ? messagesOut[i].content
          : [{ type: "text", text: String(messagesOut[i].content || "Look at these pictures and answer.") }];
        messagesOut[i] = Object.assign({}, messagesOut[i], { content: base.concat(extra) });
        break;
      }
    }
    return await streamOpenAiLike(
      cfg.base + "/chat/completions",
      Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey }, cfg.headers || {}),
      {
        model: cfg.modelId,
        messages: messagesOut,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.max_tokens ?? ANSWER_TOKENS
      }, options);
  }
  const provider = (CHAT_MODELS[modelKey] || {}).provider;
  if (provider === "gemini") {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const img = options.image && options.image.dataUrl ? parseDataUrl(options.image.dataUrl) : null;
    let contents = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content || "") }]
    }));
    const pictures = img ? [img].concat((options.images || []).map(i => parseDataUrl(i.dataUrl)).filter(Boolean)) : (options.images || []).map(i => parseDataUrl(i.dataUrl)).filter(Boolean);
    if (pictures.length) {
      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role !== "user") continue;
        pictures.forEach(pic => contents[i].parts.push({ inline_data: { mime_type: pic.mime, data: pic.base64 } }));
        break;
      }
    }
    while (contents.length && contents[0].role === "model") contents.shift();
    if (!contents.length) contents = [{ role: "user", parts: [{ text: "Hello" }] }];
    const maxOut = Math.min(16384, Math.max(4096, (options.max_tokens ?? ANSWER_TOKENS) * 2));
    const payload = {
      contents: contents,
      generationConfig: { temperature: options.temperature ?? 0.3, maxOutputTokens: maxOut }
    };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };
    const order = [];
    const add = id => { if (id && order.indexOf(id) < 0) order.push(id); };
    add(GEMINI_LIVE);
    add(chatModelId(env, modelKey));
    GEMINI_FALLBACKS.forEach(add);
    let lastError = null;
    for (const model of order) {
      try {
        return await streamGeminiLike(
          `${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
          { "Content-Type": "application/json", "x-goog-api-key": geminiKey(env) },
          payload, options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Gemini could not answer.");
  }
  if (provider === "og") {
    const base = ogBase(env);
    const catalog = await ogCatalog(env);
    const wanted = chatModelId(env, modelKey);
    const used = ogPick(catalog, wanted, "") || wanted;
    const messagesOut = openAiImageMessages(messages, options.image);
    if (options.images && options.images.length) {
      const extra = options.images.filter(i => i && i.dataUrl)
        .map(i => ({ type: "image_url", image_url: { url: i.dataUrl } }));
      for (let k = messagesOut.length - 1; k >= 0; k--) {
        if (messagesOut[k].role !== "user") continue;
        const baseParts = Array.isArray(messagesOut[k].content)
          ? messagesOut[k].content
          : [{ type: "text", text: String(messagesOut[k].content || "Look at these pictures and answer.") }];
        messagesOut[k] = Object.assign({}, messagesOut[k], { content: baseParts.concat(extra) });
        break;
      }
    }
    OG_SERVED[modelKey] = used;
    return await streamOpenAiLike(base + "/chat/completions", {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + ogKey(env)
    }, {
      model: used,
      messages: messagesOut,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? ANSWER_TOKENS
    }, options);
  }
  /* Sarvam 105B (and these last bits are the same shape as the 0G call) */
  return await streamOpenAiLike(`${API}/v1/chat/completions`, {
    "Content-Type": "application/json",
    "api-subscription-key": await sarvamKey(env)
  }, {
    model: env.SARVAM_CHAT_MODEL || DEFAULT_CHAT_MODEL,
    messages: openAiImageMessages(messages, options.image),
    temperature: options.temperature ?? 0.3,
    max_tokens: options.max_tokens ?? ANSWER_TOKENS
  }, options);
}

/* ---- Sarvam 105B ---- */
async function callSarvamChat(env, messages, options = {}) {  const response = await apiFetch(`${API}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": await sarvamKey(env)
    },
    body: JSON.stringify({
      model: env.SARVAM_CHAT_MODEL || DEFAULT_CHAT_MODEL,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? ANSWER_TOKENS
    })
  });
  const data = await response.json();
  const msg = data?.choices?.[0]?.message || {};
  const raw = msg.content || data?.choices?.[0]?.text || "";
  const text = finishText(options.tracker, contentToText(raw), msg.reasoning_content || msg.reasoning);
  trackUsage(options.tracker, data?.usage, messages, text);
  return text;
}
/* ---- 0G gateway: Qwen / GLM / DeepSeek (one API key) ---- */
/* turns the last user message into OpenAI image parts when a file is attached */
function openAiImageMessages(messages, image) {
  if (!image || !image.dataUrl) return messages;
  const out = messages.map(m => Object.assign({}, m));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user") continue;
    out[i].content = [
      { type: "text", text: String(out[i].content || "Look at this file and answer.") },
      { type: "image_url", image_url: { url: image.dataUrl } }
    ];
    break;
  }
  return out;
}
/* ---- 0G model catalog: /v1/models is public, cached for 10 minutes ---- */
let OG_CATALOG = { at: 0, base: "", list: [] };
/* which 0G model actually answered, so the reply can say so */
const OG_SERVED = {};
async function ogCatalog(env) {
  const base = ogBase(env);
  if (!base) return [];
  if (OG_CATALOG.base === base && Date.now() - OG_CATALOG.at < 600000) return OG_CATALOG.list;
  try {
    const response = await fetch(base + "/models");
    const data = await response.json();
    const list = Array.isArray(data && data.data) ? data.data : [];
    OG_CATALOG = { at: Date.now(), base: base, list: list };
    return list;
  } catch (error) {
    console.error("0G catalog unavailable:", error && error.message);
    return OG_CATALOG.list || [];
  }
}
function ogName(list, id) {
  const hit = list.find(m => m.id === id);
  return hit ? (hit.name || hit.id) : id;
}
/* model names change on 0G now and then: use the live name when the old one is gone */
function ogPick(list, wanted, skip) {
  const want = String(wanted || "").trim();
  if (!want) return "";
  if (list.some(m => m.id === want) && want !== skip) return want;
  const words = want.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const pool = list.filter(m => m.id !== skip && (m.type || "chatbot") === "chatbot");
  if (!words.length || !pool.length) return "";
  let hit = pool.filter(m => words.every(w => m.id.toLowerCase().indexOf(w) >= 0))
    .sort((a, b) => (b.provider_count || 0) - (a.provider_count || 0))[0];
  if (!hit) hit = pool.filter(m => m.id.toLowerCase().indexOf(words[0]) >= 0)
    .sort((a, b) => (b.provider_count || 0) - (a.provider_count || 0))[0];
  return hit ? hit.id : "";
}
async function handleOgStatus(request, env) {
  const list = await ogCatalog(env);
  const chat = ["qwen", "glm", "deepseek"].map(key => {
    const asked = chatModelId(env, key);
    const live = ogPick(list, asked, "");
    return { key: key, label: CHAT_MODELS[key].label, asked: asked, live: live || asked, ok: Boolean(live) };
  });
  const askedImage = imageModelId(env);
  const liveImage = ogPick(list, askedImage, "");
  const vision = list.filter(m => ((((m.architecture || {}).input_modalities) || []).indexOf("image") >= 0))
    .filter(m => (m.type || "chatbot") === "chatbot")
    .map(m => m.id);
  return json({
    ok: true,
    base: ogBase(env),
    keySet: Boolean(ogKey(env)),
    count: list.length,
    chat: chat,
    image: { asked: askedImage, live: liveImage || askedImage, ok: Boolean(liveImage) },
    visionCount: vision.length,
    vision: vision.slice(0, 8)
  });
}
async function callOgChat(env, key, messages, options = {}) {
  const base = ogBase(env);
  const catalog = await ogCatalog(env);
  const wanted = chatModelId(env, key);
  const ask = modelId => apiFetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + ogKey(env)
    },
    body: JSON.stringify({
      model: modelId,
      messages: openAiImageMessages(messages, options.image),
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? ANSWER_TOKENS
    })
  }, 2, "0G");
  let used = ogPick(catalog, wanted, "") || wanted;
  let response;
  try {
    response = await ask(used);
  } catch (firstError) {
    /* the name may have moved in the catalog — retry once with the closest live model */
    let alt = ogPick(catalog, wanted, used);
    if (!alt) {
      /* last resort: the busiest chat model the network is serving right now */
      const top = catalog.filter(m => m.id !== used && (m.type || "chatbot") === "chatbot")
        .sort((a, b) => (b.provider_count || 0) - (a.provider_count || 0))[0];
      if (top) alt = top.id;
    }
    if (!alt) throw firstError;
    console.error("0G model " + wanted + " failed, retrying with " + alt + ": " + firstError.message);
    used = alt;
    response = await ask(alt);
  }
  const data = await response.json();
  const ogMsg = data?.choices?.[0]?.message || {};
  const raw = ogMsg.content ?? data?.choices?.[0]?.text ?? "";
  const text = finishText(options.tracker, contentToText(raw), ogMsg.reasoning_content || ogMsg.reasoning);
  OG_SERVED[key] = used;
  if (used !== wanted) console.log("0G served " + wanted + " with " + used + " (" + ogName(catalog, used) + ")");
  trackUsage(options.tracker, data?.usage, messages, text);
  return text;
}
/* ---- Google Gemini (its own API key) ---- */
/* Google retires model names now and then (2.5-flash was retired for new keys).
   The API error names the replacement, so it is picked up and used from then on. */
const GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
let GEMINI_LIVE = "";
const GEMINI_SERVED = {};
function geminiModelFromError(message) {
  const m = /models\/([A-Za-z0-9_.\-]+)/.exec(String(message || ""));
  return m ? m[1] : "";
}
async function callGeminiChat(env, key, messages, options = {}) {
  const configured = chatModelId(env, key);
  const system = messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");
  const img = options.image && options.image.dataUrl ? parseDataUrl(options.image.dataUrl) : null;
  let contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content || "") }]
    }));
  if (img) {
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role !== "user") continue;
      contents[i].parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
      break;
    }
  }
  /* Gemini conversations must start with the user */
  while (contents.length && contents[0].role === "model") contents.shift();
  if (!contents.length) contents = [{ role: "user", parts: [{ text: "Hello" }] }];
  /* Gemini "thinking" also uses output tokens, so leave extra room.
     Gemini 3.x always thinks, so the budget is never allowed to be tiny. */
  const maxOut = Math.min(16384, Math.max(4096, (options.max_tokens ?? ANSWER_TOKENS) * 2));
  const payload = {
    contents,
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: maxOut
    }
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  const order = [];
  const add = id => { if (id && order.indexOf(id) < 0) order.push(id); };
  add(GEMINI_LIVE);
  add(configured);
  GEMINI_FALLBACKS.forEach(add);
  let lastError = null;
  /* b95 - when the app is streaming, built-in Gemini streams too
     (same model fallback order), so its thoughts arrive LIVE in
     the thinking box instead of only when the answer is done */
  if (options.onDelta) {
    for (let si = 0; si < order.length; si++) {
      const smodel = order[si];
      try {
        const stext = await streamGeminiLike(
          `${GEMINI_BASE}/models/${encodeURIComponent(smodel)}:streamGenerateContent?alt=sse`,
          { "Content-Type": "application/json", "x-goog-api-key": geminiKey(env) },
          payload, options);
        GEMINI_LIVE = smodel;
        GEMINI_SERVED[key] = smodel;
        return finishText(options.tracker, stext);
      } catch (serr) {
        lastError = serr;
        const smsg = String((serr && serr.message) || "");
        if (!/404|no longer available|not found|NOT_FOUND|not supported/i.test(smsg)) throw serr;
      }
    }
    if (lastError) throw lastError;
  }
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    const tries = model === GEMINI_LIVE || model === configured ? 4 : 1;
    try {
      const response = await apiFetch(
        `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey(env)
          },
          body: JSON.stringify(payload)
        },
        tries,
        "Gemini"
      );
      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const raw = parts.filter(p => !p.thought).map(p => p.text || "").join("");
      const text = finishText(
        options.tracker,
        raw,
        parts.filter(p => p.thought).map(p => p.text || "").join("")
      );
      if (!text && data?.promptFeedback?.blockReason) {
        throw new Error("Gemini blocked this request (" + data.promptFeedback.blockReason + ").");
      }
      GEMINI_LIVE = model;
      GEMINI_SERVED[key] = model;
      if (model !== configured) console.log("Gemini served " + configured + " with " + model);
      const u = data?.usageMetadata;
      trackUsage(
        options.tracker,
        u ? {
          prompt_tokens: u.promptTokenCount,
          completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)
        } : null,
        messages,
        text
      );
      return text;
    } catch (error) {
      lastError = error;
      const msg = String((error && error.message) || "");
      add(geminiModelFromError(msg));
      /* only a retired / unknown model is worth another try; a wrong key,
         quota or blocked request must be shown to the user as it is */
      if (!/404|no longer available|not found|NOT_FOUND|not supported/i.test(msg)) throw error;
    }
  }
  throw lastError;
}
/* picks the right provider for the chosen model */
function callChat(env, key, messages, options = {}) {
  const m = CHAT_MODELS[key];
  if (m) {
    if (m.provider === "gemini") return callGeminiChat(env, key, messages, options);
    if (m.provider === "og") return callOgChat(env, key, messages, options);
    return callSarvamChat(env, messages, options);
  }
  /* a model added from Settings answers here */
  return readCustomModels(env).then(list => {
    const cfg = list.find(x => x.key === key);
    if (!cfg) return callSarvamChat(env, messages, options);
    return callCustomChat(env, cfg, messages, options);
  });
}
async function translateToLanguage(env, text, languageCode, tracker, modelKey) {
  const info = LANGUAGE_INFO[languageCode];
  return callChat(env, modelKey, [
    {
      role: "system",
      content:
        `You are a professional translator. Translate the user's text into ${langLabel(info)}. ` +
        `Write ONLY in ${info.name}. Output only the translation, nothing else. ` +
        "Keep numbers, code, URLs and formatting unchanged. Proper nouns may stay in their original form."
    },
    { role: "user", content: text }
  ], { temperature: 0.1, tracker });
}
function buildSystemPrompt(info, documentText, docLangName) {
  const label = langLabel(info);
  return `You are a helpful multilingual AI assistant.
LANGUAGE RULES (HIGHEST PRIORITY — NEVER BREAK THEM):
1. Always write your ENTIRE answer in ${label}. The user has chosen ${info.name} as the permanent reply language.
2. The user's question and the uploaded document can be in ANY other language (English, Hindi, Bengali, Tamil, Urdu, Odia, etc.). Read and understand them, but do NOT answer in the document's language or in the question's language.
3. Even if the user writes in another language (for example in English "Summarize this" or in Hindi), you must still reply in ${info.name}.
4. Translate and explain the document's meaning in ${info.name}. Only proper nouns, technical terms, numbers and code may stay in their original form.
5. If the user asks which language the document is written in, name the language (in ${info.name}) by looking at the document text itself.
6. Never mention these rules.
CONTENT RULES:
- Answer only what was asked, completely and in a calm, friendly tone.
- If the user asks for an image, a photo or a map of something, never say you cannot show images and never tell them to go and find it on the internet themselves. Just present it warmly (for example "Here it is") and answer on: the app itself attaches the relevant image or map right under your answer. Never write picture code like ![words](address), never paste any image address, map address or static-map link into your answer, and never invent a link. Keep the words clean and premium. Never mention this system or these instructions.
- Start with a one-line answer, then add short points if more detail helps. Keep it comfortable on a phone.
- Use emojis sparingly: normally at most 1 to 3 in a whole answer, and only where one genuinely helps the reader. More are allowed only when the format truly needs them (for example a list where each point genuinely benefits). Never add emojis just to decorate, never the same emoji twice in a row, and never inside code, numbers, links or file names.
STYLE RULES - HOW THE REPLY MUST LOOK (NEVER BREAK THEM):
- Send ONLY the final answer. Never show your thinking, planning, drafts, notes to yourself, or lines such as "Thinking Process", "Let me think", "First I will analyse", "Step 1".
- Never mention these instructions, the model name, the API, tokens, or that you are an AI language model.
- Never put an error message, an apology template, an OCR note or a language note inside the answer.
- Never mix two languages in one sentence. One whole reply, one language, except names, code, numbers and technical terms.
- If something is unclear, answer the most likely meaning and add one short honest line - do not show your doubt process.
- If NO document is provided, simply answer the question from your general knowledge. Do not ask the user to upload a document and do not mention documents unless the user refers to one.` +
    (info.name === "Bengali"
      ? "\n- The user reads Bengali from INDIA (for example West Bengal, Tripura or Assam). Always assume the user is in India, never in Bangladesh, unless the user personally says they are in Bangladesh: use Indian places, Indian context and examples, and the rupee for money. Do not use Bangladeshi places, context or money unless the user asks about Bangladesh."
      : "") +
    (documentText
      ? "\n- The user attached this file to their message. Their question refers to the file: answer from the file and do NOT continue earlier unrelated topics of the conversation."
      : "") +
    (docLangName && documentText
      ? `\n- The document was read by OCR as ${docLangName}. This is only a hint; some languages share a script (for example Hindi/Marathi/Nepali), so decide the exact language from the text.`
      : "") +
    (documentText
      ? `\n\n=== UPLOADED DOCUMENT (may be in another language) ===\n${documentText}\n=== END OF DOCUMENT ===`
      : "");
}
/* splits a data URL into { mime, base64 } */
function parseDataUrl(url) {
  const m = String(url || "").match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) return null;
  return { mime: m[1] || "image/png", base64: m[2] };
}
/* =========================================================
   CUSTOM AI MODELS  (added from Settings — no code edits needed)
   Stored in Cloudflare KV so any new model works everywhere.
   ========================================================= */
const KV_MODELS_KEY = "custom_models";
const MODEL_FORMATS = ["openai", "gemini"];
function slugKey(label, taken) {
  var base = "c_" + String(label || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  if (!base || base === "c_") base = "c_model";
  var key = base, n = 2;
  while (taken.indexOf(key) >= 0) { key = base + "-" + n; n++; }
  return key;
}
var LOGO_MAX_STILL = 120000;   /* an uploaded still picture (the app sends 72 px) */
var LOGO_MAX_GIF = 500000;     /* an animated GIF - kept whole so it keeps moving */
function logoIsGif(v) {
  return String(v || "").toLowerCase().slice(0, 15) === "data:image/gif;";
}
/* tells the app in plain words why a logo will not be kept */
function logoTooBig(raw) {
  var v = String(raw || "").trim();
  if (v.toLowerCase().slice(0, 11) !== "data:image/") return "";
  if (v.indexOf("base64,") < 0) return "That logo picture could not be read - please upload it again.";
  if (v.length <= (logoIsGif(v) ? LOGO_MAX_GIF : LOGO_MAX_STILL)) return "";
  return logoIsGif(v)
    ? "That GIF logo is too heavy (max about 350 KB) - pick a smaller GIF, or a jpg / png picture (those are shrunk for you)."
    : "That logo picture is too big - please pick a smaller one.";
}
function cleanLogo(raw) {
  var v = String(raw || "").trim();
  if (!v) return "";
  var low = v.toLowerCase();
  if (low.slice(0, 11) === "data:image/") {
    /* an uploaded picture. A still one is already 72 px; an animated GIF is
       kept exactly as it is so every frame survives - it must never be cut
       short, because half a picture would not show at all. */
    if (v.indexOf("base64,") < 0) return "";
    if (v.length > LOGO_MAX_GIF) return "";
    return v;
  }
  if (low.slice(0, 8) === "https://") return v.slice(0, 400);
  return v.slice(0, 8);   /* a short emoji or letters */
}
function cleanCustomModel(body, taken, keepKey) {
  var label = String(body.label || "").trim().slice(0, 60);
  var modelId = String(body.modelId || "").trim().slice(0, 120);
  var provider = String(body.provider || "").trim().toLowerCase();
  var known = providerOf(provider);
  var base = String(body.base || "").trim().replace(/\/+$/, "");
  var apiKey = String(body.apiKey || "").trim();
  var format = MODEL_FORMATS.indexOf(String(body.format || "")) >= 0 ? String(body.format) : "openai";
  var key = keepKey || (taken.indexOf(String(body.key || "")) >= 0 ? String(body.key) : "");
  if (!label) return { error: "Add a display name (for example Kimi K2)." };
  if (!modelId) return { error: "Add the model code name (for example kimi-k2-0905)." };
  var logoIssue = logoTooBig(body.logo);
  if (logoIssue) return { error: logoIssue };
  var model = {
    key: key || slugKey(label, taken),
    label: label,
    modelId: modelId,
    logo: cleanLogo(body.logo),
    added: Date.now(),
    saved: Date.now()
  };
  if (known) {
    /* the new way: the API carries the address and the key */
    model.provider = known.id;
    return { model: model };
  }
  /* an older model that still carries its own address and key keeps working */
  if (/^https?:\/\//i.test(base) && apiKey) {
    model.base = base;
    model.apiKey = apiKey;
    model.format = format;
    model.provider = "custom";
    return { model: model };
  }
  return { error: "Choose which API this model belongs to (" + PROVIDER_ORDER.map(function (id) { return PROVIDERS[id].short; }).join(", ") + ")." };
}
async function readCustomModels(env) {
  if (!kvReady(env)) return [];
  try {
    var raw = await kvStore(env).get(KV_MODELS_KEY);
    var list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error("Custom models read failed:", e);
    return [];
  }
}
async function writeCustomModels(env, list) {
  await kvStore(env).put(KV_MODELS_KEY, JSON.stringify(list));
}
/* public view: keys stay on the server */
function publicModel(m) {
  var p = providerOf(m.provider);
  return {
    key: m.key,
    label: m.label,
    modelId: m.modelId,
    provider: p ? p.id : (String(m.base || "").trim() ? "custom" : ""),
    providerLabel: p ? p.label : (String(m.base || "").trim() ? "its own address" : ""),
    providerIcon: p ? p.icon : "🔗",
    base: m.base || "",
    format: p ? p.format : (m.format || "openai"),
    logo: m.logo || "",
    /* with a provider the key is already in the app, so nothing is missing */
    hasKey: p ? true : Boolean(m.apiKey),
    saved: m.saved || Date.now()
  };
}
async function handleModels(request, env) {
  if (request.method === "GET") {
    var list = await readCustomModels(env);
    return json({ ok: true, store: kvReady(env), models: list.map(publicModel),
      hidden: await readHiddenModels(env) });
  }
  var body = {};
  try { body = await request.json(); } catch {}
  if (!kvReady(env)) {
    return json({ ok: false, error: "Connect a KV namespace (binding name KV, or the older CHAT_STORE) to save models." }, 501);
  }
  /* no ADMIN_PASSWORD set = the panel is open, exactly like the rest of the app */
  if (env.ADMIN_PASSWORD && body.password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, needPassword: true, error: "Wrong or missing admin password." }, 401);
  }
  var models = await readCustomModels(env);
  /* editing an existing model must keep everything else exactly as it was */
  if (body.action === "save" && body.key) {
    var previous = null;
    for (var pi = 0; pi < models.length; pi++) if (models[pi].key === body.key) previous = models[pi];
    if (previous) {
      if (!String(body.apiKey || "").trim()) body.apiKey = previous.apiKey;
      if (!String(body.provider || "").trim()) body.provider = previous.provider || "";
      if (body.logo === undefined || body.logo === null) body.logo = previous.logo;
      body.added = previous.added;
    }
  }
  if (body.action === "unhide") {
    /* b85 — deletion is permanent: there is no way back */
    return json({ ok: false, error: "Deleted models cannot be restored." }, 400);
  }
  if (body.action === "hide") {
    /* a BUILT-IN model leaves the ⚡ Models list everywhere. The model code
       itself stays in the app, so “Add back” costs nothing. */
    var hideKey = String(body.key || "").trim();
    if (!hideKey) return json({ ok: false, error: "No model chosen." }, 400);
    var hidden = await readHiddenModels(env);
    if (body.action === "hide") { if (hidden.indexOf(hideKey) < 0) hidden.push(hideKey); }
    else hidden = hidden.filter(function (k) { return k !== hideKey; });
    await writeHiddenModels(env, hidden);
    return json({ ok: true, key: hideKey, hidden: hidden });
  }
  if (body.action === "delete") {
    var left = models.filter(function (m) { return m.key !== body.key; });
    await writeCustomModels(env, left);
    return json({ ok: true, deleted: body.key, models: left.map(publicModel) });
  }
  var taken = models.map(function (m) { return m.key; });
  if (body.key) taken = taken.filter(function (k) { return k !== body.key; });
  var cleaned = cleanCustomModel(body, taken, body.key || "");
  if (cleaned.error) return json({ ok: false, error: cleaned.error }, 400);
  var fresh = cleaned.model;
  if (body.key && body.logo === undefined) {
    var old = models.find(function (m) { return m.key === body.key; });
    if (old) fresh.logo = old.logo || "";
  }
  var replaced = false;
  models = models.map(function (m) {
    if (m.key === fresh.key) { replaced = true; return fresh; }
    return m;
  });
  if (!replaced) models.push(fresh);
  await writeCustomModels(env, models);
  return json({ ok: true, model: publicModel(fresh), models: models.map(publicModel) });
}
/* calls a model added from Settings (OpenAI-compatible or Gemini format) */
async function callCustomChat(env, cfg, messages, options = {}) {
  var label = cfg.label || "Custom model";
  /* a model that only names its API gets the address + key from the table */
  if (!String(cfg.base || "").trim()) {
    var wired = await modelProviderConfig(env, cfg);
    cfg = Object.assign({}, cfg, wired);
  }
  if (cfg.format === "gemini") {
    var system = messages.filter(function (m) { return m.role === "system"; }).map(function (m) { return m.content; }).join("\n\n");
    var contents = messages.filter(function (m) { return m.role !== "system"; }).map(function (m) {
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] };
    });
    while (contents.length && contents[0].role === "model") contents.shift();
    if (!contents.length) contents = [{ role: "user", parts: [{ text: "Hello" }] }];
    var gp = { contents: contents, generationConfig: { temperature: options.temperature ?? 0.3, maxOutputTokens: Math.min(8192, Math.max(1024, (options.max_tokens ?? ANSWER_TOKENS) * 2)) } };
    if (system) gp.systemInstruction = { parts: [{ text: system }] };
    var gr = await apiFetch(cfg.base + "/models/" + encodeURIComponent(cfg.modelId) + ":generateContent", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey }, cfg.headers || {}),
      body: JSON.stringify(gp)
    }, 3, label);
    var gd = await gr.json();
    var gparts = (gd && gd.candidates && gd.candidates[0] && gd.candidates[0].content && gd.candidates[0].content.parts) || [];
    var gtext = finishText(
      options.tracker,
      gparts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ""; }).join(""),
      gparts.filter(function (p) { return p.thought; }).map(function (p) { return p.text || ""; }).join("")
    );
    var gu = gd && gd.usageMetadata;
    trackUsage(options.tracker, gu ? { prompt_tokens: gu.promptTokenCount, completion_tokens: (gu.candidatesTokenCount || 0) + (gu.thoughtsTokenCount || 0) } : null, messages, gtext);
    return gtext;
  }
  var response = await apiFetch(cfg.base + "/chat/completions", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey }, cfg.headers || {}),
    body: JSON.stringify({
      model: cfg.modelId,
      messages: openAiImageMessages(messages, options.image),
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? ANSWER_TOKENS
    })
  }, 3, label);
  var data = await response.json();
  var cMsg = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
  var raw = cMsg.content || (data && data.choices && data.choices[0] && data.choices[0].text) || (data && data.output_text) || "";
  var text = finishText(options.tracker, contentToText(raw), cMsg.reasoning_content || cMsg.reasoning);
  trackUsage(options.tracker, data && data.usage, messages, text);
  return text;
}

/* =====================================================
   PLACE INFORMATION — geocoding + real photographs.
   GET /api/place?q=Vellore+Fort
   -> { ok, place: { name, fullName, lat, lng, photos, wiki }, mapboxToken }
   Photos come from Wikipedia / Wikimedia Commons (real
   photographs only, never generated). The Mapbox token
   is a PUBLIC token; env.MAPBOX_TOKEN can override it.
   ===================================================== */
const MAPBOX_PUBLIC_TOKEN = "pk.eyJ1IjoiY2lwaGVyc291bDEwOCIsImEiOiJjbXZmOXg4ZHMwM2huMnlyMjFvdXVnNXE2In0.J-DrF0cf9oWuEsMjpPKx8Q";
function mapboxToken(env) { return (env && env.MAPBOX_TOKEN) || MAPBOX_PUBLIC_TOKEN; }
async function mfFetchJson(u, headers) {
  const r = await fetch(u, { headers: Object.assign({ "User-Agent": "MindFusion/1.0 (place information)" }, headers || {}) });
  if (!r.ok) throw new Error("upstream " + r.status);
  return await r.json();
}
/* Unsplash (general photography). The Access Key stays in the Worker
   (env.UNSPLASH_ACCESS_KEY, a Cloudflare secret) and is only ever sent
   from here — never to the browser. Missing key -> no Unsplash, the
   rest of the feature carries on. */
async function unsplashPhotos(env, q, n) {
  const key = env && env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const data = await mfFetchJson("https://api.unsplash.com/search/photos?query=" + encodeURIComponent(q) +
    "&per_page=" + n + "&orientation=landscape&content_filter=high",
    { Authorization: "Client-ID " + key, "Accept-Version": "v1" });
  const out = [];
  for (const r of (data && data.results) || []) {
    if (!r || !r.urls || !r.urls.regular) continue;
    out.push({
      url: r.urls.regular,
      full: r.urls.full || r.urls.regular,
      alt: r.alt_description || r.description || q,
      source: "Unsplash",
      author: (r.user && r.user.name) || "",
      authorUrl: (r.user && r.user.links && r.user.links.html) || "",
      downloadLocation: (r.links && r.links.download_location) || ""
    });
  }
  return out;
}
async function commonsPhotos(q, n, have) {
  const out = [];
  const sigW = mfNorm(q).split(/[^a-z0-9]+/).filter(w => w.length > 3);
  /* when the subject has two name-words, a photo must match BOTH:
     "Salah" (the prayer) is not Mohamed Salah, however early it ranks */
  const need = sigW.length >= 2 ? 2 : 1;
  const scoreOf = (title) => {
    const tw = mfNorm(title).split(/[^a-z0-9]+/);
    return sigW.filter(w => tw.some(t => mfWordMatch(w, t))).length;
  };
  const pushWiki = (pg) => {
    if (pg && pg.thumbnail && pg.thumbnail.source && !out.some(p => p.url === pg.thumbnail.source))
      out.push({ url: pg.thumbnail.source, full: pg.original ? pg.original.source : pg.thumbnail.source, alt: pg.title || q, source: "Wikipedia", wiki: pg.fullurl || "" });
  };
  const exactOf = (title) => {
    const tw = mfNorm(title).split(/[^a-z0-9]+/);
    return sigW.filter(w => tw.indexOf(w) >= 0).length;
  };
  const fillers = [];
  let articleOk = false;
  /* a multi-word NAME with no article of its own is a namesake trap:
     Commons holds other people with the same words in their file
     names. Such a subject may only use article photographs whose
     titles name it outright — never loose Commons matches (b82) */
  const personLike = sigW.length >= 2 && !/temple|fort|palace|memorial|mosque|church|cathedral|tomb|monument|museum|waterfall|falls|beach|lake|park|garden|bridge|dam|island|mountain|river|stadium|university|temple|village|town|city|desert|valley|cave|volcano/.test(mfNorm(q));
  try {
    const art = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=query&titles=" +
      encodeURIComponent(q) + "&prop=pageimages|info&inprop=url&pithumbsize=900&format=json&origin=*");
    const apages = art && art.query && art.query.pages ? Object.values(art.query.pages) : [];
    for (const pg of apages) { if (pg && pg.title && !('missing' in pg)) articleOk = true; pushWiki(pg); }
  } catch (e) { /* search below may still find it */ }
  /* name words must sit together in a file title: "David nalbandian
     nestor kirchner" contains both words but is two other people */
  const tightOf = (title) => {
    if (sigW.length < 2) return true;
    const tw = mfNorm(title).split(/[^a-z0-9]+/);
    const idx = [];
    for (const w of sigW) { const i = tw.findIndex(t => mfWordMatch(w, t)); if (i < 0) return false; idx.push(i); }
    if (!MF_NOUN_RE.test(mfNorm(title))) { for (let k = 1; k < idx.length; k++) if (idx[k] <= idx[k - 1]) return false; }
    return Math.max.apply(null, idx) - Math.min.apply(null, idx) <= idx.length - 1;
  };
  try {
    const wiki = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
      encodeURIComponent(q) + "&gsrnamespace=0&gsrlimit=5&prop=pageimages|info&inprop=url&pithumbsize=900&format=json&origin=*");
    const pages = wiki && wiki.query && wiki.query.pages ? Object.values(wiki.query.pages) : [];
    pages.sort((a, b) => (scoreOf(b.title) - scoreOf(a.title)) || ((a.index || 99) - (b.index || 99)));
    for (const pg of pages) {
      if (exactOf(pg.title) >= need && tightOf(pg.title)) pushWiki(pg);
      else if (scoreOf(pg.title) >= need && exactOf(pg.title) >= 1 && tightOf(pg.title)) fillers.push(() => pushWiki(pg));
    }
  } catch (e) { /* Commons below may still have it */ }
  try {
    const commons = await mfFetchJson("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" +
      encodeURIComponent(q + " filetype:bitmap") + "&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&format=json&origin=*");
    const cpages = commons && commons.query && commons.query.pages ? Object.values(commons.query.pages) : [];
    const seen = new Set(out.map(p => p.url));
    for (const pg of cpages) {
      const info = pg && pg.imageinfo && pg.imageinfo[0];
      const u = info && (info.thumburl || info.url);
      if (!u || seen.has(u) || /\.svg($|\?)/i.test(u)) continue;
      if (!tightOf(pg.title)) continue;
      if (personLike && !articleOk) continue;
      if (exactOf(pg.title) < need) {
        if (scoreOf(pg.title) >= need && exactOf(pg.title) >= 1) fillers.push(() => { if (!seen.has(u)) { seen.add(u); out.push({ url: u, full: info.url || u, alt: String(pg.title || q).replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""), source: "Wikimedia Commons", author: meta.Artist ? String(meta.Artist.value || "").replace(/<[^>]*>/g, "") : "", license: meta.LicenseShortName ? String(meta.LicenseShortName.value || "") : "", wiki: info.descriptionurl || "" }); } });
        continue;
      }
      seen.add(u);
      const meta = (info.extmetadata || {});
      out.push({ url: u, full: info.url || u, alt: String(pg.title || q).replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""), source: "Wikimedia Commons",
        author: meta.Artist ? String(meta.Artist.value || "").replace(/<[^>]*>/g, "") : "",
        license: meta.LicenseShortName ? String(meta.LicenseShortName.value || "") : "",
        wiki: info.descriptionurl || "" });
      if (out.length >= have) break;
    }
  } catch (e) { /* photographs are optional */ }
  if (out.length < 1) for (const f of fillers) { f(); if (out.length >= 2) break; }
  return out.slice(0, have);
}

/* resolve a landmark through Wikipedia: article search first, then the
   search engine's own "did you mean", then opensearch title matching
   (which forgives spellings like "Viktoriya memorial"). The article's
   coordinates are the real location of the site. */
function mfNorm(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function mfSigWords(q) { return mfNorm(q).split(/[^a-z0-9]+/).filter(w => w.length > 3); }
function mfEditDist(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function mfWordMatch(w, t) {
  if (!w || !t) return false;
  if (t === w || t.indexOf(w) === 0 || w.indexOf(t) === 0) return true;
  const d = mfEditDist(w, t), m = Math.max(w.length, t.length);
  return d <= Math.max(w.length >= 7 ? 2 : 1, Math.floor(m * 0.2));
}
function mfTitleScore(q, title) {
  const tw = mfNorm(title).split(/[^a-z0-9]+/);
  let sc = mfSigWords(q).filter(w => tw.some(t => mfWordMatch(w, t))).length;
  for (const noun of ["temple", "Fort", "palace", "memorial", "mosque", "church", "tomb", "museum", "waterfall", "lake", "beach", "bridge"])
    if (String(q).toLowerCase().indexOf(noun) >= 0 && String(title).toLowerCase().indexOf(noun) >= 0) sc += 0.5;
  return sc;
}
async function wikiSearchPages(params) {
  const wp = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=query&" + params +
    "&prop=pageimages|coordinates|info&inprop=url&pithumbsize=900&format=json&origin=*");
  const pages = wp && wp.query && wp.query.pages ? Object.values(wp.query.pages) : [];
  pages.sort((a, b) => (a.index || 99) - (b.index || 99));
  return pages;
}
function placeFromPage(pg) {
  const co = pg.coordinates && pg.coordinates[0];
  return { name: pg.title, fullName: pg.title, lng: Number(co.lon), lat: Number(co.lat),
    photos: pg.thumbnail ? [{ url: pg.thumbnail.source, full: pg.thumbnail.source, alt: pg.title, source: "Wikipedia", wiki: pg.fullurl || "" }] : [],
    wiki: pg.fullurl || "" };
}
/* every significant word present AND in the user's order:
   "David Nestor" holds both words of "Nestor David" but is a
   different person entirely (b82) */
const MF_NOUN_RE = /temple|fort|palace|memorial|mosque|church|cathedral|tomb|monument|museum|waterfall|falls|beach|lake|park|garden|bridge|dam|island|mountain|river|stadium|university|village|town|city|desert|valley|cave|volcano|airport|station|shrine|harbour|harbor|market|street|road|square/;
function mfOrderedMatch(q, title) {
  if (MF_NOUN_RE.test(mfNorm(q)) || MF_NOUN_RE.test(mfNorm(title))) return true;
  const tw = mfNorm(title).split(/[^a-z0-9]+/);
  let pos = -1;
  for (const w of mfSigWords(q)) {
    let found = -1;
    for (let i = pos + 1; i < tw.length; i++) { if (mfWordMatch(w, tw[i])) { found = i; break; } }
    if (found < 0) return false;
    pos = found;
  }
  return true;
}
async function wikiBestPlace(q, relax) {
  /* the exact article (through Wikipedia's own redirects) first:
     "Tirupati Temple" IS Sri Venkateswara Temple, Tirumala there */
  try {
    const exact = await wikiSearchPages("titles=" + encodeURIComponent(q) + "&redirects=1");
    for (const pg of exact) {
      const co = pg && pg.coordinates && pg.coordinates[0];
      if (co && isFinite(co.lat) && isFinite(co.lon) && mfTitleScore(q, pg.title) > 0) return placeFromPage(pg);
    }
  } catch (e) { /* scored search below */ }
  const pages = await wikiSearchPages("generator=search&gsrsearch=" + encodeURIComponent(q) + "&gsrnamespace=0&gsrlimit=8");
  let best = null, bestScore = 0;
  for (const pg of pages) {
    const co = pg && pg.coordinates && pg.coordinates[0];
    if (!co || !isFinite(co.lat) || !isFinite(co.lon)) continue;
    /* Wikipedia's own rank is a prominence signal: its #1 result
       (Venkateswara Temple for "tirupati temple") must be able to
       beat a same-named minor shrine that merely matches more words */
    const sc = mfTitleScore(q, pg.title) + Math.max(0, 9 - (pg.index || 9)) * 0.4;
    if ((relax || mfTitleScore(q, pg.title) > 0) && sc > bestScore) { bestScore = sc; best = pg; }
  }
  return best ? placeFromPage(best) : null;
}
async function resolveWikiPlace(q) {
  let p = null;
  try { p = await wikiBestPlace(q); } catch (e) { /* next step */ }
  if (p) return p;
  try {
    const sug = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(q) + "&srlimit=1&srinfo=suggestion&format=json&origin=*");
    const sg = sug && sug.query && sug.query.searchinfo && sug.query.searchinfo.suggestion;
    if (sg && sg.toLowerCase() !== q.toLowerCase()) { p = await wikiBestPlace(sg, true); if (p) return p; }
  } catch (e) { /* next step */ }
  /* CirrusSearch fuzzy terms ("epstain~ island~") forgive a typo the
     plain search and its suggestion both miss (b80) */
  try {
    const fuzzyQ = q.split(" ").filter(w => w.length > 2).map(w => w + "~").join(" ");
    if (fuzzyQ) {
      const pages = await wikiSearchPages("generator=search&gsrsearch=" + encodeURIComponent(fuzzyQ) + "&gsrnamespace=0&gsrlimit=8");
      let best = null, bestScore = 0;
      for (const pg of pages) {
        const co = pg && pg.coordinates && pg.coordinates[0];
        if (!co || !isFinite(co.lat) || !isFinite(co.lon)) continue;
        const raw = mfTitleScore(q, pg.title);
        const sc = (raw > 0 ? 100 + raw : 0) + Math.max(0, 9 - (pg.index || 9)) * 0.4;
        if (sc > bestScore) { bestScore = sc; best = pg; }
      }
      if (best) return placeFromPage(best);
    }
  } catch (e) { /* next step */ }
  try {
    const os = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=opensearch&search=" +
      encodeURIComponent(q) + "&limit=4&namespace=0&format=json&origin=*");
    const titles = Array.isArray(os && os[1]) ? os[1] : [];
    for (const t of titles.slice(0, 3)) {
      const pages = await wikiSearchPages("titles=" + encodeURIComponent(t));
      for (const pg of pages) {
        const co = pg && pg.coordinates && pg.coordinates[0];
        if (co && isFinite(co.lat) && isFinite(co.lon)) return placeFromPage(pg);
      }
    }
  } catch (e) { /* next step */ }
  return null;
}
async function resolveAiPlace(list, askQ) {
  const askSig = askQ ? mfSigWords(askQ) : [];
  const lockOn = askSig.length > 0 && list.some(c => mfTitleScore(askQ, c) > 0);
  const rel = (c) => !lockOn || mfTitleScore(askQ, c) > 0;
  for (const c of list) {
    if (!rel(c)) continue;
    try { const p = await wikiBestPlace(c); if (p) return p; } catch (e) { /* next candidate */ }
  }
  for (const c of list.slice(0, 3)) {
    if (!rel(c)) continue;
    try { const p = await resolveWikiPlace(c); if (p) return p; } catch (e) { /* next candidate */ }
  }
  return null;
}
async function wikiCanonicalName(q) {
  let searchBest = null, searchRaw = 0;
  try {
    const pages = await wikiSearchPages("generator=search&gsrsearch=" + encodeURIComponent(q) + "&gsrnamespace=0&gsrlimit=5");
    let bestKey = -1;
    for (const pg of pages) {
      const raw = mfTitleScore(q, pg && pg.title);
      /* name match first, then having a real article photo (the
         notable entity has one), then Wikipedia's own rank */
      const key = raw * 1000 + (pg.thumbnail ? 100 : 0) + (/\(disambiguation\)/i.test(pg.title || '') ? -500 : 0) + Math.max(0, 9 - (pg.index || 9));
      if (key > bestKey) { bestKey = key; searchRaw = raw; searchBest = { title: pg.title }; }
    }
    /* every name-word matched: that article IS the subject */
    if (searchBest && searchRaw >= mfSigWords(q).length && mfSigWords(q).length > 0 && mfOrderedMatch(q, searchBest.title)) return String(searchBest.title);
  } catch (e) { /* next step */ }
  try {
    const os = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=opensearch&search=" +
      encodeURIComponent(q) + "&limit=1&namespace=0&format=json&origin=*");
    const titles = Array.isArray(os && os[1]) ? os[1] : [];
    if (titles[0] && mfTitleScore(q, titles[0]) > 0 && (mfTitleScore(q, titles[0]) < mfSigWords(q).length || mfOrderedMatch(q, titles[0]))) return String(titles[0]);
  } catch (e) { /* next step */ }
  if (searchBest && searchRaw > 0 && (searchRaw < mfSigWords(q).length || mfOrderedMatch(q, searchBest.title))) return String(searchBest.title);
  try {
    const sug = await mfFetchJson("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
      encodeURIComponent(q) + "&srlimit=1&srinfo=suggestion&format=json&origin=*");
    const sg = sug && sug.query && sug.query.searchinfo && sug.query.searchinfo.suggestion;
    if (sg) return String(sg);
  } catch (e) { /* the asked spelling is the fallback */ }
  return q;
}
async function handlePlace(request, env, url) {
  let q = String(url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const mode = String(url.searchParams.get("mode") || "place");
  const aiList = String(url.searchParams.get("ai") || "").split("|").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length >= 3).slice(0, 5);
  if (q.length < 3 && !aiList.length) return json({ ok: true, place: null, photos: [] });
  if (/^(his|her|hers|him|he|she|they|them|their|its|it|that|this|the|a|an|image|photo|map|picture|photograph)$/i.test(q) && !aiList.length) return json({ ok: true, place: null, photos: [] });
  const token = mapboxToken(env);
  /* the user may spell it wrong but close (over 80% right): the AI's
     own answer spells the subject correctly, so trust the AI's
     spelling for the photo/map hunt (b81) */
  try {
    const sigQ = mfSigWords(q);
    if (aiList.length && sigQ.length && !aiList.some(c => c.toLowerCase() === q.toLowerCase())) {
      for (const c of aiList) {
        if (mfTitleScore(q, c) >= sigQ.length) { q = c; break; }
      }
    }
  } catch (e) { /* keep the user's spelling */ }
  try {
    /* general photography: Unsplash first, Commons as fallback, no map */
    if (mode === "photo") {
      let photos = [];
      try { photos = await unsplashPhotos(env, q, 6); } catch (e) { /* fall through */ }
      if (photos.length < 2) {
        const extra = await commonsPhotos(q, 4, 4);
        const seen = new Set(photos.map(p => p.url));
        for (const ph of extra) if (!seen.has(ph.url)) photos.push(ph);
      }
      return json({ ok: true, place: null, photos: photos.slice(0, 6), mapboxToken: token });
    }
    /* images-only requests (place information / heritage): no geocoding,
       no Mapbox call at all — photographs come from Wikimedia/Unsplash */
    if (url.searchParams.get("map") === "0") {
      /* try the AI/chat subjects in order until one really has photos */
      const tryNames = [];
      for (const c of aiList) if (tryNames.indexOf(c) < 0) tryNames.push(c);
      if (tryNames.indexOf(q) < 0) tryNames.push(q);
      let photos = [];
      const askSig = mfSigWords(q);
      /* subject lock (b82): when any candidate is about what was
         ASKED, only those may fill the card — a place or club the
         answer merely mentions aside can never appear. When none
         relates, the answer itself is driving (typed words were
         junk) and its candidates may be tried in order. */
      const lockOn = askSig.length > 0 && tryNames.some(c => mfTitleScore(q, c) > 0);
      for (const name0 of tryNames.slice(0, 4)) {
        if (lockOn && mfTitleScore(q, name0) === 0) continue;
        const photoQ = await wikiCanonicalName(name0);
        if (askSig.length && mfTitleScore(q, photoQ) === 0 && mfTitleScore(name0, photoQ) === 0) continue;
        photos = await commonsPhotos(photoQ, 4, 4);
        if (!photos.length) continue;
        break;
      }
      /* named subjects: Wikimedia only — generic stock photos of
         strangers are worse than fewer real photographs */
      return json({ ok: true, place: null, photos: photos.slice(0, 6), mapboxToken: token });
    }
    /* landmarks resolve best through Wikipedia (see resolveWikiPlace);
       then OpenStreetMap's Nominatim, which knows temples and sites
       Wikipedia has no article for; Mapbox is the last resort and its
       answer must share a word with the question. */
    let place = null;
    if (aiList.length) { try { place = await resolveAiPlace(aiList, q); } catch (e) { /* typed question next */ } }
    if (!place) { try { place = await resolveWikiPlace(q); } catch (e) { /* fall through */ } }
    if (!place) {
      try {
        const nm = await mfFetchJson("https://nominatim.openstreetmap.org/search?q=" + encodeURIComponent(q) + "&format=json&limit=1");
        const hit = Array.isArray(nm) && nm[0];
        const wantWords = (aiList[0] || q).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
        const hitName = String((hit && hit.display_name) || "").toLowerCase();
        if (hit && isFinite(Number(hit.lat)) && isFinite(Number(hit.lon)) && (!wantWords.length || wantWords.some(w => hitName.indexOf(w) >= 0))) {
          place = { name: hit.name || q, fullName: hit.display_name || q, lng: Number(hit.lon), lat: Number(hit.lat), photos: [], wiki: "" };
        }
      } catch (e) { /* Mapbox below may still know it */ }
    }
    if (place) {
      if (mode === "maponly") { place.photos = []; return json({ ok: true, place: place, photos: [], mapboxToken: token }); }
      const extra = await commonsPhotos(place.name, 4, 4);
      const seen = new Set(place.photos.map(p => p.url));
      for (const ph of extra) if (!seen.has(ph.url)) place.photos.push(ph);
      place.photos = place.photos.slice(0, 6);
      return json({ ok: true, place: place, photos: place.photos, mapboxToken: token });
    }
    const geoUrl = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + encodeURIComponent(q) +
      ".json?access_token=" + token + "&limit=1&types=poi,place,locality,neighborhood,region,country";
    const geo = await mfFetchJson(geoUrl);
    const f = geo && Array.isArray(geo.features) ? geo.features[0] : null;
    if (!f || !Array.isArray(f.center) || (typeof f.relevance === "number" && f.relevance < 0.35)) {
      return json({ ok: true, place: null, photos: [] });
    }
    const wanted = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const gotName = String(f.place_name || "").toLowerCase();
    if (wanted.length && !wanted.some(w => gotName.indexOf(w) >= 0)) {
      /* the geocoder's best guess is a different place entirely:
         show photographs of the asked place, but no wrong map */
      const onlyPhotos = await commonsPhotos(q, 4, 4);
      return json({ ok: true, place: null, photos: onlyPhotos, mapboxToken: token });
    }
    place = {
      name: f.text || q,
      fullName: f.place_name || f.text || q,
      lng: Number(f.center[0]), lat: Number(f.center[1]),
      photos: [], wiki: ""
    };
    if (!isFinite(place.lat) || !isFinite(place.lng)) return json({ ok: true, place: null, photos: [] });
    /* heritage/place: Wikimedia first (authentic site photographs);
       Unsplash only tops up, and its pictures are labelled Unsplash */
    place.photos = mode === "maponly" ? [] : await commonsPhotos(q, 4, 4);
    place.wiki = (place.photos.find(p => p.wiki) || {}).wiki || "";
    return json({ ok: true, place: place, photos: place.photos, mapboxToken: token });
  } catch (e) {
    return json({ ok: true, place: null, photos: [] });
  }
}

/* =====================================================
   b84 — live web search, powered by You.com.
   Primary: the keyed Search API (ydc-index.io/v1/search).
   If the key's quota is used up (or the API refuses), the
   search automatically continues on You.com's FREE MCP
   tier (api.you.com/mcp?profile=free — keyless, ~100/day).
   ===================================================== */
const MF_YDC_KEY_PARTS = ["ydc-sk-2b4370802b2bf337-oiYXsWS3", "MdY8uASao9EMtWOU7UYoXrK6-e2c14c09"];
function mfWsNorm(data) {
  const out = [];
  const push = (it, kind) => {
    if (!it || !it.url || !it.title) return;
    let host = "";
    try { host = new URL(it.url).hostname.replace(/^www\./, ""); } catch (e) { host = ""; }
    let desc = String(it.description || "");
    if (!desc && Array.isArray(it.snippets)) desc = it.snippets.join(" ");
    out.push({
      title: String(it.title).slice(0, 200),
      url: String(it.url),
      desc: desc.replace(/\s+/g, " ").trim().slice(0, 320),
      img: it.thumbnail_url ? String(it.thumbnail_url) : "",
      host: host,
      kind: kind,
      age: String(it.page_age || it.published_at || it.date || "").slice(0, 40)
    });
  };
  const res = (data && data.results) || {};
  if (Array.isArray(res.web)) res.web.forEach((it) => push(it, "web"));
  if (Array.isArray(res.news)) res.news.forEach((it) => push(it, "news"));
  if (!out.length && Array.isArray(data && data.hits)) data.hits.forEach((it) => push(it, "web"));
  return out.slice(0, 10);
}
async function mfWsParseMcpText(raw) {
  const tryObj = (j) => {
    if (!j) return null;
    const sc = j.result && j.result.structuredContent;
    if (sc) return sc;
    const c = j.result && j.result.content;
    if (Array.isArray(c)) {
      for (const part of c) {
        if (part && part.type === "text" && part.text) {
          try { return JSON.parse(part.text); } catch (e) { /* next part */ }
        }
      }
    }
    return null;
  };
  const lines = String(raw || "").split("\n");
  for (const line of lines) {
    const s = line.trim();
    if (s.indexOf("data:") !== 0) continue;
    try { const got = tryObj(JSON.parse(s.slice(5))); if (got) return got; } catch (e) { /* next line */ }
  }
  try { return tryObj(JSON.parse(String(raw || ""))); } catch (e) { return null; }
}
async function mfWsMcp(q, count, offset) {
  const rpc = async (body) => {
    const r = await fetch("https://api.you.com/mcp?profile=free&tools=you-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify(body)
    });
    return await r.text();
  };
  await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "MindFusion", version: "1.0" } } });
  const raw = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "you-search", arguments: { query: q, count: count, offset: offset || 0 } } });
  return mfWsParseMcpText(raw);
}
async function handleWebSearch(request, env, url) {
  const q = String(url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 200);
  let offset = parseInt(url.searchParams.get("offset") || "0", 10);
  if (!isFinite(offset) || offset < 0 || offset > 9) offset = 0;
  if (q.length < 2) return json({ ok: true, via: "none", offset: offset, results: [] });
  const key = (env && (env.YOU_API_KEY || env.YDC_API_KEY)) || MF_YDC_KEY_PARTS.join("");
  try {
    const r = await fetch("https://ydc-index.io/v1/search", {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, count: 8, offset: offset })
    });
    if (r.ok) {
      const d = await r.json();
      return json({ ok: true, via: "api", offset: offset, results: mfWsNorm(d) });
    }
    /* 401/402/403/429 — quota or key limits: fall through to free */
  } catch (e) { /* the free tier below may still answer */ }
  try {
    const d = await mfWsMcp(q, 8, offset);
    if (d) return json({ ok: true, via: "free", offset: offset, results: mfWsNorm(d) });
  } catch (e) { /* nothing more to try */ }
  return json({ ok: true, via: "none", offset: offset, results: [] });
}

async function handleChat(request, env) {
  const body = await request.json();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  /* which AI model answers (default = Sarvam 105B) */
  const customList = await readCustomModels(env);
  /* a model saved in the browser (Cloud storage / KV not connected yet) arrives
     with the request itself, so it works with no extra Cloudflare setup */
  const inline = body.modelConfig && typeof body.modelConfig === "object" ? body.modelConfig : null;
  const inlineBase = inline ? String(inline.base || "").trim() : "";
  const inlineProvider = inline ? providerOf(inline.provider) : null;
  const inlineReady = inline && String(inline.modelId || "").trim() &&
    (inlineProvider || (inlineBase && String(inline.apiKey || "").trim() &&
      (inlineBase.slice(0, 8) === "https://" || inlineBase.slice(0, 7) === "http://")));
  const inlineCfg = inlineReady
      ? {
          key: String(inline.key || "c_browser"),
          label: String(inline.label || "My model") + " (this browser)",
          modelId: String(inline.modelId).trim(),
          provider: inlineProvider ? inlineProvider.id : "",
          base: inlineProvider ? "" : inlineBase,
          apiKey: inlineProvider ? "" : String(inline.apiKey || "").trim(),
          format: inlineProvider ? inlineProvider.format : (inline.format === "gemini" ? "gemini" : "openai")
        }
      : null;
  const customCfg =
    (typeof body.model === "string" ? customList.find(m => m.key === body.model) || null : null) || inlineCfg;
  const modelKey = customCfg
    ? customCfg.key
    : typeof body.model === "string" && Object.prototype.hasOwnProperty.call(CHAT_MODELS, body.model)
      ? body.model
      : "sarvam";
  if (customCfg && !String(customCfg.base || "").trim() && !providerOf(customCfg.provider)) {
    return json({ ok: false, error: "This model's API is unknown. Open Settings → My models and pick its API again." }, 400);
  }
  const problem = customCfg ? "" : missingKeyMessage(env, modelKey);
  if (problem) return json({ ok: false, error: problem }, 400);
  const rawDocument =
    typeof body.documentContext === "string" ? body.documentContext : "";
  const hasDocument = rawDocument.trim().length > 0;
  const answerLanguage =
    validChatLanguage(body.answerLanguage) ? body.answerLanguage : "bn-IN";
  /* a photo / PDF the user attached is handed straight to the chosen model */
  const attached =
    body.image && typeof body.image === "object" &&
    typeof body.image.dataUrl === "string" && body.image.dataUrl.startsWith("data:")
      ? { dataUrl: body.image.dataUrl, name: String(body.image.name || "file"), mime: String(body.image.mime || "") }
      : null;
  /* b58 — several pictures, sent together */
  const attachedList = (Array.isArray(body.images) ? body.images : [])
    .filter(img => img && typeof img.dataUrl === "string" && img.dataUrl.startsWith("data:"))
    .slice(0, 8)
    .map(img => ({ dataUrl: img.dataUrl, name: String(img.name || "picture"), mime: String(img.mime || "") }));
  if (!attachedList.length && attached) attachedList.push(attached);
  const wantsStream = body.stream === true;
  const isPdfAttachment = attached && (attached.mime === "application/pdf" || /\.pdf$/i.test(attached.name));
  const docLangName =
    validDocumentLanguage(body.documentLanguage)
      ? documentLanguageName(body.documentLanguage)
      : "";
  const info = LANGUAGE_INFO[answerLanguage];
  const tracker = { prompt: 0, completion: 0, reasoning: "" };
  /* ---------- the attachment is only understood by some models ---------- */
  const customFormat = customCfg
    ? (customCfg.format || (providerOf(customCfg.provider) || {}).format || "openai")
    : "";
  const provider = customCfg ? customFormat : (CHAT_MODELS[modelKey] || {}).provider;
  if (attached) {
    const canSeeImage = provider === "gemini" || customCfg || provider === "og";
    if (!canSeeImage) {
      return json({
        ok: false,
        error: "This model cannot read files directly. Choose Google Gemini (or add a vision model in Settings), or turn on Sarvam Vision in ⚡ Models."
      }, 400);
    }
    if (isPdfAttachment && !(provider === "gemini" || customFormat === "gemini")) {
      return json({
        ok: false,
        error: "This model can read pictures but not PDF files. Use Google Gemini, or turn on Sarvam Vision to read the PDF."
      }, 400);
    }
  }
  /* ---------- clean + budget the history ---------- */
  let history = messages
    .filter(m =>
      m && (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" && m.content.trim() &&
      !m.content.startsWith("⚠️"))
    .slice(-30)
    .map(m => ({ role: m.role, content: m.content }));
  const trimmedHistory = [];
  let historyTokens = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content);
    if (historyTokens + cost > HISTORY_TOKENS && trimmedHistory.length > 0) break;
    historyTokens += cost;
    trimmedHistory.unshift(history[i]);
  }
  history = trimmedHistory;
  /* ---------- hidden language reminder on last user message ---------- */
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      history[i] = {
        role: "user",
        content:
          history[i].content +
          `\n\n[IMPORTANT: Reply ONLY in ${langLabel(info)}, even if the question, the earlier replies or the document are in another language.]` +
          (hasDocument
            ? "\n[The message above refers to the uploaded file. Answer about the file, not about earlier unrelated topics.]"
            : "")
      };
      break;
    }
  }
  /* ---------- fit the document into the token budget ---------- */
  const baseText =
    buildSystemPrompt(info, "", "") + history.map(m => m.content).join("\n");
  const fitted = fitDocument(rawDocument, baseText);
  let documentText = fitted.text;
  let truncated = fitted.truncated;
  const TRUNC_NOTE = "\n\n[Document truncated because it is too long]";
  /* ---------- call model (auto-shrink document if still too large) ---------- */
  const answerModelLabel = () =>
    (customCfg ? customCfg.label : CHAT_MODELS[modelKey].label) +
    (OG_SERVED[modelKey] && OG_SERVED[modelKey] !== (customCfg ? customCfg.modelId : chatModelId(env, modelKey))
      ? " · 0G: " + OG_SERVED[modelKey]
      : "") +
    (GEMINI_SERVED[modelKey] && GEMINI_SERVED[modelKey] !== chatModelId(env, modelKey)
      ? " · Gemini: " + GEMINI_SERVED[modelKey]
      : "");

  async function finishAnswer(onDelta) {
    let answer = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const docForPrompt = truncated ? documentText + TRUNC_NOTE : documentText;
      try {
        const askMessages = [
          { role: "system", content: buildSystemPrompt(info, docForPrompt, docLangName) },
          ...history
        ];
        const askOptions = {
          max_tokens: ANSWER_TOKENS, tracker, image: attached, images: attachedList, onDelta
        };
        answer = (onDelta || attachedList.length > 1)
          ? await callChatStreaming(env, modelKey, customCfg, askMessages, askOptions)
          : (customCfg
              ? await callCustomChat(env, customCfg, askMessages, askOptions)
              : await callChat(env, modelKey, askMessages, askOptions));
        break;
      } catch (error) {
        if (isContextError(error) && documentText.length > 1500 && attempt < 3) {
          documentText = documentText.slice(0, Math.floor(documentText.length * 0.6));
          truncated = true;
          continue;
        }
        throw error;
      }
    }
    /* ---------- verify language, translate if needed ---------- */
    if (answer && !replyMatchesLanguage(answer, answerLanguage)) {
      try {
        const translated = await translateToLanguage(env, answer, answerLanguage, tracker, modelKey);
        if (translated) answer = translated;
      } catch (error) {
        console.error("Translation fallback failed:", error);
      }
    }
    await recordUsage(env, { chats: 1, prompt: tracker.prompt, completion: tracker.completion });
    return {
      ok: true,
      content: answer || "No response received.",
      reasoning: String(tracker.reasoning || "").trim().slice(0, 5000),
      truncated,
      model: answerModelLabel(),
      usage: {
        prompt: tracker.prompt,
        completion: tracker.completion,
        total: tracker.prompt + tracker.completion
      }
    };
  }

  /* ---------- stream the model's own words while it writes ----------
     b59 — a TransformStream, never the stream *constructor*: on Cloudflare
     that constructor is behind the "streams_enable_constructors" flag, and
     this worker has to run on a plain paste with no flags. If the runtime
     cannot make a stream at all, the answer below is returned as one ordinary
     JSON response — the user never sees that error. */
  if (wantsStream && typeof TransformStream === 'function') {
    let channel = null;
    try { channel = new TransformStream(); } catch (error) { channel = null; }
    if (channel) {
      const encoder = new TextEncoder();
      const writer = channel.writable.getWriter();
      const send = obj => {
        try { writer.write(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n')); }
        catch (error) { /* the reader went away */ }
      };
      (async () => {
        try {
          let live = '';
          const result = await finishAnswer((text, kind) => {
            if (kind === 'reason') send({ type: 'reason', text });
            else { live += text; send({ type: 'delta', text }); }
          });
          /* if the answer was translated at the end, replace what was shown */
          if (live && result.content && result.content !== live) send({ type: 'replace', text: result.content });
          send(Object.assign({ type: 'done' }, result));
        } catch (error) {
          send({ type: 'done', ok: false, error: (error && error.message) || 'The model stopped.' });
        } finally {
          try { await writer.close(); } catch (error) {}
        }
      })().catch(() => {});
      return new Response(channel.readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }

  return json(await finishAnswer(null));
}
/* =========================================================
   IMAGE GENERATION/* =========================================================
   IMAGE GENERATION  (Z-Image Turbo through the 0G key)
   ========================================================= */
async function handleOgModels(request, env) {
  if (!ogKey(env) || !ogBase(env)) {
    return json({ ok: false, error: "No 0G key is set. Add one in Settings → 🔌 API providers." }, 400);
  }
  const r = await fetch(`${ogBase(env)}/models`, {
    headers: { "Authorization": "Bearer " + String(env.OG_API_KEY).trim() }
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
async function handleImage(request, env) {
  if (!ogKey(env)) {
    return json({ ok: false, error: "No 0G key is set. Add one in Settings → 🔌 API providers." }, 400);
  }
  if (!ogBase(env)) {
    return json({ ok: false, error: "The 0G API address is not set. Add the variable OG_API_BASE." }, 400);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const size = IMAGE_SIZES.includes(body.size) ? body.size : "1024x1024";
  if (!prompt) return json({ ok: false, error: "Please describe the image you want." }, 400);
  if (prompt.length > MAX_IMAGE_PROMPT) {
    return json({ ok: false, error: "The image description is too long (max " + MAX_IMAGE_PROMPT + " characters)." }, 400);
  }
  const response = await apiFetch(`${ogBase(env)}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + ogKey(env)
    },
    body: JSON.stringify({
      model: imageModelId(env),
      prompt,
      size,
      n: 1
    })
  }, 2, "0G");
  const data = await response.json();
  const item = data?.data?.[0] || data?.images?.[0] || data?.output?.[0] || null;
  let b64 = "";
  let url = "";
  if (typeof item === "string") {
    if (/^https?:\/\//i.test(item)) url = item; else b64 = item;
  } else if (item) {
    b64 = item.b64_json || item.base64 || item.image_base64 || "";
    url = item.url || item.image_url || "";
    if (!b64 && !url && typeof item.image === "string") {
      if (/^https?:\/\//i.test(item.image)) url = item.image; else b64 = item.image;
    }
  }
  if (!b64 && !url) {
    return json({ ok: false, error: "The image model did not return a picture." }, 502);
  }
  await recordUsage(env, { img: 1 });
  if (b64) {
    const image = b64.startsWith("data:") ? b64 : "data:image/png;base64," + b64;
    return json({ ok: true, image, isData: true, model: IMAGE_MODEL.label });
  }
  return json({ ok: true, image: url, isData: false, model: IMAGE_MODEL.label });
}
/* =========================================================
   TRANSLATE  (Sarvam Mayura + Sarvam-Translate)
   ========================================================= */
const SCRIPT_LANGS = [
  ["hi-IN",  /[\u0900-\u097F]/g],
  ["bn-IN",  /[\u0980-\u09FF]/g],
  ["pa-IN",  /[\u0A00-\u0A7F]/g],
  ["gu-IN",  /[\u0A80-\u0AFF]/g],
  ["od-IN",  /[\u0B00-\u0B7F]/g],
  ["ta-IN",  /[\u0B80-\u0BFF]/g],
  ["te-IN",  /[\u0C00-\u0C7F]/g],
  ["kn-IN",  /[\u0C80-\u0CFF]/g],
  ["ml-IN",  /[\u0D00-\u0D7F]/g],
  ["sat-IN", /[\u1C50-\u1C7F]/g],
  ["ur-IN",  /[\u0600-\u06FF\u0750-\u077F]/g],
  ["en-IN",  /[A-Za-z\u00C0-\u024F]/g]
];
/* which language does the text look like (by script)? */
function detectScriptLang(text) {
  let best = null;
  let bestCount = 0;
  for (const [code, re] of SCRIPT_LANGS) {
    const count = (text.match(re) || []).length;
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return { code: best, count: bestCount };
}
/* decide model + source language */
function planTranslation(text, source, target) {
  if (source === "auto") {
    const det = detectScriptLang(text);
    if (!det.code) return { skip: true };                       // numbers / symbols only
    if (det.code === target && target !== "hi-IN") return { skip: true }; // already in target
    if (MAYURA_LANGS.has(det.code)) {
      return { model: MAYURA_MODEL, source: "auto", fallbackSource: det.code };
    }
    return { model: SARVAM_TRANSLATE_MODEL, source: det.code };
  }
  if (source === target) return { skip: true };
  const model =
    MAYURA_LANGS.has(source) && MAYURA_LANGS.has(target)
      ? MAYURA_MODEL
      : SARVAM_TRANSLATE_MODEL;
  return { model, source };
}
/* split into pieces <= limit chars (lines first, then sentences) */
function splitForTranslate(text, limit) {
  const chunks = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) chunks.push(cur);
    cur = "";
  };
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      flush();
      const parts = line.match(/[^.!?। ॥]+[.!?। ॥]*\s*/g) || [line];
      let buf = "";
      for (const part of parts) {
        if (part.length > limit) {
          if (buf.trim()) { chunks.push(buf); buf = ""; }
          for (let i = 0; i < part.length; i += limit) {
            chunks.push(part.slice(i, i + limit));
          }
          continue;
        }
        if ((buf + part).length > limit) {
          if (buf.trim()) chunks.push(buf);
          buf = part;
        } else {
          buf += part;
        }
      }
      if (buf.trim()) chunks.push(buf);
      continue;
    }
    if (cur.length + line.length + 1 > limit) flush();
    cur += (cur ? "\n" : "") + line;
  }
  flush();
  return chunks;
}
async function translateChunk(env, chunk, plan, target, mode) {
  const send = async (sourceCode) => {
    const payload = {
      input: chunk,
      source_language_code: sourceCode,
      target_language_code: target,      model: plan.model
    };
    if (plan.model === MAYURA_MODEL) {
      payload.mode = mode;
      payload.enable_preprocessing = false;
    }
    const response = await apiFetch(`${API}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": await sarvamKey(env)
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data?.translated_text || "";
  };
  let out;
  try {
    out = await send(plan.source);
  } catch (error) {
    if (plan.source === "auto" && plan.fallbackSource && error.status >= 400 && error.status < 500) {
      out = await send(plan.fallbackSource);
    } else {
      throw error;
    }
  }
  return out || chunk;
}
async function handleTranslate(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  let text = typeof body.text === "string" ? body.text : "";
  const target = String(body.target || "");
  const source = String(body.source || "auto");
  const mode = ["formal", "modern-colloquial", "classic-colloquial", "code-mixed"]
    .includes(body.mode) ? body.mode : "formal";
  if (!TRANSLATE_TARGETS.includes(target)) {
    return json({ ok: false, error: "Output language must be English, Bengali or Hindi." }, 400);
  }
  if (source !== "auto" && !validDocumentLanguage(source)) {
    return json({ ok: false, error: "Unsupported input language." }, 400);
  }
  text = text
    .replace(/\r/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .trim();
  if (!text) return json({ ok: false, error: "There is no text to translate." }, 400);
  if (text.length > MAX_TRANSLATE_INPUT) {
    return json({ ok: false, error: "Text is too long for one request. Send it in smaller parts." }, 400);
  }
  const plan = planTranslation(text, source, target);
  if (plan.skip) {
    return json({ ok: true, translation: text, model: "none", skipped: true, chars: 0 });
  }
  const limit = plan.model === MAYURA_MODEL ? MAYURA_LIMIT : SARVAM_TRANSLATE_LIMIT;
  const chunks = splitForTranslate(text, limit);
  const results = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += TRANSLATE_PARALLEL) {
    const group = chunks.slice(i, i + TRANSLATE_PARALLEL);
    const out = await Promise.all(
      group.map(chunk => translateChunk(env, chunk, plan, target, mode))
    );
    out.forEach((t, j) => { results[i + j] = t; });
  }
  await recordUsage(env, { tr: text.length });
  return json({
    ok: true,
    translation: results.join("\n"),
    model: plan.model,
    chars: text.length
  });
}
/* =========================================================
   SETTINGS / USAGE  (Cloudflare analytics + model test)
   ========================================================= */
async function fetchCloudflareUsage(env) {
  const accountTag = env.CF_ACCOUNT_ID;
  const scriptName = env.CF_WORKER_NAME || "sarvam-ai";
  const now = new Date();
  const todayStart = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
  ));
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const query = `
    query WorkerUsage(
      $accountTag: string!,
      $scriptName: string!,
      $todayStart: Time!,
      $weekStart: Time!,
      $until: Time!
    ) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          today: workersInvocationsAdaptive(
            limit: 100,
            filter: { scriptName: $scriptName, datetime_geq: $todayStart, datetime_leq: $until }
          ) {
            sum { requests errors subrequests }
          }
          week: workersInvocationsAdaptive(
            limit: 100,
            filter: { scriptName: $scriptName, datetime_geq: $weekStart, datetime_leq: $until }
          ) {
            sum { requests errors subrequests }
          }
        }
      }
    }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.CF_API_TOKEN
    },
    body: JSON.stringify({
      query,
      variables: {
        accountTag,
        scriptName,
        todayStart: todayStart.toISOString(),
        weekStart: weekStart.toISOString(),
        until: now.toISOString()
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.errors && data.errors.length)) {
    const message =
      data?.errors?.[0]?.message ||
      `Cloudflare API returned HTTP ${response.status}`;
    throw new Error(message);
  }
  const account = data?.data?.viewer?.accounts?.[0];
  const total = rows =>
    (rows || []).reduce((acc, row) => {
      acc.requests += Number(row?.sum?.requests) || 0;
      acc.errors += Number(row?.sum?.errors) || 0;
      acc.subrequests += Number(row?.sum?.subrequests) || 0;
      return acc;
    }, { requests: 0, errors: 0, subrequests: 0 });
  return {
    configured: true,
    worker: scriptName,
    today: total(account?.today),
    week: total(account?.week),
    dailyLimit: 100000
  };
}
async function handleUsage(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (env.ADMIN_PASSWORD && body.password !== env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      needPassword: true,
      error: "Wrong or missing admin password."
    }, 401);
  }
  if (body.resetUsage && kvReady(env)) {
    try { await kvStore(env).delete(KV_USAGE_KEY); }
    catch (error) { console.error("Usage reset failed:", error); }
  }
  const modelList = Object.keys(CHAT_MODELS).map(key => ({
    key,
    label: CHAT_MODELS[key].label,
    id: chatModelId(env, key),
    ready: !missingKeyMessage(env, key)
  }));
  try {
    const customReady = await readCustomModels(env);
    customReady.forEach(m => modelList.push({
      key: m.key,
      label: m.label,
      id: m.modelId,
      ready: Boolean(m.base && m.apiKey),
      custom: true
    }));
  } catch (e) { console.error("custom models in usage:", e); }
  modelList.push({
    key: "image",
    label: IMAGE_MODEL.label,
    id: imageModelId(env),
    ready: Boolean(env.OG_API_KEY && ogBase(env))
  });
  const result = {
    ok: true,
    model: env.SARVAM_CHAT_MODEL || DEFAULT_CHAT_MODEL,
    models: modelList,
    translateModels: `${MAYURA_MODEL} + ${SARVAM_TRANSLATE_MODEL}`,
    sarvamKeySet: Boolean(sarvamKeySync(env)),
    ogKeySet: Boolean(env.OG_API_KEY),
    ogBase: ogBase(env),
    geminiKeySet: Boolean(geminiKey(env)),
    passwordSet: Boolean(env.ADMIN_PASSWORD),
    store: kvReady(env),
    kvBinding: kvBindingName(env),
    kvVia: kvVia(env),
    kvLink: kvLinkWords(request, env),
    kvKind: kvStoreKind(env),
    kvSeen: kvCandidates(env),
    chatSync: kvReady(env),
    cloudflare: { configured: false }
  };
  if (kvReady(env)) {
    try {
      const u = await readUsage(env);
      result.usage = {
        today: sumUsageDays(u, 1),
        week: sumUsageDays(u, 7),
        all: u.total,
        since: u.since
      };
    } catch (error) {
      console.error("Usage read failed:", error);
    }
  }
  if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    try {
      result.cloudflare = await fetchCloudflareUsage(env);
    } catch (error) {
      console.error("Cloudflare usage failed:", error);
      result.cloudflare = { configured: true, error: error.message };
    }
  }
  /* "Test connection" button: tests the chosen chat model */
  if (body.testModel) {
    const key = Object.prototype.hasOwnProperty.call(CHAT_MODELS, body.testModel)
      ? body.testModel
      : "sarvam";
    const label = CHAT_MODELS[key].label;
    const problem = missingKeyMessage(env, key);
    if (problem) {
      result.modelTest = { ok: false, label, error: problem };
    } else {
      const started = Date.now();
      try {
        await callChat(
          env,
          key,
          [{ role: "user", content: "Reply with the single word OK." }],
          { max_tokens: 64, temperature: 0 }
        );
        result.modelTest = { ok: true, label, ms: Date.now() - started };
      } catch (error) {
        result.modelTest = { ok: false, label, error: error.message };
      }
    }
  }
  return json(result);
}
/* =========================================================
   DOCUMENT UPLOAD  (Sarvam Vision / Document Intelligence)
   ========================================================= */
async function handleDocumentUpload(request, env) {
  const form = await request.formData();
  const file = form.get("file");
  const language = String(form.get("language") || "hi-IN");
  if (!(file instanceof File)) return json({ ok: false, error: "No file was uploaded." }, 400);
  if (!ALLOWED_FILE_TYPES.has(file.type)) return json({ ok: false, error: "Only PDF, PNG and JPG/JPEG files are supported." }, 400);
  if (file.size > MAX_FILE_SIZE) return json({ ok: false, error: "File is larger than 50 MB." }, 400);
  if (!validDocumentLanguage(language)) return json({ ok: false, error: "Unsupported document language." }, 400);
  const uploadForm = new FormData();
  uploadForm.append("file", file, file.name || "document");
  uploadForm.append("language", language);
  uploadForm.append("output_format", "md");
  try {
    const response = await apiFetch(`${API}/doc-ai/v1/job/digitise`, {
      method: "POST",
      headers: { "api-subscription-key": await sarvamKey(env) },
      body: uploadForm
    });
    const data = await response.json();
    if (!data?.job_id) {
      return json({ ok: false, error: "Sarvam did not return a job ID." }, 502);
    }
    await recordUsage(env, { docs: 1 });
    return json({
      ok: true,
      jobId: data.job_id,
      status: data.status,
      name: file.name,
      language
    });
  } catch (error) {
    console.error("Upload failed:", error);
    return json({
      ok: false,
      error:
        "Upload step failed: " + error.message +
        " — Sarvam's document service is temporarily unavailable. " +
        "Wait a minute and try again, or try a smaller file."
    }, 502);
  }
}
/* =========================================================
   DOCUMENT STATUS
   ========================================================= */
const normalizeStatus = s => String(s || "").toLowerCase().replace(/[\s-]+/g, "_");
const isTerminalStatus = s => ["completed", "partially_completed", "failed", "rejected"].includes(normalizeStatus(s));
async function handleDocumentStatus(request, env) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9-]{8,100}$/.test(jobId)) {
    return json({ ok: false, error: "Invalid jobId." }, 400);
  }
  const headers = { "api-subscription-key": await sarvamKey(env) };
  /* ---- status (temporary errors = keep polling) ---- */
  let statusData;
  try {
    const statusResponse = await apiFetch(
      `${API}/doc-ai/v1/job/${encodeURIComponent(jobId)}/status`,
      { method: "GET", headers },
1
    );
    statusData = await statusResponse.json();
  } catch (error) {
    console.error("Status check failed (will retry):", error);
    return json({ ok: true, done: false, status: "retrying" });
  }
  const status = statusData?.status || statusData?.job_state || "unknown";
  if (!isTerminalStatus(status)) {
    return json({ ok: true, done: false, status });
  }
  const normalized = normalizeStatus(status);
  if (normalized === "failed" || normalized === "rejected") {
    return json({
      ok: false, done: true, status,
      error:
        statusData?.error_message ||
        statusData?.error?.message ||
        "Sarvam could not process the document."
    }, 422);
  }
  /* ---- download ---- */
  try {
    const downloadResponse = await apiFetch(
      `${API}/doc-ai/v1/job/${encodeURIComponent(jobId)}/download-url`,
      { method: "GET", headers }
    );
    const downloadData = await downloadResponse.json();
    const downloadUrl =
      downloadData?.download_url ||
      downloadData?.url ||
      downloadData?.downloadUrl ||
      downloadData?.data?.download_url ||
      downloadData?.data?.url;
    if (!downloadUrl) {
      return json({
        ok: false, done: true, status,
        error: "Sarvam completed the job but did not return a download URL."
      }, 502);
    }
    const outputResponse = await apiFetch(downloadUrl, { method: "GET" });
    const bytes = new Uint8Array(await outputResponse.arrayBuffer());
    const result = await extractSarvamZip(bytes);
    if (!result.text.trim()) {
      return json({
        ok: false, done: true, status,
        error: "Sarvam processed the document, but no readable text was found.",
        files: result.files
      }, 422);
    }
    return json({ ok: true, done: true, status, text: result.text, files: result.files });
  } catch (error) {
    console.error("Download step failed:", error);
    return json({
      ok: false, done: true, status,
      error: "Download step failed: " + error.message
    }, 502);
  }
}
/* =========================================================
   ZIP EXTRACTION
   ========================================================= */
async function extractSarvamZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = o => view.getUint16(o, true);
  const u32 = o => view.getUint32(o, true);
  function findEOCD() {
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    return -1;
  }
  async function inflateRaw(compressed) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const eocd = findEOCD();
  if (eocd < 0) throw new Error("Sarvam returned an invalid ZIP output.");
  const entryCount = u16(eocd + 10);
  const cdOffset = u32(eocd + 16);
  if (entryCount === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 output is not supported.");
  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > bytes.length || u32(pos) !== 0x02014b50) break;
    const flags = u16(pos + 8);
    const method = u16(pos + 10);
    const compressedSize = u32(pos + 20);
    const nameLen = u16(pos + 28);
    const extraLen = u16(pos + 30);
    const commentLen = u16(pos + 32);
    const localOffset = u32(pos + 42);
    const name = new TextDecoder("utf-8").decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    entries.push({ name, flags, method, compressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  const files = [];
  const textFiles = [];
  for (const entry of entries) {
    if (!entry.name || entry.name.endsWith("/")) continue;
    if (entry.flags & 1) continue;
    const local = entry.localOffset;
    if (local + 30 > bytes.length || u32(local) !== 0x04034b50) continue;
    const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > bytes.length) continue;
    const compressed = bytes.slice(dataStart, dataEnd);
    let data;
    try {
      if (entry.method === 0) data = compressed;
      else if (entry.method === 8) data = await inflateRaw(compressed);
      else continue;    } catch { continue; }
    files.push(entry.name);
    const lower = entry.name.toLowerCase();
    const readable = [".md", ".markdown", ".txt", ".html", ".htm", ".json"].some(e => lower.endsWith(e));
    if (!readable) continue;
    try {
      const text = new TextDecoder("utf-8").decode(data).trim();
      if (text) textFiles.push({ name: entry.name, text });
    } catch {}
  }
  const markdown = textFiles.filter(f => {
    const l = f.name.toLowerCase();
    return l.endsWith(".md") || l.endsWith(".markdown");
  });
  const selected = markdown.length ? markdown : textFiles;
  return { text: selected.map(f => f.text).join("\n\n---\n\n"), files };
}
/* =========================================================
   FRONTEND  (ROYAL UI v16 + LOCK SCREEN)
   ========================================================= */
function buildHTML(unlocked) {
  const langNames = JSON.stringify(
    Object.fromEntries(
      DOCUMENT_LANGUAGES.map(i => [i[0], i[1].split(" — ")[0]])
    )
  );
  const docLangs = JSON.stringify(DOCUMENT_LANGUAGES);
  const mayuraList = JSON.stringify([...MAYURA_LANGS]);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0">
<meta name="theme-color" content="#E8742C">
<title>MindFusion · A hub for different AI models</title>
<script>
/* runs before the page is painted: no colour / layout flash */
(function () {
  try {
    var root = document.documentElement;
    var p = localStorage.getItem("sarvam_ai_palette_v1");
    var v = localStorage.getItem("sarvam_ai_view_v1") || "auto";
    if (["loop", "pixel", "royal"].indexOf(p) < 0) p = "loop";
    if (["auto", "mobile", "web"].indexOf(v) < 0) v = "auto";
    root.setAttribute("data-palette", p);
    root.setAttribute("data-view", v);
    root.setAttribute("data-layout", v === "auto" ? (window.innerWidth <= 760 ? "mobile" : "web") : v);
    if (v === "web" && Math.min(screen.width, screen.height) <= 820) {
      document.querySelector('meta[name="viewport"]').setAttribute("content", "width=1100");
    }
  } catch (e) {}
})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700;800&family=Tinos:ital,wght@1,700&display=swap" rel="stylesheet">
<style>
/* =====================================================
   COLOUR THEMES  (default = Royal Saffron)
   Every colour of the UI comes from these variables.
   ===================================================== */
:root{
  --primary:#C9432E;--orange:#E8742C;--saffron:#F2A93B;--teal:#2BA6A0;--blue:#2F6FB5;
  --gold:#D9A441;--golddk:#C9962E;--gold2:#E9B949;--cream:#FBF1DC;--deep:#B5361F;--gatebg:#FFF8EA;
  --sa:242,169,59;--te:43,166,160;--pr:201,67,46;--or:232,116,44;--gd:217,164,65;
  --bd-l:170,115,40;--bd-d:233,185,73;--sh:120,70,20;
  --bg-l:#fffaf1;--bg-d:#15100c;--sol-l:255,253,248;--sol-d:31,23,17;
  --txt-l:#2a1d14;--txt-d:#f7ecd9;--mut-l:#8a7a68;--mut-d:#b4a48e;
  --w1l:rgba(214,208,255,.80);--w2l:rgba(255,205,178,.90);--w1d:rgba(80,70,150,.35);--w2d:rgba(160,80,40,.30);
}
html[data-palette="pixel"]{
  --primary:#E8742C;--orange:#F2A93B;--saffron:#F7CE6B;--teal:#2f9e44;--blue:#3A5FD0;
  --gold:#C9962E;--golddk:#B08D2E;--gold2:#E9B949;--cream:#FBF1DC;--deep:#C2410C;--gatebg:#FFF8EA;
  --sa:247,206,107;--te:47,158,68;--pr:232,116,44;--or:242,169,59;--gd:201,150,46;
  --bd-l:150,105,40;--bd-d:233,185,73;--sh:120,70,20;
  --bg-l:#FBF1DC;--bg-d:#171208;--sol-l:255,252,244;--sol-d:32,26,16;
  --txt-l:#3b2a14;--txt-d:#f7ecd9;--mut-l:#8a7a58;--mut-d:#b4a48e;
  --w1l:rgba(247,206,107,.85);--w2l:rgba(255,205,178,.90);--w1d:rgba(120,80,20,.35);--w2d:rgba(160,80,40,.30);
}
/* =====================================================
   LOOP GLOW  (the design the user picks) — v7  ·  b57
   -----------------------------------------------------
   What changed from v2 (b52), from your screenshot:
   · The Meta-style round mark and its round ring are GONE, exactly as asked.
     The page background — the five drifting colour glows, the side ribbons
     and the calm dark mode — stays exactly as it was.
   · The word **MindFusion** is FAT and FURRY now: felt letters with a fabric
     weave in them.
   · TWO plush birds fly round it instead of the owl — one coral, one teal.
     Their wings move the way a real bird's do: a long power stroke with the
     wing stretched out and the primaries locked into one wall, then a quick
     recovery stroke with the wing folded at the wrist and the feathers split
     to let the air through. The wingtip lags the shoulder, the body bobs
     against the wings, the tail flares — every 5.6 seconds, for ever.
   · Everything he does is a CSS transform animation on a few SVG groups —
     no script runs per frame and nothing repaints the page, so it stays
     smooth on a phone (no lag).
   · The tag line stays below the word, so no letter crosses anything.
   ===================================================== */
html[data-palette="loop"]{
  --primary:#0A66FF;--orange:#1C8CFF;--saffron:#FFC53D;--teal:#12BFA6;--blue:#0A66FF;
  --gold:#F5B942;--golddk:#E0A32F;--gold2:#FFD166;--cream:#F3F8FF;--deep:#0846C4;--gatebg:#F7FBFF;
  --sa:255,197,61;--te:18,191,166;--pr:10,102,255;--or:28,140,255;--gd:245,185,66;
  --bd-l:120,155,215;--bd-d:150,180,255;--sh:30,70,150;
  --bg-l:#F5FAFF;--bg-d:#070C1A;--sol-l:255,255,255;--sol-d:19,26,46;
  --txt-l:#121A2B;--txt-d:#EEF4FF;--mut-l:#64748F;--mut-d:#A7B5D3;
  --w1l:rgba(10,102,255,.20);--w2l:rgba(255,95,162,.18);
  --w1d:rgba(10,102,255,.22);--w2d:rgba(255,95,162,.14);
  --royal-photo:none;
  /* 0.50 speed — everything that moves here moves at half speed */
  --loop-speed:.5;
}
/* ---- the drifting colour glow: blue · yellow · pink · red · green ---- */
html[data-palette="loop"] #royal-bg{
  background-color:#F7FBFF;
  background-image:
    radial-gradient(46% 34% at 10% 6%,rgba(10,102,255,.30),transparent 70%),
    radial-gradient(44% 32% at 90% 3%,rgba(255,197,61,.34),transparent 70%),
    radial-gradient(48% 36% at 84% 94%,rgba(255,95,162,.26),transparent 70%),
    radial-gradient(44% 34% at 12% 92%,rgba(255,90,90,.22),transparent 70%),
    radial-gradient(56% 46% at 50% 52%,rgba(18,191,166,.20),transparent 72%);
  background-size:150% 150%;background-position:50% 50%;inset:-16%;will-change:transform;
  animation:lpFlow 26s ease-in-out infinite alternate;
}
html[data-palette="loop"] body.dark #royal-bg{
  background-color:#070C1A;
  background-image:
    radial-gradient(46% 34% at 10% 6%,rgba(10,102,255,.30),transparent 70%),
    radial-gradient(44% 32% at 90% 3%,rgba(255,197,61,.16),transparent 70%),
    radial-gradient(48% 36% at 84% 94%,rgba(255,95,162,.18),transparent 70%),
    radial-gradient(44% 34% at 12% 92%,rgba(255,90,90,.16),transparent 70%),
    radial-gradient(56% 46% at 50% 52%,rgba(18,191,166,.15),transparent 72%);
}
@keyframes lpFlow{
  0%{transform:translate3d(-3%,-2%,0) scale(1.04)}
  35%{transform:translate3d(4%,2%,0) scale(1.12)}
  70%{transform:translate3d(-2%,4%,0) scale(1.06)}
  100%{transform:translate3d(3%,-3%,0) scale(1.14)}
}
/* the chat stays calm and readable: the glow is dimmed, never gone */
html[data-palette="loop"] body.chatting #royal-bg{opacity:.62;transition:opacity .45s ease}
/* side ribbons in the same five colours */
html[data-palette="loop"] .royal-frame{width:min(100%,100vw)}
html[data-palette="loop"] .pillar{
  width:10px;opacity:.55;border:0;border-radius:0 999px 999px 0;
  background:linear-gradient(180deg,#0A66FF,#FFC53D 26%,#FF5FA2 52%,#12BFA6 76%,#FF5A5A 100%);
  box-shadow:0 0 20px rgba(10,102,255,.30);
}
html[data-palette="loop"] .pillar.l{border-right:0}
html[data-palette="loop"] .pillar.r{border-left:0;border-radius:999px 0 0 999px}
/* this design shows the mark and the “Ask anything…” line — no name, no cards */
html[data-palette="loop"] .shortcuts{display:none !important}
html[data-palette="loop"] .script-title{display:none}
html[data-palette="loop"] .gate-hero>svg{visibility:hidden}
/* the old halo is off: the mascot brings its own soft glow */
html[data-palette="loop"] .gate-hero::before{background:none}
/* the tag line goes BELOW the mascot and the word, so nothing crosses them */
html[data-palette="loop"] .gate-inner{top:auto;bottom:1%;height:auto;width:92%}
html[data-palette="loop"] .gate-inner .gate-logo{display:none}
html[data-palette="loop"] .gate-inner p{
  margin:0 auto;max-width:36ch;font-size:clamp(12px,3.1vw,14.5px);line-height:1.5;
  color:var(--muted);opacity:.92}
/* ---- the stage: the mascot on top of the word, inside the hero ---- */
.mf-hero{display:none}
html[data-palette="loop"] .mf-hero{
  display:grid;place-items:center;position:absolute;left:0;right:0;top:0;bottom:0;
  pointer-events:none;
}
.mf-stage{position:relative;display:flex;flex-direction:column;align-items:center;padding-bottom:7%;
  font-size:clamp(30px,9.2vw,50px)}
/* a soft, edge-less glow behind them — no circle, just light */
.mf-bloom{position:absolute;left:50%;top:46%;width:min(90vw,430px);aspect-ratio:1/1;
  transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(closest-side,rgba(10,102,255,.24),rgba(255,95,162,.12) 52%,rgba(18,191,166,.06) 72%,rgba(18,191,166,0) 84%);
  filter:blur(30px);
  animation:mfGlow 7s ease-in-out infinite;animation-duration:calc(3.5s / var(--loop-speed))}
@keyframes mfGlow{
  0%,100%{opacity:.75;transform:translate(-50%,-50%) scale(.94)}
  50%{opacity:1;transform:translate(-50%,-50%) scale(1.06)}
}
/* the fur filters live in an inline SVG: it has to stay in the layout (never
   display:none) or every url(#…) reference above would drop out */
.mf-furdefs{position:absolute;left:0;top:0;width:0;height:0;overflow:hidden}


/* =====================================================
   LOOP GLOW  (the default design) — v7  ·  b57
   -----------------------------------------------------
   · The birds are gone.  In the hero: the furry brand word “MindFusion” —
     thick rounded letters, one brand colour each (blue / red / yellow / green),
     every one with a hairy edge cut by a fine turbulence filter.  The word
     sways in a breeze and loose fur strands drift off it.
   · A thin root hangs from the last “n” with a golden honeycomb, hexagon cells
     and a honey drop; the root and the comb sway.
   · Eight bees fly endless loops around the hive — each one its own path,
     speed and phase, wings beating, smooth and seamless.
   · Everything is CSS transforms on a handful of groups: no script per frame,
     so it stays at 60 fps on a phone.
   ===================================================== */
/* ---- the furry word ---- */
.mf-brandwrap{position:relative;display:block;z-index:9}
.mf-furdefs{position:absolute;left:0;top:0;width:0;height:0;overflow:hidden}
.mf-brand{display:block;width:min(94vw,860px);height:auto;overflow:visible;
  margin:0 auto;filter:drop-shadow(0 5px 12px rgba(30,70,160,.13))}
.mf-brand text{font-family:'Baloo 2','Nunito','Trebuchet MS',Inter,system-ui,sans-serif;
  font-weight:900;font-size:96px;text-anchor:middle;paint-order:stroke fill;
  stroke-linejoin:round;stroke-linecap:round}
.mf-fur-face{stroke-width:2.6}
.mf-fur-hi{stroke-width:0}
/* fur in a breeze: each letter leans a hair, the whole word breathes */
.mf-gl{transform-box:view-box;transform-origin:50% 50%;animation:mfGlSway 7.4s ease-in-out infinite}
@keyframes mfGlSway{
  0%,100%{transform:rotate(-.7deg) translateY(0)}
  50%{transform:rotate(.8deg) translateY(-1.6px)}
}
.mf-word-fur{transform-box:view-box;transform-origin:50% 50%;animation:mfFurBreeze 9.6s ease-in-out infinite}
@keyframes mfFurBreeze{
  0%,100%{transform:rotate(-.35deg) scale(1)}
  50%{transform:rotate(.45deg) scale(1.012)}
}
/* loose fur drifting away */
.mf-strand{fill:none;stroke-width:2.1;stroke-linecap:round;opacity:0;
  animation:mfStrand 9.3s ease-out infinite}
@keyframes mfStrand{
  0%{opacity:0;transform:translate(0,0)}
  12%{opacity:.72}
  60%{opacity:.42}
  100%{opacity:0;transform:translate(16px,-26px) rotate(14deg)}
}
/* ---- the root, the leaves, the comb ---- */
.mf-hive-wrap{transform-box:view-box;transform-origin:252px 44px}
.mf-hive{transform-box:view-box;transform-origin:0 0;animation:mfHiveSway 6.4s ease-in-out infinite}
@keyframes mfHiveSway{
  0%,100%{transform:rotate(-2.1deg)}
  50%{transform:rotate(2.4deg)}
}
.mf-root{fill:none;stroke:#6E5A2E;stroke-width:3.1;stroke-linecap:round}
.mf-root.lite{stroke:#9A8143;stroke-width:1.5;opacity:.85}
.mf-leaf{fill:#4E9A3F;stroke:#2F6E28;stroke-width:1.1}
.mf-leaf.vein{fill:none;stroke:#9FD08F;stroke-width:1.1;stroke-linecap:round}
.mf-leaves{transform-box:view-box;transform-origin:0 0;animation:mfLeafSway 5.2s ease-in-out infinite}
@keyframes mfLeafSway{0%,100%{transform:rotate(2.6deg)}50%{transform:rotate(-3.2deg)}}
.mf-comb{transform-box:view-box}
.mf-comb-wax{fill:#F5AE22;stroke:none}
.mf-cell{fill:#FFD873;stroke:#9C6402;stroke-width:1.35}
.mf-cell.mf-cell-honey{fill:#FFB200;stroke:#8C5A06}
.mf-honey-pool circle{fill:#FFC02E;opacity:.85}
.mf-honey{fill:#FFB200;stroke:#C98A10;stroke-width:1}
.mf-comb{filter:drop-shadow(0 3px 4px rgba(120,80,10,.28))}
.mf-comb-lip{fill:none;stroke:#C8860C;stroke-width:1.5;opacity:.55}
.mf-bee-tail{fill:none;stroke:#1C1C1C;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.mf-bee-ant{fill:none;stroke:#1C1C1C;stroke-width:1.1;stroke-linecap:round}
.mf-bee-leg{fill:none;stroke:#231F1A;stroke-width:1.2;stroke-linecap:round}
.mf-wing ellipse{fill:#EAF4FF;fill-opacity:.62;stroke:#AFC7DE;stroke-width:.7}
.mf-comb-wax{fill:#F4AE1E}
.mf-comb-side{fill:#DE9612}
.mf-comb-edge{fill:none;stroke:#9B6003;stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round}
.mf-comb-shine{fill:none;stroke:#FFF1B8;stroke-width:3.4;stroke-linecap:round;opacity:.5}
.mf-cell{fill:#FFD86B;stroke:#C8860A;stroke-width:1.15;stroke-linejoin:round;
  animation:mfCell 4.6s ease-in-out infinite}
.mf-cell.mf-cell-honey{fill:#FFB300;stroke:#C98600}
@keyframes mfCell{0%,100%{opacity:.94}50%{opacity:1}}
.mf-honey-pool circle{fill:#FFC02E;opacity:.7}
.mf-honey{fill:#FFB000;opacity:.95}
.mf-honey-drip{fill:#FFC02E;animation:mfDrip 5.4s ease-in-out infinite}
@keyframes mfDrip{0%,72%,100%{transform:translateY(0) scaleY(1)}85%{transform:translateY(4px) scaleY(1.16)}}
/* ---- the eight bees: their own loop each, their own speed each ---- */
.mf-bee{transform-box:view-box}
.mf-bee-0{animation:mfBee0 6.4s linear infinite;animation-delay:-1.2s}
.mf-bee-1{animation:mfBee1 7.8s linear infinite;animation-delay:-3.4s}
.mf-bee-2{animation:mfBee2 5.9s linear infinite;animation-delay:-2.1s}
.mf-bee-3{animation:mfBee3 8.5s linear infinite;animation-delay:-5.6s}
.mf-bee-4{animation:mfBee4 6.9s linear infinite;animation-delay:-4.2s}
.mf-bee-5{animation:mfBee5 7.2s linear infinite;animation-delay:-0.7s}
.mf-bee-6{animation:mfBee6 5.6s linear infinite;animation-delay:-6.3s}
.mf-bee-7{animation:mfBee7 8.1s linear infinite;animation-delay:-2.8s}
.mf-bee-bob{transform-box:view-box;transform-origin:0 0;animation:mfBeeBob .58s ease-in-out infinite alternate}
.mf-bee-1 .mf-bee-bob{animation-delay:-.13s}
.mf-bee-2 .mf-bee-bob{animation-delay:-.29s}
.mf-bee-3 .mf-bee-bob{animation-delay:-.41s}
.mf-bee-4 .mf-bee-bob{animation-delay:-.07s}
.mf-bee-5 .mf-bee-bob{animation-delay:-.34s}
.mf-bee-6 .mf-bee-bob{animation-delay:-.19s}
.mf-bee-7 .mf-bee-bob{animation-delay:-.47s}
@keyframes mfBeeBob{from{transform:translateY(-1.4px) rotate(-4deg)}to{transform:translateY(1.6px) rotate(4deg)}}
.mf-wing{transform-box:view-box;animation:mfWingB .1s linear infinite alternate}
.mf-wing-r{animation-delay:-.05s}
@keyframes mfWingB{from{transform:scaleY(1)}to{transform:scaleY(.35)}}
.mf-wing ellipse{fill:#EAF4FF;opacity:.72;stroke:#9FC4E8;stroke-width:.5}
.mf-bee-body{fill:#2B2B2B}
.mf-bee-band{fill:none;stroke:#FFC53D;stroke-width:1.7;stroke-linecap:round}
.mf-bee-head{fill:#1C1C1C}
.mf-bee-eye{stroke:#FFD873;stroke-width:.9;stroke-linecap:round}
@keyframes mfBee0{
  0%{transform:translate(-162.33px,69.27px)}
  25%{transform:translate(-193.22px,93.81px)}
  50%{transform:translate(-229.67px,78.73px)}
  75%{transform:translate(-198.78px,54.19px)}
  100%{transform:translate(-162.33px,69.27px)}
}
@keyframes mfBee1{
  0%{transform:translate(-54.31px,127.12px)}
  25%{transform:translate(-99.17px,147.81px)}
  50%{transform:translate(-137.69px,116.88px)}
  75%{transform:translate(-92.83px,96.19px)}
  100%{transform:translate(-54.31px,127.12px)}
}
@keyframes mfBee2{
  0%{transform:translate(43.3px,52.75px)}
  25%{transform:translate(10.2px,81.6px)}
  50%{transform:translate(-31.3px,67.25px)}
  75%{transform:translate(1.8px,38.4px)}
  100%{transform:translate(43.3px,52.75px)}
}
@keyframes mfBee3{
  0%{transform:translate(131.56px,137.63px)}
  25%{transform:translate(92.25px,155.7px)}
  50%{transform:translate(60.44px,126.37px)}
  75%{transform:translate(99.75px,108.3px)}
  100%{transform:translate(131.56px,137.63px)}
}
@keyframes mfBee4{
  0%{transform:translate(219.83px,48.17px)}
  25%{transform:translate(177.92px,73.92px)}
  50%{transform:translate(132.17px,55.83px)}
  75%{transform:translate(174.08px,30.08px)}
  100%{transform:translate(219.83px,48.17px)}
}
@keyframes mfBee5{
  0%{transform:translate(289.78px,180.18px)}
  25%{transform:translate(247.28px,201.86px)}
  50%{transform:translate(210.22px,171.82px)}
  75%{transform:translate(252.72px,150.14px)}
  100%{transform:translate(289.78px,180.18px)}
}
@keyframes mfBee6{
  0%{transform:translate(329.63px,147.31px)}
  25%{transform:translate(303.13px,171.75px)}
  50%{transform:translate(270.37px,156.69px)}
  75%{transform:translate(296.87px,132.25px)}
  100%{transform:translate(329.63px,147.31px)}
}
@keyframes mfBee7{
  0%{transform:translate(347.52px,72.57px)}
  25%{transform:translate(321.43px,89.52px)}
  50%{transform:translate(304.48px,63.43px)}
  75%{transform:translate(330.57px,46.48px)}
  100%{transform:translate(347.52px,72.57px)}
}
/* ---- a narrow phone: the placeholder stays on ONE line, it never wraps ---- */
#input::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* ---- New chat: the symbol only, in EVERY design (and any design added later) ---- */
.new-chat-txt{display:none !important}
.new-chat-btn{width:40px !important;height:40px !important;padding:0 !important;gap:0 !important;
  border-radius:12px !important}
.new-chat-btn svg{width:19px !important;height:19px !important}
/* ---- the word sits a little lower, with the tag line under it ---- */
html[data-palette="loop"] .gate-inner{bottom:2%}
/* ---- the panel: one heading per section, never two ---- */
#modelMenu .mf-sec{margin:10px 0 4px;padding-top:9px;border-top:1px solid rgba(var(--bd-l),.22)}
#replyWrap{display:none}
#modelMenu #replyMenu{position:static;display:block;width:auto;
  max-height:none;overflow:visible;padding:0;margin:0;border:0;border-radius:0;
  background:none;box-shadow:none;animation:none}
#modelMenu #replyMenu .model-menu-title{display:none}
#modelMenu .mf-voice-row{display:flex;align-items:center;gap:9px;padding:2px 4px 6px}
#modelMenu .voice-lang{display:flex;flex:1 1 auto;min-width:0;margin:0}
#modelMenu .voice-lang select{flex:1 1 auto;min-width:0}
/* ---- the image strip: size only, no Generate button ---- */
#imgBtn{display:none !important}
#stripImage .strip-hint{opacity:.85}
/* ---- Save as default, in Settings ---- */
.mf-default-row{display:flex;align-items:center;gap:9px;margin:10px 0 2px;flex-wrap:wrap}
.mf-default-btn{border:1.5px solid rgba(var(--bd-l),.5);background:var(--solid);color:var(--text);
  border-radius:12px;padding:8px 14px;font:700 12.5px/1 inherit;cursor:pointer;
  transition:transform .15s ease,background .2s ease}
.mf-default-btn:hover{background:rgba(var(--pr),.10)}
.mf-default-btn:active{transform:scale(.97)}
.mf-default-btn.on{background:rgba(18,191,166,.16);border-color:rgba(18,191,166,.6)}
.mf-default-note{font-size:11.5px;color:var(--mut-l);font-weight:600}
html[data-theme="dark"] .mf-default-note{color:var(--mut-d)}
/* ---- reduce motion: everything settles, nothing is lost ---- */
@media (prefers-reduced-motion:reduce){
  html[data-palette="loop"] #royal-bg,
  html[data-palette="loop"] .mf-bloom,
  html[data-palette="loop"] .mf-brand,
  html[data-palette="loop"] .mf-gl,
  html[data-palette="loop"] .mf-word-fur,
  html[data-palette="loop"] .mf-strand,
  html[data-palette="loop"] .mf-hive,
  html[data-palette="loop"] .mf-leaves,
  html[data-palette="loop"] .mf-cell,
  html[data-palette="loop"] .mf-honey-drip,
  html[data-palette="loop"] .mf-bee,
  html[data-palette="loop"] .mf-bee-bob,
  html[data-palette="loop"] .mf-wing{animation:none}
}
#modelMenu .mf-voice-row{display:flex;align-items:center;gap:9px;padding:2px 4px 6px}
#modelMenu .voice-lang{display:flex;flex:1 1 auto;min-width:0;margin:0}
#modelMenu .voice-lang select{flex:1 1 auto;min-width:0}
html[data-palette="loop"] #modelBtn .caret{opacity:.8}
/* ---- smooth + glowing everywhere (the whole app, all three designs) ---- */
html{scroll-behavior:smooth}
.icon-btn,.model-btn,.mini-btn,.history-item,.pal-item,.model-item,.send-btn{
  transition:transform .16s ease,box-shadow .3s ease,background .22s ease,border-color .22s ease}
.icon-btn:active,.model-btn:active,.mini-btn:active,.send-btn:active{transform:scale(.96)}
.history-item:hover,.pal-item:hover,.model-item:hover{box-shadow:0 6px 20px rgba(10,102,255,.14)}
.model-menu.show,.reply-menu.show,.pal-menu.show,.mf-menu.show{animation:mfPop .17s ease-out}
@keyframes mfPop{
  from{opacity:0;transform:translateY(6px) scale(.985)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
@media (prefers-reduced-motion:reduce){
  html[data-palette="loop"] #royal-bg,
  html[data-palette="loop"] .mf-bloom,
  html[data-palette="loop"] .mf-word,
  html[data-palette="loop"] .mf-word::after{animation:none}
}
:root{
  --green:#1f9d74;
  --g-main:linear-gradient(135deg,var(--orange),var(--primary));
  --g-warm:linear-gradient(135deg,var(--saffron),var(--primary));
  --g-cool:linear-gradient(135deg,var(--teal),var(--blue));
  --g-on:linear-gradient(135deg,var(--teal),var(--green));
  --g-title:linear-gradient(100deg,var(--deep),var(--orange) 55%,var(--primary));
  --g-icon:linear-gradient(135deg,rgba(var(--sa),.28),rgba(var(--te),.22));
  --script:"Times New Roman",Tinos,Times,"Liberation Serif","Noto Sans Bengali","Noto Sans Devanagari",serif;
  --serif:"Cormorant Garamond","Noto Serif Bengali",Georgia,serif;
  --dock-h:190px;
  --col:100%;
  /* Optional: put your Taj Mahal picture URL here (it stays very light) */
  /* --royal-photo:url("https://YOUR-HOST/taj.jpg"); */
  --royal-photo:none;
  --scallop-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='10' viewBox='0 0 24 10'%3E%3Cpath d='M0 0H24V2C20 3 16 7 12 10 8 7 4 3 0 2Z'/%3E%3C/svg%3E");
}
html[data-view="mobile"]{--col:440px}
body{
  --bg:var(--bg-l);--solid:rgb(var(--sol-l));--surface:rgba(var(--sol-l),.90);
  --text:var(--txt-l);--muted:var(--mut-l);--border:rgba(var(--bd-l),.24);
  --shadow:0 12px 36px rgba(var(--sh),.14);
  --wash1:var(--w1l);--wash2:var(--w2l);--photo-opacity:.14;
}
body.dark{
  --bg:var(--bg-d);--solid:rgb(var(--sol-d));--surface:rgba(var(--sol-d),.92);
  --text:var(--txt-d);--muted:var(--mut-d);--border:rgba(var(--bd-d),.24);
  --shadow:0 12px 36px rgba(0,0,0,.45);
  --wash1:var(--w1d);--wash2:var(--w2d);--photo-opacity:.08;
}
*{box-sizing:border-box}
html{overflow-x:hidden}
html,body{margin:0;padding:0;width:100%;min-height:100%}
body{overflow-x:clip;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--bg);transition:background .25s ease,color .25s ease}
button,select,textarea,input{font:inherit}
button{cursor:pointer}
.is-hidden{display:none !important}
/* ---------- soft background + heritage side pillars ---------- */
#royal-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;
  background:radial-gradient(ellipse 75% 42% at 10% 0%,var(--wash1),transparent 72%),radial-gradient(ellipse 75% 42% at 85% -5%,var(--wash2),transparent 72%),var(--bg)}
#royal-bg .royal-photo{position:absolute;inset:0;background-image:var(--royal-photo);background-size:cover;background-position:center;opacity:var(--photo-opacity);filter:saturate(.8) blur(1px)}
.royal-frame{position:absolute;top:0;bottom:0;left:50%;width:min(100%,820px);transform:translateX(-50%)}
.pillar{position:absolute;top:0;bottom:0;width:16px;opacity:.78;
  background:radial-gradient(circle at 50% 50%,var(--primary) 0 1.4px,transparent 1.7px),radial-gradient(circle at 50% 50%,var(--saffron) 0 3.4px,transparent 3.7px),var(--teal);
  background-size:16px 16px}
.pillar.l{left:0;border-right:3px solid var(--gold2)}
.pillar.r{right:0;border-left:3px solid var(--gold2)}
.app{position:relative;z-index:1;width:100%;overflow-x:clip}
/* ---------- top bar ---------- */
.topbar{height:60px;position:sticky;top:0;z-index:30;transition:background .2s ease}
.topbar-in{width:min(100%,820px);height:100%;margin:0 auto;padding:0 26px;display:flex;align-items:center;justify-content:space-between;gap:8px}
body.chatting .topbar{background:var(--surface);backdrop-filter:blur(14px);border-bottom:2px solid var(--gold)}
body.chatting .topbar::after{content:"";position:absolute;left:0;right:0;top:100%;height:10px;background:var(--gold2);-webkit-mask-image:var(--scallop-mask);mask-image:var(--scallop-mask);-webkit-mask-repeat:repeat-x;mask-repeat:repeat-x;-webkit-mask-position:center top;mask-position:center top;-webkit-mask-size:24px 10px;mask-size:24px 10px;pointer-events:none}
.brand{display:none;align-items:center;gap:8px;min-width:0}
body.chatting .brand{display:flex}
.brand-mark{width:26px;height:26px;flex:0 0 auto}
.brand-main{font-family:var(--script);font-style:italic;font-weight:700;font-size:21px;line-height:1;white-space:nowrap}
.brand-sub{display:block;font-size:10px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:56vw}
.top-actions{display:flex;gap:6px}
.icon-btn{width:38px;height:38px;padding:0;border:1px solid var(--border);border-radius:50%;color:var(--text);background:var(--solid);display:grid;place-items:center;transition:transform .15s ease,box-shadow .15s ease}
.icon-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(var(--sh),.15)}
.icon-btn svg{width:19px;height:19px}
/* ---------- main / hero gate (centered, soft halo) ---------- */
.main{width:min(760px,calc(100% - 44px));margin-left:auto;margin-right:auto;padding:6px 0 calc(var(--dock-h) + 24px)}
.hero{position:relative;display:flex;justify-content:center;text-align:center;margin:0 auto 6px;width:100%}
.gate-hero{position:relative;width:min(100%,440px);margin:0 auto}
.gate-hero::before{content:"";position:absolute;left:-6%;right:-6%;top:4%;bottom:-2%;z-index:0;pointer-events:none;
  background:radial-gradient(ellipse 58% 56% at 50% 52%,rgba(var(--sa),.30) 0%,rgba(var(--te),.13) 46%,transparent 74%)}
body.dark .gate-hero::before{background:radial-gradient(ellipse 58% 56% at 50% 52%,rgba(var(--sa),.22) 0%,rgba(var(--te),.10) 46%,transparent 74%)}
.gate-hero>svg{position:relative;z-index:1;display:block;width:100%;height:auto;margin:0 auto;filter:drop-shadow(0 10px 18px rgba(var(--sh),.22));-webkit-mask-image:linear-gradient(180deg,#000 88%,transparent 100%);mask-image:linear-gradient(180deg,#000 88%,transparent 100%)}
.gate-inner{position:absolute;z-index:2;left:50%;width:70%;transform:translateX(-50%);top:49%;bottom:9%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.gate-logo{width:clamp(38px,11vw,52px);height:clamp(38px,11vw,52px);margin:0 auto 2px}
.script-title{margin:0;padding:0 .15em .1em;text-align:center;font-family:var(--script);font-style:italic;font-weight:700;font-size:clamp(30px,8.6vw,44px);line-height:1.12;background:var(--g-title);-webkit-background-clip:text;background-clip:text;color:transparent}
.gate-inner p{margin:4px 0 0;text-align:center;font-size:clamp(11px,2.9vw,13px);line-height:1.45;color:var(--txt-l);opacity:.78}
/* sparkle canvas: lives INSIDE the hero, so it can never reach the
   top buttons or the chat area (they sit above / outside it) */
#fxCanvas{position:absolute;left:0;top:0;width:100%;height:100%;z-index:3;pointer-events:none;display:block}
/* gate artwork colours (follow the theme) */
.g-teal{fill:var(--teal);stroke:var(--golddk);stroke-width:3}
.g-cream{fill:var(--cream);stroke:var(--gold);stroke-width:2}
.g-pat{fill:url(#flo);opacity:.6}
.g-blue{fill:var(--blue);stroke:var(--cream);stroke-width:2;stroke-dasharray:1 6;stroke-linecap:round}
.g-saf{fill:var(--saffron);stroke:var(--primary);stroke-width:2}
.g-red{fill:var(--primary)}
.g-in{fill:var(--gatebg);stroke:var(--gold);stroke-width:2}
.pf1{fill:var(--primary)}
.pf2{fill:var(--cream)}
.pf3{fill:none;stroke:var(--teal);stroke-width:1;stroke-linecap:round}
/* ---------- four sample cards ---------- */
.shortcuts{display:grid;width:100%;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
.shortcut{border:1.5px solid var(--border);border-radius:26px 26px 14px 14px;padding:12px 10px 12px;text-align:center;color:var(--text);background:var(--surface);box-shadow:0 6px 18px rgba(var(--sh),.07);transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
.shortcut:hover{transform:translateY(-2px);border-color:var(--gold);box-shadow:0 12px 26px rgba(var(--sh),.14)}
.shortcut-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:50%;margin:0 auto 4px;font-size:15px;background:var(--g-icon)}
.shortcut-title{font-family:var(--script);font-style:italic;font-weight:700;font-size:16px;line-height:1.2;color:var(--primary)}
body.dark .shortcut-title{color:var(--saffron)}
.shortcut-desc{color:var(--muted);font-size:10px;margin-top:3px;line-height:1.35}
/* ---------- clean chat mode ---------- */
body.chatting .hero,
body.chatting .shortcuts,
body.has-doc .shortcuts{display:none}
body.chatting .main{padding-top:16px}
.chat-area{display:flex;flex-direction:column;position:relative}
.messages{flex:1;min-height:0;padding:10px 2px 30px}
.message{display:flex;margin:9px 0}
.message.user{justify-content:flex-end}
.message-wrap{max-width:min(82%,640px)}
.message-wrap.user{display:flex;flex-direction:column;align-items:flex-end}
.bubble{padding:11px 15px;border-radius:18px;font-size:14.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.message.user .bubble{color:#fff;background:var(--g-main);border-bottom-right-radius:5px;box-shadow:0 6px 16px rgba(var(--pr),.22)}
.message.assistant .bubble{background:var(--solid);border:1px solid var(--border);border-left:3px solid var(--teal);border-bottom-left-radius:5px}
.message-actions{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-top:5px}
.message-action{border:1px solid var(--border);background:transparent;color:var(--muted);border-radius:8px;padding:4px 8px;font-size:10px;text-decoration:none;display:inline-block}
/* --- AI typing indicator: three dots waving while the AI thinks --- */
.typing-row{display:flex;margin:9px 0}
.typing-row .message-wrap{max-width:min(82%,640px)}
.typing-bubble{display:inline-flex;align-items:center;gap:6px;padding:14px 16px;border-radius:18px;border-bottom-left-radius:5px;background:var(--solid);border:1px solid var(--border);border-left:3px solid var(--teal)}
.typing-bubble .tdot{width:7px;height:7px;border-radius:50%;background:var(--teal);opacity:.45;animation:typingWave 1.15s ease-in-out infinite}
.typing-bubble .tdot:nth-child(2){animation-delay:.15s}
.typing-bubble .tdot:nth-child(3){animation-delay:.3s}
@keyframes typingWave{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-6px);opacity:1}}
@media (prefers-reduced-motion:reduce){.typing-bubble .tdot{animation:none;opacity:.8}}

/* ---- the API picker inside ➕ Add / edit a model ---- */
.cm-step{margin:11px 0 5px;font-size:11px;font-weight:800;letter-spacing:.04em;color:var(--muted);text-transform:uppercase}
.prov-pick{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:7px}
.prov-opt{position:relative;display:flex;align-items:center;gap:9px;padding:10px 12px 12px;border-radius:14px;border:1.5px solid var(--border);background:var(--solid);color:var(--text);font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;text-align:left}
.prov-opt .prov-ico{font-size:18px;line-height:1}
.prov-opt .prov-txt{min-width:0}
.prov-opt small{display:block;font-size:10px;font-weight:600;color:var(--muted)}
.prov-opt.on{border-color:var(--gold);box-shadow:0 0 0 3px rgba(232,116,44,.14)}
.prov-opt.on:after{content:"✓";position:absolute;right:9px;top:7px;font-size:11px;font-weight:900;color:var(--gold)}
.prov-opt .prov-dot{position:absolute;left:13px;bottom:6px;width:7px;height:7px;border-radius:50%;background:#c9c9c9}
.prov-opt .prov-dot.on{background:#2ecc71}
.prov-opt .prov-dot.off{background:#e67e22}
/* =====================================================
   🎨 UI design picker: one plain list — no headings, no dashes
   ===================================================== */
.pal-menu .pal-sep,.pal-menu .pal-sep2,.pal-menu .model-group{display:none !important}
.pal-menu{padding:6px}
.pal-menu .pal-item{width:100%;display:flex;align-items:center;gap:10px;padding:10px 11px;min-height:44px;
  border:1px solid transparent;border-radius:11px;background:transparent;color:var(--text);text-align:left;font-family:inherit;font-size:13px}
.pal-menu .pal-item + .pal-item{margin-top:4px}
.pal-menu .pal-item:hover{background:rgba(var(--sa),.09)}
.pal-menu .pal-item.active{border-color:var(--orange);background:rgba(var(--or),.12)}
.pal-menu .pal-item.active .pal-check{opacity:1}
.pal-menu .pal-item .model-txt b{font-size:13px;font-weight:800}
.pal-menu .pal-dot{width:18px;height:18px;border-radius:50%;flex:0 0 auto;box-shadow:inset 0 0 0 2px rgba(255,255,255,.75),0 2px 6px rgba(0,0,0,.18)}
.pal-check{margin-left:auto;font-size:12.5px;font-weight:900;color:var(--orange);opacity:0;flex:0 0 auto}
/* =====================================================
   🔌 The three APIs: the provider name alone, nothing under it
   ===================================================== */
.prov-pick{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.prov-opt{align-items:center;gap:10px;padding:12px 13px}
.prov-opt .prov-ico{font-size:19px}
.prov-opt .prov-txt b{display:block;font-size:13px;font-weight:800;line-height:1.3;overflow-wrap:anywhere}
.prov-opt .prov-txt small{display:none}
.prov-opt .prov-dot{position:static;margin-left:auto;width:8px;height:8px;flex:0 0 auto}
.prov-note{padding-left:2px}
.prov-note{margin-top:7px;font-size:11px;line-height:1.5;color:var(--muted);min-height:15px}
.prov-note.bad{color:#c0392b}
.prov-list{display:flex;flex-direction:column;gap:9px}
.prov-row{border:1px solid var(--border);border-radius:14px;padding:10px 12px;background:var(--solid)}
.prov-head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800}
.prov-head .prov-ico{font-size:16px}
.prov-head .prov-state{margin-left:auto;font-size:11px;font-weight:800}
.prov-head .prov-state.on{color:#1f9d55}
.prov-head .prov-state.off{color:#c0392b}
.prov-row .prov-hint{margin-top:5px;font-size:10.5px;color:var(--muted);word-break:break-all}
.prov-row .ws-actions{margin-top:7px}
.prov-row .ws-out{margin-top:6px;font-size:11px}
/* ---- 🩺 Storage & connection + the live model list ---- */
.store-head{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:800;margin:8px 0 6px}
.store-head small{font-weight:600;color:var(--muted);font-size:11px}
.store-dot{width:11px;height:11px;border-radius:50%;background:#c9c9c9;flex:0 0 auto}
.store-dot.on{background:#2ecc71;box-shadow:0 0 0 4px rgba(46,204,113,.16)}
.store-dot.warn{background:#e67e22;box-shadow:0 0 0 4px rgba(230,126,34,.16)}
.store-dot.off{background:#e74c3c;box-shadow:0 0 0 4px rgba(231,76,60,.14)}
.conn-kv{margin:4px 0 8px}
.kv-out{margin-top:8px;font-size:11.5px;line-height:1.6;color:var(--muted);white-space:normal;word-break:break-word}
.kv-out.ok{color:#1f9d55}
.kv-out.bad{color:#c0392b}
.kv-block{margin:8px 0 0;padding:10px 11px;border:1px solid var(--border);border-radius:12px;background:var(--solid);color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;line-height:1.55;overflow-x:auto;white-space:pre}
.cm-code{display:flex;align-items:stretch;gap:7px;margin-top:6px}
.cm-code .set-input{margin-top:0;flex:1 1 auto;min-width:0}
.cm-code .mini-btn{flex:0 0 auto;white-space:nowrap}
.live-list{margin-top:8px;border:1px solid var(--border);border-radius:14px;padding:9px 10px;background:var(--solid)}
.live-head{display:flex;align-items:center;gap:7px}
.live-head .set-input{margin-top:0;flex:1 1 auto;min-width:0}
.live-free{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
.live-free input{accent-color:var(--gold)}
.live-rows{margin-top:8px;display:flex;flex-direction:column;gap:5px;max-height:250px;overflow-y:auto}
.live-row{display:flex;align-items:center;gap:8px;text-align:left;padding:7px 9px;border:1px solid var(--border);border-radius:11px;background:transparent;color:var(--text);font-family:inherit;font-size:11.5px;cursor:pointer}
.live-row:hover{border-color:var(--gold);background:rgba(232,116,44,.07)}
.live-row .live-txt{min-width:0;overflow:hidden}
.live-row b{display:block;font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.live-row small{display:block;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.live-free-tag{margin-left:auto;font-size:9.5px;font-weight:900;letter-spacing:.05em;text-transform:uppercase;color:#1f9d55;border:1px solid rgba(31,157,85,.4);border-radius:999px;padding:2px 7px}
/* =====================================================
   ⚙️ Settings: one dropdown list, one item open at a time
   ===================================================== */
.settings{height:100dvh;max-height:100dvh;overflow:hidden;padding-top:env(safe-area-inset-top,0px)}
.settings .drawer-head{flex:0 0 auto;position:relative;z-index:4;height:auto;min-height:56px;padding:9px 14px;gap:8px}
.settings .drawer-title{font-size:15px;font-weight:900;letter-spacing:.01em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.settings-body{min-height:0;flex:1 1 auto;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:12px 12px calc(34px + env(safe-area-inset-bottom,0px))}
.settings-body::-webkit-scrollbar{width:9px}
.settings-body::-webkit-scrollbar-thumb{background:rgba(var(--gd),.45);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
.settings-body::-webkit-scrollbar-track{background:transparent}
.set-filter{position:relative;margin:0 0 10px}
.set-filter .set-input{padding-right:64px}
.set-count{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10.5px;font-weight:800;color:var(--muted);pointer-events:none}
/* --- one row of the list: the name appears ONCE, nothing is cut --- */
section.card.set-row{padding:0;overflow:hidden;margin-bottom:9px;border-radius:15px}
section.card.set-row.set-hidden{display:none}
section.card.set-row>h3{display:none}
.set-item>summary{list-style:none}
.set-item>summary::-webkit-details-marker{display:none}
.set-head{display:block;cursor:pointer;user-select:none;background:transparent}
.set-head-in{display:flex;align-items:center;gap:11px;padding:12px 13px;min-height:58px}
.set-head:hover .set-head-in{background:rgba(var(--sa),.06)}
.set-item[open] .set-head-in{background:linear-gradient(90deg,rgba(var(--te),.07),rgba(var(--sa),.07))}
.set-ico{font-size:19px;line-height:1.15;flex:0 0 auto;width:27px;text-align:center}
.set-txt{display:block;min-width:0;flex:1 1 auto}
.set-txt b{display:block;font-size:13.5px;font-weight:800;line-height:1.32;overflow-wrap:anywhere}
.set-txt small{display:block;margin-top:1px;font-size:11px;font-weight:600;line-height:1.38;color:var(--muted);overflow-wrap:anywhere}
.set-state{flex:0 0 auto;max-width:42%;padding:4px 9px;border-radius:999px;border:1px solid var(--border);background:var(--solid);
  font-size:10.5px;font-weight:800;color:var(--muted);text-align:center;line-height:1.35;overflow-wrap:anywhere}
.set-state.ok{color:#1f9d55;border-color:rgba(31,157,85,.35);background:rgba(31,157,85,.08)}
.set-state.warn{color:#c0392b;border-color:rgba(192,57,43,.32);background:rgba(192,57,43,.07)}
.set-chev{flex:0 0 auto;font-size:13px;font-weight:900;color:var(--muted);transition:transform .22s ease}
.set-item[open] .set-chev{transform:rotate(180deg)}
.set-detail{padding:3px 13px 14px;border-top:1px solid var(--border);animation:setOpen .22s ease both}
@keyframes setOpen{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.set-detail>section.card,.set-detail>details.cm-fold{margin-bottom:10px}
.set-detail>.hint:first-child{margin-top:9px}
@media (max-width:560px){
  .settings{width:100vw;max-width:100vw;border-left:0}
  .set-head-in{padding:11px 11px;gap:9px}
  .set-txt b{font-size:13px}
  .set-state{max-width:40%;font-size:10px;padding:3px 8px}
  .set-ico{font-size:18px;width:25px}
}
@media (prefers-reduced-motion:reduce){.set-detail{animation:none}}
.ws-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}


.ws-out{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:12px;font-weight:700;color:var(--text)}
.ws-dot{flex:0 0 auto;width:10px;height:10px;border-radius:50%;background:#c9c9c9;box-shadow:0 0 0 3px rgba(0,0,0,.06)}
.ws-dot.on{background:#2ecc71;box-shadow:0 0 0 3px rgba(46,204,113,.18)}
.ws-dot.off{background:#e67e22;box-shadow:0 0 0 3px rgba(230,126,34,.18)}
.ws-dot.bad{background:#e74c3c;box-shadow:0 0 0 3px rgba(231,76,60,.18)}
.ws-out.bad{color:#c0392b}

/* a fresh answer is written out from the top down */
.type-caret{display:inline-block;width:8px;height:1.02em;margin-left:3px;vertical-align:-2px;border-radius:2px;background:var(--gold);animation:caretBlink 1s steps(1) infinite}
@keyframes caretBlink{0%,49%{opacity:1}50%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.type-caret{animation-duration:2.4s}}

/* --- tap-time chip: appears over a tapped AI bubble/* --- tap-time chip: appears over a tapped AI bubble for ~3.5s --- */
.tappable{cursor:pointer}
.time-chip{position:fixed;z-index:120;padding:6px 10px;border-radius:10px;background:var(--solid);border:1.5px solid var(--gold);color:var(--text);font-size:11px;font-weight:700;box-shadow:0 6px 16px rgba(var(--sh),.25);opacity:0;transform:translateY(4px);pointer-events:none;transition:opacity .25s ease,transform .25s ease}
.time-chip.show{opacity:1;transform:translateY(0)}
/* =====================================================
   PIXEL MEADOW — the premium rounded UI is KEPT as-is.
   Pixel art replaces only the heritage door on the home
   hero; while chatting the scene (and its animations)
   are gone and quiet pixel side strips remain.
   ===================================================== */
html[data-palette="pixel"] body:not(.chatting):not(.dark){background:linear-gradient(180deg,#E98A3C 0%,#E98A3C 10%,#F0A44A 10%,#F0A44A 22%,#F4BC5C 22%,#F4BC5C 36%,#F7CE6B 36%,#F7CE6B 52%,#FAE09A 52%,#FAE09A 70%,#FBF1DC 70%,#FBF1DC 100%)}
.px-hero{display:none}
html[data-palette="pixel"] .gate-hero>svg{visibility:hidden}
html[data-palette="pixel"] .gate-inner{display:none}
html[data-palette="pixel"] .px-hero{display:block;position:absolute;left:50%;transform:translateX(-50%);width:100vw;top:0;bottom:0;z-index:1;overflow:hidden;pointer-events:none}
.px-hero svg{position:absolute;image-rendering:pixelated}
.px-hero .px-ground{position:absolute;left:0;right:0;bottom:0}
.px-grass{height:12px;border-top:3px solid #57c25f;background:repeating-linear-gradient(90deg,#2f9e44 0 8px,#37b24d 8px 16px)}
.px-dirt{height:26px;background:repeating-linear-gradient(90deg,#7f4f24 0 10px,#6f441f 10px 20px)}
.px-dirt::after{content:"";display:block;height:100%;background:repeating-linear-gradient(90deg,transparent 0 5px,rgba(0,0,0,.16) 5px 10px)}
.px-sun{right:4%;top:2%;width:88px;height:88px}
.px-banyan{right:3%;bottom:33px;width:205px;height:133px}
.px-palms{left:4%;bottom:33px;width:150px;height:106px}
.px-bush1{left:21%;bottom:33px;width:52px;height:24px}
.px-bush2{right:23%;bottom:33px;width:44px;height:20px}
.px-fl1{left:15%;bottom:36px;width:26px;height:38px}
.px-fl2{right:16%;bottom:36px;width:26px;height:38px}
.px-tuft1{left:29%;bottom:36px;width:22px;height:15px}
.px-tuft2{right:31%;bottom:36px;width:22px;height:15px}
.px-rock{left:49%;bottom:36px;width:28px;height:14px}
.px-kid1{left:34%;bottom:38px;width:52px;height:66px;animation:pxKid1X 7s ease-in-out infinite,pxRun 1.1s infinite}
.px-cat{left:44%;bottom:34px;width:70px;height:44px;animation:pxHop 3.4s infinite}
.px-dog{left:53%;bottom:34px;width:76px;height:45px;animation:pxHop 2.7s .5s infinite}
.px-kid2{left:62%;bottom:38px;width:52px;height:66px;animation:pxKid2X 8s ease-in-out infinite,pxRun 1.1s .4s infinite}
@keyframes pxKid1X{0%,100%{left:31%}50%{left:41%}}
@keyframes pxKid2X{0%,100%{left:65%}50%{left:55%}}
.px-bee1{left:45%;bottom:120px;width:26px;height:16px;animation:pxBuzz1 4.5s infinite}
.px-bee2{left:55%;bottom:132px;width:26px;height:16px;animation:pxBuzz2 5.2s .8s infinite}
.px-bird{width:30px;height:14px;left:0;will-change:transform}
.px-plane{width:30px;height:15px;left:0;top:5%;will-change:transform}
.px-bird1{top:8%}
.px-bird2{top:15%}
@keyframes pxRun{0%,100%{transform:translateY(0)}25%{transform:translateY(-6px)}50%{transform:translateY(0)}75%{transform:translateY(-6px)}}
@keyframes pxHop{0%,58%{transform:translateY(0)}60%,66%{transform:translateY(-16px)}68%,74%{transform:translateY(0)}76%,82%{transform:translateY(-9px)}84%,100%{transform:translateY(0)}}
@keyframes pxBuzz1{0%{transform:translate(0,0)}25%{transform:translate(14px,-10px)}50%{transform:translate(4px,-22px)}75%{transform:translate(-10px,-8px)}100%{transform:translate(0,0)}}
@keyframes pxBuzz2{0%{transform:translate(0,0)}30%{transform:translate(-12px,-14px)}60%{transform:translate(10px,-24px)}100%{transform:translate(0,0)}}

/* chatting: whole scene hidden (animations stopped); calm side strips */
html[data-palette="pixel"] body.chatting::before,
html[data-palette="pixel"] body.chatting::after{content:"";position:fixed;top:0;bottom:0;width:7px;z-index:1;pointer-events:none;background:repeating-linear-gradient(180deg,#2f9e44 0 7px,#37b24d 7px 14px)}
html[data-palette="pixel"] body.chatting::before{left:0}
html[data-palette="pixel"] body.chatting::after{right:0}
/* appearance dropdown */
.pal-wrap{position:relative}
.pal-wrap .pal-menu{position:static;width:100%;max-height:none;box-shadow:none;border:1.5px solid var(--border);margin-top:6px}
.pal-dot{width:20px;height:20px;border-radius:50%;flex:0 0 auto;box-shadow:inset 0 0 0 2px rgba(255,255,255,.75),0 2px 6px rgba(0,0,0,.18)}
.pal-item.active{border-color:var(--orange);background:rgba(var(--or),.12)}
.pal-sep{color:var(--muted);font-size:10px;text-align:center;letter-spacing:3px;margin:6px 0;user-select:none}
@media (prefers-reduced-motion:reduce){.px-hero svg{animation:none}}
.message-action:hover{color:var(--text);background:var(--surface)}
.message-action.done{color:var(--green);border-color:rgba(31,157,116,.4)}
.model-tag{margin-left:auto;font-size:10px;font-weight:600;color:var(--muted);padding:0 2px;white-space:nowrap}
/* generated image inside a reply */
.gen-img{display:block;max-width:100%;max-height:440px;margin:0 0 9px;border-radius:12px;object-fit:contain;background:rgba(var(--sa),.12)}
.gen-note{font-size:12px;color:var(--muted);margin-bottom:8px}
/* file attached to a message (thumbnail + name) */
.attach{display:flex;flex-direction:column;gap:7px;margin-bottom:9px;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,.38)}
.attach img{display:block;max-width:100%;max-height:200px;border-radius:12px;object-fit:cover;background:rgba(255,255,255,.2)}
.attach-label{font-size:11px;font-weight:600;line-height:1.35;opacity:.95;white-space:normal;word-break:break-all}
/* ---------- bottom composer ---------- */
.composer-wrap{position:fixed;left:0;right:0;bottom:0;z-index:40;padding:10px 14px 10px;background:linear-gradient(transparent,var(--bg) 32%);pointer-events:none}
.composer-wrap>*{pointer-events:auto}
.document-chip{display:none;width:min(720px,100%);margin:0 auto 7px;align-items:center;justify-content:space-between;gap:8px;padding:7px 12px;border:1px solid rgba(var(--te),.35);background:rgba(var(--te),.10);border-radius:12px;font-size:11px}
.document-chip.show{display:flex}
.document-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.document-clear{border:0;background:transparent;color:var(--muted)}
.suggest{display:none;width:min(720px,100%);margin:0 auto 8px;padding:0 2px;flex-wrap:wrap;gap:6px}
.suggest.show{display:flex}
.suggest-chip{display:inline-flex;align-items:center;gap:9px;border:1.5px solid var(--gold);background:var(--solid);color:var(--text);border-radius:99px;padding:9px 15px 9px 9px;font-size:12.5px;font-weight:600;text-align:left;line-height:1.3;transition:all .15s ease;box-shadow:0 4px 12px rgba(var(--sh),.10);cursor:pointer}
.suggest-num{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:var(--g-warm);color:#fff;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
.suggest-chip:hover{background:rgba(var(--sa),.16);transform:translateY(-1px)}
.suggest-chip.picked{color:#fff;border-color:transparent;background:var(--g-warm)}
.controls{width:min(720px,100%);margin:0 auto 6px;padding:0 4px}
/* models + reply-language drop-ups (menus open above the whole row) */
.model-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;row-gap:7px}
.model-left{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto;flex-wrap:wrap;row-gap:6px}
.model-wrap{position:static;flex:0 0 auto}
.model-btn{height:32px;display:flex;align-items:center;gap:6px;padding:0 12px;border:1px solid var(--gold);border-radius:99px;background:var(--solid);color:var(--text);font-size:12px;font-weight:700;box-shadow:0 4px 12px rgba(var(--sh),.10);white-space:nowrap}
.model-count{min-width:18px;height:18px;padding:0 4px;border-radius:9px;display:grid;place-items:center;font-size:10px;color:#fff;background:var(--g-main)}
.caret{font-size:10px;transition:transform .15s ease}
.model-btn[aria-expanded="true"] .caret{transform:rotate(180deg)}
.model-menu{display:none;position:absolute;left:0;bottom:calc(100% + 8px);width:min(340px,calc(100vw - 24px));max-height:min(64vh,470px);overflow-y:auto;padding:8px;border:1.5px solid var(--gold);border-radius:18px;background:var(--solid);box-shadow:0 -10px 34px rgba(var(--sh),.24);z-index:5}
.model-menu.show{display:block}
.reply-menu{width:min(270px,calc(100vw - 24px))}
.model-menu-title{font-family:var(--script);font-style:italic;font-weight:700;font-size:16px;color:var(--primary);padding:4px 8px 6px}
body.dark .model-menu-title{color:var(--saffron)}
.model-group{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px 8px 3px}
.model-item{width:100%;display:flex;align-items:center;gap:10px;padding:9px 8px;border:0;border-radius:12px;background:transparent;color:var(--text);text-align:left}
.model-item:hover{background:rgba(var(--sa),.14)}
.model-ico{flex:0 0 auto;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;font-size:16px;background:var(--g-icon)}
.model-ico svg{width:23px;height:23px;display:block}
.reply-menu .model-ico{font-size:13px;font-weight:800;color:var(--primary)}
body.dark .reply-menu .model-ico{color:var(--saffron)}
.model-txt{flex:1;min-width:0;display:flex;flex-direction:column}
.model-txt b{font-size:13px}
.model-txt small{font-size:10px;color:var(--muted);line-height:1.35;margin-top:1px}
.switch{flex:0 0 auto;width:40px;height:22px;border-radius:99px;background:rgba(138,122,104,.38);position:relative;transition:background .18s ease}
.switch i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3);transition:transform .18s ease}
.model-item[aria-checked="true"] .switch{background:var(--g-on)}
.model-item[aria-checked="true"] .switch i{transform:translateX(18px)}
.tick{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;color:#fff;background:var(--g-on);opacity:0;transform:scale(.6);transition:opacity .15s ease,transform .15s ease}
.model-item[aria-checked="true"] .tick{opacity:1;transform:scale(1)}
/* feature strips (visible only when their model is ON) */
.strip{display:none;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px;padding:6px 8px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}
.strip.show{display:flex}
.strip-label{font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
.strip select{height:30px;min-width:0;max-width:150px;border:1px solid var(--border);border-radius:99px;background:var(--solid);color:var(--text);font-size:12px;font-weight:700;padding:0 8px;outline:none}
.strip-arrow{color:var(--muted);font-size:13px}
.strip-hint{font-size:10px;color:var(--muted)}
.strip-btn{height:30px;padding:0 13px;border:0;border-radius:99px;color:#fff;font-size:12px;font-weight:700;background:var(--g-cool)}
.strip-btn:disabled{opacity:.5;cursor:not-allowed}
/* voice language picker */
/* never squeezed, never hidden — the voice option must always be tappable */
.voice-lang{display:flex;align-items:center;gap:4px;flex:0 0 auto;min-width:0}
.voice-lang-icon{font-size:13px;line-height:1}
.voice-lang select{height:30px;max-width:112px;border:1px solid var(--border);border-radius:99px;background:var(--solid);color:var(--text);font-size:12px;font-weight:700;padding:0 6px;outline:none;cursor:pointer}
.composer{width:min(720px,100%);margin:0 auto;display:flex;align-items:flex-end;gap:6px;min-height:58px;padding:7px 8px;border:1.5px solid var(--gold);border-radius:30px;background:var(--solid);box-shadow:0 8px 28px rgba(var(--sh),.16)}
textarea{flex:1;min-width:0;min-height:42px;max-height:125px;resize:none;border:0;outline:none;padding:11px 6px;color:var(--text);background:transparent;font-size:15px;line-height:1.4}
textarea::placeholder{color:var(--muted)}
.file-input{display:none}
.upload-btn,.mic-btn{flex:0 0 auto;width:42px;height:42px;border:0;color:var(--text);background:transparent;display:grid;place-items:center;border-radius:50%;transition:background .15s ease}
.upload-btn:hover,.mic-btn:hover{background:rgba(var(--sa),.18)}
.upload-btn svg,.send-btn svg,.mic-btn svg{width:22px;height:22px}
.mic-btn.listening{color:#fff;background:var(--g-main);animation:micPulse 1.2s infinite}
.mic-btn.listening:hover{background:var(--g-main)}
/* --- the up-opening file panel, opened by the round button --- */
.attach-panel{position:absolute;right:0;bottom:calc(100% + 10px);z-index:90;width:min(264px,80vw);padding:9px 10px 10px;background:var(--solid);border:1.5px solid var(--gold);border-radius:14px;box-shadow:0 12px 30px rgba(var(--sh),.22)}
.attach-panel[hidden]{display:none}
.ap-head{display:flex;align-items:center;gap:6px}
.ap-title{font-size:11.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ap-meta{font-size:10px;color:var(--muted);margin-top:2px}
.ap-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.ap-btn{padding:5px 9px;font-size:10.5px;font-weight:700;border-radius:999px;border:1.5px solid var(--border);background:#fff;color:var(--txt);cursor:pointer}
.ap-btn.small{padding:4px 8px;font-size:10px}
.ap-btn:hover{background:rgba(var(--sa),.12)}
.ap-btn.danger{color:#c0392b;border-color:rgba(192,57,43,.4)}
.ap-lbl{font-size:10px;font-weight:700;color:var(--muted)}
/* --- the round button sparkles like a diamond when a file lands --- */
.attach-mini.sparkle{position:relative;overflow:visible}
.attach-mini.sparkle.sparkle-run{animation-name:attachPop,attachGlow;animation-duration:.42s,2.1s;animation-timing-function:cubic-bezier(.2,.9,.3,1.35),ease-in-out;animation-fill-mode:both,forwards;animation-iteration-count:1,1}
.attach-mini.sparkle.sparkle-run::before{content:"";position:absolute;inset:-3px;border-radius:50%;background:conic-gradient(from 0deg,rgba(233,185,73,0) 0deg,rgba(255,247,214,.95) 40deg,rgba(233,185,73,0) 90deg,rgba(233,185,73,0) 360deg);animation-name:sparkSpin;animation-duration:2.2s;animation-iteration-count:1;animation-timing-function:linear;pointer-events:none}
.attach-mini.sparkle.sparkle-run::after{content:"✦";position:absolute;right:-4px;top:-7px;font-size:11px;color:#f7d774;text-shadow:0 0 6px rgba(255,236,170,.95);animation-name:starTwinkle;animation-duration:1.8s;animation-iteration-count:2;pointer-events:none}
@keyframes sparkSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes starTwinkle{0%,100%{opacity:0;transform:scale(.6) rotate(0)}35%{opacity:1;transform:scale(1.25) rotate(18deg)}70%{opacity:.15;transform:scale(.9) rotate(-12deg)}}
@keyframes attachGlow{0%{box-shadow:0 0 0 0 rgba(233,185,73,.55),0 6px 16px rgba(var(--sh),.18)}45%{box-shadow:0 0 0 7px rgba(233,185,73,0),0 8px 22px rgba(var(--sh),.22)}100%{box-shadow:0 4px 14px rgba(var(--sh),.16)}}
@media (prefers-reduced-motion:reduce){.attach-mini.sparkle.sparkle-run{animation-name:attachPop}.attach-mini.sparkle.sparkle-run::before,.attach-mini.sparkle.sparkle-run::after{display:none}}
/* --- the file card inside a sent message: one thin line, no repeated name --- */
/* thin, sleek card: a small round picture + one short line */
.attach{display:inline-flex;align-items:center;gap:7px;margin-top:6px;padding:2px 10px 2px 2px;border:1px solid rgba(var(--gold),.55);background:rgba(var(--sa),.07);border-radius:999px;max-width:100%}
.attach:has(.attach-lang){padding-right:6px}
.attach img{width:26px;height:26px;border-radius:50%;object-fit:cover;border:1.5px solid #C9962E;cursor:zoom-in;flex:0 0 auto}
.attach .attach-label{font-size:10.5px;font-weight:700;color:var(--muted);letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(190px,48vw)}
.attach .attach-lang{font-size:9px;font-weight:800;letter-spacing:.02em;padding:1.5px 7px;border-radius:999px;background:rgba(var(--te),.14);color:var(--primary);flex:0 0 auto}
html[data-layout="mobile"] .attach img{width:24px;height:24px}
html[data-layout="mobile"] .attach .attach-label{max-width:min(150px,44vw)}
.send-btn{flex:0 0 auto;width:42px;height:42px;padding:0;border:0;color:#fff;display:grid;place-items:center;border-radius:50%;background:var(--g-main);box-shadow:0 5px 14px rgba(var(--pr),.25)}
.upload-btn:hover,.send-btn:hover{transform:translateY(-1px)}
.upload-btn:disabled,.send-btn:disabled,.mic-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.status{width:min(720px,100%);margin:5px auto 0;padding:0 8px;min-height:18px;display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px}
.dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
/* ---------- upload dialog ---------- */
.modal-bg{position:fixed;inset:0;z-index:90;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(28,16,6,.52);backdrop-filter:blur(5px)}
.modal-bg.show{display:flex}
.modal{width:min(430px,100%);max-height:92vh;overflow-y:auto;padding:18px;border:2px solid var(--gold);border-radius:22px;background:var(--solid);box-shadow:var(--shadow)}
.modal h2{margin:0 0 3px;font-family:var(--script);font-style:italic;font-weight:700;font-size:23px;color:var(--primary)}
body.dark .modal h2{color:var(--saffron)}
.modal-file{font-size:12px;color:var(--muted);margin-bottom:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.field{margin-bottom:12px}
.field>label{display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:5px}
.field select{width:100%;height:42px;border:1px solid var(--border);border-radius:12px;background:var(--solid);color:var(--text);font-size:14px;padding:0 10px;outline:none}
.actions-row{display:none;gap:8px;margin-bottom:12px}
.action-opt{flex:1;display:flex;align-items:center;gap:6px;padding:9px 10px;border:1px solid var(--border);border-radius:12px;font-size:12px;font-weight:700;cursor:pointer}
.action-opt input{accent-color:var(--primary)}
.modal-note{font-size:11px;line-height:1.5;color:var(--muted);padding:9px 11px;border-radius:12px;background:rgba(var(--te),.10);margin-bottom:14px}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
.modal-btns button{height:40px;padding:0 18px;border-radius:12px;font-weight:700;font-size:13px;border:1px solid var(--border);background:var(--solid);color:var(--text)}
.modal-btns .go{border:0;color:#fff;background:var(--g-main)}
/* ---------- drawers ---------- */
.overlay{position:fixed;inset:0;display:none;z-index:50;background:rgba(28,16,6,.42);backdrop-filter:blur(5px)}
.overlay.show{display:block}
.drawer{position:fixed;top:0;left:0;bottom:0;width:min(340px,88vw);z-index:60;display:flex;flex-direction:column;background:var(--solid);border-right:3px solid var(--gold);box-shadow:20px 0 50px rgba(0,0,0,.18);transform:translateX(-105%);visibility:hidden;transition:transform .22s ease,visibility 0s linear .22s}
.drawer.show{transform:translateX(0);visibility:visible;transition:transform .22s ease,visibility 0s}
.drawer-head{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 15px;border-bottom:1px solid var(--border);background:linear-gradient(90deg,rgba(var(--te),.10),rgba(var(--sa),.12))}
.drawer-title{font-family:var(--serif);font-size:21px;font-weight:700}
.history-list{flex:1;overflow-y:auto;padding:10px}
.history-row{display:flex;align-items:center;gap:5px;width:100%;margin-bottom:4px}
.history-item{flex:1;min-width:0;border:0;background:transparent}
/* --- clear-all chat history --- */
.clear-all-btn{flex:0 0 auto;margin-right:4px;padding:5px 9px;font-size:10.5px;font-weight:700;line-height:1;letter-spacing:.01em;color:var(--primary);background:var(--card,#fff);border:1.5px solid var(--border);border-radius:999px;cursor:pointer;box-shadow:0 2px 6px rgba(var(--sh),.08)}
.clear-all-btn:hover{background:rgba(var(--sa),.12)}
.clear-all-box{margin:6px 10px 8px;padding:9px 10px;border:1.5px dashed var(--border);border-radius:12px;background:rgba(var(--sa),.07)}
.cab-text{font-size:11px;font-weight:600;color:var(--muted);margin-bottom:7px}
.cab-row{display:flex;flex-wrap:wrap;gap:6px}
.cab-btn{padding:6px 10px;font-size:10.5px;font-weight:700;border-radius:999px;border:1.5px solid var(--border);background:#fff;color:var(--txt);cursor:pointer}
.cab-btn.go{background:var(--g-main);color:#fff;border-color:transparent}
.cab-btn.danger{color:#c0392b;border-color:rgba(192,57,43,.45)}
.unread-dot{display:inline-block;width:7px;height:7px;margin-left:6px;border-radius:50%;background:var(--g-main);box-shadow:0 0 0 2px rgba(255,255,255,.6);vertical-align:middle}
/* --- model logo picture --- */
.logo-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:-2px 0 4px}
.logo-pick{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;font-size:11px;font-weight:700;color:var(--primary);background:var(--card,#fff);border:1.5px dashed var(--border);border-radius:11px;cursor:pointer}
.logo-pick:hover{background:rgba(var(--sa),.10)}
.logo-prev{width:30px;height:30px;border-radius:9px;object-fit:cover;border:1.5px solid var(--border);background:#fff}
.mini-btn{padding:5px 9px;font-size:10.5px;font-weight:700;border-radius:999px;border:1.5px solid var(--border);background:#fff;color:var(--txt);cursor:pointer}
.mini-btn:hover{background:rgba(var(--sa),.10)}
.kv-out{margin-top:6px;font-size:11px;line-height:1.45;color:var(--muted)}
.kv-out.ok{color:#2f9e44}
.kv-out.bad{color:#c0392b};color:var(--text);text-align:left;padding:11px;border-radius:11px}
.history-item:hover{background:rgba(var(--sa),.14)}
.history-title{font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.history-date{color:var(--muted);font-size:9px;margin-top:4px}
.delete-history{flex:0 0 36px;width:36px;height:36px;padding:0;border:1px solid transparent;border-radius:10px;display:grid;place-items:center;color:var(--muted);background:transparent;font-size:15px;transition:color .15s ease,background .15s ease,border-color .15s ease}
.delete-history:hover{color:#ef4444;background:rgba(239,68,68,.09);border-color:rgba(239,68,68,.15)}
.new-chat-side{margin:11px;height:42px;border:0;border-radius:12px;color:#fff;font-weight:750;background:var(--g-warm)}
/* signature */
.signature{flex:0 0 auto;padding:11px 14px 13px;text-align:center;border-top:1px solid var(--border);background:linear-gradient(90deg,rgba(var(--te),.08),rgba(var(--sa),.14));font-family:var(--script);font-style:italic;font-size:14px;line-height:1.3;color:var(--muted)}
.signature b{font-weight:700;padding-right:.12em;background:var(--g-title);-webkit-background-clip:text;background-clip:text;color:transparent}
.signature .heart{display:inline-block;font-style:normal;animation:heartbeat 1.7s ease-in-out infinite}
/* ---------- settings panel ---------- */
.settings{left:auto;right:0;width:min(420px,94vw);border-right:0;border-left:3px solid var(--gold);box-shadow:-20px 0 50px rgba(0,0,0,.18);transform:translateX(105%)}
.settings.show{transform:translateX(0)}
.settings-body{flex:1;overflow-y:auto;padding:12px}
.card{border:1px solid var(--border);border-radius:14px;padding:13px;margin-bottom:12px;background:var(--surface)}
.card h3{margin:0 0 10px;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:space-between;gap:8px}
.card h3 small{font-weight:600;font-size:9px;color:var(--muted)}
.stat{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:5px 0;border-bottom:1px dashed var(--border)}
.stat:last-child{border-bottom:0}
.stat span:first-child{color:var(--muted)}
.stat span:last-child{font-weight:700;text-align:right;word-break:break-word}
.bar{height:7px;border-radius:99px;background:rgba(var(--te),.16);overflow:hidden;margin:7px 0 3px}
.bar>div{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--teal),var(--saffron))}
.hint{font-size:10px;color:var(--muted);line-height:1.5;margin-top:6px;word-break:break-word}
.hint code{background:rgba(var(--sa),.20);padding:1px 5px;border-radius:5px}
.card-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center}
.card-actions button,.card-actions a{border:1px solid var(--border);background:var(--solid);color:var(--text);border-radius:9px;padding:6px 10px;font-size:11px;text-decoration:none;display:inline-block}
.card-actions button:hover,.card-actions a:hover{background:rgba(var(--sa),.16)}
.ok{color:var(--green)}
.bad{color:#d92d20}
/* appearance card: colour themes + layout */
.opt-label{font-size:11px;font-weight:700;color:var(--muted);margin:2px 0 7px}
.opt-label.gap{margin-top:14px}
.palette-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.swatch{border:1.5px solid var(--border);background:var(--solid);color:var(--text);border-radius:12px;padding:8px 2px 6px;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:9.5px;font-weight:700;line-height:1.2;text-align:center;transition:transform .15s ease,border-color .15s ease}
.swatch:hover{transform:translateY(-1px)}
.swatch i{width:30px;height:30px;border-radius:50%;display:block;box-shadow:inset 0 0 0 2px rgba(255,255,255,.75),0 2px 6px rgba(0,0,0,.18)}
.swatch.active{border-color:var(--orange);box-shadow:0 0 0 2px rgba(var(--or),.35)}
.seg{display:flex;gap:6px}
.seg button{flex:1;height:36px;border:1px solid var(--border);border-radius:10px;background:var(--solid);color:var(--text);font-size:12px;font-weight:700}
.seg button.active{color:#fff;border-color:transparent;background:var(--g-main)}
/* =====================================================
   LAYOUT  —  html[data-layout] is "mobile" or "web".
   Auto mode picks it from the screen width (live);
   Mobile / Web in Settings force one of them.
   ===================================================== */
/* ---- MOBILE layout ---- */
html[data-layout="mobile"] .royal-frame{width:min(100%,var(--col))}
html[data-layout="mobile"] .topbar{height:56px}
html[data-layout="mobile"] .topbar-in{width:min(100%,var(--col));padding:0 22px}
html[data-layout="mobile"] .main{width:min(calc(100% - 40px),calc(var(--col) - 40px))}
html[data-layout="mobile"] .shortcuts{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
html[data-layout="mobile"] .shortcut-desc{display:none}
html[data-layout="mobile"] .messages{padding:8px 0 20px}
html[data-layout="mobile"] .message-wrap{max-width:90%}
html[data-layout="mobile"] .composer-wrap{padding:9px 10px 8px}
html[data-layout="mobile"] .document-chip,
html[data-layout="mobile"] .suggest,
html[data-layout="mobile"] .controls,
html[data-layout="mobile"] .composer,
html[data-layout="mobile"] .status{width:min(100%,var(--col))}
html[data-layout="mobile"] .suggest-chip{flex:1 1 100%;border-radius:14px}
@media (max-width:420px){
  html[data-layout="mobile"] .brand-main{font-size:18px}
  html[data-layout="mobile"] .top-actions{gap:4px}
  html[data-layout="mobile"] .icon-btn{width:35px;height:35px}
  html[data-layout="mobile"] .upload-btn,
  html[data-layout="mobile"] .send-btn,
  html[data-layout="mobile"] .mic-btn{width:40px;height:40px}
  html[data-layout="mobile"] .model-left{gap:6px}
  html[data-layout="mobile"] .model-btn{padding:0 9px;gap:5px}
  html[data-layout="mobile"] .voice-lang select{max-width:88px;font-size:11px}
  html[data-layout="mobile"] .strip select{max-width:128px;font-size:11px}
  html[data-layout="mobile"] textarea{font-size:14px}
  html[data-layout="mobile"] .delete-history{flex-basis:34px;width:34px;height:34px}
}
@media (max-width:370px){
  html[data-layout="mobile"] .lbl-hide{display:none}
}
/* ---- WEB layout: fills the whole window ---- */
html[data-layout="web"] .royal-frame{width:100%}
html[data-layout="web"] .topbar-in{width:100%;padding:0 38px}
html[data-layout="web"] .main{width:calc(100% - 110px)}
html[data-layout="web"] .composer-wrap{padding:10px 38px}
html[data-layout="web"] .document-chip,
html[data-layout="web"] .suggest,
html[data-layout="web"] .controls,
html[data-layout="web"] .composer,
html[data-layout="web"] .status{width:100%}
html[data-layout="web"] .message-wrap{max-width:min(78%,1000px)}
html[data-layout="web"] .bubble{font-size:15.5px}
html[data-layout="web"] .attach img{max-height:260px}
html[data-layout="web"] .gate-hero{width:min(100%,520px)}
html[data-layout="web"] .script-title{font-size:52px}
html[data-layout="web"] .gate-inner p{font-size:14px}
html[data-layout="web"] .shortcuts{max-width:1100px;margin-left:auto;margin-right:auto}
html[data-layout="web"] .shortcut-desc{font-size:11px}
@keyframes pulse{0%{opacity:.35}50%{opacity:1}100%{opacity:.35}}
@keyframes micPulse{0%{box-shadow:0 0 0 0 rgba(var(--pr),.45)}100%{box-shadow:0 0 0 12px rgba(var(--pr),0)}}
@keyframes heartbeat{0%,100%{transform:scale(1)}15%{transform:scale(1.3)}30%{transform:scale(1)}45%{transform:scale(1.18)}60%{transform:scale(1)}}
/* ---------- LOCK SCREEN + ACHIEVEMENT ---------- */
#lock{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;
  background:radial-gradient(ellipse 75% 45% at 50% 0%,var(--wash1),transparent 72%),radial-gradient(ellipse 75% 45% at 85% 100%,var(--wash2),transparent 72%),var(--bg)}
#lock.hidden{display:none}
.lock-card{width:min(92vw,360px);padding:28px 22px 24px;text-align:center;color:var(--text);background:var(--solid);
  border:2px solid var(--gold);border-radius:26px;box-shadow:var(--shadow)}
.lock-icon{font-size:42px;line-height:1;margin-bottom:6px}
.lock-card h2{margin:0 0 6px;font-family:var(--script);font-style:italic;font-weight:700;font-size:28px;color:var(--primary)}
body.dark .lock-card h2{color:var(--saffron)}
#lock-msg{margin:0;min-height:40px;font-size:13px;line-height:1.5;color:var(--muted)}
#lock-msg.err{color:#d6336c;font-weight:600}
#lock-msg.ok{color:var(--green);font-weight:600}
.pins{display:flex;gap:10px;justify-content:center;margin-top:14px}
.pins input{width:56px;height:64px;padding:0;text-align:center;font-size:28px;font-weight:700;color:var(--text);
  background:var(--bg);border:2px solid var(--border);border-radius:14px;outline:none;-webkit-text-security:disc}
.pins input:focus{border-color:var(--orange);box-shadow:0 0 0 3px rgba(var(--or),.25)}
.lock-card.shake{animation:lockShake .45s}
@keyframes lockShake{20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-7px)}80%{transform:translateX(7px)}}
#achievement{position:fixed;top:-130px;left:50%;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;gap:12px;
  width:max-content;max-width:92vw;padding:13px 20px;color:var(--text);background:var(--solid);
  border:2px solid var(--gold);border-radius:18px;box-shadow:0 14px 40px rgba(var(--sh),.35);
  transition:top .55s cubic-bezier(.2,1.4,.4,1)}
#achievement.show{top:16px}
.ach-icon{font-size:34px;line-height:1}
.ach-title{font-family:var(--script);font-style:italic;font-weight:700;font-size:18px;color:var(--primary)}
body.dark .ach-title{color:var(--saffron)}
.ach-sub{font-size:12px;color:var(--muted);margin-top:2px}
/* ---------- ROYAL BABY ELEPHANT (lock screen mascot) ---------- */
.lock-stage{position:relative}
.eleph{position:absolute;left:50%;transform:translateX(-50%);top:-152px;width:230px;height:300px;z-index:3;pointer-events:none;transition:transform .28s ease;
  filter:drop-shadow(0 8px 16px rgba(0,0,0,.28));animation:elephBob 3s ease-in-out infinite}
@keyframes elephBob{0%,100%{margin-top:0}50%{margin-top:6px}}
.eleph .pupil{transition:transform .18s ease}
#trunkPath{stroke-linejoin:round}
#trunkHi,#trunkRings{pointer-events:none}
.eleph svg{pointer-events:none}
.eleph svg path,.eleph svg ellipse,.eleph svg circle,.eleph svg rect{pointer-events:auto;cursor:pointer}
.eleph .shy-mark,.eleph .shake-lines,.eleph .blush{opacity:0;transition:opacity .25s}
.eleph.mood-awkward .shy-mark,.eleph.mood-awkward .shake-lines,.eleph.mood-awkward .blush{opacity:1}
.eleph.mood-awkward svg{animation:elephShake .4s ease-in-out 3}
.eleph .eye{transition:rx .16s ease,ry .16s ease}
.eleph .pupil{transition:transform .16s ease,r .16s ease}
@keyframes elephShake{0%,100%{transform:translate(0,0) rotate(0)}
  16%{transform:translate(-5px,1px) rotate(-2.8deg)}
  34%{transform:translate(5px,-1px) rotate(2.8deg)}
  56%{transform:translate(-4px,2px) rotate(-2deg)}
  76%{transform:translate(4px,1px) rotate(2deg)}}
.lid-sad,.brow-happy,.mouth-happy,.mouth-sad{opacity:0;transition:opacity .2s}
/* AI models manager + auto-lock (Settings) */
.set-input{width:100%;margin-top:6px;height:34px;border:1px solid var(--border);border-radius:10px;background:var(--solid);color:var(--text);font-size:12px;padding:0 10px;font-family:inherit}
.set-input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--g-icon)}
.suggest-toggle{display:flex;align-items:center;gap:7px;border:1.5px solid var(--gold);background:var(--solid);color:var(--primary);border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(var(--sh),.12)}
.suggest-toggle.open{background:rgba(var(--sa),.20)}
.suggest-head{flex:1 1 100%;font-size:11px;font-weight:800;letter-spacing:.02em;color:var(--muted);padding:2px 2px 0}
.suggest-toggle .caret{font-size:10px;color:var(--muted)}
.suggest-toggle:hover{border-color:var(--primary)}
.mlist-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:12px;margin-top:6px;background:var(--solid)}
.mlist-row b{font-size:12px;display:block}
.mlist-row small{display:block;font-size:10px;color:var(--muted);word-break:break-all}
.mlist-row .mini{margin-left:auto;display:flex;gap:6px}
.mlist-row .mini button{font-size:11px;padding:4px 8px}
/* --- b49 · a model is deleted the moment Delete is tapped ---------------- */
.mlist-row .mini button[disabled]{cursor:progress;opacity:.8}
.mlist-row .mini button.del-busy{background:rgba(239,68,68,.10);border-color:rgba(239,68,68,.35);color:#b91c1c}
.mlist-row .cm-logo img{border-radius:8px}

.cm-sec{display:flex;gap:8px;margin-top:8px}
.cm-sec button{flex:1}
/* foldable settings sections */
.cm-fold{border:1px solid var(--border);border-radius:14px;margin-top:8px;background:var(--solid);overflow:hidden}
.cm-fold>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;font-size:12px;font-weight:700;cursor:pointer;list-style:none;color:var(--text)}
.cm-fold>summary::-webkit-details-marker{display:none}
.cm-fold>summary .caret{transition:transform .2s;color:var(--muted)}
.cm-fold>summary .cm-count{background:var(--g-icon);border:1px solid var(--border);border-radius:999px;font-size:10px;padding:1px 8px;color:var(--muted)}
.cm-bodied{padding:0 12px 12px}
.cm-logo{width:26px;height:26px;border-radius:8px;overflow:hidden;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:var(--g-icon);font-size:13px;font-weight:700}
.cm-logo img{width:100%;height:100%;object-fit:cover}
.model-ico img{width:100%;height:100%;object-fit:cover;border-radius:7px}
.mood-sad .lid-sad{opacity:1}
.mood-sad .mouth-sad{opacity:1}
.mood-happy .brow-happy{opacity:1}
.mood-happy .mouth-happy{opacity:1}
/* the meadow stops exactly at the frame's inner edge, so the
   ornament on both sides is never covered by the ground band */
html[data-palette="pixel"] .px-hero{width:min(100vw,820px)}
html[data-layout="web"][data-palette="pixel"] .px-hero{width:100vw}
html[data-layout="mobile"][data-palette="pixel"] .px-hero{width:min(100vw,var(--col))}
html[data-palette="pixel"] .px-hero .px-ground{left:19px;right:19px}
/* --- one small file button instead of the wide bar --- */
.document-chip{display:none !important}
.attach-wrap{position:relative;display:none;align-items:center;flex:0 0 auto;margin:0 0 0 auto}
.attach-wrap.show{display:flex}
.attach-mini{display:none;margin:0;padding:0;width:38px;height:38px;flex:0 0 auto;align-items:center;justify-content:center;border:1.5px solid var(--gold);background:var(--solid);border-radius:50%;box-shadow:0 6px 16px rgba(var(--sh),.18);cursor:pointer;font-family:inherit}
.attach-mini.show{display:flex;box-shadow:0 0 0 2px rgba(233,185,73,.26),0 0 16px 3px rgba(233,185,73,.52);animation-name:attachPop,glowBreath;animation-duration:.44s,2.9s;animation-timing-function:cubic-bezier(.2,.9,.3,1.35),ease-in-out;animation-iteration-count:1,infinite}
@keyframes glowBreath{0%,100%{box-shadow:0 0 0 2px rgba(233,185,73,.20),0 0 10px 2px rgba(233,185,73,.40)}50%{box-shadow:0 0 0 4px rgba(233,185,73,.30),0 0 22px 6px rgba(233,185,73,.72)}}
@media (prefers-reduced-motion:reduce){.attach-mini.show{animation-name:attachPop}}
.attach-mini .thumb{width:30px;height:30px;border-radius:50%;object-fit:cover;background:rgba(var(--sa),.25);flex:0 0 auto}
.attach-mini .mini-ico{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(var(--te),.16);flex:0 0 auto;font-size:15px}
.attach-mini .mini-name{font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
.attach-mini .mini-x{border:0;background:transparent;color:var(--muted);font-size:13px;line-height:1;padding:2px 2px}
.attach-mini .mini-x:hover{color:var(--deep)}
.preview-card{width:min(94vw,780px);max-height:90vh;overflow:auto;background:var(--solid);border:2px solid var(--gold);border-radius:18px;padding:12px}
.preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:700;margin-bottom:9px;color:var(--text)}
/* --- ✂️ crop sheet: a small photo editor, readable in light AND dark --- */
.crop-sheet{position:fixed;inset:0;z-index:140;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(10,7,4,.74)}
.crop-sheet[hidden]{display:none}
.crop-card{width:min(720px,97vw);max-height:95vh;display:flex;flex-direction:column;background:#1c1710;color:#f7eddc;border:2px solid rgba(233,185,73,.62);border-radius:20px;padding:12px 13px 14px;box-shadow:0 22px 54px rgba(0,0,0,.52)}
.crop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;font-weight:800;color:#ffe9bd;margin-bottom:9px}
.crop-head .mini-x{width:30px;height:30px;border-radius:9px;border:1.5px solid rgba(247,237,220,.35);background:rgba(247,237,220,.10);color:#f7eddc;font-size:14px;line-height:1}
.crop-head .mini-x:hover{background:rgba(247,237,220,.20)}
.crop-stage{background:#0c0a07;border-radius:16px;padding:10px;overflow:auto;max-height:52vh;min-height:140px;display:block}
.crop-frame{position:relative;display:inline-block;line-height:0;touch-action:none}
.crop-frame img{display:block;width:100%;height:auto;max-width:none;border-radius:6px;user-select:none;-webkit-user-drag:none}
.crop-rect{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;border:2px solid #ffd166;box-shadow:0 0 0 9999px rgba(0,0,0,.52);cursor:move}
.crop-h{position:absolute;width:20px;height:20px;background:#ffd166;border:2.5px solid #3a2c12;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.crop-h::after{content:"";position:absolute;inset:6px;border-radius:50%;background:#3a2c12}
.crop-h[data-h="nw"]{left:-11px;top:-11px;cursor:nwse-resize}
.crop-h[data-h="ne"]{right:-11px;top:-11px;cursor:nesw-resize}
.crop-h[data-h="sw"]{left:-11px;bottom:-11px;cursor:nesw-resize}
.crop-h[data-h="se"]{right:-11px;bottom:-11px;cursor:nwse-resize}
.crop-bar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px}
.crop-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.crop-lbl{font-size:11px;font-weight:800;color:#cbb894;letter-spacing:.02em;margin-right:1px}
.crop-tool{padding:7px 13px;font-size:12px;font-weight:800;border-radius:999px;border:1.5px solid rgba(247,237,220,.34);background:rgba(247,237,220,.10);color:#f7eddc;cursor:pointer;font-family:inherit}
.crop-tool:hover{background:rgba(247,237,220,.20)}
.crop-tool.on{background:#E8742C;border-color:#F2A93B;color:#fff;box-shadow:0 0 0 2px rgba(242,169,59,.28)}
.crop-zoom{display:flex;align-items:center;gap:5px;margin-left:auto}
.crop-zoom button{width:32px;height:32px;font-size:15px;font-weight:800;border-radius:10px;border:1.5px solid rgba(247,237,220,.34);background:rgba(247,237,220,.10);color:#f7eddc;cursor:pointer;font-family:inherit;line-height:1}
.crop-zoom button.wide{width:auto;padding:0 10px;font-size:11.5px}
.crop-zoom button:hover{background:rgba(247,237,220,.20)}
.crop-zoom-val{min-width:46px;text-align:center;font-size:12px;font-weight:800;color:#ffe9bd}
.crop-info{margin-top:9px;padding:7px 11px;border-radius:11px;background:rgba(247,237,220,.09);color:#f0e2c8;font-size:12px;font-weight:700}
.crop-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:11px}
.crop-btn{padding:9px 15px;font-size:12.5px;font-weight:800;border-radius:999px;border:1.5px solid rgba(247,237,220,.34);background:rgba(247,237,220,.10);color:#f7eddc;cursor:pointer;font-family:inherit}
.crop-btn:hover{background:rgba(247,237,220,.20)}
.crop-btn.primary{background:#E8742C;border-color:#F2A93B;color:#fff}
.crop-btn.ghost{border-style:dashed;color:#e6d6b8}
html[data-layout="mobile"] .crop-stage{max-height:44vh}
html[data-layout="mobile"] .crop-lbl{display:none}
@media (max-width:420px){.crop-tool{padding:6px 10px;font-size:11px}.crop-zoom{margin-left:0}}
.preview-card img{display:block;width:100%;max-height:66vh;object-fit:contain;border-radius:12px;background:rgba(var(--sa),.12)}
.preview-card .pv-text{font-size:12px;line-height:1.55;max-height:56vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:rgba(var(--sa),.10);border-radius:12px;padding:11px}
.preview-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px;justify-content:flex-end}
.preview-actions a,.preview-actions button{border:1px solid var(--border);background:var(--solid);color:var(--text);border-radius:10px;padding:8px 13px;font-size:12px;font-weight:700;text-decoration:none;font-family:inherit}
.preview-actions .pv-primary{background:var(--g-main);border-color:transparent;color:#fff}
.gen-img,.attach img{cursor:zoom-in}
/* ---- the phone meadow: land much deeper, life bigger, a plane in the sky ---- */
@media (max-width:820px){
  html[data-palette="pixel"] .px-grass{height:24px;border-top-width:4px}
  html[data-palette="pixel"] .px-dirt{height:64px}
  html[data-palette="pixel"] .px-palms{left:3.1%;right:auto;bottom:82px;width:146px;height:104px}
  html[data-palette="pixel"] .px-banyan{right:3.1%;left:auto;bottom:82px;width:174px;height:112px}
  html[data-palette="pixel"] .px-bush1{left:5.1%;right:auto;bottom:78px;width:49px;height:22px}
  html[data-palette="pixel"] .px-bush2{right:4.4%;left:auto;bottom:78px;width:45px;height:20px}
  html[data-palette="pixel"] .px-fl1{left:43.6%;right:auto;bottom:78px;width:24px;height:36px}
  html[data-palette="pixel"] .px-fl2{left:60%;right:auto;bottom:78px;width:24px;height:36px}
  html[data-palette="pixel"] .px-tuft1{left:23.6%;right:auto;bottom:78px;width:22px;height:16px}
  html[data-palette="pixel"] .px-tuft2{left:77.5%;right:auto;bottom:78px;width:22px;height:16px}
  html[data-palette="pixel"] .px-rock{left:50.8%;right:auto;bottom:78px;width:30px;height:15px}
  html[data-palette="pixel"] .px-kid1{left:10.3%;right:auto;bottom:75px;width:57px;height:72px}
  html[data-palette="pixel"] .px-kid2{left:85%;right:auto;bottom:75px;width:57px;height:72px}
  html[data-palette="pixel"] .px-cat{left:29.7%;right:auto;bottom:76px;width:62px;height:39px}
  html[data-palette="pixel"] .px-dog{left:63.6%;right:auto;bottom:76px;width:67px;height:42px}
  html[data-palette="pixel"] .px-bee1{left:44%;bottom:176px;width:30px;height:17px}
  html[data-palette="pixel"] .px-bee2{left:54%;bottom:190px;width:30px;height:17px}
  html[data-palette="pixel"] .px-bird{width:36px;height:16px}
  html[data-palette="pixel"] .px-plane{width:34px;height:17px;left:0;top:calc(3% + env(safe-area-inset-top,0px))}
  html[data-palette="pixel"] .px-sun{width:88px;height:88px;right:4%;top:calc(3% + env(safe-area-inset-top,0px))}
  /* the land runs the full width and the side design stays on top of it */
  html[data-palette="pixel"] .px-hero .px-ground{left:0;right:0}
  html[data-palette="pixel"] .pillar{z-index:3}
}
html[data-palette="pixel"] .px-ground{z-index:0}
html[data-palette="pixel"] .px-hero svg{z-index:1}
html[data-layout="mobile"][data-palette="pixel"] .px-hero .px-ground{left:0;right:0}
html[data-layout="mobile"][data-palette="pixel"] .pillar{z-index:3}
html[data-layout="mobile"][data-palette="pixel"] .px-sun{top:calc(3% + env(safe-area-inset-top,0px))}
html[data-layout="mobile"][data-palette="pixel"] .px-plane{top:calc(3% + env(safe-area-inset-top,0px))}
html[data-layout="mobile"][data-palette="pixel"] .px-grass{height:24px;border-top-width:4px}
html[data-layout="mobile"][data-palette="pixel"] .px-dirt{height:64px}
html[data-layout="mobile"][data-palette="pixel"] .px-palms{left:3.1%;right:auto;bottom:82px;width:146px;height:104px}
html[data-layout="mobile"][data-palette="pixel"] .px-banyan{right:3.1%;left:auto;bottom:82px;width:174px;height:112px}
html[data-layout="mobile"][data-palette="pixel"] .px-bush1{left:5.1%;right:auto;bottom:78px;width:49px;height:22px}
html[data-layout="mobile"][data-palette="pixel"] .px-bush2{right:4.4%;left:auto;bottom:78px;width:45px;height:20px}
html[data-layout="mobile"][data-palette="pixel"] .px-fl1{left:43.6%;right:auto;bottom:78px;width:24px;height:36px}
html[data-layout="mobile"][data-palette="pixel"] .px-fl2{left:60%;right:auto;bottom:78px;width:24px;height:36px}
html[data-layout="mobile"][data-palette="pixel"] .px-tuft1{left:23.6%;right:auto;bottom:78px;width:22px;height:16px}
html[data-layout="mobile"][data-palette="pixel"] .px-tuft2{left:77.5%;right:auto;bottom:78px;width:22px;height:16px}
html[data-layout="mobile"][data-palette="pixel"] .px-rock{left:50.8%;right:auto;bottom:78px;width:30px;height:15px}
html[data-layout="mobile"][data-palette="pixel"] .px-kid1{left:10.3%;right:auto;bottom:75px;width:57px;height:72px}
html[data-layout="mobile"][data-palette="pixel"] .px-kid2{left:85%;right:auto;bottom:75px;width:57px;height:72px}
html[data-layout="mobile"][data-palette="pixel"] .px-cat{left:29.7%;right:auto;bottom:76px;width:62px;height:39px}
html[data-layout="mobile"][data-palette="pixel"] .px-dog{left:63.6%;right:auto;bottom:76px;width:67px;height:42px}
html[data-layout="mobile"][data-palette="pixel"] .px-bee1{left:44%;bottom:176px;width:30px;height:17px}
html[data-layout="mobile"][data-palette="pixel"] .px-bee2{left:54%;bottom:190px;width:30px;height:17px}
html[data-layout="mobile"][data-palette="pixel"] .px-bird{width:36px;height:16px}
html[data-layout="mobile"][data-palette="pixel"] .px-plane{width:34px;height:17px;left:0;top:calc(3% + env(safe-area-inset-top,0px))}
html[data-layout="mobile"][data-palette="pixel"] .px-sun{width:88px;height:88px;right:4%;top:calc(3% + env(safe-area-inset-top,0px))}
/* ---- "thinking" lives inside the chat, right under your own message ---- */
.typing-row{margin:6px 0 10px}
/* --- 💡 Analyzing… row (tap to open the thinking sheet) --- */
.think-card{display:inline-flex;flex-direction:column;align-items:stretch;gap:2px;max-width:min(560px,92vw);padding:7px 10px 8px;border:1.5px solid var(--gold);border-radius:15px;background:var(--solid);box-shadow:0 6px 16px rgba(var(--sh),.10)}
.think-head{display:flex;align-items:center;gap:7px;cursor:pointer;user-select:none}
.think-ico{font-size:14px}
.think-title{font-size:12.5px;font-weight:800;letter-spacing:.01em}
.think-dots{display:inline-flex;gap:3px;margin-left:1px}
.think-dots .tdot{width:4px;height:4px}
.think-secs{font-size:10.5px;font-weight:700;color:var(--muted);margin-left:auto}
.think-chev{font-size:14px;font-weight:800;color:var(--muted);transition:transform .2s ease}
.think-head.open .think-chev{transform:rotate(90deg)}
.think-skip{margin-left:2px;padding:3px 9px;font-size:10.5px;font-weight:800;border-radius:999px;border:1.5px solid rgba(192,57,43,.45);background:#fff;color:#c0392b;cursor:pointer;font-family:inherit}
.think-skip:hover{background:rgba(192,57,43,.08)}
.think-sheet{margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11px;color:var(--muted);max-width:min(520px,86vw)}
.think-step{padding:1px 0}
.think-step.done{opacity:.6}
.think-step.now{color:var(--primary);font-weight:700}
.think-note{margin-top:5px;font-size:10px;font-style:italic;opacity:.8}
/* =====================================================
   🧠 “Thinking…” — a FIXED window, the same size every time
   -----------------------------------------------------
   The box never grows or shrinks with the answer: it is one size
   (620 × 190 on a computer, 88vw × 172 on a phone), the rows of thought
   fill it and the oldest slide away under the mask. The head sits on
   top, the small caption on the bottom, so the shape is always the same.
   ===================================================== */
.think-card{width:min(620px,94vw);max-width:none;height:190px;padding:11px 14px 10px;
  display:flex;flex-direction:column;overflow:hidden}
.think-head{gap:6px;flex:0 0 auto}
.think-lead{font-size:13px;font-weight:900;color:var(--muted);line-height:1;transition:transform .22s ease}
.think-head.open .think-lead{transform:rotate(180deg)}
.think-title{font-size:13.5px;font-weight:800}
.think-stream{position:relative;flex:1 1 auto;min-height:0;margin-top:8px;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.35) 12px,#000 30px,#000 calc(100% - 4px),transparent 100%);
  mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.35) 12px,#000 30px,#000 calc(100% - 4px),transparent 100%)}
.think-col{position:relative;padding-left:15px;min-height:20px}
.think-col:before{content:"";position:absolute;left:3px;top:1px;bottom:2px;width:1px;
  background:linear-gradient(180deg,transparent,rgba(var(--gd),.30) 20%,rgba(var(--gd),.55) 70%,transparent)}
.think-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:13px;line-height:1.72;color:var(--text);opacity:.5;white-space:pre-wrap;word-break:break-word;transition:opacity .3s ease}
.think-line.now{opacity:.94}
.think-cursor{display:block;width:14px;height:14px;margin:8px 0 1px 0;border-radius:4px;background:var(--text);box-shadow:0 0 12px rgba(var(--gd),.35);animation:thinkPulse 1.15s ease-in-out infinite}
@keyframes thinkPulse{0%,100%{opacity:.20;transform:scale(.80)}45%{opacity:1;transform:scale(1)}}
.think-shimmer{position:absolute;left:0;right:0;top:0;height:46px;pointer-events:none;
  background:linear-gradient(180deg,transparent,rgba(var(--sa),.12),transparent);animation:thinkSweep 4.2s linear infinite}
@keyframes thinkSweep{0%{transform:translateY(-60px);opacity:0}25%{opacity:1}100%{transform:translateY(170px);opacity:0}}
.think-sheet{margin-top:6px;padding-top:6px;border-top:1px dashed var(--border);font-size:11px;color:var(--muted);
  max-width:100%;flex:0 0 auto;max-height:52%;overflow-y:auto}
.typing-row .think-card .typing-model{flex:0 0 auto;margin-top:6px;font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html[data-layout="mobile"] .think-card{width:88vw;height:172px;padding:10px 12px 9px}
html[data-layout="mobile"] .think-line{font-size:12.5px;line-height:1.68}
@media (max-width:560px){
  .think-card{width:92vw;height:172px}
  .think-line{font-size:12.5px}
}
@media (prefers-reduced-motion:reduce){
  .think-cursor{animation:none;opacity:.7}
  .think-shimmer{display:none}
  .think-line{transition:none}
}

html[data-layout="mobile"] .think-card{max-width:86vw}
/* --- 💭 Thinking line above an answer, closed by default --- */
.thinking{margin:0 0 6px;border:1px dashed var(--border);border-radius:11px;background:rgba(var(--te),.05);padding:2px 8px}
.thinking summary{font-size:10.5px;font-weight:800;color:var(--muted);cursor:pointer;list-style:none;padding:3px 0}
.thinking summary::-webkit-details-marker{display:none}
.thinking summary::after{content:"›";float:right;font-weight:800;transition:transform .2s ease}
.thinking[open] summary::after{transform:rotate(90deg)}
.thinking-body{margin:2px 0 6px;padding-top:5px;border-top:1px dashed var(--border);font-size:10.5px;line-height:1.5;white-space:pre-wrap;color:var(--muted)}
.typing-row .typing-bubble{padding:10px 14px;box-shadow:0 4px 12px rgba(var(--sh),.10)}
.typing-model{font-size:11px;font-weight:700;color:var(--muted);margin-left:2px;white-space:nowrap}
/* ---- uploaded pictures: one slim heritage frame, no heavy border ---- */
.message.has-attach .bubble{padding:7px 9px 9px;border-radius:14px}
.message.has-attach.user .bubble{border-bottom-right-radius:5px}
.message.has-attach.assistant .bubble{border-bottom-left-radius:5px}
.attach{gap:6px;margin-bottom:7px;padding-bottom:0;border-bottom:0}
.attach img{max-height:230px;border:2px solid #C9962E;border-width:2px;border-style:solid;border-color:#C9962E;border-radius:5px;
  box-shadow:0 0 0 1px rgba(255,252,244,.92),0 3px 10px rgba(120,70,20,.16);background:rgba(255,255,255,.25)}
.attach-label{font-size:10.5px;letter-spacing:.1px;opacity:.92}
/* ---- the round file button: slim, left corner, pops in when a file arrives ---- */
.attach-mini{width:34px;height:34px;margin:0;padding:0;gap:0;max-width:none}
.attach-mini .thumb{width:26px;height:26px}
.attach-mini .mini-ico{width:26px;height:26px;font-size:13px}
.attach-mini .mini-name{font-size:10.5px;max-width:170px}
.attach-mini.show{display:flex;animation-name:attachPop,glowBreath;animation-duration:.44s,2.9s;
  animation-timing-function:cubic-bezier(.2,.9,.3,1.35),ease-in-out;animation-iteration-count:1,infinite}
@keyframes attachPop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.attach-mini.show{animation-name:none}}
/* ---- phone status bar / camera island and gesture bar stay clear ---- */
.app{padding-top:env(safe-area-inset-top,0px)}
.composer-wrap{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}
html[data-palette="pixel"] body.chatting::before,
html[data-palette="pixel"] body.chatting::after{top:env(safe-area-inset-top,0px)}
.royal-frame .pillar{top:env(safe-area-inset-top,0px)}
.px-sun{top:calc(2% + env(safe-area-inset-top,0px))}
/* ---- the round file button: a picture shows as a clean circle (no name beside it) ---- */
.attach-wrap{position:relative;display:flex;justify-content:flex-end;margin:0 0 6px auto;width:100%}
.attach-mini.no-name{padding:0;gap:0}
.attach-mini .mini-x{display:none}
html[data-layout="mobile"] .attach-wrap,html[data-layout="mobile"] .attach-mini{width:34px;height:34px}
.attach-panel.ap-open{animation-name:attachPanelUp;animation-duration:.22s;animation-timing-function:cubic-bezier(.2,.9,.3,1.1)}
@keyframes attachPanelUp{0%{opacity:0;transform:translateY(8px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}
html[data-layout="mobile"] .attach-panel{right:0;width:min(252px,88vw)}
.attach-mini.no-name .ministuff,.attach-mini.no-name .mini-name{display:none}
.attach-mini.no-name .thumb{width:30px;height:30px}
/* ---- Stop button: the running answer can always be cancelled ---- */
.send-btn .stop-ico{display:none;width:14px;height:14px;border-radius:4px;background:currentColor}
.send-btn.stop{background:var(--solid);color:var(--primary);border:1.5px solid var(--border);box-shadow:0 4px 12px rgba(var(--sh),.14);animation-name:stopPulse;animation-duration:1.4s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}
.send-btn.stop .go-ico{display:none}
.send-btn.stop .stop-ico{display:block}
.send-btn.stop:hover{transform:none}
@keyframes stopPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@media (prefers-reduced-motion:reduce){.send-btn.stop{animation-name:none}}

/* =====================================================
   BATCH 36 (b53) — the new pieces of the interface
   top-bar menu · pinned chats · find in chat · the model lists ·
   the toast with Undo · the arrow that jumps to the newest message
   ===================================================== */
/* ---------- the top bar: ✏️ New chat + ⋮, like a modern chat app ---------- */
.mf-hide{display:none !important}
.top-actions{gap:8px;align-items:center}
.new-chat-btn{width:auto;padding:0 14px;gap:7px;border-radius:999px}
.new-chat-btn svg{width:17px;height:17px}
.new-chat-txt{font-size:13.5px;font-weight:700;letter-spacing:.01em;white-space:nowrap}
@media (max-width:430px){.new-chat-txt{display:none}.new-chat-btn{padding:0 10px}}
.mf-menu{
  position:absolute;right:0;top:calc(100% + 8px);z-index:80;min-width:216px;padding:7px;
  background:var(--solid);border:1px solid rgba(var(--sh),.12);border-radius:16px;
  box-shadow:0 18px 44px rgba(var(--sh),.20);display:none;
}
.mf-menu.show{display:block}
.mf-mi{
  display:flex;align-items:center;gap:11px;width:100%;padding:10px 12px;border:0;border-radius:11px;
  background:transparent;color:var(--text);font:600 14px/1.2 inherit;text-align:left;cursor:pointer;
}
.mf-mi:hover{background:rgba(var(--sh),.07)}
.mf-mi:active{transform:scale(.985)}
.mf-mi-ic{width:20px;font-size:15px;text-align:center}
.mf-mi-sep{height:1px;margin:5px 8px;background:rgba(var(--sh),.12)}
body.dark .mf-menu{background:#141b2e;border-color:rgba(255,255,255,.12)}
/* ---------- find in chat ---------- */
.find-bar{
  position:fixed;left:0;right:0;top:var(--mf-top,64px);z-index:75;
  display:flex;align-items:center;gap:8px;padding:9px 14px;
  background:var(--solid);border-bottom:1px solid rgba(var(--sh),.12);
  box-shadow:0 10px 26px rgba(var(--sh),.12);
}
.find-bar[hidden]{display:none}
.find-bar .mf-find-ic{font-size:15px;opacity:.7}
.find-input{
  flex:1;min-width:0;border:1px solid rgba(var(--sh),.16);border-radius:11px;padding:9px 12px;
  font:600 14px/1.3 inherit;background:var(--bg);color:var(--text);
}
.find-input:focus{outline:2px solid rgba(10,102,255,.35);outline-offset:1px}
.find-count{min-width:74px;font:700 12px/1 inherit;color:var(--muted);text-align:center}
.find-btn{
  border:1px solid rgba(var(--sh),.16);background:var(--bg);color:var(--text);border-radius:10px;
  width:34px;height:34px;font-size:14px;cursor:pointer;
}
.find-btn:hover{background:rgba(var(--sh),.08)}
mark.mf-hit{background:linear-gradient(180deg,#FFE9A8,#FFD86B);color:#3A2B00;border-radius:4px;padding:0 1px}
mark.mf-hit.on{background:linear-gradient(180deg,#FFC53D,#FF9E3D);box-shadow:0 0 0 2px rgba(255,158,61,.35)}
body.dark mark.mf-hit{background:linear-gradient(180deg,#8a6a12,#6d520c);color:#FFF3D6}
body.dark mark.mf-hit.on{background:linear-gradient(180deg,#FFC53D,#FF9E3D);color:#2b2000}
/* ---------- pinned chats ---------- */
.pin-bar{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  margin:0 auto 8px;width:min(100%,760px);padding:7px 9px;border-radius:14px;
  background:rgba(255,255,255,.72);border:1px solid rgba(10,102,255,.16);
  box-shadow:0 8px 22px rgba(10,102,255,.10);backdrop-filter:blur(6px);
}
.pin-bar[hidden]{display:none}
body.dark .pin-bar{background:rgba(20,27,46,.72);border-color:rgba(120,155,255,.22)}
.pin-tag{font:800 11.5px/1 inherit;letter-spacing:.04em;color:#0A66FF;text-transform:uppercase;padding-right:4px}
.pin-chip{
  max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  border:1px solid rgba(10,102,255,.22);background:rgba(10,102,255,.07);color:var(--text);
  border-radius:999px;padding:7px 13px;font:700 12.5px/1 inherit;cursor:pointer;
}
.pin-chip:hover{background:rgba(10,102,255,.14);box-shadow:0 4px 14px rgba(10,102,255,.18)}
.mf-pinned-group{margin-bottom:10px;padding-bottom:6px;border-bottom:1px dashed rgba(var(--sh),.18)}
.mf-pinned-head{font:800 11px/1 inherit;letter-spacing:.05em;text-transform:uppercase;color:#0A66FF;padding:4px 6px 7px}
.history-row.pinned .history-item{border-color:rgba(10,102,255,.28);background:rgba(10,102,255,.05)}
/* ---------- the arrow that jumps back to the newest message ---------- */
#jumpDown{
  position:absolute;left:50%;top:-46px;transform:translateX(-50%) translateY(6px);
  width:38px;height:38px;border-radius:50%;border:1px solid rgba(10,102,255,.25);
  background:var(--solid);color:#0A66FF;font-size:17px;line-height:1;cursor:pointer;
  box-shadow:0 10px 24px rgba(10,102,255,.22);display:none;align-items:center;justify-content:center;
  transition:opacity .2s ease,transform .2s ease;
}
#jumpDown.show{display:flex;animation:mfPop .2s ease-out}
#jumpDown[hidden]{display:none}
/* ---------- the toast (it carries the Undo) ---------- */
.mf-toast{
  position:fixed;left:50%;bottom:calc(var(--dock-h,120px) + 16px);transform:translateX(-50%) translateY(14px);
  z-index:120;display:none;align-items:center;gap:12px;max-width:min(92vw,560px);
  padding:12px 14px;border-radius:14px;background:#101827;color:#F4F7FF;
  box-shadow:0 18px 44px rgba(8,16,40,.36);font:600 13.5px/1.45 inherit;
}
.mf-toast.show{display:flex;animation:mfToastIn .22s ease-out forwards}
.mf-toast-txt{min-width:0}
.mf-toast-btn{
  border:0;border-radius:10px;padding:8px 13px;background:linear-gradient(135deg,#0A66FF,#2E90FF);
  color:#fff;font:800 13px/1 inherit;cursor:pointer;white-space:nowrap;
}
.mf-toast-btn:active{transform:scale(.97)}
.mf-toast-bar{
  position:absolute;left:12px;right:12px;bottom:5px;height:3px;border-radius:3px;
  background:linear-gradient(90deg,#0A66FF,#12BFA6);transform-origin:left center;
}
@keyframes mfToastBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@keyframes mfToastIn{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
/* ---------- the small popup that asks once more before a delete ---------- */
.mf-modal{
  position:fixed;inset:0;z-index:140;display:flex;align-items:center;justify-content:center;
  padding:18px;background:rgba(8,16,40,.42);backdrop-filter:blur(3px);
}
.mf-modal-card{
  width:min(100%,440px);max-height:86vh;overflow:auto;background:var(--solid);color:var(--text);
  border-radius:20px;padding:20px;border:1px solid rgba(var(--sh),.14);
  box-shadow:0 26px 60px rgba(8,16,40,.32);animation:mfPop .2s ease-out;
}
.mf-modal-card h3{margin:0 0 10px;font-size:17px}
.mf-modal-p{margin:0 0 14px;font-size:13.5px;line-height:1.6;color:var(--muted)}
.mf-modal-btns{display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px}
.mf-modal-hint{margin-top:12px;font-size:12px;line-height:1.55;color:var(--muted)}
.mf-btn{
  border:1px solid rgba(var(--sh),.18);background:var(--bg);color:var(--text);
  border-radius:11px;padding:10px 16px;font:700 13.5px/1 inherit;cursor:pointer;
}
.mf-btn:hover{background:rgba(var(--sh),.08)}
.mf-btn.primary{background:linear-gradient(135deg,#0A66FF,#2E90FF);border-color:transparent;color:#fff}
.mf-btn.danger{background:#C62828;border-color:transparent;color:#fff}
.mf-btn.tiny{padding:7px 11px;font-size:12px}
.mf-linkrow{display:flex;gap:8px;margin:0 0 6px}
.mf-link{
  flex:1;min-width:0;border:1px solid rgba(var(--sh),.16);border-radius:11px;padding:10px 12px;
  font:600 12.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);color:var(--text);
}
body.dark .mf-modal-card{background:#141b2e}
/* ---------- the model list in Settings (hold to delete) ---------- */
.mf-model-row{
  position:relative;display:flex;align-items:center;gap:11px;padding:10px 11px;border-radius:13px;
  border:1px solid rgba(var(--sh),.12);background:var(--solid);margin-bottom:8px;overflow:hidden;
  transition:box-shadow .25s ease,transform .16s ease}
.mf-model-row:hover{box-shadow:0 8px 22px rgba(10,102,255,.12)}
.mf-model-row .mf-model-ico{width:26px;height:26px;display:flex;align-items:center;justify-content:center;flex:none}
.mf-model-row .mf-model-ico svg,.mf-model-row .mf-model-ico img{width:24px;height:24px;border-radius:7px}
.mf-model-txt{min-width:0;display:flex;flex-direction:column;gap:2px;flex:1}
.mf-model-txt b{font-size:13.5px}
.mf-model-txt small{font-size:11.5px;color:var(--muted)}
.mf-hold-hint{font:700 11px/1 inherit;color:var(--muted);letter-spacing:.02em;white-space:nowrap;padding-left:6px}
.mf-model-row.mf-gone{opacity:.62}
.mf-model-row.holding,.model-item.holding,.history-item.holding{background:rgba(198,40,40,.10) !important}
.hold-fill{
  position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:left center;pointer-events:none;
  background:linear-gradient(90deg,rgba(198,40,40,.34),rgba(198,40,40,.16));
  animation:mfHold linear forwards;
}
@keyframes mfHold{from{transform:scaleX(0)}to{transform:scaleX(1)}}
/* ---------- dark mode row inside Settings ---------- */
.mf-darkrow{display:flex;align-items:center;gap:11px;padding:10px 4px 2px}
.mf-switch{
  width:52px;height:30px;border-radius:999px;border:1px solid rgba(var(--sh),.20);background:rgba(var(--sh),.12);
  position:relative;cursor:pointer;flex:none;transition:background .25s ease}
.mf-switch i{
  position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;
  box-shadow:0 2px 7px rgba(8,16,40,.28);transition:transform .25s ease}
.mf-switch[aria-checked="true"]{background:linear-gradient(135deg,#0A66FF,#2E90FF)}
.mf-switch[aria-checked="true"] i{transform:translateX(22px)}
.mf-darktxt{font-size:12.5px;color:var(--muted)}
/* ---------- the pinned chips sit just above the chat box ---------- */
html[data-layout="mobile"] .pin-bar{width:100%;border-radius:12px}
html[data-layout="mobile"] .pin-chip{max-width:150px;font-size:12px}
html[data-layout="mobile"] #jumpDown{top:-42px;width:36px;height:36px}


/* ===== b58 ===== */
/* =====================================================================
   BATCH 98 — the stylesheet half
   ===================================================================== */

/* ---------- 1 · the merged panel, in every design -------------------- */
/* (the loop-only selectors are made global in the build; these are the
   finishing touches that used to exist only inside the loop sheet) */
#modelMenu #replyMenu .model-menu-title{display:none}
#modelMenu .model-menu-title.mf-sec{display:block}
#modelMenu .mf-voice-row{display:flex;align-items:center;gap:9px;padding:2px 4px 6px}
#modelMenu .voice-lang{display:flex;flex:1 1 auto;min-width:0;margin:0}
#modelMenu .voice-lang select{flex:1 1 auto;min-width:0}
#modelMenu{max-height:min(66vh,520px);overflow-y:auto}
/* the panel is a proper sheet while it is open, so a choice never closes it */
#modelMenu.show{box-shadow:0 22px 54px rgba(10,40,110,.26)}

/* ---------- 2 · the word, and the tag line 2 inches under it --------- */
/* the section that holds the word holds the tag line too, as one column:
   no element is ever moved, so the page keeps its own shape */
html[data-palette="loop"] #gateHero{
  display:flex !important;flex-direction:column;align-items:center;
  justify-content:flex-start !important;width:100% !important;max-width:100% !important;
  margin:0 !important;padding:0 !important
}
/* the old gate drawing is invisible in this design, and an invisible 1316px
   block was what pushed the word down the page */
html[data-palette="loop"] #gateHero > svg{display:none !important}
html[data-palette="loop"] #gateHero .mf-hero{
  position:relative !important;inset:auto !important;height:auto !important;
  transform:none !important;width:100% !important;max-width:100% !important;margin:0 !important
}
html[data-palette="loop"] .mf-hero .mf-stage{
  width:100% !important;max-width:100% !important;margin:0 !important;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start
}
html[data-palette="loop"] .gate-inner{
  position:static !important;transform:none !important;
  width:auto !important;height:auto !important;
  /* the script measures the word's ink and sets --mf-tag-gap so the gap really
     is two inches on screen, not two inches of invisible SVG tail */
  margin-left:auto !important;margin-right:auto !important;margin-bottom:0 !important;
  margin-top:var(--mf-tag-gap,110px) !important;
  display:flex;flex-direction:column;align-items:center;
  padding:0 8px;
}
html[data-palette="loop"] .gate-inner .gate-logo{display:none !important}
/* on a narrow phone the word used to overflow its column and sit 8px right */
html[data-palette="loop"] .mf-brand{max-width:100% !important;min-width:0 !important}
html[data-palette="loop"] .mf-brand svg{max-width:100% !important;height:auto !important}
html[data-palette="loop"] .gate-inner p{
  margin:0 !important;max-width:34ch;text-align:center;
  color:var(--muted);opacity:.9
}

/* ---------- 3 · the back-to-the-newest-message button ---------------- */
#jumpDown{
  position:absolute;left:50%;top:-52px;transform:translateX(-50%) translateY(4px);
  width:auto;min-width:40px;height:40px;padding:0 13px 0 10px;
  display:none;align-items:center;gap:7px;
  border-radius:999px;border:1px solid rgba(var(--pr,10,102,255),.3);
  background:var(--solid);color:var(--primary);
  font:700 12px/1 inherit;cursor:pointer;
  box-shadow:0 10px 26px rgba(10,40,110,.20),0 1px 0 rgba(255,255,255,.6) inset;
  transition:opacity .18s ease,transform .18s ease;
}
#jumpDown:before{
  content:"";width:15px;height:15px;flex:0 0 auto;
  background:currentColor;
  -webkit-mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M12 4v14M5.5 11.5 12 18l6.5-6.5'/></svg>") center/contain no-repeat;
  mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M12 4v14M5.5 11.5 12 18l6.5-6.5'/></svg>") center/contain no-repeat;
}
#jumpDown:after{content:"Newest";font:700 12px/1 inherit}
#jumpDown.show{display:inline-flex;animation:mfJumpIn .22s ease-out}
@keyframes mfJumpIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(4px)}}
body.dark #jumpDown{background:rgb(var(--sol-d));color:#8FB4FF;border-color:rgba(143,180,255,.34)}
@media (prefers-reduced-motion:reduce){#jumpDown.show{animation:none}}

/* ---------- 4 · the one-inch picture box and its slide -------------- */
.attach-wrap{position:relative}
.attach-mini{
  width:96px !important;height:96px !important;border-radius:18px !important;
  overflow:hidden !important;padding:0 !important;
  border:2px solid var(--gold) !important;
  box-shadow:0 10px 26px rgba(var(--sh),.22),0 0 0 3px rgba(233,185,73,.18) !important;
}
.attach-mini .thumb{width:100% !important;height:100% !important;border-radius:14px !important;object-fit:cover !important}
.attach-mini .mini-ico{width:100% !important;height:100% !important;border-radius:14px !important;font-size:34px}
.attach-mini.has-many:after{
  content:attr(data-count);
  position:absolute;right:5px;bottom:5px;min-width:22px;height:22px;padding:0 6px;
  display:flex;align-items:center;justify-content:center;
  border-radius:999px;background:#0A66FF;color:#fff;
  font:800 11.5px/1 Inter,system-ui,sans-serif;box-shadow:0 3px 10px rgba(10,40,110,.35)
}
.attach-wrap .attach-mini{position:relative}
.mf-pic-box{
  position:absolute;right:0;bottom:calc(100% + 12px);
  width:min(78vw,330px);display:none;gap:8px;padding:9px;
  border-radius:16px;border:1px solid rgba(var(--bd-l),.35);
  background:var(--solid);box-shadow:0 18px 44px rgba(10,40,110,.22);
  overflow-x:auto;overflow-y:hidden;
  scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;
}
.mf-pic-box.show{display:flex}
.mf-pic-cell{
  position:relative;flex:0 0 auto;width:96px;height:96px;margin:0;
  border-radius:12px;overflow:hidden;background:rgba(var(--sa),.14);
  scroll-snap-align:center;
}
.mf-pic-cell img{width:100%;height:100%;object-fit:cover;display:block}
.mf-pic-x{
  position:absolute;right:3px;top:3px;width:22px;height:22px;padding:0;
  border-radius:999px;border:0;cursor:pointer;
  background:rgba(12,18,32,.72);color:#fff;font:700 11px/1 Inter,system-ui,sans-serif;
  display:flex;align-items:center;justify-content:center;
}
body.dark .mf-pic-box{background:rgb(var(--sol-d));border-color:rgba(255,255,255,.14)}

/* ---------- 5 · the live thinking panel ----------------------------- */
.typing-row .mf-live-box{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.typing-row.mf-live-on .think-stream{display:none !important}
.typing-row.mf-live-on .think-sheet{display:none !important}
.mf-live-text{
  font:400 13.2px/1.66 Inter,system-ui,sans-serif;color:var(--text);
  white-space:pre-wrap;word-break:break-word;
  max-height:210px;overflow-y:auto;
  padding-left:10px;border-left:3px solid rgba(var(--pr,10,102,255),.45);
}
.mf-live-thought{
  font:400 11.8px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:var(--muted);white-space:pre-wrap;word-break:break-word;
  max-height:120px;overflow-y:auto;opacity:.85;padding-left:10px;
  border-left:2px dashed rgba(var(--bd-l),.45);
}
.typing-row.mf-live-on .think-title:after{content:" · live";font-weight:600;opacity:.7;font-size:11px}
/* waiting for the first token: a calm pulse, never a fake sentence */
.typing-row.mf-waiting .think-title:after{content:"";display:inline-block;width:7px;height:7px;margin-left:6px;
  border-radius:999px;background:currentColor;opacity:.6;animation:mfPulse 1.1s ease-in-out infinite}
@keyframes mfPulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:.9;transform:scale(1.1)}}
body.dark .mf-live-text{color:#EEF4FF}

/* ---------- 6 · the history drawer, readable in the dark ------------ */
body.dark .drawer{background:rgb(var(--sol-d));color:var(--txt-d)}
body.dark .drawer .history-item{color:var(--txt-d)}
body.dark .drawer .history-title{color:var(--txt-d)}
body.dark .drawer .history-date{color:var(--mut-d);opacity:.9}
body.dark .drawer .history-item:hover{background:rgba(143,180,255,.12)}
body.dark .drawer .drawer-title{color:var(--txt-d)}
body.dark .history-row.pinned .history-item{background:rgba(10,102,255,.16);border-color:rgba(143,180,255,.3)}
body.dark .mf-pinned-head{color:#8FB4FF}
body.dark .clear-all-btn,body.dark .cab-btn{background:rgba(255,255,255,.08);color:var(--txt-d);border-color:rgba(255,255,255,.2)}
body.dark .cab-btn.go{background:#2F6BFF;color:#fff}
body.dark .history-item{color:var(--text)}

/* ---------- 7 · a phone: everything still fits ---------------------- */
@media (max-width:820px){
  html[data-palette="loop"] .gate-inner{margin-top:var(--mf-tag-gap,110px) !important}
  .attach-mini{width:82px !important;height:82px !important}
  .mf-pic-box{width:min(84vw,320px)}
  .mf-live-text{max-height:170px}
}


/* ===== b59 ===== */
/* =====================================================================
   BATCH 98 — the picture button, the viewer and the layers
   ===================================================================== */

/* ---------- 1 · the square is half the size, and it floats ---------- */
.attach-mini{
  width:52px !important;height:52px !important;border-radius:14px !important;
  border-width:2px !important;transition:box-shadow .18s ease,transform .12s ease
}
.attach-mini .thumb{width:100% !important;height:100% !important;border-radius:11px !important;object-fit:cover !important}
.attach-mini .mini-ico{width:100% !important;height:100% !important;border-radius:11px !important;font-size:20px}
.attach-mini.has-many:after{
  right:-5px;bottom:-5px;min-width:19px;height:19px;padding:0 5px;
  font:800 10.5px/1 Inter,system-ui,sans-serif
}
.attach-mini.mf-float{
  position:fixed !important;z-index:70;margin:0 !important;
  touch-action:none;cursor:grab;
  box-shadow:0 12px 26px rgba(10,40,110,.34),0 0 0 3px rgba(233,185,73,.22);
  will-change:left,top
}
.attach-mini.mf-float:hover{transform:translateY(-2px)}
.attach-mini.mf-float.dragging{
  cursor:grabbing;transform:scale(1.08) rotate(-2deg);
  box-shadow:0 18px 38px rgba(10,40,110,.42),0 0 0 4px rgba(233,185,73,.32)
}
@media (max-width:820px){
  .attach-mini{width:48px !important;height:48px !important}
}

/* ---------- 2 · nothing hangs around for a picture ---------- */
/* the name / crop / remove card was covering the page after an upload */
body.mf-has-pic #attachPanel{display:none !important}
body.mf-has-pic .attach-wrap{position:static !important}
/* the old horizontal strip is replaced by the viewer below */
.mf-pic-box{display:none !important}

/* ---------- 3 · on a PC the ready prompts must not sit on the cards -- */
@media (min-width:821px){
  body.mf-suggest-open .shortcuts{display:none !important}
}

/* ---------- 4 · the viewer: slide through the pictures, crop one ------ */
.mfv{
  position:fixed;inset:0;z-index:120;display:none;align-items:center;justify-content:center;
  padding:16px;background:rgba(6,12,26,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)
}
.mfv.show{display:flex;animation:mfvIn .16s ease-out}
@keyframes mfvIn{from{opacity:0}to{opacity:1}}
.mfv-card{
  position:relative;width:min(560px,94vw);max-height:92vh;
  display:flex;flex-direction:column;gap:10px;padding:12px;
  border-radius:20px;background:var(--solid);box-shadow:0 30px 80px rgba(0,0,0,.45)
}
.mfv-x{
  position:absolute;right:8px;top:8px;z-index:2;width:30px;height:30px;
  border:0;border-radius:999px;background:rgba(12,18,32,.62);color:#fff;
  font:700 13px/1 Inter,system-ui,sans-serif;cursor:pointer;
  display:flex;align-items:center;justify-content:center
}
.mfv-stage{
  display:flex;align-items:center;justify-content:center;overflow:hidden;
  min-height:0;flex:1 1 auto;border-radius:14px;background:rgba(var(--sa),.12)
}
.mfv-img{display:block;max-width:100%;max-height:62vh;object-fit:contain}
.mfv-nav{display:flex;align-items:center;justify-content:center;gap:14px}
.mfv-prev,.mfv-next{
  width:38px;height:38px;border-radius:999px;border:1px solid var(--gold);
  background:var(--solid);color:var(--text);cursor:pointer;
  font:700 20px/1 Inter,system-ui,sans-serif
}
.mfv-prev[disabled],.mfv-next[disabled]{opacity:.3;cursor:default}
.mfv-count{
  min-width:58px;text-align:center;
  font:700 12.5px/1 Inter,system-ui,sans-serif;color:var(--muted)
}
.mfv-acts{display:flex;gap:8px}
.mfv-acts button{
  flex:1 1 0;height:38px;border-radius:12px;cursor:pointer;
  border:1px solid rgba(var(--bd-l),.4);background:rgba(var(--sa),.10);color:var(--text);
  font:700 12.5px/1 Inter,system-ui,sans-serif
}
.mfv-acts .mfv-del{color:#D33;border-color:rgba(221,51,51,.35)}
.mfv-acts button:hover{background:rgba(var(--sa),.18)}
body.dark .mfv-card{background:rgb(var(--sol-d))}
body.dark .mfv-acts button{color:var(--txt-d)}
@media (max-width:820px){
  .mfv-card{width:96vw;padding:10px;border-radius:16px}
  .mfv-img{max-height:56vh}
}


/* ===== b60 ===== */
/* ===== b60 ===== */

/* ---------- 1 · the theme wave ---------- */
.mf-wipe{
  position:fixed;inset:0;z-index:2147483000;pointer-events:none;
  clip-path:circle(0px at 100% 0%);opacity:1;
  transition:opacity .38s ease;will-change:clip-path,opacity
}
.mf-wipe.to-dark{
  background:radial-gradient(130% 122% at 100% 0%,
    #1B2440 0%,#111A2E 38%,#0A0F1C 68%,#05070D 100%)
}
.mf-wipe.to-light{
  background:radial-gradient(130% 122% at 0% 100%,
    #FFFFFF 0%,#FAFDFF 34%,#F3F8FF 66%,#E7F0FF 100%);
  clip-path:circle(0px at 0% 100%)
}
.mf-wipe.run{
  clip-path:circle(168% at 100% 0%);
  transition:clip-path .62s cubic-bezier(.52,.03,.24,1),opacity .38s ease
}
.mf-wipe.to-light.run{clip-path:circle(168% at 0% 100%)}
.mf-wipe::after{
  content:"";position:absolute;inset:0;
  background:radial-gradient(60% 70% at 100% 0%,rgba(255,255,255,.16),transparent 62%);
  opacity:.9
}
.mf-wipe.to-light::after{
  background:radial-gradient(60% 70% at 0% 100%,rgba(10,102,255,.10),transparent 62%)
}
.mf-wipe.fade{opacity:0}
@media (prefers-reduced-motion: reduce){.mf-wipe{display:none}}

/* the little file icon must never show next to the picture itself */
.attach-mini .mini-ico[hidden]{display:none !important}

/* ---------- 2 · the press-and-hold menu in the chat history ---------- */
.history-row{-webkit-touch-callout:none}
.history-row.mf-holding{
  background:rgba(10,102,255,.10);border-radius:12px;
  box-shadow:inset 0 0 0 1px rgba(10,102,255,.18)
}
.mf-hold-menu{
  position:fixed;z-index:2147482900;min-width:178px;padding:6px;
  border-radius:14px;background:linear-gradient(180deg,#FFFFFF,#F5F9FF);
  border:1px solid rgba(120,155,215,.35);
  box-shadow:0 18px 44px rgba(20,50,110,.26),0 2px 6px rgba(20,50,110,.12);
  animation:mfHoldIn .16s ease-out
}
body.dark .mf-hold-menu{
  background:linear-gradient(180deg,#1D2742,#131A2E);
  border-color:rgba(143,180,255,.28);
  box-shadow:0 18px 44px rgba(0,0,0,.55)
}
.mf-hold-item{
  display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;
  border:0;background:transparent;border-radius:10px;cursor:pointer;text-align:left;
  font:600 13.5px/1.2 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#12203a
}
body.dark .mf-hold-item{color:#EEF4FF}
.mf-hold-item:hover{background:rgba(10,102,255,.10)}
body.dark .mf-hold-item:hover{background:rgba(143,180,255,.14)}
.mf-hold-cancel{color:#6b7893;font-weight:600;font-size:12.5px}
body.dark .mf-hold-cancel{color:#A7B5D3}
@keyframes mfHoldIn{
  from{opacity:0;transform:translateY(4px) scale(.97)}
  to{opacity:1;transform:none}
}


/* ===== b61 ===== */
/* ===== b61 ===== */
/* 1 · no pinned strip on the home / new-chat page */
#pinBar,.pin-bar{display:none !important}
/* 2 · pinned chats: normal rows, just a 📌 on the right, pinned stay on top */
.history-row.pinned .history-item{border-color:var(--border);background:transparent;box-shadow:none}
.history-row .history-item{position:relative}
.mf-pin-mark{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:14px;line-height:1;pointer-events:none}
.mf-pinned-head,.mf-pinned-group{display:none !important}
/* 3 · no bin button any more */
.delete-history{display:none !important}
/* 4 · swipe a chat to the right: the red delete lane grows behind it */
.history-row{position:relative;overflow:hidden;border-radius:12px;touch-action:pan-y}
.mf-swipe-lane{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-start;padding-left:16px;background:linear-gradient(90deg,#dc2626,#ef4444);color:#fff;font:800 12.5px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;opacity:0;border-radius:12px;pointer-events:none}
.history-row.mf-swiping .history-item,.history-row.mf-swiping{transition:none}
.history-row.mf-swipe-out{transition:transform .28s ease,opacity .28s ease;transform:translateX(105%) !important;opacity:0}
/* 5 · the 3-second Undo popup */
.mf-undo-pop{position:fixed;left:50%;bottom:calc(var(--dock-h,120px) + 18px);transform:translateX(-50%) translateY(16px);z-index:2147482800;display:flex;align-items:center;gap:12px;max-width:min(92vw,520px);padding:12px 14px;border-radius:14px;background:#161616;color:#fff;box-shadow:0 18px 44px rgba(0,0,0,.38);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease;font:600 13px/1.35 Inter,system-ui,sans-serif}
.mf-undo-pop.show{opacity:1;transform:translateX(-50%);pointer-events:auto}
.mf-undo-pop button{flex:none;border:0;border-radius:999px;padding:8px 14px;background:#fff;color:#b91c1c;font:800 12.5px/1 Inter,system-ui,sans-serif;cursor:pointer}
.mf-undo-bar{position:absolute;left:14px;right:14px;bottom:5px;height:3px;border-radius:99px;background:rgba(255,255,255,.22);overflow:hidden}
.mf-undo-bar i{display:block;height:100%;background:#fca5a5;transform-origin:left;animation:mfUndoBar 3.5s linear forwards}
@keyframes mfUndoBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
/* 6 · back-to-newest: one small round button, one bold down arrow, no word */
#jumpDown{width:34px !important;height:34px !important;min-width:34px !important;padding:0 !important;border-radius:50% !important;gap:0 !important}
#jumpDown:after{content:none !important;display:none !important}
#jumpDown:before{width:18px !important;height:18px !important;-webkit-mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='none' stroke='black' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round' d='M12 3.5v16M5 12.5 12 19.5 19 12.5'/></svg>") center/contain no-repeat !important;mask:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='none' stroke='black' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round' d='M12 3.5v16M5 12.5 12 19.5 19 12.5'/></svg>") center/contain no-repeat !important}
/* 7 · the fighter-jet theme flight (about 2.5 s, corner to corner) */
.mf-jet-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden}
.mf-jet-shadow{position:absolute;inset:-12%;will-change:clip-path}
.mf-jet-layer.to-dark .mf-jet-shadow{background:radial-gradient(130% 122% at 100% 0%,#1B2440 0%,#111A2E 38%,#0A0F1C 68%,#05070D 100%)}
.mf-jet-layer.to-light .mf-jet-shadow{background:radial-gradient(130% 122% at 0% 100%,#FFFFFF 0%,#FAFDFF 34%,#F3F8FF 66%,#E7F0FF 100%)}
.mf-jet{position:absolute;left:0;top:0;width:118px;height:118px;will-change:transform;filter:drop-shadow(0 14px 22px rgba(0,0,0,.35))}
.mf-jet-trail{position:absolute;left:0;top:0;height:10px;border-radius:99px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.75));transform-origin:right center;will-change:transform,opacity;filter:blur(1px)}
@media (prefers-reduced-motion: reduce){.mf-jet-layer{display:none}}
@media (max-width:820px){.mf-jet{width:88px;height:88px}}

/* b89 - the pin lane behind a left swipe */
.mf-swipe-lane.mf-swipe-pinlane{justify-content:flex-end;padding-left:0;padding-right:16px;background:linear-gradient(270deg,var(--primary),var(--teal))}
/* b93 - while swiping, the item rides OVER the lane on a solid ground,
   so the lane word and the chat title can never overlap */
.history-row.mf-swiping .history-item{background:var(--surface);box-shadow:0 4px 14px rgba(0,0,0,.18);border-radius:12px;will-change:transform}
.mf-swipe-lane{z-index:0;font-size:13px}
.history-row .history-item{z-index:1}


/* ===== b62 ===== */
/* ===== b62 ===== */
/* the squadron: one big classical leader, two smaller wingmen behind */
.mf-jet{width:104px;height:104px}
.mf-jet.mf-leader{width:148px;height:148px;z-index:3;filter:drop-shadow(0 18px 26px rgba(0,0,0,.42))}
.mf-jet.mf-wing{width:88px;height:88px;z-index:2;opacity:.96;filter:drop-shadow(0 10px 18px rgba(0,0,0,.32))}
/* hazy, soft front edge of the coming theme (a loop of drifting mist) */
.mf-jet-haze{position:absolute;left:0;top:0;width:340px;height:340px;border-radius:50%;pointer-events:none;will-change:transform,opacity;filter:blur(28px);z-index:1}
.mf-jet-layer.to-dark .mf-jet-haze{background:radial-gradient(circle,rgba(16,24,48,.85) 0%,rgba(16,24,48,.45) 45%,transparent 70%)}
.mf-jet-layer.to-light .mf-jet-haze{background:radial-gradient(circle,rgba(255,255,255,.95) 0%,rgba(240,247,255,.55) 45%,transparent 70%)}
.mf-jet-haze i{position:absolute;inset:18%;border-radius:50%;border:2px solid rgba(255,255,255,.20);animation:mfHazeLoop 1.6s ease-in-out infinite alternate}
.mf-jet-layer.to-light .mf-jet-haze i{border-color:rgba(10,102,255,.14)}
@keyframes mfHazeLoop{from{transform:scale(.82);opacity:.35}to{transform:scale(1.12);opacity:.8}}
/* fire at every tail */
.mf-jet-fire{position:absolute;width:16px;height:44px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:linear-gradient(180deg,#FFF7CC 0%,#FBBF24 34%,#F97316 68%,rgba(239,68,68,.0) 100%);transform-origin:top center;animation:mfFire .18s ease-in-out infinite alternate;filter:blur(.4px);z-index:1}
@keyframes mfFire{from{transform:scaleY(.72) scaleX(.86);opacity:.75}to{transform:scaleY(1.18) scaleX(1.08);opacity:1}}
/* smoke puffs left along the flight path */
.mf-jet-puff{position:absolute;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(226,232,240,.75) 0%,rgba(203,213,225,.38) 55%,transparent 72%);filter:blur(6px);animation:mfPuff 1.5s ease-out forwards;z-index:1}
.mf-jet-layer.to-light .mf-jet-puff{background:radial-gradient(circle,rgba(148,163,184,.65) 0%,rgba(148,163,184,.30) 55%,transparent 72%)}
@keyframes mfPuff{from{transform:translate(-50%,-50%) scale(.35);opacity:.85}to{transform:translate(-50%,-50%) scale(1.9);opacity:0}}
/* real smoke resting in the corner where the planes arrived — 2.5 s */
.mf-corner-smoke{position:fixed;width:340px;height:340px;z-index:2147482950;pointer-events:none}
.mf-corner-smoke i{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(203,213,225,.8) 0%,rgba(148,163,184,.42) 52%,transparent 72%);filter:blur(10px);opacity:0;animation:mfCornerSmoke 2.5s ease-out forwards}
@keyframes mfCornerSmoke{0%{transform:translate(0,0) scale(.4);opacity:0}16%{opacity:.9}55%{opacity:.65}100%{transform:var(--mf-smoke-drift,translate(30px,-24px)) scale(2.1);opacity:0}}
@media (prefers-reduced-motion: reduce){.mf-corner-smoke,.mf-jet-haze,.mf-jet-puff{display:none}}
@media (max-width:820px){.mf-jet.mf-leader{width:108px;height:108px}.mf-jet.mf-wing{width:64px;height:64px}.mf-corner-smoke{width:240px;height:240px}}


/* ===== b63 ===== */
/* ===== b63 ===== */
/* one squadron container: the three planes can never come apart */
.mf-squad{position:absolute;left:0;top:0;width:360px;height:280px;z-index:3;pointer-events:none;will-change:transform}
.mf-plane{position:absolute;will-change:transform}
.mf-plane .mf-jet{position:relative;left:auto;top:auto}
.mf-plane-leader{left:106px;top:0;width:148px;height:148px;z-index:3}
.mf-plane-wingL{left:2px;top:132px;width:88px;height:88px;z-index:2}
.mf-plane-wingR{right:2px;top:132px;width:88px;height:88px;z-index:2}
.mf-plane .mf-jet-fire{position:absolute;left:50%;top:86%;margin-left:-8px;z-index:1}
/* smoke with contrast: white smoke when going dark, black smoke when going light */
.mf-jet-layer.to-dark .mf-jet-puff{background:radial-gradient(circle,rgba(255,255,255,.92) 0%,rgba(226,232,240,.5) 55%,transparent 72%)}
.mf-jet-layer.to-light .mf-jet-puff{background:radial-gradient(circle,rgba(15,23,42,.78) 0%,rgba(30,41,59,.45) 55%,transparent 72%)}
.mf-corner-smoke.to-dark i{background:radial-gradient(circle,rgba(255,255,255,.92) 0%,rgba(226,232,240,.5) 52%,transparent 72%)}
.mf-corner-smoke.to-light i{background:radial-gradient(circle,rgba(15,23,42,.8) 0%,rgba(30,41,59,.48) 52%,transparent 72%)}
@media (max-width:820px){.mf-squad{width:264px;height:206px}.mf-plane-leader{left:78px;width:108px;height:108px}.mf-plane-wingL,.mf-plane-wingR{top:98px;width:64px;height:64px}}


/* ===== b64 place ===== */
/* ===== b64 · place information inside an AI reply (new elements only) ===== */
.mf-place{margin-top:12px;border:1px solid var(--border,rgba(120,140,180,.35));border-radius:14px;overflow:hidden;background:rgba(127,150,200,.07)}
.mf-place-head{padding:10px 12px 8px}
.mf-place-name{font-weight:800;font-size:14px}
.mf-place-sub{font-size:11.5px;color:var(--muted,#8a94a6);margin-top:2px;line-height:1.4}
.mf-place-photos{display:flex;gap:8px;overflow-x:auto;padding:2px 12px 10px;scroll-snap-type:x mandatory}
.mf-place-photos figure{margin:0;flex:0 0 auto;scroll-snap-align:start}
.mf-place-photos img{width:190px;height:128px;object-fit:cover;border-radius:10px;display:block;background:rgba(127,150,200,.15)}
.mf-place-photos figcaption{font-size:9.5px;color:var(--muted,#8a94a6);margin-top:3px;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mf-place-map{height:240px;width:100%;background:rgba(127,150,200,.12)}
.mf-place-map img{width:100%;height:100%;object-fit:cover;display:block}
.mf-place-foot{display:flex;gap:10px;align-items:center;padding:8px 12px 10px;font-size:11.5px}
.mf-place-foot a{color:var(--primary,#0A66FF);font-weight:700;text-decoration:none}
.mf-place-err{padding:10px 12px;font-size:12px;color:var(--muted,#8a94a6)}
@media (max-width:820px){.mf-place-photos img{width:158px;height:108px}.mf-place-map{height:210px}}
/* b65 · lightbox + hide/show toggle (place card only) */
.mf-place-toggle{display:block;margin:0 auto 8px;padding:5px 12px;border-radius:999px;border:1px solid var(--border,rgba(120,140,180,.35));background:transparent;color:var(--muted,#8a94a6);font:600 11px/1 Inter,system-ui,sans-serif;cursor:pointer}
.mf-place-toggle:hover{color:var(--primary,#0A66FF)}
.mf-place-body[hidden]{display:none}
.mf-place-photos img{cursor:zoom-in}
.mf-lb{position:fixed;inset:0;z-index:2147482900;background:rgba(5,8,15,.93);display:flex;align-items:center;justify-content:center}
.mf-lb img{max-width:min(94vw,1100px);max-height:80vh;object-fit:contain;border-radius:10px}
.mf-lb-x{position:absolute;top:14px;right:16px;width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:16px;cursor:pointer}
.mf-lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:56px;border:0;border-radius:10px;background:rgba(255,255,255,.12);color:#fff;font-size:26px;cursor:pointer}
.mf-lb-prev{left:12px}.mf-lb-next{right:12px}
.mf-lb-bar{position:absolute;left:0;right:0;bottom:0;display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 16px;color:#DCE6F7;font:500 12px/1.4 Inter,system-ui,sans-serif;background:linear-gradient(0deg,rgba(0,0,0,.55),transparent)}
.mf-lb-bar a{color:#8FB4FF;font-weight:700;text-decoration:none}
.mf-lb-count{opacity:.75}
@media (max-width:820px){.mf-lb-nav{width:34px;height:48px}}


/* ===== b66 ===== */
/* ===== b66 ===== */
#modelBtn{transition:opacity .18s ease,transform .18s ease}
#modelBtn.mf-scroll-hidden{display:none !important}


/* ===== b67 ===== */
/* ===== b67 ===== */
/* Copy / Regenerate stay hidden until that message is tapped (3.5 s) */
.message-actions{opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-2px);transition:opacity .18s ease,visibility .18s,transform .18s ease}
.message.mf-actions-on .message-actions{opacity:1;visibility:visible;pointer-events:auto;transform:none}
/* the map canvas always fills its box — no cut-off right side */
.mf-place-map .mapboxgl-map{width:100% !important;height:100% !important}
.mf-place-map .mapboxgl-canvas-container,.mf-place-map .mapboxgl-canvas{width:100% !important;height:100% !important}


/* ===== b68 ===== */
/* the generated-time chip lives inside its bubble and travels with it */
.bubble{position:relative}
.bubble .time-chip{position:absolute;left:8px;top:-34px;z-index:30;white-space:nowrap}


/* ===== b69 place ===== */
/* ===== b69 · slim premium bezel for the photo + map box ===== */
.mf-place{
  margin-top:10px;border:1px solid var(--border,rgba(120,140,180,.28));border-radius:16px;
  background:linear-gradient(180deg,rgba(255,255,255,.35),rgba(127,150,200,.05));
  box-shadow:0 10px 28px rgba(15,35,80,.10),0 1px 3px rgba(15,35,80,.06)
}
body.dark .mf-place{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(127,150,200,.04));box-shadow:0 10px 28px rgba(0,0,0,.38),0 1px 3px rgba(0,0,0,.3)}
.mf-place-head{padding:8px 11px 5px}
.mf-place-name{font-size:13.5px;letter-spacing:.01em}
.mf-place-sub{font-size:11px;margin-top:1px}
.mf-place-photos{gap:6px;padding:0 8px 8px}
.mf-place-photos img{width:178px;height:118px;border-radius:9px;box-shadow:0 2px 8px rgba(15,35,80,.12)}
.mf-place-photos figcaption{font-size:9px;margin-top:2px}
.mf-place-map{height:225px;border-top:1px solid var(--border,rgba(120,140,180,.22))}
.mf-place-foot{padding:6px 11px 8px;font-size:11px}
.mf-place-toggle{padding:4px 11px;font-size:10.5px;margin:0 auto 7px}
@media (max-width:820px){
  .mf-place-photos img{width:150px;height:102px}
  .mf-place-map{height:200px}
}


/* ===== b80 place ===== */
/* b80 — the place card is a fixed premium window: its size never
   depends on how short the AI's words are */
.mf-place{width:min(520px,100%)}
.bubble:has(.mf-place){min-width:min(520px,100%)}
.mf-place-map{height:280px}
@media (max-width:820px){
  .mf-place{width:100%}
  .bubble:has(.mf-place){min-width:0}
  .mf-place-map{height:230px}
}


/* ===== b83 listen ===== */
/* ===== b83 ===== */
/* Listen sits immediately left of the model name, on the right of
   the actions row; the model name keeps its own spacing after it */
.message-actions .mf-listen{margin-left:auto;display:inline-flex;align-items:center;justify-content:center;padding:4px 7px}
.message-actions .mf-listen + .model-tag{margin-left:2px}
.message-actions .mf-listen.mf-speaking{color:var(--teal);border-color:var(--teal)}
.message-actions .mf-listen.mf-speaking svg{animation:mfListenPulse 1s ease-in-out infinite}
@keyframes mfListenPulse{0%,100%{opacity:1}50%{opacity:.45}}


/* ===== b84 web search ===== */
/* ===== b84 web search =====
   Built ONLY from the app's theme variables, so the window wears
   whichever design is active — Loop Glow, Pixel Meadow or Royal
   Saffron — in light and dark alike, with nothing theme-specific. */
.mf-ws{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:18px 12px;background:rgba(10,14,24,.45);backdrop-filter:blur(6px)}
.mf-ws[hidden]{display:none}
.mf-ws-box{width:min(680px,100%);max-height:calc(100vh - 36px);max-height:calc(100dvh - 36px);display:flex;flex-direction:column;background:var(--surface);color:var(--text);border:1.5px solid var(--border);border-radius:20px;box-shadow:0 24px 60px rgba(var(--sh),.28);overflow:hidden;animation:mfWsIn .18s ease}
@keyframes mfWsIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.mf-ws-head{display:flex;align-items:center;gap:9px;padding:13px 14px;border-bottom:1px solid var(--border);background:var(--solid)}
.mf-ws-ico{display:inline-flex;color:var(--primary)}
.mf-ws-title{font-weight:800;font-size:16px;flex:1}
.mf-ws-form{display:flex;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)}
.mf-ws-form input{flex:1;min-width:0;height:42px;padding:0 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--solid);color:var(--text);font-size:14.5px;outline:none}
.mf-ws-form input:focus{border-color:var(--primary)}
.mf-ws-go{height:42px;padding:0 18px;border:0;border-radius:12px;color:#fff;font-weight:750;font-size:14px;background:var(--g-warm);cursor:pointer}
.mf-ws-meta{padding:8px 16px 2px;font-size:11.5px;color:var(--muted)}
.mf-ws-results{overflow-y:auto;padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}
.mf-ws-card{display:flex;gap:11px;padding:11px 12px;border:1px solid var(--border);border-radius:14px;background:var(--solid);color:var(--text);text-decoration:none;transition:border-color .15s ease,transform .15s ease}
.mf-ws-card:hover{border-color:var(--primary);transform:translateY(-1px)}
.mf-ws-main{flex:1;min-width:0}
.mf-ws-dom{font-size:10.5px;font-weight:700;color:var(--primary);letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mf-ws-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:99px;background:var(--primary);color:#fff;font-size:9px;font-weight:800;vertical-align:1px}
.mf-ws-t{font-size:14.5px;font-weight:700;line-height:1.35;margin:2px 0 3px}
.mf-ws-d{font-size:12.5px;line-height:1.5;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mf-ws-img{flex:0 0 auto;width:74px;height:74px;object-fit:cover;border-radius:10px;border:1px solid var(--border)}
.mf-ws-state{padding:26px 16px;text-align:center;color:var(--muted);font-size:13.5px}
.mf-ws-more{margin:0 12px 14px;height:40px;border:1.5px solid var(--border);border-radius:12px;background:var(--solid);color:var(--text);font-weight:700;font-size:13.5px;cursor:pointer}
.mf-ws-more:hover{border-color:var(--primary);color:var(--primary)}
.mf-websearch-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px}
/* b97 - past searches, behind the history symbol (symbol only) */
.mf-ws-hist{max-height:240px;overflow-y:auto;padding:8px 12px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
.mf-ws-hist[hidden]{display:none}
.mf-ws-hist-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:11px;background:var(--solid);color:var(--text);cursor:pointer;text-align:left;font-size:13px}
.mf-ws-hist-item:hover{border-color:var(--primary)}
.mf-ws-hist-q{flex:1;min-width:0;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mf-ws-hist-t{font-size:10.5px;color:var(--muted);flex:none}
.mf-ws-hist-clear{align-self:flex-end;display:inline-flex;padding:6px;border:0;background:transparent;color:var(--muted);cursor:pointer}
.mf-ws-hist-clear:hover{color:#dc2626}


/* ===== b85 ===== */
/* ===== b85 ===== */
/* the three-line button: lines stair down to the left; while the
   drawer is open they glide into the opposite stair (a flip with
   a staggered settle), and glide back when it closes */
.mf-burger .mf-burger-in{display:flex;flex-direction:column;align-items:flex-start;gap:4.5px;transition:transform .5s cubic-bezier(.6,.05,.2,1.35)}
.mf-burger i{display:block;height:2px;border-radius:2px;background:currentColor;transition:width .45s cubic-bezier(.5,0,.2,1),transform .45s cubic-bezier(.5,0,.2,1),opacity .3s}
.mf-burger i:nth-child(1){width:17px}
.mf-burger i:nth-child(2){width:12.5px;transition-delay:.05s}
.mf-burger i:nth-child(3){width:8px;transition-delay:.1s}
.mf-burger.mf-burger-on .mf-burger-in{transform:scaleX(-1)}
.mf-burger.mf-burger-on i:nth-child(1){transform:translateY(-1px)}
.mf-burger.mf-burger-on i:nth-child(2){transform:translateY(0)}
.mf-burger.mf-burger-on i:nth-child(3){transform:translateY(1px)}
.mf-burger:active .mf-burger-in{scale:.86;transition-duration:.12s}

/* Open-in sheet (b87): exactly two choices, theme variables only */
.mf-open2{position:fixed;inset:0;z-index:120;display:flex;align-items:flex-end;justify-content:center;background:rgba(10,14,24,.45);backdrop-filter:blur(5px);animation:mfWsIn .16s ease}
.mf-open2-box{width:min(420px,100%);background:var(--surface);color:var(--text);border:1.5px solid var(--border);border-radius:20px 20px 0 0;box-shadow:0 -18px 50px rgba(var(--sh),.3);padding:16px 14px calc(14px + env(safe-area-inset-bottom))}
@media(min-width:700px){.mf-open2{align-items:center}.mf-open2-box{border-radius:20px}}
.mf-open2-h{font-size:16px;font-weight:800}
.mf-open2-t{font-size:12.5px;color:var(--muted);margin:2px 0 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mf-open2-btn{display:block;width:100%;height:52px;margin-bottom:9px;border:0;border-radius:14px;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
.mf-open2-firefox{background:#E66000}
.mf-open2-chromium{background:#1a73e8}
.mf-open2-note{font-size:11px;line-height:1.45;color:var(--muted);margin:8px 2px}
.mf-open2-x{width:100%;height:42px;border:1.5px solid var(--border);border-radius:12px;background:transparent;color:var(--text);font-weight:700;cursor:pointer}
.mf-open2-sub{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 4px}
.mf-open2-sub[hidden]{display:none}
.mf-open2-subbtn{height:44px;border:1.5px solid var(--border);border-radius:12px;background:var(--solid);color:var(--text);font-size:13.5px;font-weight:700;cursor:pointer}
.mf-open2-subbtn:active{transform:scale(.98)}
.mf-open2-subbtn.mf-notin{opacity:.45;text-decoration:line-through}
.mf-open2-all{grid-column:1/-1;background:#1a73e8;color:#fff;border-color:#1a73e8}


/* ===== b89 thinking ===== */
/* ===== b89 thinking, premium =====
   The live "Thinking..." card becomes glass: it rises in, the
   thought column is anchored to the BOTTOM so the newest line
   is always fully visible (no more letters sliced at the box
   edge), lines float up as they arrive, and both ends of the
   stream melt into a hazy blur. The saved "Thinking" fold in
   a finished answer gets the same treatment. */
.typing-row .think-card{border-radius:18px;background:var(--surface);
  -webkit-backdrop-filter:blur(12px) saturate(1.25);backdrop-filter:blur(12px) saturate(1.25);
  border:1px solid var(--border);box-shadow:0 18px 44px rgba(var(--sh),.20),inset 0 1px 0 rgba(255,255,255,.18);
  animation:mfThinkCardIn .5s cubic-bezier(.2,.8,.25,1) both}
@keyframes mfThinkCardIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
.typing-row .think-stream{border-radius:12px;
  -webkit-mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.22) 9px,#000 26px,#000 calc(100% - 26px),rgba(0,0,0,.22) calc(100% - 9px),transparent 100%);
  mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.22) 9px,#000 26px,#000 calc(100% - 26px),rgba(0,0,0,.22) calc(100% - 9px),transparent 100%)}
.typing-row .think-stream::before,.typing-row .think-stream::after{content:"";position:absolute;left:0;right:0;height:24px;z-index:3;pointer-events:none;opacity:.55;
  -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.typing-row .think-stream::before{top:0;background:linear-gradient(180deg,var(--surface),transparent);
  -webkit-mask-image:linear-gradient(180deg,#000,transparent);mask-image:linear-gradient(180deg,#000,transparent)}
.typing-row .think-stream::after{bottom:0;background:linear-gradient(0deg,var(--surface),transparent);
  -webkit-mask-image:linear-gradient(0deg,#000,transparent);mask-image:linear-gradient(0deg,#000,transparent)}
.typing-row .think-col{display:flex;flex-direction:column;justify-content:flex-end;min-height:100%}
.typing-row .think-line{line-height:1.78;padding-bottom:2px;animation:mfThinkLineIn .38s ease both}
@keyframes mfThinkLineIn{from{opacity:0;transform:translateY(9px)}to{opacity:.94;transform:none}}
.typing-row .think-cursor{margin-top:9px}

/* the saved thinking fold inside a finished answer */
.message details.thinking{border:1px solid var(--border);border-radius:13px;padding:4px 10px;
  background:rgba(var(--te),.06);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.message .thinking summary{padding:5px 0}
.message .thinking-body{line-height:1.72;font-size:11.5px;padding:9px 3px 11px;overflow-wrap:anywhere;
  max-height:300px;overflow-y:auto;
  -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 12px),transparent 100%);
  mask-image:linear-gradient(180deg,#000 calc(100% - 12px),transparent 100%)}
.message details.thinking[open ] .thinking-body{animation:mfThinkLineIn .35s ease both}
@media (prefers-reduced-motion:reduce){
  .typing-row .think-card,.typing-row .think-line,.message details.thinking[open ] .thinking-body{animation:none}
}


/* ===== b90 ===== */
/* generated-time: small plain text inside the Copy/Regenerate row,
   same size/colour family as those buttons - no box, no border */
.mf-time-inline{display:none;align-items:center;gap:3px;padding:4px 2px;font-size:10.5px;font-weight:600;line-height:1;color:var(--muted);background:none;border:none;white-space:nowrap}
.mf-time-inline.show{display:inline-flex}


/* ===== b93 · the thinking window is open/close now, not a fixed box =====
   Sending a question brings a small SQUARE window: a little Earth
   turning with sparkles orbiting it. Under the Earth sits the option
   the expand option - tap it and the window opens to the model's
   REAL live thoughts as they stream in; tap again to close it. The
   window is never a fixed size any more. */
/* b94 - closed, it is just the reference look now: a tiny dotted globe
   of particles slowly turning beside a shimmering "Thinking", with
   the expand option under it. No big square, no heavy card. */
.typing-row .think-card{height:auto !important;min-height:0}
.typing-row .think-card.mf-think-closed{width:auto;max-width:78vw;background:transparent !important;border-color:transparent !important;box-shadow:none !important;padding:2px 2px}
.typing-row .think-title{background:linear-gradient(90deg,var(--muted) 35%,var(--text) 50%,var(--muted) 65%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:mfThinkShimmer 1.7s linear infinite}
@keyframes mfThinkShimmer{from{background-position:180% 0}to{background-position:-40% 0}}
.mf-earth-stage{display:inline-flex;align-items:center;padding:0;flex:none}
.mf-earth-wrap{position:relative;width:18px;height:18px}
.mf-earth-svg{width:18px;height:18px;display:block}
.mf-earth-meridians{transform-box:fill-box;transform-origin:center;animation:mfEarthSpin 9s linear infinite}
@keyframes mfEarthSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.mf-orbit{position:absolute;inset:-3px;border-radius:50%;animation:mfOrbitSpin 5s linear infinite;pointer-events:none}
@keyframes mfOrbitSpin{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
.mf-orbit i{position:absolute;width:2.6px;height:2.6px;border-radius:50%;background:#FFC53D;box-shadow:0 0 5px 1px rgba(255,197,61,.8)}
.mf-orbit i:nth-child(1){top:0;left:50%}
.mf-orbit i:nth-child(2){bottom:3px;left:2px;background:#FF5FA2;box-shadow:0 0 5px 1px rgba(255,95,162,.75)}
.mf-orbit i:nth-child(3){top:55%;right:-1px;background:#12BFA6;box-shadow:0 0 5px 1px rgba(18,191,166,.75)}
.mf-spark{position:absolute;font-size:6px;color:#FFC53D;animation:mfSparkPulse 1.8s ease-in-out infinite;pointer-events:none}
@keyframes mfSparkPulse{0%,100%{opacity:.3}50%{opacity:1}}
.mf-think-toggle{border:none;background:transparent;color:var(--muted);font:600 11px/1 Inter,system-ui,sans-serif;padding:3px 2px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;text-decoration:underline;text-underline-offset:3px}
.mf-think-toggle:active{transform:scale(.97)}
.typing-row .think-card.mf-think-open .mf-earth-stage{padding-top:6px;align-items:center}
.typing-row .think-card.mf-think-open .mf-earth-wrap{width:22px;height:22px}
.typing-row .think-card.mf-think-open .mf-earth-svg{width:22px;height:22px}
.typing-row .think-card.mf-think-closed .mf-live-box{display:none !important}
.typing-row .think-card.mf-think-open .mf-live-box{display:block}
.mf-live-box{margin-top:6px}
.mf-live-text{display:none !important}
.mf-live-thought{max-height:190px;overflow-y:auto;font-size:13px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-break:break-word;padding:2px 2px 4px;scrollbar-width:thin}
.mf-tline{opacity:.42;transition:opacity .3s ease;white-space:pre-wrap;word-break:break-word}
.mf-tline.now{opacity:.96}
.mf-live-thought .think-cursor{display:inline-block;margin:2px 0 0 2px;vertical-align:middle}
.mf-live-thought.mf-live-wait{font-family:Inter,system-ui,sans-serif;font-size:12px;color:var(--muted);font-style:italic}
@media (prefers-reduced-motion:reduce){.mf-earth-meridians,.mf-orbit,.typing-row .think-title{animation:none}.mf-spark{animation:none;opacity:.7}}


/* ===== b95 - thinking window tidy-up ===== */
/* opening hides the globe; closing brings it back */
.typing-row .think-card.mf-think-open .mf-earth-stage{display:none !important}
/* nothing unnecessary inside the window: no model caption line */
.typing-row .think-card .typing-model{display:none !important}
/* and no stray cursor square from the old demo stream */
.typing-row .think-card .think-stream{display:none !important}
/* the box grows out of the thinking row itself */
.typing-row .think-card{transition:width .35s ease,max-width .35s ease,background-color .3s ease,box-shadow .3s ease;transform-origin:left top}
.typing-row .think-card.mf-think-open{animation:mfThinkGrow .32s ease both}
@keyframes mfThinkGrow{from{transform:scale(.965);opacity:.75}to{transform:scale(1);opacity:1}}
/* rainbow particles around the little globe */
.mf-orbit i:nth-child(1){background:#FF5A5A;box-shadow:0 0 5px 1px rgba(255,90,90,.8)}
.mf-orbit i:nth-child(2){background:#FF9F2E;box-shadow:0 0 5px 1px rgba(255,159,46,.8)}
.mf-orbit i:nth-child(3){background:#FFC53D;box-shadow:0 0 5px 1px rgba(255,197,61,.85)}
.mf-orbit i:nth-child(4){background:#3ED598;box-shadow:0 0 5px 1px rgba(62,213,152,.8)}
.mf-orbit i:nth-child(5){background:#9B5CFF;box-shadow:0 0 5px 1px rgba(155,92,255,.8)}


/* ===== b96 - Thinking row is the expand tap; nothing extra ===== */
.typing-row .think-sheet{display:none !important}
.typing-row .think-head{cursor:pointer}
.typing-row .think-card.mf-think-open .think-head .think-chev{transform:rotate(90deg)}


/* ===== b97 - thinking row: only the globe + Thinking ===== */
.typing-row .think-skip{display:none !important}
.typing-row .think-chev,.typing-row .think-lead{display:none !important}
.typing-row.mf-live-on .think-title:after{content:none !important}
.typing-row .think-head .mf-earth-stage{margin-right:2px}
.mf-earth-wrap{animation:none !important}
/* premium flip-round tap on the main buttons */
.mf-btn-anim{animation:mfBtnFlip .55s cubic-bezier(.3,.7,.4,1)}
@keyframes mfBtnFlip{0%{transform:rotate(0deg) scale(1)}35%{transform:rotate(160deg) scale(1.16)}70%{transform:rotate(300deg) scale(1.05)}100%{transform:rotate(360deg) scale(1)}}
/* long-press delete-this-message sheet */
.mf-msgdel{position:fixed;inset:0;z-index:2147482900;display:flex;align-items:center;justify-content:center;background:rgba(8,12,22,.45);backdrop-filter:blur(4px)}
.mf-msgdel-box{width:min(330px,88vw);background:var(--surface);color:var(--text);border:1.5px solid var(--border);border-radius:16px;padding:16px 14px 12px;box-shadow:0 20px 50px rgba(var(--sh),.3);text-align:center}
.mf-msgdel-t{font-size:15px;font-weight:800;margin-bottom:4px}
.mf-msgdel-s{font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:12px}
.mf-msgdel-del{width:100%;height:42px;border:0;border-radius:11px;background:#dc2626;color:#fff;font-weight:800;font-size:14px;cursor:pointer}
.mf-msgdel-x{width:100%;height:40px;margin-top:8px;border:1.5px solid var(--border);border-radius:11px;background:transparent;color:var(--text);font-weight:700;cursor:pointer}


/* ===== b98 - thinking row: calm, no bouncing; side flips ===== */
.typing-row .think-ico{display:none !important}
.typing-row .think-dots{display:none !important}
.typing-row .think-card{animation:none !important}
.mf-orbit{animation:none !important}
.mf-spark{animation:none !important;opacity:.85}
.mf-btn-anim{animation:mfBtnSide .55s cubic-bezier(.3,.7,.4,1)}
@keyframes mfBtnSide{0%{transform:perspective(320px) rotateY(0deg) scale(1)}45%{transform:perspective(320px) rotateY(72deg) scale(1.1)}100%{transform:perspective(320px) rotateY(0deg) scale(1)}}
#historyBtn.mf-btn-anim{animation:mfBtnSideLR .55s cubic-bezier(.3,.7,.4,1)}
@keyframes mfBtnSideLR{0%{transform:perspective(320px) rotateY(0deg) scale(1)}45%{transform:perspective(320px) rotateY(-72deg) scale(1.1)}100%{transform:perspective(320px) rotateY(0deg) scale(1)}}

</style>
</head>
<body>
<!-- LOCK SCREEN -->
<div id="lock" class="${unlocked ? "hidden" : ""}">
  <div class="lock-stage">
<div id="eleph" class="eleph mood-idle" aria-hidden="true">
<svg viewBox="0 0 230 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="esk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4d2e3"/><stop offset=".6" stop-color="#9db2c8"/><stop offset="1" stop-color="#849cb4"/></linearGradient>
    <linearGradient id="eear" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a9bccf"/><stop offset="1" stop-color="#7e96ae"/></linearGradient>
    <radialGradient id="einner" cx=".5" cy=".45" r=".7"><stop offset="0" stop-color="#f5cdd7"/><stop offset="1" stop-color="#dfa2b2"/></radialGradient>
    <linearGradient id="egold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8d783"/><stop offset="1" stop-color="#d9a441"/></linearGradient>
  </defs>
  <!-- ears (behind head) with fold + rim light -->
  <path d="M62 62 C 24 52 4 94 20 126 C 32 147 60 150 72 136 C 62 110 62 86 70 70 Z" fill="url(#eear)"/>
  <path d="M168 62 C 206 52 226 94 210 126 C 198 147 170 150 158 136 C 168 110 168 86 160 70 Z" fill="url(#eear)"/>
  <path d="M60 74 C 34 70 22 98 32 120 C 40 134 58 136 66 128 C 60 108 60 90 64 78 Z" fill="url(#einner)"/>
  <path d="M170 74 C 196 70 208 98 198 120 C 190 134 172 136 164 128 C 170 108 170 90 166 78 Z" fill="url(#einner)"/>
  <path d="M62 64 C 30 58 12 92 22 120" fill="none" stroke="#e6eef6" stroke-width="3" opacity=".6"/>
  <path d="M168 64 C 200 58 218 92 208 120" fill="none" stroke="#e6eef6" stroke-width="3" opacity=".6"/>
  <!-- royal ear covers -->
  <path d="M52 66 C 26 66 14 96 26 120" fill="none" stroke="url(#egold)" stroke-width="5" stroke-linecap="round"/>
  <path d="M178 66 C 204 66 216 96 204 120" fill="none" stroke="url(#egold)" stroke-width="5" stroke-linecap="round"/>
  <!-- body / shoulders with royal cloth + garland (cut at card top) -->
  <path d="M48 152 Q 48 114 84 108 L 146 108 Q 182 114 182 152 Z" fill="url(#esk)"/>
  <path d="M48 150 Q 48 140 60 136 L 170 136 Q 182 140 182 150 Z" fill="#8e2f3f"/>
  <path d="M48 138 L 182 138" stroke="url(#egold)" stroke-width="4"/>
  <circle cx="72" cy="145" r="3.2" fill="url(#egold)"/><circle cx="98" cy="145" r="3.2" fill="url(#egold)"/><circle cx="124" cy="145" r="3.2" fill="url(#egold)"/><circle cx="150" cy="145" r="3.2" fill="url(#egold)"/>
  <circle cx="60" cy="150" r="4" fill="#e8742c"/><circle cx="86" cy="151" r="4" fill="#f2a93b"/><circle cx="112" cy="151" r="4" fill="#e8742c"/><circle cx="138" cy="151" r="4" fill="#f2a93b"/><circle cx="164" cy="150" r="4" fill="#e8742c"/>
  <!-- head: soft pear with forehead dome + cheeks -->
  <path d="M115 34 C 152 34 174 62 174 98 C 174 134 149 154 115 154 C 81 154 56 134 56 98 C 56 62 78 34 115 34 Z" fill="url(#esk)"/>
  <ellipse cx="102" cy="58" rx="26" ry="12" fill="#e6eef6" opacity=".26"/>
  <ellipse cx="86" cy="116" rx="12" ry="9" fill="#7e96ae" opacity=".22"/>
  <ellipse cx="144" cy="116" rx="12" ry="9" fill="#7e96ae" opacity=".22"/>
  <!-- crown + forehead jewel chain -->
  <path d="M92 40 L98 20 L106 34 L115 13 L124 34 L132 20 L138 40 Z" fill="url(#egold)"/>
  <rect x="89" y="38" width="52" height="9" rx="4.5" fill="url(#egold)"/>
  <circle cx="115" cy="27" r="4" fill="#d6336c"/><circle cx="100" cy="34" r="2.4" fill="#2f9e44"/><circle cx="130" cy="34" r="2.4" fill="#2f6fb5"/>
  <path d="M115 47 L115 58" stroke="url(#egold)" stroke-width="2"/>
  <circle cx="115" cy="61" r="3.4" fill="#d6336c" stroke="url(#egold)" stroke-width="1.4"/>
  <!-- eyes: big, glossy, lashed -->
  <ellipse class="eye eye1" cx="93" cy="100" rx="12.5" ry="13.5" fill="#fff"/>
  <ellipse class="eye eye2" cx="137" cy="100" rx="12.5" ry="13.5" fill="#fff"/>
  <circle class="pupil" cx="93" cy="101" r="6" fill="#432f24"/>
  <circle class="pupil" cx="137" cy="101" r="6" fill="#432f24"/>
  <circle cx="95.5" cy="97.5" r="2.3" fill="#fff"/><circle cx="91" cy="104" r="1.1" fill="#fff" opacity=".8"/>
  <circle cx="139.5" cy="97.5" r="2.3" fill="#fff"/><circle cx="135" cy="104" r="1.1" fill="#fff" opacity=".8"/>
  <path d="M83 91 Q 93 86 103 91" fill="none" stroke="#5c7186" stroke-width="2" stroke-linecap="round"/>
  <path d="M127 91 Q 137 86 147 91" fill="none" stroke="#5c7186" stroke-width="2" stroke-linecap="round"/>
  <!-- sad lids / happy brows / blush+mouth -->
  <path class="lid-sad" d="M82 92 Q 93 88 104 94 L 104 102 Q 93 96 82 102 Z" fill="url(#esk)"/>
  <path class="lid-sad" d="M126 94 Q 137 88 148 92 L 148 102 Q 137 96 126 102 Z" fill="url(#esk)"/>
  <path class="brow-happy" d="M82 84 Q 93 78 104 84" fill="none" stroke="#5c7186" stroke-width="3" stroke-linecap="round"/>
  <path class="brow-happy" d="M126 84 Q 137 78 148 84" fill="none" stroke="#5c7186" stroke-width="3" stroke-linecap="round"/>
  <circle class="blush" cx="82" cy="116" r="6.5" fill="#f2b7c0"/>
  <circle class="blush" cx="148" cy="116" r="6.5" fill="#f2b7c0"/>
  <path class="mouth-happy" d="M102 132 Q 115 141 128 132" fill="none" stroke="#5c414a" stroke-width="3" stroke-linecap="round"/>
  <path class="mouth-sad" d="M102 137 Q 115 128 128 137" fill="none" stroke="#5c414a" stroke-width="3" stroke-linecap="round"/>
  <!-- shy / awkward marks (appear when the baby is tapped) -->
  <g class="shy-mark">
    <path d="M178 40 q 7 9 0 16 q -7 -7 0 -16 z" fill="#8fd0f0"/>
    <path d="M42 60 l -8 -9" stroke="#8fd0f0" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M35 45 l -7 -8" stroke="#8fd0f0" stroke-width="2.6" stroke-linecap="round"/>
  </g>
  <g class="shake-lines" fill="none" stroke="#86bfe8" stroke-width="2.6" stroke-linecap="round">
    <path d="M14 78 q8 -8 16 0 q8 8 16 0"/>
    <path d="M184 78 q8 -8 16 0 q8 8 16 0"/>
  </g>
  <!-- trunk: fat + smooth snake wave (redrawn every frame) with wrinkle rings and highlight -->
  <path id="trunkPath" fill="url(#esk)" stroke="#6f879e" stroke-width="1.4" d="M103 116 L 127 116 L 122 268 L 108 268 Z"/>
  <path id="trunkHi" fill="none" stroke="#e2ecf6" stroke-width="3.4" stroke-linecap="round" opacity=".45" d="M108 120 L 111 264"/>
  <g id="trunkRings" stroke="#6f879e" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".38">
    <path d=""/><path d=""/><path d=""/><path d=""/><path d=""/><path d=""/>
  </g>
</svg>
</div>
  <div id="lockCard" class="lock-card">
    <div class="lock-icon">🔒</div>
    <h2>Enter Access Code</h2>
    <p id="lock-msg">Please enter the 4-digit code to open the chat.</p>
    <div id="pins" class="pins">
      <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="Digit 1">
      <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="Digit 2">
      <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="Digit 3">
      <input type="password" maxlength="1" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="Digit 4">
    </div>
  </div>
  </div>
</div>
<!-- ACHIEVEMENT POPUP --><div id="achievement" role="status" aria-live="polite">
  <div class="ach-icon">🏆</div>
  <div>
    <div class="ach-title">Achievement Unlocked!</div>
    <div class="ach-sub">Access granted. Welcome in! 🎉</div>
  </div>
</div>
<!-- shared flower logo + gradient (decorative only) -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <linearGradient id="flowerGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--primary)"/>
      <stop offset=".55" style="stop-color:var(--orange)"/>
      <stop offset="1" style="stop-color:var(--saffron)"/>
    </linearGradient>
    <path id="petals" d="M50 4C63 22 63 38 50 50C37 38 37 22 50 4ZM50 96C37 78 37 62 50 50C63 62 63 78 50 96ZM4 50C22 37 38 37 50 50C38 63 22 63 4 50ZM96 50C78 63 62 63 50 50C62 37 78 37 96 50Z"/>
    <symbol id="flower" viewBox="0 0 100 100">
      <use href="#petals" fill="url(#flowerGrad)" opacity=".85" transform="rotate(45 50 50) translate(50 50) scale(.62) translate(-50 -50)"/>
      <use href="#petals" fill="url(#flowerGrad)"/>
    </symbol>
  </defs>
</svg>
<!-- soft wash + optional faint photo + heritage pillars -->
<div id="royal-bg" aria-hidden="true">
  <div class="royal-photo"></div>
  <div class="royal-frame"><i class="pillar l"></i><i class="pillar r"></i></div>
</div>
<div class="app">
<header class="topbar">
  <div class="topbar-in">
    <button id="historyBtn" class="icon-btn" type="button" title="Chat History" aria-label="Chat History">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 16h10"/></svg>
    </button>
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 100 100"><use href="#flower"/></svg>
      <div>
        <div class="brand-main">MindFusion</div>
        <div class="brand-sub">A hub for different AI models</div>
      </div>
    </div>
    <div class="top-actions">
      <button id="newTop" class="icon-btn new-chat-btn" type="button" title="New Chat" aria-label="New Chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="4.2" width="17.6" height="14" rx="3.4"/><path d="M8.2 8.6h7.6M8.2 12.2h4.6"/><path d="M8.6 18.2 6.4 20.8v-2.6"/></svg>
        <span class="new-chat-txt">New chat</span>
      </button>
      <button id="moreBtn" class="icon-btn" type="button" title="More" aria-label="More options" aria-haspopup="true" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.6" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="18.4" r="1.9"/></svg>
      </button>
      <button id="settingsBtn" class="icon-btn mf-hide" type="button" title="Settings &amp; Usage" aria-label="Settings and Usage" aria-hidden="true" tabindex="-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>
      </button>
      <button id="theme" class="icon-btn mf-hide" type="button" title="Dark Mode" aria-label="Dark Mode" aria-hidden="true" tabindex="-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
      </button>
      <div id="moreMenu" class="mf-menu" role="menu" aria-label="Chat options">
        <button type="button" class="mf-mi" data-mf="settings" role="menuitem"><span class="mf-mi-ic">⚙️</span>Settings</button>
        <button type="button" class="mf-mi" data-mf="pin" role="menuitem"><span class="mf-mi-ic">📌</span><span id="mfPinLbl">Pin chat</span></button>
        <button type="button" class="mf-mi" data-mf="share" role="menuitem"><span class="mf-mi-ic">🔗</span>Share chat</button>
        <button type="button" class="mf-mi" data-mf="find" role="menuitem"><span class="mf-mi-ic">🔍</span>Find in chat</button>
      </div>
    </div>
  </div>
</header>
<div id="findBar" class="find-bar" hidden role="search" aria-label="Find in this chat">
  <span class="mf-find-ic">🔍</span>
  <input id="mfFindInput" class="find-input" type="text" placeholder="Find a word or a sentence in this chat…" autocomplete="off">
  <span id="mfFindCount" class="find-count"></span>
  <button id="mfFindPrev" class="find-btn" type="button" title="Earlier match" aria-label="Earlier match">↑</button>
  <button id="mfFindNext" class="find-btn" type="button" title="Next match" aria-label="Next match">↓</button>
  <button id="mfFindClose" class="find-btn" type="button" title="Close" aria-label="Close find">✕</button>
</div>
<main class="main">
<section class="hero">
  <div id="gateHero" class="gate-hero">
    <svg viewBox="0 0 400 450" role="img" aria-label="Decorative heritage gate">
      <defs>
        <path id="arch" d="M14 450V260A28 28 0 0 1 23 215A27 27 0 0 1 49 178A29 29 0 0 1 88 150A32 32 0 0 1 132 118A30 30 0 0 1 169 84A38 38 0 0 1 200 30A38 38 0 0 1 231 84A30 30 0 0 1 268 118A32 32 0 0 1 312 150A29 29 0 0 1 351 178A27 27 0 0 1 377 215A28 28 0 0 1 386 260V450"/>
        <pattern id="flo" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle class="pf1" cx="6" cy="6" r="1.8"/>
          <circle class="pf2" cx="6" cy="6" r=".7"/>
          <path class="pf3" d="M6 1.2v1.8M6 9v1.8M1.2 6H3M9 6h1.8"/>
        </pattern>
      </defs>
      <use href="#arch" class="g-teal"/>
      <use href="#arch" class="g-cream" transform="translate(200 450) scale(.95) translate(-200 -450)"/>
      <use href="#arch" class="g-pat" transform="translate(200 450) scale(.95) translate(-200 -450)"/>
      <use href="#arch" class="g-blue" transform="translate(200 450) scale(.89) translate(-200 -450)"/>
      <use href="#arch" class="g-saf" transform="translate(200 450) scale(.84) translate(-200 -450)"/>
      <use href="#arch" class="g-red" transform="translate(200 450) scale(.79) translate(-200 -450)"/>
      <use href="#arch" class="g-in" transform="translate(200 450) scale(.75) translate(-200 -450)"/>
    </svg>
<div class="px-hero" aria-hidden="true">
  <svg class="px-bird px-bird1" viewBox="0 0 11 5" shape-rendering="crispEdges"><g><rect x="0" y="0" width="2" height="1" fill="#22201c"/><rect x="9" y="0" width="2" height="1" fill="#22201c"/><rect x="0" y="1" width="3" height="1" fill="#22201c"/><rect x="8" y="1" width="3" height="1" fill="#22201c"/><rect x="1" y="2" width="3" height="1" fill="#22201c"/><rect x="7" y="2" width="3" height="1" fill="#22201c"/><rect x="2" y="3" width="7" height="1" fill="#22201c"/><rect x="3" y="4" width="5" height="1" fill="#22201c"/></g></svg>
  <svg class="px-bird px-bird2" viewBox="0 0 11 5" shape-rendering="crispEdges"><g><rect x="0" y="0" width="2" height="1" fill="#22201c"/><rect x="9" y="0" width="2" height="1" fill="#22201c"/><rect x="0" y="1" width="3" height="1" fill="#22201c"/><rect x="8" y="1" width="3" height="1" fill="#22201c"/><rect x="1" y="2" width="3" height="1" fill="#22201c"/><rect x="7" y="2" width="3" height="1" fill="#22201c"/><rect x="2" y="3" width="7" height="1" fill="#22201c"/><rect x="3" y="4" width="5" height="1" fill="#22201c"/></g></svg>
  <svg class="px-sun" viewBox="0 0 18 18" shape-rendering="crispEdges"><g fill="#F3B93C"><rect x="5" y="0" width="8" height="1"/><rect x="3" y="1" width="12" height="2"/><rect x="1" y="3" width="16" height="12"/><rect x="3" y="15" width="12" height="2"/><rect x="5" y="17" width="8" height="1"/></g><g fill="#F9D66A"><rect x="4" y="3" width="10" height="12"/><rect x="3" y="4" width="12" height="10"/></g><g fill="#FFF2C6"><rect x="6" y="5" width="6" height="8"/><rect x="5" y="6" width="8" height="6"/></g></svg>
  <svg class="px-plane" viewBox="0 0 26 13" shape-rendering="crispEdges" aria-hidden="true"><g fill="#ffffff"><rect x="14" y="6" width="14" height="3"/><rect x="6" y="3" width="3" height="3"/><rect x="20" y="9" width="7" height="1"/><rect x="24" y="1" width="2" height="2"/></g><g fill="#6b5b3e"><rect x="19" y="7" width="1" height="1"/><rect x="22" y="7" width="1" height="1"/><rect x="25" y="7" width="1" height="1"/></g><g fill="#E9B949"><rect x="14" y="9" width="11" height="1"/><rect x="6" y="9" width="8" height="1"/><rect x="21" y="8" width="2" height="1"/></g><g fill="#7fb6c9"><rect x="9" y="3" width="1" height="1"/><rect x="10" y="4" width="1" height="1"/><rect x="11" y="5" width="2" height="1"/><rect x="17" y="6" width="1" height="1"/><rect x="18" y="7" width="1" height="1"/><rect x="12" y="10" width="1" height="1"/><rect x="9" y="11" width="3" height="1"/><rect x="4" y="12" width="2" height="1"/><rect x="0" y="12" width="2" height="1"/></g></svg>
  <svg class="px-palms" viewBox="0 0 54 38" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="36" y="1" width="2" height="1" fill="#57c25f"/><rect x="41" y="1" width="2" height="1" fill="#57c25f"/><rect x="36" y="2" width="1" height="1" fill="#57c25f"/><rect x="37" y="2" width="1" height="1" fill="#2f9e44"/><rect x="41" y="2" width="1" height="1" fill="#2f9e44"/><rect x="42" y="2" width="1" height="1" fill="#57c25f"/><rect x="33" y="3" width="3" height="1" fill="#57c25f"/><rect x="36" y="3" width="2" height="1" fill="#2f9e44"/><rect x="38" y="3" width="1" height="1" fill="#57c25f"/><rect x="40" y="3" width="1" height="1" fill="#57c25f"/><rect x="41" y="3" width="1" height="1" fill="#2f9e44"/><rect x="42" y="3" width="4" height="1" fill="#57c25f"/><rect x="11" y="4" width="2" height="1" fill="#57c25f"/><rect x="16" y="4" width="2" height="1" fill="#57c25f"/><rect x="33" y="4" width="1" height="1" fill="#57c25f"/><rect x="34" y="4" width="5" height="1" fill="#2f9e44"/><rect x="40" y="4" width="2" height="1" fill="#57c25f"/><rect x="42" y="4" width="3" height="1" fill="#2f9e44"/><rect x="45" y="4" width="1" height="1" fill="#57c25f"/><rect x="11" y="5" width="1" height="1" fill="#57c25f"/><rect x="12" y="5" width="1" height="1" fill="#2f9e44"/><rect x="16" y="5" width="1" height="1" fill="#2f9e44"/><rect x="17" y="5" width="1" height="1" fill="#57c25f"/><rect x="32" y="5" width="2" height="1" fill="#57c25f"/><rect x="34" y="5" width="5" height="1" fill="#2f9e44"/><rect x="39" y="5" width="8" height="1" fill="#57c25f"/><rect x="8" y="6" width="3" height="1" fill="#57c25f"/><rect x="11" y="6" width="2" height="1" fill="#2f9e44"/><rect x="13" y="6" width="1" height="1" fill="#57c25f"/><rect x="15" y="6" width="1" height="1" fill="#57c25f"/><rect x="16" y="6" width="1" height="1" fill="#2f9e44"/><rect x="17" y="6" width="4" height="1" fill="#57c25f"/><rect x="32" y="6" width="1" height="1" fill="#57c25f"/><rect x="33" y="6" width="6" height="1" fill="#2f9e44"/><rect x="39" y="6" width="1" height="1" fill="#57c25f"/><rect x="40" y="6" width="4" height="1" fill="#2f9e44"/><rect x="44" y="6" width="3" height="1" fill="#57c25f"/><rect x="8" y="7" width="1" height="1" fill="#57c25f"/><rect x="9" y="7" width="5" height="1" fill="#2f9e44"/><rect x="15" y="7" width="2" height="1" fill="#57c25f"/><rect x="17" y="7" width="3" height="1" fill="#2f9e44"/><rect x="20" y="7" width="1" height="1" fill="#57c25f"/><rect x="31" y="7" width="1" height="1" fill="#57c25f"/><rect x="32" y="7" width="13" height="1" fill="#2f9e44"/><rect x="45" y="7" width="3" height="1" fill="#57c25f"/><rect x="7" y="8" width="2" height="1" fill="#57c25f"/><rect x="9" y="8" width="5" height="1" fill="#2f9e44"/><rect x="14" y="8" width="8" height="1" fill="#57c25f"/><rect x="30" y="8" width="2" height="1" fill="#57c25f"/><rect x="32" y="8" width="14" height="1" fill="#2f9e44"/><rect x="46" y="8" width="3" height="1" fill="#57c25f"/><rect x="6" y="9" width="2" height="1" fill="#57c25f"/><rect x="8" y="9" width="6" height="1" fill="#2f9e44"/><rect x="14" y="9" width="1" height="1" fill="#57c25f"/><rect x="15" y="9" width="4" height="1" fill="#2f9e44"/><rect x="19" y="9" width="4" height="1" fill="#57c25f"/><rect x="30" y="9" width="1" height="1" fill="#57c25f"/><rect x="31" y="9" width="17" height="1" fill="#2f9e44"/><rect x="48" y="9" width="1" height="1" fill="#57c25f"/><rect x="6" y="10" width="1" height="1" fill="#57c25f"/><rect x="7" y="10" width="13" height="1" fill="#2f9e44"/><rect x="20" y="10" width="3" height="1" fill="#57c25f"/><rect x="30" y="10" width="5" height="1" fill="#2f9e44"/><rect x="37" y="10" width="5" height="1" fill="#2f9e44"/><rect x="44" y="10" width="3" height="1" fill="#2f9e44"/><rect x="47" y="10" width="1" height="1" fill="#57c25f"/><rect x="48" y="10" width="1" height="1" fill="#2f9e44"/><rect x="5" y="11" width="2" height="1" fill="#57c25f"/><rect x="7" y="11" width="14" height="1" fill="#2f9e44"/><rect x="21" y="11" width="3" height="1" fill="#57c25f"/><rect x="30" y="11" width="4" height="1" fill="#2f9e44"/><rect x="37" y="11" width="5" height="1" fill="#2f9e44"/><rect x="45" y="11" width="3" height="1" fill="#2f9e44"/><rect x="48" y="11" width="1" height="1" fill="#57c25f"/><rect x="5" y="12" width="1" height="1" fill="#57c25f"/><rect x="6" y="12" width="17" height="1" fill="#2f9e44"/><rect x="23" y="12" width="1" height="1" fill="#57c25f"/><rect x="30" y="12" width="1" height="1" fill="#57c25f"/><rect x="31" y="12" width="2" height="1" fill="#2f9e44"/><rect x="39" y="12" width="1" height="1" fill="#2f9e44"/><rect x="40" y="12" width="1" height="1" fill="#8a5a2b"/><rect x="41" y="12" width="1" height="1" fill="#6f441f"/><rect x="46" y="12" width="2" height="1" fill="#2f9e44"/><rect x="48" y="12" width="1" height="1" fill="#57c25f"/><rect x="5" y="13" width="5" height="1" fill="#2f9e44"/><rect x="12" y="13" width="5" height="1" fill="#2f9e44"/><rect x="19" y="13" width="3" height="1" fill="#2f9e44"/><rect x="22" y="13" width="1" height="1" fill="#57c25f"/><rect x="23" y="13" width="1" height="1" fill="#2f9e44"/><rect x="29" y="13" width="1" height="1" fill="#57c25f"/><rect x="30" y="13" width="1" height="1" fill="#2f9e44"/><rect x="39" y="13" width="1" height="1" fill="#e8742c"/><rect x="40" y="13" width="1" height="1" fill="#8a5a2b"/><rect x="41" y="13" width="1" height="1" fill="#6f441f"/><rect x="48" y="13" width="1" height="1" fill="#2f9e44"/><rect x="49" y="13" width="1" height="1" fill="#57c25f"/><rect x="5" y="14" width="4" height="1" fill="#2f9e44"/><rect x="12" y="14" width="5" height="1" fill="#2f9e44"/><rect x="20" y="14" width="3" height="1" fill="#2f9e44"/><rect x="23" y="14" width="1" height="1" fill="#57c25f"/><rect x="29" y="14" width="1" height="1" fill="#57c25f"/><rect x="30" y="14" width="1" height="1" fill="#2f9e44"/><rect x="37" y="14" width="1" height="1" fill="#e8742c"/><rect x="40" y="14" width="1" height="1" fill="#8a5a2b"/><rect x="41" y="14" width="1" height="1" fill="#e8742c"/><rect x="42" y="14" width="1" height="1" fill="#6f441f"/><rect x="48" y="14" width="1" height="1" fill="#2f9e44"/><rect x="49" y="14" width="1" height="1" fill="#57c25f"/><rect x="5" y="15" width="1" height="1" fill="#57c25f"/><rect x="6" y="15" width="2" height="1" fill="#2f9e44"/><rect x="12" y="15" width="2" height="1" fill="#8a5a2b"/><rect x="14" y="15" width="1" height="1" fill="#2f9e44"/><rect x="21" y="15" width="2" height="1" fill="#2f9e44"/><rect x="23" y="15" width="1" height="1" fill="#57c25f"/><rect x="29" y="15" width="1" height="1" fill="#57c25f"/><rect x="40" y="15" width="1" height="1" fill="#e8742c"/><rect x="41" y="15" width="1" height="1" fill="#8a5a2b"/><rect x="42" y="15" width="1" height="1" fill="#6f441f"/><rect x="49" y="15" width="1" height="1" fill="#57c25f"/><rect x="4" y="16" width="1" height="1" fill="#57c25f"/><rect x="5" y="16" width="1" height="1" fill="#2f9e44"/><rect x="11" y="16" width="2" height="1" fill="#8a5a2b"/><rect x="13" y="16" width="1" height="1" fill="#6f441f"/><rect x="14" y="16" width="1" height="1" fill="#e8742c"/><rect x="23" y="16" width="1" height="1" fill="#2f9e44"/><rect x="24" y="16" width="1" height="1" fill="#57c25f"/><rect x="28" y="16" width="1" height="1" fill="#57c25f"/><rect x="29" y="16" width="1" height="1" fill="#2f9e44"/><rect x="38" y="16" width="1" height="1" fill="#e8742c"/><rect x="40" y="16" width="2" height="1" fill="#8a5a2b"/><rect x="42" y="16" width="1" height="1" fill="#6f441f"/><rect x="49" y="16" width="1" height="1" fill="#2f9e44"/><rect x="50" y="16" width="1" height="1" fill="#57c25f"/><rect x="4" y="17" width="1" height="1" fill="#57c25f"/><rect x="5" y="17" width="1" height="1" fill="#2f9e44"/><rect x="11" y="17" width="1" height="1" fill="#8a5a2b"/><rect x="12" y="17" width="1" height="1" fill="#e8742c"/><rect x="13" y="17" width="1" height="1" fill="#6f441f"/><rect x="16" y="17" width="1" height="1" fill="#e8742c"/><rect x="23" y="17" width="1" height="1" fill="#2f9e44"/><rect x="24" y="17" width="1" height="1" fill="#57c25f"/><rect x="28" y="17" width="1" height="1" fill="#57c25f"/><rect x="29" y="17" width="1" height="1" fill="#2f9e44"/><rect x="36" y="17" width="1" height="1" fill="#e8742c"/><rect x="40" y="17" width="2" height="1" fill="#8a5a2b"/><rect x="42" y="17" width="1" height="1" fill="#e8742c"/><rect x="43" y="17" width="2" height="1" fill="#6f441f"/><rect x="49" y="17" width="1" height="1" fill="#2f9e44"/><rect x="50" y="17" width="1" height="1" fill="#57c25f"/><rect x="4" y="18" width="1" height="1" fill="#57c25f"/><rect x="11" y="18" width="2" height="1" fill="#8a5a2b"/><rect x="13" y="18" width="1" height="1" fill="#6f441f"/><rect x="15" y="18" width="1" height="1" fill="#e8742c"/><rect x="24" y="18" width="1" height="1" fill="#57c25f"/><rect x="27" y="18" width="1" height="1" fill="#57c25f"/><rect x="28" y="18" width="1" height="1" fill="#2f9e44"/><rect x="40" y="18" width="3" height="1" fill="#8a5a2b"/><rect x="43" y="18" width="2" height="1" fill="#6f441f"/><rect x="50" y="18" width="1" height="1" fill="#2f9e44"/><rect x="51" y="18" width="1" height="1" fill="#57c25f"/><rect x="3" y="19" width="1" height="1" fill="#57c25f"/><rect x="4" y="19" width="1" height="1" fill="#2f9e44"/><rect x="9" y="19" width="3" height="1" fill="#8a5a2b"/><rect x="12" y="19" width="1" height="1" fill="#6f441f"/><rect x="13" y="19" width="1" height="1" fill="#e8742c"/><rect x="24" y="19" width="1" height="1" fill="#2f9e44"/><rect x="25" y="19" width="1" height="1" fill="#57c25f"/><rect x="27" y="19" width="1" height="1" fill="#57c25f"/><rect x="28" y="19" width="1" height="1" fill="#2f9e44"/><rect x="40" y="19" width="3" height="1" fill="#8a5a2b"/><rect x="43" y="19" width="2" height="1" fill="#6f441f"/><rect x="50" y="19" width="1" height="1" fill="#2f9e44"/><rect x="51" y="19" width="1" height="1" fill="#57c25f"/><rect x="3" y="20" width="1" height="1" fill="#57c25f"/><rect x="4" y="20" width="1" height="1" fill="#2f9e44"/><rect x="9" y="20" width="2" height="1" fill="#8a5a2b"/><rect x="11" y="20" width="1" height="1" fill="#e8742c"/><rect x="12" y="20" width="2" height="1" fill="#6f441f"/><rect x="17" y="20" width="1" height="1" fill="#e8742c"/><rect x="24" y="20" width="1" height="1" fill="#2f9e44"/><rect x="25" y="20" width="1" height="1" fill="#57c25f"/><rect x="27" y="20" width="1" height="1" fill="#2f9e44"/><rect x="40" y="20" width="3" height="1" fill="#8a5a2b"/><rect x="43" y="20" width="2" height="1" fill="#6f441f"/><rect x="51" y="20" width="1" height="1" fill="#2f9e44"/><rect x="2" y="21" width="1" height="1" fill="#57c25f"/><rect x="3" y="21" width="1" height="1" fill="#2f9e44"/><rect x="9" y="21" width="3" height="1" fill="#8a5a2b"/><rect x="12" y="21" width="2" height="1" fill="#6f441f"/><rect x="25" y="21" width="1" height="1" fill="#2f9e44"/><rect x="26" y="21" width="1" height="1" fill="#57c25f"/><rect x="27" y="21" width="1" height="1" fill="#2f9e44"/><rect x="41" y="21" width="3" height="1" fill="#8a5a2b"/><rect x="44" y="21" width="2" height="1" fill="#6f441f"/><rect x="51" y="21" width="1" height="1" fill="#2f9e44"/><rect x="2" y="22" width="1" height="1" fill="#57c25f"/><rect x="3" y="22" width="1" height="1" fill="#2f9e44"/><rect x="9" y="22" width="3" height="1" fill="#8a5a2b"/><rect x="12" y="22" width="2" height="1" fill="#6f441f"/><rect x="25" y="22" width="1" height="1" fill="#2f9e44"/><rect x="26" y="22" width="1" height="1" fill="#57c25f"/><rect x="41" y="22" width="3" height="1" fill="#8a5a2b"/><rect x="44" y="22" width="2" height="1" fill="#6f441f"/><rect x="2" y="23" width="1" height="1" fill="#2f9e44"/><rect x="8" y="23" width="3" height="1" fill="#8a5a2b"/><rect x="11" y="23" width="2" height="1" fill="#6f441f"/><rect x="26" y="23" width="1" height="1" fill="#2f9e44"/><rect x="41" y="23" width="3" height="1" fill="#8a5a2b"/><rect x="44" y="23" width="2" height="1" fill="#6f441f"/><rect x="2" y="24" width="1" height="1" fill="#2f9e44"/><rect x="8" y="24" width="3" height="1" fill="#8a5a2b"/><rect x="11" y="24" width="2" height="1" fill="#6f441f"/><rect x="26" y="24" width="1" height="1" fill="#2f9e44"/><rect x="41" y="24" width="3" height="1" fill="#8a5a2b"/><rect x="44" y="24" width="2" height="1" fill="#6f441f"/><rect x="8" y="25" width="3" height="1" fill="#8a5a2b"/><rect x="11" y="25" width="2" height="1" fill="#6f441f"/><rect x="42" y="25" width="3" height="1" fill="#8a5a2b"/><rect x="45" y="25" width="2" height="1" fill="#6f441f"/><rect x="7" y="26" width="3" height="1" fill="#8a5a2b"/><rect x="10" y="26" width="2" height="1" fill="#6f441f"/><rect x="42" y="26" width="3" height="1" fill="#8a5a2b"/><rect x="45" y="26" width="2" height="1" fill="#6f441f"/><rect x="7" y="27" width="3" height="1" fill="#8a5a2b"/><rect x="10" y="27" width="2" height="1" fill="#6f441f"/><rect x="42" y="27" width="3" height="1" fill="#8a5a2b"/><rect x="45" y="27" width="2" height="1" fill="#6f441f"/><rect x="7" y="28" width="3" height="1" fill="#8a5a2b"/><rect x="10" y="28" width="2" height="1" fill="#6f441f"/><rect x="42" y="28" width="3" height="1" fill="#8a5a2b"/><rect x="45" y="28" width="2" height="1" fill="#6f441f"/><rect x="7" y="29" width="3" height="1" fill="#8a5a2b"/><rect x="10" y="29" width="2" height="1" fill="#6f441f"/><rect x="42" y="29" width="3" height="1" fill="#8a5a2b"/><rect x="45" y="29" width="2" height="1" fill="#6f441f"/><rect x="7" y="30" width="3" height="1" fill="#8a5a2b"/><rect x="10" y="30" width="2" height="1" fill="#6f441f"/><rect x="42" y="30" width="3" height="1" fill="#8a5a2b"/><rect x="45" y="30" width="2" height="1" fill="#6f441f"/><rect x="7" y="31" width="3" height="1" fill="#8a5a2b"/><rect x="10" y="31" width="2" height="1" fill="#6f441f"/><rect x="43" y="31" width="3" height="1" fill="#8a5a2b"/><rect x="46" y="31" width="2" height="1" fill="#6f441f"/><rect x="6" y="32" width="3" height="1" fill="#8a5a2b"/><rect x="9" y="32" width="2" height="1" fill="#6f441f"/><rect x="43" y="32" width="3" height="1" fill="#8a5a2b"/><rect x="46" y="32" width="2" height="1" fill="#6f441f"/><rect x="6" y="33" width="3" height="1" fill="#8a5a2b"/><rect x="9" y="33" width="2" height="1" fill="#6f441f"/><rect x="43" y="33" width="3" height="1" fill="#8a5a2b"/><rect x="46" y="33" width="2" height="1" fill="#6f441f"/><rect x="6" y="34" width="3" height="1" fill="#8a5a2b"/><rect x="9" y="34" width="2" height="1" fill="#6f441f"/><rect x="43" y="34" width="3" height="1" fill="#8a5a2b"/><rect x="46" y="34" width="2" height="1" fill="#6f441f"/><rect x="6" y="35" width="3" height="1" fill="#8a5a2b"/><rect x="9" y="35" width="2" height="1" fill="#6f441f"/><rect x="43" y="35" width="3" height="1" fill="#8a5a2b"/><rect x="46" y="35" width="2" height="1" fill="#6f441f"/><rect x="5" y="36" width="7" height="1" fill="#6f441f"/><rect x="42" y="36" width="7" height="1" fill="#6f441f"/><rect x="4" y="37" width="9" height="1" fill="#6f441f"/><rect x="41" y="37" width="9" height="1" fill="#6f441f"/></g></svg>
  <svg class="px-banyan" viewBox="0 0 40 26" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="16" y="0" width="8" height="1" fill="#22201c"/><rect x="12" y="1" width="2" height="1" fill="#22201c"/><rect x="14" y="1" width="12" height="1" fill="#2f9e44"/><rect x="26" y="1" width="2" height="1" fill="#22201c"/><rect x="10" y="2" width="2" height="1" fill="#22201c"/><rect x="12" y="2" width="16" height="1" fill="#2f9e44"/><rect x="28" y="2" width="2" height="1" fill="#22201c"/><rect x="9" y="3" width="1" height="1" fill="#22201c"/><rect x="10" y="3" width="20" height="1" fill="#2f9e44"/><rect x="30" y="3" width="1" height="1" fill="#22201c"/><rect x="6" y="4" width="1" height="1" fill="#22201c"/><rect x="7" y="4" width="3" height="1" fill="#2f9e44"/><rect x="10" y="4" width="1" height="1" fill="#57c25f"/><rect x="11" y="4" width="16" height="1" fill="#2f9e44"/><rect x="27" y="4" width="1" height="1" fill="#57c25f"/><rect x="28" y="4" width="4" height="1" fill="#2f9e44"/><rect x="32" y="4" width="1" height="1" fill="#22201c"/><rect x="5" y="5" width="1" height="1" fill="#22201c"/><rect x="6" y="5" width="9" height="1" fill="#2f9e44"/><rect x="15" y="5" width="1" height="1" fill="#57c25f"/><rect x="16" y="5" width="17" height="1" fill="#2f9e44"/><rect x="33" y="5" width="1" height="1" fill="#22201c"/><rect x="5" y="6" width="1" height="1" fill="#22201c"/><rect x="6" y="6" width="1" height="1" fill="#2f9e44"/><rect x="7" y="6" width="1" height="1" fill="#57c25f"/><rect x="8" y="6" width="13" height="1" fill="#2f9e44"/><rect x="21" y="6" width="1" height="1" fill="#57c25f"/><rect x="22" y="6" width="7" height="1" fill="#2f9e44"/><rect x="29" y="6" width="1" height="1" fill="#57c25f"/><rect x="30" y="6" width="3" height="1" fill="#2f9e44"/><rect x="33" y="6" width="1" height="1" fill="#22201c"/><rect x="4" y="7" width="1" height="1" fill="#22201c"/><rect x="5" y="7" width="6" height="1" fill="#2f9e44"/><rect x="11" y="7" width="1" height="1" fill="#57c25f"/><rect x="12" y="7" width="22" height="1" fill="#2f9e44"/><rect x="34" y="7" width="1" height="1" fill="#22201c"/><rect x="4" y="8" width="1" height="1" fill="#22201c"/><rect x="5" y="8" width="12" height="1" fill="#2f9e44"/><rect x="17" y="8" width="1" height="1" fill="#57c25f"/><rect x="18" y="8" width="6" height="1" fill="#2f9e44"/><rect x="24" y="8" width="1" height="1" fill="#57c25f"/><rect x="25" y="8" width="9" height="1" fill="#2f9e44"/><rect x="34" y="8" width="1" height="1" fill="#22201c"/><rect x="3" y="9" width="1" height="1" fill="#22201c"/><rect x="4" y="9" width="3" height="1" fill="#2f9e44"/><rect x="7" y="9" width="1" height="1" fill="#57c25f"/><rect x="8" y="9" width="22" height="1" fill="#2f9e44"/><rect x="30" y="9" width="1" height="1" fill="#57c25f"/><rect x="31" y="9" width="4" height="1" fill="#2f9e44"/><rect x="35" y="9" width="1" height="1" fill="#22201c"/><rect x="3" y="10" width="1" height="1" fill="#22201c"/><rect x="4" y="10" width="9" height="1" fill="#2f9e44"/><rect x="13" y="10" width="1" height="1" fill="#57c25f"/><rect x="14" y="10" width="12" height="1" fill="#2f9e44"/><rect x="26" y="10" width="1" height="1" fill="#57c25f"/><rect x="27" y="10" width="8" height="1" fill="#2f9e44"/><rect x="35" y="10" width="1" height="1" fill="#22201c"/><rect x="3" y="11" width="1" height="1" fill="#22201c"/><rect x="4" y="11" width="31" height="1" fill="#2f9e44"/><rect x="35" y="11" width="1" height="1" fill="#22201c"/><rect x="4" y="12" width="1" height="1" fill="#22201c"/><rect x="5" y="12" width="28" height="1" fill="#2f9e44"/><rect x="33" y="12" width="1" height="1" fill="#22201c"/><rect x="5" y="13" width="2" height="1" fill="#22201c"/><rect x="7" y="13" width="24" height="1" fill="#2f9e44"/><rect x="31" y="13" width="2" height="1" fill="#22201c"/><rect x="6" y="14" width="26" height="1" fill="#22201c"/><rect x="4" y="15" width="1" height="1" fill="#6f441f"/><rect x="12" y="15" width="1" height="1" fill="#22201c"/><rect x="13" y="15" width="8" height="1" fill="#8a5a2b"/><rect x="21" y="15" width="1" height="1" fill="#22201c"/><rect x="29" y="15" width="1" height="1" fill="#6f441f"/><rect x="4" y="16" width="1" height="1" fill="#6f441f"/><rect x="12" y="16" width="1" height="1" fill="#22201c"/><rect x="13" y="16" width="8" height="1" fill="#8a5a2b"/><rect x="21" y="16" width="1" height="1" fill="#22201c"/><rect x="29" y="16" width="1" height="1" fill="#6f441f"/><rect x="33" y="16" width="1" height="1" fill="#6f441f"/><rect x="4" y="17" width="1" height="1" fill="#6f441f"/><rect x="9" y="17" width="1" height="1" fill="#22201c"/><rect x="10" y="17" width="2" height="1" fill="#8a5a2b"/><rect x="12" y="17" width="1" height="1" fill="#22201c"/><rect x="13" y="17" width="8" height="1" fill="#8a5a2b"/><rect x="21" y="17" width="1" height="1" fill="#22201c"/><rect x="22" y="17" width="2" height="1" fill="#8a5a2b"/><rect x="24" y="17" width="1" height="1" fill="#22201c"/><rect x="29" y="17" width="1" height="1" fill="#6f441f"/><rect x="33" y="17" width="1" height="1" fill="#6f441f"/><rect x="4" y="18" width="1" height="1" fill="#6f441f"/><rect x="9" y="18" width="1" height="1" fill="#22201c"/><rect x="10" y="18" width="1" height="1" fill="#8a5a2b"/><rect x="11" y="18" width="1" height="1" fill="#22201c"/><rect x="13" y="18" width="1" height="1" fill="#22201c"/><rect x="14" y="18" width="6" height="1" fill="#8a5a2b"/><rect x="20" y="18" width="1" height="1" fill="#22201c"/><rect x="22" y="18" width="1" height="1" fill="#22201c"/><rect x="23" y="18" width="1" height="1" fill="#8a5a2b"/><rect x="24" y="18" width="1" height="1" fill="#22201c"/><rect x="29" y="18" width="1" height="1" fill="#6f441f"/><rect x="33" y="18" width="1" height="1" fill="#6f441f"/><rect x="4" y="19" width="1" height="1" fill="#6f441f"/><rect x="9" y="19" width="2" height="1" fill="#22201c"/><rect x="14" y="19" width="1" height="1" fill="#22201c"/><rect x="15" y="19" width="4" height="1" fill="#8a5a2b"/><rect x="19" y="19" width="1" height="1" fill="#22201c"/><rect x="23" y="19" width="2" height="1" fill="#22201c"/><rect x="29" y="19" width="1" height="1" fill="#6f441f"/><rect x="33" y="19" width="1" height="1" fill="#6f441f"/><rect x="4" y="20" width="1" height="1" fill="#6f441f"/><rect x="13" y="20" width="1" height="1" fill="#22201c"/><rect x="14" y="20" width="4" height="1" fill="#8a5a2b"/><rect x="18" y="20" width="1" height="1" fill="#22201c"/><rect x="27" y="20" width="1" height="1" fill="#6f441f"/><rect x="33" y="20" width="1" height="1" fill="#6f441f"/><rect x="4" y="21" width="1" height="1" fill="#6f441f"/><rect x="13" y="21" width="1" height="1" fill="#22201c"/><rect x="14" y="21" width="4" height="1" fill="#8a5a2b"/><rect x="18" y="21" width="1" height="1" fill="#22201c"/><rect x="27" y="21" width="1" height="1" fill="#6f441f"/><rect x="33" y="21" width="1" height="1" fill="#6f441f"/><rect x="4" y="22" width="1" height="1" fill="#6f441f"/><rect x="12" y="22" width="1" height="1" fill="#22201c"/><rect x="13" y="22" width="6" height="1" fill="#8a5a2b"/><rect x="19" y="22" width="1" height="1" fill="#22201c"/><rect x="27" y="22" width="1" height="1" fill="#6f441f"/><rect x="33" y="22" width="1" height="1" fill="#6f441f"/><rect x="4" y="23" width="1" height="1" fill="#6f441f"/><rect x="12" y="23" width="1" height="1" fill="#22201c"/><rect x="13" y="23" width="6" height="1" fill="#8a5a2b"/><rect x="19" y="23" width="1" height="1" fill="#22201c"/><rect x="27" y="23" width="1" height="1" fill="#6f441f"/><rect x="33" y="23" width="1" height="1" fill="#6f441f"/><rect x="4" y="24" width="1" height="1" fill="#6f441f"/><rect x="11" y="24" width="2" height="1" fill="#22201c"/><rect x="13" y="24" width="6" height="1" fill="#8a5a2b"/><rect x="19" y="24" width="2" height="1" fill="#22201c"/><rect x="27" y="24" width="1" height="1" fill="#6f441f"/><rect x="33" y="24" width="1" height="1" fill="#6f441f"/><rect x="4" y="25" width="1" height="1" fill="#6f441f"/><rect x="11" y="25" width="10" height="1" fill="#22201c"/><rect x="27" y="25" width="1" height="1" fill="#6f441f"/><rect x="33" y="25" width="1" height="1" fill="#6f441f"/></g></svg>
  <svg class="px-bush1" viewBox="0 0 13 6" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="3" y="0" width="2" height="1" fill="#22201c"/><rect x="7" y="0" width="2" height="1" fill="#22201c"/><rect x="2" y="1" width="1" height="1" fill="#22201c"/><rect x="3" y="1" width="2" height="1" fill="#2f9e44"/><rect x="5" y="1" width="2" height="1" fill="#22201c"/><rect x="7" y="1" width="2" height="1" fill="#2f9e44"/><rect x="9" y="1" width="1" height="1" fill="#22201c"/><rect x="1" y="2" width="1" height="1" fill="#22201c"/><rect x="2" y="2" width="8" height="1" fill="#2f9e44"/><rect x="10" y="2" width="1" height="1" fill="#22201c"/><rect x="0" y="3" width="1" height="1" fill="#22201c"/><rect x="1" y="3" width="3" height="1" fill="#2f9e44"/><rect x="4" y="3" width="1" height="1" fill="#57c25f"/><rect x="5" y="3" width="4" height="1" fill="#2f9e44"/><rect x="9" y="3" width="1" height="1" fill="#57c25f"/><rect x="10" y="3" width="1" height="1" fill="#2f9e44"/><rect x="11" y="3" width="1" height="1" fill="#22201c"/><rect x="0" y="4" width="1" height="1" fill="#22201c"/><rect x="1" y="4" width="10" height="1" fill="#2f9e44"/><rect x="11" y="4" width="1" height="1" fill="#22201c"/><rect x="1" y="5" width="10" height="1" fill="#22201c"/></g></svg>
  <svg class="px-bush2" viewBox="0 0 13 6" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="3" y="0" width="2" height="1" fill="#22201c"/><rect x="7" y="0" width="2" height="1" fill="#22201c"/><rect x="2" y="1" width="1" height="1" fill="#22201c"/><rect x="3" y="1" width="2" height="1" fill="#2f9e44"/><rect x="5" y="1" width="2" height="1" fill="#22201c"/><rect x="7" y="1" width="2" height="1" fill="#2f9e44"/><rect x="9" y="1" width="1" height="1" fill="#22201c"/><rect x="1" y="2" width="1" height="1" fill="#22201c"/><rect x="2" y="2" width="8" height="1" fill="#2f9e44"/><rect x="10" y="2" width="1" height="1" fill="#22201c"/><rect x="0" y="3" width="1" height="1" fill="#22201c"/><rect x="1" y="3" width="3" height="1" fill="#2f9e44"/><rect x="4" y="3" width="1" height="1" fill="#57c25f"/><rect x="5" y="3" width="4" height="1" fill="#2f9e44"/><rect x="9" y="3" width="1" height="1" fill="#57c25f"/><rect x="10" y="3" width="1" height="1" fill="#2f9e44"/><rect x="11" y="3" width="1" height="1" fill="#22201c"/><rect x="0" y="4" width="1" height="1" fill="#22201c"/><rect x="1" y="4" width="10" height="1" fill="#2f9e44"/><rect x="11" y="4" width="1" height="1" fill="#22201c"/><rect x="1" y="5" width="10" height="1" fill="#22201c"/></g></svg>
  <svg class="px-fl1" viewBox="0 0 8 12" shape-rendering="crispEdges"><g fill="#2f9e44"><rect x="3" y="6" width="2" height="6"/><rect x="1" y="8" width="2" height="1"/><rect x="5" y="9" width="2" height="1"/></g><g fill="#E8742C"><rect x="2" y="1" width="1" height="4"/><rect x="5" y="1" width="1" height="4"/><rect x="3" y="2" width="2" height="4"/></g></svg>
  <svg class="px-fl2" viewBox="0 0 8 12" shape-rendering="crispEdges"><g fill="#2f9e44"><rect x="3" y="6" width="2" height="6"/><rect x="1" y="8" width="2" height="1"/><rect x="5" y="9" width="2" height="1"/></g><g fill="#e599b5"><rect x="2" y="1" width="1" height="4"/><rect x="5" y="1" width="1" height="4"/><rect x="3" y="2" width="2" height="4"/></g></svg>
  <svg class="px-tuft1" viewBox="0 0 6 4" shape-rendering="crispEdges"><g fill="#37b24d"><rect x="0" y="2" width="1" height="2"/><rect x="2" y="0" width="1" height="4"/><rect x="4" y="1" width="1" height="3"/></g></svg>
  <svg class="px-tuft2" viewBox="0 0 6 4" shape-rendering="crispEdges"><g fill="#2f9e44"><rect x="1" y="1" width="1" height="3"/><rect x="3" y="0" width="1" height="4"/><rect x="5" y="2" width="1" height="2"/></g></svg>
  <svg class="px-rock" viewBox="0 0 10 5" shape-rendering="crispEdges"><g fill="#9a9a92"><rect x="2" y="1" width="6" height="4"/><rect x="1" y="2" width="8" height="3"/></g><g fill="#6f6f68"><rect x="3" y="3" width="4" height="2"/></g></svg>
  <svg class="px-kid1" viewBox="0 0 20 22" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="3" y="0" width="1" height="1" fill="#22201c"/><rect x="4" y="0" width="3" height="1" fill="#e24a3c"/><rect x="7" y="0" width="1" height="1" fill="#22201c"/><rect x="12" y="0" width="1" height="1" fill="#22201c"/><rect x="13" y="0" width="3" height="1" fill="#fac83c"/><rect x="16" y="0" width="1" height="1" fill="#22201c"/><rect x="2" y="1" width="1" height="1" fill="#22201c"/><rect x="3" y="1" width="5" height="1" fill="#e24a3c"/><rect x="8" y="1" width="1" height="1" fill="#22201c"/><rect x="11" y="1" width="1" height="1" fill="#22201c"/><rect x="12" y="1" width="5" height="1" fill="#fac83c"/><rect x="17" y="1" width="1" height="1" fill="#22201c"/><rect x="2" y="2" width="1" height="1" fill="#22201c"/><rect x="3" y="2" width="5" height="1" fill="#e24a3c"/><rect x="8" y="2" width="1" height="1" fill="#22201c"/><rect x="11" y="2" width="1" height="1" fill="#22201c"/><rect x="12" y="2" width="5" height="1" fill="#fac83c"/><rect x="17" y="2" width="1" height="1" fill="#22201c"/><rect x="3" y="3" width="1" height="1" fill="#22201c"/><rect x="4" y="3" width="3" height="1" fill="#e24a3c"/><rect x="7" y="3" width="1" height="1" fill="#22201c"/><rect x="12" y="3" width="1" height="1" fill="#22201c"/><rect x="13" y="3" width="3" height="1" fill="#fac83c"/><rect x="16" y="3" width="1" height="1" fill="#22201c"/><rect x="5" y="4" width="1" height="1" fill="#22201c"/><rect x="14" y="4" width="1" height="1" fill="#22201c"/><rect x="5" y="5" width="1" height="1" fill="#22201c"/><rect x="14" y="5" width="1" height="1" fill="#22201c"/><rect x="6" y="6" width="1" height="1" fill="#22201c"/><rect x="13" y="6" width="1" height="1" fill="#22201c"/><rect x="7" y="7" width="1" height="1" fill="#22201c"/><rect x="12" y="7" width="1" height="1" fill="#22201c"/><rect x="8" y="8" width="4" height="1" fill="#22201c"/><rect x="6" y="9" width="2" height="1" fill="#22201c"/><rect x="8" y="9" width="3" height="1" fill="#f0c096"/><rect x="11" y="9" width="2" height="1" fill="#22201c"/><rect x="6" y="10" width="1" height="1" fill="#22201c"/><rect x="7" y="10" width="5" height="1" fill="#f0c096"/><rect x="12" y="10" width="1" height="1" fill="#22201c"/><rect x="6" y="11" width="1" height="1" fill="#22201c"/><rect x="7" y="11" width="1" height="1" fill="#3c2a18"/><rect x="8" y="11" width="4" height="1" fill="#f0c096"/><rect x="12" y="11" width="1" height="1" fill="#22201c"/><rect x="6" y="12" width="1" height="1" fill="#22201c"/><rect x="7" y="12" width="5" height="1" fill="#f0c096"/><rect x="12" y="12" width="1" height="1" fill="#22201c"/><rect x="7" y="13" width="5" height="1" fill="#22201c"/><rect x="6" y="14" width="1" height="1" fill="#22201c"/><rect x="7" y="14" width="4" height="1" fill="#4080de"/><rect x="11" y="14" width="1" height="1" fill="#22201c"/><rect x="5" y="15" width="1" height="1" fill="#22201c"/><rect x="6" y="15" width="6" height="1" fill="#4080de"/><rect x="12" y="15" width="1" height="1" fill="#22201c"/><rect x="5" y="16" width="1" height="1" fill="#22201c"/><rect x="6" y="16" width="1" height="1" fill="#f0c096"/><rect x="7" y="16" width="5" height="1" fill="#4080de"/><rect x="12" y="16" width="1" height="1" fill="#f0c096"/><rect x="13" y="16" width="1" height="1" fill="#22201c"/><rect x="6" y="17" width="1" height="1" fill="#22201c"/><rect x="7" y="17" width="4" height="1" fill="#4080de"/><rect x="11" y="17" width="1" height="1" fill="#22201c"/><rect x="7" y="18" width="4" height="1" fill="#22201c"/><rect x="6" y="19" width="2" height="1" fill="#22201c"/><rect x="10" y="19" width="2" height="1" fill="#22201c"/><rect x="5" y="20" width="1" height="1" fill="#22201c"/><rect x="6" y="20" width="1" height="1" fill="#f0c096"/><rect x="11" y="20" width="1" height="1" fill="#f0c096"/><rect x="12" y="20" width="1" height="1" fill="#22201c"/><rect x="5" y="21" width="2" height="1" fill="#22201c"/><rect x="11" y="21" width="2" height="1" fill="#22201c"/></g></svg>
  <svg class="px-cat" viewBox="0 0 24 15" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="5" y="0" width="2" height="1" fill="#22201c"/><rect x="15" y="0" width="2" height="1" fill="#22201c"/><rect x="4" y="1" width="1" height="1" fill="#22201c"/><rect x="5" y="1" width="2" height="1" fill="#ffffff"/><rect x="7" y="1" width="1" height="1" fill="#22201c"/><rect x="14" y="1" width="1" height="1" fill="#22201c"/><rect x="15" y="1" width="2" height="1" fill="#ffffff"/><rect x="17" y="1" width="1" height="1" fill="#22201c"/><rect x="4" y="2" width="1" height="1" fill="#22201c"/><rect x="5" y="2" width="1" height="1" fill="#ffffff"/><rect x="6" y="2" width="1" height="1" fill="#f7a8b8"/><rect x="7" y="2" width="1" height="1" fill="#ffffff"/><rect x="8" y="2" width="1" height="1" fill="#22201c"/><rect x="13" y="2" width="1" height="1" fill="#22201c"/><rect x="14" y="2" width="1" height="1" fill="#ffffff"/><rect x="15" y="2" width="1" height="1" fill="#f7a8b8"/><rect x="16" y="2" width="1" height="1" fill="#ffffff"/><rect x="17" y="2" width="1" height="1" fill="#22201c"/><rect x="4" y="3" width="1" height="1" fill="#22201c"/><rect x="5" y="3" width="4" height="1" fill="#ffffff"/><rect x="9" y="3" width="4" height="1" fill="#22201c"/><rect x="13" y="3" width="4" height="1" fill="#ffffff"/><rect x="17" y="3" width="1" height="1" fill="#22201c"/><rect x="3" y="4" width="1" height="1" fill="#22201c"/><rect x="4" y="4" width="14" height="1" fill="#ffffff"/><rect x="18" y="4" width="1" height="1" fill="#22201c"/><rect x="3" y="5" width="1" height="1" fill="#22201c"/><rect x="4" y="5" width="1" height="1" fill="#ffffff"/><rect x="5" y="5" width="1" height="1" fill="#22201c"/><rect x="6" y="5" width="6" height="1" fill="#ffffff"/><rect x="12" y="5" width="1" height="1" fill="#22201c"/><rect x="13" y="5" width="5" height="1" fill="#ffffff"/><rect x="18" y="5" width="1" height="1" fill="#22201c"/><rect x="3" y="6" width="1" height="1" fill="#22201c"/><rect x="4" y="6" width="4" height="1" fill="#ffffff"/><rect x="8" y="6" width="1" height="1" fill="#22201c"/><rect x="9" y="6" width="1" height="1" fill="#f7a8b8"/><rect x="10" y="6" width="1" height="1" fill="#22201c"/><rect x="11" y="6" width="8" height="1" fill="#ffffff"/><rect x="19" y="6" width="1" height="1" fill="#22201c"/><rect x="3" y="7" width="1" height="1" fill="#22201c"/><rect x="4" y="7" width="4" height="1" fill="#ffffff"/><rect x="8" y="7" width="4" height="1" fill="#22201c"/><rect x="12" y="7" width="7" height="1" fill="#ffffff"/><rect x="19" y="7" width="1" height="1" fill="#22201c"/><rect x="4" y="8" width="1" height="1" fill="#22201c"/><rect x="5" y="8" width="14" height="1" fill="#ffffff"/><rect x="19" y="8" width="1" height="1" fill="#22201c"/><rect x="4" y="9" width="1" height="1" fill="#22201c"/><rect x="5" y="9" width="13" height="1" fill="#ffffff"/><rect x="18" y="9" width="1" height="1" fill="#22201c"/><rect x="21" y="9" width="2" height="1" fill="#22201c"/><rect x="3" y="10" width="1" height="1" fill="#22201c"/><rect x="4" y="10" width="15" height="1" fill="#ffffff"/><rect x="19" y="10" width="1" height="1" fill="#22201c"/><rect x="21" y="10" width="1" height="1" fill="#22201c"/><rect x="22" y="10" width="1" height="1" fill="#ffffff"/><rect x="23" y="10" width="1" height="1" fill="#22201c"/><rect x="3" y="11" width="1" height="1" fill="#22201c"/><rect x="4" y="11" width="15" height="1" fill="#ffffff"/><rect x="19" y="11" width="2" height="1" fill="#22201c"/><rect x="21" y="11" width="2" height="1" fill="#ffffff"/><rect x="23" y="11" width="1" height="1" fill="#22201c"/><rect x="3" y="12" width="1" height="1" fill="#22201c"/><rect x="4" y="12" width="16" height="1" fill="#ffffff"/><rect x="20" y="12" width="2" height="1" fill="#22201c"/><rect x="3" y="13" width="1" height="1" fill="#22201c"/><rect x="4" y="13" width="1" height="1" fill="#ffffff"/><rect x="5" y="13" width="2" height="1" fill="#22201c"/><rect x="7" y="13" width="2" height="1" fill="#ffffff"/><rect x="9" y="13" width="1" height="1" fill="#22201c"/><rect x="10" y="13" width="2" height="1" fill="#ffffff"/><rect x="12" y="13" width="1" height="1" fill="#22201c"/><rect x="13" y="13" width="2" height="1" fill="#ffffff"/><rect x="15" y="13" width="1" height="1" fill="#22201c"/><rect x="16" y="13" width="2" height="1" fill="#ffffff"/><rect x="18" y="13" width="2" height="1" fill="#22201c"/><rect x="3" y="14" width="16" height="1" fill="#22201c"/></g></svg>
  <svg class="px-dog" viewBox="0 0 24 14" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="5" y="0" width="12" height="1" fill="#22201c"/><rect x="4" y="1" width="1" height="1" fill="#22201c"/><rect x="5" y="1" width="12" height="1" fill="#e2a05c"/><rect x="17" y="1" width="1" height="1" fill="#22201c"/><rect x="3" y="2" width="1" height="1" fill="#22201c"/><rect x="4" y="2" width="1" height="1" fill="#6b3f1d"/><rect x="5" y="2" width="1" height="1" fill="#e2a05c"/><rect x="6" y="2" width="1" height="1" fill="#22201c"/><rect x="7" y="2" width="8" height="1" fill="#e2a05c"/><rect x="15" y="2" width="1" height="1" fill="#22201c"/><rect x="16" y="2" width="1" height="1" fill="#e2a05c"/><rect x="17" y="2" width="1" height="1" fill="#6b3f1d"/><rect x="18" y="2" width="1" height="1" fill="#22201c"/><rect x="3" y="3" width="1" height="1" fill="#22201c"/><rect x="4" y="3" width="2" height="1" fill="#6b3f1d"/><rect x="6" y="3" width="1" height="1" fill="#22201c"/><rect x="7" y="3" width="2" height="1" fill="#e2a05c"/><rect x="9" y="3" width="1" height="1" fill="#22201c"/><rect x="10" y="3" width="2" height="1" fill="#e2a05c"/><rect x="12" y="3" width="1" height="1" fill="#22201c"/><rect x="13" y="3" width="3" height="1" fill="#e2a05c"/><rect x="16" y="3" width="1" height="1" fill="#22201c"/><rect x="17" y="3" width="2" height="1" fill="#6b3f1d"/><rect x="19" y="3" width="1" height="1" fill="#22201c"/><rect x="3" y="4" width="1" height="1" fill="#22201c"/><rect x="4" y="4" width="2" height="1" fill="#6b3f1d"/><rect x="6" y="4" width="1" height="1" fill="#22201c"/><rect x="7" y="4" width="3" height="1" fill="#e2a05c"/><rect x="10" y="4" width="1" height="1" fill="#22201c"/><rect x="11" y="4" width="1" height="1" fill="#f7a8b8"/><rect x="12" y="4" width="1" height="1" fill="#22201c"/><rect x="13" y="4" width="3" height="1" fill="#e2a05c"/><rect x="16" y="4" width="1" height="1" fill="#22201c"/><rect x="17" y="4" width="2" height="1" fill="#6b3f1d"/><rect x="19" y="4" width="1" height="1" fill="#22201c"/><rect x="4" y="5" width="2" height="1" fill="#22201c"/><rect x="6" y="5" width="3" height="1" fill="#e2a05c"/><rect x="9" y="5" width="4" height="1" fill="#22201c"/><rect x="13" y="5" width="3" height="1" fill="#e2a05c"/><rect x="16" y="5" width="3" height="1" fill="#22201c"/><rect x="4" y="6" width="1" height="1" fill="#22201c"/><rect x="5" y="6" width="13" height="1" fill="#e2a05c"/><rect x="18" y="6" width="1" height="1" fill="#22201c"/><rect x="4" y="7" width="1" height="1" fill="#22201c"/><rect x="5" y="7" width="13" height="1" fill="#e2a05c"/><rect x="18" y="7" width="1" height="1" fill="#22201c"/><rect x="20" y="7" width="2" height="1" fill="#22201c"/><rect x="3" y="8" width="1" height="1" fill="#22201c"/><rect x="4" y="8" width="2" height="1" fill="#ffffff"/><rect x="6" y="8" width="12" height="1" fill="#e2a05c"/><rect x="18" y="8" width="1" height="1" fill="#22201c"/><rect x="20" y="8" width="1" height="1" fill="#e2a05c"/><rect x="21" y="8" width="1" height="1" fill="#ffffff"/><rect x="22" y="8" width="1" height="1" fill="#22201c"/><rect x="3" y="9" width="1" height="1" fill="#22201c"/><rect x="4" y="9" width="3" height="1" fill="#ffffff"/><rect x="7" y="9" width="2" height="1" fill="#e2a05c"/><rect x="9" y="9" width="5" height="1" fill="#ffffff"/><rect x="14" y="9" width="4" height="1" fill="#e2a05c"/><rect x="18" y="9" width="2" height="1" fill="#22201c"/><rect x="20" y="9" width="2" height="1" fill="#e2a05c"/><rect x="22" y="9" width="1" height="1" fill="#22201c"/><rect x="3" y="10" width="1" height="1" fill="#22201c"/><rect x="4" y="10" width="10" height="1" fill="#ffffff"/><rect x="14" y="10" width="7" height="1" fill="#e2a05c"/><rect x="21" y="10" width="1" height="1" fill="#22201c"/><rect x="3" y="11" width="1" height="1" fill="#22201c"/><rect x="4" y="11" width="10" height="1" fill="#ffffff"/><rect x="14" y="11" width="7" height="1" fill="#e2a05c"/><rect x="21" y="11" width="1" height="1" fill="#22201c"/><rect x="3" y="12" width="1" height="1" fill="#22201c"/><rect x="4" y="12" width="1" height="1" fill="#e2a05c"/><rect x="5" y="12" width="2" height="1" fill="#22201c"/><rect x="7" y="12" width="1" height="1" fill="#e2a05c"/><rect x="8" y="12" width="2" height="1" fill="#22201c"/><rect x="10" y="12" width="1" height="1" fill="#e2a05c"/><rect x="11" y="12" width="2" height="1" fill="#22201c"/><rect x="13" y="12" width="1" height="1" fill="#e2a05c"/><rect x="14" y="12" width="2" height="1" fill="#22201c"/><rect x="16" y="12" width="1" height="1" fill="#e2a05c"/><rect x="17" y="12" width="4" height="1" fill="#22201c"/><rect x="3" y="13" width="16" height="1" fill="#22201c"/></g></svg>
  <svg class="px-kid2" viewBox="0 0 20 22" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="3" y="0" width="1" height="1" fill="#22201c"/><rect x="4" y="0" width="3" height="1" fill="#fac83c"/><rect x="7" y="0" width="1" height="1" fill="#22201c"/><rect x="12" y="0" width="1" height="1" fill="#22201c"/><rect x="13" y="0" width="3" height="1" fill="#4080de"/><rect x="16" y="0" width="1" height="1" fill="#22201c"/><rect x="2" y="1" width="1" height="1" fill="#22201c"/><rect x="3" y="1" width="5" height="1" fill="#fac83c"/><rect x="8" y="1" width="1" height="1" fill="#22201c"/><rect x="11" y="1" width="1" height="1" fill="#22201c"/><rect x="12" y="1" width="5" height="1" fill="#4080de"/><rect x="17" y="1" width="1" height="1" fill="#22201c"/><rect x="2" y="2" width="1" height="1" fill="#22201c"/><rect x="3" y="2" width="5" height="1" fill="#fac83c"/><rect x="8" y="2" width="1" height="1" fill="#22201c"/><rect x="11" y="2" width="1" height="1" fill="#22201c"/><rect x="12" y="2" width="5" height="1" fill="#4080de"/><rect x="17" y="2" width="1" height="1" fill="#22201c"/><rect x="3" y="3" width="1" height="1" fill="#22201c"/><rect x="4" y="3" width="3" height="1" fill="#fac83c"/><rect x="7" y="3" width="1" height="1" fill="#22201c"/><rect x="12" y="3" width="1" height="1" fill="#22201c"/><rect x="13" y="3" width="3" height="1" fill="#4080de"/><rect x="16" y="3" width="1" height="1" fill="#22201c"/><rect x="5" y="4" width="1" height="1" fill="#22201c"/><rect x="14" y="4" width="1" height="1" fill="#22201c"/><rect x="5" y="5" width="1" height="1" fill="#22201c"/><rect x="14" y="5" width="1" height="1" fill="#22201c"/><rect x="6" y="6" width="1" height="1" fill="#22201c"/><rect x="13" y="6" width="1" height="1" fill="#22201c"/><rect x="7" y="7" width="1" height="1" fill="#22201c"/><rect x="12" y="7" width="1" height="1" fill="#22201c"/><rect x="8" y="8" width="4" height="1" fill="#22201c"/><rect x="6" y="9" width="2" height="1" fill="#22201c"/><rect x="8" y="9" width="3" height="1" fill="#f0c096"/><rect x="11" y="9" width="2" height="1" fill="#22201c"/><rect x="6" y="10" width="1" height="1" fill="#22201c"/><rect x="7" y="10" width="5" height="1" fill="#f0c096"/><rect x="12" y="10" width="1" height="1" fill="#22201c"/><rect x="6" y="11" width="1" height="1" fill="#22201c"/><rect x="7" y="11" width="3" height="1" fill="#f0c096"/><rect x="10" y="11" width="1" height="1" fill="#3c2a18"/><rect x="11" y="11" width="1" height="1" fill="#f0c096"/><rect x="12" y="11" width="1" height="1" fill="#22201c"/><rect x="6" y="12" width="1" height="1" fill="#22201c"/><rect x="7" y="12" width="5" height="1" fill="#f0c096"/><rect x="12" y="12" width="1" height="1" fill="#22201c"/><rect x="7" y="13" width="5" height="1" fill="#22201c"/><rect x="6" y="14" width="1" height="1" fill="#22201c"/><rect x="7" y="14" width="4" height="1" fill="#e978aa"/><rect x="11" y="14" width="1" height="1" fill="#22201c"/><rect x="5" y="15" width="1" height="1" fill="#22201c"/><rect x="6" y="15" width="6" height="1" fill="#e978aa"/><rect x="12" y="15" width="1" height="1" fill="#22201c"/><rect x="5" y="16" width="1" height="1" fill="#22201c"/><rect x="6" y="16" width="1" height="1" fill="#f0c096"/><rect x="7" y="16" width="4" height="1" fill="#e978aa"/><rect x="11" y="16" width="1" height="1" fill="#4080de"/><rect x="12" y="16" width="1" height="1" fill="#f0c096"/><rect x="13" y="16" width="1" height="1" fill="#22201c"/><rect x="6" y="17" width="1" height="1" fill="#22201c"/><rect x="7" y="17" width="4" height="1" fill="#e978aa"/><rect x="11" y="17" width="1" height="1" fill="#22201c"/><rect x="7" y="18" width="4" height="1" fill="#22201c"/><rect x="6" y="19" width="2" height="1" fill="#22201c"/><rect x="10" y="19" width="2" height="1" fill="#22201c"/><rect x="5" y="20" width="1" height="1" fill="#22201c"/><rect x="6" y="20" width="1" height="1" fill="#f0c096"/><rect x="11" y="20" width="1" height="1" fill="#f0c096"/><rect x="12" y="20" width="1" height="1" fill="#22201c"/><rect x="5" y="21" width="2" height="1" fill="#22201c"/><rect x="11" y="21" width="2" height="1" fill="#22201c"/></g></svg>
  <svg class="px-bee1" viewBox="0 0 10 6" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="1" y="0" width="1" height="1" fill="#22201c"/><rect x="2" y="0" width="2" height="1" fill="#d6ebff"/><rect x="6" y="0" width="1" height="1" fill="#22201c"/><rect x="7" y="0" width="2" height="1" fill="#d6ebff"/><rect x="0" y="1" width="1" height="1" fill="#22201c"/><rect x="1" y="1" width="1" height="1" fill="#d6ebff"/><rect x="2" y="1" width="1" height="1" fill="#ffffff"/><rect x="3" y="1" width="1" height="1" fill="#d6ebff"/><rect x="4" y="1" width="2" height="1" fill="#22201c"/><rect x="6" y="1" width="1" height="1" fill="#d6ebff"/><rect x="7" y="1" width="1" height="1" fill="#ffffff"/><rect x="8" y="1" width="1" height="1" fill="#d6ebff"/><rect x="9" y="1" width="1" height="1" fill="#22201c"/><rect x="0" y="2" width="1" height="1" fill="#22201c"/><rect x="1" y="2" width="1" height="1" fill="#d6ebff"/><rect x="2" y="2" width="1" height="1" fill="#ffffff"/><rect x="3" y="2" width="1" height="1" fill="#d6ebff"/><rect x="4" y="2" width="2" height="1" fill="#22201c"/><rect x="6" y="2" width="1" height="1" fill="#d6ebff"/><rect x="7" y="2" width="1" height="1" fill="#ffffff"/><rect x="8" y="2" width="1" height="1" fill="#d6ebff"/><rect x="9" y="2" width="1" height="1" fill="#22201c"/><rect x="1" y="3" width="1" height="1" fill="#22201c"/><rect x="2" y="3" width="6" height="1" fill="#f2a93b"/><rect x="8" y="3" width="1" height="1" fill="#22201c"/><rect x="1" y="4" width="1" height="1" fill="#22201c"/><rect x="2" y="4" width="1" height="1" fill="#f2a93b"/><rect x="3" y="4" width="2" height="1" fill="#22201c"/><rect x="5" y="4" width="1" height="1" fill="#f2a93b"/><rect x="6" y="4" width="2" height="1" fill="#22201c"/><rect x="8" y="4" width="1" height="1" fill="#f2a93b"/><rect x="2" y="5" width="6" height="1" fill="#22201c"/></g></svg>
  <svg class="px-bee2" viewBox="0 0 10 6" shape-rendering="crispEdges" aria-hidden="true"><g><rect x="1" y="0" width="1" height="1" fill="#22201c"/><rect x="2" y="0" width="2" height="1" fill="#d6ebff"/><rect x="6" y="0" width="1" height="1" fill="#22201c"/><rect x="7" y="0" width="2" height="1" fill="#d6ebff"/><rect x="0" y="1" width="1" height="1" fill="#22201c"/><rect x="1" y="1" width="1" height="1" fill="#d6ebff"/><rect x="2" y="1" width="1" height="1" fill="#ffffff"/><rect x="3" y="1" width="1" height="1" fill="#d6ebff"/><rect x="4" y="1" width="2" height="1" fill="#22201c"/><rect x="6" y="1" width="1" height="1" fill="#d6ebff"/><rect x="7" y="1" width="1" height="1" fill="#ffffff"/><rect x="8" y="1" width="1" height="1" fill="#d6ebff"/><rect x="9" y="1" width="1" height="1" fill="#22201c"/><rect x="0" y="2" width="1" height="1" fill="#22201c"/><rect x="1" y="2" width="1" height="1" fill="#d6ebff"/><rect x="2" y="2" width="1" height="1" fill="#ffffff"/><rect x="3" y="2" width="1" height="1" fill="#d6ebff"/><rect x="4" y="2" width="2" height="1" fill="#22201c"/><rect x="6" y="2" width="1" height="1" fill="#d6ebff"/><rect x="7" y="2" width="1" height="1" fill="#ffffff"/><rect x="8" y="2" width="1" height="1" fill="#d6ebff"/><rect x="9" y="2" width="1" height="1" fill="#22201c"/><rect x="1" y="3" width="1" height="1" fill="#22201c"/><rect x="2" y="3" width="6" height="1" fill="#f2a93b"/><rect x="8" y="3" width="1" height="1" fill="#22201c"/><rect x="1" y="4" width="1" height="1" fill="#22201c"/><rect x="2" y="4" width="1" height="1" fill="#f2a93b"/><rect x="3" y="4" width="2" height="1" fill="#22201c"/><rect x="5" y="4" width="1" height="1" fill="#f2a93b"/><rect x="6" y="4" width="2" height="1" fill="#22201c"/><rect x="8" y="4" width="1" height="1" fill="#f2a93b"/><rect x="2" y="5" width="6" height="1" fill="#22201c"/></g></svg>
  <div class="px-ground"><div class="px-grass"></div><div class="px-dirt"></div></div>
</div>
<!-- LOOP GLOW (b58) — the furry brand word, the hanging honeycomb and the
     bees.  Every letter is one of the four brand colours with a hairy edge; the
     word sways in a breeze and loose fur strands drift off it; a thin root hangs
     from the last “n” with a golden comb and a honey drop; eight bees fly their
     own endless loops around it.  All of it is CSS transforms on a few groups —
     no script per frame, nothing repainted. -->
<div class="mf-hero" aria-hidden="true">
  <div class="mf-bloom"></div>
  <div class="mf-stage">
    <div class="mf-brandwrap">
      <div class="mf-furdefs">
        <svg width="0" height="0" focusable="false"><defs>
          <filter id="mfFurFine" x="-24%" y="-30%" width="148%" height="160%" color-interpolation-filters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency=".34 .26" numOctaves="3" seed="11" result="n"/>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/>
            <feGaussianBlur stdDeviation=".35"/>
          </filter>
          <filter id="mfHiveSoft" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency=".06" numOctaves="2" seed="5" result="n"/>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
          </filter>
        </defs></svg>
      </div>
      <svg class="mf-brand" viewBox="-352 -100 704 314" role="img" aria-label="MindFusion">
        <g><g class="mf-word-fur"><g transform="translate(7.2,44)"><g transform="translate(-237.6,0)"><g class="mf-gl" style="animation-delay:0s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:8.2" opacity="0.95">M</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7" opacity="0.85">M</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.6" opacity="0.8">M</text><text x="0" y="0" class="mf-fur-face" style="fill:#4285F4;stroke:#1B4FB8">M</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">M</text></g></g><g transform="translate(-184.8,0)"><g class="mf-gl" style="animation-delay:-0.34s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:8.2" opacity="0.95">i</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:7" opacity="0.85">i</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.6" opacity="0.8">i</text><text x="0" y="0" class="mf-fur-face" style="fill:#EA4335;stroke:#A81F16">i</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">i</text></g></g><g transform="translate(-132,0)"><g class="mf-gl" style="animation-delay:-0.68s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#FBBC05;stroke:#B98600;stroke-width:8.2" opacity="0.95">n</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#FBBC05;stroke:#B98600;stroke-width:7" opacity="0.85">n</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#FBBC05;stroke:#B98600;stroke-width:7.6" opacity="0.8">n</text><text x="0" y="0" class="mf-fur-face" style="fill:#FBBC05;stroke:#B98600">n</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">n</text></g></g><g transform="translate(-79.2,0)"><g class="mf-gl" style="animation-delay:-1.02s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#34A853;stroke:#1B7635;stroke-width:8.2" opacity="0.95">d</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#34A853;stroke:#1B7635;stroke-width:7" opacity="0.85">d</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#34A853;stroke:#1B7635;stroke-width:7.6" opacity="0.8">d</text><text x="0" y="0" class="mf-fur-face" style="fill:#34A853;stroke:#1B7635">d</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">d</text></g></g><g transform="translate(-26.4,0)"><g class="mf-gl" style="animation-delay:-1.36s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:8.2" opacity="0.95">F</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7" opacity="0.85">F</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.6" opacity="0.8">F</text><text x="0" y="0" class="mf-fur-face" style="fill:#4285F4;stroke:#1B4FB8">F</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">F</text></g></g><g transform="translate(26.4,0)"><g class="mf-gl" style="animation-delay:-1.7s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:8.2" opacity="0.95">u</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:7" opacity="0.85">u</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.6" opacity="0.8">u</text><text x="0" y="0" class="mf-fur-face" style="fill:#EA4335;stroke:#A81F16">u</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">u</text></g></g><g transform="translate(79.2,0)"><g class="mf-gl" style="animation-delay:-2.04s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#FBBC05;stroke:#B98600;stroke-width:8.2" opacity="0.95">s</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#FBBC05;stroke:#B98600;stroke-width:7" opacity="0.85">s</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#FBBC05;stroke:#B98600;stroke-width:7.6" opacity="0.8">s</text><text x="0" y="0" class="mf-fur-face" style="fill:#FBBC05;stroke:#B98600">s</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">s</text></g></g><g transform="translate(132,0)"><g class="mf-gl" style="animation-delay:-2.38s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#34A853;stroke:#1B7635;stroke-width:8.2" opacity="0.95">i</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#34A853;stroke:#1B7635;stroke-width:7" opacity="0.85">i</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#34A853;stroke:#1B7635;stroke-width:7.6" opacity="0.8">i</text><text x="0" y="0" class="mf-fur-face" style="fill:#34A853;stroke:#1B7635">i</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">i</text></g></g><g transform="translate(184.8,0)"><g class="mf-gl" style="animation-delay:-2.72s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:8.2" opacity="0.95">o</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7" opacity="0.85">o</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.6" opacity="0.8">o</text><text x="0" y="0" class="mf-fur-face" style="fill:#4285F4;stroke:#1B4FB8">o</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">o</text></g></g><g transform="translate(237.6,0)"><g class="mf-gl" style="animation-delay:-3.06s"><text x="-3.2" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:8.2" opacity="0.95">n</text><text x="2.7" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:7" opacity="0.85">n</text><text x="-1.2" y="0" class="mf-fur-copy" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.6" opacity="0.8">n</text><text x="0" y="0" class="mf-fur-face" style="fill:#EA4335;stroke:#A81F16">n</text><text x="-2" y="-3.4" class="mf-fur-hi" style="fill:#FFFFFF" opacity=".28">n</text></g></g></g></g></g>
        <g class="mf-fur-layer" filter="url(#mfFurFine)"><g transform="translate(7.2,44)"><g transform="translate(-237.6,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:8.4">M</text><text x="3" y="1.9" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.2">M</text><text x="-1.4" y="3.2" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.8">M</text></g><g transform="translate(-184.8,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#EA4335;stroke:#A81F16;stroke-width:8.4">i</text><text x="3" y="1.9" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.2">i</text><text x="-1.4" y="3.2" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.8">i</text></g><g transform="translate(-132,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#FBBC05;stroke:#B98600;stroke-width:8.4">n</text><text x="3" y="1.9" style="fill:#FBBC05;stroke:#B98600;stroke-width:7.2">n</text><text x="-1.4" y="3.2" style="fill:#FBBC05;stroke:#B98600;stroke-width:7.8">n</text></g><g transform="translate(-79.2,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#34A853;stroke:#1B7635;stroke-width:8.4">d</text><text x="3" y="1.9" style="fill:#34A853;stroke:#1B7635;stroke-width:7.2">d</text><text x="-1.4" y="3.2" style="fill:#34A853;stroke:#1B7635;stroke-width:7.8">d</text></g><g transform="translate(-26.4,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:8.4">F</text><text x="3" y="1.9" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.2">F</text><text x="-1.4" y="3.2" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.8">F</text></g><g transform="translate(26.4,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#EA4335;stroke:#A81F16;stroke-width:8.4">u</text><text x="3" y="1.9" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.2">u</text><text x="-1.4" y="3.2" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.8">u</text></g><g transform="translate(79.2,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#FBBC05;stroke:#B98600;stroke-width:8.4">s</text><text x="3" y="1.9" style="fill:#FBBC05;stroke:#B98600;stroke-width:7.2">s</text><text x="-1.4" y="3.2" style="fill:#FBBC05;stroke:#B98600;stroke-width:7.8">s</text></g><g transform="translate(132,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#34A853;stroke:#1B7635;stroke-width:8.4">i</text><text x="3" y="1.9" style="fill:#34A853;stroke:#1B7635;stroke-width:7.2">i</text><text x="-1.4" y="3.2" style="fill:#34A853;stroke:#1B7635;stroke-width:7.8">i</text></g><g transform="translate(184.8,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:8.4">o</text><text x="3" y="1.9" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.2">o</text><text x="-1.4" y="3.2" style="fill:#4285F4;stroke:#1B4FB8;stroke-width:7.8">o</text></g><g transform="translate(237.6,0)" opacity=".9"><text x="-3.6" y="-2.8" style="fill:#EA4335;stroke:#A81F16;stroke-width:8.4">n</text><text x="3" y="1.9" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.2">n</text><text x="-1.4" y="3.2" style="fill:#EA4335;stroke:#A81F16;stroke-width:7.8">n</text></g></g></g>
        <g class="mf-strands"><path class="mf-strand" style="animation-delay:0s;stroke:#4285F4" d="M18.63 -9.05 Q25.19 -13.97 29.56 -17.25"/><path class="mf-strand" style="animation-delay:-0.93s;stroke:#EA4335" d="M30.57 -16.07 Q35.22 -20.35 38.32 -23.2"/><path class="mf-strand" style="animation-delay:-1.86s;stroke:#FBBC05" d="M-8.14 26.09 Q-3.46 21.91 -0.34 19.12"/><path class="mf-strand" style="animation-delay:-2.79s;stroke:#34A853" d="M-24.06 -14.42 Q-20.89 -19.3 -18.78 -22.56"/><path class="mf-strand" style="animation-delay:-3.72s;stroke:#4285F4" d="M18.19 -17.85 Q22.41 -19.36 25.23 -20.37"/><path class="mf-strand" style="animation-delay:-4.65s;stroke:#EA4335" d="M-10.39 -0.63 Q-8.37 -4.85 -7.03 -7.67"/><path class="mf-strand" style="animation-delay:-5.58s;stroke:#FBBC05" d="M-37.15 -8.19 Q-34.41 -14.22 -32.59 -18.25"/><path class="mf-strand" style="animation-delay:-6.51s;stroke:#34A853" d="M33.52 16.9 Q38.07 12.46 41.11 9.5"/><path class="mf-strand" style="animation-delay:-7.44s;stroke:#4285F4" d="M34.01 5.82 Q38.18 -0.74 40.95 -5.12"/><path class="mf-strand" style="animation-delay:-8.37s;stroke:#EA4335" d="M-20.41 -24.79 Q-12.93 -26.83 -7.95 -28.19"/></g><g transform="translate(252,44) scale(.9)"><g class="mf-hive-wrap">
      <g class="mf-hive">
        <defs><clipPath id="mfCombClip"><path d="M 47 21 Q 50 21 52 23 L 75 48 Q 77 50 77 53 L 77 76 Q 77 80 73 83 L 51 95 Q 47 97 43 95 L 21 83 Q 17 80 17 76 L 17 53 Q 17 50 19 48 L 42 23 Q 44 21 47 21 Z"/></clipPath></defs>
        <path class="mf-root" d="M 0 0 C 30 4 40 10 44 18"/>
        <path class="mf-root lite" d="M 2 1 C 29 5 39 11 43 17"/>
        <g class="mf-leaves">
          <path class="mf-leaf" d="M 40 14 C 56 5 71 12 74 24 C 60 32 46 27 40 14 Z"/>
          <path class="mf-leaf vein" d="M 42 15 C 53 15 64 19 73 24"/>
          <path class="mf-leaf" d="M 33 10 C 17 0 4 6 0 16 C 14 24 27 20 33 10 Z"/>
          <path class="mf-leaf vein" d="M 32 11 C 21 12 11 13 1 16"/>
        </g>
        <g class="mf-comb">
          <!-- the wax slab, the inner bevel the cells sit in -->
          <path class="mf-comb-wax" d="M 47 12 Q 51 12 54 15 L 82 45 Q 85 48 85 52 L 85 78 Q 85 84 80 88 L 52 102 Q 47 105 42 102 L 14 88 Q 9 84 9 78 L 9 52 Q 9 48 12 45 L 40 15 Q 43 12 47 12 Z"/>
          <path class="mf-comb-side" d="M 47 21 Q 50 21 52 23 L 75 48 Q 77 50 77 53 L 77 76 Q 77 80 73 83 L 51 95 Q 47 97 43 95 L 21 83 Q 17 80 17 76 L 17 53 Q 17 50 19 48 L 42 23 Q 44 21 47 21 Z"/>
          <!-- the cells, clipped so no half-hexagon ever pokes out -->
          <g clip-path="url(#mfCombClip)"><g class="mf-cells"><polygon class="mf-cell" style="animation-delay:-2.48s" points="33.54,56.15 27.39,59.7 21.24,56.15 21.24,49.05 27.39,45.5 33.54,49.05"/><polygon class="mf-cell" style="animation-delay:-2.71s" points="46.61,56.15 40.46,59.7 34.32,56.15 34.32,49.05 40.46,45.5 46.61,49.05"/><polygon class="mf-cell" style="animation-delay:-2.94s" points="59.68,56.15 53.54,59.7 47.39,56.15 47.39,49.05 53.54,45.5 59.68,49.05"/><polygon class="mf-cell" style="animation-delay:-1.1s" points="72.76,56.15 66.61,59.7 60.46,56.15 60.46,49.05 66.61,45.5 72.76,49.05"/><polygon class="mf-cell" style="animation-delay:-2.71s" points="27,67.55 20.86,71.1 14.71,67.55 14.71,60.45 20.86,56.9 27,60.45"/><polygon class="mf-cell" style="animation-delay:-2.94s" points="40.08,67.55 33.93,71.1 27.78,67.55 27.78,60.45 33.93,56.9 40.08,60.45"/><polygon class="mf-cell" style="animation-delay:-1.1s" points="53.15,67.55 47,71.1 40.85,67.55 40.85,60.45 47,56.9 53.15,60.45"/><polygon class="mf-cell" style="animation-delay:-1.33s" points="66.22,67.55 60.07,71.1 53.92,67.55 53.92,60.45 60.07,56.9 66.22,60.45"/><polygon class="mf-cell" style="animation-delay:-1.56s" points="79.29,67.55 73.14,71.1 67,67.55 67,60.45 73.14,56.9 79.29,60.45"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-2.94s" points="33.54,78.95 27.39,82.5 21.24,78.95 21.24,71.85 27.39,68.3 33.54,71.85"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.1s" points="46.61,78.95 40.46,82.5 34.32,78.95 34.32,71.85 40.46,68.3 46.61,71.85"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.33s" points="59.68,78.95 53.54,82.5 47.39,78.95 47.39,71.85 53.54,68.3 59.68,71.85"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.56s" points="72.76,78.95 66.61,82.5 60.46,78.95 60.46,71.85 66.61,68.3 72.76,71.85"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.1s" points="27,90.35 20.86,93.9 14.71,90.35 14.71,83.25 20.86,79.7 27,83.25"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.33s" points="40.08,90.35 33.93,93.9 27.78,90.35 27.78,83.25 33.93,79.7 40.08,83.25"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.56s" points="53.15,90.35 47,93.9 40.85,90.35 40.85,83.25 47,79.7 53.15,83.25"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-1.79s" points="66.22,90.35 60.07,93.9 53.92,90.35 53.92,83.25 60.07,79.7 66.22,83.25"/><polygon class="mf-cell mf-cell-honey" style="animation-delay:-2.02s" points="79.29,90.35 73.14,93.9 67,90.35 67,83.25 73.14,79.7 79.29,83.25"/></g>
            <g class="mf-honey-pool"><circle class="mf-honey-bub" cx="33" cy="85" r="1.9"/><circle class="mf-honey-bub" cx="46" cy="82" r="2.4"/><circle class="mf-honey-bub" cx="59" cy="85" r="2.9"/></g>
            <ellipse class="mf-honey" cx="47" cy="93" rx="15" ry="5.4"/>
          </g>
          <!-- the amber edge and a light along the top left -->
          <path class="mf-comb-edge" d="M 47 12 Q 51 12 54 15 L 82 45 Q 85 48 85 52 L 85 78 Q 85 84 80 88 L 52 102 Q 47 105 42 102 L 14 88 Q 9 84 9 78 L 9 52 Q 9 48 12 45 L 40 15 Q 43 12 47 12 Z"/>
          <path class="mf-comb-shine" d="M 22 44 Q 27 31 40 26"/>
        </g>
        <ellipse class="mf-honey-drip" cx="47" cy="112" rx="3.2" ry="5.6"/>
        <ellipse class="mf-honey-drip drip2" cx="62" cy="104" rx="2.3" ry="4"/>
      </g>
    </g></g><g class="mf-bee mf-bee-0">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-1">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-2">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-3">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-4">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-5">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-6">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g><g class="mf-bee mf-bee-7">
      <g class="mf-bee-bob"><g transform="scale(1.22)">
        <g class="mf-wing mf-wing-l"><ellipse cx="-5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(-24 -5.4 -5.6)"/></g>
        <g class="mf-wing mf-wing-r"><ellipse cx="5.4" cy="-5.6" rx="6.6" ry="3.1" transform="rotate(24 5.4 -5.6)"/></g>
        <ellipse class="mf-bee-body" cx="0" cy="2.2" rx="4.5" ry="7.6"/>
        <path class="mf-bee-band" d="M -4.3 -1.1 C -1.6 -.5 1.6 -.5 4.3 -1.1"/>
        <path class="mf-bee-band" d="M -4.4 1.5 C -1.6 2.1 1.6 2.1 4.4 1.5"/>
        <path class="mf-bee-band" d="M -4 4.1 C -1.5 4.7 1.5 4.7 4 4.1"/>
        <path class="mf-bee-tail" d="M -2.6 8.4 L 0 10.1 L 2.6 8.4"/>
        <ellipse class="mf-bee-head" cx="0" cy="-7.6" rx="3.9" ry="3.4"/>
        <path class="mf-bee-ant" d="M -1.7 -10.4 C -3.6 -13.4 -5.8 -13.8 -7.4 -12.4"/>
        <path class="mf-bee-ant" d="M 1.7 -10.4 C 3.6 -13.4 5.8 -13.8 7.4 -12.4"/>
        <path class="mf-bee-leg" d="M -3.4 -2.4 C -6.2 -1.4 -7.6 .4 -8.2 2.2"/>
        <path class="mf-bee-leg" d="M 3.4 -2.4 C 6.2 -1.4 7.6 .4 8.2 2.2"/>
        <path class="mf-bee-leg" d="M -3.6 2.2 C -6.4 3.4 -7.4 5.6 -7.6 7.6"/>
        <path class="mf-bee-leg" d="M 3.6 2.2 C 6.4 3.4 7.4 5.6 7.6 7.6"/>
      </g></g>
    </g></svg>
    </div>
  </div>
</div><div class="gate-inner">
      <svg class="gate-logo" viewBox="0 0 100 100"><use href="#flower"/></svg>
      <h1 class="script-title">Namaste Sujoy</h1>
      <p>Ask anything, understand documents, and explore ideas with MindFusion.</p>
    </div>
  </div>
  <!-- sparkle layer: only inside the hero -->
  <canvas id="fxCanvas" aria-hidden="true"></canvas>
</section>
<section class="shortcuts">
  <button class="shortcut" type="button" data-query="Summarize this for me in simple language.">
    <div class="shortcut-icon">✦</div><div class="shortcut-title">Summarize</div>
    <div class="shortcut-desc">Turn long content into a clear summary</div>
  </button>
  <button class="shortcut" type="button" data-query="Explain this to me in very simple language with an example.">
    <div class="shortcut-icon">💡</div><div class="shortcut-title">Explain simply</div>
    <div class="shortcut-desc">Understand difficult topics easily</div>
  </button>
  <button class="shortcut" type="button" data-query="Find and extract the important information from this.">
    <div class="shortcut-icon">⌕</div><div class="shortcut-title">Find &amp; Extract</div>
    <div class="shortcut-desc">Locate important facts and details</div>
  </button>
  <button class="shortcut" type="button" data-query="Think through this problem carefully and solve it step by step.">
    <div class="shortcut-icon">🧠</div><div class="shortcut-title">Think &amp; Solve</div>
    <div class="shortcut-desc">Work through problems step by step</div>
  </button>
</section>
<section class="chat-area">
  <div id="pinBar" class="pin-bar" hidden></div>
  <div id="messages" class="messages"></div>
  <div id="imgPreview" class="modal-bg" role="dialog" aria-modal="true" aria-label="File preview">
    <div class="preview-card">
      <div class="preview-head">
        <span id="pvTitle">Your file</span>
        <button id="pvClose" class="mini-x" type="button" title="Close" aria-label="Close">✕</button>
      </div>
      <img id="pvImg" alt="preview">
      <div id="pvText" class="pv-text" style="display:none"></div>
      <div class="preview-actions">
        <a id="pvDownload" class="pv-primary" download="file" target="_blank" rel="noopener">⬇️ Download</a>
        <button id="pvRemove" type="button">🗑️ Remove file</button>
        <button id="pvCrop" type="button" hidden>✂️ Crop picture</button>
      </div>
    </div>
  </div>
  <!-- ✂️ the crop sheet: drag the corners, pick a shape, then crop -->
  <div id="cropSheet" class="crop-sheet" hidden role="dialog" aria-modal="true" aria-label="Crop the picture">
    <div class="crop-card">
      <div class="crop-head">
        <span>✂️ Crop the picture</span>
        <button id="cropClose" class="mini-x" type="button" title="Close" aria-label="Close">✕</button>
      </div>
      <div class="crop-stage" id="cropStage">
        <div class="crop-frame" id="cropFrame">
          <img id="cropImg" alt="picture to crop">
          <div id="cropRect" class="crop-rect">
            <span class="crop-h" data-h="nw"></span>
            <span class="crop-h" data-h="ne"></span>
            <span class="crop-h" data-h="sw"></span>
            <span class="crop-h" data-h="se"></span>
          </div>
        </div>
      </div>
      <div class="crop-bar">
        <span class="crop-lbl">SHAPE</span>
        <div class="crop-tools" id="cropTools">
          <button class="crop-tool on" type="button" data-aspect="free">Free</button>
          <button class="crop-tool" type="button" data-aspect="1:1">1:1</button>
          <button class="crop-tool" type="button" data-aspect="4:3">4:3</button>
          <button class="crop-tool" type="button" data-aspect="16:9">16:9</button>
          <button class="crop-tool" type="button" data-aspect="9:16">9:16</button>
          <button class="crop-tool" type="button" id="cropReset">↺ Whole picture</button>
        </div>
        <div class="crop-zoom">
          <button type="button" id="cropZoomOut" title="Zoom out" aria-label="Zoom out">−</button>
          <span class="crop-zoom-val" id="cropZoomVal">100%</span>
          <button type="button" id="cropZoomIn" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" class="wide" id="cropZoomFit" title="Fit the whole picture">Fit</button>
        </div>
      </div>
      <div class="crop-info" id="cropInfo"></div>
      <div class="crop-actions">
        <button id="cropSkip" class="crop-btn ghost" type="button" hidden>Use without crop</button>
        <button id="cropCancel" class="crop-btn" type="button">Cancel</button>
        <button id="cropApply" class="crop-btn primary" type="button">✂️ Save crop</button>
      </div>
    </div>
  </div>
  <div id="dock" class="composer-wrap">
    <button id="jumpDown" class="jump-down" type="button" title="Back to the newest message" aria-label="Back to the newest message"></button>
    <div id="documentChip" class="document-chip">
      <span id="documentName" class="document-name"></span>
      <button id="clearDocument" class="document-clear" type="button" title="Remove file">✕</button>
    </div>
    <div id="suggest" class="suggest"></div>
    <div class="controls">
      <div class="model-row">
        <div class="model-left">
          <div class="model-stack">
          <!-- MODELS drop-up -->
          <div class="model-wrap" id="modelWrap">
            <button id="modelBtn" class="model-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Turn AI models on / off">
              <span>⚡</span><span>Models</span><span id="modelCount" class="model-count">1</span><span class="caret">▴</span>
            </button>
            <div id="modelMenu" class="model-menu" role="group" aria-label="AI models">
              <div class="model-menu-title">AI Models</div>
              <div class="model-group">Sarvam</div>
              <button type="button" class="model-item" data-model="sarvam" role="switch" aria-checked="true">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#E8742C"/><circle cx="12" cy="8.6" r="2.5" fill="#FFF3E0"/><path d="M6.8 14.6c1.6-4.2 8.8-4.2 10.4 0" stroke="#FFF3E0" stroke-width="2" fill="none" stroke-linecap="round"/></svg></span>
                <span class="model-txt"><b>Sarvam 105B</b><small>Chat &amp; answers in English, বাংলা, हिन्दी</small></span>
                <span class="switch"><i></i></span>
              </button>
              <button type="button" class="model-item" data-model="mayura" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8.2 7.6 6 11.6 6 14.8a6 6 0 0 0 12 0C18 11.6 15.8 7.6 12 2z" fill="#0E8F83"/><circle cx="12" cy="14.6" r="3.4" fill="#1F4FA3"/><circle cx="12" cy="14.6" r="1.6" fill="#F2A93B"/></svg></span>
                <span class="model-txt"><b>Sarvam Mayura</b><small>Translate text &amp; images · 22 languages → English / বাংলা / हिन्दी</small></span>
                <span class="switch"><i></i></span>
              </button>
              <button type="button" class="model-item" data-model="vision" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z" fill="none" stroke="#2BA6A0" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="#2BA6A0"/></svg></span>
                <span class="model-txt"><b>Sarvam Vision</b><small>Read &amp; analyse PDFs and images</small></span>
                <span class="switch"><i></i></span>
              </button>
              <div class="model-group">More chat models · one answers at a time</div>
              <button type="button" class="model-item" data-model="qwen" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="#615CED"/><path d="M8.6 11.4a3.6 3.6 0 1 1 4.9 3.4l2.3 2.4" stroke="#fff" stroke-width="2.1" fill="none" stroke-linecap="round"/></svg></span>
                <span class="model-txt"><b>Qwen 3.7 Flash</b><small>Fast general chat · 0G</small></span>
                <span class="switch"><i></i></span>
              </button>
              <button type="button" class="model-item" data-model="gemini" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8c.9 5.5 4.7 9.3 10.2 10.2-5.5.9-9.3 4.7-10.2 10.2-.9-5.5-4.7-9.3-10.2-10.2C7.3 11.1 11.1 7.3 12 1.8z" fill="#4E86FF"/><path d="M12 6.4c.5 3 2.6 5.1 5.6 5.6-3 .5-5.1 2.6-5.6 5.6-.5-3-2.6-5.1-5.6-5.6 3-.5 5.1-2.6 5.6-5.6z" fill="#9BC0FF"/></svg></span>
                <span class="model-txt"><b>Google Gemini</b><small>Google's AI · own API key</small></span>
                <span class="switch"><i></i></span>
              </button>
              <button type="button" class="model-item" data-model="glm" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="#1F6FEB"/><path d="M8 7.6h8l-4.6 3.7H16L8 17l2.2-4.4H8z" fill="#fff"/></svg></span>
                <span class="model-txt"><b>GLM 5.3 Flash</b><small>Fast reasoning chat · 0G</small></span>
                <span class="switch"><i></i></span>
              </button>
              <button type="button" class="model-item" data-model="deepseek" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5c0 4.6 3.8 7.5 8.6 7.5 3.8 0 6.9-1.9 6.9-4.7 0-1.9-1.3-3-3.1-3h-1.7c-.9 0-.9-.9 0-.9 1.9 0 3-.9 3-2.7H9.2c-3.2 0-5.7 1.6-5.7 3.8z" fill="#4D6BFE"/><path d="M17.5 6.7l4-2.4v4.8z" fill="#4D6BFE"/><circle cx="7.6" cy="11" r="1.1" fill="#fff"/></svg></span>
                <span class="model-txt"><b>DeepSeek V4 Flash</b><small>Coding &amp; step-by-step thinking · 0G</small></span>
                <span class="switch"><i></i></span>
              </button>
              <div class="model-group" id="customGroupTitle" style="display:none">Your models · added in Settings</div>
              <div id="customModels"></div>
              <div class="model-group">Image creation</div>
              <button type="button" class="model-item" data-model="image" role="switch" aria-checked="false">
                <span class="model-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="#31302E"/><circle cx="9" cy="8.6" r="1.8" fill="#F2A93B"/><path d="M6 16.5l3.2-4.2 2.6 3.1 2.1-2.6 4.1 3.7z" fill="#2BA6A0"/></svg></span>
                <span class="model-txt"><b>Z-Image Turbo</b><small>Create pictures from your description · 0G</small></span>
                <span class="switch"><i></i></span>
              </button>
            </div>
          </div>
          </div>
          <!-- REPLY LANGUAGE drop-up -->
          <div class="model-wrap" id="replyWrap">
            <button id="replyBtn" class="model-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Language of the AI replies">
              <span>🗣️</span><span class="lbl-hide">Reply:</span><span id="replyCur">English</span><span class="caret">▴</span>
            </button>
            <div id="replyMenu" class="model-menu reply-menu" role="menu" aria-label="Reply language">
              <div class="model-menu-title">Reply language</div>
              <button type="button" class="model-item" data-lang="en-IN" role="menuitemradio" aria-checked="false">
                <span class="model-ico">En</span>
                <span class="model-txt"><b>English</b><small>Always answer in English</small></span>
                <span class="tick">✓</span>
              </button>
              <button type="button" class="model-item" data-lang="bn-IN" role="menuitemradio" aria-checked="false">
                <span class="model-ico">বা</span>
                <span class="model-txt"><b>বাংলা</b><small>সবসময় বাংলায় উত্তর দাও</small></span>
                <span class="tick">✓</span>
              </button>
              <button type="button" class="model-item" data-lang="hi-IN" role="menuitemradio" aria-checked="false">
                <span class="model-ico">हि</span>
                <span class="model-txt"><b>हिन्दी</b><small>िमेशा हिन्दी मं उत्तर दं</small></span>
                <span class="tick">✓</span>
              </button>
            </div>
          </div>
          <!-- 🎤 voice / language sits with the other controls on the left,
               so the file button on the right can never cover it -->
          <label class="voice-lang" title="Language you will speak in (voice input)">
            <span class="voice-lang-icon">🎤</span>
            <select id="voiceLang" aria-label="Voice input language">
              <option value="bn-IN">বাংলা</option>
              <option value="en-IN">English</option>
              <option value="hi-IN">हिन्दी</option>
            </select>
          </label>
        </div>
        <div class="attach-wrap">
      <div id="attachPanel" class="attach-panel" hidden>
        <div class="ap-head">
          <span class="ap-title" id="attachMiniName">file</span>
        </div>
        <div class="ap-meta" id="attachMiniMeta"></div>
        <div class="ap-row">
          <button id="apView" class="ap-btn" type="button">🔍 View</button>
          <button id="apCrop" class="ap-btn" type="button" hidden>✂️ Crop</button>
          <button id="apRemove" class="ap-btn danger" type="button">🗑️ Remove</button>
        </div>
      </div>
      <button id="attachMini" class="attach-mini no-name sparkle" type="button" title="Your file — tap for details"
              aria-label="Your attached file — tap for the name, crop or remove">
        <img id="attachMiniThumb" class="thumb" alt="" hidden>
        <span id="attachMiniIco" class="mini-ico" hidden>📄</span>
      </button>
    </div>
      </div>
      <!-- Mayura features -->
      <div id="stripMayura" class="strip">
        <span class="strip-label">🌐 Translate</span>
        <select id="trFrom" aria-label="Input language"></select>
        <span class="strip-arrow">→</span>
        <select id="trTo" aria-label="Output language"></select>
        <button id="trBtn" class="strip-btn" type="button">Translate text</button>
      </div>
      <!-- Vision features -->
      <div id="stripVision" class="strip">
        <span class="strip-label">👁️ Document language</span>
        <select id="visLang" aria-label="Document language"></select>
        <span class="strip-hint">tap ＋ to upload a PDF / image</span>
      </div>
      <!-- Image features -->
      <div id="stripImage" class="strip">
        <span class="strip-label">🎨 Image</span>
        <select id="imgSize" aria-label="Image size"></select>
        <button id="imgBtn" class="strip-btn" type="button">Generate image</button>
        <span class="strip-hint">describe the picture in the box below (English works best)</span>
      </div>
    </div>
    <div class="composer">
      <input id="file" class="file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" />
      <button id="uploadBtn" class="upload-btn" type="button" title="Upload image or PDF" aria-label="Upload file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <textarea id="input" rows="1" placeholder="Ask anything..."></textarea>
      <button id="micBtn" class="mic-btn" type="button" title="Speak (voice input)" aria-label="Voice input" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
      </button>
      <button id="send" class="send-btn" type="button" title="Send" aria-label="Send">
        <svg class="go-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>
        <span class="stop-ico" aria-hidden="true"></span>
      </button>
    </div>
    <div id="status" class="status"></div>
  </div>
</section>
</main>
</div>
<div id="overlay" class="overlay"></div>
<!-- upload dialog -->
<div id="fileDialog" class="modal-bg">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="dlgHeading">
    <h2 id="dlgHeading">Choose languages</h2>
    <div id="dlgTitle" class="modal-file"></div>
    <div id="dlgActions" class="actions-row">
      <label class="action-opt"><input type="radio" name="dlgAction" value="translate" checked> 🌐 Translate</label>
      <label class="action-opt"><input type="radio" name="dlgAction" value="analyze"> 👁️ Analyse</label>
    </div>
    <div class="field">
      <label for="dlgFrom">Input language (language of the file)</label>
      <select id="dlgFrom"></select>
    </div>
    <div class="field">
      <label for="dlgTo">Output language</label>
      <select id="dlgTo"></select>
    </div>
    <div id="dlgNote" class="modal-note"></div>
    <div class="modal-btns">
      <button id="dlgCancel" type="button">Cancel</button>
      <button id="dlgStart" class="go" type="button">Start</button>
    </div>
  </div>
</div>
<aside id="drawer" class="drawer">
  <div class="drawer-head">
    <div class="drawer-title">Chat History</div>
    <button id="clearAll" class="clear-all-btn" type="button" title="Clear all chat history">🧹 Clear all</button>
    <button id="close" class="icon-btn" type="button">✕</button>
  </div>
  <div id="clearAllBox" class="clear-all-box" hidden>
    <div class="cab-text">Delete every chat here, and the copy in your Cloudflare KV?</div>
    <div class="cab-row">
      <button id="caHistory" class="cab-btn go" type="button">Clear chats</button>
      <button id="caAll" class="cab-btn danger" type="button">Clear everything in KV</button>
      <button id="caCancel" class="cab-btn" type="button">Cancel</button>
    </div>
  </div>
  <div id="historyList" class="history-list"></div>
  <button id="webSide" class="new-chat-side mf-websearch-btn" type="button" title="Search the live web"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg><span>Web Search</span></button>
  <div class="signature">Made with <span class="heart">💖</span> by <b>Sujoy</b></div>
</aside>
<div id="webSearch" class="mf-ws" hidden>
  <div class="mf-ws-box" role="dialog" aria-modal="true" aria-label="Web Search">
    <div class="mf-ws-head">
      <span class="mf-ws-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z"/></svg></span>
      <div class="mf-ws-title">Web Search</div>
      <button id="wsHist" class="icon-btn" type="button" aria-label="Past searches"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 1 2.5 6"/><path d="M3.5 12H7M3.5 12l1.2-3.2"/><path d="M12 7.5V12l3 2"/></svg></button>
      <button id="wsClose" class="icon-btn" type="button" aria-label="Close web search">✕</button>
    </div>
    <form id="wsForm" class="mf-ws-form">
      <input id="wsInput" type="search" autocomplete="off" enterkeyhint="search" placeholder="Search the live web…">
      <button id="wsGo" class="mf-ws-go" type="submit">Search</button>
    </form>
    <div id="wsHistPanel" class="mf-ws-hist" hidden></div>
    <div id="wsMeta" class="mf-ws-meta">Live results from across the web.</div>
    <div id="wsResults" class="mf-ws-results"></div>
    <button id="wsMore" class="mf-ws-more" type="button" hidden>More results</button>
  </div>
</div>
<aside id="settings" class="drawer settings">
  <div class="drawer-head">
    <div class="drawer-title">⚙️ Settings &amp; Usage</div>
    <button id="closeSettings" class="icon-btn" type="button">✕</button>
  </div>
  <div class="settings-body">
    <section class="card">
      <h3>🎨 Appearance <small>saved on this device</small></h3>
      <div class="opt-label">UI design</div>
      <div class="model-wrap pal-wrap" id="palWrap">
        <button id="palBtn" class="model-btn" type="button" aria-haspopup="true" aria-expanded="false" title="Choose a UI design">
          <span>🎨</span><span id="palCur">Loop Glow (default)</span><span class="caret">▾</span>
        </button>
        <div id="paletteRow" class="model-menu pal-menu" role="menu" aria-label="UI designs"></div>
      </div>
      <!-- b61 — dark mode lives in the ⋮ menu now, not in Appearance -->
      <div class="opt-label gap">Screen layout</div>
      <div id="viewRow" class="seg">
        <button type="button" data-view="auto">✨ Auto</button>
        <button type="button" data-view="mobile">📱 Mobile</button>
        <button type="button" data-view="web">🖥️ Web</button>
      </div>
      <div id="viewHint" class="hint"></div>
    </section>
    <section class="card">
      <h3>AI usage (all models) <small>tokens consumed</small></h3>
      <div id="sarvamUsage"></div>
      <div id="usageHint" class="hint"></div>
      <div class="card-actions">
        <a href="https://dashboard.sarvam.ai" target="_blank" rel="noopener">Open Sarvam dashboard</a>
        <button id="resetUsage" type="button">Reset counters</button>
      </div>
    </section>
    <section class="card">
      <h3>Cloudflare Worker usage <small>live from Cloudflare</small></h3>
      <div id="cfUsage" class="hint">Loading...</div>
      <div class="card-actions">
        <button id="loadCf" type="button">Refresh</button>
        <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">Open Cloudflare</a>
      </div>
    </section>
    <section class="card">
      <h3>🤖 AI models <small>add / remove / delete any model — no code change</small></h3>
      <details class="cm-fold" id="mfFoldAll">
        <summary><span>📋 Every AI model — hold one for 2 s to delete it</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div id="mfAllModels"></div>
          <div class="hint">Press and hold a model for <b>2 seconds</b> — with a finger or with the mouse — and a small panel asks once more. Built-in models (Sarvam, Google Gemini, the 0G ones, Mayura, Vision, Z-Image) can be deleted exactly like the ones you added yourself. Deleting is <b>permanent</b> — there is no undo and no restore.</div>
        </div>
      </details>
      <details class="cm-fold" id="cmFoldList" open>
        <summary><span>📋 My models</span><span class="cm-count" id="cmCount">0</span></summary>
        <div class="cm-bodied">
          <div id="customModelList"></div>
          <div class="hint" id="cmStoreHint"></div>
          <div class="hint">Every model answers through the API picked for it (0G, OpenRouter or Google) — the addresses and the keys live in <b>🔌 API providers</b>, so you only ever fill three boxes.</div>
        </div>
      </details>
      <details class="cm-fold" id="cmFoldAdd">
        <summary><span>➕ Add a model</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div class="cm-step">1 · Which API answers?</div>
          <div id="cmProv" class="prov-pick" role="radiogroup" aria-label="Which API the model belongs to"></div>
          <div id="cmProvNote" class="prov-note"></div>
          <div class="cm-step">2 · Name it</div>
          <input id="cmName" class="set-input" type="text" placeholder="Display name (e.g. Qwen Flash)" autocomplete="off">
          <div class="cm-code">
            <input id="cmId" class="set-input" type="text" placeholder="Model code name (e.g. qwen3.7-flash)" autocomplete="off">
            <button id="cmBrowse" class="mini-btn" type="button" title="See the models this API offers">📖 Models</button>
          </div>
          <div id="cmModels" class="live-list" hidden>
            <div class="live-head">
              <input id="cmSearch" class="set-input" type="text" placeholder="Type to search the list…" autocomplete="off">
              <label class="live-free"><input id="cmFreeOnly" type="checkbox" checked> free only</label>
              <button id="cmReload" class="mini-btn" type="button">↻</button>
            </div>
            <div id="cmModelRows" class="live-rows"></div>
            <div class="hint" id="cmListNote"></div>
          </div>
          <div class="cm-step">3 · Give it a face</div>
          <input id="cmLogo" class="set-input" type="text" placeholder="Logo — image https://…, a gif, or an emoji like ✨" autocomplete="off">
          <div class="logo-row">
            <label class="logo-pick" for="cmLogoFile">🖼️ Upload a logo picture (jpg / png / webp / gif)</label>
            <input id="cmLogoFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            <img id="cmLogoPrev" class="logo-prev" alt="" hidden>
            <button id="cmLogoClear" class="mini-btn" type="button" hidden>Remove picture</button>
          </div>
          <div class="cm-sec">
            <button id="cmSave" type="button">💾 Save model</button>
            <button id="cmClear" type="button">Clear form</button>
          </div>
          <div id="cmHint" class="hint">Pick the API, type a display name, pick the model code from the live list (one tap) and give it a logo. The address and the key of the API are already in the app — nothing else is asked. It saves into <b>Cloud storage</b>, so every browser gets the same model. A jpg / png picture is shrunk for you; a small animated <b>GIF</b> keeps moving as the logo.</div>
        </div>
      </details>
      <details class="cm-fold" id="cmFoldKeys">
        <summary><span>🔌 API providers &amp; their keys</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div id="provList" class="prov-list"></div>
          <div class="hint">All three keys are already in the app, so every model works the moment you add it. Save a different key here if you ever want to use your own — it is kept in your Cloudflare KV for every browser. A Worker secret with the same name wins over this box.</div>
        </div>
      </details>

      <details class="cm-fold" id="cmFoldInfo">
        <summary><span>ℹ️ How it works</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div class="hint">1 · Pick the API (0G, OpenRouter or Google), type a display name and the model's code name, add a logo, then press Save model — the address and the key are already in the app.<br>
          2 · The model appears in ⚡ Models right away and stays saved in your Cloudflare KV.<br>
          3 · Pictures you upload go straight to the model you selected — Gemini can also read PDFs.<br>
          4 · Delete any model with the Delete button — nothing in the code has to change.</div>
        </div>
      </details>
    </section>
    <section class="card">
      <h3>🔒 Security</h3>
      <div id="autoLockInfo" class="hint">Auto-lock: home screen after 30 idle minutes · the whole chat locks after 1 idle hour.</div>
    </section>
    <section class="card" id="connCard">
      <h3>🩺 Storage &amp; connection <small>everything that is saved lives here</small></h3>
      <div id="storeHead" class="store-head">
        <span id="storeDot" class="store-dot off"></span>
        <span id="storeWords">Checking the storage…</span>
      </div>
      <div id="connKv" class="conn-kv"></div>
      <div class="hint" id="storeWhat">Chats, usage counters, the keys you save and the AI models you add are all kept in <b>one Cloudflare KV namespace</b>, so they follow you into every browser.</div>
      <details class="cm-fold" id="kvFold">
        <summary><span>🔑 Check the storage</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div class="card-actions">
            <button id="kvTest" class="set-btn" type="button">Test KV storage</button>
            <button id="kvRefresh" class="set-btn ghost" type="button">Refresh status</button>
          </div>
          <div id="kvTestOut" class="kv-out"></div>
        </div>
      </details>
      <details class="cm-fold" id="kvLinkFold">
        <summary><span>🪄 Connect without a binding (API token)</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div class="hint">Use this when Cloudflare says the Worker has <b>no KV binding</b>, or when the binding points at a namespace you cannot see. Paste three things and press Connect — the app keeps them in this browser and sends them with every request, so chats, models and keys are saved in <b>your own KV namespace</b> without touching the Worker's settings.</div>
          <input id="kvAcc" class="set-input" type="text" inputmode="text" autocomplete="off" placeholder="Cloudflare account id (32 characters)">
          <input id="kvNs" class="set-input" type="text" inputmode="text" autocomplete="off" placeholder="KV namespace id (32 characters)">
          <input id="kvTok" class="set-input" type="password" autocomplete="off" placeholder="API token — Workers KV Storage: Edit">
          <div class="ws-actions">
            <button id="kvLinkSave" class="set-btn" type="button">Connect</button>
            <button id="kvLinkTest" class="set-btn ghost" type="button">Test link</button>
            <button id="kvLinkClear" class="set-btn ghost" type="button">Forget it</button>
          </div>
          <div id="kvLinkOut" class="kv-out"></div>
          <div class="hint">Where to find them:<br>
            · <b>account id</b> — Cloudflare dashboard, right-hand side of the account home (“Account ID”), or the URL of any zone in that account.<br>
            · <b>namespace id</b> — Workers &amp; Pages → <b>KV</b> → open the namespace → the id under its name (<code>06795ec62c844cc0a58bbf3873efc31d</code> for the one in your wrangler.jsonc).<br>
            · <b>token</b> — My Profile → API Tokens → Create Token → <i>Edit Cloudflare Workers</i>, or a custom token with the single permission <b>Account · Workers KV Storage · Edit</b>.</div>
          <div class="hint">A KV binding on the Worker always wins over this link — this is only a bridge for when there is none. If you prefer the binding, the block below is exactly what your <code>wrangler.jsonc</code> should carry.</div>
          <pre class="kv-block" id="kvJsonc">"kv_namespaces": [
  {
    "binding": "KV",
    "id": "06795ec62c844cc0a58bbf3873efc31d"
  }
]</pre>
          <div class="ws-actions">
            <button id="kvCopy" class="set-btn ghost" type="button">Copy the wrangler block</button>
          </div>
          <div class="hint">A <code>preview_id</code> line with the placeholder text <code>&lt;ID_OF_PREVIEW_KV_NAMESPACE_FOR_LOCAL_DEVELOPMENT&gt;</code> makes <code>wrangler dev</code> fail — delete that one line (as in the block above) or put a real second namespace id there.</div>
        </div>
      </details>
    </section>
      <div class="hint" hidden>App build <b>b98</b> · KV only · models follow every browser · 3 ready prompts after a file · crop editor with zoom · voice control never hidden · pure answers with a thinking panel · answers typed out line by line · 🔌 adding a model = pick the API (name only), name it, tap its code name from the live list · 🩺 the storage card says in plain words whether KV is connected · 🗑️ Delete removes a model on the first tap · 🖼️ an animated GIF works as a model logo · ⚙️ settings is a one-at-a-time list that scrolls · 🧠 a live “Thinking…” stream in a fixed window while the AI works · 🌀 three designs — the furry MindFusion word, the hive and the 8 bees is the brand home · ⚡ one panel in every design · 🌙 dark mode in the ⋮ menu · 🖼️ up to 8 pictures in one send · 🧠 the AI’s own live stream while it writes · 🖼️ drag the picture button · 👀 slide & crop every picture · 📌 hold a chat to pin it</div>
      <details class="cm-fold" id="cmFoldConn">
        <summary><span>🔑 API keys &amp; services</span><span class="caret">▾</span></summary>
        <div class="cm-bodied">
          <div id="connInfo"></div>
        </div>
      </details>
      <div class="card-actions">
        <select id="testModel" aria-label="Model to test" style="height:30px;border:1px solid var(--border);border-radius:9px;background:var(--solid);color:var(--text);font-size:11px;padding:0 6px;max-width:170px"></select>
        <button id="testBtn" type="button">Test connection</button>
      </div>
    </section>
  </div>
  <div class="signature">Made with <span class="heart">💖</span> by <b>Sujoy</b></div>
</aside>
<script>
"use strict";
const $ = id => document.getElementById(id);
const messagesEl = $("messages");
const input = $("input");
const sendBtn = $("send");
const uploadBtn = $("uploadBtn");
const micBtn = $("micBtn");
const voiceLangSel = $("voiceLang");
const fileInput = $("file");
const statusEl = $("status");
const documentChip = $("documentChip");
const documentName = $("documentName");
const clearDocumentBtn = $("clearDocument");
const attachMiniEl = $("attachMini");
const attachMiniThumb = $("attachMiniThumb");
const attachMiniIco = $("attachMiniIco");
const attachMiniName = $("attachMiniName");
const attachMiniX = $("attachMiniX");
const imgPreview = $("imgPreview");
const pvImg = $("pvImg");
const pvText = $("pvText");
const pvTitle = $("pvTitle");
const pvDownload = $("pvDownload");
const pvRemove = $("pvRemove");
let pvIsUploaded = false;
let pvMessage = null;
let pvSrc = "";
const pvClose = $("pvClose");
/* tap the small button for the big preview; the ✕ removes the file */
if (attachMiniEl) {
  attachMiniEl.addEventListener("click", () => {
    if (attachedImage && attachedImage.dataUrl) {
      openPreview(attachedImage.dataUrl, attachedImage.name || "picture.png", "image", true,
        "🖼️ " + (attachedImage.name || "Your upload"));
    } else if (documentText) {
      openPreview("", documentFileName || "file", "text", true,
        "📄 " + (documentFileName || "Your file") + (documentLangCode ? " · " + langName(documentLangCode) : "") + " — as Sarvam Vision read it");
    }
  });
}
if (attachMiniX) {
  attachMiniX.addEventListener("click", event => { event.stopPropagation(); removeAttachedFile(); });
}
if (pvClose) pvClose.addEventListener("click", closePreview);
if (pvRemove) pvRemove.addEventListener("click", removeAttachedFile);
if (imgPreview) {
  imgPreview.addEventListener("click", event => { if (event.target === imgPreview) closePreview(); });
}
let pvBlobUrl = "";
let pvIsAttachment = false;
/* the file shows as one small button; it disappears when the file is gone */
/* the round button only shows a picture — the name lives in the drop-up panel */
function attachMetaText() {
  const photo = attachedImage && attachedImage.dataUrl ? attachedImage : null;
  if (photo) {
    const kb = Math.max(1, Math.round(String(photo.dataUrl).length * 0.75 / 1024));
    return "picture · " + kb + " KB" + (photo.cropped ? " · cropped" : "");
  }
  const lang = documentLangCode ? langName(documentLangCode) : langName(answerLang);
  return (documentKind === "image" ? "picture" : "document") + " · " + lang;
}
function updateAttachMini() {
  if (!attachMiniEl) return;
  const photo = attachedImage && attachedImage.dataUrl ? attachedImage : null;
  const hasText = Boolean(documentText || photo);
  const wasShown = attachMiniEl.classList.contains("show");
  attachMiniEl.classList.toggle("show", hasText);
  const wrap = attachMiniEl.parentElement;
  if (wrap && wrap.classList.contains("attach-wrap")) wrap.classList.toggle("show", hasText);
  attachMiniEl.classList.add("no-name");
  if (hasText && !wasShown) {
    /* a star / diamond sparkle the moment a file lands */
    attachMiniEl.classList.remove("sparkle-run");
    void attachMiniEl.offsetWidth;
    attachMiniEl.classList.add("sparkle-run");
    setTimeout(() => attachMiniEl.classList.remove("sparkle-run"), 2400);
  }
  if (!hasText) {
    hideAttachPanel();
    return;
  }
  if (photo) {
    attachMiniThumb.src = photo.dataUrl;
    attachMiniThumb.hidden = false;
    attachMiniIco.hidden = true;
    attachMiniName.textContent = photo.name || "picture";
  } else {
    attachMiniThumb.hidden = true;
    attachMiniThumb.removeAttribute("src");
    attachMiniIco.hidden = false;
    attachMiniIco.textContent = documentKind === "image" ? "🖼️" : "📄";
    attachMiniName.textContent = documentFileName || "file";
  }
  const meta = $("attachMiniMeta");
  if (meta) meta.textContent = attachMetaText();
  const cropBtn = $("apCrop");
  if (cropBtn) cropBtn.hidden = !photo;    /* cropping only makes sense for a picture */
  attachMiniEl.title = "Your file — tap for its name, crop or remove";
}
function showAttachPanel(show) {
  const panel = $("attachPanel");
  if (!panel) return;
  panel.hidden = !show;
  panel.classList.toggle("ap-open", Boolean(show));
}
function hideAttachPanel() { showAttachPanel(false); }
function toggleAttachPanel() {
  const panel = $("attachPanel");
  if (!panel) return;
  showAttachPanel(panel.hidden);
}
/* shrinks (or grows) the attached picture right here in the browser */
/* =====================================================
   ✂️ CROP  (took the place of the older resize option)
   Works in three places, always the same sheet:
     • before the picture is attached at all
     • on the picture waiting in the file panel
     • on a picture that was already sent in a message
   ===================================================== */
let cropState = null;
const CROP_ASPECTS = { "free": 0, "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9, "9:16": 9 / 16 };
/* how big the picture is drawn inside the stage (1 = fits the stage width) */
function setCropZoom(zoom) {
  if (!cropState) return;
  if (Number(zoom) !== 1) cropState.autoZoom = false;   /* the user chose this zoom */
  const stage = $("cropStage"), frame = $("cropFrame"), val = $("cropZoomVal");
  cropState.zoom = Math.max(1, Math.min(4, Math.round((Number(zoom) || 1) * 100) / 100));
  if (stage && frame) {
    const pad = 20;
    const width = Math.max(80, Math.round((stage.clientWidth || 320) - pad) * cropState.zoom);
    frame.style.width = width + "px";
  }
  if (val) val.textContent = Math.round(cropState.zoom * 100) + "%";
  paintCropRect();
}
function spinCropZoom(step) {
  if (!cropState) return;
  setCropZoom((cropState.zoom || 1) + step);
}
function cropEls() {
  return {
    sheet: $("cropSheet"), frame: $("cropFrame"), img: $("cropImg"), stage: $("cropStage"),
    rect: $("cropRect"), info: $("cropInfo"), skip: $("cropSkip"),
    apply: $("cropApply"), cancel: $("cropCancel"), close: $("cropClose")
  };
}
function cropClamp(rect) {
  const min = 0.04;
  let w = Math.max(min, Math.min(1, rect.w));
  let h = Math.max(min, Math.min(1, rect.h));
  let x = Math.max(0, Math.min(1 - w, rect.x));
  let y = Math.max(0, Math.min(1 - h, rect.y));
  return { x: x, y: y, w: w, h: h };
}
function paintCropRect() {
  if (!cropState) return;
  const el = cropEls();
  const pct = v => (v * 100).toFixed(3) + "%";
  if (el.rect) {
    el.rect.style.left = pct(cropState.rect.x);
    el.rect.style.top = pct(cropState.rect.y);
    el.rect.style.width = pct(cropState.rect.w);
    el.rect.style.height = pct(cropState.rect.h);
  }
  if (el.info) {
    const nat = cropState.natural || [0, 0];
    const cw = Math.round(cropState.rect.w * nat[0]);
    const ch = Math.round(cropState.rect.h * nat[1]);
    el.info.textContent = "Crop area " + cw + " × " + ch + " px" +
      (nat[0] ? " (picture " + nat[0] + " × " + nat[1] + ")" : "") +
      (cropState.aspect && cropState.aspect !== "free" ? " · shape " + cropState.aspect : "");
  }
}
function openCrop(options) {
  const el = cropEls();
  if (!el.sheet) return;
  cropState = {
    src: options.src, name: options.name || "picture.png", mime: options.mime || "image/png",
    mode: options.mode || "attach", message: options.message || null, file: options.file || null,
    allowSkip: Boolean(options.allowSkip), aspect: "free", natural: [0, 0], zoom: 1, autoZoom: true,
    rect: { x: 0, y: 0, w: 1, h: 1 }, drag: null
  };
  el.img.onload = function () {
    if (!cropState) return;
    cropState.natural = [el.img.naturalWidth || el.img.width || 0, el.img.naturalHeight || el.img.height || 0];
    /* a tall screenshot (a phone screen, a long page) is drawn bigger from the
       start, so its text can actually be read while cropping */
    const nat = cropState.natural;
    if (cropState.autoZoom && nat[0] && nat[1] && nat[1] / nat[0] > 1.6) setCropZoom(1.6);
    paintCropRect();
  };
  el.img.src = cropState.src;
  if (el.skip) el.skip.hidden = !cropState.allowSkip;
  if (el.apply) el.apply.textContent = cropState.allowSkip ? "✂️ Crop & attach" : "✂️ Save crop";
  document.querySelectorAll("#cropTools [data-aspect]").forEach(b => b.classList.toggle("on", b.dataset.aspect === "free"));
  el.sheet.hidden = false;
  el.sheet.classList.add("show");
  /* fitted first, then (once the size is known) a tall picture zooms itself */
  setCropZoom(1);
  paintCropRect();
}
function closeCrop() {
  const el = cropEls();
  if (el.sheet) { el.sheet.hidden = true; el.sheet.classList.remove("show"); }
  cropState = null;
}
function setCropAspect(name) {
  if (!cropState) return;
  cropState.aspect = name;
  document.querySelectorAll("#cropTools [data-aspect]").forEach(b => b.classList.toggle("on", b.dataset.aspect === name));
  const ratio = CROP_ASPECTS[name];
  if (ratio) {
    const nat = cropState.natural;
    const imgRatio = nat[1] ? nat[0] / nat[1] : 1;
    let w = 0.86;
    let h = (w * imgRatio) / ratio;
    if (h > 0.86) { h = 0.86; w = (h * ratio) / imgRatio; }
    cropState.rect = cropClamp({ x: (1 - w) / 2, y: (1 - h) / 2, w: w, h: h });
  }
  paintCropRect();
}
function cropBox() {
  const el = cropEls();
  const box = el.frame ? el.frame.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
  return { left: box.left || 0, top: box.top || 0, width: box.width || 1, height: box.height || 1 };
}
function cropPoint(clientX, clientY) {
  const box = cropBox();
  return {
    x: Math.max(0, Math.min(1, (clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (clientY - box.top) / box.height))
  };
}
function cropDragStart(kind, point, handle) {
  if (!cropState) return;
  cropState.drag = { kind: kind, handle: handle || "", start: point, rect: Object.assign({}, cropState.rect) };
}
function cropDragMove(point) {
  const drag = cropState && cropState.drag;
  if (!drag) return;
  const r = drag.rect;
  if (drag.kind === "move") {
    cropState.rect = cropClamp({ x: r.x + (point.x - drag.start.x), y: r.y + (point.y - drag.start.y), w: r.w, h: r.h });
  } else if (drag.kind === "new") {
    cropState.rect = cropClamp({
      x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y),
      w: Math.abs(point.x - drag.start.x), h: Math.abs(point.y - drag.start.y)
    });
  } else {
    let left = r.x, top = r.y, right = r.x + r.w, bottom = r.y + r.h;
    if (drag.handle.indexOf("w") >= 0) left = point.x;
    if (drag.handle.indexOf("e") >= 0) right = point.x;
    if (drag.handle.indexOf("n") >= 0) top = point.y;
    if (drag.handle.indexOf("s") >= 0) bottom = point.y;
    cropState.rect = cropClamp({
      x: Math.min(left, right), y: Math.min(top, bottom),
      w: Math.abs(right - left), h: Math.abs(bottom - top)
    });
  }
  paintCropRect();
}
function cropDragEnd() { if (cropState) cropState.drag = null; }
/* draws only the chosen part of the picture into a new picture */
function cropDataUrl(dataUrl, rect, mime) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("That picture could not be cropped."));
    img.onload = () => {
      const nw = img.naturalWidth || img.width || 0;
      const nh = img.naturalHeight || img.height || 0;
      if (!nw || !nh) { reject(new Error("That picture could not be read.")); return; }
      const x = Math.max(0, Math.round(rect.x * nw));
      const y = Math.max(0, Math.round(rect.y * nh));
      const w = Math.max(8, Math.min(nw - x, Math.round(rect.w * nw)));
      const h = Math.max(8, Math.min(nh - y, Math.round(rect.h * nh)));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      let out = "";
      const type = /png/i.test(mime || "") ? "image/png" : "image/jpeg";
      try { out = canvas.toDataURL(type, 0.92); } catch (e) { out = ""; }
      if (!out || out.length < 20) { try { out = canvas.toDataURL("image/jpeg", 0.9); } catch (e) { out = ""; } }
      if (!out || out.length < 20) { reject(new Error("Could not crop that picture.")); return; }
      resolve({ dataUrl: out, width: w, height: h });
    };
    img.src = dataUrl;
  });
}
/* puts a new picture into a message that is already in the chat */
function setMessagePicture(message, dataUrl) {
  if (!message) return;
  if (message.attachment) {
    thumbs[message.attachment.id] = dataUrl;
    message.attachment.cropped = true;
    delete message.attachment.scaled;
  }
  if (message.img && message.img.id) genImages[message.img.id] = dataUrl;
  renderMessages();
  saveHistory();
}
function openCropForAttached() {
  const photo = attachedImage && attachedImage.dataUrl ? attachedImage : null;
  if (!photo) return;
  hideAttachPanel();
  openCrop({ src: photo.dataUrl, name: photo.name || "picture.png", mime: photo.mime || "image/png", mode: "attach" });
}
function openCropForPreview() {
  const src = pvSrc || (attachedImage && attachedImage.dataUrl) || "";
  if (!src) return;
  const fromMessage = pvMessage && (pvMessage.attachment || pvMessage.img);
  closePreview();
  openCrop({
    src: src,
    name: (pvMessage && pvMessage.attachment && pvMessage.attachment.name) || (attachedImage && attachedImage.name) || "picture.png",
    mime: (attachedImage && attachedImage.mime) || "image/png",
    mode: fromMessage ? "message" : "attach",
    message: fromMessage ? pvMessage : null
  });
}
/* a chosen picture is offered for cropping BEFORE it is attached */
function proposeCropBeforeAttach(file) {
  fileToDataUrl(file).then(dataUrl => {
    openCrop({
      src: dataUrl, name: file.name, mime: file.type || "image/png",
      mode: "attach", file: file, allowSkip: true
    });
    setStatus("✂️ Crop it now, or press \u201CUse without crop\u201D.");
  }).catch(() => attachFileDirectly(file));
}
async function applyCrop() {
  const state = cropState;
  if (!state) return;
  let note = "";
  const els = cropEls();
  if (els.apply) els.apply.disabled = true;
  try {
    const out = await cropDataUrl(state.src, state.rect, state.mime);
    closeCrop();
    if (state.mode === "gallery" && typeof window.mfGalleryApply === "function") {
      /* a picture inside the slide-out viewer: the crop replaces that one */
      window.mfGalleryApply(out.dataUrl);
      note = "\u2702\uFE0F Cropped to " + out.width + " × " + out.height + " px.";
    } else if (state.mode === "message" && state.message) {
      setMessagePicture(state.message, out.dataUrl);
      note = "\u2702\uFE0F Picture cropped to " + out.width + " × " + out.height + " px.";
    } else if (state.file) {
      attachFileDataUrl(out.dataUrl, state.name, state.mime);
      note = "\u2702\uFE0F Cropped to " + out.width + " × " + out.height + " px — press Send when you are ready.";
    } else {
      attachedImage = { name: state.name, mime: state.mime, dataUrl: out.dataUrl };
      documentThumb = out.dataUrl;
      updateAttachMini();
      note = "\u2702\uFE0F Attached picture cropped to " + out.width + " × " + out.height + " px.";
    }
    /* the note stays until it expires - it must never wipe a newer message */
    setStatus(note);
    setTimeout(() => { if (statusEl.textContent === note) setStatus(""); }, 4500);
  } catch (error) {
    closeCrop();
    const bad = "⚠️ " + (error.message || "Could not crop that picture.");
    setStatus(bad);
    setTimeout(() => { if (statusEl.textContent === bad) setStatus(""); }, 4000);
  }
}
function setupCropSheet() {
  const el = cropEls();
  if (!el.sheet) return;
  const start = (kind, handle) => point => cropDragStart(kind, point, handle);
  if (el.rect) {
    el.rect.addEventListener("mousedown", event => {
      const handle = event.target.classList && event.target.classList.contains("crop-h") ? event.target.dataset.h : "";
      event.preventDefault();
      start(handle ? "size" : "move", handle)(cropPoint(event.clientX, event.clientY));
    });
    el.rect.addEventListener("touchstart", event => {
      const t = event.touches && event.touches[0];
      if (!t) return;
      const handle = event.target.classList && event.target.classList.contains("crop-h") ? event.target.dataset.h : "";
      cropDragStart(handle ? "size" : "move", cropPoint(t.clientX, t.clientY), handle);
    }, { passive: true });
  }
  if (el.frame) {
    el.frame.addEventListener("mousedown", event => {
      if (event.target === el.rect || (event.target.classList && event.target.classList.contains("crop-h"))) return;
      event.preventDefault();
      start("new", "")(cropPoint(event.clientX, event.clientY));
    });
  }
  document.addEventListener("mousemove", event => cropDragMove(cropPoint(event.clientX, event.clientY)));
  document.addEventListener("mouseup", cropDragEnd);
  document.addEventListener("touchmove", event => {
    const t = event.touches && event.touches[0];
    if (t) cropDragMove(cropPoint(t.clientX, t.clientY));
  }, { passive: true });
  document.addEventListener("touchend", cropDragEnd);
  document.addEventListener("keydown", event => {
    if (!cropState) return;
    if (event.key === "Escape") { closeCrop(); return; }
    if (event.key === "+" || event.key === "=") { spinCropZoom(0.25); return; }
    if (event.key === "-" || event.key === "_") { spinCropZoom(-0.25); return; }
    if (event.key === "Enter") applyCrop();
  });
  const zin = $("cropZoomIn"), zout = $("cropZoomOut"), zfit = $("cropZoomFit");
  if (zin) zin.addEventListener("click", () => spinCropZoom(0.25));
  if (zout) zout.addEventListener("click", () => spinCropZoom(-0.25));
  if (zfit) zfit.addEventListener("click", () => {
    setCropZoom(1);
    const stage = $("cropStage");
    if (stage) { stage.scrollTop = 0; stage.scrollLeft = 0; }
  });
  window.addEventListener("resize", () => { if (cropState) setCropZoom(cropState.zoom || 1); });
  document.querySelectorAll("#cropTools [data-aspect]").forEach(btn => {
    btn.addEventListener("click", () => setCropAspect(btn.dataset.aspect));
  });
  const reset = $("cropReset");
  if (reset) reset.addEventListener("click", () => {
    if (!cropState) return;
    cropState.rect = { x: 0, y: 0, w: 1, h: 1 };
    cropState.aspect = "free";
    document.querySelectorAll("#cropTools [data-aspect]").forEach(b => b.classList.toggle("on", b.dataset.aspect === "free"));
    paintCropRect();
  });
  const giveUp = () => { closeCrop(); fileInput.value = ""; };
  if (el.cancel) el.cancel.addEventListener("click", giveUp);
  if (el.close) el.close.addEventListener("click", giveUp);
  if (el.skip) el.skip.addEventListener("click", () => {
    const state = cropState;
    closeCrop();
    if (state && state.file) attachFileDirectly(state.file);
  });
  if (el.apply) el.apply.addEventListener("click", () => { applyCrop(); });
}
function setupAttachPanel() {
  if (!attachMiniEl) return;
  attachMiniEl.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleAttachPanel();
  });
  const view = $("apView"), remove = $("apRemove");
  if (view) view.addEventListener("click", () => {
    hideAttachPanel();
    const photo = attachedImage && attachedImage.dataUrl ? attachedImage : null;
    if (photo) openPreview(photo.dataUrl, photo.name || "picture.png", "image", true, "🖼️ " + (photo.name || "Your upload"), true);
    else openPreview("", documentFileName || "file", "text", true, "📄 " + (documentFileName || "Your file"), false);
  });
  if (remove) remove.addEventListener("click", () => { hideAttachPanel(); removeAttachedFile(); });
  const cropBtn = $("apCrop");
  if (cropBtn) cropBtn.addEventListener("click", () => openCropForAttached());
}
/* one big preview for any picture — uploaded or created here */
function openPreview(src, fileName, kind, canRemove, title, canCrop) {
  if (!imgPreview) return;
  const isImage = kind === "image" && Boolean(src);
  pvIsAttachment = Boolean(canRemove);
  pvIsUploaded = Boolean(canCrop) && isImage;
  pvSrc = isImage ? src : "";
  pvMessage = canCrop && canCrop.message ? canCrop.message : null;
  if (pvBlobUrl) { try { URL.revokeObjectURL(pvBlobUrl); } catch (e) {} pvBlobUrl = ""; }
  pvImg.style.display = isImage ? "" : "none";
  pvText.style.display = isImage ? "none" : "";
  if (isImage) {
    pvImg.src = src;
    pvDownload.href = src;
    pvDownload.download = fileName || "picture.png";
  } else {
    pvText.textContent = (documentText || "").slice(0, 20000) || "No text to show.";
    pvBlobUrl = URL.createObjectURL(new Blob([pvText.textContent], { type: "text/plain;charset=utf-8" }));
    pvDownload.href = pvBlobUrl;
    pvDownload.download = (fileName || "reading") + ".txt";
  }
  pvTitle.textContent = title || "Your file";
  pvRemove.hidden = !canRemove;
  const cr = $("pvCrop");
  if (cr) cr.hidden = !pvIsUploaded;
  imgPreview.classList.add("show");
}
function setupPreviewCrop() {
  const btn = $("pvCrop");
  if (!btn) return;
  btn.addEventListener("click", () => openCropForPreview());
}
function closePreview() {
  if (!imgPreview) return;
  imgPreview.classList.remove("show");
  pvImg.removeAttribute("src");
}
function removeAttachedFile() {
  closePreview();
  resetDocument();          /* this also hides the small button */
  fileInput.value = "";
  setStatusFor("File removed.", 1300);
}
const suggestEl = $("suggest");
const historyBtn = $("historyBtn");
const historyList = $("historyList");
const drawer = $("drawer");
const overlay = $("overlay");
const closeBtn = $("close");
const newTop = $("newTop");
const webSide = $("webSide");
const themeBtn = $("theme");
const dock = $("dock");
const settingsBtn = $("settingsBtn");
const settingsPanel = $("settings");
const closeSettingsBtn = $("closeSettings");
const sarvamUsageEl = $("sarvamUsage");
const usageHintEl = $("usageHint");
const cfUsageEl = $("cfUsage");
const connInfoEl = $("connInfo");
const loadCfBtn = $("loadCf");
const testBtn = $("testBtn");
const testModelSel = $("testModel");
const resetUsageBtn = $("resetUsage");
/* AI models manager (Settings) */
const cmNameEl = $("cmName");
const cmIdEl = $("cmId");
const cmProvEl = $("cmProv"), cmProvNoteEl = $("cmProvNote");
const provListEl = $("provList");
let cmProvider = "", providerTable = [];
const cmLogoEl = $("cmLogo");
const cmCountEl = $("cmCount");
const cmSaveBtn = $("cmSave");
const cmClearBtn = $("cmClear");
const cmHintEl = $("cmHint");
const customHintEl = cmHintEl;
/* appearance (colour theme + layout) */
const paletteRow = $("paletteRow");
const viewRow = $("viewRow");
const viewHint = $("viewHint");
/* models drop-up, reply-language drop-up + strips */
const modelWrap = $("modelWrap");
const modelBtn = $("modelBtn");
const modelMenu = $("modelMenu");
const modelCount = $("modelCount");
let modelItems = Array.from(document.querySelectorAll("#modelMenu .model-item"));
const replyWrap = $("replyWrap");
const replyBtn = $("replyBtn");
const replyMenu = $("replyMenu");
const replyCur = $("replyCur");
const replyItems = Array.from(document.querySelectorAll("#replyMenu .model-item"));
const stripMayura = $("stripMayura");
const stripVision = $("stripVision");
const stripImage = $("stripImage");
const trFromSel = $("trFrom");
const trToSel = $("trTo");
const trBtn = $("trBtn");
const visLangSel = $("visLang");
const imgSizeSel = $("imgSize");
const imgBtn = $("imgBtn");
/* upload dialog */
const dialogBg = $("fileDialog");
const dlgTitle = $("dlgTitle");
const dlgFrom = $("dlgFrom");
const dlgTo = $("dlgTo");
const dlgNote = $("dlgNote");
const dlgActions = $("dlgActions");
const dlgStart = $("dlgStart");
const dlgCancel = $("dlgCancel");
const HISTORY_KEY = "sarvam_ai_history_v6";
const LANG_KEY = "sarvam_ai_reply_lang_v2";
const USAGE_KEY = "sarvam_ai_usage_v1";
const VOICE_KEY = "sarvam_ai_voice_lang_v1";
const PREF_KEY = "sarvam_ai_prefs_v1";
const ADMIN_KEY = "sarvam_admin";
const DIRTY_KEY = "sarvam_ai_dirty_v1";
const SYNCED_KEY = "sarvam_ai_synced_v1";
const PALETTE_KEY = "sarvam_ai_palette_v1";
const DEFAULT_MOVED_KEY = "mf_default_design_v2";   /* the once-only switch to Loop Glow */
const VIEW_KEY = "sarvam_ai_view_v1";
const LANG_NAMES = ${langNames};
const DOC_LANGS = ${docLangs};
const MAYURA_SET = ${mayuraList};
let CHAT_MODEL_LIST = ${JSON.stringify(Object.keys(CHAT_MODELS).map(k => ({ key: k, label: CHAT_MODELS[k].label })))};
const BASE_CHAT_LIST = CHAT_MODEL_LIST.slice();
const IMAGE_LABEL = ${JSON.stringify(IMAGE_MODEL.label)};
const IMG_SIZES = ${JSON.stringify(IMAGE_SIZES)};
const MAX_IMAGE_PROMPT = ${MAX_IMAGE_PROMPT};
const REPLY_LANGS = ["en-IN", "bn-IN", "hi-IN"];
const REPLY_SHORT = { "en-IN": "English", "bn-IN": "বাংলা", "hi-IN": "हिन्दी" };
const OUT_LANGS = [
  ["en-IN", "English"],
  ["bn-IN", "Bengali — বাংলা"],
  ["hi-IN", "Hindi — हिन्दी"]
];
const IMG_SIZE_LABELS = {
  "1024x1024": "Square · 1024×1024",
  "768x1024": "Portrait · 768×1024",
  "1024x768": "Landscape · 1024×768"
};
/* colour themes (the CSS for each one is in the <style> block) */
const PALETTES = [
  { key: "loop",    name: "Loop Glow (default)",     label: "Loop",    c: ["#0A66FF", "#FF5FA2", "#12BFA6"], meta: "#0A66FF" },
  { key: "pixel",   name: "Pixel Meadow",            label: "Pixel",   c: ["#E8742C", "#F7CE6B", "#2f9e44"], meta: "#F2A93B" },
  { key: "royal",   name: "Royal Saffron",           label: "Saffron", c: ["#C9432E", "#F2A93B", "#2BA6A0"], meta: "#E8742C" }
];
const VIEW_HINTS = {
  auto: "Auto: the layout follows your screen. Phone layout on narrow screens, full-width layout on computers.",
  mobile: "Mobile: the phone layout is always used, even on a computer (narrow centred column).",
  web: "Web: the computer layout is always used, even on a phone."
};
/* all model names (chat models come from the server list) */let CHAT_KEYS = CHAT_MODEL_LIST.map(m => m.key);
const MODEL_NAMES = { mayura: "Sarvam Mayura", vision: "Sarvam Vision", image: IMAGE_LABEL };
CHAT_MODEL_LIST.forEach(m => { MODEL_NAMES[m.key] = m.label; });
let chats = [];
let currentChat = null;
let documentText = "";
let documentFileName = "";
let documentLangCode = "";
let documentKind = "doc";
let documentThumb = null;     /* browser-only preview URL of an uploaded image */
let documentSent = false;     /* has the file already been attached to a message? */
let docMsgIndex = -1;         /* index of the message that carries the file */
let answerLang = "bn-IN";
let suggestOn = false;
let busy = false;
let adminPassword = "";
let pendingFile = null;
let serverUsage = null;       /* filled when cloud storage (KV) is connected */
/* appearance state — the Loop Glow design is the default */
let paletteKey = "loop";
let viewMode = "auto";        /* auto | mobile | web */
/* thumbnails of attached images + generated pictures (session only, not saved) */
const thumbs = {};
const genImages = {};
/* which models are switched on (only ONE chat model can be on) */
const models = {
  sarvam: false, qwen: false, gemini: false, glm: false, deepseek: false,
  mayura: false, vision: false, image: false
};
let trFrom = "auto";
let trTo = "bn-IN";
let visLang = "auto";
let imgSize = "1024x1024";
function activeChat() {
  for (let i = 0; i < CHAT_KEYS.length; i++) {
    if (models[CHAT_KEYS[i]]) return CHAT_KEYS[i];
  }
  return "";
}
function hasChat() {
  return activeChat() !== "";
}
/* voice input state */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let voiceLang = "bn-IN";
try { adminPassword = localStorage.getItem(ADMIN_KEY) || ""; } catch {}
/* =====================================================
   APPEARANCE  —  colour theme + screen layout
   ===================================================== */
function computeLayout() {
  if (viewMode === "mobile") return "mobile";
  if (viewMode === "web") return "web";
  return window.innerWidth <= 760 ? "mobile" : "web";
}
function updateViewport() {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const small = Math.min(screen.width, screen.height) <= 820;
  const wanted = (viewMode === "web" && small)
    ? "width=1100"
    : "width=device-width, initial-scale=1.0, minimum-scale=1.0";
  if (meta.getAttribute("content") !== wanted) meta.setAttribute("content", wanted);
}
function applyLayout() {
  const root = document.documentElement;
  const layout = computeLayout();
  if (root.getAttribute("data-view") !== viewMode) root.setAttribute("data-view", viewMode);
  if (root.getAttribute("data-layout") !== layout) root.setAttribute("data-layout", layout);
  syncDock();
}
function renderViewButtons() {
  Array.from(viewRow.querySelectorAll("button")).forEach(b => {
    b.classList.toggle("active", b.dataset.view === viewMode);
  });
  viewHint.textContent = VIEW_HINTS[viewMode] || "";
}
function setView(mode, quiet) {
  if (["auto", "mobile", "web"].indexOf(mode) < 0) return;
  viewMode = mode;
  try { localStorage.setItem(VIEW_KEY, mode); } catch {}
  updateViewport();
  applyLayout();
  renderViewButtons();
  if (!quiet) {
    const names = { auto: "Auto", mobile: "Mobile view", web: "Web view" };
    setStatus("Layout: " + names[mode] + " ✓");
    setTimeout(() => setStatus(""), 1500);
  }
}
function renderPalettes() {
  paletteRow.innerHTML = "";
  const mk = function (p) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "model-item pal-item";
    b.dataset.palette = p.key;
    const dot = document.createElement("i");
    dot.className = "pal-dot";
    dot.style.background = "linear-gradient(135deg," +
      p.c[0] + " 0%," + p.c[0] + " 36%," +
      p.c[1] + " 36%," + p.c[1] + " 68%," +
      p.c[2] + " 68%," + p.c[2] + " 100%)";
    const t = document.createElement("span");
    t.className = "model-txt";
    const bb = document.createElement("b");
    bb.textContent = p.name;
    t.appendChild(bb);
    const tick = document.createElement("span");
    tick.className = "pal-check";
    tick.textContent = "✓";
    b.appendChild(dot);
    b.appendChild(t);
    b.appendChild(tick);
    b.addEventListener("click", function () {
      setPalette(p.key);
      paletteRow.classList.remove("show");
    });
    return b;
  };
  /* one plain list — no group headings and no dashed line between them */
  PALETTES.forEach(p => paletteRow.appendChild(mk(p)));
  markPalette();
}
function markPalette() {
  Array.from(paletteRow.querySelectorAll(".pal-item")).forEach(b => {
    b.classList.toggle("active", b.dataset.palette === paletteKey);
  });
  const cur = document.getElementById("palCur");
  const p = PALETTES.find(item => item.key === paletteKey);
  if (cur && p) cur.textContent = p.name;
}
function setPalette(key, quiet) {
  const p = PALETTES.find(item => item.key === key);
  if (!p) return;
  paletteKey = key;
  document.documentElement.setAttribute("data-palette", key);
  try { localStorage.setItem(PALETTE_KEY, key); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", p.meta);
  markPalette();
  fxRefreshColors();
  if (!quiet) {
    setStatus("UI design: " + p.name + " ✓");
    setTimeout(() => setStatus(""), 1500);
  }
}
function initAppearance() {
  try {
    const p = localStorage.getItem(PALETTE_KEY);
    if (PALETTES.some(item => item.key === p)) paletteKey = p;
    /* the new design is the default now: a browser that is still on the old
       default (Pixel Meadow) moves once — a design chosen on purpose (Royal
       Saffron, or Pixel picked again later) is always kept */
    if (!localStorage.getItem(DEFAULT_MOVED_KEY)) {
      if (!p || p === "pixel") {
        paletteKey = "loop";
        localStorage.setItem(PALETTE_KEY, "loop");
      }
      localStorage.setItem(DEFAULT_MOVED_KEY, "1");
    }
    const v = localStorage.getItem(VIEW_KEY);
    if (["auto", "mobile", "web"].indexOf(v) >= 0) viewMode = v;
  } catch {}
  renderPalettes();
  setPalette(paletteKey, true);
  Array.from(viewRow.querySelectorAll("button")).forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
  const palBtnEl = document.getElementById("palBtn");
  if (palBtnEl) {
    palBtnEl.addEventListener("click", function (e) {
      e.stopPropagation();
      closeMenus();
      paletteRow.classList.toggle("show");
    });
    document.addEventListener("click", function (e) {
      if (!paletteRow.contains(e.target) && !palBtnEl.contains(e.target)) {
        paletteRow.classList.remove("show");
      }
    });
  }
  updateViewport();
  applyLayout();
  renderViewButtons();
  /* in Auto mode the layout follows the window size live */
  window.addEventListener("resize", () => {
    if (viewMode === "auto") applyLayout();
  });
}
/* =====================================================
   SUGGESTED PROMPTS (shown after a file is read)
   Tapping one only fills the chat box — it is NOT sent.
   ===================================================== */

const SUGGEST_UI = {
  "en-IN": {btn: "💡 Suggested questions",
    image: ["Summarize this image.", "What is written in this image? Which language is it in?", "Explain the important points in simple words."],
    doc: ["Summarize this document.", "What is written in this document? Which language is it in?", "Explain the important points in simple words."]},
  "bn-IN": {btn: "💡 প্রস্তাবিত প্রশ্ন",
    image: ["এই ছবিটির সারসংক্ষেপ দাও।", "এই ছবিতে কী লেখা আছে? কোন ভাষায় লেখা?", "গুরুত্বপূর্ণ বিষয়গুলো সহজ ভাষায় বুঝিয়ে দাও।"],
    doc: ["এই নথিটির সারসংক্ষেপ দাও।", "এই নথিতে কী লেখা আছে? কোন ভাষায় লেখা?", "গুরুত্বপূর্ণ বিষয়গুলো সহজ ভাষায় বুঝিয়ে দাও।"]},
  "hi-IN": {btn: "💡 सुझाए गए सवाल",
    image: ["इस तस्वीर का सारांश बताइए।", "इस तस्वीर में क्या लिखा है? किस भाषा में है?", "मुख्य बातें आसान भाषा में समझाइए।"],
    doc: ["इस दस्तावेज़ का सारांश बताइए।", "इस दस्तावेज़ में क्या लिखा है? किस भाषा में है?", "मुख्य बातें आसान भाषा में समझाइए।"]},
  "te-IN": {btn: "💡 సూచించిన ప్రశ్నలు",
    image: ["ఈ చిత్రాన్ని సంక్షిప్తంగా చెప్పండి.", "ఈ చిత్రంలో ఏమి రాసి ఉంది? ఏ భాషలో ఉంది?", "ముఖ్యమైన అంశాలను సులభంగా వివరించండి."],
    doc: ["ఈ పత్రాన్ని సంక్షిప్తంగా చెప్పండి.", "ఈ పత్రంలో ఏమి రాసి ఉంది? ఏ భాషలో ఉంది?", "ముఖ్యమైన అంశాలను సులభంగా వివరించండి."]},
  "ta-IN": {btn: "💡 பரிந்துரைக்கப்பட்ட கேள்விகள்",
    image: ["இந்தப் படத்தைச் சுருக்கமாகச் சொல்லுங்கள்.", "இந்தப் படத்தில் என்ன எழுதியிருக்கிறது? எந்த மொழியில்?", "முக்கியமான விஷயங்களை எளிமையாக விளக்குங்கள்."],
    doc: ["இந்த ஆவணத்தைச் சுருக்கமாகச் சொல்லுங்கள்.", "இந்த ஆவணத்தில் என்ன எழுதியிருக்கிறது? எந்த மொழியில்?", "முக்கியமான விஷயங்களை எளிமையாக விளக்குங்கள்."]},
  "mr-IN": {btn: "💡 सुचवलेले प्रश्न",
    image: ["या चित्राचा सारांश सांगा.", "या चित्रात काय लिहिले आहे? कोणत्या भाषेत आहे?", "महत्त्वाचे मुद्दे सोप्या भाषेत समजावून सांगा."],
    doc: ["या दस्तऐवजाचा सारांश सांगा.", "या दस्तऐवजात काय लिहिले आहे? कोणत्या भाषेत आहे?", "महत्त्वाचे मुद्दे सोप्या भाषेत समजावून सांगा."]},
  "gu-IN": {btn: "💡 સૂચવેલા પ્રશ્નો",
    image: ["આ ચિત્રનો સારાંશ આપો.", "આ ચિત્રમાં શું લખેલું છે? કઈ ભાષામાં છે?", "મહત્વના મુદ્દા સરળ ભાષામાં સમજાવો."],
    doc: ["આ દસ્તાવેજનો સારાંશ આપો.", "આ દસ્તાવેજમાં શું લખેલું છે? કઈ ભાષામાં છે?", "મહત્વના મુદ્દા સરળ ભાષામાં સમજાવો."]},
  "kn-IN": {btn: "💡 ಸೂಚಿಸಿದ ಪ್ರಶ್ನೆಗಳು",
    image: ["ಈ ಚಿತ್ರದ ಸಾರಾಂಶ ಹೇಳಿ.", "ಈ ಚಿತ್ರದಲ್ಲಿ ಏನು ಬರೆದಿದೆ? ಯಾವ ಭಾಷೆಯಲ್ಲಿ?", "ಮುಖ್ಯ ಅಂಶಗಳನ್ನು ಸುಲಭವಾಗಿ ವಿವರಿಸಿ."],
    doc: ["ಈ ದಾಖಲೆಯ ಸಾರಾಂಶ ಹೇಳಿ.", "ಈ ದಾಖಲೆಯಲ್ಲಿ ಏನು ಬರೆದಿದೆ? ಯಾವ ಭಾಷೆಯಲ್ಲಿ?", "ಮುಖ್ಯ ಅಂಶಗಳನ್ನು ಸುಲಭವಾಗಿ ವಿವರಿಸಿ."]},
  "ml-IN": {btn: "💡 നിർദ്ദേശിച്ച ചോദ്യങ്ങൾ",
    image: ["ഈ ചിത്രത്തിന്റെ സാരാംശം പറയൂ.", "ഈ ചിത്രത്തിൽ എന്താണ് എഴുതിയിരിക്കുന്നത്? ഏത് ഭാഷയിലാണ്?", "പ്രധാന കാര്യങ്ങൾ ലളിതമായി വിശദീകരിക്കൂ."],
    doc: ["ഈ രേഖയുടെ സാരാംശം പറയൂ.", "ഈ രേഖയിൽ എന്താണ് എഴുതിയിരിക്കുന്നത്? ഏത് ഭാഷയിലാണ്?", "പ്രധാന കാര്യങ്ങൾ ലളിതമായി വിശദീകരിക്കൂ."]},
  "pa-IN": {btn: "💡 ਸੁਝਾਏ ਸਵਾਲ",
    image: ["ਇਸ ਤਸਵੀਰ ਦਾ ਸਾਰ ਦੱਸੋ।", "ਇਸ ਤਸਵੀਰ ਵਿੱਚ ਕੀ ਲਿਖਿਆ ਹੈ? ਕਿਹੜੀ ਭਾਸ਼ਾ ਵਿੱਚ ਹੈ?", "ਮੁੱਖ ਗੱਲਾਂ ਸੌਖੀ ਭਾਸ਼ਾ ਵਿੱਚ ਸਮਝਾਓ।"],
    doc: ["ਇਸ ਦਸਤਾਵੇਜ਼ ਦਾ ਸਾਰ ਦੱਸੋ।", "ਇਸ ਦਸਤਾਵੇਜ਼ ਵਿੱਚ ਕੀ ਲਿਖਿਆ ਹੈ? ਕਿਹੜੀ ਭਾਸ਼ਾ ਵਿੱਚ ਹੈ?", "ਮੁੱਖ ਗੱਲਾਂ ਸੌਖੀ ਭਾਸ਼ਾ ਵਿੱਚ ਸਮਝਾਓ।"]},
  "od-IN": {btn: "💡 ପ୍ରସ୍ତାବିତ ପ୍ରଶ୍ନ",
    image: ["ଏହି ଚିତ୍ରର ସାରାଂଶ କୁହନ୍ତୁ।", "ଏହି ଚିତ୍ରରେ କଣ ଲେଖା ଅଛି? କେଉଁ ଭାଷାରେ?", "ମୁଖ୍ୟ ବିଷୟଗୁଡ଼ିକ ସରଳ ଭାଷାରେ ବୁଝାନ୍ତୁ।"],
    doc: ["ଏହି ଦଲିଲର ସାରାଂଶ କୁହନ୍ତୁ।", "ଏହି ଦଲିଲରେ କଣ ଲେଖା ଅଛି? କେଉଁ ଭାଷାରେ?", "ମୁଖ୍ୟ ବିଷୟଗୁଡ଼ିକ ସରଳ ଭାଷାରେ ବୁଝାନ୍ତୁ।"]},
  "ur-IN": {btn: "💡 تجویز کردہ سوالات",
    image: ["اس تصویر کا خلاصہ بتائیں۔", "اس تصویر میں کیا لکھا ہے؟ کس زبان میں ہے؟", "اہم نکات آسان زبان میں سمجھائیں۔"],
    doc: ["اس دستاویز کا خلاصہ بتائیں۔", "اس دستاویز میں کیا لکھا ہے؟ کس زبان میں ہے؟", "اہم نکات آسان زبان میں سمجھائیں۔"]},
  "as-IN": {btn: "💡 প্ৰস্তাৱিত প্ৰশ্ন",
    image: ["এই ছবিখনৰ সাৰাংশ দিয়া।", "এই ছবিখনত কি লিখা আছে? কোন ভাষাত লিখা?", "গুৰুত্বপূৰ্ণ কথাবোৰ সহজ ভাষাত বুজাই দিয়া।"],
    doc: ["এই নথিখনৰ সাৰাংশ দিয়া।", "এই নথিখনত কি লিখা আছে? কোন ভাষাত লিখা?", "গুৰুত্বপূৰ্ণ কথাবোৰ সহজ ভাষাত বুজাই দিয়া।"]},
  "ne-IN": {btn: "💡 सुझाव गरिएका प्रश्न",
    image: ["यो तस्बिरको सारांश दिनुहोस्।", "यो तस्बिरमा के लेखिएको छ? कुन भाषामा छ?", "मुख्य कुराहरू सरल भाषामा बुझाउनुहोस्।"],
    doc: ["यो कागजातको सारांश दिनुहोस्।", "यो कागजातमा के लेखिएको छ? कुन भाषामा छ?", "मुख्य कुराहरू सरल भाषामा बुझाउनुहोस्।"]},
  default: {btn: "💡 Suggested questions",
    image: ["Summarize this image.", "What is written in this image? Which language is it in?", "Explain the important points in simple words."],
    doc: ["Summarize this document.", "What is written in this document? Which language is it in?", "Explain the important points in simple words."]}
};
/* the bundled PROMPTS table carried corrupted Bengali / Hindi glyphs,
   so it is rebuilt from these clean packs */
const PROMPTS = {};
Object.keys(SUGGEST_UI).forEach(k => { PROMPTS[k] = { image: SUGGEST_UI[k].image, doc: SUGGEST_UI[k].doc }; });
/* which pack to show: the language the user set for replies comes first, so the
   prompts are in Bengali when "Reply: বাংলা" is set, English when English is set.
   The language the file was read in is only a fallback. */
function suggestLangPack() {
  if (SUGGEST_UI[answerLang]) return SUGGEST_UI[answerLang];
  if (documentLangCode && SUGGEST_UI[documentLangCode]) return SUGGEST_UI[documentLangCode];
  return SUGGEST_UI.default;
}
function hideSuggestions() {
  suggestOn = false;
  suggestOpen = false;
  renderSuggestions();
}
function updateDocUi() {
  document.body.classList.toggle("has-doc", !!documentText);
  renderSuggestions();
  updateAttachMini();
}
/* =====================================================
   PREFERENCES + MODEL SWITCHES (drop-up menus)
   ===================================================== */
function hasCode(list, code) {
  return list.some(item => item[0] === code);
}
function fillLangSelect(sel, withAuto, list) {
  sel.innerHTML = "";
  if (withAuto) sel.add(new Option("🔍 Auto-detect", "auto"));
  list.forEach(item => sel.add(new Option(item[1], item[0])));
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    if (p.models && typeof p.models === "object") {
      Object.keys(models).forEach(k => {
        if (typeof p.models[k] === "boolean") models[k] = p.models[k];
      });
      /* older versions saved the chat switch as "chat" */
      if (typeof p.models.chat === "boolean" && typeof p.models.sarvam !== "boolean") {
        models.sarvam = p.models.chat;
      }
    }
    /* only one chat model may be on */
    CHAT_KEYS.filter(k => models[k]).slice(1).forEach(k => { models[k] = false; });
    if (p.trFrom === "auto" || hasCode(DOC_LANGS, p.trFrom)) trFrom = p.trFrom;
    if (hasCode(OUT_LANGS, p.trTo)) trTo = p.trTo;
    if (p.visLang === "auto" || hasCode(DOC_LANGS, p.visLang)) visLang = p.visLang;
    if (IMG_SIZES.indexOf(p.imgSize) >= 0) imgSize = p.imgSize;
  } catch {}
}
function savePrefs() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({
      models: models, trFrom: trFrom, trTo: trTo, visLang: visLang, imgSize: imgSize
    }));
  } catch {}
}
function syncSelects() {
  trFromSel.value = trFrom;
  trToSel.value = trTo;
  visLangSel.value = visLang;
  imgSizeSel.value = imgSize;
}
/* =====================================================
   TYPEWRITER PLACEHOLDER  (a premium, self-typing hint)
   ===================================================== */
const PH_CHAT = [
  "Ask anything...",
  "Summarize a long document in three lines...",
  "Explain photosynthesis like I am ten...",
  "Write a short birthday message in বাংলা...",
  "Translate this paragraph into हिन्दी...",
  "Solve this step by step: 48 × 37...",
  "Draft a polite leave email for my office..."
];
const PH_NOMODEL = [
  "Turn on a model from ⚡ Models...",
  "No AI model is on — pick one in ⚡ Models...",
  "Tap ⚡ Models and choose your brain..."
];
const PH_TRANSLATE = [
  "Type text to translate...",
  "Paste a paragraph to translate into বাংলা...",
  "Translate an image into English..."
];
const PH_IMAGE = [
  "Describe the image you want...",
  "A royal Bengal tiger in a monsoon forest...",
  "A pixel-art meadow at sunset..."
];
let phList = null, phText = "", phIndex = 0, phDeleting = false, phTimer = null;
function placeholderPhrases() {
  if (hasChat()) return PH_CHAT;
  if (models.mayura) return PH_TRANSLATE;
  if (models.image) return PH_IMAGE;
  return PH_NOMODEL;
}
function syncPlaceholder() {
  const list = placeholderPhrases();
  if (list !== phList) {
    phList = list;
    phIndex = 0;
    phText = "";
    phDeleting = false;
    if (phTimer) { clearTimeout(phTimer); phTimer = null; }
    typewriterStep();
  }
}
const PH_REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function typewriterStep() {
  if (!phList) phList = placeholderPhrases();
  /* b97 - once a chat has started, no typewriter: just a calm,
     static "Type your query…" watermark in the box */
  if (document.body.classList.contains("chatting")) {
    if (input.placeholder !== "Type your query\u2026") input.placeholder = "Type your query\u2026";
    phTimer = setTimeout(typewriterStep, 1500);
    return;
  }
  const target = phList[phIndex % phList.length] || "";
  if (PH_REDUCED) {
    phText = target;
    input.placeholder = phText;
    phIndex++;
    phTimer = setTimeout(typewriterStep, 4000);
    return;
  }
  if (!phDeleting) {
    if (phText.length < target.length) {
      phText = target.slice(0, phText.length + 1);
      input.placeholder = phText;
      phTimer = setTimeout(typewriterStep, 52 + Math.random() * 58);
    } else {
      phTimer = setTimeout(() => { phDeleting = true; typewriterStep(); }, 1900);
    }
  } else if (phText.length > 0) {
    phText = phText.slice(0, -1);
    input.placeholder = phText;
    phTimer = setTimeout(typewriterStep, 21);
  } else {
    phDeleting = false;
    phIndex++;
    phTimer = setTimeout(typewriterStep, 320);
  }
}
function startTypewriter() {
  if (phTimer) clearTimeout(phTimer);
  phList = placeholderPhrases();
  phText = "";
  phIndex = 0;
  phDeleting = false;
  typewriterStep();
}
function updateModelUi() {
  stripMayura.classList.toggle("show", models.mayura);
  stripVision.classList.toggle("show", models.vision);
  stripImage.classList.toggle("show", models.image);
  let count = 0;
  modelItems.forEach(item => {
    const on = !!models[item.dataset.model];
    if (on) count++;
    item.setAttribute("aria-checked", on ? "true" : "false");
  });
  modelCount.textContent = String(count);
  syncPlaceholder();
  renderSuggestions();
  syncDock();
}
function setModel(key, on, quiet) {
  /* switching a chat model on switches the other chat models off */
  if (on && CHAT_KEYS.indexOf(key) >= 0) {
    CHAT_KEYS.forEach(k => { if (k !== key) models[k] = false; });
  }
  models[key] = on;
  savePrefs();
  updateModelUi();
  if (!quiet) {
    setStatusFor((MODEL_NAMES[key] || key) + (on ? " is ON ✓" : " is OFF"), 1400);
  }
}
function setMenu(menu, btn, show) {
  menu.classList.toggle("show", show);
  btn.setAttribute("aria-expanded", show ? "true" : "false");
}
function closeMenus() {
  setMenu(modelMenu, modelBtn, false);
  setMenu(replyMenu, replyBtn, false);
}
function toggleMenu(menu, btn, otherMenu, otherBtn) {
  const show = !menu.classList.contains("show");
  setMenu(otherMenu, otherBtn, false);
  setMenu(menu, btn, show);
}
function syncDock() {
  document.documentElement.style.setProperty("--dock-h", dock.offsetHeight + "px");
}
/* =====================================================
   REPLY-LANGUAGE DROP-UP
   ===================================================== */
function syncReply() {
  replyCur.textContent = REPLY_SHORT[answerLang] || answerLang;
  replyItems.forEach(item => {
    item.setAttribute("aria-checked", item.dataset.lang === answerLang ? "true" : "false");
  });
}
function setAnswerLanguage(code, quiet) {
  if (!REPLY_LANGS.includes(code)) return;
  answerLang = code;
  saveLangs();
  syncReply();
  /* the three ready prompts follow the reply language */
  try { renderSuggestions(); } catch (e) {}
  renderSuggestions();
  if (!quiet) {
    /* b58 — do NOT close the panel here: it closes when the user taps
       outside it, and not before */
    setStatusFor("Replies will now always be in " + (LANG_NAMES[code] || code) + " ✓", 1600);
  }
}
function loadLangs() {
  try {
    const saved = JSON.parse(localStorage.getItem(LANG_KEY) || "{}");
    if (REPLY_LANGS.includes(saved.ans)) answerLang = saved.ans;
  } catch {}
}
function saveLangs() {
  try { localStorage.setItem(LANG_KEY, JSON.stringify({ ans: answerLang })); } catch {}
}
/* =====================================================
   VOICE INPUT  (free — browser Web Speech API,
   uses Google's voice recognition in Chrome)
   ===================================================== */
function resizeInput() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 125) + "px";
}
function loadVoiceLang() {
  try {
    const saved = localStorage.getItem(VOICE_KEY);
    if (saved && Array.from(voiceLangSel.options).some(o => o.value === saved)) {
      voiceLang = saved;
    }
  } catch {}
  voiceLangSel.value = voiceLang;
}
function saveVoiceLang() {
  try { localStorage.setItem(VOICE_KEY, voiceLang); } catch {}
}
function voiceLangLabel() {
  const opt = voiceLangSel.options[voiceLangSel.selectedIndex];
  return opt ? opt.text : voiceLang;
}
function setListening(value) {
  listening = value;
  micBtn.classList.toggle("listening", value);
  micBtn.setAttribute("aria-pressed", value ? "true" : "false");
  micBtn.title = value ? "Tap to stop" : "Speak (voice input)";
}
/* graceful stop (keeps the text that was heard) */
function stopVoice() {
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
}
/* hard cancel (used when sending / new chat / busy) */
function cancelVoice() {
  const r = recognition;
  recognition = null;
  if (r) {
    try { r.abort(); } catch {}
  }
  setListening(false);
}
function voiceErrorMessage(code) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone permission is blocked. Allow the microphone for this site and try again.";
  }
  if (code === "no-speech") return "I could not hear anything. Tap the mic and speak again.";
  if (code === "audio-capture") return "No microphone was found on this device.";
  if (code === "network") return "Voice input needs an internet connection.";
  if (code === "language-not-supported") return "This browser does not support voice input in the selected language.";
  return "Voice input error: " + code;
}
function startVoice() {
  if (busy) return;
  if (!SpeechRec) {
    setStatus("⚠️ Voice input is not supported in this browser. Please open this site in Chrome, Edge or Safari.");
    setTimeout(() => setStatus(""), 4500);
    return;
  }
  if (listening) {
    stopVoice();    return;
  }
  const rec = new SpeechRec();
  rec.lang = voiceLang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  const base = input.value.trim() ? input.value.trim() + " " : "";
  let heard = false;
  let failed = false;
  recognition = rec;
  rec.onstart = () => {
    setListening(true);
    setStatus("Listening in " + voiceLangLabel() + "... speak now", true);
  };
  rec.onresult = event => {
    if (recognition !== rec) return;
    let text = "";
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    if (text.trim()) heard = true;
    input.value = base + text;
    resizeInput();
  };
  rec.onerror = event => {
    if (recognition !== rec) return;
    if (event.error === "aborted") return;
    failed = true;
    setStatus("⚠️ " + voiceErrorMessage(event.error));
    setTimeout(() => setStatus(""), 4500);
  };
  rec.onend = () => {
    if (recognition === rec) recognition = null;
    setListening(false);
    if (failed) return;
    if (heard) {
      setStatusFor("Voice captured ✓ · check the text and press send", 3000);
    } else {
      setStatus("");
    }
    input.focus();
  };
  try {
    rec.start();
  } catch (error) {
    recognition = null;
    setListening(false);
    setStatus("⚠️ Could not start voice input. Please try again.");
    setTimeout(() => setStatus(""), 3000);
  }
}
/* =====================================================
   AUTOMATIC INPUT-LANGUAGE DETECTION
   ===================================================== */
const SCRIPTS = [
  { key: "deva", lang: "hi-IN",  re: /[\\u0900-\\u097F]/g },
  { key: "beng", lang: "bn-IN",  re: /[\\u0980-\\u09FF]/g },
  { key: "guru", lang: "pa-IN",  re: /[\\u0A00-\\u0A7F]/g },
  { key: "gujr", lang: "gu-IN",  re: /[\\u0A80-\\u0AFF]/g },
  { key: "orya", lang: "od-IN",  re: /[\\u0B00-\\u0B7F]/g },
  { key: "taml", lang: "ta-IN",  re: /[\\u0B80-\\u0BFF]/g },
  { key: "telu", lang: "te-IN",  re: /[\\u0C00-\\u0C7F]/g },
  { key: "knda", lang: "kn-IN",  re: /[\\u0C80-\\u0CFF]/g },
  { key: "mlym", lang: "ml-IN",  re: /[\\u0D00-\\u0D7F]/g },
  { key: "olck", lang: "sat-IN", re: /[\\u1C50-\\u1C7F]/g },
  { key: "arab", lang: "ur-IN",  re: /[\\u0600-\\u06FF\\u0750-\\u077F]/g },
  { key: "latn", lang: "en-IN",  re: /[A-Za-z\\u00C0-\\u024F]/g }
];
const LANG_SCRIPT = {
  "hi-IN": "deva", "mr-IN": "deva", "ne-IN": "deva", "sa-IN": "deva",
  "kok-IN": "deva", "mai-IN": "deva", "doi-IN": "deva", "brx-IN": "deva",
  "bn-IN": "beng", "as-IN": "beng", "mni-IN": "beng",
  "pa-IN": "guru", "gu-IN": "gujr", "od-IN": "orya",
  "ta-IN": "taml", "te-IN": "telu", "kn-IN": "knda", "ml-IN": "mlym",
  "sat-IN": "olck",
  "ks-IN": "arab", "sd-IN": "arab", "ur-IN": "arab",
  "en-IN": "latn"
};
/* English is the last fallback guess */
const FALLBACK_ORDER = [
  "hi-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN",
  "ml-IN", "gu-IN", "pa-IN", "od-IN", "ur-IN", "en-IN"
];
const MAX_OCR_ATTEMPTS = 3;
function langName(code) {
  return LANG_NAMES[code] || code;
}
function analyzeText(text) {
  const cleaned = String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, " ")
    .replace(/https?:\\/\\/\\S+/g, " ");
  const all = cleaned.match(/\\p{L}/gu) || [];
  if (!all.length) {
    return { script: null, lang: null, ratio: 0, letters: 0 };
  }
  let best = null;
  for (const s of SCRIPTS) {
    const count = (cleaned.match(s.re) || []).length;
    if (!best || count > best.count) best = { s, count };
  }
  if (!best || best.count === 0) {
    return { script: null, lang: null, ratio: 0, letters: all.length };
  }
  return {
    script: best.s.key,
    lang: best.s.lang,
    ratio: best.count / all.length,
    letters: all.length
  };
}
function isGoodResult(lang, analysis) {
  return (
    analysis.letters > 0 &&
    analysis.ratio >= 0.5 &&
    analysis.script === LANG_SCRIPT[lang]
  );
}
/* =====================================================
   USAGE TRACKING (this browser = fallback;
   the server copy in KV is used when it is connected)
   ===================================================== */
function todayKey(offset) {
  const d = new Date(Date.now() - (offset || 0) * 86400000);
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
function loadUsage() {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    if (!u.days || typeof u.days !== "object") u.days = {};
    return u;
  } catch {
    return { days: {} };
  }
}
function saveUsage(u) {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
}
function recordUsage(delta) {
  const u = loadUsage();
  const key = todayKey(0);
  const d = u.days[key] || { chats: 0, prompt: 0, completion: 0, docs: 0, tr: 0, img: 0 };
  d.chats = (d.chats || 0) + (delta.chats || 0);
  d.prompt = (d.prompt || 0) + (delta.prompt || 0);
  d.completion = (d.completion || 0) + (delta.completion || 0);
  d.docs = (d.docs || 0) + (delta.docs || 0);
  d.tr = (d.tr || 0) + (delta.tr || 0);
  d.img = (d.img || 0) + (delta.img || 0);
  u.days[key] = d;
  const keys = Object.keys(u.days).sort();
  while (keys.length > 60) delete u.days[keys.shift()];
  saveUsage(u);
}
function addDay(total, d) {
  total.chats += d.chats || 0;
  total.prompt += d.prompt || 0;
  total.completion += d.completion || 0;
  total.docs += d.docs || 0;
  total.tr += d.tr || 0;
  total.img += d.img || 0;
}
function sumDays(u, count) {
  const total = { chats: 0, prompt: 0, completion: 0, docs: 0, tr: 0, img: 0 };
  for (let i = 0; i < count; i++) {
    const d = u.days[todayKey(i)];
    if (d) addDay(total, d);
  }
  return total;
}
function sumAll(u) {
  const total = { chats: 0, prompt: 0, completion: 0, docs: 0, tr: 0, img: 0 };
  Object.keys(u.days).forEach(k => addDay(total, u.days[k]));
  return total;
}
const fmt = n => Number(n || 0).toLocaleString();
function statRow(label, value, cls) {
  const row = document.createElement("div");
  row.className = "stat";
  const a = document.createElement("span");
  a.textContent = label;
  const b = document.createElement("span");
  b.textContent = value;
  if (cls) b.className = cls;
  row.appendChild(a);
  row.appendChild(b);
  return row;
}
function renderSarvamUsage() {
  const u = loadUsage();
  const today = serverUsage ? serverUsage.today : sumDays(u, 1);
  const week = serverUsage ? serverUsage.week : sumDays(u, 7);
  const all = serverUsage ? serverUsage.all : sumAll(u);
  sarvamUsageEl.innerHTML = "";
  sarvamUsageEl.appendChild(statRow("Total tokens used (all time)", fmt(all.prompt + all.completion), "ok"));
  if (serverUsage && serverUsage.since) {
    sarvamUsageEl.appendChild(statRow("Counting since", serverUsage.since));
  }
  sarvamUsageEl.appendChild(statRow("Today · AI replies", fmt(today.chats)));
  sarvamUsageEl.appendChild(statRow("Today · tokens", fmt(today.prompt + today.completion)));
  sarvamUsageEl.appendChild(statRow("Today · images created", fmt(today.img)));
  sarvamUsageEl.appendChild(statRow("Today · document reads", fmt(today.docs)));
  sarvamUsageEl.appendChild(statRow("Today · translated characters", fmt(today.tr)));
  sarvamUsageEl.appendChild(statRow("Last 7 days · tokens", fmt(week.prompt + week.completion)));
  sarvamUsageEl.appendChild(statRow("All time · AI replies", fmt(all.chats)));
  sarvamUsageEl.appendChild(statRow("All time · images created", fmt(all.img)));
  sarvamUsageEl.appendChild(statRow("All time · document reads", fmt(all.docs)));
  sarvamUsageEl.appendChild(statRow("All time · translated characters", fmt(all.tr)));
  usageHintEl.textContent = serverUsage
    ? "Counts every model (Sarvam, 0G models, Gemini). Saved permanently in Cloudflare KV. It stays across browsers and devices until you press Reset counters. For official credit balances, open each provider's dashboard."
    : "Counts every model. Saved in this browser only. Connect a KV namespace named KV to keep it permanently. For official credit balances, open each provider's dashboard.";
}
/* =====================================================
   SETTINGS PANEL
   ===================================================== */
async function fetchUsage(testModel, isRetry, resetUsage) {
  const response = await fetchWithKv("/api/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: adminPassword,
      testModel: testModel || "",
      resetUsage: !!resetUsage
    })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && data.needPassword) {
    try { localStorage.removeItem(ADMIN_KEY); } catch {}
    adminPassword = "";
    if (isRetry) throw new Error("Wrong admin password.");
    const typed = window.prompt("Enter the admin password:");
    if (typed === null) throw new Error("Admin password required.");
    adminPassword = typed;
    try { localStorage.setItem(ADMIN_KEY, typed); } catch {}
    return fetchUsage(testModel, true, resetUsage);
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Could not load usage.");
  }
  return data;
}
function renderCloudflare(cf) {
  cfUsageEl.innerHTML = "";
  cfUsageEl.className = "";
  if (!cf || !cf.configured) {
    cfUsageEl.className = "hint";
    cfUsageEl.innerHTML =
      "Not connected yet. In Cloudflare open your Worker → Settings → Variables and Secrets and add: " +
      "<code>CF_API_TOKEN</code> (secret, Account Analytics: Read), " +
      "<code>CF_ACCOUNT_ID</code> and <code>CF_WORKER_NAME</code>.";
    return;
  }
  if (cf.error) {
    cfUsageEl.appendChild(statRow("Cloudflare error", cf.error, "bad"));
    return;
  }
  const pct = Math.min(100, (cf.today.requests / cf.dailyLimit) * 100);
  cfUsageEl.appendChild(statRow("Worker", cf.worker));
  cfUsageEl.appendChild(statRow("Requests today (UTC)", fmt(cf.today.requests)));
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("div");
  fill.style.width = pct.toFixed(1) + "%";
  bar.appendChild(fill);
  cfUsageEl.appendChild(bar);
  const limit = document.createElement("div");
  limit.className = "hint";
  limit.textContent = pct.toFixed(2) + "% of the 100,000 / day Workers Free limit";
  cfUsageEl.appendChild(limit);
  cfUsageEl.appendChild(statRow("Errors today", fmt(cf.today.errors), cf.today.errors ? "bad" : "ok"));
  cfUsageEl.appendChild(statRow("Subrequests today", fmt(cf.today.subrequests)));
  cfUsageEl.appendChild(statRow("Requests · last 7 days", fmt(cf.week.requests)));
  cfUsageEl.appendChild(statRow("Errors · last 7 days", fmt(cf.week.errors)));
}
function renderConnection(data) {
  setTimeout(() => { try { paintSetStates(); } catch (e) {} }, 30);
  connInfoEl.innerHTML = "";
  const keyRow = (label, isSet) => {
    connInfoEl.appendChild(statRow(label, isSet ? "Set ✓" : "Missing ✗", isSet ? "ok" : "bad"));
  };
  keyRow("Sarvam API key", data.sarvamKeySet);
  keyRow("0G API key", data.ogKeySet);
  const ogRow = statRow("0G models on the router", "checking...", "");
  connInfoEl.appendChild(ogRow);
  fillOgRow(ogRow);
  connInfoEl.appendChild(statRow(
    "0G API address",
    data.ogBase ? data.ogBase : "Not set ✗ (add OG_API_BASE)",
    data.ogBase ? "ok" : "bad"
  ));
  keyRow("Gemini API key", data.geminiKeySet);
  if (Array.isArray(data.models)) {
    data.models.forEach(m => {
      connInfoEl.appendChild(statRow(
        m.label + " (" + m.id + ")",
        m.ready ? "Ready ✓" : "Not ready ✗",
        m.ready ? "ok" : "bad"
      ));
    });
  }
  connInfoEl.appendChild(statRow("Translate models", data.translateModels || "—"));
  connInfoEl.appendChild(statRow("Document model", "Sarvam Vision"));
  connInfoEl.appendChild(statRow(
    "Admin password",
    data.passwordSet ? "Enabled ✓" : "Not set (panel is open)",
    data.passwordSet ? "ok" : "bad"
  ));
  connInfoEl.appendChild(statRow(
    "Cloud storage",
    data.store
      ? ("Connected ✓ · KV namespace " + (data.kvBinding ? "\u201c" + data.kvBinding + "\u201d" : ""))
      : ("Not connected" + (data.kvSeen && data.kvSeen.length ? " (saw: " + data.kvSeen.join(", ") + ")" : "")),
    data.store ? "ok" : "bad"
  ));
  if (!data.store) {
    const howto = document.createElement("div");
    howto.className = "hint";
    howto.style.marginTop = "4px";
    howto.innerHTML = "Add a KV namespace to this Worker: Cloudflare \u2192 your Worker \u2192 <b>Settings</b> \u2192 <b>Bindings</b> \u2192 Add \u2192 <b>KV Namespace</b> \u2192 the variable name can be <b>anything</b> (KV, My-Chat, CHAT_STORE\u2026) \u2192 pick your namespace \u2192 Save, then deploy the newest build again. With wrangler it is the <code>kv_namespaces</code> block in wrangler.jsonc.";
    connInfoEl.appendChild(howto);
  }
  let syncText = "Off";
  let syncCls = "bad";
  if (data.store && cloud.on) { syncText = "On ✓ (every browser)"; syncCls = "ok"; }
  else if (data.store) { syncText = "Starting..."; syncCls = ""; }
  connInfoEl.appendChild(statRow("Chat history sync", syncText, syncCls));
  if (data.modelTest) {
    const t = data.modelTest;
    if (t.ok) {
      connInfoEl.appendChild(statRow("Test · " + t.label, "Working ✓ (" + t.ms + " ms)", "ok"));
    } else {
      connInfoEl.appendChild(statRow("Test · " + t.label, "Failed: " + t.error, "bad"));
    }
  }
}
/* the meadow animations can stall while the lock overlay covers them,
   so they are restarted (and re-promoted to the compositor) at unlock */
function restartSceneFx() {
  try {
    const nodes = document.querySelectorAll(
      ".px-kid1, .px-kid2, .px-cat, .px-dog, .px-bee1, .px-bee2"
    );
    if (!nodes.length) return;
    nodes.forEach(el => { el.style.animation = "none"; });
    void document.body.offsetWidth;
    requestAnimationFrame(() => {
      nodes.forEach(el => { el.style.animation = ""; });
      const hero = document.querySelector(".px-hero");
      if (hero) {
        hero.style.willChange = "transform";
        setTimeout(() => { hero.style.willChange = ""; }, 700);
      }
    });
  } catch (error) { /* the scene is optional */ }
}
window.mfRestartScene = restartSceneFx;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) restartSceneFx();
});
/* no AI is switched on by default — the user chooses one from the ⚡ Models menu */
function selectDefaultModel() {
  if (!CHAT_KEYS.length) return;
  CHAT_KEYS.forEach(key => { models[key] = false; });
  savePrefs();
  updateModelUi();
}
window.mfSelectDefaultModel = selectDefaultModel;
function updateAutoLockInfo() {
  const el = $("autoLockInfo");
  if (!el) return;
  let last = 0;
  try { last = Number(localStorage.getItem("mf_last_chat")) || 0; } catch {}
  const lockBox = $("lock");
  const lockedNow = lockBox && !lockBox.classList.contains("hidden");
  if (lockedNow || !last) {
    el.textContent = "Auto-lock: home screen after 30 idle minutes · the whole chat locks after 1 idle hour.";
    return;
  }
  const idleMin = Math.floor((Date.now() - last) / 60000);
  const mins = Math.max(0, Math.ceil((3600000 - (Date.now() - last)) / 60000));
  el.textContent = "Idle " + idleMin + " min · back to home at 30 · locks in about " + mins + " min if nobody chats.";
}
setInterval(updateAutoLockInfo, 30000);
async function refreshSettings(testModel) {
  renderSarvamUsage();
  updateAutoLockInfo();
  cfUsageEl.className = "hint";
  cfUsageEl.textContent = "Loading...";
  try {
    const data = await fetchUsage(testModel, false);
    serverUsage = data.usage || null;
    renderSarvamUsage();
    renderCloudflare(data.cloudflare);
    renderConnection(data);
    if (data.chatSync) startSync();
  } catch (error) {
    cfUsageEl.className = "hint bad";
    cfUsageEl.textContent = error.message;
  }
}
/* =====================================================
   🩺 STORAGE & CONNECTION
   -----------------------------------------------------
   One card that answers three questions in plain words:
     · is the storage connected, and which road is it on?
     · if not — what exactly do I do now?
     · and who can answer chats right now (the API keys)?
   ===================================================== */
const KV_LINK_KEY = "mf_kv_link_v1";
function readKvLink() {
  try {
    const raw = localStorage.getItem(KV_LINK_KEY);
    const j = raw ? JSON.parse(raw) : null;
    if (!j || !j.a || !j.n || !j.t) return null;
    return { a: String(j.a).trim(), n: String(j.n).trim(), t: String(j.t).trim() };
  } catch (e) { return null; }
}
function writeKvLink(link) {
  try {
    if (!link) localStorage.removeItem(KV_LINK_KEY);
    else localStorage.setItem(KV_LINK_KEY, JSON.stringify(link));
  } catch (e) {}
}
function b64e(text) {
  try {
    const bytes = new TextEncoder().encode(String(text));
    let bin = "";
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  } catch (e) { return ""; }
}
/* every call to the Worker carries the link when there is one */
function kvHeaders(extra) {
  const link = readKvLink();
  const out = Object.assign({}, extra || {});
  if (link) out["x-mf-kv"] = b64e(JSON.stringify(link));
  return out;
}
function fetchWithKv(url, opts) {
  const options = Object.assign({}, opts || {});
  options.headers = kvHeaders(options.headers);
  /* a plain fetch with the same arguments, plus the storage link header */
  return fetch(url, options);
}
function kvFetch(url, opts) { return fetchWithKv(url, opts); }
function kvLinkActive() { return Boolean(readKvLink()); }
/* ---------- the card ---------- */
async function loadStorage(quiet) {
  const dot = $("storeDot"), words = $("storeWords"), box = $("connKv");
  if (!words) return;
  if (!quiet) { words.textContent = "Checking the storage…"; if (dot) dot.className = "store-dot"; }
  let data = null;
  try {
    const response = await fetchWithKv("/api/kv-check");
    data = await response.json().catch(() => ({}));
  } catch (error) {
    data = { ok: false, error: error.message };
  }
  const link = readKvLink();
  const via = (data && data.via) || (link ? "link" : "none");
  if (dot) {
    dot.className = "store-dot " + (data && data.ok ? "on" : (data && data.binding ? "warn" : "off"));
  }
  const locals = customModels.filter(m => m && m.local);
  if (words) {
    words.innerHTML = data && data.ok
      ? "Cloud storage connected ✓ <small>· " + (via === "link" ? "KV link (API token)" : "namespace “" + escHtml(data.binding || "") + "”") + "</small>"
      : (data && data.binding
        ? "Storage found but not answering ✗ <small>· “" + escHtml(data.binding) + "”</small>"
        : "Cloud storage not connected ✗");
    if (locals.length) {
      words.innerHTML += data && data.ok
        ? ' <small>· moving ' + locals.length + " model" + (locals.length === 1 ? "" : "s") + " up from this browser…</small>"
        : ' <small>· ' + locals.length + " model" + (locals.length === 1 ? "" : "s") + " kept in this browser only</small>";
    }
  }
  /* once storage works, anything that was parked in this browser goes up */
  if (data && data.ok && locals.length && !localPushRunning) { pushLocalModels(); }
  if (box) {
    box.innerHTML = "";
    box.appendChild(statRow("Route", via === "link" ? "KV link · API token" : via === "binding" ? "KV binding on the Worker" : "nothing attached", data && data.ok ? "ok" : "bad"));
    if (data && data.binding) box.appendChild(statRow("Binding name", data.binding, "ok"));
    if (data && data.link && data.link.configured) {
      box.appendChild(statRow("KV link", "account " + data.link.account + " · namespace " + String(data.link.namespace).slice(0, 8) + "… · token …" + data.link.tail, "ok"));
    }
    box.appendChild(statRow("Wrote a test key", data && data.wrote ? "yes ✓" : "no ✗", data && data.wrote ? "ok" : "bad"));
    box.appendChild(statRow("Read it back", data && data.read ? "yes ✓" : "no ✗", data && data.read ? "ok" : "bad"));
    if (data && data.error) box.appendChild(statRow("What the store said", data.error, "bad"));
  }
  if (!data || !data.ok) {
    const fold = $("kvLinkFold");
    if (fold && !fold.dataset.seen) { fold.dataset.seen = "1"; fold.open = true; }
  }
  renderStorageRepair(data);
  const pre = $("kvJsonc");
  if (pre) pre.textContent = '"kv_namespaces": [\\n  {\\n    "binding": "KV",\\n    "id": "06795ec62c844cc0a58bbf3873efc31d"\\n  }\\n]';
  return data;
}
function renderStorageRepair(data) {
  const out = $("kvTestOut");
  if (!out) return;
  const lines = [];
  if (data && data.ok) {
    lines.push("✓ Working — a test key was written, read back and removed in " +
      (data.via === "link" ? "your KV namespace over the API-token link" : "the namespace “" + (data.binding || "?") + "”") + ".");
    lines.push("Chats, usage counters, your saved keys and your AI models are kept there for every browser.");
    out.className = "kv-out ok";
  } else {
    lines.push("✗ Not connected yet — nothing is being saved to Cloudflare right now.");
    if (data && data.binding) lines.push("A binding named “" + data.binding + "” was found, but it did not answer.");
    if (data && data.error) lines.push("The store said: " + data.error);
    if (data && data.seen && data.seen.length) lines.push("Names that look like storage but are not KV: " + data.seen.join(", "));
    if (data && data.envKeys && data.envKeys.length) lines.push("Bindings this Worker can see: " + data.envKeys.join(", "));
    lines.push("——— what to do (any one of these) ———");
    (data && data.fix && data.fix.length ? data.fix : [
      "Easy: press “🪄 Connect without a binding” just above and paste three strings (account id, KV namespace id, API token). The app tests them before saving.",
      "Permanent: Cloudflare → Workers & Pages → your Worker → Settings → Bindings → Add → KV Namespace → any variable name → your namespace → Save, then deploy again.",
      "With wrangler: copy the block above into wrangler.jsonc and run npx wrangler deploy (delete the preview_id placeholder line)."
    ]).forEach(l => lines.push("• " + l));
    out.className = "kv-out bad";
  }
  out.innerHTML = lines.map((l, i) => (i === 0 || l.indexOf("———") === 0) ? "<b>" + escHtml(l) + "</b>" : escHtml(l)).join("<br>");
}
async function testKvStorage() {
  const out = $("kvTestOut"), btn = $("kvTest");
  if (out) { out.className = "kv-out"; out.textContent = "Testing the KV namespace…"; }
  if (btn) btn.disabled = true;
  try {
    const data = await loadStorage(true);
    if (!data) renderStorageRepair({ ok: false, error: "The Worker did not answer." });
  } finally {
    if (btn) btn.disabled = false;
    if (typeof refreshProviderRows === "function") loadProviders(true);
  }
}
/* ---------- the API-token link ---------- */
async function kvLinkSave() {
  const out = $("kvLinkOut"), btn = $("kvLinkSave");
  const acc = ($("kvAcc").value || "").trim();
  const ns = ($("kvNs").value || "").trim();
  const tok = ($("kvTok").value || "").trim();
  const paint = (cls, text) => { if (out) { out.className = "kv-out " + cls; out.innerHTML = text; } };
  if (!/^[0-9a-f]{32}$/i.test(acc)) { paint("bad", "The <b>account id</b> should be 32 characters (letters and digits) — copy it from the right-hand side of your Cloudflare dashboard."); return; }
  if (!/^[0-9a-f]{32}$/i.test(ns)) { paint("bad", "The <b>namespace id</b> should be 32 characters — open Workers &amp; Pages → KV and copy the id under the namespace name."); return; }
  if (tok.length < 20) { paint("bad", "The <b>API token</b> looks too short — copy the whole token (it has ~40 characters and starts with letters or digits)."); return; }
  paint("", "Testing the link with a tiny write…");
  if (btn) btn.disabled = true;
  try {
    writeKvLink({ a: acc, n: ns, t: tok });
    const response = await fetchWithKv("/api/kv-check");
    const data = await response.json().catch(() => ({}));
    if (data && data.ok) {
      paint("ok", "✓ Connected — the app is now saving to KV namespace <b>" + escHtml(ns.slice(0, 8)) + "…</b> with the token ending " + escHtml(tok.slice(-4)) + ".<br>Chats, models and keys now follow every browser. You can close this box.");
      ["kvAcc", "kvNs", "kvTok"].forEach(id => { const el = $(id); if (el) el.value = ""; });
      await loadStorage(true);
      loadProviders(true);
      pushLocalModels();
    } else {
      writeKvLink(null);
      paint("bad", "✗ That did not work, so nothing was saved.<br>" + escHtml((data && data.error) || "The Worker did not answer.") +
        "<br>• The token needs the permission <b>Account → Workers KV Storage → Edit</b>.<br>• Both ids must belong to the <b>same account</b> as this Worker.");
    }
  } catch (error) {
    writeKvLink(null);
    paint("bad", "✗ " + escHtml(error.message));
  } finally {
    if (btn) btn.disabled = false;
  }
}
/* ---------- models that were kept in this browser are moved up ---------- */
let localPushRunning = false;
async function pushLocalModels() {
  const locals = customModels.filter(m => m && m.local);
  if (!locals.length || localPushRunning) return 0;
  localPushRunning = true;
  let done = 0;
  try {
    for (const m of locals) {
      try {
        const payload = { action: "save", key: m.key, label: m.label, modelId: m.modelId, logo: m.logo || "" };
        if (m.provider) payload.provider = m.provider;
        if (m.base) { payload.base = m.base; payload.apiKey = m.apiKey || ""; payload.format = m.format || "openai"; }
        const data = await modelsRequest(payload);
        if (data) done++;
      } catch (e) { /* the next one may still work */ }
    }
    if (done) {
      try { await refreshModelsQuiet(true); } catch (e) {}
      modelHint(done + " model" + (done === 1 ? "" : "s") + " that were kept in this browser moved into Cloud storage ✓ — every browser can see them now.", false);
    }
  } finally {
    localPushRunning = false;
  }
  return done;
}
async function kvLinkTest() {
  const out = $("kvLinkOut");
  const link = readKvLink();
  if (out) { out.className = "kv-out"; out.textContent = "Testing the saved link…"; }
  if (!link) { if (out) { out.className = "kv-out bad"; out.textContent = "No link is saved yet — fill the three boxes and press Connect."; } return; }
  try {
    const response = await fetchWithKv("/api/kv-check");
    const data = await response.json().catch(() => ({}));
    if (data && data.ok) {
      if (out) { out.className = "kv-out ok"; out.textContent = "✓ The link works — a test key was written and removed in your namespace."; }
    } else {
      if (out) { out.className = "kv-out bad"; out.textContent = "✗ " + ((data && data.error) || "The link is not working."); }
    }
    await loadStorage(true);
  } catch (error) {
    if (out) { out.className = "kv-out bad"; out.textContent = "✗ " + error.message; }
  }
}
async function kvLinkClear() {
  const out = $("kvLinkOut");
  writeKvLink(null);
  if (out) { out.className = "kv-out"; out.textContent = "Forgotten. The app goes back to the Worker's own KV binding (if it has one)."; }
  await loadStorage(true);
}
function kvCopyJsonc() {
  const pre = $("kvJsonc"), out = $("kvLinkOut");
  const text = pre ? pre.textContent : "";
  try {
    navigator.clipboard.writeText('"kv_namespaces": [\\n  {\\n    "binding": "KV",\\n    "id": "06795ec62c844cc0a58bbf3873efc31d"\\n  }\\n]');
    if (out) { out.className = "kv-out ok"; out.textContent = "✓ Copied — paste it inside wrangler.jsonc (next to \\"main\\"), then deploy."; }
  } catch (e) {
    if (out) { out.className = "kv-out"; out.textContent = "Copy it by hand:\\n" + text; }
  }
}
function setupStorageCard() {
  const test = $("kvTest"), refresh = $("kvRefresh"), save = $("kvLinkSave"), tl = $("kvLinkTest"), cl = $("kvLinkClear"), cp = $("kvCopy");
  if (test) test.addEventListener("click", testKvStorage);
  if (refresh) refresh.addEventListener("click", () => loadStorage(false));
  if (save) save.addEventListener("click", kvLinkSave);
  if (tl) tl.addEventListener("click", kvLinkTest);
  if (cl) cl.addEventListener("click", kvLinkClear);
  if (cp) cp.addEventListener("click", kvCopyJsonc);
  const link = readKvLink();
  if (link) {
    if ($("kvAcc")) $("kvAcc").placeholder = "account " + link.a.slice(0, 6) + "… saved — paste a new one to replace it";
    if ($("kvNs")) $("kvNs").placeholder = "namespace " + link.n.slice(0, 8) + "… saved";
    if ($("kvTok")) $("kvTok").placeholder = "token …" + link.t.slice(-4) + " saved";
  }
  loadStorage(true);
  window.mfStorageAfterUnlock = function () { loadStorage(true); };
}

/* =====================================================
   📖 THE MODELS INSIDE AN API
   -----------------------------------------------------
   One tap fills the “Model code name” box, so nobody has to guess or
   remember a code name. The list is live from the API (5-minute cache).
   ===================================================== */
let liveModels = [];
let liveModelsFor = "";
function liveListOpen(open) {
  const box = $("cmModels");
  if (!box) return;
  box.hidden = !open;
  const btn = $("cmBrowse");
  if (btn) btn.textContent = open ? "🙈 Hide" : "📖 Models";
}
async function loadLiveModels(fresh) {
  const note = $("cmListNote"), rows = $("cmModelRows");
  if (!cmProvider) {
    if (note) note.textContent = "Pick one of the three APIs first — then its live model list appears here.";
    liveListOpen(true);
    return;
  }
  const p = providerInfo(cmProvider) || (PROVIDER_FALLBACK.find(x => x.id === cmProvider) || {});
  if (note) note.textContent = "Asking " + (p.label || "the API") + " for its model list…";
  if (rows) rows.innerHTML = "";
  try {
    const response = await fetchWithKv("/api/provider-models?id=" + encodeURIComponent(cmProvider) + (fresh ? "&fresh=1" : "") + "&q=" + encodeURIComponent(($("cmSearch") || {}).value || ""));
    const data = await response.json().catch(() => ({}));
    if (!data || !data.ok) throw new Error((data && data.error) || "The API did not send a list.");
    liveModels = Array.isArray(data.models) ? data.models : [];
    liveModelsFor = cmProvider;
    if (note) {
      note.textContent = liveModels.length
        ? data.count + " model" + (data.count === 1 ? "" : "s") + " shown of " + data.total + " on " + data.label + (data.freeCount ? " · " + data.freeCount + " free" : "") + ". Tap one to use it."
        : ((data.total ? data.total + " models, but none matched your search." : "This API did not send any model.") + (data.example ? " Example: " + data.example : ""));
    }
    renderLiveModels();
  } catch (error) {
    liveModels = [];
    if (note) note.textContent = "Could not read the list: " + error.message + " — press ↻ to try again, or simply type the code name by hand.";
    if (rows) rows.innerHTML = "";
  }
}
function renderLiveModels() {
  const rows = $("cmModelRows");
  if (!rows) return;
  const freeOnly = $("cmFreeOnly") ? $("cmFreeOnly").checked : false;
  const shown = liveModels
    .filter(m => !freeOnly || m.free || cmProvider !== "openrouter")
    .slice(0, 40);
  rows.innerHTML = "";
  if (!shown.length) return;
  shown.forEach(m => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "live-row";
    b.innerHTML = '<span class="live-txt"><b>' + escHtml(m.label || m.id) + '</b><small>' + escHtml(m.id) +
      (m.note ? ' · ' + escHtml(m.note) : '') + '</small></span>' +
      (m.free ? '<span class="live-free-tag">free</span>' : '');
    b.addEventListener("click", () => {
      $("cmId").value = m.id;
      if (!$("cmName").value.trim()) $("cmName").value = String(m.label || m.id).replace(/ \\(free\\)$/, "");
      modelHint("Selected “" + m.id + "”. Give it a display name and a logo, then press Save model.", false);
    });
    rows.appendChild(b);
  });
  const more = document.createElement("div");
  more.className = "hint";
  more.textContent = shown.length + " shown — type in the search box to narrow the list.";
  rows.appendChild(more);
}
function setupModelBrowse() {
  const browse = $("cmBrowse"), search = $("cmSearch"), free = $("cmFreeOnly"), reload = $("cmReload");
  if (browse) browse.addEventListener("click", () => {
    const open = $("cmModels").hidden;
    liveListOpen(open);
    if (open) loadLiveModels(false);
  });
  let timer = null;
  if (search) search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadLiveModels(false), 350);
  });
  if (free) free.addEventListener("change", renderLiveModels);
  if (reload) reload.addEventListener("click", () => loadLiveModels(true));
  window.mfModelBrowseRedraw = function () { if ($("cmModels") && !$("cmModels").hidden) loadLiveModels(true); };
}
/* =====================================================
   ⚙️ SETTINGS AS ONE LIST OF DROPDOWNS
   -----------------------------------------------------
   Every card of Settings becomes a row. Tapping a row opens THAT row
   alone — the others close, so one screen always shows one item in full
   detail. It is built from the page itself, and anything added to the
   settings body later becomes a row by itself (a MutationObserver keeps
   watching), so no future setting can fall outside this list.
   ===================================================== */
const SET_OPEN_KEY = "mf_settings_open_v1";
function setItemIcon(text) {
  const first = String(text || "").trim().split(/\\s+/)[0] || "";
  if (!first) return { icon: "⚙️", label: String(text || "Settings").trim() };
  try {
    if (/\\p{Extended_Pictographic}/u.test(first)) {
      return { icon: first, label: String(text).trim().slice(first.length).trim() };
    }
  } catch (e) {}
  return { icon: "⚙️", label: String(text || "Settings").trim() };
}
function buildOneSetting(card) {
  if (!card || card.dataset.setBuilt === "1") return;
  const head = card.querySelector("h3");
  const rawTitle = head ? String((head.childNodes[0] && head.childNodes[0].nodeValue) || head.textContent || "").trim() : "Settings";
  const sub = head ? head.querySelector("small") : null;
  const named = setItemIcon(rawTitle);
  const details = document.createElement("details");
  details.className = "set-item";
  if (card.id) details.id = card.id;
  const summary = document.createElement("summary");
  summary.className = "set-head";
  /* the row itself is a plain flex span inside the summary: the flexbox on
     <summary> itself is ignored by some Safari versions */
  const row = document.createElement("span");
  row.className = "set-head-in";
  const ico = document.createElement("span");
  ico.className = "set-ico";
  ico.textContent = named.icon;
  const txt = document.createElement("span");
  txt.className = "set-txt";
  const b = document.createElement("b");
  b.textContent = named.label || rawTitle || "Settings";
  txt.appendChild(b);
  if (sub) {
    const small = document.createElement("small");
    small.textContent = sub.textContent.trim();
    txt.appendChild(small);
  }
  const state = document.createElement("span");
  state.className = "set-state";
  state.textContent = "…";
  const chev = document.createElement("span");
  chev.className = "set-chev";
  chev.textContent = "▾";
  row.appendChild(ico);
  row.appendChild(txt);
  row.appendChild(state);
  row.appendChild(chev);
  summary.appendChild(row);
  const detail = document.createElement("div");
  detail.className = "set-detail";
  Array.from(card.childNodes).forEach(node => {
    if (node === head) return;
    detail.appendChild(node);
  });
  details.appendChild(summary);
  details.appendChild(detail);
  card.appendChild(details);
  card.classList.add("set-row");
  card.dataset.setBuilt = "1";
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    closeOtherSettings(details);
    try { localStorage.setItem(SET_OPEN_KEY, details.id || named.label || ""); } catch (e) {}
    paintSetStates();
  });
  summary.addEventListener("click", () => {
    setTimeout(() => { if (details.open) closeOtherSettings(details); paintSetStates(); }, 0);
  });
}
function closeOtherSettings(keep) {
  Array.from(document.querySelectorAll("#settings .set-item")).forEach(item => {
    if (item !== keep && item.open) {
      item.dataset.silent = "1";
      item.open = false;
      delete item.dataset.silent;
    }
  });
}
function setItems() {
  return Array.from(document.querySelectorAll("#settings .set-item"));
}
function buildSettingItems() {
  const body = document.querySelector("#settings .settings-body");
  if (!body) return;
  Array.from(body.children).forEach(child => {
    if (child.tagName === "SECTION" && child.classList.contains("card")) buildOneSetting(child);
  });
  if (!body.dataset.watching) {
    body.dataset.watching = "1";
    /* a setting added later (a new card) becomes a row on its own */
    const observer = new MutationObserver(list => {
      list.forEach(change => {
        Array.from(change.addedNodes || []).forEach(node => {
          if (node.nodeType === 1 && node.tagName === "SECTION" && node.classList.contains("card")) {
            buildOneSetting(node);
            paintSetStates();
          }
        });
      });
    });
    observer.observe(body, { childList: true });
  }
}
/* the small line on the right of every row: the state of that setting */
function firstValue(sel) {
  const el = document.querySelector(sel);
  if (!el) return "";
  const row = el.querySelector(".stat-row");
  const spans = row ? row.querySelectorAll("span") : [];
  if (spans.length >= 2) return String(spans[spans.length - 1].textContent || "").trim();
  return String(el.textContent || "").trim();
}
function paintSetStates() {
  const body = document.querySelector("#settings .settings-body");
  if (!body) return;
  Array.from(body.querySelectorAll("section.card.set-row")).forEach(card => {
    const state = card.querySelector(".set-state");
    const label = (card.querySelector(".set-txt b") || {}).textContent || "";
    if (!state) return;
    state.className = "set-state";
    let text = "";
    let full = "";
    if (/Appearance/i.test(label)) {
      const cur = $("palCur");
      text = cur ? String(cur.textContent || "").replace(/\\s*\\(default\\)\\s*/i, "").trim() : "";
      full = "The look of the app on this device";
    } else if (/AI usage/i.test(label)) {
      const tokens = Number(firstValue("#sarvamUsage").replace(/[^0-9]/g, "")) || 0;
      text = tokens ? (tokens >= 1000 ? (tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1) + "k tokens" : tokens + " tokens") : "no usage yet";
      full = "How many tokens the models have used";
    } else if (/Cloudflare/i.test(label)) {
      const cf = firstValue("#cfUsage");
      text = /error|cannot|undefined/i.test(cf) ? "—" : cf;
      full = "What the Worker did today, live from Cloudflare";
    } else if (/AI models/i.test(label)) {
      const count = $("cmCount");
      const n = count ? Number(count.textContent) || 0 : 0;
      const locals = (typeof customModels !== "undefined" && Array.isArray(customModels))
        ? customModels.filter(m => m && m.local).length : 0;
      text = n + (n === 1 ? " model" : " models") + (locals ? " · " + locals + " here" : "");
      full = "Models you added from Settings, saved for every browser";
      if (locals) state.className = "set-state warn";
    } else if (/Security/i.test(label)) {
      text = "auto-lock on";
      full = "Home screen after 30 idle minutes, lock after 60";
    } else if (/Storage/i.test(label)) {
      const dot = $("storeDot");
      const cls = dot ? dot.className : "";
      text = /on/.test(cls) ? "connected" : /warn/.test(cls) ? "check me" : /off/.test(cls) ? "not connected" : "checking";
      full = "Chats, keys and models are kept in your Cloudflare KV";
      if (/warn|off/.test(cls)) state.className = "set-state warn";
      else if (/on/.test(cls)) state.className = "set-state ok";
    } else {
      const sub = card.querySelector('.set-txt small');
      text = "open";
      full = sub ? sub.textContent : "";
    }
    text = String(text || "").replace(/\\s+/g, " ").trim();
    if (!text || text === "—" || /cannot read|undefined|null|error/i.test(text)) text = "open";
    if (text.length > 15) text = text.slice(0, 14) + "…";
    state.textContent = text;
    state.setAttribute("title", full || text);
    /* the whole row explains itself on hover */
    const headEl = card.querySelector('.set-head');
    if (headEl) headEl.setAttribute("title", (label || "") + (full ? " — " + full : ""));
  });
}
/* a small search box, so a long list stays quick to use */
function setupSettingSearch() {
  const body = document.querySelector("#settings .settings-body");
  if (!body || $("setFilter")) return;
  const wrap = document.createElement("div");
  wrap.className = "set-filter";
  const input = document.createElement("input");
  input.id = "setFilter";
  input.className = "set-input";
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = "Search a setting… (appearance, models, storage, keys)";
  const count = document.createElement("span");
  count.className = "set-count";
  wrap.appendChild(input);
  wrap.appendChild(count);
  body.insertBefore(wrap, body.firstChild);
  const apply = () => {
    const q = String(input.value || "").trim().toLowerCase();
    let shown = 0;
    Array.from(body.querySelectorAll("section.card.set-row")).forEach(card => {
      const words = String(card.textContent || "").toLowerCase();
      const ok = !q || words.indexOf(q) >= 0;
      card.classList.toggle("set-hidden", !ok);
      if (ok) shown++;
      if (ok && q && shown === 1) {
        const item = card.querySelector(".set-item");
        if (item && !item.open) { item.open = true; }
      }
    });
    count.textContent = q ? shown + " of " + body.querySelectorAll("section.card.set-row").length : "";
  };
  input.addEventListener("input", apply);
  apply();
}
function openDefaultSetting() {
  const items = setItems();
  if (!items.length) return;
  if (items.some(i => i.open)) return;
  let want = "";
  try { want = localStorage.getItem(SET_OPEN_KEY) || ""; } catch (e) {}
  const target = items.find(i => i.id === want) || items[0];
  if (target) target.open = true;
}
function setupSettingsList() {
  buildSettingItems();
  setupSettingSearch();
  openDefaultSetting();
  paintSetStates();
  clearInterval(setStateTimer);
  setStateTimer = setInterval(() => {
    const panel = document.getElementById("settings");
    if (panel && panel.classList.contains("show")) paintSetStates();
  }, 1200);
  /* scrolling the list never scrolls the page behind it, and the last row
     is always reachable (the old list did not scroll on phones) */
  const body = document.querySelector("#settings .settings-body");
  if (body) {
    body.addEventListener("touchmove", e => { e.stopPropagation(); }, { passive: true });
  }
}
let setStateTimer = null;

/* =====================================================
   🧠 THE “Thinking…” STREAM  (what an answer looks like while it is made)
   -----------------------------------------------------
   The rows of thought appear one after another, slightly dimmed, older
   rows fade away under a soft mask, a thin rail runs down the left and a
   small square cursor breathes at the bottom — the same idea as the big
   chat apps. Everything here is thrown away the moment the answer starts
   to be written: none of it can leak into the answer.
   ===================================================== */
const THINK_PHRASES = {
  "bn-IN": [
    "আপনার প্রশ্নটা পড়ে নিচ্ছি…",
    "কোন অংশটা আসলেই জানতে চাওয়া হয়েছে, সেটা বুঝে নিচ্ছি…",
    "উত্তরটা গুছিয়ে সাজাচ্ছি…",
    "তথ্যগুলো একবার মিলিয়ে নিচ্ছি…",
    "শেষ করে বাংলায় লিখে দিচ্ছি…"
  ],
  "hi-IN": [
    "आपका सवाल पढ़ रहा हूँ…",
    "समझ रहा हूँ कि असल में क्या जानना है…",
    "जवाब को क्रम में सजा रहा हूँ…",
    "तथ्यों को एक बार मिला रहा हूँ…",
    "आख़िर में हिंदी में लिख दे रहा हूँ…"
  ],
  "en-IN": [
    "Reading your question…",
    "Working out what is really being asked…",
    "Thinking about the best answer…",
    "Checking the details before writing…",
    "Writing it out in your language…"
  ]
};
let thinkTypeTimer = null;
function thinkReduceMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}
function thinkPhrases() {
  const list = THINK_PHRASES[answerLang] || THINK_PHRASES["en-IN"];
  return list.length ? list : THINK_PHRASES["en-IN"];
}
function thinkLinePaint(col) {
  const lines = Array.from(col.querySelectorAll(".think-line"));
  const fade = [0.92, 0.60, 0.38, 0.24, 0.15, 0.10, 0.07];
  lines.forEach((el, i) => {
    const back = lines.length - 1 - i;
    el.classList.toggle("now", back === 0);
    el.style.opacity = String(fade[back] !== undefined ? fade[back] : 0.05);
  });
}
function thinkLineNew(col) {
  const line = document.createElement("div");
  line.className = "think-line now";
  col.appendChild(line);
  while (col.children.length > 8) col.removeChild(col.firstChild);
  thinkLinePaint(col);
  return line;
}
/* the box that holds the rows, the rail, the shimmer and the cursor */
function buildThinkStream() {
  const stream = document.createElement("div");
  stream.className = "think-stream";
  const shimmer = document.createElement("span");
  shimmer.className = "think-shimmer";
  const col = document.createElement("div");
  col.className = "think-col";
  const cursor = document.createElement("span");
  cursor.className = "think-cursor";
  stream.appendChild(shimmer);
  stream.appendChild(col);
  col.appendChild(cursor);
  return stream;
}
function stopThinkStream() {
  clearTimeout(thinkTypeTimer);
  thinkTypeTimer = null;
}
function startThinkStream() {
  /* b58 — the panel shows the model's REAL stream now (see mfReadStream);
     the demo phrases were only there to fill the silence */
  if (window.mfReadStream) {
    const row = document.querySelector(".typing-row");
    if (row) { row.classList.add("mf-waiting"); const t = row.querySelector(".think-title"); if (t) t.textContent = "Thinking…"; }
    return;
  }
  stopThinkStream();
  if (!typingRow) return;
  const col = typingRow.querySelector(".think-col");
  const cursor = typingRow.querySelector(".think-cursor");
  if (!col) return;
  const list = thinkPhrases();
  const slow = thinkReduceMotion();
  let phrase = 0;
  let line = thinkLineNew(col);
  let i = 0;
  const keepCursorLast = () => { if (cursor) col.appendChild(cursor); };
  keepCursorLast();
  const step = () => {
    const text = list[phrase % list.length];
    if (slow) {
      const shown = phrase + 1;
      line.textContent = list.slice(0, shown).join(" ").slice(0, 160);
      i = text.length;
    }
    if (i <= text.length) {
      if (!slow) line.textContent = text.slice(0, i);
      i += 1;
      thinkTypeTimer = setTimeout(step, slow ? 900 : 16 + Math.random() * 26);
    } else {
      i = 0;
      phrase += 1;
      line = thinkLineNew(col);
      keepCursorLast();
      thinkTypeTimer = setTimeout(step, slow ? 200 : 260 + Math.random() * 220);
    }
  };
  step();
}
function openSettings() {
  closeMenus();
  overlay.classList.add("show");
  settingsPanel.classList.add("show");
  buildSettingItems();
  openDefaultSetting();
  paintSetStates();
  refreshSettings("");
}
async function testKvStorage() {
  const out = $("kvTestOut");
  const btn = $("kvTest");
  if (out) { out.className = "kv-out"; out.textContent = "Testing the KV namespace..."; }
  if (btn) btn.disabled = true;
  try {
    const response = await fetchWithKv("/api/kv-check");
    const data = await response.json().catch(() => ({}));
    const lines = [];
    if (data.ok) {
      lines.push("✓ Working — wrote, read back and removed a test key in the KV namespace \u201c" + (data.binding || "?") + "\u201d.");
      lines.push("Chats, usage counters and your AI models are stored there for every browser.");
      if (out) out.className = "kv-out ok";
    } else {
      lines.push("✗ Not working." + (data.binding ? " Found a binding named \u201c" + data.binding + "\u201d." : " No KV namespace binding found on this Worker."));
      if (data.error) lines.push("The store said: " + data.error);
      if (data.seen && data.seen.length) lines.push("Names that looked like storage but are not KV: " + data.seen.join(", "));
      if (data.envKeys && data.envKeys.length) lines.push("Bindings this Worker can see: " + data.envKeys.join(", "));
      lines.push("Fix: Cloudflare \u2192 your Worker \u2192 Settings \u2192 Bindings \u2192 Add \u2192 KV Namespace \u2192 variable name KV (or any name) \u2192 pick your namespace (06795ec62c844cc0a58bbf3873efc31d) \u2192 Save, then deploy the newest build again.");
      if (out) out.className = "kv-out bad";
    }
    if (out) out.innerHTML = lines.map(l => escHtml(l)).join("<br>");
  } catch (error) {
    if (out) { out.className = "kv-out bad"; out.textContent = "✗ Could not reach the Worker: " + error.message; }
  } finally {
    if (btn) btn.disabled = false;
  }
}
function closeSettings() {
  setStatus("");
  settingsPanel.classList.remove("show");
  if (!drawer.classList.contains("show")) overlay.classList.remove("show");
}
/* =====================================================
   HISTORY STORAGE
   ===================================================== */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    chats = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(chats)) chats = [];
  } catch { chats = []; }
}
/* only chats with something in them are kept, so the blank chat that waits
   on the home screen never becomes a history row - here or in KV */
function savedChats() {
  return chats.filter(chat => chat && Array.isArray(chat.messages) && chat.messages.length > 0);
}
function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(savedChats())); } catch {}
  scheduleCloudSave();
}
/* =====================================================
   CLOUD SYNC  (chat history in Cloudflare KV)
   Needs the KV binding (KV, or the older name CHAT_STORE)
   plus the ADMIN_PASSWORD.
   ===================================================== */
/* one tap: clear every chat here and in KV */
async function clearAllHistory(scope) {
  const everything = scope === "all";
  const box = $("clearAllBox");
  if (box) box.hidden = true;
  const had = chats.length;
  localWipe("");
  hideSuggestions();
  suggestOn = true;
  renderHistory();
  renderMessages();
  closeHistory();
  cancelVoice();
  setStatus(had ? "Cleared " + had + " chat" + (had === 1 ? "" : "s") + " here." : "History is already empty.");
  /* the cloud copy always goes too, so every other browser empties itself
     within a few seconds — no admin password is needed for this */
  try {
    const data = await syncCall({ action: "clear", scope: everything ? "all" : "history" });
    if (data.resetAt) rememberResetAt(data.resetAt);
    setStatus(everything
      ? "Cleared everywhere \u2713 — the KV store is empty (" + (data.removed || 0) + " keys removed)."
      : "Cleared everywhere \u2713 — chat history and counters removed from KV.");
  } catch (error) {
    dropBadPassword(error);
    setStatus("⚠️ Cleared here, but the cloud copy said: " + error.message);
  }
  setTimeout(() => {
    if (statusEl.textContent.indexOf("Cleared") >= 0) setStatus("");
  }, 6000);
}
function setupClearAll() {
  const btn = $("clearAll"), box = $("clearAllBox");
  if (!btn || !box) return;
  btn.addEventListener("click", () => { box.hidden = !box.hidden; });
  const hist = $("caHistory"), all = $("caAll"), cancel = $("caCancel");
  if (hist) hist.addEventListener("click", () => clearAllHistory("history"));
  if (all) all.addEventListener("click", () => clearAllHistory("all"));
  if (cancel) cancel.addEventListener("click", () => { box.hidden = true; });
  window.mfClearAll = clearAllHistory;
}
const cloud = { on: false, starting: false, timer: null, metaTimer: null };
/* the moment "clear all" was last pressed (kept in KV, mirrored here) */
const RESET_KEY = "mf_reset_at";
function localResetAt() {
  try { return Number(localStorage.getItem(RESET_KEY)) || 0; } catch (e) { return 0; }
}
function rememberResetAt(value) {
  try {
    if (value) localStorage.setItem(RESET_KEY, String(value));
    else localStorage.removeItem(RESET_KEY);
  } catch (e) {}
}
/* wipe this browser because another one cleared the history */
function localWipe(message) {
  chats = [];
  currentChat = null;
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(DIRTY_KEY);
    localStorage.removeItem(SYNCED_KEY);
  } catch (e) {}
  renderHistory();
  renderMessages();
  if (message) {
    setStatus(message);
    setTimeout(() => {
      if (statusEl.textContent.indexOf("cleared") >= 0 || statusEl.textContent.indexOf("Cleared") >= 0) setStatus("");
    }, 6000);
  }
}
/* same tidy-up in the browser: nothing older than CHAT_KEEP_DAYS_MS */
const CHAT_KEEP_DAYS_MS = 15 * 86400000;
function pruneLocalChats() {
  const edge = Date.now() - CHAT_KEEP_DAYS_MS;
  const before = chats.length;
  chats = chats.filter(chat => {
    if (!chat || !Array.isArray(chat.messages)) return false;
    let last = Math.max(Number(chat.updated) || 0, Number(chat.created) || 0);
    chat.messages.forEach(m => { const ts = Number(m && m.ts) || 0; if (ts > last) last = ts; });
    return !last || last >= edge;
  });
  return before - chats.length;
}
async function syncCall(payload) {
  const response = await fetchWithKv("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ password: adminPassword }, payload))
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const err = new Error(data.error || "Sync failed.");
    err.data = data;
    throw err;
  }
  return data;
}
function dropBadPassword(error) {
  if (error && error.data && error.data.needPassword) {
    adminPassword = "";
    cloud.on = false;
    try { localStorage.removeItem(ADMIN_KEY); } catch {}
  }
}
function scheduleCloudSave() {
  try { localStorage.setItem(DIRTY_KEY, "1"); } catch {}
  if (!cloud.on) return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(pushChats, 2500);
}
async function pushChats() {
  if (!cloud.on) return;
  try {
    const data = await syncCall({ action: "save", chats: savedChats(), stamp: localResetAt() });
    if (data.cleared) {
      rememberResetAt(data.resetAt);
      localWipe("🧹 The history was cleared in another browser — this browser is empty now.");
      return;
    }
    try { localStorage.removeItem(DIRTY_KEY); } catch {}
  } catch (error) {
    console.error("Chat sync failed:", error);
    dropBadPassword(error);
    setStatus("⚠️ Chat sync failed: " + error.message);
    setTimeout(() => setStatus(""), 3500);
  }
}
function lockIsUp() {
  const lock = $("lock");
  return Boolean(lock && !lock.classList.contains("hidden"));
}
/* a tiny poll: did another browser clear the history, or did old chats expire? */
async function syncMeta() {
  if (!cloud.on) return;
  try {
    const data = await syncCall({ action: "meta" });
    const serverAt = Number(data.resetAt) || 0;
    if (serverAt > localResetAt()) {
      rememberResetAt(serverAt);
      localWipe("🧹 The history was cleared in another browser — this one is empty now.");
      return;
    }
    if (pruneLocalChats()) {
      renderHistory();
      setStatus("🗓️ Chats older than 15 days were tidied away.");
      setTimeout(() => {
        if (statusEl.textContent.indexOf("15 days") >= 0) setStatus("");
      }, 5000);
      try { await syncCall({ action: "save", chats: savedChats(), stamp: localResetAt() }); } catch (e) {}
    }
  } catch (error) {}
  /* the same poll brings in models added on another phone / computer */
  refreshModelsQuiet();
}
function startMetaWatch() {
  if (cloud.metaTimer) return;
  cloud.metaTimer = setInterval(() => { syncMeta(); }, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncMeta(); });
}
async function startSync() {
  if (cloud.on || cloud.starting) return;
  /* the login is the gate: syncing only makes sense once the chat is open */
  if (lockIsUp()) return;
  cloud.starting = true;
  try {
    const synced = localStorage.getItem(SYNCED_KEY) === "1";    const dirty = synced && localStorage.getItem(DIRTY_KEY) === "1";
    if (dirty) {
      /* this browser has newer changes that were not uploaded yet */
      await syncCall({ action: "save", chats: savedChats(), stamp: localResetAt() });
    } else {
      const data = await syncCall({ action: "load" });
      const serverAt = Number(data.resetAt) || 0;
      if (serverAt > localResetAt()) {
        rememberResetAt(serverAt);
        localWipe("🧹 The history was cleared in another browser — this browser is empty now.");
        cloud.on = true;
        startMetaWatch();
        return;
      }
      if (serverAt) rememberResetAt(serverAt);
      if (data.pruned) console.log("KV tidy-up removed " + data.pruned + " old chats");
      if (Array.isArray(data.chats)) {
        /* a blank chat left over from an older build is dropped on the way in */
        let merged = data.chats.filter(c => c && Array.isArray(c.messages) && c.messages.length);
        let needPush = false;
        if (!synced) {
          /* first time: keep this browser's older chats too */
          const ids = new Set(data.chats.map(c => c.id));
          const extra = chats.filter(c => c && !ids.has(c.id) && c.messages && c.messages.length);
          merged = data.chats.concat(extra).sort((a, b) => (b.created || 0) - (a.created || 0));
          needPush = extra.length > 0;
        }
        const keepId = currentChat ? currentChat.id : null;
        chats = merged;
        /* a blank chat waiting on the home screen still exists in memory only */
        currentChat = chats.find(c => c.id === keepId) || chats[0] || null;
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(chats)); } catch {}
        if (!currentChat) createChat();
        else if (currentChat.id !== keepId) resetDocument();
        if (needPush) await syncCall({ action: "save", chats: savedChats() });
      } else {
        /* nothing on the server yet → upload what this browser has (real chats only) */
        await syncCall({ action: "save", chats: savedChats() });
      }
    }
    try {
      localStorage.setItem(SYNCED_KEY, "1");
      localStorage.removeItem(DIRTY_KEY);
    } catch {}
    cloud.on = true;
    /* the whole model list comes from KV, so a fresh browser gets it now */
    refreshModelsQuiet(true);
    startMetaWatch();
    renderMessages();
    renderHistory();
    setStatus("Chat history synced ✓");
    setTimeout(() => setStatus(""), 1800);
  } catch (error) {
    console.error("Cloud sync start failed:", error);
    dropBadPassword(error);
  } finally {
    cloud.starting = false;
  }
}
/* =====================================================
   CHATS
   ===================================================== */
function chatIsEmpty(chat) {
  return !chat || !Array.isArray(chat.messages) || chat.messages.length === 0;
}
/* A chat is only created when the open one already has messages.
   If some blank "New Chat" already exists it is re-opened instead,
   so pressing New chat never fills the list with empty chats. */
function createChat(force) {
  if (!force) {
    const blank = chats.find(item => chatIsEmpty(item));
    if (blank) {
      currentChat = blank;
      chats = [blank].concat(chats.filter(item => item !== blank));
      saveHistory();
      renderHistory();
      renderMessages();
      return false;
    }
  }
  const chat = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: "New Chat",
    created: Date.now(),
    messages: []
  };
  chats.unshift(chat);
  currentChat = chat;
  saveHistory();
  renderHistory();
  renderMessages();
  return true;
}
function resetDocument() {
  attachedImage = null;
  documentText = "";
  documentFileName = "";
  documentLangCode = "";
  documentKind = "doc";
  documentThumb = null;
  documentSent = false;
  docMsgIndex = -1;
  suggestOn = false;
  documentChip.classList.remove("show");
  updateDocUi();
}
function newChat() {
  /* while an answer is running a new chat waits: the answer must land where it was asked */
  if (busy) {
    setStatus("⏳ Please wait — the AI is still answering. You can open a new chat as soon as it finishes, or press the stop button.");
    setTimeout(() => {
      if (statusEl.textContent.indexOf("still answering") >= 0) setStatus("");
    }, 4000);
    return;
  }
  cancelVoice();
  closeHistory();
  closeMenus();
  resetDocument();
  input.value = "";
  input.style.height = "42px";
  const started = createChat();
  if (!started) {
    /* the open chat has no messages yet — do not make another one */
    setStatus("You are already in a new chat — send a message to start it.");
    setTimeout(() => {
      if (statusEl.textContent.indexOf("already in a new chat") >= 0) setStatus("");
    }, 3000);
  }
  input.focus();
}
/* the home screen: nothing open, the meadow, the sample prompts */
function goHome(keepModel) {
  closeHistory();
  closeMenus();
  cancelVoice();
  resetDocument();
  input.value = "";
  input.style.height = "42px";
  currentChat = null;
  createChat(true);          /* a fresh blank chat, so nothing is written into an old one */
  hideSuggestions();
  renderMessages();
  renderHistory();
  suggestOn = true;
  if (!keepModel) {
    /* nothing is on by default — the user picks a model from the ⚡ Models menu */
    CHAT_KEYS.forEach(k => { models[k] = false; });
    savePrefs();
    updateModelUi();
  }
  input.focus();
}
window.mfGoHome = goHome;
function openChat(id) {
  const chat = chats.find(item => item.id === id);
  if (!chat) return;
  if (chat.unread) { chat.unread = false; saveHistory(); }
  /* opening a chat counts as activity, so it stays for another 15 days */
  chat.updated = Date.now();
  currentChat = chat;
  resetDocument();
  renderMessages();
  closeHistory();
  input.focus();
}
function deleteChat(id, opts) {
  opts = opts || {};
  const idx = chats.findIndex(item => item.id === id);
  if (idx < 0) return false;
  if (!opts.skipConfirm && !window.confirm("Delete this chat history?")) return false;
  const chat = chats[idx];
  const snapshot = { chat: chat, index: idx, wasCurrent: !!(currentChat && currentChat.id === id) };
  chats = chats.filter(item => item.id !== id);
  saveHistory();
  if (snapshot.wasCurrent) {
    if (chats.length) { currentChat = chats[0]; }
    else { currentChat = null; createChat(); }
    resetDocument();
    renderMessages();
  }
  renderHistory();
  /* b61 — the 3-second Undo popup (swipe delete skips the confirm box) */
  if (!opts.skipUndo && window.mfUndoDelete) window.mfUndoDelete(snapshot);
  return true;
}
window.mfDeleteChat = function (id, opts) { return deleteChat(id, Object.assign({ skipConfirm: true }, opts || {})); };
window.mfRestoreChat = function (snapshot) {
  if (!snapshot || !snapshot.chat) return;
  if (chats.some(item => item.id === snapshot.chat.id)) return;
  chats.splice(Math.min(snapshot.index, chats.length), 0, snapshot.chat);
  if (snapshot.wasCurrent) { currentChat = snapshot.chat; resetDocument(); renderMessages(); }
  saveHistory();
  renderHistory();
};
function openHistory() {
  closeMenus();
  renderHistory();
  overlay.classList.add("show");
  drawer.classList.add("show");
}
function closeHistory() {
  drawer.classList.remove("show");
  if (!settingsPanel.classList.contains("show")) overlay.classList.remove("show");
}
function closeAllPanels() {
  drawer.classList.remove("show");
  settingsPanel.classList.remove("show");
  overlay.classList.remove("show");
}
function renderHistory() {
  historyList.innerHTML = "";
  /* ignored blank chats: a chat appears here the moment it has a message */
  const visible = savedChats();
  if (!visible.length) {
    historyList.innerHTML = '<div style="padding:18px;color:var(--muted);font-size:13px;text-align:center">No chats yet.</div>';
    return;
  }
  visible.forEach(chat => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.setAttribute("data-chat-id", chat.id);   /* b60 — press and hold to pin */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = chat.title || "New Chat";
    if (chat.unread) {
      const dot = document.createElement("span");
      dot.className = "unread-dot";
      dot.title = "A new answer is waiting here";
      title.appendChild(dot);
    }
    const date = document.createElement("div");
    date.className = "history-date";
    date.textContent = new Date(chat.created).toLocaleString();
    button.appendChild(title);
    button.appendChild(date);
    button.addEventListener("click", () => openChat(chat.id));
    /* b61 — no bin button: swipe the row right to delete (3 s Undo) */
    row.appendChild(button);
    historyList.appendChild(row);
  });
}
/* attachment = { id, name, kind, lang } (optional)
   extra = { model, img, gen, prompt } (optional) */
/* addMessageTo writes into ONE named chat, so an answer can never land in a
   chat the user switched to while the model was still writing */
function addMessageTo(chat, role, content, attachment, extra) {
  if (!chat) { if (!currentChat) createChat(); chat = currentChat; }
  if (!chat) return null;
  const message = { role, content };
  message.ts = Date.now();   /* when this message was generated (IST shown on tap) */
  if (attachment) message.attachment = attachment;
  if (extra) Object.assign(message, extra);
  chat.messages.push(message);
  if (role === "user" && chat.title === "New Chat") {
    currentChat.title = content.replace(/\\s+/g, " ").trim().slice(0, 55) || "New Chat";
  }
  chat.updated = Date.now();     /* keeps this chat alive for another 15 days */
  saveHistory();
  return message;
}
function addMessage(role, content, attachment, extra) {
  const message = addMessageTo(currentChat, role, content, attachment, extra);
  if (role === "assistant" && message) markReveal(currentChat);
  return message;
}
/* is this chat gone (deleted while its answer was being written)? */
function chatIsGone(chat) { return !chat || chats.indexOf(chat) < 0; }
function landAnswer(chat, content, extra) {
  if (chatIsGone(chat)) {
    if (!currentChat) createChat();
    addMessageTo(currentChat, "assistant", content, null, extra);
    if (currentChat) { markReveal(currentChat); renderMessages(); }
    return "";
  }
  addMessageTo(chat, "assistant", content, null, extra);
  if (currentChat === chat) { markReveal(chat); renderMessages(); return ""; }
  /* the user moved to another chat - the answer waited here, so say so */
  chat.unread = true;
  saveHistory();
  renderHistory();
  return "\u2705 Answer is ready in \u201c" + (chat.title || "another chat") + "\u201d.";
}
/* describes the currently loaded file so it can travel with a message */
function makeAttachment() {
  const id = "att" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (documentThumb) thumbs[id] = documentThumb;
  return {
    id: id,
    name: documentFileName || "file",
    kind: documentKind,
    lang: documentLangCode
  };
}
/* =====================================================
   COPY (works for both your messages and AI replies)
   ===================================================== */
async function writeClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
async function copyText(text, button) {
  const ok = await writeClipboard(text);
  if (button) {
    const original = button.dataset.label || button.innerHTML;   /* b67 — keep the symbol */
    button.dataset.label = original;
    button.textContent = ok ? "Copied ✓" : "Failed";
    button.classList.toggle("done", ok);
    setTimeout(() => {
      button.innerHTML = original;   /* b67 — the symbol is back after copying */
      button.classList.remove("done");
    }, 1400);
  }
  setStatusFor(ok ? "Copied ✓" : "Could not copy.", 1300);
}
async function regenerate() {
  if (busy || !currentChat) return;
  let lastUserIndex = -1;
  for (let i = currentChat.messages.length - 1; i >= 0; i--) {
    if (currentChat.messages[i].role === "user") { lastUserIndex = i; break; }
  }
  if (lastUserIndex < 0) return;
  const lastUser = currentChat.messages[lastUserIndex];
  /* the last request was an image → make the image again */
  if (lastUser.gen) {
    if (!models.image) {
      setStatusFor("⚠️ Turn on Z-Image Turbo to create the image again.", 2500);
      return;
    }
    currentChat.messages = currentChat.messages.slice(0, lastUserIndex + 1);
    saveHistory();
    renderMessages();
    await runImage(lastUser.prompt || "");
    return;
  }
  if (!hasChat()) {
    setStatusFor("⚠️ Turn on a chat model to regenerate a reply.", 2500);
    return;
  }
  currentChat.messages = currentChat.messages.slice(0, lastUserIndex + 1);
  saveHistory();
  renderMessages();
  await requestAssistant(true);
}
/* =====================================================
   A FRESH ANSWER IS WRITTEN OUT — top to bottom, like a pen
   ===================================================== */
const REVEAL_MS_PER_CHAR = 12, REVEAL_MIN_MS = 320, REVEAL_MAX_MS = 3600, REVEAL_TICK = 16;
let revealFor = 0, revealJob = null, revealPending = {};
function revealReduced() {
  try {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { return false; }
}
/* tapping the answer (or Esc) shows all of it at once */
function revealSkip() {
  const job = revealJob;
  if (!job) return false;
  revealJob = null;
  if (job.timer) clearTimeout(job.timer);
  if (job.caret && job.caret.parentNode) job.caret.parentNode.removeChild(job.caret);
  if (job.el) job.el.textContent = job.text;
  if (job.done) job.done();
  return true;
}
function revealStart(el, text, done) {
  const full = String(text || "");
  if (!el) { if (done) done(); return; }
  if (!full.length || revealReduced()) {
    el.textContent = full;
    if (done) done();
    return;
  }
  const target = Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, full.length * REVEAL_MS_PER_CHAR));
  const perTick = Math.max(1, Math.ceil(full.length / Math.max(1, Math.round(target / REVEAL_TICK))));
  const caret = document.createElement("span");
  caret.className = "type-caret";
  const job = { el: el, text: full, i: 0, perTick: perTick, caret: caret, timer: null, done: done };
  revealJob = job;
  el.textContent = "";
  el.appendChild(caret);
  const step = () => {
    if (revealJob !== job) return;
    if (!el.isConnected) { revealJob = null; return; }
    job.i = Math.min(full.length, job.i + job.perTick);
    const complete = job.i >= full.length;
    el.textContent = full.slice(0, job.i);
    if (!complete) {
      el.appendChild(caret);
      if (job.i % (job.perTick * 6) < job.perTick) {
        window.scrollTo({ top: document.body.scrollHeight });
      }
      job.timer = setTimeout(step, REVEAL_TICK);
      return;
    }
    revealJob = null;
    if (job.done) job.done();
  };
  step();
}
/* which answer should be typed out (its time-stamp), 0 = none */
function markReveal(chat) {
  const list = chat && chat.messages ? chat.messages : [];
  const last = list.length ? list[list.length - 1] : null;
  if (last && last.role === "assistant" && String(last.content || "").length > 1) revealFor = last.ts;
}
function startAnswerReveal() {
  if (!revealFor) return;
  const stamp = revealFor;
  revealFor = 0;
  const job = revealPending[stamp];
  revealPending = {};
  if (!job) return;
  revealStart(job.el, job.text, null);
}
window.mfRevealSkip = revealSkip;

function renderMessages() {
  messagesEl.innerHTML = "";
  const hasMessages = !!(currentChat && currentChat.messages.length);
  /* home screen only while the chat is empty */
  document.body.classList.toggle("chatting", hasMessages);
  /* sparkle effect runs only on the empty home screen */
  fxSetEnabled(!hasMessages);
  if (!hasMessages) return;
  currentChat.messages.forEach(message => {
    const isUser = message.role === "user";
    const row = document.createElement("div");
    row.className = "message " + (isUser ? "user" : "assistant");
    const wrapper = document.createElement("div");
    wrapper.className = "message-wrap " + (isUser ? "user" : "");
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (!isUser) {
      /* single tap on an AI reply reveals when it was generated */
      bubble.classList.add("tappable");
      bubble.addEventListener("click", function () {
        /* while it is still being written, a tap shows all of it at once */
        if (revealSkip()) return;
        showTimeChip(message, bubble);
      });
    }
    if (message.attachment) {
      /* the file travels together with the prompt */
      row.classList.add("has-attach");
      const att = document.createElement("div");
      att.className = "attach";
      const thumb = thumbs[message.attachment.id];
      if (thumb) {
        const img = document.createElement("img");
        img.src = thumb;
        img.alt = message.attachment.name || "attached image";
        img.addEventListener("click", () => openPreview(thumb, message.attachment.name || "picture.png", "image", false,
          "🖼️ " + (message.attachment.name || "Your upload"), { message: message }));
        att.appendChild(img);
      }
      /* one thin line, and never the same file name twice: for a picture the
         card just says "Picture" (the full name lives behind a tap) */
      const isPic = message.attachment.kind === "image";
      const label = document.createElement("div");
      label.className = "attach-label";
      label.textContent = isPic ? "Picture" : (message.attachment.name || "Document");
      if (message.attachment.scaled) label.textContent += " · " + message.attachment.scaled + "%";
      label.title = message.attachment.name || "";
      att.appendChild(label);
      if (message.attachment.lang) {
        const tag = document.createElement("span");
        tag.className = "attach-lang";
        tag.textContent = langName(message.attachment.lang);
        att.appendChild(tag);
      }
      att.title = message.attachment.name || "";
      bubble.appendChild(att);
    }
    /* picture made by Z-Image Turbo (kept in memory only) */
    let imageSrc = "";
    if (message.img) {
      imageSrc = genImages[message.img.id] || message.img.url || "";
      if (imageSrc) {
        const pic = document.createElement("img");
        pic.className = "gen-img";
        pic.src = imageSrc;
        pic.alt = message.img.prompt || "Generated image";
        pic.addEventListener("load", () => {
          window.scrollTo({ top: document.body.scrollHeight });
        });
        pic.addEventListener("click", () => openPreview(imageSrc, "mindfusion-image.png", "image", false,
          "🎨 " + (message.img.prompt || "Image created here"), { message: message }));
        bubble.appendChild(pic);
      } else {
        const note = document.createElement("div");
        note.className = "gen-note";
        note.textContent = "🖼️ This picture was not saved. Generated images stay only until you reload the page.";
        bubble.appendChild(note);
      }
    }
    /* the thinking lives in its own collapsed line, above the answer:
       the answer text itself stays clean */
    if (!isUser && message.reasoning) {
      const det = document.createElement("details");
      det.className = "thinking";
      const sum = document.createElement("summary");
      const secs = message.thinkMs ? Math.max(1, Math.round(message.thinkMs / 1000)) : 0;
      sum.textContent = "\uD83D\uDCAD Thinking" + (secs ? " \u00B7 " + secs + "s" : "");
      det.appendChild(sum);
      const inner = document.createElement("div");
      inner.className = "thinking-body";
      inner.textContent = message.reasoning;
      det.appendChild(inner);
      bubble.appendChild(det);
    }
    const body = document.createElement("div");
    if (!isUser && message.ts && message.ts === revealFor) {
      /* a fresh answer is written out from the top down */
      body.className = "type-body";
      row.setAttribute("data-reveal", String(message.ts));
      revealPending[message.ts] = { el: body, text: message.content };
    } else {
      body.textContent = message.content;
    }
    bubble.appendChild(body);
    wrapper.appendChild(bubble);
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "message-action";
    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.title = "Copy";
    copyBtn.setAttribute("aria-label", "Copy");
    copyBtn.addEventListener("click", () => copyText(message.content, copyBtn));
    actions.appendChild(copyBtn);
    if (!isUser && imageSrc) {
      const dl = document.createElement("a");
      dl.className = "message-action";
      dl.textContent = "Download";
      dl.href = imageSrc;
      dl.download = "image.png";
      dl.target = "_blank";
      dl.rel = "noopener";
      actions.appendChild(dl);
    }
    if (!isUser) {
      const regenBtn = document.createElement("button");
      regenBtn.type = "button";
      regenBtn.className = "message-action";
      regenBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
      regenBtn.title = message.img ? "Create again" : "Regenerate";
      regenBtn.setAttribute("aria-label", regenBtn.title);
      regenBtn.addEventListener("click", regenerate);
      actions.appendChild(regenBtn);
      /* b66 — the two buttons swap seats: Regenerate takes Copy's place,
         Copy takes Regenerate's; handlers and icons are untouched */
      actions.insertBefore(regenBtn, actions.firstChild);
      actions.appendChild(copyBtn);
      /* b83 — Listen: immediately left of the model name */
      const listenBtn = document.createElement("button");
      listenBtn.type = "button";
      listenBtn.className = "message-action mf-listen";
      listenBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5L11 19z" fill="currentColor" stroke="none"/><path d="M15.5 8.7a4.6 4.6 0 0 1 0 6.6"/><path d="M18.4 6a8.8 8.8 0 0 1 0 12"/></svg>';
      listenBtn.title = "Listen";
      listenBtn.setAttribute("aria-label", "Listen");
      listenBtn.setAttribute("aria-pressed", "false");
      listenBtn.addEventListener("click", function () { if (window.mfListenToggle) window.mfListenToggle(message.content, listenBtn); });
      actions.appendChild(listenBtn);
      if (message.model) {
        const tag = document.createElement("span");
        tag.className = "model-tag";
        tag.textContent = message.model;
        actions.appendChild(tag);
      }
    }
    wrapper.appendChild(actions);
    row.appendChild(wrapper);
    messagesEl.appendChild(row);
  });
  window.scrollTo({ top: document.body.scrollHeight });
  if (revealFor) startAnswerReveal();
}
/* =====================================================
   TAP-TIME — one tap on an AI reply shows the moment it
   was generated, in Indian Standard Time, for ~3.5s.
   ===================================================== */
let timeChip = null;
let timeChipTimer = 0;
function fmtIST(ts) {
  const f = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
  return f.format(new Date(ts));
}
function showTimeChip(message, anchorEl) {
  if (!message) return;
  /* b90 - the time lives inside this reply's Copy/Regenerate row:
     small plain text that matches those buttons, no box at all */
  var rowEl = anchorEl;
  while (rowEl && !(rowEl.classList && rowEl.classList.contains("message"))) rowEl = rowEl.parentElement;
  var acts = rowEl ? rowEl.querySelector(".message-actions") : null;
  if (!acts) return;
  if (rowEl.classList) rowEl.classList.add("mf-actions-on");
  if (!timeChip || !timeChip.classList || !timeChip.classList.contains("mf-time-inline")) {
    timeChip = document.createElement("span");
    timeChip.className = "mf-time-inline";
    timeChip.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span class="mf-time-txt"></span>';
  }
  var copyB = null;
  var ab = acts.querySelectorAll("button.message-action");
  for (var bi = 0; bi < ab.length; bi++) { if (ab[bi].title === "Copy") { copyB = ab[bi]; break; } }
  if (copyB && copyB.nextSibling) acts.insertBefore(timeChip, copyB.nextSibling);
  else acts.appendChild(timeChip);
  timeChip.querySelector(".mf-time-txt").textContent = message.ts ? fmtIST(message.ts) : "time not saved";
  timeChip.classList.add("show");
  clearTimeout(timeChipTimer);
  timeChipTimer = setTimeout(function () {
    timeChip.classList.remove("show");
  }, 3500);
}
/* =====================================================
   AI TYPING INDICATOR  — three small dots that wave
   up and down one after another while the AI thinks.
   Shown the moment the message is sent, hidden the
   moment the answer (or an error) arrives.
   ===================================================== */
let typingRow = null;
let thinkTimer = null;
let thinkStart = 0;
let thinkSteps = [];
const THINK_STEPS = [
  "\uD83D\uDCD6 Reading your question…",
  "\uD83E\uDDE0 Thinking about the best answer…",
  "\u270D\uFE0F Writing it in your language…"
];
function thinkSeconds() {
  return Math.max(0, Math.round((Date.now() - thinkStart) / 1000));
}
function paintThinkSheet() {
  if (!typingRow) return;
  const sheet = typingRow.querySelector(".think-sheet");
  const secs = typingRow.querySelector(".think-secs");
  if (secs) secs.textContent = thinkSeconds() + "s";
  if (!sheet || sheet.hidden) return;
  const stage = Math.min(THINK_STEPS.length - 1, Math.floor(thinkSeconds() / 7));
  sheet.innerHTML = "";
  THINK_STEPS.forEach((step, i) => {
    const line = document.createElement("div");
    line.className = "think-step" + (i < stage ? " done" : i === stage ? " now" : "");
    line.textContent = (i < stage ? "\u2713 " : i === stage ? "\u25CF " : "\u25CB ") + step;
    sheet.appendChild(line);
  });
  const note = document.createElement("div");
  note.className = "think-note";
  note.textContent = "The answer will appear below when it is ready. Nothing of this panel is mixed into the answer.";
  sheet.appendChild(note);
}
function showTyping(label) {
  hideTyping();
  typingRow = document.createElement("div");
  typingRow.className = "message assistant typing-row think-live";
  typingRow.setAttribute("aria-label", "The AI is analyzing your question");
  const wrap = document.createElement("div");
  wrap.className = "message-wrap";
  const bubble = document.createElement("div");
  bubble.className = "think-card";
  /* ---- the row itself: 💡 Analyzing… › with Skip ---- */
  const head = document.createElement("div");
  head.className = "think-head";
  const lead = document.createElement("span");
  lead.className = "think-lead";
  lead.textContent = "\u2304";
  head.appendChild(lead);
  const ico = document.createElement("span");
  ico.className = "think-ico";
  ico.textContent = "\uD83D\uDCA1";
  head.appendChild(ico);
  const title = document.createElement("span");
  title.className = "think-title";
  title.textContent = "Thinking…";
  head.appendChild(title);
  const dots = document.createElement("span");
  dots.className = "think-dots";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "tdot";
    dots.appendChild(dot);
  }
  head.appendChild(dots);
  const secs = document.createElement("span");
  secs.className = "think-secs";
  secs.textContent = "0s";
  head.appendChild(secs);
  const chev = document.createElement("span");
  chev.className = "think-chev";
  chev.textContent = "\u203A";
  head.appendChild(chev);
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "think-skip";
  skip.textContent = "Skip";
  skip.title = "Skip this answer";
  skip.addEventListener("click", event => {
    event.stopPropagation();
    stopRequest();
  });
  head.appendChild(skip);
  const sheet = document.createElement("div");
  sheet.className = "think-sheet";
  sheet.hidden = true;
  sheet.setAttribute("aria-label", "What the AI is doing");
  head.addEventListener("click", () => {
    sheet.hidden = !sheet.hidden;
    head.classList.toggle("open", !sheet.hidden);
    paintThinkSheet();
  });
  bubble.appendChild(head);
  /* the stream of thought sits right under the row, like a terminal */
  bubble.appendChild(buildThinkStream());
  bubble.classList.add("mf-think-closed");
  const earthStage = document.createElement("div");
  earthStage.className = "mf-earth-stage";
  earthStage.innerHTML = '<div class="mf-earth-wrap"><svg class="mf-earth-svg" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="mfEg2" cx="35%" cy="28%" r="88%"><stop offset="0%" stop-color="#9BDCFF"/><stop offset="52%" stop-color="#2E90FF"/><stop offset="100%" stop-color="#144FA6"/></radialGradient></defs><circle cx="50" cy="50" r="45" fill="url(#mfEg2)"/><g fill="#35D49A" opacity=".9"><path d="M27 36 q8-9 17-5 q-2 9-10 10 q-8 1-7-5z"/><path d="M58 63 q10-6 16 1 q-3 8-12 7 q-7-1-4-8z"/><path d="M63 24 q7-4 11 1 q-2 6-9 5 q-5-1-2-6z"/><path d="M33 66 q6-3 9 2 q-3 5-8 4 q-4-2-1-6z"/></g><g class="mf-earth-meridians" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6"><ellipse cx="50" cy="50" rx="30" ry="45"/><ellipse cx="50" cy="50" rx="14" ry="45"/><ellipse cx="50" cy="50" rx="45" ry="30"/><ellipse cx="50" cy="50" rx="45" ry="14"/><line x1="5" y1="50" x2="95" y2="50"/></g><circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1.6"/></svg><span class="mf-orbit"><i></i><i></i><i></i><i></i><i></i></span><span class="mf-spark" style="top:-3px;right:1px">✦</span><span class="mf-spark" style="bottom:0;left:-3px">✦</span></div>'
  bubble.addEventListener("click", function (ev) {
    var hd = ev.target && ev.target.closest ? ev.target.closest(".think-head") : null;
    if (!hd) return;
    if (ev.target.closest && ev.target.closest(".think-skip")) return;
    var open = bubble.classList.toggle("mf-think-open");
    bubble.classList.toggle("mf-think-closed", !open);
    if (open && window.mfLiveBox) { try { window.mfLiveBox(); } catch (e) {} }
  });
  var ttl = bubble.querySelector(".think-title");
  if (ttl && ttl.parentNode) ttl.parentNode.insertBefore(earthStage, ttl);
  else bubble.insertBefore(earthStage, bubble.querySelector(".think-stream"));

  bubble.appendChild(sheet);
  const name = document.createElement("span");
  name.className = "typing-model";
  name.textContent = label || "The AI is working on your question";
  bubble.appendChild(name);
  wrap.appendChild(bubble);
  typingRow.appendChild(wrap);
  /* the seconds tick while the model works */
  thinkStart = Date.now();
  thinkSteps = [];
  clearInterval(thinkTimer);
  thinkTimer = setInterval(paintThinkSheet, 1000);
  paintThinkSheet();
  /* and the thought is typed out, row after row */
  startThinkStream();
  /* it always sits right under the query that was just sent */
  messagesEl.appendChild(typingRow);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  window.scrollTo({ top: document.body.scrollHeight });
}
/* =====================================================
   STOP A RUNNING ANSWER  (like every AI app has)
   ===================================================== */
function isAbort(error) {
  const m = String((error && (error.name || error.message)) || "");
  return m.indexOf("Abort") >= 0 || m.indexOf("abort") >= 0;
}
function stopRequest() {
  if (abortCtl) { try { abortCtl.abort(); } catch (e) {} }
  abortCtl = null;
  hideTyping();
  setBusy(false);
  setStatus("Stopped ✋");
  setTimeout(() => {
    if (statusEl.textContent.indexOf("Stopped") >= 0) setStatus("");
  }, 1600);
  input.focus();
}
function hideTyping() {
  clearInterval(thinkTimer);
  thinkTimer = null;
  stopThinkStream();
  if (typingRow) {
    if (typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
    typingRow = null;
  }
}
/* shows a note that disappears by itself - and only if it is still the
   note on screen, so a newer message can never be wiped by an old timer */
function setStatusFor(text, ms, active = false) {
  setStatus(text, active);
  setTimeout(() => { if (statusEl.textContent === text) setStatus(""); }, ms);
}
function setStatus(text, active = false) {
  statusEl.innerHTML = "";
  if (!text) return;
  const dot = document.createElement("span");
  dot.className = "dot";
  if (active) dot.style.animation = "pulse 1s infinite";
  const label = document.createElement("span");
  label.textContent = text;
  statusEl.appendChild(dot);
  statusEl.appendChild(label);
}
/* the controller of the request that is running right now (for Stop) */
let abortCtl = null;
function setBusy(value) {
  busy = value;
  /* while a request of your own is running, the send button turns into Stop */
  const canStop = value && Boolean(abortCtl);
  sendBtn.classList.toggle("stop", canStop);
  sendBtn.disabled = value && !canStop;
  sendBtn.title = canStop ? "Stop this answer" : "Send";
  sendBtn.setAttribute("aria-label", canStop ? "Stop this answer" : "Send");
  uploadBtn.disabled = value;
  micBtn.disabled = value;
  trBtn.disabled = value;
  imgBtn.disabled = value;
  if (value && listening) cancelVoice();
}
/* =====================================================
   AI REQUEST  (Sarvam 105B / Qwen / Gemini / GLM /
   DeepSeek — whichever chat model is ON)
   ===================================================== */
async function requestAssistant(regenerateMode = false) {
  if (busy || !currentChat) return;
  /* remember the chat that asked - the answer always comes back here, even if
     the user opens or switches to another chat while the model is writing */
  const targetChat = currentChat;
  const modelKey = activeChat();
  if (!modelKey) {
    setStatusFor("⚠️ Turn on a chat model from the ⚡ Models menu first.", 2500);
    return;
  }
  abortCtl = new AbortController();
  setBusy(true);
  /* the thinking animation is shown inside the chat, under the message, so the
     bottom line stays free for real notes and errors */
  setStatus("");
  showTyping((regenerateMode ? "Regenerating with " : "Thinking with ") + (MODEL_NAMES[modelKey] || "AI"));
  let note = "";
  try {
    /* when a file is attached, only the conversation from the file message
       onward is sent, so old unrelated topics cannot confuse the answer */
    let source = targetChat.messages;
    if (documentText && docMsgIndex >= 0 && docMsgIndex < source.length) {
      source = source.slice(docMsgIndex);
    }
    /* picture requests and their results are not sent to the chat model */
    const payloadMessages = source
      .filter(m => !m.gen && !m.img)
      .map(m => ({
        role: m.role,
        content: m.attachment
          ? "[Attached file: " + (m.attachment.name || "file") + "]\\n" + m.content
          : m.content
      }));
    if (!payloadMessages.length) throw new Error("There is no text to send to the AI.");
    const response = await fetchWithKv("/api/chat", {
      method: "POST",
      signal: abortCtl ? abortCtl.signal : undefined,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: payloadMessages,
        documentContext: documentText,
        documentLanguage: documentLangCode,
        answerLanguage: answerLang,
        image: attachedImage,
        /* b58 — every attached picture goes along, and the answer streams back */
        images: (window.mfAttachedList || []).filter(p => p && p.dataUrl),
        model: modelKey,
        modelConfig: localModelPayload(modelKey),
        stream: true
      })
    });
    let data;
    if (response.ok && (response.headers.get("content-type") || "").indexOf("text/event-stream") >= 0 &&
        typeof window.mfReadStream === "function") {
      /* the model is writing right now: show its own words as they arrive */
      data = await window.mfReadStream(response, abortCtl ? abortCtl.signal : undefined);
      if (!data) data = {};
      if (!data.ok) throw new Error(data.error || "The answer stopped before it finished.");
    } else {
      data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Request failed.");
    }
    if (data.truncated) {
      note = "ℹ️ The document is very long, so only the first part was analysed.";
    }
    if (data.usage) {
      recordUsage({
        chats: 1,
        prompt: data.usage.prompt,
        completion: data.usage.completion
      });
    } else {
      recordUsage({ chats: 1 });
    }
    const thinkMs = thinkSeconds() * 1000;
    hideTyping();
    if (window.mfTouchActivity) window.mfTouchActivity();
    const awayNote = landAnswer(targetChat, data.content || "No response received.", {
      model: data.model || MODEL_NAMES[modelKey] || "",
      reasoning: String(data.reasoning || "").trim().slice(0, 4000),
      thinkMs: thinkMs
    });
    if (awayNote) note = awayNote;
    renderHistory();
  } catch (error) {
    hideTyping();
    if (isAbort(error)) {
      note = "Stopped ✋";
    } else {
      const errNote = landAnswer(targetChat, "⚠️ " + (error.message || "Something went wrong."), {});
      if (errNote) note = errNote;
    }
  } finally {
    abortCtl = null;
    hideTyping();
    setBusy(false);
    setStatus(note);
    /* the note disappears by itself */
    if (note) {
      setTimeout(() => {
        if (statusEl.textContent === note) setStatus("");
      }, 6000);
    }
    input.focus();
  }
}
async function sendMessage() {
  if (busy) { stopRequest(); return; }
  if (window.mfTouchActivity) window.mfTouchActivity();
  closeMenus();
  /* no chat model is ON → Enter translates or creates an image */
  if (!hasChat()) {
    if (models.mayura) { translateTyped(); return; }
    if (models.image) { generateTyped(); return; }
    setStatus("⚠️ Turn on a model from the ⚡ Models menu first.");
    setTimeout(() => setStatus(""), 2500);
    return;
  }
  /* stop voice input first so late voice results cannot refill the box */
  if (listening) cancelVoice();
  const text = input.value.trim();
  if (!text) return;
  if (!currentChat) createChat();
  /* a question was asked → sample prompts disappear */
  hideSuggestions();
  /* the first message after an upload carries the file with it */
  let attachment = null;
  if ((documentText || attachedImage) && !documentSent) {
    attachment = makeAttachment();
  }
  const sentImage = Boolean(attachedImage);
  addMessage("user", text, attachment);
  if (attachment) {
    docMsgIndex = currentChat.messages.length - 1;
    documentSent = true;
  }
  input.value = "";
  input.style.height = "42px";
  renderMessages();
  await requestAssistant(false);
  if (sentImage) {
    /* the pictures are in the chat now — the small box goes away */
    attachedImage = null;
    if (window.mfClearPictures) window.mfClearPictures();
    try { window.dispatchEvent(new Event("mf-chat-sent")); } catch (error) {}
    updateAttachMini();
  }
}
/* =====================================================
   IMAGE CREATION  (Z-Image Turbo through the 0G key)
   ===================================================== */
async function generateTyped() {
  if (busy) return;
  if (!models.image) return;
  if (listening) cancelVoice();
  const text = input.value.trim();
  if (!text) {
    setStatusFor("Describe the picture you want, then press Generate image.", 2400);
    return;
  }
  if (text.length > MAX_IMAGE_PROMPT) {
    setStatus("⚠️ The description is too long (max " + MAX_IMAGE_PROMPT + " characters).");
    setTimeout(() => setStatus(""), 3200);
    return;
  }
  if (!currentChat) createChat();
  hideSuggestions();
  closeMenus();
  addMessage("user", "🎨 " + text, null, { gen: true, prompt: text });
  input.value = "";
  input.style.height = "42px";
  renderMessages();
  await runImage(text);
}
/* the user message is already in the chat; this adds the picture */
async function runImage(prompt) {
  if (busy || !prompt) return;
  const targetChat = currentChat;   /* the picture belongs to this chat, always */
  abortCtl = new AbortController();
  setBusy(true);
  setStatus("Creating your image with " + IMAGE_LABEL + "...", true);
  let note = "";
  try {
    const response = await fetchWithKv("/api/image", {
      method: "POST",
      signal: abortCtl ? abortCtl.signal : undefined,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt, size: imgSize })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Image creation failed.");
    }
    const id = "img" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    /* the picture itself stays in memory only (it is too big to save) */
    genImages[id] = data.image;
    const awayPic = landAnswer(targetChat, "🎨 Image created from your description.", {
      model: data.model || IMAGE_LABEL,
      img: { id: id, prompt: prompt, url: data.isData ? "" : data.image }
    });
    recordUsage({ img: 1 });
    note = awayPic || ("Image ready ✓ · " + (data.model || IMAGE_LABEL));
  } catch (error) {
    if (isAbort(error)) note = "Stopped ✋";
    else landAnswer(targetChat, "⚠️ " + (error.message || "Image creation failed."), {});
  } finally {
    abortCtl = null;
    setBusy(false);
    if (chatIsGone(targetChat)) renderMessages();
    renderHistory();
    setStatus(note);
    if (note) {
      setTimeout(() => {
        if (statusEl.textContent === note) setStatus("");
      }, 4000);
    }
    input.focus();
  }
}
/* =====================================================
   TRANSLATE  (Sarvam Mayura / Sarvam-Translate)
   ===================================================== */
function batchText(text, size) {
  const lines = String(text || "").replace(/\\r/g, "").split("\\n");
  const out = [];
  let cur = "";
  lines.forEach(original => {
    let line = original;
    while (line.length > size) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(line.slice(0, size));
      line = line.slice(size);
    }
    if (cur.length + line.length + 1 > size) {
      out.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\\n" + line : line;
    }
  });
  if (cur) out.push(cur);
  return out.filter(b => b.trim());
}
function modelLabel(model) {
  if (model === "mayura:v1") return "Mayura v1";
  if (model === "sarvam-translate:v1") return "Sarvam-Translate v1";
  return "";
}
async function translateLong(text, from, to) {
  const batches = batchText(text, 6000);
  const parts = [];
  let chars = 0;
  let model = "";
  for (let i = 0; i < batches.length; i++) {
    setStatus("Translating " + (i + 1) + "/" + batches.length + "...", true);
    const response = await fetchWithKv("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: batches[i], source: from, target: to })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Translation failed.");
    }
    parts.push(data.translation);
    chars += data.chars || 0;
    if (data.model && data.model !== "none") model = data.model;
  }
  if (chars) recordUsage({ tr: chars });
  return { text: parts.join("\\n"), model: model };
}
async function translateTyped() {
  if (busy) return;
  if (!models.mayura) return;
  if (listening) cancelVoice();
  const text = input.value.trim();
  if (!text) {
    setStatus("Type or speak the text you want to translate.");
    setTimeout(() => setStatus(""), 2200);
    return;
  }
  if (!currentChat) createChat();
  hideSuggestions();
  closeMenus();
  addMessage("user", text);
  input.value = "";
  input.style.height = "42px";
  renderMessages();
  setBusy(true);
  setStatus("Translating...", true);
  let note = "";
  try {
    const out = await translateLong(text, trFrom, trTo);
    addMessage("assistant", out.text, null, out.model ? { model: modelLabel(out.model) } : null);
    if (out.model) note = "Translated ✓ · " + modelLabel(out.model);
  } catch (error) {
    addMessage("assistant", "⚠️ " + (error.message || "Translation failed."));
  } finally {
    setBusy(false);
    renderMessages();
    renderHistory();
    setStatus(note);
    input.focus();
  }
}
/* =====================================================
   UPLOAD DIALOG  (input language + output language)
   ===================================================== */
function getAction() {
  if (models.mayura && models.vision) {
    const r = document.querySelector('input[name="dlgAction"]:checked');
    return r ? r.value : "translate";
  }
  return models.mayura ? "translate" : "analyze";
}
function updateDlgNote() {
  const action = getAction();
  const from = dlgFrom.value;
  const to = dlgTo.value;
  let text = "";
  if (action === "translate") {
    text = "Sarvam Vision reads the file first, then it is translated into " + langName(to) + ". ";
    if (from === "auto") {
      text += "Model: Mayura v1 or Sarvam-Translate v1, chosen automatically.";
    } else if (MAYURA_SET.indexOf(from) >= 0 && MAYURA_SET.indexOf(to) >= 0) {
      text += "Model: Mayura v1.";
    } else {
      text += "Model: Sarvam-Translate v1 (supports all 22 Indian languages).";
    }
  } else {
    text = "Sarvam Vision will read the file and show what it says. ";
    text += hasChat()
      ? "You can then ask follow-up questions — " + (MODEL_NAMES[activeChat()] || "the AI") + " answers in " + langName(to) + "."
      : "Turn on a chat model if you want follow-up answers in " + langName(to) + ".";
  }
  dlgNote.textContent = text;
}
function applyDialogDefaults() {
  const action = getAction();
  dlgFrom.value = action === "translate" ? trFrom : visLang;
  dlgTo.value = action === "translate" ? trTo : answerLang;
  updateDlgNote();
}
function openDialog(file) {
  pendingFile = file;
  dlgTitle.textContent = "📄 " + file.name;
  const both = models.mayura && models.vision;
  dlgActions.style.display = both ? "flex" : "none";
  if (both) {
    const r = document.querySelector('input[name="dlgAction"][value="translate"]');
    if (r) r.checked = true;
  }
  applyDialogDefaults();
  dialogBg.classList.add("show");
}
function closeDialog(cancelled) {
  dialogBg.classList.remove("show");
  if (cancelled) {
    pendingFile = null;
    fileInput.value = "";
  }
}
function confirmDialog() {
  const file = pendingFile;
  if (!file) { closeDialog(true); return; }
  const action = getAction();
  const from = dlgFrom.value;
  const to = dlgTo.value;
  if (action === "translate") {
    trFrom = from;
    trTo = to;
  } else {
    visLang = from;
    setAnswerLanguage(to, true);
  }
  savePrefs();
  syncSelects();
  dialogBg.classList.remove("show");
  pendingFile = null;
  processFile(file, from, to, action);
}
function onFileChosen(file) {
  if (!file) return;
  const okType = ["application/pdf", "image/png", "image/jpeg", "image/jpg"].indexOf(file.type) >= 0;
  if (!okType) {
    setStatus("⚠️ Only PDF, PNG and JPG/JPEG files are supported.");
    setTimeout(() => setStatus(""), 3500);
    fileInput.value = "";
    return;
  }
  /* b58 — nothing is switched on behind the user's back.  A file goes to the
     model that is already chosen; Vision only reads a file if the user turned
     it on themselves. */
  closeMenus();
  openDialog(file);
}
/* =====================================================
   DOCUMENT  (Sarvam Vision)
   ===================================================== */
function chooseFile() {
  if (busy) return;
  fileInput.click();
}
async function runOcr(file, lang) {
  const form = new FormData();
  form.append("file", file);
  form.append("language", lang);
  const uploadResponse = await fetchWithKv("/api/document-upload", { method: "POST", body: form });
  const uploadData = await uploadResponse.json();
  if (!uploadResponse.ok || !uploadData.ok) {
    throw new Error(uploadData.error || "Document upload failed.");
  }
  recordUsage({ docs: 1 });
  const jobId = uploadData.jobId;
  if (!jobId) throw new Error("No document job ID was returned.");
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const response = await fetchWithKv("/api/document-status?jobId=" + encodeURIComponent(jobId));
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      const err = new Error(data.error || "Document processing failed.");
      if (data.done && response.status === 422) err.attemptFailed = true;
      throw err;
    }
    if (!data.done) {
      setStatus("Reading file... " + (attempt + 1) + "/90", true);
      continue;
    }
    return data.text || "";
  }
  throw new Error("Document processing timed out.");
}
async function extractWithDetection(file) {
  const tried = [];
  let next = "hi-IN";
  let best = null;
  let lastError = null;
  for (let round = 0; round < MAX_OCR_ATTEMPTS && next; round++) {
    tried.push(next);
    if (round > 0) {
      setStatus("Detecting language... trying " + langName(next) + "...", true);
    }
    let text = "";
    let analysis = { script: null, lang: null, ratio: 0, letters: 0 };
    try {
      text = await runOcr(file, next);
      analysis = analyzeText(text);
    } catch (error) {
      lastError = error;
      if (!error.attemptFailed) throw error;
    }
    const score = analysis.letters * analysis.ratio;
    if (text.trim() && (!best || score > best.score)) {
      best = { text, lang: next, score };
    }
    if (isGoodResult(next, analysis)) {
      best = { text, lang: next, score };
      break;
    }
    let candidate = analysis.letters > 0 ? analysis.lang : null;
    if (!candidate || tried.includes(candidate)) {
      candidate = FALLBACK_ORDER.find(l => !tried.includes(l)) || null;
    }
    next = candidate;  }
  if (!best || !best.text.trim()) {
    throw lastError || new Error("No readable text was found in this file.");
  }
  return { text: best.text, lang: best.lang, tried };
}
/* the file is kept as-is so the chosen model can read it directly */
let attachedImage = null;   /* { name, mime, dataUrl } */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}
async function attachFileDirectly(file) {
  try {
    setStatus("Attaching the file...", true);
    const dataUrl = await fileToDataUrl(file);
    attachFileDataUrl(dataUrl, file.name, file.type || "");
  } catch (error) {
    setStatus("⚠️ " + (error.message || "Could not attach the file."));
    setTimeout(() => setStatus(""), 3000);
  }
  fileInput.value = "";
}
/* the same attaching, but from a picture the browser already holds — this is
   what the crop sheet hands over, so the cropped picture is what is attached */
function attachFileDataUrl(dataUrl, name, mime) {
  attachedImage = { name: name, mime: mime || "", dataUrl: dataUrl };
  /* b58 — every picture the user attaches is kept in one list, so several can
     travel with the question and he can slide through them */
  try {
    if ((mime || "").indexOf("image/") === 0 && window.mf58 && window.mf58.rememberPicture) {
      window.mf58.rememberPicture({ name: name, mime: mime || "", dataUrl: dataUrl });
    }
  } catch (error) { /* the list is a convenience: never block the attach */ }
  /* this file is read by the chosen model alone: drop any older reading */
  documentText = "";
  documentSent = false;
  docMsgIndex = -1;
  /* b60 — the three ready prompts are there but stay CLOSED, so the home
     screen is clean after an upload: the 💡 button opens them on a tap */
  suggestOn = true;
  suggestOpen = false;
  documentKind = (mime || "").indexOf("image/") === 0 ? "image" : "doc";
  documentFileName = name;
  documentLangCode = "";
  documentThumb = documentKind === "image" ? dataUrl : null;
  documentName.textContent = (documentKind === "image" ? "🖼️ " : "📄 ") + name +
    " · read directly by " + (MODEL_NAMES[activeChat()] || "the chosen model");
  documentChip.classList.add("show");
  updateAttachMini();
  renderSuggestions();
  /* nothing is sent on upload: the file waits here until Send is pressed */
  setStatus("📎 Attached — press Send when you are ready and it goes to " + (MODEL_NAMES[activeChat()] || "the chosen model") + ".");
  setTimeout(() => {
    if (statusEl.textContent.indexOf("Attached — press Send") >= 0) setStatus("");
  }, 4500);
}
/* Sarvam Vision turned the file into text: that text IS the analysis */
function postVisionAnalysis() {
  const text = (documentText || "").trim();
  if (!text) return;
  if (!currentChat) createChat();
  const NL = String.fromCharCode(10);
  const shown = text.length > 4000 ? text.slice(0, 4000) + NL + NL + "… (the rest is kept for your questions)" : text;
  addMessage("user", "📄 " + documentFileName + " · " + langName(documentLangCode), makeAttachment());
  addMessage("assistant", "📄 **Sarvam Vision read the file**" + NL + NL + shown, null, { model: "Sarvam Vision" });
  documentSent = true;
  docMsgIndex = currentChat.messages.length - 2;
  saveHistory();
  renderMessages();
  renderHistory();
  suggestOn = true;
  renderSuggestions();
  setStatus("Read by Sarvam Vision ✓ — ask anything about it below");
  setTimeout(() => {
    if (statusEl.textContent.indexOf("Read by Sarvam Vision") >= 0) setStatus("");
  }, 5000);
}
async function processFile(file, from, to, action) {
  if (!file) return;
  setBusy(true);
  hideSuggestions();
  setStatus("Uploading...", true);
  let note = "";
  let result = null;
  try {
    if (from === "auto") {
      result = await extractWithDetection(file);
    } else {
      const text = await runOcr(file, from);
      if (!text.trim()) throw new Error("No readable text was found in this file.");
      result = { text: text, lang: from };
    }
    documentText = result.text;
    documentFileName = file.name;
    documentLangCode = result.lang;
    documentKind = (file.type || "").indexOf("image/") === 0 ? "image" : "doc";
    /* a fresh file: not attached to any message yet */
    documentSent = false;
    docMsgIndex = -1;
    documentThumb = documentKind === "image" ? URL.createObjectURL(file) : null;
    documentName.textContent = "📄 " + file.name + " · " + langName(result.lang);
    documentChip.classList.add("show");
  } catch (error) {
    resetDocument();
    setStatus("⚠️ " + (error.message || "Upload failed."));
    setBusy(false);
    fileInput.value = "";
    return;
  }
  try {
    if (action === "translate") {
      if (!currentChat) createChat();
      /* the file and its translation request are one message */
      addMessage("user", "🌐 " + file.name + " → " + langName(to), makeAttachment());
      docMsgIndex = currentChat.messages.length - 1;
      documentSent = true;
      renderMessages();
      setStatus("Translating with Sarvam...", true);
      try {
        const out = await translateLong(result.text, from, to);
        addMessage("assistant", out.text, null, out.model ? { model: modelLabel(out.model) } : null);
        note = "Translated ✓ · " + (modelLabel(out.model) || "no translation needed");
      } catch (error) {
        addMessage("assistant", "⚠️ " + (error.message || "Translation failed."));
      }
      renderMessages();
      renderHistory();
      updateDocUi();
    } else {
      note = "";
      /* Sarvam Vision did the reading, so its text IS the analysis —
         no second model is asked to read the same file again */
      postVisionAnalysis();
      if (true) {
        updateDocUi();
      } else {
        updateDocUi();
      }
    }
  } finally {
    setBusy(false);
    setStatus(note);
    fileInput.value = "";
  }
}
function clearDocument() {
  resetDocument();
  fileInput.value = "";
  setStatus("File removed.");
  setTimeout(() => setStatus(""), 1200);
}
/* =====================================================
   THEME  (dark / light)
   ===================================================== */
function loadTheme() {
  try {
    if (localStorage.getItem("sarvam_theme") === "dark") document.body.classList.add("dark");
  } catch {}
}
function toggleTheme() {
  const flip = function () {
    const dark = document.body.classList.toggle("dark");
    try { localStorage.setItem("sarvam_theme", dark ? "dark" : "light"); } catch {}
  };
  /* b60 — the theme arrives as a wave from one corner to the other */
  if (typeof window.mfThemeWipe === "function") { window.mfThemeWipe(flip); return; }
  flip();
}
/* =====================================================
   SPARKLE / CONFETTI EFFECT  ✨ 🎉 🎊
   - only on the empty home screen
   - the canvas lives INSIDE the hero (gate + Namaste part),
     so it can never be drawn on the top buttons or the chat
     area. The pointer must also be inside the hero rectangle.
   - mouse: just move the mouse (no click needed)
   - phone: slide a finger (touch events keep firing while
     the page scrolls; pointer events do not)
   - no circles, no glow: only star sparkles, confetti
     pieces and emoji. Everything fades out on its own and
     the animation loop stops when nothing is left.
   ===================================================== */
const fxCanvas = $("fxCanvas");
const fxCtx = fxCanvas.getContext("2d");
const heroSection = document.querySelector(".hero");
const topbarEl = document.querySelector(".topbar");
const reduceMotion =
  !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
const FX_EMOJI = ["✨", "🎉", "🎊", "⭐", "✨", "🎉"];
const FX_MAX = 150;
const fx = {
  on: false,
  running: false,
  parts: [],
  colors: ["#F2A93B", "#E8742C", "#C9432E", "#2BA6A0", "#2F6FB5", "#E9B949"],
  last: 0,
  prevX: -9999, prevY: -9999,
  spawnX: -9999, spawnY: -9999,
  w: 0, h: 0, dpr: 1
};
/* sparkle colours follow the chosen colour theme */
function fxRefreshColors() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const names = ["--saffron", "--orange", "--primary", "--teal", "--blue", "--gold2"];
    const list = names.map(n => cs.getPropertyValue(n).trim()).filter(Boolean);
    if (list.length) fx.colors = list;
  } catch {}
}
/* allowed rectangle in screen coordinates */
function fxZone() {
  const r = heroSection.getBoundingClientRect();
  const top = Math.max(r.top, topbarEl.getBoundingClientRect().bottom);
  const bottom = Math.min(r.bottom, dock.getBoundingClientRect().top);
  return {
    left: r.left,
    right: r.right,
    top: top,
    bottom: bottom,
    originX: r.left,
    originY: r.top,
    ok: r.width > 10 && r.height > 10 && bottom - top > 10
  };
}
function fxInside(z, x, y) {
  return z.ok && x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
}
function fxResize() {
  const r = heroSection.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  fx.dpr = Math.min(window.devicePixelRatio || 1, 2);
  fx.w = r.width;
  fx.h = r.height;
  fxCanvas.width = Math.round(r.width * fx.dpr);
  fxCanvas.height = Math.round(r.height * fx.dpr);
  fxCtx.setTransform(fx.dpr, 0, 0, fx.dpr, 0, 0);
}
function fxKick() {
  if (!fx.running) {
    fx.running = true;
    requestAnimationFrame(fxTick);
  }
}
function fxPick() {
  return fx.colors[Math.floor(Math.random() * fx.colors.length)];
}
/* one particle (x, y are LOCAL to the hero) */
function fxAdd(kind, x, y, burst) {
  if (fx.parts.length >= FX_MAX) fx.parts.shift();
  const a = Math.random() * Math.PI * 2;
  const sp = burst ? 1.6 + Math.random() * 4.2 : 0.3 + Math.random() * 1.3;
  const p = {
    kind: kind,
    x: x, y: y,
    vx: Math.cos(a) * sp,
    vy: Math.sin(a) * sp - (burst ? 1.4 : 0.5),
    g: 0,
    life: 0,
    max: 50,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.3,
    size: 6,
    ph: Math.random() * 6,
    color: fxPick(),
    ch: ""
  };
  if (kind === "star") {
    p.size = 5 + Math.random() * 7;
    p.g = -0.012;
    p.max = 38 + Math.random() * 30;
    p.vr = (Math.random() - 0.5) * 0.08;
  } else if (kind === "confetti") {
    p.size = 4 + Math.random() * 4;
    p.g = 0.12;
    p.max = 55 + Math.random() * 40;
    p.w2 = p.size * (1.2 + Math.random());
  } else {
    p.size = 14 + Math.random() * 8;
    p.g = -0.02;
    p.max = 46 + Math.random() * 28;
    p.vr = 0;
    p.rot = 0;
    p.ch = FX_EMOJI[Math.floor(Math.random() * FX_EMOJI.length)];
    p.vx *= 0.6;
  }
  fx.parts.push(p);
}
function fxDrawStar(s, color) {
  const k = s * 0.16;
  fxCtx.fillStyle = color;
  fxCtx.beginPath();
  fxCtx.moveTo(0, -s);
  fxCtx.quadraticCurveTo(k, -k, s, 0);
  fxCtx.quadraticCurveTo(k, k, 0, s);
  fxCtx.quadraticCurveTo(-k, k, -s, 0);
  fxCtx.quadraticCurveTo(-k, -k, 0, -s);
  fxCtx.closePath();
  fxCtx.fill();
}
function fxTick(ts) {
  fx.running = false;
  fxCtx.clearRect(0, 0, fx.w + 2, fx.h + 2);
  if (!fx.on || !fx.parts.length) { fx.last = 0; return; }
  const zone = fxZone();
  if (!zone.ok) {
    fx.parts = [];
    fx.last = 0;
    return;
  }
  let dt = 1;
  if (fx.last && ts) dt = Math.min(2.5, Math.max(0.5, (ts - fx.last) / 16.67));
  fx.last = ts || 0;
  /* nothing can be drawn below the top of the chat dock or above the top bar */
  const clipTop = Math.max(0, zone.top - zone.originY);
  const clipBottom = Math.max(clipTop, zone.bottom - zone.originY);
  fxCtx.save();
  fxCtx.beginPath();
  fxCtx.rect(0, clipTop, fx.w, clipBottom - clipTop);
  fxCtx.clip();
  const alive = [];
  for (let i = 0; i < fx.parts.length; i++) {
    const p = fx.parts[i];
    p.life += dt;
    if (p.life >= p.max) continue;
    p.vy += p.g * dt;
    p.vx *= Math.pow(0.985, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const t = p.life / p.max;
    const alpha = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85);
    fxCtx.save();
    fxCtx.globalAlpha = alpha;
    fxCtx.translate(p.x, p.y);
    if (p.kind === "star") {
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(p.life * 0.28 + p.ph));
      fxCtx.rotate(p.rot);
      fxDrawStar(p.size * pulse, p.color);
    } else if (p.kind === "confetti") {
      fxCtx.rotate(p.rot);
      fxCtx.fillStyle = p.color;
      fxCtx.fillRect(-p.size / 2, -p.w2 / 2, p.size, p.w2);
    } else {
      fxCtx.font = Math.round(p.size) + "px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
      fxCtx.textAlign = "center";
      fxCtx.textBaseline = "middle";
      fxCtx.fillText(p.ch, 0, 0);
    }
    fxCtx.restore();
    alive.push(p);
  }
  fxCtx.restore();
  fx.parts = alive;
  if (fx.parts.length) fxKick();
  else fx.last = 0;
}
function fxBlocked() {
  return overlay.classList.contains("show") || dialogBg.classList.contains("show");
}
/* the pointer (mouse or finger) moved to screen x, y */
function fxMove(x, y) {
  if (!fx.on || fxBlocked()) return;
  const zone = fxZone();
  if (!fxInside(zone, x, y)) {
    fx.prevX = -9999;
    fx.spawnX = -9999;
    return;
  }
  const lx = x - zone.originX;
  const ly = y - zone.originY;
  const sx = x - fx.spawnX;
  const sy = y - fx.spawnY;
  if (fx.spawnX < -9000 || sx * sx + sy * sy > 20 * 20) {
    fx.spawnX = x;
    fx.spawnY = y;
    const r = Math.random();
    fxAdd("star", lx + (Math.random() - 0.5) * 14, ly + (Math.random() - 0.5) * 14, false);
    if (r < 0.55) fxAdd("confetti", lx, ly, false);
    else if (r < 0.80) fxAdd("star", lx, ly, false);
    else fxAdd("emoji", lx, ly, false);
    fxKick();
  }
  fx.prevX = x;
  fx.prevY = y;
}
/* click / tap → a small burst of confetti */
function fxDown(x, y) {
  if (!fx.on || fxBlocked()) return;
  const zone = fxZone();
  if (!fxInside(zone, x, y)) return;
  const lx = x - zone.originX;
  const ly = y - zone.originY;
  for (let i = 0; i < 14; i++) fxAdd("confetti", lx, ly, true);
  for (let i = 0; i < 7; i++) fxAdd("star", lx, ly, true);
  for (let i = 0; i < 3; i++) fxAdd("emoji", lx, ly, true);
  fx.spawnX = x;
  fx.spawnY = y;
  fxKick();
}
function fxLift() {
  fx.prevX = -9999;
  fx.spawnX = -9999;
}
function fxSetEnabled(on) {
  on = !!on && !reduceMotion;
  if (on === fx.on) return;
  fx.on = on;
  if (on) {
    fxResize();
    return;
  }
  /* chat started → stop everything and clean up */
  fx.parts = [];
  fx.last = 0;
  fx.prevX = -9999;
  fx.spawnX = -9999;
  fxCtx.clearRect(0, 0, fx.w + 2, fx.h + 2);
}
function setupFx() {
  fxRefreshColors();
  fxResize();
  window.addEventListener("resize", fxResize);
  if (window.ResizeObserver) new ResizeObserver(fxResize).observe(heroSection);
  /* mouse / pen: just moving is enough */
  window.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    fxMove(event.clientX, event.clientY);
  }, { passive: true });
  window.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch") return;
    fxDown(event.clientX, event.clientY);
  }, { passive: true });
  document.addEventListener("mouseleave", fxLift, { passive: true });
  /* finger: touch events are used because the browser cancels pointer
     events as soon as a finger starts to scroll the page */
  window.addEventListener("touchstart", event => {
    const t = event.touches[0];
    if (t) fxDown(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchmove", event => {
    const t = event.touches[0];
    if (t) fxMove(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener("touchend", fxLift, { passive: true });
  window.addEventListener("touchcancel", fxLift, { passive: true });
  /* dark / light switch changes nothing for the sparkles, but the
     theme variables may have changed, so read the colours again */
  if (themeBtn) themeBtn.addEventListener("click", () => setTimeout(fxRefreshColors, 50));
}
/* =====================================================
   SETUP
   ===================================================== */
function setupShortcuts() {
  document.querySelectorAll(".shortcut").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.getAttribute("data-query") || "";
      input.focus();
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 125) + "px";
    });
  });
}
function setupTextarea() {
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 125) + "px";
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
}
/* =====================================================
   CUSTOM AI MODELS  (add any new model from Settings)
   ===================================================== */
let customModels = [];
let customHintTimer = null;
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function customModelIcon(label, logo) {
  const l = String(logo || "").trim();
  const low = l.toLowerCase();
  if (low.slice(0, 8) === "https://" || low.slice(0, 11) === "data:image/") {
    return '<img src="' + escHtml(l) + '" alt="">';
  }
  if (l) return '<span>' + escHtml(l) + '</span>';
  const ch = escHtml(String(label || "?").trim().charAt(0).toUpperCase() || "?");
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="#5b6cf0"/>' +
    '<text x="12" y="16.4" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff" font-family="Inter,system-ui,sans-serif">' + ch + '</text></svg>';
}
let suggestOpen = false;
function renderSuggestions() {
  suggestEl.innerHTML = "";
  /* an attached picture counts as a file too — the three ready prompts are the
     first thing the user should see after an upload */
  const hasFile = Boolean(documentText) || Boolean(attachedImage && attachedImage.dataUrl);
  if (!suggestOn || !hasFile || !hasChat() || typeof input === "undefined") {
    suggestEl.classList.remove("show");
    return;
  }
  const pack = suggestLangPack();
  const list = pack[documentKind === "image" ? "image" : "doc"];
  /* one clean button; the ready questions appear only when it is tapped */
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "suggest-toggle" + (suggestOpen ? " open" : "");
  toggle.innerHTML = "<span>" + pack.btn + "</span><span class='caret'>" + (suggestOpen ? "▴" : "▾") + "</span>";
  toggle.addEventListener("click", () => {
    suggestOpen = !suggestOpen;
    renderSuggestions();
  });
  suggestEl.appendChild(toggle);
  if (!suggestOpen) {
    suggestEl.classList.add("show");
    return;
  }
  const head = document.createElement("div");
  head.className = "suggest-head";
  head.textContent = documentKind === "image"
    ? "\uD83D\uDCF8 Tap one of these, then press Send"
    : "\uD83D\uDCC4 Tap one of these, then press Send";
  suggestEl.appendChild(head);
  list.slice(0, 3).forEach((text, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggest-chip";
    const num = document.createElement("span");
    num.className = "suggest-num";
    num.textContent = String(index + 1);
    const label = document.createElement("span");
    label.className = "suggest-text";
    label.textContent = text;
    chip.appendChild(num);
    chip.appendChild(label);
    chip.addEventListener("click", () => {
      if (busy) return;
      /* only put the text into the chat box — the user presses send */
      input.value = text;
      resizeInput();
      Array.from(suggestEl.children).forEach(c => {
        c.classList.toggle("picked", c === chip);
      });
      input.focus();
      setStatusFor("Prompt added to the chat box · edit it if you like, then press send ✓", 3200);
    });
    suggestEl.appendChild(chip);
  });
  suggestEl.classList.add("show");
}
function applyCustomModels() {
  CHAT_MODEL_LIST = BASE_CHAT_LIST.concat(customModels.map(m => ({ key: m.key, label: m.label })));
  CHAT_KEYS = CHAT_MODEL_LIST.map(m => m.key);
  customModels.forEach(m => { MODEL_NAMES[m.key] = m.label; });
  /* rebuild the ⚡ Models menu entries */
  const box = $("customModels");
  const title = $("customGroupTitle");
  if (box) {
    box.innerHTML = "";
    customModels.forEach(m => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-item";
      btn.dataset.model = m.key;
      btn.dataset.custom = "1";
      btn.setAttribute("role", "switch");
      btn.setAttribute("aria-checked", models[m.key] ? "true" : "false");
      btn.innerHTML =
        '<span class="model-ico">' + customModelIcon(m.label, m.logo) + '</span>' +
        '<span class="model-txt"><b>' + escHtml(m.label) + '</b><small>' +
        escHtml((m.format === "gemini" ? "Gemini format" : "OpenAI format") + " · " + (m.modelId || "")) +
        '</small></span><span class="switch"><i></i></span>';
      box.appendChild(btn);
    });
    if (title) title.style.display = customModels.length ? "" : "none";
  }
  /* keep the count / placeholders / test list in sync */
  modelItems = Array.from(document.querySelectorAll("#modelMenu .model-item"));
  const keep = testModelSel.value;
  testModelSel.innerHTML = "";
  CHAT_MODEL_LIST.forEach(m => testModelSel.add(new Option(m.label, m.key)));
  testModelSel.value = CHAT_KEYS.indexOf(keep) >= 0 ? keep : (activeChat() || "gemini");
  updateModelUi();
  renderModelList();
}
/* models added while Cloud storage (KV) is not connected live in this browser */
const LOCAL_MODELS_KEY = "mf_custom_models";
let ogLive = null;
let ogLiveAt = 0;
function readLocalModels() {
  try {
    const raw = localStorage.getItem(LOCAL_MODELS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (error) { return []; }
}
function writeLocalModels(list) {
  try { localStorage.setItem(LOCAL_MODELS_KEY, JSON.stringify(list)); } catch (error) {}
}
/* a model whose delete is still travelling is hidden from every incoming
   list, so a slow network can never make a just-deleted row jump back */
const pendingDeletes = new Set();
function mergeCustomModels(serverList, localList) {
  const map = new Map();
  (serverList || []).forEach(m => { if (!pendingDeletes.has(m.key)) map.set(m.key, m); });
  (localList || []).forEach(m => {
    if (!pendingDeletes.has(m.key) && !map.has(m.key)) map.set(m.key, Object.assign({ local: true }, m));
  });
  return Array.from(map.values());
}
/* the picture/text of a browser model has to travel with the chat request */
function localModelPayload(key) {
  const m = customModels.find(x => x.key === key && x.local);
  if (!m) return null;
  /* a browser model names its API too — the key stays on the worker */
  return { key: m.key, label: m.label, modelId: m.modelId, provider: m.provider || "",
    base: m.base || "", apiKey: m.apiKey || "", format: m.format || "openai" };
}
function saveModelInBrowser(payload) {
  let base = String(payload.base || "").trim();
  while (base.length && base.slice(-1) === "/") base = base.slice(0, -1);
  const slug = "c_" + String(payload.label || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  const known = providerTable.find(p => p.id === payload.provider);
  const entry = {
    key: cmEditKey || slug || "c_model",
    label: payload.label,
    modelId: payload.modelId,
    provider: payload.provider || "",
    providerLabel: known ? known.label : "its own address",
    providerIcon: known ? known.icon : "🔗",
    base: base,
    apiKey: payload.apiKey || "",
    format: payload.format || "openai",
    logo: payload.logo || "",
    hasKey: true,
    local: true
  };
  const rest = readLocalModels().filter(m => m.key !== entry.key);
  rest.push(entry);
  writeLocalModels(rest);
  customModels = mergeCustomModels(customModels.filter(m => !m.local), rest);
  applyCustomModels();
  clearModelForm();
  modelHint("Saved in this browser ✓ " + entry.label + " answers chats right away, but it is NOT in KV yet — press Test KV storage in Connection to see why, then save it again.", false);
}
/* live 0G catalogue state shown in Settings */
async function fillOgRow(row) {
  const value = row.lastChild;
  const now = Date.now();
  if (!ogLive || now - ogLiveAt > 60000) {
    try {
      const response = await fetchWithKv("/api/og-status");
      const data = await response.json();
      if (data && data.ok) { ogLive = data; ogLiveAt = now; }
    } catch (error) {}
  }
  const data = ogLive;
  if (!data) { value.textContent = "not reachable right now"; value.className = "bad"; return; }
  if (!data.count) {
    value.textContent = "0G did not answer — check OG_API_KEY";
    value.className = "bad";
    return;
  }
  const renamed = (data.chat || []).filter(m => !m.ok).map(m => m.asked + " → " + m.live);
  value.textContent = data.count + " models live ✓" +
    (renamed.length ? " · auto-pick: " + renamed.join(", ") : "") +
    (data.visionCount ? " · " + data.visionCount + " can read pictures" : "");
  value.className = "ok";
}
/* ---- every browser sees the same models ----
   Cloudflare KV holds the list; each browser re-reads it quietly, so a model
   added on one phone/computer appears on every other one (and on a brand new
   browser right after the access code) without a reload. */
let cloudModelsSig = "";
function modelsSignature(list) {
  return (list || [])
    .map(m => [m.key, m.label, m.modelId, m.base, m.format, m.logo ? "L" : "", m.hasKey ? "K" : ""].join("~"))
    .sort()
    .join("|");
}
async function refreshModelsQuiet(force) {
  try {
    const response = await fetchWithKv("/api/models");
    if (!response.ok) return false;                 /* not unlocked yet */
    const data = await response.json();
    if (!data || !data.ok) return false;
    const server = Array.isArray(data.models) ? data.models : [];
    const sig = modelsSignature(server);
    const first = !cloudModelsSig;
    if (sig === cloudModelsSig && !force) return false;
    cloudModelsSig = sig;
    customModels = mergeCustomModels(server, readLocalModels());
    applyCustomModels();
    const hint = $("cmStoreHint");
    if (hint) {
      hint.textContent = data.store
        ? "Cloud storage is connected (KV namespace \u201C" + (data.kvBinding || "?") +
          "\u201D) — models and chat history are saved for every browser."
        : "Cloud storage is not connected, so a model you add is saved in this browser only. Press Test KV storage in Connection to see why.";
    }
    if (!first) {
      setStatus("\uD83D\uDD04 AI models updated from the cloud \u2014 " + customModels.length +
        " model" + (customModels.length === 1 ? "" : "s") + " ready.");
      setTimeout(() => {
        if (statusEl.textContent.indexOf("AI models updated") >= 0) setStatus("");
      }, 5000);
    }
    return true;
  } catch (error) {
    return false;
  }
}
async function refreshCustomModels() {
  let data = null;
  try {
    const response = await fetchWithKv("/api/models");
    if (!response.ok) return;
    data = await response.json();
  } catch { return; }
  if (!data || !data.ok) return;
  customModels = mergeCustomModels(Array.isArray(data.models) ? data.models : [], readLocalModels());
  applyCustomModels();
  cloudModelsSig = modelsSignature(Array.isArray(data.models) ? data.models : []);
  const storeHint = $("cmStoreHint");
  if (storeHint) {
    storeHint.textContent = data.store
      ? "Cloud storage is connected (KV namespace \u201c" + (data.kvBinding || "?") +
        "\u201d) — models and chat history are saved for every browser."
      : "Cloud storage is not connected, so a model you add is saved in this browser only. Press Test KV storage in Connection to see why.";
  }
}
/* =====================================================
   🔌 API PROVIDERS — pick one, and the rest is already set
   ===================================================== */
const PROVIDER_FALLBACK = [
  { id: "og", label: "0G API", short: "0G", icon: "🧠", hint: "One key for every 0G model", example: "qwen3.7-flash", connected: true, source: "built-in" },
  { id: "openrouter", label: "OpenRouter API", short: "OpenRouter", icon: "🛰️", hint: "Hundreds of models from many companies", example: "nvidia/nemotron-3.5-lightning:free", connected: true, source: "built-in" },
  { id: "google", label: "Google API", short: "Google", icon: "✨", hint: "Also reads pictures and PDFs", example: "gemini-3.8-flash", connected: true, source: "built-in" }
];
function providerInfo(id) {
  return providerTable.find(p => p.id === id) || null;
}
function renderProviderPicker() {
  if (!cmProvEl) return;
  cmProvEl.innerHTML = "";
  const list = providerTable.length ? providerTable : PROVIDER_FALLBACK;
  list.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prov-opt" + (cmProvider === p.id ? " on" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", cmProvider === p.id ? "true" : "false");
    btn.setAttribute("data-prov", p.id);
    /* only the API's own name here — no model code name under it */
    btn.innerHTML = '<span class="prov-ico">' + p.icon + '</span><span class="prov-txt"><b>' +
      escHtml(p.label || p.short || "") + '</b></span>' +
      '<span class="prov-dot ' + (p.connected ? "on" : "off") + '" title="' +
      (p.connected ? "key ready" : "no key saved") + '"></span>';
    btn.addEventListener("click", () => pickProvider(p.id, true));
    cmProvEl.appendChild(btn);
  });
}
function pickProvider(id, announce) {
  cmProvider = id || "";
  const list = providerTable.length ? providerTable : PROVIDER_FALLBACK;
  const p = list.find(x => x.id === cmProvider);
  if (cmProvEl) {
    Array.from(cmProvEl.querySelectorAll(".prov-opt")).forEach(b => {
      const on = b.getAttribute("data-prov") === cmProvider;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  if (cmProvNoteEl) {
    if (!p) {
      cmProvNoteEl.textContent = "Pick the API this model lives on — its address and key are already set.";
      cmProvNoteEl.classList.remove("bad");
    } else if (!p.connected) {
      cmProvNoteEl.textContent = "⚠️ " + p.label + " has no key yet — add one in 🔌 API providers below.";
      cmProvNoteEl.classList.add("bad");
    } else {
      cmProvNoteEl.textContent = p.icon + " " + p.label + " — " + p.hint;
      cmProvNoteEl.classList.remove("bad");
    }
  }
  if (announce) modelHint("This model will answer through " + (p ? p.label : "that API") + ".", false);
  if (window.mfModelBrowseRedraw) { try { mfModelBrowseRedraw(); } catch (e) {} }
}
/* ---------- the card: the three keys, once each ---------- */
async function loadProviders(quiet) {
  try {
    const response = await fetchWithKv("/api/providers");
    if (!response.ok) return false;
    const data = await response.json();
    if (!data || !data.ok || !Array.isArray(data.providers)) return false;
    providerTable = data.providers;
    renderProviderPicker();
    renderProviderRows();
    if (cmProvider) pickProvider(cmProvider, false);
    return true;
  } catch (error) {
    if (!quiet) renderProviderPicker();
    return false;
  }
}
function providerPaint(row, state, text) {
  const out = row.querySelector(".ws-out");
  if (!out) return;
  out.className = "ws-out" + (state === "bad" || state === "off" ? " bad" : "");
  const dot = out.querySelector(".ws-dot");
  const txt = out.querySelector(".ws-text");
  if (dot) dot.className = "ws-dot " + (state || "off");
  if (txt) txt.textContent = text || "";
}
async function providerCall(id, action, key) {
  const send = async extra => {
    const response = await fetchWithKv("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ password: adminPassword, provider: id, action: action }, extra || {}))
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.needPassword) {
      try { localStorage.removeItem(ADMIN_KEY); } catch (e) {}
      adminPassword = "";
      const typed = window.prompt("Enter the admin password:");
      if (typed === null) throw new Error("Admin password required.");
      adminPassword = typed;
      try { localStorage.setItem(ADMIN_KEY, typed); } catch (e) {}
      return send(extra);
    }
    if (!response.ok || !data.ok) throw new Error(data.error || "The API refused that.");
    return data;
  };
  return send(key ? { key: key } : null);
}
function renderProviderRows() {
  if (!provListEl) return;
  provListEl.innerHTML = "";
  const list = providerTable.length ? providerTable : PROVIDER_FALLBACK;
  list.forEach(p => {
    const row = document.createElement("div");
    row.className = "prov-row";
    row.setAttribute("data-prov", p.id);
    const head = document.createElement("div");
    head.className = "prov-head";
    head.innerHTML = '<span class="prov-ico">' + p.icon + '</span><b>' + escHtml(p.label) + '</b>' +
      '<span class="prov-state ' + (p.connected ? "on" : "off") + '">' +
      (p.connected ? (p.source === "built-in" ? "ready ✓ (in the app)" : p.source === "secret" ? "ready ✓ (worker secret)" : "ready ✓ (saved key)") : "no key") +
      '</span>';
    row.appendChild(head);
    const hint = document.createElement("div");
    hint.className = "prov-hint";
    hint.textContent = p.hint + " · " + p.base + (p.example ? " · e.g. " + p.example : "");
    row.appendChild(hint);
    const input = document.createElement("input");
    input.className = "set-input";
    input.type = "password";
    input.setAttribute("autocomplete", "off");
    input.placeholder = p.connected ? "Use my own key instead (…" + (p.tail || "…") + ")" : "Paste the " + p.label + " key";
    row.appendChild(input);
    const actions = document.createElement("div");
    actions.className = "ws-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "set-btn";
    save.textContent = "Save key";
    save.addEventListener("click", () => providerSave(p.id, input));
    const test = document.createElement("button");
    test.type = "button";
    test.className = "set-btn ghost";
    test.textContent = "Test key";
    test.addEventListener("click", () => providerTest(p.id));
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "set-btn ghost";
    clear.textContent = "Clear key";
    clear.addEventListener("click", () => providerClear(p.id));
    actions.appendChild(save);
    actions.appendChild(test);
    actions.appendChild(clear);
    row.appendChild(actions);
    const out = document.createElement("div");
    out.className = "ws-out";
    out.innerHTML = '<span class="ws-dot ' + (p.connected ? "on" : "off") + '"></span><span class="ws-text">' +
      (p.connected ? "Ready — models on this API answer right away." : "Not connected — models on this API cannot answer yet.") + '</span>';
    row.appendChild(out);
    provListEl.appendChild(row);
  });
}
function providerRowOf(id) {
  return provListEl ? provListEl.querySelector('.prov-row[data-prov="' + id + '"]') : null;
}
async function providerSave(id, input) {
  const row = providerRowOf(id);
  const value = input ? input.value.trim() : "";
  if (!value) { if (row) providerPaint(row, "bad", "Paste the key first."); return; }
  if (row) providerPaint(row, "on", "Saving and testing the key…");
  try {
    const data = await providerCall(id, "save", value);
    if (input) input.value = "";
    if (row) providerPaint(row, data.tested ? "on" : "bad", data.tested ? "Saved ✅ — " + (data.note || "the key works.") : "Saved, but the test failed: " + (data.note || ""));
    await loadProviders(true);
  } catch (error) {
    if (row) providerPaint(row, "bad", error.message);
  }
}
async function providerTest(id) {
  const row = providerRowOf(id);
  if (row) providerPaint(row, "on", "Checking the key with a free call…");
  try {
    const data = await providerCall(id, "test");
    if (row) providerPaint(row, "on", "Working ✅ — " + (data.note || "the key answered."));
  } catch (error) {
    if (row) providerPaint(row, "bad", "Failed ✗ — " + error.message);
  }
}
async function providerClear(id) {
  const row = providerRowOf(id);
  if (row) providerPaint(row, "on", "Removing the saved key…");
  try {
    await providerCall(id, "clear");
    if (row) providerPaint(row, "off", "Removed — the key that ships with the app is used again.");
    await loadProviders(true);
  } catch (error) {
    if (row) providerPaint(row, "bad", error.message);
  }
}
function setupProviders() {
  const fold = $("cmFoldKeys");
  if (fold) fold.addEventListener("toggle", () => { if (fold.open) loadProviders(true); });
  if (cmProvEl) renderProviderPicker();
  loadProviders(true);
  window.mfProvidersAfterUnlock = function () { loadProviders(true); };
}
function modelHint(text, bad) {
  if (!customHintEl) return;
  customHintEl.className = "hint" + (bad ? " bad" : "");
  customHintEl.textContent = text;
  clearTimeout(customHintTimer);
  customHintTimer = setTimeout(() => {
    if (customHintEl.textContent === text) {
      customHintEl.className = "hint";
      customHintEl.textContent = "That is all — the address and the key of the API are already set, so nothing else is asked. The model appears in ⚡ Models with its own logo.";
    }
  }, 6000);
}
/* b49 · a model leaves the browser the moment Delete is tapped: the row, the
   ⚡ Models entry, the saved copy and its switch all go in the same tap, so
   ONE tap is always enough even when the cloud is slow. It is put back only
   if the delete really failed. */
function removeModelEverywhere(key) {
  writeLocalModels(readLocalModels().filter(m => m.key !== key));
  customModels = customModels.filter(m => m.key !== key);
  if (models[key]) { models[key] = false; }
  delete MODEL_NAMES[key];
  savePrefs();
  applyCustomModels();
}
function putModelBack(entry, wasLocal) {
  if (wasLocal) {
    const rest = readLocalModels().filter(m => m.key !== entry.key);
    rest.push(entry);
    writeLocalModels(rest);
    customModels = mergeCustomModels(customModels.filter(m => !m.local), rest);
  } else if (!customModels.some(m => m.key === entry.key)) {
    customModels.push(entry);
  }
  applyCustomModels();
}
function renderModelList() {
  setTimeout(() => { try { paintSetStates(); } catch (e) {} }, 30);
  const list = $("customModelList");
  if (!list) return;
  list.innerHTML = "";
  if (cmCountEl) cmCountEl.textContent = String(customModels.length);
  const anyLocal = customModels.some(m => m.local);
  if (!customModels.length) {
    list.innerHTML = '<div class="hint">No model added yet. Fill the form below, then press Save model.</div>';
    return;
  }
  customModels.forEach(m => {
    const row = document.createElement("div");
    row.className = "mlist-row";
    const via = (m.providerLabel || (m.provider ? m.provider : "")) ||
      (m.format === "gemini" ? "Google API" : "its own address");
    row.innerHTML = '<span class="cm-logo">' + customModelIcon(m.label, m.logo) + '</span>' +
      '<span style="min-width:0"><b>' + escHtml(m.label) + '</b><small>' + escHtml(m.modelId || "") + '</small>' +
      '<small>' + (m.providerIcon ? escHtml(m.providerIcon) + " " : "") + 'via ' + escHtml(via) +
        (m.local ? " · this browser only" : " · saved in KV · every device") + '</small></span>';
    const mini = document.createElement("span");
    mini.className = "mini";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      $("cmName").value = m.label;
      $("cmId").value = m.modelId || "";
      $("cmLogo").value = m.logo || "";
      cmEditKey = m.key;
      pickProvider(m.provider || "", false);
      const fold = $("cmFoldAdd");
      if (fold) fold.open = true;
      modelHint("Editing " + m.label + ". Press Save model to update, or Clear form to add a new one.", false);
    });
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.title = "Delete " + m.label + " from every browser";
    del.addEventListener("click", async () => {
      if (!window.confirm("Delete the model " + m.label + "? It leaves the ⚡ Models list in every browser.")) return;
      /* one tap is enough — the model goes from this browser at once and only
         comes back if the delete really failed */
      const backup = JSON.parse(JSON.stringify(m));
      const wasLocal = !!m.local;
      pendingDeletes.add(m.key);
      del.disabled = true;
      del.className = "del-busy";
      del.textContent = "Deleting…";
      removeModelEverywhere(m.key);
      modelHint("Deleting " + backup.label + " — the row goes at once, the cloud copy follows.", false);
      try {
        const data = await modelsRequest({ action: "delete", key: m.key });
        if (data && Array.isArray(data.models)) {
          cloudModelsSig = modelsSignature(data.models);
          customModels = mergeCustomModels(data.models, readLocalModels());
          applyCustomModels();
        }
        setStatus("\uD83D\uDDD1\uFE0F " + backup.label + " deleted — gone from the ⚡ Models list in every browser.");
        setTimeout(() => {
          if (statusEl.textContent.indexOf("deleted") >= 0) setStatus("");
        }, 4000);
        modelHint("Deleted ✓ " + backup.label + " is gone here and in every other browser. The form below adds a new one any time.", false);
      } catch (error) {
        putModelBack(backup, wasLocal);
        modelHint("Could not delete " + backup.label + " — " + error.message + " It was put back, so nothing is lost. Press Delete once more to retry.", true);
      } finally {
        pendingDeletes.delete(m.key);
      }
    });
    mini.appendChild(edit);
    mini.appendChild(del);
    row.appendChild(mini);
    list.appendChild(row);
  });
}
let cmEditKey = "";
async function modelsRequest(payload) {
  const send = async () => {
    const response = await fetchWithKv("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminPassword ? Object.assign({ password: adminPassword }, payload) : payload)
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.needPassword) {
      try { localStorage.removeItem(ADMIN_KEY); } catch {}
      adminPassword = "";
      const typed = window.prompt("Enter the admin password:");
      if (typed === null) throw new Error("Admin password required.");
      adminPassword = typed;
      try { localStorage.setItem(ADMIN_KEY, typed); } catch {}
      return send();
    }
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not save the model.");
    return data;
  };
  return send();
}
async function saveCustomModel() {
  if (!cmProvider) {
    modelHint("Pick which API this model belongs to first (0G, OpenRouter or Google).", true);
    return;
  }
  /* the address and the key belong to the API, not to the model */
  const payload = {
    action: "save",
    key: cmEditKey || "",
    label: cmNameEl.value.trim(),
    modelId: cmIdEl.value.trim(),
    provider: cmProvider,
    logo: cmLogoEl.value.trim()
  };
  try {
    modelHint("Saving...", false);
    const data = await modelsRequest(payload);
    customModels = Array.isArray(data.models) ? data.models : customModels;
    applyCustomModels();
    clearModelForm();
    modelHint("Saved ✓ " + (data.model ? data.model.label : "") + " now answers through " +
      (data.model && data.model.providerLabel ? data.model.providerLabel : "its API") +
      ". It is in ⚡ Models here and in every other browser (Cloud storage is connected ✓).", false);
    if (data.store === false) {
      modelHint("Saved in Cloud storage ✓ — but the Worker did not confirm the store on this call. Press “Test KV storage” in ⚙️ Settings → 🩺 Storage & connection if the model does not appear in your other browser.", false);
    }
  } catch (error) {
    const words = String(error.message || "");
            const storageProblem = /\\bKV\\b|CHAT_STORE|namespace|storage|binding/i.test(words);
    if (storageProblem) {
      /* the model still works right here, and the card says what to fix */
      saveModelInBrowser(payload);
      const out = $("kvTestOut");
      if (out) {
        out.className = "kv-out bad";
        out.innerHTML = "✗ <b>A model could not be saved to Cloudflare.</b><br>Reason: " + escHtml(words) +
          "<br>It was kept in this browser so it still answers here. Open <b>🩺 Storage &amp; connection</b> above and press “Connect without a binding” — then press Save model once more and it will reach every browser.";
      }
      const fold = $("kvLinkFold");
      if (fold) fold.open = true;
      return;
    }
    modelHint("Could not save the model: " + error.message + (error.status === 401 ? " — press Save again and enter the admin password." : ""), true);
  }
}
/* a logo picture is shrunk here (72 px) so it stays tiny in KV and shows
   exactly the same in every browser */
/* b49 · logo pictures. A small animated GIF is kept exactly as it is, so the
   logo KEEPS MOVING in the ⚡ Models list and in every browser. Everything
   else (jpg / png / webp, and a GIF too heavy to travel) is shrunk to 72 px
   so one logo can never fill the store. */
const GIF_LOGO_MAX = 400000;      /* about 300 KB of GIF data */
function shrinkLogoDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("That file is not a picture the browser can show."));
    img.onload = () => {
      const size = 72;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      let out = "";
      try { out = canvas.toDataURL("image/png"); } catch (e) { out = ""; }
      if (!out || out.length < 20) {
        try { out = canvas.toDataURL("image/jpeg", 0.85); } catch (e) { out = ""; }
      }
      if (!out || out.length < 20) { reject(new Error("Could not prepare that picture.")); return; }
      resolve(out);
    };
    img.src = dataUrl;
  });
}
function readPictureDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that picture."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}
/* gives back { url, animated, wasGif } — animated is true only when a moving
   GIF was kept as it is */
async function logoFromFile(file) {
  if (!file) throw new Error("No picture chosen.");
  const kind = String(file.type || "").toLowerCase();
  const isGif = kind === "image/gif" || /\\.gif$/i.test(String(file.name || ""));
  if (!/^image[\/]/.test(kind) && !isGif) {
    throw new Error("Please choose a picture — jpg, png, webp or an animated gif.");
  }
  if (file.size > 6000000) throw new Error("That picture is too big (max 6 MB).");
  const dataUrl = await readPictureDataUrl(file);
  if (isGif) {
    if (dataUrl.slice(0, 15).toLowerCase() !== "data:image/gif;") {
      throw new Error("That file is not a GIF the browser can show.");
    }
    if (dataUrl.length > GIF_LOGO_MAX) {
      /* too heavy to keep moving — its first frame still makes a fine logo */
      return { url: await shrinkLogoDataUrl(dataUrl), animated: false, wasGif: true };
    }
    return { url: dataUrl, animated: true, wasGif: true };
  }
  return { url: await shrinkLogoDataUrl(dataUrl), animated: false, wasGif: false };
}
function showLogoPreview(logo) {
  const prev = $("cmLogoPrev"), clear = $("cmLogoClear");
  const isPic = /^data:image[\/]/i.test(String(logo || ""));
  if (prev) {
    prev.hidden = !isPic;
    if (isPic) prev.src = logo;
  }
  if (clear) clear.hidden = !isPic;
}
function setupLogoUpload() {
  const file = $("cmLogoFile"), prev = $("cmLogoPrev"), clear = $("cmLogoClear");
  if (!file) return;
  file.addEventListener("change", async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    try {
      modelHint("Preparing the logo picture...", false);
      const made = await logoFromFile(picked);
      cmLogoEl.value = made.url;
      showLogoPreview(made.url);
      const kb = Math.round(made.url.length / 1024) + " KB";
      if (made.animated) {
        modelHint("Animated logo ready ✓ (" + kb + ") — the GIF keeps moving in ⚡ Models, here and in every other browser. Press Save model to keep it.", false);
      } else if (made.wasGif) {
        modelHint("That GIF is " + Math.round(picked.size / 1024) + " KB — too heavy to keep moving (a moving logo has to stay under about 300 KB), so it was kept as a still picture. Pick a smaller GIF to keep the movement ✓", false);
      } else {
        modelHint("Logo picture ready ✓ (" + kb + ") — press Save model to keep it for every browser.", false);
      }
    } catch (error) {
      modelHint(error.message, true);
    } finally {
      file.value = "";
    }
  });
  if (clear) {
    clear.addEventListener("click", () => {
      cmLogoEl.value = "";
      showLogoPreview("");
      modelHint("Logo picture removed — press Save model to keep it that way.", false);
    });
  }
  if (cmLogoEl) {
    cmLogoEl.addEventListener("input", () => showLogoPreview(cmLogoEl.value.trim()));
  }
}
function clearModelForm() {
  cmEditKey = "";
  cmNameEl.value = "";
  cmIdEl.value = "";
  if (cmProvEl) {
    Array.from(cmProvEl.querySelectorAll(".prov-opt")).forEach(b => b.classList.remove("on"));
  }
  cmProvider = "";
  if (cmLogoEl) cmLogoEl.value = "";
  showLogoPreview("");
}
function setupModelsManager() {
  if (!cmSaveBtn) return;
  setupLogoUpload();
  cmSaveBtn.addEventListener("click", saveCustomModel);
  cmClearBtn.addEventListener("click", () => { clearModelForm(); modelHint("Form cleared. Fill it to add another model.", false); });
  modelMenu.addEventListener("click", event => {
    const item = event.target.closest("#modelMenu .model-item[data-custom]");
    if (!item) return;
    event.stopPropagation();
    const key = item.dataset.model;
    setModel(key, !models[key]);
  });
  refreshCustomModels();
}
function setupModelUi() {
  fillLangSelect(trFromSel, true, DOC_LANGS);
  fillLangSelect(trToSel, false, OUT_LANGS);  fillLangSelect(visLangSel, true, DOC_LANGS);
  fillLangSelect(dlgFrom, true, DOC_LANGS);
  fillLangSelect(dlgTo, false, OUT_LANGS);
  /* image sizes */
  imgSizeSel.innerHTML = "";
  IMG_SIZES.forEach(size => {
    imgSizeSel.add(new Option(IMG_SIZE_LABELS[size] || size, size));
  });
  /* model picker for "Test connection" */
  testModelSel.innerHTML = "";
  CHAT_MODEL_LIST.forEach(m => testModelSel.add(new Option(m.label, m.key)));
  testModelSel.value = activeChat() || "gemini";
  syncSelects();
  updateModelUi();
  syncReply();
  modelBtn.addEventListener("click", event => {
    event.stopPropagation();
    toggleMenu(modelMenu, modelBtn, replyMenu, replyBtn);
  });
  replyBtn.addEventListener("click", event => {
    event.stopPropagation();
    toggleMenu(replyMenu, replyBtn, modelMenu, modelBtn);
  });
  modelItems.forEach(item => {
    item.addEventListener("click", event => {
      event.stopPropagation();
      const key = item.dataset.model;
      setModel(key, !models[key]);
    });
  });
  replyItems.forEach(item => {
    item.addEventListener("click", event => {
      event.stopPropagation();
      setAnswerLanguage(item.dataset.lang);
    });
  });
  document.addEventListener("click", event => {
    if (!modelWrap.contains(event.target) && !replyWrap.contains(event.target)) closeMenus();
  });
  trFromSel.addEventListener("change", () => { trFrom = trFromSel.value; savePrefs(); });
  trToSel.addEventListener("change", () => { trTo = trToSel.value; savePrefs(); });
  visLangSel.addEventListener("change", () => { visLang = visLangSel.value; savePrefs(); });
  imgSizeSel.addEventListener("change", () => { imgSize = imgSizeSel.value; savePrefs(); });
  trBtn.addEventListener("click", translateTyped);
  imgBtn.addEventListener("click", generateTyped);
  dlgFrom.addEventListener("change", updateDlgNote);
  dlgTo.addEventListener("change", updateDlgNote);
  Array.from(document.querySelectorAll('input[name="dlgAction"]')).forEach(radio => {
    radio.addEventListener("change", applyDialogDefaults);
  });
  dlgStart.addEventListener("click", confirmDialog);
  dlgCancel.addEventListener("click", () => closeDialog(true));
  dialogBg.addEventListener("click", event => {
    if (event.target === dialogBg) closeDialog(true);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeMenus();
      if (dialogBg.classList.contains("show")) closeDialog(true);
    }
  });
}
function bindEvents() {
  historyBtn.addEventListener("click", openHistory);
  closeBtn.addEventListener("click", closeHistory);
  overlay.addEventListener("click", closeAllPanels);
  newTop.addEventListener("click", newChat);
  webSide.addEventListener("click", function () { closeHistory(); if (window.mfOpenWebSearch) window.mfOpenWebSearch(); });
  setupClearAll();
  setupAttachPanel();
  setupPreviewCrop();
  setupCropSheet();
  setupProviders();
  setupStorageCard();
  setupModelBrowse();
  setupSettingsList();
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  sendBtn.addEventListener("click", sendMessage);
  uploadBtn.addEventListener("click", chooseFile);
  clearDocumentBtn.addEventListener("click", clearDocument);
  micBtn.addEventListener("click", startVoice);
  voiceLangSel.addEventListener("change", () => {
    voiceLang = voiceLangSel.value;
    saveVoiceLang();
    if (listening) cancelVoice();
    setStatus("Voice language: " + voiceLangLabel() + " ✓");
    setTimeout(() => setStatus(""), 1500);
  });
  settingsBtn.addEventListener("click", openSettings);
  closeSettingsBtn.addEventListener("click", closeSettings);
  loadCfBtn.addEventListener("click", () => refreshSettings(""));
  testBtn.addEventListener("click", () => refreshSettings(testModelSel.value || "sarvam"));
  const kvTestBtn = $("kvTest");
  if (kvTestBtn) kvTestBtn.addEventListener("click", testKvStorage);
  resetUsageBtn.addEventListener("click", async () => {
    if (!window.confirm("Reset the usage counters? This also clears the permanent totals.")) return;
    saveUsage({ days: {} });
    try {
      await fetchUsage("", false, true);
    } catch (error) {
      setStatus("⚠️ " + error.message);
      setTimeout(() => setStatus(""), 3000);
    }
    refreshSettings("");
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    /* b58 — a picture is never handed to Sarvam Vision by itself and never
       opens the Vision sheet: it is attached to the model that is chosen.
       Vision still reads a file when the user switched it on. */
    const isPdf = file.type === "application/pdf";
    if (models.vision && !hasChat()) {
      onFileChosen(file);                 /* no chat model yet: Vision reads it */
      return;
    }
    if (!isPdf) {
      /* a picture can be cropped BEFORE it is attached at all */
      proposeCropBeforeAttach(file);
      return;
    }
    if (!models.vision && hasChat() && activeChat() !== "gemini") {
      setStatus("⚠️ This model can read pictures, not PDFs — use Google Gemini or turn on Sarvam Vision.");
      setTimeout(() => setStatus(""), 4500);
      fileInput.value = "";
      return;
    }
    if (models.vision && hasChat()) { onFileChosen(file); return; }
    attachFileDirectly(file);
  });
}
/* =====================================================
   BIRDS — flown by a frame loop, so no CSS animation can
   ever freeze them (they used to stall behind the lock).
   ===================================================== */
function setupBirds() {
  /* birds and the little plane all fly on this one frame loop */
  const birds = Array.prototype.slice.call(document.querySelectorAll(".px-bird"));
  const planeEl = document.querySelector(".px-plane");
  if (!birds.length && !planeEl) return;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const specs = [
    { speed: 56, x: -80 },
    { speed: 38, x: Math.max(window.innerWidth * 0.34, 140) }
  ];
  birds.forEach((el, i) => {
    const s = specs[i] || specs[specs.length - 1];
    s.el = el;
    el.style.animation = "none";        /* belt and braces: never animate by CSS */
    if (reduced) {
      s.frozen = true;
      el.style.transform = "translateX(" + Math.round(window.innerWidth * (0.18 + i * 0.42)) + "px)";
    } else {
      el.style.transform = "translateX(" + s.x.toFixed(1) + "px)";
    }
  });
  window.mfBirds = specs;
  /* the plane flies the same way: across the sky, left to right, for ever */
  const plane = { el: planeEl, speed: 104, x: -150, top: 1 };
  if (planeEl) {
    planeEl.style.animation = "none";
    if (reduced) {
      plane.frozen = true;
      planeEl.style.transform = "translateX(" + Math.round(window.innerWidth * 0.55) + "px)";
    } else {
      planeEl.style.transform = "translateX(" + plane.x.toFixed(1) + "px)";
    }
  }
  window.mfPlane = plane;
  let last = 0;
  function frame(now) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    const wrapAt = window.innerWidth + 110;
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      if (!s.el || s.frozen) continue;
      s.x += s.speed * dt;
      if (s.x > wrapAt) s.x = -90;
      s.el.style.transform = "translateX(" + s.x.toFixed(1) + "px)";
    }
    if (plane.el && !plane.frozen) {
      plane.x += plane.speed * dt;
      if (plane.x > wrapAt) plane.x = -150;
      plane.el.style.transform = "translateX(" + plane.x.toFixed(1) + "px)";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function boot() {
  loadTheme();
  loadHistory();
  loadLangs();
  loadPrefs();
  loadVoiceLang();
  bindEvents();
  setupFx();
  setupBirds();
  initAppearance();
  setupModelUi();
  setupModelsManager();
  startTypewriter();
  updateAutoLockInfo();
  setupShortcuts();
  setupTextarea();
  if (!SpeechRec) micBtn.style.opacity = ".45";
  if (window.ResizeObserver) new ResizeObserver(syncDock).observe(dock);
  window.addEventListener("resize", syncDock);
  syncDock();
  /* chats nobody touched for 15 days are gone before anything is shown */
  if (pruneLocalChats()) saveHistory();
  /* always start on the home screen, never inside an old chat */
  currentChat = null;
  createChat(true);
  hideSuggestions();
  renderMessages();
  renderHistory();
  input.focus();
  /* the same chats and models appear in every browser, logged in or not */
  startSync();
}
try {
  boot();
} catch (error) {
  console.error("Sarvam frontend boot error:", error);
  statusEl.textContent = "Frontend error: " + error.message;
}
/* =====================================================
   LOCK SCREEN  (4-digit access code)
   ===================================================== */
(function () {
  var lockEl = document.getElementById("lock");
  var cardEl = document.getElementById("lockCard");
  var msgEl = document.getElementById("lock-msg");
  var pins = Array.prototype.slice.call(document.getElementById("pins").querySelectorAll("input"));
  var achEl = document.getElementById("achievement");
  var elephEl = document.getElementById("eleph");
  var pupils = elephEl ? Array.prototype.slice.call(elephEl.querySelectorAll(".pupil")) : [];
  function elephLook(i) {
    if (!pupils.length) return;
    var dx = [-9, -3, 3, 9][i] || 0;
    pupils.forEach(function (p) { p.style.transform = "translate(" + dx + "px, 6px)"; });
  }
  function elephMood(m) {
    if (!elephEl) return;
    elephEl.classList.remove("mood-idle", "mood-happy", "mood-sad", "mood-awkward");
    elephEl.classList.add("mood-" + m);
  }
  var eyeWhites = elephEl ? Array.prototype.slice.call(elephEl.querySelectorAll(".eye")) : [];
  function elephCalmFace() {
    pupils.forEach(function (p) { p.setAttribute("r", "6"); });
    eyeWhites.forEach(function (e) {
      e.setAttribute("rx", "12.5");
      e.setAttribute("ry", "13.5");
    });
  }
  function elephReset() { elephLook(0); elephMood("idle"); elephCalmFace(); }
  var checking = false;
  var DEFAULT_MSG = "Please enter the 4-digit code to open the chat.";
  var SWEET = [
    "Oops! That is not the right code 💕 Try again, sweetheart!",
    "Almost there! 🌸 Please check the code and try once more.",
    "Hmm, that does not look right 🍬 Give it another go!",
    "Not quite, dear friend 🌷 The right code is waiting for you!",
    "Aww, wrong code  Take a breath and try again 💖"
  ];
  function isLocked() { return !lockEl.classList.contains("hidden"); }
  function clearPins() {
    pins.forEach(function (p) { p.value = ""; });
  }
  function setMsg(text, cls) {
    msgEl.textContent = text;
    msgEl.className = cls || "";
  }
  function showLock(text) {
    clearPins();
    setMsg(text || DEFAULT_MSG);
    lockEl.classList.remove("hidden");
    setTimeout(function () { pins[0].focus(); }, 60);
  }
  function showAchievement() {
    achEl.classList.add("show");
    setTimeout(function () { achEl.classList.remove("show"); }, 3800);
  }
  function wrongCode(text) {
    setMsg(text || SWEET[Math.floor(Math.random() * SWEET.length)], "err");
    elephMood("sad");
    setTimeout(function () { if (isLocked()) elephMood("idle"); }, 1600);
    cardEl.classList.remove("shake");
    void cardEl.offsetWidth;
    cardEl.classList.add("shake");
    setTimeout(function () {
      cardEl.classList.remove("shake");
      clearPins();
      pins[0].focus();
    }, 500);
  }
  async function submitCode() {
    if (checking) return;
    var code = pins.map(function (p) { return p.value; }).join("");
    if (code.length !== 4) return;
    checking = true;
    setMsg("Checking...", "");
    try {
      var r = await fetchWithKv("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      });
      if (r.ok) {
        setMsg("Correct! 🎉", "ok");
        markChat();                   /* the 1-hour auto-lock clock starts now */
        elephMood("happy");           /* baby elephant celebrates first */
        setTimeout(function () {      /* ...then unlock after 2 seconds */
          lockEl.classList.add("hidden");
          if (window.mfRestartScene) { window.mfRestartScene(); setTimeout(window.mfRestartScene, 400); }
          if (window.mfSelectDefaultModel) window.mfSelectDefaultModel();
          clearPins();
          showAchievement();
          var chatBox = document.getElementById("input");
          if (chatBox) chatBox.focus();
          /* the login is valid now → the home screen + the cloud chat sync */
          try { if (window.mfGoHome) window.mfGoHome(); } catch (e) {}
          try { startSync(); } catch (e) {}
          /* a brand new browser sees every model added anywhere */
          try { refreshModelsQuiet(true); } catch (e) {}
          try { if (window.mfProvidersAfterUnlock) window.mfProvidersAfterUnlock(); } catch (e) {}
          try { if (window.mfStorageAfterUnlock) window.mfStorageAfterUnlock(); } catch (e) {}
          elephReset();
        }, 2000);
      } else if (r.status === 429) {
        var d = await r.json().catch(function () { return {}; });
        wrongCode(d.error || "Too many wrong tries. Please wait a while 💤");
      } else {
        wrongCode();
      }
    } catch (e) {
      setMsg("Network problem. Please try again.", "err");
    } finally {
      checking = false;
    }
  }
  pins.forEach(function (p, i) {
    p.addEventListener("input", function () {
      p.value = p.value.replace(/[^0-9]/g, "").slice(0, 1);
      elephLook(p.value ? i : Math.max(i - 1, 0));
      if (p.value && i < pins.length - 1) pins[i + 1].focus();
      if (pins.every(function (x) { return x.value; })) submitCode();
    });
    p.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !p.value && i > 0) {
        pins[i - 1].value = "";
        pins[i - 1].focus();
        elephLook(i - 1);
      }
      if (e.key === "ArrowLeft" && i > 0) pins[i - 1].focus();
      if (e.key === "ArrowRight" && i < pins.length - 1) pins[i + 1].focus();
    });
    p.addEventListener("paste", function (e) {
      var text = (e.clipboardData || window.clipboardData).getData("text") || "";
      var digits = text.replace(/[^0-9]/g, "").slice(0, 4);
      if (!digits) return;
      e.preventDefault();
      for (var k = 0; k < 4; k++) pins[k].value = digits[k] || "";
      if (digits.length === 4) submitCode();
      else pins[Math.min(digits.length, 3)].focus();
    });
  });
  /* if the login expires while chatting, any locked answer shows the lock again */
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function () {
    return nativeFetch.apply(null, arguments).then(function (r) {
      if (r.status === 401 && r.headers.get("X-Locked") === "1" && !isLocked()) {
        showLock("Your session ended. Please enter the code again 🔒");
      }
      return r;
    });
  };
  /* --- fat, smooth, snake-like trunk: a travelling serpentine wave --- */
  var trunkEl = document.getElementById("trunkPath");
  var trunkHiEl = document.getElementById("trunkHi");
  var ringEls = Array.prototype.slice.call(
    document.querySelectorAll("#trunkRings path")
  );
  var BASE_X = 115, BASE_Y = 116, LEN = 152;
  function elephState() {
    var cls = elephEl ? elephEl.className : "";
    if (cls.indexOf("happy") >= 0) return { name: "happy", amp: 15, spd: 0.011, lean: 8, droop: 2, curl: 0, quiver: 0, len: 152 };
    if (cls.indexOf("sad") >= 0) return { name: "sad", amp: 2.2, spd: 0.002, lean: 2, droop: 15, curl: 0, quiver: 0, len: 152 };
    if (cls.indexOf("shy") >= 0) return { name: "shy", amp: 3.5, spd: 0.02, lean: 4, droop: 0, curl: -26, quiver: 2.2, len: 138 };
    return { name: "idle", amp: 7, spd: 0.0042, lean: 5, droop: 2, curl: 0, quiver: 0.7, len: 152 };
  }
  function trunkPoint(f, t, st) {
    var y = BASE_Y + f * st.len;
    var x = BASE_X
      + Math.sin(t * st.spd - f * 5.2) * st.amp * (0.22 + 0.78 * f)
      + Math.sin(t * st.spd * 0.33) * st.lean * f
      + Math.sin(f * 2.1) * st.droop * f
      + Math.sin(t * 0.05 + f * 12) * st.quiver * f
      + st.curl * f * f * f;
    return [x, y];
  }
  function trunkWidth(f) { return (24 + (9 - 24) * f) / 2; }
  function trunkD(t) {
    var st = elephState(), N = 18, i, f, p;
    var left = [], right = [], pts = [];
    for (i = 0; i <= N; i++) {
      f = i / N;
      pts.push(trunkPoint(f, t, st));
    }
    for (i = 0; i <= N; i++) {
      f = i / N;
      p = pts[i];
      var a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, N)];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var L = Math.hypot(dx, dy) || 1;
      var w = trunkWidth(f);
      left.push([p[0] - dy / L * w, p[1] + dx / L * w]);
      right.push([p[0] + dy / L * w, p[1] - dx / L * w]);
    }
    var d = "M" + left.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L ");
    d += " L " + right.reverse().map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L ") + " Z";
    return d;
  }
  function updateTrunkDetails(t, st) {
    var i, f, p, a, b, dx, dy, L, w, nx, ny;
    if (trunkHiEl) {
      var hi = [], k;
      for (k = 0; k <= 10; k++) {
        f = k / 10;
        p = trunkPoint(f, t, st);
        a = trunkPoint(Math.max(f - 0.06, 0), t, st);
        b = trunkPoint(Math.min(f + 0.06, 1), t, st);
        dx = b[0] - a[0]; dy = b[1] - a[1];
        L = Math.hypot(dx, dy) || 1;
        nx = -dy / L; ny = dx / L;
        w = trunkWidth(f) * 0.52;
        hi.push([p[0] - nx * w, p[1] - ny * w]);
      }
      trunkHiEl.setAttribute("d", "M" + hi.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L "));
    }
    for (i = 0; i < ringEls.length; i++) {
      f = 0.13 + i * 0.15;
      p = trunkPoint(f, t, st);
      a = trunkPoint(Math.max(f - 0.05, 0), t, st);
      b = trunkPoint(Math.min(f + 0.05, 1), t, st);
      dx = b[0] - a[0]; dy = b[1] - a[1];
      L = Math.hypot(dx, dy) || 1;
      nx = -dy / L; ny = dx / L;
      w = trunkWidth(f) * 0.62;
      ringEls[i].setAttribute(
        "d",
        "M" + (p[0] - nx * w).toFixed(1) + " " + (p[1] - ny * w).toFixed(1) +
        " L " + (p[0] + nx * w).toFixed(1) + " " + (p[1] + ny * w).toFixed(1)
      );
    }
  }
  function trunkLoop(t) {
    if (trunkEl && isLocked()) {
      var st = elephState();
      trunkEl.setAttribute("d", trunkD(t));
      updateTrunkDetails(t, st);
    }
    requestAnimationFrame(trunkLoop);
  }
  if (trunkEl) requestAnimationFrame(trunkLoop);

  /* --- idle rules: 30 min without a chat → back to the home screen,
         1 hour without a chat → the whole app asks for the code again --- */
  var HOME_AFTER_MS = 30 * 60 * 1000;
  var AUTO_LOCK_MS = 60 * 60 * 1000;
  var homeShownAt = 0;
  function markChat() {
    try { localStorage.setItem("mf_last_chat", String(Date.now())); } catch (e) {}
  }
  function autoLockIfIdle() {
    if (isLocked()) return;
    var last = 0;
    try { last = Number(localStorage.getItem("mf_last_chat")) || 0; } catch (e) {}
    if (!last) { markChat(); return; }
    var idle = Date.now() - last;
    if (idle >= AUTO_LOCK_MS) {
      showLock("You were away for a while, so the chat locked itself 🔒 Enter the code again to continue.");
      try { homeShownAt = 0; } catch (e) {}
      elephReset();
      return;
    }
    if (idle >= HOME_AFTER_MS && homeShownAt !== last) {
      /* no chat for half an hour: quietly return to the home screen */
      homeShownAt = last;
      try {
        if (window.mfGoHome) window.mfGoHome(true);
        if (typeof setStatus === "function") {
          setStatus("🏠 Back to home — no chat for 30 minutes.");
          setTimeout(function () {
            var el = document.getElementById("status");
            if (el && el.textContent.indexOf("Back to home") >= 0) el.textContent = "";
          }, 4000);
        }
      } catch (e) {}
    }
  }
  window.mfTouchActivity = markChat;
  window.mfAutoLockCheck = autoLockIfIdle;
  setInterval(autoLockIfIdle, 30000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) autoLockIfIdle(); });
  if (!isLocked()) autoLockIfIdle();

  /* --- touch the baby: it feels shy / awkward --- */
  var shyTimer = null, lastTap = 0;
  function elephAwkward() {
    if (!elephEl || !isLocked()) return;
    var now = Date.now();
    if (now - lastTap < 450) return;
    lastTap = now;
    /* 🫪 shaking, startled reaction: the svg jitters, the whole baby
       rattles, eyes jump wide and swoosh lines appear on both sides */
    elephEl.classList.remove("mood-idle", "mood-happy", "mood-sad", "mood-awkward");
    void elephEl.offsetWidth;                 /* restart the shake cleanly */
    elephEl.classList.add("mood-awkward");
    if (pupils.length === 2) {
      /* startled: eyes open wide, pupils shrink and look up */
      pupils[0].style.transform = "translate(-4px, -3px)";
      pupils[1].style.transform = "translate(5px, -3px)";
      pupils.forEach(function (p) { p.setAttribute("r", "4.8"); });
      eyeWhites.forEach(function (e) {
        e.setAttribute("rx", "14.6");
        e.setAttribute("ry", "15.8");
      });
    }
    setMsg("Aww! please don't touch me.", "");
    clearTimeout(shyTimer);
    shyTimer = setTimeout(function () {
      elephEl.classList.remove("mood-awkward");
      elephCalmFace();
      if (isLocked() && !checking) {
        elephReset();
        setMsg(DEFAULT_MSG);
      }
    }, 2800);
  }
  if (elephEl) elephEl.addEventListener("click", elephAwkward);
  if (isLocked()) setTimeout(function () { pins[0].focus(); }, 100);
})();
</script>
<script>
/* =========================================================
   BATCH 36 (b53) — everything that is new in the app
   ---------------------------------------------------------
   1 · the ⋮ menu in the top bar — Settings · Pin chat · Share chat ·
       Find in chat, drawn like a modern chat app
   2 · pinned chats — up to 3, kept in Cloudflare KV, so they show in
       every browser; 📌 at the top of the history and a chip bar above
       the chat
   3 · Share chat — one tap makes a random link; anyone who opens it can
       READ that chat only, never write in it
   4 · Find in chat — search any word in the open chat, in any language
   5 · press and hold a model for 2 seconds → it can be deleted for good,
       built-in models (Sarvam, Google Gemini, the 0G ones) included
   6 · after a delete, 5 seconds of Undo — in ⚡ Models and in Settings
   7 · a small arrow above the chat box brings you back to the newest
       message when you have scrolled up
   ========================================================= */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var HIDE_KEY = "mf_hidden_models";
  var PINS_KEY = "mf_pins";
  var MAX_PINS = 5;   /* b61 — five pins */
  var hiddenKeys = [];
  var pins = [];
  var shareToken = "";
  var findState = { q: "", hits: [], i: 0 };
  var mfAllBase = null;


  /* the app keeps some of its state in let / const bindings, which are
     shared with this script but are not properties of window — these little
     readers reach them safely */
  function mfCustom() { try { return customModels || []; } catch (e) { return []; } }
  function mfModels() { try { return models || {}; } catch (e) { return {}; } }
  function mfNames() { try { return MODEL_NAMES || {}; } catch (e) { return {}; } }
  function mfBase() { try { return BASE_CHAT_LIST || []; } catch (e) { return []; } }
  function mfChats() { try { return chats || []; } catch (e) { return []; } }
  function mfCurrent() { try { return currentChat || null; } catch (e) { return null; } }
  function mfBusy() { try { return !!busy; } catch (e) { return false; } }
  function mfThemeBtn() { return $("theme"); }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      var val = raw ? JSON.parse(raw) : null;
      return Array.isArray(val) ? val : fallback;
    } catch (e) { return fallback; }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function isAuthed() {
    var lock = $("lock");
    return !lock || lock.classList.contains("hidden");
  }

  /* =========================================================
     the toast — it carries the 5 second Undo
     ========================================================= */
  var toastEl = null, toastTimer = null;
  function toast(text, actionLabel, onAction, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "mf-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastTimer);
    toastEl.innerHTML = "";
    var span = document.createElement("span");
    span.className = "mf-toast-txt";
    span.textContent = text;
    toastEl.appendChild(span);
    if (actionLabel) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mf-toast-btn";
      btn.textContent = actionLabel;
      btn.addEventListener("click", function () {
        hideToast();
        try { onAction(); } catch (e) {}
      });
      toastEl.appendChild(btn);
    }
    var bar = document.createElement("i");
    bar.className = "mf-toast-bar";
    toastEl.appendChild(bar);
    toastEl.classList.add("show");
    var life = ms || 5000;
    bar.style.animation = "mfToastBar " + (life / 1000) + "s linear forwards";
    toastTimer = setTimeout(hideToast, life);
    return toastEl;
  }
  function hideToast() {
    if (toastEl) toastEl.classList.remove("show");
    clearTimeout(toastTimer);
  }

  /* =========================================================
     1 · the ⋮ menu
     ========================================================= */
  function closeMoreMenu() {
    var menu = $("moreMenu"), btn = $("moreBtn");
    if (menu) menu.classList.remove("show");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function openMoreMenu() {
    var menu = $("moreMenu"), btn = $("moreBtn");
    if (!menu || !btn) return;
    var show = !menu.classList.contains("show");
    menu.classList.toggle("show", show);
    btn.setAttribute("aria-expanded", show ? "true" : "false");
    if (show) paintPinLabel();
  }
  function currentChatId() {
    return (mfCurrent() && mfCurrent().id) ? mfCurrent().id : "";
  }
  function paintPinLabel() {
    var lbl = $("mfPinLbl");
    if (!lbl) return;
    var id = currentChatId();
    lbl.textContent = id && pins.indexOf(id) >= 0 ? "Unpin chat" : "Pin chat";
  }
  function wireMoreMenu() {
    var btn = $("moreBtn"), menu = $("moreMenu");
    if (!btn || !menu) return;
    btn.addEventListener("click", function (e) { e.stopPropagation(); openMoreMenu(); });
    menu.addEventListener("click", function (e) {
      var row = e.target.closest ? e.target.closest("[data-mf]") : null;
      if (!row) return;
      var what = row.getAttribute("data-mf");
      closeMoreMenu();
      if (what === "settings") { var sb = $("settingsBtn"); if (sb) sb.click(); }
      else if (what === "pin") togglePinCurrent();
      else if (what === "share") shareCurrentChat();
      else if (what === "find") openFind();
    });
    document.addEventListener("click", function (e) {
      if (!menu.classList.contains("show")) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      closeMoreMenu();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeMoreMenu(); closeFind(); } });
  }

  /* dark mode moves into Settings → Appearance (the ⋮ keeps only the four
     things you asked for), so the little switch there drives the same button */
  function paintDarkRow() {
    var on = document.body.classList.contains("dark");
    var sw = $("mfDarkToggle"), txt = $("mfDarkTxt");
    if (sw) sw.setAttribute("aria-checked", on ? "true" : "false");
    if (txt) txt.textContent = on
      ? "Dark — the page is dark, the glow stays soft"
      : "Light — tap the switch for dark mode";
  }
  function wireDarkRow() {
    var sw = $("mfDarkToggle");
    if (!sw) return;
    sw.addEventListener("click", function () {
      var tb = mfThemeBtn(); if (tb) tb.click();
      setTimeout(paintDarkRow, 60);
    });
    paintDarkRow();
  }

  /* =========================================================
     2 · pinned chats  (max 3, kept in KV → every browser)
     ========================================================= */
  function paintPins(list) {
    if (Array.isArray(list)) { pins = list.slice(0, MAX_PINS); writeJson(PINS_KEY, pins); }
    paintPinBar();
    try { if (window.renderHistory) window.renderHistory(); } catch (e) {}
    paintPinLabel();
  }
  function chatById(id) {
    var list = mfChats();
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function paintPinBar() {
    var bar = $("pinBar");
    if (!bar) return;
    /* b61 — no pinned strip on the home page: pins live in the history only */
    bar.innerHTML = ""; bar.hidden = true; bar.classList.remove("show"); return;
    var real = pins.filter(function (id) { return chatById(id); });
    bar.innerHTML = "";
    if (!real.length || !isAuthed()) { bar.hidden = true; bar.classList.remove("show"); return; }
    var tag = document.createElement("span");
    tag.className = "pin-tag";
    tag.innerHTML = "📌 Pinned";
    bar.appendChild(tag);
    real.forEach(function (id) {
      var chat = chatById(id);
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pin-chip";
      chip.title = "Open this pinned chat · press and hold to unpin";
      chip.textContent = (chat.title || "New Chat").slice(0, 26);
      chip.addEventListener("click", function () {
        if (window.openChat) window.openChat(id);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      hold(chip, 700, function () { unpinChat(id, true); });
      bar.appendChild(chip);
    });
    bar.hidden = false;
    bar.classList.add("show");
  }
  async function loadPins() {
    if (!isAuthed()) return;
    try {
      var data = await window.syncCall({ action: "pins" });
      if (data && Array.isArray(data.pins)) paintPins(data.pins);
      else paintPinBar();
    } catch (e) { paintPinBar(); }
  }
  async function savePins(next) {
    pins = next.slice(0, MAX_PINS);
    writeJson(PINS_KEY, pins);
    paintPinBar();
    try { if (window.renderHistory) window.renderHistory(); } catch (e) {}
    try { await window.syncCall({ action: "pins-save", pins: pins }); }
    catch (e) { toast("Pinned here — the cloud copy could not be saved just now.", "", null, 4000); }
  }
  function pinChat(id, quiet) {
    if (!id) return;
    if (pins.indexOf(id) >= 0) return;
    if (pins.length >= MAX_PINS) {
      toast("You can pin 5 chats at most — unpin one first.", "", null, 5000);
      return;
    }
    savePins(pins.concat([id]));
    if (!quiet) toast("📌 Pinned — it now shows at the top of every chat list, in every browser.", "", null, 3200);
  }
  function unpinChat(id, quiet) {
    if (pins.indexOf(id) < 0) return;
    savePins(pins.filter(function (p) { return p !== id; }));
    if (!quiet) toast("Unpinned.", "", null, 2600);
  }
  function togglePinCurrent() {
    var id = currentChatId();
    if (!id) { toast("Open a chat first, then you can pin it.", "", null, 3000); return; }
    if (pins.indexOf(id) >= 0) unpinChat(id); else pinChat(id);
    paintPinLabel();
  }

  /* =========================================================
     3 · share a chat — a link that only READS
     ========================================================= */
  function modal(html, cls) {
    var box = document.createElement("div");
    box.className = "mf-modal " + (cls || "");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.innerHTML = '<div class="mf-modal-card">' + html + "</div>";
    box.addEventListener("click", function (e) {
      if (e.target === box || (e.target.closest && e.target.closest("[data-mf-close]"))) box.remove();
    });
    document.body.appendChild(box);
    return box;
  }
  async function shareCurrentChat() {
    var id = currentChatId();
    if (!id) { toast("Open a chat first — then you can share it.", "", null, 3000); return; }
    var chat = chatById(id) || {};
    var box = modal(
      '<h3>🔗 Share “' + esc((chat.title || "this chat").slice(0, 40)) + '”</h3>' +
      '<p class="mf-modal-p">Anyone who opens the link can <b>read this chat only</b>. They cannot type, answer or change anything — only you can.</p>' +
      '<div class="mf-linkrow"><input id="mfShareInput" class="mf-link" type="text" readonly placeholder="Making the link…">' +
      '<button id="mfShareCopy" type="button" class="mf-btn primary">Copy</button></div>' +
      '<div class="mf-modal-btns"><button type="button" class="mf-btn" data-mf-close>Done</button>' +
      '<button type="button" class="mf-btn danger" id="mfShareStop">Stop sharing</button></div>' +
      '<div class="mf-modal-hint" id="mfShareHint">The link is random and belongs to this chat only. Delete the chat and the link stops working.</div>', "share");
    var input = $("mfShareInput"), copy = $("mfShareCopy"), stop = $("mfShareStop");
    if (copy) copy.addEventListener("click", function () {
      if (!input.value) return;
      input.select();
      var done = function () { toast("Link copied ✓", "", null, 2200); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(input.value).then(done, done);
      else { try { document.execCommand("copy"); done(); } catch (e) {} }
    });
    if (stop) stop.addEventListener("click", async function () {
      try {
        await fetchWithKv("/api/share", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: id, revoke: true })
        });
        toast("Sharing stopped — that link no longer opens.", "", null, 3600);
        box.remove();
      } catch (e) { toast("Could not reach the Worker just now.", "", null, 3600); }
    });
    try {
      var res = await fetchWithKv("/api/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: id })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!data.ok || !data.url) throw new Error(data.error || "Could not make the link.");
      input.value = data.url;
      shareToken = data.token || "";
      var hint = $("mfShareHint");
      if (hint) hint.textContent = data.existing
        ? "This chat already had a link — it is the same link, shown again."
        : "Link ready ✓ Anyone can open it and read this chat. Only you can write in it.";
    } catch (e) {
      input.value = "";
      input.placeholder = "Could not make the link — " + (e.message || "try again");
    }
  }

  /* =========================================================
     4 · find in chat — any word, any language
     ========================================================= */
  function openFind() {
    var bar = $("findBar");
    if (!bar) return;
    bar.hidden = false;
    document.body.classList.add("mf-finding");
    var input = $("mfFindInput");
    if (input) { input.focus(); input.select(); }
    if (input && input.value) runFind(input.value);
  }
  function closeFind() {
    var bar = $("findBar");
    if (bar) bar.hidden = true;
    document.body.classList.remove("mf-finding");
    clearFind();
  }
  function clearFind() {
    var marks = document.querySelectorAll("mark.mf-hit");
    for (var i = marks.length - 1; i >= 0; i--) {
      var m = marks[i], parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
    findState = { q: "", hits: [], i: 0 };
    paintFindCount();
  }
  function paintFindCount(text) {
    var out = $("mfFindCount");
    if (!out) return;
    if (text) { out.textContent = text; return; }
    if (!findState.q) { out.textContent = ""; return; }
    out.textContent = findState.hits.length
      ? (findState.i + 1) + " / " + findState.hits.length
      : "no match";
  }
  function runFind(query) {
    if (mfBusy()) { paintFindCount("wait for the answer"); return; }
    clearFind();
    var q = String(query || "").trim();
    findState.q = q;
    if (!q) { paintFindCount(""); return; }
    try { if (window.renderMessages) window.renderMessages(); } catch (e) {}
    var root = $("messages");
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], node;
    while ((node = walker.nextNode())) {
      var tag = node.parentNode && node.parentNode.nodeName ? node.parentNode.nodeName.toLowerCase() : "";
      if (tag === "script" || tag === "style" || tag === "mark") continue;
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      nodes.push(node);
    }
    var low = q.toLowerCase();
    nodes.forEach(function (textNode) {
      var text = textNode.nodeValue, lowText = text.toLowerCase(), from = 0, at;
      var pieces = [], cut = 0, found = false;
      while ((at = lowText.indexOf(low, from)) >= 0) {
        found = true;
        if (at > cut) pieces.push(document.createTextNode(text.slice(cut, at)));
        var mark = document.createElement("mark");
        mark.className = "mf-hit";
        mark.textContent = text.slice(at, at + q.length);
        pieces.push(mark);
        findState.hits.push(mark);
        cut = at + q.length;
        from = cut;
      }
      if (!found) return;
      if (cut < text.length) pieces.push(document.createTextNode(text.slice(cut)));
      var frag = document.createDocumentFragment();
      pieces.forEach(function (p) { frag.appendChild(p); });
      textNode.parentNode.replaceChild(frag, textNode);
    });
    findState.i = 0;
    paintFindCount();
    if (findState.hits.length) jumpFind(0);
  }
  function jumpFind(i) {
    var hits = findState.hits;
    if (!hits.length) return;
    var n = (i + hits.length) % hits.length;
    findState.i = n;
    hits.forEach(function (m, k) { m.classList.toggle("on", k === n); });
    var target = hits[n];
    var rect = target.getBoundingClientRect();
    var y = window.scrollY + rect.top - (window.innerHeight * 0.34);
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    paintFindCount();
  }
  function wireFind() {
    var input = $("mfFindInput");
    if (input) {
      var debounce = null;
      input.addEventListener("input", function () {
        clearTimeout(debounce);
        debounce = setTimeout(function () { runFind(input.value); }, 160);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); jumpFind(findState.i + (e.shiftKey ? -1 : 1)); }
        if (e.key === "Escape") closeFind();
      });
    }
    var prev = $("mfFindPrev"), next = $("mfFindNext"), close = $("mfFindClose");
    if (prev) prev.addEventListener("click", function () { jumpFind(findState.i - 1); });
    if (next) next.addEventListener("click", function () { jumpFind(findState.i + 1); });
    if (close) close.addEventListener("click", closeFind);
  }

  /* =========================================================
     7 · the arrow that takes you back to the newest message
     ========================================================= */
  /* b58 — this button is run by the b58 script: it shows the moment you
     scroll up and fades 2.5 s later, so nothing may re-show it here */
  function paintJump() {}
  function wireJump() {
    var btn = $("jumpDown");
    if (!btn) return;
    btn.classList.add("mf-jump58");
  }

  /* =========================================================
     5 · hold a model for 2 seconds → delete it for good
         (built-in models too)  +  5 seconds of Undo
     ========================================================= */
  /* a press-and-hold that works with a finger or a mouse: a red fill grows
     across the row for two seconds, then the small panel asks once more.
     Letting go, scrolling or leaving the row cancels it — nothing happens
     by accident. */
  var holdState = null;
  function startHold(el, ms, onDone) {
    cancelHold();
    el.classList.add("holding");
    var fill = document.createElement("i");
    fill.className = "hold-fill";
    fill.style.animationDuration = (ms / 1000) + "s";
    el.appendChild(fill);
    holdState = { el: el, fill: fill, onDone: onDone, timer: setTimeout(function () {
      var state = holdState;
      cancelHold();
      if (state && state.onDone) state.onDone();
    }, ms) };
  }
  function cancelHold() {
    if (!holdState) return;
    clearTimeout(holdState.timer);
    try { holdState.el.classList.remove("holding"); } catch (e) {}
    if (holdState.fill && holdState.fill.parentNode) holdState.fill.parentNode.removeChild(holdState.fill);
    holdState = null;
  }
  /* for a row that already exists (a pinned chip, a history row) */
  function hold(el, ms, onDone) {
    el.addEventListener("pointerdown", function (ev) {
      if (ev && ev.button !== undefined && ev.button !== 0) return;
      startHold(el, ms, onDone);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (evt) {
      el.addEventListener(evt, cancelHold);
    });
  }
  /* every model that ships with the app: the chat models from the server
     list AND the extra rows in ⚡ Models (Mayura, Vision, Z-Image), so the
     Settings list can offer all of them for a 2-second hold */
  function mfAllBuiltins() {
    var out = [], seen = {};
    mfBase().forEach(function (m) {
      if (!m || !m.key || seen[m.key]) return;
      seen[m.key] = 1;
      out.push({ key: m.key, label: m.label });
    });
    Array.prototype.slice.call(document.querySelectorAll("#modelMenu .model-item[data-model]")).forEach(function (row) {
      var key = row.getAttribute("data-model");
      if (!key || seen[key] || row.dataset.custom) return;
      var b = row.querySelector(".model-txt b");
      seen[key] = 1;
      out.push({ key: key, label: (b && b.textContent.trim()) || mfNames()[key] || key });
    });
    return out;
  }
  function builtinRows() {
    /* every model button that ships with the app (custom ones are not here) */
    return Array.prototype.slice.call(document.querySelectorAll("#modelMenu .model-item"))
      .filter(function (row) { return !row.dataset.custom && row.dataset.model; });
  }
  function modelTitle(key) {
    return mfNames()[key] || key;
  }
  function paintHidden() {
    hiddenKeys.forEach(function (key) {
      var md = mfModels(); if (md[key]) md[key] = false;
    });
    builtinRows().forEach(function (row) {
      var hidden = hiddenKeys.indexOf(row.dataset.model) >= 0;
      row.classList.toggle("mf-gone", hidden);
      row.style.display = hidden ? "none" : "";
    });
    try { if (window.updateModelUi) window.updateModelUi(); } catch (e) {}
    paintModelSettings();
  }
  function applyHidden(list, quiet) {
    hiddenKeys = (list || []).slice();
    writeJson(HIDE_KEY, hiddenKeys);
    /* the ⚡ Models list, the Settings list and the picker all follow */
    refilterBase();
    try { if (window.applyCustomModels) window.applyCustomModels(); } catch (e) {}
    paintHidden();
    if (!quiet) setStatusLine(hiddenKeys.length
      ? "🤖 " + hiddenKeys.length + " model(s) deleted permanently."
      : "🤖 All the built-in models are here.");
  }
  function setStatusLine(text) {
    try { if (window.setStatus) window.setStatus(text); } catch (e) {}
  }
  function refilterBase() {
    mfAllBase = mfAllBuiltins();
    /* BASE_CHAT_LIST is the list of models that ship with the app; deleting a
       built-in takes it out of this list (and the server remembers it) */
    try {
      var base = mfBase();
      if (!Array.isArray(base) || !base.length) return;
      if (!mfAllBase) mfAllBase = base.slice();
      var keep = mfAllBase.filter(function (m) { return hiddenKeys.indexOf(m.key) < 0; });
      base.length = 0;
      keep.forEach(function (m) { base.push(m); });
    } catch (e) {}
  }
  function applyBuiltinEverywhere(key) {
    refilterBase();
    var md = mfModels(); if (md[key]) md[key] = false;
    var nm = mfNames(); if (nm[key]) delete nm[key];
    try { window.savePrefs && window.savePrefs(); } catch (e) {}
    try { window.applyCustomModels && window.applyCustomModels(); } catch (e) {}
    paintHidden();
  }
  function deleteBuiltin(key, label) {
    /* the row goes at once, here and in ⚡ Models; the cloud copy follows.
       If the cloud copy cannot be written, the row comes back. */
    var before = hiddenKeys.slice();
    var info = { key: key, label: label, was: before.slice() };
    applyHidden(before.concat([key]), true);
    applyBuiltinEverywhere(key);
    return window.modelsRequest({ action: "hide", key: key }).then(function () {
      return info;
    }).catch(function (error) {
      applyHidden(before, true);
      applyBuiltinEverywhere(key);
      throw error;
    });
  }
  function restoreBuiltin(key, label) {
    if (!key) return Promise.resolve();
    applyHidden(hiddenKeys.filter(function (k) { return k !== key; }), true);
    var nm = mfNames();
    if (!nm[key]) {
      var all = mfAllBuiltins();
      for (var i = 0; i < all.length; i++) if (all[i].key === key) nm[key] = all[i].label;
    }
    return window.modelsRequest({ action: "unhide", key: key });
  }
  function deleteCustom(m) {
    var backup = JSON.parse(JSON.stringify(m));
    var wasLocal = !!m.local;
    if (window.removeModelEverywhere) window.removeModelEverywhere(m.key);
    return window.modelsRequest({ action: "delete", key: m.key }).then(function () {
      return backup;
    });
  }
  function confirmDelete(what, label, run) {
    var box = modal(
      '<h3>🗑️ Delete “' + esc(label) + '”?</h3>' +
      '<p class="mf-modal-p">' + (what === "builtin"
        ? "This model ships with the app. It leaves ⚡ Models and the Settings list <b>everywhere</b> — in every browser. This is <b>permanent</b> — once deleted, the model is gone for good. There is no undo and no restore."
        : "This model was added by you. It leaves ⚡ Models in every browser, together with its picture.") +
      '</p><div class="mf-modal-btns"><button type="button" class="mf-btn" data-mf-close>Keep it</button>' +
      '<button type="button" class="mf-btn danger" id="mfDoDelete">Delete now</button></div>', "danger");
    var go = $("mfDoDelete");
    if (go) go.addEventListener("click", async function () {
      go.disabled = true;
      go.textContent = "Deleting…";
      box.remove();
      try {
        var backup = await run();
        toast("🗑️ " + label + " deleted — permanently. There is no undo.", "", null, 3500);
      } catch (error) {
        toast("Could not delete " + label + " — " + (error.message || "try again"), "", null, 4500);
      }
    });
  }
  async function refreshModels(quiet) {
    try {
      if (window.refreshModelsQuiet) { await window.refreshModelsQuiet(true); }
    } catch (e) {}
    try { if (window.renderModelList) window.renderModelList(); } catch (e) {}
  }
  function wireHoldOn(selector, pick) {
    document.addEventListener("pointerdown", function (e) {
      if (holdState) return;
      var el = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (!el) return;
      var info = pick(el);
      if (!info) return;
      startHold(el, 2000, function () { confirmDelete(info.what, info.label, info.run); });
    });
    document.addEventListener("pointerup", cancelHold);
    document.addEventListener("pointercancel", cancelHold);
    document.addEventListener("scroll", cancelHold, true);
  }
  function customByName(key) {
    var list = mfCustom();
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function wireModelHolds() {
    /* ⚡ Models rows (built-in and saved ones) */
    wireHoldOn("#modelMenu .model-item", function (el) {
      var key = el.dataset.model;
      if (!key) return null;
      var custom = el.dataset.custom ? customByName(key) : null;
      if (custom) {
        return { what: "custom", label: custom.label, run: function () { return deleteCustom(custom); } };
      }
      var label = modelTitle(key);
      return { what: "builtin", label: label, run: function () { return deleteBuiltin(key, label); } };
    });
    /* the Settings rows (both the new list and “My models”) */
    wireHoldOn("#customModelList .mlist-row, #mfAllModels .mf-model-row", function (el) {
      if (el.dataset.customKey) {
        var m = customByName(el.dataset.customKey);
        if (!m) return null;
        return { what: "custom", label: m.label, run: function () { return deleteCustom(m); } };
      }
      var key = el.dataset.key;
      if (!key) return null;
      return { what: "builtin", label: modelTitle(key), run: function () { return deleteBuiltin(key, modelTitle(key)); } };
    });
  }
  function paintModelSettings() {
    var box = $("mfAllModels");
    if (box) {
      var rows = [];
      (mfAllBuiltins()).forEach(function (m) {
        var row = document.querySelector('#modelMenu .model-item[data-model="' + m.key + '"]');
        var ico = row ? (row.querySelector(".model-ico") || {}).innerHTML : "🤖";
        rows.push({ key: m.key, label: m.label, ico: ico || "🤖", where: "built-in model", custom: false });
      });
      (mfCustom()).forEach(function (m) {
        rows.push({ key: m.key, label: m.label, ico: window.customModelIcon ? window.customModelIcon(m.label, m.logo) : "🤖",
          where: (m.local ? "added here · this browser only" : "added here · saved in KV"), custom: true });
      });
      box.innerHTML = rows.length ? "" : '<div class="hint">No models at all — add one below.</div>';
      rows.forEach(function (r) {
        var dead = !r.custom && hiddenKeys.indexOf(r.key) >= 0;
        if (dead) return;
        var el = document.createElement("div");
        el.className = "mf-model-row" + (dead ? " mf-gone" : "");
        el.setAttribute("data-key", r.custom ? "" : r.key);
        if (r.custom) el.dataset.customKey = r.key;
        el.innerHTML = '<span class="mf-model-ico">' + (r.ico || "🤖") + '</span>' +
          '<span class="mf-model-txt"><b>' + esc(r.label) + '</b><small>' + esc(r.where) +
          (dead ? " · removed" : "") + '</small></span>' +
          (dead
            ? ''
            : '<span class="mf-hold-hint">hold 2 s to delete</span>');
        var back = el.querySelector(".mf-restore");
        if (back) back.addEventListener("click", async function () {
          back.disabled = true;
          await restoreBuiltin(r.key, r.label);
          toast("✅ " + r.label + " is back in ⚡ Models.", "", null, 3000);
          await refreshModels(true);
        });
        box.appendChild(el);
      });
    }
    var gone = $("mfGoneList"), count = $("mfGoneCount");
    if (gone) {
      var base = mfAllBuiltins();
      var out = base.filter(function (m) { return hiddenKeys.indexOf(m.key) >= 0; });
      if (count) count.textContent = String(out.length);
      gone.innerHTML = out.length ? "" : '<div class="hint">Nothing removed — every model that ships with the app is in ⚡ Models.</div>';
      out.forEach(function (m) {
        var el = document.createElement("div");
        el.className = "mf-model-row";
        el.innerHTML = '<span class="mf-model-ico">🤖</span><span class="mf-model-txt"><b>' + esc(m.label) +
          '</b><small>removed from ⚡ Models</small></span>';
        el.querySelector("button").addEventListener("click", async function () {
          await restoreBuiltin(m.key, m.label);
          toast("✅ " + m.label + " is back in ⚡ Models.", "", null, 3000);
          await refreshModels(true);
        });
        gone.appendChild(el);
      });
    }
  }

  /* =========================================================
     wiring it all up
     ========================================================= */
  function init() {
    /* the models the user removed travel with the account (KV) */
    hiddenKeys = readJson(HIDE_KEY, []);
    mfAllBase = mfAllBuiltins();
    pins = readJson(PINS_KEY, []).slice(0, MAX_PINS);
    refilterBase();
    paintHidden();
    paintModelSettings();
    paintPinBar();
    wireMoreMenu();
    wireDarkRow();
    wireFind();
    wireJump();
    wireModelHolds();
    paintDarkRow();

    /* keep the new lists in step with the app's own rendering */
    var appRenderModelList = window.renderModelList;
    if (typeof appRenderModelList === "function") {
      window.renderModelList = function () {
        appRenderModelList.apply(null, arguments);
        setTimeout(function () { paintModelSettings(); paintHidden(); }, 40);
      };
    }
    var appRenderMessages = window.renderMessages;
    if (typeof appRenderMessages === "function") {
      window.renderMessages = function () {
        var out = appRenderMessages.apply(null, arguments);
        setTimeout(function () { paintJump(); if ($("findBar") && !$("findBar").hidden) runFind(findState.q); }, 60);
        return out;
      };
    }
    var appRenderHistory = window.renderHistory;
    if (typeof appRenderHistory === "function") {
      window.renderHistory = function () {
        var out = appRenderHistory.apply(null, arguments);
        setTimeout(paintPinnedHistory, 20);
        return out;
      };
    }
    var appApply = window.applyCustomModels;
    if (typeof appApply === "function") {
      window.applyCustomModels = function () {
        refilterBase();
        var out = appApply.apply(null, arguments);
        setTimeout(function () { paintHidden(); paintModelSettings(); }, 30);
        return out;
      };
    }
    var appActive = window.activeChat;
    if (typeof appActive === "function") {
      window.activeChat = function () {
        var key = appActive.apply(null, arguments);
        return hiddenKeys.indexOf(key) >= 0 ? "" : key;
      };
    }
    var appSyncMeta = window.syncMeta;
    if (typeof appSyncMeta === "function") {
      window.syncMeta = function () {
        var out = appSyncMeta.apply(null, arguments);
        loadPins();
        loadHiddenFromServer();
        return out;
      };
    }

    /* after the login: bring the pins, the removed models and the lists in */
    var unlockWatch = setInterval(function () {
      if (!isAuthed()) return;
      clearInterval(unlockWatch);
      loadPins();
      loadHiddenFromServer();
      paintModelSettings();
    }, 800);
    paintJump();
  }

  function paintPinnedHistory() {
    var list = $("historyList");
    if (!list) return;
    var old = list.querySelector(".mf-pinned-group");
    if (old) old.remove();
    list.querySelectorAll(".mf-pin-mark").forEach(function (n) { n.remove(); });
    list.querySelectorAll(".history-row.pinned").forEach(function (r) { r.classList.remove("pinned"); });
    var real = pins.filter(function (id) { return chatById(id); });
    for (var i = real.length - 1; i >= 0; i--) {
      var row = list.querySelector('.history-row[data-chat-id="' + real[i] + '"]');
      if (!row) continue;
      row.classList.add("pinned");
      var mark = document.createElement("span");
      mark.className = "mf-pin-mark"; mark.textContent = "\uD83D\uDCCC"; mark.title = "Pinned";
      var item = row.querySelector(".history-item") || row;
      item.appendChild(mark);
      list.insertBefore(row, list.firstChild);   /* pinned chats always on top */
    }
  }

  async function loadHiddenFromServer() {
    if (!isAuthed()) return;
    try {
      var res = await window.fetchWithKv("/api/models", { method: "GET" });
      var data = await res.json().catch(function () { return {}; });
      if (data && Array.isArray(data.hidden)) applyHidden(data.hidden, true);
    } catch (e) {}
  }

  window.mf36 = {
    pin: pinChat, unpin: unpinChat, pins: function () { return pins.slice(); },
    hidden: function () { return hiddenKeys.slice(); },
    find: runFind, openFind: openFind, closeFind: closeFind,
    reloadHidden: loadHiddenFromServer, reloadPins: loadPins
  };
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(init, 60);
  else window.addEventListener("DOMContentLoaded", function () { setTimeout(init, 60); });
})();
</script>

<script>
/* =====================================================
   b54 — the Loop Glow design only
   -----------------------------------------------------
   1. the three controls under the chat box (⚡ Models, 🗣️ Reply, 🎤 Voice)
      become ONE panel, opened by the ⚡ button.  Nothing is lost: the same
      rows move inside it.  Switching to another design puts them back
      exactly where they were.
   That is the only thing this script does.
   ===================================================== */
(function () {
  var D = document;
  function isLoop() {
    /* b58 — the ⚡ panel is merged in EVERY design, and in any design added
       later: there is no per-design list to keep up to date any more */
    return true;
  }

  /* ---------- 1. one panel instead of three controls ---------- */
  var stored = null;

  function merge() {
    if (stored) return;
    var menu = D.getElementById("modelMenu");
    var reply = D.getElementById("replyMenu");
    var voice = D.querySelector(".voice-lang");
    if (!menu) return;
    stored = { menu: menu, reply: reply, replyHome: null, voice: voice, voiceHome: null, voiceNext: null };
    if (reply) {
      stored.replyHome = reply.parentNode;
      var h = D.createElement("div");
      h.className = "model-menu-title mf-sec";
      h.textContent = "Reply language";
      menu.appendChild(h);
      menu.appendChild(reply);
    }
    if (voice) {
      stored.voiceHome = voice.parentNode;
      stored.voiceNext = voice.nextSibling;
      var h2 = D.createElement("div");
      h2.className = "model-menu-title mf-sec";
      h2.textContent = "Voice input language";
      var row = D.createElement("div");
      row.className = "mf-voice-row";
      row.appendChild(voice);
      menu.appendChild(h2);
      menu.appendChild(row);
    }
    var btn = D.getElementById("modelBtn");
    if (btn) {
      var spans = btn.querySelectorAll("span");
      if (spans[1] && !spans[1].getAttribute("data-mf-orig")) {
        spans[1].setAttribute("data-mf-orig", spans[1].textContent);
        spans[1].textContent = "AI Controls";   /* b66 — one name for model + reply + voice */
      }
    }
  }

  function unmerge() {
    if (!stored) return;
    var menu = stored.menu;
    if (stored.reply && stored.replyHome) {
      stored.replyHome.appendChild(stored.reply);
    }
    if (stored.voice && stored.voiceHome) {
      if (stored.voiceNext && stored.voiceNext.parentNode === stored.voiceHome) {
        stored.voiceHome.insertBefore(stored.voice, stored.voiceNext);
      } else {
        stored.voiceHome.appendChild(stored.voice);
      }
    }
    var leftovers = menu.querySelectorAll(".mf-sec, .mf-voice-row");
    Array.prototype.forEach.call(leftovers, function (n) { n.parentNode.removeChild(n); });
    var btn = D.getElementById("modelBtn");
    if (btn) {
      var spans = btn.querySelectorAll("span");
      if (spans[1] && spans[1].getAttribute("data-mf-orig")) {
        spans[1].textContent = spans[1].getAttribute("data-mf-orig");
        spans[1].removeAttribute("data-mf-orig");
      }
    }
    stored = null;
  }

  function sync() { if (isLoop()) merge(); else unmerge(); }

  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", sync);
  else sync();

  /* when the design changes in Settings, follow it */
  try {
    var sp = window.setPalette;
    if (typeof sp === "function") {
      window.setPalette = function () {
        var out = sp.apply(this, arguments);
        setTimeout(sync, 0);
        return out;
      };
    }
  } catch (e) {}
  D.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(".palette-row")) setTimeout(sync, 60);
  }, true);

  window.mf37 = { sync: sync, merge: merge, unmerge: unmerge };
})();

</script>
<script>
/* =====================================================
   b57 — the image model, the size box and the default design.
   -----------------------------------------------------
   1. An image model no longer needs a “Generate image” button.
      Pick an image model and only the SIZE box stays: type what you want
      and press SEND — the picture is made from there.
   2. In Settings → add a model there is a tick box, “This model creates
      pictures”.  Tick it and that model behaves like an image model: the
      size box appears whenever it is the model in use.
   3. Settings → the design list has a “Save as my default” button.  Press it
      and that design is what opens everywhere from then on.  Nothing is
      forced on you any more.
   ===================================================== */
(function () {
  var D = document;
  var LS_DEF = "mf_default_palette";
  var LS_IMG = "mf_img_models";          /* { modelName: 1 } — ticked in Settings */
  var BUILTIN_IMG = "image";             /* the Z-Image Turbo row in the model list */
  var strip, sizeSel, grow, tick, savedNote;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function imgMap() { try { return JSON.parse(ls(LS_IMG) || "{}") || {}; } catch (e) { return {}; } }
  function saveImgMap(m) { ls(LS_IMG, JSON.stringify(m)); }

  /* ---------- which model is in use right now ---------- */
  function currentRow() {
    var m = D.getElementById("modelMenu");
    if (!m) return null;
    return m.querySelector('.model-item[aria-checked="true"]') || null;
  }
  function isImageModel() {
    var row = currentRow();
    if (!row) return false;
    var key = row.getAttribute("data-model") || "";
    if (key === BUILTIN_IMG) return true;                 /* Z-Image Turbo */
    var name = (row.textContent || "").replace(/\s+/g, " ").trim();
    var map = imgMap();
    if (map[key]) return true;
    for (var k in map) { if (map[k] && name.indexOf(k) === 0) return true; }
    return false;
  }

  /* ---------- the strip: the SIZE box only ---------- */
  function syncStrip() {
    strip = D.getElementById("stripImage");
    sizeSel = D.getElementById("imgSize");
    grow = D.getElementById("imgBtn");
    if (!strip) return;
    if (grow) { grow.style.display = "none"; grow.setAttribute("aria-hidden", "true"); }
    /* the app itself shows and hides this strip (the “show” class) — all we do
       is take the Generate button away and make the hint match the new flow */
    var hint = strip.querySelector(".strip-hint");
    if (hint) hint.textContent = "pick a size, describe the picture in the box below, then press \u27A4";
  }

  /* pressing Send while an image model is in use makes the picture */
  function sendAsImage(e) {
    if (!isImageModel()) return false;
    var btn = D.getElementById("imgBtn");
    if (!btn) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    btn.click();
    return true;
  }
  D.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("#send")) sendAsImage(e);
  }, true);
  D.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    var t = e.target;
    if (t && t.id === "input") sendAsImage(e);
  }, true);

  /* ---------- the tick box in “add a model” ---------- */
  function addTickBox() {
    if (D.getElementById("cmImgFlag")) return;
    var save = D.getElementById("cmSave");
    if (!save) return;
    var host = save.parentNode;
    var box = D.createElement("label");
    box.className = "mf-imgtick";
    box.innerHTML = '<input type="checkbox" id="cmImgFlag"> <span>This model creates pictures ' +
      '\u2014 show the image size box when it is chosen</span>';
    host.insertBefore(box, save);
    box.addEventListener("change", function () { box.classList.toggle("on", box.querySelector("input").checked); });
    save.addEventListener("click", function () {
      var nm = D.getElementById("cmName");
      var on = box.querySelector("input").checked;
      if (!nm || !nm.value.trim()) return;
      var key = nm.value.trim();
      setTimeout(function () {
        var m = imgMap();
        if (on) m[key] = 1; else delete m[key];
        saveImgMap(m);
        syncStrip();
      }, 260);
    }, true);
  }

  /* ---------- Save this design as my default ---------- */
  function designRow() {
    if (D.getElementById("mfDefaultBtn")) return;
    var list = D.getElementById("paletteRow");
    if (!list) return;
    var host = list.parentNode;
    var row = D.createElement("div");
    row.className = "mf-default-row";
    row.innerHTML = '<button id="mfDefaultBtn" class="mf-default-btn" type="button">' +
      'Save this design as my default</button><span id="mfDefaultNote" class="mf-default-note"></span>';
    host.appendChild(row);
    var btn = D.getElementById("mfDefaultBtn");
    savedNote = D.getElementById("mfDefaultNote");
    btn.addEventListener("click", function () {
      var key = D.documentElement.getAttribute("data-palette") || "loop";
      ls(LS_DEF, key);
      showDefaultNote(true);
      try {
        if (typeof toast === "function") toast("Saved — this design is your default now");
      } catch (e) {}
    });
    showDefaultNote(false);
  }
  function showDefaultNote(justSaved) {
    if (!savedNote) return;
    var mine = ls(LS_DEF);
    var now = D.documentElement.getAttribute("data-palette");
    if (!mine) { savedNote.textContent = "nothing saved yet \u2014 pick a design, then press the button"; return; }
    savedNote.textContent = (mine === now)
      ? (justSaved ? "\u2713 saved \u2014 this design opens first from now on" : "\u2713 your default \u2014 this design opens first")
      : "your default is " + mine + " \u2014 press the button to make this one the default";
  }

  /* on load: open the design the user saved, if any */
  function applySaved() {
    var mine = ls(LS_DEF);
    if (!mine) return;
    try {
      if (typeof setPalette === "function" && D.documentElement.getAttribute("data-palette") !== mine) {
        setPalette(mine, true);
      }
    } catch (e) {}
  }

  function boot() {
    addTickBox();
    designRow();
    applySaved();
    syncStrip();
    var m = D.getElementById("modelMenu");
    if (m) m.addEventListener("click", function () { setTimeout(syncStrip, 40); });
    D.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.closest && t.closest("#modelBtn")) setTimeout(syncStrip, 60);
      if (t && t.closest && t.closest(".palette-row, #paletteRow")) setTimeout(function () { showDefaultNote(false); }, 80);
    }, true);
  }
  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.mf41 = { syncStrip: syncStrip, isImageModel: isImageModel, note: showDefaultNote };
})();
</script>
<script>
/* =====================================================================
   BATCH 98 — the client half
   ---------------------------------------------------------------------
   1. ⚡ AI model · Reply · Voice is ONE panel in EVERY design, including
      any design added later (the merge no longer asks which design it is).
   2. The panel stays open while you pick: it closes only when you tap
      outside it.
   3. Dark mode lives in the ⋮ menu (Settings · Dark mode · Pin · Share ·
      Find); the old hidden moon button is gone.
   4. The tag line sits a real two inches under the word, and both are
      centred.
   5. “Back to the newest message” is a proper button: it appears the
      moment you scroll up and fades away 2.5 s later — scroll up again
      and it is back.
   6. Attaching a picture no longer switches Sarvam Vision on and no
      longer opens the Vision sheet: the picture goes straight to the
      model you chose. Several pictures can be attached.
   7. The attach button is a one-inch square, and tapping it slides the
      pictures open.
   8. The thinking panel shows the model's own live stream (real tokens),
      not a demo script. With “less motion” it simply updates without
      typing.
   ===================================================================== */
(function () {
  var D = document;
  var root = D.documentElement;

  /* ---------------- 1 · the panel is one panel everywhere ---------------- */
  /* the b54 script decides per design; b58 makes that decision always yes,
     so a design added in the future gets the merged panel with no new code */
  try {
    if (window.mf37 && typeof window.mf37.sync === 'function') window.mf37.sync();
  } catch (e) {}

  /* ---------------- 2 · the panel closes only on an outside tap -------- */
  /* closing is done by the app on an outside tap already; what used to close
     the panel too early was the reply-language choice. Undo that: */
  if (typeof window.setAnswerLanguage === 'function' && !window.setAnswerLanguage.mf58) {
    var originalSetAnswerLanguage = window.setAnswerLanguage;
    var patched = function (code, quiet) {
      var menu = D.getElementById('modelMenu');
      var stayOpen = menu && menu.classList.contains('show');
      originalSetAnswerLanguage(code, quiet);
      if (stayOpen) {
        /* put the panel back exactly as it was: the user is still choosing */
        menu.classList.add('show');
        var btn = D.getElementById('modelBtn');
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }
    };
    patched.mf58 = true;
    window.setAnswerLanguage = patched;
  }

  /* ---------------- 3 · dark mode inside the ⋮ menu -------------------- */
  function themeLabel() {
    return D.body.classList.contains('dark') ? 'Light mode' : 'Dark mode';
  }
  function paintThemeItem() {
    var item = D.querySelector('#moreMenu .mf-mi[data-mf="theme"] .mf-mf-label');
    if (item) item.textContent = themeLabel();
    var ico = D.querySelector('#moreMenu .mf-mi[data-mf="theme"] .mf-mi-ic');
    if (ico) ico.textContent = D.body.classList.contains('dark') ? '☀️' : '🌙';
  }
  function addThemeItem() {
    var menu = D.getElementById('moreMenu');
    if (!menu || menu.querySelector('[data-mf="theme"]')) return;
    var btn = D.createElement('button');
    btn.type = 'button';
    btn.className = 'mf-mi';
    btn.setAttribute('data-mf', 'theme');
    /* b60 — like every other row of this menu, it closes on the tap */
    btn.setAttribute('role', 'menuitem');
    var ico = D.createElement('span');
    ico.className = 'mf-mi-ic';
    var label = D.createElement('span');
    label.className = 'mf-mf-label';
    btn.appendChild(ico);
    btn.appendChild(label);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof window.toggleTheme === 'function') window.toggleTheme();
      else D.body.classList.toggle('dark');
      paintThemeItem();
      /* b60 — the menu is done with its job: close it, as the other rows do */
      var mfMenu = D.getElementById('moreMenu');
      if (mfMenu) mfMenu.classList.remove('show');
      var mfBtn = D.getElementById('moreBtn');
      if (mfBtn) mfBtn.setAttribute('aria-expanded', 'false');
    });
    /* right under Settings, as asked */
    var settings = menu.querySelector('[data-mf="settings"]');
    if (settings && settings.nextSibling) menu.insertBefore(btn, settings.nextSibling);
    else menu.appendChild(btn);
    paintThemeItem();
  }
  function removeOldThemeButton() {
    /* b58 — the old moon stays in the page (already hidden): taking it out
       broke anything that looks it up at boot, and it is out of the way */
    var old = D.getElementById('theme');
    if (old) { old.classList.add('mf-hide'); old.hidden = true; old.setAttribute('aria-hidden', 'true'); }
  }
  function syncThemeUi() { addThemeItem(); removeOldThemeButton(); paintThemeItem(); }

  /* ---------------- 4 · the word and the tag line, centred, 2 inches --- */
  function placeTagLine() {
    var inner = D.getElementById('gateInner') || D.querySelector('#gateHero .gate-inner');
    var word = D.querySelector('.mf-word-fur') || D.querySelector('.mf-brand');
    if (!inner || !word) return;
    /* the word's own ink, not the SVG box: the box carries the hive and the
       bees' tail, which made the tag look half a screen away */
    var target = window.innerWidth <= 820 ? 112 : 190;   /* ≈ two inches on a laptop */
    inner.style.setProperty('--mf-tag-gap', '0px');
    var gap = inner.getBoundingClientRect().top - word.getBoundingClientRect().bottom;
    /* the hero box is taller than the word (the hive and the bees live in that
       tail), so this has to be allowed to pull UP: a negative margin */
    var value = Math.round(target - gap);
    if (!isFinite(value)) return;
    inner.style.setProperty('--mf-tag-gap', Math.max(-320, Math.min(400, value)) + 'px');
  }

  /* ---------------- 5 · the “back to the newest message” button -------- */
  var jumpTimer = null;
  function paintJumpUp() {
    var btn = D.getElementById('jumpDown');
    if (!btn) return;
    var room = D.documentElement.scrollHeight - window.innerHeight;
    var fromBottom = room - window.scrollY;
    if (fromBottom < 160) { btn.hidden = true; btn.classList.remove('show'); return; }
    if (window.scrollY > 60) { btn.hidden = false; btn.classList.add('show'); }
  }
  function wireJumpUp() {
    var btn = D.getElementById('jumpDown');
    if (!btn || btn.getAttribute('data-mf58')) return;
    btn.setAttribute('data-mf58', '1');
    btn.hidden = true;                       /* nothing to go back to at the start */
    var lastY = window.scrollY;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      var goingUp = y < lastY - 2;
      lastY = y;
      var room = D.documentElement.scrollHeight - window.innerHeight;
      if (room - y < 160) { btn.hidden = true; btn.classList.remove('show'); return; }
      if (!goingUp) return;
      /* up: show at once, then let it go after 2.5 seconds */
      btn.hidden = false;
      btn.classList.add('show');
      clearTimeout(jumpTimer);
      jumpTimer = setTimeout(function () {
        btn.classList.remove('show');
        btn.hidden = true;
      }, 2500);
    }, { passive: true });
    btn.addEventListener('click', function () {
      clearTimeout(jumpTimer);
      btn.classList.remove('show');
      btn.hidden = true;
      window.scrollTo({ top: D.documentElement.scrollHeight, behavior: 'smooth' });
    });
  }

  /* ---------------- 6 + 7 · pictures: no Vision, many pictures --------- */
  window.mfPictures = window.mfPictures || [];
  function pictureList() {
    try {
      if (window.mfAttachedList && window.mfAttachedList.length) return window.mfAttachedList;
    } catch (e) {}
    return window.mfPictures;
  }
  function rememberPicture(pic) {
    var list = window.mfAttachedList;
    if (!Array.isArray(list)) { list = window.mfAttachedList = []; }
    if (!pic || !pic.dataUrl) return;
    /* the same picture twice is one picture */
    for (var i = 0; i < list.length; i++) if (list[i].dataUrl === pic.dataUrl) return;
    list.push(pic);
    if (list.length > 8) list.shift();
    paintPictureBox();
  }
  function dropPicture(index) {
    var list = window.mfAttachedList;
    if (!Array.isArray(list)) return;
    list.splice(index, 1);
    if (!list.length) { window.mfAttachedList = []; }
    paintPictureBox();
  }
  function clearPictures() {
    window.mfAttachedList = [];
    paintPictureBox();
  }
  window.mfClearPictures = clearPictures;

  function paintPictureBox() {
    var box = D.getElementById('mfPicBox');
    var mini = D.getElementById('attachMini');
    var list = window.mfAttachedList || [];
    if (!mini) return;
    if (!box) {
      box = D.createElement('div');
      box.id = 'mfPicBox';
      box.className = 'mf-pic-box';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Your pictures — slide to see them all');
      var wrap = D.querySelector('.attach-wrap');
      if (wrap) wrap.appendChild(box);
    }
    if (!list.length) { box.classList.remove('show'); mini.classList.remove('has-many'); mini.removeAttribute('data-count'); return; }
    box.innerHTML = '';
    list.forEach(function (pic, i) {
      var cell = D.createElement('figure');
      cell.className = 'mf-pic-cell';
      var img = D.createElement('img');
      img.src = pic.dataUrl;
      img.alt = pic.name || ('picture ' + (i + 1));
      cell.appendChild(img);
      var x = D.createElement('button');
      x.type = 'button';
      x.className = 'mf-pic-x';
      x.setAttribute('aria-label', 'Remove this picture');
      x.textContent = '✕';
      x.addEventListener('click', function (ev) { ev.stopPropagation(); dropPicture(i); });
      cell.appendChild(x);
      box.appendChild(cell);
    });
    box.classList.toggle('show', list.length > 1);
    mini.classList.toggle('has-many', list.length > 1);
    if (list.length > 1) mini.setAttribute('data-count', String(list.length));
    else mini.removeAttribute('data-count');
    try { window.dispatchEvent(new Event('mf-pics-changed')); } catch (e) {}
  }
  window.mfPaintPictures = paintPictureBox;

  /* the small box opens the slide of pictures */
  function wirePictureBox() {
    var mini = D.getElementById('attachMini');
    if (!mini || mini.getAttribute('data-mf58')) return;
    mini.setAttribute('data-mf58', '1');
    mini.addEventListener('click', function () {
      var list = window.mfAttachedList || [];
      if (list.length < 2) return;              /* one picture: the app's own panel */
      var box = D.getElementById('mfPicBox');
      if (box) box.classList.toggle('show');
    });
  }

  /* ---------------- 8 · the live thinking panel ------------------------ */
  function liveRow() { return D.querySelector('.typing-row'); }
  function liveBox() {
    var row = liveRow();
    if (!row) return null;
    var card = row.querySelector('.think-card') || row;
    var box = card.querySelector('.mf-live-box');
    if (!box) {
      box = D.createElement('div');
      box.className = 'mf-live-box';
      var live = D.createElement('div');
      live.className = 'mf-live-text';
      box.appendChild(live);
      var thought = D.createElement('div');
      thought.className = 'mf-live-thought mf-live-wait';
      thought.innerHTML = '<span class="think-cursor"></span>';
      box.appendChild(thought);
      card.appendChild(box);
      row.classList.add('mf-live-on');
      var title = row.querySelector('.think-title');
      if (title) title.textContent = 'Thinking…';
      var model = row.querySelector('.typing-model');
      if (model) model.setAttribute('data-live', '1');
    }
    return box;
  }
  var liveState = { text: '', thought: '', nativeThought: '', inlineThought: '' };
  /* b96 - many models think INSIDE the answer stream, between
     thinking tags, instead of a separate reasoning field. Split
     those out live, so their thought fills the box too. */
  function pullInlineThought() {
    var raw = liveState.text;
    if (!raw) return;
    var open = raw.search(/<(thinking|thought|reasoning)>/i);
    if (open < 0) return;
    var rest = raw.slice(open).replace(/<(thinking|thought|reasoning)>/i, '');
    var close = rest.search(/<\\/(thinking|thought|reasoning)>/i);
    var inner = close >= 0 ? rest.slice(0, close) : rest;
    inner = inner.replace(/^\\s+/, '');
    if (inner && inner !== liveState.inlineThought) {
      liveState.inlineThought = inner;
      liveState.thought = (liveState.nativeThought || '') + inner;
      scheduleThoughtReveal();
    }
  }
  /* b94 - the live thought is revealed smoothly, a few letters at a
     time (even when the model sends it in bursts), and painted as
     thought-lines: older lines rest faded, the line being thought
     right now stays lit, with the cursor riding at its end */
  var thoughtShown = 0, thoughtTimer = null;
  function paintThought() {
    var box = D.querySelector('.mf-live-box');
    if (!box) return;
    var t = box.querySelector('.mf-live-thought');
    if (!t) return;
    var shown = liveState.thought.slice(0, thoughtShown);
    if (!shown) return;
    t.classList.remove('mf-live-wait');
    t.innerHTML = '';
    var segs = shown.replace(/([.!?])\\s+/g, '$1\\u0001').split('\\u0001');
    segs = segs.filter(function (x) { return x.trim().length; }).slice(-8);
    segs.forEach(function (seg, idx) {
      var d = D.createElement('div');
      d.className = 'mf-tline' + (idx === segs.length - 1 ? ' now' : '');
      d.textContent = seg;
      t.appendChild(d);
    });
    var cur = D.createElement('span');
    cur.className = 'think-cursor';
    t.appendChild(cur);
    t.scrollTop = t.scrollHeight;
  }
  function scheduleThoughtReveal() {
    if (thoughtTimer) return;
    thoughtTimer = setInterval(function () {
      if (thoughtShown < liveState.thought.length) {
        thoughtShown = Math.min(liveState.thought.length, thoughtShown + 4);
        paintThought();
      } else { clearInterval(thoughtTimer); thoughtTimer = null; }
    }, 24);
  }
  function liveDelta(piece, kind) {
    var box = liveBox();
    if (!box) return;
    if (kind === 'reason') {
      liveState.nativeThought = (liveState.nativeThought || '') + piece;
      liveState.thought = liveState.nativeThought + (liveState.inlineThought || '');
      scheduleThoughtReveal();
    } else {
      liveState.text += piece;
      box.querySelector('.mf-live-text').textContent = liveState.text.slice(-4000);
      pullInlineThought();
    }
    var card = box.parentNode;
    if (card && card.scrollHeight) card.scrollTop = card.scrollHeight;
  }
  function liveReset() {
    liveState = { text: '', thought: '' };
    thoughtShown = 0;
    if (thoughtTimer) { clearInterval(thoughtTimer); thoughtTimer = null; }
    var box = D.querySelector('.mf-live-box');
    if (box) box.parentNode.removeChild(box);
    var row = liveRow();
    if (row) row.classList.remove('mf-live-on');
  }

  /* reads the Worker's event stream; resolves with the final “done” object */
  window.mfReadStream = async function (response, signal) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var final = null;
    for (;;) {
      if (signal && signal.aborted) { try { reader.cancel(); } catch (e) {} break; }
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var cut;
      while ((cut = buffer.indexOf('\\n')) >= 0) {
        var line = buffer.slice(0, cut).replace(/\\r$/, '');
        buffer = buffer.slice(cut + 1);
        if (line.slice(0, 5) !== 'data:') continue;
        var raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        var event;
        try { event = JSON.parse(raw); } catch (e) { continue; }
        if (event.type === 'delta' && event.text) liveDelta(event.text, 'text');
        else if (event.type === 'reason' && event.text) liveDelta(event.text, 'reason');
        else if (event.type === 'replace' && event.text) {
          liveState.text = event.text;
          var box = liveBox();
          if (box) box.querySelector('.mf-live-text').textContent = event.text.slice(-4000);
        } else if (event.type === 'done') final = event;
      }
    }
    return final;
  };
  window.mfLiveReset = liveReset;
  window.mfLiveBox = liveBox;

  /* ---------------- start-up + keep in step with the design ------------- */
  function sync() {
    syncThemeUi();
    /* measured once the layout has settled, then again after the artwork has
       taken its final size — otherwise the gap is measured too early */
    placeTagLine();
    requestAnimationFrame(placeTagLine);
    setTimeout(placeTagLine, 120);
    setTimeout(placeTagLine, 420);
    wireJumpUp();
    wirePictureBox();
    paintPictureBox();
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', sync);
  else sync();
  window.addEventListener('load', function () { setTimeout(placeTagLine, 60); });
  try {
    var sp = window.setPalette;
    if (typeof sp === 'function' && !sp.mf58) {
      var wrapped = function () {
        var out = sp.apply(this, arguments);
        setTimeout(sync, 0);
        return out;
      };
      wrapped.mf58 = true;
      window.setPalette = wrapped;
    }
  } catch (e) {}
  D.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.palette-row')) setTimeout(sync, 60);
    if (t && t.closest && t.closest('#moreBtn')) setTimeout(syncThemeUi, 0);
  }, true);
  window.addEventListener('mf-chat-sent', function () { clearPictures(); liveReset(); });
  var tagTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(tagTimer);
    tagTimer = setTimeout(placeTagLine, 120);
  }, { passive: true });

  window.mf58 = {
    sync: sync, liveDelta: liveDelta, liveReset: liveReset,
    pictures: paintPictureBox, rememberPicture: rememberPicture
  };
})();

</script>
<script>
/* =====================================================================
   BATCH 98 — the client half
   ---------------------------------------------------------------------
   · the picture button is half the size and can be dragged anywhere;
   · tapping it opens ONE frame: ‹ › through every picture, a counter,
     swipe on a touch screen, crop and remove;
   · the options card never hangs around for a picture;
   · after the question is sent, everything picture-shaped goes away.
   ===================================================================== */
(function () {
  var D = document;
  var POS_KEY = 'mf_square_pos_v1';
  var pics = function () {
    return Array.isArray(window.mfAttachedList) ? window.mfAttachedList : [];
  };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  /* ------------------------------------------------------------------
     where the square sits
     ------------------------------------------------------------------ */
  function readPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { return null; }
  }
  function savePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {}
  }
  function defaultPos(btn) {
    var w = btn.offsetWidth || 52, h = btn.offsetHeight || 52;
    var dock = D.getElementById('dock');
    var top = dock ? dock.getBoundingClientRect().top : (window.innerHeight - 190);
    /* b60 — it waits in the BOTTOM-RIGHT corner, just above the whole panel,
       so it never sits on the model button; the user can drag it from there */
    return { x: Math.max(18, window.innerWidth - w - 18), y: Math.max(70, top - h - 12) };
  }
  function place(btn, p) {
    var w = btn.offsetWidth || 52, h = btn.offsetHeight || 52;
    var x = clamp(p.x, 6, Math.max(6, window.innerWidth - w - 6));
    var y = clamp(p.y, 6, Math.max(6, window.innerHeight - h - 6));
    btn.style.left = Math.round(x) + 'px';
    btn.style.top = Math.round(y) + 'px';
    return { x: x, y: y };
  }

  /* ------------------------------------------------------------------
     the viewer
     ------------------------------------------------------------------ */
  var view = null;
  var at = 0;

  function build() {
    if (view) return view;
    view = D.createElement('div');
    view.id = 'mfViewer';
    view.className = 'mfv';
    view.setAttribute('role', 'dialog');
    view.setAttribute('aria-modal', 'true');
    view.setAttribute('aria-label', 'Your pictures — slide, crop or remove');
    var card = D.createElement('div');
    card.className = 'mfv-card';
    var x = D.createElement('button');
    x.type = 'button'; x.className = 'mfv-x'; x.setAttribute('aria-label', 'Close'); x.textContent = '✕';
    var stage = D.createElement('div');
    stage.className = 'mfv-stage';
    var img = D.createElement('img');
    img.className = 'mfv-img'; img.alt = 'Your picture';
    stage.appendChild(img);
    var nav = D.createElement('div');
    nav.className = 'mfv-nav';
    var prev = D.createElement('button');
    prev.type = 'button'; prev.className = 'mfv-prev'; prev.setAttribute('aria-label', 'Previous picture'); prev.textContent = '‹';
    var count = D.createElement('span');
    count.className = 'mfv-count'; count.textContent = '1 / 1';
    var next = D.createElement('button');
    next.type = 'button'; next.className = 'mfv-next'; next.setAttribute('aria-label', 'Next picture'); next.textContent = '›';
    nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next);
    var acts = D.createElement('div');
    acts.className = 'mfv-acts';
    var crop = D.createElement('button');
    crop.type = 'button'; crop.className = 'mfv-crop'; crop.textContent = '✂️ Crop';
    var del = D.createElement('button');
    del.type = 'button'; del.className = 'mfv-del'; del.textContent = '🗑️ Remove';
    acts.appendChild(crop); acts.appendChild(del);
    card.appendChild(x); card.appendChild(stage); card.appendChild(nav); card.appendChild(acts);
    view.appendChild(card);
    D.body.appendChild(view);

    x.addEventListener('click', close);
    view.addEventListener('click', function (e) { if (e.target === view) close(); });
    prev.addEventListener('click', function (e) { e.stopPropagation(); step(-1); });
    next.addEventListener('click', function (e) { e.stopPropagation(); step(1); });
    crop.addEventListener('click', function (e) { e.stopPropagation(); cropCurrent(); });
    del.addEventListener('click', function (e) { e.stopPropagation(); removeCurrent(); });

    /* swipe, with a finger or with the mouse */
    var from = null;
    stage.addEventListener('pointerdown', function (e) { from = e.clientX; });
    stage.addEventListener('pointerup', function (e) {
      if (from === null) return;
      var dx = e.clientX - from;
      from = null;
      if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    });
    stage.addEventListener('pointercancel', function () { from = null; });

    D.addEventListener('keydown', function (e) {
      if (!view.classList.contains('show')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    });
    return view;
  }

  function paint() {
    if (!view) return;
    var list = pics();
    if (!list.length) { close(); return; }
    at = clamp(at, 0, list.length - 1);
    var pic = list[at];
    var img = view.querySelector('.mfv-img');
    if (img.getAttribute('src') !== pic.dataUrl) img.src = pic.dataUrl;
    img.alt = pic.name || 'Your picture';
    view.querySelector('.mfv-count').textContent = (at + 1) + ' / ' + list.length;
    var prev = view.querySelector('.mfv-prev');
    var next = view.querySelector('.mfv-next');
    prev.disabled = list.length < 2;
    next.disabled = list.length < 2;
    prev.style.visibility = list.length < 2 ? 'hidden' : 'visible';
    next.style.visibility = list.length < 2 ? 'hidden' : 'visible';
  }

  function open(index) {
    build();
    at = index || 0;
    view.classList.add('show');
    paint();
    closeSquarePanel();
  }
  function close() {
    if (view) view.classList.remove('show');
  }
  function step(delta) {
    var list = pics();
    if (list.length < 2) return;
    at = (at + delta + list.length) % list.length;
    paint();
  }

  /* ---- crop the picture on screen, inside the same frame ---- */
  function cropCurrent() {
    var list = pics();
    var pic = list[at];
    if (!pic) return;
    var index = at;
    close();
    if (typeof window.openCrop !== 'function') return;
    /* what the crop sheet hands back comes here */
    window.mfGalleryApply = function (dataUrl) {
      var l = pics();
      if (!l[index]) return;
      l[index].dataUrl = dataUrl;
      syncThumb(l[index]);
      if (typeof window.mfPaintPictures === 'function') window.mfPaintPictures();
      setTimeout(function () { open(Math.min(index, pics().length - 1)); }, 80);
    };
    window.openCrop({
      src: pic.dataUrl,
      name: pic.name || 'picture.png',
      mime: pic.mime || 'image/png',
      mode: 'gallery'
    });
  }

  /* ---- take one picture out of the strip ---- */
  function removeCurrent() {
    var list = pics();
    if (!list.length) { close(); return; }
    var gone = list[at];
    list.splice(at, 1);
    try {
      /* keep the app's own "attached picture" in step */
      if (typeof attachedImage !== 'undefined' && attachedImage &&
          gone && attachedImage.dataUrl === gone.dataUrl) {
        attachedImage = list[0] ? {
          name: list[0].name, mime: list[0].mime, dataUrl: list[0].dataUrl
        } : null;
      }
    } catch (e) {}
    if (!list.length) {
      if (window.mfClearPictures) window.mfClearPictures();
      close();
      return;
    }
    at = Math.min(at, list.length - 1);
    paint();
    if (typeof window.mfPaintPictures === 'function') window.mfPaintPictures();
  }

  function syncThumb(pic) {
    var thumb = D.getElementById('attachMiniThumb');
    if (thumb && pic && pic.dataUrl) { thumb.src = pic.dataUrl; thumb.hidden = false; }
    try {
      if (typeof attachedImage !== 'undefined' && attachedImage && pic) attachedImage.dataUrl = pic.dataUrl;
    } catch (e) {}
    if (typeof window.updateAttachMini === 'function') window.updateAttachMini();
  }

  /* ------------------------------------------------------------------
     the square: drag it, tap it
     ------------------------------------------------------------------ */
  var btn = D.getElementById('attachMini');
  var dragging = false, moved = false, grab = null, suppress = false;

  function closeSquarePanel() {
    var panel = D.getElementById('attachPanel');
    if (panel) { panel.hidden = true; panel.classList.remove('show', 'ap-open'); }
  }

  function floating(on) {
    if (!btn) return;
    btn.classList.toggle('mf-float', !!on);
    if (!on) {
      btn.style.left = '';
      btn.style.top = '';
      btn.classList.remove('dragging');
    }
  }

  function syncSquare() {
    var n = pics().length;
    D.body.classList.toggle('mf-has-pic', n > 0);
    if (n > 0) {
      floating(true);
      if (btn) place(btn, readPos() || defaultPos(btn));
      closeSquarePanel();            /* the old card never covers the page */
    } else {
      floating(false);
      close();
    }
  }

  if (btn) {
    /* the app opens its own card on a click; for pictures this is our button */
    btn.addEventListener('click', function (e) {
      if (!pics().length) return;                 /* a document: leave it alone */
      e.preventDefault();
      e.stopImmediatePropagation();
      if (suppress) { suppress = false; return; }
      open(0);
    }, true);

    /* the pointer may leave the little square the instant it moves, and on
       some browsers the capture is refused — so the move and the release are
       listened for on the whole window, which always hears them */
    var onMove = function (e) {
      if (!dragging || !grab) return;
      /* a real drag, measured from where the finger went down (movementX is
         not reliable everywhere) */
      if (!moved && Math.abs(e.clientX - grab.sx) + Math.abs(e.clientY - grab.sy) > 3) moved = true;
      if (!moved) return;
      btn.classList.add('dragging');
      place(btn, { x: e.clientX - grab.dx, y: e.clientY - grab.dy });
      if (e.cancelable) e.preventDefault();
    };
    var onEnd = function () {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      if (moved) {
        btn.classList.remove('dragging');
        var r = btn.getBoundingClientRect();
        savePos(place(btn, { x: r.left, y: r.top }));
        suppress = true;
        setTimeout(function () { suppress = false; }, 220);
      }
      grab = null;
    };

    btn.addEventListener('pointerdown', function (e) {
      if (!btn.classList.contains('mf-float')) return;
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      moved = false;
      var r = btn.getBoundingClientRect();
      grab = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onEnd, true);
      window.addEventListener('pointercancel', onEnd, true);
    });

    /* a double tap puts it back where it started */
    btn.addEventListener('dblclick', function (e) {
      if (!pics().length) return;
      e.preventDefault();
      savePos(defaultPos(btn));
      place(btn, defaultPos(btn));
    });
  }

  /* the app's own "the picture is gone" paths must reach us too */
  window.addEventListener('mf-pics-changed', syncSquare);
  window.addEventListener('mf-chat-sent', function () {
    close();
    floating(false);
    closeSquarePanel();
    setTimeout(syncSquare, 30);
  });
  window.addEventListener('resize', function () {
    if (pics().length && btn) place(btn, readPos() || defaultPos(btn));
  }, { passive: true });

  /* the ready prompts: on a PC the four cards step aside while they are open */
  var suggest = D.getElementById('suggest');
  if (suggest && window.MutationObserver) {
    var flag = function () {
      /* only when the LIST is open — a closed toggle must not hide anything */
      D.body.classList.toggle('mf-suggest-open', !!suggest.querySelector('.suggest-head'));
    };
    new MutationObserver(flag).observe(suggest, { attributes: true, attributeFilter: ['class'],
      childList: true, subtree: true });
    flag();
  }

  window.mf59 = { open: open, close: close, next: function () { step(1); }, prev: function () { step(-1); },
    count: function () { return pics().length; }, sync: syncSquare };
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', syncSquare);
  else syncSquare();
})();

</script>
<script>
/* =====================================================
   b60 — three finishing touches
   -----------------------------------------------------
   1. dark mode and light mode arrive as a wave: a soft
      circle that opens in one corner and sweeps to the
      opposite one (dark from the top-right, light from
      the bottom-left), so the change looks premium
      instead of snapping.
   2. press and hold a chat in the history for 2 seconds
      and a small menu offers "Pin chat" — hold a pinned
      chat and the same menu offers "Unpin chat".
   3. nothing here touches the rest of the page.
   ===================================================== */
(function () {
  var D = document;

  /* ---------- 1 · the corner-to-corner theme wave ---------- */
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  window.mfThemeWipe = function (apply) {
    if (typeof apply !== 'function') return;
    if (reduced()) { apply(); return; }          /* "less motion": no wave at all */
    var goingDark = !D.body.classList.contains('dark');
    var layer = D.createElement('div');
    layer.className = 'mf-wipe ' + (goingDark ? 'to-dark' : 'to-light');
    layer.setAttribute('aria-hidden', 'true');
    D.body.appendChild(layer);
    void layer.offsetWidth;                      /* the start corner paints first */
    layer.classList.add('run');
    var flipped = false;
    var flip = function () {
      if (flipped) return;
      flipped = true;
      try { apply(); } catch (e) {}
    };
    setTimeout(flip, 330);                       /* the page changes under the wave */
    var closed = false;
    var done = function () {
      if (closed) return;
      closed = true;
      flip();
      layer.classList.add('fade');
      setTimeout(function () {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }, 440);
    };
    layer.addEventListener('transitionend', function (e) {
      if (e.propertyName === 'clip-path') done();
    });
    setTimeout(done, 1100);                      /* a safety net */
  };

  /* ---------- 2 · hold a chat in the history for 2 seconds ---------- */
  var timer = null, menu = null, menuRow = null, justReleased = false, heldRow = false, sx = 0, sy = 0;

  function pinnedIds() {
    try { return (window.mf36 && window.mf36.pins && window.mf36.pins()) || []; }
    catch (e) { return []; }
  }
  function rowOf(node) { return node && node.closest ? node.closest('.history-row') : null; }
  function rowId(row) { return row ? (row.getAttribute('data-chat-id') || '') : ''; }
  function closeMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
    menuRow = null;
  }
  function openMenu(row) {
    closeMenu();
    var id = rowId(row);
    if (!id) return;
    var pinned = pinnedIds().indexOf(id) >= 0;
    var box = row.getBoundingClientRect();
    menu = D.createElement('div');
    menu.className = 'mf-hold-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<button type="button" class="mf-hold-item" role="menuitem">' +
      (pinned ? '\uD83D\uDCCD Unpin chat' : '\uD83D\uDCCC Pin chat') + '</button>' +
      '<button type="button" class="mf-hold-item mf-hold-cancel" role="menuitem">Cancel</button>';
    D.body.appendChild(menu);
    var w = menu.offsetWidth || 178, h = menu.offsetHeight || 88;
    var left = Math.min(window.innerWidth - w - 10, Math.max(10, box.left + 10));
    /* above the row when there is room, so the menu never lands under the
       finger that just pressed the chat */
    var above = box.top - h - 8;
    var top = above >= 10
      ? above
      : Math.min(window.innerHeight - h - 10, Math.max(10, box.bottom + 8));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.querySelector('.mf-hold-item').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (pinned) { if (window.mf36 && window.mf36.unpin) window.mf36.unpin(id); }
      else { if (window.mf36 && window.mf36.pin) window.mf36.pin(id); }
      closeMenu();
    });
    menu.querySelector('.mf-hold-cancel').addEventListener('click', function (e) {
      e.stopPropagation();
      closeMenu();
    });
    menuRow = row;                /* the finger lifting must not open the chat */
    row.classList.add('mf-holding');
    setTimeout(function () { row.classList.remove('mf-holding'); }, 650);
  }

  D.addEventListener('pointerdown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;
    var row = rowOf(e.target);
    if (!row) return;
    if (e.target.closest && e.target.closest('.delete-history')) return;
    sx = e.clientX;
    sy = e.clientY;
    heldRow = false;
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      heldRow = true;          /* this menu was opened by a finger still down */
      openMenu(row);
    }, 2000);
  }, true);
  D.addEventListener('pointermove', function (e) {
    if (!timer) return;
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 12) {
      clearTimeout(timer); timer = null;
    }
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) {
    D.addEventListener(t, function () {
      clearTimeout(timer);
      timer = null;
      if (heldRow) {
        /* the finger that opened the menu is lifting: its click must not close
           the menu or open the chat */
        heldRow = false;
        justReleased = true;
        setTimeout(function () { justReleased = false; }, 0);
      }
    }, true);
  });
  D.addEventListener('click', function (e) {
    if (justReleased) {
      /* this click is the long press letting go */
      justReleased = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (menu && menuRow && menuRow.contains(e.target)) {
      /* a tap on the very row whose menu is open: keep the menu, stay put */
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (menu && !menu.contains(e.target)) closeMenu();
  }, true);
  D.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  D.addEventListener('scroll', function () { closeMenu(); }, true);
  window.addEventListener('resize', function () { closeMenu(); });
  D.addEventListener('contextmenu', function (e) {
    /* a long press shows OUR menu, not the browser's */
    if (rowOf(e.target)) e.preventDefault();
  });
})();

</script>
<script>
/* =====================================================
   b61 — pins without the home strip, swipe-to-delete with
   a 3-second Undo, and the fighter-jet theme flight.
   ===================================================== */
(function () {
  var D = document;
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  var JET_MS = 2500;
  var JET_SVG = '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g><path d="M60 4 L70 38 L104 74 L106 88 L70 76 L66 104 L60 96 L54 104 L50 76 L14 88 L16 74 L50 38 Z" fill="#DCE8F7" stroke="#5B7BA6" stroke-width="3" stroke-linejoin="round"/><path d="M60 18 L66 44 L60 58 L54 44 Z" fill="#0A66FF"/><circle cx="60" cy="34" r="6" fill="#7DD3FC" stroke="#24507E" stroke-width="2"/><path d="M50 82 L38 104 M70 82 L82 104" stroke="#F59E0B" stroke-width="5" stroke-linecap="round"/><path d="M60 88 L60 110" stroke="#F97316" stroke-width="6" stroke-linecap="round"/></g></svg>';

  /* ---------- the fighter jet carries the theme across ---------- */
  window.mfThemeWipe = function (apply) {
    if (typeof apply !== 'function') return;
    if (reduced()) { apply(); return; }
    var goingDark = !D.body.classList.contains('dark');
    var W = window.innerWidth || 1280, H = window.innerHeight || 800;
    var layer = D.createElement('div');
    layer.className = 'mf-jet-layer ' + (goingDark ? 'to-dark' : 'to-light');
    layer.setAttribute('aria-hidden', 'true');
    var shadow = D.createElement('div'); shadow.className = 'mf-jet-shadow';
    var trail = D.createElement('div'); trail.className = 'mf-jet-trail';
    var jet = D.createElement('div'); jet.className = 'mf-jet'; jet.innerHTML = JET_SVG;
    layer.appendChild(shadow); layer.appendChild(trail); layer.appendChild(jet);
    D.body.appendChild(layer);
    /* dark: top-right -> bottom-left · light: bottom-left -> top-right */
    var sx = goingDark ? W + 90 : -90, sy = goingDark ? -90 : H + 90;
    var ex = goingDark ? -90 : W + 90, ey = goingDark ? H + 90 : -90;
    var dx = ex - sx, dy = ey - sy;
    var ang = Math.atan2(dy, dx) * 180 / Math.PI + 90; /* the jet drawing points up */
    var len = Math.sqrt(dx * dx + dy * dy);
    var flipped = false, start = null;
    function flip() { if (!flipped) { flipped = true; try { apply(); } catch (e) {} } }
    function frame(ts) {
      if (!start) start = ts;
      var raw = Math.min(1, (ts - start) / JET_MS);
      var p = raw < .5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2; /* easeInOut */
      var x = sx + dx * p, y = sy + dy * p;
      jet.style.transform = 'translate(' + (x - 59) + 'px,' + (y - 59) + 'px) rotate(' + ang + 'deg)';
      /* the shadow follows BEHIND the jet: everything on the start-corner
         side of a line through the jet has already changed */
      var nx = -dy / len, ny = dx / len; /* perpendicular */
      if (!goingDark) { nx = -nx; ny = -ny; }
      var cx = W / 2, cy = H / 2;
      /* build the covered half-plane as a big polygon around the start corner */
      var bx = goingDark ? W : 0, by = goingDark ? 0 : H;
      var d = (bx - x) * nx + (by - y) * ny;
      var ox = x + nx * Math.max(0, d), oy = y + ny * Math.max(0, d);
      var px = -dy / len * 2400, py = dx / len * 2400;
      shadow.style.clipPath = 'polygon(' + (ox - px) + 'px ' + (oy - py) + 'px,' + (ox + px) + 'px ' + (oy + py) + 'px,' + (bx + (bx - cx) * 2) + 'px ' + (by + (by - cy) * 2) + 'px)';
      trail.style.width = '150px';
      trail.style.transform = 'translate(' + (x - 75 - dx / len * 40) + 'px,' + (y - 5 - dy / len * 40) + 'px) rotate(' + (ang - 90) + 'deg)';
      trail.style.opacity = String(Math.sin(Math.PI * Math.min(1, raw)) * .9);
      if (raw >= .52) flip();
      if (raw < 1) { window.requestAnimationFrame(frame); return; }
      flip();
      layer.style.transition = 'opacity .3s ease'; layer.style.opacity = '0';
      setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 340);
    }
    window.requestAnimationFrame(frame);
    setTimeout(function () { /* safety net */ flip(); if (layer.parentNode) layer.parentNode.removeChild(layer); }, JET_MS + 900);
  };

  /* ---------- the 3-second Undo popup ---------- */
  var undoPop = null, undoTimer = null;
  window.mfUndoDelete = function (snapshot) {
    if (!snapshot || !snapshot.chat) return;
    if (undoPop && undoPop.parentNode) undoPop.parentNode.removeChild(undoPop);
    clearTimeout(undoTimer);
    undoPop = D.createElement('div');
    undoPop.className = 'mf-undo-pop';
    undoPop.setAttribute('role', 'status');
    undoPop.innerHTML = '<span>Chat deleted</span>';
    var btn = D.createElement('button');
    btn.type = 'button'; btn.textContent = 'Undo';
    btn.addEventListener('click', function () {
      clearTimeout(undoTimer);
      undoPop.classList.remove('show');
      if (window.mfRestoreChat) window.mfRestoreChat(snapshot);
    });
    undoPop.appendChild(btn);
    var bar = D.createElement('span'); bar.className = 'mf-undo-bar'; bar.innerHTML = '<i></i>';
    undoPop.appendChild(bar);
    D.body.appendChild(undoPop);
    void undoPop.offsetWidth;
    undoPop.classList.add('show');
    undoTimer = setTimeout(function () { if (undoPop) undoPop.classList.remove('show'); }, 3500);
  };

  /* ---------- swipe a history chat (b89) ----------
     LEFT  -> pin it (or unpin it)     RIGHT -> delete it for good.
     The lane behind the row says which one is coming; letting go
     early snaps the row back. A full swipe right deletes the chat
     PERMANENTLY - no Undo popup, exactly like the user asked. */
  var sw = null;
  function rowOf(n) { return n && n.closest ? n.closest('.history-row') : null; }
  D.addEventListener('pointerdown', function (e) {
    var row = rowOf(e.target); if (!row) return;
    var id = row.getAttribute('data-chat-id'); if (!id) return;
    sw = { row: row, id: id, x: e.clientX, y: e.clientY, dx: 0, on: false, dir: 0, lane: null };
  }, true);
  function makeLane(dir, pinned) {
    var lane = D.createElement('div');
    lane.className = 'mf-swipe-lane' + (dir < 0 ? ' mf-swipe-pinlane' : '');
    lane.textContent = dir < 0 ? (pinned ? '📌 Unpin' : '📌 Pin') : '🗑 Delete';
    return lane;
  }
  D.addEventListener('pointermove', function (e) {
    if (!sw) return;
    var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.on) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        sw.on = true; sw.dir = dx > 0 ? 1 : -1; sw.row.classList.add('mf-swiping');
        sw.item = sw.row.querySelector('.history-item') || sw.row;
        sw.lane = makeLane(sw.dir, sw.row.classList.contains('pinned'));
        sw.row.insertBefore(sw.lane, sw.row.firstChild);
      } else if (Math.abs(dy) > 10) { sw = null; return; }
      else return;
    }
    if (sw.dir > 0) sw.dx = Math.max(0, dx); else sw.dx = Math.min(0, dx);
    /* b93 - slide the ITEM, not the whole row: the coloured lane (and
       its word) stays planted behind, so the two texts never overlap */
    (sw.item || sw.row).style.transform = 'translateX(' + sw.dx + 'px)';
    if (sw.lane) sw.lane.style.opacity = String(Math.min(1, Math.abs(sw.dx) / 90));
  }, true);
  function endSwipe() {
    if (!sw) return;
    var s = sw; sw = null;
    if (!s.on) return;
    function settle() {
      var it = s.item || s.row;
      it.style.transition = 'transform .22s ease'; it.style.transform = '';
      setTimeout(function () {
        it.style.transition = ''; s.row.classList.remove('mf-swiping');
        if (s.lane && s.lane.parentNode) s.lane.parentNode.removeChild(s.lane);
      }, 230);
    }
    if (s.dir > 0 && s.dx > 90) {
      /* permanent delete - no Undo */
      s.row.classList.add('mf-swipe-out');
      setTimeout(function () { if (window.mfDeleteChat) window.mfDeleteChat(s.id); }, 240);
    } else if (s.dir < 0 && s.dx < -90) {
      settle();
      try {
        if (window.mf36) {
          if (s.row.classList.contains('pinned')) window.mf36.unpin(s.id);
          else window.mf36.pin(s.id);
        }
      } catch (e) {}
    } else settle();
  }
  D.addEventListener('pointerup', endSwipe, true);
  D.addEventListener('pointercancel', endSwipe, true);
  /* a swiped row must not open the chat when the finger lifts */
  D.addEventListener('click', function (e) {
    var row = rowOf(e.target);
    if (row && row.classList.contains('mf-swiping')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.mfSwipeDeleteReady = true;
  window.mfSwipePinReady = true;
})();

</script>
<script>
/* =====================================================
   b62 — the theme flight, second pass.
   A classical squadron of THREE planes: one big leader
   in mixed colours, two smaller wingmen behind at the
   sides in one shared colour. Fire flickers at every
   tail and smoke puffs trail behind them. The front of
   the coming theme is hazy. The theme itself only
   completes when the planes have fully reached the far
   corner — never in the middle — and then real smoke
   rests in that corner for 2.5 seconds.
   ===================================================== */
(function () {
  var D = document;
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  var FLIGHT_MS = 2500, CORNER_SMOKE_MS = 2500;

  function planeSVG(leader) {
    var body = leader ? '#E8EEF7' : '#B9C9DE';
    var trim = leader ? '#DC2626' : '#64748B';
    var wing = leader ? '#2563EB' : '#7C93B2';
    var gold = leader ? '#F59E0B' : '#94A3B8';
    return '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M60 3 L69 34 L58 34 L58 14 Z" fill="' + gold + '"/>' +
      '<path d="M60 6 C67 22 70 40 69 62 L66 96 L60 88 L54 96 L51 62 C50 40 53 22 60 6 Z" fill="' + body + '" stroke="#3F5878" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<path d="M52 40 L14 74 L12 88 L52 70 Z" fill="' + wing + '" stroke="#3F5878" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M68 40 L106 74 L108 88 L68 70 Z" fill="' + wing + '" stroke="#3F5878" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M53 68 L30 96 L29 104 L54 84 Z" fill="' + trim + '"/>' +
      '<path d="M67 68 L90 96 L91 104 L66 84 Z" fill="' + trim + '"/>' +
      '<ellipse cx="60" cy="30" rx="6.5" ry="11" fill="#7DD3FC" stroke="#24507E" stroke-width="2"/>' +
      '<path d="M51 58 L69 58 L68 66 L52 66 Z" fill="' + trim + '" opacity=".9"/>' +
      '<circle cx="60" cy="48" r="3" fill="' + gold + '"/></svg>';
  }

  window.mfThemeWipe = function (apply) {
    if (typeof apply !== 'function') return;
    if (reduced()) { apply(); return; }
    var goingDark = !D.body.classList.contains('dark');
    var W = window.innerWidth || 1280, H = window.innerHeight || 800;
    var layer = D.createElement('div');
    layer.className = 'mf-jet-layer ' + (goingDark ? 'to-dark' : 'to-light');
    layer.setAttribute('aria-hidden', 'true');
    var shadow = D.createElement('div'); shadow.className = 'mf-jet-shadow';
    var haze = D.createElement('div'); haze.className = 'mf-jet-haze'; haze.innerHTML = '<i></i>';
    layer.appendChild(shadow); layer.appendChild(haze);
    /* three planes: leader + two wingmen (behind, at the sides) */
    var planes = [];
    [{ cls: 'mf-jet mf-leader', leader: true, back: 0, side: 0 },
     { cls: 'mf-jet mf-wing', leader: false, back: 118, side: -86 },
     { cls: 'mf-jet mf-wing', leader: false, back: 118, side: 86 }].forEach(function (cfg) {
      var jet = D.createElement('div'); jet.className = cfg.cls; jet.innerHTML = planeSVG(cfg.leader);
      var fire = D.createElement('div'); fire.className = 'mf-jet-fire';
      layer.appendChild(fire); layer.appendChild(jet);
      planes.push({ el: jet, fire: fire, cfg: cfg, size: cfg.leader ? 148 : 88 });
    });
    D.body.appendChild(layer);

    var sx = goingDark ? W + 110 : -110, sy = goingDark ? -110 : H + 110;
    var ex = goingDark ? -110 : W + 110, ey = goingDark ? H + 110 : -110;
    var dx = ex - sx, dy = ey - sy, len = Math.sqrt(dx * dx + dy * dy);
    var ux = dx / len, uy = dy / len;              /* direction of travel */
    var nx = -uy, ny = ux;                          /* sideways */
    var ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    var flipped = false, start = null, lastPuff = 0;

    function flip() { if (!flipped) { flipped = true; try { apply(); } catch (e) {} } }

    function cornerSmoke() {
      /* smoke resting in the corner the planes reached, for 2.5 s */
      var box = D.createElement('div');
      box.className = 'mf-corner-smoke';
      var atRight = !goingDark;   /* dark lands bottom-left, light lands top-right */
      if (goingDark) { box.style.left = '-90px'; box.style.bottom = '-90px'; }
      else { box.style.right = '-90px'; box.style.top = '-90px'; }
      var drifts = ['translate(46px,-30px)', 'translate(20px,-58px)', 'translate(70px,6px)',
                    'translate(-8px,-34px)', 'translate(52px,-64px)', 'translate(12px,10px)'];
      for (var i = 0; i < 7; i++) {
        var puff = D.createElement('i');
        var s = 74 + (i % 3) * 36;
        puff.style.width = s + 'px'; puff.style.height = s + 'px';
        puff.style.left = (34 + (i * 29) % 170) + 'px';
        puff.style.top = (120 + (i * 37) % 130) + 'px';
        if (!goingDark) { puff.style.top = (20 + (i * 31) % 120) + 'px'; }
        puff.style.setProperty('--mf-smoke-drift', drifts[i % drifts.length]);
        puff.style.animationDelay = (i * 0.16) + 's';
        box.appendChild(puff);
      }
      D.body.appendChild(box);
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, CORNER_SMOKE_MS + 700);
    }

    function frame(ts) {
      if (!start) start = ts;
      var raw = Math.min(1, (ts - start) / FLIGHT_MS);
      var p = raw < .5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      var x = sx + dx * p, y = sy + dy * p;
      /* the shadow still follows behind the squadron… */
      var bx = goingDark ? W : 0, by = goingDark ? 0 : H;
      var nnx = nx, nny = ny;
      var d = (bx - x) * nnx + (by - y) * nny;
      if (d < 0) { nnx = -nnx; nny = -nny; d = -d; }
      var ox = x + nnx * d, oy = y + nny * d;
      var px = -dy / len * 2600, py = dx / len * 2600;
      var cx = W / 2, cy = H / 2;
      shadow.style.clipPath = 'polygon(' + (ox - px) + 'px ' + (oy - py) + 'px,' + (ox + px) + 'px ' + (oy + py) + 'px,' + (bx + (bx - cx) * 2) + 'px ' + (by + (by - cy) * 2) + 'px)';
      /* hazy front: a soft loop of mist riding just ahead of the leader */
      haze.style.transform = 'translate(' + (x + ux * 60 - 170) + 'px,' + (y + uy * 60 - 170) + 'px)';
      haze.style.opacity = String(Math.sin(Math.PI * Math.min(1, raw)) * .95);
      /* the three planes, fire at every tail */
      planes.forEach(function (pl) {
        var jx = x - ux * pl.cfg.back + nx * pl.cfg.side;
        var jy = y - uy * pl.cfg.back + ny * pl.cfg.side;
        var half = pl.size / 2;
        pl.el.style.transform = 'translate(' + (jx - half) + 'px,' + (jy - half) + 'px) rotate(' + ang + 'deg)';
        var fx = jx - ux * (half + 16), fy = jy - uy * (half + 16);
        pl.fire.style.transform = 'translate(' + (fx - 8) + 'px,' + (fy - 4) + 'px) rotate(' + (ang + 180) + 'deg)';
        pl.fire.style.opacity = String(.65 + Math.random() * .35);
        pl.x = jx; pl.y = jy;
      });
      /* smoke puffs trail from every tail */
      if (ts - lastPuff > 90 && raw > 0.02 && raw < 0.99) {
        lastPuff = ts;
        planes.forEach(function (pl) {
          var puff = D.createElement('div');
          puff.className = 'mf-jet-puff';
          var s = pl.cfg.leader ? 54 : 38;
          puff.style.width = s + 'px'; puff.style.height = s + 'px';
          puff.style.left = (pl.x - ux * (pl.size / 2 + 22)) + 'px';
          puff.style.top = (pl.y - uy * (pl.size / 2 + 22)) + 'px';
          layer.appendChild(puff);
          setTimeout(function () { if (puff.parentNode) puff.parentNode.removeChild(puff); }, 1600);
        });
      }
      if (raw < 1) { window.requestAnimationFrame(frame); return; }
      /* …but the theme only completes NOW: the planes have fully reached
         the far corner and the shadow covers the whole screen, so the flip
         underneath is invisible — dark/white is fully done at the corner. */
      shadow.style.clipPath = 'none';
      flip();
      cornerSmoke();
      layer.style.transition = 'opacity .32s ease'; layer.style.opacity = '0';
      setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 360);
    }
    window.requestAnimationFrame(frame);
    setTimeout(function () { flip(); if (layer.parentNode) layer.parentNode.removeChild(layer); }, FLIGHT_MS + 1200);
  };
})();

</script>
<script>
/* =====================================================
   b63 — the squadron flies as ONE container, so the two
   wingmen can never be left behind in a corner again.
   Leader in front (big, mixed colours), two smaller
   same-colour wingmen behind at the sides, fire at every
   tail, and smoke you can actually see: WHITE smoke when
   the planes bring the dark, BLACK smoke when they bring
   the light. The theme still completes only at the far
   corner, then smoke rests there for 2.5 s.
   ===================================================== */
(function () {
  var D = document;
  function reduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  var FLIGHT_MS = 2500, CORNER_SMOKE_MS = 2500;

  function planeSVG(leader) {
    var body = leader ? '#E8EEF7' : '#B9C9DE';
    var trim = leader ? '#DC2626' : '#64748B';
    var wing = leader ? '#2563EB' : '#7C93B2';
    var gold = leader ? '#F59E0B' : '#94A3B8';
    return '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M60 3 L69 34 L58 34 L58 14 Z" fill="' + gold + '"/>' +
      '<path d="M60 6 C67 22 70 40 69 62 L66 96 L60 88 L54 96 L51 62 C50 40 53 22 60 6 Z" fill="' + body + '" stroke="#3F5878" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<path d="M52 40 L14 74 L12 88 L52 70 Z" fill="' + wing + '" stroke="#3F5878" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M68 40 L106 74 L108 88 L68 70 Z" fill="' + wing + '" stroke="#3F5878" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<path d="M53 68 L30 96 L29 104 L54 84 Z" fill="' + trim + '"/>' +
      '<path d="M67 68 L90 96 L91 104 L66 84 Z" fill="' + trim + '"/>' +
      '<ellipse cx="60" cy="30" rx="6.5" ry="11" fill="#7DD3FC" stroke="#24507E" stroke-width="2"/>' +
      '<path d="M51 58 L69 58 L68 66 L52 66 Z" fill="' + trim + '" opacity=".9"/>' +
      '<circle cx="60" cy="48" r="3" fill="' + gold + '"/></svg>';
  }
  function makePlane(cls, leader) {
    var wrap = D.createElement('div');
    wrap.className = 'mf-plane ' + cls;
    var jet = D.createElement('div');
    jet.className = 'mf-jet ' + (leader ? 'mf-leader' : 'mf-wing');
    jet.innerHTML = planeSVG(leader);
    var fire = D.createElement('div'); fire.className = 'mf-jet-fire';
    wrap.appendChild(fire); wrap.appendChild(jet);
    return wrap;
  }

  window.mfThemeWipe = function (apply) {
    if (typeof apply !== 'function') return;
    if (reduced()) { apply(); return; }
    /* never leave a plane behind: clear any old flight first */
    D.querySelectorAll('.mf-jet-layer,.mf-corner-smoke').forEach(function (n) { n.remove(); });
    var goingDark = !D.body.classList.contains('dark');
    var W = window.innerWidth || 1280, H = window.innerHeight || 800;
    var layer = D.createElement('div');
    layer.className = 'mf-jet-layer ' + (goingDark ? 'to-dark' : 'to-light');
    layer.setAttribute('aria-hidden', 'true');
    var shadow = D.createElement('div'); shadow.className = 'mf-jet-shadow';
    var haze = D.createElement('div'); haze.className = 'mf-jet-haze'; haze.innerHTML = '<i></i>';
    /* ONE squadron container — leader + two wingmen move together */
    var squad = D.createElement('div'); squad.className = 'mf-squad';
    squad.appendChild(makePlane('mf-plane-wingL', false));
    squad.appendChild(makePlane('mf-plane-wingR', false));
    squad.appendChild(makePlane('mf-plane-leader', true));
    layer.appendChild(shadow); layer.appendChild(haze); layer.appendChild(squad);
    D.body.appendChild(layer);

    var sx = goingDark ? W + 110 : -110, sy = goingDark ? -110 : H + 110;
    var ex = goingDark ? -110 : W + 110, ey = goingDark ? H + 110 : -110;
    var dx = ex - sx, dy = ey - sy, len = Math.sqrt(dx * dx + dy * dy);
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    var squadW = W <= 820 ? 264 : 360, squadH = W <= 820 ? 206 : 280;
    var flipped = false, start = null, lastPuff = 0;
    function flip() { if (!flipped) { flipped = true; try { apply(); } catch (e) {} } }

    function cornerSmoke() {
      var box = D.createElement('div');
      box.className = 'mf-corner-smoke ' + (goingDark ? 'to-dark' : 'to-light');
      if (goingDark) { box.style.left = '-90px'; box.style.bottom = '-90px'; }
      else { box.style.right = '-90px'; box.style.top = '-90px'; }
      var drifts = ['translate(46px,-30px)', 'translate(20px,-58px)', 'translate(70px,6px)',
                    'translate(-8px,-34px)', 'translate(52px,-64px)', 'translate(12px,10px)'];
      for (var i = 0; i < 7; i++) {
        var puff = D.createElement('i');
        var s = 74 + (i % 3) * 36;
        puff.style.width = s + 'px'; puff.style.height = s + 'px';
        puff.style.left = (34 + (i * 29) % 170) + 'px';
        puff.style.top = goingDark ? (120 + (i * 37) % 130) + 'px' : (20 + (i * 31) % 120) + 'px';
        puff.style.setProperty('--mf-smoke-drift', drifts[i % drifts.length]);
        puff.style.animationDelay = (i * 0.16) + 's';
        box.appendChild(puff);
      }
      D.body.appendChild(box);
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, CORNER_SMOKE_MS + 700);
    }
    /* world position of a plane: leader at (x,y); wings 98 behind, ±130 side */
    function tailPos(back, side, tailBack) {
      return { x: sx0(back, side) - ux * tailBack, y: sy0(back, side) - uy * tailBack };
    }
    function sx0(back, side) { return curX - ux * back + nx * side; }
    function sy0(back, side) { return curY - uy * back + ny * side; }
    var curX = sx, curY = sy;

    function frame(ts) {
      if (!start) start = ts;
      var raw = Math.min(1, (ts - start) / FLIGHT_MS);
      var p = raw < .5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      curX = sx + dx * p; curY = sy + dy * p;
      var bx = goingDark ? W : 0, by = goingDark ? 0 : H;
      var nnx = nx, nny = ny;
      var d = (bx - curX) * nnx + (by - curY) * nny;
      if (d < 0) { nnx = -nnx; nny = -nny; d = -d; }
      var ox = curX + nnx * d, oy = curY + nny * d;
      var px = -dy / len * 2600, py = dx / len * 2600;
      var cx = W / 2, cy = H / 2;
      shadow.style.clipPath = 'polygon(' + (ox - px) + 'px ' + (oy - py) + 'px,' + (ox + px) + 'px ' + (oy + py) + 'px,' + (bx + (bx - cx) * 2) + 'px ' + (by + (by - cy) * 2) + 'px)';
      haze.style.transform = 'translate(' + (curX + ux * 60 - 170) + 'px,' + (curY + uy * 60 - 170) + 'px)';
      haze.style.opacity = String(Math.sin(Math.PI * Math.min(1, raw)) * .95);
      /* the whole squadron moves with ONE transform — nobody gets left behind */
      squad.style.transform = 'translate(' + (curX - squadW / 2) + 'px,' + (curY - squadH / 2 + 40) + 'px) rotate(' + ang + 'deg)';
      if (ts - lastPuff > 90 && raw > 0.02 && raw < 0.99) {
        lastPuff = ts;
        [[0, 0, 96, 54], [98, -130, 62, 38], [98, 130, 62, 38]].forEach(function (cfg) {
          var tp = tailPos(cfg[0], cfg[1], cfg[2]);
          var puff = D.createElement('div');
          puff.className = 'mf-jet-puff';
          puff.style.width = cfg[3] + 'px'; puff.style.height = cfg[3] + 'px';
          puff.style.left = tp.x + 'px'; puff.style.top = tp.y + 'px';
          layer.appendChild(puff);
          setTimeout(function () { if (puff.parentNode) puff.parentNode.removeChild(puff); }, 1600);
        });
      }
      if (raw < 1) { window.requestAnimationFrame(frame); return; }
      /* theme completes only here, at the far corner */
      shadow.style.clipPath = 'none';
      flip();
      cornerSmoke();
      layer.style.transition = 'opacity .32s ease'; layer.style.opacity = '0';
      setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 360);
    }
    window.requestAnimationFrame(frame);
    setTimeout(function () { flip(); if (layer.parentNode) layer.parentNode.removeChild(layer); }, FLIGHT_MS + 1200);
  };
})();

</script>
<script>
/* =====================================================
   b64/b65 — Smart Place Information.
   The user's ORIGINAL question is classified first:
     A heritage place  -> Wikimedia photos (+ map)
     B general photo   -> Unsplash photos, no map
     C place / travel  -> Wikimedia/Unsplash photos + map
     D anything else   -> nothing at all (no API calls)
   Qualifying replies gain a photo gallery + Mapbox map
   inside the existing bubble, with a lightbox (download,
   attribution, prev/next) and a Hide/Show toggle. All
   other replies, and the whole UI, are untouched.
   ===================================================== */
(function () {
  var D = document;
  var PLACE_NOUN = /(fort|temple|mahal|memorial|palace|mosque|church|cathedral|tomb|ruins?|monument|landmark|museum|heritage|archaeological|ancient|historical site|waterfall|lake|beach|park|garden|zoo|dam|bridge|mountain|hill|river|island|capital|station|airport|hospital|university|market|দুর্গ|ফোর্ট|মন্দির|প্রাসাদ|জাদুঘর|স্মৃতিসৌধ|মসজিদ|গির্জা)/i;
  var LOCATION_CUE = /(where (is|are|exactly)|located|location of|show me the location|how (can|do|could) (i|we|one) (get|reach|go)|how to (get|reach)|reach(ing)? .+ from|want to (go|visit)|i want to (go|visit|see)|directions?|route|distance (from|to)|address|which area|nearest (station|airport)|কোথায়|অবস্থিত|কীভাবে (যাব|যেতে|পৌঁছ)|মানচিত্র|দিকনির্দেশ|রাস্তা|যাবো কীভাবে)/i;
  var PLACE_CUE = /(near(by)?|around|visit|tour|tourist|travel|places?|location|located|map|directions|how to (get|reach)|show me|tell me about|where (is|are)|in|at|of)\b/i;
  var HERITAGE_CUE = /(history|historical|built|build|architecture|ancient|heritage|who built|founded|constructed|facts about)/i;
  var GENERIC_PHOTO = /(mountains?|coffee|workspace|beach|nature|lifestyle|food|sunset|flowers?|animals?|fashion|interior|landscape|sky|ocean|forest|city ?scape|architecture|minimalist|aesthetic|background|wallpaper)/i;
  var PHOTO_ASK = /(photograph|photo|image|picture|wallpaper|gallery)/i;

  /* b72 \u2014 WHAT is shown follows WHAT THE USER ASKED:
       where / how to go / route ......... image + map   ('place')
       "give me the map / location map" ... map only      ('maponly')
       know about it / history / details .. image only    ('heritage')
       "give me an image of X" ............ image only    ('heritage')
       general photography ................ image only    ('photo')
       anything else ...................... nothing       ('none')
     WHICH place is shown still follows the AI's answer (b71). */
  var NAV_CUE = /(where (is|are|exactly)|located|location of|how (can|do|could) (i|we|one) (get|reach|go)|how to (get|reach|go)|reach(ing)? .+ from|want to (go|visit)|i want to (go|visit|see)|directions?|route|distance (from|to)|address|which area|nearest (station|airport)|\u0995\u09cb\u09a5\u09be|\u0985\u09ac\u09b8\u09cd\u09a5\u09bf\u09a4|\u09ae\u09be\u09a8\u099a\u09bf\u09a4\u09cd\u09b0|\u09a6\u09bf\u0995\u09a8\u09bf\u09b0\u09cd\u09a6\u09c7\u09b6|\u09b0\u09be\u09b8\u09cd\u09a4\u09be|\u09af\u09be\u09ac\u09cb \u0995\u09c0\u09ad\u09be\u09ac\u09c7)/i;
  var MAP_ASK = /((give|show|send|open|display|share|provide|get|see|want|need)( me)?( the| a)? (location )?map|map of|on (the )?map|location map|\\b(its|that|this|the) (location )?map\\b|\\bmap\\s*(please)?\\s*$|\u09ae\u09cd\u09af\u09be\u09aa)/i;
  var IMAGE_ASK = /((give|show|send|display|share|provide|get|see|want|need)( me)?( the| a| an)? (image|photo|picture|photograph|pic)|images? of|photos? of|pictures? of|photographs? of|\u099b\u09ac\u09bf)/i;
  function classifyPlaceQuery(text) {
    var t = String(text || '');
    if (!t) return 'none';
    var hasPlaceNoun = PLACE_NOUN.test(t);
    var named = /[A-Z][a-z]+/.test(t.replace(/^(Show|Where|How|Tell|Best|What|When|Why|The|A|An)\\s+/, ''));
    var placeish = hasPlaceNoun || named || PLACE_CUE.test(t);
    /* navigation first: where is it, how do I go \u2014 image + map */
    if (NAV_CUE.test(t) && placeish) return 'place';
    /* "give me the map of X" \u2014 map only */
    if (MAP_ASK.test(t) && placeish) return 'maponly';
    /* general photography (unless it names a heritage place) */
    if (PHOTO_ASK.test(t) && GENERIC_PHOTO.test(t) && !/(fort|temple|mahal|memorial|palace|mosque|church|cathedral|tomb|monument|museum|ruins)/i.test(t)) return 'photo';
    /* "give me an image of X" \u2014 that place's image only */
    if (IMAGE_ASK.test(t) && placeish) return 'heritage';
    /* subject-first asks: "give haaland image", "show tiger photo" */
    if (/\\b(images?|photos?|pictures?|photographs?)\\b/i.test(t) && /(give|show|send|display|share|provide|get|see|want|need)/i.test(t)) return 'heritage';
    /* heritage / landmark information: photographs only, NO map */
    if (hasPlaceNoun && (HERITAGE_CUE.test(t) || /tell me about|show me|about|special about|\u099b\u09ac\u09bf|\u0987\u09a4\u09bf\u09b9\u09be\u09b8/i.test(t))) return 'heritage';
    /* discovery / travel (visit, near, places to visit in \u2026): image + map */
    var travelCue = /(near(by)?|visit|tour|travel|places? (to visit|in|near)|\u09ad\u09cd\u09b0\u09ae\u09a3|\u0995\u09be\u099b\u09c7)/i.test(t);
    if (hasPlaceNoun && travelCue) return 'place';
    if (travelCue && named) return 'place';
    /* a named place asked about plainly: information + photographs only */
    if (hasPlaceNoun) return 'heritage';
    /* a follow-up that names nothing ("give me its map", "show its
       photo") \u2014 the place comes from the last AI response */
    if (MAP_ASK.test(t)) return 'maponly';
    if (IMAGE_ASK.test(t) || /\\b(photos?|images?|pictures?|photographs?)\\b/i.test(t)) return 'heritage';
    if (NAV_CUE.test(t)) return 'place';
    return 'none';
  }
  function extractQuery(text) {
    var q = String(text || '').replace(/\\s+/g, ' ').trim().replace(/[?।.!]+$/, '');
    /* the destination is what comes before "from …", "how …", "by train…" */
    q = q.split(/\\s+(from|via|how|what|who|where|when|why|by (train|bus|car|metro|road|flight))\\b/i)[0];
    q = q.replace(/^(please\\s+)?(give|show|send|open|display|share|provide)( me)?( the| a| an)?\s+/i, '');
    q = q.replace(/^(location\\s+map|map|location|image|photo|picture|photograph)( of)?\\s+/i, '');
    q = q.replace(/^(his|her|hers|their|its|that one|this one)\\s+/i, '');
    var qWords = q.replace(/\\b(images?|photos?|pictures?|photographs?|map)\\b/gi, ' ').replace(/\\s+/g, ' ').trim();
    if (qWords.length >= 3) q = qWords;
    q = q.replace(/\\b(location\\s+map|map|images?|photos?|pictures?|photographs?)\\s*$/i, '');
    q = q.replace(/^(please\\s+)?(how (do|can|could) (i|we) (reach|get|go)( to)?|how to (reach|get|go)( to)?|give me( the)?( details?| information| info)( about)?|tell me( more)?( about)?|i want to (go to|visit|see)|want to (go to|visit|see)|let me know( about)?|details?( about| of)?|information about|info about|describe|explain|(the )?history of|show me( the)?( photographs?| photos?| pictures?| images?)?( of)?|about|what (is|are)|where (is|are|exactly)( the)?)\\s+/i, '');
    q = q.replace(/\\b(i want|want|please|there|located|famous for|known for)\\b.*$/i, '');
    q = q.replace(/\\s+(is|are|was|were)\\s+(located|famous|known).*$/i, '');
    q = q.replace(/\\bi\\b/gi, ' ').replace(/\\s+/g, ' ').trim();
    return q.slice(0, 90);
  }
  /* b71 — the map & photos FOLLOW THE AI'S ANSWER: pull the place
     names the answer itself uses (bold names first, then headings,
     then capitalised landmark names in the text). The worker checks
     each one against Wikipedia, so a candidate that is not a real
     place simply falls away. */
  var AI_STOP = /^(the|a|an|this|that|these|those|it|if|when|where|what|why|how|you|your|there|here|in|on|at|for|with|and|but|or|as|by|from|to|of|best|top|most|some|many|first|one|two|three|day|night|good|great|famous|popular|beautiful|main|other|another|also|just|only|even|now|then|so|yes|no|sure|well|however|meanwhile|later|today|india|indian|key|points?|summary|conclusion|introduction|overview|facts?|details?|note|examples?|types?|benefits?|answer|important|meaning|history|life|story|plot|cast)$/i;
  function cleanCand(s) {
    s = String(s || '').replace(/[*#>_~]/g, ' ').replace(/\\s+/g, ' ').trim();
    s = s.replace(/^(the|a|an)\\s+/i, '').replace(/[\\s:;,\\.\\-–—(\\[]+$/g, '').trim();
    return s.slice(0, 70);
  }
  function aiPlaceCandidates(text) {
    var t = String(text || '');
    var out = [], seen = {};
    function add(s) {
      s = cleanCand(s);
      if (s.length < 3) return;
      var words = s.split(' ');
      if (words.length > 6) return;
      if (AI_STOP.test(words[0])) return;
      if (seen[s.toLowerCase()]) return;
      seen[s.toLowerCase()] = 1;
      out.push(s);
    }
    var m;
    var boldRe = /\\*\\*([^*]{3,70})\\*\\*/g;
    while ((m = boldRe.exec(t)) && out.length < 6) add(m[1]);
    var quoteRe = /[\u201c\u201d\"']([^\u201c\u201d\"']{2,40})[\u201c\u201d\"']/g;
    while ((m = quoteRe.exec(t)) && out.length < 6) { if (/[A-Za-z]{2,}/.test(m[1])) add(m[1]); }
    var headRe = /(^|\\n)\\s{0,3}#{1,4}\\s+([^\\n]{3,70})/g;
    while ((m = headRe.exec(t)) && out.length < 6) add(m[2]);
    var ofRe = /\\b(?:image|photo|picture|photograph|map) of\\s+([A-Z\\u00C0-\\u00DE][\\w\\u00C0-\\u00FF'\\u2019-]+(?:\\s+[A-Z\\u00C0-\\u00DE][\\w\\u00C0-\\u00FF'\\u2019-]+){0,2})/g;
    while ((m = ofRe.exec(t)) && out.length < 6) add(m[1].replace(/['\u2019]s$/, ''));
    var possRe = /\\b([A-Z\\u00C0-\\u00DE][\\w\\u00C0-\\u00FF'\\u2019-]+(?:\\s+[A-Z\\u00C0-\\u00DE][\\w\\u00C0-\\u00FF'\\u2019-]+){0,2})['\\u2019]s\\b/g;
    while ((m = possRe.exec(t)) && out.length < 6) add(m[1]);
    var nameRe = /\\b[A-Z][a-zA-Z]+(?:\\s+(?:of|the|and)\\s+|\\s+)[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,2}/g;
    while ((m = nameRe.exec(t)) && out.length < 6) {
      add(m[0]);
    }
    var nounRe = /\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2}\\s+(temple|fort|palace|memorial|mosque|church|cathedral|tomb|monument|museum|waterfall|beach|lake|park|garden|bridge|dam|island|mountain)\\b/g;
    while ((m = nounRe.exec(t)) && out.length < 6) add(m[0]);
    return out.slice(0, 5);
  }

  /* b73 \u2014 knowing about ANY real thing can show its image:
     a place, a person, the Earth, the universe, an animal, a
     machine, even a topic \u2014 as long as it is a "know about"
     question and Wikimedia has a real photograph of it. The
     worker checks the thing really exists before any image. */
  /* b76 \u2014 the AI sometimes pastes raw picture code like
     ![name](https://\u2026) or a static-map address into its words.
     The real picture/map is the card below; the words stay clean. */
  function cleanAnswerText(text) {
    return String(text || '')
      .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, '')
      .replace(/\\[([^\\]]*)\\]\\((https?:[^)]*(staticmap|upload\\.wikimedia|images\\.unsplash|maps\\.googleapis)[^)]*)/gi, '')
      .replace(/https?:\\S*(maps\\.googleapis\\.com\\/maps\\/api\\/staticmap|staticmap)\\S*/gi, '')
      .replace(/https?:\\S+\\.(jpg|jpeg|png|gif|webp)(\\?\\S*)?/gi, '')
      .replace(/[ \\t]+\\n/g, '\\n')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();
  }
  function foldWord(s) { try { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { return String(s || '').toLowerCase(); } }
  function wordDist(a, b) {
    if (Math.abs(a.length - b.length) > 4) return 99;
    var prev = [], j, i;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) { var cur = [i]; for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[b.length];
  }
  function wordMatchC(a, b) {
    if (!a || !b) return false;
    if (a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0) return true;
    var d = wordDist(a, b), m = Math.max(a.length, b.length);
    return d <= Math.max(a.length >= 7 ? 2 : 1, Math.floor(m * 0.2));
  }
  /* b82 — rank the answer's names so its actual SUBJECT leads:
     a name the user asked about, named early and often, is the
     subject; a club/city mentioned in passing is not */
  function rankCandidates(cands, text, userText) {
    var t = foldWord(text);
    var uq = extractQuery(userText || '');
    var uWords = foldWord(uq).split(/[^a-z0-9]+/).filter(function (w) { return w.length > 3; });
    var scored = cands.map(function (c, idx) {
      var cf = foldWord(c);
      var cWords = cf.split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
      var s = 0;
      uWords.forEach(function (uw) { if (cWords.some(function (cw) { return wordMatchC(uw, cw); })) s += 10; });
      var pos = t.indexOf(cf);
      if (pos >= 0 && pos < 160) s += 6; else if (pos >= 0 && pos < 450) s += 3;
      if (cf && t.split(cf).length - 1 >= 2) s += 2;
      if (cWords.length >= 2 && cWords.length <= 3) s += 1;
      return { c: c, s: s, i: idx };
    });
    scored.sort(function (a, b) { return (b.s - a.s) || (a.i - b.i); });
    return scored.map(function (x) { return x.c; });
  }
  function knowSubject(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    if (/^(how|why|when)\b/i.test(t)) return '';
    if (!/(who (is|was|were)|what (is|are|was|were)|tell me|describe|explain|know about|details? (about|of)|information (about|on)|history of|\u099c\u09be\u09a8\u09a4\u09c7|\u09ac\u09b2\u09cb)/i.test(t)) return '';
    t = t.replace(/^(who|what) (is|are|was|were)\s+/i, '');
    var q = extractQuery(t).replace(/^(the|a|an)\s+/i, '');
    if (q.length < 3 || q.split(' ').length > 6) return '';
    if (/difference between|meaning of|yourself|you\b|joke|story|poem|essay|code|programme|program\b|something|anything|everything/i.test(q)) return '';
    return q;
  }
  /* one image/map PER THING PER CHAT (b73): the first ask shows it,
     later asks about the same thing in this chat stay text-only.
     A new chat starts fresh. Keys are the resolved place/thing
     names, so spelling variants still count as the same thing. */
  function placeKeyOf(x) {
    return String(x || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an)\\s+/, '');
  }
  function shownSet() {
    var chat = mfCurrent();
    if (!chat) return null;
    if (!chat.placeShown) {
      chat.placeShown = {};
      (chat.messages || []).forEach(function (mm) {
        if (mm.place && mm.place.name) chat.placeShown[placeKeyOf(mm.place.name)] = 1;
        if (mm.placeKey) chat.placeShown[mm.placeKey] = 1;
      });
    }
    return chat.placeShown;
  }

  function photoQuery(text) {
    var q = extractQuery(text);
    q = q.replace(/^(beautiful|premium|best|amazing|stunning)\\s+/i, '');
    return q || String(text || '').slice(0, 90);
  }

  function mfCurrent() { try { return currentChat || null; } catch (e) { return null; } }

  /* ---------- Mapbox GL, loaded only when a map is needed ---------- */
  var glState = 0, glWaiters = [];
  function loadGL(cb) {
    if (window.mapboxgl) { cb(true); return; }
    glWaiters.push(cb);
    if (glState) return;
    glState = 1;
    var css = D.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css';
    D.head.appendChild(css);
    var s = D.createElement('script');
    s.src = 'https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js';
    s.onload = function () { glWaiters.splice(0).forEach(function (f) { f(!!window.mapboxgl); }); };
    s.onerror = function () { glWaiters.splice(0).forEach(function (f) { f(false); }); };
    D.head.appendChild(s);
    setTimeout(function () { if (!window.mapboxgl) glWaiters.splice(0).forEach(function (f) { f(false); }); }, 7000);
  }
  function buildMap(el, place, token) {
    function fallback() {
      el.innerHTML = '';
      var a = D.createElement('a');
      a.href = 'https://www.google.com/maps/search/?api=1&query=' + place.lat + ',' + place.lng;
      a.target = '_blank'; a.rel = 'noopener';
      var img = D.createElement('img');
      img.alt = 'Map of ' + place.name;
      img.src = 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-s+f00(' + place.lng + ',' + place.lat + ')/' + place.lng + ',' + place.lat + ',13/640x360@2x?access_token=' + token;
      img.onerror = function () { el.innerHTML = '<div class="mf-place-err">The map could not load — tap “Open in Maps” below.</div>'; };
      a.appendChild(img); el.appendChild(a);
    }
    loadGL(function (ok) {
      if (!ok || !token) { fallback(); return; }
      try {
        window.mapboxgl.accessToken = token;
        var map = new window.mapboxgl.Map({ container: el, style: 'mapbox://styles/mapbox/satellite-streets-v12', center: [place.lng, place.lat], zoom: 13 });
        map.addControl(new window.mapboxgl.NavigationControl(), 'top-right');
        /* the card can change width after the map starts (fonts, photos):
           resize so the canvas always fills the whole map box */
        map.on('load', function () { try { map.resize(); } catch (e) {} });
        setTimeout(function () { try { map.resize(); } catch (e) {} }, 350);
        setTimeout(function () { try { map.resize(); } catch (e) {} }, 1200);
        new window.mapboxgl.Marker({ color: '#E0245E' }).setLngLat([place.lng, place.lat])
          .setPopup(new window.mapboxgl.Popup({ offset: 24 }).setText(place.name)).addTo(map);
        map.on('error', function () {});
      } catch (e) { fallback(); }
    });
  }

  /* ---------- the lightbox ---------- */
  var lb = null, lbList = [], lbIdx = 0;
  function closeLightbox() { if (lb && lb.parentNode) lb.parentNode.removeChild(lb); lb = null; D.removeEventListener('keydown', lbKeys, true); }
  function lbKeys(e) {
    if (!lb) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') showLb(lbIdx + 1);
    else if (e.key === 'ArrowLeft') showLb(lbIdx - 1);
  }
  function showLb(i) {
    if (!lbList.length) return;
    lbIdx = (i + lbList.length) % lbList.length;
    var ph = lbList[lbIdx];
    var img = lb.querySelector('img');
    img.src = ph.full || ph.url;
    img.alt = ph.alt || '';
    var cap = lb.querySelector('.mf-lb-cap');
    var bits = [];
    if (ph.alt) bits.push(ph.alt);
    var srcTxt = ph.source || '';
    if (ph.author) srcTxt += (srcTxt ? ' · ' : '') + 'by ' + ph.author;
    if (ph.license) srcTxt += (srcTxt ? ' · ' : '') + ph.license;
    cap.textContent = bits.join(' — ') + (srcTxt ? '  (' + srcTxt + ')' : '');
    var srcLink = lb.querySelector('.mf-lb-src');
    srcLink.href = ph.wiki || ph.authorUrl || ph.full || ph.url;
    var dl = lb.querySelector('.mf-lb-dl');
    dl.href = ph.full || ph.url;
    dl.setAttribute('download', '');
    dl.onclick = function () {
      if (ph.downloadLocation) {
        try { fetch('/api/unsplash-track?u=' + encodeURIComponent(ph.downloadLocation), { credentials: 'same-origin' }).catch(function () {}); } catch (e) {}
      }
    };
    lb.querySelector('.mf-lb-count').textContent = (lbIdx + 1) + ' / ' + lbList.length;
  }
  function openLightbox(list, idx) {
    closeLightbox();
    lbList = list; lbIdx = idx || 0;
    lb = D.createElement('div');
    lb.className = 'mf-lb';
    lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = '<button type="button" class="mf-lb-x" aria-label="Close">✕</button>' +
      '<button type="button" class="mf-lb-nav mf-lb-prev" aria-label="Previous photo">‹</button>' +
      '<img alt="">' +
      '<button type="button" class="mf-lb-nav mf-lb-next" aria-label="Next photo">›</button>' +
      '<div class="mf-lb-bar"><span class="mf-lb-count"></span><span class="mf-lb-cap"></span>' +
      '<a class="mf-lb-src" target="_blank" rel="noopener">View source ↗</a>' +
      '<a class="mf-lb-dl" target="_blank" rel="noopener">Download</a></div>';
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
    lb.querySelector('.mf-lb-x').addEventListener('click', closeLightbox);
    lb.querySelector('.mf-lb-prev').addEventListener('click', function () { showLb(lbIdx - 1); });
    lb.querySelector('.mf-lb-next').addEventListener('click', function () { showLb(lbIdx + 1); });
    D.body.appendChild(lb);
    D.addEventListener('keydown', lbKeys, true);
    showLb(lbIdx);
  }

  /* ---------- the card ---------- */
  function buildCard(msg) {
    var place = msg.place, photos = (place && place.photos) || msg.photos || [];
    var hasMap = !!(place && isFinite(place.lat) && isFinite(place.lng));
    var card = D.createElement('div');
    card.className = 'mf-place';
    var bodyWrap = D.createElement('div');
    bodyWrap.className = 'mf-place-body';
    if (msg.placeHidden) bodyWrap.hidden = true;
    if (place) {
      var head = D.createElement('div'); head.className = 'mf-place-head';
      var nm = D.createElement('div'); nm.className = 'mf-place-name'; nm.textContent = '📍 ' + place.name;
      var sub = D.createElement('div'); sub.className = 'mf-place-sub'; sub.textContent = place.fullName || '';
      head.appendChild(nm); head.appendChild(sub); bodyWrap.appendChild(head);
    }
    if (photos.length) {
      var strip = D.createElement('div'); strip.className = 'mf-place-photos';
      photos.forEach(function (ph, i) {
        var fig = D.createElement('figure');
        var img = D.createElement('img');
        img.src = ph.url; img.alt = ph.alt || (place ? place.name : 'photo'); img.loading = 'lazy';
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        img.addEventListener('click', function () { openLightbox(photos, i); });
        img.addEventListener('keydown', function (e) { if (e.key === 'Enter') openLightbox(photos, i); });
        img.onerror = function () { fig.remove(); };
        var cap = D.createElement('figcaption');
        cap.textContent = (ph.alt || '') + (ph.source ? ' · ' + ph.source : '') + (ph.author ? ' · ' + ph.author : '');
        fig.appendChild(img); fig.appendChild(cap); strip.appendChild(fig);
      });
      bodyWrap.appendChild(strip);
    }
    if (hasMap) {
      var mapEl = D.createElement('div'); mapEl.className = 'mf-place-map';
      bodyWrap.appendChild(mapEl);
      buildMap(mapEl, place, msg.placeToken || '');
    }
    if (place) {
      var foot = D.createElement('div'); foot.className = 'mf-place-foot';
      var link = D.createElement('a');
      link.href = 'https://www.google.com/maps/search/?api=1&query=' + place.lat + ',' + place.lng;
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open in Maps ↗';
      foot.appendChild(link);
      if (place.wiki) {
        var w = D.createElement('a');
        w.href = place.wiki; w.target = '_blank'; w.rel = 'noopener'; w.textContent = 'Wikipedia ↗';
        foot.appendChild(w);
      }
      bodyWrap.appendChild(foot);
    }
    card.appendChild(bodyWrap);
    /* hide / show — never refetches, never touches the answer text */
    var toggle = D.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mf-place-toggle';
    function paintToggle() {
      var hidden = bodyWrap.hidden;
      var what = hasMap && photos.length ? 'photos & map' : (hasMap ? 'map' : 'photos');
      toggle.textContent = (hidden ? 'Show ' : 'Hide ') + what;
    }
    toggle.addEventListener('click', function () {
      bodyWrap.hidden = !bodyWrap.hidden;
      msg.placeHidden = bodyWrap.hidden;
      try { saveHistory(); } catch (e) {}
      paintToggle();
    });
    paintToggle();
    card.appendChild(toggle);
    return card;
  }

  function decorate() {
    var chat = mfCurrent();
    if (!chat || !chat.messages) return;
    var rows = D.querySelectorAll('#messages .message.assistant');
    var assistants = chat.messages.filter(function (m) { return m.role !== 'user'; });
    rows.forEach(function (row, i) {
      var msg = assistants[i];
      if (!msg || (!msg.place && !msg.photos) || row.querySelector('.mf-place')) return;
      var bubble = row.querySelector('.bubble');
      if (bubble) bubble.appendChild(buildCard(msg));
    });
  }
  /* b75 \u2014 follow-ups like "give his image" name nobody: hunt the
     subject through the whole chat (the AI's answers first-hand
     names, then what the user originally asked about), newest first */
  function historyCandidates(msg) {
    var chat = mfCurrent();
    var out = [];
    if (!chat || !chat.messages) return out;
    var idx = chat.messages.indexOf(msg);
    if (idx < 0) idx = chat.messages.length;
    for (var i = idx - 1; i >= 0 && out.length < 6; i--) {
      var m = chat.messages[i];
      if (!m || !m.content) continue;
      if (m.role === 'user') {
        var ks = knowSubject(m.content);
        if (!ks && classifyPlaceQuery(m.content) !== 'none') ks = extractQuery(m.content);
        if (ks && ks.length >= 3 && out.indexOf(ks) < 0) out.push(ks);
      } else {
        aiPlaceCandidates(m.content).forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); });
      }
    }
    return out;
  }
  function maybeFetch(msg, prevUserText, prevAiText) {
    if (!msg || msg.role === 'user' || msg.place || msg.photos || msg.placeChecked) return;
    /* wait until the answer is finished \u2014 the card follows the
       AI's final words, not a half-streamed sentence */
    try {
      if (typeof busy !== 'undefined' && busy) {
        if (!msg._placeWait) { msg._placeWait = true; setTimeout(function () { msg._placeWait = false; scan(); }, 1600); }
        return;
      }
    } catch (e) {}
    var kind = classifyPlaceQuery(prevUserText);
    /* WHICH place: this answer first, then the last AI response
       (follow-ups like "give me its map" name nothing themselves) */
    var candsNow = rankCandidates(aiPlaceCandidates(msg.content), msg.content, prevUserText);
    var cands = candsNow.slice();
    historyCandidates(msg).forEach(function (c) { if (cands.indexOf(c) < 0) cands.push(c); });
    cands = cands.slice(0, 5);
    var pronounUsed = false;
    /* no place in the question AND none named in the answers:
       a "know about a thing" question may still earn its image */
    var knowQ = '';
    if (kind === 'none') {
      knowQ = knowSubject(prevUserText);
      if (!knowQ) return;
    }
    msg.placeChecked = true;
    var q, mode, mapParam;
    if (kind === 'photo' && !cands.length) {
      q = photoQuery(prevUserText); mode = 'photo'; mapParam = '&map=0';
    } else {
      q = kind === 'none' ? '' : extractQuery(prevUserText);
      /* the extraction can come back as pure ask-words ("Give me its",
         "give his") when the ask is all pronoun: that is NOT a subject -
         resolve it from the chat/answer candidates instead (b80) */
      var JUNKQ = /^(give|me|us|show|send|get|please|his|her|hers|him|he|she|they|them|their|its|it|that|this|the|a|an|image|photo|picture|map|of|for|to)$/i;
      var junkQ = !!q && q.split(/ +/).every(function (w) { return JUNKQ.test(w); });
      if (junkQ) { if (cands.length) { q = cands[0]; pronounUsed = true; } else return; }
      /* the question named no usable place (a follow-up pronoun, or
         only ask-words): use the place the AI responses named */
      if (q.length < 3 || (/\\b\(it|its|that|this|there|same)\\b/i.test(prevUserText || '') && !PLACE_NOUN.test(prevUserText || '') && cands.length)) { if (cands.length && q !== cands[0]) pronounUsed = true; q = cands[0] || q; }
      if ((q.length < 4 || /^(his|her|hers|him|he|she|they|them|their|its|it|that|this|the|image|photo|map|picture)$/i.test(q)) && cands.length) { if (q !== cands[0]) pronounUsed = true; q = cands[0]; }
      if (q.length < 3) { if (cands.length) pronounUsed = true; q = cands[0] || ''; }
      if (q.length < 3) return;
      if (/^(his|her|hers|him|he|she|they|them|their|its|it|that|this|the|image|photo|map|picture)$/i.test(q)) return;
      if (knowQ) { q = knowQ; pronounUsed = false; mode = 'heritage'; mapParam = '&map=0'; }
      else if (kind === 'maponly') { mode = 'maponly'; mapParam = ''; }
      else if (kind === 'place') { mode = 'place'; mapParam = ''; }
      else { mode = 'heritage'; mapParam = '&map=0'; }
    }
    /* once per thing per chat for AUTOMATIC cards: already shown here
       -> stay text-only, and do not even spend the fetch. But an
       EXPLICIT ask ("give me its map/photo again") is always honoured. */
    var explicitAsk = kind === 'maponly' || MAP_ASK.test(prevUserText || '') || IMAGE_ASK.test(prevUserText || '');
    var shown = explicitAsk ? null : shownSet();
    var askKeys = [placeKeyOf(q)].filter(Boolean);
    if (shown && askKeys.some(function (k) { return shown[k]; })) { msg.placeChecked = true; return; }
    if (shown) askKeys.forEach(function (k) { shown[k] = 1; });
    /* priority (b80): a subject the user named in THIS question always
       wins; older chat subjects are only fallbacks for pronoun asks
       ("give his map") that name nothing themselves */
    var aiUse = pronounUsed ? cands : candsNow;
    var aiParam = aiUse.length ? '&ai=' + encodeURIComponent(aiUse.join('|').slice(0, 300)) : '';
    fetch('/api/place?q=' + encodeURIComponent(q) + '&mode=' + mode + mapParam + aiParam, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        /* the resolved name is the real identity of the thing */
        var thingKey = placeKeyOf((data.place && data.place.name) || q);
        var chatNow = mfCurrent();
        if (!explicitAsk && thingKey && chatNow && (chatNow.messages || []).some(function (mm) { return mm !== msg && mm.place && placeKeyOf(mm.place.name) === thingKey; })) return;
        if (shown && thingKey) { shown[thingKey] = 1; askKeys.forEach(function (k) { shown[k] = 1; }); msg.placeKey = thingKey; }
        if (data.place) { msg.place = data.place; msg.placeToken = data.mapboxToken || ''; }
        else if (data.photos && data.photos.length) { msg.photos = data.photos; msg.placeToken = data.mapboxToken || ''; }
        else return;
        try { saveHistory(); } catch (e) {}
        decorate();
      })
      .catch(function () {});
  }
  function scan() {
    var chat = mfCurrent();
    if (!chat || !chat.messages) return;
    try {
      if (typeof busy === 'undefined' || !busy) {
        var cleanedAny = false;
        chat.messages.forEach(function (mm) {
          if (mm.role === 'user' || !mm.content) return;
          var c = cleanAnswerText(mm.content);
          if (c !== mm.content) { mm.content = c; cleanedAny = true; }
        });
        if (cleanedAny) {
          try { saveHistory(); } catch (e) {}
          setTimeout(function () { try { window.renderMessages(); } catch (e) {} }, 60);
          return;
        }
      }
    } catch (e) {}
    chat.messages.forEach(function (msg, i) {
      if (msg.role === 'user') return;
      var prev = chat.messages[i - 1];
      var before = chat.messages[i - 2];
      maybeFetch(msg,
        prev && prev.role === 'user' ? prev.content : '',
        before && before.role !== 'user' ? before.content : '');
    });
    decorate();
  }
  var inRender = false;
  var appRender = window.renderMessages;
  if (typeof appRender === 'function') {
    window.renderMessages = function () {
      var out = appRender.apply(null, arguments);
      if (!inRender) { inRender = true; setTimeout(function () { inRender = false; scan(); }, 30); }
      return out;
    };
  }
  setTimeout(scan, 900);
  window.mfPlace = { intent: function (t) { return classifyPlaceQuery(t) !== 'none' || aiPlaceCandidates(t).length > 0; }, classify: classifyPlaceQuery, extract: extractQuery, aiCandidates: aiPlaceCandidates, rank: rankCandidates, know: knowSubject, cleanText: cleanAnswerText, scan: scan };
})();

</script>
<script>
/* =====================================================
   b66 — while the user scrolls UP to read earlier chats,
   the merged controls button (AI Controls) steps aside;
   it comes back when they return near the bottom.
   ===================================================== */
(function () {
  var D = document;
  function update() {
    var btn = D.getElementById('modelBtn');
    if (!btn) return;
    var room = D.documentElement.scrollHeight - window.innerHeight;
    var fromBottom = room - window.scrollY;
    btn.classList.toggle('mf-scroll-hidden', fromBottom > 260);
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  setTimeout(update, 600);
  window.mfControlsScrollHide = update;
})();

</script>
<script>
/* =====================================================
   b67 — tap a message to show ITS Copy / Regenerate
   buttons for 3.5 seconds, then they hide again. Tapping
   your own message shows only its Copy; tapping an AI
   reply shows its Regenerate + Copy. Other messages'
   buttons stay hidden.
   ===================================================== */
(function () {
  var D = document;
  var timers = new WeakMap();
  function activate(row) {
    if (!row) return;
    D.querySelectorAll('.message.mf-actions-on').forEach(function (r) {
      if (r !== row) r.classList.remove('mf-actions-on');
    });
    row.classList.add('mf-actions-on');
    clearTimeout(timers.get(row));
    timers.set(row, setTimeout(function () { row.classList.remove('mf-actions-on'); }, 3500));
  }
  D.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var row = e.target.closest('#messages .message');
    if (row) activate(row);
  }, true);
  window.mfShowActions = activate;
})();

</script>
<script>
/* b68 — scrolling tucks the generated-time chip away at once */
(function () {
  var D = document;
  function hideChip() {
    var chip = D.querySelector('.time-chip.show');
    if (chip) chip.classList.remove('show');
  }
  window.addEventListener('scroll', hideChip, { passive: true });
  window.mfHideTimeChip = hideChip;
})();

</script>
<script>
/* =====================================================
   b83 — Listen: read an AI reply aloud with the browser's
   own SpeechSynthesis (no APIs, no keys). One tap speaks,
   the next tap stops; starting another reply stops the
   one before. The voice follows the reply's language.
   ===================================================== */
(function () {
  var synth = null;
  try { synth = window.speechSynthesis || null; } catch (e) { synth = null; }
  var activeBtn = null, activeTok = 0, keepAlive = 0;

  function setBtn(btn, on) {
    if (!btn) return;
    if (on) btn.classList.add('mf-speaking'); else btn.classList.remove('mf-speaking');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Stop' : 'Listen';
    btn.setAttribute('aria-label', on ? 'Stop' : 'Listen');
  }
  function stopAll() {
    activeTok++;
    if (keepAlive) { clearInterval(keepAlive); keepAlive = 0; }
    if (synth) { try { synth.cancel(); } catch (e) {} }
    setBtn(activeBtn, false);
    activeBtn = null;
  }
  /* the reply's own script betrays its language */
  function detectLang(text) {
    var t = String(text || '');
    if (/[\\u0980-\\u09FF]/.test(t)) return 'bn';
    if (/[\\u0900-\\u097F]/.test(t)) return 'hi';
    if (/[\\u0B80-\\u0BFF]/.test(t)) return 'ta';
    if (/[\\u0C00-\\u0C7F]/.test(t)) return 'te';
    if (/[\\u0C80-\\u0CFF]/.test(t)) return 'kn';
    if (/[\\u0D00-\\u0D7F]/.test(t)) return 'ml';
    if (/[\\u0A80-\\u0AFF]/.test(t)) return 'gu';
    if (/[\\u0A00-\\u0A7F]/.test(t)) return 'pa';
    if (/[\\u0600-\\u06FF]/.test(t)) return 'ur';
    if (/[\\u0400-\\u04FF]/.test(t)) return 'ru';
    if (/[\\u4E00-\\u9FFF]/.test(t)) return 'zh';
    if (/[\\u3040-\\u30FF]/.test(t)) return 'ja';
    if (/[\\uAC00-\\uD7AF]/.test(t)) return 'ko';
    return 'en';
  }
  function pickVoice(lang) {
    if (!synth) return null;
    var vs = [];
    try { vs = synth.getVoices() || []; } catch (e) { vs = []; }
    if (!vs.length) return null;
    var want = String(lang || 'en').toLowerCase();
    var primary = want.split('-')[0];
    var i, vlang;
    for (i = 0; i < vs.length; i++) { vlang = String(vs[i].lang || '').toLowerCase().replace('_', '-'); if (vlang === want) return vs[i]; }
    for (i = 0; i < vs.length; i++) { vlang = String(vs[i].lang || '').toLowerCase().replace('_', '-'); if (vlang.split('-')[0] === primary) return vs[i]; }
    for (i = 0; i < vs.length; i++) { vlang = String(vs[i].lang || '').toLowerCase(); if (vlang.indexOf('en') === 0) return vs[i]; }
    return vs[0];
  }
  if (synth && typeof synth.onvoiceschanged !== 'undefined') {
    try { synth.onvoiceschanged = function () { try { synth.getVoices(); } catch (e) {} }; } catch (e) {}
  }
  /* speak the words, not the markup */
  function cleanForSpeech(text) {
    var t = String(text || '');
    t = t.replace(/\\u0060\\u0060\\u0060[\\s\\S]*?\\u0060\\u0060\\u0060/g, ' ');
    t = t.replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, ' ');
    t = t.replace(/\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1');
    t = t.replace(/https?:\\S+/g, ' ');
    t = t.replace(/[*_~\\u0060#>|]/g, '');
    t = t.replace(/\\s+/g, ' ').trim();
    return t.slice(0, 6000);
  }
  function chunksOf(t) {
    var parts = t.split(/(?<=[.?!।])\\s+/), out = [], cur = '';
    for (var i = 0; i < parts.length; i++) {
      if ((cur + ' ' + parts[i]).length > 180 && cur) { out.push(cur); cur = parts[i]; }
      else cur = cur ? cur + ' ' + parts[i] : parts[i];
    }
    if (cur) out.push(cur);
    return out;
  }
  function toggle(text, btn) {
    if (activeBtn && btn && activeBtn === btn) { stopAll(); return; }
    stopAll();
    if (!synth || !btn) return;
    var cleaned = cleanForSpeech(text);
    if (!cleaned) return;
    var lang = detectLang(cleaned);
    var voice = pickVoice(lang);
    var chunks = chunksOf(cleaned);
    var tok = ++activeTok;
    activeBtn = btn;
    setBtn(btn, true);
    /* Chrome pauses long speech on its own; nudge it along */
    keepAlive = setInterval(function () {
      if (tok !== activeTok) { clearInterval(keepAlive); return; }
      try { if (synth.speaking && !synth.paused) synth.resume(); } catch (e) {}
    }, 10000);
    chunks.forEach(function (chunk, i) {
      var u = new SpeechSynthesisUtterance(chunk);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = lang;
      u.rate = 1;
      if (i === chunks.length - 1) {
        u.onend = function () { if (tok === activeTok) stopAll(); };
        u.onerror = function () { if (tok === activeTok) stopAll(); };
      }
      synth.speak(u);
    });
  }
  window.mfListenToggle = toggle;
  window.mfStopListening = stopAll;
  window.mfListen = { toggle: toggle, stop: stopAll, detect: detectLang, clean: cleanForSpeech };
})();

</script>
<script>
/* =====================================================
   b84 — the Web Search window: live results from the
   worker's /api/websearch (You.com, with the free tier
   behind it). The window is pure theme variables, so it
   matches whichever of the three designs is active.
   ===================================================== */
(function () {
  var D = document;
  var box, input, form, results, meta, moreBtn;
  var state = { q: '', offset: 0, busy: false, done: false };

  function el() {
    box = box || D.getElementById('webSearch');
    input = input || D.getElementById('wsInput');
    form = form || D.getElementById('wsForm');
    results = results || D.getElementById('wsResults');
    meta = meta || D.getElementById('wsMeta');
    moreBtn = moreBtn || D.getElementById('wsMore');
    return box;
  }
  function open() {
    if (!el()) return;
    box.hidden = false;
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 60);
  }
  function close() { if (el()) box.hidden = true; }
  function setMeta(t) { if (meta) meta.textContent = t; }
  function state_(t) {
    results.innerHTML = '';
    var d = D.createElement('div');
    d.className = 'mf-ws-state';
    d.textContent = t;
    results.appendChild(d);
    moreBtn.hidden = true;
  }
  function card(r) {
    var a = D.createElement('a');
    a.className = 'mf-ws-card';
    a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
    var main = D.createElement('div'); main.className = 'mf-ws-main';
    var dom = D.createElement('div'); dom.className = 'mf-ws-dom';
    dom.textContent = (r.host || '') + (r.age ? ' · ' + r.age : '');
    if (r.kind === 'news') {
      var b = D.createElement('span'); b.className = 'mf-ws-badge'; b.textContent = 'NEWS';
      dom.appendChild(b);
    }
    var t = D.createElement('div'); t.className = 'mf-ws-t'; t.textContent = r.title || r.url;
    var d = D.createElement('div'); d.className = 'mf-ws-d'; d.textContent = r.desc || '';
    main.appendChild(dom); main.appendChild(t); main.appendChild(d);
    a.appendChild(main);
    a.addEventListener('click', function (e) { if (openLink(r.url, r.title || r.host || 'Link')) e.preventDefault(); });
    if (r.img) {
      var im = D.createElement('img');
      im.className = 'mf-ws-img'; im.loading = 'lazy'; im.alt = '';
      im.src = r.img;
      im.addEventListener('error', function () { im.remove(); });
      a.appendChild(im);
    }
    return a;
  }
  function render(list, append) {
    if (!append) results.innerHTML = '';
    if (!list.length && !append) { state_('No results found. Try different words.'); return; }
    list.forEach(function (r) { results.appendChild(card(r)); });
    moreBtn.hidden = list.length < 8;
  }
  function run(offset) {
    if (state.busy || !state.q) return;
    state.busy = true;
    if (!offset) state_('Searching the live web…');
    else moreBtn.textContent = 'Loading…';
    fetch('/api/websearch?q=' + encodeURIComponent(state.q) + '&offset=' + offset, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.busy = false;
        moreBtn.textContent = 'More results';
        var list = (data && data.results) || [];
        state.offset = offset;
        render(list, offset > 0);
        if (offset > 0 && !list.length) moreBtn.hidden = true;
        setMeta(data && data.via === 'free'
          ? 'Live results · free search tier'
          : 'Live results · You.com');
        state.done = true;
      })
      .catch(function () {
        state.busy = false;
        moreBtn.textContent = 'More results';
        if (!offset) state_('Search could not run. Check your connection and try again.');
      });
  }
  /* ---- past searches (b97): tap the history symbol to reopen one ---- */
  var WS_HIST_KEY = 'mfWsHistoryV1';
  function wsHistLoad() {
    try { var v = JSON.parse(localStorage.getItem(WS_HIST_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function wsHistSave(q) {
    try {
      var list = wsHistLoad().filter(function (x) { return x && x.q !== q; });
      list.unshift({ q: q, ts: Date.now() });
      localStorage.setItem(WS_HIST_KEY, JSON.stringify(list.slice(0, 20)));
    } catch (e) {}
  }
  function wsHistPaint() {
    var panel = D.getElementById('wsHistPanel');
    if (!panel) return;
    var list = wsHistLoad();
    panel.innerHTML = '';
    if (!list.length) {
      var em = D.createElement('div'); em.className = 'mf-ws-state'; em.textContent = 'No searches yet.';
      panel.appendChild(em); return;
    }
    list.forEach(function (x) {
      var b = D.createElement('button');
      b.type = 'button'; b.className = 'mf-ws-hist-item';
      var when = '';
      try { when = new Date(x.ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
      b.innerHTML = '<span class="mf-ws-hist-q"></span><span class="mf-ws-hist-t"></span>';
      b.querySelector('.mf-ws-hist-q').textContent = x.q;
      b.querySelector('.mf-ws-hist-t').textContent = when;
      b.addEventListener('click', function () {
        panel.hidden = true;
        if (input) input.value = x.q;
        search(x.q);
      });
      panel.appendChild(b);
    });
    var clr = D.createElement('button');
    clr.type = 'button'; clr.className = 'mf-ws-hist-clear';
    clr.setAttribute('aria-label', 'Clear past searches');
    clr.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13"/></svg>';
    clr.addEventListener('click', function () {
      try { localStorage.removeItem(WS_HIST_KEY); } catch (e) {}
      wsHistPaint();
    });
    panel.appendChild(clr);
  }
  function search(q) {
    if (!el()) return;
    state.q = String(q || input.value || '').replace(/\\s+/g, ' ').trim();
    if (state.q.length < 2) { state_('Type at least two characters to search.'); return; }
    wsHistSave(state.q);
    state.offset = 0;
    run(0);
  }
  /* ---- Open in Firefox or Chromium (b87), mobile only ----
     Two choices, nothing else. Picking one makes the system hunt
     for a browser of that family (Firefox: Firefox/Beta/Focus;
     Chromium: Chromium/Chrome/Brave/Opera/Samsung) and open the
     link there. Edge and Bing are NEVER used - not as a pick, not as
     a fallback, not even when they are the device default. If no
     matching browser is installed, the user is told, and the
     link simply does not open in the wrong browser. On PC and
     Windows this does not run: links open the normal way. */
  function linkMobile() {
    var ua = navigator.userAgent || '';
    return /Android/i.test(ua) || /iPhone|iPad|iPod/i.test(ua);
  }
  function isIos() { return /iPhone|iPad|iPod/i.test(navigator.userAgent || ''); }
  function currentFamily() {
    var ua = navigator.userAgent || '';
    if (ua.indexOf('Firefox/') >= 0 || ua.indexOf('FxiOS') >= 0) return 'firefox';
    if (ua.indexOf('Edg/') >= 0 || ua.indexOf('EdgA') >= 0 || ua.indexOf('EdgiOS') >= 0) return 'edge';
    if (ua.indexOf('Chrome/') >= 0 || ua.indexOf('Chromium/') >= 0 || ua.indexOf('CriOS') >= 0) return 'chromium';
    return '';
  }
  var FAMILIES = {
    firefox: {
      label: 'Firefox',
      android: ['org.mozilla.firefox', 'org.mozilla.firefox_beta', 'org.mozilla.fenix', 'org.mozilla.focus'],
      ios: function (url) { return 'firefox::open-url?url=' + encodeURIComponent(url); }
    },
    chromium: {
      label: 'Chromium',
      android: ['com.android.chrome', 'com.zoho.primeum.stable', 'com.zoho.ulaa', 'org.chromium.chrome', 'com.chrome.beta', 'com.brave.browser', 'com.vivaldi.browser', 'com.kiwibrowser.browser', 'com.yandex.browser', 'com.opera.browser', 'com.sec.android.app.sbrowser', 'com.duckduckgo.mobile.android', 'com.mi.globalbrowser', 'com.huawei.browser'],
      ios: function (url) { return (url.indexOf('https:') === 0 ? 'googlechromes://' : 'googlechrome://') + (url.split('://')[1] || url); }
    }
  };
  function tryFamily(fam, url, noteEl, done) {
    var pkgs = isIos() ? null : fam.android;
    var tries = pkgs ? pkgs.length : 1;
    var i = 0, finished = false;
    function finish(ok) {
      if (finished) return; finished = true;
      window.removeEventListener('blur', onGone);
      document.removeEventListener('visibilitychange', onGone);
      done(ok);
    }
    function onGone() { if (document.hidden) finish(true); }
    window.addEventListener('blur', onGone);
    document.addEventListener('visibilitychange', onGone);
    function attempt() {
      if (finished) return;
      if (i >= tries) {
        finish(false);
        if (noteEl) noteEl.textContent = fam.label + ' is not installed on this device, so the link was not opened.';
        return;
      }
      var launch;
      if (isIos()) launch = fam.ios(url);
      else {
        var scheme = url.indexOf('https:') === 0 ? 'https' : 'http';
        var rest = url.split('://')[1] || url;
        launch = 'intent://' + rest + '#Intent;scheme=' + scheme + ';package=' + pkgs[i] +
          ';action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end';
      }
      i++;
      try { window.location.href = launch; } catch (e) {}
      setTimeout(function () { if (!finished && !document.hidden) attempt(); }, 750);
    }
    attempt();
  }
  var CHROME_BROWSERS = [
    ['Default browser', null],
    ['Brave', 'com.brave.browser'],
    ['Microsoft Edge', 'com.microsoft.emmx'],
    ['Opera', 'com.opera.browser'],
    ['Ulaa', 'com.zoho.primeum.stable'],
    ['Chrome', 'com.android.chrome'],
    ['Vivaldi', 'com.vivaldi.browser'],
    ['DuckDuckGo', 'com.duckduckgo.mobile.android']
  ];
  /* open ONE named browser by its package. A web page cannot read
     the phone's app list, so the tap itself is the test: installed
     -> the page leaves and the link opens there; still here after a
     moment -> that browser is not on this device */
  function launchPkg(pkg, label, url, noteEl, btn) {
    var gone = false, finished = false;
    function onGone() { if (document.hidden) gone = true; }
    document.addEventListener('visibilitychange', onGone);
    window.addEventListener('blur', onGone);
    var scheme = url.indexOf('https:') === 0 ? 'https' : 'http';
    var rest = url.split('://')[1] || url;
    var launch = 'intent://' + rest + '#Intent;scheme=' + scheme + (pkg ? ';package=' + pkg : '') +
        ';action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end';
    try { window.location.href = launch; } catch (e) {}
    setTimeout(function () {
      document.removeEventListener('visibilitychange', onGone);
      window.removeEventListener('blur', onGone);
      if (finished) return; finished = true;
      if (gone || document.hidden) { closeLinkSheet(); return; }
      noteEl.textContent = label + ' is not installed on this device — pick another browser.';
      if (btn) { btn.classList.add('mf-notin'); btn.disabled = true; }
    }, 1000);
  }
  var sheet2 = null;
  function closeLinkSheet() { if (sheet2) sheet2.remove(); sheet2 = null; }
  function openLink(url, title) {
    if (!linkMobile()) return false;
    closeLinkSheet();
    sheet2 = D.createElement('div');
    sheet2.className = 'mf-open2';
    var panel = D.createElement('div'); panel.className = 'mf-open2-box';
    var h = D.createElement('div'); h.className = 'mf-open2-h'; h.textContent = 'Open link in';
    var t = D.createElement('div'); t.className = 'mf-open2-t'; t.textContent = title;
    var note = D.createElement('div'); note.className = 'mf-open2-note';
    note.textContent = 'Choose your preferred browser.';
    panel.appendChild(h); panel.appendChild(t);
    ['firefox', 'chromium'].forEach(function (key) {
      var fam = FAMILIES[key];
      var b = D.createElement('button');
      b.type = 'button'; b.className = 'mf-open2-btn mf-open2-' + key;
      b.textContent = fam.label;
      b.addEventListener('click', function () {
        /* already browsing inside that family (Ulaa, Chrome...):
           the link simply opens here - that IS that browser */
        if (currentFamily() === key && !(key === 'chromium' && !isIos())) { window.open(url, '_blank', 'noopener'); closeLinkSheet(); return; }
        /* Chromium on Android (b92): Plan B — the named browser
           list shows at once; the user picks, the link opens there */
        if (key === 'chromium' && !isIos()) {
          if (sub.hidden) {
            sub.hidden = false;
            note.textContent = 'Pick a browser — the link opens there. If it is not on this phone, you will be told here.';
          } else sub.hidden = true;
          return;
        }
        note.textContent = 'Looking for ' + fam.label + ' on this device…';
        tryFamily(fam, url, note, function (ok) { if (ok) closeLinkSheet(); });
      });
      panel.appendChild(b);
    });
    var sub = D.createElement('div');
    sub.className = 'mf-open2-sub'; sub.hidden = true;
    CHROME_BROWSERS.forEach(function (cb) {
      var sb = D.createElement('button');
      sb.type = 'button'; sb.className = 'mf-open2-subbtn';
      sb.textContent = cb[0];
      sb.addEventListener('click', function () {
        note.textContent = 'Opening in ' + cb[0] + '…';
        launchPkg(cb[1], cb[0], url, note, sb);
      });
      sub.appendChild(sb);
    });
    panel.appendChild(sub);
    panel.appendChild(note);
    var x = D.createElement('button');
    x.type = 'button'; x.className = 'mf-open2-x'; x.textContent = 'Cancel';
    x.addEventListener('click', closeLinkSheet);
    panel.appendChild(x);
    sheet2.appendChild(panel);
    sheet2.addEventListener('click', function (e) { if (e.target === sheet2) closeLinkSheet(); });
    D.body.appendChild(sheet2);
    return true;
  }
  window.mfOpenLink = openLink;
  window.mfLinkMobile = linkMobile;
  window.mfBrowserFamily = currentFamily;
  function wire() {
    if (!el() || box.dataset.wired) return;
    box.dataset.wired = '1';
    form.addEventListener('submit', function (e) { e.preventDefault(); search(); });
    moreBtn.addEventListener('click', function () { run(state.offset + 1); });
    D.getElementById('wsClose').addEventListener('click', close);
    var hb = D.getElementById('wsHist');
    if (hb) hb.addEventListener('click', function () {
      var panel = D.getElementById('wsHistPanel');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) wsHistPaint();
    });
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) close(); });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', wire); else wire();
  window.mfOpenWebSearch = function () { wire(); open(); };
  window.mfWebSearch = { open: open, close: close, search: search };
})();

</script>
<script>
/* =====================================================
   b85 — the three-line button flips its lines to the
   opposite stair while the History drawer is open, and
   flips back when it closes. Icon only; the button's
   job and behaviour are untouched.
   ===================================================== */
(function () {
  var btn = document.getElementById('historyBtn');
  var drawer = document.getElementById('drawer');
  if (!btn) return;
  btn.classList.add('mf-burger');
  btn.innerHTML = '<span class="mf-burger-in"><i></i><i></i><i></i></span>';
  btn.setAttribute('aria-label', 'Chat History');
  function sync() {
    var open = !!(drawer && drawer.classList.contains('show'));
    btn.classList.toggle('mf-burger-on', open);
  }
  if (drawer && window.MutationObserver) {
    new MutationObserver(sync).observe(drawer, { attributes: true, attributeFilter: ['class'] });
  }
  sync();
})();

</script>
<script>
/* b90 - scrolling tucks the inline time away too */
(function () {
  function hideInline() {
    var t = document.querySelector('.mf-time-inline.show');
    if (t) t.classList.remove('show');
  }
  window.addEventListener('scroll', hideInline, { passive: true });
})();

</script>
<script>
/* b97 - long-press (2s) a message to delete just that message,
   plus the flip-round tap animation on the main buttons */
(function () {
  var D = document;
  var pressT = null, pressRow = null, suppressUntil = 0, sheet = null;
  function rows() { return Array.prototype.slice.call(D.querySelectorAll('#messages .message:not(.typing-row)')); }
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
  function askDelete(row) {
    var idx = rows().indexOf(row);
    if (idx < 0) return;
    closeSheet();
    sheet = D.createElement('div'); sheet.className = 'mf-msgdel';
    var box = D.createElement('div'); box.className = 'mf-msgdel-box';
    var t = D.createElement('div'); t.className = 'mf-msgdel-t'; t.textContent = 'Delete this message?';
    var s = D.createElement('div'); s.className = 'mf-msgdel-s'; s.textContent = 'Only this one message is removed from this chat. Anyone viewing a shared copy will not see it either.';
    var del = D.createElement('button'); del.type = 'button'; del.className = 'mf-msgdel-del'; del.textContent = 'Delete';
    del.addEventListener('click', function () {
      try {
        if (typeof currentChat !== 'undefined' && currentChat && Array.isArray(currentChat.messages)) {
          currentChat.messages.splice(idx, 1);
          if (typeof saveHistory === 'function') saveHistory();
          if (typeof renderMessages === 'function') renderMessages();
        }
      } catch (e) {}
      closeSheet();
    });
    var x = D.createElement('button'); x.type = 'button'; x.className = 'mf-msgdel-x'; x.textContent = 'Cancel';
    x.addEventListener('click', closeSheet);
    box.appendChild(t); box.appendChild(s); box.appendChild(del); box.appendChild(x);
    sheet.appendChild(box);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    D.body.appendChild(sheet);
  }
  D.addEventListener('pointerdown', function (e) {
    var row = e.target && e.target.closest ? e.target.closest('#messages .message:not(.typing-row)') : null;
    if (!row) return;
    pressRow = row;
    clearTimeout(pressT);
    pressT = setTimeout(function () {
      suppressUntil = Date.now() + 500;
      askDelete(row);
    }, 2000);
  }, true);
  function cancelPress() { clearTimeout(pressT); pressT = null; pressRow = null; }
  D.addEventListener('pointerup', cancelPress, true);
  D.addEventListener('pointercancel', cancelPress, true);
  D.addEventListener('pointermove', function (e) {
    if (pressRow && pressT) { /* small finger drift is fine; a scroll cancels via pointercancel */ }
  }, true);
  D.addEventListener('click', function (e) {
    if (Date.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.mfMsgDeleteReady = true;
  ['newTop', 'historyBtn', 'micBtn', 'attachMini'].forEach(function (id) {
    var el = D.getElementById(id);
    if (!el) return;
    el.addEventListener('click', function () {
      el.classList.remove('mf-btn-anim');
      void el.offsetWidth;
      el.classList.add('mf-btn-anim');
    });
  });
  D.addEventListener('animationend', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('mf-btn-anim')) e.target.classList.remove('mf-btn-anim');
  });
})();

</script>
</body>
</html>`;
}
/* ============================================================
   SHARE A CHAT  (b53) — one random link per chat.
   The link opens a READ-ONLY page: the visitor sees that one chat and
   nothing else — no typing, no answering, no settings, no history.
   Only the owner (the one who is logged in) can edit the chat.
   ============================================================ */
const KV_SHARE_PREFIX = "share_v1_";
const KV_SHARE_OF = "shareof_v1_";
const KV_PINS_KEY = "pins_v1";
const KV_HIDDEN_KEY = "hidden_models_v1";
function escShare(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function shareLoad(env, chatId) {
  return kvStore(env).get(KV_SHARE_OF + chatId);
}
async function handleShare(request, env) {
  if (!kvReady(env)) {
    return json({ ok: false, error: "Connect a KV namespace first — the link is kept there." }, 501);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const chatId = String(body.chatId || "").trim().slice(0, 80);
  if (!chatId) return json({ ok: false, error: "Open a chat first." }, 400);
  const kv = kvStore(env);
  const mapKey = KV_SHARE_OF + chatId;
  if (body.revoke) {
    const old = await kv.get(mapKey);
    if (old) { await kv.delete(KV_SHARE_PREFIX + old); await kv.delete(mapKey); }
    return json({ ok: true, revoked: true });
  }
  let token = "";
  try { token = String((await kv.get(mapKey)) || ""); } catch {}
  const existing = Boolean(token);
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    await kv.put(mapKey, token);
  }
  await kv.put(KV_SHARE_PREFIX + token, chatId);
  const origin = new URL(request.url).origin;
  return json({ ok: true, token: token, existing: existing, url: origin + "/s/" + token });
}
function sharedGonePage(reason) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MindFusion · shared chat</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#121A2B;
  background:#F7FBFF;background-image:radial-gradient(46% 34% at 10% 6%,rgba(10,102,255,.22),transparent 70%),radial-gradient(44% 32% at 90% 3%,rgba(255,197,61,.24),transparent 70%),radial-gradient(48% 36% at 84% 94%,rgba(255,95,162,.18),transparent 70%),radial-gradient(44% 34% at 12% 92%,rgba(255,90,90,.16),transparent 70%)}
.card{max-width:440px;margin:20px;padding:26px;border-radius:22px;background:#fff;box-shadow:0 20px 50px rgba(20,60,140,.14);text-align:center}
h1{margin:0 0 8px;font-size:19px}
p{margin:0;font-size:13.5px;line-height:1.6;color:#5A6B85}
.badge{display:inline-block;margin-bottom:12px;padding:5px 12px;border-radius:999px;font-size:11px;
  font-weight:800;letter-spacing:.06em;text-transform:uppercase;background:rgba(10,102,255,.12);color:#0A66FF}
</style></head><body><div class="card"><div class="badge">MindFusion</div>
<h1>This link no longer opens</h1><p>${escShare(reason)}</p></div></body></html>`;
}
function buildSharePage(chat) {
  const list = Array.isArray(chat.messages) ? chat.messages : [];
  const rows = list.map(function (m) {
    const mine = m.role === "user";
    const when = Number(m.ts) ? new Date(Number(m.ts)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "";
    const file = m.attachment && m.attachment.name
      ? `<div class="file">📎 ${escShare(String(m.attachment.name).slice(0, 60))}</div>` : "";
    const body = escShare(String(m.content || "")).replace(/\n/g, "<br>");
    /* b93 - viewers see the visuals too: place photos, the map and any
       picture the AI made in this chat (read-only, exactly as the
       owner saw them; nothing here can be edited) */
    let viz = "";
    const pl = m.place || null;
    const phs = (pl && Array.isArray(pl.photos) && pl.photos.length ? pl.photos : (Array.isArray(m.photos) ? m.photos : []));
    if (pl && pl.name) viz += `<div class="viz-name">📍 ${escShare(String(pl.name))}` + (pl.fullName ? `<span>${escShare(String(pl.fullName))}</span>` : "") + `</div>`;
    if (phs.length) {
      viz += `<div class="viz-photos">` + phs.slice(0, 6).map(function (ph) {
        if (!ph || !ph.url) return "";
        const cap = [ph.alt || "", ph.source || "", ph.author || ""].filter(Boolean).join(" · ");
        return `<figure><img src="${escShare(String(ph.url))}" alt="${escShare(String(ph.alt || (pl ? pl.name : "photo")))}" loading="lazy">` + (cap ? `<figcaption>${escShare(cap)}</figcaption>` : "") + `</figure>`;
      }).join("") + `</div>`;
    }
    if (pl && isFinite(pl.lat) && isFinite(pl.lng)) {
      const tok = String(m.placeToken || "");
      if (tok) {
        const su = "https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-s+e0245e(" + pl.lng + "," + pl.lat + ")/" + pl.lng + "," + pl.lat + ",13,0/640x320@2x?access_token=" + tok;
        viz += `<div class="viz-map"><a class="viz-maplink" href="https://www.google.com/maps/search/?api=1&query=${escShare(String(pl.lat))},${escShare(String(pl.lng))}" target="_blank" rel="noopener" title="Open this map"><img src="${escShare(su)}" alt="Map of ${escShare(String(pl.name || "the place"))}" loading="lazy"><span class="viz-maphint">Tap the map to open it</span></a></div>`;
      }
      viz += `<div class="viz-links"><a href="https://www.google.com/maps/search/?api=1&query=${escShare(String(pl.lat))},${escShare(String(pl.lng))}" target="_blank" rel="noopener">Open in Maps ↗</a>` +
        (pl.wiki ? `<a href="${escShare(String(pl.wiki))}" target="_blank" rel="noopener">Wikipedia ↗</a>` : "") + `</div>`;
    }
    if (m.img && m.img.url && /^https?:\/\//i.test(String(m.img.url))) {
      viz += `<div class="viz-gen"><img src="${escShare(String(m.img.url))}" alt="${escShare(String(m.img.prompt || "Image created in this chat"))}" loading="lazy"></div>`;
    }
    if (viz) viz = `<div class="viz">${viz}</div>`;
    return `<div class="row ${mine ? "me" : "ai"}"><div class="bubble ${mine ? "me" : "ai"}">${file}<div class="txt">${body}</div>${viz}` +
      (when ? `<div class="when">${escShare(when)}</div>` : "") + `</div></div>`;
  }).join("");
  const title = escShare(String(chat.title || "Shared chat").slice(0, 90));
  const made = new Date(Number(chat.created) || Date.now()).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · MindFusion</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#121A2B;background:#F7FBFF;
  background-image:radial-gradient(46% 34% at 10% 6%,rgba(10,102,255,.26),transparent 70%),radial-gradient(44% 32% at 90% 3%,rgba(255,197,61,.28),transparent 70%),radial-gradient(48% 36% at 84% 94%,rgba(255,95,162,.20),transparent 70%),radial-gradient(44% 34% at 12% 92%,rgba(255,90,90,.18),transparent 70%),radial-gradient(56% 46% at 50% 52%,rgba(18,191,166,.16),transparent 72%)}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:13px 18px;
  background:rgba(255,255,255,.82);backdrop-filter:blur(10px);border-bottom:1px solid rgba(20,60,140,.10)}
.logo{font-weight:900;font-size:15px;background:linear-gradient(96deg,#0A66FF,#FF5FA2 60%,#12BFA6);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.badge{padding:5px 11px;border-radius:999px;font-size:10.5px;font-weight:800;letter-spacing:.06em;
  text-transform:uppercase;background:rgba(10,102,255,.12);color:#0A66FF}
.head-title{margin-left:auto;font-size:12.5px;color:#5A6B85;max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
main{max-width:760px;margin:0 auto;padding:20px 16px 60px}
.note{margin:4px 0 18px;padding:12px 14px;border-radius:14px;background:rgba(10,102,255,.08);
  border:1px solid rgba(10,102,255,.18);font-size:12.5px;line-height:1.6;color:#40506A}
.row{display:flex;margin:12px 0}
.row.me{justify-content:flex-end}
.bubble{max-width:86%;padding:13px 15px;border-radius:18px;font-size:14.5px;line-height:1.65;
  box-shadow:0 10px 26px rgba(20,60,140,.10);background:#fff;border:1px solid rgba(20,60,140,.08)}
.bubble.me{background:linear-gradient(135deg,#0A66FF,#2E90FF);color:#fff;border-color:transparent}
.txt{white-space:pre-wrap;word-break:break-word}
.when{margin-top:7px;font-size:10.5px;opacity:.6}
.file{margin-bottom:7px;font-size:12.5px;font-weight:700;opacity:.8}
.viz{margin-top:11px;border-top:1px solid rgba(20,60,140,.10);padding-top:10px}
.viz-name{font-size:13px;font-weight:800;margin-bottom:8px}
.viz-name span{display:block;font-size:11.5px;font-weight:600;opacity:.65;margin-top:1px}
.viz-photos{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.viz-photos figure{margin:0}
.viz-photos img,.viz-map img,.viz-gen img{width:100%;display:block;border-radius:12px}
.viz-photos figcaption{font-size:10px;opacity:.6;margin-top:3px;line-height:1.4}
.viz-map{margin-top:8px}
.viz-gen{margin-top:8px}
.viz-links{display:flex;gap:14px;margin-top:8px;font-size:12px;font-weight:700}
.viz-maplink{position:relative;display:block}
.viz-maphint{position:absolute;right:8px;bottom:8px;padding:4px 9px;border-radius:999px;background:rgba(10,16,30,.72);color:#fff;font-size:10.5px;font-weight:700}
.viz-lb{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(5,10,20,.93);padding:20px}
.viz-lb.show{display:flex}
.viz-lb img{max-width:94vw;max-height:82vh;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.viz-lb-cap{color:#D7E2F2;font-size:12px;text-align:center;max-width:88vw}
.viz-lb-x{position:absolute;top:14px;right:14px;width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:16px;cursor:pointer}
footer{max-width:760px;margin:0 auto;padding:0 16px 44px;text-align:center;font-size:12px;color:#6B7A93}
a{color:#0A66FF}
@media (max-width:520px){.head-title{display:none}.bubble{max-width:92%}}
</style></head><body>
<header><span class="logo">MindFusion</span><span class="badge">Read only</span>
<span class="head-title">${title}</span></header>
<main>
  <div class="note">🔗 <b>This is a shared copy of one chat.</b> You can read it, but you cannot
  type, answer or change anything here — the chat belongs to its owner, and only the owner can
  edit it. Shared on ${escShare(made)}.</div>
  ${rows || '<div class="note">This chat has no messages in it yet.</div>'}
</main>
<footer>Made with <b>MindFusion</b> — a hub for different AI models.</footer>
<div class="viz-lb" id="vizLb" role="dialog" aria-label="Image preview">
  <button type="button" class="viz-lb-x" id="vizLbX" aria-label="Close preview">✕</button>
  <img id="vizLbImg" alt="">
  <div class="viz-lb-cap" id="vizLbCap"></div>
</div>
<script>
(function () {
  var lb = document.getElementById('vizLb'), im = document.getElementById('vizLbImg'), cap = document.getElementById('vizLbCap');
  function open(img) { im.src = img.src; im.alt = img.alt || ''; cap.textContent = img.alt || ''; lb.classList.add('show'); }
  function shut() { lb.classList.remove('show'); im.removeAttribute('src'); }
  document.querySelectorAll('.viz-photos img,.viz-gen img').forEach(function (img) {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', function () { open(img); });
  });
  document.getElementById('vizLbX').addEventListener('click', shut);
  lb.addEventListener('click', function (e) { if (e.target === lb) shut(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
})();
</script>
</body></html>`;
}
async function handleSharedChat(token, env) {
  const clean = String(token || "").replace(/[^a-z0-9]/gi, "").slice(0, 64);
  const fail = (why, code) => new Response(sharedGonePage(why), {
    status: code || 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" }
  });
  if (!clean) return fail("That address does not look like a MindFusion share link.");
  if (!kvReady(env)) return fail("The owner's cloud storage is not connected right now.");
  let chatId = "";
  try { chatId = String((await kvStore(env).get(KV_SHARE_PREFIX + clean)) || ""); } catch (e) {}
  if (!chatId) return fail("This link was never used, or the owner has stopped sharing this chat.");
  let list = [];
  try {
    const raw = await kvStore(env).get(KV_CHATS_KEY);
    list = raw ? JSON.parse(raw) : [];
  } catch (e) {}
  const chat = Array.isArray(list) ? list.find(function (c) { return c && c.id === chatId; }) : null;
  if (!chat) return fail("The owner deleted this chat, so the link stops here.");
  return new Response(buildSharePage(chat), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" }
  });
}
/* the built-in models the owner has removed — kept in KV, so every browser
   sees the same ⚡ Models list */
async function readHiddenModels(env) {
  if (!kvReady(env)) return [];
  try {
    const raw = await kvStore(env).get(KV_HIDDEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(function (k) { return typeof k === "string"; }) : [];
  } catch (e) { return []; }
}
async function writeHiddenModels(env, list) {
  await kvStore(env).put(KV_HIDDEN_KEY, JSON.stringify(list.slice(0, 40)));
}
/* =========================================================
   WORKER ENTRY
   ========================================================= */
export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
          }
        });
      }
      const url = new URL(request.url);
      /* a KV binding always wins; when there is none, the KV link header
         (Settings → 🩺 Storage & connection) is used instead */
      env = kvLinkAttach(env, request);
      if (url.pathname === "/health") {
        return json({ ok: true, service: "Sarvam AI Worker", version: "v16" });
      }
      /* a shared chat: a read-only page, open to anyone who has the link */
      if (url.pathname.indexOf("/s/") === 0) {
        return await handleSharedChat(url.pathname.slice(3), env);
      }
      /* login endpoint (open) */
      if (url.pathname === "/api/verify" && request.method === "POST") {
        return await handleVerify(request, env);
      }
      /* every other /api route needs a valid login cookie */
      if (url.pathname.startsWith("/api/")) {
        if (!(await isAuthed(request, env))) return lockedResponse();
        if (url.pathname === "/api/session") return json({ ok: true });
      }
      if (url.pathname === "/api/provider-models" && request.method === "GET") {
        return await handleProviderModels(request, env, url);
      }
      if (url.pathname === "/api/providers" && (request.method === "GET" || request.method === "POST")) {
        return await handleProviders(request, env);
      }
      if (url.pathname === "/api/models" && (request.method === "GET" || request.method === "POST")) {
        return await handleModels(request, env);
      }
      if (url.pathname === "/api/og-status") {
        return await handleOgStatus(request, env);
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await handleChat(request, env);
      }
      if (url.pathname === "/api/og-models" && request.method === "GET") {
        return await handleOgModels(request, env);
      }
      if (url.pathname === "/api/image" && request.method === "POST") {
        return await handleImage(request, env);
      }
      if (url.pathname === "/api/translate" && request.method === "POST") {
        return await handleTranslate(request, env);
      }
      if (url.pathname === "/api/kv-check") {
        return await handleKvCheck(request, env);
      }
      if (url.pathname === "/api/usage" && request.method === "POST") {
        return await handleUsage(request, env);
      }
      if (url.pathname === "/api/sync" && request.method === "POST") {
        return await handleSync(request, env);
      }
      if (url.pathname === "/api/share" && request.method === "POST") {
        return await handleShare(request, env);
      }
      if (url.pathname === "/api/document-upload" && request.method === "POST") {
        return await handleDocumentUpload(request, env);
      }
      if (url.pathname === "/api/document-status" && request.method === "GET") {
        return await handleDocumentStatus(request, env);
      }
      if (url.pathname === "/api/place" && request.method === "GET") {
        return await handlePlace(request, env, url);
      }
      if (url.pathname === "/api/websearch" && request.method === "GET") {
        return await handleWebSearch(request, env, url);
      }
      if (url.pathname === "/api/unsplash-track" && request.method === "GET") {
        /* Unsplash download tracking, proxied so the key stays server-side */
        try {
          const loc = String(url.searchParams.get("u") || "");
          const key = env && env.UNSPLASH_ACCESS_KEY;
          if (key && loc.indexOf("https://api.unsplash.com/") === 0) {
            await fetch(loc, { headers: { Authorization: "Client-ID " + key, "Accept-Version": "v1" } });
          }
        } catch (e) { /* tracking is best-effort */ }
        return json({ ok: true });
      }
      if (url.pathname === "/" || url.pathname === "") {
        return new Response(buildHTML(await isAuthed(request, env)), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin"
          }
        });
      }
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (error) {
      console.error("Worker error:", error);
      return json({ ok: false, error: error?.message || "Internal server error." }, 500);
    }
  }
};
