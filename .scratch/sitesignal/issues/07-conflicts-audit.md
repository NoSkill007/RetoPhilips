Part of #1.

## Objective

Preserve contradictory knowledge and every correction so users can understand why the installed base changed.

## End-to-end behavior

- Incompatible observations create a visible pending conflict instead of overwriting one another.
- Any collaborator profile may resolve a conflict by selecting a supported outcome and writing an explanation.
- Editing reviewed data records old value, new value, author, timestamp, and reason.
- A manual correction remains Reported unless evidence or independent confirmation supports it.
- A separate matching observation from another collaborator can confirm supported fields.
- The hospital 360 profile exposes the observations, evidence, conflicts, and change history behind current values.

## Acceptance criteria

- Newer observations do not silently replace contradictory older observations.
- Conflict resolution is impossible without an explanation.
- Independent confirmation requires a different collaborator profile.
- Audit history survives restart and cannot be confused with the current projection.
- API-level tests cover conflicts, resolution, correction, corroboration, and provenance retrieval.
