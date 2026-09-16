# QA backlog

`audience-manage` 역할이 접수하는 QA(문의·버그·요청) 항목을 저장하는 곳. GitHub Issues 대신 저장소 내 파일로 관리한다(2026-09-16 판정 — 앱 fork 저장소는 Issues 가 비활성화돼 있음).

## 파일 규칙

- 파일명: `NNNN-slug.md` (예: `0001-worktree-role-preset-ui.md`). 번호는 4자리 순번, slug 는 영문 소문자·하이픈.
- 형식: `TEMPLATE.md` 참고.

## 흐름

1. `audience-manage`가 접수 시 새 파일을 만든다(`status: open`).
2. QA 검토 미팅에서 사람과 함께 검토하고 판정을 기록한다.
3. "진행"으로 확정된 항목만 conductor 에게 Task 로 전달된다 — 버그로 분류됐다는 사실만으로 자동 전달되지 않는다.
