Part of #1.

## Objective

Finish SiteSignal as a reproducible hackathon delivery whose core behavior and QVAC compliance can be verified without a network connection.

## End-to-end behavior

- Export the current installed base as CSV.
- Export field observations, history, states, conflicts, decisions, and evidence references as JSON.
- Display QVAC model, quantization, hardware device, connection state, inference duration, and relevant local logs.
- Preserve the database and fictional evidence across service restarts.
- Provide separate preparation and normal-start instructions; normal start performs no downloads.
- Run the core capture, storage, hospital 360, regional panorama, natural query, and export paths with the network disabled.
- Document all pre-existing bases, libraries, models, third-party components, hardware, limitations, and remote non-inference services.
- Provide a Spanish demonstration script that fits within five minutes.

## Acceptance criteria

- CSV and JSON exports represent the same current state visible in the application.
- The Windows starter checks prerequisites, starts all local components, and opens SiteSignal.
- An offline acceptance run succeeds after preparation and proves that no inference endpoint is contacted.
- A simple written observation reaches review in under thirty seconds on the declared demonstration hardware.
- The isolated QVAC integration test validates a real structured extraction; voice and photo smoke checks use bundled synthetic assets.
- The README clearly separates implemented prototype guarantees from production requirements such as encryption and corporate access control.
