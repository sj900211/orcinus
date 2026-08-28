# upstream 동기화 인수인계

**상태**: 연기(두 차례 시도). 이 문서는 다음 담당자가 바로 이어받도록 "이미 해결된 것 / 남은 유일한 블로커 / 정확한 절차"를 정리한다.

---

## 요약 (TL;DR)

`upstream/main`(stablyai/orca) 병합은 **거의 전부가 기계적이거나 이미 해결법이 확정**됐고, **딱 하나의 feature-scale 블로커**만 남았다: 원정 2 "New Window"의 **창별(per-window) PTY 스트림 전달 서브시스템(약 1,500줄)을 upstream이 분할한 `./pty/*` 구조 위에 재구현**하는 일. 이것만 별도 작업(전용 기능 던전)으로 처리하면 동기화가 완결된다.

## 배경

- 대상·전략: `main`에 `upstream/main` 병합(main-우선). `main`은 `origin/main`을 추적·푸시돼 있어 **복구는 항상 `git reset --hard origin/main`** (한 번이라도 비충돌 파일을 편집하면 `git merge --abort`는 실패한다).
- SFTP 작업은 `feat/sftp`(= main + SFTP)에 있고 upstream과 **0 충돌**. 병합은 `main`에서 하고, 이후 `main`→`feat/sftp`.
- 현재 격차: `main`은 이미 과거 127커밋 병합을 포함, 그 이후 upstream이 더 진행해 **201커밋 뒤**(측정일 기준).

## 자동 병합에서 보존되는 정체성 (매번 확인)

- `package.json`: `name: orcinus`
- `config/electron-builder.config.cjs`: `appId com.sj900211.orcinus`, `productName Orcinus`

## 충돌 지형

- **14개 충돌**(전부 원정 2 New Window 계열: window / terminals / session / ipc-events / pty) + `AGENTS.md`(코드 스타일). 텍스트 충돌은 작음(마커 약 25개) → **파일당 에이전트 1개 병렬 해결** 가능.
- `AGENTS.md`는 upstream이 상위집합이므로 upstream 채택.

## 해결됨 ① — 기계적 5건 (병합 후 타입체크)

1. `window/main-window-contracts.ts` `CreateMainWindowOptions`: `role?: 'main'|'workspace'` + `initialBounds?: { x?; y?; width; height }` 추가.
2. `store/terminals/terminal-contracts.ts` `ReconnectPersistedTerminalsOptions.directSshAuthority?` 옵셔널화 → `store/terminals/workspace-terminal-reconnect.ts`를 optional-safe 접근으로: `options?.directSshAuthority?.targetId`, 권위 검사(`isCurrentDirectSshAuthority`)는 `options?.directSshAuthority &&`로 게이트, 권위가 있을 때만 targetId로 스코핑.
3. `web/preload-api/web-workspace-session-api.ts` 세션 객체에 웹 no-op 4개: `onCheckpointRequest: () => noopUnsubscribe`, `sendCheckpointReply: () => {}`, `handbackProjectSessionSync: () => {}`, `onProjectSessionHandback: () => noopUnsubscribe`.

## 해결됨 ② — pty 게이트 재직조 (arg 15건 → 테스트 15개 통과)

upstream이 `pty.ts`(모놀리스)를 `./pty/*` 배럴+서브모듈로 분할했다. 서브모듈은 Orcinus의 **창별 게이트**(`pty-hidden-delivery-gate.ts`, 변경 불필요)를 옛 인자 개수로 호출 → 15개 arg 불일치.

- **근본 원인**: 병합이 `pty/register-handlers.ts`의 라우터 주입을 **누락**한다. 복원 필요: `setMainWindowForRouting(mainWindow)` + `setPtyWorktreeResolverForRouting(...)` + `setProjectKeyResolverForRouting(...)`. 없으면 `resolvePtyOwnerWindow`가 null을 반환해 게이트가 전혀 동작하지 않는다.
- **인자 규칙**(모놀리스 대조):
  - `markHiddenRendererPty(webContentsId, id)` / `unmarkHiddenRendererPty(webContentsId, id)` = **보고 창** id.
    - 인터랙티브(`pty:setHiddenRendererPty`) = `event.sender.id`.
    - spawn = `resolveWorktreeOwnerWindow(worktreeId).webContents.id`(폴백 mainWebContents). → spawn 경로에 `worktreeId`를 8개 호출부에 스레딩.
  - 전달 결정 = `shouldDropHiddenRendererPtyDataForOwner(id, settings)` (소유 창; `pty/pty-owner-gate.ts` 래퍼가 `resolvePtyOwnerWindow`로 해석).
- 적용 파일: `hidden-transition.ts`, `session.ts`, `wire-session.ts`, `ipc/resize-visibility.ts`, spawn 8개 파일. → `pty-ipc-hidden-delivery-gate.test.ts` + `pty-hidden-at-spawn-mark.test.ts` 통과, 타입체크 0.

## 남은 유일한 블로커 — 창별 스트림 전달 서브시스템 (feature-scale)

`pty-project-window-stream-routing.test.ts`(7건)는 게이트가 아니라 **멀티윈도우 PTY 스트림 전달 전체**를 검증한다. upstream 분할은 이 서브시스템을 **평면 단일-창 `session`**으로 대체해 버렸다(단일 `flushTimer`, `sendPtyDataToRenderer`/`sendModelRestoreNeededMarker`가 `session.mainWindow.webContents`에 하드와이어, owner/ackBase 없음).

원상 복구 = 모놀리스의 다음을 upstream 분할 위에 **재구현**:
- `windowFlowStates` Map + `RendererWindowFlowState` + `createWindowFlowState` / `ownerFlowStateForPty` / `ackAttributionFlowState`
- per-owner 필드(`ownerWebContentsId`, `ackBaseChars`), `resetWindowScopedDeliveryStateForLifecycle`
- 약 1,500줄, 60+ 참조 · `payload.ts`/`accept.ts`/`flush.ts`/`accounting.ts`/`exit.ts`/`resize-visibility.ts`/`debug.ts` 재배선 + `PtyIpcSession` 형태 변경

7개 테스트가 요구하는 동작:
1. `pty:data`/`pty:exit`/`pty:spawned`를 **소유 창**으로 라우팅
2. 창별 dispatcher-ready 게이팅
3. per-owner ACK 귀속 + baseline 할인
4. 소유 창 변경 시 `delivery-heal` 마커
5. 창 파괴 시 메인으로 이관 + `renderer-window-closed`/복원 마커

**중요**: 반쪽 이식은 단일-창 전달까지 오염시킨다 → all-or-nothing. 전용 작업으로 스코핑할 것.

## 무시해도 되는 것 (기존/환경)

병합 트리에서 셸/WSL 테스트 4건(`pty-wsl-cwd-validation`, `pty-login-shell-startup-commands`, `pty-daemon-spawn-wsl-runtime`) 실패 = Windows 경로 구분자(`shell-ready\zsh` vs `/`) + upstream의 daemon-PATH 변경 계열. 병합·창별 로직과 무관.

## 병합 후 참고

- 병합으로 새 의존성이 들어오면 `pnpm install` 후 dev 실행(누락 시 Cannot-find-module).
- 분할 후 upstream pty 개선 커밋도 반영 검토: `94f231737d`·`d60a3c900b`·`26721bd632`·`0bfd3808f6`.

## 절차 요약

1. `git switch main` → `git merge upstream/main`
2. 14개 텍스트 충돌 해결(정체성 확인)
3. 기계적 5건 + pty 게이트 재직조(위) → 타입체크 0
4. **창별 스트림 전달 서브시스템 재구현**(블로커) → `pty-project-window-stream-routing` 통과
5. 전체 pty 테스트 + 빌드 + 멀티윈도우 터미널 수동 검증
6. `main`→`feat/sftp` 병합
