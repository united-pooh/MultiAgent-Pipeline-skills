# Internal Methodology: Frontend Design

This methodology is owned by the Multi-Agent Pipeline repository. The
`ce-frontend-design` value is a pipeline-internal capability label, not a
requirement for a separate host skill package.

## When It Applies

Apply this guidance when `worker_group.required_skills` includes
`ce-frontend-design`, or when reviewing a worker group that carried that label.
Record `ce-frontend-design` in `applied_skills` when the guidance was applied.

## Product Fit

- Match the existing app structure, design system, component conventions, and
  density.
- Choose UI patterns that serve the product's real use: dashboards should be
  efficient and scannable, games can be more expressive, and tools should make
  repeated workflows fast.
- Avoid speculative decoration that does not help the user complete the task.

## Interface Quality

- Prefer clear controls: icons for common commands, toggles for binary states,
  segmented controls for modes, sliders or inputs for numeric values, and menus
  for option sets.
- Keep typography sized for the surface. Compact panels need compact headings;
  hero-scale type belongs only in true hero contexts.
- Use stable dimensions for boards, toolbars, tiles, counters, and other fixed
  UI elements so state changes do not shift layout.
- Make text fit on mobile and desktop without overlapping nearby content.

## Interaction And Accessibility

- Preserve keyboard flow, focus visibility, labels, and predictable navigation.
- Provide loading, empty, error, disabled, hover, focus, and active states where
  the workflow expects them.
- Keep color contrast and visual hierarchy strong enough for real use.

## Verification

- Inspect the actual rendered result when tooling is available.
- For meaningful UI changes, capture evidence from browser/manual validation or
  explain why visual verification was skipped.
- Report visual risks, responsive behavior, and interaction evidence in
  `frontend_design_summary` or `frontend_design_assessment`.
