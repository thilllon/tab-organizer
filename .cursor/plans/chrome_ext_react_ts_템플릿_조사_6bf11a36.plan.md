---
name: Chrome Ext React TS 템플릿 조사
overview: Google/Vite 공식 Chrome Extension + React + TypeScript 템플릿은 없고, 대신 커뮤니티에서 널리 쓰이는 create-chrome-ext(Vite 기반, React+TS 지원) 등으로 새 프로젝트를 만드는 것이 가능합니다.
todos: []
isProject: false
---

# Chrome Extension을 React + TypeScript로 재구성하기: 템플릿 옵션 정리

## 결론: “공식” 템플릿은 없음

- **Google**: Chrome Extension용 **React/TypeScript 전용 공식 스캐폴드나 템플릿은 제공하지 않습니다.** [Chrome for Developers](https://developer.chrome.com/docs/extensions/get-started)에는 HTML/CSS/JS 기반 가이드와 문서만 있습니다.
- **Vite**: Vite 저장소/공식 문서에는 **“Chrome Extension” 전용 공식 템플릿은 없습니다.** `create-vite`는 일반 웹앱용만 제공합니다.

그래서 “Google에서 직접 제공”하거나 “Vite에서 공식 제공”하는 Chrome Ext + React + TS 템플릿은 **없고**, **커뮤니티 템플릿/스캐폴드**를 쓰는 방식이 현실적입니다.

---

## 추천: create-chrome-ext (Vite + React + TypeScript)

**가장 많이 쓰이는 커뮤니티 스캐폴드**는 [create-chrome-ext](https://github.com/guocaoyi/create-chrome-ext)입니다.

- **기반**: **Vite** (HMR, 빠른 빌드)
- **지원**: React · Vue · Svelte · Preact · Solid 등 + **JavaScript / TypeScript**
- **React + TypeScript**: `--template react-ts` 로 생성 가능
- **구성**: Background, Content, Popup, Options, SidePanel, DevTools, NewTab 등 크롬 익스텐션에 필요한 페이지/스크립트 구조를 갖춤
- **사용법 예시** (npm 7+):
  ```bash
  npm create chrome-ext@latest my-tab-organizer -- --template react-ts
  ```

즉, “Vite에서 제공하는” 건 아니지만, **Vite를 사용하는** Chrome Extension용 React+TS 템플릿을 한 번에 뽑아주는 도구라고 보면 됩니다.

---

## 다른 선택지 (참고용)


| 옵션                                                                                                                        | 설명                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [chrome-extension-boilerplate-react-vite](https://github.com/thomaskiljanczykdev/chrome-extension-boilerplate-react-vite) | Vite 7, React 19, TypeScript, Manifest V3. 별도 보일러플레이트 저장소. |
| [crx-vite-ts-react-template](https://github.com/50ra4/crx-vite-ts-react-template)                                         | Vite + TS + React 전용 템플릿.                                  |
| [chrome-extension-starter-vite](https://github.com/matheuscoelhomalta/chrome-extension-starter-vite)                      | Vite + React + TS + Tailwind.                              |


원하시면 “create-chrome-ext로 생성한 뒤, 기존 Simple Tab Sorter의 동작(탭 정렬/그룹 등)을 어떻게 옮길지”까지 이어서 계획할 수 있습니다.

---

## 현재 프로젝트와의 관계

현재 **[original**/src/manifest.json](__original__/src/manifest.json)은 **Manifest V3**, `tabs`, `tabGroups`, `storage`, **service worker** 기반 background, **popup**, **options_page** 구조입니다.  
React+TS 템플릿으로 새 프로젝트를 만든 다음, 이 manifest 권한/페이지 구성을 맞추고 기존 `background.js`, `popup.js`, `options.js` 로직을 React 컴포넌트/타입스크립트로 이식하는 방식이 자연스럽습니다.

요약하면, **Google/Vite 공식 템플릿은 없고**, **create-chrome-ext의 `react-ts` 템플릿**을 쓰면 Vite + React + TypeScript로 크롬 익스텐션을 다시 만드는 것이 가능합니다.