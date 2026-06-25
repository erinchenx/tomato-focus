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

// ── Supabase 配置 ──────────────────────
const SUPABASE_URL = "https://godpcmioyidqnonwbhqr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ADgGALRfPkKU2tBLe5nJnQ_wcDj5kbb";

let supabase = null;
let currentUser = null;
let syncDirty = false;
let syncTimer = null;

async function initSupabase() {
  try {
    // 动态加载 Supabase SDK，失败不影响本地功能
    const mod = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("[番茄时钟] Supabase 已初始化");
    return true;
  } catch (e) {
    console.warn("[番茄时钟] Supabase 初始化失败（离线或网络问题），仅本地模式可用", e);
  }
  return false;
}

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
const periodDawn = document.getElementById("period-dawn");
const persistIndicator = document.getElementById("persist-indicator");
const timerSection = document.querySelector(".timer-section");
const taskTypeSection = document.getElementById("task-type-section");
const taskTypeRow = document.getElementById("task-type-row");
const focusTypeIndicator = document.getElementById("focus-type-indicator");
const btnStartFocus = document.getElementById("btn-start-focus");
const taskNoteInput = document.getElementById("task-note-input");
const controls = document.getElementById("controls");
const authBtn = document.getElementById("auth-btn");
const authOverlay = document.getElementById("auth-overlay");
const authClose = document.getElementById("auth-close");
const authForm = document.getElementById("auth-form");
const authFormSection = document.getElementById("auth-form-section");
const authLoggedIn = document.getElementById("auth-logged-in");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authUserEmail = document.getElementById("auth-user-email");
const authAvatar = document.getElementById("auth-avatar");
const authDisplayName = document.getElementById("auth-display-name");
const authDisplayNameText = document.getElementById("auth-display-name-text");
const authNameEditInput = document.getElementById("auth-name-edit-input");
const authTabLogin = document.getElementById("auth-tab-login");
const authTabRegister = document.getElementById("auth-tab-register");
const authSyncStatus = document.getElementById("auth-sync-status");
const typeMgrOverlay = document.getElementById("type-mgr-overlay");
const typeMgrList = document.getElementById("type-mgr-list");
const typeMgrAddInput = document.getElementById("type-mgr-add-input");
const typeMgrAddBtn = document.getElementById("type-mgr-add-btn");
const typeMgrDoneBtn = document.getElementById("type-mgr-done-btn");

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
let currentNote = "";            // 当前备注
let calYear, calMonth;
let typeMgrOriginalType = null;  // 类型管理弹窗关闭时恢复的下拉框选中值

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

function cleanFocusDataOverlaps() {
  let removed = 0;
  for (const [dateKey, sessions] of Object.entries(focusData)) {
    if (!Array.isArray(sessions) || sessions.length < 2) continue;

    // 收集有效索引（非 null，有 start/end），按 start 排序
    const valid = sessions
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s && s.start && s.end)
      .sort((a, b) => a.s.start - b.s.start);

    const toRemove = new Set();

    for (let ai = 0; ai < valid.length; ai++) {
      if (toRemove.has(valid[ai].i)) continue;
      const a = valid[ai].s;

      for (let bj = ai + 1; bj < valid.length; bj++) {
        if (toRemove.has(valid[bj].i)) continue;
        const b = valid[bj].s;

        // 时间段重叠
        if (a.start < b.end && b.start < a.end) {
          // 保留第一条（先记录的），移除后出现的重复
          toRemove.add(valid[bj].i);
          console.log("[番茄时钟] 本地去重（时间重叠）:", dateKey,
            timestampToTimeString(b.start), "-", timestampToTimeString(b.end),
            "(被移除，与", timestampToTimeString(a.start), "-", timestampToTimeString(a.end), "重叠)");
        }
      }
    }

    if (toRemove.size > 0) {
      // 从后往前删，保持索引不偏移
      const sorted = [...toRemove].sort((a, b) => b - a);
      sorted.forEach(i => sessions.splice(i, 1));
      removed += sorted.length;
      if (sessions.length === 0) delete focusData[dateKey];
    }
  }
  if (removed > 0) {
    console.log("[番茄时钟] 本地去重完成，共移除", removed, "条重复记录");
  }
}

function saveFocusData() {
  cleanFocusDataOverlaps();
  localStorage.setItem("focusData", JSON.stringify(focusData));
  if (currentUser) { syncDirty = true; schedulePush(); }
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
let deletedDefaults = [];  // 永久删除的默认类型
let typeOrder = [];        // 类型显示顺序
let defaultType = null;    // 默认专注类型

function loadTypeData() {
  try {
    const raw = localStorage.getItem("customTypes");
    if (raw) customTypes = JSON.parse(raw);
  } catch (_) { customTypes = []; }
  try {
    const raw = localStorage.getItem("hiddenTypes");
    if (raw) hiddenTypes = JSON.parse(raw);
  } catch (_) { hiddenTypes = []; }
  try {
    defaultType = localStorage.getItem("defaultType") || null;
  } catch (_) { defaultType = null; }
  try {
    const raw = localStorage.getItem("deletedDefaults");
    if (raw) deletedDefaults = JSON.parse(raw);
  } catch (_) { deletedDefaults = []; }
  try {
    const raw = localStorage.getItem("typeOrder");
    if (raw) typeOrder = JSON.parse(raw);
  } catch (_) { typeOrder = []; }
}

function saveDefaultType() {
  if (defaultType) {
    localStorage.setItem("defaultType", defaultType);
  } else {
    localStorage.removeItem("defaultType");
  }
  if (currentUser) { syncDirty = true; schedulePush(); }
}

function saveCustomTypes() {
  localStorage.setItem("customTypes", JSON.stringify(customTypes));
  if (currentUser) { syncDirty = true; schedulePush(); }
}

function saveHiddenTypes() {
  localStorage.setItem("hiddenTypes", JSON.stringify(hiddenTypes));
  if (currentUser) { syncDirty = true; schedulePush(); }
}

function saveDeletedDefaults() {
  localStorage.setItem("deletedDefaults", JSON.stringify(deletedDefaults));
  if (currentUser) { syncDirty = true; schedulePush(); }
}

function saveTypeOrder() {
  localStorage.setItem("typeOrder", JSON.stringify(typeOrder));
  if (currentUser) { syncDirty = true; schedulePush(); }
}

function addCustomType(type) {
  if (!type) return;
  // 如果是被永久删除的默认类型，恢复它
  if (DEFAULT_TYPES.includes(type)) {
    const didx = deletedDefaults.indexOf(type);
    if (didx >= 0) { deletedDefaults.splice(didx, 1); saveDeletedDefaults(); }
    const hidx = hiddenTypes.indexOf(type);
    if (hidx >= 0) { hiddenTypes.splice(hidx, 1); saveHiddenTypes(); }
    renderTaskTypeRow();
    return;
  }
  if (customTypes.includes(type)) return;
  customTypes.push(type);
  saveCustomTypes();
  // 新增类型添加到排序末尾
  if (!typeOrder.includes(type)) {
    typeOrder.push(type);
    saveTypeOrder();
  }
  renderTaskTypeRow();
}

// 获取所有可用类型（含隐藏，不含永久删除），按 typeOrder 排序
function getAllTypesOrdered() {
  const all = [...DEFAULT_TYPES.filter(t => !deletedDefaults.includes(t)), ...customTypes];
  if (typeOrder.length > 0) {
    all.sort((a, b) => {
      const ai = typeOrder.indexOf(a), bi = typeOrder.indexOf(b);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  return all;
}

// 获取当前可见的类型列表（隐藏的默认类型不显示）
function getVisibleTypes() {
  return getAllTypesOrdered().filter(t => !hiddenTypes.includes(t));
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
  if (defaultType === type) { defaultType = null; saveDefaultType(); }
  renderTaskTypeRow();
}

// 永久删除类型（专注类型管理弹窗用）
function permanentDeleteType(type) {
  if (DEFAULT_TYPES.includes(type)) {
    if (!deletedDefaults.includes(type)) {
      deletedDefaults.push(type);
      saveDeletedDefaults();
    }
    // 也从隐藏列表中移除
    const hidx = hiddenTypes.indexOf(type);
    if (hidx >= 0) { hiddenTypes.splice(hidx, 1); saveHiddenTypes(); }
  } else {
    const idx = customTypes.indexOf(type);
    if (idx >= 0) { customTypes.splice(idx, 1); saveCustomTypes(); }
  }
  // 从排序中移除
  const oidx = typeOrder.indexOf(type);
  if (oidx >= 0) { typeOrder.splice(oidx, 1); saveTypeOrder(); }
  if (currentTaskType === type) currentTaskType = "无类型";
  if (defaultType === type) { defaultType = null; saveDefaultType(); }
  renderTaskTypeRow();
}

// 移动类型排序位置
function moveTypeOrder(type, direction) {
  const all = getAllTypesOrdered();
  const idx = all.indexOf(type);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= all.length) return;
  // 更新 typeOrder
  typeOrder = all;
  [typeOrder[idx], typeOrder[newIdx]] = [typeOrder[newIdx], typeOrder[idx]];
  saveTypeOrder();
}

// 动态渲染任务类型按钮
function renderTaskTypeRow() {
  const allTypes = getVisibleTypes();
  const activeType = currentTaskType || "无类型";

  taskTypeRow.innerHTML =
    allTypes.map(t => {
      return `<button class="task-type-btn${t === activeType ? " active" : ""}" data-type="${t}">${t}<span class="type-del" data-action="del-type" data-type="${t}">✕</span></button>`;
    }).join("") +
    `<button class="task-type-btn task-type-manage-btn" data-type="__custom__">+ 自定义</button>`;
}

// 检查番茄钟时间是否与已有记录重叠（不允许时间重复）
function hasTimeOverlap(dateKey, start, end, excludeIndex) {
  const sessions = getFocusSessions(dateKey);
  for (let i = 0; i < sessions.length; i++) {
    if (i === excludeIndex) continue;
    const s = sessions[i];
    if (!s) continue;
    // 如果旧记录缺少时间信息（null），新记录有时会被误判为非重叠
    // 保守策略：如果旧数据没有 start/end，视为未知，不跳过，用宽松匹配
    if (!s.start || !s.end) {
      // 旧数据无时间：如果新记录也没有 start/end → 视为重复
      if (!start || !end) return true;
      // 新记录有时间但旧数据无时间：无法判断，跳过（保留旧数据不阻碍新记录）
      continue;
    }
    // 新记录缺少时间：只要旧记录有时间，按宽松比较（start==null 当作 0 处理）
    const a = start ?? 0;
    const b = end ?? 0;
    // 两个时间段有交集即为重叠
    if (a < s.end && b > s.start) return true;
  }
  return false;
}

function recordFocus() {
  const key = getDateKey();
  const start = sessionStartTime;
  const end = Date.now();

  // 检查时间重叠，防止重复记录
  if (hasTimeOverlap(key, start, end, -1)) {
    console.warn("[番茄时钟] 检测到重复番茄钟，已跳过记录:", new Date(start).toLocaleTimeString());
    // 独立 toast：不依赖 showNotification，避免状态冲突
    notifyMessage.textContent = "⚠️ 该时段已有记录，已跳过";
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1500);
    return;
  }

  if (!Array.isArray(focusData[key])) focusData[key] = [];
  const type = currentTaskType || "无类型";
  const note = currentNote.trim();
  focusData[key].push({
    start: start,
    end: end,
    type: type,
    note: note || "",
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

function addFocusSession(dateKey, start, end, type, note) {
  if (!Array.isArray(focusData[dateKey])) focusData[dateKey] = [];
  // 防御性检查：防止添加时间重叠的记录
  if (start && end && hasTimeOverlap(dateKey, start, end, -1)) {
    console.warn("[番茄时钟] addFocusSession 检测到重复番茄钟，已跳过:", dateKey, timestampToTimeString(start));
    return;
  }
  focusData[dateKey].push({ start, end, type: type || "无类型", note: note || "" });
  saveFocusData();
}

function editFocusSession(dateKey, index, start, end, type, note) {
  if (!Array.isArray(focusData[dateKey])) return;
  focusData[dateKey][index] = { start, end, type: type || "无类型", note: note || "" };
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
  timerSection.classList.add("running");
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
        sessionStartTime = null; // 本段专注已结束，清空等待下一轮
        updateTodayCount();
        updateCalendar();
        currentMode = "break";
        timeLeft = BREAK;
        updateModeUI();
        updateTimerDisplay();
        startTimer();
      } else {
        sessionStartTime = null; // 休息结束，清空准备新专注
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
  // 暂停后保持控制按钮可见，根据当前模式切换文字
  startPauseBtn.textContent = currentMode === "work" ? "继续专注" : "继续休息";
  saveTimerState();
}

function resetTimer() {
  pauseTimer();
  currentMode = "work";
  timeLeft = WORK;
  currentTaskType = "无类型";
  currentNote = "";
  sessionStartTime = null; // 重置：清除上次专注开始时间
  taskNoteInput.value = "";
  updateModeUI();
  updateTimerDisplay();
  renderTaskTypeRow();
  clearTimerState();
  // 回到空闲状态：显示任务类型，隐藏控制按钮
  timerSection.classList.remove("running");
  taskTypeSection.style.display = "";
  controls.style.display = "none";
  focusTypeIndicator.style.display = "none";
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
  updateCalendarStats();
}

function updateCalendarStats() {
  const now = new Date();
  const year = calYear ?? now.getFullYear();
  const month = calMonth ?? now.getMonth() + 1;

  let totalMinutes = 0;
  let totalPomos = 0;
  let focusedDays = 0;

  for (const [key, sessions] of Object.entries(focusData)) {
    const [ky, km] = key.split("-").map(Number);
    if (ky !== year || km !== month) continue;
    if (!Array.isArray(sessions) || sessions.length === 0) continue;

    focusedDays++;
    totalPomos += sessions.length;

    for (const s of sessions) {
      if (s && s.start && s.end) {
        totalMinutes += (s.end - s.start) / 60;
      } else {
        totalMinutes += 25; // 默认一个番茄钟（25分钟）
      }
    }
  }

  const totalHours = totalMinutes / 60;
  const activeDays = Math.max(focusedDays, 1);

  const avgPomos = (totalPomos / activeDays).toFixed(1);

  document.getElementById("cal-stat-days").textContent = focusedDays;
  document.getElementById("cal-stat-avg-pomos").textContent = avgPomos;
}

// ── 日期点击 → 详情浮窗 ────────────────

// 时间段判定：根据开始时间戳返回时段名称
function getPeriod(ts) {
  if (ts == null) return "上午"; // 旧数据无时间信息默认归上午
  const h = new Date(ts).getHours();
  if (h >= 6 && h < 12) return "上午";
  if (h >= 12 && h < 18) return "下午";
  if (h >= 18) return "晚间";
  return "凌晨"; // 0-5
}

// 将 sessions 按上午/下午/晚间分组，组内按开始时间排序
function groupSessionsByPeriod(sessions) {
  const groups = { "凌晨": [], "上午": [], "下午": [], "晚间": [] };
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
  const note = s.note || "";
  const start = s.start ? formatTime(s.start) : "??:??";
  const end = s.end ? formatTime(s.end) : "??:??";
  const startTimeVal = s.start ? timestampToTimeString(s.start) : "";
  const endTimeVal = s.end ? timestampToTimeString(s.end) : "";
  const noteAttr = note ? ` data-note="${note.replace(/"/g, '&quot;')}"` : "";
  return `<div class="period-item" data-index="${i}">
    <span class="item-time">${start}<span class="time-sep"> – </span>${end}</span>
    <span class="type-tag">${taskType}</span>
    ${note ? `<span class="item-note">${note}</span>` : ""}
    <span class="detail-actions">
      <button class="detail-edit-btn" data-action="edit" data-index="${i}" data-start="${startTimeVal}" data-end="${endTimeVal}" data-type="${taskType}"${noteAttr} title="编辑">✎</button>
      <button class="detail-del-btn" data-action="delete" data-index="${i}" title="删除">✕</button>
    </span>
  </div>`;
}

// 获取某个 period 对应的 list DOM
function getPeriodListEl(period) {
  if (period === "上午") return periodMorning;
  if (period === "下午") return periodAfternoon;
  if (period === "晚间") return periodEvening;
  return periodDawn;
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
  ["凌晨", "上午", "下午", "晚间"].forEach(period => {
    const list = getPeriodListEl(period);
    const items = groups[period];
    const countEl = list.parentElement.querySelector(".period-count");
    const timeRange = period === "上午" ? "6:00 – 12:00" : period === "下午" ? "12:00 – 18:00" : period === "晚间" ? "18:00 – 次日 0:00" : "0:00 – 6:00";

    if (items.length === 0) {
      countEl.textContent = timeRange + " · 无";
      list.innerHTML = '<div class="period-empty">—</div>';
    } else {
      countEl.textContent = timeRange + " · 专注 " + items.length + " 个番茄钟";
      list.innerHTML = items.map(s => renderPeriodItem(s, s._globalIndex)).join("");
    }
  });

  // 凌晨时段：无记录时隐藏整个区块
  const dawnBlock = periodDawn.closest(".period-block");
  if (dawnBlock) {
    dawnBlock.style.display = groups["凌晨"].length === 0 ? "none" : "";
  }

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
  dayDetail.style.maxHeight = "";
  dayDetail.style.top = "auto";
  dayDetail.style.bottom = "auto";
  dayDetail.style.left = "50%";
  dayDetail.style.transform = "translateX(-50%)";
  dayDetail.classList.add("show");

  // 从统计区下方一点开始
  const stats = document.getElementById("calendar-stats");
  if (stats) {
    const statsBottom = stats.getBoundingClientRect().bottom;
    dayDetail.style.top = `${statsBottom + 16}px`;
  }

  // 宽度：内容区对齐统计区（面板宽度 = 容器内容区 + 面板自身 padding）
  const container = document.querySelector(".container");
  if (container) {
    const cs = getComputedStyle(container);
    const containerContentW = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const detailCs = getComputedStyle(dayDetail);
    const detailPad = parseFloat(detailCs.paddingLeft) + parseFloat(detailCs.paddingRight);
    dayDetail.style.width = `${containerContentW + detailPad}px`;
  }

  // 限制高度不超出屏幕底部（留出 tab 栏空间）
  const tabBar = document.querySelector(".tab-bar");
  const tabTop = tabBar ? tabBar.getBoundingClientRect().top : window.innerHeight;
  const maxH = tabTop - parseFloat(dayDetail.style.top) - 8;
  if (maxH > 0) {
    dayDetail.style.maxHeight = `${maxH}px`;
  }
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
  const typeVal = (session && session.type) || (isNew && defaultType && getVisibleTypes().includes(defaultType) ? defaultType : "无类型");
  const noteVal = (session && session.note) || "";
  const visibleTypes = getVisibleTypes();
  const typeDropdownItems = visibleTypes.map(t =>
    `<button class="edit-type-opt" type="button" data-value="${t}">${t}</button>`
  ).join("") +
    `<div class="edit-type-sep"></div>` +
    `<button class="edit-type-opt edit-type-opt-settings" type="button" data-value="__type_settings__">选项设置</button>`;

  const formHtml = `
    <div class="detail-edit-form" data-edit-index="${index}">
      <div class="detail-edit-row">
        <div class="edit-type-custom">
          <button class="edit-type-btn" type="button">${typeVal}<span class="edit-type-arrow">▾</span></button>
          <div class="edit-type-dropdown">${typeDropdownItems}</div>
        </div>
        <input type="time" class="edit-start" value="${startVal}">
        <span class="time-sep">–</span>
        <input type="time" class="edit-end" value="${endVal}">
      </div>
      <div class="detail-edit-row">
        <input type="text" class="edit-note" value="${noteVal.replace(/"/g, '&quot;')}" placeholder="备注…" maxlength="50">
        <button class="detail-save-btn" data-action="save" data-index="${index}">保存</button>
        <button class="detail-cancel-btn" data-action="cancel" data-index="${index}">取消</button>
      </div>
    </div>
  `;

  // 移除已有的编辑表单
  const existingForm = detailPeriods.querySelector(".detail-edit-form");
  if (existingForm) existingForm.remove();

  let formEl;
  if (isNew) {
    // 新增：插入到所有时段末尾
    detailPeriods.insertAdjacentHTML("beforeend", formHtml);
    formEl = detailPeriods.querySelector(".detail-edit-form:last-of-type");
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

    // 自动填充：debounce 确保用户输入完毕后才计算
    let startTimer, endTimer;

    const scheduleEndFill = () => {
      clearTimeout(startTimer);
      if (startInput.value) {
        startTimer = setTimeout(() => {
          endInput.value = addMinutesToTime(startInput.value, 25);
        }, 300);
      }
    };

    const scheduleStartFill = () => {
      clearTimeout(endTimer);
      if (endInput.value) {
        endTimer = setTimeout(() => {
          startInput.value = addMinutesToTime(endInput.value, -25);
        }, 300);
      }
    };

    startInput.addEventListener("input", scheduleEndFill);
    startInput.addEventListener("change", scheduleEndFill);

    endInput.addEventListener("input", scheduleStartFill);
    endInput.addEventListener("change", scheduleStartFill);

    // 自定义类型下拉框交互
    const typeCustom = formEl.querySelector(".edit-type-custom");
    if (typeCustom) {
      const typeBtn = typeCustom.querySelector(".edit-type-btn");
      const typeDropdown = typeCustom.querySelector(".edit-type-dropdown");
      typeCustom.dataset.originalType = typeVal;

      // 点击按钮切换下拉
      typeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = typeDropdown.classList.contains("show");
        // 关闭所有其他下拉
        document.querySelectorAll(".edit-type-dropdown.show").forEach(d => d.classList.remove("show"));
        if (!isOpen) typeDropdown.classList.add("show");
      });

      // 点击选项
      typeDropdown.addEventListener("click", (e) => {
        const opt = e.target.closest(".edit-type-opt");
        if (!opt) return;
        const val = opt.dataset.value;
        if (val === "__type_settings__") {
          typeMgrOriginalType = typeCustom.dataset.originalType;
          typeDropdown.classList.remove("show");
          openTypeManagerModal();
        } else {
          typeBtn.childNodes[0].textContent = val;
          typeCustom.dataset.originalType = val;
          typeDropdown.classList.remove("show");
        }
      });
    }

    // 表单插入后重新定位面板，防止底部被折叠
    if (dayDetail._cell) {
      positionDayDetail(dayDetail._cell);
    }
  }
}

// ── 类型管理弹窗 ──────────────────────

function openTypeManagerModal() {
  renderTypeManagerList();
  typeMgrAddInput.value = "";
  typeMgrOverlay.classList.add("show");
}

function closeTypeManagerModal() {
  typeMgrOverlay.classList.remove("show");
  refreshEditTypeSelect();
}

function renderTypeManagerList() {
  const allTypes = getAllTypesOrdered();
  let html = "";

  allTypes.forEach((type) => {
    const isDefault = type === defaultType;
    const isHidden = hiddenTypes.includes(type);

    let row = `<div class="type-mgr-item" draggable="true" data-type="${type}">`;
    // 拖拽手柄
    row += `<span class="type-mgr-drag-handle" title="拖拽排序">⋮⋮</span>`;

    if (isHidden) {
      row += `<span class="type-mgr-item-name dimmed">${type}</span>
        <span class="type-mgr-item-label">（已隐藏）</span>
        <button class="type-mgr-restore-btn" data-action="restore-type" data-type="${type}">恢复</button>`;
    } else {
      row += `<span class="type-mgr-item-name">${type}</span>`;
      if (isDefault) {
        row += `<span class="type-mgr-item-label type-mgr-default-label">默认</span>`;
      } else {
        row += `<button class="type-mgr-set-default-btn" data-action="set-default-type" data-type="${type}">设为默认</button>`;
      }
      row += `<button class="type-mgr-del-btn" data-action="delete-type" data-type="${type}" title="永久删除">✕</button>`;
    }
    row += `</div>`;
    html += row;
  });

  typeMgrList.innerHTML = html || '<div style="text-align:center;color:var(--text-secondary);opacity:0.5;padding:12px;">暂无类型</div>';
}

function refreshEditTypeSelect() {
  const form = detailPeriods.querySelector(".detail-edit-form");
  if (!form) return;
  const typeCustom = form.querySelector(".edit-type-custom");
  if (!typeCustom) return;

  let originalType = typeMgrOriginalType || typeCustom.dataset.originalType || "无类型";
  const visibleTypes = getVisibleTypes();

  // 如果设置了默认类型且可见，优先使用默认类型
  if (defaultType && visibleTypes.includes(defaultType)) {
    originalType = defaultType;
  }

  // 如果原类型被删了，兜底到第一个可见类型
  if (!visibleTypes.includes(originalType) && originalType !== "无类型") {
    originalType = visibleTypes.length > 0 ? visibleTypes[0] : "无类型";
  }

  // 更新按钮文字
  const typeBtn = typeCustom.querySelector(".edit-type-btn");
  if (typeBtn) typeBtn.childNodes[0].textContent = originalType;

  // 重建下拉选项
  const typeDropdown = typeCustom.querySelector(".edit-type-dropdown");
  if (typeDropdown) {
    typeDropdown.innerHTML = visibleTypes.map(t =>
      `<button class="edit-type-opt" type="button" data-value="${t}">${t}</button>`
    ).join("") +
      `<div class="edit-type-sep"></div>` +
      `<button class="edit-type-opt edit-type-opt-settings" type="button" data-value="__type_settings__">选项设置</button>`;
  }

  typeCustom.dataset.originalType = originalType;
}

// 保存编辑
function saveEditSession(dateKey, index, startStr, endStr, type, note) {
  if (!startStr || !endStr) {
    alert("请填写开始和结束时间");
    return;
  }

  const [startH, startM] = startStr.split(":").map(Number);
  const [endH, endM] = endStr.split(":").map(Number);

  // 结束时间早于开始时间 → 仅当 start ≥ 23:35 时允许跨天
  const endBeforeStart = (endH < startH) || (endH === startH && endM <= startM);
  if (endBeforeStart) {
    if (startH < 23 || (startH === 23 && startM < 35)) {
      alert("结束时间不能早于开始时间（仅23:35之后允许跨天记录）");
      return;
    }
  }

  let start = timeToTimestamp(dateKey, startStr);
  let end = timeToTimestamp(dateKey, endStr);

  // 开始时间在0:00之后（含0:00）计入下一天
  if (startH === 0) {
    start += 24 * 3600000;
    end += 24 * 3600000;
  }

  // 跨午夜：结束时间在开始时间之前或相同 → 自动加一天
  if (end <= start) {
    end += 24 * 3600000;
  }

  // 检查时间是否与已有记录重叠
  if (hasTimeOverlap(dateKey, start, end, index >= 0 ? index : -1)) {
    alert("该时段与已有番茄钟记录重叠，请调整时间");
    return;
  }
  if (index >= 0) {
    editFocusSession(dateKey, index, start, end, type, note);
  } else {
    addFocusSession(dateKey, start, end, type, note);
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
    const typeCustom = form.querySelector(".edit-type-custom");
    const noteInput = form.querySelector(".edit-note");
    const rawType = typeCustom ? (typeCustom.dataset.originalType || "无类型") : "无类型";
    const type = (rawType === "__type_settings__") ? "无类型" : rawType;
    const note = noteInput ? noteInput.value : "";
    // 保存时兜底自动填充（防止 debounce 未触发）
    if (startInput.value && !endInput.value) {
      endInput.value = addMinutesToTime(startInput.value, 25);
    } else if (endInput.value && !startInput.value) {
      startInput.value = addMinutesToTime(endInput.value, -25);
    }
    saveEditSession(dateKey, index, startInput.value, endInput.value, type, note);
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
let notificationPermissionRequested = localStorage.getItem("notifAsked") === "1";

function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  if (notificationPermissionRequested) return;
  notificationPermissionRequested = true;
  localStorage.setItem("notifAsked", "1");
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

function showNotification(msg, duration = 3300) {
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
  toast._autoHideId = setTimeout(hide, duration);
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
  } else {
    startTimer();
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
    openTypeManagerModal();
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

// 备注输入同步
taskNoteInput.addEventListener("input", () => {
  currentNote = taskNoteInput.value;
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

// 点击日历区域外关闭详情 + 关闭自定义下拉
document.addEventListener("click", (e) => {
  if (!dayDetail.contains(e.target) && !e.target.closest(".day-cell")) {
    hideDayDetail();
  }
  // 关闭所有类型下拉
  if (!e.target.closest(".edit-type-custom")) {
    document.querySelectorAll(".edit-type-dropdown.show").forEach(d => d.classList.remove("show"));
  }
});

// ── 云端同步 ──────────────────────────

async function pullFromCloud() {
  if (!supabase || !currentUser) return;
  console.log("[番茄时钟] 从云端拉取数据...");
  updateSyncStatus("syncing", "同步中…");

  try {
    // 拉取专注会话
    const { data: sessions, error: sErr } = await supabase
      .from("focus_sessions")
      .select("date_key, start_ts, end_ts, type, note, updated_at")
      .order("start_ts", { ascending: true });

    if (sErr) throw sErr;

    // 拉取设置
    const { data: settings, error: setErr } = await supabase
      .from("user_settings")
      .select("custom_types, hidden_types")
      .single();

    if (setErr && setErr.code !== "PGRST116") throw setErr;

    // 合并专注数据：云端 → focusData 格式
    const cloudFocus = {};
    if (sessions) {
      sessions.forEach(s => {
        if (!cloudFocus[s.date_key]) cloudFocus[s.date_key] = [];
        cloudFocus[s.date_key].push({
          start: s.start_ts,
          end: s.end_ts,
          type: s.type || "无类型",
          note: s.note || "",
          _updated_at: s.updated_at ? new Date(s.updated_at).getTime() : 0,
        });
      });
    }

    // 合并：本地 + 云端（union，云端优先），含时间重叠检测
    const merged = {};
    const allKeys = new Set([...Object.keys(focusData), ...Object.keys(cloudFocus)]);

    for (const key of allKeys) {
      const local = focusData[key] || [];
      const cloud = cloudFocus[key] || [];
      const sessionMap = new Map();

      function makeKey(s) {
        // 精确键：start + end + type — 用于完全一致的快速去重
        return `${s.start ?? "null"}_${s.end ?? "null"}_${s.type || ""}`;
      }

      // 先放本地
      local.forEach((s, i) => {
        if (!s) return;
        sessionMap.set(makeKey(s), { ...s, _updated_at: 0, _localIdx: i });
      });

      // 云端覆盖（updated_at 更新者胜）
      cloud.forEach(s => {
        const k = makeKey(s);
        const existing = sessionMap.get(k);
        if (!existing || (s._updated_at || 0) > (existing._updated_at || 0)) {
          sessionMap.set(k, { ...s, _localIdx: -1 });
        }
      });

      // ── 时间重叠去重（第二轮）：检测 key 不同但时间段重叠的记录 ──
      let entries = Array.from(sessionMap.values());
      const toRemove = new Set();

      // 按 start 排序（null 排最前）
      entries.sort((a, b) => {
        if (a.start == null && b.start == null) return 0;
        if (a.start == null) return -1;
        if (b.start == null) return 1;
        return a.start - b.start;
      });

      for (let i = 0; i < entries.length; i++) {
        if (toRemove.has(i)) continue;
        const a = entries[i];
        // 缺少时间信息的记录不参与重叠去重（保守：保留不删）
        if (!a.start || !a.end) continue;

        for (let j = i + 1; j < entries.length; j++) {
          if (toRemove.has(j)) continue;
          const b = entries[j];
          if (!b.start || !b.end) continue;

          // 检查时间段是否重叠
          if (a.start < b.end && b.start < a.end) {
            // 重叠！保留 updated_at 更新的，或云端数据（_localIdx === -1）
            const aIsCloud = a._localIdx === -1;
            const bIsCloud = b._localIdx === -1;
            const aTime = a._updated_at || 0;
            const bTime = b._updated_at || 0;

            if (bTime > aTime || (bIsCloud && !aIsCloud)) {
              toRemove.add(i);
              console.log("[番茄时钟] 云端合并去重（时间重叠）:", key, timestampToTimeString(a.start), "-", timestampToTimeString(a.end), "被", timestampToTimeString(b.start), "-", timestampToTimeString(b.end), "替代");
              break; // a 已移除，跳出内层循环
            } else {
              toRemove.add(j);
              console.log("[番茄时钟] 云端合并去重（时间重叠）:", key, timestampToTimeString(b.start), "-", timestampToTimeString(b.end), "被", timestampToTimeString(a.start), "-", timestampToTimeString(a.end), "替代");
            }
          }
        }
      }

      merged[key] = entries
        .filter((_, i) => !toRemove.has(i))
        .map(s => {
          const { _updated_at, _localIdx, ...clean } = s;
          return clean;
        });
    }

    focusData = merged;
    saveFocusDataLocal(); // 只写 localStorage，不触发再次推送

    // 合并设置
    if (settings) {
      if (settings.custom_types && Array.isArray(settings.custom_types)) {
        const mergedTypes = [...new Set([...customTypes, ...settings.custom_types])];
        customTypes = mergedTypes;
        saveTypesLocal();
      }
      if (settings.hidden_types && Array.isArray(settings.hidden_types)) {
        const mergedHidden = [...new Set([...hiddenTypes, ...settings.hidden_types])];
        hiddenTypes = mergedHidden;
        saveHiddenTypesLocal();
      }
    }

    syncDirty = false;
    updateSyncStatus("ok", "已同步 ✓");
    console.log("[番茄时钟] ✅ 云端数据已同步");
  } catch (e) {
    console.error("[番茄时钟] 拉取云端数据失败:", e);
    updateSyncStatus("error", "同步失败 ⚠");
  }
}

async function pushToCloud() {
  if (!supabase || !currentUser || !syncDirty) return;
  console.log("[番茄时钟] 推送数据到云端...");
  updateSyncStatus("syncing", "同步中…");

  try {
    // 删除旧数据，全量写入（番茄钟数据量小，简单可靠）
    await supabase.from("focus_sessions").delete().eq("user_id", currentUser.id);

    // 批量插入
    const rows = [];
    for (const [dateKey, sessions] of Object.entries(focusData)) {
      if (!Array.isArray(sessions)) continue;
      sessions.forEach(s => {
        if (!s) return;
        rows.push({
          user_id: currentUser.id,
          date_key: dateKey,
          start_ts: s.start,
          end_ts: s.end,
          type: s.type || "无类型",
          note: s.note || "",
        });
      });
    }

    if (rows.length > 0) {
      // 分批插入，每批最多 500 条
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from("focus_sessions").insert(batch);
        if (error) throw error;
      }
    }

    // 设置 upsert
    const { error: setErr } = await supabase
      .from("user_settings")
      .upsert({
        user_id: currentUser.id,
        custom_types: customTypes,
        hidden_types: hiddenTypes,
        updated_at: new Date().toISOString(),
      });

    if (setErr) throw setErr;

    syncDirty = false;
    updateSyncStatus("ok", "已同步 ✓");
    console.log("[番茄时钟] ✅ 数据已推送到云端");
  } catch (e) {
    console.error("[番茄时钟] 推送云端数据失败:", e);
    updateSyncStatus("error", "同步失败 ⚠");
  }
}

function schedulePush() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushToCloud(), 2000);
}

// 仅写 localStorage（不触发云端推送，用于拉取合并后）
function saveFocusDataLocal() {
  cleanFocusDataOverlaps();
  localStorage.setItem("focusData", JSON.stringify(focusData));
}

function saveTypesLocal() {
  localStorage.setItem("customTypes", JSON.stringify(customTypes));
}

function saveHiddenTypesLocal() {
  localStorage.setItem("hiddenTypes", JSON.stringify(hiddenTypes));
}

// ── Auth 认证 ──────────────────────────

function updateAuthUI() {
  if (currentUser) {
    const email = currentUser.email || "";
    const displayName = currentUser.user_metadata?.display_name || "";
    let initial = "✨";
    if (displayName) {
      initial = displayName.charAt(0).toUpperCase() || "✨";
    } else if (email) {
      const firstLetter = email.match(/[a-zA-Z]/);
      initial = firstLetter ? firstLetter[0].toUpperCase() : "✨";
    }
    authBtn.textContent = initial;
    authBtn.title = displayName ? `${displayName} (${email})` : (email || "已登录");
    authBtn.classList.add("logged-in");
    authAvatar.textContent = initial;
    // 显示名
    if (displayName) {
      authDisplayNameText.textContent = displayName;
      authDisplayNameText.style.display = "";
      authUserEmail.textContent = email;
    } else {
      authDisplayNameText.textContent = "✨";
      authDisplayNameText.style.display = "";
      authUserEmail.textContent = email;
    }
    authFormSection.style.display = "none";
    authLoggedIn.style.display = "";
  } else {
    authBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="10" cy="6" rx="4" ry="4.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/><path d="M5.5 11c-1 2-1.5 4-1 6.5.1.3.4.5.7.5h9.6c.3 0 .6-.2.7-.5.5-2.5 0-4.5-1-6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/></svg>';
    authBtn.title = "登录同步数据";
    authBtn.classList.remove("logged-in");
    authFormSection.style.display = "";
    authLoggedIn.style.display = "none";
    authEmail.value = "";
    authPassword.value = "";
    if (authDisplayName) authDisplayName.value = "";
    authError.textContent = "";
    authSubmit.textContent = "登录";
    updateSyncStatus("ok", "已同步 ✓");
  }
}

function updateSyncStatus(state, text) {
  if (!authSyncStatus) return;
  authSyncStatus.textContent = text;
  authSyncStatus.className = "auth-sync-status " + state;
}

// ── Tab 切换 ──────────────────────────────
let authMode = "login";

function setAuthTab(mode) {
  authMode = mode;
  authError.textContent = "";
  if (mode === "login") {
    authTabLogin.classList.add("active");
    authTabRegister.classList.remove("active");
    authSubmit.textContent = "登录";
    if (authDisplayName) authDisplayName.style.display = "none";
  } else {
    authTabRegister.classList.add("active");
    authTabLogin.classList.remove("active");
    authSubmit.textContent = "注册";
    if (authDisplayName) authDisplayName.style.display = "";
  }
}

authTabLogin.addEventListener("click", () => setAuthTab("login"));
authTabRegister.addEventListener("click", () => setAuthTab("register"));

function openAuthModal() {
  authOverlay.classList.add("show");
  if (currentUser) {
    authFormSection.style.display = "none";
    authLoggedIn.style.display = "";
  } else {
    authFormSection.style.display = "";
    authLoggedIn.style.display = "none";
    // 重置表单
    authEmail.value = "";
    authPassword.value = "";
    if (authDisplayName) authDisplayName.value = "";
    authError.textContent = "";
    setAuthTab("login");
  }
}

function closeAuthModal() {
  authOverlay.classList.remove("show");
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    authError.textContent = "请填写邮箱和密码";
    return;
  }
  if (password.length < 6) {
    authError.textContent = "密码至少需要 6 位";
    return;
  }

  // 确保 Supabase 已初始化（如果之前初始化失败则重试）
  if (!supabase) {
    authSubmit.disabled = true;
    authSubmit.textContent = "连接中…";
    const ok = await initSupabase();
    if (!ok || !supabase) {
      authError.textContent = "无法连接服务器，请检查网络后刷新页面重试";
      authSubmit.disabled = false;
      authSubmit.textContent = "登录";
      return;
    }
  }

  authError.textContent = "";
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === "login" ? "登录中…" : "注册中…";

  try {
    if (authMode === "register") {
      // 直接注册
      const displayName = (authDisplayName && authDisplayName.value.trim()) || "";
      const signUpPayload = { email, password };
      if (displayName) {
        signUpPayload.options = { data: { display_name: displayName } };
      }
      const { error: signUpErr } = await supabase.auth.signUp(signUpPayload);
      if (signUpErr) throw signUpErr;
      closeAuthModal();
    } else {
      // 登录
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      closeAuthModal();
    }
  } catch (err) {
    authError.textContent = err.message || "操作失败，请重试";
    authError.style.color = "#d9534f";
    authSubmit.textContent = authMode === "login" ? "登录" : "注册";
  }

  authSubmit.disabled = false;
}

async function handleSignOut() {
  if (syncDirty) await pushToCloud();
  if (supabase) await supabase.auth.signOut();
  currentUser = null;
  updateAuthUI();
  closeAuthModal();
}

// ── 事件绑定：Auth ──────────────────────

authBtn.addEventListener("click", openAuthModal);

authClose.addEventListener("click", closeAuthModal);

authOverlay.addEventListener("click", (e) => {
  if (e.target === authOverlay) closeAuthModal();
});

authForm.addEventListener("submit", handleAuthSubmit);

document.getElementById("auth-logout").addEventListener("click", handleSignOut);

document.getElementById("auth-force-sync").addEventListener("click", async () => {
  await pullFromCloud();
  await pushToCloud();
  updateTodayCount();
  updateCalendar();
  renderTaskTypeRow();
});

// ── 类型管理弹窗事件 ──────────────────

typeMgrOverlay.addEventListener("click", (e) => {
  if (e.target === typeMgrOverlay) closeTypeManagerModal();
});

typeMgrDoneBtn.addEventListener("click", closeTypeManagerModal);

typeMgrList.addEventListener("click", (e) => {
  const delBtn = e.target.closest("[data-action='delete-type']");
  if (delBtn) {
    const type = delBtn.dataset.type;
    if (confirm(`永久删除类型「${type}」？`)) {
      permanentDeleteType(type);
      renderTypeManagerList();
    }
    return;
  }

  const restoreBtn = e.target.closest("[data-action='restore-type']");
  if (restoreBtn) {
    const type = restoreBtn.dataset.type;
    addCustomType(type);
    renderTypeManagerList();
    return;
  }

  const setDefaultBtn = e.target.closest("[data-action='set-default-type']");
  if (setDefaultBtn) {
    const type = setDefaultBtn.dataset.type;
    defaultType = type;
    saveDefaultType();
    if (!currentTaskType || currentTaskType === "无类型") {
      currentTaskType = type;
    }
    renderTypeManagerList();
    renderTaskTypeRow();
    return;
  }
});

// ── 拖拽排序 ──
let dragSrcType = null;

typeMgrList.addEventListener("dragstart", (e) => {
  const item = e.target.closest(".type-mgr-item");
  if (!item) return;
  dragSrcType = item.dataset.type;
  item.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragSrcType);
});

typeMgrList.addEventListener("dragend", (e) => {
  const item = e.target.closest(".type-mgr-item");
  if (item) item.classList.remove("dragging");
  typeMgrList.querySelectorAll(".type-mgr-item").forEach(el => el.classList.remove("drag-over"));
  dragSrcType = null;
});

typeMgrList.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const item = e.target.closest(".type-mgr-item");
  if (!item || item.dataset.type === dragSrcType) return;
  typeMgrList.querySelectorAll(".type-mgr-item").forEach(el => el.classList.remove("drag-over"));
  item.classList.add("drag-over");
});

typeMgrList.addEventListener("drop", (e) => {
  e.preventDefault();
  const item = e.target.closest(".type-mgr-item");
  if (!item || !dragSrcType || item.dataset.type === dragSrcType) return;

  const allTypes = getAllTypesOrdered();
  const srcIdx = allTypes.indexOf(dragSrcType);
  const targetIdx = allTypes.indexOf(item.dataset.type);
  if (srcIdx === -1 || targetIdx === -1) return;

  // 移动源到目标位置
  allTypes.splice(srcIdx, 1);
  allTypes.splice(targetIdx, 0, dragSrcType);
  typeOrder = allTypes;
  saveTypeOrder();
  renderTypeManagerList();
});

typeMgrAddBtn.addEventListener("click", () => {
  const name = typeMgrAddInput.value.trim();
  if (!name) return;
  if (name.length > 10) {
    alert("类型名称不能超过10个字符");
    return;
  }
  addCustomType(name);
  typeMgrAddInput.value = "";
  renderTypeManagerList();
});

typeMgrAddInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    typeMgrAddBtn.click();
  }
});

// ── 修改昵称 ──────────────────────────────

let _editNameSave = true;

authDisplayNameText.addEventListener("click", () => {
  // 点击昵称文字 → 进入编辑
  authDisplayNameText.style.display = "none";
  // 默认值：有昵称用昵称，否则用邮箱首字母
  const displayName = currentUser?.user_metadata?.display_name || "";
  const email = currentUser?.email || "";
  authNameEditInput.value = displayName || (email.match(/[a-zA-Z]/) || [""])[0].toUpperCase() || "";
  authNameEditInput.style.display = "";
  authNameEditInput.focus();
  authNameEditInput.select();
  _editNameSave = true;
});

function finishEditDisplayName(save) {
  _editNameSave = save;
  if (!save) { authNameEditInput.blur(); return; }
  const newName = authNameEditInput.value.trim();
  authDisplayNameText.textContent = newName || authUserEmail.textContent || currentUser?.email || "";
  if (newName && supabase) {
    supabase.auth.updateUser({ data: { display_name: newName } }).then(({ error }) => {
      if (error) { authSyncStatus.textContent = "昵称更新失败"; authSyncStatus.className = "auth-sync-status error"; }
      else {
        // 更新本地缓存
        if (currentUser && currentUser.user_metadata) {
          currentUser.user_metadata.display_name = newName;
        }
        // 刷新 header 按钮和头像
        const initial = newName.charAt(0).toUpperCase();
        authBtn.textContent = initial;
        authBtn.title = `${newName} (${currentUser?.email || ""})`;
        authAvatar.textContent = initial;
        authUserEmail.textContent = currentUser?.email || "";
      }
    });
  } else if (!newName) {
    // 清空昵称：回退到 ✨
    const email = currentUser?.email || "";
    authUserEmail.textContent = email;
    authDisplayNameText.textContent = "✨";
    const firstLetter = email.match(/[a-zA-Z]/);
    const initial = firstLetter ? firstLetter[0].toUpperCase() : "✨";
    authBtn.textContent = initial;
    authBtn.title = email || "已登录";
    authAvatar.textContent = initial;
    if (supabase) {
      supabase.auth.updateUser({ data: { display_name: null } });
      if (currentUser && currentUser.user_metadata) {
        delete currentUser.user_metadata.display_name;
      }
    }
  }
  // 恢复显示
  authNameEditInput.style.display = "none";
  authDisplayNameText.style.display = "";
}

authNameEditInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); finishEditDisplayName(true); }
  else if (e.key === "Escape") { e.preventDefault(); finishEditDisplayName(false); }
});

authNameEditInput.addEventListener("blur", () => {
  setTimeout(() => {
    if (_editNameSave) finishEditDisplayName(true);
  }, 100);
});

// ── 离线检测 ────────────────────────────

window.addEventListener("online", () => {
  if (currentUser && syncDirty) {
    pushToCloud();
    showNotification("网络已恢复，同步中…");
  }
});

window.addEventListener("offline", () => {
  showNotification("已离线，数据将保存在本地");
});

// 页面卸载前最后一次同步（兜底，尽力而为）
window.addEventListener("beforeunload", () => {
  if (currentUser && syncDirty && supabase) {
    // 尝试用 fetch + keepalive 做最后一次推送
    const session = supabase.auth.session;
    // 注：实际推送可能在 beforeunload 中超时，此处仅标记
    console.log("[番茄时钟] beforeunload 云端同步标记");
  }
});

// ── 初始化 ────────────────────────────
function init() {
  try {
    // 初始化 Supabase（非阻塞：网络问题也不影响本地功能）
    initSupabase().then(ok => {
      if (ok && supabase) {
        // 监听认证状态变化
        supabase.auth.onAuthStateChange((event, session) => {
          console.log("[番茄时钟] Auth 状态变化:", event);
          if (session?.user) {
            currentUser = session.user;
            updateAuthUI();
            pullFromCloud().then(() => {
              updateTodayCount();
              updateCalendar();
              renderTaskTypeRow();
              if (dayDetail.classList.contains("show") && dayDetail._dateKey) {
                const cell = daysGrid.querySelector(`.day-cell[data-date="${dayDetail._dateKey}"]`);
                if (cell) showDayDetail(dayDetail._dateKey, cell);
              }
            });
          } else if (event === "SIGNED_OUT") {
            currentUser = null;
            updateAuthUI();
          }
        });

        // 恢复已有会话
        supabase.auth.getSession().then(({ data }) => {
          if (data?.session?.user) {
            currentUser = data.session.user;
            updateAuthUI();
            pullFromCloud().then(() => {
              updateTodayCount();
              updateCalendar();
              renderTaskTypeRow();
            });
            console.log("[番茄时钟] ✅ 会话已恢复:", currentUser.email);
          }
        });
      }
    });

    // 固定容器高度：以空闲态（taskTypeSection 可见，最高）为基准，避免切换时跳动
    const container = document.querySelector(".container");
    let pinnedContainerHeight = 0;

    function pinContainerHeight() {
      // 临时确保 taskTypeSection 可见、controls 隐藏（空闲态，最高）
      const ts = taskTypeSection.style.display;
      const cs = controls.style.display;
      const fi = focusTypeIndicator.style.display;
      taskTypeSection.style.display = "";
      controls.style.display = "none";
      focusTypeIndicator.style.display = "none";

      pinnedContainerHeight = container.offsetHeight;
      container.style.minHeight = pinnedContainerHeight + "px";

      // 恢复原始状态
      taskTypeSection.style.display = ts;
      controls.style.display = cs;
      focusTypeIndicator.style.display = fi;
    }

    let resizeDebounce;
    window.addEventListener("resize", () => {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        container.style.minHeight = "";
        pinContainerHeight();
      }, 200);
    });

    // Tab 切换
    const dateHeader = document.querySelector(".date-header");
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        document.getElementById("tab-timer").style.display = tab === "timer" ? "" : "none";
        document.getElementById("tab-calendar").style.display = tab === "calendar" ? "" : "none";
        dateHeader.style.display = tab === "calendar" ? "none" : "";
      });
    });

    loadFocusData();
    cleanFocusDataOverlaps(); // 清理本地已有的重复数据
    loadTypeData();
    if (defaultType && currentTaskType === "无类型") {
      currentTaskType = defaultType;
    }
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
              sessionStartTime = null; // 专注已结束，清空等待下一轮
              updateTodayCount();
              updateCalendar();
              currentMode = "break";
              timeLeft = BREAK;
              updateModeUI();
              updateTimerDisplay();
              startTimer();
            } else {
              sessionStartTime = null; // 休息结束，清空准备新专注
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
        // 恢复暂停时的按钮UI：根据模式显示"继续专注"或"继续休息"
        startPauseBtn.textContent = currentMode === "work" ? "继续专注" : "继续休息";
        timerSection.classList.add("running");
        taskTypeSection.style.display = "none";
        controls.style.display = "";
        focusTypeIndicator.style.display = "none";
        console.log("[番茄时钟] ✅ 暂停状态已恢复:", timeLeft, "秒, 模式:", currentMode);
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

    // 等 DOM 布局稳定后测量并固定容器高度
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pinContainerHeight();
      });
    });
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
