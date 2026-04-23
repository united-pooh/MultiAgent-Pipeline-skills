# PRE (Pointwise Rubric Evaluation) Rubric

Each of the 3 EME reviewers evaluates these 8 dimensions independently. Every dimension gets exactly one score: `pass`, `fail`, or `warning`.

## Scoring Definitions

- **pass**: Meets or exceeds expectations. No issues found.
- **warning**: Minor issue that does not block delivery but should be noted. Does not count as a failure in EME voting.
- **fail**: Significant issue that must be fixed before the implementation can be accepted.

## Dimension Rubrics

### 1. Correctness

Does the implementation satisfy all requirements and acceptance criteria from `spec.json`?

| Score | Criteria |
|---|---|
| pass | All `must-have` and `should-have` requirements implemented. All acceptance criteria verifiable and met. |
| warning | All `must-have` met, but a `should-have` requirement is partially implemented with a reasonable workaround. |
| fail | Any `must-have` requirement not implemented, or acceptance criteria not met. Logic errors that produce wrong results. |

**How to evaluate**: Cross-reference each requirement ID in `spec.json` against the implementation. Trace acceptance criteria to specific code paths.

### 2. Security

Are there vulnerabilities that could be exploited?

| Score | Criteria |
|---|---|
| pass | No injection vectors, proper input validation at boundaries, secrets not hardcoded, auth/authz checks in place. |
| warning | Minor issues like overly permissive CORS in dev config, or missing rate limiting on non-critical endpoint. |
| fail | SQL/command injection possible, XSS vectors, hardcoded credentials, missing auth on protected endpoints, sensitive data in logs. |

**How to evaluate**: Check all user input paths, database queries, shell commands, HTML rendering, authentication gates, and log statements.

### 3. Performance

Are there obvious performance problems?

| Score | Criteria |
|---|---|
| pass | No N+1 queries, appropriate use of indexes/caching, no unnecessary allocations in hot paths, no blocking calls in async context. |
| warning | Minor inefficiency that won't impact production at current scale but should be addressed eventually. |
| fail | N+1 queries, unbounded loops over external data, synchronous blocking in async handlers, missing pagination on large datasets, O(n²) where O(n) is straightforward. |

**How to evaluate**: Trace data access patterns, look for loops containing I/O, check query patterns, review memory allocation in frequently called code.

### 4. Error Handling

Are edge cases and failure modes handled gracefully?

| Score | Criteria |
|---|---|
| pass | Errors propagated or handled at appropriate levels, meaningful error messages, no silent failures, graceful degradation. |
| warning | Error handling exists but messages could be more descriptive, or a non-critical edge case has generic handling. |
| fail | Uncaught exceptions on likely error paths, silent swallowing of errors, panics on invalid input, no handling of network/IO failures. |

**How to evaluate**: Identify all external calls (DB, API, file I/O) and verify error handling. Test mental model of what happens with nil/null/empty/malformed inputs.

### 5. Code Quality

Is the code readable, maintainable, and consistent with the project's style?

| Score | Criteria |
|---|---|
| pass | Clear naming, consistent style with existing codebase, appropriate abstractions, no dead code, self-documenting. |
| warning | Minor style inconsistency, slightly unclear variable name, could use a comment in one complex section. |
| fail | Misleading names, copy-paste duplication that should be abstracted, deeply nested logic (>4 levels), magic numbers, completely inconsistent with project conventions. |

**How to evaluate**: Read the code as if maintaining it 6 months from now. Compare style with adjacent files in the project.

### 6. Architecture Compliance

Does the implementation follow the design in `architecture.json`?

| Score | Criteria |
|---|---|
| pass | Changes match `proposed_changes`, correct files modified/created, design patterns followed, dependency changes match spec. |
| warning | Minor deviation that arguably improves on the design (document why). |
| fail | Files modified that weren't in the plan without justification, wrong design pattern used, architectural boundaries violated, unauthorized dependencies added. |

**How to evaluate**: Compare each entry in `architecture.json.proposed_changes` against actual changes. Verify `dependency_changes` match.

### 7. Test Coverage

Are critical code paths tested?

| Score | Criteria |
|---|---|
| pass | Happy path tested, key error paths tested, edge cases for complex logic tested, tests are meaningful (not just asserting true). |
| warning | Core paths tested but an edge case in complex logic lacks a test. |
| fail | No tests for new functionality, tests only cover trivial cases, tests are tautological, critical error handling untested. |

**How to evaluate**: Map test cases to requirements. Verify tests would actually catch regressions (not just smoke tests).

### 8. Backward Compatibility

Does the change preserve existing APIs, interfaces, and behavior?

| Score | Criteria |
|---|---|
| pass | Existing public APIs unchanged or extended additively, no breaking changes to consumers, data migrations handle old formats. |
| warning | Internal API changed but all callers updated within this change set. |
| fail | Public API signature changed without migration path, existing behavior altered without documentation, breaking change to downstream consumers. |

**How to evaluate**: Check if `constraints` in `spec.json` mention compatibility requirements. Diff public interfaces before/after. Search for callers of modified functions.

## Evidence Requirements

Every score MUST include evidence:
- **pass**: Brief statement of what was verified (e.g., "All 3 REQ requirements traced to implementation in handler.go:45-120")
- **warning**: Specific location and description of the minor issue
- **fail**: Exact file:line reference, description of the problem, and a concrete fix suggestion

Vague evidence like "code looks fine" or "could be improved" is not acceptable. Each reviewer should be able to defend their score with specific references.
