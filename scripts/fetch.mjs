// Pulls the last ~30 hours of headlines from the RSS feeds in config/feeds.json.
import fs from "node:fs";
import Parser from "rss-parser";

const UA = "Mozilla/5.0 (compatible; NewsTerminal/1.0; personal morning briefing)";
const parser = new Parser({ timeout: 15000, headers: { "User-Agent": UA } });

const MAX_PER_FEED = 15;
const MAX_AGE_HOURS = 30;
const DESC_CHARS = 220;

function clean(text = "") {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchFeed(section, feed) {
  const parsed = await parser.parseURL(feed.url);
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  return parsed.items
    .filter((it) => it.title && it.link)
    .filter((it) => {
      const t = Date.parse(it.isoDate || it.pubDate || "");
      return Number.isNaN(t) || t >= cutoff; // keep undated items; most feeds date them
    })
    .slice(0, MAX_PER_FEED)
    .map((it) => {
      // Google News titles end in " - Publisher"; split that out as the source.
      let title = clean(it.title);
      let source = feed.source;
      if (feed.url.includes("news.google.com")) {
        const m = title.match(/^(.*) - ([^-]+)$/);
        if (m) [title, source] = [m[1].trim(), m[2].trim()];
      }
      const desc = feed.url.includes("news.google.com") ? "" : clean(it.contentSnippet || it.content || it.summary);
      return {
        section,
        source,
        title,
        desc: desc.slice(0, DESC_CHARS),
        link: it.link,
        published: it.isoDate || it.pubDate || null,
      };
    });
}

export async function fetchAllFeeds(configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const jobs = Object.entries(config).flatMap(([section, feeds]) =>
    feeds.map((feed) =>
      fetchFeed(section, feed).then(
        (items) => ({ feed, section, items }),
        (err) => ({ feed, section, items: [], error: err.message })
      )
    )
  );
  const results = await Promise.all(jobs);

  const seen = new Set();
  const items = [];
  for (const r of results) {
    for (const it of r.items) {
      const key = it.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: `i${items.length}`, ...it });
    }
  }
  const report = results.map((r) => ({
    section: r.section,
    source: r.feed.source,
    count: r.items.length,
    error: r.error || null,
  }));
  return { items, report };
}
