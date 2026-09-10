Part of #1.

## Objective

Allow users to explore the regional panorama in Spanish or English through natural questions that become safe, visible filters.

## End-to-end behavior

- QVAC interprets natural questions using only supported intents and fields.
- Supported filters include country, city, Client, Hospital, Modality, approximate age, state, confidence, and freshness.
- The interpreted filters are displayed and applied to the regional panorama.
- A short explanation describes the result and its limitations.
- Unsupported requests receive a useful response and do not execute arbitrary queries.

## Acceptance criteria

- The Philips example asking for Brazilian customers with MR systems older than seven years produces the expected filters and results.
- Equivalent Spanish and English questions produce equivalent filters.
- No model-generated SQL is executed.
- Users can remove or modify interpreted filters.
- API-level tests cover supported questions, ambiguity, empty results, and unsupported intents with a deterministic adapter.
