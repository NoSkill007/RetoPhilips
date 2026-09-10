Part of #1.

## Objective

Identify explainable potential renewal opportunities without presenting them as definitive commercial recommendations.

## End-to-end behavior

- Mark installed-base information stale after twelve months without verification.
- Create a current potential renewal opportunity only when age is at least seven years, confidence is at least 60, the observation is less than twelve months old, and no identity or age conflict is pending.
- Show every condition and supporting observation behind the signal.
- Allow a collaborator to mark the opportunity reviewed or dismissed and add a note.
- Recalculate the signal when supporting installed-base information changes.

## Acceptance criteria

- Failing any required condition prevents an active opportunity.
- A stale-information alert is distinct from old equipment.
- Conflicts suppress opportunities until resolved.
- Review state and notes persist and remain auditable.
- API-level tests use a controllable clock and cover all boundary conditions and recalculation.
