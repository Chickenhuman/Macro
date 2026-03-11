const startRecordBtn = document.getElementById("startRecordBtn");
const stopRecordBtn = document.getElementById("stopRecordBtn");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const refreshBtn = document.getElementById("refreshBtn");
const addWaitForTemplateBtn = document.getElementById("addWaitForTemplateBtn");
const addWaitForPopupTemplateBtn = document.getElementById("addWaitForPopupTemplateBtn");

const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const stepsMeta = document.getElementById("stepsMeta");
const emptyBox = document.getElementById("emptyBox");
const stepsList = document.getElementById("stepsList");
const jsonEditor = document.getElementById("jsonEditor");
const applyJsonBtn = document.getElementById("applyJsonBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const resultBox = document.getElementById("resultBox");

let currentData = {
  steps: [],
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
  }
};

let editingStepIndex = null;

function setResult(text) {
  resultBox.textContent = text;
}

async function sendRuntimeMessage(message) {
  return await chrome.runtime.sendMessage(message);
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

  switch (step.type) {
    case "click":
      return `클릭: ${step.label || step.selector || "(selector 없음)"}`;
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

  if (run.running) {
    statusBadge.textContent = run.waitingForPopup ? "POP" : "RUN";
    statusBadge.classList.remove("recording");
    statusText.textContent = run.waitingForPopup
      ? `새 창을 기다리는 중입니다. ${run.popupUrlIncludes || ""}`.trim()
      : `매크로 실행 중입니다. ${run.stepIndex}/${(run.steps || []).length}`;
    return;
  }

  if (recording.enabled) {
    statusBadge.textContent = "기록 중";
    statusBadge.classList.add("recording");
    statusText.textContent = "현재 페이지와 새로 열리는 관련 창에서 사용자 동작을 기록하고 있습니다.";
    return;
  }

  statusBadge.textContent = "대기";
  statusBadge.classList.remove("recording");
  statusText.textContent = "기록 중이 아니며 실행도 진행 중이 아닙니다.";
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
      setResult(`오류: ${error.message || String(error)}`);
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

  stepsMeta.textContent = `${steps.length}개`;

  if (!steps.length) {
    emptyBox.style.display = "block";
    stepsList.style.display = "none";
    stepsList.innerHTML = "";
    jsonEditor.value = "[]";
    return;
  }

  emptyBox.style.display = "none";
  stepsList.style.display = "flex";
  stepsList.innerHTML = "";

  steps.forEach((step, index) => {
    const item = document.createElement("div");
    item.className = "step-item";

    const main = document.createElement("div");
    main.className = "step-main";
    main.textContent = `${index + 1}. ${describeStep(step)}`;

    const actions = document.createElement("div");
    actions.className = "step-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "위로";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", async () => {
      const next = [...steps];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      await setSteps(next);
    });

    const downBtn = document.createElement("button");
    downBtn.textContent = "아래로";
    downBtn.disabled = index === steps.length - 1;
    downBtn.addEventListener("click", async () => {
      const next = [...steps];
      [next[index + 1], next[index]] = [next[index], next[index + 1]];
      await setSteps(next);
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

    item.appendChild(main);
    item.appendChild(actions);
    renderStepEditor(item, step, index, steps);
    stepsList.appendChild(item);
  });

  jsonEditor.value = JSON.stringify(steps, null, 2);
}

async function loadData() {
  const response = await sendRuntimeMessage({
    type: "GET_DATA"
  });

  if (!response?.ok) {
    throw new Error(response?.message || "데이터를 불러오지 못했습니다.");
  }

  currentData = {
    steps: Array.isArray(response.steps) ? response.steps : [],
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
    }
  };

  if (typeof editingStepIndex === "number" && editingStepIndex >= currentData.steps.length) {
    editingStepIndex = null;
  }

  renderStatus();
  renderSteps();

  if (currentData.run?.lastMessage) {
    setResult(currentData.run.lastMessage);
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

  const response = await sendRuntimeMessage({
    type: "START_MACRO_RUN",
    tabId: tab.id,
    steps
  });

  if (!response?.ok) {
    throw new Error(response?.message || "실행 실패");
  }

  await loadData();
  setResult(response.message || "실행 시작됨");
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
    setResult(`오류: ${error.message || String(error)}`);
  }
});

stopRecordBtn.addEventListener("click", async () => {
  try {
    await stopRecording();
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

runBtn.addEventListener("click", async () => {
  try {
    await runMacro();
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

clearBtn.addEventListener("click", async () => {
  try {
    await clearSteps();
    setResult("기록 전체 삭제 완료");
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

refreshBtn.addEventListener("click", async () => {
  try {
    await loadData();
    setResult("새로고침 완료");
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

document.querySelectorAll("button[data-wait]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const ms = Number(button.getAttribute("data-wait"));
      await addWait(ms);
    } catch (error) {
      setResult(`오류: ${error.message || String(error)}`);
    }
  });
});

addWaitForTemplateBtn.addEventListener("click", async () => {
  try {
    await addWaitForTemplate();
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

addWaitForPopupTemplateBtn.addEventListener("click", async () => {
  try {
    await addWaitForPopupTemplate();
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

applyJsonBtn.addEventListener("click", async () => {
  try {
    editingStepIndex = null;
    await applyJson();
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

copyJsonBtn.addEventListener("click", async () => {
  try {
    await copyJson();
  } catch (error) {
    setResult(`오류: ${error.message || String(error)}`);
  }
});

loadData().catch((error) => {
  setResult(`오류: ${error.message || String(error)}`);
});

setInterval(() => {
  loadData().catch(() => {
    // ignore
  });
}, 1200);
