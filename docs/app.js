(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

  const state = { index: null, edition: null, tab: "markets" };
  try {
    state.tab = localStorage.getItem("tab") || "markets";
  } catch {}

  // ---------- formatting ----------
  const dir = (v) => (v == null || Number.isNaN(v) ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat");
  const pctText = (v) => (v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
  const fmtPct = (v, cls = "") => `<span class="${dir(v)} ${cls}">${pctText(v)}</span>`;
  const fmtNum = (v, digits) => {
    if (v == null) return "—";
    const d = digits ?? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 2 ? 2 : 4);
    return v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const arrow = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "■");

  function sparkline(values, { w = 96, h = 26, cls = "spark", ref } = {}) {
    if (!values || values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values
      .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
      .join(" ");
    const trend = ref ?? values.at(-1) - values[0];
    const colour = trend >= 0 ? "var(--up)" : "var(--down)";
    return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${colour}" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
  }

  // ---------- building blocks ----------
  const TAGS = {
    political: "POLITICAL", financial: "FINANCIAL", notable: "NOTABLE",
    markets: "MARKETS", economy: "ECONOMY", companies: "COMPANIES",
    energy: "ENERGY", ai: "AI", tech: "TECH",
  };

  function sourcesHtml(sources) {
    const n = sources?.length || 0;
    if (!n) return "";
    const names = [...new Set(sources.map((s) => s.source))];
    const shown = names.slice(0, 3).join(" · ") + (names.length > 3 ? ` +${names.length - 3}` : "");
    return `<details><summary><b>${n} source${n === 1 ? "" : "s"}</b><span>${esc(shown)}</span></summary><ul>${sources
      .map((src) => `<li><span class="src">${esc(src.source)}</span><a href="${esc(safeUrl(src.link))}" target="_blank" rel="noopener">${esc(src.title)}</a></li>`)
      .join("")}</ul></details>`;
  }

  function storyHtml(s) {
    return `<article class="story">
      <span class="tag ${esc(s.category)}">${TAGS[s.category] || esc(s.category).toUpperCase()}</span>
      <h3>${esc(s.headline)}</h3>
      ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
      ${sourcesHtml(s.sources)}
    </article>`;
  }

  const sourceCount = (stories) => (stories || []).reduce((n, s) => n + (s.sources?.length || 0), 0);
  const plural = (n, word) => `${n} ${n === 1 ? word : word === "story" ? "stories" : word + "s"}`;

  function panel(title, body, { meta = "", cls = "", ruled = false, foot = "" } = {}) {
    return `<section class="panel ${cls}">
      <h2 class="panel-head${ruled ? " ruled" : ""}"><span>${title}</span>${meta ? `<span class="dim">${meta}</span>` : ""}</h2>
      ${body}
      ${foot ? `<div class="panel-foot">${foot}</div>` : ""}
    </section>`;
  }

  function storiesPanel(title, stories, opts = {}) {
    const body = stories?.length
      ? `<div class="panel-body">${stories.map(storyHtml).join("")}</div>`
      : `<div class="panel-body"><div class="empty">Nothing significant this morning.</div></div>`;
    const meta = stories?.length ? `${plural(stories.length, "story")} · ${plural(sourceCount(stories), "source")}` : "";
    return panel(title, body, { ruled: true, meta, ...opts });
  }

  function notesFoot(assets) {
    return (assets || [])
      .filter((a) => a.note && !a.error)
      .map((a) => `<div><b>${esc(a.label)}</b> — ${esc(a.note)}</div>`)
      .join("");
  }

  function assetTable(assets, { cols = ["w1", "ytd", "spark"] } = {}) {
    const showW1 = cols.includes("w1");
    const rows = (assets || [])
      .map((a) => {
        if (a.error) return `<tr><td><span class="name">${esc(a.label)}</span></td><td colspan="6" class="dim">unavailable</td></tr>`;
        const sub = [a.unit, a.sub].filter(Boolean).join(" · ");
        return `<tr>
          <td><span class="name">${esc(a.label)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</td>
          <td>${fmtNum(a.price)}</td>
          <td>${fmtPct(a.d1, "d1")}</td>
          ${showW1 ? `<td class="hide-sm">${fmtPct(a.w1)}</td>` : ""}
          <td>${fmtPct(a.m1)}</td>
          <td class="hide-sm">${fmtPct(a.ytd)}</td>
          <td class="hide-sm">${sparkline(a.spark, { ref: a.m1 ?? undefined })}</td>
        </tr>`;
      })
      .join("");
    return `<div class="scroll-x"><table class="mkt"><thead><tr><th>NAME</th><th>LAST</th><th>1D</th>${
      showW1 ? '<th class="hide-sm">1W</th>' : ""
    }<th>1M</th><th class="hide-sm">YTD</th><th class="hide-sm">1M CHART</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function tilesHtml(e) {
    const want = ["^GSPC", "SPUS", "^IXIC", "^FTSE"];
    const all = e.markets.indices || [];
    const tiles = want
      .map((sym) => all.find((a) => a.symbol === sym && !a.error))
      .filter(Boolean)
      .map(
        (a) => `<div class="tile">
          <div class="tile-top"><span class="tile-name">${esc(a.label)}</span><span class="tile-ytd">YTD ${fmtPct(a.ytd)}</span></div>
          <div class="tile-px"><span class="px">${fmtNum(a.price)}</span><span class="chg ${dir(a.d1)}">${arrow(a.d1)} ${pctText(a.d1)}</span></div>
          ${sparkline(a.spark, { cls: "", ref: a.d1 })}
          <div class="tile-foot">1 MONTH${a.sub ? ` · ${esc(a.sub).toUpperCase()}` : ""}</div>
        </div>`
      )
      .join("");
    return tiles ? `<section class="tiles span-2" aria-label="Key indices">${tiles}</section>` : "";
  }

  function moverList(list, max, { pence = false } = {}) {
    if (!list?.length) return '<div class="empty">—</div>';
    return list
      .map((m) => {
        const w = Math.max(4, Math.round((Math.abs(m.d1 || 0) / max) * 100));
        const price = m.price == null ? "" : pence ? `${fmtNum(m.price, m.price >= 100 ? 0 : 1)}p` : `$${fmtNum(m.price, 2)}`;
        return `<div class="mover">
          <div class="mover-row"><span class="t">${esc(m.ticker)}${
            m.shariah ? '<span class="shariah" title="In the S&amp;P 500 Shariah (SPUS holdings)">☪</span>' : ""
          }</span><span class="d ${dir(m.d1)}">${pctText(m.d1)}</span></div>
          <div class="mover-sub"><span>${esc(m.name)}</span><span>${price}</span></div>
          <div class="bar"><i class="${dir(m.d1)}" style="width:${w}%"></i></div>
          ${m.note ? `<div class="mover-note">${esc(m.note)}</div>` : ""}
        </div>`;
      })
      .join("");
  }

  function moversPanel(title, idx, opts = {}) {
    if (!idx) return panel(title, '<div class="panel-body"><div class="empty">Movers unavailable this morning.</div></div>', { ruled: true });
    const max = Math.max(1, ...[...(idx.gainers || []), ...(idx.losers || [])].map((m) => Math.abs(m.d1 || 0)));
    const meta = [opts.legend ? "☪ Shariah-compliant" : "", idx.coverage ? `${idx.coverage} stocks` : "", opts.pence ? "pence" : ""]
      .filter(Boolean)
      .join(" · ");
    return panel(
      title,
      `<div class="movers">
        <div><h4>TOP GAINERS</h4>${moverList(idx.gainers, max, opts)}</div>
        <div><h4>TOP LOSERS</h4>${moverList(idx.losers, max, opts)}</div>
      </div>`,
      { ruled: true, meta }
    );
  }

  function calendarHtml(cal) {
    if (!cal?.length) return '<div class="panel-body"><div class="empty">No scheduled events flagged in this morning\'s coverage.</div></div>';
    return `<ul class="cal">${cal
      .map((c) => {
        const m = /^(\w{3})\w*\s+(\d{1,2})\b/.exec(c.when || "");
        const date = m
          ? `<div class="cal-date"><small>${esc(m[1].toUpperCase())}</small><strong>${esc(m[2])}</strong></div>`
          : `<div class="cal-date text">${esc(c.when)}</div>`;
        return `<li>${date}<div class="cal-event">${esc(c.event)}</div></li>`;
      })
      .join("")}</ul>`;
  }

  function storySection(title, stories) {
    if (!stories?.length) return "";
    return `<section class="span-2">
      <div class="section-head"><h2>${title}</h2><span>${plural(stories.length, "story")} · ${plural(sourceCount(stories), "source")}</span></div>
      <div class="story-grid">${stories.map(storyHtml).join("")}</div>
    </section>`;
  }

  // ---------- tabs ----------
  function renderMarkets(e) {
    const m = e.markets;
    return [
      tilesHtml(e),
      panel("INDICES", assetTable(m.indices), { meta: "prev. close", foot: notesFoot(m.indices) }),
      panel("COMMODITIES", assetTable(m.commodities), { meta: "front month", foot: notesFoot(m.commodities) }),
      moversPanel("S&amp;P 500 MOVERS", m.movers?.sp500, { legend: true }),
      moversPanel("FTSE 100 MOVERS", m.movers?.ftse100, { pence: true }),
      panel("RATES &amp; FX", assetTable(m.rates_fx, { cols: ["ytd", "spark"] }), { foot: notesFoot(m.rates_fx) }),
      panel("ON THE CALENDAR", calendarHtml(m.calendar), { ruled: true }),
      storySection("MARKET STORIES", m.stories),
    ].join("");
  }

  const LEGEND = `<div class="legend span-2" aria-hidden="true">
    <span><i style="background:var(--pol)"></i>POLITICAL</span>
    <span><i style="background:var(--fin)"></i>FINANCIAL</span>
    <span><i style="background:var(--note)"></i>NOTABLE</span>
  </div>`;

  function renderWorld(e) {
    return [
      LEGEND,
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
    const short = {
      "^GSPC": "SPX", SPUS: "SHARIAH (SPUS)", "^IXIC": "NDX", "^DJI": "DOW", "^FTSE": "FTSE", "^STOXX50E": "STOXX50",
      "^TASI.SR": "TADAWUL", "GC=F": "GOLD", "SI=F": "SILVER", "BZ=F": "BRENT", "CL=F": "WTI", "HG=F": "COPPER",
      "NG=F": "NATGAS", "GBPUSD=X": "GBPUSD", "EURUSD=X": "EURUSD", "^TNX": "US10Y",
    };
    const all = [...(e.markets.indices || []), ...(e.markets.commodities || []), ...(e.markets.rates_fx || [])];
    const items = Object.keys(short)
      .map((sym) => all.find((a) => a.symbol === sym && !a.error))
      .filter(Boolean)
      .map((a) => `<span class="tick"><b>${short[a.symbol]}</b>${fmtNum(a.price)} ${fmtPct(a.d1)}</span>`)
      .join("");
    // Two identical copies so the scroll can loop seamlessly (animation moves by -50%).
    $("#ticker").innerHTML = items ? `${items}<span class="ticker-copy" aria-hidden="true">${items}</span>` : "";
  }

  const count = (lists) => lists.reduce((n, l) => n + (l?.length || 0), 0);

  function render() {
    const e = state.edition;
    if (!e) return;
    $("#date-label").textContent = e.dateLabel;
    const t = new Date(e.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
    $("#edition-info").textContent = `Edition ${t} UK${e.mode === "ai" ? "" : " · unranked"}`;
    $("#status").innerHTML = e.stats ? `<span>${e.stats.headlines} headlines · ${e.stats.feeds} feeds</span>` : "";

    const banner = $("#banner");
    banner.hidden = e.mode === "ai";
    banner.textContent = e.mode === "ai" ? "" : `AI curation unavailable (${e.error || "unknown error"}) — showing latest headlines unranked.`;

    // Highlight figures like $1tn, £3.2bn, 2.4%, $118 in the headline.
    $("#hod").innerHTML = esc(e.headlineOfDay || "").replace(
      /[$£€]?\d[\d,.]*(?:\s?(?:tn|bn|m|bps|%))?/g,
      (fig) => (/[$£€%]|tn|bn|bps|\d[,.]\d/.test(fig) ? `<span class="fig">${fig}</span>` : fig)
    );
    $(".lead-hod").hidden = !e.headlineOfDay;
    const m = e.markets;
    const asOf = m.indices?.find((a) => a.asOf)?.asOf;
    const asOfLabel = asOf ? new Date(`${asOf}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase() : "";
    const session = $("#session");
    session.hidden = !m.summary;
    session.innerHTML = m.summary
      ? `<h2 class="panel-head" style="padding:0 0 10px"><span>THE SESSION</span>${asOfLabel ? `<span class="dim">CLOSE ${esc(asOfLabel)}</span>` : ""}</h2><p>${esc(m.summary)}</p>`
      : "";
    $(".lead").classList.toggle("solo", !m.summary || !e.headlineOfDay);
    renderTicker(e);

    const counts = {
      markets: "",
      world: count(Object.values(e.world || {})),
      energyTech: count(Object.values(e.energyTech || {})),
    };
    $$(".tabs button").forEach((b) => {
      b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
      b.querySelector(".count").textContent = counts[b.dataset.tab] || "";
    });
    $$(".bottombar button").forEach((b) => {
      if (b.dataset.tab === state.tab) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

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

  function step(d) {
    const dates = state.index.dates;
    const i = dates.indexOf(state.edition.date) + d; // dates are newest first
    if (i >= 0 && i < dates.length) loadEdition(dates[i]);
  }

  function setTab(tab) {
    state.tab = tab;
    try {
      localStorage.setItem("tab", tab);
    } catch {}
    render();
    const tabs = $(".tabs");
    const top = tabs && tabs.offsetParent ? tabs.getBoundingClientRect().top + window.scrollY - 8 : 0;
    if (window.scrollY > top) window.scrollTo(0, top);
  }

  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $("#prev").addEventListener("click", () => step(1));
  $("#next").addEventListener("click", () => step(-1));
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target.closest?.("input, textarea, select")) return;
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
      $("#content").innerHTML = `<div class="empty span-2">Couldn't load today's edition (${esc(err.message)}).</div>`;
    }
  })();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
