// Turns the raw headline pool + market data into a morning edition.
// curateWithClaude() asks Claude to pick and summarise the stories;
// curateFallback() is a no-AI version used when the API is unavailable.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const story = (categories) =>
  z.object({
    // Plain string rather than z.enum: an off-list value shouldn't fail the whole edition.
    category: z.string().describe(`One of: ${categories.join(", ")}`),
    headline: z.string().describe("Short, plain-English headline in your own words"),
    summary: z.string().describe("Two sentences: what happened, and why it matters"),
    item_ids: z.array(z.string()).describe("Every pool item id covering this same story, any section"),
  });

const regionStory = story(["political", "financial", "notable"]);
const marketStory = story(["markets", "economy", "companies"]);
const sectorStory = (cat) => story([cat]);

const EditionSchema = z.object({
  headline_of_day: z.string().describe("One sentence capturing the morning's single most important development"),
  markets: z.object({
    summary: z.string().describe("2-3 sentences on how the last trading session went and why"),
    stories: z.array(marketStory),
    asset_notes: z
      .array(z.object({ symbol: z.string(), note: z.string() }))
      .describe("Short reason for notable index/commodity moves, only where the pool explains it"),
    mover_notes: z
      .array(z.object({ ticker: z.string(), note: z.string() }))
      .describe("Short reason for a top/bottom mover, only where the pool explains it"),
    calendar: z
      .array(z.object({ when: z.string(), event: z.string() }))
      .describe("Scheduled events for today explicitly mentioned in the pool"),
  }),
  world: z.object({
    us: z.array(regionStory),
    uk: z.array(regionStory),
    europe: z.array(regionStory),
    middle_east: z.array(regionStory),
  }),
  energy_tech: z.object({
    energy: z.array(sectorStory("energy")),
    ai: z.array(sectorStory("ai")),
    tech: z.array(sectorStory("tech")),
  }),
});

const SYSTEM = `You are the editor of a personal morning news briefing for a reader in London. Their interests: world affairs, markets, the UK and Gulf (GCC) economies, electrical power systems and energy, and AI.

You receive a pool of headlines from the last ~30 hours, each with an id, its feed section, source, title and a short description, plus market data from the last trading session. Build today's edition.

Editorial rules:
- World: for each region (US, UK, Europe, Middle East) pick at most one story per category: political (government, elections, policy, diplomacy, conflict), financial (that region's economy, trade, business), and notable (the most significant other story). Leave a category out rather than fill it with something trivial.
- Markets: up to 3 stories, at most one each of markets (session moves), economy (central banks, data, policy) and companies (earnings, deals). Do not repeat a story that you used under World.
- Energy, Power & Tech: 2-3 stories each for energy, ai and tech. For energy, favour UK grid, transmission, networks and power-system news, then global oil, gas and renewables.
- Middle East: give Gulf/GCC developments their due weight alongside wider regional news.
- Importance means real-world consequence, and is signalled by how many outlets cover a story. Skip celebrity, lifestyle, sport and opinion pieces.
- Put the ids of every pool item covering the same story into item_ids, from any section. Use only ids that appear in the pool.
- Write summaries in neutral British English, two sentences each. Use only facts in the pool; never invent numbers, quotes or causes. If you are unsure why something moved, leave its note out.
- calendar: list only events the pool says are scheduled for today. An empty list is fine.`;

function poolText(items) {
  const bySection = {};
  for (const it of items) (bySection[it.section] ||= []).push(it);
  return Object.entries(bySection)
    .map(
      ([section, list]) =>
        `## ${section}\n` + list.map((it) => `${it.id} | ${it.source} | ${it.title}${it.desc ? ` — ${it.desc}` : ""}`).join("\n")
    )
    .join("\n\n");
}

function marketText(snapshots, movers) {
  const f = (v) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
  const lines = Object.values(snapshots)
    .flat()
    .filter((a) => !a.error)
    .map((a) => `${a.symbol} ${a.label}: ${a.price.toFixed(2)} (1D ${f(a.d1)}, 1M ${f(a.m1)}, YTD ${f(a.ytd)})`);
  const mv = (label, side) =>
    `${label}: ` + side.map((m) => `${m.ticker} ${m.name} ${f(m.d1)}`).join("; ");
  if (movers) {
    lines.push(mv("S&P 500 gainers", movers.sp500.gainers), mv("S&P 500 losers", movers.sp500.losers));
    lines.push(mv("FTSE 100 gainers", movers.ftse100.gainers), mv("FTSE 100 losers", movers.ftse100.losers));
  }
  return lines.join("\n");
}

export async function curateWithClaude({ items, snapshots, movers, dateLabel }) {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(EditionSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Today is ${dateLabel}.\n\n# Market data (last session)\n${marketText(snapshots, movers)}\n\n# Headline pool\n${poolText(items)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error(`Claude declined: ${response.stop_details?.category}`);
  if (response.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens");
  if (!response.parsed_output) throw new Error("Claude returned output that did not match the schema");
  return { draft: response.parsed_output, usage: response.usage, model: response.model };
}

// No-AI fallback: newest distinct headlines per section, using feed descriptions.
export function curateFallback({ items }) {
  const pick = (section, n, category) =>
    items
      .filter((it) => it.section === section)
      .sort((a, b) => Date.parse(b.published || 0) - Date.parse(a.published || 0))
      .slice(0, n)
      .map((it) => ({ category, headline: it.title, summary: it.desc, item_ids: [it.id] }));
  return {
    draft: {
      headline_of_day: "", // the app shows a banner explaining the fallback
      markets: { summary: "", stories: pick("markets", 3, "markets"), asset_notes: [], mover_notes: [], calendar: [] },
      world: {
        us: pick("us", 3, "notable"),
        uk: pick("uk", 3, "notable"),
        europe: pick("europe", 3, "notable"),
        middle_east: pick("middle_east", 3, "notable"),
      },
      energy_tech: { energy: pick("energy", 3, "energy"), ai: pick("ai", 3, "ai"), tech: pick("tech", 3, "tech") },
    },
  };
}
