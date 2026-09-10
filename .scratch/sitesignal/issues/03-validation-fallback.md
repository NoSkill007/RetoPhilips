Part of #1.

## Objective

Prevent unsupported model output from contaminating the installed base and keep capture usable when local inference fails.

## End-to-end behavior

- Validate extraction against a strict response schema and the Modality catalogue.
- Compare quantities, manufacturers, models, serial numbers, ages, and locations with the source observation.
- Reject unsupported values instead of silently accepting them.
- Retry one invalid inference with a corrective instruction.
- After a second failure, open an editable manual capture and record that AI did not produce the result.

## Acceptance criteria

- Invalid JSON, missing required structure, unsupported modalities, and invented values are handled visibly.
- No invalid extraction can be saved without review.
- A second failed inference reaches manual capture without losing the source text.
- Stored provenance distinguishes QVAC extraction from manual entry.
- API-level tests cover success, corrected retry, repeated failure, and unsupported claims.
