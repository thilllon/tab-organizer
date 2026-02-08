---
name: 의존성 정리 및 Biome 전환
overview: package.json의 모든 의존성을 비운 뒤 pnpm으로 최신 패키지를 재설치하고, prettier를 완전히 제거한 뒤 biome로 교체합니다.
todos:
  - id: clear-deps
    content: package.json에서 dependencies/devDependencies 전부 비우고 fmt 스크립트 제거
    status: completed
  - id: reinstall
    content: mise 기반 pnpm으로 필요한 패키지 최신 버전 재설치
    status: completed
  - id: remove-prettier
    content: .prettierrc, .prettierignore 파일 삭제
    status: completed
  - id: setup-biome
    content: biome init + biome.json 설정 + fmt 스크립트를 biome로 교체
    status: completed
  - id: update-manifest
    content: manifest.ts에 tabs, tabGroups 권한 추가
    status: completed
  - id: port-background
    content: background.js 탭 정렬 로직을 src/background/index.ts로 TypeScript 이식
    status: completed
isProject: false
---

# 의존성 초기화 및 Prettier -> Biome 전환

## 1. package.json 의존성 전부 제거

[package.json](package.json)에서 `dependencies`와 `devDependencies`의 모든 항목을 비웁니다.

```json
"dependencies": {},
"devDependencies": {}
```

`fmt` 스크립트도 prettier 기반이므로 제거합니다.

## 2. pnpm으로 패키지 재설치 (mise 기반)

[mise.toml](mise.toml)에 명시된 버전(node 24.13.0, pnpm 10.28.2)을 사용합니다.

필요한 패키지를 하나씩 최신 버전으로 설치:

- **dependencies**: `react`, `react-dom`
- **devDependencies**:
  - 빌드: `vite`, `@vitejs/plugin-react`, `@crxjs/vite-plugin`, `typescript`
  - 타입: `@types/chrome`, `@types/react`, `@types/react-dom`
  - 패키징: `gulp`, `gulp-zip` (zip 스크립트에서 사용)
  - 포맷/린트: `@biomejs/biome` (prettier 대체)

## 3. Prettier 잔재 완전 제거

삭제할 파일:

- [.prettierrc](.prettierrc)
- [.prettierignore](.prettierignore)

수정할 파일:

- [package.json](package.json): `"fmt"` 스크립트를 biome 기반으로 교체

## 4. Biome 설정 추가

- `pnpm biome init`으로 `biome.json` 생성
- 기존 `.prettierrc` 설정(singleQuote, printWidth 100, semi false, tabWidth 2, trailingComma all, LF)에 맞춰 biome formatter 설정 조정
- `package.json`의 `fmt` 스크립트를 `biome check --write .`으로 교체

## 5. manifest.ts 권한 업데이트

현재 [src/manifest.ts](src/manifest.ts)의 `permissions`가 `['sidePanel', 'storage']`만 있는데, 탭 정렬 기능에 필수적인 `tabs`와 `tabGroups`를 추가합니다.

```ts
permissions: ['tabs', 'tabGroups', 'storage'],
```

불필요한 `sidePanel` 권한은 제거합니다 (탭 정렬 익스텐션에 sidePanel은 필요 없음).

## 6. background.js 로직을 TypeScript로 이식

**[original**/src/background.js](**original**/src/background.js) (312줄)의 핵심 탭 정렬 로직을 [src/background/index.ts](src/background/index.ts)로 이식합니다.

동작 흐름:

- 유저가 익스텐션 아이콘 클릭 -> popup 열림 -> popup이 `chrome.runtime.sendMessage({ type: "click_event" })` 전송
- background가 메시지를 수신 -> `sortTabGroups()` 실행

이식할 핵심 함수들 (TypeScript화):

- `sortTabGroups()`: 현재 윈도우의 탭 그룹 정렬 (pinned tabs 처리, tab groups 이동, ungrouped tabs 정렬)
- `sortTabs()`: 설정에 따라 title/url/custom 정렬 분기
- `sortByTitleOrUrl()`: 제목 또는 URL 기반 정렬 (suspended tab 처리 포함)
- `sortByCustom()`: 사용자 정의 그룹 순서 기반 정렬
- 유틸 함수: `isSuspended()`, `tabToUrl()`, `updateTabGroupMap()`, `compareByUrlComponents()`
- `chrome.runtime.onInstalled` 리스너 (설치/업데이트 처리)

주요 TypeScript 개선:

- `chrome.tabs.Tab` 타입 활용
- 설정값 인터페이스 정의 (`SortSettings`)
- `var` -> `const`/`let`, 콜백 -> async/await 전환
- strict null check 대응
