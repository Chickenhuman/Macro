const STEPS_KEY = "macroSteps";
const RECORDING_KEY = "macroRecordingState";
const RUN_KEY = "macroRunState";
const ERROR_LOGS_KEY = "macroErrorLogs";
const DEBUG_STATE_KEY = "macroDebugState";
const DEBUG_LOGS_KEY = "macroDebugLogs";
const POPUP_WAIT_ALARM = "macroPopupWaitTimeout";

const DEFAULT_RECORDING_STATE = {
  enabled: false,
  initializing: false,
  rootTabId: null,
  rootWindowId: null,
  rootOrigin: "",
  rootHostname: "",
  startedAt: 0,
  trackedTabIds: [],
  pendingPopupTabIds: [],
  knownTabIdsAtStart: [],
  popupStepRecordedTabIds: []
};

const DEFAULT_RUN_STATE = {
  running: false,
  rootTabId: null,
  rootWindowId: null,
  rootOrigin: "",
  rootHostname: "",
  currentTabId: null,
  currentTabTrail: [],
  steps: [],
  stepIndex: 0,
  waitingForPopup: false,
  popupUrlIncludes: "",
  popupTimeout: 0,
  popupWaitStartedAt: 0,
  lastMessage: "대기",
  error: "",
  pendingPopupTabIds: [],
  knownTabIdsAtWaitStart: []
};

const DEFAULT_DEBUG_STATE = {
  enabled: false
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFiniteTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://")
  );
}

function getUrlOrigin(url) {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function getUrlHostname(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isSameOriginOrHostname(url, origin, hostname) {
  if (!url) return false;

  const currentOrigin = getUrlOrigin(url);
  const currentHostname = getUrlHostname(url);

  if (origin && currentOrigin && currentOrigin === origin) {
    return true;
  }

  if (hostname && currentHostname && currentHostname === hostname) {
    return true;
  }

  return false;
}

function uniqTabIds(values) {
  return Array.from(new Set((values || []).filter(isFiniteTabId)));
}

function collectDescendantTabs(rootTabId, tabs) {
  if (!isFiniteTabId(rootTabId)) return [];

  const byOpener = new Map();

  for (const tab of tabs || []) {
    if (!isFiniteTabId(tab?.id)) continue;
    if (!isFiniteTabId(tab?.openerTabId)) continue;

    const children = byOpener.get(tab.openerTabId) || [];
    children.push(tab);
    byOpener.set(tab.openerTabId, children);
  }

  const queue = [rootTabId];
  const seen = new Set([rootTabId]);
  const result = [];

  while (queue.length) {
    const parentId = queue.shift();
    const children = byOpener.get(parentId) || [];

    for (const child of children) {
      if (!isFiniteTabId(child.id)) continue;
      if (seen.has(child.id)) continue;

      seen.add(child.id);
      result.push(child);
      queue.push(child.id);
    }
  }

  return result;
}

async function getSteps() {
  const data = await chrome.storage.local.get(STEPS_KEY);
  return Array.isArray(data[STEPS_KEY]) ? data[STEPS_KEY] : [];
}

async function setSteps(steps) {
  await chrome.storage.local.set({
    [STEPS_KEY]: Array.isArray(steps) ? steps : []
  });
}

async function getRecordingState() {
  const data = await chrome.storage.local.get(RECORDING_KEY);
  return {
    ...DEFAULT_RECORDING_STATE,
    ...(data[RECORDING_KEY] || {})
  };
}

async function setRecordingState(state) {
  const nextState = {
    ...DEFAULT_RECORDING_STATE,
    ...(state || {})
  };

  nextState.trackedTabIds = uniqTabIds(nextState.trackedTabIds);
  nextState.pendingPopupTabIds = uniqTabIds(nextState.pendingPopupTabIds);
  nextState.knownTabIdsAtStart = uniqTabIds(nextState.knownTabIdsAtStart);
  nextState.popupStepRecordedTabIds = uniqTabIds(nextState.popupStepRecordedTabIds);

  if (!nextState.enabled) {
    nextState.initializing = false;
    nextState.rootTabId = null;
    nextState.rootWindowId = null;
    nextState.rootOrigin = "";
    nextState.rootHostname = "";
    nextState.startedAt = 0;
    nextState.trackedTabIds = [];
    nextState.pendingPopupTabIds = [];
    nextState.knownTabIdsAtStart = [];
    nextState.popupStepRecordedTabIds = [];
  }

  await chrome.storage.local.set({
    [RECORDING_KEY]: nextState
  });

  return nextState;
}

async function getRunState() {
  const data = await chrome.storage.local.get(RUN_KEY);
  return {
    ...DEFAULT_RUN_STATE,
    ...(data[RUN_KEY] || {})
  };
}

async function getDebugState() {
  const data = await chrome.storage.local.get(DEBUG_STATE_KEY);
  return {
    ...DEFAULT_DEBUG_STATE,
    ...(data[DEBUG_STATE_KEY] || {})
  };
}

async function setDebugState(state) {
  const nextState = {
    ...DEFAULT_DEBUG_STATE,
    ...(state || {})
  };

  nextState.enabled = !!nextState.enabled;

  await chrome.storage.local.set({
    [DEBUG_STATE_KEY]: nextState
  });

  return nextState;
}

async function getErrorLogs() {
  const data = await chrome.storage.local.get(ERROR_LOGS_KEY);
  return Array.isArray(data[ERROR_LOGS_KEY]) ? data[ERROR_LOGS_KEY] : [];
}

async function getDebugLogs() {
  const data = await chrome.storage.local.get(DEBUG_LOGS_KEY);
  return Array.isArray(data[DEBUG_LOGS_KEY]) ? data[DEBUG_LOGS_KEY] : [];
}

async function setErrorLogs(entries) {
  await chrome.storage.local.set({
    [ERROR_LOGS_KEY]: Array.isArray(entries) ? entries.slice(-100) : []
  });
}

async function setDebugLogs(entries) {
  await chrome.storage.local.set({
    [DEBUG_LOGS_KEY]: Array.isArray(entries) ? entries.slice(-200) : []
  });
}

async function appendErrorLog(message, source = "runtime") {
  const text = String(message || "").trim();
  if (!text) return [];

  const current = await getErrorLogs();
  const next = [
    ...current,
    {
      at: Date.now(),
      source: String(source || "runtime"),
      message: text
    }
  ].slice(-100);

  await setErrorLogs(next);
  return next;
}

async function appendDebugLog(entry) {
  const current = await getDebugLogs();
  const nextEntry = {
    at: Date.now(),
    source: String(entry?.source || "content:event"),
    eventType: String(entry?.eventType || "event"),
    pageUrl: String(entry?.pageUrl || ""),
    target: entry?.target || null,
    ancestors: Array.isArray(entry?.ancestors) ? entry.ancestors.slice(0, 8) : [],
    clickableTarget: entry?.clickableTarget || null,
    clickableSelector: typeof entry?.clickableSelector === "string" ? entry.clickableSelector : "",
    checkboxTarget: entry?.checkboxTarget || null,
    checkboxSelector: typeof entry?.checkboxSelector === "string" ? entry.checkboxSelector : "",
    dropdownTarget: entry?.dropdownTarget || null,
    dropdownSelector: typeof entry?.dropdownSelector === "string" ? entry.dropdownSelector : "",
    inputTarget: entry?.inputTarget || null,
    inputSelector: typeof entry?.inputSelector === "string" ? entry.inputSelector : "",
    note: typeof entry?.note === "string" ? entry.note : "",
    recordedStep: entry?.recordedStep || null
  };

  const next = [...current, nextEntry].slice(-200);
  await setDebugLogs(next);
  return next;
}

async function setRunState(state) {
  const nextState = {
    ...DEFAULT_RUN_STATE,
    ...(state || {})
  };

  nextState.steps = Array.isArray(nextState.steps) ? nextState.steps : [];
  nextState.currentTabTrail = uniqTabIds(nextState.currentTabTrail);
  nextState.pendingPopupTabIds = uniqTabIds(nextState.pendingPopupTabIds);
  nextState.knownTabIdsAtWaitStart = uniqTabIds(nextState.knownTabIdsAtWaitStart);

  if (!nextState.running) {
    nextState.rootTabId = null;
    nextState.rootWindowId = null;
    nextState.rootOrigin = "";
    nextState.rootHostname = "";
    nextState.currentTabId = null;
    nextState.currentTabTrail = [];
    nextState.steps = [];
    nextState.stepIndex = 0;
    nextState.waitingForPopup = false;
    nextState.popupUrlIncludes = "";
    nextState.popupTimeout = 0;
    nextState.popupWaitStartedAt = 0;
    nextState.pendingPopupTabIds = [];
    nextState.knownTabIdsAtWaitStart = [];
  }

  await chrome.storage.local.set({
    [RUN_KEY]: nextState
  });

  await updateBadge();
  return nextState;
}

async function updateBadge() {
  const [recording, runState] = await Promise.all([
    getRecordingState(),
    getRunState()
  ]);

  if (recording.enabled) {
    await chrome.action.setBadgeText({ text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    return;
  }

  if (runState.running) {
    await chrome.action.setBadgeText({ text: runState.waitingForPopup ? "POP" : "RUN" });
    await chrome.action.setBadgeBackgroundColor({
      color: runState.waitingForPopup ? "#f59e0b" : "#1a73e8"
    });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
}

function sanitizeStep(step) {
  if (!step || typeof step !== "object" || !step.type) {
    return null;
  }

  const clean = { type: String(step.type) };

  if (typeof step.selector === "string") clean.selector = step.selector;
  if (typeof step.value === "string") clean.value = step.value;
  if (typeof step.label === "string") clean.label = step.label;
  if (typeof step.timeout === "number") clean.timeout = step.timeout;
  if (typeof step.interval === "number") clean.interval = step.interval;
  if (typeof step.ms === "number") clean.ms = step.ms;
  if (typeof step.urlIncludes === "string") clean.urlIncludes = step.urlIncludes;

  return clean;
}

async function appendSteps(newSteps) {
  const currentSteps = await getSteps();
  const nextSteps = [...currentSteps];

  for (const step of newSteps || []) {
    const clean = sanitizeStep(step);
    if (clean) {
      nextSteps.push(clean);
    }
  }

  await setSteps(nextSteps);
  return nextSteps;
}

function buildPopupWaitStepFromUrl(url) {
  if (!url) {
    return {
      type: "waitForPopup",
      timeout: 10000
    };
  }

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastPath = parts[parts.length - 1] || parsed.pathname || parsed.origin;

    return {
      type: "waitForPopup",
      urlIncludes: lastPath,
      timeout: 10000
    };
  } catch {
    return {
      type: "waitForPopup",
      urlIncludes: url,
      timeout: 10000
    };
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"]
  });
}

async function sendTabMessage(tabId, message) {
  return await chrome.tabs.sendMessage(tabId, message);
}

async function executeMainWorldClick(tabId, frameId, selector) {
  const target = { tabId };

  if (Number.isInteger(frameId) && frameId >= 0) {
    target.frameIds = [frameId];
  }

  const results = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    args: [selector],
    func: (targetSelector) => {
      const el = document.querySelector(targetSelector);
      if (!(el instanceof Element)) {
        return {
          ok: false,
          message: `요소를 찾지 못했습니다: ${targetSelector}`
        };
      }

      el.scrollIntoView({
        block: "center",
        inline: "center"
      });

      if (typeof el.focus === "function") {
        el.focus();
      }

      if (typeof el.click === "function") {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }

      return { ok: true };
    }
  });

  return results?.[0]?.result || {
    ok: false,
    message: `요소를 찾지 못했습니다: ${selector}`
  };
}

function isRetryableTabMessageError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("message channel closed before a response was received") ||
    message.includes("Could not establish connection") ||
    message.includes("Receiving end does not exist")
  );
}

async function sendTabMessageWithReconnect(tabId, message, retries = 4) {
  let lastError = null;

  for (let i = 0; i < retries; i += 1) {
    try {
      return await sendTabMessage(tabId, message);
    } catch (error) {
      lastError = error;

      if (!isRetryableTabMessageError(error) || i === retries - 1) {
        throw error;
      }

      await delay(150);
      await ensureContentReady(tabId);
    }
  }

  throw lastError || new Error("탭 메시지 전송 실패");
}

async function ensureContentReady(tabId, retries = 4) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await injectContentScript(tabId);

      const response = await sendTabMessage(tabId, {
        type: "PING"
      });

      if (response?.ok) {
        return true;
      }
    } catch {
      // retry
    }

    await delay(150);
  }

  throw new Error("페이지와 연결하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.");
}

async function startRecordingOnTab(tabId) {
  await ensureContentReady(tabId);
  const debugState = await getDebugState();

  const response = await sendTabMessageWithReconnect(tabId, {
    type: "START_RECORD",
    debugEnabled: !!debugState.enabled
  });

  if (!response?.ok) {
    throw new Error(response?.message || "기록 시작 실패");
  }
}

async function broadcastDebugMode(enabled) {
  const recording = await getRecordingState();
  const tracked = uniqTabIds(recording.trackedTabIds);

  for (const tabId of tracked) {
    try {
      await sendTabMessage(tabId, {
        type: "SET_DEBUG_MODE",
        enabled: !!enabled
      });
    } catch {
      // ignore missing or unloaded content scripts
    }
  }
}

async function bootstrapRecordingSession(tabId, options = {}) {
  if (!options.skipRootStart) {
    try {
      await startRecordingOnTab(tabId);
    } catch (error) {
      const current = await getRecordingState();
      if (current.enabled && current.rootTabId === tabId) {
        await setRecordingState(DEFAULT_RECORDING_STATE);
        try {
          await updateBadge();
        } catch {
          // ignore badge failure
        }
      }

      try {
        await appendErrorLog(error?.message || String(error), "recording:start");
      } catch {
        // ignore logging failure
      }
      return;
    }
  }

  try {
    await attachRecordingToExistingRelatedTabs(tabId);
  } catch (error) {
    const current = await getRecordingState();
    if (current.enabled) {
      const latestTabs = await chrome.tabs.query({});
      await setRecordingState({
        ...current,
        initializing: false,
        knownTabIdsAtStart: latestTabs.map((item) => item.id).filter(isFiniteTabId)
      });
    }

    try {
      await appendErrorLog(error?.message || String(error), "recording:attach");
    } catch {
      // ignore logging failure
    }
  }
}

async function stopRecordingOnTab(tabId) {
  if (!isFiniteTabId(tabId)) return;

  try {
    await sendTabMessage(tabId, {
      type: "STOP_RECORD"
    });
  } catch {
    // ignore
  }
}

async function clearPopupWaitAlarm() {
  try {
    await chrome.alarms.clear(POPUP_WAIT_ALARM);
  } catch {
    // ignore
  }
}

async function failRun(message) {
  await clearPopupWaitAlarm();
  await appendErrorLog(message || "실행 실패", "run");
  await setRunState({
    running: false,
    lastMessage: `오류: ${message}`,
    error: message || "실행 실패"
  });
}

async function finishRun(message) {
  await clearPopupWaitAlarm();
  await setRunState({
    running: false,
    lastMessage: message || "실행 완료",
    error: ""
  });
}

async function attachRecordingToExistingRelatedTabs(rootTabId) {
  if (!isFiniteTabId(rootTabId)) {
    return await getRecordingState();
  }

  const [recording, tabs] = await Promise.all([
    getRecordingState(),
    chrome.tabs.query({})
  ]);

  if (!recording.enabled) {
    return recording;
  }

  const tracked = new Set(recording.trackedTabIds || []);
  const relatedTabs = [];
  const seen = new Set();

  const descendants = collectDescendantTabs(rootTabId, tabs);
  for (const tab of descendants) {
    if (!isFiniteTabId(tab?.id)) continue;
    if (seen.has(tab.id)) continue;
    seen.add(tab.id);
    relatedTabs.push(tab);
  }

  for (const tab of tabs || []) {
    if (!isFiniteTabId(tab?.id)) continue;
    if (tab.id === rootTabId) continue;
    if (seen.has(tab.id)) continue;
    if (isRestrictedUrl(tab.url || "")) continue;

    const sameSitePopupWindow =
      recording.rootWindowId != null &&
      tab.windowId !== recording.rootWindowId &&
      isSameOriginOrHostname(tab.url || "", recording.rootOrigin, recording.rootHostname);

    if (!sameSitePopupWindow) continue;

    seen.add(tab.id);
    relatedTabs.push(tab);
  }

  for (const tab of relatedTabs) {
    if (!isFiniteTabId(tab.id)) continue;
    if (tracked.has(tab.id)) continue;
    if (isRestrictedUrl(tab.url || "")) continue;

    try {
      await startRecordingOnTab(tab.id);
      tracked.add(tab.id);
    } catch {
      // onUpdated에서 다시 시도
    }
  }

  const latestTabs = await chrome.tabs.query({});

  return await setRecordingState({
    ...recording,
    initializing: false,
    knownTabIdsAtStart: latestTabs.map((tab) => tab.id).filter(isFiniteTabId),
    trackedTabIds: [...tracked]
  });
}

function getRecordingAttachDecision(tab, recording) {
  if (!recording?.enabled) {
    return { shouldAttach: false, shouldAppendWait: false };
  }

  if (recording.initializing) {
    return { shouldAttach: false, shouldAppendWait: false };
  }

  if (!tab || !isFiniteTabId(tab.id)) {
    return { shouldAttach: false, shouldAppendWait: false };
  }

  if (isRestrictedUrl(tab.url || "")) {
    return { shouldAttach: false, shouldAppendWait: false };
  }

  const tracked = new Set(recording.trackedTabIds || []);
  if (tracked.has(tab.id)) {
    return { shouldAttach: false, shouldAppendWait: false };
  }

  const pending = new Set(recording.pendingPopupTabIds || []);
  const knownAtStart = new Set(recording.knownTabIdsAtStart || []);
  const popupStepRecorded = new Set(recording.popupStepRecordedTabIds || []);

  const pendingMatched = pending.has(tab.id);
  const openerMatched =
    isFiniteTabId(tab.openerTabId) && tracked.has(tab.openerTabId);

  const sameOriginOtherWindow =
    recording.rootWindowId != null &&
    tab.windowId !== recording.rootWindowId &&
    isSameOriginOrHostname(tab.url || "", recording.rootOrigin, recording.rootHostname);

  const shouldAttach = pendingMatched || openerMatched || sameOriginOtherWindow;
  if (!shouldAttach) {
    return { shouldAttach: false, shouldAppendWait: false };
  }

  const existedAtStart = knownAtStart.has(tab.id);

  const shouldAppendWait =
    !existedAtStart &&
    !popupStepRecorded.has(tab.id) &&
    (pendingMatched || openerMatched || sameOriginOtherWindow);

  return {
    shouldAttach: true,
    shouldAppendWait
  };
}

function scorePopupCandidate(tab, runState, step) {
  if (!tab || !isFiniteTabId(tab.id)) return -1;
  if (isRestrictedUrl(tab.url || "")) return -1;
  if (tab.id === runState.currentTabId) return -1;

  const expected = String(step.urlIncludes || "").trim();
  if (expected && !(tab.url || "").includes(expected)) {
    return -1;
  }

  let score = 0;

  const openerCandidates = [runState.currentTabId, runState.rootTabId].filter(isFiniteTabId);
  if (openerCandidates.includes(tab.openerTabId)) {
    score += 100;
  }

  if ((runState.pendingPopupTabIds || []).includes(tab.id)) {
    score += 90;
  }

  const sameOriginOtherWindow =
    runState.rootWindowId != null &&
    tab.windowId !== runState.rootWindowId &&
    isSameOriginOrHostname(tab.url || "", runState.rootOrigin, runState.rootHostname);

  if (sameOriginOtherWindow) {
    score += 70;
  }

  if (tab.active) {
    score += 20;
  }

  if (typeof tab.lastAccessed === "number") {
    score += Math.min(10, Math.floor(tab.lastAccessed / 100000000000));
  }

  return score;
}

function findBestPopupCandidate(tabs, runState, step) {
  let bestTab = null;
  let bestScore = -1;

  for (const tab of tabs || []) {
    const score = scorePopupCandidate(tab, runState, step);
    if (score > bestScore) {
      bestScore = score;
      bestTab = tab;
    }
  }

  return bestScore >= 0 ? bestTab : null;
}

async function switchRunToTab(runState, tabId, message) {
  await ensureContentReady(tabId);

  const nextTrail = [...(runState.currentTabTrail || [])];
  if (isFiniteTabId(runState.currentTabId) && runState.currentTabId !== tabId) {
    nextTrail.push(runState.currentTabId);
  }

  return await setRunState({
    ...runState,
    currentTabId: tabId,
    currentTabTrail: nextTrail,
    stepIndex: runState.stepIndex + 1,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: message || `새 창으로 전환: ${tabId}`,
    error: "",
    pendingPopupTabIds: (runState.pendingPopupTabIds || []).filter((id) => id !== tabId),
    knownTabIdsAtWaitStart: []
  });
}

async function restoreRunToPreviousTab(runState, closedTabId) {
  const trail = [...(runState.currentTabTrail || [])].filter((id) => id !== closedTabId);

  while (trail.length) {
    const fallbackTabId = trail.pop();
    if (!isFiniteTabId(fallbackTabId)) continue;

    try {
      const fallbackTab = await chrome.tabs.get(fallbackTabId);
      if (isRestrictedUrl(fallbackTab.url || "")) {
        continue;
      }

      await ensureContentReady(fallbackTabId);

      return await setRunState({
        ...runState,
        currentTabId: fallbackTabId,
        currentTabTrail: trail,
        lastMessage: `팝업이 닫혀 이전 탭으로 복귀: ${fallbackTab.url || fallbackTab.title || fallbackTabId}`,
        error: ""
      });
    } catch {
      // 다음 후보를 확인
    }
  }

  if (isFiniteTabId(runState.rootTabId) && runState.rootTabId !== closedTabId) {
    try {
      const rootTab = await chrome.tabs.get(runState.rootTabId);
      if (!isRestrictedUrl(rootTab.url || "")) {
        await ensureContentReady(runState.rootTabId);

        return await setRunState({
          ...runState,
          currentTabId: runState.rootTabId,
          currentTabTrail: [],
          lastMessage: `팝업이 닫혀 루트 탭으로 복귀: ${rootTab.url || rootTab.title || runState.rootTabId}`,
          error: ""
        });
      }
    } catch {
      // 실패 시 아래에서 중단
    }
  }

  await failRun("팝업이 닫힌 뒤 복귀할 실행 탭을 찾지 못했습니다.");
  return null;
}

async function handleWaitForPopupStep(runState, step) {
  const tabs = await chrome.tabs.query({});
  const found = findBestPopupCandidate(tabs, runState, step);

  if (found) {
    const nextState = await switchRunToTab(
      runState,
      found.id,
      `새 창 감지: ${found.url || found.title || found.id}`
    );
    await continueMacroRun(nextState);
    return;
  }

  const timeout = typeof step.timeout === "number" ? step.timeout : 10000;

  await clearPopupWaitAlarm();
  await chrome.alarms.create(POPUP_WAIT_ALARM, {
    when: Date.now() + timeout
  });

  await setRunState({
    ...runState,
    waitingForPopup: true,
    popupUrlIncludes: step.urlIncludes || "",
    popupTimeout: timeout,
    popupWaitStartedAt: Date.now(),
    lastMessage: `새 창 대기 중: ${step.urlIncludes || "URL 조건 없음"}`,
    error: "",
    knownTabIdsAtWaitStart: tabs.map((tab) => tab.id).filter(isFiniteTabId)
  });
}

async function continueMacroRun(passedState) {
  let runState = passedState || (await getRunState());

  if (!runState.running || runState.waitingForPopup) {
    return;
  }

  while (runState.running && !runState.waitingForPopup) {
    if (runState.stepIndex >= runState.steps.length) {
      await finishRun("실행 완료");
      return;
    }

    const step = sanitizeStep(runState.steps[runState.stepIndex]);
    if (!step) {
      await failRun(`${runState.stepIndex + 1}번째 step 형식이 잘못되었습니다.`);
      return;
    }

    if (step.type === "waitForPopup") {
      await handleWaitForPopupStep(runState, step);
      return;
    }

    if (!isFiniteTabId(runState.currentTabId)) {
      await failRun("현재 실행 탭을 찾을 수 없습니다.");
      return;
    }

    try {
      const tab = await chrome.tabs.get(runState.currentTabId);
      if (isRestrictedUrl(tab.url || "")) {
        throw new Error("현재 실행 탭은 확장 실행이 허용되지 않는 페이지입니다.");
      }

      await ensureContentReady(runState.currentTabId);

      const response = await sendTabMessage(runState.currentTabId, {
        type: "RUN_SINGLE_STEP",
        step,
        index: runState.stepIndex
      });

      if (!response?.ok) {
        throw new Error(response?.message || "step 실행 실패");
      }

      runState = await setRunState({
        ...runState,
        stepIndex: runState.stepIndex + 1,
        lastMessage:
          response.message ||
          `${runState.stepIndex + 1} / ${runState.steps.length} step 완료`,
        error: ""
      });
    } catch (error) {
      await failRun(error?.message || String(error));
      return;
    }
  }
}

async function handleRecordingRelatedTab(tabId, tab) {
  const recording = await getRecordingState();
  if (!recording.enabled) return;

  const decision = getRecordingAttachDecision(tab, recording);
  if (!decision.shouldAttach) return;

  const tracked = new Set(recording.trackedTabIds || []);
  const popupStepRecorded = new Set(recording.popupStepRecordedTabIds || []);

  try {
    if (decision.shouldAppendWait) {
      await appendSteps([buildPopupWaitStepFromUrl(tab.url || "")]);
      popupStepRecorded.add(tabId);
    }

    await startRecordingOnTab(tabId);
    tracked.add(tabId);

    await setRecordingState({
      ...recording,
      trackedTabIds: [...tracked],
      pendingPopupTabIds: (recording.pendingPopupTabIds || []).filter((id) => id !== tabId),
      popupStepRecordedTabIds: [...popupStepRecorded]
    });
  } catch {
    if (decision.shouldAppendWait) {
      await setRecordingState({
        ...recording,
        popupStepRecordedTabIds: [...popupStepRecorded]
      });
    }
  }
}

async function reviveRecordingOnTrackedTab(tabId, tab) {
  const recording = await getRecordingState();
  if (!recording.enabled) return;

  const tracked = new Set(recording.trackedTabIds || []);
  if (!tracked.has(tabId)) return;
  if (isRestrictedUrl(tab?.url || "")) return;

  try {
    await startRecordingOnTab(tabId);
  } catch {
    // 다음 onUpdated complete에서 다시 시도
  }
}

async function handleRunRelatedTab(tabId, tab) {
  const runState = await getRunState();
  if (!runState.running || !runState.waitingForPopup) return;

  const step = {
    urlIncludes: runState.popupUrlIncludes
  };

  const score = scorePopupCandidate(tab, runState, step);
  if (score < 0) return;

  const waitMs = Date.now() - (runState.popupWaitStartedAt || 0);
  if (runState.popupTimeout > 0 && waitMs > runState.popupTimeout) {
    await failRun(`새 창 대기 시간 초과: ${runState.popupUrlIncludes || "조건 없음"}`);
    return;
  }

  try {
    const nextState = await switchRunToTab(
      runState,
      tabId,
      `새 창 전환 완료: ${tab.url || tab.title || tabId}`
    );
    await clearPopupWaitAlarm();
    await continueMacroRun(nextState);
  } catch (error) {
    await failRun(error?.message || String(error));
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    STEPS_KEY,
    RECORDING_KEY,
    RUN_KEY,
    ERROR_LOGS_KEY,
    DEBUG_STATE_KEY,
    DEBUG_LOGS_KEY
  ]);

  if (!Array.isArray(data[STEPS_KEY])) {
    await setSteps([]);
  }

  if (!data[RECORDING_KEY]) {
    await setRecordingState(DEFAULT_RECORDING_STATE);
  }

  if (!data[RUN_KEY]) {
    await setRunState(DEFAULT_RUN_STATE);
  }

  if (!Array.isArray(data[ERROR_LOGS_KEY])) {
    await setErrorLogs([]);
  }

  if (!data[DEBUG_STATE_KEY]) {
    await setDebugState(DEFAULT_DEBUG_STATE);
  }

  if (!Array.isArray(data[DEBUG_LOGS_KEY])) {
    await setDebugLogs([]);
  }

  await updateBadge();
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!isFiniteTabId(tab.id)) return;

  const recording = await getRecordingState();
  if (recording.enabled) {
    const tracked = new Set(recording.trackedTabIds || []);
    if (isFiniteTabId(tab.openerTabId) && tracked.has(tab.openerTabId)) {
      await setRecordingState({
        ...recording,
        pendingPopupTabIds: [...(recording.pendingPopupTabIds || []), tab.id]
      });
    }
  }

  const runState = await getRunState();
  if (runState.running) {
    const openerCandidates = [runState.currentTabId, runState.rootTabId].filter(isFiniteTabId);
    if (isFiniteTabId(tab.openerTabId) && openerCandidates.includes(tab.openerTabId)) {
      await setRunState({
        ...runState,
        pendingPopupTabIds: [...(runState.pendingPopupTabIds || []), tab.id]
      });
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  await reviveRecordingOnTrackedTab(tabId, tab);
  await handleRecordingRelatedTab(tabId, tab);
  await handleRunRelatedTab(tabId, tab);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const recording = await getRecordingState();
  if (recording.enabled) {
    const nextTracked = (recording.trackedTabIds || []).filter((id) => id !== tabId);
    const nextPending = (recording.pendingPopupTabIds || []).filter((id) => id !== tabId);
    const nextKnown = (recording.knownTabIdsAtStart || []).filter((id) => id !== tabId);
    const nextPopupSteps = (recording.popupStepRecordedTabIds || []).filter((id) => id !== tabId);

    if (recording.rootTabId === tabId || nextTracked.length === 0) {
      await setRecordingState(DEFAULT_RECORDING_STATE);
    } else {
      await setRecordingState({
        ...recording,
        trackedTabIds: nextTracked,
        pendingPopupTabIds: nextPending,
        knownTabIdsAtStart: nextKnown,
        popupStepRecordedTabIds: nextPopupSteps
      });
    }
  }

  const runState = await getRunState();
  if (!runState.running) return;

  const nextPending = (runState.pendingPopupTabIds || []).filter((id) => id !== tabId);
  const nextKnown = (runState.knownTabIdsAtWaitStart || []).filter((id) => id !== tabId);
  const nextTrail = (runState.currentTabTrail || []).filter((id) => id !== tabId);

  if (runState.rootTabId === tabId) {
    await failRun("실행 기준 탭이 닫혀서 매크로를 중단했습니다.");
    return;
  }

  if (runState.currentTabId === tabId) {
    const restoredState = await restoreRunToPreviousTab(
      {
        ...runState,
        pendingPopupTabIds: nextPending,
        knownTabIdsAtWaitStart: nextKnown,
        currentTabTrail: nextTrail
      },
      tabId
    );
    if (restoredState?.running) {
      await continueMacroRun(restoredState);
    }
    return;
  }

  if (
    nextPending.length !== (runState.pendingPopupTabIds || []).length ||
    nextKnown.length !== (runState.knownTabIdsAtWaitStart || []).length ||
    nextTrail.length !== (runState.currentTabTrail || []).length
  ) {
    await setRunState({
      ...runState,
      pendingPopupTabIds: nextPending,
      knownTabIdsAtWaitStart: nextKnown,
      currentTabTrail: nextTrail
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POPUP_WAIT_ALARM) return;

  const runState = await getRunState();
  if (!runState.running || !runState.waitingForPopup) return;

  await failRun(`새 창 대기 시간 초과: ${runState.popupUrlIncludes || "조건 없음"}`);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case "GET_DATA": {
          const [steps, recording, runState, errorLogs, debug, debugLogs] = await Promise.all([
            getSteps(),
            getRecordingState(),
            getRunState(),
            getErrorLogs(),
            getDebugState(),
            getDebugLogs()
          ]);

          sendResponse({
            ok: true,
            steps,
            recording,
            run: runState,
            errorLogs,
            debug,
            debugLogs
          });
          return;
        }

        case "START_RECORDING": {
          const tabId = Number(message.tabId);
          if (!isFiniteTabId(tabId)) {
            throw new Error("기록을 시작할 탭을 찾을 수 없습니다.");
          }

          const [tab, allTabs] = await Promise.all([
            chrome.tabs.get(tabId),
            chrome.tabs.query({})
          ]);

          if (isRestrictedUrl(tab.url || "")) {
            throw new Error("이 페이지에서는 확장을 주입할 수 없습니다.");
          }

          await setRecordingState({
            enabled: true,
            initializing: true,
            rootTabId: tabId,
            rootWindowId: isFiniteTabId(tab.windowId) ? tab.windowId : null,
            rootOrigin: getUrlOrigin(tab.url || ""),
            rootHostname: getUrlHostname(tab.url || ""),
            startedAt: Date.now(),
            trackedTabIds: [tabId],
            pendingPopupTabIds: [],
            knownTabIdsAtStart: allTabs.map((item) => item.id).filter(isFiniteTabId),
            popupStepRecordedTabIds: []
          });

          try {
            await startRecordingOnTab(tabId);
          } catch (error) {
            await setRecordingState(DEFAULT_RECORDING_STATE);
            try {
              await updateBadge();
            } catch {
              // ignore badge failure
            }
            throw error;
          }

          try {
            await updateBadge();
          } catch {
            // ignore badge failure
          }

          sendResponse({
            ok: true,
            recording: await getRecordingState()
          });

          bootstrapRecordingSession(tabId, {
            skipRootStart: true
          }).catch(() => {
            // 개별 내부 단계에서 자체 로그/정리를 수행한다.
          });
          return;
        }

        case "STOP_RECORDING": {
          const recording = await getRecordingState();
          const tracked = Array.from(new Set(recording.trackedTabIds || []));

          for (const tabId of tracked) {
            await stopRecordingOnTab(tabId);
          }

          const nextState = await setRecordingState(DEFAULT_RECORDING_STATE);
          await updateBadge();

          sendResponse({
            ok: true,
            recording: nextState
          });
          return;
        }

        case "START_MACRO_RUN": {
          const tabId = Number(message.tabId);
          const steps = Array.isArray(message.steps) ? message.steps : [];
          const sanitized = steps.map(sanitizeStep).filter(Boolean);

          if (!isFiniteTabId(tabId)) {
            throw new Error("실행할 탭을 찾을 수 없습니다.");
          }

          if (!sanitized.length) {
            throw new Error("실행할 step이 없습니다.");
          }

          const tab = await chrome.tabs.get(tabId);
          if (isRestrictedUrl(tab.url || "")) {
            throw new Error("이 페이지에서는 확장을 실행할 수 없습니다.");
          }

          await ensureContentReady(tabId);

          await setRunState({
            running: true,
            rootTabId: tabId,
            rootWindowId: isFiniteTabId(tab.windowId) ? tab.windowId : null,
            rootOrigin: getUrlOrigin(tab.url || ""),
            rootHostname: getUrlHostname(tab.url || ""),
            currentTabId: tabId,
            currentTabTrail: [],
            steps: sanitized,
            stepIndex: 0,
            waitingForPopup: false,
            popupUrlIncludes: "",
            popupTimeout: 0,
            popupWaitStartedAt: 0,
            lastMessage: "매크로 실행 시작",
            error: "",
            pendingPopupTabIds: [],
            knownTabIdsAtWaitStart: []
          });

          continueMacroRun().catch(async (error) => {
            await failRun(error?.message || String(error));
          });

          sendResponse({
            ok: true,
            message: "백그라운드에서 매크로 실행을 시작했습니다."
          });
          return;
        }

        case "EXECUTE_MAIN_WORLD_CLICK": {
          const tabId = sender?.tab?.id;
          const frameId = sender?.frameId;
          const selector = typeof message.selector === "string" ? message.selector.trim() : "";

          if (!isFiniteTabId(tabId)) {
            throw new Error("실행할 탭을 찾을 수 없습니다.");
          }

          if (!selector) {
            throw new Error("클릭할 selector가 없습니다.");
          }

          const result = await executeMainWorldClick(tabId, frameId, selector);
          sendResponse(result);
          return;
        }

        case "APPEND_STEPS": {
          const steps = Array.isArray(message.steps) ? message.steps : [];
          const nextSteps = await appendSteps(steps);

          sendResponse({
            ok: true,
            steps: nextSteps
          });
          return;
        }

        case "SET_STEPS": {
          const steps = Array.isArray(message.steps) ? message.steps : [];
          const sanitized = steps.map(sanitizeStep).filter(Boolean);

          await setSteps(sanitized);

          sendResponse({
            ok: true,
            steps: sanitized
          });
          return;
        }

        case "CLEAR_STEPS": {
          await setSteps([]);

          sendResponse({
            ok: true,
            steps: []
          });
          return;
        }

        case "APPEND_ERROR_LOG": {
          const messageText = String(message.message || "").trim();
          if (!messageText) {
            throw new Error("저장할 오류 로그가 없습니다.");
          }

          const errorLogs = await appendErrorLog(messageText, message.source || "popup");

          sendResponse({
            ok: true,
            errorLogs
          });
          return;
        }

        case "CLEAR_ERROR_LOGS": {
          await setErrorLogs([]);

          sendResponse({
            ok: true,
            errorLogs: []
          });
          return;
        }

        case "SET_DEBUG_STATE": {
          const debug = await setDebugState({
            enabled: !!message.enabled
          });

          await broadcastDebugMode(debug.enabled);

          sendResponse({
            ok: true,
            debug
          });
          return;
        }

        case "APPEND_DEBUG_LOG": {
          const debugLogs = await appendDebugLog(message.entry || {});

          sendResponse({
            ok: true,
            debugLogs
          });
          return;
        }

        case "CLEAR_DEBUG_LOGS": {
          await setDebugLogs([]);

          sendResponse({
            ok: true,
            debugLogs: []
          });
          return;
        }

        default: {
          sendResponse({
            ok: false,
            message: "알 수 없는 메시지입니다."
          });
        }
      }
    } catch (error) {
      if (
        message?.type !== "GET_DATA" &&
        message?.type !== "APPEND_ERROR_LOG" &&
        message?.type !== "APPEND_DEBUG_LOG"
      ) {
        try {
          await appendErrorLog(error?.message || String(error), message?.type || "runtime");
        } catch {
          // ignore logging failure
        }
      }

      sendResponse({
        ok: false,
        message: error?.message || String(error)
      });
    }
  })();

  return true;
});
