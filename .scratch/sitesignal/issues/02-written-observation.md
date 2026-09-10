Part of #1.

## Objective

Deliver the first complete business path: a collaborator records a written field observation, reviews QVAC extraction, saves it, and sees the hospital 360 profile update.

## End-to-end behavior

- Create and select a local collaborator profile with name and role.
- Enter a Spanish or English field observation.
- Extract Client, Hospital, optional area, Modality, quantity, manufacturer, model, serial number, and age only when supported by the input.
- Resolve an extracted hospital against existing fictional hospitals or create a new one after review.
- Show editable equipment cards before saving.
- Persist the original field observation, reviewed structured fields, collaborator, timestamps, and inference metadata.
- Display the saved result in the hospital 360 profile.

## Acceptance criteria

- The primary synthetic example completes from text input to hospital profile.
- Unknown values remain explicitly unknown.
- The original observation remains available as provenance.
- A reviewer can edit extracted fields before saving.
- API-level tests cover profile selection, extraction review, save, and hospital profile retrieval using a deterministic text adapter.
