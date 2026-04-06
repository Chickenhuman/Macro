const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const CONTENT_PATH = path.join(__dirname, "..", "..", "content.js");
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
  const appendedToDocumentElement = [];

  const createNode = () => ({
    style: {},
    appendChild() {},
    remove() {
      const index = appendedToDocumentElement.indexOf(this);
      if (index >= 0) {
        appendedToDocumentElement.splice(index, 1);
      }
    },
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
      appendChild(node) {
        appendedToDocumentElement.push(node);
      }
    },
    addEventListener() {},
    createElement: createNode,
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    __appendedToDocumentElement: appendedToDocumentElement
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
    location: {
      href: "https://example.com/test"
    },
    MouseEvent: class MouseEventMock {},
    setTimeout,
    clearTimeout,
    window
  });

  vm.runInContext(CONTENT_SOURCE, context, {
    filename: CONTENT_PATH
  });

  window.document = document;

  return {
    chrome,
    document,
    hooks,
    runtimeListener,
    storage: storage.state
  };
}

async function dispatchContentRuntimeMessage(listener, message, sender = {}) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        reject(new Error(`No response for message: ${message.type}`));
      }
    }, 100);

    listener(message, sender, (response) => {
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function createApprovalGuardElement(tagName, text, options = {}) {
  return {
    nodeType: 1,
    tagName,
    ownerDocument: null,
    innerText: text,
    textContent: text,
    childElementCount: options.childElementCount ?? 1,
    getBoundingClientRect() {
      return {
        width: 120,
        height: 24
      };
    },
    getAttribute(name) {
      if (name === "role") {
        return options.role || "";
      }

      return "";
    }
  };
}

function createApprovalGuardWindow({ containers = [], frames = [] } = {}) {
  const document = {
    activeElement: null,
    defaultView: null,
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") {
        return frames;
      }

      if (selector === "tr, [role='row'], li, section, article, div") {
        return containers;
      }

      return [];
    }
  };

  const window = {
    document,
    getComputedStyle() {
      return {
        display: "block",
        visibility: "visible",
        opacity: "1"
      };
    }
  };

  document.defaultView = window;
  containers.forEach((entry) => {
    entry.ownerDocument = document;
  });
  frames.forEach((entry) => {
    entry.ownerDocument = document;
  });

  return window;
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

test("persistRecordedSteps preserves key step metadata during storage fallback", async () => {
  const step = {
    type: "key",
    selector: "#spaceToggleLabel",
    label: "스페이스 토글",
    key: " ",
    code: "Space"
  };

  const harness = loadContentHarness({
    sendMessageImpl: async () => {
      throw new Error(
        "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
      );
    }
  });

  await harness.hooks.persistRecordedSteps([step]);

  assert.deepEqual(normalize(harness.storage.macroSteps), [step]);
});

test("querySelectorDeep finds same-origin iframe descendants from the top frame", () => {
  const harness = loadContentHarness();

  const childTarget = {
    nodeType: 1,
    tagName: "DIV",
    ownerDocument: null
  };

  const childDocument = {
    activeElement: null,
    defaultView: null,
    querySelector(selector) {
      return selector === "#rowCheckWrap" ? childTarget : null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") {
        return [];
      }

      if (selector === "body *") {
        return [childTarget];
      }

      return [];
    }
  };
  const childWindow = {
    document: childDocument
  };
  childDocument.defaultView = childWindow;
  childTarget.ownerDocument = childDocument;

  const frameElement = {
    nodeType: 1,
    tagName: "IFRAME",
    contentWindow: childWindow
  };

  const topDocument = {
    activeElement: null,
    defaultView: null,
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") {
        return [frameElement];
      }

      if (selector === "body *") {
        return [];
      }

      return [];
    }
  };
  const topWindow = {
    document: topDocument
  };
  topDocument.defaultView = topWindow;
  frameElement.ownerDocument = topDocument;

  assert.equal(harness.hooks.isElementNode(childTarget), true);
  assert.equal(harness.hooks.querySelectorDeep("#rowCheckWrap", topWindow), childTarget);
  const deepMatches = harness.hooks.collectQuerySelectorAllDeep("body *", topWindow);
  assert.equal(Array.isArray(deepMatches), true);
  assert.equal(deepMatches.length, 1);
  assert.equal(deepMatches[0], childTarget);
});

test("querySelectorDeep prefers iframe descendants over same-selector hidden inputs in the top frame", () => {
  const harness = loadContentHarness();

  const hiddenTopInput = {
    nodeType: 1,
    tagName: "INPUT",
    ownerDocument: null,
    getAttribute(name) {
      return name === "type" ? "hidden" : "";
    }
  };

  const childTarget = {
    nodeType: 1,
    tagName: "INPUT",
    ownerDocument: null,
    getAttribute(name) {
      return name === "type" ? "password" : "";
    }
  };

  const childDocument = {
    activeElement: null,
    defaultView: null,
    querySelector(selector) {
      return selector === "#userPassword" ? childTarget : null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") {
        return [];
      }

      return [];
    }
  };
  const childWindow = {
    document: childDocument
  };
  childDocument.defaultView = childWindow;
  childTarget.ownerDocument = childDocument;

  const frameElement = {
    nodeType: 1,
    tagName: "IFRAME",
    contentWindow: childWindow
  };

  const topDocument = {
    activeElement: frameElement,
    defaultView: null,
    querySelector(selector) {
      return selector === "#userPassword" ? hiddenTopInput : null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe, frame") {
        return [frameElement];
      }

      return [];
    }
  };
  const topWindow = {
    document: topDocument
  };
  topDocument.defaultView = topWindow;
  hiddenTopInput.ownerDocument = topDocument;
  frameElement.ownerDocument = topDocument;

  assert.equal(harness.hooks.querySelectorDeep("#userPassword", topWindow), childTarget);
});

test("findApprovalGuardMatch blocks when the closing department row only contains 조경환 as a name", () => {
  const harness = loadContentHarness();
  const row = createApprovalGuardElement("TR", "마감부서 팀원 조경환");
  const topWindow = createApprovalGuardWindow({
    containers: [row]
  });

  assert.deepEqual(normalize(harness.hooks.findApprovalGuardMatch(topWindow)), {
    blocked: true,
    matchedText: "마감부서 팀원 조경환"
  });
});

test("findApprovalGuardMatch ignores the closing department block when another name is present", () => {
  const harness = loadContentHarness();
  const row = createApprovalGuardElement("TR", "마감부서 팀원 조경환 팀장 서동진");
  const topWindow = createApprovalGuardWindow({
    containers: [row]
  });

  assert.deepEqual(normalize(harness.hooks.findApprovalGuardMatch(topWindow)), {
    blocked: false,
    matchedText: ""
  });
});

test("findApprovalGuardMatch ignores unrelated 조경환 text outside the closing department block", () => {
  const harness = loadContentHarness();
  const row = createApprovalGuardElement("TR", "마감부서 재무기획팀");
  const stray = createApprovalGuardElement("DIV", "결재자 조경환 안내");
  const topWindow = createApprovalGuardWindow({
    containers: [row, stray]
  });

  assert.deepEqual(normalize(harness.hooks.findApprovalGuardMatch(topWindow)), {
    blocked: false,
    matchedText: ""
  });
});

test("findApprovalGuardMatch scans same-origin child frames", () => {
  const harness = loadContentHarness();
  const childRow = createApprovalGuardElement("TR", "마감부서 팀원 조경환");
  const childWindow = createApprovalGuardWindow({
    containers: [childRow]
  });
  const frame = {
    nodeType: 1,
    tagName: "IFRAME",
    contentWindow: childWindow
  };
  const topWindow = createApprovalGuardWindow({
    containers: [],
    frames: [frame]
  });

  assert.equal(harness.hooks.findApprovalGuardMatch(topWindow).blocked, true);
});

test("RUN_SINGLE_STEP does not render the run overlay when hideRunOverlay is enabled", async () => {
  const harness = loadContentHarness();

  const response = await dispatchContentRuntimeMessage(harness.runtimeListener.fn, {
    type: "RUN_SINGLE_STEP",
    step: {
      type: "wait",
      ms: 1
    },
    index: 0,
    hideRunOverlay: true
  });

  assert.equal(response.ok, true);
  assert.equal(harness.document.__appendedToDocumentElement.length, 0);
});

test("RUN_SINGLE_STEP renders the run overlay by default", async () => {
  const harness = loadContentHarness();

  const response = await dispatchContentRuntimeMessage(harness.runtimeListener.fn, {
    type: "RUN_SINGLE_STEP",
    step: {
      type: "wait",
      ms: 1
    },
    index: 0
  });

  assert.equal(response.ok, true);
  assert.equal(harness.document.__appendedToDocumentElement.length, 1);
});

test("RUN_SINGLE_STEP skips run trace messages when runTraceEnabled is false", async () => {
  const traceMessages = [];
  const harness = loadContentHarness({
    sendMessageImpl: async (message) => {
      if (message?.type === "APPEND_RUN_TRACE_LOG") {
        traceMessages.push(message);
      }

      return {
        ok: true
      };
    }
  });

  const response = await dispatchContentRuntimeMessage(harness.runtimeListener.fn, {
    type: "RUN_SINGLE_STEP",
    step: {
      type: "wait",
      ms: 1
    },
    index: 0,
    runTraceEnabled: false
  });

  assert.equal(response.ok, true);
  assert.deepEqual(traceMessages, []);
});

test("RUN_SINGLE_STEP sends run trace messages when runTraceEnabled is true", async () => {
  const traceMessages = [];
  const harness = loadContentHarness({
    sendMessageImpl: async (message) => {
      if (message?.type === "APPEND_RUN_TRACE_LOG") {
        traceMessages.push(message);
      }

      return {
        ok: true
      };
    }
  });

  const response = await dispatchContentRuntimeMessage(harness.runtimeListener.fn, {
    type: "RUN_SINGLE_STEP",
    step: {
      type: "wait",
      ms: 1
    },
    index: 0
  });

  assert.equal(response.ok, true);
  assert.equal(traceMessages.length, 2);
  assert.equal(traceMessages[0].entry?.eventType, "step-start");
  assert.equal(traceMessages[1].entry?.eventType, "step-success");
});
