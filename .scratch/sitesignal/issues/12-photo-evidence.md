Part of #1.

## Objective

Use a permitted fictional plate or label as local evidence for specific equipment fields.

## End-to-end behavior

- Attach a local photograph to a text or voice observation.
- Process the image locally through QVAC vision or OCR capability.
- Attempt to extract manufacturer, model, serial number, and manufacture or installation year only when visible.
- Preserve detected text and present every extracted field for review.
- Store the fictional image locally and link it to the field observation.
- Confirm only fields visibly supported by the image.
- Feed reviewed serial and model data into duplicate detection and consolidation.

## Acceptance criteria

- Images never leave the local environment for inference.
- A plate that shows manufacturer and serial but no age confirms only manufacturer and serial.
- Unsupported or unreadable fields remain Unknown.
- Deleting or changing an extracted value does not alter the original evidence.
- The fast suite uses a deterministic vision adapter and a separate QVAC smoke test covers one bundled fictional plate.
