<script lang="ts">
	import SettingItemHeading from "./SettingItemHeading.svelte";
	import SettingItem from "./SettingItem.svelte";
	import SettingGroup from "./SettingGroup.svelte";
	import type Live from "src/main";
	import { type SharedFolder } from "src/SharedFolder";
	import { debounce, Notice } from "obsidian";
	import { createEventDispatcher, onDestroy, onMount } from "svelte";
	import Breadcrumbs from "./Breadcrumbs.svelte";

	export let plugin: Live;
	export let sharedFolder: SharedFolder;

	const dispatch = createEventDispatcher();

	// ── per-folder auto-resolve setting ─────────────────────────────────────
	type AutoResolve = 'none' | 'remote' | 'local' | 'latest';

	let autoResolve: AutoResolve = sharedFolder?.autoResolveConflicts ?? 'none';

	function onAutoResolveChange() {
		if (sharedFolder) {
			sharedFolder.autoResolveConflicts = autoResolve;
		}
	}

	// ── disk write debounce setting ──────────────────────────────────────────
	let diskDebounceMs: number = sharedFolder?.diskWriteDebounceMs ?? 1000;

	function onDiskDebounceChange() {
		if (sharedFolder) {
			sharedFolder.diskWriteDebounceMs = diskDebounceMs;
		}
	}

	// ── Fix 5: reset HSM state ───────────────────────────────────────────────
	let resetting = false;

	async function handleResetSyncState() {
		if (!sharedFolder || resetting) return;
		resetting = true;
		try {
			await sharedFolder.resetHSMState();
			new Notice(`Relay: Sync state reset for "${sharedFolder.path}". Re-open files to apply.`);
		} catch (e) {
			new Notice(`Relay: Failed to reset sync state: ${e}`);
		} finally {
			resetting = false;
		}
	}

	async function handleDeleteMetadata() {
		if (sharedFolder) {
			plugin.sharedFolders.delete(sharedFolder);
		}
		dispatch("goBack", { clear: true });
	}

	function handleDeleteLocal() {
		if (sharedFolder) {
			const folder = plugin.vault.getFolderByPath(sharedFolder.path);
			if (folder) {
				plugin.app.vault.trash(folder, false);
			}
		}
		dispatch("goBack", {});
	}
</script>

<Breadcrumbs
	items={[
		{
			type: "home",
			onClick: () => dispatch("goBack", { clear: true }),
		},
		{
			type: "folder",
			folder: sharedFolder,
		},
	]}
/>

<div style="padding: 1em; margin: 1em; background: var(--background-secondary)">
	<p style="margin: 1em; text-align: center">
		This Shared Folder is not on a Relay Server, or else you do not have
		permission to access it.
	</p>
</div>

{#if sharedFolder}
	<!-- Conflict resolution + disk write settings -->
	<SettingItemHeading name="Sync settings"></SettingItemHeading>
	<SettingGroup>
		<SettingItem
			name="Conflict resolution"
			description="When a conflict is detected — which version wins automatically? 'Prefer Latest' accepts whichever side was modified most recently."
		>
			<select bind:value={autoResolve} on:change={onAutoResolveChange}>
				<option value="none">Manual — show conflict UI</option>
				<option value="remote">Prefer Remote — always accept server/editor state</option>
				<option value="local">Prefer Local — always accept disk/external writes</option>
				<option value="latest">Prefer Latest — accept most recent</option>
			</select>
		</SettingItem>
		<SettingItem
			name="Disk write delay"
			description="Quiet period after a file is written before Relay syncs it. Increase for folders written by external tools (MegaMem, Claude Code) to absorb rapid write chains. Default: 1 second."
		>
			<select bind:value={diskDebounceMs} on:change={onDiskDebounceChange}>
				<option value={0}>Off — sync immediately</option>
				<option value={500}>Fast — 0.5 seconds</option>
				<option value={1000}>Standard — 1 second (default)</option>
				<option value={3000}>Relaxed — 3 seconds</option>
				<option value={30000}>Slow — 30 seconds</option>
			</select>
		</SettingItem>
	</SettingGroup>

	<!-- Fix 5: Reset sync state -->
	<SettingItemHeading name="Maintenance"></SettingItemHeading>
	<SettingGroup>
		<SettingItem
			name="Reset sync state"
			description="Clears all persisted merge history (LCA, fork, deferred conflicts) for this folder. Use this after an upgrade if previously-resolved conflicts keep reappearing. Document content is not affected."
		>
			<button
				disabled={resetting}
				on:click={debounce(() => {
					handleResetSyncState();
				})}
			>
				{resetting ? "Resetting…" : "Reset sync state"}
			</button>
		</SettingItem>
	</SettingGroup>

	<SettingItemHeading name="Danger zone"></SettingItemHeading>
	<SettingGroup>
		<SettingItem
			name="Delete metadata"
			description="Deletes edit history and disables change tracking."
		>
			<button
				class="mod-destructive"
				on:click={debounce(() => {
					handleDeleteMetadata();
				})}
			>
				Delete metadata
			</button>
		</SettingItem>

		<SettingItem
			name="Delete from vault"
			description="Delete the local Shared Folder and all of its contents."
		>
			<button
				class="mod-warning"
				on:click={debounce(() => {
					handleDeleteLocal();
				})}
			>
				Move to trash
			</button>
		</SettingItem>
	</SettingGroup>
{/if}
