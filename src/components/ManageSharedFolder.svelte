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

	// ── Fix 4: per-folder auto-resolve setting ──────────────────────────────
	type AutoResolve = 'none' | 'remote' | 'local';

	let autoResolve: AutoResolve = sharedFolder?.autoResolveConflicts ?? 'none';

	function onAutoResolveChange() {
		if (sharedFolder) {
			sharedFolder.autoResolveConflicts = autoResolve;
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
	<!-- Fix 4: Conflict resolution preference -->
	<SettingItemHeading name="Sync settings"></SettingItemHeading>
	<SettingGroup>
		<SettingItem
			name="Conflict resolution"
			description="When a conflict is detected between an external write (MegaMem, Claude Code) and the live editor, how should Relay resolve it?"
		>
			<select bind:value={autoResolve} on:change={onAutoResolveChange}>
				<option value="none">Manual — show conflict UI</option>
				<option value="remote">Prefer Remote — always accept server/editor state</option>
				<option value="local">Prefer Local — always accept disk/external writes</option>
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
