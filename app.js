/* DevWorld 2026 — personalized schedule recommender, spektrum-driven.
 *
 * Spektrum owns rendering: HTML in index.html declares all bindings via
 * data-each / data-if / :class / data-model / data-action. This module
 * loads sessions, derives slot/filter/recommendation state, and registers
 * action handlers. No manual DOM mutation. */

import {
  setValue,
  defineFn,
  bindDOM,
  run,
  computed,
  addSystem,
  getPathObj,
} from "spektrum";

// ---------- storage keys ------------------------------------------------

const STORAGE = {
  apiKey: "dw26.apiKey",
  model: "dw26.model",
  context: "dw26.context",
  tagFilters: "dw26.tagFilters",
  stageFilters: "dw26.stageFilters",
  rawRecs: "dw26.rawRecs",
  overallAdvice: "dw26.overallAdvice",
};

// ---------- bootstrap ---------------------------------------------------

(async function main() {
  initialState();
  registerHandlers();
  registerComputeds();
  registerPersistence();
  wireHashRouting();
  await loadSessions();
  bindDOM();
  run();
})();

// ---------- initial state ----------------------------------------------

function initialState() {
  setValue("sessions", []);
  setValue("slots", []);
  setValue("agendaItems", []);
  setValue("tagsAvailable", []);
  setValue("stagesAvailable", []);
  setValue("tagFilters", safeJson(localStorage.getItem(STORAGE.tagFilters), []));
  setValue("stageFilters", safeJson(localStorage.getItem(STORAGE.stageFilters), []));
  setValue("context", localStorage.getItem(STORAGE.context) || "");
  setValue("apiKey", localStorage.getItem(STORAGE.apiKey) || "");
  setValue(
    "model",
    localStorage.getItem(STORAGE.model) ||
      (window.APP_CONFIG && window.APP_CONFIG.DEFAULT_MODEL) ||
      "anthropic/claude-sonnet-4.5"
  );
  setValue("status", { text: "Loading agenda…", kind: "muted" });
  setValue("loading", false);
  setValue("settingsOpen", false);
  setValue("hasRecommendations", false);
  setValue(
    "overallAdvice",
    localStorage.getItem(STORAGE.overallAdvice) || ""
  );
  setValue(
    "rawRecs",
    safeJson(localStorage.getItem(STORAGE.rawRecs), null)
  );
  setValue("view", deriveViewFromHash());
}

function deriveViewFromHash() {
  return window.location.hash === "#agenda" ? "agenda" : "schedule";
}

function safeJson(s, fallback) {
  try {
    return JSON.parse(s) ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------- data load + enrichment -------------------------------------

async function loadSessions() {
  const resp = await fetch("./data/sessions.json");
  if (!resp.ok) {
    setValue("status", {
      text: `Failed to load agenda (${resp.status}).`,
      kind: "error",
    });
    return;
  }
  const raw = await resp.json();
  const enriched = raw.map((s, idx) => enrichSession(s, idx));
  setValue("sessions", enriched);
  setValue("tagsAvailable", uniqueSorted(enriched.flatMap((s) => s.tags)));
  setValue(
    "stagesAvailable",
    uniqueSorted(enriched.map((s) => s.stage).filter(Boolean))
  );
  const restoredRecs = safeJson(localStorage.getItem(STORAGE.rawRecs), null);
  const pickCount = restoredRecs
    ? Object.values(restoredRecs).filter((r) => r?.kind === "pick").length
    : 0;
  setValue("status", {
    text: pickCount
      ? `Loaded ${enriched.length} sessions. ${pickCount} saved picks restored.`
      : `Loaded ${enriched.length} sessions.`,
    kind: "muted",
  });
}

function enrichSession(s, idx) {
  const time = s.time || "00:00";
  const end = s.time ? addMinutes(s.time, parseDuration(s.duration)) : null;
  const metaBits = [];
  if (s.stage) metaBits.push(s.stage);
  if (s.duration) metaBits.push(s.duration);
  if (end && s.time) metaBits.push(`${s.time}–${end}`);
  if (s.speakers?.length) metaBits.push(s.speakers.join(", "));
  return {
    id: idx,
    title: s.title,
    time: s.time,
    timeKey: time,
    timeLabel: s.time || "Opening",
    duration: s.duration,
    stage: s.stage || "",
    speakers: s.speakers || [],
    tags: s.tags || [],
    description: s.description || "",
    metaText: metaBits.join("  ·  "),
    visible: true,
    recKind: "",
    recLabel: "",
    recRationale: "",
  };
}

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a.localeCompare(b));
}

function parseDuration(d) {
  if (!d) return 30;
  let mins = 0;
  const h = d.match(/(\d+)\s+Hour/);
  const m = d.match(/(\d+)\s+Minute/);
  if (h) mins += parseInt(h[1], 10) * 60;
  if (m) mins += parseInt(m[1], 10);
  return mins || 30;
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

// ---------- derived state (computed) -----------------------------------

function registerComputeds() {
  // slots: group sessions by time, attach filter/recommendation state.
  computed(
    "slots",
    ["sessions", "tagFilters", "stageFilters", "rawRecs"],
    (state) => {
      const sessions = state.sessions || [];
      const tagF = new Set(state.tagFilters || []);
      const stageF = new Set(state.stageFilters || []);
      const recs = state.rawRecs; // plain object map: norm-title -> {kind, rationale}

      const map = new Map();
      for (const s of sessions) {
        const visible =
          (tagF.size === 0 || s.tags.some((t) => tagF.has(t))) &&
          (stageF.size === 0 || stageF.has(s.stage));
        const r = recs ? recs[normalize(s.title)] : null;
        const enriched = {
          ...s,
          visible,
          recKind: r?.kind || "",
          recLabel:
            r?.kind === "pick" ? "Recommended" : r?.kind === "alt" ? "Alternative" : "",
          recRationale: r?.rationale || "",
        };
        if (!map.has(s.timeKey)) map.set(s.timeKey, []);
        map.get(s.timeKey).push(enriched);
      }

      return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, items]) => {
          const sorted = [...items].sort(slotSort);
          const visibleCount = sorted.filter((s) => s.visible).length;
          return {
            time: key,
            label: key === "00:00" ? "Opening" : key,
            parallelText: `${sorted.length} parallel session${
              sorted.length === 1 ? "" : "s"
            }`,
            sessions: sorted,
            visibleCount,
          };
        });
    }
  );

  // hasRecommendations boolean for the Strategy card + Clear button.
  computed("hasRecommendations", ["rawRecs"], (state) => {
    const r = state.rawRecs;
    return !!r && Object.keys(r).length > 0;
  });

  // agendaItems: just the picks, in chronological order, enriched with rationale.
  computed("agendaItems", ["sessions", "rawRecs"], (state) => {
    const recs = state.rawRecs;
    const sessions = state.sessions || [];
    if (!recs || sessions.length === 0) return [];
    return sessions
      .map((s) => {
        const r = recs[normalize(s.title)];
        if (r?.kind !== "pick") return null;
        return { ...s, rationale: r.rationale || "" };
      })
      .filter(Boolean)
      .sort((a, b) => (a.timeKey || "00:00").localeCompare(b.timeKey || "00:00"));
  });
}

function slotSort(a, b) {
  return weight(a) - weight(b);
}
function weight(s) {
  if (s.recKind === "pick") return 0;
  if (s.recKind === "alt") return 1;
  return 2;
}

function normalize(s) {
  return (s || "").trim().toLowerCase();
}

// ---------- action handlers (data-fn) ----------------------------------

function registerHandlers() {
  defineFn("toggleSettings", (_el, state) => {
    setValue("settingsOpen", !state.settingsOpen);
  });

  defineFn("toggleTagFilter", (el, state) => {
    const tag = getPathObj(state, el.dataset.id);
    if (tag === undefined) return;
    const next = togglePresence(state.tagFilters || [], tag);
    setValue("tagFilters", next);
    localStorage.setItem(STORAGE.tagFilters, JSON.stringify(next));
  });

  defineFn("toggleStageFilter", (el, state) => {
    const stage = getPathObj(state, el.dataset.id);
    if (stage === undefined) return;
    const next = togglePresence(state.stageFilters || [], stage);
    setValue("stageFilters", next);
    localStorage.setItem(STORAGE.stageFilters, JSON.stringify(next));
  });

  defineFn("saveSettings", (_el, state, delta) => {
    const live = { ...state, ...delta };
    if (live.apiKey) localStorage.setItem(STORAGE.apiKey, live.apiKey);
    else localStorage.removeItem(STORAGE.apiKey);
    localStorage.setItem(STORAGE.model, live.model || "");
    setValue("status", { text: "Settings saved.", kind: "muted" });
    setValue("settingsOpen", false);
  });

  defineFn("clearRecommendations", () => {
    setValue("rawRecs", null);
    setValue("overallAdvice", "");
    setValue("status", { text: "Cleared.", kind: "muted" });
    if (window.location.hash === "#agenda") {
      window.location.hash = "#schedule";
    }
  });

  defineFn("goAgenda", () => {
    setValue("view", "agenda");
    if (window.location.hash !== "#agenda") {
      window.location.hash = "#agenda";
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  defineFn("goSchedule", () => {
    setValue("view", "schedule");
    if (window.location.hash !== "#schedule" && window.location.hash !== "") {
      window.location.hash = "#schedule";
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  defineFn("recommend", async (_el, state, delta) => {
    const live = { ...state, ...delta };
    const ctx = (live.context || "").trim();
    if (!ctx) {
      setValue("status", {
        text: "Tell me about your role first.",
        kind: "error",
      });
      return;
    }
    const apiKey = effectiveApiKey(live);
    if (!apiKey) {
      setValue("status", {
        text: "Add an OpenRouter API key in Settings.",
        kind: "error",
      });
      setValue("settingsOpen", true);
      return;
    }
    setValue("loading", true);
    setValue("status", { text: "Thinking…", kind: "muted" });
    try {
      const recs = await callOpenRouter(ctx, live.sessions, apiKey, live.model);
      const map = recsToMap(recs);
      setValue("rawRecs", map);
      setValue("overallAdvice", recs.overall_advice || "");
      setValue("status", {
        text: `Recommendations ready (${recs.slots?.length ?? 0} slots).`,
        kind: "muted",
      });
    } catch (err) {
      console.error(err);
      setValue("status", { text: `Error: ${err.message}`, kind: "error" });
    } finally {
      setValue("loading", false);
    }
  });
}

function togglePresence(arr, value) {
  const set = new Set(arr);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

function effectiveApiKey(state) {
  return (
    state.apiKey ||
    (window.APP_CONFIG && window.APP_CONFIG.OPENROUTER_API_KEY) ||
    ""
  );
}

function recsToMap(recs) {
  const map = {};
  for (const slot of recs.slots || []) {
    if (slot.pick?.title) {
      map[normalize(slot.pick.title)] = {
        kind: "pick",
        rationale: slot.pick.rationale || "",
      };
    }
    for (const alt of slot.alternatives || []) {
      const k = normalize(alt.title);
      if (k && !(k in map)) {
        map[k] = { kind: "alt", rationale: alt.note || "" };
      }
    }
  }
  return map;
}

// ---------- persistence side-effects -----------------------------------
//
// data-model="context" / "apiKey" / "model" mirror their inputs into state
// on each event. Recommendations are written via setValue from the recommend
// handler. We mirror the relevant slices into localStorage with reactive
// subscriptions so the binding layer stays declarative.

function registerPersistence() {
  let ctxTimer = null;
  addSystem(["context"], (state) => {
    clearTimeout(ctxTimer);
    ctxTimer = setTimeout(() => {
      localStorage.setItem(STORAGE.context, state.context || "");
    }, 200);
  });

  addSystem(["rawRecs"], (state) => {
    const v = state.rawRecs;
    if (v && Object.keys(v).length > 0) {
      localStorage.setItem(STORAGE.rawRecs, JSON.stringify(v));
    } else {
      localStorage.removeItem(STORAGE.rawRecs);
    }
  });

  addSystem(["overallAdvice"], (state) => {
    if (state.overallAdvice) {
      localStorage.setItem(STORAGE.overallAdvice, state.overallAdvice);
    } else {
      localStorage.removeItem(STORAGE.overallAdvice);
    }
  });
}

function wireHashRouting() {
  window.addEventListener("hashchange", () => {
    setValue("view", deriveViewFromHash());
  });
}

// ---------- OpenRouter call --------------------------------------------

async function callOpenRouter(context, sessions, apiKey, model) {
  // Trim payload — full descriptions inflate tokens for marginal lift.
  const compact = sessions.map((s) => ({
    title: s.title,
    time: s.time,
    duration: s.duration,
    stage: s.stage,
    speakers: s.speakers,
    tags: s.tags,
    description: (s.description || "").slice(0, 600),
  }));

  const systemPrompt = `You are a conference scheduling assistant for DevWorld 2026.
Given a user's professional context and the full agenda, recommend the single best session per time slot
plus up to two strong alternatives at that slot.

Rules:
- Use exact session titles from the agenda; titles are unique within a slot.
- Some sessions span multiple slots (workshops, networking mixers). When you pick one, mention the conflict
  in the rationale so the user knows what they'd be giving up.
- Prefer hands-on / advanced content over introductory talks unless the user asked otherwise.
- Skip slots only if every session at that slot is clearly irrelevant.
- Keep rationales tight: one or two sentences each.

Return STRICT JSON only, no markdown, matching this shape:
{
  "slots": [
    {
      "time": "09:30",
      "pick": { "title": "...", "rationale": "..." },
      "alternatives": [
        { "title": "...", "note": "..." }
      ]
    }
  ],
  "overall_advice": "..."
}`;

  const userMessage = `Professional context:
${context}

Agenda (${compact.length} sessions):
${JSON.stringify(compact)}`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin || "https://devworld26.local",
      "X-Title": (window.APP_CONFIG && window.APP_CONFIG.APP_TITLE) || "DevWorld26",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      const j = await resp.json();
      detail = j?.error?.message || JSON.stringify(j);
    } catch {
      detail = await resp.text();
    }
    throw new Error(`OpenRouter ${resp.status}: ${detail}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model.");
  const parsed = parseModelJson(content);
  if (!parsed?.slots) throw new Error("Model response missing 'slots' array.");
  return parsed;
}

function parseModelJson(text) {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  return JSON.parse(t);
}
