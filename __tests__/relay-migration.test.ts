/**
 * Tests for Day07.02 — relay-scoped pendingUpload permanent fix.
 *
 * Uses the mirror-extract pattern: no Obsidian/SharedFolder deps mounted.
 * Mirrors the three mutated pieces of logic and verifies the invariants
 * from the DevDoc spec:
 *   1. _buildPendingUploadKey scopes correctly
 *   2. _onRelayChanged marks ALL local files pending on the new relay
 *   3. cleanupExtraLocalFiles does NOT delete files marked pending
 *   4. Normal remote deletions still propagate (file not pending + not in remote map)
 *   5. Small-batch migrations (<3 files, below circuit-breaker threshold) are protected
 */

import { describe, test, expect } from "@jest/globals";

// ─── Mirrored helpers ────────────────────────────────────────────────────────

/**
 * Mirrors SharedFolder._buildPendingUploadKey
 */
function buildPendingUploadKey(
	appId: string,
	folderGuid: string,
	relayId?: string,
): string {
	const base = `${appId}-system3-relay/folders/${folderGuid}/pendingUploads`;
	return relayId ? `${base}/${relayId}` : base;
}

/**
 * Mirrors SharedFolder._onRelayChanged (pendingUpload population logic only —
 * LocalStorage is swapped for Map<string,string> to avoid browser storage deps).
 * Returns the newly-populated pendingUpload for the new relay.
 */
function onRelayChanged(
	localVPaths: string[],
	getGuid: (vpath: string) => string | undefined,
): Map<string, string> {
	const pendingUpload = new Map<string, string>();
	for (const vpath of localVPaths) {
		if (!pendingUpload.has(vpath)) {
			const guid = getGuid(vpath) ?? `fallback-${vpath}`;
			pendingUpload.set(vpath, guid);
		}
	}
	return pendingUpload;
}

/**
 * Mirrors the cleanupExtraLocalFiles inner sync() guard.
 * Returns true if the file would be scheduled for deletion.
 * Excludes the zero-path guard (tested separately) — only the per-file guard.
 */
function wouldDelete(
	vpath: string,
	remoteVPaths: string[],
	pendingUpload: Map<string, string>,
): boolean {
	const fileInMap = remoteVPaths.includes(vpath);
	const filePending = pendingUpload.has(vpath);
	return !fileInMap && !filePending;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("_buildPendingUploadKey", () => {
	test("returns relay-scoped key when relayId provided", () => {
		const key = buildPendingUploadKey("app1", "folder-abc", "relay-xyz");
		expect(key).toBe(
			"app1-system3-relay/folders/folder-abc/pendingUploads/relay-xyz",
		);
	});

	test("returns legacy unscoped key when no relayId", () => {
		const key = buildPendingUploadKey("app1", "folder-abc");
		expect(key).toBe(
			"app1-system3-relay/folders/folder-abc/pendingUploads",
		);
	});

	test("two different relays produce different keys for the same folder", () => {
		const keyA = buildPendingUploadKey("app1", "folder-abc", "relay-A");
		const keyB = buildPendingUploadKey("app1", "folder-abc", "relay-B");
		expect(keyA).not.toBe(keyB);
	});

	test("same relay on different folders produces different keys", () => {
		const k1 = buildPendingUploadKey("app1", "folder-111", "relay-A");
		const k2 = buildPendingUploadKey("app1", "folder-222", "relay-A");
		expect(k1).not.toBe(k2);
	});
});

describe("relay migration — _onRelayChanged populates pendingUpload", () => {
	test("all local files are marked pending after relay change", () => {
		const localVPaths = ["notes/a.md", "notes/b.md", "notes/c.md"];
		const pendingUpload = onRelayChanged(localVPaths, () => undefined);
		for (const vpath of localVPaths) {
			expect(pendingUpload.has(vpath)).toBe(true);
		}
	});

	test("existing GUIDs from syncStore.get are preserved", () => {
		const guids: Record<string, string> = {
			"notes/a.md": "guid-aaa",
			"notes/b.md": "guid-bbb",
		};
		const localVPaths = ["notes/a.md", "notes/b.md"];
		const pendingUpload = onRelayChanged(localVPaths, (vpath) => guids[vpath]);
		expect(pendingUpload.get("notes/a.md")).toBe("guid-aaa");
		expect(pendingUpload.get("notes/b.md")).toBe("guid-bbb");
	});

	test("fallback GUID is used when syncStore has no entry", () => {
		const pendingUpload = onRelayChanged(["notes/new.md"], () => undefined);
		expect(pendingUpload.get("notes/new.md")).toBe("fallback-notes/new.md");
	});
});

describe("relay migration — cleanupExtraLocalFiles does NOT delete local files", () => {
	test("full migration: new relay has empty registry — no files deleted", () => {
		const localVPaths = ["notes/a.md", "notes/b.md", "notes/c.md"];
		// New relay has zero registered paths (server migration scenario)
		const remoteVPaths: string[] = [];
		// _onRelayChanged has populated pendingUpload for ALL local files
		const pendingUpload = onRelayChanged(localVPaths, () => undefined);

		for (const vpath of localVPaths) {
			expect(wouldDelete(vpath, remoteVPaths, pendingUpload)).toBe(false);
		}
	});

	test("small-batch migration: 2 files, below circuit-breaker threshold, still protected", () => {
		// Only 2 local files — circuit breaker (>=3 || >=50%) would NOT fire.
		// The per-file pendingUpload guard must catch this.
		const localVPaths = ["notes/a.md", "notes/b.md"];
		const remoteVPaths: string[] = [];
		const pendingUpload = onRelayChanged(localVPaths, () => undefined);

		for (const vpath of localVPaths) {
			expect(wouldDelete(vpath, remoteVPaths, pendingUpload)).toBe(false);
		}
	});

	test("single-file migration: 1 file, relay B empty, not deleted", () => {
		const localVPaths = ["notes/only-file.md"];
		const remoteVPaths: string[] = [];
		const pendingUpload = onRelayChanged(localVPaths, () => undefined);
		expect(wouldDelete("notes/only-file.md", remoteVPaths, pendingUpload)).toBe(false);
	});
});

describe("normal remote deletion still propagates", () => {
	test("file cleared from pendingUpload and absent from remote map IS deleted", () => {
		// a.md was uploaded to relay A, markUploaded cleared it from pendingUpload.
		// Remote peer deleted it. pendingUpload does not contain it.
		const pendingUpload = new Map<string, string>();
		const remoteVPaths = ["notes/b.md"]; // only b.md remains

		expect(wouldDelete("notes/a.md", remoteVPaths, pendingUpload)).toBe(true);
	});

	test("file present in remote map is NOT deleted regardless of pendingUpload", () => {
		const pendingUpload = new Map<string, string>();
		const remoteVPaths = ["notes/b.md"];
		expect(wouldDelete("notes/b.md", remoteVPaths, pendingUpload)).toBe(false);
	});

	test("single deletion in a large folder is not blocked by circuit breaker", () => {
		// Scenario: 10 local files, one was remotely deleted, 9 still in remote map.
		// The one deleted file should be scheduled for deletion.
		const allVPaths = Array.from({ length: 10 }, (_, i) => `notes/file${i}.md`);
		const deletedVPath = allVPaths[3];
		const remoteVPaths = allVPaths.filter((p) => p !== deletedVPath);
		const pendingUpload = new Map<string, string>(); // all files uploaded and acknowledged

		// Only the deleted file would be scheduled
		const deletions = allVPaths.filter((vpath) =>
			wouldDelete(vpath, remoteVPaths, pendingUpload),
		);
		expect(deletions).toEqual([deletedVPath]);
	});
});

describe("partial migration — relay B already has some files", () => {
	test("files in relay B not deleted; unregistered files protected by pendingUpload", () => {
		const localVPaths = ["notes/a.md", "notes/b.md", "notes/c.md"];
		// Relay B already has a.md and b.md from a prior partial sync
		const remoteVPaths = ["notes/a.md", "notes/b.md"];
		// c.md was never uploaded to relay B
		const pendingUpload = onRelayChanged(localVPaths, () => undefined);

		for (const vpath of localVPaths) {
			expect(wouldDelete(vpath, remoteVPaths, pendingUpload)).toBe(false);
		}
	});

	test("after upload acknowledged: file cleared from pendingUpload, still in remote map — not deleted", () => {
		// a.md uploaded to relay B → markUploaded clears it from pendingUpload
		const pendingUpload = new Map([
			["notes/b.md", "guid-b"], // not yet uploaded to relay B
			["notes/c.md", "guid-c"], // not yet uploaded to relay B
		]);
		const remoteVPaths = ["notes/a.md", "notes/b.md"]; // a.md and b.md exist on relay B

		// a.md: cleared from pendingUpload, in remote map → NOT deleted ✓
		expect(wouldDelete("notes/a.md", remoteVPaths, pendingUpload)).toBe(false);
		// b.md: still pending AND in remote map → NOT deleted ✓
		expect(wouldDelete("notes/b.md", remoteVPaths, pendingUpload)).toBe(false);
		// c.md: still pending, not yet in remote map → NOT deleted ✓
		expect(wouldDelete("notes/c.md", remoteVPaths, pendingUpload)).toBe(false);
	});
});
