# Pipeline Brainstorming Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 multi-agent-pipeline 的 Spec 阶段前新增 Brainstorming 阶段，由 orchestrator 主导用户对话，产出 `design.md`，再由 Spec subagent 生成 `spec.md`（中文，含设计理由）+ `spec.json`，用户批准 spec.md 后进入 Plan。

**Architecture:** 纯文档改动，不涉及代码。修改 3 个文件：`SKILL.md`（新增 Brainstorming 章节、更新流程、更新 Workspace、更新 Spec 章节）、`agents/spec.md`（双输出）、`references/contracts.md`（新增 spec.md 格式）。所有变更在 pipeline skill 的独立 git 仓库（`~/.claude/skills/multi-agent-pipeline/`）中提交。

**Tech Stack:** Markdown 文本编辑，git commit

---

## 文件清单

| 文件 | 操作 |
|------|------|
| `~/.claude/skills/multi-agent-pipeline/SKILL.md` | 修改 |
| `~/.claude/skills/multi-agent-pipeline/agents/spec.md` | 修改 |
| `~/.claude/skills/multi-agent-pipeline/references/contracts.md` | 修改 |

---

### Task 1: 更新 SKILL.md frontmatter 和 Workspace

**Files:**
- Modify: `~/.claude/skills/multi-agent-pipeline/SKILL.md:1-99`

- [ ] **Step 1: 更新 frontmatter description，加入 Brainstorming**

将第 4-9 行替换为：

```markdown
  Claude Code multi-agent production pipeline for non-trivial implementation work. Uses
  the Agent tool to run Brainstorming, Spec, Plan, Architecture, Execution, Review, and
  Doc stages, persists artifacts in `.pipeline-workspace/`, and loops Execution and Review
  until the change passes. Use when the user wants a feature, refactor, or subsystem built
  with explicit brainstorming/spec/plan/architecture/review stages, or mentions "pipeline",
  "multi-agent", "production workflow", or "full implementation".
```

- [ ] **Step 2: 更新 Workspace 文件树，加入 design.md 和 spec.md**

将第 83-99 行的 workspace 代码块替换为：

```text
.pipeline-workspace/
├── design.md
├── spec.md
├── spec.json
├── plan.json
├── architecture.json
├── execution-report.json
├── validation-report.json
├── review_feedback.json
├── doc-report.json
├── review_history/
│   ├── iteration-1-reviewer-1.json
│   ├── iteration-1-reviewer-2.json
│   ├── iteration-1-reviewer-3.json
│   └── ...
└── logs/
    └── pipeline.log
```

- [ ] **Step 3: 验证修改正确**

```bash
grep -n "design.md\|spec.md\|Brainstorming" ~/.claude/skills/multi-agent-pipeline/SKILL.md | head -20
```

预期输出：frontmatter 中出现 Brainstorming，workspace 列表中出现 design.md 和 spec.md。

- [ ] **Step 4: 提交**

```bash
cd ~/.claude/skills/multi-agent-pipeline
git add SKILL.md
git commit -m "feat: update frontmatter and workspace for brainstorming stage"
```

---

### Task 2: 在 SKILL.md Pipeline 章节前插入 Brainstorming 阶段

**Files:**
- Modify: `~/.claude/skills/multi-agent-pipeline/SKILL.md:103-117`

- [ ] **Step 1: 在 `### 1. Spec` 之前插入新的 `### 0. Brainstorming` 章节**

在第 104 行（`## Pipeline` 下方的空行之后，`### 1. Spec` 之前）插入以下内容：

```markdown
### 0. Brainstorming

Brainstorming 由 orchestrator 直接与用户对话，不通过 subagent 执行。

Goal:
- 探索项目上下文（读取相关文件、git log）
- 逐一向用户提问（每次一个问题，优先多选题），聚焦目的、约束、成功标准
- 提出 2-3 种方案，附权衡分析和推荐理由
- 逐节呈现设计方案，每节后询问用户确认
- 获得用户批准后，将设计内容写入 `.pipeline-workspace/design.md`

`design.md` 格式：
- 自由 Markdown 格式，覆盖目标、方案选择、约束、成功标准
- 语言与用户对话语言一致
- 这是 pipeline 内部 artifact，不写入代码库 `docs/` 目录

User approval rule:
- Orchestrator 明确询问用户是否批准设计（"这个设计方向你确认了吗？"）
- 未获批准前不进入 Spec 阶段
- 用户要求修改时，继续对话并更新 `design.md`

```

- [ ] **Step 2: 验证插入位置正确**

```bash
grep -n "### 0. Brainstorming\|### 1. Spec\|### 2. Plan" ~/.claude/skills/multi-agent-pipeline/SKILL.md
```

预期输出：`### 0. Brainstorming` 行号 < `### 1. Spec` 行号 < `### 2. Plan` 行号。

- [ ] **Step 3: 提交**

```bash
cd ~/.claude/skills/multi-agent-pipeline
git add SKILL.md
git commit -m "feat: add Brainstorming stage 0 to pipeline"
```

---

### Task 3: 更新 SKILL.md 的 Spec 章节（加双输出和用户批准门）

**Files:**
- Modify: `~/.claude/skills/multi-agent-pipeline/SKILL.md`（原 `### 1. Spec` 章节）

- [ ] **Step 1: 替换 Spec 章节内容**

找到当前 `### 1. Spec` 章节（内容为 "Spawn the Spec subagent using..." 到下一个 `###` 之前），替换为：

```markdown
### 1. Spec

Spawn the Spec subagent using `agents/spec.md` and `references/contracts.md`. Pass the contents of `.pipeline-workspace/design.md` inline in the prompt.

Goal:
- Read `design.md` and turn it into two outputs: `spec.md` (human-readable, Chinese) and `spec.json` (structured, for downstream stages)
- `spec.json`: record explicit assumptions instead of stopping on every ambiguity, keep scope tight and acceptance criteria testable
- `spec.md`: Chinese, one section per requirement with design rationale, follows the format in `references/contracts.md`

User approval gate:
- After the Spec subagent returns, orchestrator writes both `spec.md` and `spec.json` to `.pipeline-workspace/`
- Orchestrator presents `spec.md` to the user and explicitly asks for approval
- Do not start Plan until the user approves
- If the user requests changes, rerun the Spec subagent with the user's feedback appended to the prompt
- Rerun until the user approves

```

- [ ] **Step 2: 验证 Spec 章节更新正确**

```bash
grep -n "design.md\|spec.md\|User approval gate\|user approves" ~/.claude/skills/multi-agent-pipeline/SKILL.md
```

预期输出：这几个关键词都出现在 Spec 章节对应行号范围内。

- [ ] **Step 3: 提交**

```bash
cd ~/.claude/skills/multi-agent-pipeline
git add SKILL.md
git commit -m "feat: update Spec stage for dual output and user approval gate"
```

---

### Task 4: 更新 agents/spec.md（双输出、中文 spec.md、格式规范）

**Files:**
- Modify: `~/.claude/skills/multi-agent-pipeline/agents/spec.md`

- [ ] **Step 1: 替换整个 agents/spec.md 内容**

```markdown
# Spec Agent

You are a Spec subagent in a Claude Code multi-agent pipeline, spawned via the `Agent` tool.

## Mission

Read `design.md` (the brainstorming output) and produce two artifacts:
1. `spec.json` — structured, for Plan / Architecture / Execution agents
2. `spec.md` — human-readable Chinese spec, for user approval

## Inputs

- `design.md` content (passed inline in this prompt by the orchestrator)
- `references/contracts.md` (read via the `Read` tool if needed)

## Output

Return exactly **two** fenced blocks and no extra prose:

1. A `json` block containing the `spec.json` payload matching the contract in `references/contracts.md`
2. A `markdown` block containing the `spec.md` payload (format specified below)

Example structure:
````
```json
{ ... spec.json content ... }
```

```markdown
# [功能名称] 规格说明
...
```
````

## spec.md Format

Write `spec.md` in Chinese. Follow this exact structure:

```markdown
# [功能名称] 规格说明

## 目标
[一段话说明要做什么、为什么要做]

## 需求

### REQ-001：[标题]
- **优先级：** 必须有 / 应该有 / 可以有
- **描述：** [需求内容]
- **设计理由：** [为什么需要这个需求，背景和动机]
- **验收标准：**
  - [具体可测试的标准1]
  - [具体可测试的标准2]

### REQ-002：[标题]
...

## 约束
- [约束项]：[为什么存在这个约束]

## 范围外
- [排除项]：[为什么不做]

## 假设
- [假设内容]：[依据]
```

Rules for `spec.md`:
- Language: Chinese throughout
- Every requirement must have a `设计理由` explaining the motivation
- Every constraint and out-of-scope item must include a brief reason
- `优先级` mapping: `must-have` → `必须有`, `should-have` → `应该有`, `nice-to-have` → `可以有`

## spec.json Rules

- Do not ask the user directly. The orchestrator owns user communication.
- Default to explicit assumptions instead of blocking on every ambiguity.
- Only leave an assumption in `assumptions` when it is reasonable and low-risk.
- If an ambiguity would materially change the scope or acceptance criteria, surface it in `assumptions` with a note that the orchestrator should confirm before execution.

## Process

1. Read `design.md` to understand the agreed feature, approach, constraints, and success criteria.
2. Break the request into discrete requirements with objective acceptance criteria.
3. List backward-compatibility, performance, security, and scope constraints.
4. Record non-blocking assumptions explicitly.
5. Keep `out_of_scope` tight so downstream stages do not expand the work.
6. Write `spec.json` matching the contract.
7. Write `spec.md` in Chinese with design rationale for every section.

## Quality Bar

- Requirements must be independently verifiable.
- Acceptance criteria must be concrete enough to test.
- Prefer a smaller, clearer scope over a broad speculative scope.
- The spec should be immediately usable by Plan and Architecture without follow-up prose.
- `spec.md` must be readable and informative to a Chinese-speaking user with no pipeline context.
```

- [ ] **Step 2: 验证文件写入正确**

```bash
grep -n "spec.md\|design.md\|markdown\|设计理由\|Chinese" ~/.claude/skills/multi-agent-pipeline/agents/spec.md
```

预期输出：这几个关键词都出现。

- [ ] **Step 3: 提交**

```bash
cd ~/.claude/skills/multi-agent-pipeline
git add agents/spec.md
git commit -m "feat: update Spec agent for dual output with Chinese spec.md"
```

---

### Task 5: 更新 references/contracts.md（新增 spec.md 格式说明）

**Files:**
- Modify: `~/.claude/skills/multi-agent-pipeline/references/contracts.md:1-48`

- [ ] **Step 1: 更新 spec.json 的 Produced by 注释，加入 design.md 来源说明**

将第 6-8 行替换为：

```markdown
Produced by: **Spec Agent** (reads `design.md` from Brainstorming stage)
Consumed by: **Plan Agent**, **Architecture Agent**, **Execution Agent**, **Review Agent**, **Doc Agent**
```

- [ ] **Step 2: 在 spec.json 章节结束（`---` 分隔线之前）插入 spec.md 章节**

在第 48 行（spec.json 章节末尾的 `---` 之前）插入：

```markdown
---

## spec.md

Produced by: **Spec Agent**
Consumed by: **User** (approval gate before Plan stage)

Human-readable Chinese specification document. Written in Markdown. Presented to the user by the orchestrator for explicit approval before the Plan stage begins.

### Format

```markdown
# [功能名称] 规格说明

## 目标
[一段话说明要做什么、为什么要做]

## 需求

### REQ-001：[标题]
- **优先级：** 必须有 / 应该有 / 可以有
- **描述：** [需求内容]
- **设计理由：** [为什么需要这个需求，背景和动机]
- **验收标准：**
  - [具体可测试的标准1]

## 约束
- [约束项]：[为什么存在这个约束]

## 范围外
- [排除项]：[为什么不做]

## 假设
- [假设内容]：[依据]
```

### Field Rules

- Language: Chinese throughout.
- `设计理由`: Required for every requirement. Explains motivation, not just what.
- Every constraint and out-of-scope item must include a brief reason clause.
- REQ IDs must match exactly with corresponding entries in `spec.json`.

```

- [ ] **Step 3: 验证修改正确**

```bash
grep -n "spec.md\|design.md\|设计理由\|Brainstorming" ~/.claude/skills/multi-agent-pipeline/references/contracts.md
```

预期输出：三个关键词都出现。

- [ ] **Step 4: 提交**

```bash
cd ~/.claude/skills/multi-agent-pipeline
git add references/contracts.md
git commit -m "feat: add spec.md contract and update spec.json source annotation"
```

---

### Task 6: 端到端验证

**Files:** 无新文件，验证所有修改的一致性

- [ ] **Step 1: 确认 SKILL.md 中流程编号正确**

```bash
grep -n "^### [0-9]" ~/.claude/skills/multi-agent-pipeline/SKILL.md
```

预期输出：
```
### 0. Brainstorming
### 1. Spec
### 2. Plan
### 3. Architecture
### 4. Execution
### 4a. Validation
### 5. Review
### 5a. Architecture Rework
### 5b. Plan Rework
### 6. Documentation
```

- [ ] **Step 2: 确认 workspace 文件树包含所有新 artifact**

```bash
grep -A 20 "Create a run workspace" ~/.claude/skills/multi-agent-pipeline/SKILL.md | grep "├\|└"
```

预期输出：列表中包含 `design.md` 和 `spec.md`。

- [ ] **Step 3: 确认 agents/spec.md 双输出格式正确**

```bash
grep -n "json block\|markdown block\|two.*fenced\|fenced.*two" ~/.claude/skills/multi-agent-pipeline/agents/spec.md
```

预期输出：出现关于两个 fenced block 的说明。

- [ ] **Step 4: 确认 contracts.md 有 spec.md 章节**

```bash
grep -n "^## spec.md" ~/.claude/skills/multi-agent-pipeline/references/contracts.md
```

预期输出：输出一行，包含 `## spec.md`。

- [ ] **Step 5: 最终提交（如有未提交的改动）**

```bash
cd ~/.claude/skills/multi-agent-pipeline
git status
git log --oneline -6
```

预期输出：`git status` 显示 clean working tree，`git log` 显示本次 4 个新提交。
