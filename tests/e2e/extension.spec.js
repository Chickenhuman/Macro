const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const { test, expect, chromium } = require("@playwright/test");

const EXTENSION_PATH = path.join(__dirname, "..", "..");

function renderPage(title, body, script = "") {
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
  </head>
  <body>
    ${body}
    <script>
      ${script}
    </script>
  </body>
</html>`;
}

async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const route = new URL(req.url, "http://127.0.0.1").pathname;

    if (route === "/record-nav.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Record Nav",
          `
            <label for="nameInput">이름</label>
            <input id="nameInput" type="text" />
            <button id="nextBtn" type="button">다음으로 이동</button>
          `,
          `
            document.querySelector("#nextBtn").addEventListener("click", () => {
              window.location.href = "/done.html";
            });
          `
        )
      );
      return;
    }

    if (route === "/popup-root.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Popup Root",
          `
            <button id="openPopupBtn" type="button">팝업 열기</button>
          `,
          `
            document.querySelector("#openPopupBtn").addEventListener("click", () => {
              window.open("/popup-child.html", "macro-popup", "width=480,height=320");
            });
          `
        )
      );
      return;
    }

    if (route === "/popup-child.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Popup Child",
          `
            <label for="popupInput">팝업 입력</label>
            <input id="popupInput" type="text" />
            <button id="popupSave" type="button">저장</button>
          `
        )
      );
      return;
    }

    if (route === "/run-root.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Run Root",
          `
            <button id="openPopupBtn" type="button">팝업 열기</button>
          `,
          `
            document.querySelector("#openPopupBtn").addEventListener("click", () => {
              window.open("/run-child.html", "macro-run-popup", "width=480,height=320");
            });
          `
        )
      );
      return;
    }

    if (route === "/pudd-controls.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "PUDD Controls",
          `
            <style>
              #rowCheckWrap {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                border: 1px solid #666;
                cursor: pointer;
                user-select: none;
              }

              #rowCheckWrap svg {
                width: 18px;
                height: 18px;
                pointer-events: none;
              }

              #archiveButton {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 120px;
                height: 36px;
                padding: 0 16px;
                border: 1px solid #999;
                background: #f5f5f5;
                cursor: pointer;
                user-select: none;
              }

              .iframe_wrap {
                padding: 16px;
                border: 1px solid #d7dce5;
              }

              .toolbar {
                display: flex;
                align-items: center;
                gap: 12px;
              }

              .field_row {
                margin-top: 18px;
              }

              #boardTypeInput {
                width: 180px;
                height: 32px;
                padding: 0 10px;
                border: 1px solid #999;
              }
            </style>
            <div class="iframe_wrap">
              <div class="toolbar">
                <div id="rowCheckWrap" class="PUDD-UI-checkbox PUDDCheckBoxWrap">
                  <input id="rowCheckInput" class="PUDDCheckBox" type="checkbox" hidden />
                  <svg id="rowCheckIcon" viewBox="0 0 18 18" aria-hidden="true">
                    <rect x="1" y="1" width="16" height="16" fill="white" stroke="#0b6efd"></rect>
                    <polyline
                      id="rowCheckMark"
                      points="4,9 8,13 14,5"
                      fill="none"
                      stroke="#0b6efd"
                      stroke-width="2"
                      style="display:none"
                    ></polyline>
                  </svg>
                </div>
                <button
                  id="archiveButton"
                  class="puddSetup"
                  type="button"
                >
                  <span id="archiveButtonLabel">편철접수</span>
                </button>
              </div>
              <div class="field_row">
                <label for="boardTypeInput">접수유형</label>
                <div class="PUDD-UI-selectBox">
                  <input
                    id="boardTypeInput"
                    class="PUDD-UI-input"
                    type="text"
                    readonly
                    value="관내접수"
                  />
                </div>
              </div>
            </div>
            <div id="buttonResult"></div>
          `,
          `
            const input = document.querySelector("#rowCheckInput");
            const mark = document.querySelector("#rowCheckMark");
            const wrapper = document.querySelector("#rowCheckWrap");
            const button = document.querySelector("#archiveButton");

            function renderCheck() {
              mark.style.display = input.checked ? "block" : "none";
            }

            wrapper.addEventListener("click", () => {
              input.checked = !input.checked;
              renderCheck();
            });

            button.addEventListener("click", () => {
              document.querySelector("#buttonResult").textContent = "clicked";
            });

            renderCheck();
          `
        )
      );
      return;
    }

    if (route === "/pudd-picker.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "PUDD Picker",
          `
            <style>
              #archiveCell {
                padding: 16px;
              }

              .archive_field {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                border: 1px solid #c9cfda;
              }

              #archivePickerInput {
                width: 180px;
                height: 32px;
                padding: 0 10px;
                border: 1px solid #999;
              }

              #archivePickerOptions {
                display: none;
                list-style: none;
                margin: 8px 0 0;
                padding: 0;
                width: 220px;
                border: 1px solid #999;
                background: #fff;
              }

              #archivePickerOptions.open {
                display: block;
              }

              #archivePickerOptions li {
                padding: 8px 12px;
                cursor: pointer;
              }

              #archivePickerOptions li:hover {
                background: #eef4ff;
              }
            </style>
            <table>
              <tbody>
                <tr>
                  <td id="archiveCell">
                    <div class="archive_field">
                      <input
                        id="archivePickerInput"
                        type="text"
                        readonly
                        value="선택 보존기간 : -"
                      />
                      <div class="controll_btn">
                        <button id="archivePickerButton" type="button">선택</button>
                      </div>
                    </div>
                    <ul id="archivePickerOptions" role="listbox">
                      <li role="option">3년</li>
                      <li role="option">10년</li>
                    </ul>
                  </td>
                </tr>
              </tbody>
            </table>
          `,
          `
            const input = document.querySelector("#archivePickerInput");
            const button = document.querySelector("#archivePickerButton");
            const options = document.querySelector("#archivePickerOptions");

            button.addEventListener("click", () => {
              options.classList.toggle("open");
            });

            options.querySelectorAll("[role='option']").forEach((option) => {
              option.addEventListener("click", (event) => {
                input.value = "선택 보존기간 : " + event.currentTarget.textContent.trim();
                options.classList.remove("open");
              });
            });
          `
        )
      );
      return;
    }

    if (route === "/pudd-dropdown.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "PUDD Dropdown",
          `
            <style>
              #docTypeWrap {
                display: inline-flex;
                align-items: center;
                justify-content: space-between;
                width: 180px;
                height: 36px;
                padding: 0 12px;
                border: 1px solid #999;
                cursor: pointer;
                user-select: none;
              }

              #docTypeOptions {
                display: none;
                list-style: none;
                padding: 0;
                margin: 8px 0 0;
                width: 180px;
                border: 1px solid #999;
              }

              #docTypeOptions.open {
                display: block;
              }

              #docTypeOptions li {
                padding: 8px 12px;
                cursor: pointer;
              }

              #docTypeOptions li:hover {
                background: #eef4ff;
              }
            </style>
            <div
              class="PUDD-UI-selectBox"
            >
              <input
                id="docTypeInput"
                class="PUDD-UI-input"
                type="text"
                readonly
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded="false"
                value="기본"
              />
              <span aria-hidden="true">▼</span>
            </div>
            <ul id="docTypeOptions" role="listbox">
              <li role="option">일반접수</li>
              <li role="option">편철접수</li>
            </ul>
          `,
          `
            const input = document.querySelector("#docTypeInput");
            const options = document.querySelector("#docTypeOptions");

            input.addEventListener("click", () => {
              const nextOpen = !options.classList.contains("open");
              options.classList.toggle("open", nextOpen);
              input.setAttribute("aria-expanded", String(nextOpen));
            });

            options.querySelectorAll("[role='option']").forEach((option) => {
              option.addEventListener("click", (event) => {
                event.stopPropagation();
                input.value = option.textContent;
                options.classList.remove("open");
                input.setAttribute("aria-expanded", "false");
              });
            });
          `
        )
      );
      return;
    }

    if (route === "/run-child.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Run Child",
          `
            <label for="popupInput">팝업 입력</label>
            <input id="popupInput" type="text" />
            <div id="result"></div>
          `,
          `
            document.querySelector("#popupInput").addEventListener("change", (event) => {
              document.querySelector("#result").textContent = event.target.value;
            });
          `
        )
      );
      return;
    }

    if (route === "/done.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPage("Done", `<div id="doneFlag">done</div>`));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function launchExtensionContext() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "macro-playwright-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    ignoreDefaultArgs: [
      "--disable-component-extensions-with-background-pages",
      "--disable-extensions"
    ],
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    ]
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }

  return {
    context,
    extensionId: new URL(serviceWorker.url()).host,
    userDataDir
  };
}

async function closeExtensionContext(bundle) {
  if (!bundle) return;

  await bundle.context.close();
  await fs.rm(bundle.userDataDir, {
    recursive: true,
    force: true
  });
}

async function getExtensionPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

async function findTabId(extensionPage, url) {
  return await extensionPage.evaluate(async (targetUrl) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => tab.url === targetUrl);
    return match?.id ?? null;
  }, url);
}

async function sendRuntimeMessage(extensionPage, message) {
  return await extensionPage.evaluate(async (payload) => {
    return await chrome.runtime.sendMessage(payload);
  }, message);
}

async function readStorage(extensionPage) {
  return await extensionPage.evaluate(async () => {
    return await chrome.storage.local.get([
      "macroSteps",
      "macroRecordingState",
      "macroRunState",
      "macroErrorLogs"
    ]);
  });
}

test.describe("extension smoke tests", () => {
  let server;
  let bundle;
  let extensionPage;

  test.beforeEach(async () => {
    server = await startFixtureServer();
    bundle = await launchExtensionContext();
    extensionPage = await getExtensionPage(bundle.context, bundle.extensionId);
  });

  test.afterEach(async () => {
    if (extensionPage) {
      await extensionPage.close().catch(() => {});
    }

    await closeExtensionContext(bundle);
    await server.close();
  });

  test("records navigation-triggering clicks without losing steps", async () => {
    const page = await bundle.context.newPage();
    await page.goto(`${server.baseUrl}/record-nav.html`);

    const tabId = await findTabId(extensionPage, page.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    await page.fill("#nameInput", "Alice");
    await page.locator("#nameInput").blur();

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).some(
          (step) => step.type === "input" && step.selector === "#nameInput"
        );
      })
      .toBe(true);

    await page.click("#nextBtn");
    await page.waitForURL(`${server.baseUrl}/done.html`);

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(steps.some((step) => step.type === "input" && step.selector === "#nameInput")).toBe(true);
    expect(steps.some((step) => step.type === "click" && step.selector === "#nextBtn")).toBe(true);
  });

  test("records related popup tab actions and inserts waitForPopup", async () => {
    const rootPage = await bundle.context.newPage();
    await rootPage.goto(`${server.baseUrl}/popup-root.html`);

    const tabId = await findTabId(extensionPage, rootPage.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    const popupPromise = bundle.context.waitForEvent("page");
    await rootPage.click("#openPopupBtn");
    const popupPage = await popupPromise;
    await popupPage.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).map((step) => step.type).join(",");
      })
      .toContain("waitForPopup");

    await expect
      .poll(async () => {
        return await popupPage.evaluate(() => document.documentElement.innerText || "");
      })
      .toContain("매크로 기록 중");

    await popupPage.fill("#popupInput", "Popup text");
    await popupPage.locator("#popupInput").blur();
    await popupPage.click("#popupSave");

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(
      steps.some((step) => step.type === "waitForPopup" && String(step.urlIncludes || "").includes("popup-child.html"))
    ).toBe(true);
    expect(steps.some((step) => step.type === "input" && step.selector === "#popupInput")).toBe(true);
  });

  test("runs a popup macro end-to-end", async () => {
    const rootPage = await bundle.context.newPage();
    await rootPage.goto(`${server.baseUrl}/run-root.html`);

    const tabId = await findTabId(extensionPage, rootPage.url());
    expect(tabId).toBeTruthy();

    const steps = [
      {
        type: "click",
        selector: "#openPopupBtn",
        label: "팝업 열기"
      },
      {
        type: "waitForPopup",
        urlIncludes: "run-child.html",
        timeout: 10000
      },
      {
        type: "input",
        selector: "#popupInput",
        value: "Macro value",
        label: "팝업 입력"
      }
    ];

    const popupPromise = bundle.context.waitForEvent("page");
    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    const popupPage = await popupPromise;
    await popupPage.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => {
        return await popupPage.inputValue("#popupInput");
      })
      .toBe("Macro value");

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return storage.macroRunState || {};
      })
      .toMatchObject({
        running: false,
        error: "",
        lastMessage: "실행 완료"
      });
  });

  test("records and runs PUDD-style checkbox and button clicks", async () => {
    const recordPage = await bundle.context.newPage();
    await recordPage.goto(`${server.baseUrl}/pudd-controls.html`);

    const recordTabId = await findTabId(extensionPage, recordPage.url());
    expect(recordTabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId: recordTabId
    });
    expect(startResponse.ok).toBe(true);

    await recordPage.click("#rowCheckWrap");
    await recordPage.click("#archiveButtonLabel");

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const recordedStorage = await readStorage(extensionPage);
    const recordedSteps = recordedStorage.macroSteps || [];

    expect(recordedSteps.some((step) => step.type === "click" && step.selector === "#rowCheckWrap")).toBe(true);
    expect(recordedSteps.some((step) => step.type === "click" && step.selector === "#archiveButton")).toBe(true);
    expect(recordedSteps.some((step) => step.type === "dropdownSelect")).toBe(false);

    await recordPage.close();

    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/pudd-controls.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps: recordedSteps.filter((step) => step.type === "click")
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.evaluate(() => ({
          checked: document.querySelector("#rowCheckInput").checked,
          result: document.querySelector("#buttonResult").textContent
        }));
      })
      .toMatchObject({
        checked: true,
        result: "clicked"
      });
  });

  test("records PUDD-style dropdown selection as dropdownSelect", async () => {
    const page = await bundle.context.newPage();
    await page.goto(`${server.baseUrl}/pudd-dropdown.html`);

    const tabId = await findTabId(extensionPage, page.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    await page.click("#docTypeInput");
    await page.getByRole("option", { name: "편철접수" }).click();

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(
      steps.some(
        (step) =>
          step.type === "dropdownSelect" &&
          step.selector === "#docTypeInput" &&
          step.value === "편철접수"
      )
    ).toBe(true);
    expect(steps.some((step) => step.type === "click" && step.selector === "#docTypeInput")).toBe(false);
  });

  test("records button-triggered picker changes as dropdownSelect", async () => {
    const recordPage = await bundle.context.newPage();
    await recordPage.goto(`${server.baseUrl}/pudd-picker.html`);

    const recordTabId = await findTabId(extensionPage, recordPage.url());
    expect(recordTabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId: recordTabId
    });
    expect(startResponse.ok).toBe(true);

    await recordPage.click("#archivePickerButton");
    await recordPage.getByRole("option", { name: "10년" }).click();

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const recordedStorage = await readStorage(extensionPage);
    const recordedSteps = recordedStorage.macroSteps || [];

    expect(
      recordedSteps.some(
        (step) =>
          step.type === "dropdownSelect" &&
          step.selector === "#archivePickerInput" &&
          step.value === "선택 보존기간 : 10년"
      )
    ).toBe(true);
    expect(recordedSteps.some((step) => step.type === "click" && step.selector === "#archivePickerButton")).toBe(
      false
    );

    await recordPage.close();

    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/pudd-picker.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const dropdownStep = recordedSteps.find(
      (step) =>
        step.type === "dropdownSelect" &&
        step.selector === "#archivePickerInput" &&
        step.value === "선택 보존기간 : 10년"
    );
    expect(dropdownStep).toBeTruthy();

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps: [dropdownStep]
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.inputValue("#archivePickerInput");
      })
      .toBe("선택 보존기간 : 10년");
  });
});
