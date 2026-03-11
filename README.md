# Doc Reception Macro

## 1. Summary
- Type: Chrome Extension (Manifest V3)
- Purpose: Record and replay repetitive document reception tasks in web pages
- Main language: Korean UI, JavaScript implementation
- Core behavior:
  - User actions on a page are recorded as `steps`
  - Recorded `steps` can be edited as JSON
  - The macro can replay the same actions later
  - Popup windows opened from the current workflow can be tracked automatically

## 2. File Map
- `manifest.json`: Chrome extension manifest
- `background.js`: Global state, recording control, macro execution, popup-tab tracking
- `content.js`: In-page recorder and step executor
- `popup.html`: Popup UI layout
- `popup.js`: Popup UI logic, JSON editing, button actions

## 3. Supported Features
### 3.1 Recording
- Record click actions
- Record text input changes
- Record `select` changes
- Auto-insert `wait` steps based on time gaps between actions
- Show an overlay on the page while recording

### 3.2 Execution
- Replay recorded steps in order
- Scroll target elements into view before interaction
- Wait for elements to appear with `waitFor`
- Wait for popup windows/tabs with `waitForPopup`
- Continue execution in a newly opened popup tab
- Return to the previous/root tab if a popup tab closes during execution

### 3.3 Editing
- View all recorded steps in the popup
- Reorder steps up/down
- Delete individual steps
- Clear all steps
- Edit the entire step list as raw JSON
- Copy step JSON to clipboard
- Add quick templates for `wait`, `waitFor`, and `waitForPopup`

### 3.4 State Feedback
- Badge states:
  - `REC`: recording
  - `RUN`: running
  - `POP`: waiting for popup
- Popup status text updates continuously
- Last execution message is shown in the popup result box

## 4. Installation
1. Open Chrome and go to `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder: `/workspaces/Macro`

## 5. Basic Usage
### 5.1 Record a macro
1. Open the target website
2. Click the extension icon
3. Click `기록 전체 삭제` if you want a fresh macro
4. Click `기록 시작`
5. Perform the work directly on the page
6. If the workflow opens a related popup/new tab, keep working there as well
7. Reopen the extension popup
8. Click `기록 종료`

### 5.2 Review and edit the recorded macro
1. Check the recorded step list in the popup
2. Reorder or delete steps if needed
3. Open the JSON editor section
4. Adjust selectors, timeouts, values, or popup URL conditions
5. Click `JSON 반영`

### 5.3 Run the macro
1. Open the starting page for the workflow
2. Click the extension icon
3. Verify the step list
4. Click `지금 실행`
5. The extension will execute steps in sequence
6. If a popup step exists, execution pauses until the popup tab is found or timeout is reached

## 6. Step Format
The extension stores macros as a JSON array.

Example:
```json
[
  {
    "type": "click",
    "selector": "#loginBtn",
    "label": "로그인"
  },
  {
    "type": "input",
    "selector": "input[name=\"title\"]",
    "value": "테스트 문서",
    "label": "제목"
  },
  {
    "type": "wait",
    "ms": 1000
  },
  {
    "type": "waitFor",
    "selector": ".result-row",
    "timeout": 10000,
    "interval": 200
  },
  {
    "type": "waitForPopup",
    "urlIncludes": "RegistArchiveDocDispatch.do",
    "timeout": 10000
  }
]
```

## 7. Step Types
### 7.1 `click`
Fields:
- `type`: must be `click`
- `selector`: CSS selector for target element
- `label`: optional human-readable label
- `timeout`: optional element wait timeout in ms

Behavior:
- Waits for the element
- Scrolls it into view
- Attempts click execution
- Has extra handling for checkbox-like UI wrappers

### 7.2 `input`
Fields:
- `type`: must be `input`
- `selector`: CSS selector
- `value`: string to set
- `label`: optional label
- `timeout`: optional wait timeout

Behavior:
- Waits until the element is visible
- Sets the value directly
- Fires `input` and `change` events

### 7.3 `select`
Fields:
- `type`: must be `select`
- `selector`: CSS selector
- `value`: option value
- `label`: optional label
- `timeout`: optional wait timeout

Behavior:
- Waits until the `select` is visible
- Sets the selected value
- Fires `input` and `change` events

### 7.4 `wait`
Fields:
- `type`: must be `wait`
- `ms`: delay in milliseconds

Behavior:
- Sleeps for the specified time

### 7.5 `waitFor`
Fields:
- `type`: must be `waitFor`
- `selector`: CSS selector to wait for
- `timeout`: max wait time in ms
- `interval`: polling interval in ms

Behavior:
- Repeats DOM lookup until the element exists or timeout is reached

### 7.6 `waitForPopup`
Fields:
- `type`: must be `waitForPopup`
- `urlIncludes`: optional substring expected in popup URL
- `timeout`: max wait time in ms

Behavior:
- Waits for a related popup/new tab
- If found, switches execution context to that tab
- If timeout expires, the macro fails

## 8. Recording Rules
- Recording is injected into the active tab when recording starts
- Related popup tabs can also be attached automatically
- Time gaps between recorded actions may become `wait` steps
- Only these action categories are recorded automatically:
  - click
  - input change
  - select change
- Restricted pages are not recordable:
  - `chrome://*`
  - `edge://*`
  - `about:*`
  - extension pages

## 9. Selector Strategy
The recorder tries to build stable CSS selectors using this priority:
1. Element `id`
2. Stable attributes such as `name`, `data-testid`, `data-test`, `data-qa`, `data-role`, `aria-label`, `title`
3. Stable class names
4. Fallback `nth-of-type` path

This means recorded selectors are usually usable immediately, but some dynamic pages may still require manual JSON edits.

## 10. Execution Flow
1. Popup sends `START_MACRO_RUN`
2. `background.js` stores run state
3. `background.js` injects `content.js` into the active tab if needed
4. Each step is executed one by one
5. For `waitForPopup`, execution pauses and monitors new/related tabs
6. When popup tab is detected, execution switches to that tab
7. If the popup tab closes, the extension tries to return to the previous or root tab
8. When all steps finish, run state resets to idle

## 11. Storage Model
Chrome local storage keys:
- `macroSteps`: saved step array
- `macroRecordingState`: current recording state
- `macroRunState`: current run state

## 12. Known Constraints
- The extension depends on DOM selectors, so UI changes can break macros
- Pages with heavy iframe/shadow DOM/custom rendering may need manual adjustment
- Restricted browser pages cannot be automated
- Unsupported step types are rejected during execution
- `value` is sanitized as string input in stored steps
- Popup matching for `waitForPopup` is based on related tab heuristics and optional URL substring matching

## 13. Recommended Editing Rules
For stable macros:
- Prefer unique IDs or `name`-based selectors
- Add explicit `wait` or `waitFor` after slow page transitions
- Use `waitForPopup` before actions that happen in a newly opened tab
- Keep `urlIncludes` short but distinctive
- Re-test after site UI changes

## 14. AI-Friendly Operational Summary
If another AI agent reads this repository, the practical interpretation is:
- This project is a Chrome macro recorder/executor for repetitive office-style web workflows
- `background.js` is the orchestration layer
- `content.js` is both the recorder and the single-step executor
- Macro data is a JSON array of typed steps
- The most important non-trivial feature is automatic popup/new-tab tracking during both recording and execution
- The popup UI is only a controller/editor; core behavior lives in background/content scripts

## 15. Quick Start Example
Minimal manual macro:
```json
[
  { "type": "click", "selector": "#btnSearch", "label": "조회" },
  { "type": "waitFor", "selector": ".search-result", "timeout": 10000, "interval": 200 },
  { "type": "click", "selector": ".search-result .open", "label": "문서 열기" },
  { "type": "waitForPopup", "urlIncludes": "detail", "timeout": 10000 },
  { "type": "input", "selector": "input[name=\"title\"]", "value": "자동 입력", "label": "제목" },
  { "type": "click", "selector": "button.save", "label": "저장" }
]
```
