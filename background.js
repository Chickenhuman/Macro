const STEPS_KEY = "macroSteps";
const SAVED_MACROS_KEY = "savedMacros";
const RECORDING_KEY = "macroRecordingState";
const RUN_KEY = "macroRunState";
const ERROR_LOGS_KEY = "macroErrorLogs";
const DEBUG_STATE_KEY = "macroDebugState";
const DEBUG_LOGS_KEY = "macroDebugLogs";
const RUN_TRACE_STATE_KEY = "macroRunTraceState";
const RUN_TRACE_LOGS_KEY = "macroRunTraceLogs";
const WORKSPACE_SESSION_KEY = "macroWorkspaceSessionInitialized";
const POPUP_WAIT_ALARM = "macroPopupWaitTimeout";

const DEFAULT_RECORDING_STATE = {
  enabled: false,
  initializing: false,
  rootTabId: null,
  rootWindowId: null,
  rootOrigin: "",
  rootHostname: "",
  startedAt: 0,
  lastRecordedAt: 0,
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
  currentFrameId: 0,
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
  knownTabIdsAtWaitStart: [],
  activeStepIndex: -1,
  activeStepType: "",
  activeStepTabId: null,
  repeatTotal: 1,
  repeatRemaining: 1,
  repeatDelayMs: 0,
  iteration: 1,
  restartOnError: false,
  hideRunOverlay: false
};

const DEFAULT_DEBUG_STATE = {
  enabled: false
};

const DEFAULT_RUN_TRACE_STATE = {
  enabled: true
};

let continueMacroRunInFlight = false;
let continueMacroRunQueued = false;
let continueMacroRunQueuedState = undefined;
let continueMacroRunQueuedStateSet = false;
let appendStepsInFlight = Promise.resolve();
let runTraceStateCache = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundRecordedDelay(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 400) return 0;
  return Math.min(30000, Math.round(ms / 100) * 100);
}

function isFiniteTabId(value) {
  return Number.isInteger(value) && value >= 0;
}

function isFiniteFrameId(value) {
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

function tryParseUrl(url, base) {
  if (!url) return null;

  try {
    return base ? new URL(url, base) : new URL(url);
  } catch {
    return null;
  }
}

function normalizeSearchParamsForMatch(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) {
    return "";
  }

  const pairs = [...searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) {
      return String(aValue).localeCompare(String(bValue));
    }

    return String(aKey).localeCompare(String(bKey));
  });
  const normalized = new URLSearchParams();

  for (const [key, value] of pairs) {
    normalized.append(key, value);
  }

  const serialized = normalized.toString();
  return serialized ? `?${serialized}` : "";
}

function normalizeUrlForMatch(url, base) {
  const parsed = tryParseUrl(url, base);
  if (!parsed) {
    return "";
  }

  return `${parsed.origin}${parsed.pathname}${normalizeSearchParamsForMatch(parsed.searchParams)}`;
}

function normalizeUrlPathForMatch(url, base) {
  const parsed = tryParseUrl(url, base);
  if (!parsed) {
    return "";
  }

  return `${parsed.pathname}${normalizeSearchParamsForMatch(parsed.searchParams)}`;
}

function collectFrameHintUrlCandidates(frameHint, frameInfos) {
  const absoluteCandidates = new Set();
  const pathCandidates = new Set();
  const bases = new Set();

  for (const frame of Array.isArray(frameInfos) ? frameInfos : []) {
    if (frame?.url) {
      bases.add(frame.url);
    }
  }

  const rawLocationHref = String(frameHint?.locationHref || "");
  const rawFrameSrc = String(frameHint?.frameSrc || "");

  if (rawLocationHref) {
    const absoluteLocationHref = normalizeUrlForMatch(rawLocationHref);
    const locationPath = normalizeUrlPathForMatch(rawLocationHref);
    if (absoluteLocationHref) {
      absoluteCandidates.add(absoluteLocationHref);
    }
    if (locationPath) {
      pathCandidates.add(locationPath);
    }
  }

  if (rawFrameSrc) {
    const absoluteFrameSrc = normalizeUrlForMatch(rawFrameSrc);
    const frameSrcPath = normalizeUrlPathForMatch(rawFrameSrc);
    if (absoluteFrameSrc) {
      absoluteCandidates.add(absoluteFrameSrc);
    }
    if (frameSrcPath) {
      pathCandidates.add(frameSrcPath);
    }

    for (const base of bases) {
      const resolvedFrameSrc = normalizeUrlForMatch(rawFrameSrc, base);
      const resolvedFrameSrcPath = normalizeUrlPathForMatch(rawFrameSrc, base);
      if (resolvedFrameSrc) {
        absoluteCandidates.add(resolvedFrameSrc);
      }
      if (resolvedFrameSrcPath) {
        pathCandidates.add(resolvedFrameSrcPath);
      }
    }
  }

  return {
    absoluteCandidates,
    pathCandidates
  };
}

function uniqTabIds(values) {
  return Array.from(new Set((values || []).filter(isFiniteTabId)));
}

function sanitizeTraceData(value, depth = 0) {
  if (value == null) return value;

  if (depth >= 4) {
    return "[depth-limit]";
  }

  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 997)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeTraceData(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 30);
    return entries.reduce((acc, [key, entryValue]) => {
      acc[key] = sanitizeTraceData(entryValue, depth + 1);
      return acc;
    }, {});
  }

  return String(value);
}

function summarizeTabForTrace(tab) {
  if (!tab || !isFiniteTabId(tab.id)) return null;

  return sanitizeTraceData({
    id: tab.id,
    url: String(tab.url || ""),
    pendingUrl: String(tab.pendingUrl || ""),
    title: String(tab.title || ""),
    status: String(tab.status || ""),
    windowId: Number.isInteger(tab.windowId) ? tab.windowId : null,
    openerTabId: isFiniteTabId(tab.openerTabId) ? tab.openerTabId : null,
    active: !!tab.active
  });
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
  const rawSteps = Array.isArray(data[STEPS_KEY]) ? data[STEPS_KEY] : [];
  const sanitized = rawSteps.map(sanitizeStep).filter(Boolean);

  if (JSON.stringify(rawSteps) !== JSON.stringify(sanitized)) {
    await setSteps(sanitized);
  }

  return sanitized;
}

function createSavedMacroId() {
  return `macro-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function setSteps(steps) {
  await chrome.storage.local.set({
    [STEPS_KEY]: Array.isArray(steps) ? steps : []
  });
}

async function ensureWorkspaceDefaultsForSession() {
  if (!chrome.storage?.session?.get || !chrome.storage?.session?.set) {
    return;
  }

  const session = await chrome.storage.session.get(WORKSPACE_SESSION_KEY);
  if (session[WORKSPACE_SESSION_KEY]) {
    return;
  }

  const [recording, runState] = await Promise.all([getRecordingState(), getRunState()]);

  if (!recording.enabled && !recording.initializing && !runState.running) {
    await setSteps([]);
  }

  await chrome.storage.session.set({
    [WORKSPACE_SESSION_KEY]: true
  });
}

function sanitizeSavedMacro(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const name = String(entry.name || "").trim();
  if (!name) {
    return null;
  }

  const steps = Array.isArray(entry.steps) ? entry.steps.map(sanitizeStep).filter(Boolean) : [];
  if (!steps.length) {
    return null;
  }

  const createdAt =
    typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
      ? entry.createdAt
      : Date.now();
  const updatedAt =
    typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
      ? entry.updatedAt
      : createdAt;

  return {
    id: String(entry.id || createSavedMacroId()),
    name,
    steps,
    createdAt,
    updatedAt
  };
}

function sortSavedMacros(entries) {
  return [...entries].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }

    return a.name.localeCompare(b.name, "ko");
  });
}

async function getSavedMacros() {
  const data = await chrome.storage.local.get(SAVED_MACROS_KEY);
  const normalized = Array.isArray(data[SAVED_MACROS_KEY])
    ? data[SAVED_MACROS_KEY].map(sanitizeSavedMacro).filter(Boolean)
    : [];

  return sortSavedMacros(normalized);
}

async function setSavedMacros(entries) {
  const normalized = sortSavedMacros((entries || []).map(sanitizeSavedMacro).filter(Boolean));
  await chrome.storage.local.set({
    [SAVED_MACROS_KEY]: normalized
  });

  return normalized;
}

async function saveMacro(name, steps) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("저장할 매크로 이름을 입력하세요.");
  }

  const sanitizedSteps = Array.isArray(steps) ? steps.map(sanitizeStep).filter(Boolean) : [];
  if (!sanitizedSteps.length) {
    throw new Error("저장할 step이 없습니다.");
  }

  const current = await getSavedMacros();
  const existing = current.find((item) => item.name === trimmedName);
  const now = Date.now();

  const nextEntry = sanitizeSavedMacro({
    id: existing?.id || createSavedMacroId(),
    name: trimmedName,
    steps: sanitizedSteps,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  const next = existing
    ? current.map((item) => (item.id === existing.id ? nextEntry : item))
    : [...current, nextEntry];

  const savedMacros = await setSavedMacros(next);
  return {
    savedMacros,
    savedMacro: savedMacros.find((item) => item.id === nextEntry.id) || nextEntry
  };
}

async function deleteSavedMacro(macroId) {
  const targetId = String(macroId || "").trim();
  if (!targetId) {
    throw new Error("삭제할 매크로를 찾지 못했습니다.");
  }

  const current = await getSavedMacros();
  const next = current.filter((item) => item.id !== targetId);

  if (next.length === current.length) {
    throw new Error("삭제할 매크로를 찾지 못했습니다.");
  }

  return await setSavedMacros(next);
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
  nextState.lastRecordedAt =
    typeof nextState.lastRecordedAt === "number" && Number.isFinite(nextState.lastRecordedAt)
      ? nextState.lastRecordedAt
      : 0;

  if (!nextState.enabled) {
    nextState.initializing = false;
    nextState.rootTabId = null;
    nextState.rootWindowId = null;
    nextState.rootOrigin = "";
    nextState.rootHostname = "";
    nextState.startedAt = 0;
    nextState.lastRecordedAt = 0;
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

async function getRunTraceState(forceRefresh = false) {
  if (!forceRefresh && runTraceStateCache) {
    return {
      ...DEFAULT_RUN_TRACE_STATE,
      ...runTraceStateCache
    };
  }

  const data = await chrome.storage.local.get(RUN_TRACE_STATE_KEY);
  runTraceStateCache = {
    ...DEFAULT_RUN_TRACE_STATE,
    ...(data[RUN_TRACE_STATE_KEY] || {})
  };

  runTraceStateCache.enabled = !!runTraceStateCache.enabled;
  return {
    ...runTraceStateCache
  };
}

async function setRunTraceState(state) {
  const nextState = {
    ...DEFAULT_RUN_TRACE_STATE,
    ...(state || {})
  };

  nextState.enabled = !!nextState.enabled;
  runTraceStateCache = nextState;

  await chrome.storage.local.set({
    [RUN_TRACE_STATE_KEY]: nextState
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

async function getRunTraceLogs() {
  const data = await chrome.storage.local.get(RUN_TRACE_LOGS_KEY);
  return Array.isArray(data[RUN_TRACE_LOGS_KEY]) ? data[RUN_TRACE_LOGS_KEY] : [];
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

async function setRunTraceLogs(entries) {
  await chrome.storage.local.set({
    [RUN_TRACE_LOGS_KEY]: Array.isArray(entries) ? entries.slice(-400) : []
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

async function appendRunTraceLog(entry) {
  const runTraceState = await getRunTraceState();
  if (!runTraceState.enabled) {
    return [];
  }

  const current = await getRunTraceLogs();
  const nextEntry = {
    at: Date.now(),
    source: String(entry?.source || "run:background"),
    eventType: String(entry?.eventType || "trace"),
    pageUrl: String(entry?.pageUrl || ""),
    tabId: isFiniteTabId(entry?.tabId) ? entry.tabId : null,
    frameId: isFiniteFrameId(entry?.frameId) ? entry.frameId : null,
    stepIndex: Number.isInteger(entry?.stepIndex) ? entry.stepIndex : null,
    stepType: typeof entry?.stepType === "string" ? entry.stepType : "",
    message: typeof entry?.message === "string" ? entry.message : "",
    step: sanitizeStep(entry?.step) || null,
    detail: sanitizeTraceData(entry?.detail ?? null)
  };

  const next = [...current, nextEntry].slice(-400);
  await setRunTraceLogs(next);
  return next;
}

async function setRunState(state) {
  const nextState = {
    ...DEFAULT_RUN_STATE,
    ...(state || {})
  };

  nextState.steps = Array.isArray(nextState.steps) ? nextState.steps : [];
  nextState.currentFrameId = isFiniteFrameId(nextState.currentFrameId) ? nextState.currentFrameId : 0;
  nextState.currentTabTrail = uniqTabIds(nextState.currentTabTrail);
  nextState.pendingPopupTabIds = uniqTabIds(nextState.pendingPopupTabIds);
  nextState.knownTabIdsAtWaitStart = uniqTabIds(nextState.knownTabIdsAtWaitStart);
  nextState.repeatTotal =
    Number.isInteger(nextState.repeatTotal) && nextState.repeatTotal > 0 ? nextState.repeatTotal : 1;
  nextState.repeatRemaining =
    Number.isInteger(nextState.repeatRemaining) && nextState.repeatRemaining > 0
      ? nextState.repeatRemaining
      : nextState.repeatTotal;
  nextState.repeatDelayMs =
    typeof nextState.repeatDelayMs === "number" && nextState.repeatDelayMs >= 0
      ? nextState.repeatDelayMs
      : 0;
  nextState.iteration =
    Number.isInteger(nextState.iteration) && nextState.iteration > 0 ? nextState.iteration : 1;
  nextState.restartOnError = !!nextState.restartOnError;
  nextState.hideRunOverlay = !!nextState.hideRunOverlay;

  if (!nextState.running) {
    nextState.rootTabId = null;
    nextState.rootWindowId = null;
    nextState.rootOrigin = "";
    nextState.rootHostname = "";
    nextState.currentTabId = null;
    nextState.currentFrameId = 0;
    nextState.currentTabTrail = [];
    nextState.steps = [];
    nextState.stepIndex = 0;
    nextState.waitingForPopup = false;
    nextState.popupUrlIncludes = "";
    nextState.popupTimeout = 0;
    nextState.popupWaitStartedAt = 0;
    nextState.pendingPopupTabIds = [];
    nextState.knownTabIdsAtWaitStart = [];
    nextState.activeStepIndex = -1;
    nextState.activeStepType = "";
    nextState.activeStepTabId = null;
    nextState.repeatTotal = 1;
    nextState.repeatRemaining = 1;
    nextState.repeatDelayMs = 0;
    nextState.iteration = 1;
    nextState.restartOnError = false;
    nextState.hideRunOverlay = false;
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
  if (typeof step.key === "string") clean.key = step.key;
  if (typeof step.code === "string") clean.code = step.code;
  if (typeof step.timeout === "number") clean.timeout = step.timeout;
  if (typeof step.interval === "number") clean.interval = step.interval;
  if (typeof step.ms === "number") clean.ms = step.ms;
  if (typeof step.urlIncludes === "string") clean.urlIncludes = step.urlIncludes;

  if (clean.type === "key" && !clean.key && !clean.code) {
    clean.key = " ";
    clean.code = "Space";
  }

  return clean;
}

function getUrlHintFromUrl(url) {
  const popupStep = buildPopupWaitStepFromUrl(url);
  return typeof popupStep?.urlIncludes === "string" ? popupStep.urlIncludes.trim() : "";
}

function applyRecordedStepContext(steps, recording, options = {}) {
  const sourceTabId = Number(options.sourceTabId);
  const sourceTabUrl = String(options.sourceTabUrl || "");

  if (!recording?.enabled || !isFiniteTabId(sourceTabId)) {
    return steps;
  }

  if (!isFiniteTabId(recording.rootTabId) || sourceTabId === recording.rootTabId) {
    return steps;
  }

  const tracked = new Set(recording.trackedTabIds || []);
  if (!tracked.has(sourceTabId)) {
    return steps;
  }

  const urlHint = getUrlHintFromUrl(sourceTabUrl);
  if (!urlHint) {
    return steps;
  }

  return (steps || []).map((step) => {
    if (!step || typeof step !== "object") {
      return step;
    }

    if (step.type === "wait" || step.type === "waitForPopup") {
      return step;
    }

    if (typeof step.urlIncludes === "string" && step.urlIncludes.trim()) {
      return step;
    }

    return {
      ...step,
      urlIncludes: urlHint
    };
  });
}

async function appendSteps(newSteps, options = {}) {
  const run = appendStepsInFlight.catch(() => {}).then(async () => {
    let sanitized = (newSteps || []).map(sanitizeStep).filter(Boolean);
    if (!sanitized.length) {
      return await getSteps();
    }

    const [currentSteps, recording] = await Promise.all([getSteps(), getRecordingState()]);
    sanitized = applyRecordedStepContext(sanitized, recording, options);
    const nextSteps = [...currentSteps];
    const recordedAt =
      typeof options.recordedAt === "number" && Number.isFinite(options.recordedAt)
        ? options.recordedAt
        : Date.now();
    const previousRecordedAt =
      typeof recording.lastRecordedAt === "number" && Number.isFinite(recording.lastRecordedAt)
        ? recording.lastRecordedAt
        : 0;

    const hasRecordedAction = sanitized.some((step) => step.type !== "wait");
    const startsWithImmediateTimingStep =
      sanitized[0]?.type === "wait" || sanitized[0]?.type === "waitForPopup";

    if (
      recording.enabled &&
      previousRecordedAt > 0 &&
      hasRecordedAction &&
      !startsWithImmediateTimingStep
    ) {
      const gap = roundRecordedDelay(recordedAt - previousRecordedAt);
      if (gap > 0) {
        nextSteps.push({
          type: "wait",
          ms: gap
        });
      }
    }

    nextSteps.push(...sanitized);

    await setSteps(nextSteps);

    if (recording.enabled && hasRecordedAction) {
      await setRecordingState({
        ...recording,
        lastRecordedAt: recordedAt
      });
    }

    return nextSteps;
  });

  appendStepsInFlight = run;
  return await run;
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

async function sendTabMessageToFrame(tabId, message, frameId) {
  if (isFiniteFrameId(frameId)) {
    return await chrome.tabs.sendMessage(tabId, message, {
      frameId
    });
  }

  return await sendTabMessage(tabId, message);
}

async function getTabFrames(tabId) {
  if (!chrome.webNavigation?.getAllFrames) {
    return [
      {
        frameId: 0,
        parentFrameId: null,
        url: ""
      }
    ];
  }

  try {
    const frames = await chrome.webNavigation.getAllFrames({
      tabId
    });
    const byFrameId = new Map();

    for (const frame of frames || []) {
      if (!isFiniteFrameId(frame?.frameId)) continue;
      byFrameId.set(frame.frameId, {
        frameId: frame.frameId,
        parentFrameId: isFiniteFrameId(frame?.parentFrameId) ? frame.parentFrameId : null,
        url: String(frame?.url || "")
      });
    }

    if (!byFrameId.has(0)) {
      byFrameId.set(0, {
        frameId: 0,
        parentFrameId: null,
        url: ""
      });
    }

    return [...byFrameId.values()].sort((a, b) => a.frameId - b.frameId);
  } catch {
    return [
      {
        frameId: 0,
        parentFrameId: null,
        url: ""
      }
    ];
  }
}

async function getTabFrameIds(tabId) {
  const frames = await getTabFrames(tabId);
  return frames.map((frame) => frame.frameId).filter(isFiniteFrameId);
}

async function broadcastTabMessage(tabId, message) {
  const frameIds = await getTabFrameIds(tabId);

  if (!frameIds.length) {
    return [
      {
        frameId: null,
        response: await sendTabMessage(tabId, message)
      }
    ];
  }

  const responses = [];

  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message, {
        frameId
      });
      responses.push({
        frameId,
        response
      });
    } catch {
      // frame-level delivery is best-effort; other frames may still respond
    }
  }

  if (responses.length) {
    return responses;
  }

  return [
    {
      frameId: null,
      response: await sendTabMessage(tabId, message)
    }
  ];
}

function shouldResolveRunStepFrame(step) {
  if (!step || typeof step !== "object") {
    return false;
  }

  if (step.type === "waitForPopup" || step.type === "wait") {
    return false;
  }

  return typeof step.selector === "string" && step.selector.trim().length > 0;
}

function normalizeResolvedFrameId(frameId, fallback = 0) {
  if (isFiniteFrameId(frameId)) {
    return frameId;
  }

  return isFiniteFrameId(fallback) ? fallback : 0;
}

function scoreRunFrameCandidate(candidate, preferredFrameId = 0) {
  let score = typeof candidate?.response?.score === "number" ? candidate.response.score : -1;

  if (score < 0) {
    return score;
  }

  const frameId = normalizeResolvedFrameId(candidate?.frameId, preferredFrameId);
  const detail = candidate?.response?.detail || {};

  if (frameId === normalizeResolvedFrameId(preferredFrameId, 0)) {
    score += 40;
  }

  if (detail.documentHasFocus) {
    score += 20;
  }

  if (detail.activeElement?.selector === candidate?.response?.target?.selector) {
    score += 20;
  }

  return score;
}

function summarizeRunFrameCandidateForTrace(candidate, preferredFrameId = 0) {
  if (!candidate) return null;

  const detail = candidate.response?.detail || {};
  return sanitizeTraceData({
    frameId: normalizeResolvedFrameId(candidate.frameId, preferredFrameId),
    score: scoreRunFrameCandidate(candidate, preferredFrameId),
    rawScore: typeof candidate?.response?.score === "number" ? candidate.response.score : -1,
    locationHref: detail.locationHref || "",
    topFrame: !!detail.topFrame,
    documentHasFocus: !!detail.documentHasFocus,
    target: candidate.response?.target || null,
    activeElement: detail.activeElement || null,
    selectorTrace: detail.selectorTrace || null
  });
}

function scoreRunFrameHintCandidate(candidate, preferredFrameId = 0) {
  if (!candidate) return -1;

  let score = 120;

  if (candidate.frameId === normalizeResolvedFrameId(preferredFrameId, 0)) {
    score += 30;
  }

  if (candidate.hint?.active) {
    score += 30;
  }

  if (candidate.hint?.visible) {
    score += 20;
  }

  if (candidate.hint?.topLevel) {
    score += 10;
  }

  const frameName = String(candidate.hint?.frameName || "").toLowerCase();
  const frameIdAttr = String(candidate.hint?.frameIdAttr || "").toLowerCase();
  if (frameName === "_content" || frameIdAttr === "_content") {
    score += 40;
  }

  if (candidate.hint?.locationHref) {
    score += 15;
  }

  return score;
}

function summarizeRunFrameHintCandidateForTrace(candidate, preferredFrameId = 0) {
  if (!candidate) return null;

  return sanitizeTraceData({
    frameId: normalizeResolvedFrameId(candidate.frameId, preferredFrameId),
    score: scoreRunFrameHintCandidate(candidate, preferredFrameId),
    source: "descendant-frame-hint",
    locationHref: candidate.hint?.locationHref || "",
    frameIdAttr: candidate.hint?.frameIdAttr || "",
    frameName: candidate.hint?.frameName || "",
    frameSrc: candidate.hint?.frameSrc || "",
    active: !!candidate.hint?.active,
    visible: !!candidate.hint?.visible,
    topLevel: !!candidate.hint?.topLevel,
    sourceFrameId: normalizeResolvedFrameId(candidate.sourceFrameId, 0)
  });
}

function matchRunFrameHintToFrame(frameHint, frameInfos) {
  if (!frameHint || !Array.isArray(frameInfos) || !frameInfos.length) {
    return null;
  }

  const childFrames = frameInfos.filter((frame) => frame.frameId !== 0);
  if (!childFrames.length) {
    return null;
  }

  const locationHref = String(frameHint.locationHref || "");
  if (locationHref) {
    const exactMatch = childFrames.find((frame) => frame.url === locationHref);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const frameSrc = String(frameHint.frameSrc || "");
  if (frameSrc) {
    const srcMatch = childFrames.find((frame) => frame.url === frameSrc);
    if (srcMatch) {
      return srcMatch;
    }
  }

  const { absoluteCandidates, pathCandidates } = collectFrameHintUrlCandidates(frameHint, frameInfos);

  if (absoluteCandidates.size) {
    const normalizedAbsoluteMatch = childFrames.find((frame) => absoluteCandidates.has(normalizeUrlForMatch(frame.url)));
    if (normalizedAbsoluteMatch) {
      return normalizedAbsoluteMatch;
    }
  }

  if (pathCandidates.size) {
    const pathMatches = childFrames.filter((frame) => pathCandidates.has(normalizeUrlPathForMatch(frame.url)));
    if (pathMatches.length === 1) {
      return pathMatches[0];
    }
  }

  return null;
}

function hasIframeLikeActiveElement(detail) {
  const tag = String(detail?.activeElement?.tag || "").toLowerCase();
  return tag === "iframe" || tag === "frame";
}

function responseHasRunStepFrameHints(response) {
  const detail = response?.detail || {};
  return (
    Array.isArray(detail.childFrameHints) && detail.childFrameHints.length > 0 ||
    Array.isArray(detail.topLevelFrameHints) && detail.topLevelFrameHints.length > 0 ||
    !!detail.activeFrameHint ||
    hasIframeLikeActiveElement(detail)
  );
}

function shouldRetryRunStepFrameResolution(responses, fallbackFrameId = 0) {
  if (normalizeResolvedFrameId(fallbackFrameId, 0) !== 0) {
    return false;
  }

  return (responses || []).some((entry) => responseHasRunStepFrameHints(entry?.response));
}

function resolveRunStepFrameWithContext(frameInfos, responses, fallbackFrameId = 0) {
  const candidates = (responses || [])
    .filter((entry) => entry?.response?.ok && entry.response.canRun)
    .map((entry) => ({
      frameId: normalizeResolvedFrameId(entry?.frameId, fallbackFrameId),
      response: entry.response
    }))
    .sort((a, b) => {
      const scoreDiff = scoreRunFrameCandidate(b, fallbackFrameId) - scoreRunFrameCandidate(a, fallbackFrameId);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const aIsPreferred = a.frameId === fallbackFrameId ? 1 : 0;
      const bIsPreferred = b.frameId === fallbackFrameId ? 1 : 0;
      return bIsPreferred - aIsPreferred;
    });

  if (!candidates.length) {
    const hintedCandidates = [];
    const hintedFrameIds = new Set();

    for (const entry of responses || []) {
      const childFrameHints = Array.isArray(entry?.response?.detail?.childFrameHints)
        ? entry.response.detail.childFrameHints
        : [];
      const topLevelFrameHints = Array.isArray(entry?.response?.detail?.topLevelFrameHints)
        ? entry.response.detail.topLevelFrameHints
        : [];

      for (const hint of childFrameHints) {
        const matchedFrame = matchRunFrameHintToFrame(hint, frameInfos);
        if (!matchedFrame || hintedFrameIds.has(matchedFrame.frameId)) {
          continue;
        }

        hintedFrameIds.add(matchedFrame.frameId);
        hintedCandidates.push({
          frameId: matchedFrame.frameId,
          hint,
          sourceFrameId: normalizeResolvedFrameId(entry?.frameId, fallbackFrameId)
        });
      }

      for (const hint of topLevelFrameHints) {
        const matchedFrame = matchRunFrameHintToFrame(hint, frameInfos);
        if (!matchedFrame || hintedFrameIds.has(matchedFrame.frameId)) {
          continue;
        }

        hintedFrameIds.add(matchedFrame.frameId);
        hintedCandidates.push({
          frameId: matchedFrame.frameId,
          hint,
          sourceFrameId: normalizeResolvedFrameId(entry?.frameId, fallbackFrameId)
        });
      }

      const activeFrameHint = entry?.response?.detail?.activeFrameHint;
      const matchedActiveFrame = matchRunFrameHintToFrame(activeFrameHint, frameInfos);
      if (matchedActiveFrame && !hintedFrameIds.has(matchedActiveFrame.frameId)) {
        hintedFrameIds.add(matchedActiveFrame.frameId);
        hintedCandidates.push({
          frameId: matchedActiveFrame.frameId,
          hint: {
            ...activeFrameHint,
            active: true,
            topLevel: true
          },
          sourceFrameId: normalizeResolvedFrameId(entry?.frameId, fallbackFrameId)
        });
      }

      const activeElement = entry?.response?.detail?.activeElement;
      const soleChildFrames = frameInfos.filter(
        (frame) => frame.frameId !== 0 && normalizeResolvedFrameId(frame.parentFrameId, 0) === 0
      );
      if (
        activeElement?.tag === "iframe" &&
        soleChildFrames.length === 1 &&
        !hintedFrameIds.has(soleChildFrames[0].frameId)
      ) {
        hintedFrameIds.add(soleChildFrames[0].frameId);
        hintedCandidates.push({
          frameId: soleChildFrames[0].frameId,
          hint: {
            frameIdAttr: activeElement.id || "",
            frameName: activeElement.name || "",
            frameSrc: "",
            locationHref: soleChildFrames[0].url || "",
            active: true,
            visible: !!activeElement.visible,
            topLevel: true
          },
          sourceFrameId: normalizeResolvedFrameId(entry?.frameId, fallbackFrameId)
        });
      }
    }

    if (!hintedCandidates.length) {
      const directChildFrames = frameInfos.filter(
        (frame) => frame.frameId !== 0 && normalizeResolvedFrameId(frame.parentFrameId, 0) === 0
      );

      if (directChildFrames.length === 1) {
        hintedCandidates.push({
          frameId: directChildFrames[0].frameId,
          hint: {
            frameIdAttr: "",
            frameName: "",
            frameSrc: "",
            locationHref: directChildFrames[0].url || "",
            active: false,
            visible: true,
            topLevel: true
          },
          sourceFrameId: fallbackFrameId
        });
      }
    }

    if (hintedCandidates.length) {
      hintedCandidates.sort((a, b) => {
        const scoreDiff =
          scoreRunFrameHintCandidate(b, fallbackFrameId) - scoreRunFrameHintCandidate(a, fallbackFrameId);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        const aIsPreferred = a.frameId === fallbackFrameId ? 1 : 0;
        const bIsPreferred = b.frameId === fallbackFrameId ? 1 : 0;
        return bIsPreferred - aIsPreferred;
      });

      return {
        frameId: hintedCandidates[0].frameId,
        candidates: hintedCandidates.map((entry) =>
          summarizeRunFrameHintCandidateForTrace(entry, fallbackFrameId)
        ),
        matched: true
      };
    }

    return {
      frameId: fallbackFrameId,
      candidates: [],
      matched: false
    };
  }

  return {
    frameId: candidates[0].frameId,
    candidates: candidates.map((entry) => summarizeRunFrameCandidateForTrace(entry, fallbackFrameId)),
    matched: true
  };
}

async function resolveRunStepFrame(tabId, step, preferredFrameId = 0) {
  const fallbackFrameId = normalizeResolvedFrameId(preferredFrameId, 0);

  if (!shouldResolveRunStepFrame(step)) {
    return {
      frameId: fallbackFrameId,
      candidates: [],
      matched: false
    };
  }

  let frameInfos = await getTabFrames(tabId);
  let responses = await broadcastTabMessage(tabId, {
    type: "LOCATE_RUN_STEP_TARGET",
    step
  });
  let resolved = resolveRunStepFrameWithContext(frameInfos, responses, fallbackFrameId);

  if (resolved.matched || !shouldRetryRunStepFrameResolution(responses, fallbackFrameId)) {
    return resolved;
  }

  const retryUntil = Date.now() + 1200;

  while (Date.now() < retryUntil) {
    await delay(150);

    try {
      await injectContentScript(tabId);
    } catch {
      // frame rebinding is best-effort during frame resolution retries
    }

    frameInfos = await getTabFrames(tabId);
    responses = await broadcastTabMessage(tabId, {
      type: "LOCATE_RUN_STEP_TARGET",
      step
    });
    resolved = resolveRunStepFrameWithContext(frameInfos, responses, fallbackFrameId);

    if (resolved.matched || !shouldRetryRunStepFrameResolution(responses, fallbackFrameId)) {
      return resolved;
    }
  }

  return resolved;
}

function collectRunDialogTabIds(runState) {
  return uniqTabIds([
    runState?.rootTabId,
    runState?.currentTabId,
    ...(runState?.currentTabTrail || []),
    ...(runState?.pendingPopupTabIds || [])
  ]);
}

async function setNativeDialogAutoAccept(tabId, enabled) {
  if (!isFiniteTabId(tabId)) return false;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [!!enabled],
      func: (nextEnabled) => {
        const KEY = "__EASY_WEB_MACRO_NATIVE_DIALOG_PATCH__";
        let state = window[KEY];

        if (!state) {
          state = {
            enabled: false,
            nativeAlert: window.alert,
            nativeConfirm: window.confirm
          };

          Object.defineProperty(window, KEY, {
            value: state,
            configurable: true
          });

          window.alert = function (...args) {
            if (window[KEY]?.enabled) {
              return undefined;
            }

            return state.nativeAlert.apply(window, args);
          };

          window.confirm = function (...args) {
            if (window[KEY]?.enabled) {
              return true;
            }

            return state.nativeConfirm.apply(window, args);
          };
        }

        state.enabled = !!nextEnabled;
        return { ok: true };
      }
    });

    return true;
  } catch {
    return false;
  }
}

async function syncRunDialogAutoAccept(runState, enabled) {
  const tabIds = collectRunDialogTabIds(runState);

  for (const tabId of tabIds) {
    await setNativeDialogAutoAccept(tabId, enabled);
  }
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

function isMissingTabError(error) {
  const message = String(error?.message || error || "");
  return message.includes("No tab with id");
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

  const responses = await broadcastTabMessage(tabId, {
    type: "START_RECORD",
    debugEnabled: !!debugState.enabled
  });

  const success = responses.some((entry) => entry?.response?.ok);
  if (!success) {
    const failed = responses.find((entry) => entry?.response && entry.response.ok === false);
    throw new Error(failed?.response?.message || "기록 시작 실패");
  }
}

async function broadcastDebugMode(enabled) {
  const recording = await getRecordingState();
  const tracked = uniqTabIds(recording.trackedTabIds);

  for (const tabId of tracked) {
    try {
      await broadcastTabMessage(tabId, {
        type: "SET_DEBUG_MODE",
        enabled: !!enabled
      });
    } catch {
      // ignore missing or unloaded content scripts
    }
  }
}

async function broadcastRunTraceMode(enabled) {
  const runState = await getRunState();
  const tabIds = collectRunDialogTabIds(runState);

  for (const tabId of tabIds) {
    try {
      await broadcastTabMessage(tabId, {
        type: "SET_RUN_TRACE_MODE",
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
    await broadcastTabMessage(tabId, {
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
  const runState = await getRunState();
  const errorMessage = String(message || "실행 실패");
  await clearPopupWaitAlarm();
  await appendErrorLog(errorMessage, "run");

  if (runState.running && runState.restartOnError && runState.repeatRemaining > 1) {
    try {
      const nextState = await continueMacroRunFromNextIterationAfterError(runState, errorMessage);
      await continueMacroRun(nextState);
      return;
    } catch (advanceError) {
      await appendRunTraceLog({
        source: "run:background",
        eventType: "run-error-next-iteration-failed",
        tabId: runState.currentTabId,
        stepIndex: runState.stepIndex,
        stepType: runState.activeStepType || sanitizeStep(runState.steps?.[runState.stepIndex])?.type || "",
        message: advanceError?.message || String(advanceError),
        step: runState.steps?.[runState.stepIndex] || null,
        detail: {
          failedMessage: errorMessage,
          iteration: runState.iteration || 1,
          repeatTotal: runState.repeatTotal || 1
        }
      });
    }
  }

  await appendRunTraceLog({
    source: "run:background",
    eventType: "run-failed",
    tabId: runState.currentTabId,
    stepIndex: runState.stepIndex,
    stepType: runState.activeStepType || sanitizeStep(runState.steps?.[runState.stepIndex])?.type || "",
    message: errorMessage,
    step: runState.steps?.[runState.stepIndex] || null,
    detail: {
      currentTabTrail: runState.currentTabTrail || [],
      waitingForPopup: !!runState.waitingForPopup,
      popupUrlIncludes: runState.popupUrlIncludes || "",
      pendingPopupTabIds: runState.pendingPopupTabIds || [],
      knownTabIdsAtWaitStart: runState.knownTabIdsAtWaitStart || []
    }
  });

  await syncRunDialogAutoAccept(runState, false);
  await setRunState({
    running: false,
    lastMessage: `오류: ${errorMessage}`,
    error: errorMessage
  });
}

async function finishRun(message) {
  const runState = await getRunState();
  await appendRunTraceLog({
    source: "run:background",
    eventType: "run-finished",
    tabId: runState.currentTabId,
    stepIndex: runState.stepIndex,
    message: String(message || "실행 완료")
  });
  await syncRunDialogAutoAccept(runState, false);
  await clearPopupWaitAlarm();
  await setRunState({
    running: false,
    lastMessage: message || "실행 완료",
    error: ""
  });
}

async function stopRun(message) {
  const runState = await getRunState();
  await appendRunTraceLog({
    source: "run:background",
    eventType: "run-stopped",
    tabId: runState.currentTabId,
    stepIndex: runState.stepIndex,
    message: String(message || "실행 중지됨")
  });
  await syncRunDialogAutoAccept(runState, false);
  await clearPopupWaitAlarm();
  return await setRunState({
    running: false,
    lastMessage: message || "실행 중지됨",
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

function scorePopupCandidate(tab, runState, step, options = {}) {
  if (!tab || !isFiniteTabId(tab.id)) return -1;
  if (isRestrictedUrl(tab.url || "")) return -1;
  if (tab.id === runState.currentTabId) return -1;

  const allowSameOriginFallback = options.allowSameOriginFallback !== false;
  const expected = String(step.urlIncludes || "").trim();
  if (expected && !(tab.url || "").includes(expected)) {
    return -1;
  }

  let score = 0;
  let matchedRelationship = false;

  const openerCandidates = [runState.currentTabId, runState.rootTabId].filter(isFiniteTabId);
  if (openerCandidates.includes(tab.openerTabId)) {
    score += 100;
    matchedRelationship = true;
  }

  if ((runState.pendingPopupTabIds || []).includes(tab.id)) {
    score += 90;
    matchedRelationship = true;
  }

  const knownAtWaitStart = new Set(runState.knownTabIdsAtWaitStart || []);
  const sameOriginOtherWindow =
    runState.rootWindowId != null &&
    tab.windowId !== runState.rootWindowId &&
    isSameOriginOrHostname(tab.url || "", runState.rootOrigin, runState.rootHostname);

  if (allowSameOriginFallback && sameOriginOtherWindow && !knownAtWaitStart.has(tab.id)) {
    score += 70;
    matchedRelationship = true;
  }

  if (!matchedRelationship) {
    return -1;
  }

  if (tab.active) {
    score += 20;
  }

  if (typeof tab.lastAccessed === "number") {
    score += Math.min(10, Math.floor(tab.lastAccessed / 100000000000));
  }

  return score;
}

function findBestPopupCandidate(tabs, runState, step, options = {}) {
  let bestTab = null;
  let bestScore = -1;

  for (const tab of tabs || []) {
    const score = scorePopupCandidate(tab, runState, step, options);
    if (score > bestScore) {
      bestScore = score;
      bestTab = tab;
    }
  }

  return bestScore >= 0 ? bestTab : null;
}

function collectPopupCandidatesForTrace(tabs, runState, step, options = {}) {
  return (tabs || [])
    .map((tab) => ({
      score: scorePopupCandidate(tab, runState, step, options),
      tab: summarizeTabForTrace(tab)
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

async function switchRunToTab(runState, tabId, message) {
  await ensureContentReady(tabId);
  await setNativeDialogAutoAccept(tabId, true);

  const nextTrail = [...(runState.currentTabTrail || [])];
  if (isFiniteTabId(runState.currentTabId) && runState.currentTabId !== tabId) {
    nextTrail.push(runState.currentTabId);
  }

  const nextState = await setRunState({
    ...runState,
    currentTabId: tabId,
    currentFrameId: 0,
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

  await appendRunTraceLog({
    source: "run:background",
    eventType: "switch-tab",
    tabId,
    stepIndex: nextState.stepIndex,
    message: message || `새 창으로 전환: ${tabId}`,
    detail: {
      previousTabId: runState.currentTabId,
      currentTabTrail: nextState.currentTabTrail || []
    }
  });

  return nextState;
}

async function completeWaitForCurrentRunTab(runState, tab) {
  await ensureContentReady(tab.id);
  await setNativeDialogAutoAccept(tab.id, true);
  await clearPopupWaitAlarm();

  const nextState = await setRunState({
    ...runState,
    currentFrameId: 0,
    stepIndex: runState.stepIndex + 1,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: `현재 탭 새로고침 완료: ${tab.url || tab.title || tab.id}`,
    error: "",
    pendingPopupTabIds: (runState.pendingPopupTabIds || []).filter((id) => id !== tab.id),
    knownTabIdsAtWaitStart: []
  });

  await appendRunTraceLog({
    source: "run:background",
    eventType: "wait-for-current-tab-complete",
    tabId: tab.id,
    stepIndex: nextState.stepIndex,
    stepType: "waitForPopup",
    message: `현재 탭 대기 완료: ${tab.url || tab.id}`,
    detail: {
      tab: summarizeTabForTrace(tab)
    }
  });

  await continueMacroRun(nextState);
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
      await setNativeDialogAutoAccept(fallbackTabId, true);

      const nextState = await setRunState({
        ...runState,
        currentTabId: fallbackTabId,
        currentFrameId: 0,
        currentTabTrail: trail,
        lastMessage: `팝업이 닫혀 이전 탭으로 복귀: ${fallbackTab.url || fallbackTab.title || fallbackTabId}`,
        error: ""
      });

      await appendRunTraceLog({
        source: "run:background",
        eventType: "restore-previous-tab",
        tabId: fallbackTabId,
        stepIndex: nextState.stepIndex,
        message: nextState.lastMessage,
        detail: {
          closedTabId,
          currentTabTrail: nextState.currentTabTrail || [],
          tab: summarizeTabForTrace(fallbackTab)
        }
      });

      return nextState;
    } catch {
      // 다음 후보를 확인
    }
  }

  if (isFiniteTabId(runState.rootTabId) && runState.rootTabId !== closedTabId) {
    try {
      const rootTab = await chrome.tabs.get(runState.rootTabId);
      if (!isRestrictedUrl(rootTab.url || "")) {
        await ensureContentReady(runState.rootTabId);
        await setNativeDialogAutoAccept(runState.rootTabId, true);

        const nextState = await setRunState({
          ...runState,
          currentTabId: runState.rootTabId,
          currentFrameId: 0,
          currentTabTrail: [],
          lastMessage: `팝업이 닫혀 루트 탭으로 복귀: ${rootTab.url || rootTab.title || runState.rootTabId}`,
          error: ""
        });

        await appendRunTraceLog({
          source: "run:background",
          eventType: "restore-root-tab",
          tabId: runState.rootTabId,
          stepIndex: nextState.stepIndex,
          message: nextState.lastMessage,
          detail: {
            closedTabId,
            tab: summarizeTabForTrace(rootTab)
          }
        });

        return nextState;
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
  const hasPreStepKnownTabs = (runState.knownTabIdsAtWaitStart || []).length > 0;
  const traceOptions = {
    allowSameOriginFallback: hasPreStepKnownTabs
  };
  const candidateTrace = collectPopupCandidatesForTrace(tabs, runState, step, traceOptions);
  await appendRunTraceLog({
    source: "run:background",
    eventType: "wait-for-popup-check",
    tabId: runState.currentTabId,
    stepIndex: runState.stepIndex,
    stepType: "waitForPopup",
    message: `새 창 후보 확인: ${step.urlIncludes || "URL 조건 없음"}`,
    step,
    detail: {
      pendingPopupTabIds: runState.pendingPopupTabIds || [],
      knownTabIdsAtWaitStart: runState.knownTabIdsAtWaitStart || [],
      candidates: candidateTrace
    }
  });
  const found = findBestPopupCandidate(tabs, runState, step, {
    allowSameOriginFallback: hasPreStepKnownTabs
  });

  if (found) {
    await appendRunTraceLog({
      source: "run:background",
      eventType: "wait-for-popup-found",
      tabId: found.id,
      stepIndex: runState.stepIndex,
      stepType: "waitForPopup",
      message: `새 창 즉시 감지: ${found.url || found.id}`,
      step,
      detail: {
        tab: summarizeTabForTrace(found)
      }
    });
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
    knownTabIdsAtWaitStart:
      hasPreStepKnownTabs ? runState.knownTabIdsAtWaitStart : tabs.map((tab) => tab.id).filter(isFiniteTabId)
  });

  await appendRunTraceLog({
    source: "run:background",
    eventType: "wait-for-popup-start",
    tabId: runState.currentTabId,
    stepIndex: runState.stepIndex,
    stepType: "waitForPopup",
    message: `새 창 대기 시작: ${step.urlIncludes || "URL 조건 없음"}`,
    step,
    detail: {
      timeout,
      currentTabId: runState.currentTabId,
      knownTabIdsAtWaitStart:
        hasPreStepKnownTabs ? runState.knownTabIdsAtWaitStart : tabs.map((tab) => tab.id).filter(isFiniteTabId)
    }
  });
}

function getStepContextUrlHint(step) {
  if (!step || step.type === "waitForPopup") {
    return "";
  }

  return typeof step.urlIncludes === "string" ? step.urlIncludes.trim() : "";
}

async function alignRunContextToStepTab(runState, step, currentTab) {
  const expectedUrlHint = getStepContextUrlHint(step);
  if (!expectedUrlHint) {
    return {
      runState,
      tab: currentTab,
      switched: false
    };
  }

  const currentUrl = String(currentTab?.url || "");
  const pendingUrl = String(currentTab?.pendingUrl || "");
  if (currentUrl.includes(expectedUrlHint) || pendingUrl.includes(expectedUrlHint)) {
    return {
      runState,
      tab: currentTab,
      switched: false
    };
  }

  const tabs = await chrome.tabs.query({});
  const candidate = findBestPopupCandidate(tabs, runState, {
    urlIncludes: expectedUrlHint
  });

  if (!candidate) {
    return {
      runState,
      tab: currentTab,
      switched: false
    };
  }

  await ensureContentReady(candidate.id);
  await setNativeDialogAutoAccept(candidate.id, true);

  const nextTrail = [...(runState.currentTabTrail || [])];
  if (isFiniteTabId(runState.currentTabId) && runState.currentTabId !== candidate.id) {
    nextTrail.push(runState.currentTabId);
  }

  const nextState = await setRunState({
    ...runState,
    currentTabId: candidate.id,
    currentFrameId: 0,
    currentTabTrail: nextTrail,
    lastMessage: `step 실행 탭 전환: ${candidate.url || candidate.title || candidate.id}`,
    error: ""
  });

  await appendRunTraceLog({
    source: "run:background",
    eventType: "switch-tab-for-step-context",
    tabId: candidate.id,
    stepIndex: nextState.stepIndex,
    stepType: step.type,
    message: nextState.lastMessage,
    step,
    detail: {
      previousTabId: runState.currentTabId,
      currentTabTrail: nextState.currentTabTrail || [],
      urlIncludes: expectedUrlHint,
      tab: summarizeTabForTrace(candidate)
    }
  });

  return {
    runState: nextState,
    tab: candidate,
    switched: true
  };
}

async function restartMacroRunFromRoot(runState, options = {}) {
  if (!isFiniteTabId(runState.rootTabId)) {
    throw new Error("반복 실행을 시작할 기준 탭을 찾을 수 없습니다.");
  }

  if (options.waitBeforeRestart && runState.repeatDelayMs > 0) {
    await delay(runState.repeatDelayMs);
  }

  const rootTab = await chrome.tabs.get(runState.rootTabId);
  if (!rootTab || isRestrictedUrl(rootTab.url || "")) {
    throw new Error("반복 실행 기준 탭을 다시 사용할 수 없습니다.");
  }

  await ensureContentReady(runState.rootTabId);
  await setNativeDialogAutoAccept(runState.rootTabId, true);

  return await setRunState({
    ...runState,
    currentTabId: runState.rootTabId,
    currentFrameId: 0,
    currentTabTrail: [],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: String(options.lastMessage || "반복 실행 재시작"),
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null,
    repeatRemaining:
      Number.isInteger(options.repeatRemaining) && options.repeatRemaining > 0
        ? options.repeatRemaining
        : Math.max(1, runState.repeatRemaining || 1),
    iteration:
      Number.isInteger(options.iteration) && options.iteration > 0
        ? options.iteration
        : Math.max(1, runState.iteration || 1)
  });
}

async function restartMacroRunIteration(runState) {
  const nextIteration = (runState.iteration || 1) + 1;
  const nextState = await restartMacroRunFromRoot(runState, {
    waitBeforeRestart: true,
    repeatRemaining: Math.max(1, runState.repeatRemaining - 1),
    iteration: nextIteration,
    lastMessage: `반복 실행 ${nextIteration}/${runState.repeatTotal} 시작`
  });

  await appendRunTraceLog({
    source: "run:background",
    eventType: "run-iteration-restart",
    tabId: nextState.currentTabId,
    stepIndex: nextState.stepIndex,
    message: nextState.lastMessage,
    detail: {
      iteration: nextIteration,
      repeatTotal: runState.repeatTotal
    }
  });

  return nextState;
}

async function continueMacroRunFromNextIterationAfterError(runState, errorMessage) {
  const failedIteration = Math.max(1, runState.iteration || 1);
  const nextIteration = failedIteration + 1;
  const nextState = await restartMacroRunFromRoot(runState, {
    waitBeforeRestart: true,
    repeatRemaining: Math.max(1, runState.repeatRemaining - 1),
    iteration: nextIteration,
    lastMessage: `오류로 ${failedIteration}/${runState.repeatTotal}회차를 종료하고 ${nextIteration}/${runState.repeatTotal}회차로 넘어갑니다.`
  });

  await appendRunTraceLog({
    source: "run:background",
    eventType: "run-error-next-iteration",
    tabId: nextState.currentTabId,
    stepIndex: nextState.stepIndex,
    message: nextState.lastMessage,
    detail: {
      failedIteration,
      nextIteration,
      repeatTotal: runState.repeatTotal,
      failedMessage: errorMessage
    }
  });

  return nextState;
}

async function waitForClickStepRecovery(runState, originalTab, knownTabIdsAtWaitStart, timeout = 2500) {
  const startedAt = Date.now();
  const originalUrl = String(originalTab?.url || "");

  while (Date.now() - startedAt < timeout) {
    const latestRunState = await getRunState();

    if (!latestRunState.running) {
      return {
        handled: true,
        runState: latestRunState
      };
    }

    if (latestRunState.stepIndex > runState.stepIndex) {
      return {
        handled: true,
        runState: latestRunState
      };
    }

    if (
      latestRunState.currentTabId !== runState.currentTabId &&
      latestRunState.activeStepIndex === -1 &&
      latestRunState.activeStepType === "" &&
      latestRunState.activeStepTabId == null
    ) {
      return {
        handled: true,
        runState: latestRunState
      };
    }

    try {
      const currentTab = await chrome.tabs.get(runState.currentTabId);
      const currentUrl = String(currentTab?.url || "");
      const pendingUrl = String(currentTab?.pendingUrl || "");
      const navigated =
        !!pendingUrl ||
        (originalUrl && currentUrl && currentUrl !== originalUrl) ||
        currentTab?.status === "loading";

      const stillHandlingSameStep =
        latestRunState.activeStepIndex === runState.stepIndex &&
        latestRunState.activeStepType === runState.activeStepType &&
        latestRunState.activeStepTabId === runState.currentTabId;

      if (navigated && stillHandlingSameStep) {
        const advancedRunState = await setRunState({
          ...latestRunState,
          currentFrameId: 0,
          stepIndex: latestRunState.stepIndex + 1,
          lastMessage:
            `${latestRunState.stepIndex + 1} / ${latestRunState.steps.length} step 완료 ` +
            "(탭 전환/새로고침 감지)",
          error: "",
          knownTabIdsAtWaitStart,
          activeStepIndex: -1,
          activeStepType: "",
          activeStepTabId: null
        });

        return {
          handled: true,
          runState: advancedRunState
        };
      }
    } catch (error) {
      if (!isMissingTabError(error)) {
        throw error;
      }
    }

    await delay(150);
  }

  return {
    handled: false,
    runState: await getRunState()
  };
}

function getPostClickNavigationObserveMs(nextStep) {
  if (!nextStep || typeof nextStep !== "object") {
    return 0;
  }

  if (nextStep.type === "wait") {
    const waitMs = typeof nextStep.ms === "number" && nextStep.ms >= 0 ? nextStep.ms : 0;
    return Math.min(2000, Math.max(400, waitMs));
  }

  if (nextStep.type === "waitFor" || nextStep.type === "waitForPopup") {
    return 800;
  }

  return 0;
}

async function waitForSuccessfulClickNavigation(
  runState,
  originalTab,
  knownTabIdsAtWaitStart,
  observeTimeout = 1200,
  settleTimeout = 10000
) {
  const startedAt = Date.now();
  const originalUrl = String(originalTab?.url || "");

  while (Date.now() - startedAt < observeTimeout) {
    const latestRunState = await getRunState();

    if (!latestRunState.running) {
      return {
        handled: true,
        runState: latestRunState
      };
    }

    if (latestRunState.stepIndex > runState.stepIndex) {
      return {
        handled: true,
        runState: latestRunState
      };
    }

    const stillHandlingSameStep =
      latestRunState.currentTabId === runState.currentTabId &&
      latestRunState.activeStepIndex === runState.stepIndex &&
      latestRunState.activeStepType === runState.activeStepType &&
      latestRunState.activeStepTabId === runState.currentTabId;

    if (!stillHandlingSameStep) {
      return {
        handled: true,
        runState: latestRunState
      };
    }

    try {
      const currentTab = await chrome.tabs.get(runState.currentTabId);
      const currentUrl = String(currentTab?.url || "");
      const pendingUrl = String(currentTab?.pendingUrl || "");
      const navigated =
        !!pendingUrl ||
        currentTab?.status === "loading" ||
        (originalUrl && currentUrl && currentUrl !== originalUrl);

      if (!navigated) {
        await delay(100);
        continue;
      }
    } catch (error) {
      if (isMissingTabError(error)) {
        return {
          handled: false,
          runState: await getRunState()
        };
      }

      throw error;
    }

    const settleStartedAt = Date.now();

    while (Date.now() - settleStartedAt < settleTimeout) {
      const latestAfterNavigation = await getRunState();

      if (!latestAfterNavigation.running) {
        return {
          handled: true,
          runState: latestAfterNavigation
        };
      }

      if (latestAfterNavigation.stepIndex > runState.stepIndex) {
        return {
          handled: true,
          runState: latestAfterNavigation
        };
      }

      const stillHandlingAfterNavigation =
        latestAfterNavigation.currentTabId === runState.currentTabId &&
        latestAfterNavigation.activeStepIndex === runState.stepIndex &&
        latestAfterNavigation.activeStepType === runState.activeStepType &&
        latestAfterNavigation.activeStepTabId === runState.currentTabId;

      if (!stillHandlingAfterNavigation) {
        return {
          handled: true,
          runState: latestAfterNavigation
        };
      }

      try {
        const currentTab = await chrome.tabs.get(runState.currentTabId);
        const pendingUrl = String(currentTab?.pendingUrl || "");
        const loading = !!pendingUrl || currentTab?.status === "loading";

        if (loading) {
          await delay(150);
          continue;
        }

        try {
          await ensureContentReady(runState.currentTabId);
        } catch (error) {
          const message = String(error?.message || error || "");
          if (
            isRetryableTabMessageError(error) ||
            message.includes("페이지와 연결하지 못했습니다")
          ) {
            await delay(150);
            continue;
          }
          throw error;
        }

        const latestReadyRunState = await getRunState();

        if (!latestReadyRunState.running) {
          return {
            handled: true,
            runState: latestReadyRunState
          };
        }

        if (latestReadyRunState.stepIndex > runState.stepIndex) {
          return {
            handled: true,
            runState: latestReadyRunState
          };
        }

        const stillHandlingReadyStep =
          latestReadyRunState.currentTabId === runState.currentTabId &&
          latestReadyRunState.activeStepIndex === runState.stepIndex &&
          latestReadyRunState.activeStepType === runState.activeStepType &&
          latestReadyRunState.activeStepTabId === runState.currentTabId;

        if (!stillHandlingReadyStep) {
          return {
            handled: true,
            runState: latestReadyRunState
          };
        }

        const advancedRunState = await setRunState({
          ...latestReadyRunState,
          currentFrameId: 0,
          stepIndex: latestReadyRunState.stepIndex + 1,
          lastMessage:
            `${latestReadyRunState.stepIndex + 1} / ${latestReadyRunState.steps.length} step 완료 ` +
            "(현재 탭 새로고침 완료)",
          error: "",
          knownTabIdsAtWaitStart,
          activeStepIndex: -1,
          activeStepType: "",
          activeStepTabId: null
        });

        return {
          handled: true,
          runState: advancedRunState
        };
      } catch (error) {
        if (isMissingTabError(error)) {
          return {
            handled: false,
            runState: await getRunState()
          };
        }

        throw error;
      }
    }

    return {
      handled: false,
      runState: await getRunState()
    };
  }

  return {
    handled: false,
    runState: await getRunState()
  };
}

async function continueMacroRun(passedState) {
  if (arguments.length > 0) {
    continueMacroRunQueuedState = passedState;
    continueMacroRunQueuedStateSet = true;
  } else if (!continueMacroRunQueuedStateSet) {
    continueMacroRunQueuedState = undefined;
  }

  continueMacroRunQueued = true;

  if (continueMacroRunInFlight) {
    return;
  }

  continueMacroRunInFlight = true;

  try {
    while (continueMacroRunQueued) {
      const nextState = continueMacroRunQueuedStateSet ? continueMacroRunQueuedState : undefined;

      continueMacroRunQueued = false;
      continueMacroRunQueuedState = undefined;
      continueMacroRunQueuedStateSet = false;

      await continueMacroRunInternal(nextState);
    }
  } finally {
    continueMacroRunInFlight = false;
  }
}

async function continueMacroRunInternal(passedState) {
  let runState = passedState || (await getRunState());

  if (!runState.running || runState.waitingForPopup) {
    return;
  }

  while (true) {
    runState = await getRunState();
    if (!runState.running || runState.waitingForPopup) {
      return;
    }

    if (runState.stepIndex >= runState.steps.length) {
      if (runState.repeatRemaining > 1) {
        try {
          runState = await restartMacroRunIteration(runState);
          continue;
        } catch (error) {
          await failRun(error?.message || String(error));
          return;
        }
      }

      await finishRun(
        runState.repeatTotal > 1 ? `실행 완료 (${runState.repeatTotal}회 반복)` : "실행 완료"
      );
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

    let knownTabIdsAtWaitStart = [];
    let tab = null;
    let dispatchFrameId = normalizeResolvedFrameId(runState.currentFrameId, 0);
    let dispatchFrameCandidates = [];

    try {
      const nextStep = sanitizeStep(runState.steps[runState.stepIndex + 1]);
      if (nextStep?.type === "waitForPopup") {
        const tabsBeforeAction = await chrome.tabs.query({});
        knownTabIdsAtWaitStart = tabsBeforeAction.map((tab) => tab.id).filter(isFiniteTabId);
      }

      runState = await setRunState({
        ...runState,
        activeStepIndex: runState.stepIndex,
        activeStepType: step.type,
        activeStepTabId: runState.currentTabId,
        knownTabIdsAtWaitStart
      });

      try {
        tab = await chrome.tabs.get(runState.currentTabId);
      } catch (error) {
        if (isMissingTabError(error)) {
          const restoredState = await restoreRunToPreviousTab(runState, runState.currentTabId);
          if (restoredState?.running) {
            runState = restoredState;
            continue;
          }
          return;
        }

        throw error;
      }

      if (!tab) {
        const restoredState = await restoreRunToPreviousTab(runState, runState.currentTabId);
        if (restoredState?.running) {
          runState = restoredState;
          continue;
        }
        return;
      }

      if (isRestrictedUrl(tab.url || "")) {
        throw new Error("현재 실행 탭은 확장 실행이 허용되지 않는 페이지입니다.");
      }

      const alignedContext = await alignRunContextToStepTab(runState, step, tab);
      if (alignedContext.switched) {
        runState = alignedContext.runState;
        continue;
      }
      tab = alignedContext.tab;

      await ensureContentReady(runState.currentTabId);

      const resolvedFrame = await resolveRunStepFrame(
        runState.currentTabId,
        step,
        runState.currentFrameId
      );
      dispatchFrameId = normalizeResolvedFrameId(resolvedFrame.frameId, runState.currentFrameId);
      dispatchFrameCandidates = Array.isArray(resolvedFrame.candidates) ? resolvedFrame.candidates : [];

      await appendRunTraceLog({
        source: "run:background",
        eventType: "step-dispatch",
        tabId: runState.currentTabId,
        frameId: dispatchFrameId,
        stepIndex: runState.stepIndex,
        stepType: step.type,
        message: `${runState.stepIndex + 1}번째 step 실행 시작`,
        step,
        detail: {
          currentTab: summarizeTabForTrace(tab),
          currentFrameId: runState.currentFrameId,
          selectedFrameId: dispatchFrameId,
          matchedFrame: !!resolvedFrame.matched,
          frameCandidates: dispatchFrameCandidates,
          nextStep: sanitizeStep(runState.steps[runState.stepIndex + 1]) || null,
          knownTabIdsAtWaitStart
        }
      });

      const response = await sendTabMessageToFrame(runState.currentTabId, {
        type: "RUN_SINGLE_STEP",
        step,
        index: runState.stepIndex,
        hideRunOverlay: !!runState.hideRunOverlay,
        runTraceEnabled: (await getRunTraceState()).enabled
      }, dispatchFrameId);

      if (!response?.ok) {
        throw new Error(response?.message || "step 실행 실패");
      }

      await appendRunTraceLog({
        source: "run:background",
        eventType: "step-response",
        tabId: runState.currentTabId,
        frameId: dispatchFrameId,
        stepIndex: runState.stepIndex,
        stepType: step.type,
        message: response.message || "step 실행 응답 수신",
        step
      });

      const postClickNavigationObserveMs =
        step.type === "click" ? getPostClickNavigationObserveMs(nextStep) : 0;
      if (postClickNavigationObserveMs > 0) {
        const navigation = await waitForSuccessfulClickNavigation(
          runState,
          tab,
          knownTabIdsAtWaitStart,
          postClickNavigationObserveMs
        );
        if (navigation.handled) {
          runState = navigation.runState;
          if (!runState.running) {
            return;
          }
          continue;
        }
      }

      const latestRunState = await getRunState();
      if (!latestRunState.running) {
        return;
      }

      if (
        latestRunState.stepIndex > runState.stepIndex ||
        latestRunState.currentTabId !== runState.currentTabId ||
        latestRunState.activeStepIndex !== runState.stepIndex ||
        latestRunState.activeStepType !== step.type ||
        latestRunState.activeStepTabId !== runState.currentTabId
      ) {
        runState = latestRunState;
        continue;
      }

      runState = await setRunState({
        ...latestRunState,
        currentFrameId: dispatchFrameId,
        stepIndex: latestRunState.stepIndex + 1,
        lastMessage:
          response.message ||
          `${latestRunState.stepIndex + 1} / ${latestRunState.steps.length} step 완료`,
        error: "",
        knownTabIdsAtWaitStart,
        activeStepIndex: -1,
        activeStepType: "",
        activeStepTabId: null
      });

      await appendRunTraceLog({
        source: "run:background",
        eventType: "step-complete",
        tabId: runState.currentTabId,
        frameId: dispatchFrameId,
        stepIndex: runState.stepIndex,
        stepType: step.type,
        message: runState.lastMessage || "step 완료",
        step
      });
    } catch (error) {
      await appendRunTraceLog({
        source: "run:background",
        eventType: "step-error",
        tabId: runState.currentTabId,
        frameId: dispatchFrameId,
        stepIndex: runState.stepIndex,
        stepType: step.type,
        message: error?.message || String(error),
        step,
        detail: {
          currentTab: summarizeTabForTrace(tab),
          currentFrameId: runState.currentFrameId,
          selectedFrameId: dispatchFrameId,
          frameCandidates: dispatchFrameCandidates,
          knownTabIdsAtWaitStart
        }
      });

      if (isMissingTabError(error)) {
        const restoredState = await restoreRunToPreviousTab(runState, runState.currentTabId);
        if (restoredState?.running) {
          runState = restoredState;
          continue;
        }
        return;
      }

      if (isRetryableTabMessageError(error) && step.type === "click") {
        const recovery = await waitForClickStepRecovery(runState, tab, knownTabIdsAtWaitStart);
        if (recovery.handled) {
          runState = recovery.runState;
          if (!runState.running) {
            return;
          }
          continue;
        }
      }
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

  if (tabId === runState.currentTabId) {
    const expected = String(step.urlIncludes || "").trim();
    if (!expected || String(tab?.url || "").includes(expected)) {
      await appendRunTraceLog({
        source: "run:background",
        eventType: "wait-for-popup-current-tab-match",
        tabId,
        stepIndex: runState.stepIndex,
        stepType: "waitForPopup",
        message: `현재 탭이 대기 조건과 일치: ${tab?.url || tabId}`,
        detail: {
          tab: summarizeTabForTrace(tab),
          popupUrlIncludes: runState.popupUrlIncludes || ""
        }
      });
      const waitMs = Date.now() - (runState.popupWaitStartedAt || 0);
      if (runState.popupTimeout > 0 && waitMs > runState.popupTimeout) {
        await failRun(`새 창 대기 시간 초과: ${runState.popupUrlIncludes || "조건 없음"}`);
        return;
      }

      try {
        await completeWaitForCurrentRunTab(runState, tab);
      } catch (error) {
        await failRun(error?.message || String(error));
      }
    }
    return;
  }

  const score = scorePopupCandidate(tab, runState, step);
  if (score < 0) return;

  await appendRunTraceLog({
    source: "run:background",
    eventType: "wait-for-popup-related-tab-match",
    tabId,
    stepIndex: runState.stepIndex,
    stepType: "waitForPopup",
    message: `관련 탭 후보 감지: ${tab?.url || tabId}`,
    detail: {
      score,
      tab: summarizeTabForTrace(tab),
      popupUrlIncludes: runState.popupUrlIncludes || ""
    }
  });

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
    SAVED_MACROS_KEY,
    RECORDING_KEY,
    RUN_KEY,
    ERROR_LOGS_KEY,
    DEBUG_STATE_KEY,
    RUN_TRACE_STATE_KEY,
    DEBUG_LOGS_KEY,
    RUN_TRACE_LOGS_KEY
  ]);

  if (!Array.isArray(data[STEPS_KEY])) {
    await setSteps([]);
  }

  if (!Array.isArray(data[SAVED_MACROS_KEY])) {
    await setSavedMacros([]);
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

  if (!data[RUN_TRACE_STATE_KEY]) {
    await setRunTraceState(DEFAULT_RUN_TRACE_STATE);
  } else {
    await getRunTraceState(true);
  }

  if (!Array.isArray(data[DEBUG_LOGS_KEY])) {
    await setDebugLogs([]);
  }

  if (!Array.isArray(data[RUN_TRACE_LOGS_KEY])) {
    await setRunTraceLogs([]);
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
    await appendRunTraceLog({
      source: "run:background",
      eventType: "tab-created",
      tabId: tab.id,
      stepIndex: runState.stepIndex,
      message: `탭 생성 감지: ${tab.url || tab.pendingUrl || tab.id}`,
      detail: {
        tab: summarizeTabForTrace(tab),
        currentTabId: runState.currentTabId,
        rootTabId: runState.rootTabId
      }
    });

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

  const runState = await getRunState();
  if (runState.running && collectRunDialogTabIds(runState).includes(tabId)) {
    await setNativeDialogAutoAccept(tabId, true);
  }

  if (runState.running) {
    await appendRunTraceLog({
      source: "run:background",
      eventType: "tab-updated",
      tabId,
      stepIndex: runState.stepIndex,
      message: `탭 완료 감지: ${tab?.url || tabId}`,
      detail: {
        tab: summarizeTabForTrace(tab),
        changeInfo: sanitizeTraceData(changeInfo)
      }
    });
  }
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

  await appendRunTraceLog({
    source: "run:background",
    eventType: "tab-removed",
    tabId,
    stepIndex: runState.stepIndex,
    stepType: runState.activeStepType || "",
    message: `탭 제거 감지: ${tabId}`,
    detail: {
      currentTabId: runState.currentTabId,
      rootTabId: runState.rootTabId,
      currentTabTrail: runState.currentTabTrail || []
    }
  });

  const nextPending = (runState.pendingPopupTabIds || []).filter((id) => id !== tabId);
  const nextKnown = (runState.knownTabIdsAtWaitStart || []).filter((id) => id !== tabId);
  const nextTrail = (runState.currentTabTrail || []).filter((id) => id !== tabId);

  if (runState.rootTabId === tabId) {
    await failRun("실행 기준 탭이 닫혀서 매크로를 중단했습니다.");
    return;
  }

  if (runState.currentTabId === tabId) {
    const shouldAdvanceClosedClickStep =
      runState.activeStepType === "click" &&
      runState.activeStepTabId === tabId &&
      runState.activeStepIndex === runState.stepIndex;

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
      const nextState = shouldAdvanceClosedClickStep
        ? await setRunState({
            ...restoredState,
            stepIndex: restoredState.stepIndex + 1,
            activeStepIndex: -1,
            activeStepType: "",
            activeStepTabId: null,
            lastMessage: `팝업이 닫혀 click step 완료 후 복귀: ${restoredState.lastMessage}`
          })
        : restoredState;

      await continueMacroRun(nextState);
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
          await ensureWorkspaceDefaultsForSession();
          const [steps, savedMacros, recording, runState, errorLogs, debug, runTrace, debugLogs, runTraceLogs] =
            await Promise.all([
            getSteps(),
            getSavedMacros(),
            getRecordingState(),
            getRunState(),
            getErrorLogs(),
            getDebugState(),
            getRunTraceState(),
            getDebugLogs(),
            getRunTraceLogs()
          ]);

          sendResponse({
            ok: true,
            steps,
            savedMacros,
            recording,
            run: runState,
            errorLogs,
            debug,
            runTrace,
            debugLogs,
            runTraceLogs
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

        case "REFRESH_RECORDING_FRAMES": {
          const tabId = Number(sender?.tab?.id);
          const recording = await getRecordingState();
          const tracked = new Set(recording.trackedTabIds || []);

          if (!recording.enabled || !isFiniteTabId(tabId) || !tracked.has(tabId)) {
            sendResponse({
              ok: true,
              refreshed: false
            });
            return;
          }

          try {
            await startRecordingOnTab(tabId);
            sendResponse({
              ok: true,
              refreshed: true
            });
          } catch (error) {
            await appendErrorLog(error?.message || String(error), "recording:refresh-frame");
            sendResponse({
              ok: false,
              message: error?.message || String(error)
            });
          }
          return;
        }

        case "START_MACRO_RUN": {
          const tabId = Number(message.tabId);
          const steps = Array.isArray(message.steps) ? message.steps : [];
          const sanitized = steps.map(sanitizeStep).filter(Boolean);
          const currentRun = await getRunState();
          const repeatCount =
            Number.isInteger(Number(message.repeatCount)) && Number(message.repeatCount) > 0
              ? Number(message.repeatCount)
              : 1;
          const repeatDelayMs =
            typeof message.repeatDelayMs === "number" && message.repeatDelayMs >= 0
              ? message.repeatDelayMs
              : 800;
          const restartOnError = !!message.restartOnError && repeatCount > 1;
          const hideRunOverlay = !!message.hideRunOverlay;

          if (currentRun.running) {
            throw new Error("이미 매크로를 실행 중입니다.");
          }

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
          await setRunTraceLogs([]);

          await setRunState({
            running: true,
            rootTabId: tabId,
            rootWindowId: isFiniteTabId(tab.windowId) ? tab.windowId : null,
            rootOrigin: getUrlOrigin(tab.url || ""),
            rootHostname: getUrlHostname(tab.url || ""),
            currentTabId: tabId,
            currentFrameId: 0,
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
            knownTabIdsAtWaitStart: [],
            repeatTotal: repeatCount,
            repeatRemaining: repeatCount,
            repeatDelayMs,
            iteration: 1,
            restartOnError,
            hideRunOverlay
          });

          await appendRunTraceLog({
            source: "run:background",
            eventType: "run-start",
            tabId,
            stepIndex: 0,
            message:
              repeatCount > 1
                ? `매크로 실행 시작 (${repeatCount}회 반복)`
                : "매크로 실행 시작",
            detail: {
              rootTab: summarizeTabForTrace(tab),
              stepCount: sanitized.length,
              repeatCount,
              repeatDelayMs,
              restartOnError,
              hideRunOverlay
            }
          });

          await syncRunDialogAutoAccept(await getRunState(), true);

          continueMacroRun().catch(async (error) => {
            await failRun(error?.message || String(error));
          });

          sendResponse({
            ok: true,
            message:
              repeatCount > 1
                ? `백그라운드에서 매크로 실행을 ${repeatCount}회 시작했습니다.`
                : "백그라운드에서 매크로 실행을 시작했습니다."
          });
          return;
        }

        case "STOP_MACRO_RUN": {
          const runState = await getRunState();
          const nextRunState = runState.running
            ? await stopRun("사용자가 매크로 실행을 중지했습니다.")
            : await getRunState();

          sendResponse({
            ok: true,
            run: nextRunState,
            message: nextRunState.lastMessage || "실행 중지됨"
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
          const nextSteps = await appendSteps(steps, {
            sourceTabId: sender?.tab?.id,
            sourceTabUrl: sender?.tab?.url,
            recordedAt:
              typeof message.recordedAt === "number" && Number.isFinite(message.recordedAt)
                ? message.recordedAt
                : Date.now()
          });

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

        case "SAVE_MACRO": {
          const result = await saveMacro(message.name, message.steps);

          sendResponse({
            ok: true,
            savedMacros: result.savedMacros,
            savedMacro: result.savedMacro
          });
          return;
        }

        case "DELETE_SAVED_MACRO": {
          const savedMacros = await deleteSavedMacro(message.id);

          sendResponse({
            ok: true,
            savedMacros
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

        case "SET_RUN_TRACE_STATE": {
          const runTrace = await setRunTraceState({
            enabled: !!message.enabled
          });

          await broadcastRunTraceMode(runTrace.enabled);

          sendResponse({
            ok: true,
            runTrace
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

        case "APPEND_RUN_TRACE_LOG": {
          const runTraceLogs = await appendRunTraceLog({
            ...(message.entry || {}),
            frameId: isFiniteFrameId(sender?.frameId)
              ? sender.frameId
              : message?.entry?.frameId
          });

          sendResponse({
            ok: true,
            runTraceLogs
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

        case "CLEAR_RUN_TRACE_LOGS": {
          await setRunTraceLogs([]);

          sendResponse({
            ok: true,
            runTraceLogs: []
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
        message?.type !== "APPEND_DEBUG_LOG" &&
        message?.type !== "APPEND_RUN_TRACE_LOG"
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
