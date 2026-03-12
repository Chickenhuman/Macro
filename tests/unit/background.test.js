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
      async executeScript() {}
    },
    storage: {
      local: storage.api
    },
    tabs: {
      async get(tabId) {
        return tabs.get(tabId);
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
