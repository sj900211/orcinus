# 🗺 월드맵 — Orcinus 원정 전도

> **단일 진실 공급원** — 전체 진행 현황은 이 문서가 기준이다. (창설: 2026-08-19)
> 규칙: 던전·원정의 **클리어 표시는 제작자의 판정 후에만** 기록한다 (→ `collab-protocol` 판정 게이트).

## 📍 현재 위치

**🏆 원정 3 클리어(2026-08-28 제작자 판정)** — 세 요구 원정(리브랜딩·New Window·SFTP) 모두 완료. 던전 8(9항목)·10(뷰어→네이티브 에디터)·11(Split+DnD 업/다운로드 드롭)·다중선택 압축·원격 마크다운 프리뷰·원격 탭 아이콘 전부 승인, **보스전 D9**(통합 게이트 통과 → `build:win` 설치기 `dist\orcinus-windows-setup.exe` 생성 → 제작자 설치·수동 검증) 완료. **잔여(요구 외 유지보수)**: upstream 재동기화 = 창별 PTY 딜리버리 재이식 전용 던전(연기, 메모리 기록). 다음: `/report` 결산.

## 🌍 원정 전도

| 원정 | 이름 | 난이도 | 상태 |
|---|---|---|---|
| 원정 1 | Fork & 리브랜딩 | ★ 모험가 | 🏆 클리어 (2026-08-20) |
| 원정 2 | New Window | ★★ 베테랑 | 🏆 클리어 (2026-08-24) |
| 원정 3 | SFTP 원양 탐사 | ★★★ 영웅 | 🏆 클리어 (2026-08-28 제작자 판정) |

- 원정 2·3의 던전 구성은 각 원정의 **정찰** 후 확정한다 (봉인 해제 시).
- 원정 사이마다 **upstream 동기화**(원본 병합)를 수행한다.

## ⚔️ 원정 1 — Fork & 리브랜딩 (던전 목록)

| # | 던전 | 내용 | 상태 |
|---|---|---|---|
| 1 | 정찰 | 빌드 요구사항·리브랜딩 지점·장비 점검 | ✅ 클리어 (2026-08-19 제작자 판정) |
| 2 | 베이스캠프 | fork → clone → upstream 등록 → 도구·의존성 설치 | ✅ 클리어 (2026-08-19 제작자 판정) |
| 3 | 첫 불꽃 | 원본 그대로 dev 실행 + Windows 빌드 산출물 확인 (기준선 · 설치는 던전 5로 — appId 충돌 방지) | ✅ 클리어 (2026-08-19 제작자 판정) |
| 4 | 변신 | 이름·아이콘 리브랜딩 (`feat/rebrand` 브랜치, 커밋 `61dcdd4a5`) | ✅ 클리어 (2026-08-19 제작자 판정) |
| 5 | 보스전 | 리브랜딩 빌드 설치·사용 테스트 (3페이즈 보스 + 5-3a~c 소탕) | ✅ 클리어 (2026-08-20 제작자 판정) |

세부 퀘스트: [미니맵/원정1-포크와-리브랜딩.md](미니맵/원정1-포크와-리브랜딩.md)

## 🪟 원정 2 — New Window (던전 목록, 2026-08-20 확정)

| # | 던전 | 내용 | 상태 |
|---|---|---|---|
| 1 | 정찰 🔭 | 창·워크스페이스 구조 조사, B안 확정 | ✅ 클리어 (2026-08-20 제작자 판정) |
| 2 | 설계 청사진 📐 | 심층 정찰 + B안 상세 설계 | ✅ 클리어 (2026-08-20 제작자 판정) |
| 3 | 창 소환술 | 지정 워크스페이스로 두 번째 창 열기 | ✅ 클리어 (2026-08-20 제작자 판정) |
| 4 | 통로 공사 | 터미널 스트림·알림 창별 라우팅 (+세션 인수인계·마운트 게이트 격파) | ✅ 클리어 (2026-08-20 제작자 판정) |
| 5 | 표식과 소환진 | 사이드바 표식·컨텍스트 메뉴·창 승격 (+v2 프로젝트 단위·v3 스코핑·v4 메인 소유) | ✅ 클리어 (2026-08-21 제작자 판정) |
| 6 | 보스전 🐋 | 전체 검증·빌드·설치·통합 검증 (닫힘 세션 인계 버그 수정 포함) | ✅ 클리어 (2026-08-24 제작자 판정) |

세부 퀘스트: [미니맵/원정2-뉴-윈도우.md](미니맵/원정2-뉴-윈도우.md)

## 🌊 원정 3 — SFTP 원양 탐사 (던전 목록, 2026-08-25 개정)

| # | 던전 | 내용 | 상태 |
|---|---|---|---|
| 1 | 정찰 🔭 | ssh2/SFTP 가능성·인프라 재활용·경로 방식(A→B) | ✅ 클리어 (2026-08-24) |
| 2 | 설계 청사진 📐 | IPC 계약·Server Explorer 재활용·경로 방식 확정 | ✅ 클리어 (2026-08-24) |
| 3 | 통로 개통 🚇 | relay-free SFTP IPC 백엔드(readdir/realpath/up·download/progress/cancel) + 적대적 리뷰 강화(14확인→10수정) · 실서버 검증 · 커밋 `d7690fd481` | ✅ 검증·커밋 · 판정 보류(원정 재조정) |
| 4 | 원격 등록소 🛖 | 워크트리 SSH와 분리된 **별도 `SFTP Hosts` 레지스트리**(설정 섹션) + **비밀번호 인증**(OS 암호화 저장) | 🏆 클리어 (2026-08-25) · 커밋 `5f8abbcd85` |
| 5 | 서버 탐색기 🗂 | SSH 탭 + Server Explorer 트리(FileExplorer 재활용, **SFTP Hosts 대상 선택**) | 🏆 클리어 (2026-08-25) · 커밋 `696c28b430` |
| 6 | 경로 설정 🧭 | SFTP 호스트에 **탐색기 시작 경로**(basePath): 텍스트 입력 + 실시간 존재 검증(없으면 저장 불가) + `ls` 자동완성 드롭다운(draft 프로브 연결) · 공백=루트 | 🏆 클리어 (2026-08-26) · 커밋 `1e1cc95096` |
| 7 | 화물 하역 ⚓ | 우클릭 다운로드/업로드 + 진행률(A안) | ✅ 7-A 커밋 `a4a62127ac` · Split+DnD(B안) 후속 |
| 8 | 화물 하역 심화 ⚙️ | 원자적 롤백·새 디렉토리·DnD 이동·삭제·폴더 업로드·업로드 충돌 프롬프트·자동 새로고침·용량/권한 표시·tar.gz 압축 다운로드 (9항목·커밋 8건) | 🏆 클리어 (2026-08-27 제작자 판정) |
| 9 | 보스전 🐋 | 통합·빌드·설치·검증 → 원정 클리어 | ⏳ 대기 |

> 🕊️ **후속 퀘스트**: ① Split 패널 + Drag&Drop 전송(던전 7 B안) — 대기 · ② ~~SFTP 파일 내용 뷰어~~ → 🏆 던전 10 성공 확인(2026-08-27, 커밋 `91a20410a5`) · ③ 다중선택 압축 다운로드 — 대기.

> 🕊️ **후속 퀘스트**(제작자 요청, 원정 후반): SFTP 탐색기 **파일 내용 뷰어**(행 클릭 → 원격 파일을 Monaco 뷰어로 열기).

세부 퀘스트: [미니맵/원정3-SFTP-원양탐사.md](미니맵/원정3-SFTP-원양탐사.md)

## 🧭 추적

- 🕳️ **히든 퀘스트** (빼먹은 것): ① ~~VS 2022 Build Tools 설치~~ → ✅ 처치 완료 (2026-08-19) ② **데몬 호스트 정체성 미분리** (2026-08-19 발견): `daemon-host-relocation.ts`의 `LOCAL_HOST_ROOT_NAME='Orca'`·`DAEMON_HOST_EXE_NAME='orca-terminal-daemon.exe'`가 원본과 공유됨 → Orcinus를 **진짜 언인스톨**하면 NSIS가 `taskkill orca-terminal-daemon.exe` + `%LOCALAPPDATA%\Orca\daemon-host` 폴더 삭제로 **Orca의 터미널 데몬까지 파괴**(역방향도 동일). 업데이트 설치는 `${isUpdated}` 가드로 무해. 처리 시점(원정 1 내 vs 보류) 제작자 판정 대기
- 💀 **놓쳐버린 적** (의도와 다르게 된 것): ① 1차 install이 `pnpm-lock.yaml`을 고쳐 씀 → git restore로 원상 복구 (재발 시 동일 처방) ② `CI=true`로 돌린 빌드가 마지막에 GitHub 릴리스 업로드를 시도 → 무해하게 실패. 처방: 로컬 빌드는 CI=true 없이 + `--publish never` ③ **"최소 리브랜딩" 판단 미스로 package.json `name` 미변경** → Orcinus가 원본 설치 폴더(`Programs\orca`)를 점거하고 2차 설치가 Orca.exe를 삭제 → Orca 재설치로 복구(프로필 무사). 처방 = 길드 규약 **판례 1호** (정체성 3층 분리) ④ **던전 4의 publish 수정으로는 자동 업데이트 함정이 안 죽음** — 런타임 코드가 원본 피드를 하드코딩(`setFeedURL`이 app-update.yml을 덮어씀) → 설치본에 원본 Orca 업데이트 알림(클릭 시 원본으로 교체됨). 처방은 미니맵 5-2g에서 선택
- 🧭 **upstream 재동기화 — 시도→연기** (2026-08-27, 전용 세션 필요): upstream/main(186커밋 뒤처짐)을 `main`에 병합 시도. **정체성(name=orcinus·appId `com.sj900211.orcinus`·productName Orcinus) 자동병합 보존 확인**. 충돌 14개(전부 원정 2 New Window 계열) 병렬 해결. 검증: web 0·node 18(전부 pty). **연기 사유 = pty 분할 충돌**: upstream이 `pty.ts`(8000줄)를 `./pty/*` 모듈로 분할(서브모듈 순수 upstream), 그런데 Orcinus New Window(`44d95e63b7`)가 공유 전달게이트(`pty-hidden-delivery-gate.ts`의 `shouldDropHiddenRendererPtyData`를 창별 + `...InAnyWindow`)를 재작성 → 분할본이 옛 시그니처로 16곳 호출 불일치. **정석 = New Window 창별 터미널 라우팅을 upstream 분할에 재이식(기능 규모·다중창 회귀 위험)** → `git merge --abort`로 원복. **다음 시도용 해결법(기계적 5건 확정)**: (1) `register-core-handlers.ts`에 `import { app } from 'electron'` (2) `main-window-contracts.ts`에 `role?: 'main'|'workspace'` + `initialBounds?: {x?;y?;width;height}` (3) `terminal-contracts.ts` `directSshAuthority?` optional + `workspace-terminal-reconnect.ts` optional-safe 접근(`options?.directSshAuthority`) (4) `web-workspace-session-api.ts` 세션에 `onCheckpointRequest/sendCheckpointReply/handbackProjectSessionSync/onProjectSessionHandback`(웹 no-op) (5) `index.ts` codex 시그니처. pty는 upstream barrel 채택 + New Window 라우팅 재이식 + upstream pty 개선 4건(`94f231737d`·`d60a3c900b`·`26721bd632`·`0bfd3808f6`) 반영.
- 🧭 **upstream 재동기화 2차 시도(2026-08-28, @201커밋)→다시 연기(제작자 판정).** 이번엔 끝까지 진행해 경계를 확정: 텍스트 충돌 14(마커~25, 병렬 에이전트)·정체성 보존·**기계적 5건 확정 적용**·**pty 게이트 재직조 완료(arg 15건 → hidden-delivery-gate/spawn-mark 테스트 15개 통과, 타입체크 0)**. 게이트 실패 근본원인 = 병합이 `pty/register-handlers.ts`의 라우터 주입(`setMainWindowForRouting`/리졸버) 누락 → 복원으로 해결. **확정된 유일 블로커 = `pty-project-window-stream-routing`(7건): 멀티윈도우 PTY 스트림 전달 서브시스템 전체(monolith `windowFlowStates`·창별 회계·소유창 라우팅 ~1500줄)를 upstream 분할 위에 재구현하는 feature-scale 작업**(반쪽 이식은 단일창 전달 오염) → **전용 던전으로 분리 필요**. 셸/WSL 4건 실패는 기존 Windows 경로구분자 이슈(무관). `git reset --hard origin/main`로 원복, `feat/sftp` 무손상. 상세 = 메모리 `upstream-sync-pty-split-clash`.
- 🕊️ **자비를 베푼 적** (미룬 것): ① VS 설치기가 요구한 **PC 재부팅 보류** — 컴파일 정상이나 편한 때 재부팅 권장 ② Python 미설치 상태 관찰 중(현재까지 문제 없음) ③ `ssh2` 네이티브 바인딩 미빌드(순수 JS 폴백) — 원정 3(SFTP) 정찰 때 검토 ④ **upstream 재동기화(29커밋·핫파일 충돌 예상)** — 원정 3 진입 전 수행 ⑤ **작업 트리 팬텀 CRLF churn**(~15,900파일·내용 동일·커밋 무영향) — upstream 동기화 시 정리 ⑥ **폴더 스캔 그룹 내 개별 폴더 워크스페이스**는 헤더 없어 "New Window" 진입점 없음(폴더로 추가한 프로젝트는 지원) — 필요 시 별도 퀘스트

- 📌 **원정 2 도구 판례**(메모리 기록): dev 크래시 후 실행불가→5173 좀비 정리(`dev-server-crash-recovery`) · autocrlf churn→명시 경로 커밋(`repo-crlf-formatter-churn`) · build:win EBUSY→conpty 잠금 정리(`build-win-conpty-lock`)

## 📚 참조

- 활성 컨셉: [../concept/orcinus.md](../concept/orcinus.md) · 환경 명세: [../../COMPOSITION.md](../../COMPOSITION.md) · 요구사항 원문: [../../REQUIREMENT.md](../../REQUIREMENT.md)
- 판정 기준: [길드-규약.md](길드-규약.md)
