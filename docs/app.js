(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

  const state = { index: null, edition: null, tab: "markets" };
  try {
    state.tab = localStorage.getItem("tab") || "markets";
  } catch {}

  // ---------- formatting ----------
  const fmtPct = (v) => {
    if (v == null || Number.isNaN(v)) return '<span class="dim">—</span>';
    const cls = v > 0 ? "up" : v < 0 ? "down" : "dim";
    return `<span class="${cls}">${v > 0 ? "+" : ""}${v.toFixed(2)}%</span>`;
  };
  const fmtNum = (v, digits) => {
    if (v == null) return "—";
    const d = digits ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 2 ? 2 : 4);
    return v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  function sparkline(values, w = 80, h = 22) {
    if (!values || values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values
      .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
      .join(" ");
    const colour = values.at(-1) >= values[0] ? "var(--up)" : "var(--down)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${colour}" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  // ---------- rendering ----------
  const TAGS = {
    political: "POL", financial: "FIN", notable: "NOTE",
    markets: "MKT", economy: "ECON", companies: "CORP",
    energy: "NRG", ai: "AI", tech: "TECH",
  };

  function storyHtml(s) {
    const n = s.sources?.length || 0;
    const sources = n
      ? `<details><summary>${n} source${n === 1 ? "" : "s"}</summary><ul>${s.sources
          .map((src) => `<li><span class="src">${esc(src.source)}</span> · <a href="${esc(safeUrl(src.link))}" target="_blank" rel="noopener">${esc(src.title)}</a></li>`)
          .join("")}</ul></details>`
      : "";
    return `<article class="story">
      <span class="tag ${esc(s.category)}">${TAGS[s.category] || esc(s.category).toUpperCase()}</span><h3>${esc(s.headline)}</h3>
      ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
      ${sources}
    </article>`;
  }

  function panel(title, body, { extra = "", cls = "" } = {}) {
    return `<section class="panel ${cls}"><h2><span>${title}</span>${extra}</h2>${body}</section>`;
  }

  function storiesPanel(title, stories, opts) {
    const body = stories?.length
      ? `<div class="panel-body">${stories.map(storyHtml).join("")}</div>`
      : `<div class="panel-body"><div class="empty">Nothing significant this morning.</div></div>`;
    return panel(title, body, opts);
  }

  function assetTable(assets) {
    const rows = (assets || [])
      .map((a) => {
        if (a.error) return `<tr><td class="name">${esc(a.label)}</td><td colspan="6" class="dim">unavailable</td></tr>`;
        const sub = [a.unit, a.sub].filter(Boolean).join(" · ");
        const main = `<tr>
          <td><span class="name">${esc(a.label)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</td>
          <td>${fmtNum(a.price)}</td>
          <td>${fmtPct(a.d1)}</td>
          <td class="hide-sm">${fmtPct(a.w1)}</td>
          <td>${fmtPct(a.m1)}</td>
          <td class="hide-sm">${fmtPct(a.ytd)}</td>
          <td class="hide-sm">${sparkline(a.spark)}</td>
        </tr>`;
        return main + (a.note ? `<tr class="note"><td colspan="7">↳ ${esc(a.note)}</td></tr>` : "");
      })
      .join("");
    return `<table class="mkt assets"><thead><tr><th></th><th>LAST</th><th>1D</th><th class="hide-sm">1W</th><th>1M</th><th class="hide-sm">YTD</th><th class="hide-sm">1M CHART</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function moverTable(list, { pence = false } = {}) {
    if (!list?.length) return '<div class="empty">—</div>';
    return `<table class="mkt"><tbody>${list
      .map(
        (m) => `<tr>
          <td><span class="name">${esc(m.ticker)}</span>${m.shariah ? '<span class="shariah" title="In the S&P 500 Shariah (SPUS holdings)">☪</span>' : ""}<span class="sub">${esc(m.name)}</span></td>
          <td>${pence ? `${fmtNum(m.price, m.price >= 100 ? 0 : 1)}p` : fmtNum(m.price, 2)}</td>
          <td>${fmtPct(m.d1)}</td>
        </tr>${m.note ? `<tr class="note"><td colspan="3">↳ ${esc(m.note)}</td></tr>` : ""}`
      )
      .join("")}</tbody></table>`;
  }

  function moversPanel(title, idx, opts) {
    if (!idx) return panel(title, '<div class="panel-body"><div class="empty">Movers unavailable this morning.</div></div>');
    return panel(
      title,
      `<div class="panel-body movers">
        <div><h4>TOP GAINERS</h4>${moverTable(idx.gainers, opts)}</div>
        <div><h4>TOP LOSERS</h4>${moverTable(idx.losers, opts)}</div>
      </div>`,
      { extra: opts?.legend ? '<span class="dim">☪ = Shariah-compliant</span>' : "" }
    );
  }

  function renderMarkets(e) {
    const m = e.markets;
    const asOf = m.indices?.find((a) => a.asOf)?.asOf;
    const cal = m.calendar?.length
      ? `<ul class="cal panel-body">${m.calendar.map((c) => `<li><b>${esc(c.when)}</b>${esc(c.event)}</li>`).join("")}</ul>`
      : '<div class="panel-body"><div class="empty">No scheduled events flagged in this morning\'s coverage.</div></div>';
    return [
      m.summary ? panel("SESSION", `<p class="summary-text">${esc(m.summary)}</p>`, { cls: "span-2", extra: asOf ? `<span class="dim">close ${esc(asOf)}</span>` : "" }) : "",
      panel("INDICES", assetTable(m.indices), { cls: "span-2" }),
      panel("COMMODITIES", assetTable(m.commodities), { cls: "span-2" }),
      moversPanel("S&amp;P 500 MOVERS", m.movers?.sp500, { legend: true }),
      moversPanel("FTSE 100 MOVERS", m.movers?.ftse100, { pence: true }),
      panel("RATES &amp; FX", assetTable(m.rates_fx)),
      panel("TODAY", cal),
      storiesPanel("MARKET STORIES", m.stories, { cls: "span-2" }),
    ].join("");
  }

  function renderWorld(e) {
    return [
      storiesPanel("UNITED STATES", e.world.us),
      storiesPanel("UNITED KINGDOM", e.world.uk),
      storiesPanel("EUROPE", e.world.europe),
      storiesPanel("MIDDLE EAST", e.world.middle_east),
    ].join("");
  }

  function renderEnergyTech(e) {
    return [
      storiesPanel("ENERGY &amp; POWER", e.energyTech.energy, { cls: "span-2" }),
      storiesPanel("AI", e.energyTech.ai),
      storiesPanel("TECH", e.energyTech.tech),
    ].join("");
  }

  function renderTicker(e) {
    const pick = ["^GSPC", "SPUS", "^FTSE", "^IXIC", "BZ=F", "GC=F", "SI=F", "HG=F", "GBPUSD=X"];
    const short = { "^GSPC": "SPX", SPUS: "SHARIAH", "^FTSE": "FTSE", "^IXIC": "NDX", "BZ=F": "BRENT", "GC=F": "GOLD", "SI=F": "SILVER", "HG=F": "COPPER", "GBPUSD=X": "GBPUSD" };
    const all = [...(e.markets.indices || []), ...(e.markets.commodities || []), ...(e.markets.rates_fx || [])];
    $("#ticker").innerHTML = pick
      .map((sym) => all.find((a) => a.symbol === sym && !a.error))
      .filter(Boolean)
      .map((a) => `<span class="tick"><b>${short[a.symbol]}</b>${fmtNum(a.price)} ${fmtPct(a.d1)}</span>`)
      .join("");
  }

  function render() {
    const e = state.edition;
    if (!e) return;
    $("#date-label").textContent = e.dateLabel;
    const t = new Date(e.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    $("#edition-info").textContent = `Edition ${t} UK${e.mode === "ai" ? "" : " · unranked"}`;
    const banner = $("#banner");
    banner.hidden = e.mode === "ai";
    banner.textContent = e.mode === "ai" ? "" : `AI curation unavailable (${e.error || "unknown error"}) — showing latest headlines unranked.`;
    $("#hod").textContent = e.headlineOfDay || "";
    renderTicker(e);

    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    const renderers = { markets: renderMarkets, world: renderWorld, energyTech: renderEnergyTech };
    $("#content").innerHTML = (renderers[state.tab] || renderMarkets)(e);

    const i = state.index.dates.indexOf(e.date);
    $("#prev").disabled = i < 0 || i >= state.index.dates.length - 1;
    $("#next").disabled = i <= 0;
    $("#footer").textContent = `${e.stats.headlines} headlines scanned from ${e.stats.feeds} feeds${e.model ? ` · curated by ${e.model}` : ""} · market data delayed, previous close`;
  }

  // ---------- data ----------
  async function getJson(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  async function loadEdition(date) {
    state.edition = await getJson(`editions/${date}.json`);
    history.replaceState(null, "", date === state.index.latest ? location.pathname : `#${date}`);
    render();
  }

  function step(dir) {
    const dates = state.index.dates;
    const i = dates.indexOf(state.edition.date) + dir; // dates are newest first
    if (i >= 0 && i < dates.length) loadEdition(dates[i]);
  }

  function setTab(tab) {
    state.tab = tab;
    try {
      localStorage.setItem("tab", tab);
    } catch {}
    render();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#prev").addEventListener("click", () => step(1));
  $("#next").addEventListener("click", () => step(-1));
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "1") setTab("markets");
    else if (ev.key === "2") setTab("world");
    else if (ev.key === "3") setTab("energyTech");
    else if (ev.key === "ArrowLeft") step(1);
    else if (ev.key === "ArrowRight") step(-1);
  });

  (async () => {
    try {
      state.index = await getJson("editions/index.json");
      const wanted = location.hash.slice(1);
      await loadEdition(state.index.dates.includes(wanted) ? wanted : state.index.latest);
    } catch (err) {
      $("#date-label").textContent = "No edition available";
      $("#content").innerHTML = `<div class="empty">Couldn't load today's edition (${esc(err.message)}).</div>`;
    }
  })();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
