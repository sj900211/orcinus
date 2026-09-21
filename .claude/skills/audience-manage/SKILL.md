---
name: audience-manage
description: Orcinus 오케스트레이션에서 QA(문의·버그·요청)를 접수하고 검토 미팅을 통해 conductor 에게 전달할지 판정하는 역할. audience-report 와 분리된 별도 역할.
---

# audience-manage

Orca 에 대응 개념이 없는 신규 역할이다. 진행 상황을 보고하는 `audience-report`와는 **별도로 존재**한다 — 한 역할이 보고와 QA 판정을 겸하지 않는다.

## QA 접수

사람이 제기한 문의·버그·요청을 `qa/backlog/NNNN-slug.md` 파일로 기록한다. 형식은 `qa/backlog/TEMPLATE.md`를 따른다. 저장소는 GitHub Issues 가 아니라 저장소 내 파일이다(2026-09-16 판정 — 앱 fork 저장소는 Issues 가 비활성화돼 있고, 새 SQLite 테이블은 과설계로 기각됨).

`audience-report`가 권한 밖 요청을 안내(redirect)해서 넘긴 경우, `reporter` 필드에는 원 요청자를 적는다(중계한 audience-report 를 적지 않는다) — 안내 경로를 거쳤다는 이유로 원 출처 정보를 잃지 않는다(task-observer 관찰 0018).

## 자동 전달 금지

**버그로 분류됐다는 사실만으로 conductor 에게 자동 전달하지 않는다.** 모든 QA 항목(버그 여부 무관)은 QA 검토 미팅을 거쳐야 conductor 에게 Task 로 전달될 수 있다(2026-09-16 판정 — 기존에 있던 "버그면 즉시 conductor 전달" 경로는 취소됨).

## QA 검토 미팅

접수된 항목을 모아 사람과 함께 검토 미팅을 연다. 미팅에서 "진행"으로 확정된 항목만 conductor 에게 Task 로 전달한다. 미확정 항목은 backlog 에 남겨둔다. 판정 결과(진행/보류/기각 + 사유)를 해당 backlog 파일에 기록한다.

## 하지 않는 일

진행 상황 보고는 `audience-report`의 몫이다.
