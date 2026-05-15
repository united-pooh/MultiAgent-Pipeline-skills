# Multi-Language Validation Design

**Date:** 2026-05-15  
**Status:** Approved  
**Scope:** `skills/multi-agent-pipeline/agents/validation.md` + `references/contracts.md`

---

## Problem

The Validation Agent currently hard-codes `go test ./...` and `go vet ./...`. When the pipeline runs on Python or JavaScript projects, the validation stage produces no useful signal — or worse, errors out entirely — leaving the Review stage without objective evidence.

---

## Solution

Introduce language auto-detection and a command routing table directly inside `validation.md`. The Validation Agent detects the project language at runtime, selects the appropriate command set, and executes commands in two layers: a **fix layer** (writes files) and a **check layer** (read-only).

---

## Language Detection

Scan the repository root for marker files in priority order. First match wins.

| Marker file | Detected language |
|---|---|
| `go.mod` | Go |
| `pyproject.toml`, `setup.py`, `requirements.txt` | Python |
| `package.json` | JavaScript (TypeScript if `.ts` files exist) |
| `Cargo.toml` | Rust |
| `pom.xml`, `build.gradle` | Java |
| `Gemfile` | Ruby |
| None of the above | `unknown` → skip validation, `status = "skipped"` |

**Multi-language repos:** Run all matched language command sets. Any failure across any language marks the overall status as `failed`.

---

## Command Routing Table

### Go
| Layer | Command |
|---|---|
| check | `go vet ./...` |
| check | `go test ./...` |

### Python
| Layer | Command |
|---|---|
| fix | `ruff format --fix` |
| fix | `ruff check --fix --select I,F401` |
| check | `mypy .` |
| check | `pytest` (only if `tests/` directory exists) |

### JavaScript / TypeScript
| Layer | Command |
|---|---|
| fix | `eslint --fix` (only if ESLint config exists) |
| check | `tsc --noEmit` (only if `tsconfig.json` exists) |
| check | `npm test` or `vitest` (whichever is configured in `package.json`) |

### Rust
| Layer | Command |
|---|---|
| fix | `cargo fmt` |
| check | `cargo clippy` |
| check | `cargo test` |

### Java
| Layer | Command |
|---|---|
| check | `mvn verify` or `gradle test` (whichever build file is present) |

### Ruby
| Layer | Command |
|---|---|
| fix | `rubocop --auto-correct-all` |
| check | `bundle exec rspec` |

---

## Execution Rules

**Fix layer** (has write permission):
- Runs first, before any check commands.
- Directly modifies files in the workspace (format, import sort, unused import removal).
- If the tool itself errors (not a fixable issue, but a tool failure) → set `status = "error"` and stop. Do not proceed to check layer.
- File modifications made by fix commands are reported in `commands_run` with `"type": "fix"`.

**Check layer** (read-only):
- Runs after all fix commands complete successfully.
- Never modifies files.
- Any non-zero exit code → `status = "failed"`, individual failures written to `blocking_failures`.
- All check output included in full in `commands_run[].output`.

**Status rules:**
- `passed` — all commands (fix + check) exit 0
- `failed` — any check command exits non-zero
- `error` — any fix command fails to run, or compilation prevents test execution
- `skipped` — language is `unknown`; orchestrator treats this as a soft pass and proceeds to Review

---

## Contract Changes

`validation-report.json` gets two new fields:

```json
{
  "detected_language": "go | python | javascript | typescript | rust | java | ruby | unknown",
  "commands_run": [
    {
      "command": "string — exact command run",
      "type": "fix | check",
      "exit_code": 0,
      "output": "string — full stdout/stderr"
    }
  ]
}
```

`type` is added to each entry in `commands_run`. All other fields remain unchanged.

---

## Files to Change

| File | Change |
|---|---|
| `agents/validation.md` | Replace Go-only instructions with language detection logic, routing table, and two-layer execution rules |
| `references/contracts.md` | Add `detected_language` field and `type` field to `commands_run` entries in `validation-report.json` schema |

---

## Hook Conflict Resolution

The project's `.claude/settings.json` currently has two `PostToolUse` hooks that fire on every `Write`/`Edit`:

1. `ruff format --fix` on `.py` files
2. `mypy-feedback.sh`

These overlap directly with the Python fix and check layers in Validation. Keeping both means ruff runs twice per pipeline (hook fires during Execution, Validation fires again), and mypy runs at two different scopes (hook = per-file, Validation = whole project), producing inconsistent signals.

**Decision: remove both Python hooks from `.claude/settings.json`.**

The pipeline becomes the single quality gate. `ruff format --fix`, `ruff check --fix`, and `mypy` all run exclusively in the Validation stage.

**Trade-off accepted:** Python files edited outside the pipeline (e.g., quick manual edits) will no longer be auto-formatted on save. This is acceptable — the pipeline is the intended workflow for any non-trivial change.

**Files to Change (addition):**

| File | Change |
|---|---|
| `.claude/settings.json` | Remove the `ruff format` and `mypy-feedback.sh` entries from the `PostToolUse` hook |

---

## Out of Scope

- Adding language detection to `spec.json` or any other artifact
- Supporting custom validation commands via user config
- Caching or skipping validation when no files changed
