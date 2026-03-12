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
- `input`
- `select`
- `dropdownSelect`
- `wait`
- `waitFor`
- `waitForPopup`

### 실행
- 기록된 step 순차 실행
- 요소 표시 전 스크롤/대기
- 새 창/팝업 자동 추적
- 팝업이 닫히면 이전/루트 탭으로 복귀 시도

### 현재 보강된 UI 대응
- PUDD 스타일 체크박스
- PUDD/커스텀 버튼
- 같은 페이지 안 드롭다운/선택기
- 버튼을 눌러 열리는 picker형 선택기
- 팝업을 열어 값을 반영하는 선택기
- 열린 목록 안 옵션 클릭 시 부모 컨트롤이 아니라 실제 옵션 기록

### 진단 기능
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
2. 순서 변경/삭제/개별 편집
3. 필요하면 JSON 편집 영역에서 직접 수정
4. `JSON 반영`

### 실행
1. 시작 페이지 열기
2. 팝업 열기
3. step 목록 확인
4. `지금 실행`

## 5. Step 형식

매크로는 JSON 배열로 저장됩니다.

```json
[
  { "type": "click", "selector": "#btnSearch", "label": "조회" },
  { "type": "waitFor", "selector": ".result-row", "timeout": 10000, "interval": 200 },
  { "type": "click", "selector": ".result-row .open", "label": "문서 열기" },
  { "type": "waitForPopup", "urlIncludes": "detail", "timeout": 10000 }
]
```

### 지원 타입

#### `click`
- 필드: `selector`, `label?`, `timeout?`
- 일반 버튼/링크/체크박스/옵션 클릭에 사용

#### `input`
- 필드: `selector`, `value`, `label?`, `timeout?`
- 텍스트 입력에 사용

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

### 팝업 관련
- 현재 작업 탭에서 새 창이 열리면 자동으로 기록 대상에 붙습니다
- 실행 시 `waitForPopup`이 있으면 관련 새 창을 기다린 뒤 그 창으로 실행 컨텍스트를 옮깁니다

### 저장 안정성
- 기록 직후 페이지 이동/리로드로 메시지 채널이 닫히는 경우를 대비해 직접 저장 fallback이 들어가 있습니다

## 7. 디버그 로그 사용법

문제가 나는 컨트롤을 분석할 때만 사용합니다.

1. 팝업에서 `디버그 켜기`
2. `기록 시작`
3. 문제 동작 재현
4. `기록 종료`
5. `디버그 로그 복사`

현재 디버그 로그에는 아래 정보가 들어갑니다.
- `pointerdown`, `mousedown`, `mouseup`, `click`, `change`
- `target`
- `ancestors`
- `clickable`
- `checkbox`
- `dropdown`
- `input`
- 실제 기록된 step

## 8. 테스트

### 스크립트
- `npm test`
- `npm run test:unit`
- `npm run test:e2e`

### 현재 테스트 범위
- 메시지 채널 종료 시 저장 fallback
- 기록 시작 실패 처리
- 팝업 기록/실행
- PUDD 체크박스/버튼
- 드롭다운 선택
- 버튼으로 여는 picker형 선택기
- 팝업형 선택기
- 열린 목록 안 옵션 선택 회귀

`test:e2e`는 Playwright + Xvfb 기준입니다.

## 9. 파일 역할 요약

### `background.js`
- 전역 상태 관리
- 기록 시작/종료
- 실행 상태 관리
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
- JSON 편집
- 오류/디버그 로그 처리

## 10. 주의사항

- 이 확장은 DOM selector 기반이라 사이트 UI가 바뀌면 매크로도 깨질 수 있습니다
- iframe/shadow DOM/custom renderer 비중이 큰 페이지는 추가 보정이 필요할 수 있습니다
- `chrome://`, `edge://`, `about:` 같은 제한 페이지는 자동화할 수 없습니다
- 동적 페이지에서는 `wait`, `waitFor`, `waitForPopup`를 적절히 넣어야 안정적입니다

## 11. 권장 운영 방식

- 가능한 한 `id`, `name`, 고유 속성이 있는 요소 중심으로 기록
- 새 창이 뜨는 단계는 반드시 실제 흐름대로 기록
- 사이트가 느리면 `wait`보다 `waitFor`/`waitForPopup` 우선
- 문제가 나는 컨트롤은 디버그 로그로 먼저 target/ancestors/clickable 판별 결과 확인
- 테스트 파일은 유지하고, 실제 배포 폴더만 따로 복사해서 쓰는 편이 관리가 쉽습니다
