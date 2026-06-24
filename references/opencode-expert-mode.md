# OpenCode Expert Mode

This skill is compatible with OpenCode's skill and agent model while preserving
Codex-specific orchestration behavior in separate references.

Official OpenCode docs used for this adaptation:

- Agent Skills: <https://opencode.ai/docs/skills/>
- Agents: <https://opencode.ai/docs/agents/>
- Modes: <https://opencode.ai/docs/modes/>

## Why This File Exists

OpenCode skills are discovered by `name` and `description` first. The full
`SKILL.md` is loaded later through the native `skill` tool. This is progressive
disclosure: a short routing surface first, detailed instructions only when the
agent actually needs them.

The root `SKILL.md` therefore stays short and points here for OpenCode-specific
setup instead of embedding every OpenCode rule in the entrypoint.

## Skill Placement

Install the skill directory at one of OpenCode's search paths:

```text
.opencode/skills/multi-agent-pipeline/SKILL.md
~/.config/opencode/skills/multi-agent-pipeline/SKILL.md
.claude/skills/multi-agent-pipeline/SKILL.md
~/.claude/skills/multi-agent-pipeline/SKILL.md
.agents/skills/multi-agent-pipeline/SKILL.md
~/.agents/skills/multi-agent-pipeline/SKILL.md
```

Project-local discovery walks upward from the current working directory until
the git worktree root. Keep the directory name and frontmatter `name` identical:
`multi-agent-pipeline`.

## Frontmatter Rules

OpenCode recognizes these frontmatter fields:

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`

The skill name must be lowercase alphanumeric with single hyphen separators,
must not start or end with a hyphen, and must match the folder name.

The description must be specific enough for the agent to choose the skill
without loading the body. Keep it within OpenCode's 1-1024 character rule.

## Expert Primary Agent

OpenCode now configures specialized assistants through the `agent` option. The
older `mode` option is deprecated for new configs, but "expert mode" is still a
useful name for a high-capability primary agent dedicated to this pipeline.

Use the copy-ready agent template:

```text
templates/opencode-expert-agent.md
```

Suggested install location:

```text
.opencode/agents/multi-agent-pipeline-expert.md
```

The expert primary agent should:

- Run in `primary` mode.
- Allow skill access for `multi-agent-pipeline`.
- Allow task/subagent access when OpenCode host policy permits parallel work.
- Ask before broad edits or dangerous bash commands unless the user's local
  policy intentionally allows them.
- Tell the model to load `multi-agent-pipeline` with the skill tool only when
  the user asks for staged multi-agent delivery or a large implementation.

## Permission Shape

OpenCode permissions can be configured globally or per agent. For this skill,
the relevant keys are:

- `skill`: controls whether the skill can be loaded.
- `task`: controls which subagents can be invoked.
- `edit`: controls write, edit, and patch operations.
- `bash`: controls shell command execution.
- `external_directory`: controls access outside the project worktree.

Use explicit permissions in the expert agent instead of relying on hidden
defaults. Prefer `ask` for risky write or bash patterns and `allow` for safe
read/search operations.

## Progressive Disclosure Rules

- Do not paste the entire skill body into an OpenCode prompt.
- Let OpenCode discover the skill from `name` and `description`.
- Load `SKILL.md` only when the task matches the trigger.
- After loading `SKILL.md`, read only the reference for the current need.
- For stage execution, read only the current `agents/<stage>.md` plus
  `references/contracts.md`.
- Read `references/pre-rubric.md` only for Review.
- Read `references/example-run.md` only for debugging, training, or explaining
  a complete run.

## Codex Compatibility

OpenCode adaptation must not remove Codex behavior. Keep these Codex-specific
details in separate references and runtime files:

- `references/codex-execution-model.md`
- `references/orchestrator-prompts.md`
- `src/runtime/constants.js`
- `src/runtime/stage-catalog.js`

Codex and OpenCode should share the same stage files, contracts, review rubric,
example run, scripts, runtime, and tests.
