// Default configuration. Anything entered in the in-app Settings panel
// is stored in localStorage and overrides these defaults.
//
// The OPENROUTER_API_KEY is intentionally blank in the published source.
// To use the app, paste your own OpenRouter key into Settings — it is
// stored only in your browser's localStorage. Never commit a real key
// here: this file is fetched client-side and indexed by scrapers within
// seconds of going public.
window.APP_CONFIG = {
  OPENROUTER_API_KEY: "",
  DEFAULT_MODEL: "anthropic/claude-sonnet-4.5",
  APP_TITLE: "DevWorld 2026 Recommender",
};
