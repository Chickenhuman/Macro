const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BACKGROUND_PATH = path.join(__dirname, "..", "background.js");
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
    storage: storage.state
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
