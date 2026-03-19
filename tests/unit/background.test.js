const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BACKGROUND_PATH = path.join(__dirname, "..", "..", "background.js");
const BACKGROUND_SOURCE = fs.readFileSync(BACKGROUND_PATH, "utf8");

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStorage(initial = {}) {
  const state = { ...initial };

  return {
    state,
    api: {
      async get(key) {
        if (Array.isArray(key)) {
          return key.reduce((acc, item) => {
            acc[item] = state[item];
            return acc;
          }, {});
        }

        if (typeof key === "string") {
          return { [key]: state[key] };
        }

        return { ...state };
      },
      async set(value) {
        Object.assign(state, value || {});
      }
    }
  };
}

function createEventRegistry() {
  return {
    listeners: [],
    addListener(fn) {
      this.listeners.push(fn);
    }
  };
}

function loadBackgroundHarness() {
  const storage = createStorage();
  const executeScriptCalls = [];
  const registries = {
    runtimeOnInstalled: createEventRegistry(),
    runtimeOnMessage: createEventRegistry(),
    tabsOnCreated: createEventRegistry(),
    tabsOnUpdated: createEventRegistry(),
    tabsOnRemoved: createEventRegistry(),
    alarmsOnAlarm: createEventRegistry()
  };

  const tabs = new Map([
    [
      1,
      {
        id: 1,
        url: "https://example.com",
        windowId: 10
      }
    ]
  ]);

  const chrome = {
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() {}
    },
    alarms: {
      async clear() {},
      async create() {},
      onAlarm: registries.alarmsOnAlarm
    },
    runtime: {
      onInstalled: registries.runtimeOnInstalled,
      onMessage: registries.runtimeOnMessage
    },
    scripting: {
      async executeScript(options) {
        executeScriptCalls.push(options);
        return [{ result: { ok: true } }];
      }
    },
    storage: {
      local: storage.api
    },
    tabs: {
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) {
          throw new Error(`No tab with id: ${tabId}.`);
        }
        return tab;
      },
      async query() {
        return [...tabs.values()];
      },
      async sendMessage() {
        return {
          ok: true
        };
      },
      onCreated: registries.tabsOnCreated,
      onUpdated: registries.tabsOnUpdated,
      onRemoved: registries.tabsOnRemoved
    }
  };

  const context = vm.createContext({
    chrome,
    console,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(BACKGROUND_SOURCE, context, {
    filename: BACKGROUND_PATH
  });

  return {
    chrome,
    context,
    executeScriptCalls,
    registries,
    storage: storage.state,
    tabs
  };
}

async function dispatchRuntimeMessage(listener, message) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        reject(new Error(`No response for message: ${message.type}`));
      }
    }, 100);

    listener(message, {}, (response) => {
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

test("START_RECORDING resets recording state and returns an error when root tab initialization fails", async () => {
  const harness = loadBackgroundHarness();
  const listener = harness.registries.runtimeOnMessage.listeners[0];

  harness.context.startRecordingOnTab = async () => {
    throw new Error("페이지와 연결하지 못했습니다.");
  };

  const response = await dispatchRuntimeMessage(listener, {
    type: "START_RECORDING",
    tabId: 1
  });

  assert.equal(response.ok, false);
  assert.equal(response.message, "페이지와 연결하지 못했습니다.");
  assert.deepEqual(normalize(harness.storage.macroRecordingState), {
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
  });
});

test("advances an in-flight click step when the popup tab closes before the content response returns", async () => {
  const harness = loadBackgroundHarness();
  const onRemoved = harness.registries.tabsOnRemoved.listeners[0];

  harness.tabs.set(2, {
    id: 2,
    url: "https://example.com/popup",
    windowId: 11
  });

  let continuedState = null;
  harness.context.continueMacroRun = async (state) => {
    continuedState = normalize(state);
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 2,
    currentTabTrail: [1],
    steps: [
      {
        type: "click",
        selector: "#set_apprv",
        label: "반영"
      },
      {
        type: "click",
        selector: "#btnConfirmD",
        label: "확인"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "매크로 실행 중",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: 0,
    activeStepType: "click",
    activeStepTabId: 2
  };

  await onRemoved(2);

  assert.equal(continuedState.currentTabId, 1);
  assert.equal(continuedState.stepIndex, 1);
  assert.equal(continuedState.activeStepIndex, -1);
  assert.equal(continuedState.activeStepType, "");
  assert.equal(continuedState.activeStepTabId, null);
});

test("continueMacroRun recovers when a click closes the popup before the response arrives", async () => {
  const harness = loadBackgroundHarness();
  const onRemoved = harness.registries.tabsOnRemoved.listeners[0];
  const closedMessage =
    "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
  let runSingleStepCalls = 0;

  harness.tabs.set(2, {
    id: 2,
    url: "https://example.com/approvalLineWrite.do",
    windowId: 11
  });

  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === "RUN_SINGLE_STEP") {
      runSingleStepCalls += 1;

      if (runSingleStepCalls === 1) {
        setTimeout(() => {
          harness.tabs.delete(2);
          onRemoved(2).catch(() => {});
        }, 20);
        throw new Error(closedMessage);
      }
    }

    return {
      ok: true
    };
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 2,
    currentTabTrail: [1],
    steps: [
      {
        type: "click",
        selector: "#set_apprv",
        label: "반영"
      },
      {
        type: "click",
        selector: "#btnConfirmD",
        label: "확인"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "매크로 실행 중",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null
  };

  await harness.context.continueMacroRun(harness.storage.macroRunState);

  assert.equal(runSingleStepCalls, 2);
  assert.equal(harness.storage.macroRunState.running, false);
  assert.equal(harness.storage.macroRunState.lastMessage, "실행 완료");
});

test("restores to the previous tab when the current run tab is already missing", async () => {
  const harness = loadBackgroundHarness();
  let sentToTabId = null;

  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === "RUN_SINGLE_STEP") {
      sentToTabId = tabId;
    }

    return {
      ok: true
    };
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 2,
    currentTabTrail: [1],
    steps: [
      {
        type: "click",
        selector: "#btnConfirmD",
        label: "확인"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "매크로 실행 중",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null
  };

  await harness.context.continueMacroRun(harness.storage.macroRunState);

  assert.equal(sentToTabId, 1);
  assert.equal(harness.storage.macroRunState.running, false);
  assert.equal(harness.storage.macroRunState.lastMessage, "실행 완료");
});

test("continueMacroRun recovers when a click reloads the current tab before the response arrives", async () => {
  const harness = loadBackgroundHarness();
  const closedMessage =
    "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
  let runSingleStepCalls = 0;

  harness.tabs.set(1, {
    id: 1,
    url: "https://example.com/docCommonDraftView.do?firstApproval=Y",
    windowId: 10,
    status: "complete"
  });

  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === "RUN_SINGLE_STEP") {
      runSingleStepCalls += 1;

      if (runSingleStepCalls === 1) {
        setTimeout(() => {
          const currentTab = harness.tabs.get(1);
          harness.tabs.set(1, {
            ...currentTab,
            status: "loading",
            pendingUrl: currentTab.url
          });
        }, 20);
        throw new Error(closedMessage);
      }
    }

    return {
      ok: true
    };
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 1,
    currentTabTrail: [],
    steps: [
      {
        type: "click",
        selector: "#set_apprv",
        label: "반영"
      },
      {
        type: "click",
        selector: "#btnConfirmD",
        label: "확인"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "매크로 실행 중",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null
  };

  await harness.context.continueMacroRun(harness.storage.macroRunState);

  assert.equal(runSingleStepCalls, 2);
  assert.equal(harness.storage.macroRunState.running, false);
  assert.equal(harness.storage.macroRunState.lastMessage, "실행 완료");
});

test("continueMacroRun waits for a successful click-triggered reload before running the next wait and click", async () => {
  const harness = loadBackgroundHarness();
  let runSingleStepCalls = 0;

  harness.tabs.set(1, {
    id: 1,
    url: "https://example.com/docCommonDraftView.do?multiViewYN=Y",
    windowId: 10,
    status: "complete"
  });

  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    const currentTab = harness.tabs.get(tabId);

    if (message.type === "PING") {
      if (currentTab?.status === "loading") {
        throw new Error("Receiving end does not exist");
      }

      return {
        ok: true
      };
    }

    if (message.type === "RUN_SINGLE_STEP") {
      runSingleStepCalls += 1;

      if (message.index === 0) {
        harness.tabs.set(tabId, {
          ...currentTab,
          status: "loading",
          pendingUrl: currentTab.url
        });

        setTimeout(() => {
          const reloadedTab = harness.tabs.get(tabId);
          harness.tabs.set(tabId, {
            ...reloadedTab,
            status: "complete",
            pendingUrl: ""
          });
        }, 2000);

        return {
          ok: true,
          message: "[1] 클릭: 확인 완료"
        };
      }

      return {
        ok: true
      };
    }

    return {
      ok: true
    };
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 1,
    currentTabTrail: [],
    steps: [
      {
        type: "click",
        selector: "#btnConfirmD",
        label: "확인"
      },
      {
        type: "wait",
        ms: 500
      },
      {
        type: "click",
        selector: "div.PUDD.PUDD-COLOR-blue.PUDD-UI-Button:nth-of-type(6) > input.psh_btn",
        label: "결재"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "매크로 실행 중",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null
  };

  await harness.context.continueMacroRun(harness.storage.macroRunState);

  assert.equal(runSingleStepCalls, 3);
  assert.equal(harness.storage.macroRunState.running, false);
  assert.equal(harness.storage.macroRunState.lastMessage, "실행 완료");
});

test("SAVE_MACRO stores and overwrites saved macros by name", async () => {
  const harness = loadBackgroundHarness();
  const listener = harness.registries.runtimeOnMessage.listeners[0];

  const firstResponse = await dispatchRuntimeMessage(listener, {
    type: "SAVE_MACRO",
    name: "기본 흐름",
    steps: [
      {
        type: "click",
        selector: "#first",
        label: "첫 버튼"
      }
    ]
  });

  assert.equal(firstResponse.ok, true);
  assert.equal(firstResponse.savedMacros.length, 1);
  assert.equal(firstResponse.savedMacros[0].name, "기본 흐름");

  const secondResponse = await dispatchRuntimeMessage(listener, {
    type: "SAVE_MACRO",
    name: "기본 흐름",
    steps: [
      {
        type: "click",
        selector: "#second",
        label: "둘째 버튼"
      }
    ]
  });

  assert.equal(secondResponse.ok, true);
  assert.equal(secondResponse.savedMacros.length, 1);
  assert.deepEqual(normalize(secondResponse.savedMacros[0].steps), [
    {
      type: "click",
      selector: "#second",
      label: "둘째 버튼"
    }
  ]);
});

test("SET_STEPS defaults key steps without key metadata to Space", async () => {
  const harness = loadBackgroundHarness();
  const listener = harness.registries.runtimeOnMessage.listeners[0];

  const response = await dispatchRuntimeMessage(listener, {
    type: "SET_STEPS",
    steps: [
      {
        type: "key",
        selector: "#btnConfirmD",
        label: "확인"
      }
    ]
  });

  assert.equal(response.ok, true);
  assert.deepEqual(normalize(harness.storage.macroSteps), [
    {
      type: "key",
      selector: "#btnConfirmD",
      label: "확인",
      key: " ",
      code: "Space"
    }
  ]);
});

test("GET_DATA backfills legacy key steps without key metadata", async () => {
  const harness = loadBackgroundHarness();
  const listener = harness.registries.runtimeOnMessage.listeners[0];

  harness.storage.macroSteps = [
    {
      type: "key",
      selector: "#btnConfirmD",
      label: "확인"
    }
  ];
  harness.storage.macroRunTraceLogs = [
    {
      at: 1,
      source: "run:background",
      eventType: "run-start",
      message: "매크로 실행 시작"
    }
  ];

  const response = await dispatchRuntimeMessage(listener, {
    type: "GET_DATA"
  });

  assert.equal(response.ok, true);
  assert.deepEqual(normalize(response.steps), [
    {
      type: "key",
      selector: "#btnConfirmD",
      label: "확인",
      key: " ",
      code: "Space"
    }
  ]);
  assert.deepEqual(normalize(response.runTraceLogs), normalize(harness.storage.macroRunTraceLogs));
  assert.deepEqual(normalize(harness.storage.macroSteps), normalize(response.steps));
});

test("handleRunRelatedTab completes waitForPopup when the current tab reloads to the expected URL", async () => {
  const harness = loadBackgroundHarness();
  let continuedState = null;

  harness.tabs.set(1, {
    id: 1,
    url: "https://example.com/docCommonDraftView.do?firstApproval=Y",
    windowId: 10,
    status: "complete"
  });

  harness.context.continueMacroRun = async (state) => {
    continuedState = normalize(state);
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 1,
    currentTabTrail: [],
    steps: [
      {
        type: "click",
        selector: "#btnConfirm",
        label: "확인"
      },
      {
        type: "waitForPopup",
        urlIncludes: "docCommonDraftView.do",
        timeout: 10000
      },
      {
        type: "click",
        selector: "#next",
        label: "다음"
      }
    ],
    stepIndex: 1,
    waitingForPopup: true,
    popupUrlIncludes: "docCommonDraftView.do",
    popupTimeout: 10000,
    popupWaitStartedAt: Date.now(),
    lastMessage: "새 창 대기 중: docCommonDraftView.do",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [1],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null
  };

  await harness.context.handleRunRelatedTab(1, harness.tabs.get(1));

  assert.equal(continuedState.stepIndex, 2);
  assert.equal(continuedState.currentTabId, 1);
  assert.equal(continuedState.waitingForPopup, false);
  assert.equal(continuedState.lastMessage.includes("현재 탭 새로고침 완료"), true);
});

test("continueMacroRun repeats the full macro for the requested repeat count", async () => {
  const harness = loadBackgroundHarness();
  let runSingleStepCalls = 0;

  harness.chrome.tabs.sendMessage = async (tabId, message) => {
    if (message.type === "RUN_SINGLE_STEP") {
      runSingleStepCalls += 1;
    }

    return {
      ok: true
    };
  };

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    rootWindowId: 10,
    rootOrigin: "https://example.com",
    rootHostname: "example.com",
    currentTabId: 1,
    currentTabTrail: [],
    steps: [
      {
        type: "click",
        selector: "#runBtn",
        label: "실행"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "매크로 실행 시작",
    error: "",
    pendingPopupTabIds: [],
    knownTabIdsAtWaitStart: [],
    activeStepIndex: -1,
    activeStepType: "",
    activeStepTabId: null,
    repeatTotal: 2,
    repeatRemaining: 2,
    repeatDelayMs: 0,
    iteration: 1
  };

  await harness.context.continueMacroRun(harness.storage.macroRunState);

  assert.equal(runSingleStepCalls, 2);
  assert.equal(harness.storage.macroRunState.running, false);
  assert.equal(harness.storage.macroRunState.lastMessage, "실행 완료 (2회 반복)");
});

test("STOP_MACRO_RUN clears the current run state", async () => {
  const harness = loadBackgroundHarness();
  const listener = harness.registries.runtimeOnMessage.listeners[0];

  harness.storage.macroRunState = {
    running: true,
    rootTabId: 1,
    currentTabId: 1,
    steps: [
      {
        type: "click",
        selector: "#runBtn"
      }
    ],
    stepIndex: 0,
    waitingForPopup: false,
    popupUrlIncludes: "",
    popupTimeout: 0,
    popupWaitStartedAt: 0,
    lastMessage: "실행 중",
    error: ""
  };

  const response = await dispatchRuntimeMessage(listener, {
    type: "STOP_MACRO_RUN"
  });

  assert.equal(response.ok, true);
  assert.equal(response.run.running, false);
  assert.equal(response.run.lastMessage, "사용자가 매크로 실행을 중지했습니다.");
});

test("START_MACRO_RUN enables native dialog auto-accept and STOP_MACRO_RUN disables it", async () => {
  const harness = loadBackgroundHarness();
  const listener = harness.registries.runtimeOnMessage.listeners[0];

  const startResponse = await dispatchRuntimeMessage(listener, {
    type: "START_MACRO_RUN",
    tabId: 1,
    steps: [
      {
        type: "wait",
        ms: 50
      }
    ]
  });

  assert.equal(startResponse.ok, true);
  assert.equal(harness.executeScriptCalls.length > 0, true);
  const enabledCall = harness.executeScriptCalls.find((call) => call.world === "MAIN");
  assert.equal(enabledCall?.world, "MAIN");
  assert.deepEqual(normalize(enabledCall?.args), [true]);

  const stopResponse = await dispatchRuntimeMessage(listener, {
    type: "STOP_MACRO_RUN"
  });

  assert.equal(stopResponse.ok, true);
  const disabledCall = [...harness.executeScriptCalls]
    .reverse()
    .find((call) => call.world === "MAIN" && Array.isArray(call.args) && call.args[0] === false);
  assert.equal(disabledCall?.world, "MAIN");
  assert.deepEqual(normalize(disabledCall?.args), [false]);
});
