# Doc Reception Macro

크롬 확장프로그램(Manifest V3) 기반의 웹 매크로 기록/실행 도구입니다.  
문서 접수, 편철접수, 결재라인 지정처럼 반복되는 사내 웹 업무를 기록한 뒤 그대로 다시 실행하는 용도입니다.

## 1. 현재 구성

### 실행에 필요한 파일
- `manifest.json`
- `background.js`
- `content.js`
- `popup.html`
- `popup.js`

### 개발/테스트용 파일
- `package.json`
- `package-lock.json`
- `tests/unit/content.test.js`
- `tests/unit/background.test.js`
- `tests/e2e/extension.spec.js`
- `tests/playwright.config.js`

### 생성되거나 로컬에만 필요한 파일
- `node_modules/`
- `test-results/`
- 그 외 개인 확인용 파일

실제로 확장프로그램만 로드해서 사용할 때는 실행용 5개 파일만 있으면 됩니다.

## 2. 주요 기능

### 기록
- `click`
- `key`
- `input`
- `select`
- `dropdownSelect`
- `wait`
- `waitFor`
- `waitForPopup`

### 실행
- 기록된 step 순차 실행
- 반복 실행
- 반복 실행 중 오류 시 현재 회차 1번 step부터 재시작 토글
- 페이지 우상단 `매크로 실행 중` 배지 숨기기 토글
- 실행 추적 전역 중지/재시작 버튼
- 실행 중지
- 요소 표시 전 스크롤/대기
- 새 창/팝업 자동 추적
- 팝업이 닫히면 이전/루트 탭으로 복귀 시도

### 관리
- 저장 매크로 이름 지정/불러오기/삭제
- 직전 기록 되돌리기
- step 드래그 정렬
- JSON 직접 편집/반영

### 현재 보강된 UI 대응
- PUDD 스타일 체크박스
- PUDD/커스텀 버튼
- 비밀번호 입력창 기록/재실행
- 같은 탭 안에서 뜨는 iframe 결재/비밀번호 창 재실행
- 같은 페이지 안 드롭다운/선택기
- 버튼을 눌러 열리는 picker형 선택기
- 팝업을 열어 값을 반영하는 선택기
- 열린 목록 안 옵션 클릭 시 부모 컨트롤이 아니라 실제 옵션 기록
- 실행 중 사이트의 네이티브 `alert`/`confirm` 자동 수락

### 진단 기능
- 실행 추적 로그 복사/삭제/새로고침
- 팝업에서 디버그 기록 켜기/끄기
- 디버그 로그 복사/삭제/새로고침
- 오류 로그 복사/삭제

## 3. 설치

1. Chrome에서 `chrome://extensions` 열기
2. `개발자 모드` 켜기
3. `압축해제된 확장 프로그램을 로드합니다` 클릭
4. 이 폴더를 선택

로컬에서 최소 실행 폴더만 따로 만들고 싶다면 아래 5개만 넣어도 됩니다.

```text
manifest.json
background.js
content.js
popup.html
popup.js
```

## 4. 기본 사용법

### 기록
1. 대상 페이지 열기
2. 확장 팝업 열기
3. 필요하면 `기록 전체 삭제`
4. `기록 시작`
5. 페이지에서 실제 업무 진행
6. 새 창이 뜨면 그 창에서도 계속 작업
7. 다시 팝업을 열고 `기록 종료`

### 수정
1. 팝업의 step 목록 확인
2. 드래그 또는 버튼으로 순서 변경/삭제/개별 편집
3. 필요하면 `직전 기록 되돌리기`
4. 필요하면 JSON 편집 영역에서 직접 수정
5. `JSON 반영`

### 실행
1. 시작 페이지 열기
2. 팝업 열기
3. step 목록 확인
4. 필요하면 반복 횟수/반복 간격, `반복 실행 중 오류 시 1번부터 재시작`, `매크로 실행중 숨기기` 토글 설정
5. `지금 실행`
6. 실행 중 문제가 나면 `실행 중지`

### 저장 매크로
1. 현재 step을 원하는 상태로 만든 뒤 매크로 이름 입력
2. `현재 매크로 저장`
3. 나중에 저장 목록에서 선택 후 `선택 매크로 불러오기`
4. 필요 없으면 `선택 매크로 삭제`

## 5. Step 형식

매크로는 JSON 배열로 저장됩니다.

```json
[
  { "type": "click", "selector": "#btnSearch", "label": "조회" },
  { "type": "key", "selector": "#agreeWrap", "label": "동의", "key": " ", "code": "Space" },
  { "type": "waitFor", "selector": ".result-row", "timeout": 10000, "interval": 200 },
  { "type": "click", "selector": ".result-row .open", "label": "문서 열기" },
  { "type": "waitForPopup", "urlIncludes": "detail", "timeout": 10000 }
]
```

### 지원 타입

#### `click`
- 필드: `selector`, `label?`, `timeout?`
- 일반 버튼/링크/체크박스/옵션 클릭에 사용

#### `key`
- 필드: `selector`, `key`, `code?`, `label?`, `timeout?`
- 현재는 `Space` 키 기록/실행에 사용
- 키보드로 체크박스나 포커스된 컨트롤을 조작해야 하는 흐름에 사용
- 기존 매크로나 수동 JSON에 `key`/`code`가 빠져 있어도 현재는 `Space`로 보정해 실행합니다

#### `input`
- 필드: `selector`, `value`, `label?`, `timeout?`
- 텍스트 입력에 사용
- `type="password"` 입력도 같은 방식으로 기록/실행됩니다
- `type="password"` 칸은 사이트에 따라 먼저 클릭 포커스가 필요할 수 있어서, 클릭 후 값을 바꾸면 `click`과 `input`이 함께 기록될 수 있습니다

#### `select`
- 필드: `selector`, `value`, `label?`, `timeout?`
- 네이티브 `<select>`에 사용

#### `dropdownSelect`
- 필드: `selector`, `value`, `label?`, `timeout?`
- 커스텀 드롭다운/선택기/PUDD 계열 선택기에 사용
- 실행 시 이미 원하는 값이 적용돼 있으면 안전하게 건너뜁니다

#### `wait`
- 필드: `ms`

#### `waitFor`
- 필드: `selector`, `timeout?`, `interval?`

#### `waitForPopup`
- 필드: `urlIncludes?`, `timeout?`

## 6. 현재 기록/실행 동작 기준

### 선택기 관련
- 같은 페이지 안에서 값이 바뀌는 선택기는 `dropdownSelect`로 기록될 수 있습니다
- 팝업을 여는 선택 버튼은 `click`으로 기록되고, 이어서 `waitForPopup`과 팝업 내부 step이 붙을 수 있습니다
- 값 반영까지 같은 흐름에서 감지되면 추가로 `dropdownSelect`가 기록될 수 있습니다
- 열린 목록 안에서 옵션 텍스트를 눌렀을 때는 부모 컨트롤이 아니라 실제 옵션 요소를 기록합니다

### 버튼 클릭 관련
- 일반 `button`/`input[type=button|submit|reset]` 계열은 합성 `mousedown`/`mouseup`보다 직접 `click()`을 우선해 사이트별 부작용을 줄입니다

### 팝업 관련
- 현재 작업 탭에서 새 창이 열리면 자동으로 기록 대상에 붙습니다
- 실행 시 `waitForPopup`이 있으면 관련 새 창을 기다린 뒤 그 창으로 실행 컨텍스트를 옮깁니다
- 관련 팝업 탭에서 기록된 일반 step도 URL 힌트를 함께 저장해서, 실행 시 이미 열려 있는 같은 팝업으로 먼저 전환할 수 있습니다
- 같은 탭이 새 창 대신 새로고침/재이동으로 이어지는 흐름이면 그 현재 탭 완료도 `waitForPopup`로 이어서 처리합니다
- 실행 시 top frame에서 selector가 안 잡혀도 활성 iframe/하위 iframe 힌트를 따라 같은 탭 내부 frame으로 내려가 다시 찾습니다
- 같은 origin iframe이면 frame id 해석이 늦더라도 상위 content script가 iframe DOM 안까지 다시 탐색해 selector 실행을 이어갑니다
- top 문서의 hidden input와 iframe 내부 실제 입력칸이 같은 selector를 공유하면, 실행 시 hidden보다 iframe 내부 실입력을 우선합니다
- popup 안 버튼이 부모창 새로고침/닫힘을 유발해도 가능한 한 부모 탭으로 복귀해 다음 step을 이어갑니다
- 클릭 직후 팝업 닫힘 또는 탭 새로고침 때문에 메시지 채널이 먼저 닫혀도, 실제 전환이 감지되면 해당 click step은 계속 완료 처리합니다
- 클릭 다음에 `wait`/`waitFor`가 이어지는 경우, 현재 탭 reload가 감지되면 그 reload 완료 뒤 다음 step으로 넘어가도록 안정화합니다
- 반복 실행에서 `반복 실행 중 오류 시 1번부터 재시작` 토글을 켜면, 실패한 현재 회차를 중단하지 않고 root 탭 기준 1번 step부터 다시 시작합니다
- `매크로 실행중 숨기기`를 켜면 페이지 우상단의 진행 배지를 그리지 않고 step만 조용히 실행합니다
- `실행 추적 중지`를 누르면 실행 추적 로그 적재 자체를 멈추고, 다시 누르면 `실행 추적 시작`으로 재개할 수 있습니다

### 브라우저 기본 다이얼로그 관련
- 사이트가 띄우는 브라우저 기본 `alert`/`confirm`은 DOM 클릭 step으로 기록되지 않습니다
- 대신 실행 중에는 관련 탭에서 자동 수락되도록 처리합니다
- 그래서 `결재자가 한 명일 때는 자동으로 전결처리 됩니다.` 같은 안내창은 별도 step 없이 넘어갈 수 있습니다

### 키보드 입력 관련
- 현재 `Space` 키는 별도 `key` step으로 기록할 수 있습니다
- `Space`로 인해 뒤따라오는 브라우저 기본 `click`은 중복 기록되지 않도록 막습니다
- 일반 텍스트 입력은 계속 `input` step으로 저장됩니다

### 저장 안정성
- 기록 직후 페이지 이동/리로드로 메시지 채널이 닫히는 경우를 대비해 직접 저장 fallback이 들어가 있습니다
- 기록 중 같은 탭 안에서 뒤늦게 생성된 iframe도 다시 감지해 입력/클릭 기록을 이어갑니다
- 상위 화면 클릭 뒤 iframe/팝업 안 입력으로 넘어가도 기록 간 대기 시간이 이어서 저장됩니다
- 기록 시작/종료와 디버그 상태 전파도 현재 탭의 하위 frame까지 함께 맞춥니다

### 팝업 편집 안정성
- step 편집 입력창을 사용하는 동안 팝업 자동 새로고침은 잠시 멈춥니다
- 그래서 대기 시간 같은 값을 수정할 때 입력 포커스가 1~2초마다 끊기지 않도록 동작합니다

## 7. 디버그 로그 사용법

문제가 나는 컨트롤을 분석할 때만 사용합니다.

1. 팝업에서 `디버그 켜기`
2. `기록 시작`
3. 문제 동작 재현
4. `기록 종료`
5. `디버그 로그 복사`

현재 디버그 로그에는 아래 정보가 들어갑니다.
- `pointerdown`, `mousedown`, `mouseup`, `keydown`, `click`, `change`
- `target`
- `ancestors`
- `clickable`
- `checkbox`
- `dropdown`
- `input`
- 실제 기록된 step

## 8. 실행 추적 로그 사용법

실행은 되지만 어디서 꼬였는지 모를 때 사용합니다.

1. 팝업에서 기존 `실행 추적 삭제`
2. 문제가 나는 매크로 실행
3. 실패 직후 팝업에서 `실행 추적 복사`

현재 실행 추적 로그에는 아래 정보가 들어갑니다.
- step 시작/성공/실패
- 실행 당시 URL, 탭 id, frame id, step index/type
- selector 매칭 개수와 앞쪽 후보 요소 요약
- visible 버튼 후보 목록
- 실제 클릭 방식
  `main-world click`, `element.click()`, `mouse sequence`
- selector 기준 frame 후보 점수와 실제 선택된 frame
- `waitForPopup` 후보 탭 점수와 전환/timeout 흐름
- 탭 생성/완료/닫힘과 복귀 처리 기록

## 9. 테스트

### 스크립트
- `npm test`
- `npm run test:unit`
- `npm run test:e2e`

### 현재 테스트 범위
- 메시지 채널 종료 시 저장 fallback
- 기록 시작 실패 처리
- 저장 매크로 저장/덮어쓰기
- 반복 실행
- 실행 중지
- 비밀번호 입력 기록
- 동적 iframe 내부 입력 기록
- 스페이스바 키 기록/실행
- 팝업 UI 드래그 정렬
- 팝업 자동 새로고침 중 step 편집 유지
- 팝업 기록/실행
- PUDD 체크박스/버튼
- 드롭다운 선택
- 버튼으로 여는 picker형 선택기
- 팝업형 선택기
- 열린 목록 안 옵션 선택 회귀
- popup 닫힘 후 부모 탭 복귀 실행
- click 직후 popup 닫힘/현재 탭 새로고침 복구
- 현재 탭 새로고침 기반 `waitForPopup` 처리
- 성공 응답 뒤 늦게 시작되는 현재 탭 reload 안정화
- 실행 중 네이티브 `alert`/`confirm` 자동 수락

`test:e2e`는 Playwright + Xvfb 기준입니다.

## 10. 파일 역할 요약

### `background.js`
- 전역 상태 관리
- 기록 시작/종료
- 실행 상태 관리
- 반복 실행 상태 관리
- 팝업/새 탭 연결
- 배지 상태 갱신

### `content.js`
- 페이지 내 이벤트 기록
- selector 생성
- 개별 step 실행
- 체크박스/드롭다운/선택기 보강 로직

### `popup.html`
- 확장 팝업 UI

### `popup.js`
- 팝업 버튼 동작
- step 목록 렌더링
- 저장 매크로 관리
- 반복 실행/실행 중지 제어
- JSON 편집
- 오류/실행 추적/디버그 로그 처리

## 11. 주의사항

- 이 확장은 DOM selector 기반이라 사이트 UI가 바뀌면 매크로도 깨질 수 있습니다
- iframe/shadow DOM/custom renderer 비중이 큰 페이지는 추가 보정이 필요할 수 있습니다
- `chrome://`, `edge://`, `about:` 같은 제한 페이지는 자동화할 수 없습니다
- 동적 페이지에서는 `wait`, `waitFor`, `waitForPopup`를 적절히 넣어야 안정적입니다

## 12. 권장 운영 방식

- 가능한 한 `id`, `name`, 고유 속성이 있는 요소 중심으로 기록
- 새 창이 뜨는 단계는 반드시 실제 흐름대로 기록
- 사이트가 느리면 `wait`보다 `waitFor`/`waitForPopup` 우선
- 재현이 잘 안 되는 실행 오류는 `실행 추적`부터 확인하고, 요소 판별 자체가 의심되면 `디버그 기록`을 함께 사용
- 문제가 나는 컨트롤은 디버그 로그로 먼저 target/ancestors/clickable 판별 결과 확인
- 테스트 파일은 유지하고, 실제 배포 폴더만 따로 복사해서 쓰는 편이 관리가 쉽습니다

## 13. 저장소 작업 규칙

- 코드나 동작을 바꾸면 기본적으로 `npm test`까지 실행해 검증합니다
- 기존 로직을 수정할 때는 부분 확인만 하지 않고 전체 회귀 검증을 우선하며, 주변 흐름까지 확인할 수 있도록 회귀 테스트를 추가하거나 보강합니다
- 검증이 끝난 변경은 특별한 요청이 없으면 커밋 후 `origin/main`에 푸시합니다
- UI/기능/테스트 흐름이 바뀌면 README와 저장소 작업 규칙 문서를 같이 갱신합니다
- 세션이 바뀌어도 같은 규칙을 따를 수 있도록 저장소 루트의 `AGENTS.md`를 함께 유지합니다
- 세션이 바뀌어도 같은 기준으로 작업할 수 있도록 저장소 루트의 `AGENTS.md`를 유지합니다
