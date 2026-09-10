Part of #1.

## Objective

Make incomplete observations useful and honest through prioritized follow-up questions, field states, and an explainable confidence score.

## End-to-end behavior

- Ask at most three questions, one at a time, with a visible “I don't know” option.
- Prioritize missing Hospital, Modality, quantity, manufacturer, model, and age in that order.
- Classify individual fields as Confirmed, Reported, Estimated, or Unknown.
- Derive the overall observation state from the weakest state among Hospital, Modality, and quantity.
- Calculate confidence from completeness up to 40 points, freshness up to 25, and evidence or independent confirmation up to 35.
- Display numeric score, low/medium/high band, and component explanation.

## Acceptance criteria

- Follow-ups never exceed three and respect priority.
- Approximate language produces Estimated rather than Confirmed.
- Missing information stays Unknown.
- Score bands are low 0–49, medium 50–79, and high 80–100.
- API-level tests use a controllable clock and cover field states, overall state, each score component, and question limits.
