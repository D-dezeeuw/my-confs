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
  refs,
  appState,
  appStateDelta,
} from "spektrum";

// ---------- vendor / pitch detection -----------------------------------
//
// Each speaker company is scored 0-10 in data/companies.json. The session's
// pitchScore is the max across its speakers, +2 if the company name is
// referenced in the title or description (clamped to 10). Score is bucketed
// for display:
//   ≥7  → "Likely pitch" (amber, hidden by Hide-pitches filter)
//   ≥4  → "Vendor talk"  (grey)
//   else→ neutral (no badge)
//
// Soft signal: a DevRel/Advocate/Evangelist job title bumps the score by 1
// even when the company is unscored, so generic outreach roles still flag.

let companiesIndex = {}; // populated by loadCompanies()

const PITCH_JOB_TITLES = /devrel|developer\s+advocate|evangelist|gtm|sales/i;

async function loadCompanies() {
  try {
    const resp = await fetch("./data/companies.json");
    if (!resp.ok) return;
    const json = await resp.json();
    companiesIndex = json.companies || {};
  } catch {
    /* fall through — empty index keeps everything neutral */
  }
}

function lookupCompany(name) {
  if (!name) return null;
  const direct = companiesIndex[name];
  if (direct) return direct;
  // Fallback: case-insensitive lookup (handles minor casing drift in source).
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(companiesIndex)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function classifyPitchRisk(session) {
  const speakerInfos = session.speakerInfo || [];
  if (speakerInfos.length === 0) {
    return { risk: "neutral", score: 0, reason: "" };
  }

  const haystack = `${session.title || ""} ${session.description || ""}`.toLowerCase();

  let bestScore = 0;
  let bestCompany = "";
  let bestProducts = "";
  let bumpReason = "";

  for (const info of speakerInfos) {
    const company = (info.company || "").trim();
    let score = 0;
    let products = "";
    if (company) {
      const entry = lookupCompany(company);
      if (entry) {
        score = entry.pitchScore || 0;
        products = entry.products || "";
      }
      // Bump if the company name is referenced in title/description.
      if (haystack.includes(company.toLowerCase())) {
        score = Math.min(10, score + 2);
        bumpReason = ` (talk references ${company})`;
      }
    }
    // Soft bump for outreach job titles, even without a company score.
    if (PITCH_JOB_TITLES.test(info.jobTitle || "")) {
      score = Math.max(score, 6);
    }
    if (score > bestScore) {
      bestScore = score;
      bestCompany = company;
      bestProducts = products;
    }
  }

  // Fallback: when no speaker resolved to a worksFor (or speaker info is
  // empty), still scan the title + description for any known vendor-company
  // name in the index. Catches talks like "Agents at Work: How GitLab Is
  // Redefining AI Adoption" where the speaker didn't match but the brand is
  // explicit. Skip if a real speaker company already produced a higher
  // signal.
  if (bestScore < 7) {
    for (const [name, entry] of Object.entries(companiesIndex)) {
      if (!entry || (entry.pitchScore || 0) < 6) continue;
      const lower = name.toLowerCase();
      if (lower.length < 3) continue; // avoid spurious 2-letter hits
      if (haystack.includes(lower)) {
        const score = Math.min(10, (entry.pitchScore || 0) + 2);
        if (score > bestScore) {
          bestScore = score;
          bestCompany = name;
          bestProducts = entry.products || "";
          bumpReason = " (talk references the company)";
        }
      }
    }
  }

  let risk = "neutral";
  let reason = "";
  if (bestScore >= 7) {
    risk = "pitch";
    reason = bestCompany
      ? `Speaker from ${bestCompany}${bestProducts ? " — " + bestProducts : ""}${bumpReason}.`
      : "Likely product pitch.";
  } else if (bestScore >= 4) {
    risk = "vendor";
    reason = bestCompany
      ? `Speaker from ${bestCompany}${bestProducts ? " — " + bestProducts : ""}.`
      : "Vendor or outreach role.";
  }
  return { risk, score: bestScore, reason };
}

// ---------- role templates ---------------------------------------------

const ROLE_TEMPLATES = [
  {
    id: "cto",
    label: "Fractional CTO",
    text:
      "I am a fractional CTO working with development teams and the board to adapt to the AI transition, make them work more efficient, capable with the latest technological advancements and automation.",
  },
  {
    id: "frontend",
    label: "Frontend Developer",
    text:
      "Senior frontend engineer working in TypeScript / React / Next.js. Interested in performance, accessibility, design systems, and how AI-assisted code generation fits into a production frontend workflow. Less interested in beginner JS talks or framework-flavor-of-the-month.",
  },
  {
    id: "backend",
    label: "Backend Developer",
    text:
      "Backend engineer working primarily in Go / Python / Node, building API services and event-driven systems. Interested in production-grade observability, security, data pipelines, and pragmatic patterns for adding AI agents to existing services. Skip introductory cloud talks.",
  },
  {
    id: "fullstack",
    label: "Full-stack Developer",
    text:
      "Full-stack developer (TypeScript / Node / Postgres) shipping features end-to-end. Interested in faster feedback loops, AI-assisted dev workflows (Cursor, Claude Code, Copilot), zero-trust security patterns, and useful agentic AI patterns I can apply Monday.",
  },
  {
    id: "product",
    label: "Product Owner / Manager",
    text:
      "Product owner working with engineering and design to ship customer value. Interested in AI-driven product discovery and validation, prioritisation under regulatory constraints (EU AI Act / GDPR), and how engineering teams adopt agentic tools without slowing delivery. Less interested in deep low-level engineering talks.",
  },
  {
    id: "qa",
    label: "QA / Tester",
    text:
      "QA engineer / SDET working on test automation and quality strategy. Interested in AI-augmented testing (test generation, flake reduction, bug reproduction), accessibility testing, and how the QA role evolves as agents take on more of the test cycle. Skip pure dev framework deep-dives.",
  },
  {
    id: "devops",
    label: "DevOps / Platform Engineer",
    text:
      "Platform / DevOps engineer running CI/CD and cloud infra (Kubernetes, GitHub Actions, Terraform). Interested in golden paths, AI-assisted incident response, secure supply chain (SBOMs, slopsquatting defenses), cost-aware delivery, and platform-as-product practices.",
  },
  {
    id: "em",
    label: "Engineering Manager",
    text:
      "Engineering manager leading a team of 5–12 engineers. Interested in productivity culture, incident management, AI org-change practices, social/network thinking for team health, and leading through the agentic SDLC transition. Less interested in single-framework deep-dives.",
  },
  {
    id: "founder",
    label: "Solo founder / Indie hacker",
    text:
      "Solo founder building AI-powered SaaS. Interested in vibe-coding workflows, MCP / agent skills, AI-driven product validation, fast paths from spec to shipped feature, and what's actually working for AI-native teams. Pragmatic over academic; skip enterprise governance panels.",
  },
  {
    id: "data",
    label: "Data / ML Engineer",
    text:
      "Data / ML engineer working on production model pipelines and agentic systems. Interested in dataset management, retrieval / context engineering for agents, data-aware MCP servers, and security implications of LLM-integrated services.",
  },
];

// ---------- storage keys ------------------------------------------------

const STORAGE = {
  apiKey: "dw26.apiKey",
  model: "dw26.model",
  context: "dw26.context",
  tagFilters: "dw26.tagFilters",
  stageFilters: "dw26.stageFilters",
  hidePitches: "dw26.hidePitches",
  timelineMode: "dw26.timelineMode",
  rawRecs: "dw26.rawRecs",
  overallAdvice: "dw26.overallAdvice",
  notifyEnabled: "dw26.notifyEnabled",
  notifiedIds: "dw26.notifiedIds",
};

// Reminder fires this many minutes before a recommended session start.
const NOTIFY_LEAD_MIN = 5;
// How often the in-page scheduler polls (ms).
const NOTIFY_POLL_MS = 30_000;

// ---------- bootstrap ---------------------------------------------------

(async function main() {
  const keyFromUrl = consumeApiKeyFromUrl();
  initialState();
  registerHandlers();
  registerComputeds();
  registerPersistence();
  wireHashRouting();
  wireGlobalKeys();
  wireClock();
  wireTimelineAutoScroll();
  wireNotifications();
  await loadCompanies();
  await loadSessions();
  if (keyFromUrl) {
    setValue("status", {
      text: "API key loaded from URL and saved to this browser.",
      kind: "muted",
    });
  }
  // Prompt the user up front when no API key is configured anywhere.
  // The ?api= URL param is already consumed into localStorage above, so
  // this only fires when neither the URL, localStorage, nor config.js
  // gave us a key.
  promptForApiKeyIfMissing();
  bindDOM();
  run();
  wireFooterFabHide();
})();

function promptForApiKeyIfMissing() {
  const stored = localStorage.getItem(STORAGE.apiKey) || "";
  const fallback =
    (window.APP_CONFIG && window.APP_CONFIG.OPENROUTER_API_KEY) || "";
  if (stored.trim() || fallback.trim()) return;
  setValue("settingsOpen", true);
  setValue("status", {
    text: "Paste your OpenRouter API key to enable recommendations.",
    kind: "muted",
  });
}

// Parse `?api=...` (or alias `?key=...`) on boot, persist the value to
// localStorage, then strip the param from the URL bar via replaceState so
// the secret doesn't linger in browser history, bookmarks, or referer
// headers when the user navigates away. Returns true iff a key was consumed
// so main() can surface a status note after the agenda loads.
function consumeApiKeyFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("api") ?? params.get("key");
  if (raw == null) return false;
  const key = raw.trim();
  if (!key) return false;
  localStorage.setItem(STORAGE.apiKey, key);
  params.delete("api");
  params.delete("key");
  const newSearch = params.toString();
  const newUrl =
    window.location.pathname +
    (newSearch ? "?" + newSearch : "") +
    window.location.hash;
  history.replaceState(null, "", newUrl);
  return true;
}

// ---------- initial state ----------------------------------------------

function initialState() {
  setValue("sessions", []);
  setValue("slots", []);
  setValue("agendaItems", []);
  setValue("tagsAvailable", []);
  setValue("stagesAvailable", []);
  setValue("tagFilters", safeJson(localStorage.getItem(STORAGE.tagFilters), []));
  setValue("stageFilters", safeJson(localStorage.getItem(STORAGE.stageFilters), []));
  setValue(
    "hidePitches",
    localStorage.getItem(STORAGE.hidePitches) === "1"
  );
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
  setValue(
    "timelineMode",
    localStorage.getItem(STORAGE.timelineMode) || "picks"
  );
  setValue("timelineNow", currentMinutes());
  setValue("tracks", []);
  setValue("timeAxis", []);
  setValue("nowOffset", null);
  setValue("timelineWidth", 0);
  setValue("selectedSession", null);
  setValue(
    "notifyEnabled",
    localStorage.getItem(STORAGE.notifyEnabled) === "1"
  );
  setValue("notificationPermission", initialNotificationPermission());
  setValue(
    "notifiedIds",
    safeJson(localStorage.getItem(STORAGE.notifiedIds), [])
  );
  setValue("notifyScheduledCount", 0);
}

function initialNotificationPermission() {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function deriveViewFromHash() {
  const h = window.location.hash;
  if (h === "#agenda") return "agenda";
  if (h === "#live") return "live";
  return "schedule";
}

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
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
  const speakerInfo = s.speakerInfo || [];

  // Speaker text in card meta: "Name · Company" when we have it.
  const speakerLabel = speakerInfo.length
    ? speakerInfo
        .map((info) =>
          info.company ? `${info.name} · ${info.company}` : info.name
        )
        .join(", ")
    : (s.speakers || []).join(", ");

  const metaBits = [];
  if (s.stage) metaBits.push(s.stage);
  if (s.duration) metaBits.push(s.duration);
  if (end && s.time) metaBits.push(`${s.time}–${end}`);
  if (speakerLabel) metaBits.push(speakerLabel);

  const {
    risk: pitchRisk,
    reason: pitchReason,
    score: pitchScore,
  } = classifyPitchRisk(s);
  const pitchLabel =
    pitchRisk === "pitch"
      ? "Likely pitch"
      : pitchRisk === "vendor"
      ? "Vendor talk"
      : "";

  return {
    id: idx,
    title: s.title,
    time: s.time,
    timeKey: time,
    timeLabel: s.time || "Opening",
    duration: s.duration,
    stage: s.stage || "",
    speakers: s.speakers || [],
    speakerInfo,
    tags: s.tags || [],
    description: s.description || "",
    metaText: metaBits.join("  ·  "),
    visible: true,
    recKind: "",
    recLabel: "",
    recRationale: "",
    pitchRisk,
    pitchLabel,
    pitchReason,
    pitchScore,
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
    ["sessions", "tagFilters", "stageFilters", "hidePitches", "rawRecs"],
    (state) => {
      const sessions = state.sessions || [];
      const tagF = new Set(state.tagFilters || []);
      const stageF = new Set(state.stageFilters || []);
      const hidePitches = !!state.hidePitches;
      const recs = state.rawRecs; // plain object map: norm-title -> {kind, rationale}

      const map = new Map();
      for (const s of sessions) {
        const visible =
          (tagF.size === 0 || s.tags.some((t) => tagF.has(t))) &&
          (stageF.size === 0 || stageF.has(s.stage)) &&
          (!hidePitches || s.pitchRisk !== "pitch");
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

  // ---- Live timeline ----
  // Tunables.
  const PX_PER_MINUTE = 5;
  const TIMELINE_PAD_BEFORE = 30;   // minutes shown before the earliest session
  const TIMELINE_PAD_AFTER = 30;    // minutes shown after the latest end
  const STAGE_ORDER = [
    "Main Stage",
    "Duck Stage 1",
    "Duck Stage 2",
    "Duck Stage 3",
    "Workshop Area",
    "All Tracks",
  ];

  const stageRank = (s) => {
    const i = STAGE_ORDER.indexOf(s);
    return i === -1 ? 100 : i;
  };

  const sessionStartMinutes = (s) => {
    // Three opening Duck Stage talks have no published time; treat as 09:00
    // for timeline purposes only (their original .time stays null).
    const t = s.time || "09:00";
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const sessionEndMinutes = (s) => sessionStartMinutes(s) + parseDuration(s.duration);

  computed(
    "tracks",
    ["sessions", "rawRecs", "timelineMode", "hasRecommendations"],
    (state) => {
      const sessions = state.sessions || [];
      if (sessions.length === 0) return [];

      const recs = state.rawRecs;
      const mode = state.hasRecommendations ? state.timelineMode : "all";

      // Compute timeline range for px-positioning.
      let minStart = Infinity;
      let maxEnd = 0;
      for (const s of sessions) {
        const start = sessionStartMinutes(s);
        const end = sessionEndMinutes(s);
        if (start < minStart) minStart = start;
        if (end > maxEnd) maxEnd = end;
      }
      const origin = (Number.isFinite(minStart) ? minStart : 540) - TIMELINE_PAD_BEFORE;

      // Build per-stage map.
      const map = new Map();
      for (const s of sessions) {
        const stage = s.stage || "Other";
        if (!map.has(stage)) map.set(stage, []);
        const start = sessionStartMinutes(s);
        const dur = parseDuration(s.duration);
        const r = recs ? recs[normalize(s.title)] : null;
        const recKind = r?.kind || "";

        if (mode === "picks" && recKind !== "pick") continue;

        const left = (start - origin) * PX_PER_MINUTE;
        const width = Math.max(60, dur * PX_PER_MINUTE);
        map.get(stage).push({
          ...s,
          recKind,
          recRationale: r?.rationale || "",
          timelineStyle: `left: ${left}px; width: ${width}px;`,
        });
      }

      const tracks = [...map.entries()]
        .filter(([, items]) => items.length > 0)
        .sort(([a], [b]) => stageRank(a) - stageRank(b))
        .map(([stage, items]) => ({
          stage,
          sessions: items.sort((a, b) => sessionStartMinutes(a) - sessionStartMinutes(b)),
        }));
      return tracks;
    }
  );

  computed("timeAxis", ["sessions"], (state) => {
    const sessions = state.sessions || [];
    if (sessions.length === 0) return [];
    let minStart = Infinity;
    let maxEnd = 0;
    for (const s of sessions) {
      const start = sessionStartMinutes(s);
      const end = sessionEndMinutes(s);
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }
    if (!Number.isFinite(minStart)) return [];
    const origin = minStart - TIMELINE_PAD_BEFORE;
    const last = maxEnd + TIMELINE_PAD_AFTER;
    // Round origin down to nearest :00 / :30, end up similarly.
    const startMin = Math.floor(origin / 30) * 30;
    const endMin = Math.ceil(last / 30) * 30;
    const ticks = [];
    for (let m = startMin; m <= endMin; m += 30) {
      const h = Math.floor(m / 60) % 24;
      const mm = m % 60;
      const label = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      // Shift by the stage-column width so ticks line up with the lanes
      // (which start after the sticky stage-label column on each row).
      // Width set via CSS var --stage-col-width; falls back to 88px.
      ticks.push({
        label,
        style: `left: calc(var(--stage-col-width, 88px) + ${(m - origin) * PX_PER_MINUTE}px);`,
        major: mm === 0,
      });
    }
    return ticks;
  });

  computed("timelineWidth", ["sessions"], (state) => {
    const sessions = state.sessions || [];
    if (sessions.length === 0) return 0;
    let minStart = Infinity;
    let maxEnd = 0;
    for (const s of sessions) {
      const start = sessionStartMinutes(s);
      const end = sessionEndMinutes(s);
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }
    if (!Number.isFinite(minStart)) return 0;
    return (maxEnd + TIMELINE_PAD_AFTER - (minStart - TIMELINE_PAD_BEFORE)) * PX_PER_MINUTE;
  });

  computed("nowOffset", ["sessions", "timelineNow"], (state) => {
    const sessions = state.sessions || [];
    if (sessions.length === 0) return null;
    let minStart = Infinity;
    let maxEnd = 0;
    for (const s of sessions) {
      const start = sessionStartMinutes(s);
      const end = sessionEndMinutes(s);
      if (start < minStart) minStart = start;
      if (end > maxEnd) maxEnd = end;
    }
    if (!Number.isFinite(minStart)) return null;
    const origin = minStart - TIMELINE_PAD_BEFORE;
    const now = state.timelineNow ?? 0;
    if (now < origin || now > maxEnd + TIMELINE_PAD_AFTER) return null;
    return (now - origin) * PX_PER_MINUTE;
  });

  computed("nowLabel", ["timelineNow"], (state) => {
    const m = state.timelineNow ?? 0;
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  });

  computed("nowStyle", ["nowOffset"], (state) => {
    const o = state.nowOffset;
    return o == null
      ? "display: none;"
      : `left: calc(var(--stage-col-width, 88px) + ${o}px);`;
  });

  // hasRecommendations boolean for the Strategy card + Clear button.
  computed("hasRecommendations", ["rawRecs"], (state) => {
    const r = state.rawRecs;
    return !!r && Object.keys(r).length > 0;
  });

  // notifyScheduledCount: how many picks are still waiting on a reminder
  // (i.e. id not yet in notifiedIds). Once the scheduler poll fires (or
  // marks past-time picks as stale), they drop out of this count.
  computed("notifyScheduledCount", ["agendaItems", "notifiedIds"], (state) => {
    const items = state.agendaItems || [];
    const notified = new Set(state.notifiedIds || []);
    return items.filter((i) => !notified.has(i.id)).length;
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

  defineFn("closeSettings", () => {
    setValue("settingsOpen", false);
  });

  defineFn("backdropClose", (el, _state, _delta, _value, ev) => {
    // Only close when the click landed on the backdrop itself, not on a
    // child (the modal card or any of its inputs/buttons).
    if (ev && ev.target === el) setValue("settingsOpen", false);
  });

  defineFn("applyTemplate", (el) => {
    const id = el.value;
    if (!id) return;
    const tmpl = ROLE_TEMPLATES.find((t) => t.id === id);
    if (!tmpl) return;
    setValue("context", tmpl.text);
    el.value = "";
    setValue("status", {
      text: `Template applied: ${tmpl.label}. Edit to taste.`,
      kind: "muted",
    });
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

  defineFn("toggleHidePitches", (_el, state) => {
    const next = !state.hidePitches;
    setValue("hidePitches", next);
    localStorage.setItem(STORAGE.hidePitches, next ? "1" : "0");
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

  defineFn("exportPdf", () => {
    // window.print() with a print stylesheet — zero deps, real searchable
    // text in the PDF, native browser dialog. Print stylesheet hides app
    // chrome and forces details elements open so the strategy block prints.
    window.print();
  });

  defineFn("goSchedule", () => {
    setValue("view", "schedule");
    if (window.location.hash !== "#schedule" && window.location.hash !== "") {
      window.location.hash = "#schedule";
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  defineFn("goLive", () => {
    setValue("view", "live");
    if (window.location.hash !== "#live") {
      window.location.hash = "#live";
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  defineFn("toggleTimelineMode", (_el, state) => {
    const next = state.timelineMode === "picks" ? "all" : "picks";
    setValue("timelineMode", next);
    localStorage.setItem(STORAGE.timelineMode, next);
  });

  defineFn("openSessionDetail", (el, state) => {
    const path = el.dataset.id;
    if (!path) return;
    const session = getPathObj(state, path);
    if (!session) return;
    setValue("selectedSession", session);
  });

  defineFn("closeSessionDetail", () => {
    setValue("selectedSession", null);
  });

  defineFn("backdropCloseDetail", (el, _state, _delta, _value, ev) => {
    if (ev && ev.target === el) setValue("selectedSession", null);
  });

  defineFn("enableNotifications", async () => {
    if (!("Notification" in window)) return;
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = Notification.permission;
      }
    }
    setValue("notificationPermission", perm);
    if (perm === "granted") {
      setValue("notifyEnabled", true);
      localStorage.setItem(STORAGE.notifyEnabled, "1");
      pollNotifications(); // catch up immediately for any pick already in-window
    }
  });

  defineFn("disableNotifications", () => {
    setValue("notifyEnabled", false);
    localStorage.setItem(STORAGE.notifyEnabled, "0");
  });

  defineFn("testNotification", () => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      const n = new Notification("DevWorld 2026 reminder", {
        body: "Notifications working — you'll get one 5 min before each pick.",
        icon: faviconUrl(),
        tag: "dw26-test",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (err) {
      console.warn("Notification test failed:", err);
    }
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
    // Always send the full agenda. We previously dropped pitch-risk
    // sessions from the payload when hidePitches was on, but that produced
    // gaps in slots whose every entry was a pitch (the LLM had nothing to
    // pick). Instead we pass the preference through and tell the model to
    // avoid pitches *unless* the whole slot is pitches, in which case it
    // should pick the best one anyway and surface the trade-off.
    const allSessions = live.sessions || [];

    setValue("loading", true);
    setValue("status", { text: "Thinking…", kind: "muted" });
    try {
      const recs = await callOpenRouter(
        ctx,
        allSessions,
        apiKey,
        live.model,
        !!live.hidePitches
      );
      const map = recsToMap(recs);
      setValue("rawRecs", map);
      setValue("overallAdvice", recs.overall_advice || "");
      // Fresh agenda → reset which picks have been notified about so a
      // pick whose id matches one we previously alerted about doesn't get
      // silently suppressed. (Subsequent reloads preserve this list.)
      setValue("notifiedIds", []);
      localStorage.removeItem(STORAGE.notifiedIds);
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

function wireGlobalKeys() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setValue("settingsOpen", false);
      setValue("selectedSession", null);
    }
  });
}

// Toggle a body class when the footer scrolls into view, so CSS can fade
// the FAB out and stop it sitting on top of the credits + social icons.
function wireFooterFabHide() {
  if (!("IntersectionObserver" in window)) return;
  const footer = document.querySelector(".site-footer");
  if (!footer) return;
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        document.body.classList.toggle("footer-visible", e.isIntersecting);
      }
    },
    { rootMargin: "0px 0px -16px 0px" }
  );
  obs.observe(footer);
}

function wireClock() {
  setInterval(() => setValue("timelineNow", currentMinutes()), 60_000);
}

// ---------- Notifications scheduler ------------------------------------
//
// In-page poll: every NOTIFY_POLL_MS we walk the agenda picks and fire a
// browser Notification 5 minutes before each pick's start time. Already-
// notified picks (and picks already past the fire window) are tracked in
// state.notifiedIds, persisted across reloads.
//
// Caveat: this runs in the open tab. If the user closes it, no
// notifications. Browsers throttle background tabs but most still let
// setInterval fire roughly once per minute, which catches our 30s window.

function wireNotifications() {
  // Catch up immediately on tab focus + on visibility return + on
  // recommendations changing (newly-generated picks may already be in
  // the 5-min window).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollNotifications();
  });
  addSystem(["agendaItems"], () => pollNotifications());
  setInterval(pollNotifications, NOTIFY_POLL_MS);
}

function pollNotifications() {
  if (!("Notification" in window)) return;
  // Read live state (delta-merged) so we see the most recent notifyEnabled
  // and notifiedIds without waiting for another tick.
  const enabled = getLiveValue("notifyEnabled");
  if (!enabled) return;
  if (Notification.permission !== "granted") return;

  const items = getLiveValue("agendaItems") || [];
  if (items.length === 0) return;

  const notified = new Set(getLiveValue("notifiedIds") || []);
  const before = notified.size;
  const nowMs = Date.now();
  const fired = [];

  for (const pick of items) {
    if (notified.has(pick.id)) continue;
    const startMs = todayAtMs(pick.time);
    if (startMs == null) {
      // No published time (e.g. opening Duck stage talks) — silent skip.
      notified.add(pick.id);
      continue;
    }
    const fireAt = startMs - NOTIFY_LEAD_MIN * 60_000;
    const dt = fireAt - nowMs;

    if (dt < -60_000) {
      // Past our fire window. Mark as notified-or-stale; never fire late.
      notified.add(pick.id);
      continue;
    }
    if (dt <= 0) {
      // Within the fire window — fire and remember.
      fireSessionNotification(pick);
      notified.add(pick.id);
      fired.push(pick);
    }
  }

  if (notified.size !== before) {
    const arr = [...notified];
    setValue("notifiedIds", arr);
    localStorage.setItem(STORAGE.notifiedIds, JSON.stringify(arr));
  }
  if (fired.length) {
    console.info(
      `[dw26] fired ${fired.length} notification(s):`,
      fired.map((p) => p.title)
    );
  }
}

// Read the latest value for a top-level path, preferring the in-flight
// delta over the committed state. Avoids waiting a tick for setValue
// writes from one handler to be visible in another.
function getLiveValue(key) {
  if (appStateDelta && key in appStateDelta) return appStateDelta[key];
  return appState ? appState[key] : undefined;
}

function fireSessionNotification(pick) {
  const time = pick.time || pick.timeLabel || "";
  const stage = pick.stage ? `${pick.stage}` : "";
  const speakers = (pick.speakerInfo || [])
    .map((s) => (s.company ? `${s.name} (${s.company})` : s.name))
    .join(", ");
  const bodyParts = [`Starts in ${NOTIFY_LEAD_MIN} min`];
  if (stage) bodyParts.push(stage);
  if (speakers) bodyParts.push(speakers);

  try {
    const n = new Notification(`${time} · ${pick.title}`, {
      body: bodyParts.join(" · "),
      icon: faviconUrl(),
      tag: `dw26-session-${pick.id}`,
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      window.location.hash = "#agenda";
      n.close();
    };
  } catch (err) {
    console.warn("Notification fire failed:", err);
  }
}

function todayAtMs(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function faviconUrl() {
  return new URL("./favicon.svg", window.location.href).href;
}

// Scroll the timeline so the now-line sits ~28% from the left edge once
// per visit to the live view. We can't gate on "view changed since last
// fire" because of a multi-tick race: on a fresh load with hash=#live,
// the system fires once with view=live and nowOffset=null (still
// computing), then again with the real nowOffset — by which time
// "view changed" is false and we'd never scroll.
//
// Instead we track whether the scroll has actually landed. The flag
// resets when the user leaves the view, so a return visit re-scrolls.
// Per-minute clock ticks updating nowOffset don't re-fire the scroll
// either, so a user mid-scroll never gets yanked back to now.
//
// requestAnimationFrame defers the scroll so spektrum's data-if binder
// has a chance to flip .live from display:none to display:block before
// we read clientWidth.
function wireTimelineAutoScroll() {
  let scrolled = false;
  addSystem(["view", "nowOffset"], (state) => {
    if (state.view !== "live") {
      scrolled = false;
      return;
    }
    if (scrolled) return;
    const offset = state.nowOffset;
    if (offset == null) return;
    requestAnimationFrame(() => {
      const el = refs.timelineScroll;
      if (!el || el.clientWidth === 0) return;
      const stageCol =
        parseInt(
          getComputedStyle(document.documentElement)
            .getPropertyValue("--stage-col-width")
            .trim(),
          10
        ) || 88;
      const nowX = stageCol + offset;
      const target = Math.max(0, nowX - el.clientWidth * 0.28);
      el.scrollTo({ left: target, behavior: "auto" });
      scrolled = true;
    });
  });
}

// ---------- OpenRouter call --------------------------------------------

async function callOpenRouter(context, sessions, apiKey, model, hidePitches) {
  // Trim payload — full descriptions inflate tokens for marginal lift.
  const compact = sessions.map((s) => ({
    title: s.title,
    time: s.time,
    duration: s.duration,
    stage: s.stage,
    speakers: (s.speakerInfo || []).map((info) => ({
      name: info.name,
      company: info.company || null,
      jobTitle: info.jobTitle || null,
    })),
    tags: s.tags,
    pitchScore: s.pitchScore,
    pitchRisk: s.pitchRisk,
    pitchReason: s.pitchReason || null,
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
- Each session has a numeric pitchScore (0-10) derived from the speaker's company. 0-3 = neutral / case
  study / academia / non-profit; 4-6 = consultancy or general SaaS; 7-10 = product company actively
  marketing a SaaS dev-tool. Score is bumped +2 when the company name appears in the talk title or
  description. Treat scores ≥7 as a strong negative unless the user explicitly asked for product demos.
  4-6 is a soft signal, not disqualifying — many vendor-adjacent talks are technically deep. Surface the
  conflict in the rationale when relevant ("vendor talk — speaker is from <Company>, which sells
  <product>"). The pitchReason field already names the company and product when one is on file.
- The user's "Hide pitches" preference is passed in via hidePitches. When true: prefer sessions with
  pitchScore < 7 as picks. **However, never leave a slot without a pick.** If every session in a slot
  has pitchScore ≥ 7, pick the least pitch-y one anyway and clearly call out the compromise in the
  rationale ("Every session in this slot is vendor-led — picked the most technically substantive of
  them"). Same rule for alternatives: it is fine to surface a pitch as an alternative if the slot is
  thin on options.
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

Hide pitches preference: ${
    hidePitches
      ? "ON — strongly avoid sessions with pitchScore >= 7. Only fall back to a pitch if every session in a slot is a pitch, and call out the compromise in the rationale. Never leave a slot without a pick."
      : "OFF — apply the default pitchScore guidance from the system prompt without an extra penalty."
  }

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
