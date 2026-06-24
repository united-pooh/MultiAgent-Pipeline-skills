# Internal Methodology: Brainstorming

This methodology is owned by the Multi-Agent Pipeline repository. Use it through
skill references and stage prompts, not as an external Codex skill attachment.

## Purpose

Turn a user request into an approved or user-implied design that downstream
Spec and Plan agents can consume without inventing scope.

## Context First

- Inspect relevant repo files, docs, prior artifacts, and recent changes when
  they affect the request.
- Identify constraints, existing patterns, and likely ownership boundaries.
- If the request is already concrete and execution-oriented, record the user's
  concrete request as the approved design instead of reopening discovery.

## Clarify One Point At A Time

- Ask only when the answer materially changes scope, acceptance criteria, or
  risk.
- Ask one focused question at a time.
- Prefer concise multiple-choice options when they reduce ambiguity.

## Compare Approaches

- When the design path is open, present two or three viable approaches.
- Include tradeoffs, risks, and a recommendation.
- Avoid option sprawl and speculative features.

## Design Review And Approval Gate

- Present the selected design in clear sections: objective, approach,
  constraints, and success criteria.
- Get explicit approval before advancing when the user is in a planning or
  brainstorming mode.
- If the user has already requested implementation directly, treat that request
  as an approval signal and preserve the rationale in `design.md`.

## Self-Check Before Spec

Before handing off to Spec:

- Remove placeholders, contradictions, and ungrounded requirements.
- Make scope boundaries and out-of-scope items explicit.
- Confirm that success criteria are observable.
- Record low-risk assumptions rather than blocking unnecessarily.
