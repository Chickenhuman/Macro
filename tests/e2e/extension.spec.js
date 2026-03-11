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
});
