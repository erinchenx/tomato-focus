/* ===========================
   番茄时钟 — 核心逻辑
   =========================== */

// ── 环境检测 ──────────────────────────
(() => {
  console.log("[番茄时钟] 协议:", window.location.protocol);
  try {
    const testKey = "__tomato_storage_test__";
    localStorage.setItem(testKey, "ok");
    const result = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);
    console.log("[番茄时钟] localStorage: " + (result === "ok" ? "✅ 可用" : "❌ 异常"));
  } catch (e) {
    console.error("[番茄时钟] localStorage: ❌ 不可用", e);
  }
})();

// ── DOM 引用 ──────────────────────────
const timerDisplay = document.getElementById("timer");
const modeBadge = document.getElementById("mode-badge");
const startPauseBtn = document.getElementById("start-pause-btn");
const resetBtn = document.getElementById("reset-btn");
const timerRing = document.getElementById("timer-ring");
const dateDisplay = document.getElementById("date-display");
const todayCount = document.getElementById("today-count");
const calMonthLabel = document.getElementById("cal-month-label");
const weekdayRow = document.getElementById("weekday-row");
const daysGrid = document.getElementById("days-grid");
const toast = document.getElementById("toast");
const notifyMessage = document.getElementById("notify-message");
const toastCloseBtn = document.getElementById("toast-close-btn");
const dayDetail = document.getElementById("day-detail");
const detailDate = document.getElementById("detail-date");
const detailCount = document.getElementById("detail-count");
const detailPeriods = document.getElementById("detail-periods");
const periodMorning = document.getElementById("period-morning");
const periodAfternoon = document.getElementById("period-afternoon");
const periodEvening = document.getElementById("period-evening");
const persistIndicator = document.getElementById("persist-indicator");
const taskTypeSection = document.getElementById("task-type-section");
const taskTypeRow = document.getElementById("task-type-row");
const focusTypeIndicator = document.getElementById("focus-type-indicator");
const btnStartFocus = document.getElementById("btn-start-focus");
const controls = document.getElementById("controls");

// ── 状态 ──────────────────────────────
let timer = null;
let isRunning = false;
const WORK = 25 * 60;
const BREAK = 5 * 60;
let timeLeft = WORK;
let endTime = null;
let currentMode = "work";
let sessionStartTime = null; // 当前专注开始的绝对时间戳
let currentTaskType = "无类型";   // 当前选中的任务类型
let calYear, calMonth;

// ── 计时器状态持久化（刷新不丢） ──────
// 同时写入所有可用存储，刷新时从任意一个恢复

function saveTimerState() {
  const pack = timeLeft + "|" + currentMode + "|" + (endTime ?? 0) + "|" + (isRunning ? 1 : 0) + "|" + (sessionStartTime ?? 0);
  // 1) window.name
  window.name = pack;
  // 2) location.hash（用 replaceState 不产生历史）
  try { history.replaceState(null, "", "#" + pack); } catch (_) {}
  // 3) localStorage
  try { localStorage.setItem("ts", pack); } catch (_) {}
  // 4) sessionStorage
  try { sessionStorage.setItem("ts", pack); } catch (_) {}
  // 5) cookie
  try { document.cookie = "ts=" + encodeURIComponent(pack) + ";path=/"; } catch (_) {}
}

function loadTimerState() {
  let pack = null;
  // 逐个尝试读取
  if (window.name && window.name.includes("|")) pack = window.name;
  if (!pack) {
    const h = window.location.hash;
    if (h && h.includes("|")) pack = h.slice(1);
  }
  if (!pack) {
    try { const v = localStorage.getItem("ts"); if (v && v.includes("|")) pack = v; } catch (_) {}
  }
  if (!pack) {
    try { const v = sessionStorage.getItem("ts"); if (v && v.includes("|")) pack = v; } catch (_) {}
  }
  if (!pack) {
    try {
      const m = document.cookie.match(/(?:^|;\s*)ts=([^;]*)/);
      if (m) pack = decodeURIComponent(m[1]);
    } catch (_) {}
  }
  if (!pack) return null;
  const parts = pack.split("|");
  if (parts.length < 5) return null;
  const end = parts[2] === "0" ? null : parseInt(parts[2], 10);
  return {
    timeLeft: parseInt(parts[0], 10),
    currentMode: parts[1],
    endTime: end,
    isRunning: parts[3] === "1",
    sessionStartTime: parts[4] === "0" ? null : parseInt(parts[4], 10),
  };
}

function clearTimerState() {
  window.name = "";
  try { history.replaceState(null, "", window.location.href.split("#")[0]); } catch (_) {}
  try { localStorage.removeItem("ts"); } catch (_) {}
  try { sessionStorage.removeItem("ts"); } catch (_) {}
  try { document.cookie = "ts=;path=/;max-age=0"; } catch (_) {}
}

// ── 专注数据：按日期存储，每条为 { start, end } ────
// 格式: { "2026-06-19": [{start:ts, end:ts}, ...], ... }
// null 表示从史前版本迁移、无时间信息
let focusData = {};

function loadFocusData() {
  try {
    const raw = localStorage.getItem("focusData");
    if (raw) {
      const parsed = JSON.parse(raw);
      let migrated = false;
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === "number") {
          // 最旧格式：值为数字 → 全部置 null，保留计数
          parsed[key] = new Array(val).fill(null);
          migrated = true;
        } else if (Array.isArray(val)) {
          // 上一版格式：数组中可能是纯时间戳数字，迁移为 { start, end }
          parsed[key] = val.map((item) => {
            if (item === null || item === undefined) return null;
            if (typeof item === "number") {
              migrated = true;
              return { start: null, end: item }; // 旧数据只有结束时间
            }
            return item; // 已是 { start, end } 格式
          });
        }
      }
      focusData = parsed;
      if (migrated) saveFocusData();
      return;
    }
  } catch (_) { /* ignore */ }

  // 迁移最旧版本：单个 focusCount 数字
  const oldCount = parseInt(localStorage.getItem("focusCount")) || 0;
  if (oldCount > 0) {
    focusData[getDateKey()] = new Array(oldCount).fill(null);
    saveFocusData();
    localStorage.removeItem("focusCount");
  }
}

function saveFocusData() {
  localStorage.setItem("focusData", JSON.stringify(focusData));
}

function getDateKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── 任务类型管理 ──────────────────────
const DEFAULT_TYPES = ["工作", "探索", "读书"];
let customTypes = [];
let hiddenTypes = [];

function loadTypeData() {
  try {
    const raw = localStorage.getItem("customTypes");
    if (raw) customTypes = JSON.parse(raw);
  } catch (_) { customTypes = []; }
  try {
    const raw = localStorage.getItem("hiddenTypes");
    if (raw) hiddenTypes = JSON.parse(raw);
  } catch (_) { hiddenTypes = []; }
}

function saveCustomTypes() {
  localStorage.setItem("customTypes", JSON.stringify(customTypes));
}

function saveHiddenTypes() {
  localStorage.setItem("hiddenTypes", JSON.stringify(hiddenTypes));
}

function addCustomType(type) {
  if (!type) return;
  // 如果是被隐藏的默认类型，恢复它
  if (DEFAULT_TYPES.includes(type)) {
    const hidx = hiddenTypes.indexOf(type);
    if (hidx >= 0) { hiddenTypes.splice(hidx, 1); saveHiddenTypes(); renderTaskTypeRow(); }
    return;
  }
  if (customTypes.includes(type)) return;
  customTypes.push(type);
  saveCustomTypes();
  renderTaskTypeRow();
}

// 获取当前可见的类型列表
function getVisibleTypes() {
  return [...DEFAULT_TYPES.filter(t => !hiddenTypes.includes(t)), ...customTypes];
}

// 删除类型（默认类型加入隐藏列表，自定义类型直接移除）
function removeCustomType(type) {
  if (DEFAULT_TYPES.includes(type)) {
    if (!hiddenTypes.includes(type)) {
      hiddenTypes.push(type);
      saveHiddenTypes();
    }
  } else {
    const idx = customTypes.indexOf(type);
    if (idx >= 0) { customTypes.splice(idx, 1); saveCustomTypes(); }
  }
  if (currentTaskType === type) currentTaskType = "无类型";
  renderTaskTypeRow();
}

// 动态渲染任务类型按钮
function renderTaskTypeRow() {
  const allTypes = getVisibleTypes();
  const activeType = currentTaskType || "无类型";

  taskTypeRow.innerHTML =
    allTypes.map(t => {
      return `<button class="task-type-btn${t === activeType ? " active" : ""}" data-type="${t}">${t}<span class="type-del" data-action="del-type" data-type="${t}">✕</span></button>`;
    }).join("") +
    `<button class="task-type-btn${currentTaskType && !allTypes.includes(currentTaskType) && currentTaskType !== "无类型" ? " active" : ""}" data-type="__custom__">+ 自定义</button>
    <input type="text" class="task-type-input" id="task-type-input" placeholder="输入类型…" maxlength="8" style="display:none;">`;
}

function recordFocus() {
  const key = getDateKey();
  if (!Array.isArray(focusData[key])) focusData[key] = [];
  const type = currentTaskType || "无类型";
  focusData[key].push({
    start: sessionStartTime,
    end: Date.now(),
    type: type,
  });
  addCustomType(type);
  saveFocusData();
}

function getTodayFocus() {
  const arr = focusData[getDateKey()];
  return Array.isArray(arr) ? arr.length : 0;
}

function getFocusSessions(dateKey) {
  const arr = focusData[dateKey];
  return Array.isArray(arr) ? arr : [];
}

function addFocusSession(dateKey, start, end, type) {
  if (!Array.isArray(focusData[dateKey])) focusData[dateKey] = [];
  focusData[dateKey].push({ start, end, type: type || "无类型" });
  saveFocusData();
}

function editFocusSession(dateKey, index, start, end, type) {
  if (!Array.isArray(focusData[dateKey])) return;
  focusData[dateKey][index] = { start, end, type: type || "无类型" };
  saveFocusData();
}

function removeFocusSession(dateKey, index) {
  if (!Array.isArray(focusData[dateKey])) return;
  focusData[dateKey].splice(index, 1);
  if (focusData[dateKey].length === 0) delete focusData[dateKey];
  saveFocusData();
}

// 工具：dateKey → 当天 00:00 的时间戳（毫秒）
function dateKeyToBase(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

// 工具：HH:MM → 相对于 dateKey 当天的毫秒时间戳
function timeToTimestamp(dateKey, timeStr) {
  if (!timeStr) return null;
  const [h, min] = timeStr.split(":").map(Number);
  return dateKeyToBase(dateKey) + h * 3600000 + min * 60000;
}

// 工具：毫秒时间戳 → HH:MM
function timestampToTimeString(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 工具：HH:MM ± 分钟 → HH:MM
function addMinutesToTime(timeStr, minutes) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  let total = h * 60 + m + minutes;
  total = ((total % 1440) + 1440) % 1440; // 处理跨天和负值
  const newH = Math.floor(total / 60);
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

// ── 日期显示 ──────────────────────────
function updateDateDisplay() {
  const now = new Date();
  const weekNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const w = weekNames[now.getDay()];
  dateDisplay.textContent = `${y}年${m}月${d}日 ${w}`;
}

// ── 计时器 ────────────────────────────
function updateTimerDisplay() {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  timerDisplay.textContent =
    `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function updateModeUI() {
  if (currentMode === "work") {
    modeBadge.textContent = "Focus";
    timerRing.classList.remove("break");
  } else {
    modeBadge.textContent = "Rest";
    timerRing.classList.add("break");
  }
}

function startTimer() {
  isRunning = true;
  startPauseBtn.textContent = "暂停";
  if (currentMode === "work" && !sessionStartTime) {
    sessionStartTime = Date.now();
  }
  // 运行中：隐藏任务类型选择，显示控制按钮
  taskTypeSection.style.display = "none";
  controls.style.display = "";
  focusTypeIndicator.style.display = "none";
  endTime = Date.now() + timeLeft * 1000;
  saveTimerState(); // 立即持久化，不等第一个 tick

  timer = setInterval(() => {
    timeLeft = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    updateTimerDisplay();
    saveTimerState(); // 每个 tick 持久化剩余时间

    if (timeLeft <= 0) {
      clearInterval(timer);
      isRunning = false;
      endTime = null;
      clearTimerState();
      playAlarmSound();

      if (currentMode === "work") {
        recordFocus();
        updateTodayCount();
        updateCalendar();
        currentMode = "break";
        timeLeft = BREAK;
        updateModeUI();
        updateTimerDisplay();
        startTimer();
      } else {
        currentMode = "work";
        timeLeft = WORK;
        updateModeUI();
        updateTimerDisplay();
        startPauseBtn.textContent = "开始";
        // 恢复任务类型选择，隐藏控制按钮
        taskTypeSection.style.display = "";
        controls.style.display = "none";
        focusTypeIndicator.style.display = "none";
        saveTimerState();
      }
    }
  }, 250);
}

function pauseTimer() {
  isRunning = false;
  clearInterval(timer);
  timeLeft = Math.max(0, Math.round((endTime - Date.now()) / 1000));
  endTime = null;
  // 恢复任务类型选择，隐藏控制按钮和专注指示
  taskTypeSection.style.display = "";
  controls.style.display = "none";
  focusTypeIndicator.style.display = "none";
  saveTimerState();
}

function resetTimer() {
  pauseTimer();
  currentMode = "work";
  timeLeft = WORK;
  currentTaskType = "无类型";
  updateModeUI();
  updateTimerDisplay();
  renderTaskTypeRow();
  clearTimerState();
}

// ── 今日统计 ──────────────────────────
function updateTodayCount() {
  todayCount.textContent = getTodayFocus();
}

// ── 月历 ──────────────────────────────
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function buildWeekdayRow() {
  weekdayRow.innerHTML = WEEKDAYS.map((w) => `<span>${w}</span>`).join("");
}

function updateCalendar(year, month) {
  calYear = year ?? calYear ?? new Date().getFullYear();
  calMonth = month ?? calMonth ?? new Date().getMonth() + 1;

  const now = new Date();
  const todayKey = getDateKey(now);
  const isCurrentMonth =
    calYear === now.getFullYear() && calMonth === now.getMonth() + 1;

  calMonthLabel.textContent = `${calYear}年${calMonth}月`;

  const firstDay = new Date(calYear, calMonth - 1, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  let html = "";

  for (let i = 0; i < startOffset; i++) {
    html += '<div class="day-cell empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const sessions = getFocusSessions(key);
    const hasFocus = sessions.length > 0;
    const isToday = isCurrentMonth && key === todayKey;
    let cls = "day-cell";
    if (isToday) cls += " today";

    html += `<div class="${cls}" data-date="${key}">${d}${hasFocus ? '<div class="day-dot"></div>' : ""}</div>`;
  }

  daysGrid.innerHTML = html;
}

// ── 日期点击 → 详情浮窗 ────────────────

// 时间段判定：根据开始时间戳返回时段名称
function getPeriod(ts) {
  if (ts == null) return "上午"; // 旧数据无时间信息默认归上午
  const h = new Date(ts).getHours();
  if (h >= 6 && h < 12) return "上午";
  if (h >= 12 && h < 18) return "下午";
  return "晚间"; // 18-23 及 0-5
}

// 将 sessions 按上午/下午/晚间分组，组内按开始时间排序
function groupSessionsByPeriod(sessions) {
  const groups = { "上午": [], "下午": [], "晚间": [] };
  sessions.forEach((s, i) => {
    const period = getPeriod(s ? s.start : null);
    groups[period].push({ ...s, _globalIndex: i });
  });
  // 每组内按开始时间升序排列，无时间的排末尾
  for (const period of Object.keys(groups)) {
    groups[period].sort((a, b) => {
      if (a.start == null && b.start == null) return 0;
      if (a.start == null) return 1;
      if (b.start == null) return -1;
      return a.start - b.start;
    });
  }
  return groups;
}

// 渲染单条记录行 HTML
function renderPeriodItem(s, i) {
  if (s === null) {
    return `<div class="period-item" data-index="${i}">
      <span class="type-tag">专注</span>
      <span class="item-time">时间不详（旧数据）</span>
      <span class="detail-actions">
        <button class="detail-del-btn" data-action="delete" data-index="${i}" title="删除">✕</button>
      </span>
    </div>`;
  }
  const taskType = s.type || "专注";
  const start = s.start ? formatTime(s.start) : "??:??";
  const end = s.end ? formatTime(s.end) : "??:??";
  const startTimeVal = s.start ? timestampToTimeString(s.start) : "";
  const endTimeVal = s.end ? timestampToTimeString(s.end) : "";
  return `<div class="period-item" data-index="${i}">
    <span class="item-time">${start}<span class="time-sep"> – </span>${end}</span>
    <span class="type-tag">${taskType}</span>
    <span class="detail-actions">
      <button class="detail-edit-btn" data-action="edit" data-index="${i}" data-start="${startTimeVal}" data-end="${endTimeVal}" data-type="${taskType}" title="编辑">✎</button>
      <button class="detail-del-btn" data-action="delete" data-index="${i}" title="删除">✕</button>
    </span>
  </div>`;
}

// 获取某个 period 对应的 list DOM
function getPeriodListEl(period) {
  if (period === "上午") return periodMorning;
  if (period === "下午") return periodAfternoon;
  return periodEvening;
}

function showDayDetail(dateKey, cell) {
  const sessions = getFocusSessions(dateKey);
  const [y, m, d] = dateKey.split("-");
  detailDate.textContent = `${y}年${parseInt(m)}月${parseInt(d)}日`;
  detailCount.textContent = sessions.length > 0 ? `共专注 ${sessions.length} 个番茄钟` : "无专注记录";

  // 存储当前查看的日期和格子引用，供后续编辑使用
  dayDetail._dateKey = dateKey;
  dayDetail._cell = cell;

  const groups = groupSessionsByPeriod(sessions);

  // 渲染每个时段
  ["上午", "下午", "晚间"].forEach(period => {
    const list = getPeriodListEl(period);
    const items = groups[period];
    const countEl = list.parentElement.querySelector(".period-count");
    const timeRange = period === "上午" ? "6:00 – 11:59" : period === "下午" ? "12:00 – 17:59" : "18:00 – 次日 5:59";

    if (items.length === 0) {
      countEl.textContent = timeRange + " · 无";
      list.innerHTML = '<div class="period-empty">—</div>';
    } else {
      countEl.textContent = timeRange + " · 专注 " + items.length + " 个番茄钟";
      list.innerHTML = items.map(s => renderPeriodItem(s, s._globalIndex)).join("");
    }
  });

  // 定位浮窗
  positionDayDetail(cell);

  const close = (e) => {
    if (!dayDetail.contains(e.target) && e.target !== cell) {
      dayDetail.classList.remove("show");
      document.removeEventListener("click", close);
    }
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}

function positionDayDetail(cell) {
  const cellRect = cell.getBoundingClientRect();
  let top = cellRect.top - 8;
  let left = cellRect.left + cellRect.width / 2;

  dayDetail.style.top = "auto";
  dayDetail.style.bottom = "auto";
  dayDetail.style.left = "auto";
  dayDetail.style.right = "auto";

  dayDetail.classList.add("show");
  const dh = dayDetail.offsetHeight;

  if (top - dh < 16) {
    top = cellRect.bottom + 8;
  } else {
    top = top - dh;
  }

  dayDetail.style.top = `${top}px`;
  dayDetail.style.left = `${Math.max(16, Math.min(left, window.innerWidth - 176))}px`;
  dayDetail.style.transform = "translateX(-50%) translateY(0)";
}

function refreshAfterEdit() {
  const dateKey = dayDetail._dateKey;
  if (!dateKey) return;
  updateTodayCount();
  updateCalendar(calYear, calMonth);
  const cell = daysGrid.querySelector(`.day-cell[data-date="${dateKey}"]`);
  if (cell) {
    showDayDetail(dateKey, cell);
  } else {
    hideDayDetail();
  }
}

// 开始编辑某条记录或新增记录
function startEditSession(dateKey, index) {
  const sessions = getFocusSessions(dateKey);
  const session = index >= 0 ? sessions[index] : null;
  const isNew = index < 0;

  const startVal = (session && session.start) ? timestampToTimeString(session.start) : "";
  const endVal = (session && session.end) ? timestampToTimeString(session.end) : "";
  const typeVal = (session && session.type) || "无类型";
  const visibleTypes = getVisibleTypes();
  const typeOptions = visibleTypes.map(t =>
    `<option value="${t}" ${t === typeVal ? "selected" : ""}>${t}</option>`
  ).join("");

  const formHtml = `
    <div class="detail-edit-form" data-edit-index="${index}">
      <select class="edit-type">${typeOptions}</select>
      <input type="time" class="edit-start" value="${startVal}">
      <span class="time-sep">–</span>
      <input type="time" class="edit-end" value="${endVal}">
      <button class="detail-save-btn" data-action="save" data-index="${index}">保存</button>
      <button class="detail-cancel-btn" data-action="cancel" data-index="${index}">取消</button>
    </div>
  `;

  // 移除已有的编辑表单
  const existingForm = detailPeriods.querySelector(".detail-edit-form");
  if (existingForm) existingForm.remove();

  let formEl;
  if (isNew) {
    // 新增：插入到晚间时段末尾（或唯一可见时段）
    const targetList = periodEvening.querySelector(".period-empty") ? periodEvening : periodEvening;
    targetList.insertAdjacentHTML("beforeend", formHtml);
    formEl = targetList.querySelector(".detail-edit-form");
  } else {
    // 编辑：找到对应行并替换
    const item = detailPeriods.querySelector(`.period-item[data-index="${index}"]`);
    if (!item) return;
    item.insertAdjacentHTML("afterend", formHtml);
    formEl = item.nextElementSibling;
    item.style.display = "none";
  }

  // 自动填充
  if (formEl) {
    const startInput = formEl.querySelector(".edit-start");
    const endInput = formEl.querySelector(".edit-end");

    startInput.addEventListener("change", () => {
      if (startInput.value && !endInput.value) {
        endInput.value = addMinutesToTime(startInput.value, 25);
      }
    });

    endInput.addEventListener("change", () => {
      if (endInput.value && !startInput.value) {
        startInput.value = addMinutesToTime(endInput.value, -25);
      }
    });
  }
}

// 保存编辑
function saveEditSession(dateKey, index, startStr, endStr, type) {
  if (!startStr || !endStr) {
    alert("请填写开始和结束时间");
    return;
  }
  const start = timeToTimestamp(dateKey, startStr);
  const end = timeToTimestamp(dateKey, endStr);
  if (start >= end) {
    alert("结束时间必须晚于开始时间");
    return;
  }
  if (index >= 0) {
    editFocusSession(dateKey, index, start, end, type);
  } else {
    addFocusSession(dateKey, start, end, type);
  }
  addCustomType(type);
  refreshAfterEdit();
}

// 取消编辑
function cancelEditSession(dateKey, index) {
  if (index >= 0) {
    const item = detailPeriods.querySelector(`.period-item[data-index="${index}"]`);
    if (item) item.style.display = "";
  }
  const form = detailPeriods.querySelector(".detail-edit-form");
  if (form) form.remove();
}

// ── 日期详情浮窗内的事件委托 ──────────
detailPeriods.addEventListener("click", (e) => {
  const dateKey = dayDetail._dateKey;
  if (!dateKey) return;

  const editBtn = e.target.closest("[data-action='edit']");
  if (editBtn) {
    startEditSession(dateKey, parseInt(editBtn.dataset.index, 10));
    return;
  }

  const delBtn = e.target.closest("[data-action='delete']");
  if (delBtn) {
    if (confirm("确定删除这个番茄钟吗？")) {
      removeFocusSession(dateKey, parseInt(delBtn.dataset.index, 10));
      refreshAfterEdit();
    }
    return;
  }

  const saveBtn = e.target.closest("[data-action='save']");
  if (saveBtn) {
    const index = parseInt(saveBtn.dataset.index, 10);
    const form = saveBtn.closest(".detail-edit-form");
    const startInput = form.querySelector(".edit-start");
    const endInput = form.querySelector(".edit-end");
    const typeSelect = form.querySelector(".edit-type");
    const type = typeSelect ? typeSelect.value : "无类型";
    saveEditSession(dateKey, index, startInput.value, endInput.value, type);
    return;
  }

  const cancelBtn = e.target.closest("[data-action='cancel']");
  if (cancelBtn) {
    cancelEditSession(dateKey, parseInt(cancelBtn.dataset.index, 10));
    return;
  }
});

// ── 添加按钮 ──────────────────────────
document.getElementById("detail-add-btn").addEventListener("click", () => {
  const dateKey = dayDetail._dateKey;
  if (!dateKey) return;
  startEditSession(dateKey, -1);
});

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 事件委托：月历点击
daysGrid.addEventListener("click", (e) => {
  const cell = e.target.closest(".day-cell");
  if (!cell || cell.classList.contains("empty")) return;
  const dateKey = cell.dataset.date;
  if (!dateKey) return;
  hideDayDetail();
  showDayDetail(dateKey, cell);
});

function hideDayDetail() {
  dayDetail.classList.remove("show");
}

// ── 浏览器系统通知 ────────────────────
let notificationPermissionRequested = false;

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  if (notificationPermissionRequested) return;
  notificationPermissionRequested = true;
  Notification.requestPermission();
}

function sendSystemNotification(msg) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // 如果页面可见，不需要系统通知（ toast 已经够显眼）
  if (document.visibilityState === "visible") return;

  const n = new Notification("🍅 番茄时钟", {
    body: msg,
    icon: "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text x="8" y="52" font-size="52">🍅</text></svg>'
    ),
    tag: "tomato-timer",
    requireInteraction: false,
  });

  n.onclick = () => {
    n.close();
    window.focus();
  };

  // 5 秒后自动关闭
  setTimeout(() => n.close(), 5000);
}

// ── 标题闪烁（页面不可见时） ──────────
let titleFlashTimer = null;
const originalTitle = document.title;

function startTitleFlash(msg) {
  if (document.visibilityState === "visible") return;
  if (titleFlashTimer) return;

  const flashMessages = [msg, originalTitle];
  let idx = 0;

  titleFlashTimer = setInterval(() => {
    document.title = flashMessages[idx];
    idx = (idx + 1) % 2;
  }, 1000);
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
  }
  document.title = originalTitle;
}

// 页面重新可见时自动停止闪烁
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    stopTitleFlash();
  }
});

// ── 提示音 &  toast ───────────────────
function playAlarmSound() {
  const msg =
    currentMode === "work"
      ? "专注时间结束，休息一下 ☕"
      : "休息结束，开始专注吧 💪";
  showNotification(msg);
  sendSystemNotification(msg);
  startTitleFlash(msg);
  playChime(3);
}

function showNotification(msg) {
  notifyMessage.textContent = msg;

  // 清除旧定时器
  if (toast._autoHideId) {
    clearTimeout(toast._autoHideId);
    toast._autoHideId = null;
  }
  // 清除旧关闭回调
  if (toast._onClose) {
    toastCloseBtn.removeEventListener("click", toast._onClose);
  }

  // 强制关闭 → 重排 → 重新打开，保证动画每次都触发
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");

  const hide = () => {
    toast.classList.remove("show");
    if (toast._autoHideId) {
      clearTimeout(toast._autoHideId);
      toast._autoHideId = null;
    }
    toastCloseBtn.removeEventListener("click", hide);
    toast._onClose = null;
  };

  // 点击关闭按钮
  toastCloseBtn.addEventListener("click", hide);
  toast._onClose = hide;

  // 提示音结束后自动消失（3 秒叮咚 + 0.3 秒余量）
  toast._autoHideId = setTimeout(hide, 3300);
}

function playChime(durationSec) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = ctx.currentTime;
    const notes = [523.25, 659.25];
    const noteLen = 0.3;

    for (let i = 0; i < durationSec / noteLen; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = notes[i % 2];

      const start = t0 + i * noteLen;
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + noteLen);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + noteLen);
    }
  } catch (e) {
    // 浏览器自动播放策略可能阻止 AudioContext
  }
}

// ── 事件绑定 ──────────────────────────
btnStartFocus.addEventListener("click", () => {
  hideDayDetail();
  requestNotificationPermission();
  startTimer();
});

startPauseBtn.addEventListener("click", () => {
  hideDayDetail();
  if (isRunning) {
    pauseTimer();
  }
});

resetBtn.addEventListener("click", () => {
  hideDayDetail();
  resetTimer();
});

// ── 任务类型选择 ──────────────────────
taskTypeRow.addEventListener("click", (e) => {
  // 删除自定义类型
  const delBtn = e.target.closest("[data-action='del-type']");
  if (delBtn) {
    e.stopPropagation();
    const type = delBtn.dataset.type;
    if (confirm(`删除类型「${type}」？`)) removeCustomType(type);
    return;
  }

  const btn = e.target.closest(".task-type-btn");
  if (!btn || isRunning) return;

  const type = btn.dataset.type;
  const input = taskTypeRow.querySelector("#task-type-input");

  if (type === "__custom__") {
    // 切换到自定义输入
    taskTypeRow.querySelectorAll(".task-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (input) {
      input.style.display = "";
      input.focus();
      currentTaskType = input.value.trim() || "";
    }
  } else {
    if (input) {
      input.style.display = "none";
      input.value = "";
    }
    taskTypeRow.querySelectorAll(".task-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTaskType = type;
  }
});

// 事件委托：自定义输入
taskTypeRow.addEventListener("input", (e) => {
  if (e.target.id === "task-type-input") {
    currentTaskType = e.target.value.trim() || "";
  }
});

taskTypeRow.addEventListener("keydown", (e) => {
  if (e.target.id === "task-type-input" && e.key === "Enter") {
    e.preventDefault();
    e.target.blur();
  }
});

document.getElementById("cal-prev").addEventListener("click", () => {
  hideDayDetail();
  if (calMonth === 1) {
    calMonth = 12;
    calYear--;
  } else {
    calMonth--;
  }
  updateCalendar(calYear, calMonth);
});

document.getElementById("cal-next").addEventListener("click", () => {
  hideDayDetail();
  if (calMonth === 12) {
    calMonth = 1;
    calYear++;
  } else {
    calMonth++;
  }
  updateCalendar(calYear, calMonth);
});

// 点击日历区域外关闭详情
document.addEventListener("click", (e) => {
  if (!dayDetail.contains(e.target) && !e.target.closest(".day-cell")) {
    hideDayDetail();
  }
});

// ── 初始化 ────────────────────────────
function init() {
  try {
    loadFocusData();
    loadTypeData();
    renderTaskTypeRow();
    buildWeekdayRow();
    updateDateDisplay();
    updateTodayCount();
    updateCalendar(
      new Date().getFullYear(),
      new Date().getMonth() + 1
    );

    // 恢复上次的计时状态（刷新不丢失）
    const saved = loadTimerState();
    if (saved) {
      console.log("[番茄时钟] 尝试恢复状态...");
      currentMode = saved.currentMode || "work";
      sessionStartTime = saved.sessionStartTime || null;

      if (saved.isRunning && saved.endTime) {
        // 之前正在跑，用绝对时间戳算剩余秒数
        const remaining = Math.max(0, Math.round((saved.endTime - Date.now()) / 1000));
        console.log("[番茄时钟] 恢复运行中，剩余秒数:", remaining);
        if (remaining > 0) {
          timeLeft = remaining;
          updateModeUI();
          updateTimerDisplay();
          startTimer(); // 恢复倒计时
          console.log("[番茄时钟] ✅ 倒计时已恢复");
          persistIndicator.textContent = "";
          persistIndicator.className = "persist-indicator default";
          showNotification("倒计时已恢复");
        } else {
          // 刷新期间计时已到，模拟 tick 结束逻辑
          console.log("[番茄时钟] 计时在刷新期间结束，触发结束逻辑");
          persistIndicator.textContent = "";
          persistIndicator.className = "persist-indicator default";
          clearTimerState();
          updateModeUI();
          updateTimerDisplay();
          setTimeout(() => {
            playAlarmSound();
            if (currentMode === "work") {
              recordFocus();
              updateTodayCount();
              updateCalendar();
              currentMode = "break";
              timeLeft = BREAK;
              updateModeUI();
              updateTimerDisplay();
              startTimer();
            } else {
              currentMode = "work";
              timeLeft = WORK;
              updateModeUI();
              updateTimerDisplay();
              startPauseBtn.textContent = "开始";
              taskTypeSection.style.display = "";
              controls.style.display = "none";
              focusTypeIndicator.style.display = "none";
            }
          }, 200);
        }
      } else {
        // 之前暂停了，直接恢复显示
        timeLeft = saved.timeLeft != null ? saved.timeLeft : WORK;
        updateModeUI();
        updateTimerDisplay();
        console.log("[番茄时钟] ✅ 暂停状态已恢复:", timeLeft, "秒");
        persistIndicator.textContent = "";
        persistIndicator.className = "persist-indicator default";
        showNotification("已恢复暂停状态");
      }
    } else {
      console.log("[番茄时钟] 无已保存状态，使用默认值");
      persistIndicator.textContent = "";
      persistIndicator.className = "persist-indicator default";
      updateTimerDisplay();
      updateModeUI();
    }
  } catch (e) {
    console.error("[番茄时钟] 初始化出错:", e);
    persistIndicator.textContent = "初始化出错，查看控制台";
    persistIndicator.className = "persist-indicator error";
    // 出错时回退到默认状态
    updateTimerDisplay();
    updateModeUI();
  }
}

// ── 页面卸载前保存状态（兜底） ────────
window.addEventListener("beforeunload", () => {
  if (isRunning || timeLeft !== WORK || currentMode !== "work") {
    saveTimerState();
    console.log("[番茄时钟] beforeunload 保存");
  }
});

// 页面隐藏时也保存一次（切标签页等场景）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && (isRunning || timeLeft !== WORK || currentMode !== "work")) {
    saveTimerState();
    console.log("[番茄时钟] visibilitychange 保存");
  }
});

init();
