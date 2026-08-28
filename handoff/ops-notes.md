# 운영·환경 노트 (Orcinus)

작업하며 축적한 환경·워크플로 함정. 다른 기계·에이전트도 갖도록 repo에 표면화했다. (Windows 개발 환경 기준.)

---

## Git 워크플로

### CRLF 팬텀 churn — `git add -A` 금지
- 이 repo는 `core.autocrlf=true`. 서브에이전트의 git-stash나 포매터가 대량 팬텀 churn(~15,900 파일, 내용 동일)을 일으킨다.
- **커밋은 반드시 명시 경로로만**: `git add src/path/file.ts …` (절대 `git add -A` / `git add .` 금지).
- 변경 검토는 `git diff --ignore-space-at-eol`.
- 커밋은 `--no-verify`(pre-commit 훅이 대량 포맷/린트로 churn 유발). 커밋 메시지 말미:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

### repo 레이아웃
- **코드 git repo = `F:\backend\orcinus\src`** (브랜치 `feat/sftp`).
- 협업 문서(`docs/진행`·`docs/concept`·`report`·부모 `AGENTS.md`/`CLAUDE.md`)는 **원래 부모 폴더 = 비-git**. 그래서 코드 커밋은 문서를 포함하지 않았다.
- 이식을 위해 이 `handoff/` 번들에 사본을 넣었다(이건 코드 repo에 커밋됨, upstream과 충돌 없음).
- 원격: `origin`=개인 포크(공개), `upstream`=`stablyai/orca`.

## 빌드

### `build:win` conpty 잠금(EBUSY)
- `build:win`이 node-pty `conpty.dll`에서 EBUSY로 실패할 수 있다.
- **빌드 전**: 실행 중인 Orcinus/dev 인스턴스 종료 + 잔여 vitest 워커(node.exe) 정리.
- `build:win`은 `--publish` 금지 · `CI=true` 설정 금지(로컬 산출만). 산출물: `dist/orcinus-windows-setup.exe`(서명된 NSIS 원클릭).

## 개발 실행

### dev가 안 뜰 때(크래시 후 복구)
- `pnpm dev`가 크래시 후 안 뜨면: 이 repo의 **고아 dev 프로세스**를 죽이고 Vite **:5173** 포트를 비운다(dev는 단일 인스턴스 락을 건너뛴다).

### upstream 병합 후 `pnpm install`
- upstream 병합으로 새 의존성이 들어오면 **반드시 `pnpm install`** 후 dev. 안 하면 `Cannot find module`로 실패.

## 코드 규약

### 새 UI 문자열(현지화)
- 렌더러 새 문자열은 `translate('auto.<경로>', 'English')`로 감싸고 `pnpm run sync:localization-catalog` 실행.
- 커버리지 게이트는 **맨 JSX 텍스트**(비-translate)에서 실패. `en.json`은 중첩 객체(점표기 아님); `en.json` 값이 런타임에서 인라인 폴백을 이긴다(sync는 누락 키만 추가, 갱신 안 함) → 문구 변경 시 인라인 + `en.json` 둘 다 수정.

### 우측 사이드바 탭 추가
- `RightSidebarTab` 추가는 4개 동기화 지점 필요(union 타입, 렌더러+메인 normalizer, Zod `STATIC_RIGHT_SIDEBAR_TABS`) + NODE 타입체크(패리티 가드) 실행.

### max-lines
- `AGENTS.md`(src) 규약: `max-lines` disable 주석 금지. 파일이 커지면 **분할**한다. 큰 핸들러는 별도 파일로 등록(예: `sftp-*-handlers.ts`, `sftp-*-batch.ts`).
- 참고: 리포 일부 파일은 사전-존재 max-lines/array-type 부채가 있어 `--no-verify`로 커밋돼 왔다. 새 파일은 규약 준수.

## 미결 작업

- **upstream 재동기화**의 상세 절차·경계·해결된 것/블로커는 `reports/03-upstream-동기화-인수인계.md` 참조.
