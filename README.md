# News Terminal

A personal morning news briefing. Every morning a GitHub Actions job pulls
~45 RSS feeds and the previous session's market data, asks Claude to pick and
summarise the stories, and publishes the edition to a small terminal-style
web app (installable on iPhone via Share → Add to Home Screen).

## Tabs

- **Markets** — indices (incl. S&P 500 Shariah via the SPUS ETF), commodities,
  rates & FX with 1D/1W/1M/YTD moves; S&P 500 and FTSE 100 top/bottom 5 movers
  (☪ marks SPUS holdings); up to 3 market stories; today's scheduled events.
- **World** — US, UK, Europe, Middle East: one political, one financial and one
  notable story each (slots are left empty on quiet days).
- **Energy · AI · Tech** — 2–3 stories each, energy weighted to UK grid/power.

## How it runs

| Step | Where |
|---|---|
| Feeds | `config/feeds.json` (edit to add/remove sources) |
| Fetch headlines | `scripts/fetch.mjs` |
| Market data + movers | `scripts/markets.mjs` (Yahoo Finance, Wikipedia constituents, SPUS holdings) |
| Curation prompt + schema | `scripts/curate.mjs` |
| Build + write edition | `scripts/build-edition.mjs` → `docs/editions/YYYY-MM-DD.json` |
| Web app | `docs/` (static; served by GitHub Pages or Vercel) |
| Schedule | `.github/workflows/edition.yml` — 05:30 UTC daily, plus a manual "Run workflow" button |

If the Claude call fails (no key, out of credit, outage), the edition is still
published with the latest headlines unranked and a banner saying so.

## Settings

- **API key**: repo → Settings → Secrets and variables → Actions → *Secrets* →
  `ANTHROPIC_API_KEY`.
- **Model** (optional): same page → *Variables* → `CLAUDE_MODEL`
  (default `claude-opus-5-5`; `claude-sonnet-5-5` or `claude-haiku-5-5` are cheaper).

## Local use

```
npm install
npm run build:no-ai          # edition without Claude (unranked)
ANTHROPIC_API_KEY=... npm run build
npm run serve                # http://localhost:8080
```

Testing prompt changes without refetching: `node scripts/build-edition.mjs --pool pool.json`
saves the headline pool on first run and reuses it after; `--draft draft.json`
skips Claude and renders a hand-written draft.
