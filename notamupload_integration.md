# NOTAMUPLOAD → FISO FID Integration Contract

## Firebase path

FISO FID listens to the following Firebase Realtime Database path:

```text
fiso/fisoradar_pib_v1
```

Each successful NOTAMUPLOAD publication must **replace the complete record** at this path with the newly processed ACTIVE PIB.

Do not publish incremental deltas to this path.

## Expected payload

The published object must contain:

- `meta` — PIB metadata.
- `notams` — array of parsed NOTAM records.

Each item in `notams` must expose the fields currently consumed by the FISO FID NOTAM engine:

```text
notamId
qLine
icao
b
c
d
eText
f
g
```

Fields should retain their existing meaning and formatting so current FISO FID parsing and matching logic remains compatible.

## FISO FID behaviour

FISO FID already listens for changes to `fiso/fisoradar_pib_v1`.

When the Firebase value changes:

1. The new record becomes the single ACTIVE PIB.
2. FISO FID derives applicable AUTO hazards from the new `notams` array.
3. NOTAMs that are no longer present in the replacement PIB are treated as removed from the ACTIVE PIB.
4. AUTO PIB hazards associated with those removed NOTAMs are removed.
5. Unrelated manually plotted hazards are preserved.

Release 140 introduced automatic paraglider-hazard derivation from this array when the Firebase value changes.

## Publication rule

NOTAMUPLOAD must always publish the **full latest processed PIB**, not only additions or removals.

This replacement model is required so FISO FID can reliably determine which AUTO PIB records remain current and which must be removed.

## Compatibility requirement

Changes to NOTAMUPLOAD must preserve the payload contract above unless the corresponding FISO FID parsing logic is updated at the same time.
