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
  const STEPS_KEY = "macroSteps";

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
    if (!(el instanceof Element)) return "";

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

  function summarizeElement(el) {
    if (!(el instanceof Element)) return null;

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
    if (!(el instanceof Element)) return [];

    const items = [];
    let node = el;

    while (node && node !== document.documentElement && items.length < limit) {
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

  function logDebugEvent(eventType, rawTarget, extra = {}) {
    if (!debugMode) return;

    const target = rawTarget instanceof Element ? rawTarget : null;
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
    if (!(el instanceof Element)) return false;
    if (el.tagName === "SELECT") return false;

    if (
      el.matches(
        "[role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='tree'], [data-role='combobox'], [data-role='dropdown']"
      )
    ) {
      return true;
    }

    if (hasDropdownLikeClassName(el)) {
      return true;
    }

    if (el.matches("input[readonly], input[aria-haspopup], input[role='combobox']")) {
      return true;
    }

    if (el.querySelector("input[readonly], input[aria-haspopup], input[role='combobox']")) {
      return true;
    }

    return false;
  }

  function getDropdownTriggerTarget(rawTarget) {
    if (!(rawTarget instanceof Element)) return null;

    let node = rawTarget;
    while (node && node !== document.documentElement) {
      if (isDropdownLikeElement(node)) {
        return node;
      }
      node = node.parentElement;
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

  function setOverlay(title, body = "") {
    ensureOverlay();
    overlayTitle.textContent = title;
    overlayBody.textContent = body;
  }

  function showRecordedMessage(step) {
    if (!step) return;

    if (step.type === "click") {
      setOverlay("매크로 기록 중", `클릭 기록: ${step.label || step.selector}`);
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

  function isRetryableRuntimeMessageError(error) {
    const message = String(error?.message || error || "");
    return (
      message.includes("message channel closed before a response was received") ||
      message.includes("Could not establish connection") ||
      message.includes("Receiving end does not exist")
    );
  }

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

  async function appendRecordedStepsDirectly(steps) {
    const sanitized = sanitizeRecordedSteps(steps);
    if (!sanitized.length) return [];

    const data = await chrome.storage.local.get(STEPS_KEY);
    const currentSteps = Array.isArray(data[STEPS_KEY]) ? data[STEPS_KEY] : [];

    if (hasMatchingTail(currentSteps, sanitized)) {
      return currentSteps;
    }

    const nextSteps = [...currentSteps, ...sanitized];
    await chrome.storage.local.set({
      [STEPS_KEY]: nextSteps
    });

    return nextSteps;
  }

  async function persistRecordedSteps(steps) {
    const sanitized = sanitizeRecordedSteps(steps);
    if (!sanitized.length) return [];

    try {
      const response = await chrome.runtime.sendMessage({
        type: "APPEND_STEPS",
        steps: sanitized
      });

      if (!response?.ok) {
        throw new Error(response?.message || "step 저장 실패");
      }

      return Array.isArray(response.steps) ? response.steps : sanitized;
    } catch (error) {
      if (!isRetryableRuntimeMessageError(error)) {
        throw error;
      }

      return await appendRecordedStepsDirectly(sanitized);
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
    await persistRecordedSteps(stepsToAppend);
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
    if (step.type === "input" || step.type === "select" || step.type === "dropdownSelect") {
      return `${step.type} ${step.selector || ""} ${String(step.value ?? "")}`.trim();
    }
    if (step.type === "wait") {
      return `wait ${step.ms || 0}`;
    }

    return step.type;
  }

  function findCheckboxLikeWrapper(el) {
    if (!(el instanceof Element)) return null;

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
    if (!(el instanceof Element)) return false;

    if (
      el.matches(
        "button, [role='button'], a, input[type='button'], input[type='submit'], input[type='reset'], [onclick]"
      )
    ) {
      return true;
    }

    return hasButtonLikeClassName(el);
  }

  function getClickableTarget(rawTarget) {
    if (!(rawTarget instanceof Element)) return null;

    const checkboxWrapper = findCheckboxLikeWrapper(rawTarget);
    if (checkboxWrapper) {
      return checkboxWrapper;
    }

    let node = rawTarget;
    while (node && node !== document.documentElement) {
      if (isButtonLikeElement(node)) {
        return node;
      }
      node = node.parentElement;
    }

    return null;
  }

  function getInputTarget(rawTarget) {
    if (!(rawTarget instanceof Element)) return null;

    const el = rawTarget.closest("input, textarea, select");
    if (!el) return null;

    if (el.tagName === "SELECT") return el;

    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (["password", "hidden", "file"].includes(type)) {
      return null;
    }

    if (["button", "submit", "reset", "checkbox", "radio"].includes(type)) {
      return null;
    }

    return el;
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
    "click",
    async (event) => {
      if (!recordMode) return;

      logDebugEvent("click", event.target);

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

      const dropdownTrigger = getDropdownTriggerTarget(event.target);
      if (dropdownTrigger) {
        rememberDropdownRecord(dropdownTrigger);
        return;
      }

      if (pendingDropdownRecord) {
        const recorded = await finalizePendingDropdownRecord();
        if (recorded) {
          return;
        }
      }

      const el = getClickableTarget(event.target);
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
      const el = document.querySelector(selector);
      if (el) return el;
      await delay(interval);
    }

    throw new Error(`요소를 찾지 못했습니다: ${selector}`);
  }

  function isVisible(el) {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

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

  function fireMouseSequence(el) {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));

    if (typeof el.click === "function") {
      el.click();
      return;
    }

    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  function isCheckboxLikeElement(el) {
    if (!(el instanceof Element)) return false;

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
    if (!(el instanceof Element)) return null;

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
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

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

  function setInputValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function setSelectValue(el, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function isDropdownOptionCandidate(el) {
    if (!(el instanceof Element)) return false;

    if (
      el.matches(
        "[role='option'], [role='treeitem'], [role='menuitem'], li, button, a, td, div, span"
      )
    ) {
      return true;
    }

    return hasDropdownLikeClassName(el);
  }

  function scoreDropdownOptionCandidate(el, expected) {
    if (!(el instanceof Element)) return -1;
    if (!isVisible(el)) return -1;

    const text = normalizeText(el.innerText || el.textContent || "");
    if (!text) return -1;

    const normalizedExpected = normalizeText(expected);
    if (!normalizedExpected) return -1;

    if (text !== normalizedExpected && !text.includes(normalizedExpected)) {
      return -1;
    }

    let score = 0;

    if (text === normalizedExpected) score += 100;
    if (el.matches("[role='option'], [role='treeitem'], [role='menuitem']")) score += 40;
    if (el.closest("[role='listbox'], [role='tree'], [role='menu']")) score += 30;
    if (el.matches("li, button, a")) score += 20;
    if (hasDropdownLikeClassName(el) || hasDropdownLikeClassName(el.parentElement)) score += 10;

    return score;
  }

  async function waitForDropdownOption(value, timeout = 10000, interval = 200) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      const candidates = [...document.querySelectorAll("body *")];
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

    trigger.scrollIntoView({
      block: "center",
      inline: "center"
    });

    await delay(200);
    trigger.focus?.();
    fireMouseSequence(trigger);
    await delay(250);

    const option = await waitForDropdownOption(step.value ?? "", step.timeout || 10000, 200);
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
    const raw = await waitForElement(step.selector, step.timeout || 10000);

    if (isCheckboxLikeElement(raw)) {
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

    el.focus?.();
    fireMouseSequence(el);
  }

  async function doInput(step) {
    const el = await ensureVisible(step.selector, step.timeout || 10000);

    if (!("value" in el)) {
      throw new Error(`입력 가능한 요소가 아닙니다: ${step.selector}`);
    }

    el.focus?.();
    setInputValue(el, step.value ?? "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await delay(200);
  }

  async function doSelect(step) {
    const el = await ensureVisible(step.selector, step.timeout || 10000);

    if (el.tagName !== "SELECT") {
      throw new Error(`select 요소가 아닙니다: ${step.selector}`);
    }

    el.focus?.();
    setSelectValue(el, step.value ?? "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
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

    if (step.type === "click") {
      await doClick(step);
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

    return `${desc} 완료`;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        if (message?.type === "PING") {
          sendResponse({ ok: true });
          return;
        }

        if (message?.type === "START_RECORD") {
          debugMode = !!message.debugEnabled;
          recordMode = true;
          lastRecordedAt = null;
          pendingDropdownRecord = null;
          setOverlay("매크로 기록 중", "페이지에서 버튼을 클릭하거나 값을 입력하세요.");
          sendResponse({ ok: true });
          return;
        }

        if (message?.type === "STOP_RECORD") {
          if (pendingDropdownRecord) {
            await finalizePendingDropdownRecord();
          }
          recordMode = false;
          debugMode = false;
          lastRecordedAt = null;
          pendingDropdownRecord = null;
          removeOverlay();
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
      persistRecordedSteps
    });
  }
})();
