# Multi-Language Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Go-only Validation Agent with a language-aware agent that auto-detects the project language and runs the appropriate fix + check commands.

**Architecture:** Language detection scans the repo root for marker files, selects per-language command sets from a routing table, runs fix-layer commands first (with write permission), then check-layer commands (read-only). Contract is extended with `detected_language` and per-command `type` fields. Conflicting PostToolUse hooks are removed so the pipeline is the single quality gate.

**Tech Stack:** Markdown (skill files), JSON (contracts), Bash commands per language (ruff, mypy, pytest, go test, cargo, etc.)

---

### Task 1: Remove conflicting PostToolUse hooks from settings.json

**Files:**
- Modify: `/Users/united_pooh/.claude/settings.json`

- [ ] **Step 1: Read current settings**

Open `/Users/united_pooh/.claude/settings.json` and confirm the two hooks to remove are present:
- The `ruff format --fix` command under `PostToolUse`
- The `mypy-feedback.sh` command under `PostToolUse`

- [ ] **Step 2: Remove both Python hooks, keep the rest**

The `PostToolUse` block after the change should contain only the `matcher: "Write|Edit"` entry removed entirely (since both hooks inside it are being deleted). The `Stop` and `SubagentStop` hooks stay untouched.

Result — the `hooks` section should look like:

```json
"hooks": {
  "Stop": [
    {
      "hooks": [
        {
          "command": "osascript -e 'display notification \"Claude 完成了\" with title \"Claude Code\"'",
          "statusMessage": "发送完成通知...",
          "type": "command"
        }
      ]
    }
  ],
  "SubagentStop": [
    {
      "hooks": [
        {
          "command": "osascript -e 'display notification \"子 Agent 完成\" with title \"Pipeline Stage\"'",
          "statusMessage": "发送 stage 完成通知...",
          "type": "command"
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Verify JSON is valid**

```bash
cat /Users/united_pooh/.claude/settings.json | python3 -m json.tool > /dev/null && echo "valid JSON"
```

Expected: `valid JSON`

- [ ] **Step 4: Commit**

```bash
git add /Users/united_pooh/.claude/settings.json
git commit -m "chore: remove ruff and mypy PostToolUse hooks — pipeline is now single quality gate"
```

---

### Task 2: Extend validation-report.json contract in contracts.md

**Files:**
- Modify: `skills/multi-agent-pipeline/references/contracts.md`

- [ ] **Step 1: Locate the validation-report.json schema**

In `references/contracts.md`, find the `## validation-report.json` section. The current `commands_run` entry looks like:

```json
{
  "command": "string — exact command run",
  "exit_code": 0,
  "output": "string — full stdout/stderr"
}
```

- [ ] **Step 2: Add `detected_language` field and `type` field to commands_run**

Replace the `validation-report.json` JSON block with:

```json
{
  "version": "1.0",
  "detected_language": "go | python | javascript | typescript | rust | java | ruby | unknown",
  "status": "passed | failed | error | skipped",
  "commands_run": [
    {
      "command": "string — exact command run",
      "type": "fix | check",
      "exit_code": 0,
      "output": "string — full stdout/stderr"
    }
  ],
  "test_summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "skipped": 0
  },
  "blocking_failures": [
    "string — failing test name or vet error, one per entry"
  ]
}
```

- [ ] **Step 3: Update the Field Rules section for validation-report.json**

Add these rules after the existing ones:

```
- `detected_language`: The language detected from repo root marker files. Set to `unknown` when no marker file is found.
- `status`: Add `skipped` — set when `detected_language` is `unknown`; orchestrator treats `skipped` as a soft pass and proceeds to Review.
- `commands_run[].type`: `fix` for commands that write files (formatters, import sorters); `check` for read-only commands (tests, type checkers, linters that only report).
```

- [ ] **Step 4: Commit**

```bash
git add skills/multi-agent-pipeline/references/contracts.md
git commit -m "feat: extend validation-report.json contract with detected_language and command type"
```

---

### Task 3: Rewrite validation.md with language detection and routing table

**Files:**
- Modify: `skills/multi-agent-pipeline/agents/validation.md`

- [ ] **Step 1: Replace the Mission section**

The current Mission section says "Run `go test ./...` and `go vet ./...`". Replace the entire file content with the new language-aware version below.

The new `validation.md`:

````markdown
# Validation Agent

You are a Validation subagent in a Claude Code multi-agent pipeline, spawned via the `Agent` tool. Your role is to gather objective evidence by running automated checks. You do not make subjective quality judgments — that is the Review agent's job.

## Mission

Detect the project language, run the appropriate fix-layer commands (with write permission), then run check-layer commands (read-only). Return a `validation-report.json` with full command output, detected language, and per-command type annotations.

## Inputs

All inputs are passed inline in this prompt by the orchestrator:
- `execution-report.json` content — to know which files were changed
- Repo root path

## Output

Return exactly one fenced `json` block containing a `validation-report.json` payload matching the contract in `references/contracts.md`. Do not return prose outside the JSON block.

## Process

### Step 1: Detect Language

Scan the repo root for marker files in this priority order. Collect ALL matches (for multi-language repos).

| Marker file | Language |
|---|---|
| `go.mod` | `go` |
| `pyproject.toml`, `setup.py`, `requirements.txt` | `python` |
| `package.json` | `javascript` (or `typescript` if any `.ts` files exist) |
| `Cargo.toml` | `rust` |
| `pom.xml`, `build.gradle` | `java` |
| `Gemfile` | `ruby` |

If no marker file is found: set `detected_language = "unknown"`, `status = "skipped"`, return immediately with empty `commands_run` and zeroed `test_summary`.

If exactly one language is detected: set `detected_language` to that language.

If multiple languages are detected: set `detected_language` to the primary language (the one whose marker file appears first in the priority list above), and run command sets for all detected languages.

### Step 2: Run Fix Layer

Fix-layer commands have write permission. They run **before** any check commands. Run them in the order listed for each language.

**If a fix command itself fails to execute** (tool not found, permission error, compilation error that prevents the tool from starting) → set `status = "error"`, record the command in `commands_run`, stop immediately. Do not proceed to the check layer.

Fix commands that exit non-zero due to unfixable issues (e.g., syntax error ruff cannot fix) are also treated as `status = "error"`.

#### Go
No fix-layer commands.

#### Python
```
ruff format --fix
ruff check --fix --select I,F401
```

#### JavaScript / TypeScript
```
eslint --fix        (only if .eslintrc*, eslint.config.*, or "eslintConfig" in package.json exists)
```

#### Rust
```
cargo fmt
```

#### Ruby
```
rubocop --auto-correct-all
```

#### Java
No fix-layer commands.

### Step 3: Run Check Layer

Check-layer commands are read-only. They run after all fix commands complete successfully.

Any non-zero exit code → add failing tests or diagnostics to `blocking_failures`. Continue running remaining check commands (do not stop on first failure). After all check commands finish, set `status = "failed"` if any check exited non-zero.

#### Go
```
go vet ./...
go test ./...
```

#### Python
```
mypy .
pytest          (only if tests/ directory exists at repo root)
```

#### JavaScript / TypeScript
```
tsc --noEmit    (only if tsconfig.json exists)
npm test        (use vitest directly if scripts.test in package.json invokes vitest)
```

#### Rust
```
cargo clippy
cargo test
```

#### Java
```
mvn verify      (if pom.xml exists)
gradle test     (if build.gradle exists and pom.xml does not)
```

#### Ruby
```
bundle exec rspec
```

### Step 4: Determine Final Status

- `passed` — all fix and check commands exited 0
- `failed` — one or more check commands exited non-zero
- `error` — one or more fix commands failed to execute, or a compile error prevented test execution
- `skipped` — no language detected

### Step 5: Build and Return validation-report.json

Populate all fields per the contract in `references/contracts.md`:
- `detected_language`: as determined in Step 1
- `status`: as determined in Step 4
- `commands_run`: every command attempted, in order, each with `command`, `type` (`fix` or `check`), `exit_code`, and full `output`
- `test_summary`: aggregate counts across all test commands; zeroes if no test commands ran
- `blocking_failures`: individual failing test names or diagnostic lines; empty array when `status` is `passed` or `skipped`

## Rules

- Fix-layer commands may write files. Check-layer commands must not.
- Do not skip a check command because a previous check command failed — run all of them to give full evidence to the Review agent.
- Do not truncate command output in the JSON — include full stdout/stderr.
- Do not interpret results or make pass/fail recommendations beyond what the status field communicates — report raw facts only.
- Record every command attempted in `commands_run`, even if it failed to start.
- If a tool is not installed, set `status = "error"` and describe the missing tool in the `output` field of that command entry.
````

- [ ] **Step 2: Verify the file was written correctly**

```bash
head -5 skills/multi-agent-pipeline/agents/validation.md
```

Expected: starts with `# Validation Agent`

- [ ] **Step 3: Commit**

```bash
git add skills/multi-agent-pipeline/agents/validation.md
git commit -m "feat: rewrite Validation Agent with multi-language detection and fix/check two-layer execution"
```

---

### Task 4: Self-review against spec

- [ ] **Step 1: Verify all spec requirements are covered**

Check each spec section against the plan:

| Spec requirement | Covered by |
|---|---|
| Language auto-detection via marker files | Task 3, Step 1 |
| Priority order, first match wins | Task 3, Step 1 |
| Multi-language repo support | Task 3, Step 1 (collect ALL matches) |
| `unknown` → `skipped` | Task 3, Step 1 |
| Python fix layer: ruff format + ruff check | Task 3, Step 2 |
| Python check layer: mypy + pytest | Task 3, Step 3 |
| JS/TS fix: eslint --fix (conditional) | Task 3, Step 2 |
| JS/TS check: tsc --noEmit + npm test | Task 3, Step 3 |
| Rust fix: cargo fmt | Task 3, Step 2 |
| Rust check: clippy + test | Task 3, Step 3 |
| Java check only: mvn/gradle | Task 3, Step 3 |
| Ruby fix: rubocop | Task 3, Step 2 |
| Ruby check: rspec | Task 3, Step 3 |
| Fix tool error → status = "error", stop | Task 3, Step 2 |
| Check failures → continue all checks | Task 3, Step 3 |
| `detected_language` in contract | Task 2 |
| `type: fix\|check` per command in contract | Task 2 |
| `status = "skipped"` added to contract | Task 2 |
| Remove ruff + mypy hooks | Task 1 |

- [ ] **Step 2: Final commit check**

```bash
git log --oneline -4
```

Expected: 3 commits from this plan visible (tasks 1, 2, 3).
