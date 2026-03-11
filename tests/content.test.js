const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CONTENT_PATH = path.join(__dirname, "..", "content.js");
const CONTENT_SOURCE = fs.readFileSync(CONTENT_PATH, "utf8");

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

function createDocumentMock() {
  const createNode = () => ({
    style: {},
    appendChild() {},
    remove() {},
    setAttribute() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    focus() {},
    scrollIntoView() {},
    matches() {
      return false;
    },
    classList: [],
    textContent: "",
    innerText: ""
  });

  return {
    body: createNode(),
    documentElement: {
      appendChild() {}
    },
    addEventListener() {},
    createElement: createNode,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function loadContentHarness({ sendMessageImpl, initialStorage } = {}) {
  const storage = createStorage(initialStorage);
  const hooks = {};
  const runtimeListener = { fn: null };
  const document = createDocumentMock();
  const window = {
    __EASY_WEB_MACRO_TEST_HOOKS__: hooks,
    CSS: {
      escape(value) {
        return String(value);
      }
    }
  };

  class ElementMock {}

  const chrome = {
    runtime: {
      async sendMessage(message) {
        if (sendMessageImpl) {
          return await sendMessageImpl(message);
        }

        return {
          ok: true,
          steps: []
        };
      },
      onMessage: {
        addListener(fn) {
          runtimeListener.fn = fn;
        }
      }
    },
    storage: {
      local: storage.api
    }
  };

  const context = vm.createContext({
    chrome,
    console,
    CSS: window.CSS,
    document,
    Element: ElementMock,
    Event: class EventMock {},
    HTMLInputElement: class HTMLInputElementMock {},
    HTMLSelectElement: class HTMLSelectElementMock {},
    HTMLTextAreaElement: class HTMLTextAreaElementMock {},
    MouseEvent: class MouseEventMock {},
    setTimeout,
    clearTimeout,
    window
  });

  vm.runInContext(CONTENT_SOURCE, context, {
    filename: CONTENT_PATH
  });

  return {
    chrome,
    hooks,
    runtimeListener,
    storage: storage.state
  };
}

test("persistRecordedSteps falls back to storage when runtime response channel closes", async () => {
  const harness = loadContentHarness({
    sendMessageImpl: async () => {
      throw new Error(
        "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
      );
    }
  });

  const step = {
    type: "click",
    selector: "#saveBtn",
    label: "저장"
  };

  await harness.hooks.persistRecordedSteps([step]);

  assert.deepEqual(normalize(harness.storage.macroSteps), [step]);
});

test("persistRecordedSteps does not duplicate a batch already appended before channel close", async () => {
  const step = {
    type: "click",
    selector: "#saveBtn",
    label: "저장"
  };

  const harness = loadContentHarness({
    initialStorage: {
      macroSteps: [step]
    },
    sendMessageImpl: async () => {
      throw new Error(
        "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
      );
    }
  });

  await harness.hooks.persistRecordedSteps([step]);

  assert.deepEqual(normalize(harness.storage.macroSteps), [step]);
});

test("persistRecordedSteps avoids direct storage fallback when runtime append succeeds", async () => {
  const step = {
    type: "click",
    selector: "#saveBtn",
    label: "저장"
  };

  const harness = loadContentHarness({
    sendMessageImpl: async (message) => ({
      ok: true,
      steps: message.steps
    })
  });

  await harness.hooks.persistRecordedSteps([step]);

  assert.equal(harness.storage.macroSteps, undefined);
});
