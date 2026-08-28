# Orcinus — 핸드오프 (다음 담당자 시작 여기)

> 이 폴더는 다른 세션·에이전트·기계가 이 작업을 **이어받도록** 만든 자족적 번들이다. 이 문서부터 읽는다.

## 1. 이게 뭔가

**Orcinus** = 오픈소스 IDE/ADE **Orca**(`stablyai/orca`)를 개인 계정으로 포크한 커스텀 데스크톱 앱(Electron/TS/React). 정체성(포크 시 확정, upstream 병합에도 보존):
- `name: orcinus` · AppId `com.sj900211.orcinus` · Product/실행 `Orcinus` · 원본 MIT 고지 보존.

## 2. 현재 상태 (2026-08-28)

세 개발 단계 모두 완료:
- **1) 리브랜딩** ✅ · **2) New Window**(두 번째 앱 창 + 창별 터미널/세션 라우팅) ✅ · **3) SFTP 원격 파일 관리** ✅ (제작자 판정 클리어).
- 코드 브랜치: **`feat/sftp`** (= `main` + SFTP 전 작업). 최신 커밋 `fc3157dd4b`.
- `main` = `origin/main` (SFTP 작업은 `feat/sftp`에만).

## 3. 코드 가져오기

```
git clone https://github.com/sj900211/orcinus.git   # origin (개인 포크, 공개)
cd orcinus
git checkout feat/sftp
git remote add upstream https://github.com/stablyai/orca.git   # 이미 있으면 생략
```
- `origin` = 개인 포크(작업 저장) · `upstream` = `stablyai/orca`(원본).
- **git repo 루트 = 이 폴더(코드)**. 협업 문서(SSOT·리포트)는 원래 이 repo 밖(부모 폴더)에 있었고, 이식을 위해 `handoff/`로 사본을 넣었다.

## 4. 셋업·명령

```
pnpm install                       # 의존성 (upstream 병합 후엔 반드시 재실행)
pnpm dev                           # 개발 실행
pnpm run typecheck                 # node+web 병렬 타입체크
npx vitest run --config config/vitest.config.ts <경로>   # 단위 테스트
pnpm run sync:localization-catalog # 새 UI 문자열 추가 후
pnpm run build:win                 # → dist/orcinus-windows-setup.exe (서명된 NSIS 설치기)
```

## 5. 협업 방식 (정본은 repo 안)

- `.agents/skills/` 의 **collab-protocol**(판정·완료·클리어는 사람이 선언, AI가 대신 안 함; 근거+선택지+추천 제시)과 **guided-steps**(한 단계씩·시작점 구체화). `.claude/skills/`는 사본.
- `AGENTS.md`/`CLAUDE.md`(부모 = 협업 지침, `src/AGENTS.md` = Orca 엔지니어링/디자인 규약).
- 컨셉·테마: `handoff/context/orcinus-concept.md` (게임 퀘스트 세계관 — "원정/던전"). 사무적 결과는 `reports/01-결과보고서.md`.

## 6. 무엇이 되어 있나 (SFTP)

릴레이 없는 `ssh2` 직접 접속. 전 기능 제작자 검증·커밋 완료:
- 원격 브라우징(메타: 크기/mtime/권한) · 업로드(충돌 프롬프트) · 다운로드(단일 + 다중선택 `.tar.gz`) · 이동/삭제/새 디렉토리.
- 원격 파일 열람 = **메인 워크스페이스 read-only 탭**(로컬과 동일 Monaco, 서버 탭 아이콘) + 원격 마크다운 프리뷰.
- **Split 패널 + 양방향 드래그 전송**(로컬↔원격 업/다운로드 드롭).
- 설계 상세 = **`reports/04-SFTP-아키텍처.md`**.
- 형상·커밋 목록·품질/보안 = **`reports/01-결과보고서.md`**.

## 7. 다음 작업 (미결)

- **upstream 재동기화** — `upstream/main`(현재 201커밋 뒤) 병합. 기계적 충돌 + pty 게이트 재직조는 **확정된 recipe**, 남은 유일 블로커는 **멀티윈도우 PTY 스트림 전달 서브시스템(~1,500줄) 재구현**(feature-scale). 정확한 절차·경계 = **`reports/03-upstream-동기화-인수인계.md`** (반드시 읽고 시작).
- 복구 안전망: 병합이 꼬이면 `git reset --hard origin/main`.

## 8. 반드시 알아야 할 gotcha

전체는 **`ops-notes.md`**. 요약:
- **커밋은 명시 경로로만**(`git add <path>`), 절대 `git add -A` 금지 — 리포는 `core.autocrlf=true`라 팬텀 CRLF churn(~15,900파일) 발생. 커밋은 `--no-verify`.
- `build:win` EBUSY(node-pty conpty.dll) → 빌드 전 dev 인스턴스 종료 + 잔여 vitest 워커 정리.
- upstream 병합 후 `pnpm install`(새 의존성) 안 하면 dev가 Cannot-find-module.
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 9. 문서 지도

```
handoff/
  START-HERE.md   ← 이 문서
  ops-notes.md    ← 운영/환경 gotcha
  reports/        ← 01 결과보고서 · 02 대화록(HTML) · 03 upstream 인수인계 · 04 SFTP 아키텍처
  context/        ← orcinus-concept(테마) · world-map(SSOT 스냅샷) · expedition3-sftp-map(세부)
```
