/**
 * Auto-Resolve Tests
 *
 * Tests for autoResolveConflicts modes: 'remote', 'local', 'latest'
 * across the conflict detection paths in MergeHSM:
 *  1. invokeIdleThreeWayAutoMerge  (idle.diverged)
 *  2. invokeForkReconcile          (idle.localAhead — fork path)
 */

import {
  createTestHSM,
  diskChanged,
  connected,
  providerSynced,
  loadToIdle,
  expectState,
} from 'src/merge-hsm/testing';

// =============================================================================
// Helper: drive to idle.diverged with a TRUE three-way conflict
//
// Key sequence to create a genuine three-way conflict WITHOUT advancing LCA:
//  1. loadToIdle (LCA = base content)
//  2. Pre-compute disk event (hash needed, compute before async)
//  3. applyRemoteChange → idle.remoteAhead → starts async invoke (first microtask)
//  4. IMMEDIATELY send disk event (sync) → DISK_CHANGED transitions to idle.diverged,
//     aborts the remote invoke before it can run and advance LCA
//  5. idle.diverged → invokeIdleThreeWayAutoMerge runs with:
//       LCA='original', disk='DISK', remote='REMOTE' → genuine conflict
//     Auto-resolve fires silently if mode ≠ 'none'
// =============================================================================
async function driveToIdleThreeWayConflict(
  t: Awaited<ReturnType<typeof createTestHSM>>,
  opts: { remoteMtime: number; diskMtime: number }
) {
  // Base content, single-line to guarantee same-line diff3 conflict
  await loadToIdle(t, { content: 'original', mtime: 500 });

  // Pre-compute disk event (async hash) BEFORE sending remote update
  const diskEvt = await diskChanged('DISK', opts.diskMtime);

  // Set mock-clock for _remoteMtime recording
  t.time.setTime(opts.remoteMtime);

  // Send remote change → idle.remoteAhead → async remote-merge invoke STARTS
  // (hits first await → yields thread back to us before running merge body)
  t.applyRemoteChange('REMOTE');

  // SYNCHRONOUSLY send disk event — arrives while remote merge is pending
  // → DISK_CHANGED in idle.remoteAhead aborts remote invoke → idle.diverged
  t.send(diskEvt);

  // idle.diverged → invokeIdleThreeWayAutoMerge
  // Provider already synced from loadToIdle (no REQUEST_PROVIDER_SYNC emitted here)
  await t.hsm.awaitIdleAutoMerge();

  // Fork path: if auto-resolve wasn't reached and a fork was created
  if (t.matches('idle.localAhead')) {
    t.send(connected());
    t.send(providerSynced());
    await t.hsm.awaitForkReconcile();
    await t.hsm.awaitIdleAutoMerge();
  }
}

// =============================================================================
// 1. Auto-resolve: invokeIdleThreeWayAutoMerge
// =============================================================================

describe('Auto-resolve: idle 3-way merge (invokeIdleThreeWayAutoMerge)', () => {
  test("'local' — silently accepts disk content, reaches idle.synced", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'local' });
    await driveToIdleThreeWayConflict(t, { remoteMtime: 1000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('DISK');
  });

  test("'remote' — silently accepts CRDT content, reaches idle.synced", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'remote' });
    await driveToIdleThreeWayConflict(t, { remoteMtime: 1000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('REMOTE');
  });

  test("'latest' — disk newer than remote → accepts disk content", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'latest' });
    // remoteMtime=1000, diskMtime=2000 → disk wins
    await driveToIdleThreeWayConflict(t, { remoteMtime: 1000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('DISK');
  });

  test("'latest' — remote newer than disk → accepts remote content", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'latest' });
    // remoteMtime=3000, diskMtime=2000 → remote wins
    await driveToIdleThreeWayConflict(t, { remoteMtime: 3000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('REMOTE');
  });

  test("'latest' — equal timestamps → disk wins (tiebreaker)", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'latest' });
    // Both 2000 → disk wins (diskMtime >= remoteMtime)
    await driveToIdleThreeWayConflict(t, { remoteMtime: 2000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('DISK');
  });

  test("'none' — conflict NOT auto-resolved, stays out of idle.synced", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'none' });
    await driveToIdleThreeWayConflict(t, { remoteMtime: 2000, diskMtime: 2000 });

    // With 'none', conflict is never silently resolved
    expect(t.matches('idle.synced')).toBe(false);
  });
});

// =============================================================================
// 2. Auto-resolve: invokeForkReconcile (idle fork path)
//    Load to idle, disk change creates fork, then remote changes SAME line.
// =============================================================================

describe('Auto-resolve: idle fork-reconcile (invokeForkReconcile)', () => {
  async function setupForkConflict(
    t: Awaited<ReturnType<typeof createTestHSM>>,
    opts: { remoteMtime: number; diskMtime: number }
  ) {
    await loadToIdle(t, { content: 'original', mtime: 500 });
    t.setProviderSynced(false);

    // Disk change creates fork → idle.localAhead
    t.send(await diskChanged('DISK', opts.diskMtime));
    await t.hsm.awaitIdleAutoMerge();

    // Remote changes SAME single line → conflict in fork-reconcile
    t.time.setTime(opts.remoteMtime);
    t.applyRemoteChange('REMOTE');

    t.send(connected());
    t.send(providerSynced());
    await t.hsm.awaitForkReconcile();
    await t.hsm.awaitIdleAutoMerge();
  }

  test("'local' — fork-reconcile picks disk content, reaches idle.synced", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'local' });
    await setupForkConflict(t, { remoteMtime: 3000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('DISK');
  });

  test("'remote' — fork-reconcile picks CRDT content, reaches idle.synced", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'remote' });
    await setupForkConflict(t, { remoteMtime: 3000, diskMtime: 2000 });

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('REMOTE');
  });

  test("'latest' — fork.created newer than remoteMtime → picks disk", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'latest' });
    t.time.setTime(2000);  // fork.created = 2000
    await loadToIdle(t, { content: 'original', mtime: 500 });
    t.setProviderSynced(false);
    t.send(await diskChanged('DISK', 2000));
    await t.hsm.awaitIdleAutoMerge();

    t.time.setTime(1000);  // _remoteMtime = 1000 < fork.created 2000 → disk wins
    t.applyRemoteChange('REMOTE');
    t.send(connected());
    t.send(providerSynced());
    await t.hsm.awaitForkReconcile();
    await t.hsm.awaitIdleAutoMerge();

    expectState(t, 'idle.synced');
    expect(t.getLocalDocText()).toBe('DISK');
  });

  test("'none' — fork-reconcile conflict stays unresolved", async () => {
    const t = await createTestHSM({ getAutoResolveConflicts: () => 'none' });
    await setupForkConflict(t, { remoteMtime: 3000, diskMtime: 2000 });

    expect(t.matches('idle.synced')).toBe(false);
  });
});
