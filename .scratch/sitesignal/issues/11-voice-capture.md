Part of #1.

## Objective

Let a collaborator dictate a field observation and continue through the same trusted capture flow without cloud transcription.

## End-to-end behavior

- Select Spanish or English before recording.
- Record, stop, replay, and discard audio locally.
- Transcribe audio on-device through QVAC.
- Show the transcript for correction before extraction.
- Continue through validation, follow-ups, review, storage, and hospital 360 update.
- Surface model, device, duration, and failure information.

## Acceptance criteria

- No audio or transcript is sent to a cloud inference endpoint.
- Spanish and English synthetic samples follow the complete capture path.
- A transcription failure preserves the recording and offers retry or text/manual continuation.
- The fast suite uses a deterministic transcription adapter.
- A separate real-QVAC smoke test transcribes a bundled synthetic audio sample.
