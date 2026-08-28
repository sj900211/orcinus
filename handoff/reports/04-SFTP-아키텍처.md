# SFTP 아키텍처 심화

Orcinus의 SFTP 원격 파일 관리 기능 설계. 유지보수자·다음 담당자용.

---

## 1. 설계 원칙 — 릴레이 프리

원격 파일 접근은 별도 릴레이/데몬 없이 **`ssh2` 커넥션 풀에 직접** SFTP 채널을 연다. 시스템-ssh 전송(system-ssh transport)은 SFTP를 못 열므로, SFTP 기능은 항상 raw ssh2 연결 위에서만 동작한다(exec 채널도 항상 사용 가능).

핵심 계약: **모든 원격 IPC는 예외를 던지지 않고 `{ error: string }` 유니온을 반환**한다. 렌더러는 `'error' in result`로 분기한다(throw를 캐치하지 않음).

## 2. 메인 프로세스 계층

### 2.1 연결
- `SftpConnectionPool`(raw ssh2) — 호스트별 연결 관리.
- `getSftpConnection` / `resolveConnection(getSftpConnection, targetId)` — targetId로 연결 확보, 실패 시 `SftpConnectionAccessFailure` → `{ error }`.
- `withSftpChannel(conn, cb)` — SFTP 채널을 열어 콜백에 넘기고 정리(`sftp.end()`)까지 책임.
- 유틸: `validateString`, `toErrorMessage`, `transferErrorMessage`.

### 2.2 IPC 채널 (`src/main/ipc/sftp-transfer.ts`의 `SFTP_IPC_CHANNELS`)
`readdir` · `realpath` · `readFile` · `startUpload` · `startDownload` · `cancelTransfer` · `mkdir` · `move` · `delete` · `planUpload` · `performUpload` · `uploadPaths` · `downloadArchive` · `downloadToDir`

핸들러는 max-lines 준수를 위해 분리 등록된다:
- `registerSftpTransferHandlers`(기본) · `registerSftpUploadHandlers` · `registerSftpArchiveHandlers` · `registerSftpDownloadHandlers` · `registerSftpFsMutationHandlers`.
- 공통 의존성: `{ getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup }`.

### 2.3 전송 세션 (진행률·취소·수명)
- `transfers: Map<transferId, { controller: AbortController; senderId }>`.
- `emitProgress(webContents, { transferId, phase, bytesTransferred, totalBytes })` — phase = `start|progress|done|error|canceled`. `TRANSFER_PROGRESS_CHANNEL` 브로드캐스트.
- `emitTransferFailure` — 실패/취소를 error/canceled phase로.
- `lifecycle.retain/release(targetId)` — 긴 전송 중 커넥션 풀 idle 리핑 방지.
- `ensureDestroyedCleanup(sender)` — 렌더러 파괴 시 세션 정리.
- 취소: `sftp:cancelTransfer` → `controller.abort()` → 각 엔진의 `signal.throwIfAborted()`/스트림 abort.

### 2.4 전송 엔진
- **업로드**: `src/main/ssh/sftp-upload-batch.ts` — `uploadFilesInto`(파일, temp+rename 원자적, 진행률), `uploadDirectoriesInto`(디렉토리 재귀, 심링크 스킵, 경로 이탈 가드).
- **다운로드**: `src/main/ssh/sftp-download-batch.ts` — `downloadFileInto`(fastGet → temp+rename), `downloadDirectory`(재귀 readdir+mkdir+fastGet), `classifyRemoteEntry`(권한 mode 비트로 파일/디렉토리 확정 분류, 그 외 스킵).
- **아카이브**: `src/main/ipc/sftp-download-archive.ts` — `tar -czf - -C <공통조상> -- <상대 멤버들>`를 exec 채널로 스트리밍 → 로컬 temp+rename. 공통 조상 계산 + 중첩/중복 경로 제거. writeStream 'finish' AND channel 'close' 둘 다 대기(exit는 close보다 먼저).
- **뷰어 읽기**: `readFileCappedViaSftp`(`createReadStream({start:0,end:cap})`, cap 10MB), 바이너리 게이트 → `{ content, isBinary, truncated }`.

### 2.5 보안 가드
- 원격 경로는 exec 시 `shellEscape`(`ssh-connection-utils.ts`)로 인젝션 차단. 아카이브는 `--`로 tar 옵션-인젝션 차단.
- 로컬 대상 파일명은 메인에서 `sanitizeLocalDownloadFilename`(`/ \ .. ` 등 제거)로 경로 이탈 차단.
- 심링크: 업로드는 최상위 심링크 거부(`lstat`), 다운로드는 `classifyRemoteEntry`가 권한 비트 확정 시에만 파일/디렉토리로 처리(mode 없거나 심링크면 스킵) → 링크 대상 유출 방지.
- 덮어쓰기: 다운로드는 `deconflictName`("name copy")으로 비파괴.

## 3. 렌더러 계층

### 3.1 공유 파일 탐색기 재사용 (opt-in)
로컬 파일 탐색기와 SFTP Server Explorer는 **동일한 `FileExplorerRow`/`FileExplorerVirtualRows`**를 공유한다. SFTP 전용 동작은 로컬을 건드리지 않는 **opt-in 프롭**으로만 주입:
- `renderContextMenu` / `renderRowMeta` — SFTP 전용 메뉴·메타(크기/권한/mtime).
- `sftpDragHostId` — 원격 행 드래그에 SFTP MIME 태깅.
- `onExternalPathsDrop(destDir, dataTransfer) => boolean` — 크로스패널 드롭 클레임(업로드/다운로드), 내부 이동 루프보다 먼저.
- `selectedPaths` + `onContextMenuSelect` + 선택 훅(`useFileExplorerSelection`) — 다중 선택.

### 3.2 크로스패널 드래그 라우팅
- 공통 MIME `WORKSPACE_FILE_PATH_MIME`(`text/x-orca-file-path`)는 로컬·원격 행 모두 설정 → 출처 구분 불가.
- 그래서 원격 행에만 2차 MIME **`SFTP_FILE_DRAG_MIME`(`text/x-orca-sftp-file`, `{hostId, paths}`)** 부착(`src/renderer/src/lib/sftp-file-drag.ts`: `encode`/`readSftpFileDrag`(drop 시)/`hasSftpFileDrag`(dragover 시 `types`)).
- 규칙: 로컬 출신 = SFTP MIME 없음, 원격 출신 = 있음.
- **업로드 드롭**(로컬→원격, `use-server-explorer-mutations.ts`): SFTP MIME 없으면 `sftp:uploadPaths`로 업로드.
- **다운로드 드롭**(원격→로컬, `useFileExplorerDragDrop.ts`): SFTP MIME 있으면 `sftp:downloadToDir`로 다운로드. hostId는 **드래그 페이로드에서**(로컬 패널엔 SFTP 선택 개념 없음). **`connectionId == null`(진짜 로컬 워크트리)일 때만** 다운로드(SSH 백엔드 워크트리는 거부).

### 3.3 전송 UI
- Server 패널: `server-explorer-transfers.ts`(tracked map + sonner 토스트, 업로드 후 자동 새로고침).
- 로컬 패널 다운로드: `local-explorer-download-transfers.ts` + `use-local-explorer-download-progress.ts`(브로드캐스트 구독을 자기 transferId로 필터, 완료 시 로컬 dir 새로고침).

### 3.4 원격 파일 열람 → 메인 에디터 통합
- `OpenFile.sftpTargetId` 필드로 표시. 콘텐츠 로더(`useEditorPanelFileContentLoader.ts`)가 이 필드가 있으면 **로컬/SSH/런타임 라우팅을 우회**하고 `window.api.sftp.readFile`로 읽는다(read-only이므로 잘림 허용).
- 소유: 활성 워크트리(AI Vault "View Log" 읽기전용 탭 선례). `openServerFilePreview`(`server-explorer-open-preview.ts`)가 `openFile`을 호출.
- 식별자: `buildSftpEditorFileId('sftp:'+host+worktree+path)`로 네임스페이스 → 같은 절대경로의 로컬/SSH 탭과 충돌 방지(재사용 가드 포함).
- 영속: SFTP 탭은 세션 영속에서 제외(`workspace-session.ts` + `workspace-session-unified-tabs.ts`) → 재시작 후 고아 탭 없음(Phase 1).
- 마크다운 프리뷰: 프리뷰 탭이 소스에서 `sftpTargetId`를 물려받아(externalSshTargetId 유도 방식과 동일) 원격 마크다운을 렌더.
- 탭 표시: `EditorFileTab.tsx`가 `sftpTargetId` 있으면 서버 아이콘.

## 4. 확장 포인트 (다음 작업 시)
- 새 SFTP IPC: `SFTP_IPC_CHANNELS` 배열 + 핸들러 등록 + preload `sftp-api.ts` 타입 + `preload/index.ts` 브리지 + (필요 시) 전송 세션 스캐폴딩 재사용.
- 새 렌더러 UI 문자열: `translate('auto.…', 'English')` + `pnpm run sync:localization-catalog`.
- 공유 행에 SFTP 전용 동작 추가: opt-in 프롭 패턴 유지(로컬 무손상).
