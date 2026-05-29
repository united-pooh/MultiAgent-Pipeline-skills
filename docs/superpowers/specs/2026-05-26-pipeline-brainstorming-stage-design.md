# Pipeline Brainstorming Stage Design

**日期：** 2026-05-26  
**范围：** 在 multi-agent-pipeline skill 的 Spec 阶段前新增 Brainstorming 阶段

---

## 目标

在自动化管道中加入用户协作发现阶段，让模糊的需求在进入 Spec 形式化之前先经过对话澄清和设计确认，减少因需求理解偏差导致的下游返工。

---

## 新 Pipeline 流程

```
Brainstorming (orchestrator 主导，用户交互)
    ↓  产出 design.md，用户批准设计
Spec subagent
    ↓  读取 design.md → 产出 spec.md（用户批准）+ spec.json
Plan subagent
    ↓  读取 spec.json → 产出 plan.json
Architecture subagent
    ↓
Execution → Validation → Review → Doc
（不变）
```

用户有两个显式批准点：
1. Brainstorming 结束时批准 `design.md`
2. Spec 结束时批准 `spec.md`

---

## 需求

### REQ-001：Brainstorming 阶段由 Orchestrator 主导

- **优先级：** 必须有
- **描述：** Brainstorming 不通过 subagent 执行，由 orchestrator 直接与用户对话。
- **设计理由：** subagent 无法直接与用户交互，brainstorming 需要实时的来回对话（逐一提问、方案确认）。Orchestrator 本身就是用户通信的唯一所有者，由其主导最自然。
- **验收标准：**
  - SKILL.md 中有专门的 Brainstorming 章节，描述 orchestrator 的行为
  - 无新 `agents/brainstorming.md` 文件（避免被误用为可 spawn 的 subagent）

### REQ-002：Brainstorming 流程步骤

- **优先级：** 必须有
- **描述：** Orchestrator 在 Brainstorming 阶段依次执行：探索项目上下文 → 逐一提问 → 提出 2-3 种方案 → 逐节呈现设计 → 用户批准 → 写 design.md。
- **设计理由：** 与 superpowers:brainstorming skill 保持一致的方法论，确保覆盖目的、约束、方案权衡、成功标准。
- **验收标准：**
  - SKILL.md 中明确列出上述步骤
  - `design.md` 写入 `.pipeline-workspace/design.md`

### REQ-003：design.md 写入 Pipeline Workspace

- **优先级：** 必须有
- **描述：** `design.md` 保存到 `.pipeline-workspace/design.md`，而非 `docs/superpowers/specs/`。
- **设计理由：** `design.md` 是本次 pipeline run 的中间 artifact，属于 workspace 管理范畴，与代码库文档分开。
- **验收标准：**
  - SKILL.md workspace 文件列表中包含 `design.md`
  - Spec subagent prompt 从 `.pipeline-workspace/design.md` 读取内容

### REQ-004：Spec Subagent 双输出

- **优先级：** 必须有
- **描述：** Spec subagent 同时输出 `spec.md`（人类可读，中文）和 `spec.json`（结构化，供下游消费）。
- **设计理由：** 当前 `spec.json` 对用户不友好，用户难以判断 spec 是否准确反映了意图。增加 `spec.md` 让用户有可读的确认门，同时 `spec.json` 保持不变供机器消费。
- **验收标准：**
  - `agents/spec.md` 说明输出两个 fenced block：一个 `json`，一个 `markdown`
  - `spec.md` 包含目标、需求（含设计理由）、约束、范围外、假设

### REQ-005：spec.md 用中文，含设计理由

- **优先级：** 必须有
- **描述：** `spec.md` 以中文撰写，每个需求和约束附带设计理由说明。
- **设计理由：** 主要使用者为中文用户，中文减少理解摩擦；设计理由让用户能判断 spec 是否准确捕捉了意图，而不仅仅是确认格式。
- **验收标准：**
  - `agents/spec.md` 中明确规定语言为中文
  - `spec.md` 格式规范包含"设计理由"字段

### REQ-006：Spec 用户批准门

- **优先级：** 必须有
- **描述：** Orchestrator 展示 `spec.md` 给用户，等待明确批准后才启动 Plan subagent。如用户要求修改，重新运行 Spec subagent 附带反馈。
- **设计理由：** Spec 是整个管道的需求基础，在此处引入用户确认可以在进入架构和实现前捕捉方向偏差，避免大量下游返工。
- **验收标准：**
  - SKILL.md 中 Spec 章节明确描述用户批准流程
  - 用户反馈触发 Spec subagent 重跑逻辑

---

## 约束

- **不修改 `spec.json` contract**：下游 subagent（Plan、Architecture、Execution）消费 `spec.json` 的逻辑不变，避免级联改动。设计理由：最小化改动范围，降低引入 bug 的风险。
- **不新增 subagent 文件**：Brainstorming 不创建 `agents/brainstorming.md`，避免被误用为可 spawn 的 subagent。

---

## 范围外

- **视觉伴侣（Visual Companion）**：不在 pipeline brainstorming 中引入浏览器可视化辅助。理由：增加依赖复杂度，当前需求不需要。
- **brainstorming 结果写入 `docs/`**：`design.md` 只存于 workspace，不 commit 到代码库。理由：pipeline run artifact 不应污染代码库文档。
- **修改 Plan / Architecture / Execution / Review / Doc agents**：本次改动止于 Spec，不触及下游。

---

## 假设

- **用户每次使用 pipeline 都希望走 Brainstorming**：不加条件跳过逻辑。依据：用户明确要求"自动化管道 spec 前加一个 brainstorming"，未提及可选。
- **`spec.md` 由 Spec subagent 自动中文化**：orchestrator 不做翻译后处理。依据：Spec subagent 接受语言指令，可直接输出中文。

---

## 需要修改的文件

| 文件 | 改动摘要 |
|------|---------|
| `SKILL.md` | 新增 Brainstorming 章节；更新流程图；更新 Workspace 文件列表；Spec 章节加用户批准门 |
| `agents/spec.md` | 新增 `design.md` 输入；新增 `spec.md` 双输出要求（中文、含理由、格式规范） |
| `references/contracts.md` | 新增 `spec.md` 格式说明；`spec.json` 来源备注 |

**不改动：** `agents/plan.md`、`agents/architecture.md`、`agents/execution.md`、`agents/review.md`、`agents/validation.md`、`agents/doc.md`、`references/pre-rubric.md`、`references/orchestrator-prompts.md`
