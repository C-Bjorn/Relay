# Relay 0.9.1-beta.1

## New Features

### `same-user` Auto-Resolve Mode
A new conflict resolution option that silently accepts disk writes (from MegaMem, Claude Code, or any external tool) when the remote CRDT content was authored solely by the same user — eliminating false merge conflicts in solo-user multi-tool workflows.

Adds a fifth option to the "Conflict resolution" dropdown: **Same User — skip conflicts when remote author is you**.

Uses Yjs `PermanentUserData` (PUD) authorship inspection on `remoteDoc` to confirm the remote author identity. No server changes required — PUD data confirmed to survive the relay server round-trip.

## Bug Fixes

### `pendingUpload` Relay-Scoped Key (Data Loss Fix)
Scopes the `pendingUpload` LocalStorage key to include the relay GUID. This fixes small-batch relay migration data loss (files < 3, below the old circuit breaker threshold) where files uploaded to a previous relay were being deleted when connecting to a new relay.

Previous mitigations (zero-path guard v0.8.7, circuit breaker v0.9.0) remain as defense-in-depth.

### `downloadDoc` Empty-File Templater Guard
When fetching a remote document for the first time, `downloadDoc` now decodes content directly from `updateBytes` as a fallback when `doc.text` is empty. This prevents Relay from writing a blank file to disk (via `vault.adapter.write`) which was triggering Templater's folder-template application and overwriting relay-synced content.

### Version Badge Layout Fix
Removed `position: absolute` from the version badge in settings — it was overlapping interactive UI elements in the relay settings panel.

## UI Fixes

- Added `same-user` option to `ManageRemoteFolder.svelte` (the primary relay settings panel)
- Added `same-user` option to `ManageSharedFolder.svelte`

## Tests

- 15 new unit tests for relay migration (`__tests__/relay-migration.test.ts`)
- 5 new integration tests for `same-user` mode (`__tests__/merge-hsm/auto-resolve.test.ts`)
