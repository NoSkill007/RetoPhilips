Part of #1.

## Objective

Turn individual field observations into a useful regional view backed by a reproducible synthetic dataset.

## End-to-end behavior

- Seed approximately ten fictional hospitals and sixty equipment records across Panama, Brazil, and Colombia.
- The home screen summarizes Hospitals, equipment, confidence, stale information, and potential opportunities.
- Users filter by Client, Hospital, country, city, and Modality.
- A bundled vector map supports navigation without online map tiles.
- The regional panorama aggregates Modality, geography, approximate age, confidence, and freshness.
- Users can drill from a regional result into the hospital 360 profile.

## Acceptance criteria

- Every seeded organization, person, equipment item, label, and location used as customer data is explicitly fictional.
- Seed data is deterministic and can be reset for the demonstration.
- Map and charts render with the network disabled.
- Filters update map, metrics, and lists consistently.
- API-level tests cover seed loading, aggregation, filters, and drill-down results.
