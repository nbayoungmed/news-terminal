// Builds today's edition: fetch feeds + markets -> curate -> write
// docs/editions/<date>.json and update docs/editions/index.json.
// Usage: node scripts/build-edition.mjs [--no-ai] [--pool <file>] [--draft <file>]
//   --pool   reuse the headline pool saved in <file> (saved there if missing)
//   --draft  use a hand-written draft JSON instead of calling Claude (for testing)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllFeeds } from "./fetch.mjs";
import { fetchSnapshots, fetchMovers } from "./markets.mjs";
import { curateWithClaude, curateFallback, MODEL } from "./curate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editionsDir = path.join(root, "docs", "editions");
const KEEP_DAYS = 90;

const now = new Date();
const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now); // YYYY-MM-DD
const dateLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(now);

// Replace item ids with real source links, drop unknown ids, cap list lengths.
function resolveStories(stories, byId, max) {
  return (stories || []).slice(0, max).map(({ item_ids, ...s }) => {
    const sources = [];
    const seen = new Set();
    for (const id of item_ids || []) {
      const it = byId.get(id);
      if (!it || seen.has(it.source)) continue;
      seen.add(it.source);
      sources.push({ source: it.source, title: it.title, link: it.link });
    }
    return { ...s, sources };
  });
}

function attachNotes(snapshots, movers, draft) {
  const assetNotes = new Map((draft.markets.asset_notes || []).map((n) => [n.symbol, n.note]));
  const moverNotes = new Map((draft.markets.mover_notes || []).map((n) => [n.ticker, n.note]));
  for (const group of Object.values(snapshots)) for (const a of group) if (assetNotes.has(a.symbol)) a.note = assetNotes.get(a.symbol);
  if (movers)
    for (const idx of [movers.sp500, movers.ftse100])
      for (const m of [...idx.gainers, ...idx.losers]) if (moverNotes.has(m.ticker)) m.note = moverNotes.get(m.ticker);
}

const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : null;
};

async function loadPool(poolFile) {
  if (poolFile && fs.existsSync(poolFile)) return JSON.parse(fs.readFileSync(poolFile, "utf8"));
  const pool = await fetchAllFeeds(path.join(root, "config", "feeds.json"));
  if (poolFile) fs.writeFileSync(poolFile, JSON.stringify(pool));
  return pool;
}

async function main() {
  const draftFile = argValue("--draft");
  const noAi = !draftFile && (process.argv.includes("--no-ai") || !process.env.ANTHROPIC_API_KEY);

  console.log("Fetching feeds and markets…");
  const [{ items, report }, snapshots, movers] = await Promise.all([
    loadPool(argValue("--pool")),
    fetchSnapshots(),
    fetchMovers(path.join(root, "data", "constituents.json")).catch((err) => {
      console.warn("Movers unavailable:", err.message);
      return null;
    }),
  ]);
  const failed = report.filter((r) => r.error);
  console.log(`${items.length} headlines from ${report.length - failed.length}/${report.length} feeds`);
  for (const f of failed) console.warn(`  feed failed: ${f.section}/${f.source}: ${f.error}`);
  if (items.length < 50) throw new Error("Too few headlines fetched — not publishing an edition");

  let result;
  let mode = "ai";
  let error = null;
  if (draftFile) {
    result = { draft: JSON.parse(fs.readFileSync(draftFile, "utf8")), model: "hand-written sample" };
  } else if (noAi) {
    mode = "fallback";
    error = "No API key configured";
    result = curateFallback({ items });
  } else {
    try {
      console.log(`Curating with ${MODEL}…`);
      result = await curateWithClaude({ items, snapshots, movers, dateLabel });
      const u = result.usage;
      console.log(`Tokens: ${u.input_tokens} in / ${u.output_tokens} out`);
    } catch (err) {
      console.error("Claude curation failed, using fallback:", err.message);
      mode = "fallback";
      error = err.message;
      result = curateFallback({ items });
    }
  }

  const { draft } = result;
  const byId = new Map(items.map((it) => [it.id, it]));
  attachNotes(snapshots, movers, draft);

  const edition = {
    date: londonDate,
    dateLabel,
    generatedAt: now.toISOString(),
    mode,
    model: mode === "ai" ? result.model : null,
    error,
    headlineOfDay: draft.headline_of_day,
    markets: {
      summary: draft.markets.summary,
      ...snapshots,
      movers,
      stories: resolveStories(draft.markets.stories, byId, 3),
      calendar: draft.markets.calendar || [],
    },
    world: Object.fromEntries(
      ["us", "uk", "europe", "middle_east"].map((r) => [r, resolveStories(draft.world[r], byId, 3)])
    ),
    energyTech: Object.fromEntries(
      ["energy", "ai", "tech"].map((k) => [k, resolveStories(draft.energy_tech[k], byId, 3)])
    ),
    stats: { headlines: items.length, feeds: report.length, feedsFailed: failed.length },
  };

  fs.mkdirSync(editionsDir, { recursive: true });
  fs.writeFileSync(path.join(editionsDir, `${londonDate}.json`), JSON.stringify(edition, null, 1));

  // Rebuild the index from the files on disk, pruning old editions.
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const dates = fs
    .readdirSync(editionsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter((d) => {
      if (d >= cutoff) return true;
      fs.unlinkSync(path.join(editionsDir, `${d}.json`));
      return false;
    })
    .sort()
    .reverse();
  fs.writeFileSync(path.join(editionsDir, "index.json"), JSON.stringify({ latest: dates[0], dates }, null, 1));

  console.log(`Wrote edition ${londonDate} (${mode})`);
  process.exit(0); // rss-parser can leave timers open
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
