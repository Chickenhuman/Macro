(() => {
  if (window.__EASY_WEB_MACRO_INSTALLED__) {
    return;
  }
  window.__EASY_WEB_MACRO_INSTALLED__ = true;

  let recordMode = false;
  let debugMode = false;
  let lastRecordedAt = null;
  let overlayRoot = null;
  let overlayTitle = null;
  let overlayBody = null;
  let pendingDropdownRecord = null;
  let pendingKeyClickSuppression = null;
  let recordingFrameObserver = null;
  let recordingFrameRefreshTimer = null;
  const observedRecordingFrames = new WeakSet();
  const STEPS_KEY = "macroSteps";
  const RECORDING_KEY = "macroRecordingState";
  const RECORD_STATE_EVENT_TYPE = "__EASY_WEB_MACRO_RECORD_STATE__";
  const FRAME_READY_EVENT_TYPE = "__EASY_WEB_MACRO_FRAME_READY__";

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function roundDelay(ms) {
    if (ms < 400) return 0;
    return Math.min(30000, Math.round(ms / 100) * 100);
  }

  function cssEscapeSafe(value) {
    if (window.CSS && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, "\\$1");
  }

  function isUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function isStableClassName(name) {
    if (!name) return false;

    const lower = name.toLowerCase();

    if (name.length > 40) return false;
    if (name.length <= 2) return false;
    if (/^\d/.test(name)) return false;

    const unstable = [
      "on",
      "off",
      "active",
      "selected",
      "hover",
      "focus",
      "open",
      "close",
      "disabled",
      "checked",
      "current"
    ];

    if (unstable.includes(lower)) {
      return false;
    }

    if (/(active|selected|hover|focus|open|close|disabled|checked|current)/i.test(lower)) {
      return false;
    }

    return true;
  }

  function getHumanLabel(el) {
    if (!el) return "";

    const parts = [
      el.getAttribute("aria-label"),
      el.innerText,
      el.textContent,
      el.value,
      el.getAttribute("title"),
      el.getAttribute("name"),
      el.id
    ];

    for (const part of parts) {
      if (typeof part === "string" && part.trim()) {
        return part.trim().replace(/\s+/g, " ").slice(0, 80);
      }
    }

    return el.tagName.toLowerCase();
  }

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function getElementDisplayValue(el) {
    if (!isElementNode(el)) return "";

    if ("value" in el && typeof el.value === "string") {
      return normalizeText(el.value);
    }

    const selected = el.querySelector?.(
      "[aria-selected='true'], .selected, .on, .active, .is-selected"
    );
    if (selected) {
      const selectedText = normalizeText(selected.innerText || selected.textContent || "");
      if (selectedText) return selectedText;
    }

    return normalizeText(el.innerText || el.textContent || "");
  }

  function isMeaningfulStepLabel(label) {
    const text = normalizeText(label);
    if (!text) return false;
    if (text.length <= 1) return false;

    return !GENERIC_STEP_LABELS.has(text.toLowerCase());
  }

  function getLabelMatchScore(actualLabel, expectedLabel) {
    const actual = normalizeText(actualLabel);
    const expected = normalizeText(expectedLabel);
    if (!actual || !expected) return -1;

    if (actual === expected) return 300;
    if (actual.includes(expected)) return 220;
    return -1;
  }

  function hasMatchingLabel(el, expectedLabel) {
    return getLabelMatchScore(getHumanLabel(el), expectedLabel) >= 0;
  }

  function getStableClassTokens(el) {
    if (!isElementNode(el) || typeof el.className !== "string") return [];

    return el.className
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token && isStableClassName(token));
  }

  function getClassOverlapScore(a, b) {
    const aTokens = getStableClassTokens(a);
    const bTokens = new Set(getStableClassTokens(b));
    let overlap = 0;

    for (const token of aTokens) {
      if (bTokens.has(token)) {
        overlap += 1;
      }
    }

    return Math.min(20, overlap * 5);
  }

  function getDomDistance(a, b) {
    if (!isElementNode(a) || !isElementNode(b)) {
      return Number.POSITIVE_INFINITY;
    }

    const seen = new Map();
    let node = a;
    let depth = 0;

    while (node) {
      seen.set(node, depth);
      node = node.parentElement;
      depth += 1;
    }

    node = b;
    depth = 0;
    while (node) {
      if (seen.has(node)) {
        return seen.get(node) + depth;
      }
      node = node.parentElement;
      depth += 1;
    }

    return Number.POSITIVE_INFINITY;
  }

  const DROPDOWN_TRIGGER_SELECTOR = [
    "[role='combobox']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='tree']",
    "[data-role='combobox']",
    "[data-role='dropdown']",
    "input[readonly]",
    "input[aria-haspopup]",
    "input[role='combobox']"
  ].join(", ");

  const BUTTON_LIKE_CANDIDATE_SELECTOR = [
    "button",
    "a",
    "[role='button']",
    "[onclick]",
    "input[type='button']",
    "input[type='submit']",
    "input[type='reset']",
    ".btn",
    ".button",
    ".PUDD-UI-Button",
    ".psh_btn",
    ".submit"
  ].join(", ");

  const GENERIC_STEP_LABELS = new Set([
    "a",
    "button",
    "div",
    "em",
    "i",
    "img",
    "input",
    "label",
    "li",
    "option",
    "p",
    "path",
    "section",
    "span",
    "strong",
    "svg",
    "td",
    "tr",
    "ul"
  ]);

  function summarizeElement(el) {
    if (!isElementNode(el)) return null;

    const text = normalizeText(el.innerText || el.textContent || el.value || "").slice(0, 80);
    const className =
      typeof el.className === "string" ? normalizeText(el.className).slice(0, 120) : "";

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      className,
      role: el.getAttribute("role") || "",
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      text
    };
  }

  function summarizeAncestors(el, limit = 6) {
    if (!isElementNode(el)) return [];

    const items = [];
    let node = el;

    while (node && node !== getElementRoot(el) && items.length < limit) {
      const summary = summarizeElement(node);
      if (summary) {
        items.push(summary);
      }
      node = node.parentElement;
    }

    return items;
  }

  function safeBuildSelector(el) {
    try {
      return buildSelector(el);
    } catch {
      return null;
    }
  }

  async function appendDebugLog(entry) {
    if (!debugMode) return;

    try {
      await chrome.runtime.sendMessage({
        type: "APPEND_DEBUG_LOG",
        entry: {
          ...entry,
          source: entry?.source || "content:event",
          pageUrl: location.href
        }
      });
    } catch {
      // ignore debug logging failure
    }
  }

  async function appendRunTraceLog(entry) {
    try {
      await chrome.runtime.sendMessage({
        type: "APPEND_RUN_TRACE_LOG",
        entry: {
          ...entry,
          source: entry?.source || "content:run",
          pageUrl: location.href
        }
      });
    } catch {
      // ignore run trace logging failure
    }
  }

  function summarizeTraceElement(el) {
    if (!isElementNode(el)) return null;

    return {
      ...summarizeElement(el),
      visible: isVisible(el),
      label: getHumanLabel(el),
      selector: safeBuildSelector(el) || ""
    };
  }

  function buildFrameHint(frameElement, extra = {}) {
    if (!isFrameElementNode(frameElement)) {
      return null;
    }

    let locationHref = "";
    try {
      locationHref = String(frameElement.contentWindow?.location?.href || "");
    } catch {
      locationHref = "";
    }

    return {
      frameIdAttr: frameElement.id || "",
      frameName: frameElement.getAttribute("name") || "",
      frameSrc: String(frameElement.getAttribute("src") || ""),
      locationHref,
      visible: isVisible(frameElement),
      ...extra
    };
  }

  function collectTopLevelFrameHints(limit = 10) {
    const hints = [];
    const seen = new Set();

    for (const frameElement of document.querySelectorAll("iframe, frame")) {
      const hint = buildFrameHint(frameElement, {
        active: document.activeElement === frameElement,
        topLevel: true
      });

      if (!hint) {
        continue;
      }

      const key = JSON.stringify([
        hint.frameIdAttr || "",
        hint.frameName || "",
        hint.locationHref || "",
        hint.frameSrc || ""
      ]);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      hints.push(hint);
      if (hints.length >= limit) {
        break;
      }
    }

    return hints;
  }

  function collectChildFrameHintsForSelector(selector, rootWindow = window, depth = 0, results = [], visited = new Set()) {
    if (!selector || depth > 4) {
      return results;
    }

    let currentDocument = null;
    try {
      currentDocument = rootWindow.document;
    } catch {
      return results;
    }

    if (!currentDocument?.querySelectorAll) {
      return results;
    }

    const frameElements = [...currentDocument.querySelectorAll("iframe, frame")];
    const activeFrameElement = isFrameElementNode(currentDocument.activeElement)
      ? currentDocument.activeElement
      : null;
    const orderedFrames = activeFrameElement
      ? [activeFrameElement, ...frameElements.filter((frame) => frame !== activeFrameElement)]
      : frameElements;

    for (const frameElement of orderedFrames) {
      let childWindow = null;
      let childDocument = null;

      try {
        childWindow = frameElement.contentWindow;
        childDocument = childWindow?.document;
        if (!childWindow || !childDocument || visited.has(childWindow)) {
          continue;
        }
        void childDocument.querySelectorAll;
      } catch {
        continue;
      }

      visited.add(childWindow);

      let locationHref = "";
      try {
        locationHref = String(childWindow.location?.href || "");
      } catch {
        locationHref = "";
      }

      let hasMatch = false;
      try {
        hasMatch = !!childDocument.querySelector(selector);
      } catch {
        hasMatch = false;
      }

      if (hasMatch) {
        results.push(
          buildFrameHint(frameElement, {
            active: currentDocument.activeElement === frameElement,
            topLevel: depth === 0
          })
        );
      }

      collectChildFrameHintsForSelector(selector, childWindow, depth + 1, results, visited);
    }

    return results;
  }

  function collectSelectorTrace(selector, limit = 5) {
    const cleanSelector = String(selector || "").trim();
    if (!cleanSelector) {
      return {
        selector: "",
        count: 0,
        matches: []
      };
    }

    try {
      const matches = [...document.querySelectorAll(cleanSelector)];
      return {
        selector: cleanSelector,
        count: matches.length,
        matches: matches.slice(0, limit).map(summarizeTraceElement)
      };
    } catch (error) {
      return {
        selector: cleanSelector,
        count: 0,
        error: String(error?.message || error),
        matches: []
      };
    }
  }

  function collectVisibleButtonTrace(expectedLabel = "", limit = 10) {
    const seen = new Set();
    const rows = [];

    for (const node of document.querySelectorAll(BUTTON_LIKE_CANDIDATE_SELECTOR)) {
      const candidate = getClickableTarget(node);
      if (!isElementNode(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (!isButtonLikeElement(candidate) || !isVisible(candidate)) continue;

      const label = getHumanLabel(candidate);
      rows.push({
        ...summarizeTraceElement(candidate),
        labelMatches: !!expectedLabel && hasMatchingLabel(candidate, expectedLabel)
      });

      if (rows.length >= limit) {
        break;
      }
    }

    return rows;
  }

  function getDocumentHasFocus() {
    try {
      return typeof document.hasFocus === "function" ? document.hasFocus() : false;
    } catch {
      return false;
    }
  }

  function getFrameElementForTrace() {
    try {
      return isElementNode(window.frameElement) ? window.frameElement : null;
    } catch {
      return null;
    }
  }

  function collectFrameContextTrace(step, selectorLimit = 5) {
    const activeElement = document.activeElement;
    const activeFrameHint = buildFrameHint(activeElement, {
      active: true,
      topLevel: window.top === window
    });

    return {
      locationHref: location.href,
      topFrame: window.top === window,
      documentHasFocus: getDocumentHasFocus(),
      activeElement: summarizeTraceElement(activeElement),
      activeFrameHint,
      frameElement: summarizeTraceElement(getFrameElementForTrace()),
      topLevelFrameHints: window.top === window ? collectTopLevelFrameHints() : [],
      selectorTrace: step?.selector ? collectSelectorTrace(step.selector, selectorLimit) : null
    };
  }

  function buildStepFailureContext(step) {
    const context = collectFrameContextTrace(step);

    if (step?.type === "click") {
      context.visibleButtons = collectVisibleButtonTrace(step?.label || "");
    }

    return context;
  }

  function locateRunStepTarget(step) {
    const detail = collectFrameContextTrace(step, 3);
    const result = {
      ok: true,
      canRun: false,
      score: -1,
      detail,
      target: null,
      reason: ""
    };

    if (!step || typeof step !== "object" || !step.type) {
      result.reason = "invalid-step";
      return result;
    }

    if (step.type === "wait") {
      result.canRun = true;
      result.score = detail.documentHasFocus ? 30 : 10;
      return result;
    }

    const selector = typeof step.selector === "string" ? step.selector.trim() : "";
    if (!selector) {
      result.reason = "missing-selector";
      return result;
    }

    let raw = null;
    try {
      raw = document.querySelector(selector);
    } catch (error) {
      result.reason = "invalid-selector";
      result.detail.selectorError = String(error?.message || error);
      return result;
    }

    if (!isElementNode(raw)) {
      result.reason = "no-match";
      if (window.top === window) {
        result.detail.childFrameHints = collectChildFrameHintsForSelector(selector);
      }
      return result;
    }

    let candidate = null;

    switch (step.type) {
      case "click":
        candidate = getPreferredClickTarget(step, raw) || resolveVisibleClickTarget(raw) || raw;
        break;
      case "input":
        candidate = getInputTarget(raw);
        break;
      case "select":
        candidate = raw.tagName === "SELECT" ? raw : null;
        break;
      case "dropdownSelect":
        candidate = resolveVisibleClickTarget(raw) || getDropdownTriggerTarget(raw) || raw;
        break;
      case "key":
        candidate = getKeyboardExecutionTarget(raw) || raw;
        break;
      case "waitFor":
        candidate = raw;
        break;
      default:
        candidate = raw;
        break;
    }

    if (!isElementNode(candidate)) {
      result.reason = "unsupported-target";
      return result;
    }

    let score = 100;

    if (candidate === raw) {
      score += 10;
    }

    if (isVisible(candidate)) {
      score += 40;
    }

    if (detail.documentHasFocus) {
      score += 20;
    }

    if (document.activeElement === candidate) {
      score += 25;
    }

    if (step.type === "click" && isMeaningfulStepLabel(step?.label) && hasMatchingLabel(candidate, step.label)) {
      score += 40;
    }

    if (step.type === "input" && isTextEntryTarget(candidate)) {
      score += 20;
    }

    result.canRun = true;
    result.score = score;
    result.target = summarizeTraceElement(candidate);
    return result;
  }

  function logDebugEvent(eventType, rawTarget, extra = {}) {
    if (!debugMode) return;

    const target = isElementNode(rawTarget) ? rawTarget : null;
    const checkboxTarget = target ? findCheckboxLikeWrapper(target) : null;
    const dropdownTarget = target ? getDropdownTriggerTarget(target) : null;
    const clickableTarget = target ? getClickableTarget(target) : null;
    const inputTarget = target ? getInputTarget(target) : null;

    appendDebugLog({
      source: "content:event",
      eventType,
      target: summarizeElement(target),
      ancestors: summarizeAncestors(target),
      checkboxTarget: summarizeElement(checkboxTarget),
      checkboxSelector: safeBuildSelector(checkboxTarget) || "",
      dropdownTarget: summarizeElement(dropdownTarget),
      dropdownSelector: safeBuildSelector(dropdownTarget) || "",
      clickableTarget: summarizeElement(clickableTarget),
      clickableSelector: safeBuildSelector(clickableTarget) || "",
      inputTarget: summarizeElement(inputTarget),
      inputSelector: safeBuildSelector(inputTarget) || "",
      note: extra.note || ""
    });
  }

  function hasDropdownLikeClassName(el) {
    const className = typeof el?.className === "string" ? el.className.toLowerCase() : "";
    if (!className) return false;

    return (
      /(dropdown|combo|combobox|selectbox|select2|chosen)/.test(className) ||
      /pudd[^\s]*(dropdown|combo|combobox|select)/.test(className)
    );
  }

  function isDropdownLikeElement(el) {
    if (!isElementNode(el)) return false;
    if (el.tagName === "SELECT") return false;

    return el.matches(DROPDOWN_TRIGGER_SELECTOR) || hasDropdownLikeClassName(el);
  }

  function isBroadDropdownContainer(el) {
    if (!isElementNode(el)) return true;
    const ownerDocument = getElementDocument(el);
    if (el === ownerDocument.body || el === ownerDocument.documentElement) return true;
    if (el.matches("body, html, form, table, tbody, thead, tfoot, ul, ol")) return true;
    if ((el.childElementCount || 0) > 10) return true;

    const text = normalizeText(el.innerText || el.textContent || "");
    if (text.length > 120) return true;

    return false;
  }

  function isElementNearReference(candidate, referenceEl) {
    if (!isElementNode(candidate) || !isElementNode(referenceEl)) {
      return false;
    }

    const controlRect = candidate.getBoundingClientRect();
    const referenceRect = referenceEl.getBoundingClientRect();

    if (
      !controlRect.width ||
      !controlRect.height ||
      !referenceRect.width ||
      !referenceRect.height
    ) {
      return true;
    }

    const verticalOverlap =
      Math.min(controlRect.bottom, referenceRect.bottom) -
      Math.max(controlRect.top, referenceRect.top);
    const horizontalOverlap =
      Math.min(controlRect.right, referenceRect.right) -
      Math.max(controlRect.left, referenceRect.left);

    const sameRow =
      verticalOverlap >= Math.min(controlRect.height, referenceRect.height) * 0.3 ||
      Math.abs(controlRect.top - referenceRect.top) < 24 ||
      Math.abs(controlRect.bottom - referenceRect.bottom) < 24;

    const closeHorizontally =
      horizontalOverlap > 0 ||
      Math.abs(controlRect.left - referenceRect.right) < 160 ||
      Math.abs(referenceRect.left - controlRect.right) < 160;

    return sameRow && closeHorizontally;
  }

  function findOwnedDropdownControl(root, referenceEl, maxDepth = 2) {
    if (!isElementNode(root) || isBroadDropdownContainer(root)) return null;

    const queue = [...root.children].map((child) => ({ node: child, depth: 1 }));
    let found = null;

    while (queue.length) {
      const { node, depth } = queue.shift();

      if (isDropdownLikeElement(node) && isElementNearReference(node, referenceEl)) {
        if (found && found !== node) {
          return null;
        }
        found = node;
        continue;
      }

      if (depth >= maxDepth) {
        continue;
      }

      queue.push(...[...node.children].map((child) => ({ node: child, depth: depth + 1 })));
    }

    return found;
  }

  function getDropdownTriggerTarget(rawTarget) {
    if (!isElementNode(rawTarget)) return null;

    let node = rawTarget;
    let depth = 0;
    const rootElement = getElementRoot(rawTarget);

    while (node && node !== rootElement && depth < 6) {
      if (isDropdownLikeElement(node)) {
        return node;
      }

      const ownedControl = findOwnedDropdownControl(node, rawTarget);
      if (ownedControl) {
        return ownedControl;
      }

      node = node.parentElement;
      depth += 1;
    }

    return null;
  }

  function findNearbyButtonLikeTarget(referenceEl, maxDepth = 3) {
    if (!isElementNode(referenceEl)) return null;

    let node = referenceEl;
    let depth = 0;
    const rootElement = getElementRoot(referenceEl);

    while (node && node !== rootElement && depth < maxDepth) {
      const parent = node.parentElement;
      if (!parent || isBroadDropdownContainer(parent)) {
        node = parent;
        depth += 1;
        continue;
      }

      const candidates = [...parent.querySelectorAll("*")]
        .map((candidate) => {
          if (
            candidate === referenceEl ||
            candidate.contains(referenceEl) ||
            !isButtonLikeElement(candidate) ||
            !isVisible(candidate) ||
            !isElementNearReference(candidate, referenceEl)
          ) {
            return null;
          }

          let score = 0;
          if (
            candidate.matches(
              "button, input[type='button'], input[type='submit'], input[type='reset']"
            )
          ) {
            score += 80;
          } else if (candidate.matches("[role='button'], a")) {
            score += 40;
          } else if (hasButtonLikeClassName(candidate)) {
            score += 10;
          }

          if (candidate.parentElement === parent) {
            score += 10;
          }

          return { candidate, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      if (candidates.length && candidates[0].score > 0) {
        return candidates[0].candidate;
      }

      node = parent;
      depth += 1;
    }

    return null;
  }

  function rememberDropdownRecord(trigger) {
    const selector = buildSelector(trigger);
    if (!selector) return false;

    pendingDropdownRecord = {
      selector,
      label: getHumanLabel(trigger),
      beforeValue: getElementDisplayValue(trigger),
      startedAt: Date.now()
    };

    monitorPendingDropdownRecord(pendingDropdownRecord.startedAt).catch(() => {
      // dropdown value tracking is best-effort during recording
    });
    return true;
  }

  function isElementNode(value) {
    return !!value && (
      value instanceof Element ||
      (value.nodeType === 1 && typeof value.tagName === "string")
    );
  }

  function isFrameElementNode(value) {
    return isElementNode(value) && /^(iframe|frame)$/i.test(String(value.tagName || ""));
  }

  function getElementDocument(value) {
    return isElementNode(value) ? value.ownerDocument || document : document;
  }

  function getElementRoot(value) {
    return getElementDocument(value)?.documentElement || document.documentElement;
  }

  function getElementWindow(value) {
    return getElementDocument(value)?.defaultView || window;
  }

  function createUiEvent(target, type, init = {}) {
    const eventWindow = getElementWindow(target);
    const EventCtor = eventWindow?.Event || Event;
    return new EventCtor(type, init);
  }

  function createMouseEventForElement(target, type, init = {}) {
    const eventWindow = getElementWindow(target);
    const MouseEventCtor = eventWindow?.MouseEvent || MouseEvent;
    return new MouseEventCtor(type, {
      bubbles: true,
      cancelable: true,
      ...init
    });
  }

  function querySelectorDeep(selector, rootWindow = window, depth = 0, visited = new Set()) {
    if (!selector || depth > 4) {
      return null;
    }

    let currentDocument = null;
    try {
      currentDocument = rootWindow.document;
      void currentDocument?.querySelectorAll;
    } catch {
      return null;
    }

    const directMatch = currentDocument.querySelector(selector);
    if (directMatch) {
      return directMatch;
    }

    const frameElements = [...currentDocument.querySelectorAll("iframe, frame")];
    const activeFrameElement = isFrameElementNode(currentDocument.activeElement)
      ? currentDocument.activeElement
      : null;
    const orderedFrames = activeFrameElement
      ? [activeFrameElement, ...frameElements.filter((frame) => frame !== activeFrameElement)]
      : frameElements;

    for (const frameElement of orderedFrames) {
      let childWindow = null;
      let childDocument = null;

      try {
        childWindow = frameElement.contentWindow;
        childDocument = childWindow?.document;
        if (!childWindow || !childDocument || visited.has(childWindow)) {
          continue;
        }
        void childDocument.querySelectorAll;
      } catch {
        continue;
      }

      visited.add(childWindow);
      const nestedMatch = querySelectorDeep(selector, childWindow, depth + 1, visited);
      if (nestedMatch) {
        return nestedMatch;
      }
    }

    return null;
  }

  function collectQuerySelectorAllDeep(selector, rootWindow = window, depth = 0, results = [], visited = new Set()) {
    if (!selector || depth > 4) {
      return results;
    }

    let currentDocument = null;
    try {
      currentDocument = rootWindow.document;
      void currentDocument?.querySelectorAll;
    } catch {
      return results;
    }

    results.push(...currentDocument.querySelectorAll(selector));

    const frameElements = [...currentDocument.querySelectorAll("iframe, frame")];
    const activeFrameElement = isFrameElementNode(currentDocument.activeElement)
      ? currentDocument.activeElement
      : null;
    const orderedFrames = activeFrameElement
      ? [activeFrameElement, ...frameElements.filter((frame) => frame !== activeFrameElement)]
      : frameElements;

    for (const frameElement of orderedFrames) {
      let childWindow = null;
      let childDocument = null;

      try {
        childWindow = frameElement.contentWindow;
        childDocument = childWindow?.document;
        if (!childWindow || !childDocument || visited.has(childWindow)) {
          continue;
        }
        void childDocument.querySelectorAll;
      } catch {
        continue;
      }

      visited.add(childWindow);
      collectQuerySelectorAllDeep(selector, childWindow, depth + 1, results, visited);
    }

    return results;
  }

  async function tryRecordPendingDropdownChange() {
    if (!recordMode || !pendingDropdownRecord) {
      return false;
    }

    const elapsed = Date.now() - pendingDropdownRecord.startedAt;
    if (elapsed > 5000) {
      pendingDropdownRecord = null;
      return false;
    }

    let trigger = null;
    try {
      trigger = document.querySelector(pendingDropdownRecord.selector);
    } catch {
      pendingDropdownRecord = null;
      return false;
    }

    if (!trigger) {
      pendingDropdownRecord = null;
      return false;
    }

    const nextValue = getElementDisplayValue(trigger);
    if (!nextValue || nextValue === pendingDropdownRecord.beforeValue) {
      return false;
    }

    await recordAction({
      type: "dropdownSelect",
      selector: pendingDropdownRecord.selector,
      value: nextValue,
      label: pendingDropdownRecord.label || getHumanLabel(trigger)
    });

    pendingDropdownRecord = null;
    return true;
  }

  async function monitorPendingDropdownRecord(startedAt) {
    while (recordMode && pendingDropdownRecord?.startedAt === startedAt) {
      const recorded = await tryRecordPendingDropdownChange();
      if (recorded) {
        return true;
      }

      await delay(120);
    }

    return false;
  }

  async function finalizePendingDropdownRecord() {
    await delay(180);
    return await tryRecordPendingDropdownChange();
  }

  function buildNthPathSelector(el) {
    const parts = [];
    let node = el;

    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      const tag = node.tagName.toLowerCase();

      if (node.id) {
        const idSelector = `#${cssEscapeSafe(node.id)}`;
        parts.unshift(idSelector);
        return parts.join(" > ");
      }

      let part = tag;

      const stableClasses = [...node.classList].filter(isStableClassName).slice(0, 3);
      if (stableClasses.length) {
        const classSelector = `${tag}.${stableClasses.map(cssEscapeSafe).join(".")}`;
        if (isUniqueSelector(classSelector)) {
          return classSelector;
        }
        part += `.${stableClasses.map(cssEscapeSafe).join(".")}`;
      }

      if (node.parentElement) {
        const siblings = [...node.parentElement.children].filter(
          (child) => child.tagName === node.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(node) + 1;
          part += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(part);

      const combined = parts.join(" > ");
      if (isUniqueSelector(combined)) {
        return combined;
      }

      node = node.parentElement;
    }

    return parts.join(" > ");
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) {
      return null;
    }

    if (el.id) {
      const selector = `#${cssEscapeSafe(el.id)}`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    const attrCandidates = [
      "name",
      "data-testid",
      "data-test",
      "data-qa",
      "data-role",
      "aria-label",
      "title"
    ];

    const tag = el.tagName.toLowerCase();

    for (const attr of attrCandidates) {
      const value = el.getAttribute(attr);
      if (value) {
        const selector = `${tag}[${attr}="${value.replace(/"/g, '\\"')}"]`;
        if (isUniqueSelector(selector)) {
          return selector;
        }
      }
    }

    const stableClasses = [...el.classList].filter(isStableClassName).slice(0, 3);
    if (stableClasses.length) {
      const selector = `${tag}.${stableClasses.map(cssEscapeSafe).join(".")}`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }

    return buildNthPathSelector(el);
  }

  function ensureOverlay() {
    if (overlayRoot) return;

    overlayRoot = document.createElement("div");
    overlayRoot.style.position = "fixed";
    overlayRoot.style.top = "12px";
    overlayRoot.style.right = "12px";
    overlayRoot.style.zIndex = "2147483647";
    overlayRoot.style.pointerEvents = "none";
    overlayRoot.style.background = "rgba(32, 33, 36, 0.95)";
    overlayRoot.style.color = "#fff";
    overlayRoot.style.padding = "10px 12px";
    overlayRoot.style.borderRadius = "10px";
    overlayRoot.style.fontFamily = "Arial, sans-serif";
    overlayRoot.style.fontSize = "12px";
    overlayRoot.style.lineHeight = "1.45";
    overlayRoot.style.boxShadow = "0 4px 14px rgba(0,0,0,0.25)";
    overlayRoot.style.maxWidth = "320px";

    overlayTitle = document.createElement("div");
    overlayTitle.style.fontWeight = "700";
    overlayTitle.style.marginBottom = "4px";

    overlayBody = document.createElement("div");
    overlayBody.style.opacity = "0.95";

    overlayRoot.appendChild(overlayTitle);
    overlayRoot.appendChild(overlayBody);
    document.documentElement.appendChild(overlayRoot);
  }

  function removeOverlay() {
    if (overlayRoot) {
      overlayRoot.remove();
      overlayRoot = null;
      overlayTitle = null;
      overlayBody = null;
    }
  }

  function postRecordingStateToFrame(iframe, enabled, nextDebugEnabled) {
    try {
      iframe?.contentWindow?.postMessage(
        {
          type: RECORD_STATE_EVENT_TYPE,
          enabled: !!enabled,
          debugEnabled: !!nextDebugEnabled
        },
        "*"
      );
    } catch {
      // same-tab frame state propagation is best-effort
    }
  }

  function postRecordingStateToWindow(targetWindow, enabled, nextDebugEnabled) {
    try {
      targetWindow?.postMessage(
        {
          type: RECORD_STATE_EVENT_TYPE,
          enabled: !!enabled,
          debugEnabled: !!nextDebugEnabled
        },
        "*"
      );
    } catch {
      // same-tab frame state propagation is best-effort
    }
  }

  function broadcastRecordingStateToChildFrames(enabled, nextDebugEnabled) {
    const frames = document.querySelectorAll?.("iframe") || [];
    for (const iframe of frames) {
      postRecordingStateToFrame(iframe, enabled, nextDebugEnabled);
    }
  }

  function notifyParentFrameReady() {
    if (window.top === window || typeof window.parent?.postMessage !== "function") {
      return;
    }

    const payload = {
      type: FRAME_READY_EVENT_TYPE
    };

    try {
      window.parent.postMessage(payload, "*");
      setTimeout(() => {
        try {
          window.parent.postMessage(payload, "*");
        } catch {
          // ignore delayed retry failure
        }
      }, 150);
    } catch {
      // ignore parent notify failure
    }
  }

  function setOverlay(title, body = "") {
    ensureOverlay();
    overlayTitle.textContent = title;
    overlayBody.textContent = body;
  }

  function getRecordedKeyName(step) {
    if (
      step?.type === "key" ||
      step?.code === "Space" ||
      step?.key === " " ||
      step?.key === "Spacebar"
    ) {
      return "스페이스바";
    }

    const normalized = String(step?.key || step?.code || "").trim();
    return normalized || "알 수 없는 키";
  }

  function showRecordedMessage(step) {
    if (!step) return;

    if (step.type === "click") {
      setOverlay("매크로 기록 중", `클릭 기록: ${step.label || step.selector}`);
    } else if (step.type === "key") {
      setOverlay(
        "매크로 기록 중",
        `키 입력 기록: ${step.label || step.selector} (${getRecordedKeyName(step)})`
      );
    } else if (step.type === "input") {
      setOverlay("매크로 기록 중", `입력 기록: ${step.label || step.selector}`);
    } else if (step.type === "select") {
      setOverlay("매크로 기록 중", `선택 기록: ${step.label || step.selector}`);
    } else if (step.type === "dropdownSelect") {
      setOverlay("매크로 기록 중", `드롭다운 선택 기록: ${step.label || step.selector}`);
    } else if (step.type === "wait") {
      setOverlay("매크로 기록 중", `대기 기록: ${step.ms}ms`);
    }
  }

  function applyRecordingState(enabled, nextDebugEnabled, options = {}) {
    const shouldPropagate = options.propagate !== false;

    recordMode = !!enabled;
    debugMode = !!nextDebugEnabled;
    lastRecordedAt = null;
    pendingDropdownRecord = null;
    pendingKeyClickSuppression = null;

    if (recordMode) {
      startRecordingFrameObserver();
      setOverlay("매크로 기록 중", "페이지에서 버튼을 클릭하거나 값을 입력하세요.");
    } else {
      stopRecordingFrameObserver();
      removeOverlay();
    }

    if (shouldPropagate) {
      broadcastRecordingStateToChildFrames(recordMode, debugMode);
    }
  }

  function stopRecordingFrameObserver() {
    if (recordingFrameRefreshTimer) {
      clearTimeout(recordingFrameRefreshTimer);
      recordingFrameRefreshTimer = null;
    }

    if (recordingFrameObserver) {
      recordingFrameObserver.disconnect();
      recordingFrameObserver = null;
    }
  }

  function scheduleRecordingFrameRefresh(reason = "iframe") {
    if (!recordMode) return;

    if (recordingFrameRefreshTimer) {
      clearTimeout(recordingFrameRefreshTimer);
    }

    recordingFrameRefreshTimer = setTimeout(async () => {
      recordingFrameRefreshTimer = null;

      try {
        await chrome.runtime.sendMessage({
          type: "REFRESH_RECORDING_FRAMES",
          reason
        });
      } catch {
        // same-tab iframe rebinding is best-effort during recording
      }
    }, 120);
  }

  function bindRecordingFrame(iframe) {
    if (!isElementNode(iframe)) return;
    if (iframe.tagName !== "IFRAME") return;
    if (observedRecordingFrames.has(iframe)) return;

    observedRecordingFrames.add(iframe);
    iframe.addEventListener(
      "load",
      () => {
        if (recordMode) {
          postRecordingStateToFrame(iframe, true, debugMode);
        }
        scheduleRecordingFrameRefresh("iframe-load");
      },
      true
    );
  }

  function bindRecordingFramesWithin(node) {
    if (!isElementNode(node)) return false;

    let found = false;

    if (node.tagName === "IFRAME") {
      bindRecordingFrame(node);
      found = true;
    }

    const descendants = node.querySelectorAll?.("iframe") || [];
    for (const iframe of descendants) {
      bindRecordingFrame(iframe);
      found = true;
    }

    return found;
  }

  function startRecordingFrameObserver() {
    if (recordingFrameObserver || typeof MutationObserver !== "function") {
      return;
    }

    const root = document.documentElement || document.body;
    if (!isElementNode(root)) {
      return;
    }

    bindRecordingFramesWithin(root);

    recordingFrameObserver = new MutationObserver((mutations) => {
      if (!recordMode) return;

      let foundFrame = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (!isElementNode(node)) continue;

          if (bindRecordingFramesWithin(node)) {
            foundFrame = true;
          }
        }
      }

      if (foundFrame) {
        scheduleRecordingFrameRefresh("iframe-added");
      }
    });

    recordingFrameObserver.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function isRetryableRuntimeMessageError(error) {
    const message = String(error?.message || error || "");
    return (
      message.includes("message channel closed before a response was received") ||
      message.includes("Could not establish connection") ||
      message.includes("Receiving end does not exist")
    );
  }

  if (typeof window.addEventListener === "function") {
    window.addEventListener(
      "message",
      (event) => {
        if (event?.data?.type === FRAME_READY_EVENT_TYPE) {
          if (recordMode) {
            postRecordingStateToWindow(event.source, recordMode, debugMode);
          }
          return;
        }

        if (event?.data?.type !== RECORD_STATE_EVENT_TYPE) {
          return;
        }

        applyRecordingState(!!event.data.enabled, !!event.data.debugEnabled);
      },
      true
    );
  }

  notifyParentFrameReady();

  function sanitizeRecordedStep(step) {
    if (!step || typeof step !== "object" || !step.type) {
      return null;
    }

    const clean = {
      type: String(step.type)
    };

    if (typeof step.selector === "string") clean.selector = step.selector;
    if (typeof step.value === "string") clean.value = step.value;
    if (typeof step.label === "string") clean.label = step.label;
    if (typeof step.key === "string") clean.key = step.key;
    if (typeof step.code === "string") clean.code = step.code;
    if (typeof step.timeout === "number") clean.timeout = step.timeout;
    if (typeof step.interval === "number") clean.interval = step.interval;
    if (typeof step.ms === "number") clean.ms = step.ms;
    if (typeof step.urlIncludes === "string") clean.urlIncludes = step.urlIncludes;

    return clean;
  }

  function sanitizeRecordedSteps(steps) {
    return Array.isArray(steps) ? steps.map(sanitizeRecordedStep).filter(Boolean) : [];
  }

  function hasMatchingTail(currentSteps, appendedSteps) {
    if (!Array.isArray(currentSteps) || !Array.isArray(appendedSteps)) {
      return false;
    }

    if (!appendedSteps.length || appendedSteps.length > currentSteps.length) {
      return false;
    }

    const offset = currentSteps.length - appendedSteps.length;

    for (let i = 0; i < appendedSteps.length; i += 1) {
      if (JSON.stringify(currentSteps[offset + i]) !== JSON.stringify(appendedSteps[i])) {
        return false;
      }
    }

    return true;
  }

  async function appendRecordedStepsDirectly(steps, options = {}) {
    const sanitized = sanitizeRecordedSteps(steps);
    if (!sanitized.length) return [];

    const data = await chrome.storage.local.get([STEPS_KEY, RECORDING_KEY]);
    const currentSteps = Array.isArray(data[STEPS_KEY]) ? data[STEPS_KEY] : [];
    const recording =
      data[RECORDING_KEY] && typeof data[RECORDING_KEY] === "object" ? data[RECORDING_KEY] : {};

    if (hasMatchingTail(currentSteps, sanitized)) {
      return currentSteps;
    }

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
    const startsWithWait = sanitized[0]?.type === "wait";

    if (recording.enabled && previousRecordedAt > 0 && hasRecordedAction && !startsWithWait) {
      const gap = roundDelay(recordedAt - previousRecordedAt);
      if (gap > 0) {
        nextSteps.push({
          type: "wait",
          ms: gap
        });
      }
    }

    nextSteps.push(...sanitized);

    const nextRecording =
      recording.enabled && hasRecordedAction
        ? {
            ...recording,
            lastRecordedAt: recordedAt
          }
        : null;

    await chrome.storage.local.set(
      nextRecording
        ? {
            [STEPS_KEY]: nextSteps,
            [RECORDING_KEY]: nextRecording
          }
        : {
            [STEPS_KEY]: nextSteps
          }
    );

    return nextSteps;
  }

  async function persistRecordedSteps(steps, options = {}) {
    const sanitized = sanitizeRecordedSteps(steps);
    if (!sanitized.length) return [];

    try {
      const response = await chrome.runtime.sendMessage({
        type: "APPEND_STEPS",
        steps: sanitized,
        recordedAt:
          typeof options.recordedAt === "number" && Number.isFinite(options.recordedAt)
            ? options.recordedAt
            : Date.now()
      });

      if (!response?.ok) {
        throw new Error(response?.message || "step 저장 실패");
      }

      return Array.isArray(response.steps) ? response.steps : sanitized;
    } catch (error) {
      if (!isRetryableRuntimeMessageError(error)) {
        throw error;
      }

      return await appendRecordedStepsDirectly(sanitized, options);
    }
  }

  async function recordAction(step) {
    if (!recordMode || !step) return;

    const now = Date.now();
    const stepsToAppend = [];

    if (lastRecordedAt !== null) {
      const gap = roundDelay(now - lastRecordedAt);
      if (gap > 0) {
        stepsToAppend.push({
          type: "wait",
          ms: gap
        });
      }
    }

    stepsToAppend.push(step);
    await persistRecordedSteps(stepsToAppend, {
      recordedAt: now
    });
    lastRecordedAt = now;

    appendDebugLog({
      source: "content:record",
      eventType: "record",
      note: describeDebugStep(step),
      recordedStep: step
    });

    showRecordedMessage(step);
  }

  function describeDebugStep(step) {
    if (!step || !step.type) return "";

    if (step.type === "click") {
      return `click ${step.selector || ""}`.trim();
    }
    if (step.type === "key") {
      return `key ${step.selector || ""} ${getRecordedKeyName(step)}`.trim();
    }
    if (step.type === "input" || step.type === "select" || step.type === "dropdownSelect") {
      return `${step.type} ${step.selector || ""} ${String(step.value ?? "")}`.trim();
    }
    if (step.type === "wait") {
      return `wait ${step.ms || 0}`;
    }

    return step.type;
  }

  function findCheckboxLikeWrapper(el) {
    if (!isElementNode(el)) return null;

    const wrapper = el.closest(
      ".PUDD-UI-checkbox, .PUDDCheckBoxWrap, label, [role='checkbox'], [role='radio'], [aria-checked]"
    );
    if (wrapper) return wrapper;

    const checkboxInput = el.closest(
      "input.PUDDCheckBox, input[type='checkbox'], input[type='radio']"
    );
    if (!checkboxInput) return null;

    const directParent = checkboxInput.parentElement;
    if (
      directParent &&
      directParent.matches(
        ".PUDD-UI-checkbox, .PUDDCheckBoxWrap, label, [role='checkbox'], [role='radio'], [aria-checked]"
      )
    ) {
      return directParent;
    }

    return directParent || checkboxInput;
  }

  function hasButtonLikeClassName(el) {
    const className = typeof el?.className === "string" ? el.className.toLowerCase() : "";
    if (!className) return false;

    return className
      .split(/\s+/)
      .filter(Boolean)
      .some((token) => /(^|[-_])(btn|button)([-_]|$)/.test(token));
  }

  function isButtonLikeElement(el) {
    if (!isElementNode(el)) return false;

    if (
      el.matches(
        "button, [role='button'], a, input[type='button'], input[type='submit'], input[type='reset'], [onclick]"
      )
    ) {
      return true;
    }

    return hasButtonLikeClassName(el);
  }

  function findMatchingButtonLikeTarget(expectedLabel, referenceEl) {
    const seen = new Set();
    let best = null;
    let bestScore = -1;
    const searchDocument = isElementNode(referenceEl) ? getElementDocument(referenceEl) : document;

    for (const node of searchDocument.querySelectorAll(BUTTON_LIKE_CANDIDATE_SELECTOR)) {
      const candidate = getClickableTarget(node);
      if (!isElementNode(candidate)) continue;
      if (!isButtonLikeElement(candidate)) continue;
      if (!isVisible(candidate)) continue;
      if (seen.has(candidate)) continue;
      seen.add(candidate);

      const labelScore = getLabelMatchScore(getHumanLabel(candidate), expectedLabel);
      if (labelScore < 0) continue;

      let score = labelScore;
      if (isElementNode(referenceEl)) {
        if (candidate.tagName === referenceEl.tagName) {
          score += 30;
        }

        const candidateType = candidate.getAttribute("type") || "";
        const referenceType = referenceEl.getAttribute("type") || "";
        if (candidateType && candidateType === referenceType) {
          score += 20;
        }

        score += getClassOverlapScore(candidate, referenceEl);

        const distance = getDomDistance(candidate, referenceEl);
        if (Number.isFinite(distance)) {
          score += Math.max(0, 25 - Math.min(distance, 25));
        }
      }

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  function findOptionLikeClickTarget(rawTarget) {
    if (!isElementNode(rawTarget)) return null;

    const optionTarget = rawTarget.closest(
      "[role='option'], [role='treeitem'], [role='menuitem'], a.anchor, a[role='option']"
    );
    if (optionTarget) {
      return optionTarget;
    }

    const listItem = rawTarget.closest("li");
    if (!listItem) return null;

    const listContainer = listItem.closest(
      "[role='listbox'], [role='tree'], [role='menu'], .multi_sel_list, .signLineSel_list, .kl_sel, .dropdown-menu"
    );
    if (!listContainer) return null;

    const explicitChild = rawTarget.closest("span, strong, em, div");
    if (explicitChild && listItem.contains(explicitChild)) {
      return explicitChild;
    }

    return listItem;
  }

  function getClickableTarget(rawTarget) {
    if (!isElementNode(rawTarget)) return null;

    const checkboxWrapper = findCheckboxLikeWrapper(rawTarget);
    if (checkboxWrapper) {
      return checkboxWrapper;
    }

    const optionTarget = findOptionLikeClickTarget(rawTarget);
    if (optionTarget) {
      return optionTarget;
    }

    let node = rawTarget;
    const rootElement = getElementRoot(rawTarget);
    while (node && node !== rootElement) {
      if (isButtonLikeElement(node)) {
        return node;
      }
      node = node.parentElement;
    }

    return null;
  }

  function getInputTarget(rawTarget) {
    if (!isElementNode(rawTarget)) return null;

    const el = rawTarget.closest("input, textarea, select");
    if (!el) return null;

    if (el.tagName === "SELECT") return el;

    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "file"].includes(type)) {
      return null;
    }

    if (["button", "submit", "reset", "checkbox", "radio"].includes(type)) {
      return null;
    }

    return el;
  }

  function isTextEntryTarget(el) {
    if (!isElementNode(el)) return false;

    if (el.tagName === "TEXTAREA") {
      return true;
    }

    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ![
        "button",
        "submit",
        "reset",
        "checkbox",
        "radio",
        "range",
        "color",
        "file",
        "hidden",
        "image"
      ].includes(type);
    }

    return !!el.isContentEditable;
  }

  function isKeyboardActionCandidate(el) {
    if (!isElementNode(el)) return false;
    if (isTextEntryTarget(el)) return false;

    if (findCheckboxLikeWrapper(el)) {
      return true;
    }

    if (isButtonLikeElement(el) || isDropdownLikeElement(el)) {
      return true;
    }

    return el.matches(
      "summary, [role='button'], [role='checkbox'], [role='radio'], [role='menuitem'], [role='option']"
    );
  }

  function getKeyboardTarget(rawTarget) {
    if (!isElementNode(rawTarget)) return null;

    if (isTextEntryTarget(rawTarget)) {
      return null;
    }

    const clickableTarget = getClickableTarget(rawTarget);
    if (isKeyboardActionCandidate(clickableTarget)) {
      return clickableTarget;
    }

    const dropdownTarget = getDropdownTriggerTarget(rawTarget);
    if (isKeyboardActionCandidate(dropdownTarget)) {
      return dropdownTarget;
    }

    const focusable = rawTarget.closest(
      "button, a, input, select, textarea, summary, [tabindex], [contenteditable='true'], [role='button'], [role='checkbox'], [role='radio'], [role='menuitem'], [role='option']"
    );
    if (isKeyboardActionCandidate(focusable)) {
      return focusable;
    }

    return isKeyboardActionCandidate(rawTarget) ? rawTarget : null;
  }

  function isSpacebarEvent(event) {
    if (!event) return false;

    return (
      event.code === "Space" ||
      event.key === " " ||
      event.key === "Spacebar" ||
      String(event.key || "").toLowerCase() === "space"
    );
  }

  function shouldRecordSpacebarEvent(event) {
    if (!recordMode || !isSpacebarEvent(event)) {
      return false;
    }

    if (event.repeat) return false;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return false;
    }

    return true;
  }

  function rememberKeyClickSuppression(selector) {
    if (!selector) return;

    pendingKeyClickSuppression = {
      selector,
      expiresAt: Date.now() + 800
    };
  }

  function shouldSuppressKeyTriggeredClick(rawTarget, event) {
    if (!pendingKeyClickSuppression) {
      return false;
    }

    if (Date.now() > pendingKeyClickSuppression.expiresAt) {
      pendingKeyClickSuppression = null;
      return false;
    }

    if (event?.detail > 0) {
      return false;
    }

    const target =
      findCheckboxLikeWrapper(rawTarget) || getClickableTarget(rawTarget) || getKeyboardTarget(rawTarget);
    const selector = safeBuildSelector(target);
    if (!selector || selector !== pendingKeyClickSuppression.selector) {
      return false;
    }

    pendingKeyClickSuppression = null;
    return true;
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!recordMode) return;
      logDebugEvent("pointerdown", event.target);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (event) => {
      if (!recordMode) return;
      logDebugEvent("mousedown", event.target);
    },
    true
  );

  document.addEventListener(
    "mouseup",
    (event) => {
      if (!recordMode) return;
      logDebugEvent("mouseup", event.target);
    },
    true
  );

  document.addEventListener(
    "keydown",
    async (event) => {
      if (!recordMode) return;

      logDebugEvent("keydown", event.target, {
        note: `${event.code || ""} ${getRecordedKeyName(event)}`.trim()
      });

      if (!shouldRecordSpacebarEvent(event)) {
        return;
      }

      const target = getKeyboardTarget(event.target);
      if (!target) return;

      const selector = buildSelector(target);
      if (!selector) return;

      rememberKeyClickSuppression(selector);
      try {
        await recordAction({
          type: "key",
          selector,
          key: " ",
          code: "Space",
          label: getHumanLabel(target)
        });
      } catch (error) {
        if (pendingKeyClickSuppression?.selector === selector) {
          pendingKeyClickSuppression = null;
        }
        throw error;
      }
    },
    true
  );

  document.addEventListener(
    "click",
    async (event) => {
      if (!recordMode) return;

      logDebugEvent("click", event.target);

      if (shouldSuppressKeyTriggeredClick(event.target, event)) {
        return;
      }

      const checkboxWrapper = findCheckboxLikeWrapper(event.target);
      if (checkboxWrapper) {
        const selector = buildSelector(checkboxWrapper);
        if (!selector) return;

        await recordAction({
          type: "click",
          selector,
          label: getHumanLabel(checkboxWrapper)
        });
        return;
      }

      if (pendingDropdownRecord) {
        const recorded = await finalizePendingDropdownRecord();
        if (recorded) {
          return;
        }
      }

      const el = getClickableTarget(event.target);
      const dropdownTrigger = getDropdownTriggerTarget(event.target);
      const shouldRecordClickBeforeDropdown =
        !!el &&
        !!dropdownTrigger &&
        el !== dropdownTrigger &&
        isButtonLikeElement(el) &&
        !isDropdownLikeElement(el);

      if (shouldRecordClickBeforeDropdown) {
        const selector = buildSelector(el);
        if (selector) {
          await recordAction({
            type: "click",
            selector,
            label: getHumanLabel(el)
          });
        }

        rememberDropdownRecord(dropdownTrigger);
        return;
      }

      if (dropdownTrigger) {
        rememberDropdownRecord(dropdownTrigger);
        return;
      }

      if (!el) return;

      const selector = buildSelector(el);
      if (!selector) return;

      await recordAction({
        type: "click",
        selector,
        label: getHumanLabel(el)
      });
    },
    true
  );

  document.addEventListener(
    "change",
    async (event) => {
      if (!recordMode) return;

      logDebugEvent("change", event.target);

      if (pendingDropdownRecord) {
        await finalizePendingDropdownRecord();
      }

      const el = getInputTarget(event.target);
      if (!el) return;

      const selector = buildSelector(el);
      if (!selector) return;

      if (el.tagName === "SELECT") {
        await recordAction({
          type: "select",
          selector,
          value: el.value,
          label: getHumanLabel(el)
        });
        return;
      }

      await recordAction({
        type: "input",
        selector,
        value: String(el.value ?? ""),
        label: getHumanLabel(el)
      });
    },
    true
  );

  async function waitForElement(selector, timeout = 10000, interval = 200) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      const el = querySelectorDeep(selector);
      if (el) return el;
      await delay(interval);
    }

    throw new Error(`요소를 찾지 못했습니다: ${selector}`);
  }

  function requiresVisibleOptionTarget(el) {
    if (!isElementNode(el)) return false;

    return findOptionLikeClickTarget(el) === el;
  }

  function isVisible(el) {
    if (!isElementNode(el)) return false;

    const rect = el.getBoundingClientRect();
    const style = getElementWindow(el).getComputedStyle(el);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  async function ensureVisible(selector, timeout = 10000) {
    const el = await waitForElement(selector, timeout, 200);

    el.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(250);

    if (!isVisible(el)) {
      throw new Error(`요소가 보이지 않습니다: ${selector}`);
    }

    return el;
  }

  function resolveVisibleClickTarget(el) {
    if (!el) return null;
    if (isVisible(el)) return el;

    const checkboxWrapper = findCheckboxLikeWrapper(el);
    if (checkboxWrapper && isVisible(checkboxWrapper)) {
      return checkboxWrapper;
    }

    let parent = el.parentElement;
    while (parent) {
      if (isVisible(parent)) {
        return parent;
      }
      parent = parent.parentElement;
    }

    return null;
  }

  function getPreferredClickTarget(step, raw) {
    if (!isElementNode(raw)) return null;

    if (isCheckboxLikeElement(raw)) {
      return raw;
    }

    if (requiresVisibleOptionTarget(raw) && !isVisible(raw)) {
      return null;
    }

    const resolved = resolveVisibleClickTarget(raw);
    if (!resolved) {
      return null;
    }

    if (!isMeaningfulStepLabel(step?.label)) {
      return raw;
    }

    if (hasMatchingLabel(raw, step.label) || hasMatchingLabel(resolved, step.label)) {
      return raw;
    }

    return findMatchingButtonLikeTarget(step.label, resolved);
  }

  async function waitForClickTarget(step, timeout = 10000, interval = 200) {
    const startedAt = Date.now();
    let lastFound = null;

    while (Date.now() - startedAt < timeout) {
      const raw = querySelectorDeep(step.selector);
      if (raw) {
        lastFound = raw;
        const preferred = getPreferredClickTarget(step, raw);
        if (preferred) {
          return preferred;
        }
      }

      await delay(interval);
    }

    if (lastFound) {
      if (requiresVisibleOptionTarget(lastFound) && !isVisible(lastFound)) {
        throw new Error(`요소가 보이지 않습니다: ${step.selector}`);
      }

      if (isMeaningfulStepLabel(step?.label)) {
        throw new Error(`라벨과 일치하는 클릭 대상을 찾지 못했습니다: ${step.label}`);
      }
    }

    throw new Error(`요소를 찾지 못했습니다: ${step.selector}`);
  }

  function fireMouseSequence(el) {
    el.dispatchEvent(createMouseEventForElement(el, "mouseover"));
    el.dispatchEvent(createMouseEventForElement(el, "mousedown"));
    el.dispatchEvent(createMouseEventForElement(el, "mouseup"));

    if (typeof el.click === "function") {
      el.click();
      return;
    }

    el.dispatchEvent(createMouseEventForElement(el, "click"));
  }

  function isNativeDirectClickElement(el) {
    if (!isElementNode(el)) return false;

    return el.matches("button, input[type='button'], input[type='submit'], input[type='reset']");
  }

  function prefersDirectClick(el) {
    return isNativeDirectClickElement(el);
  }

  function prefersMainWorldDirectClick(el) {
    if (!isNativeDirectClickElement(el)) {
      return false;
    }

    return el.hasAttribute("onclick");
  }

  async function clickInMainWorld(step, el) {
    const selector = safeBuildSelector(el) || step?.selector;
    if (!selector) {
      return false;
    }

    const response = await chrome.runtime.sendMessage({
      type: "EXECUTE_MAIN_WORLD_CLICK",
      selector
    });

    if (!response?.ok) {
      throw new Error(response?.message || `요소를 클릭하지 못했습니다: ${selector}`);
    }

    return true;
  }

  function isCheckboxLikeElement(el) {
    if (!isElementNode(el)) return false;

    return (
      el.matches(
        ".PUDD-UI-checkbox, .PUDDCheckBoxWrap, label, [role='checkbox'], [role='radio'], [aria-checked]"
      ) ||
      !!el.querySelector(
        "input.PUDDCheckBox, input[type='checkbox'], input[type='radio']"
      )
    );
  }

  function getCheckboxExecutionTarget(el) {
    if (!isElementNode(el)) return null;

    const wrapper = el.matches(
      ".PUDD-UI-checkbox, .PUDDCheckBoxWrap, label, [role='checkbox'], [role='radio'], [aria-checked]"
    )
      ? el
      : el.closest(
          ".PUDD-UI-checkbox, .PUDDCheckBoxWrap, label, [role='checkbox'], [role='radio'], [aria-checked]"
        );

    if (!wrapper) return null;

    const input = wrapper.querySelector(
      "input.PUDDCheckBox, input[type='checkbox'], input[type='radio']"
    );
    const svg = wrapper.querySelector("svg");

    return { wrapper, input, svg };
  }

  async function clickCheckboxLike(el, step) {
    const target = getCheckboxExecutionTarget(el);
    if (!target || !target.wrapper) {
      throw new Error(`체크박스 래퍼를 찾지 못했습니다: ${step.selector}`);
    }

    const { wrapper, input, svg } = target;

    wrapper.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(250);

    if (input) {
      const before = !!input.checked;

      input.focus?.();
      input.click();
      input.dispatchEvent(createUiEvent(input, "input", { bubbles: true }));
      input.dispatchEvent(createUiEvent(input, "change", { bubbles: true }));

      await delay(120);

      if (!!input.checked !== before) {
        return;
      }
    }

    if (svg && isVisible(svg)) {
      svg.focus?.();
      fireMouseSequence(svg);
      await delay(120);
      return;
    }

    if (isVisible(wrapper)) {
      wrapper.focus?.();
      fireMouseSequence(wrapper);
      await delay(120);
      return;
    }

    throw new Error(`체크박스를 클릭하지 못했습니다: ${step.selector}`);
  }

  function getKeyboardExecutionTarget(el) {
    if (!isElementNode(el)) return null;

    const checkboxTarget = getCheckboxExecutionTarget(el);
    if (checkboxTarget?.input) {
      return checkboxTarget.input;
    }

    return resolveVisibleClickTarget(el) || el;
  }

  function createKeyboardEvent(type, step, targetWindow = window) {
    const key =
      step?.type === "key" || step?.key === " " || step?.code === "Space"
        ? " "
        : String(step?.key || "");
    const code = step?.code || (key === " " ? "Space" : "");
    const keyCode = code === "Space" ? 32 : 0;
    const KeyboardEventCtor = targetWindow?.KeyboardEvent || KeyboardEvent;

    return new KeyboardEventCtor(type, {
      key,
      code,
      keyCode,
      charCode: type === "keypress" ? keyCode : 0,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true
    });
  }

  function dispatchKeySequence(el, step) {
    const targetWindow = getElementWindow(el);
    const keydownAllowed = el.dispatchEvent(createKeyboardEvent("keydown", step, targetWindow));
    const keypressAllowed = el.dispatchEvent(createKeyboardEvent("keypress", step, targetWindow));
    const keyupAllowed = el.dispatchEvent(createKeyboardEvent("keyup", step, targetWindow));

    return {
      keydownAllowed,
      keypressAllowed,
      keyupAllowed
    };
  }

  function isNativeSpaceActivatableElement(el) {
    if (!isElementNode(el)) return false;

    return el.matches(
      "button, summary, input[type='button'], input[type='submit'], input[type='reset'], input[type='checkbox'], input[type='radio']"
    );
  }

  function setInputValue(el, value) {
    const targetWindow = getElementWindow(el);
    const proto =
      el.tagName === "TEXTAREA"
        ? targetWindow.HTMLTextAreaElement?.prototype || HTMLTextAreaElement.prototype
        : targetWindow.HTMLInputElement?.prototype || HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function setSelectValue(el, value) {
    const targetWindow = getElementWindow(el);
    const descriptor = Object.getOwnPropertyDescriptor(
      targetWindow.HTMLSelectElement?.prototype || HTMLSelectElement.prototype,
      "value"
    );
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function isDropdownOptionCandidate(el) {
    if (!isElementNode(el)) return false;

    if (
      el.matches(
        "[role='option'], [role='treeitem'], [role='menuitem'], li, button, a, td, div, span"
      )
    ) {
      return true;
    }

    return hasDropdownLikeClassName(el);
  }

  function extractChangedValueFragment(beforeValue, afterValue) {
    const before = normalizeText(beforeValue);
    const after = normalizeText(afterValue);

    if (!after || before === after) {
      return "";
    }

    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) {
      start += 1;
    }

    let beforeEnd = before.length - 1;
    let afterEnd = after.length - 1;
    while (beforeEnd >= start && afterEnd >= start && before[beforeEnd] === after[afterEnd]) {
      beforeEnd -= 1;
      afterEnd -= 1;
    }

    return after
      .slice(start, afterEnd + 1)
      .replace(/^[:\-\s]+|[:\-\s]+$/g, "")
      .trim();
  }

  function getDropdownOptionQueries(beforeValue, targetValue) {
    const normalizedTarget = normalizeText(targetValue);
    const queries = [];

    if (normalizedTarget) {
      queries.push(normalizedTarget);
    }

    const changedFragment = extractChangedValueFragment(beforeValue, normalizedTarget);
    if (changedFragment && !queries.includes(changedFragment)) {
      queries.push(changedFragment);
    }

    const colonFragment = normalizedTarget.split(":").pop()?.trim();
    if (colonFragment && !queries.includes(colonFragment)) {
      queries.push(colonFragment);
    }

    return queries;
  }

  function scoreDropdownOptionCandidate(el, expected) {
    if (!isElementNode(el)) return -1;
    if (!isVisible(el)) return -1;

    const text = normalizeText(el.innerText || el.textContent || "");
    if (!text) return -1;

    const expectedTexts = (Array.isArray(expected) ? expected : [expected])
      .map((value) => normalizeText(value))
      .filter(Boolean);
    if (!expectedTexts.length) return -1;

    let matchedExpected = "";
    for (const candidate of expectedTexts) {
      if (text === candidate || text.includes(candidate)) {
        matchedExpected = candidate;
        break;
      }
    }

    if (!matchedExpected) {
      return -1;
    }

    let score = 0;

    if (text === matchedExpected) score += 100;
    if (el.matches("[role='option'], [role='treeitem'], [role='menuitem']")) score += 40;
    if (el.closest("[role='listbox'], [role='tree'], [role='menu']")) score += 30;
    if (el.matches("li, button, a")) score += 20;
    if (hasDropdownLikeClassName(el) || hasDropdownLikeClassName(el.parentElement)) score += 10;

    return score;
  }

  async function waitForDropdownOption(value, timeout = 10000, interval = 200) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      const candidates = collectQuerySelectorAllDeep("body *");
      let best = null;
      let bestScore = -1;

      for (const candidate of candidates) {
        if (!isDropdownOptionCandidate(candidate)) continue;
        const score = scoreDropdownOptionCandidate(candidate, value);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }

      if (best && bestScore >= 0) {
        return best;
      }

      await delay(interval);
    }

    throw new Error(`드롭다운 옵션을 찾지 못했습니다: ${value}`);
  }

  async function doDropdownSelect(step) {
    const raw = await waitForElement(step.selector, step.timeout || 10000);
    const trigger = resolveVisibleClickTarget(raw) || getDropdownTriggerTarget(raw) || raw;

    if (!trigger) {
      throw new Error(`드롭다운 트리거를 찾지 못했습니다: ${step.selector}`);
    }

    const beforeValue = getElementDisplayValue(trigger);
    if (beforeValue && normalizeText(step.value) && beforeValue.includes(normalizeText(step.value))) {
      return;
    }

    const optionQueries = getDropdownOptionQueries(beforeValue, step.value ?? "");

    trigger.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(200);
    trigger.focus?.();
    fireMouseSequence(trigger);
    await delay(250);

    let option = null;
    try {
      option = await waitForDropdownOption(optionQueries, 1200, 200);
    } catch {
      const alternateTrigger = findNearbyButtonLikeTarget(trigger);
      if (!alternateTrigger) {
        throw new Error(`드롭다운 옵션을 찾지 못했습니다: ${step.value}`);
      }

      alternateTrigger.scrollIntoView({
        block: "center",
        inline: "center"
      });

      await delay(120);
      alternateTrigger.focus?.();
      fireMouseSequence(alternateTrigger);
      await delay(250);
      option = await waitForDropdownOption(optionQueries, step.timeout || 10000, 200);
    }

    option.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(120);
    option.focus?.();
    fireMouseSequence(option);
    await delay(250);

    const nextValue = getElementDisplayValue(trigger);
    if (nextValue && normalizeText(step.value) && nextValue.includes(normalizeText(step.value))) {
      return;
    }

    if (beforeValue !== nextValue) {
      return;
    }

    throw new Error(`드롭다운 값이 변경되지 않았습니다: ${step.value}`);
  }

  async function doClick(step) {
    const raw = await waitForClickTarget(step, step.timeout || 10000, 200);

    if (isCheckboxLikeElement(raw)) {
      await appendRunTraceLog({
        eventType: "click-dispatch",
        stepType: step.type,
        message: "체크박스형 요소 클릭",
        step,
        detail: {
          target: summarizeTraceElement(raw),
          selectorTrace: collectSelectorTrace(step.selector)
        }
      });
      await clickCheckboxLike(raw, step);
      return;
    }

    const el = resolveVisibleClickTarget(raw);
    if (!el) {
      throw new Error(`요소가 보이지 않습니다: ${step.selector}`);
    }

    el.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(250);

    if (getElementDocument(el) === document && prefersMainWorldDirectClick(el) && typeof el.click === "function") {
      await appendRunTraceLog({
        eventType: "click-dispatch",
        stepType: step.type,
        message: "main world direct click 사용",
        step,
        detail: {
          rawTarget: summarizeTraceElement(raw),
          resolvedTarget: summarizeTraceElement(el),
          selectorTrace: collectSelectorTrace(step.selector),
          method: "main-world-click"
        }
      });
      const clickedInMainWorld = await clickInMainWorld(step, el);
      if (clickedInMainWorld) {
        return;
      }
    }

    el.focus?.();

    if (prefersDirectClick(el) && typeof el.click === "function") {
      await appendRunTraceLog({
        eventType: "click-dispatch",
        stepType: step.type,
        message: "직접 click() 사용",
        step,
        detail: {
          rawTarget: summarizeTraceElement(raw),
          resolvedTarget: summarizeTraceElement(el),
          selectorTrace: collectSelectorTrace(step.selector),
          method: "element.click"
        }
      });
      el.click();
      return;
    }

    await appendRunTraceLog({
      eventType: "click-dispatch",
      stepType: step.type,
      message: "합성 마우스 시퀀스 사용",
      step,
      detail: {
        rawTarget: summarizeTraceElement(raw),
        resolvedTarget: summarizeTraceElement(el),
        selectorTrace: collectSelectorTrace(step.selector),
        method: "mouse-sequence"
      }
    });
    fireMouseSequence(el);
  }

  async function doKey(step) {
    const raw = await waitForElement(step.selector, step.timeout || 10000, 200);
    const visibleTarget = resolveVisibleClickTarget(raw) || raw;
    if (!visibleTarget || !isVisible(visibleTarget)) {
      throw new Error(`요소가 보이지 않습니다: ${step.selector}`);
    }

    const focusTarget = getKeyboardExecutionTarget(raw);
    if (!focusTarget) {
      throw new Error(`키 입력 대상을 찾지 못했습니다: ${step.selector}`);
    }

    const checkboxTarget = getCheckboxExecutionTarget(raw);
    const beforeChecked =
      checkboxTarget?.input && "checked" in checkboxTarget.input ? !!checkboxTarget.input.checked : null;

    visibleTarget.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(250);
    focusTarget.focus?.();

    const result = dispatchKeySequence(focusTarget, step);

    if (beforeChecked !== null && checkboxTarget?.input) {
      await delay(120);
      if (!!checkboxTarget.input.checked !== beforeChecked) {
        return;
      }
    }

    if (
      isSpacebarEvent(step) &&
      result.keydownAllowed &&
      result.keypressAllowed &&
      result.keyupAllowed &&
      isNativeSpaceActivatableElement(focusTarget)
    ) {
      if (checkboxTarget?.wrapper) {
        await clickCheckboxLike(raw, step);
        return;
      }

      if (typeof focusTarget.click === "function") {
        focusTarget.click();
        await delay(120);
      }
    }
  }

  async function doInput(step) {
    const el = await ensureVisible(step.selector, step.timeout || 10000);

    if (!("value" in el)) {
      throw new Error(`입력 가능한 요소가 아닙니다: ${step.selector}`);
    }

    el.focus?.();
    setInputValue(el, step.value ?? "");
    el.dispatchEvent(createUiEvent(el, "input", { bubbles: true }));
    el.dispatchEvent(createUiEvent(el, "change", { bubbles: true }));
    await delay(200);
  }

  async function doSelect(step) {
    const el = await ensureVisible(step.selector, step.timeout || 10000);

    if (el.tagName !== "SELECT") {
      throw new Error(`select 요소가 아닙니다: ${step.selector}`);
    }

    el.focus?.();
    setSelectValue(el, step.value ?? "");
    el.dispatchEvent(createUiEvent(el, "input", { bubbles: true }));
    el.dispatchEvent(createUiEvent(el, "change", { bubbles: true }));
    await delay(200);
  }

  async function doWait(step) {
    await delay(step.ms || 1000);
  }

  async function doWaitFor(step) {
    await waitForElement(step.selector, step.timeout || 10000, step.interval || 200);
  }

  function describeStep(step, index = 0) {
    const n = index + 1;

    switch (step.type) {
      case "click":
        return `[${n}] 클릭: ${step.label || step.selector}`;
      case "key":
        return `[${n}] 키 입력: ${step.label || step.selector} (${getRecordedKeyName(step)})`;
      case "input":
        return `[${n}] 입력: ${step.label || step.selector}`;
      case "select":
        return `[${n}] 선택: ${step.label || step.selector}`;
      case "dropdownSelect":
        return `[${n}] 드롭다운 선택: ${step.label || step.selector}`;
      case "wait":
        return `[${n}] 대기: ${step.ms || 0}ms`;
      case "waitFor":
        return `[${n}] 요소 대기: ${step.selector}`;
      default:
        return `[${n}] ${step.type}`;
    }
  }

  async function runSingleStep(step, index = 0) {
    if (!step || !step.type) {
      throw new Error("step에 type이 없습니다.");
    }

    const desc = describeStep(step, index);
    setOverlay("매크로 실행 중", desc);

    await appendRunTraceLog({
      source: "content:run",
      eventType: "step-start",
      stepIndex: index,
      stepType: step.type,
      message: desc,
      step,
      detail: collectFrameContextTrace(step)
    });

    try {
      if (step.type === "click") {
        await doClick(step);
      } else if (step.type === "key") {
        await doKey(step);
      } else if (step.type === "input") {
        await doInput(step);
      } else if (step.type === "select") {
        await doSelect(step);
      } else if (step.type === "dropdownSelect") {
        await doDropdownSelect(step);
      } else if (step.type === "wait") {
        await doWait(step);
      } else if (step.type === "waitFor") {
        await doWaitFor(step);
      } else {
        throw new Error(`지원하지 않는 step type입니다: ${step.type}`);
      }
    } catch (error) {
      await appendRunTraceLog({
        source: "content:run",
        eventType: "step-failure",
        stepIndex: index,
        stepType: step.type,
        message: error?.message || String(error),
        step,
        detail: buildStepFailureContext(step)
      });
      throw error;
    }

    const successMessage = `${desc} 완료`;
    await appendRunTraceLog({
      source: "content:run",
      eventType: "step-success",
      stepIndex: index,
      stepType: step.type,
      message: successMessage,
      step
    });

    return successMessage;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        if (message?.type === "PING") {
          sendResponse({ ok: true });
          return;
        }

        if (message?.type === "LOCATE_RUN_STEP_TARGET") {
          sendResponse(locateRunStepTarget(message.step));
          return;
        }

        if (message?.type === "START_RECORD") {
          applyRecordingState(true, !!message.debugEnabled);
          sendResponse({ ok: true });
          return;
        }

        if (message?.type === "STOP_RECORD") {
          if (pendingDropdownRecord) {
            await finalizePendingDropdownRecord();
          }
          applyRecordingState(false, false);
          sendResponse({ ok: true });
          return;
        }

        if (message?.type === "SET_DEBUG_MODE") {
          debugMode = !!message.enabled;
          sendResponse({ ok: true });
          return;
        }

        if (message?.type === "RUN_SINGLE_STEP") {
          const result = await runSingleStep(message.step, message.index || 0);
          sendResponse({
            ok: true,
            message: result
          });
          return;
        }

        sendResponse({
          ok: false,
          message: "알 수 없는 메시지입니다."
        });
      } catch (error) {
        removeOverlay();
        sendResponse({
          ok: false,
          message: error?.message || String(error)
        });
      }
    })();

    return true;
  });

  if (window.__EASY_WEB_MACRO_TEST_HOOKS__) {
    Object.assign(window.__EASY_WEB_MACRO_TEST_HOOKS__, {
      appendRecordedStepsDirectly,
      isRetryableRuntimeMessageError,
      persistRecordedSteps,
      isElementNode,
      querySelectorDeep,
      collectQuerySelectorAllDeep
    });
  }
})();
