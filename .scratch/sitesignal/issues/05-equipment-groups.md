Part of #1.

## Objective

Represent reported quantities without inventing individual equipment identities, then split a known unit from a group without changing the installed total.

## End-to-end behavior

- A report such as “three MR systems” creates one equipment group with quantity three.
- A later reviewed observation can identify one individual unit from that group.
- Splitting produces the individual equipment and reduces the remaining group quantity.
- The hospital 360 profile clearly distinguishes groups from individual equipment.
- Provenance remains linked to both the individual equipment and remaining group.

## Acceptance criteria

- Group creation does not generate fake serial numbers or identities.
- Splitting one unit from a group of three leaves an individual unit plus a group of two.
- Totals remain stable before and after the split.
- Splitting the last unit removes the empty group representation.
- API-level tests cover group creation, partial split, final split, and provenance.
