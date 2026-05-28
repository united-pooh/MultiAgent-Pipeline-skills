# 多智能体流水线

`multi-agent-pipeline` 是一套 Codex-compatible、OpenCode-adaptable 的复杂开发任务流程。它把一件较大的工作拆成需求澄清、计划、架构、分派、实现、复杂度检查、合并、验证、审查、QA、文档和最终评估，让每一步都有明确责任和可追踪产物。

它适合新功能、跨文件重构、需要严格验证的改动，或你明确要求使用“流水线”“多智能体”“production workflow”的场景。小修小补、纯问答、单文件快速修改通常不需要走完整流水线。

## 怎么启动

在 Codex 里直接说明要用这个技能或多智能体流水线即可：

```text
使用 multi-agent-pipeline 给 API 加一个限速功能
```

```text
用多智能体流水线把登录模块改造成支持第三方账号登录
```

也可以指定检查偏好：

```text
用 multi-agent-pipeline 做报表 CSV 导出，审查用 PRE
```

默认审查模式是 EME：三个独立 Review 子代理并行检查，然后聚合结果。

在 OpenCode 里，把 skill 目录安装到 `.opencode/skills/multi-agent-pipeline/` 或 `~/.config/opencode/skills/multi-agent-pipeline/`，再用 `templates/opencode-expert-agent.md` 创建一个 `.opencode/agents/multi-agent-pipeline-expert.md` primary agent。OpenCode 会先通过 `name` 和 `description` 发现技能，真正匹配复杂实现任务时再用原生 `skill` tool 加载 `SKILL.md`。

## 流程一览

```mermaid
flowchart LR
    A["用户请求"] --> B["Brainstorming: 明确目标"]
    B --> C["Spec: 规格说明"]
    C --> D["Plan: 任务计划"]
    D --> E["Architecture: 架构方案"]
    E --> F["Dispatch: 分派工作组"]
    F --> G["Execution: 实现"]
    G --> H["Merge: 三向合并"]
    H --> I["Validation: 命令验证"]
    I -->|通过或跳过| J["Review: 独立审查"]
    I -->|失败| G
    J -->|通过| K["QA: 场景验证"]
    J -->|失败| G
    K -->|通过| L["Doc: 文档"]
    K -->|失败| G
    L --> M["Final Assessment: 最终评估"]
```

## 主要能力

| 能力 | 说明 |
|---|---|
| Codex 子代理 | 使用 `spawn_agent`/`wait_agent` 运行各阶段，默认固定为 `gpt-5.5`、`xhigh` 推理、`priority` service tier |
| OpenCode 专家模式 | 通过自定义 primary agent 和原生 `skill` tool 进行渐进式披露，Task/subagent 调用细节放在 OpenCode adapter 中 |
| 显式记录 | 关键产物写入 `.pipeline-workspace/`，成功验收后保留 `.pipeline-last-run-summary.json` |
| 分组实现 | Dispatch 按文件所有权和依赖拆分 worker group，减少并行冲突 |
| 保守合并 | Merge 由 orchestrator 本地执行，使用三向合并语义，冲突时暂停给人处理 |
| 多语言验证 | Validation 根据项目标记自动选择 Go、Python、JavaScript/TypeScript、Rust、Java、Ruby 的 fix/check 命令 |
| 独立审查 | Review 支持 EME 三审或 PRE 单审，按 8 个质量维度给出证据 |
| 场景 QA | QA 补充运行时和用户场景验证，不重复命令层验证 |
| Codex pet 事件 | Runtime 会输出 `codex_pet_events`，把 pipeline 阶段映射到 `running`、`review`、`failed`、`waiting`、`waving` 等 Codex avatar state |

## 文件结构

```text
skills/multi-agent-pipeline/
├── SKILL.md
├── agents/
│   ├── spec.md
│   ├── plan.md
│   ├── architecture.md
│   ├── dispatch.md
│   ├── execution.md
│   ├── validation.md
│   ├── review.md
│   ├── qa.md
│   ├── doc.md
│   └── final-assessment.md
├── references/
│   ├── contracts.md
│   ├── codex-execution-model.md
│   ├── opencode-expert-mode.md
│   ├── orchestration-rules.md
│   ├── pre-rubric.md
│   ├── pipeline-stages.md
│   ├── orchestrator-prompts.md
│   ├── workspace-and-events.md
│   └── example-run.md
├── templates/
│   └── opencode-expert-agent.md
├── src/runtime/
└── test/
```

运行时工作区大致如下：

```text
.pipeline-workspace/
├── design.md
├── spec.md
├── spec.json
├── plan.json
├── architecture.json
├── dispatch.json
├── execution/
├── complexity/
├── merge/
├── validation/
├── review_history/
├── qa/
├── assessment_history/
└── logs/
```

## 产物说明

| 产物 | 作用 |
|---|---|
| `design.md` | Brainstorming 后的目标、方案、约束和成功标准 |
| `spec.md` | 给用户看的中文规格说明 |
| `spec.json` | 给后续阶段使用的结构化需求 |
| `plan.json` | 任务计划、依赖和风险 |
| `architecture.json` | 代码分析、架构决策、文件级改动意图 |
| `dispatch.json` | worker group、文件所有权、执行波次 |
| `execution-report.json` | 每个工作组的实现报告 |
| `complexity-report.json` | Execution 后对 changed Python 文件运行的认知复杂度报告，包含可读性高/低和复杂度高/低结论 |
| `merge-report.json` | 合并结果或冲突记录 |
| `validation-report.json` | 自动命令验证结果 |
| `review_feedback.json` | Review 聚合结果 |
| `qa-report.json` | 场景和运行时验证结果 |
| `doc-report.json` | 文档更新结果 |
| `final-assessment.json` | 最终验收或重启点判断 |
| `codex_pet_events` | `.pipeline-last-run-summary.json` 内的 pet state 事件列表，可供支持 `::codex-pet{...}` 的宿主或事件桥消费 |

## 检查机制

Review 有两种模式：

| 模式 | 说明 |
|---|---|
| PRE | 一个 reviewer 按 8 个维度严格审查，适合较小但要求极严的改动 |
| EME | 三个 reviewer 独立审查并按维度多数投票，默认模式，适合复杂任务 |

8 个维度包括正确性、安全性、性能、错误处理、代码质量、架构一致性、测试覆盖和向后兼容。

## Codex Pet 状态事件

运行时会在关键阶段记录 pet 状态事件：

| 场景 | 状态 |
|---|---|
| 阶段执行中 | `running` |
| Review / Final Assessment | `review` |
| 验证或审查失败 | `failed` |
| 合并冲突或等待人工处理 | `waiting` |
| 最终接受 | `waving` |

事件会写入 `.pipeline-workspace/logs/codex-pet-events.jsonl`。运行结束后，`.pipeline-last-run-summary.json` 会保留同一组 `codex_pet_events`。每个事件同时带有 `directive` 字段，例如：

```text
::codex-pet{state="review" durationMs=2400 scope="pipeline.review.group-group-1.iteration-1"}
```

当前仓库定义的是 skill/runtime 侧协议；Codex Desktop 或其他宿主如果支持该 directive，可以把它桥接到 avatar state。

## 渐进式披露

这个 skill 的主入口 `SKILL.md` 现在只保留触发条件、流程图、硬规则和按需读文件路线。详细规则拆在：

| 文件 | 作用 |
|---|---|
| `references/codex-execution-model.md` | Codex `spawn_agent` / `wait_agent` / profile / 并发规则 |
| `references/opencode-expert-mode.md` | OpenCode skill 发现、权限、专家 primary agent 配置 |
| `references/pipeline-stages.md` | 0-11 阶段的详细目标和门禁 |
| `references/workspace-and-events.md` | `.pipeline-workspace/`、summary 和 pet events |
| `references/orchestration-rules.md` | prompt、artifact、review、merge、cleanup 纪律 |

OpenCode 只需要先看到 frontmatter 的 `name` 和 `description`；加载技能后，也应按当前阶段读取对应 reference 或 `agents/<stage>.md`，不要一次性读取整套手册。

## OpenCode 专家模式

推荐配置：

```text
.opencode/
├── agents/
│   └── multi-agent-pipeline-expert.md
└── skills/
    └── multi-agent-pipeline/
        ├── SKILL.md
        ├── agents/
        ├── references/
        ├── templates/
        ├── scripts/
        ├── src/
        └── test/
```

`templates/opencode-expert-agent.md` 是可复制的 agent 模板。它把 `multi-agent-pipeline` skill 设置为允许加载，并把 Task/subagent、编辑、bash、外部目录访问保持为可控权限。官方 OpenCode 文档把这类配置称为自定义 agent；这里的“专家模式”指这个高能力 primary agent 配置，而不是 OpenCode 内置的固定模式名。

运行时也暴露了 `DEFAULT_OPENCODE_EXPERT_STAGE_PROFILES`，供 OpenCode 适配器把阶段 prompt、references、Task 调用和专家 agent 关联起来。默认 `DEFAULT_STAGE_PROFILES` 仍然指向 Codex profile，保留原来的 Codex 行为。

## 安装到 Codex

如果要把仓库里的 skill 同步到当前 Codex 环境，可以把 `skills/multi-agent-pipeline/` 同步到：

```text
~/.codex/skills/multi-agent-pipeline/
```

同步后需要重启 Codex 才能让新的 skill 指令在后续会话中稳定生效。
