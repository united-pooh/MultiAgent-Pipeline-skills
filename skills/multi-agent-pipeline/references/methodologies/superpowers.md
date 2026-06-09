# Internal Methodology: Superpowers

This methodology is owned by the Multi-Agent Pipeline repository. Use it as
pipeline guidance through skill references and stage prompts, not as an external Codex
skill attachment.

## Pipeline Shape

Follow the lifecycle:

1. Idea
2. Brainstorm
3. Plan
4. TDD Build
5. Review
6. Finish

Keep the current stage bounded. Spec and Plan use only the Brainstorm and Plan
discipline. Execution owns implementation. Finish happens only after verified
delivery.

## Brainstorm And Plan Discipline

- Understand the user objective and relevant codebase context before producing
  artifacts.
- Prefer narrow scope, explicit assumptions, and testable acceptance criteria.
- Produce plans as concrete tasks with dependencies, risks, and verification
  expectations.
- Apply YAGNI: remove speculative features and keep out-of-scope items visible.
- Apply DRY: avoid duplicate tasks, duplicate abstractions, and repeated manual
  checks when one shared check is enough.

## TDD Build Discipline

- Execution workers should prefer a failing test or equivalent observable check
  before implementation when practical.
- Make the smallest change that satisfies the requirement.
- Verify with the repository's real test or runtime commands before claiming
  success.

## Systematic Debugging

When a bug, test failure, or unexpected behavior appears:

1. Reproduce or inspect the failure evidence.
2. Trace the data/control path to the likely root cause.
3. Compare with a working nearby pattern.
4. Test one hypothesis at a time.
5. Fix the root cause, then rerun the relevant verification.

Do not patch symptoms just to make an error disappear.

## Evidence First

- Treat command output, artifact validation, file diffs, and user-approved
  requirements as stronger than guesses.
- Record assumptions when evidence is incomplete.
- Report what was verified and what remains unverified.

## Subagent Reviewer Loop

- Implementation proposals should be reviewed against the spec and quality bar.
- Review feedback routes back to Execution for repair.
- A retry stays within its assigned ownership unless the issue requires
  re-dispatch.

## Finish Branch Discipline

- Finish only after tests and required review stages pass.
- Summarize changed files, verification, residual risks, and next actions.
- Keep branch, commit, push, merge, and cleanup actions explicit and
  orchestrator-owned.
