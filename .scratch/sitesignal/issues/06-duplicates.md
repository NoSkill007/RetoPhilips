Part of #1.

## Objective

Detect possible duplicate equipment and allow a human to consolidate records without losing their original observations.

## End-to-end behavior

- An identical serial number produces a strong duplicate candidate within the relevant installed base.
- Without a serial number, candidates use explainable matches across Hospital, Modality, manufacturer, model, quantity, and approximate age.
- The interface shows matching and conflicting fields before asking for a decision.
- A collaborator may keep records separate or consolidate them.
- Consolidation creates one consolidated equipment representation linked to every source observation and evidence item.

## Acceptance criteria

- No approximate match consolidates automatically.
- Serial and approximate candidates are visually distinguishable.
- Keeping records separate changes no installed-base data.
- Consolidation removes double counting while preserving all provenance.
- API-level tests cover exact serial matches, approximate candidates, rejection, and consolidation.
