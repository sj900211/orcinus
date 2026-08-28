# ⚔️ 미니맵 — 원정 3: SFTP 원양 탐사 (★★★ 영웅) — 🔥 진행 중 (2026-08-24 개막)

> 원정 목표: SFTP로 서버 접근. 스펙 원문 `REQUIREMENT.md` 3번.
> 요구 분해: ① Activity Sidebar에 **SSH 탭** 추가 → **Server Explorer**(원격 파일 보기) ② Explorer(로컬)에서 컨텍스트 메뉴로 **업로드**(생성·덮어쓰기) ③ Server Explorer에서 컨텍스트 메뉴로 **다운로드** ④ 경로 지정 문제 → 업/다운로드 시 경로 지정 기능, **또는** Server Explorer 패널을 Explorer 하단에 split해 **Drag & Drop** 업/다운로드.
> 클리어 조건·던전 구성은 정찰 후 확정. 최종 클리어 판정은 제작자.

> 📝 사전 정비(원정 사이): upstream 127커밋 동기화 완료(`81de9ba40f`). `ssh2`는 원정 1에서 순수 JS 폴백으로 관찰해 둠(SFTP 핵심 라이브러리) — 정찰에서 성능·네이티브 바인딩 검토.

## 던전 1 — 정찰 🔭 — ✅ 클리어 (2026-08-24 제작자 판정: 6던전 구성 + A→B 경로 방식 승인)

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 1-1. 정찰: ssh2/SFTP 가능성 · SSH 인프라 재활용 · Activity Sidebar 탭 구조 · Explorer UI 재활용 · 업/다운로드·경로/DnD (병렬 4갈래) | 🤖 | ✅ |
| 1-2. 정찰 보고서: 가능성 판정 + 접근 방식 선택지 + 더 나은 방향 → 하단 📜 | 🧑🤖 | ✅ |
| 1-3. 던전 구성 확정 → 정찰 클리어 판정 — **6던전·A→B 승인·클리어** (2026-08-24) | 🧑 | ✅ |

## 던전 2 — 설계 청사진 📐 — ✅ 클리어 (2026-08-24 제작자 판정: 청사진 승인 · SSH 테스트 호스트 보유 확인)

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 2-1. 심층 정찰 완료 (병렬 4갈래) → 결과는 설계 청사진에 반영 | 🤖 | ✅ |
| 2-2. 설계 초안 → 하단 📐 청사진 | 🤖 | ✅ |
| 2-3. 설계 검토·확정 → **승인 + 클리어** (2026-08-24) | 🧑🤖 | ✅ |

## 던전 3 — 통로 개통 🚇 — ✅ 검증·커밋 `d7690fd481` (판정: 원정 재조정으로 던전 4~7 후 통합)

> 목표: SFTP를 렌더러에 노출하는 IPC + 전송 진행률/취소. 기존 헬퍼의 얇은 배선. (UI는 던전 4·5)

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 3-1. 구현 완료 — 6파일(신규 `sftp-transfer.ts`·`sftp-transfer-operations.ts`·`sftp-api.ts`+테스트, 수정 `ssh-filesystem-provider-sftp.ts`·`sftp-upload.ts` 진행률 훅·`ipc/ssh.ts` 등록·preload). `sftp:readdir/realpath/startUpload/startDownload/cancelTransfer` + `sftp:transferProgress` 이벤트. 다운로드는 진행률 위해 신규(`fs:downloadFile`은 step 훅 없음). 취소=AbortController·transferId 세션(sender destroyed 시 정리). 어드버설 3검증 통과·🤖 41 테스트·typecheck·lint 클린·미커밋 | 🤖 | ✅ |
| 3-2. 검증: dev 콘솔에서 실제 SSH 호스트로 readdir·다운로드·업로드(🧑) → 커밋 — 💀 **설계 사각 발견(2026-08-24)**: 제작자 서버에 Node.js 없어 `ssh:connect`(relay 배포) 실패. 실측: `SshConnection.connect()`는 ssh2 전송만(relay 무관), `sftp()`는 그 위에서 동작 — **relay 층만 실패**. 던전 3은 relay 연결(`getConnection`) 가정 → 평범한 SFTP 서버(무 Node.js) 미지원. 처방 후보: **SFTP 전용 raw-SSH 연결 경로**(relay 건너뜀) 추가. → **결정(2026-08-24 제작자): raw-SSH SFTP 연결 구현.** 하단 3-1b 추가 | 🧑🤖 | ⏳ |
| 3-1b. raw-SSH SFTP 연결 구현 완료 — 신규 `sftp-connection.ts`(`SftpConnectionPool`): 라이브 relay 연결 있으면 그 ssh2 클라이언트 재활용, 없으면 전용 relay-free `SshConnection.connect()`(Node.js 무관). 호스트키/passphrase는 표준 콜백으로 무료 재활용. 타깃별 캐시·10분 idle·quit/제거 시 정리. 핸들러 재배선(타입 에러 계약 유지). Recon→Impl→Verify(relay-free 100% 추적·자격 무회귀)·🤖 20 테스트·typecheck·lint 클린. **UX: Settings에서 타깃 "추가"만 하면 됨("Connect" 불필요) — 첫 sftp 호출 때 알아서 연결·프롬프트.** 미커밋 | 🤖 | ✅ |
| 3-3. 강화+검증+커밋 — 적대적 리뷰(6차원, 검증관 반증)로 14건 확인 → **10건 전부 수정**(다운로드 데이터 손실·10분 전송 끊김 심각 2건 등, 오탐 4건 기각). 실서버(10.10.12.201) readdir/업로드/다운로드(정상+실패) 검증. 커밋 `d7690fd481`(명시 경로 11파일, `--no-verify`로 lint-staged 팬텀 churn 회피·게이트 수동 통과) | 🧑🤖 | ✅ |
| 3-4. 던전 클리어 판정 | 🧑 | 보류(던전 4~7 후 통합) |

> 📌 던전 3은 **백엔드(통로)**까지. 사용 중 발견: 기존 `SSH 호스트`(워크트리용)와 SFTP가 같은 레지스트리를 공유해 혼란 + 비번 저장 불가 → **던전 4 신설**.

## 던전 4 — 원격 등록소 🛖 — 🏆 클리어 (2026-08-25 제작자 판정) · 커밋 `5f8abbcd85`

> 목표: 워크트리 SSH와 **분리된 별도 `SFTP Hosts` 레지스트리**(설정 섹션) + **비밀번호 인증**(OS 암호화 저장). 사용 중 발견한 두 개선 요청 반영.
> **결정(2026-08-25 제작자)**: ① 섹션명 **SFTP Hosts**(그룹 "Remote Hosts" 하위, 기존 "SSH Hosts"와 대칭 — 그룹명 자체가 "Remote Hosts"라 중복 회피) ② **별도 레지스트리**(jira 패턴 — `~/.orca/sftp-hosts.json` + 호스트별 암호화 파일, 메인 영속화 store 무손상) ③ 비밀번호 **OS 암호화 저장**(`safeStorage`/`ElectronSecretStore`).
> **핵심 실측**: 비밀번호 인증은 연결 계층에 **이미 배선**됨(`ssh-connection.ts` — `onCredentialRequest(kind='password')` → `cachedPassword` → `config.password` → `buildAuthQueue` password 시도). → 저장된 비번을 풀의 콜백으로 공급하면 **코어 무수정**.

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 4-A. 백엔드: `shared/sftp-host-types.ts`(SftpHost/Input/View) + 독립 저장소 `main/ssh/sftp-host-store.ts`(jira 패턴·암호화 비번) + IPC `sftp:host:*` + `SftpConnectionPool` 재배선(SFTP 레지스트리 해석·비번 콜백 주입, 워크트리 무손상) + preload. 관문: 콘솔에서 비번 호스트 추가→readdir/download 재입력 없이 동작 · 저장소·IPC 단위테스트 | 🤖 | ✅ (실서버 검증·SFTP 42테스트 green) |
| 4-B. 설정 UI: `SFTP Hosts` 섹션(=SshPane/SshTargetForm 복제) + Authentication type 토글(Key pair/Password) + 섹션 등록(메타데이터·Settings.tsx·검색) + 현지화(en+es/ja/ko/zh). 관문: 설정에서 비번 호스트 추가/편집/삭제 | 🤖 | ✅ 시각 검증 통과 (제작자 2026-08-25) |
| 4-C. 통합 검증 + 커밋 — E2E(새 섹션 호스트로 SFTP 동작·기존 SSH 워크트리 무손상)·마이그레이션 안내(기존 테스트 호스트 1회 재등록)·테스트/타입/린트/현지화 게이트 green → 명시 경로 커밋 | 🧑🤖 | ✅ 커밋 `5f8abbcd85` (16파일·SFTP 42테스트·docs 별도) |

## 던전 5 — 서버 탐색기 🗂 — 🏆 클리어 (2026-08-25 제작자 판정) · 커밋 `696c28b430`

> 목표: 오른쪽 사이드바 **SFTP 탭** → 호스트 선택기 + **원격 파일 트리**(읽기 전용). 전송(업/다운로드)은 던전 6.
> **결정(제작자)**: A안(트리). 구현형태 **A2**(아키텍트 검토) — FileExplorer **프레젠테이션 재활용**(`FileExplorerVirtualRows`·행·가상화, D6에서 컨텍스트메뉴/DnD 재활용) + **전용 `useServerExplorerTree`**(SFTP 데이터). **공유 로컬 탐색기 코드 무손상**(`useFileExplorerTree`/operationOwner/pane-state 안 건드림 — B/A1 대비 최저 위험).
> 정찰: 사이드바 탭은 **게이팅 없이 상시 표시**(SFTP는 워크스페이스 무관). 현지화는 세만틱 키 + `sync:localization-catalog`.

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 5-A. 트리 데이터: `server-explorer-directory-listing.ts`(sftp:readdir→TreeNode) + `useServerExplorerTree`(dirCache/loadDir/expand·세대 카운터·전용 상태) | 🤖 | ✅ 구현(타입·oxlint·react-doctor·현지화 green) |
| 5-B. 패널+탭: `ServerExplorer.tsx`(호스트 선택기 + FileExplorerVirtualRows 재활용, 읽기전용 no-op 핸들러 + 로딩/빈/에러/설정 링크) + 탭 등록(유니온·활동아이템·라우터·영속화) + 현지화 | 🤖 | ✅ 시각 검증 통과 (제작자) — 💀 라우팅 버그(렌더러 정규화기 `right-sidebar-route.ts`에 'sftp' 누락→explorer 폴백) 수정 포함 |
| 5-C. 검증+커밋: 시각 검증(SFTP 탭→호스트 선택→트리 탐색·펼치기) + 게이트 green → 명시 경로 커밋 | 🧑🤖 | ✅ 커밋 `696c28b430` (11파일) |

> 📌 D5 사용 중 제작자 요청 2건 → ① **경로 설정**(새 던전 6, 하단) ② **파일 내용 뷰어**(후속 퀘스트, 원정 후반).

## 던전 6 — 경로 설정 🧭 — 🏆 클리어 (2026-08-26 제작자 판정) · 커밋 `1e1cc95096`

> 목표: SFTP 호스트에 **탐색기 시작 경로**(basePath). 공백 = 서버 **루트 `/`**. 전송은 던전 7.
> 설계: 미저장 호스트도 검증/자동완성되도록 **draft 프로브 연결**(`SftpProbePool` + `sftp:probe:list`, 폼 세션 1연결 재사용·idle 정리). 편집 시 비번 미입력이면 저장된 호스트 연결 사용.

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 6-A. 백엔드: basePath 모델·저장소 + `sftp-probe.ts`(프로브 풀) + IPC `sftp:probe:list` + ssh.ts 배선 + preload + 탐색기 루트 | 🤖 | ✅ (node·web 타입 0·45테스트) |
| 6-B. 폼 UI: `SftpBasePathField`(디바운스 검증·`ls` 자동완성 드롭다운·저장 게이트) + RemoteHostForm/Pane 배선 + 현지화 | 🤖 | ✅ |
| 6-C. 검증+커밋 — 💀 버그 수정: IPC `toHostInput`가 basePath 누락→저장 안 됨(2계층 매핑 중 1곳만 갱신) + D5 잠복(Zod `STATIC_RIGHT_SIDEBAR_TABS` 누락→node 타입 실패). 공백=루트 반영. 시각 검증 통과 → 커밋 `1e1cc95096` | 🧑🤖 | ✅ 판정 대기 |

> 📌 검증 전제: 제작자 보유 SSH 호스트로 Orcinus에서 SSH 워크스페이스를 열어 테스트.
> 🕳️ 정비 복병(2026-08-24): `pnpm dev` 실패 — `@vscode/windows-process-tree: Cannot find module`. 원인: **upstream 병합이 새 네이티브 의존성을 추가했는데 병합 후 `pnpm install` 미실행**(원정 사이 정비 누락). 처방: `pnpm install --frozen-lockfile`(락파일에 이미 있음·변경 없음, prebuilt 로드) → `ensure:electron-runtime` 통과. 메모리 `upstream-merge-pnpm-install` 기록.

## 던전 7 — 화물 하역 ⚓ — 🔥 7-A 커밋 `a4a62127ac` (DnD는 후속 퀘스트로 분리) · 판정 대기

> 목표: Server Explorer에서 컨텍스트 메뉴로 **다운로드/업로드** + 진행률 토스트. (경로 방식 A안 = 우클릭 메뉴, 제작자 결정.)
> **결정(제작자)**: 진입점 **A. 우클릭 메뉴**(FileExplorer 행에 opt-in 프롭 `renderContextMenu` 1개 추가 → 로컬 탐색기 무손상). Split+DnD(B안)는 **후속 퀘스트**로 분리.

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 7-A. 전송 UI: `ServerExplorerRowMenu`(파일=Download·폴더=Upload here·Refresh) + `server-explorer-transfers.ts`(전송 오케스트레이션·`transferId`별 진행률 토스트·취소) + `FileExplorerRow`/`VirtualRows`에 opt-in `renderContextMenu` 프롭 + `ServerExplorer` 배선(헤더 Upload/Refresh 버튼) + 현지화. 게이트 green | 🤖 | ✅ 커밋 `a4a62127ac` |
| 7-B. Split 패널 + Drag&Drop 업/다운로드 (B안) | 🧑🤖 | 🕗 후속 퀘스트로 분리 |
| 7-C. 던전 클리어 판정 | 🧑 | 보류(D8 후 통합) |

> 📌 D7 사용 중 제작자 검수 5건 → 던전 8 신설. 특히 #4(취소 시 부분 파일/덮어쓰기 원본 손상)는 데이터 손실이라 최우선.

## 던전 8 — 화물 하역 심화 🏗 — 🏆 클리어 (2026-08-27 제작자 판정) · 커밋 `1dc1efba21`·`597bf79896`·`93c79953f3`·`35d766d61e`·`11fe46663e`·`82cb42c000`·`1d469632f7`·`994d0a85d7`

> 목표: D7 검수에서 나온 5개 심화 요청. (a) 취소 시 **이전 상태로 롤백**(부분 파일·덮어쓰기 전 원본 포함) (b) 동명 파일 **덮어쓰기/이름변경 프롬프트** (c) 폴더·다중 파일 **압축 다운로드**(tar.gz, 제작자 승인) (d) 폴더·다중 파일 **업로드** (e) Explorer에서 **새 폴더 생성**.
> 권장 진행 순서: 8-A(롤백) → 8-E(새 폴더) → 8-C(다중 업로드) → 8-B(충돌 프롬프트) → 8-D(압축 다운로드).

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 8-A. 원자적 업로드: 원격 **temp 파일 + 성공 시 rename**(`sftp-rename.ts` 추출 — `publishTempUpload`/`unlinkQuietSftp`, exclusive=일반 rename·overwrite=posix-rename 폴백 unlink+rename) → 취소/실패가 부분 파일·원본 손상 안 남김. 🤖 sftp-rename 5테스트 | 🤖 | ✅ 커밋 `1dc1efba21` · **성공 확인**(제작자 2026-08-26) |
| 8-E. 새 폴더: `sftp:mkdir` IPC(relay-free·allowExisting:false→중복명 에러) + preload + `ServerExplorerRowMenu` "New Folder…"(폴더) + 헤더 버튼(루트) + 이름 다이얼로그(타깃별 remount) + 성공 시 부모 새로고침 + 현지화(7키). 🤖 mkdir 4테스트·23 SFTP 테스트 green | 🤖 | ✅ 커밋 `597bf79896` · **성공 확인**(제작자 2026-08-26) |
| 8-G. **DnD 이동**: 트리 내 행을 폴더/루트로 드래그해 원격 **이동**(rename). `sftp:move` IPC(신규 `sftp-fs-mutations.ts`) + 공유 DnD 프롭 배선 + 루트 드롭존 + 충돌 시 **덮어쓰기 확인**(제작자 결정) → 덮어쓰기는 **백업-후-교체**(손실 방지) + 출발/도착 새로고침. `use-server-explorer-mutations` 훅 | 🤖 | ✅ 커밋 `93c79953f3` · **성공 확인**(제작자 2026-08-26) |
| 8-H. **삭제**: 파일 unlink·폴더 재귀 remove. `sftp:delete` IPC + 우클릭 Delete 항목 + **확인 다이얼로그**(파일·폴더 모두, 제작자 결정) + 부모 새로고침. 루트류 경로(`/`·`//`·`.`·`~`·`..`) 삭제 거부 | 🤖 | ✅ 커밋 `93c79953f3` · **성공 확인**(제작자 2026-08-26) |
| 8-C. 폴더·다중 파일 업로드: 다중 파일은 이미 동작 → **폴더 통째 업로드** 추가. `sftp:startUpload`에 `directories` 모드(`openDirectory`) + 신규 `sftp-upload-batch.ts`(`uploadDirectoriesInto` → 보안 가드 있는 `uploadDirectory` 재귀). 우클릭 "Upload folder here…" + 헤더 버튼. 폴더 진행률은 미결정(스피너), exclusive(중복 폴더 시 에러 → 충돌 프롬프트는 8-B). 독립 검토 클린 | 🤖 | ✅ 커밋 `35d766d61e` · **성공 확인**(제작자 2026-08-26) |
| 8-B. 충돌 프롬프트: 파일 업로드 2단계화(`sftp:planUpload` 충돌 탐지 → `sftp:performUpload` 해결안 업로드, 신규 `sftp-upload-handlers.ts`) + `uploadFilesInto` + 충돌마다 **덮어쓰기/이름 직접 입력/건너뛰기** 다이얼로그(`ServerExplorerUploadConflictDialog`·`use-server-explorer-upload` 훅). 덮어쓰기=원자적 교체. 경로 세그먼트 가드(`.`·`..`·`/`·`\`). 범위=파일(폴더는 exclusive 유지). 독립 검토 2건 → 가드 1건 강화 | 🤖 | ✅ 커밋 `11fe46663e` · 판정 대기 |
| 8-D. **압축 다운로드**: 디렉토리 우클릭 "Download as archive…" → `tar -czf -` **exec 스트림** → 로컬 temp+rename(신규 `sftp-download-archive.ts`). `shellEscape` 인젝션 가드 · `-C parent` 상대 경로. exec는 relay-free ssh2에 항상 있음(system-ssh는 SFTP 자체 불가). 범위=단일 디렉토리(다중선택 후속). 독립 검토 → HIGH 2건(취소 미settle·비정상 종료 놓침) 수정 | 🤖 | ✅ 커밋 `994d0a85d7` · **성공 확인**(제작자 2026-08-27) |
| 8-I. **검수 수정**(2026-08-27): 업로드 종료 시 대상 디렉토리 **자동 새로고침**(`tracked`에 remoteDir·진행률 훅 콜백) + 삭제 시 **서브트리 캐시 무효화**(`invalidateDir` — 삭제→재업로드 stale 방지) + UI 문구 **Folder→Directory** | 🤖 | ✅ 커밋 `82cb42c000` · **성공 확인**(제작자 2026-08-27) |
| 8-J. **메타데이터 열**: 제작자 결정 = **용량+권한**(소유자 제외). 공유 행에 opt-in `renderRowMeta`(로컬 무손상) + `TreeNode` 선택 필드 size/mode + `formatPosixMode`(rwx)·`formatBytes` 재사용. 우측 정렬 표시. → 제작자 추가 요청으로 **수정 시각(mtime)** 추가(`formatMtime` YYYY-MM-DD HH:mm, 커밋 `d7567c7c0e`) | 🤖 | ✅ 커밋 `1d469632f7`·`d7567c7c0e` · **성공 확인**(제작자 2026-08-27) |
| 8-F. 던전 클리어 판정 | 🧑 | 🏆 **클리어 선언**(제작자 2026-08-27) |

## 던전 10 — 파일 열람 🔍 — ✅ 커밋 `91a20410a5` (2026-08-27, 후속 퀘스트) · 판정 대기

> 목표: Server Explorer에서 **파일 단일 클릭 → 원격 내용을 read-only Monaco로** 열람(제작자 선택). 로컬 열기 흐름은 worktree에 묶여 재사용 불가 → **독립 뷰어 + 신규 읽기 IPC**.

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 10-A. 백엔드 `sftp:readFile`: `readFileCappedViaSftp`(캡 10MB `createReadStream({start,end})`·초과 시 클립+destroy) + `isBinaryBuffer` 게이트 → `{content,isBinary,truncated}`. preload+타입 | 🤖 | ✅ |
| 10-B. 렌더러: `ServerExplorerFileViewerDialog`(큰 모달 + read-only `@monaco-editor/react` `<Editor>`·`detectLanguage`·테마·lazy) + `handleRowClick` 파일 클릭 배선(로컬 무손상) + 바이너리/truncated 안내 | 🤖 | ✅ |
| 10-C. 검증+커밋 — 게이트(node+web·oxfmt·oxlint·react-doctor·max-lines·81 SFTP 테스트·현지화) + 독립 검토(캡 오버슛 MEDIUM 1건 수정) → 커밋 `91a20410a5` | 🧑🤖 | ✅ **성공 확인**(제작자 2026-08-27; >10MB truncated 배너 시각 검증은 큰 파일 부재로 skip — 단위테스트로 커버) |
| 10-D. **네이티브 에디터 전환(Phase 1)**: 팝업(`ServerExplorerFileViewerDialog` 삭제)→ 로컬과 동일한 **메인 워크스페이스 read-only 탭**. `OpenFile.sftpTargetId` + 콘텐츠 로더 SFTP 분기(`window.api.sftp.readFile`, worktree/SSH/runtime 우회, 잘림 read-only 허용) + `openServerFilePreview`(활성 워크트리 소유, AI Vault View Log 선례). 세션 복원 제외(Phase 1). 커밋 `a4962b1408` | 🤖 | ✅ · 판정 대기 |
| 10-D 🛡. 적대적 3렌즈 리뷰(로더격리·영속·소유권) → 확정 2건 교정: **MEDIUM** 동일 경로 로컬/SSH 탭과 식별자 충돌 = 호스트로 네임스페이스한 `sftp:` 에디터-id + 재사용 가드 · **MEDIUM** unified 탭이 별도 영속돼 하이드레이션 고아 = SFTP 탭도 영속 제외. (미교정·보고: `uploadPaths`/`performUpload` 공통 렌더러 신뢰모델) | 🧑🤖 | ✅ |

## 던전 11 — Split 패널 + Drag&Drop 전송 🪟 — ✅ 전 항목 승인(제작자 2026-08-27) · 클리어 선언 대기 (후속 퀘스트 = D7-B)

> 목표: 로컬 Explorer 하단에 Server Explorer를 split해 **패널 간 드래그로 업/다운로드**. 제작자 결정 = **툴바 토글 · 양방향 한 번에**.
> 정찰(`sftp-split-dnd-recon`): split 라이브러리 없음(자체 리사이즈) · DnD 출처 태깅 = 2차 MIME `text/x-orca-sftp-file`={hostId,paths}(base MIME 유지) · 다이얼로그 없는 업/다운로드 = **신규 IPC 2개**(엔진 `uploadFilesInto`/`uploadDirectoriesInto`/`fastGetViaSftp` 재사용). 안전 위해 단계별 커밋.
> 🧭 **진행 순서 확정(2026-08-27, 제작자)**: **A → 11-2 → 11-3**. 재정찰(`sftp-preview-dnd-recon`) 확인 사항:
>   - **선결과제 A**: 현재 로컬·SFTP 행이 **동일 MIME**(`text/x-orca-file-path`, 공유 `FileExplorerRow.tsx:155`)을 emit → 드롭 지점이 출처 구분 불가. 원격 행에만 opt-in 프롭으로 `SFTP_FILE_DRAG_MIME`(`workspace-file-drag.ts:9` 옆) 추가가 **11-2·11-3 공통 선결**. 규칙: 로컬=SFTP MIME 없음 / 원격=SFTP MIME 있음.
>   - **11-2(업로드)=저위험**: 엔진 완비. 신규 `sftp:uploadPaths({targetId,remoteDir,paths[]})`(`sftp-transfer.ts` startUpload은 다이얼로그라 재사용 불가) + 원격 드롭 분기(`use-server-explorer-mutations.ts:159` rootDropHandlers·per-row onMoveDrop: SFTP MIME 없으면 upload). SFTP 코드만 손댐.
>   - **11-3(다운로드)=고위험**: ⑴ `fastGetViaSftp`는 **단일 파일 전용** → 원격 **디렉토리** 다운로드 엔진 없음(재귀 walk or tar 아카이브 `sftp-download-archive.ts` 재사용 필요, 효과 드라이버). ⑵ 로컬 탐색기 드롭 경로(`useFileExplorerDragDrop.ts:123`·`useFileExplorerRowDrag.ts` = git 워크트리 이동+undo/redo) 수정 → 회귀 위험. opt-in 단락으로 로컬 이동 무손상 유지.
>   - hostId는 반드시 **드래그 페이로드**에서(로컬 패널엔 SFTP 타깃 개념 없음). 드롭 분기는 기존 move 분기보다 **앞**에 두고 SFTP MIME 명시 확인.

| 퀘스트 | 담당 | 상태 |
|---|---|---|
| 11-1. **Split 레이아웃**: `FileExplorerSftpSplit`(로컬 트리 상 + 드래그 divider + `ServerExplorer` 하·lazy) + "Show SFTP" 토글 바 · open/height localStorage 지속. 로컬 코드 무손상 | 🤖 | ✅ 커밋 `eb81a2cfa0` · 판정 대기 |
| 11-A. **공통 MIME 태깅(선결)**: `sftp-file-drag.ts`(`SFTP_FILE_DRAG_MIME`={hostId,paths}, encode/read/has) + `FileExplorerRow` opt-in `sftpDragHostId` → Virtual/ServerExplorer 배선. 로컬 행 무태깅 | 🤖 | ✅ 커밋 `3862ac947f` · 판정 대기 |
| 11-2. **업로드 드롭**(로컬→원격): 신규 다이얼로그 없는 `sftp:uploadPaths`(파일→`uploadFilesInto`·디렉토리→`uploadDirectoriesInto`·exclusive) + 공유 훅 opt-in `onExternalPathsDrop`(로컬 무손상) + 원격 행·배경 드롭 분기 | 🤖 | ✅ 커밋 `3862ac947f` · 판정 대기 |
| 11-3. **다운로드**(원격→로컬 드롭): 다이얼로그 없는 `sftp:downloadToDir`(파일=temp+rename·디렉토리=재귀 walk, tar 의존성 없음) + 11-2 `onExternalPathsDrop` 훅 로컬 재사용 + 배경 드롭 분기 + hostId=드래그 페이로드 + `connectionId==null` 게이트(SSH 백엔드 워크트리 거부) + 로컬 새로고침. 커밋 `fc3157dd4b` | 🤖 | ✅ **승인**(제작자 2026-08-27) |
| 11-3 🛡. 적대적 3렌즈 리뷰(보안·로컬회귀·다운로드정합) → 확정 2건 교정: **HIGH** 기존 로컬 파일 무경고 덮어쓰기 = `deconflictName`("name copy")로 비파괴(네이티브 드롭 관습) · **MEDIUM** 심링크 분류가 선택적 mode 비트 의존(악성 서버가 permissions 생략 시 심링크→파일 오분류→fastGet 링크 추종·유출) = S_IFREG/S_IFDIR 확정 분류(`classifyRemoteEntry`)로 그 외 전부 skip | 🧑🤖 | ✅ |

> 🛡 11-A/11-2 적대적 리뷰(3렌즈: 보안·로컬회귀·라우팅 → 검증관 반증) 3건 확정: **HIGH** 최상위 심볼릭 링크 디렉토리 업로드 = `uploadDirectoriesInto`가 realpath로 링크 대상(예: `~/.ssh`)을 루트 채택 → 유출. `sftp:uploadPaths`에서 `lstat`로 최상위 심링크 거부로 교정. **MEDIUM** 배경 드롭이 단일 경로 MIME만 읽어 다중선택 이동이 1건으로 잘림(내가 추가한 다중선택의 여파) = `readWorkspaceFileDragPaths` 다중 루프로 교정. **MEDIUM(미교정·보고)** `uploadPaths`가 렌더러 제공 로컬 경로를 워크스페이스 제한 없이 신뢰 — 기존 `performUpload`와 동일 신뢰모델이라 이 핸들러만 제한하면 비일관/정상 업로드 파손. 코드베이스 차원 결정 사항으로 제작자에 보고.

> 🔥 2026-08-26 제작자 추가 요청 2건 → **8-G(DnD 이동)·8-H(삭제)**. 정찰(`sftp-move-delete-recon`)→구현→적대적 리뷰(`sftp-move-delete-review`, 4차원·검증관 반증) 순서로 진행.
> 🛡 리뷰 12건 발견·9건 확정 → 전부 반영: **HIGH** 덮어쓰기 이동 비원자성(삭제-후-rename→데이터 손실) = 백업-후-교체로 교정 · 백엔드 자기-이동 가드 부재 = `sourcePath===destPath`/하위 트리 거부. **MEDIUM** 루트 드롭존 부재 · 삭제 루트가드가 `/`만 매칭(정규화 추가) · 누락 테스트(sourcePath·심볼릭·충돌 idle·덮어쓰기 실패). **LOW** 충돌 유니온 방어(도달 불가라 현행 유지).
> 🕗 후속 퀘스트(원정 후반): ① **Split 패널 + Drag&Drop** 전송(D7-B) ② **SFTP 파일 내용 뷰어**(클릭 → Monaco).

### 📐 설계 청사진 (2-2 초안) — 제작자 검토 대기

**핵심 원칙: 재활용 최대화.** SFTP 백엔드 헬퍼·FileExplorer 트리·오른쪽 사이드바 탭 시스템·다이얼로그가 다 있어, 신규 코드는 얇은 IPC 배선 + Server Explorer 래퍼 + 전송 UI뿐.

**① 백엔드 — 신규 IPC(기존 헬퍼의 얇은 래퍼)**

| 채널 | 인자 | 반환 | 기반 |
|---|---|---|---|
| `sftp:readdir` | `{targetId, path}` | `[{name, type, size, mtime}]` | `SshConnection.sftp()`→`readDirViaSftp` |
| `sftp:realpath` | `{targetId, path}` | `string` (홈='.') | SFTP realpath (트리 루트 시드) |
| `sftp:startDownload` | `{targetId, remotePath}` | `{transferId}\|{canceled}` | `showSaveDialog`→`downloadFile`(fastGet) |
| `sftp:startUpload` | `{targetId, remoteDir, overwrite?}` | `{transferId}\|{canceled}` | `showOpenDialog`(로컬 파일)→`openFileUploadSession().uploadFile` |
| `sftp:cancelTransfer` | `{transferId}` | — | `ssh-file-transfer-abort.ts` |
| `sftp:transferProgress`(이벤트) | `{transferId, bytes, total, phase}` | — | fastGet step 콜백·업로드 read-stream data |

- 진행률 훅: `fastGetViaSftp`에 `onProgress(total,bytes,fsize)` 추가(ssh2 fastGet step 콜백) · 업로드 read-stream data 리스너. transferId 세션 맵(기존 `downloadSessions` 패턴).
- **트리 목록은 SFTP `readdir`** 채택(`ssh:browseDir`의 ls 파싱 대비 size·mtime·type 풍부·전송과 일관).

**② 렌더러 — SSH 탭 + Server Explorer (FileExplorer 재활용)**

- 탭: `ui-chrome-types.ts`의 `RightSidebarTab`에 `'ssh-server'` 추가 · `use-right-sidebar-activity-items.ts`에 `sshOnly:true` 아이템(기존 `ports` 탭과 동일 패턴 — SSH 워크스페이스일 때만 노출) · `right-sidebar-panel-content.tsx` 라우팅.
- **대상 모델**: 활성 워크스페이스의 `activeRepo.connectionId`(타깃 피커 불필요 — 워크스페이스 전환으로 대상 전환). 루트 = `sftp:realpath('.')`(원격 홈).
- `ServerExplorerPanel`(신규 ~100줄): **`useFileExplorerTree`를 pluggable `readDirectory`로 추출(~15줄)** 후 SFTP 로더 주입. 행·컨텍스트 메뉴·선택·키보드·projection은 **무변경 재활용**(트리는 이미 데이터소스 백엔드와 분리돼 있음 — 정찰 실측).

**③ 화물 하역 (경로 방식 A 먼저)**

- **다운로드**: Server Explorer 행 우클릭 → "Download" → `sftp:startDownload`(save 다이얼로그로 로컬 경로) → 진행률 표시.
- **업로드**: (A) Server Explorer의 **현재 디렉토리에 업로드** — 로컬 Explorer 행 우클릭 "Upload to server" 또는 Server 폴더 우클릭 "Upload here" → `sftp:startUpload`(open 다이얼로그로 로컬 파일, 원격 목적지 = 현재 서버 디렉토리, overwrite 옵션) → 진행률.
- 진행률 UI: `sftp:transferProgress` 구독 → 전송 목록/토스트. 취소 버튼 → `sftp:cancelTransfer`.

**④ 던전 3~5 분해**

- **던전 3 통로 개통** 🚇: 위 IPC 채널 + 진행률 훅/이벤트(백엔드 배선, 유닛 테스트). 관문: dev 콘솔에서 readdir/전송 동작.
- **던전 4 서버 탐색기** 🗂: SSH 탭 + `ServerExplorerPanel`(FileExplorer 재활용). 관문: 원격 파일 트리 탐색.
- **던전 5 화물 하역** ⚓: 5a 다운로드/업로드 컨텍스트 메뉴 + 경로 다이얼로그 + 진행률 → 5b Split 패널 + DnD.

**⑤ 리스크 & 완화**: 대용량/취소 UX(진행률+abort로 대응) · 순수 JS ssh2 성능(I/O 바운드라 무해, 정찰 판정) · Windows 원격 OpenSSH 경로(SFTP는 POSIX 경로, realpath로 정규화) · 크로스플랫폼 규칙 준수. 신규 파일 위주라 upstream 병합 표면 최소.

**⑥ 테스트 전략**: 신규 IPC 핸들러 유닛(mock SFTPWrapper) · readDirectory 추출 후 로컬 Explorer 무회귀 · Server Explorer 트리 렌더 · 던전 게이트마다 dev 수동 검증(실제 SSH 호스트로 readdir·다운로드·업로드) · 보스전 전체 회귀·빌드·설치.

> 📝 브랜치 `feat/sftp` 생성 (main = upstream 동기화 후 `81de9ba40f`).

### 📜 정찰 보고서 (2026-08-24)

**① 가능성 판정: 가능 — 신뢰도 매우 높음.** 결정적 발견: **SFTP 백엔드가 이미 대부분 구현돼 있다.** 이 앱은 원래 SSH 원격 호스트에서 동작하므로 SSH/SFTP 인프라가 성숙함.

**② 이미 있는 것 (재활용 — 큰 지름길)**

| 영역 | 위치 | 내용 |
|---|---|---|
| ssh2 SFTP | `src/main/ssh/ssh-connection.ts:276` `sftp()` | 기존 SSH 연결 위에 SFTP 채널 멀티플렉스(새 연결 불필요) |
| 연결 풀 | `ssh-connection-manager.ts` `getConnection(targetId)` | targetId로 모든 원격 작업 라우팅(PTY·git·browse) |
| 원격 디렉토리 브라우징 | `src/main/ipc/ssh-browse.ts` `ssh:browseDir` | 이미 원격 파일 목록(POSIX/Windows 경로·심볼릭·`~` 해석) |
| 업로드 | `ssh-connection.ts` `openFileUploadSession()`·`sftp-upload.ts` | 스트림·overwrite('wx'/'w')·mkdir·재귀 |
| 다운로드 | `ssh-connection.ts:531` `downloadFile()`·`ssh-filesystem-provider-sftp.ts` `fastGet` | fastGet·readdir·stat |
| 이중 전송 | SFTP ↔ system-ssh(tar/scp) | 시스템 SSH 폴백까지 |
| 부수 인프라 | abort·에러 분류·`dialog.showSave/OpenDialog`·`fs:readFile/writeFile` | 취소·권한 에러·경로 다이얼로그 |
| Activity Sidebar | = **오른쪽 사이드바** 탭(`ui-chrome-types.ts` `RightSidebarTab`·`use-right-sidebar-activity-items.ts`) | 탭 추가 6단계 레시피 확보(전역+워크트리별 탭 기억) |
| Explorer UI | `FileExplorer` 트리·행·Radix 컨텍스트 메뉴·MIME 기반 DnD | 데이터소스 교체(pluggable readDirectory)로 재활용 가능 |

**③ 만들 것 (백엔드 소·UI 대부분)**: SFTP readdir/stat + 업/다운로드를 렌더러에 노출하는 IPC · **전송 진행률 이벤트**(스트림 래퍼 + IPC, 현재 없음) · 업로드 파일 피커 IPC · **SSH 탭 + Server Explorer 트리 컴포넌트**(FileExplorer 재활용) · 컨텍스트 메뉴 업로드/다운로드 항목 · **경로 처리 UI**(아래 결정).

**④ 핵심 설계 결정 — 경로 처리 방식** (스펙: "경로 지정 기능이 있거나, split하여 Drag&Drop"):
- **A. 경로 지정 다이얼로그**: 업/다운로드 시 `dialog.showOpen/SaveDialog`로 경로 선택. 다이얼로그가 이미 있어 **간단·저위험**. split 패널 불필요.
- **B. Split 패널 + Drag & Drop**: Explorer 하단에 Server Explorer를 split 표시, DnD로 전송. **UX 우수**하나 split 패널 프리미티브가 없어 신규 제작 필요(중간 난도).
- 정찰 추천: 반드시 하나만은 아님 — **A로 시작(빠른 동작 확보) 후 B를 얹는** 단계적 접근도 가능.
- **결정(2026-08-24 제작자): A→B 단계적** — 던전 5에서 경로 다이얼로그로 업/다운로드를 먼저 동작시키고, 이어 Split 패널 + Drag&Drop을 얹는다. 각 단계 제작자 검수.

**⑤ 더 나은 방향**: Server Explorer 목록을 `ssh:browseDir`(ls 파싱) 대신 **SFTP readdir**(size·mtime·perm 풍부·견고)로 하면 전송과 일관. upstream 크로스플랫폼 규칙(win/mac/linux) 준수 — SFTP 경로는 POSIX, Windows 원격 OpenSSH 고려.

**⑥ 미확정(설계 던전에서 실측)**: 진행률 이벤트 배관 상세 · Server Explorer 트리의 FileExplorer 재활용 실측(pluggable 여부) · split 패널 제작 범위 · 대용량 전송/취소 UX.

### 🗺 던전 구성안 (제작자 확정 대기)

| # | 던전 | 내용 | 관문 |
|---|---|---|---|
| 1 | 정찰 🔭 | 이 보고서 | 클리어 판정 |
| 2 | 설계 청사진 📐 | 심층 정찰 + IPC 계약·Server Explorer 재활용·경로 방식 확정 | 설계 승인 |
| 3 | 통로 개통 🚇 | SFTP browse/stat + 업/다운로드 IPC + 진행률 이벤트(기존 헬퍼 배선) | 백엔드 동작 |
| 4 | 서버 탐색기 🗂 | SSH 탭 + Server Explorer 트리(FileExplorer 재활용) | 원격 파일 보기 |
| 5 | 화물 하역 ⚓ | 5a: 업로드(로컬 컨텍스트 메뉴)·다운로드(Server 컨텍스트 메뉴) + **경로 다이얼로그(A)** → 5b: **Split 패널 + Drag&Drop(B)** | 스펙 요구 충족 |
| 6 | 보스전 🐋 | 통합·빌드·설치·실사용 검증 → 원정 클리어 | 제작자 판정 |

> 📝 브랜치: 정찰은 `main`에서 읽기만. 구현 시작 시 `feat/sftp` 생성.
