// Market data for the Markets tab: index/commodity snapshots with 1D/1W/1M/YTD
// changes, plus S&P 500 and FTSE 100 top/bottom movers. Prices come from
// Yahoo Finance's public endpoints; constituent lists from Wikipedia; Shariah
// membership from the SPUS ETF's published holdings.
import fs from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NewsTerminal/1.0";

export const ASSETS = {
  indices: [
    { symbol: "^GSPC", label: "S&P 500" },
    { symbol: "SPUS", label: "S&P 500 Shariah", sub: "via SPUS ETF" },
    { symbol: "^IXIC", label: "Nasdaq" },
    { symbol: "^DJI", label: "Dow Jones" },
    { symbol: "^FTSE", label: "FTSE 100" },
    { symbol: "^STOXX50E", label: "Euro Stoxx 50" },
    { symbol: "^TASI.SR", label: "Tadawul (Saudi)" },
  ],
  commodities: [
    { symbol: "GC=F", label: "Gold", unit: "$/oz" },
    { symbol: "SI=F", label: "Silver", unit: "$/oz" },
    { symbol: "BZ=F", label: "Brent crude", unit: "$/bbl" },
    { symbol: "CL=F", label: "WTI crude", unit: "$/bbl" },
    { symbol: "HG=F", label: "Copper", unit: "$/lb" },
    { symbol: "NG=F", label: "US natural gas", unit: "$/MMBtu" },
  ],
  rates_fx: [
    { symbol: "GBPUSD=X", label: "GBP/USD" },
    { symbol: "EURUSD=X", label: "EUR/USD" },
    { symbol: "^TNX", label: "US 10Y yield", unit: "%" },
  ],
};

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);

async function snapshot(asset) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?range=1y&interval=1d`;
  const data = await getJson(url);
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp || [];
  const raw = r?.indicators?.quote?.[0]?.close || [];
  const bars = ts.map((t, i) => ({ t: t * 1000, c: raw[i] })).filter((b) => b.c != null);
  if (bars.length < 2) {
    // Some indices (e.g. Tadawul) only expose the latest bar; show what we can.
    const m = r?.meta || {};
    if (m.regularMarketPrice == null) throw new Error("not enough data");
    return {
      ...asset,
      price: m.regularMarketPrice,
      asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString().slice(0, 10) : null,
      d1: pct(m.regularMarketPrice, m.previousClose ?? m.chartPreviousClose),
      w1: null,
      m1: null,
      ytd: null,
      spark: [],
    };
  }

  const last = bars.at(-1);
  const at = (n) => bars[Math.max(0, bars.length - 1 - n)].c;
  const yearStart = Date.UTC(new Date(last.t).getUTCFullYear(), 0, 1);
  const lastOfPrevYear = [...bars].reverse().find((b) => b.t < yearStart);

  return {
    ...asset,
    price: last.c,
    asOf: new Date(last.t).toISOString().slice(0, 10),
    d1: pct(last.c, at(1)),
    w1: pct(last.c, at(5)),
    m1: pct(last.c, at(21)),
    ytd: lastOfPrevYear ? pct(last.c, lastOfPrevYear.c) : null,
    spark: bars.slice(-22).map((b) => +b.c.toFixed(4)),
  };
}

export async function fetchSnapshots() {
  const out = {};
  for (const [group, assets] of Object.entries(ASSETS)) {
    out[group] = await Promise.all(
      assets.map((a) => snapshot(a).catch((err) => ({ ...a, error: err.message })))
    );
  }
  return out;
}

// --- constituents -----------------------------------------------------------

function tableRows(html, tableId) {
  const start = html.indexOf(`id="${tableId}"`);
  if (start < 0) throw new Error(`table ${tableId} not found`);
  const table = html.slice(start, html.indexOf("</table>", start));
  return table
    .split(/<tr[\s>]/)
    .slice(1)
    .map((row) =>
      [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
        m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#91;.*?&#93;/g, "").trim()
      )
    )
    .filter((cells) => cells.length >= 2);
}

async function scrapeConstituents() {
  const sp = tableRows(
    await getText("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"),
    "constituents"
  ).map(([ticker, name]) => ({ ticker, name, yahoo: ticker.replace(/\./g, "-") }));

  const ftse = tableRows(await getText("https://en.wikipedia.org/wiki/FTSE_100_Index"), "constituents").map(
    ([name, ticker]) => ({ ticker, name, yahoo: `${ticker.replace(/\.$/, "").replace(/\./g, "-")}.L` })
  );

  if (sp.length < 450 || ftse.length < 90) throw new Error(`suspicious counts sp=${sp.length} ftse=${ftse.length}`);
  return { sp500: sp, ftse100: ftse };
}

// Constituents change rarely, so cache them and refresh once a week.
async function loadConstituents(cacheFile) {
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {}
  const weekMs = 7 * 24 * 3600 * 1000;
  if (cached && Date.now() - Date.parse(cached.updated) < weekMs) return cached;
  try {
    const fresh = { updated: new Date().toISOString(), ...(await scrapeConstituents()) };
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(fresh, null, 1));
    return fresh;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function shariahTickers() {
  const csv = await getText("https://www.sp-funds.com/wp-content/uploads/data/TidalFG_Holdings_SPUS.csv");
  return new Set(
    csv
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(",")[2])
      .filter(Boolean)
  );
}

async function dailyMoves(symbols) {
  const moves = new Map();
  for (let i = 0; i < symbols.length; i += 20) {
    const batch = symbols.slice(i, i + 20);
    const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${batch.map(encodeURIComponent).join(",")}&range=5d&interval=1d`;
    try {
      const data = await getJson(url);
      for (const [sym, s] of Object.entries(data)) {
        const closes = (s.close || []).filter((c) => c != null);
        if (closes.length >= 2) moves.set(sym, { price: closes.at(-1), d1: pct(closes.at(-1), closes.at(-2)) });
      }
    } catch {
      // one failed batch shouldn't sink the whole movers list
    }
  }
  return moves;
}

function topBottom(list, moves, n, shariah) {
  const ranked = list
    .filter((c) => moves.has(c.yahoo))
    .map((c) => ({
      ticker: c.ticker,
      name: c.name,
      ...moves.get(c.yahoo),
      ...(shariah ? { shariah: shariah.has(c.ticker) } : {}),
    }))
    .sort((a, b) => b.d1 - a.d1);
  return { gainers: ranked.slice(0, n), losers: ranked.slice(-n).reverse(), coverage: ranked.length };
}

export async function fetchMovers(cacheFile) {
  const constituents = await loadConstituents(cacheFile);
  const shariah = await shariahTickers().catch(() => null);
  const all = [...constituents.sp500, ...constituents.ftse100].map((c) => c.yahoo);
  const moves = await dailyMoves(all);
  return {
    sp500: topBottom(constituents.sp500, moves, 5, shariah),
    ftse100: topBottom(constituents.ftse100, moves, 5, null),
    shariahListAvailable: !!shariah,
  };
}
