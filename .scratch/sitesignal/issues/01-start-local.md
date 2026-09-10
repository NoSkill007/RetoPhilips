Part of #1.

## Objective

Create the smallest runnable SiteSignal slice on Windows: one command verifies the local environment, starts the browser interface and API, opens local persistence, and reports whether QVAC is available.

## End-to-end behavior

- A Windows starter checks Node, the QVAC SDK, configured model availability, storage access, and the local port.
- The starter launches the API and responsive browser interface on localhost.
- The interface displays a ready, degraded, or unavailable state for the API, database, and QVAC runtime.
- A minimal SQLite database is created locally and survives restart.
- No runtime asset requires a cloud service after initial preparation.

## Acceptance criteria

- A fresh documented preparation followed by the starter opens SiteSignal on Windows.
- Restarting uses the same local database.
- Missing QVAC or a missing model produces an actionable message instead of a crash.
- The API is bound to loopback by default.
- An API-level test verifies startup status and persistence.

## Notes

Use the existing QVAC smoke script as prior exploration, but replace it where the application needs a stable adapter. Do not implement observation capture in this ticket.
