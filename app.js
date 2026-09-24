// 台股每日焦點 Dashboard（V4，2026-09-24精簡版）
// 只保留V4區塊：市場狀態、進場策略、我的持股、策略實盤追蹤。
// 舊的單一總分訊號、今日關注清單、盤中訊號、漲幅/法人/熱門、自選股、支撐價位查詢已移除
// （研究結論見私有repo CLAUDE.md「V4」章節）。
const GH_OWNER = "willychang-jimu";
const GH_REPO = "tw-stock-dashboard";
const TOKEN_STORAGE_KEY = "tw_stock_watchlist_pat";  // 沿用舊的key，已經設定過Token的裝置不用重設

const state = { codeNameMap: {}, v3Data: null, v3ActiveKey: null, positions: [], positionsExtra: {}, positionsSha: undefined, positionStatus: {} };

// 策略證據狀態的短標籤——真正的note/caveat文字來自daily_picks.json
// (由strategy_base.py的STRATEGY_EVIDENCE產生)，這裡只放「一眼看懂等級」用的短標籤跟樣式class
// V3/V4兩種格式的等級都列著，後端還沒合併V4之前網站讀到的仍是V3格式
const V3_EVIDENCE_LABEL = {
  validated: "已驗證",
  experimental: "實驗中",
  unverified: "未驗證",
  retired: "已退役",
  invalidated_general: "全市場證偽",
  abandoned: "已放棄",
};
// 不同策略該用什麼頻率檢視
const V3_CADENCE = {
  reversal: "恐慌期每日訊號 · 碰布林上軌停利／跌10%停損／最多40天",
  leaders: "觀察名單 · 建議每月檢視一次，不是買進建議",
  breakout: "每日訊號（建議僅參考你的觀察名單內個股）",
  momentum: "研究記錄 · 非每日訊號，不建議依此進出場",
};
const POSITIONS_PATH = "positions.json";
const PERF_HORIZONS = ["5日", "10日", "20日", "40日"];
const STRATEGY_NAME = { reversal: "跌深反彈", leaders: "強勢股觀察", momentum: "強勢上漲(已退役)", breakout: "突破型態(已退役)" };

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const el = {
  stateMessage: document.getElementById("state-message"),
  panelV3: document.getElementById("panel-v3-strategies"),
  v3Tabs: document.getElementById("v3-tabs"),
  v3TabPanel: document.getElementById("v3-tab-panel"),
  panelRegime: document.getElementById("panel-regime"),
  panelPositions: document.getElementById("panel-positions"),
  tablePositions: document.getElementById("table-positions"),
  posStatus: document.getElementById("pos-status"),
  panelStrategyPerf: document.getElementById("panel-strategy-perf"),
  tableStrategyPerf: document.getElementById("table-strategy-perf"),
};

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

// ===== GitHub Token（我的持股存檔用） =====
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
  const btn = document.getElementById("token-btn");
  btn.addEventListener("click", () => {
    if (getToken()) {
      if (window.confirm("已經設定過Token了。要清除這台裝置上的Token嗎？（清除後這台裝置就不能編輯持股，可以重新設定）")) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        window.alert("已清除。");
      }
    } else if (promptForToken()) {
      window.alert("Token已儲存在這台裝置，可以開始登記持股了。");
    }
  });
}

// 股票名稱對照（我的持股顯示名稱用）
async function loadCodeNameMap() {
  try {
    const data = await fetchJSON(`support_levels.json?t=${Date.now()}`);
    const map = {};
    for (const [code, info] of Object.entries(data)) {
      if (info && info.name) map[code] = info.name;
    }
    state.codeNameMap = map;
    renderPositions();
  } catch (err) {
    // 讀不到就只顯示代號
  }
}

// ===== 進場策略：分頁籤呈現（V3 2026-09-09新增，V4 2026-09-24改版） =====
function exitPlanHtml(pick) {
  const plan = pick.exit_plan;
  if (!plan) return "";
  return `<div class="v4-exit-plan">
      <span class="v4-exit-item take">停利≈${escapeHtml(plan.target_price_today)}</span>
      <span class="v4-exit-item stop">停損≈${escapeHtml(plan.stop_price_ref)}</span>
      <span class="v4-exit-item">最多${escapeHtml(plan.max_hold_days)}天</span>
    </div>`;
}

function renderV3PickCard(pick) {
  const pctHtml = pick.pct !== undefined && pick.pct !== null
    ? `<span class="${pctClass(pick.pct)}">${fmtPct(pick.pct)}</span>` : "";
  const priceText = pick.current !== undefined && pick.current !== null ? Number(pick.current).toFixed(2) : "-";
  const reasons = (pick.reasons || []).join(" · ");
  const leaderTag = pick.return_pct !== undefined && pick.return_pct !== null
    ? `<span class="v4-leader-ret ${pctClass(pick.return_pct)}">近${escapeHtml(pick.lookback_days)}日 ${fmtPct(pick.return_pct)}</span>` : "";
  return `
    <div class="v3-pick-card">
      <div class="v3-pick-main">
        <span class="v3-pick-name">${pick.rank ? `<span class="v4-rank">#${pick.rank}</span>` : ""}${stockLinkHtml(pick.code, pick.name, {
          stop: pick.exit_plan ? pick.exit_plan.stop_price_ref : null,
          stopLabel: "停損參考",
        })}</span>
        <span class="v3-pick-reasons">${escapeHtml(reasons)}</span>
        ${exitPlanHtml(pick)}
      </div>
      <div class="v3-pick-price">${priceText}　${pctHtml}${leaderTag}</div>
    </div>`;
}

function renderV3TabPanel(strategyData) {
  const level = strategyData.evidence_level;
  const label = V3_EVIDENCE_LABEL[level] || level;
  const cadence = V3_CADENCE[strategyData.key] || "";
  const picks = strategyData.picks || [];
  let listHtml;
  if (strategyData.active === false) {
    // V4：非恐慌期跌深反彈暫停，明講原因，不要只顯示「今日無標的」讓人以為系統壞了
    listHtml = `<div class="v4-inactive">
        <div class="v4-inactive-title">⏸️ 暫停推薦</div>
        <p>${escapeHtml(strategyData.inactive_reason || "")}</p>
        <p class="v4-inactive-hint">現在該做的：核心部位照常持有0050；已經買進的跌深反彈持股，照原本的出場計畫處理。</p>
      </div>`;
  } else if (picks.length) {
    // 恐慌期可能一次30檔，手機上太長：先顯示前10檔，其餘收進「顯示全部」
    const SHOW_FIRST = 10;
    const more = picks.length > SHOW_FIRST
      ? `<details class="v4-more"><summary>顯示其餘${picks.length - SHOW_FIRST}檔</summary>
           <div class="v3-pick-list">${picks.slice(SHOW_FIRST).map(renderV3PickCard).join("")}</div></details>` : "";
    listHtml = `<div class="v3-pick-list">${picks.slice(0, SHOW_FIRST).map(renderV3PickCard).join("")}</div>${more}`;
    if (strategyData.key === "reversal") {
      listHtml += `<p class="v4-list-foot">隔天開盤買進；停損以實際買進價×0.9為準；停利目標是每天的布林上軌，會隨股價變動。買進後記得到「📌 我的持股」登記，才會收到出場提醒。</p>`;
    }
  } else {
    listHtml = `<div class="v3-empty-note">今日無符合條件的標的</div>`;
  }
  el.v3TabPanel.innerHTML = `
    <div class="v3-evidence-row">
      <span class="v3-evidence-badge ${escapeHtml(level)}">${escapeHtml(label)}</span>
      <span class="v3-cadence">${escapeHtml(cadence)}</span>
    </div>
    <p class="v3-evidence-note">${escapeHtml(strategyData.evidence_note || "")}</p>
    <p class="v3-evidence-caveat">${escapeHtml(strategyData.evidence_caveat || "")}</p>
    ${listHtml}
  `;
}

function selectV3Tab(key) {
  if (!state.v3Data) return;
  state.v3ActiveKey = key;
  el.v3Tabs.querySelectorAll(".v3-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.key === key);
  });
  const strategyData = state.v3Data.strategies.find((s) => s.key === key);
  if (strategyData) renderV3TabPanel(strategyData);
}

function renderV3Tabs() {
  const strategies = state.v3Data.strategies;
  el.v3Tabs.innerHTML = strategies.map((s) => {
    const countTag = s.count ? ` (${s.count})` : "";
    const pausedTag = s.active === false ? " ⏸️" : "";
    return `<button type="button" class="v3-tab" data-key="${escapeHtml(s.key)}">${escapeHtml(s.label)}${countTag}${pausedTag}</button>`;
  }).join("");
  el.v3Tabs.querySelectorAll(".v3-tab").forEach((btn) => {
    btn.addEventListener("click", () => selectV3Tab(btn.dataset.key));
  });
  // 預設打開「目前有在推薦」的第一個策略；都暫停時打開第一個
  const firstActive = strategies.find((s) => s.active !== false && s.count) || strategies[0];
  selectV3Tab(firstActive.key);
}

// ===== V4：市場狀態（市場寬度）=====
function breadthSparklineSvg(history, threshold) {
  const pts = (history || []).filter((h) => h.breadth !== null && h.breadth !== undefined);
  if (pts.length < 2) return `<div class="v3-empty-note">資料累積中</div>`;
  const W = 300, H = 90, P = 4;
  const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v) => P + (1 - v) * (H - 2 * P);
  const line = pts.map((h, i) => `${x(i).toFixed(1)},${y(h.breadth).toFixed(1)}`).join(" ");
  const area = `${x(0).toFixed(1)},${H - P} ${line} ${x(pts.length - 1).toFixed(1)},${H - P}`;
  const panicDots = pts.map((h, i) => h.breadth < threshold
    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(h.breadth).toFixed(1)}" r="2.2" class="spark-panic-dot"/>` : "").join("");
  const last = pts[pts.length - 1];
  const first = pts[0];
  return `
    <svg class="regime-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
         aria-label="近${pts.length}日市場寬度走勢，最新${Math.round(last.breadth * 100)}%">
      <line x1="${P}" x2="${W - P}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}" class="spark-threshold"/>
      <polygon points="${area}" class="spark-area"/>
      <polyline points="${line}" class="spark-line"/>
      ${panicDots}
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.breadth).toFixed(1)}" r="3.5" class="spark-last"/>
    </svg>
    <div class="regime-spark-axis"><span>${escapeHtml(first.date)}</span><span class="spark-legend">虛線＝恐慌線${Math.round(threshold * 100)}%　紅點＝恐慌日</span><span>${escapeHtml(last.date)}</span></div>`;
}

function renderRegime(data) {
  const r = data.regime;
  if (!r || r.breadth === null || r.breadth === undefined) {
    el.panelRegime.hidden = true;
    return;
  }
  const isPanic = r.regime === "panic";
  const pct = Math.round(r.breadth * 100);
  const th = r.threshold ?? 0.3;
  el.panelRegime.classList.toggle("is-panic", isPanic);
  document.getElementById("regime-label").innerHTML =
    `<span class="regime-dot"></span>${isPanic ? "全市場恐慌 · 跌深反彈啟動" : "一般／多頭 · 跌深反彈暫停"}`;
  document.getElementById("regime-breadth-value").textContent = `${pct}%`;
  document.getElementById("regime-gauge").innerHTML =
    `<div class="regime-gauge-fill" style="width:${Math.min(Math.max(pct, 0), 100)}%"></div>` +
    `<div class="regime-gauge-threshold" style="left:${th * 100}%"></div>`;
  document.getElementById("regime-gauge").setAttribute("aria-label", `市場寬度${pct}%，恐慌線${Math.round(th * 100)}%`);
  document.getElementById("regime-threshold-tag").style.left = `${th * 100}%`;
  document.getElementById("regime-threshold-tag").textContent = `恐慌線${Math.round(th * 100)}%`;
  document.getElementById("regime-sparkline").innerHTML = breadthSparklineSvg(r.history, th);
  const counts = r.total ? `（${r.above} / ${r.total} 檔）` : "";
  document.getElementById("regime-core-advice").textContent =
    `${r.date || ""} 市場寬度${pct}%${counts}。${data.core_advice || ""}`;
  el.panelRegime.hidden = false;
}

async function loadV3Strategies() {
  try {
    state.v3Data = await fetchJSON(`daily_picks.json?t=${Date.now()}`);
    if (state.v3Data.version >= 4) {
      renderRegime(state.v3Data);
      document.getElementById("v3-panel-note").textContent =
        "先看上方市場狀態：恐慌期推跌深反彈（附出場計畫），其他時間只列強勢股觀察名單（實驗中）。僅供參考，非投資建議";
    }
    renderV3Tabs();
    el.panelV3.hidden = false;
  } catch (err) {
    // daily_picks.json可能還沒產生過(第一次部署時)，安靜跳過，不擋其他面板載入
    console.warn("讀取daily_picks.json失敗，策略面板暫不顯示：", err.message);
  }
}

// ===== V4：策略實盤追蹤 vs 0050 =====
function fmtNum(v, digits = 1, suffix = "") {
  return v === null || v === undefined ? "-" : `${Number(v).toFixed(digits)}${suffix}`;
}

async function loadStrategyPerf() {
  try {
    const data = await fetchJSON(`daily_picks_backtest.json?t=${Date.now()}`);
    const perf = data["表現"] || {};
    // 只顯示V4仍在運作的策略；已退役策略與V3以前的舊資料不列（原始紀錄仍保留在後端）
    const keys = ["reversal", "leaders"].filter((k) => perf[k]);
    const hasBench = keys.some((k) => Object.values(perf[k]).some((h) => h && "超額vs0050%" in h));
    const rows = [];
    for (const key of keys) {
      PERF_HORIZONS.forEach((h, i) => {
        const d = perf[key][h];
        if (!d) return;
        const ex = d["超額vs0050%"];
        const beat = d["贏0050比例%"];
        rows.push(`<tr>
          <td>${i === 0 ? escapeHtml(STRATEGY_NAME[key] || key) : ""}</td>
          <td>${h}</td>
          <td>${d["樣本數"] ?? 0}${d["樣本數"] && d["樣本數"] < 30 ? '<span class="perf-thin">少</span>' : ""}</td>
          <td>${fmtNum(d["勝率%"], 0, "%")}</td>
          <td class="${pctClass(d["平均報酬%"])}">${d["平均報酬%"] == null ? "-" : fmtPct(d["平均報酬%"])}</td>
          ${hasBench ? `<td class="${pctClass(ex)}">${ex == null ? "-" : fmtPct(ex)}</td>
          <td class="${beat == null ? "" : beat >= 50 ? "perf-good" : "perf-bad"}">${fmtNum(beat, 0, "%")}</td>` : ""}
        </tr>`);
      });
    }
    const total = keys.reduce((n, k) => n + Object.values(perf[k]).reduce((m, h) => Math.max(m, (h && h["樣本數"]) || 0), 0), 0);
    const since = data["起算日"] ? `${data["起算日"]}起` : "V4上線後";
    document.getElementById("perf-status").textContent = total
      ? `統計${since}的推薦；樣本少於30筆時僅供參考`
      : `${since}的推薦樣本累積中（最快要隔幾個交易日才會有第一筆報酬），目前還沒有可統計的數字`;
    if (!rows.length) { el.panelStrategyPerf.hidden = false; return; }
    el.tableStrategyPerf.innerHTML = `
      <thead><tr><th>策略</th><th>持有</th><th>樣本</th><th>勝率</th><th>平均報酬</th>
        ${hasBench ? "<th>超額vs0050</th><th>贏0050比例</th>" : ""}</tr></thead>
      <tbody>${rows.join("")}</tbody>`;
    el.panelStrategyPerf.hidden = false;
  } catch (err) {
    console.warn("讀取daily_picks_backtest.json失敗：", err.message);
  }
}

// ===== V4：我的持股（positions.json讀寫，跟自選股共用Token） =====
async function loadPositions() {
  try {
    const res = await fetch(`${POSITIONS_PATH}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      state.positions = data.positions || [];
      const { positions, ...extra } = data;   // exit_settings等其他欄位原樣保留，存檔時寫回去
      state.positionsExtra = extra;
    }
  } catch (err) { /* 沒有檔案就當作沒有持股 */ }
  try {
    const status = await fetchJSON(`position_status.json?t=${Date.now()}`);
    state.positionStatus = {};
    (status.positions || []).forEach((p) => { state.positionStatus[`${p.code}|${p.entry_date || ""}`] = p; });
    state.positionStatusDate = status.date;
  } catch (err) { state.positionStatus = {}; }
  renderPositions();
  el.panelPositions.hidden = false;
}

function positionAlertsHtml(st) {
  if (!st) return `<span class="empty-note">等下次盤後更新</span>`;
  if (st.strategy === "reversal") {
    const alerts = st.exit_alerts || [];
    if (alerts.length) return alerts.map((a) => `<span class="pos-alert ${escapeHtml(a.level)}">${escapeHtml(a.text)}</span>`).join("");
    return `<span class="pos-ok">續抱 · 停利≈${fmtNum(st.bb_upper, 2)} 停損${fmtNum(st.stop_price, 2)} · 剩${st.days_left ?? "-"}天</span>`;
  }
  const alerts = [];
  if (st.below_ma20) alerts.push(`<span class="pos-alert danger">跌破月線${fmtNum(st.ma20, 2)}</span>`);
  if (st.below_ma5) alerts.push(`<span class="pos-alert warn">跌破5日線${fmtNum(st.ma5, 2)}</span>`);
  return alerts.join("") || `<span class="pos-ok">均線之上</span>`;
}

function renderPositions() {
  const list = state.positions;
  if (!list.length) {
    el.tablePositions.innerHTML = `<tbody><tr><td class="empty-note">還沒有登記持股</td></tr></tbody>`;
    return;
  }
  const rows = list.map((p, i) => {
    const st = state.positionStatus[`${p.code}|${p.entry_date || ""}`];
    const name = p.name || state.codeNameMap[p.code] || (st && st.name) || "";
    return `<tr>
      <td class="pos-name">${stockLinkHtml(p.code, name, {
        entry: p.entry_price,
        stop: p.strategy === "reversal" && p.entry_price ? Math.round(p.entry_price * 90) / 100 : null,
        stopLabel: "停損",
      })}</td>
      <td data-label="策略">${escapeHtml(STRATEGY_NAME[p.strategy] || "一般")}</td>
      <td data-label="買進">${fmtNum(p.entry_price, 2)}<div class="pos-sub">${escapeHtml(p.entry_date || "")}</div></td>
      <td data-label="現價">${st ? fmtNum(st.current, 2) : "-"}</td>
      <td data-label="損益" class="${st ? pctClass(st.pnl_pct) : ""}">${st && st.pnl_pct != null ? fmtPct(st.pnl_pct) : "-"}</td>
      <td class="pos-check">${positionAlertsHtml(st)}</td>
      <td class="pos-actions"><button type="button" class="pos-remove" data-idx="${i}" aria-label="移除">✕</button></td>
    </tr>`;
  }).join("");
  el.tablePositions.innerHTML = `
    <thead><tr><th>股票</th><th>策略</th><th>買進</th><th>現價</th><th>損益</th><th>出場檢查</th><th></th></tr></thead>
    <tbody>${rows}</tbody>`;
  el.tablePositions.querySelectorAll(".pos-remove").forEach((btn) => {
    btn.addEventListener("click", () => removePosition(Number(btn.dataset.idx)));
  });
}

async function savePositionsToRepo(positions) {
  const token = getToken() || promptForToken();
  if (!token) throw new Error("尚未設定Token，無法儲存");
  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${POSITIONS_PATH}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const getSha = async () => {
    const r = await fetch(apiUrl, { headers, cache: "no-store" });
    if (r.ok) return (await r.json()).sha;
    if (r.status === 404) return null;
    throw new Error(`讀取positions.json失敗 (${r.status})，請確認Token權限`);
  };
  const put = (sha) => {
    const content = JSON.stringify({ ...state.positionsExtra, positions }, null, 2);
    const body = { message: `更新持股 (${positions.length}檔)`, content: btoa(unescape(encodeURIComponent(content))), branch: "main" };
    if (sha) body.sha = sha;
    return fetch(apiUrl, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  };
  if (state.positionsSha === undefined) state.positionsSha = await getSha();
  let res = await put(state.positionsSha);
  if (res.status === 409) { state.positionsSha = await getSha(); res = await put(state.positionsSha); }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`儲存失敗 (${res.status})：${errBody.message || "請確認Token是否過期或權限不足"}`);
  }
  state.positionsSha = (await res.json()).content?.sha ?? state.positionsSha;
}

async function commitPositions(next, okText) {
  const prev = state.positions;
  state.positions = next;
  renderPositions();
  el.posStatus.textContent = "儲存中…";
  try {
    await savePositionsToRepo(next);
    el.posStatus.textContent = okText;
  } catch (err) {
    state.positions = prev;
    renderPositions();
    el.posStatus.textContent = err.message;
  }
}

function removePosition(idx) {
  const p = state.positions[idx];
  if (!p || !window.confirm(`移除 ${p.code}（${p.entry_date || "未填日期"} 買進）這筆持股？`)) return;
  commitPositions(state.positions.filter((_, i) => i !== idx), "已移除");
}

function setupPositionForm() {
  const dateInput = document.getElementById("pos-date");
  dateInput.value = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  document.getElementById("pos-add-btn").addEventListener("click", () => {
    const code = document.getElementById("pos-code").value.trim();
    const price = parseFloat(document.getElementById("pos-price").value);
    const shares = parseInt(document.getElementById("pos-shares").value, 10);
    const strategy = document.getElementById("pos-strategy").value;
    if (!/^\d{4,6}[A-Z]?$/.test(code)) { el.posStatus.textContent = "請輸入正確的股票代號"; return; }
    if (!(price > 0)) { el.posStatus.textContent = "請輸入買進價"; return; }
    const pos = { code, name: state.codeNameMap[code] || "", entry_price: price, entry_date: dateInput.value || null };
    if (shares > 0) pos.shares = shares;
    if (strategy) pos.strategy = strategy;
    commitPositions([...state.positions, pos], "已加入，出場檢查會在下次盤後更新時出現");
    document.getElementById("pos-code").value = "";
    document.getElementById("pos-price").value = "";
    document.getElementById("pos-shares").value = "";
  });
}


// ===== 主題切換（亮色預設） =====
const THEME_STORAGE_KEY = "tw_stock_theme";
function currentTheme() { return document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
function setupThemeButton() {
  const btn = document.getElementById("theme-btn");
  const label = () => { btn.textContent = currentTheme() === "dark" ? "☀️ 亮色" : "🌙 暗色"; };
  label();
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (e) { /* 私密模式等情況存不了就算了 */ }
    label();
  });
}

// ===== K線彈窗（點強勢股／跌深反彈／持股的名稱） =====
// 資料來自後端charts.json：只含強勢股觀察、跌深反彈、我的持股，每檔最多160天
const CHART_SHOW_DAYS = 120;
let chartsPromise = null;
let activeChart = null;

function stockLinkHtml(code, name, ctx = {}) {
  const data = { code, name: name || "", entry: ctx.entry ?? null, stop: ctx.stop ?? null, stopLabel: ctx.stopLabel || "停損" };
  return `<button type="button" class="stock-link" data-chart="${escapeHtml(JSON.stringify(data))}">${escapeHtml(name || code)} <span class="v3-pick-code">${escapeHtml(code)}</span></button>`;
}

function loadChartsData() {
  if (!chartsPromise) {
    chartsPromise = fetchJSON(`charts.json?t=${Date.now()}`).catch(() => ({}));
  }
  return chartsPromise;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function rollingStats(closes, n) {
  // 回傳每一天的20日均線與布林上下軌（資料不足20天的日子是null）
  return closes.map((_, i) => {
    if (i < n - 1) return null;
    const seg = closes.slice(i - n + 1, i + 1);
    const ma = seg.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - ma) ** 2, 0) / n);
    return { ma, upper: ma + 2 * sd, lower: ma - 2 * sd };
  });
}

function externalLinksHtml(code) {
  const c = encodeURIComponent(code);
  return `
    <a href="https://tw.stock.yahoo.com/quote/${c}/technical-analysis" target="_blank" rel="noopener">Yahoo股市 技術分析 ↗</a>
    <a href="https://tw.stock.yahoo.com/quote/${c}/news" target="_blank" rel="noopener">Yahoo股市 新聞 ↗</a>
    <a href="https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${c}" target="_blank" rel="noopener">Goodinfo 基本資料 ↗</a>`;
}

function fmtVol(v) {
  if (v === null || v === undefined) return "-";
  const lots = v / 1000;   // 股 → 張
  return lots >= 10000 ? `${(lots / 10000).toFixed(1)}萬張` : `${Math.round(lots).toLocaleString()}張`;
}

function legendHtml(bar, prevClose, stat, ctx) {
  if (!bar) return "";
  const pct = prevClose ? ((bar.close - prevClose) / prevClose) * 100 : null;
  const cls = pctClass(pct);
  const keys = [
    `<span class="chart-key"><span class="chart-swatch" style="border-color:${cssVar("--chart-ma")}"></span>月線 <b>${stat ? stat.ma.toFixed(2) : "-"}</b></span>`,
    `<span class="chart-key"><span class="chart-swatch" style="border-color:${cssVar("--chart-bb")}"></span>布林 <b>${stat ? `${stat.lower.toFixed(2)}～${stat.upper.toFixed(2)}` : "-"}</b></span>`,
  ];
  if (ctx.entry) keys.push(`<span class="chart-key"><span class="chart-swatch dashed" style="border-color:${cssVar("--text-muted")}"></span>買進價 <b>${Number(ctx.entry).toFixed(2)}</b></span>`);
  if (ctx.stop) keys.push(`<span class="chart-key"><span class="chart-swatch dashed" style="border-color:${cssVar("--chart-stop")}"></span>${escapeHtml(ctx.stopLabel)} <b>${Number(ctx.stop).toFixed(2)}</b></span>`);
  return `<span>${escapeHtml(bar.time)}</span>
    <span>開 <b>${bar.open}</b> 高 <b>${bar.high}</b> 低 <b>${bar.low}</b> 收 <b class="${cls}">${bar.close}</b>
      <span class="${cls}">${pct === null ? "" : fmtPct(pct)}</span></span>
    <span>量 <b>${fmtVol(bar.volume)}</b></span>${keys.join("")}`;
}

async function openChartModal(ctx) {
  const overlay = document.getElementById("chart-modal-overlay");
  const canvas = document.getElementById("chart-canvas");
  const legend = document.getElementById("chart-legend");
  const foot = document.getElementById("chart-foot");
  document.getElementById("chart-modal-title").textContent = `${ctx.name || ""} ${ctx.code}`;
  document.getElementById("chart-links").innerHTML = externalLinksHtml(ctx.code);
  legend.innerHTML = "載入中…";
  foot.textContent = "";
  canvas.innerHTML = "";
  canvas.hidden = false;
  overlay.hidden = false;
  document.getElementById("chart-modal-close").focus();

  const all = (await loadChartsData())[ctx.code];
  if (!all || !all.length || !window.LightweightCharts) {
    canvas.hidden = true;
    legend.innerHTML = "";
    foot.textContent = window.LightweightCharts
      ? "這檔還沒有K線資料（剛加入的持股要等下一次盤後更新才會有），可以先用下方連結看。"
      : "K線圖元件載入失敗（網路問題），可以先用下方連結看。";
    return;
  }

  const closes = all.map((d) => d.close);
  const stats = rollingStats(closes, 20);
  const start = Math.max(0, all.length - CHART_SHOW_DAYS);
  const bars = all.slice(start);
  const up = cssVar("--up"), down = cssVar("--down");
  const LC = window.LightweightCharts;
  activeChart = LC.createChart(canvas, {
    autoSize: true,
    layout: { background: { color: cssVar("--surface") }, textColor: cssVar("--text-muted"), fontFamily: cssVar("--font-mono") },
    grid: { vertLines: { color: cssVar("--chart-grid") }, horzLines: { color: cssVar("--chart-grid") } },
    rightPriceScale: { borderColor: cssVar("--border") },
    timeScale: { borderColor: cssVar("--border") },
    crosshair: { mode: LC.CrosshairMode.Normal },
    localization: { locale: "zh-TW", dateFormat: "yyyy/MM/dd" },
  });
  const candle = activeChart.addCandlestickSeries({
    upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
  });
  candle.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  // 成交量：放在K線下方自己的區塊（不跟價格共用刻度）
  const vol = activeChart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  activeChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  candle.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
  vol.setData(bars.filter((d) => d.volume != null).map((d) => ({
    time: d.time, value: d.volume, color: d.close >= d.open ? `${up}66` : `${down}66`,
  })));
  const line = (color, width) => activeChart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const statBars = bars.map((d, i) => ({ d, s: stats[start + i] })).filter((x) => x.s);
  const bbColor = cssVar("--chart-bb");
  line(bbColor, 1).setData(statBars.map(({ d, s }) => ({ time: d.time, value: s.upper })));
  line(bbColor, 1).setData(statBars.map(({ d, s }) => ({ time: d.time, value: s.lower })));
  line(cssVar("--chart-ma"), 2).setData(statBars.map(({ d, s }) => ({ time: d.time, value: s.ma })));
  if (ctx.entry) candle.createPriceLine({ price: Number(ctx.entry), color: cssVar("--text-muted"), lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "買進" });
  if (ctx.stop) candle.createPriceLine({ price: Number(ctx.stop), color: cssVar("--chart-stop"), lineWidth: 2, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: ctx.stopLabel });
  activeChart.timeScale().fitContent();

  const byTime = new Map(bars.map((d, i) => [d.time, i]));
  const showLegend = (i) => {
    const gi = start + i;
    legend.innerHTML = legendHtml(all[gi], gi > 0 ? all[gi - 1].close : null, stats[gi], ctx);
  };
  showLegend(bars.length - 1);
  activeChart.subscribeCrosshairMove((param) => {
    const i = param.time !== undefined ? byTime.get(param.time) : undefined;
    showLegend(i === undefined ? bars.length - 1 : i);
  });
  foot.textContent = `顯示最近${bars.length}個交易日（未做除權息還原，跟一般看盤軟體一致）。藍線是布林通道上下軌——跌深反彈的停利目標就是收盤碰到上軌。`;
}

function closeChartModal() {
  document.getElementById("chart-modal-overlay").hidden = true;
  if (activeChart) { activeChart.remove(); activeChart = null; }
}

function setupChartModal() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".stock-link");
    if (link) {
      try { openChartModal(JSON.parse(link.dataset.chart)); } catch (err) { console.warn(err); }
    }
  });
  document.getElementById("chart-modal-close").addEventListener("click", closeChartModal);
  document.getElementById("chart-modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "chart-modal-overlay") closeChartModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("chart-modal-overlay").hidden) closeChartModal();
  });
}

async function init() {
  setupThemeButton();
  setupTokenButton();
  setupChartModal();
  setupPositionForm();
  await Promise.all([loadV3Strategies(), loadStrategyPerf(), loadPositions()]);
  loadCodeNameMap();
  if (el.panelV3.hidden) {
    el.stateMessage.textContent = "目前還沒有每日資料，下次盤後更新後就會出現。";
  } else {
    el.stateMessage.hidden = true;
  }
}

init();
