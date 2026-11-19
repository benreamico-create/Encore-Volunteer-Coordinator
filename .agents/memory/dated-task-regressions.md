---
name: Dated task regression coverage
description: Why task movement tests must use due dates persisted and reloaded from PostgreSQL
---
Exercise status, ordering and assignment changes on tasks whose due dates have already been saved and reloaded, not only on undated tasks or freshly constructed request objects.

**Why:** The initial undated CRUD checks passed while real task movement failed. Raw PostgreSQL DATE results were JavaScript Date objects, and request-format validation accidentally ran against the merged stored row during a status-only change. A valid stored date then caused an unrelated update to fail.

**How to apply:** Preserve the separation between request validation and stored values. Include persisted dated tasks in task-board regressions, even if the requested change is only to status, order or assignee.
