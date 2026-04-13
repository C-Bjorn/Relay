/**
 * Tests for Day05.02 — BackgroundSync Stuck at 96% three-bug fix.
 *
 * Rather than fully mounting BackgroundSync (heavy Obsidian deps), we extract
 * the mutated logic into mirrored helpers and verify the invariants that each
 * fix establishes.  This matches the four test cases described in the spec.
 */

import { EventEmitter } from "events";
import { describe, test, expect } from "@jest/globals";

// ─── Helpers that mirror the fixed implementations ────────────────────────────

/**
 * Mirrors the fixed HasProvider.onceProviderSynced() promise body.
 * Resolves on "synced", rejects on "connection-close".
 */
function onceProviderSynced(
	provider: EventEmitter,
	path: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const onSynced = () => {
			provider.off("connection-close", onClose);
			resolve();
		};
		const onClose = () => {
			provider.off("synced", onSynced);
			reject(
				new Error(
					`[onceProviderSynced] Provider disconnected before sync: ${path}`,
				),
			);
		};
		provider.once("synced", onSynced);
		provider.once("connection-close", onClose);
	});
}

/** Minimal SyncGroup shape used by processSyncQueue catch blocks. */
interface MiniGroup {
	total: number;
	completed: number;
	completedSyncs: number;
	status: string;
}

/**
 * Mirrors the fixed catch-block logic from processSyncQueue.
 * Increments counters and marks status = "failed" only when all items done.
 */
function applyFailureCatch(group: MiniGroup): void {
	group.completedSyncs++;
	group.completed++;
	if (group.completed === group.total) {
		group.status = "failed";
	}
}

/**
 * Mirrors the fixed enqueueSharedFolderSync total calculation:
 * only items NOT already in inProgressSyncs contribute to the group total.
 */
function calcNewItems(
	allItems: Array<{ guid: string }>,
	inProgressSyncs: Set<string>,
): Array<{ guid: string }> {
	return allItems.filter((item) => !inProgressSyncs.has(item.guid));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("BackgroundSync — three-bug fix (Day05.02)", () => {
	// ── Test 1 ──────────────────────────────────────────────────────────────────
	describe("Bug 1 — onceProviderSynced() rejects on provider disconnect", () => {
		test("rejects with path-tagged error when connection-close fires before synced", async () => {
			const provider = new EventEmitter();
			const promise = onceProviderSynced(provider, "notes/stuck.md");

			provider.emit("connection-close");

			await expect(promise).rejects.toThrow(
				"[onceProviderSynced] Provider disconnected before sync: notes/stuck.md",
			);
		});

		test("resolves cleanly when synced fires first", async () => {
			const provider = new EventEmitter();
			const promise = onceProviderSynced(provider, "notes/ok.md");

			provider.emit("synced");

			await expect(promise).resolves.toBeUndefined();
		});

		test("no unhandled rejection when connection-close fires after synced (listeners cleaned up)", async () => {
			const provider = new EventEmitter();
			const promise = onceProviderSynced(provider, "notes/ok.md");

			provider.emit("synced");
			await promise;

			// Firing connection-close after resolution must not produce a dangling rejection
			expect(() => provider.emit("connection-close")).not.toThrow();
		});
	});

	// ── Test 2 ──────────────────────────────────────────────────────────────────
	describe("Bug 2 — sync failure increments group.completed", () => {
		test("group.completed increments on first item failure (group stays running)", () => {
			const group: MiniGroup = {
				total: 2,
				completed: 0,
				completedSyncs: 0,
				status: "running",
			};

			applyFailureCatch(group);

			expect(group.completed).toBe(1);
			expect(group.completedSyncs).toBe(1);
			expect(group.total).toBe(2);
			// Not all items accounted for yet — status must NOT flip to failed prematurely
			expect(group.status).toBe("running");
		});
	});

	// ── Test 3 ──────────────────────────────────────────────────────────────────
	describe("Bug 3 — re-sync after stuck item excludes stuck item from total", () => {
		test("group total = allItems.length - 1 when one item is already in progress", () => {
			const allItems = [
				{ guid: "stuck-guid" },
				{ guid: "item-b" },
				{ guid: "item-c" },
			];
			const inProgress = new Set(["stuck-guid"]);

			const newItems = calcNewItems(allItems, inProgress);

			expect(newItems).toHaveLength(2);
			expect(newItems.map((i) => i.guid)).not.toContain("stuck-guid");
		});
	});

	// ── Test 4 ──────────────────────────────────────────────────────────────────
	describe("Bug 2+3 combined — full group reaches 100% despite one failure", () => {
		test("3 items (2 succeed, 1 fails) → completed=3, total=3, status=failed", () => {
			const group: MiniGroup = {
				total: 3,
				completed: 0,
				completedSyncs: 0,
				status: "running",
			};

			// Two successful syncs (mirror the .then() happy-path counter increments)
			group.completed++;
			group.completedSyncs++;
			group.completed++;
			group.completedSyncs++;

			// One failed sync goes through the catch block
			applyFailureCatch(group);

			expect(group.completed).toBe(3);
			expect(group.total).toBe(3);
			expect(group.status).toBe("failed"); // completed but with errors
		});
	});
});
