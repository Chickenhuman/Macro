const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const runBtn = document.getElementById("runBtn");
const stopRunBtn = document.getElementById("stopRunBtn");
const undoLastStepBtn = document.getElementById("undoLastStepBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");
const addWaitForTemplateBtn = document.getElementById("addWaitForTemplateBtn");
const addWaitForPopupTemplateBtn = document.getElementById("addWaitForPopupTemplateBtn");
const repeatCountInput = document.getElementById("repeatCountInput");
const repeatDelayInput = document.getElementById("repeatDelayInput");
const macroNameInput = document.getElementById("macroNameInput");
const saveMacroBtn = document.getElementById("saveMacroBtn");
const savedMacroSelect = document.getElementById("savedMacroSelect");
const loadMacroBtn = document.getElementById("loadMacroBtn");
const deleteMacroBtn = document.getElementById("deleteMacroBtn");
const savedMacroMeta = document.getElementById("savedMacroMeta");

const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const stepsMeta = document.getElementById("stepsMeta");
const emptyBox = document.getElementById("emptyBox");
const stepsList = document.getElementById("stepsList");
const jsonEditor = document.getElementById("jsonEditor");
const applyJsonBtn = document.getElementById("applyJsonBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const resultBox = document.getElementById("resultBox");
const copyErrorLogBtn = document.getElementById("copyErrorLogBtn");
const clearErrorLogBtn = document.getElementById("clearErrorLogBtn");
const errorLogBox = document.getElementById("errorLogBox");
const toggleDebugBtn = document.getElementById("toggleDebugBtn");
const copyDebugLogBtn = document.getElementById("copyDebugLogBtn");
const clearDebugLogBtn = document.getElementById("clearDebugLogBtn");
const refreshDebugBtn = document.getElementById("refreshDebugBtn");
const debugLogBox = document.getElementById("debugLogBox");

const ERROR_LOGS_KEY = "macroErrorLogs";
const DEBUG_LOGS_KEY = "macroDebugLogs";

let currentData = {
  steps: [],
  savedMacros: [],
  recording: {
    enabled: false,
    rootTabId: null,
    trackedTabIds: []
  },
  run: {
    running: false,
    waitingForPopup: false,
    stepIndex: 0,
    steps: [],
    lastMessage: "대기",
    error: ""
  },
  errorLogs: [],
  debug: {
    enabled: false
  },
  debugLogs: []
};

let editingStepIndex = null;
let loadDataPromise = null;
let draggingStepIndex = null;

function setResult(text) {
  resultBox.textContent = text;
}

function normalizeErrorText(message) {
  return String(message || "").trim();
}

function formatErrorTimestamp(value) {
  if (!value) return "";

  try {
    return new Date(value).toLocaleString("ko-KR", {
      hour12: false
    });
  } catch {
    return String(value);
  }
}

function formatSavedMacroTimestamp(value) {
  if (!value) return "-";

  try {
    return new Date(value).toLocaleString("ko-KR", {
      hour12: false
    });
  } catch {
    return String(value);
  }
}

function buildErrorLogText() {
  const logs = Array.isArray(currentData.errorLogs) ? currentData.errorLogs : [];
  if (!logs.length) {
    return "오류 로그 없음";
  }

  return [...logs]
    .reverse()
    .map((entry, index) => {
      const time = formatErrorTimestamp(entry?.at);
      const source = String(entry?.source || "runtime");
      const message = normalizeErrorText(entry?.message || "");
      return `${index + 1}. [${time || "-"}] ${source}\n${message || "(메시지 없음)"}`;
    })
    .join("\n\n");
}

function formatElementSummary(entry) {
  if (!entry) return "-";

  const tag = entry.tag || "?";
  const id = entry.id ? `#${entry.id}` : "";
  const role = entry.role ? ` role=${entry.role}` : "";
  const type = entry.type ? ` type=${entry.type}` : "";
  const text = entry.text ? ` text=${JSON.stringify(entry.text)}` : "";
  const className = entry.className ? ` class=${JSON.stringify(entry.className)}` : "";

  return `${tag}${id}${role}${type}${text}${className}`.trim();
}

function buildDebugLogText() {
  const logs = Array.isArray(currentData.debugLogs) ? currentData.debugLogs : [];
  if (!logs.length) {
    return "디버그 로그 없음";
  }

  return [...logs]
    .reverse()
    .map((entry, index) => {
      const time = formatErrorTimestamp(entry?.at);
      const lines = [
        `${index + 1}. [${time || "-"}] ${entry?.source || "content"} / ${entry?.eventType || "-"}`,
        `url: ${String(entry?.pageUrl || "-")}`,
        `target: ${formatElementSummary(entry?.target)}`,
        `ancestors: ${(entry?.ancestors || []).map(formatElementSummary).join(" <- ") || "-"}`,
        `clickable: ${formatElementSummary(entry?.clickableTarget)}${entry?.clickableSelector ? ` / ${entry.clickableSelector}` : ""}`,
        `checkbox: ${formatElementSummary(entry?.checkboxTarget)}${entry?.checkboxSelector ? ` / ${entry.checkboxSelector}` : ""}`,
        `dropdown: ${formatElementSummary(entry?.dropdownTarget)}${entry?.dropdownSelector ? ` / ${entry.dropdownSelector}` : ""}`,
        `input: ${formatElementSummary(entry?.inputTarget)}${entry?.inputSelector ? ` / ${entry.inputSelector}` : ""}`
      ];

      if (entry?.note) {
        lines.push(`note: ${entry.note}`);
      }

      if (entry?.recordedStep) {
        lines.push(`recorded: ${JSON.stringify(entry.recordedStep)}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function renderErrorLogs() {
  errorLogBox.textContent = buildErrorLogText();
}

function renderDebugLogs() {
  debugLogBox.textContent = buildDebugLogText();
  toggleDebugBtn.textContent = currentData.debug?.enabled ? "디버그 끄기" : "디버그 켜기";
  toggleDebugBtn.classList.toggle("primary", !!currentData.debug?.enabled);
}

function getSelectedSavedMacro() {
  const savedMacros = Array.isArray(currentData.savedMacros) ? currentData.savedMacros : [];
  const selectedId = String(savedMacroSelect.value || "");
  return savedMacros.find((item) => item.id === selectedId) || null;
}

function renderSavedMacros() {
  const savedMacros = Array.isArray(currentData.savedMacros) ? currentData.savedMacros : [];
  const previousValue = String(savedMacroSelect.value || "");

  savedMacroSelect.innerHTML = "";

  if (!savedMacros.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "저장된 매크로 없음";
    savedMacroSelect.appendChild(option);
    savedMacroSelect.disabled = true;
    savedMacroMeta.textContent = "0개 저장됨";
    renderControls();
    return;
  }

  savedMacros.forEach((macro) => {
    const option = document.createElement("option");
    option.value = macro.id;
    option.textContent = macro.name;
    savedMacroSelect.appendChild(option);
  });

  savedMacroSelect.disabled = false;

  const hasPrevious = savedMacros.some((macro) => macro.id === previousValue);
  savedMacroSelect.value = hasPrevious ? previousValue : savedMacros[0].id;

  const selected = getSelectedSavedMacro();
  savedMacroMeta.textContent = selected
    ? `${savedMacros.length}개 저장됨 · 최근 수정 ${formatSavedMacroTimestamp(selected.updatedAt)}`
    : `${savedMacros.length}개 저장됨`;
  renderControls();
}

function renderControls() {
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];
  const recording = currentData.recording || { enabled: false };
  const run = currentData.run || { running: false };
  const savedMacro = getSelectedSavedMacro();

  startRecordBtn.disabled = !!run.running;
  stopRecordBtn.disabled = !!run.running;
  runBtn.disabled = !!run.running || !steps.length || !!recording.enabled;
  clearBtn.disabled = !!run.running;
  undoLastStepBtn.disabled = !!run.running || !steps.length;
  saveMacroBtn.disabled = !!run.running || !steps.length;
  loadMacroBtn.disabled = !!run.running || !savedMacro;
  deleteMacroBtn.disabled = !!run.running || !savedMacro;
  stopRunBtn.disabled = !run.running;
  repeatCountInput.disabled = !!run.running;
  repeatDelayInput.disabled = !!run.running;
}

async function writeErrorLogEntry(message, source = "popup") {
  const text = normalizeErrorText(message);
  if (!text) return;

  try {
    const response = await sendRuntimeMessage({
      type: "APPEND_ERROR_LOG",
      source,
      message: text
    });

    if (response?.ok && Array.isArray(response.errorLogs)) {
      currentData.errorLogs = response.errorLogs;
      renderErrorLogs();
      return;
    }
  } catch {
    // storage fallback below
  }

  const data = await chrome.storage.local.get(ERROR_LOGS_KEY);
  const current = Array.isArray(data[ERROR_LOGS_KEY]) ? data[ERROR_LOGS_KEY] : [];
  const next = [
    ...current,
    {
      at: Date.now(),
      source: String(source || "popup"),
      message: text
    }
  ].slice(-100);

  await chrome.storage.local.set({
    [ERROR_LOGS_KEY]: next
  });

  currentData.errorLogs = next;
  renderErrorLogs();
}

async function clearErrorLogs() {
  try {
    const response = await sendRuntimeMessage({
      type: "CLEAR_ERROR_LOGS"
    });

    if (response?.ok) {
      currentData.errorLogs = [];
      renderErrorLogs();
      return;
    }
  } catch {
    // storage fallback below
  }

  await chrome.storage.local.set({
    [ERROR_LOGS_KEY]: []
  });

  currentData.errorLogs = [];
  renderErrorLogs();
}

async function clearDebugLogs() {
  try {
    const response = await sendRuntimeMessage({
      type: "CLEAR_DEBUG_LOGS"
    });

    if (response?.ok) {
      currentData.debugLogs = [];
      renderDebugLogs();
      return;
    }
  } catch {
    // storage fallback below
  }

  await chrome.storage.local.set({
    [DEBUG_LOGS_KEY]: []
  });

  currentData.debugLogs = [];
  renderDebugLogs();
}

async function setDebugState(enabled) {
  const response = await sendRuntimeMessage({
    type: "SET_DEBUG_STATE",
    enabled: !!enabled
  });

  if (!response?.ok) {
    throw new Error(response?.message || "디버그 상태 변경 실패");
  }

  currentData.debug = response.debug || {
    enabled: !!enabled
  };
  renderDebugLogs();
}

async function handleUiError(error, source = "popup") {
  const text = normalizeErrorText(error?.message || String(error));
  setResult(`오류: ${text}`);
  await writeErrorLogEntry(text, source);
}

function isRetryableRuntimeMessageError(error) {
  const text = String(error?.message || error || "");
  return (
    text.includes("message channel closed before a response was received") ||
    text.includes("Could not establish connection") ||
    text.includes("Receiving end does not exist")
  );
}

async function sendRuntimeMessage(message, retries = 3) {
  let lastError = null;

  for (let i = 0; i < retries; i += 1) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      lastError = error;

      if (!isRetryableRuntimeMessageError(error) || i === retries - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  throw lastError || new Error("메시지 전송 실패");
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tabs || !tabs.length) {
    throw new Error("현재 탭을 찾을 수 없습니다.");
  }

  return tabs[0];
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

function describeStep(step) {
  if (!step) return "알 수 없는 step";

  const keyName =
    step.type === "key" || step.code === "Space" || step.key === " " || step.key === "Spacebar"
      ? "스페이스바"
      : step.key || step.code || "알 수 없는 키";

  switch (step.type) {
    case "click":
      return `클릭: ${step.label || step.selector || "(selector 없음)"}`;
    case "key":
      return `키 입력: ${step.label || step.selector || "(selector 없음)"} → ${keyName}`;
    case "input":
      return `입력: ${step.label || step.selector || "(selector 없음)"} → ${JSON.stringify(step.value ?? "")}`;
    case "select":
      return `선택: ${step.label || step.selector || "(selector 없음)"} → ${JSON.stringify(step.value ?? "")}`;
    case "dropdownSelect":
      return `드롭다운 선택: ${step.label || step.selector || "(selector 없음)"} → ${JSON.stringify(step.value ?? "")}`;
    case "wait":
      return `대기: ${step.ms || 0}ms`;
    case "waitFor":
      return `요소 대기: ${step.selector || "(selector 없음)"} / timeout=${step.timeout || 10000}`;
    case "waitForPopup":
      return `새 창 대기: ${step.urlIncludes || "URL 조건 없음"} / timeout=${step.timeout || 10000}`;
    default:
      return `${step.type}`;
  }
}

function renderStatus() {
  const recording = currentData.recording || { enabled: false };
  const run = currentData.run || { running: false };
  const repeatText =
    run.repeatTotal > 1 ? ` ${run.iteration || 1}/${run.repeatTotal}회차` : "";

  if (run.running) {
    statusBadge.textContent = run.waitingForPopup ? "POP" : "RUN";
    statusBadge.classList.remove("recording");
    statusText.textContent = run.waitingForPopup
      ? `새 창을 기다리는 중입니다.${repeatText} ${run.popupUrlIncludes || ""}`.trim()
      : `매크로 실행 중입니다.${repeatText} ${run.stepIndex}/${(run.steps || []).length}`;
    renderControls();
    return;
  }

  if (recording.enabled) {
    statusBadge.textContent = "기록 중";
    statusBadge.classList.add("recording");
    statusText.textContent = "현재 페이지와 새로 열리는 관련 창에서 사용자 동작을 기록하고 있습니다.";
    renderControls();
    return;
  }

  statusBadge.textContent = "대기";
  statusBadge.classList.remove("recording");
  statusText.textContent = "기록 중이 아니며 실행도 진행 중이 아닙니다.";
  renderControls();
}

async function setSteps(steps) {
  const response = await sendRuntimeMessage({
    type: "SET_STEPS",
    steps
  });

  if (!response?.ok) {
    throw new Error(response?.message || "step 저장 실패");
  }

  await loadData();
}

async function clearSteps() {
  const response = await sendRuntimeMessage({
    type: "CLEAR_STEPS"
  });

  if (!response?.ok) {
    throw new Error(response?.message || "step 삭제 실패");
  }

  await loadData();
}

function cloneStep(step) {
  return JSON.parse(JSON.stringify(step || {}));
}

function reorderSteps(steps, fromIndex, toIndex) {
  if (!Array.isArray(steps)) return [];
  if (fromIndex === toIndex) return [...steps];
  if (fromIndex < 0 || fromIndex >= steps.length) return [...steps];
  if (toIndex < 0 || toIndex >= steps.length) return [...steps];

  const next = [...steps];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function remapEditingIndexAfterMove(currentIndex, fromIndex, toIndex) {
  if (typeof currentIndex !== "number") {
    return currentIndex;
  }

  if (currentIndex === fromIndex) {
    return toIndex;
  }

  if (fromIndex < toIndex && currentIndex > fromIndex && currentIndex <= toIndex) {
    return currentIndex - 1;
  }

  if (fromIndex > toIndex && currentIndex >= toIndex && currentIndex < fromIndex) {
    return currentIndex + 1;
  }

  return currentIndex;
}

async function moveStep(fromIndex, toIndex) {
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];
  if (!steps.length || fromIndex === toIndex) {
    return;
  }

  const next = reorderSteps(steps, fromIndex, toIndex);
  if (JSON.stringify(next) === JSON.stringify(steps)) {
    return;
  }

  editingStepIndex = remapEditingIndexAfterMove(editingStepIndex, fromIndex, toIndex);
  await setSteps(next);
  setResult(`${fromIndex + 1}번 step을 ${toIndex + 1}번 위치로 이동했습니다.`);
}

function shouldPauseAutoRefresh() {
  if (draggingStepIndex !== null || typeof editingStepIndex === "number") {
    return true;
  }

  const active = document.activeElement;
  if (!active || active === document.body) {
    return false;
  }

  return active === jsonEditor || !!active.closest?.(".step-editor");
}

function getEditableFields(step) {
  if (!step || !step.type) return [];

  switch (step.type) {
    case "wait":
      return [
        { key: "ms", label: "대기 시간(ms)", type: "number", min: 0 }
      ];
    case "waitFor":
      return [
        { key: "selector", label: "셀렉터", type: "text" },
        { key: "timeout", label: "최대 대기(ms)", type: "number", min: 0 },
        { key: "interval", label: "확인 간격(ms)", type: "number", min: 0 }
      ];
    case "waitForPopup":
      return [
        { key: "urlIncludes", label: "URL 포함 문자열", type: "text" },
        { key: "timeout", label: "최대 대기(ms)", type: "number", min: 0 }
      ];
    case "key":
      return [
        { key: "label", label: "표시 이름", type: "text" },
        { key: "selector", label: "셀렉터", type: "text" },
        { key: "key", label: "키 값", type: "text" },
        { key: "code", label: "키 코드", type: "text" },
        { key: "timeout", label: "최대 대기(ms)", type: "number", min: 0 }
      ];
    case "input":
    case "select":
    case "dropdownSelect":
      return [
        { key: "label", label: "표시 이름", type: "text" },
        { key: "selector", label: "셀렉터", type: "text" },
        { key: "value", label: "값", type: "text" },
        { key: "timeout", label: "최대 대기(ms)", type: "number", min: 0 }
      ];
    case "click":
      return [
        { key: "label", label: "표시 이름", type: "text" },
        { key: "selector", label: "셀렉터", type: "text" },
        { key: "timeout", label: "최대 대기(ms)", type: "number", min: 0 }
      ];
    default:
      return [];
  }
}

function parseEditorValue(rawValue, field) {
  if (field.type === "number") {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new Error(`${field.label} 값이 올바르지 않습니다.`);
    }
    if (typeof field.min === "number" && value < field.min) {
      throw new Error(`${field.label} 값은 ${field.min} 이상이어야 합니다.`);
    }
    return value;
  }

  return String(rawValue ?? "");
}

async function saveEditedStep(index, fieldDefs, editorRoot) {
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];
  const targetStep = steps[index];

  if (!targetStep) {
    throw new Error("수정할 step을 찾지 못했습니다.");
  }

  const nextStep = cloneStep(targetStep);

  for (const field of fieldDefs) {
    const input = editorRoot.querySelector(`[data-field="${field.key}"]`);
    if (!input) continue;
    nextStep[field.key] = parseEditorValue(input.value, field);
  }

  const nextSteps = [...steps];
  nextSteps[index] = nextStep;
  editingStepIndex = null;
  await setSteps(nextSteps);
  setResult(`${index + 1}번 step 수정 완료`);
}

function renderStepEditor(item, step, index, steps) {
  const fieldDefs = getEditableFields(step);
  if (!fieldDefs.length || editingStepIndex !== index) {
    return;
  }

  const editor = document.createElement("div");
  editor.className = "step-editor";

  fieldDefs.forEach((field) => {
    const row = document.createElement("div");
    row.className = "step-editor-row";

    const label = document.createElement("label");
    label.textContent = field.label;

    const input = document.createElement("input");
    input.type = field.type === "number" ? "number" : "text";
    input.value = String(step[field.key] ?? "");
    input.setAttribute("data-field", field.key);
    if (field.type === "number") {
      input.step = "1";
      if (typeof field.min === "number") {
        input.min = String(field.min);
      }
    }

    row.appendChild(label);
    row.appendChild(input);
    editor.appendChild(row);
  });

  const editorActions = document.createElement("div");
  editorActions.className = "step-editor-actions";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "저장";
  saveBtn.className = "primary";
  saveBtn.addEventListener("click", async () => {
    try {
      await saveEditedStep(index, fieldDefs, editor);
    } catch (error) {
      await handleUiError(error, "popup:editStep");
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "취소";
  cancelBtn.addEventListener("click", () => {
    editingStepIndex = null;
    renderSteps();
  });

  editorActions.appendChild(saveBtn);
  editorActions.appendChild(cancelBtn);
  editor.appendChild(editorActions);
  item.appendChild(editor);
}

function renderSteps() {
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];
  const dragEnabled = !(currentData.run?.running || currentData.recording?.enabled);

  stepsMeta.textContent = `${steps.length}개`;

  if (!steps.length) {
    emptyBox.style.display = "block";
    stepsList.style.display = "none";
    stepsList.innerHTML = "";
    jsonEditor.value = "[]";
    renderControls();
    return;
  }

  emptyBox.style.display = "none";
  stepsList.style.display = "flex";
  stepsList.innerHTML = "";

  steps.forEach((step, index) => {
    const item = document.createElement("div");
    item.className = "step-item";
    item.setAttribute("data-step-index", String(index));

    item.addEventListener("dragover", (event) => {
      if (!dragEnabled || draggingStepIndex === null || draggingStepIndex === index) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });

    item.addEventListener("dragleave", (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && item.contains(related)) {
        return;
      }

      item.classList.remove("drag-over");
    });

    item.addEventListener("drop", async (event) => {
      if (!dragEnabled || draggingStepIndex === null || draggingStepIndex === index) {
        item.classList.remove("drag-over");
        return;
      }

      event.preventDefault();
      item.classList.remove("drag-over");

      const fromIndex = draggingStepIndex;
      draggingStepIndex = null;
      try {
        await moveStep(fromIndex, index);
      } catch (error) {
        await handleUiError(error, "popup:dragReorder");
      }
    });

    const head = document.createElement("div");
    head.className = "step-head";

    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "step-drag-handle";
    dragHandle.textContent = "드래그";
    dragHandle.draggable = dragEnabled;
    dragHandle.disabled = !dragEnabled;
    dragHandle.setAttribute("data-step-drag-handle", "true");

    dragHandle.addEventListener("dragstart", (event) => {
      if (!dragEnabled) {
        event.preventDefault();
        return;
      }

      draggingStepIndex = index;
      item.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
      }
    });

    dragHandle.addEventListener("dragend", () => {
      draggingStepIndex = null;
      document.querySelectorAll(".step-item.dragging, .step-item.drag-over").forEach((node) => {
        node.classList.remove("dragging", "drag-over");
      });
    });

    const main = document.createElement("div");
    main.className = "step-main";
    main.textContent = `${index + 1}. ${describeStep(step)}`;

    head.appendChild(dragHandle);
    head.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "step-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "위로";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", async () => {
      await moveStep(index, index - 1);
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "아래로";
    downBtn.disabled = index === steps.length - 1;
    downBtn.addEventListener("click", async () => {
      await moveStep(index, index + 1);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", async () => {
      const next = steps.filter((_, i) => i !== index);
      if (editingStepIndex === index) {
        editingStepIndex = null;
      } else if (typeof editingStepIndex === "number" && editingStepIndex > index) {
        editingStepIndex -= 1;
      }
      await setSteps(next);
    });

    const editBtn = document.createElement("button");
    editBtn.textContent = editingStepIndex === index ? "수정 중" : "수정";
    editBtn.addEventListener("click", () => {
      editingStepIndex = editingStepIndex === index ? null : index;
      renderSteps();
    });

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(head);
    item.appendChild(actions);
    renderStepEditor(item, step, index, steps);
    stepsList.appendChild(item);
  });

  jsonEditor.value = JSON.stringify(steps, null, 2);
  renderControls();
}

async function loadData() {
  if (loadDataPromise) {
    return await loadDataPromise;
  }

  loadDataPromise = (async () => {
    const response = await sendRuntimeMessage({
      type: "GET_DATA"
    });

    if (!response?.ok) {
      throw new Error(response?.message || "데이터를 불러오지 못했습니다.");
    }

    currentData = {
      steps: Array.isArray(response.steps) ? response.steps : [],
      savedMacros: Array.isArray(response.savedMacros) ? response.savedMacros : [],
      recording: response.recording || {
        enabled: false,
        rootTabId: null,
        trackedTabIds: []
      },
      run: response.run || {
        running: false,
        waitingForPopup: false,
        stepIndex: 0,
        steps: [],
        lastMessage: "대기",
      error: ""
      },
      errorLogs: Array.isArray(response.errorLogs) ? response.errorLogs : [],
      debug: response.debug || {
        enabled: false
      },
      debugLogs: Array.isArray(response.debugLogs) ? response.debugLogs : []
    };

    if (typeof editingStepIndex === "number" && editingStepIndex >= currentData.steps.length) {
      editingStepIndex = null;
    }

    renderStatus();
    renderSteps();
    renderSavedMacros();
    renderErrorLogs();
    renderDebugLogs();

    if (currentData.run?.lastMessage) {
      setResult(currentData.run.lastMessage);
    }
  })();

  try {
    await loadDataPromise;
  } finally {
    loadDataPromise = null;
  }
}

async function startRecording() {
  const tab = await getCurrentTab();

  if (isRestrictedUrl(tab.url || "")) {
    throw new Error("이 페이지에서는 확장을 주입할 수 없습니다.");
  }

  const response = await sendRuntimeMessage({
    type: "START_RECORDING",
    tabId: tab.id
  });

  if (!response?.ok) {
    throw new Error(response?.message || "기록 시작 실패");
  }

  await loadData();
  setResult("기록 시작됨\n현재 페이지와 이후 열리는 관련 창도 자동 기록 대상입니다.");
}

async function stopRecording() {
  const response = await sendRuntimeMessage({
    type: "STOP_RECORDING"
  });

  if (!response?.ok) {
    throw new Error(response?.message || "기록 종료 실패");
  }

  await loadData();
  setResult("기록 종료됨");
}

async function runMacro() {
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];
  if (!steps.length) {
    throw new Error("실행할 step이 없습니다.");
  }

  const tab = await getCurrentTab();

  if (isRestrictedUrl(tab.url || "")) {
    throw new Error("이 페이지에서는 확장을 실행할 수 없습니다.");
  }

  const repeatCount = Number.parseInt(repeatCountInput.value, 10);
  const repeatDelayMs = Number.parseInt(repeatDelayInput.value, 10);

  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error("반복 횟수는 1 이상의 정수여야 합니다.");
  }

  if (!Number.isInteger(repeatDelayMs) || repeatDelayMs < 0) {
    throw new Error("반복 간격은 0 이상의 정수여야 합니다.");
  }

  const response = await sendRuntimeMessage({
    type: "START_MACRO_RUN",
    tabId: tab.id,
    steps,
    repeatCount,
    repeatDelayMs
  });

  if (!response?.ok) {
    throw new Error(response?.message || "실행 실패");
  }

  await loadData();
  setResult(response.message || "실행 시작됨");
}

async function stopMacroRun() {
  const response = await sendRuntimeMessage({
    type: "STOP_MACRO_RUN"
  });

  if (!response?.ok) {
    throw new Error(response?.message || "실행 중지 실패");
  }

  await loadData();
  setResult(response.message || "실행 중지됨");
}

async function undoLastStep() {
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];
  if (!steps.length) {
    throw new Error("되돌릴 step이 없습니다.");
  }

  const nextSteps = steps.slice(0, -1);
  if (typeof editingStepIndex === "number" && editingStepIndex >= nextSteps.length) {
    editingStepIndex = null;
  }

  await setSteps(nextSteps);
  setResult("직전 기록 되돌리기 완료");
}

async function saveCurrentMacro() {
  const name = String(macroNameInput.value || "").trim();
  const steps = Array.isArray(currentData.steps) ? currentData.steps : [];

  if (!name) {
    throw new Error("매크로 이름을 입력하세요.");
  }

  if (!steps.length) {
    throw new Error("저장할 step이 없습니다.");
  }

  const response = await sendRuntimeMessage({
    type: "SAVE_MACRO",
    name,
    steps
  });

  if (!response?.ok) {
    throw new Error(response?.message || "매크로 저장 실패");
  }

  await loadData();
  if (response.savedMacro?.id) {
    savedMacroSelect.value = response.savedMacro.id;
  }
  setResult(`매크로 저장 완료: ${name}`);
}

async function loadSavedMacro() {
  const macro = getSelectedSavedMacro();
  if (!macro) {
    throw new Error("불러올 저장 매크로를 선택하세요.");
  }

  editingStepIndex = null;
  await setSteps(macro.steps || []);
  macroNameInput.value = macro.name;
  setResult(`매크로 불러오기 완료: ${macro.name}`);
}

async function deleteSelectedMacro() {
  const macro = getSelectedSavedMacro();
  if (!macro) {
    throw new Error("삭제할 저장 매크로를 선택하세요.");
  }

  const response = await sendRuntimeMessage({
    type: "DELETE_SAVED_MACRO",
    id: macro.id
  });

  if (!response?.ok) {
    throw new Error(response?.message || "매크로 삭제 실패");
  }

  await loadData();
  if (macroNameInput.value.trim() === macro.name) {
    macroNameInput.value = "";
  }
  setResult(`매크로 삭제 완료: ${macro.name}`);
}

async function addWait(ms) {
  const next = [...(currentData.steps || []), { type: "wait", ms }];
  await setSteps(next);
  setResult(`대기 ${ms}ms 추가됨`);
}

async function addWaitForTemplate() {
  const next = [
    ...(currentData.steps || []),
    {
      type: "waitFor",
      selector: "#exampleSelector",
      timeout: 10000,
      interval: 200
    }
  ];

  await setSteps(next);
  setResult("waitFor 예시가 추가되었습니다. JSON에서 selector를 수정하세요.");
}

async function addWaitForPopupTemplate() {
  const next = [
    ...(currentData.steps || []),
    {
      type: "waitForPopup",
      urlIncludes: "RegistArchiveDocDispatch.do",
      timeout: 10000
    }
  ];

  await setSteps(next);
  setResult("waitForPopup 예시가 추가되었습니다. JSON에서 urlIncludes를 수정하세요.");
}

async function applyJson() {
  let steps;
  try {
    steps = JSON.parse(jsonEditor.value);
  } catch {
    throw new Error("JSON 형식이 잘못되었습니다.");
  }

  if (!Array.isArray(steps)) {
    throw new Error("JSON의 최상위 값은 배열이어야 합니다.");
  }

  await setSteps(steps);
  setResult("JSON 반영 완료");
}

async function copyJson() {
  const text = JSON.stringify(currentData.steps || [], null, 2);
  await navigator.clipboard.writeText(text);
  setResult("JSON 복사 완료");
}

startRecordBtn.addEventListener("click", async () => {
  try {
    await startRecording();
  } catch (error) {
    await handleUiError(error, "popup:startRecording");
  }
});

stopRecordBtn.addEventListener("click", async () => {
  try {
    await stopRecording();
  } catch (error) {
    await handleUiError(error, "popup:stopRecording");
  }
});

runBtn.addEventListener("click", async () => {
  try {
    await runMacro();
  } catch (error) {
    await handleUiError(error, "popup:runMacro");
  }
});

stopRunBtn.addEventListener("click", async () => {
  try {
    await stopMacroRun();
  } catch (error) {
    await handleUiError(error, "popup:stopMacroRun");
  }
});

undoLastStepBtn.addEventListener("click", async () => {
  try {
    await undoLastStep();
  } catch (error) {
    await handleUiError(error, "popup:undoLastStep");
  }
});

clearBtn.addEventListener("click", async () => {
  try {
    await clearSteps();
    setResult("기록 전체 삭제 완료");
  } catch (error) {
    await handleUiError(error, "popup:clearSteps");
  }
});

refreshBtn.addEventListener("click", async () => {
  try {
    await loadData();
    setResult("새로고침 완료");
  } catch (error) {
    await handleUiError(error, "popup:refresh");
  }
});

saveMacroBtn.addEventListener("click", async () => {
  try {
    await saveCurrentMacro();
  } catch (error) {
    await handleUiError(error, "popup:saveMacro");
  }
});

loadMacroBtn.addEventListener("click", async () => {
  try {
    await loadSavedMacro();
  } catch (error) {
    await handleUiError(error, "popup:loadSavedMacro");
  }
});

deleteMacroBtn.addEventListener("click", async () => {
  try {
    await deleteSelectedMacro();
  } catch (error) {
    await handleUiError(error, "popup:deleteSavedMacro");
  }
});

savedMacroSelect.addEventListener("change", () => {
  renderSavedMacros();
  renderControls();
});

document.querySelectorAll("button[data-wait]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const ms = Number(button.getAttribute("data-wait"));
      await addWait(ms);
    } catch (error) {
      await handleUiError(error, "popup:addWait");
    }
  });
});

addWaitForTemplateBtn.addEventListener("click", async () => {
  try {
    await addWaitForTemplate();
  } catch (error) {
    await handleUiError(error, "popup:addWaitForTemplate");
  }
});

addWaitForPopupTemplateBtn.addEventListener("click", async () => {
  try {
    await addWaitForPopupTemplate();
  } catch (error) {
    await handleUiError(error, "popup:addWaitForPopupTemplate");
  }
});

applyJsonBtn.addEventListener("click", async () => {
  try {
    editingStepIndex = null;
    await applyJson();
  } catch (error) {
    await handleUiError(error, "popup:applyJson");
  }
});

copyJsonBtn.addEventListener("click", async () => {
  try {
    await copyJson();
  } catch (error) {
    await handleUiError(error, "popup:copyJson");
  }
});

copyErrorLogBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildErrorLogText());
    setResult("오류 로그 복사 완료");
  } catch (error) {
    await handleUiError(error, "popup:copyErrorLog");
  }
});

clearErrorLogBtn.addEventListener("click", async () => {
  try {
    await clearErrorLogs();
    setResult("오류 로그 삭제 완료");
  } catch (error) {
    await handleUiError(error, "popup:clearErrorLogs");
  }
});

toggleDebugBtn.addEventListener("click", async () => {
  try {
    await setDebugState(!currentData.debug?.enabled);
    setResult(`디버그 ${currentData.debug?.enabled ? "활성화" : "비활성화"}됨`);
  } catch (error) {
    await handleUiError(error, "popup:setDebugState");
  }
});

copyDebugLogBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildDebugLogText());
    setResult("디버그 로그 복사 완료");
  } catch (error) {
    await handleUiError(error, "popup:copyDebugLog");
  }
});

clearDebugLogBtn.addEventListener("click", async () => {
  try {
    await clearDebugLogs();
    setResult("디버그 로그 삭제 완료");
  } catch (error) {
    await handleUiError(error, "popup:clearDebugLogs");
  }
});

refreshDebugBtn.addEventListener("click", async () => {
  try {
    await loadData();
    setResult("디버그 로그 새로고침 완료");
  } catch (error) {
    await handleUiError(error, "popup:refreshDebugLogs");
  }
});

loadData().catch((error) => {
  handleUiError(error, "popup:initialLoad").catch(() => {
    setResult(`오류: ${error.message || String(error)}`);
  });
});

setInterval(() => {
  if (shouldPauseAutoRefresh()) {
    return;
  }

  loadData().catch(() => {
    // ignore
  });
}, 1200);
