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

    if (route === "/password-input.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Password Input",
          `
            <label for="passwordInput">비밀번호</label>
            <input id="passwordInput" type="password" autocomplete="current-password" />
          `
        )
      );
      return;
    }

    if (route === "/iframe-password-root.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Iframe Password Root",
          `
            <button id="openPasswordDialog" type="button">결재</button>
            <div id="dialogHost"></div>
          `,
          `
            document.querySelector("#openPasswordDialog").addEventListener("click", () => {
              const host = document.querySelector("#dialogHost");
              if (host.querySelector("#dlgFrame")) {
                return;
              }

              const frame = document.createElement("iframe");
              frame.id = "dlgFrame";
              frame.src = "/iframe-password-child.html";
              frame.width = "640";
              frame.height = "240";
              host.appendChild(frame);
            });
          `
        )
      );
      return;
    }

    if (route === "/iframe-password-child.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Iframe Password Child",
          `
            <label for="signPassword">비밀번호</label>
            <input id="signPassword" type="password" autocomplete="current-password" />
            <button id="closeFocus" type="button">다음</button>
          `
        )
      );
      return;
    }

    if (route === "/space-toggle.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Space Toggle",
          `
            <label id="spaceToggleLabel">
              <input id="spaceToggle" type="checkbox" />
              스페이스 토글
            </label>
            <div id="spaceState">off</div>
          `,
          `
            const input = document.querySelector("#spaceToggle");
            const state = document.querySelector("#spaceState");

            function syncState() {
              state.textContent = input.checked ? "on" : "off";
            }

            input.addEventListener("change", syncState);
            syncState();
          `
        )
      );
      return;
    }

    if (route === "/space-idle.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Space Idle",
          `
            <div id="idleState">idle</div>
          `,
          `
            document.body.tabIndex = 0;
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
      const source = new URL(req.url, "http://127.0.0.1").searchParams.get("source") || "default";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Popup Child",
          `
            <label for="popupInput">팝업 입력</label>
            <input id="popupInput" type="text" />
            <button id="popupSave" type="button">저장</button>
            <div id="popupStatus">${source}</div>
          `,
          `
            document.querySelector("#popupSave").addEventListener("click", () => {
              document.querySelector("#popupStatus").textContent = "saved-${source}";
            });
          `
        )
      );
      return;
    }

    if (route === "/popup-picker-root.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Popup Picker Root",
          `
            <style>
              .picker_row {
                display: flex;
                align-items: center;
                gap: 10px;
              }

              #archiveInput {
                width: 220px;
                height: 32px;
                padding: 0 10px;
                border: 1px solid #999;
              }
            </style>
            <div class="picker_row">
              <input id="archiveInput" type="text" readonly value="" />
              <button id="openArchivePopup" type="button">선택</button>
              <span id="retentionPeriod">보존기간 : -</span>
            </div>
          `,
          `
            document.querySelector("#openArchivePopup").addEventListener("click", () => {
              window.open("/popup-picker-child.html", "archive-picker", "width=480,height=320");
            });
          `
        )
      );
      return;
    }

    if (route === "/popup-picker-child.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Popup Picker Child",
          `
            <button id="archiveOption" type="button">회계전표</button>
          `,
          `
            document.querySelector("#archiveOption").addEventListener("click", () => {
              const openerDocument = window.opener && window.opener.document;
              if (openerDocument) {
                const archiveInput = openerDocument.querySelector("#archiveInput");
                const retentionPeriod = openerDocument.querySelector("#retentionPeriod");

                archiveInput.value = "회계전표";
                archiveInput.dispatchEvent(new Event("input", { bubbles: true }));
                archiveInput.dispatchEvent(new Event("change", { bubbles: true }));

                if (retentionPeriod) {
                  retentionPeriod.textContent = "보존기간 : 10년";
                }
              }

              setTimeout(() => {
                window.close();
              }, 0);
            });
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

    if (route === "/delayed-popup-root.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Delayed Popup Root",
          `
            <button id="openPopupBtn" type="button">팝업 열기</button>
          `,
          `
            document.querySelector("#openPopupBtn").addEventListener("click", () => {
              setTimeout(() => {
                window.open("/popup-child.html?source=expected", "macro-delayed-popup", "width=480,height=320");
              }, 600);
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

    if (route === "/line-selector.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Line Selector",
          `
            <style>
              #selMyKyuljaeLine {
                position: relative;
                display: inline-block;
              }

              #idMyApprvLineGroup {
                display: none;
                position: absolute;
                top: 40px;
                left: 0;
                width: 220px;
                padding: 8px 0;
                border: 1px solid #bfc6d4;
                background: #fff;
              }

              #idMyApprvLineGroup.open {
                display: block;
              }

              #idMyApprvLineGroup ul {
                list-style: none;
                margin: 0;
                padding: 0;
              }

              #idMyApprvLineGroup li {
                padding: 8px 12px;
                cursor: pointer;
              }

              #idMyApprvLineGroup li:hover {
                background: #eef4ff;
              }
            </style>
            <div id="selMyKyuljaeLine" class="controll_btn posi_re p0 fr">
              <button id="btnLineGroup" type="button" class="btn_ud ud down al ellipsis">내 결재라인</button>
              <div id="idMyApprvLineGroup" class="multi_sel_list signLineSel_list kl_sel">
                <ul>
                  <li><span id="lineOptionLow">풍력 1000만 이하</span></li>
                  <li><span id="lineOptionHigh">풍력 고액</span></li>
                </ul>
              </div>
            </div>
            <div id="selectedLineLabel"></div>
          `,
          `
            const trigger = document.querySelector("#btnLineGroup");
            const list = document.querySelector("#idMyApprvLineGroup");
            const label = document.querySelector("#selectedLineLabel");

            trigger.addEventListener("click", () => {
              list.classList.toggle("open");
            });

            document.querySelectorAll("#idMyApprvLineGroup span").forEach((option) => {
              option.addEventListener("click", (event) => {
                label.textContent = event.currentTarget.textContent.trim();
                trigger.textContent = event.currentTarget.textContent.trim();
                list.classList.remove("open");
              });
            });
          `
        )
      );
      return;
    }

    if (route === "/line-selector-delayed.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Line Selector Delayed",
          `
            <style>
              #selMyKyuljaeLine {
                position: relative;
                display: inline-block;
              }

              #idMyApprvLineGroup {
                display: none;
                position: absolute;
                top: 40px;
                left: 0;
                width: 220px;
                padding: 8px 0;
                border: 1px solid #bfc6d4;
                background: #fff;
              }

              #idMyApprvLineGroup.open {
                display: block;
              }

              #idMyApprvLineGroup ul {
                list-style: none;
                margin: 0;
                padding: 0;
              }

              #idMyApprvLineGroup li {
                padding: 8px 12px;
                cursor: pointer;
              }
            </style>
            <div id="selMyKyuljaeLine" class="controll_btn posi_re p0 fr">
              <button id="btnLineGroup" type="button" class="btn_ud ud down al ellipsis">내 결재라인</button>
              <div id="idMyApprvLineGroup" class="multi_sel_list signLineSel_list kl_sel">
                <ul>
                  <li><span id="lineOptionLow">풍력 1000만 이하</span></li>
                  <li><span id="lineOptionHigh">풍력 고액</span></li>
                </ul>
              </div>
            </div>
            <div id="selectedLineLabel"></div>
          `,
          `
            const trigger = document.querySelector("#btnLineGroup");
            const list = document.querySelector("#idMyApprvLineGroup");
            const label = document.querySelector("#selectedLineLabel");

            trigger.addEventListener("click", () => {
              setTimeout(() => {
                list.classList.add("open");
              }, 900);
            });

            document.querySelectorAll("#idMyApprvLineGroup span").forEach((option) => {
              option.addEventListener("click", (event) => {
                label.textContent = event.currentTarget.textContent.trim();
                trigger.textContent = event.currentTarget.textContent.trim();
                list.classList.remove("open");
              });
            });
          `
        )
      );
      return;
    }

    if (route === "/button-label-recovery.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Button Label Recovery",
          `
            <style>
              .psh_btnbox {
                display: flex;
                gap: 10px;
                align-items: center;
              }

              .PUDD.PUDD-COLOR-blue.PUDD-UI-Button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 120px;
                height: 36px;
                padding: 0 12px;
                border: 1px solid #9aa4b2;
                background: #fff;
              }

              .psh_btn {
                width: 100%;
                height: 100%;
                border: 0;
                background: transparent;
                cursor: pointer;
              }
            </style>
            <div class="psh_btnbox" id="buttonToolbar">
              <div class="PUDD PUDD-COLOR-blue PUDD-UI-Button">
                <input class="psh_btn" type="button" value="열람자확인" />
              </div>
              <div class="PUDD PUDD-COLOR-blue PUDD-UI-Button">
                <input class="psh_btn" type="button" value="문서수정내역" />
              </div>
              <div class="PUDD PUDD-COLOR-blue PUDD-UI-Button">
                <input class="psh_btn" type="button" value="결재라인선택" />
              </div>
              <div class="PUDD PUDD-COLOR-blue PUDD-UI-Button" id="approvalWrap">
                <input class="psh_btn" type="button" value="결재" />
              </div>
            </div>
            <div id="clickedLabel"></div>
          `,
          `
            const toolbar = document.querySelector("#buttonToolbar");
            const clickedLabel = document.querySelector("#clickedLabel");

            toolbar.addEventListener("click", (event) => {
              if (event.target.matches("input.psh_btn")) {
                clickedLabel.textContent = event.target.value;
              }
            });

            setTimeout(() => {
              const wrap = document.createElement("div");
              wrap.className = "PUDD PUDD-COLOR-blue PUDD-UI-Button";
              wrap.innerHTML = '<input class="psh_btn" type="button" value="결재라인지정" />';

              toolbar.insertBefore(wrap, document.querySelector("#approvalWrap"));
            }, 900);
          `
        )
      );
      return;
    }

    if (route === "/inline-onclick-apply.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Inline Onclick Apply",
          `
            <style>
              .PUDD.PUDD-COLOR-blue.PUDD-UI-Button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 80px;
                height: 32px;
                padding: 0 10px;
                border: 1px solid #9aa4b2;
                background: #fff;
              }

              #set_apprv {
                width: 100%;
                height: 100%;
                border: 0;
                background: transparent;
                cursor: pointer;
              }
            </style>
            <div class="PUDD PUDD-COLOR-blue PUDD-UI-Button">
              <input id="set_apprv" type="button" value="반영" onclick="main('SET_APPRV');" />
            </div>
            <div id="result"></div>
          `,
          `
            const button = document.querySelector("#set_apprv");
            const nativeClick = HTMLInputElement.prototype.click;

            window.main = function(action) {
              const result = document.querySelector("#result");
              if (action !== "SET_APPRV") {
                result.textContent = "wrong-action";
                return;
              }

              result.textContent = window.__viaPageClickOverride ? "applied" : "closed";
              window.__viaPageClickOverride = false;
            };

            button.click = function() {
              window.__viaPageClickOverride = true;
              nativeClick.call(this);
            };
          `
        )
      );
      return;
    }

    if (route === "/native-alert-apply.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Native Alert Apply",
          `
            <div class="PUDD PUDD-COLOR-blue PUDD-UI-Button">
              <input id="set_apprv" type="button" value="반영" onclick="approveWithAlert();" />
            </div>
            <div id="result"></div>
          `,
          `
            window.approveWithAlert = function() {
              alert("결재자가 한 명일 때는 자동으로 전결처리 됩니다.");
              document.querySelector("#result").textContent = "approved";
            };
          `
        )
      );
      return;
    }

    if (route === "/synthetic-mousedown-sensitive.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          "Synthetic Mousedown Sensitive",
          `
            <button id="btnConfirmD" type="button" class="submit">확인</button>
            <div id="result">idle</div>
          `,
          `
            const button = document.querySelector("#btnConfirmD");
            const result = document.querySelector("#result");

            button.addEventListener("mousedown", (event) => {
              if (!event.isTrusted) {
                result.textContent = "system-error";
              }
            });

            button.addEventListener("click", () => {
              if (result.textContent === "system-error") {
                return;
              }

              result.textContent = "applied";
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
      "savedMacros",
      "macroRecordingState",
      "macroRunState",
      "macroErrorLogs",
      "macroRunTraceLogs"
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

  test("records password field changes as input steps", async () => {
    const page = await bundle.context.newPage();
    await page.goto(`${server.baseUrl}/password-input.html`);

    const tabId = await findTabId(extensionPage, page.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    await page.fill("#passwordInput", "S3cret!");
    await page.locator("#passwordInput").blur();

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(
      steps.some(
        (step) =>
          step.type === "input" &&
          step.selector === "#passwordInput" &&
          step.value === "S3cret!"
      )
    ).toBe(true);
  });

  test("records password field changes inside a dynamically added iframe", async () => {
    const page = await bundle.context.newPage();
    await page.goto(`${server.baseUrl}/iframe-password-root.html`);

    const tabId = await findTabId(extensionPage, page.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    await page.click("#openPasswordDialog");
    await page.locator("#dlgFrame").waitFor();

    const frame = page.frameLocator("#dlgFrame");
    await frame.locator("#signPassword").waitFor();
    await expect
      .poll(async () => {
        return await frame.locator("html").textContent();
      })
      .toContain("매크로 기록 중");
    await frame.locator("#signPassword").fill("1358314a!");
    await frame.locator("#signPassword").blur();
    await frame.locator("#closeFocus").click();

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).some(
          (step) =>
            step.type === "input" &&
            step.selector === "#signPassword" &&
            step.value === "1358314a!"
        );
      })
      .toBe(true);

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(steps.some((step) => step.type === "click" && step.selector === "#openPasswordDialog")).toBe(
      true
    );
    expect(
      steps.some(
        (step) =>
          step.type === "input" &&
          step.selector === "#signPassword" &&
          step.value === "1358314a!"
      )
    ).toBe(true);
  });

  test("does not record a key step while typing spaces into text inputs", async () => {
    const page = await bundle.context.newPage();
    await page.goto(`${server.baseUrl}/record-nav.html`);

    const tabId = await findTabId(extensionPage, page.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    await page.focus("#nameInput");
    await page.keyboard.type("macro test");
    await page.locator("#nameInput").blur();

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(
      steps.some(
        (step) =>
          step.type === "input" &&
          step.selector === "#nameInput" &&
          step.value === "macro test"
      )
    ).toBe(true);
    expect(steps.some((step) => step.type === "key")).toBe(false);
  });

  test("records and replays spacebar key steps without duplicating click steps", async () => {
    const recordPage = await bundle.context.newPage();
    await recordPage.goto(`${server.baseUrl}/space-toggle.html`);

    const recordTabId = await findTabId(extensionPage, recordPage.url());
    expect(recordTabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId: recordTabId
    });
    expect(startResponse.ok).toBe(true);

    await recordPage.focus("#spaceToggle");
    await recordPage.keyboard.press("Space");

    await expect
      .poll(async () => {
        return await recordPage.textContent("#spaceState");
      })
      .toBe("on");

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(
      steps.some(
        (step) =>
          step.type === "key" &&
          step.selector === "#spaceToggleLabel" &&
          step.key === " " &&
          step.code === "Space"
      )
    ).toBe(true);
    expect(
      steps.some((step) => step.type === "click" && step.selector === "#spaceToggleLabel")
    ).toBe(false);

    await recordPage.close();

    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/space-toggle.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#spaceState");
      })
      .toBe("on");

    await expect
      .poll(async () => {
        return await runPage.isChecked("#spaceToggle");
      })
      .toBe(true);
  });

  test("replays legacy key steps without explicit key metadata as Space", async () => {
    const setResponse = await sendRuntimeMessage(extensionPage, {
      type: "SET_STEPS",
      steps: [
        {
          type: "key",
          selector: "#spaceToggleLabel",
          label: "스페이스 토글"
        }
      ]
    });
    expect(setResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    expect(storage.macroSteps || []).toEqual([
      {
        type: "key",
        selector: "#spaceToggleLabel",
        label: "스페이스 토글",
        key: " ",
        code: "Space"
      }
    ]);

    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/space-toggle.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps: storage.macroSteps || []
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#spaceState");
      })
      .toBe("on");
  });

  test("loads legacy key steps as Space in the popup UI", async () => {
    await extensionPage.evaluate(async () => {
      await chrome.storage.local.set({
        macroSteps: [
          {
            type: "key",
            selector: "#spaceToggleLabel",
            label: "스페이스 토글"
          }
        ]
      });
    });

    await extensionPage.reload();
    await extensionPage.waitForLoadState("domcontentloaded");

    await expect(extensionPage.locator("#stepsList .step-main").first()).toContainText("스페이스바");

    const storage = await readStorage(extensionPage);
    expect(storage.macroSteps || []).toEqual([
      {
        type: "key",
        selector: "#spaceToggleLabel",
        label: "스페이스 토글",
        key: " ",
        code: "Space"
      }
    ]);
  });

  test("does not record a key step when spacebar is pressed on the page body", async () => {
    const page = await bundle.context.newPage();
    await page.goto(`${server.baseUrl}/space-idle.html`);

    const tabId = await findTabId(extensionPage, page.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    await page.focus("body");
    await page.keyboard.press("Space");

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(steps.some((step) => step.type === "key")).toBe(false);
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

  test("waits for a newly opened popup instead of switching to an older matching window", async () => {
    const staleRootPage = await bundle.context.newPage();
    await staleRootPage.goto(`${server.baseUrl}/popup-root.html`);

    const stalePopupPromise = bundle.context.waitForEvent("page");
    await staleRootPage.click("#openPopupBtn");
    const stalePopup = await stalePopupPromise;
    await stalePopup.waitForLoadState("domcontentloaded");

    const rootPage = await bundle.context.newPage();
    await rootPage.goto(`${server.baseUrl}/delayed-popup-root.html`);

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
        urlIncludes: "popup-child.html",
        timeout: 10000
      },
      {
        type: "click",
        selector: "#popupSave",
        label: "저장"
      }
    ];

    const expectedPopupPromise = bundle.context.waitForEvent("page");
    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    const expectedPopup = await expectedPopupPromise;
    await expectedPopup.waitForLoadState("domcontentloaded");

    await expect
      .poll(async () => {
        return await expectedPopup.textContent("#popupStatus");
      })
      .toBe("saved-expected");

    await expect
      .poll(async () => {
        return await stalePopup.textContent("#popupStatus");
      })
      .toBe("default");
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

    expect(recordedSteps.some((step) => step.type === "click" && step.selector === "#archivePickerButton")).toBe(true);
    expect(
      recordedSteps.some(
        (step) =>
          step.type === "dropdownSelect" &&
          step.selector === "#archivePickerInput" &&
          step.value === "선택 보존기간 : 10년"
      )
    ).toBe(true);

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
      steps: recordedSteps.filter((step) => ["click", "dropdownSelect"].includes(step.type))
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.inputValue("#archivePickerInput");
      })
      .toBe("선택 보존기간 : 10년");
  });

  test("records popup picker opener clicks and replays the full popup flow", async () => {
    const rootPage = await bundle.context.newPage();
    await rootPage.goto(`${server.baseUrl}/popup-picker-root.html`);

    const tabId = await findTabId(extensionPage, rootPage.url());
    expect(tabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId
    });
    expect(startResponse.ok).toBe(true);

    const popupPromise = bundle.context.waitForEvent("page");
    await rootPage.click("#openArchivePopup");
    const popupPage = await popupPromise;
    await popupPage.waitForLoadState("domcontentloaded");

    const popupClosed = popupPage.waitForEvent("close");
    await popupPage.click("#archiveOption");
    await popupClosed;

    await expect
      .poll(async () => {
        return await rootPage.inputValue("#archiveInput");
      })
      .toBe("회계전표");

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).some(
          (step) => step.type === "click" && step.selector === "#archiveOption"
        );
      })
      .toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(steps.some((step) => step.type === "click" && step.selector === "#openArchivePopup")).toBe(true);
    expect(
      steps.some(
        (step) => step.type === "waitForPopup" && String(step.urlIncludes || "").includes("popup-picker-child.html")
      )
    ).toBe(true);
    expect(steps.some((step) => step.type === "click" && step.selector === "#archiveOption")).toBe(true);

    await rootPage.close();

    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/popup-picker-root.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.inputValue("#archiveInput");
      })
      .toBe("회계전표");
  });

  test("records open list options instead of collapsing back to the opener control", async () => {
    const recordPage = await bundle.context.newPage();
    await recordPage.goto(`${server.baseUrl}/line-selector.html`);

    const recordTabId = await findTabId(extensionPage, recordPage.url());
    expect(recordTabId).toBeTruthy();

    const startResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_RECORDING",
      tabId: recordTabId
    });
    expect(startResponse.ok).toBe(true);

    await recordPage.click("#btnLineGroup");
    await recordPage.click("#lineOptionLow");

    const stopResponse = await sendRuntimeMessage(extensionPage, {
      type: "STOP_RECORDING"
    });
    expect(stopResponse.ok).toBe(true);

    const storage = await readStorage(extensionPage);
    const steps = storage.macroSteps || [];

    expect(steps.some((step) => step.type === "click" && step.selector === "#btnLineGroup")).toBe(true);
    expect(steps.some((step) => step.type === "click" && step.selector === "#lineOptionLow")).toBe(true);
    expect(steps.some((step) => step.type === "click" && step.selector === "#selMyKyuljaeLine")).toBe(false);

    await recordPage.close();

    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/line-selector.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps: steps.filter((step) => step.type === "click")
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#selectedLineLabel");
      })
      .toBe("풍력 1000만 이하");
  });

  test("waits for delayed list options to become visible before clicking them", async () => {
    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/line-selector-delayed.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const steps = [
      {
        type: "click",
        selector: "#btnLineGroup",
        label: "내 결재라인"
      },
      {
        type: "click",
        selector: "#lineOptionLow",
        label: "풍력 1000만 이하"
      }
    ];

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#selectedLineLabel");
      })
      .toBe("풍력 1000만 이하");
  });

  test("prefers a visible button whose label matches when an nth-of-type selector is still settling", async () => {
    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/button-label-recovery.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const steps = [
      {
        type: "click",
        selector: "div.PUDD.PUDD-COLOR-blue.PUDD-UI-Button:nth-of-type(4) > input.psh_btn",
        label: "결재라인지정"
      }
    ];

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#clickedLabel");
      })
      .toBe("결재라인지정");
  });

  test("uses main-world direct click for inline onclick buttons", async () => {
    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/inline-onclick-apply.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const steps = [
      {
        type: "click",
        selector: "#set_apprv",
        label: "반영"
      }
    ];

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#result");
      })
      .toBe("applied");
  });

  test("uses direct click for native buttons without firing synthetic mousedown first", async () => {
    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/synthetic-mousedown-sensitive.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const steps = [
      {
        type: "click",
        selector: "#btnConfirmD",
        label: "확인"
      }
    ];

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#result");
      })
      .toBe("applied");
  });

  test("stores run trace logs when a step fails to find its selector", async () => {
    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/record-nav.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    const steps = [
      {
        type: "click",
        selector: "#missingConfirmButton",
        label: "확인",
        timeout: 600
      }
    ];

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return storage.macroRunState?.running;
      })
      .toBe(false);

    const storage = await readStorage(extensionPage);
    const traceLogs = storage.macroRunTraceLogs || [];
    const failureLog = traceLogs.find(
      (entry) =>
        entry?.source === "content:run" &&
        entry?.eventType === "step-failure" &&
        String(entry?.message || "").includes("요소를 찾지 못했습니다")
    );

    expect(failureLog).toBeTruthy();
    expect(failureLog.detail?.selectorTrace?.count).toBe(0);
    expect(Array.isArray(failureLog.detail?.visibleButtons)).toBe(true);
    expect(traceLogs.some((entry) => entry?.eventType === "run-failed")).toBe(true);
  });

  test("auto-accepts native alert dialogs during macro run", async () => {
    const runPage = await bundle.context.newPage();
    await runPage.goto(`${server.baseUrl}/native-alert-apply.html`);

    const runTabId = await findTabId(extensionPage, runPage.url());
    expect(runTabId).toBeTruthy();

    let dialogSeen = false;
    runPage.on("dialog", async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });

    const steps = [
      {
        type: "click",
        selector: "#set_apprv",
        label: "반영"
      }
    ];

    const runResponse = await sendRuntimeMessage(extensionPage, {
      type: "START_MACRO_RUN",
      tabId: runTabId,
      steps
    });
    expect(runResponse.ok).toBe(true);

    await expect
      .poll(async () => {
        return await runPage.textContent("#result");
      })
      .toBe("approved");

    await runPage.waitForTimeout(300);
    expect(dialogSeen).toBe(false);
  });

  test("saves and reloads named macros from the popup UI", async () => {
    const steps = [
      {
        type: "click",
        selector: "#openPopupBtn",
        label: "팝업 열기"
      },
      {
        type: "wait",
        ms: 1000
      }
    ];

    const setResponse = await sendRuntimeMessage(extensionPage, {
      type: "SET_STEPS",
      steps
    });
    expect(setResponse.ok).toBe(true);

    await extensionPage.fill("#macroNameInput", "기본 저장");
    await extensionPage.click("#saveMacroBtn");

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.savedMacros || []).length;
      })
      .toBe(1);

    await extensionPage.click("#clearBtn");

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).length;
      })
      .toBe(0);

    await extensionPage.selectOption("#savedMacroSelect", { label: "기본 저장" });
    await extensionPage.click("#loadMacroBtn");

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).map((step) => ({
          type: step.type,
          selector: step.selector || "",
          label: step.label || "",
          ms: step.ms || 0
        }));
      })
      .toEqual([
        {
          type: "click",
          selector: "#openPopupBtn",
          label: "팝업 열기",
          ms: 0
        },
        {
          type: "wait",
          selector: "",
          label: "",
          ms: 1000
        }
      ]);
  });

  test("reorders steps by dragging in the popup UI", async () => {
    const steps = [
      {
        type: "click",
        selector: "#firstBtn",
        label: "첫 단계"
      },
      {
        type: "wait",
        ms: 1000
      },
      {
        type: "click",
        selector: "#secondBtn",
        label: "둘째 단계"
      }
    ];

    const setResponse = await sendRuntimeMessage(extensionPage, {
      type: "SET_STEPS",
      steps
    });
    expect(setResponse.ok).toBe(true);

    await expect(extensionPage.locator("#stepsList .step-item").first()).toContainText("첫 단계");

    await extensionPage.dragAndDrop(
      "#stepsList .step-item:nth-child(1) [data-step-drag-handle='true']",
      "#stepsList .step-item:nth-child(3)"
    );

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return (storage.macroSteps || []).map((step) => step.label || step.type);
      })
      .toEqual(["wait", "둘째 단계", "첫 단계"]);
  });

  test("keeps wait-step editing open across popup auto-refresh", async () => {
    const setResponse = await sendRuntimeMessage(extensionPage, {
      type: "SET_STEPS",
      steps: [
        {
          type: "wait",
          ms: 1000
        }
      ]
    });
    expect(setResponse.ok).toBe(true);

    const stepItem = extensionPage.locator("#stepsList .step-item").first();
    await stepItem.getByRole("button", { name: "수정" }).click();

    const msInput = extensionPage.locator('[data-field="ms"]').first();
    await expect(msInput).toBeVisible();
    await msInput.fill("2500");
    await expect(msInput).toBeFocused();

    await extensionPage.waitForTimeout(1700);

    await expect(msInput).toBeVisible();
    await expect(msInput).toHaveValue("2500");
    await expect(msInput).toBeFocused();

    await stepItem.getByRole("button", { name: "저장" }).click();

    await expect
      .poll(async () => {
        const storage = await readStorage(extensionPage);
        return storage.macroSteps?.[0]?.ms || 0;
      })
      .toBe(2500);
  });
});
