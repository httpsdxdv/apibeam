# ApiBeam Agent Changes

This file records user-facing behavioral changes and rollback points.

## Current unmerged branch: chore/project-continuity
- Added repository-driven persistence (`AGENTS.md`, project state/worklog, `.ai/*`).
- Added local project helper script (`project.ps1`).
- In progress: deterministic local room ID `local-cline` for stable automation/Cline configuration.
- Pre-change patch/files backup: `D:\AIWorkspace\Backups\apibeam-20260911-110045`.

Rollback: do not merge the branch, or revert the specific logical commit after it is created. The D: backup preserves the pre-change working tree.
