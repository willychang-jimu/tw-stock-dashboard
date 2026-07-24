const CATEGORY_META = {
  "強力關注": { emoji: "🔥", cls: "cat-strong" },
  "價量齊揚": { emoji: "📈", cls: "cat-steady" },
  "訊號矛盾": { emoji: "⚠️", cls: "cat-warning" },
  "出貨嫌疑": { emoji: "🌊", cls: "cat-caution" },
};
const CATEGORY_ORDER = ["強力關注", "價量齊揚", "訊號矛盾", "出貨嫌疑"];
const CAT_EMOJI = { "強力關注": "🔥", "價量齊揚": "📈", "訊號矛盾": "⚠️", "出貨嫌疑": "🌊" };
const HORIZON_ORDER = ["1日", "3日", "5日"];

const GH_OWNER = "willychang-jimu";
const GH_REPO = "tw-stock-dashboard";
const WATCHLIST_PATH = "watchlist.json";
const TOKEN_STORAGE_KEY = "tw_stock_watchlist_pat";

const state = { index: [], watchlistCodes: new Set(), currentDay: null };

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
  panelSignals: document.getElementById("panel-signals"),
  tableSignalBuy: document.getElementById("table-signal-buy"),
  tableSignalSell: document.getElementById("table-signal-sell"),
  panelBacktest: document.getElementById("panel-backtest"),
  tableBacktest: document.getElementById("table-backtest"),
};

function abbreviateReason(reason) {
  const rules = [
    [/^RSI(\d+)超賣$/, (m) => `RSI↓${m[1]}`],
    [/^RSI(\d+)偏弱$/, (m) => `RSI${m[1]}`],
    [/^RSI(\d+)偏強$/, (m) => `RSI${m[1]}`],
    [/^RSI(\d+)超買$/, (m) => `RSI↑${m[1]}`],
    [/^觸及布林下軌\(支撐\)$/, () => `布林↓`],
    [/^觸及布林上軌\(壓力\)$/, () => `布林↑`],
    [/^MACD黃金交叉$/, () => `MACD↗`],
    [/^MACD死亡交叉$/, () => `MACD↘`],
    [/^放量上漲$/, () => `量↑漲`],
    [/^放量下跌\(出貨疑慮\)$/, () => `量↓跌`],
    [/^法人買超$/, () => `法人↑`],
    [/^法人賣超$/, () => `法人↓`],
    [/^營收年增(\d+)%$/, (m) => `營收↑${m[1]}%`],
    [/^營收年減(\d+)%$/, (m) => `營收↓${m[1]}%`],
  ];
  for (const [regex, fn] of rules) {
    const m = reason.match(regex);
    if (m) return fn(m);
  }
  return reason;
}

function scoreEmoji(score) {
  if (score >= 4) return "🟢";
  if (score >= 2) return "🟡";
  if (score <= -4) return "🔴";
  if (score <= -2) return "🟠";
  return "⚪";
}

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
      const sorted = prioritize(
        [...items].sort((a, b) => (b.volume_ratio || 0) - (a.volume_ratio || 0)),
        (x) => x.code
      );
      sorted.forEach((item) => {
          const row = document.createElement("a");
          row.className = "stock-row";
          row.href = newsLink(item.code);
          row.target = "_blank";
          row.rel = "noopener noreferrer";
          const sigBadge = item.signal_score !== null && item.signal_score !== undefined
            ? `<span class="signal-badge" title="${item.conflict_reason || ""}">${scoreEmoji(item.signal_score)}${item.signal_score > 0 ? "+" : ""}${item.signal_score}${item.conflict ? " ⚠️" : ""}</span>`
            : "";
          row.innerHTML = `
            <span>${starHtml(item.code)} <span class="stock-id">${item.code}</span>${item.name}${sigBadge}</span>
            <span class="stock-pct ${pctClass(item.pct)}">${fmtPct(item.pct)} · ${(item.volume_ratio || 0).toFixed(1)}x</span>
          `;
          if (item.conflict) row.title = item.conflict_reason || "";
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
  const items = prioritize(day.gainers || [], (x) => x.code);
  const rows = items.map((item) => [
    { className: "star-cell", html: starHtml(item.code) },
    item.code,
    { className: "name-cell", html: item.name },
    item.close?.toFixed ? item.close.toFixed(2) : item.close,
    { className: pctClass(item.pct), html: fmtPct(item.pct) },
    { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">新聞</a>` },
  ]);
  renderTable(el.tableGainers, ["★", "代號", "名稱", "收盤價", "漲幅", "連結"], rows);
}

function renderInstitution(day) {
  const items = prioritize(day.institution || [], (x) => x.code);
  const rows = items.map((item) => [
    { className: "star-cell", html: starHtml(item.code) },
    item.code,
    { className: "name-cell", html: item.name },
    (item.net_buy / 1000).toFixed(0) + " 張",
    { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">新聞</a>` },
  ]);
  renderTable(el.tableInstitution, ["★", "代號", "名稱", "買超", "連結"], rows);
}

function renderWeekly(day) {
  const items = prioritize(day.weekly || [], (x) => x.code);
  const rows = items.map((item) => [
    { className: "star-cell", html: starHtml(item.code) },
    item.code,
    { className: "name-cell", html: item.name },
    `${item.count} 次`,
    { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">新聞</a>` },
  ]);
  renderTable(el.tableWeekly, ["★", "代號", "名稱", "上榜次數", "連結"], rows);
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

function renderSignals(day) {
  const signals = day.signals || { buy: [], sell: [] };

  const buildRows = (list) =>
    prioritize(list, (x) => x.code).map((item) => {
      const fullReasons = (item.reasons || []).join("、");
      const shortReasons = (item.reasons || []).map(abbreviateReason).join(" ");
      return [
        { className: "star-cell", html: starHtml(item.code) },
        item.code,
        { className: "name-cell", html: item.name },
        {
          className: pctClass(item.score),
          html: `${scoreEmoji(item.score)}${item.score > 0 ? "+" : ""}${item.score}`,
        },
        item.conflict
          ? { className: "conflict-flag", html: `<span title="${item.conflict_reason || ""}">⚠️</span>` }
          : "-",
        { html: `<span title="${fullReasons}">${shortReasons}</span>` },
        { html: `<a href="${newsLink(item.code)}" target="_blank" rel="noopener noreferrer">🔗</a>` },
      ];
    });

  renderTable(
    el.tableSignalBuy,
    ["★", "代號", "名稱", "分數", "矛盾", "理由", "連結"],
    buildRows(signals.buy)
  );
  renderTable(
    el.tableSignalSell,
    ["★", "代號", "名稱", "分數", "矛盾", "理由", "連結"],
    buildRows(signals.sell)
  );
}

function showPanels() {
  el.metaRow.hidden = false;
  el.panelWatchlist.hidden = false;
  el.panelGainers.hidden = false;
  el.panelInstitution.hidden = false;
  el.panelWeekly.hidden = false;
  el.panelSignals.hidden = false;
  el.panelBacktest.hidden = false;
  el.stateMessage.hidden = true;
}

async function loadDay(dateStr) {
  try {
    const day = await fetchJSON(`history/${dateStr}.json`);
    state.currentDay = day;
    el.metaGenerated.textContent = `資料產生時間：${day.generated_at || "-"}`;
    renderAll(day);
    showPanels();
  } catch (err) {
    el.stateMessage.hidden = false;
    el.stateMessage.textContent = `讀取 ${dateStr} 的資料時發生錯誤：${err.message}`;
  }
}

// ===== 自選股：Token管理 =====
function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

function promptForToken() {
  const input = window.prompt(
    "貼上你的GitHub Fine-grained Token（只需勾選 tw-stock-dashboard 這個repo，Contents權限設Read and write）。\n" +
    "Token只會存在這台裝置的瀏覽器裡，不會出現在任何程式碼或repo中。\n" +
    "留空取消。"
  );
  if (input && input.trim()) {
    localStorage.setItem(TOKEN_STORAGE_KEY, input.trim());
    return input.trim();
  }
  return "";
}

function setupTokenButton() {
  const btn = document.getElementById("watchlist-token-btn");
  btn.addEventListener("click", () => {
    if (getToken()) {
      const clear = window.confirm("已經設定過Token了。要清除這台裝置上的Token嗎？（清除後這台裝置就不能編輯自選股，但可以重新設定）");
      if (clear) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.alert("已清除，這台裝置目前無法編輯自選股。");
      }
    } else {
      const token = promptForToken();
      if (token) window.alert("Token已儲存在這台裝置，可以開始點星號加入自選股了。");
    }
  });
}

// ===== 自選股：GitHub 讀寫 =====
async function loadWatchlistData() {
  try {
    const res = await fetch(`watchlist.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      state.watchlistCodes = new Set();
      return;
    }
    const data = await res.json();
    state.watchlistCodes = new Set(data.codes || []);
  } catch (err) {
    state.watchlistCodes = new Set();
  }
}

async function saveWatchlistToRepo(codes) {
  const token = getToken() || promptForToken();
  if (!token) throw new Error("尚未設定Token，無法儲存");

  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${WATCHLIST_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  let sha;
  const getRes = await fetch(apiUrl, { headers, cache: "no-store" });
  if (getRes.ok) {
    const fileInfo = await getRes.json();
    sha = fileInfo.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`讀取watchlist.json失敗 (${getRes.status})，請確認Token權限`);
  }

  const content = JSON.stringify({ codes }, null, 2);
  const body = {
    message: `更新自選股清單 (${codes.length}檔)`,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: "main",
  };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({}));
    throw new Error(`儲存失敗 (${putRes.status})：${errBody.message || "請確認Token是否過期或權限不足"}`);
  }
}

function starHtml(code) {
  const filled = state.watchlistCodes.has(code);
  return `<span class="star-toggle${filled ? " star-filled" : ""}" data-code="${code}" title="${filled ? "移除自選股" : "加入自選股"}">${filled ? "★" : "☆"}</span>`;
}

function prioritize(items, codeAccessor) {
  return [...items].sort((a, b) => {
    const aw = state.watchlistCodes.has(codeAccessor(a)) ? 0 : 1;
    const bw = state.watchlistCodes.has(codeAccessor(b)) ? 0 : 1;
    return aw - bw;
  });
}

state.saving = false;
state.pendingSave = false;

async function flushSave() {
  if (state.saving) {
    state.pendingSave = true;
    return;
  }
  state.saving = true;
  try {
    await saveWatchlistToRepo(Array.from(state.watchlistCodes));
  } catch (err) {
    window.alert(err.message);
  } finally {
    state.saving = false;
    if (state.pendingSave) {
      state.pendingSave = false;
      flushSave();
    }
  }
}

async function toggleWatchlist(code) {
  if (state.watchlistCodes.has(code)) {
    state.watchlistCodes.delete(code);
  } else {
    state.watchlistCodes.add(code);
  }
  if (state.currentDay) renderAll(state.currentDay);
  flushSave();
}

document.addEventListener("click", (e) => {
  const star = e.target.closest(".star-toggle");
  if (!star) return;
  e.preventDefault();
  e.stopPropagation();
  toggleWatchlist(star.dataset.code);
});

function renderAll(day) {
  renderTicker(day);
  renderWatchlist(day);
  renderGainers(day);
  renderInstitution(day);
  renderWeekly(day);
  renderSignals(day);
  renderBacktest(day);
}

async function init() {
  setupTokenButton();
  await loadWatchlistData();
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
function renderSupportCard(code, info) {
  const ma20 = info.ma20 !== null && info.ma20 !== undefined ? info.ma20 : null;
  const bbLower = info.bb_lower !== null && info.bb_lower !== undefined ? info.bb_lower : null;
  const distMa = info.dist_to_ma_pct !== null && info.dist_to_ma_pct !== undefined ? info.dist_to_ma_pct : null;
  const label = info.name ? `${code} ${info.name}` : code;

  let bodyHtml = `<div class="code-title">${label} · 目前價格 ${info.current}</div>`;

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

    // 先試代號完全比對
    if (allData[query]) {
      resultBox.innerHTML = renderSupportCard(query, allData[query]);
      return;
    }

    // 代號沒對到，改用公司名稱做包含比對
    const matches = Object.entries(allData).filter(
      ([, info]) => info.name && info.name.includes(query)
    );

    if (matches.length === 0) {
      resultBox.innerHTML = `<p class="empty-note">找不到「${query}」的資料（可能是ETF、非個股，或代號/名稱輸入錯誤）</p>`;
    } else if (matches.length === 1) {
      const [matchCode, matchInfo] = matches[0];
      resultBox.innerHTML = renderSupportCard(matchCode, matchInfo);
    } else {
      const listHtml = matches
        .slice(0, 20)
        .map(([matchCode, matchInfo]) => `<button type="button" class="match-item" data-code="${matchCode}">${matchCode} ${matchInfo.name}</button>`)
        .join("");
      resultBox.innerHTML = `<p class="empty-note">找到 ${matches.length} 檔符合「${query}」，請選擇：</p><div class="match-list">${listHtml}</div>`;
      resultBox.querySelectorAll(".match-item").forEach((btn) => {
        btn.addEventListener("click", () => {
          const matchCode = btn.dataset.code;
          resultBox.innerHTML = renderSupportCard(matchCode, allData[matchCode]);
        });
      });
    }
  } catch (err) {
    resultBox.innerHTML = `<p class="empty-note">查詢失敗：${err.message}</p>`;
  }
}

document.getElementById("support-search-btn").addEventListener("click", searchSupportLevel);
document.getElementById("support-input").addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchSupportLevel();
});

init();
