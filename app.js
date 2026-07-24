const CATEGORY_META = {
  "強力關注": { emoji: "🔥", cls: "cat-strong" },
  "價量齊揚": { emoji: "📈", cls: "cat-steady" },
  "訊號矛盾": { emoji: "⚠️", cls: "cat-warning" },
  "出貨嫌疑": { emoji: "🌊", cls: "cat-caution" },
};
const CATEGORY_ORDER = ["強力關注", "價量齊揚", "訊號矛盾", "出貨嫌疑"];
const CAT_EMOJI = { "強力關注": "🔥", "價量齊揚": "📈", "訊號矛盾": "⚠️", "出貨嫌疑": "🌊" };
const HORIZON_ORDER = ["1日", "3日", "5日"];

const state = { index: [] };

const el = {
  stateMessage: document.getElementById("state-message"),
  dateSelect: document.getElementById("date-select"),
  tickerTrack: document.getElementById("ticker-track"),
  metaRow: document.getElementById("meta-row"),
  metaGenerated: document.getElementById("meta-generated"),
  panelWatchlist: document.getElementById("panel-watchlist"),
  watchlistGrid: document.getElementById("watchlist-grid"),
  panelGainers: document.getElementById("panel-gainers"),
  tableGainers: document.getElementById("table-gainers"),
  panelInstitution: document.getElementById("panel-institution"),
  tableInstitution: document.getElementById("table-institution"),
  panelWeekly: document.getElementById("panel-weekly"),
  tableWeekly: document.getElementById("table-weekly"),
  panelBacktest: document.getElementById("panel-backtest"),
  tableBacktest: document.getElementById("table-backtest"),
};

function newsLink(code) {
  return `https://tw.stock.yahoo.com/quote/${code}.TW/news`;
}

function fmtPct(pct) {
  if (pct === null || pct === undefined) return "-";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function pctClass(pct) {
  if (pct === null || pct === undefined) return "";
  return pct > 0 ? "pct-up" : pct < 0 ? "pct-down" : "";
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`無法讀取 ${path} (${res.status})`);
  return res.json();
}

function buildDateOptions() {
  el.dateSelect.innerHTML = "";
  state.index.forEach((entry) => {
    const opt = document.createElement("option");
    opt.value = entry.date;
    opt.textContent = entry.date;
    el.dateSelect.appendChild(opt);
  });
}

function renderTicker(day) {
  const s = day.summary || {};
  const items = [
    `🎯 關注 <b>${s.watchlist ?? 0}</b>`,
    `📈 漲幅榜 <b>${s.gainers ?? 0}</b>`,
    `💰 法人買超 <b>${s.institution ?? 0}</b>`,
    `🔥 本週熱門 <b>${s.weekly ?? 0}</b>`,
  ];
  const html = items.map((t) => `<span>${t}</span>`).join("");
  el.tickerTrack.innerHTML = html + html;
}

function renderWatchlist(day) {
  el.watchlistGrid.innerHTML = "";
  const grouped = {};
  CATEGORY_ORDER.forEach((c) => (grouped[c] = []));
  (day.watchlist || []).forEach((item) => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  CATEGORY_ORDER.forEach((cat) => {
    const meta = CATEGORY_META[cat];
    const items = grouped[cat] || [];
    const card = document.createElement("div");
    card.className = `cat-card ${meta.cls}`;

    const title = document.createElement("div");
    title.className = "cat-title";
    title.innerHTML = `<span>${meta.emoji} ${cat}</span><span class="cat-count">${items.length} 檔</span>`;
    card.appendChild(title);

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "無符合條件的股票";
      card.appendChild(empty);
    } else {
      items
        .sort((a, b) => (b.volume_ratio || 0) - (a.volume_ratio || 0))
        .forEach((item) => {
          const row = document.createElement("a");
          row.className = "stock-row";
          row.href = newsLink(item.code);
          row.target = "_blank";
          row.rel = "noopener noreferrer";
          row.innerHTML = `
            <span><span class="stock-id">${item.code}</span>${item.name}</span>
            <span class="stock-pct ${pctClass(item.pct)}">${fmtPct(item.pct)} · ${(item.volume_ratio || 0).toFixed(1)}x</span>
          `;
          card.appendChild(row);
        });
    }
    el.watchlistGrid.appendChild(card);
  });
}

function renderTable(tableEl, headers, rows) {
  tableEl.innerHTML = "";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  tableEl.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((cells) => {
    const tr = document.createElement("tr");
    cells.forEach((cell) => {
      const td = document.createElement("td");
      if (cell && cell.className) td.className = cell.className;
      if (cell && cell.html !== undefined) {
        td.innerHTML = cell.html;
      } else {
        td.textContent = cell === null || cell === undefined ? "-" : cell;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tableEl.appendChild(tbody);
}

function renderGainers(day) {
  const rows = (day.gainers || []).map((item) => [
    item.code,
    { className: "name-cell", html: item.name },
    item.close?.toFixed ? item.close.toFixed(2) : item.close,
    { className: pctClass(item.pct), html: fmtPct(item.pct) },
    { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">新聞</a>` },
  ]);
  renderTable(el.tableGainers, ["代號", "名稱", "收盤價", "漲幅", "連結"], rows);
}

function renderInstitution(day) {
  const rows = (day.institution || []).map((item) => [
    item.code,
    { className: "name-cell", html: item.name },
    (item.net_buy / 1000).toFixed(0) + " 張",
    { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">新聞</a>` },
  ]);
  renderTable(el.tableInstitution, ["代號", "名稱", "買超", "連結"], rows);
}

function renderWeekly(day) {
  const rows = (day.weekly || []).map((item) => [
    item.code,
    { className: "name-cell", html: item.name },
    `${item.count} 次`,
    { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">新聞</a>` },
  ]);
  renderTable(el.tableWeekly, ["代號", "名稱", "上榜次數", "連結"], rows);
}

function renderBacktest(day) {
  const backtest = day.backtest || {};
  const rows = [];
  Object.keys(CAT_EMOJI).forEach((cat) => {
    const byHorizon = backtest[cat] || {};
    HORIZON_ORDER.forEach((horizon) => {
      const stat = byHorizon[horizon] || {};
      const avg = stat["平均報酬%"];
      const win = stat["勝率%"];
      const n = stat["樣本數"] || 0;
      rows.push([
        `${CAT_EMOJI[cat]} ${cat}`,
        horizon,
        n === 0
          ? { className: "", html: '<span class="empty-note">尚無樣本</span>' }
          : { className: pctClass(avg), html: fmtPct(avg) },
        n === 0 ? "-" : `${win.toFixed(1)}%`,
        n,
      ]);
    });
  });
  renderTable(el.tableBacktest, ["分類", "天數後", "平均報酬", "勝率", "樣本數"], rows);
}

function showPanels() {
  el.metaRow.hidden = false;
  el.panelWatchlist.hidden = false;
  el.panelGainers.hidden = false;
  el.panelInstitution.hidden = false;
  el.panelWeekly.hidden = false;
  el.panelBacktest.hidden = false;
  el.stateMessage.hidden = true;
}

async function loadDay(dateStr) {
  try {
    const day = await fetchJSON(`history/${dateStr}.json`);
    el.metaGenerated.textContent = `資料產生時間：${day.generated_at || "-"}`;
    renderTicker(day);
    renderWatchlist(day);
    renderGainers(day);
    renderInstitution(day);
    renderWeekly(day);
    renderBacktest(day);
    showPanels();
  } catch (err) {
    el.stateMessage.hidden = false;
    el.stateMessage.textContent = `讀取 ${dateStr} 的資料時發生錯誤：${err.message}`;
  }
}

async function searchSupportLevel() {
  const input = document.getElementById("support-input");
  const resultBox = document.getElementById("support-result");
  const query = input.value.trim();

  if (!query) {
    resultBox.innerHTML = '<p class="empty-note">請輸入股票代號或公司名稱</p>';
    return;
  }

  resultBox.innerHTML = '<p class="empty-note">查詢中…</p>';

  try {
    const allData = await fetchJSON("support_levels.json");

    let matches = [];
    if (allData[query]) {
      matches = [[query, allData[query]]];
    } else {
      matches = Object.entries(allData).filter(
        ([, info]) => info.name && info.name.includes(query)
      );
    }

    if (matches.length === 0) {
      resultBox.innerHTML = `<p class="empty-note">找不到「${query}」相關的資料（可能是ETF、非個股，或名稱/代號輸入有誤）</p>`;
      return;
    }

    resultBox.innerHTML = matches.map(([code, info]) => renderSupportCard(code, info)).join("");
  } catch (err) {
    resultBox.innerHTML = `<p class="empty-note">查詢失敗：${err.message}</p>`;
  }
}

function renderSupportCard(code, info) {
  const ma20 = info.ma20 !== null && info.ma20 !== undefined ? info.ma20 : null;
  const bbLower = info.bb_lower !== null && info.bb_lower !== undefined ? info.bb_lower : null;
  const distMa = info.dist_to_ma_pct !== null && info.dist_to_ma_pct !== undefined ? info.dist_to_ma_pct : null;
  const name = info.name || "";

  let bodyHtml = `<div class="code-title">${code} ${name} · 目前價格 ${info.current}</div>`;

  if (ma20 === null) {
    bodyHtml += `<p class="empty-note">資料累積中（目前${info.data_days}天），需滿20個交易日才能算出均線與布林通道</p>`;
  } else {
    bodyHtml += `
      <div>20日均線：${ma20}　（距目前價格 ${fmtPct(distMa)}）</div>
      <div>布林下軌：${bbLower}</div>
    `;
  }

  return `<div class="support-card">${bodyHtml}</div>`;
}

document.getElementById("support-search-btn").addEventListener("click", searchSupportLevel);
document.getElementById("support-input").addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchSupportLevel();
});

async function init() {
  try {
    state.index = await fetchJSON("history/index.json");
    if (!state.index.length) {
      el.stateMessage.textContent = "目前還沒有任何歷史資料，明天執行後就會出現。";
      return;
    }
    buildDateOptions();
    el.dateSelect.addEventListener("change", (e) => loadDay(e.target.value));
    await loadDay(state.index[0].date);
  } catch (err) {
    el.stateMessage.textContent = `無法讀取索引資料：${err.message}`;
  }
}

init();
