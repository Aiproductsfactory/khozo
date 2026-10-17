// Verifies the tamper-evident audit log.
//
// Each audit row stores the hash of the row before it (prevHash) and a hash of
// its own content plus that prevHash. The log used to be verified as a single
// straight line: walk the rows oldest-first and require every row to point at
// the one before it. That is not how the log is written. On the Worker every
// request appends to its own replica of the log and flushes at the end, so two
// requests served at the same moment both append to the same newest row. The
// log forks, and the straight-line check reported the first fork (1 Aug 2026 on
// khozo.org) as "audit chain failed" — indistinguishable, on the dashboard,
// from tampering.
//
// What tampering actually looks like is checked here instead:
//   - a row whose content no longer matches its own hash (edited), and
//   - a row that points at a predecessor no longer in the log (a row deleted
//     from the middle).
// Concurrent branches are reported as a count, not as a failure.

// A gap can be acknowledged, never hidden: a super admin records an
// 'audit.gap_acknowledged' entry naming the missing predecessor hashes and why
// (e.g. a write lost when the Worker was stopped mid-request). That entry is
// itself in the log and hash-checked; any gap it does not name still fails.
const GAP_ACK = 'audit.gap_acknowledged';

export function verifyAuditLinks(rows = [], hashRow) {
  const chronological = rows.slice().sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
  const known = new Set(chronological.map((row) => row.hash).filter(Boolean));
  const acknowledged = new Set(
    chronological
      .filter((row) => row.action === GAP_ACK)
      .flatMap((row) => (Array.isArray(row.metadata?.missingPrevHashes) ? row.metadata.missingPrevHashes : [])),
  );
  const children = new Map();
  const changed = [];
  const missing = [];
  const starts = [];
  let acknowledgedGaps = 0;

  for (const row of chronological) {
    const prevHash = row.prevHash || null;
    const expected = hashRow(row, prevHash);
    if (row.hash !== expected) changed.push({ id: row.id, ts: row.ts });
    if (prevHash === null) {
      starts.push({ id: row.id, ts: row.ts });
    } else if (!known.has(prevHash)) {
      if (acknowledged.has(prevHash)) acknowledgedGaps++;
      else missing.push({ id: row.id, ts: row.ts, prevHash });
    }
    children.set(prevHash, (children.get(prevHash) || 0) + 1);
  }

  const branches = [...children.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  const summary = {
    checked: chronological.length,
    concurrentBranches: branches,
    acknowledgedGaps,
    contentChanged: changed.length,
    missingPredecessors: missing.length,
    starts: starts.length,
  };
  // Earliest problem first, so failedId points at where to look.
  const first = [
    changed[0] && { ...changed[0], reason: 'content_changed' },
    missing[0] && { ...missing[0], reason: 'predecessor_missing' },
    // The log starts once. A second start means rows were removed from the
    // beginning, or a fork happened on an empty log.
    starts.length > 1 && { ...starts[1], reason: 'multiple_starts' },
  ].filter(Boolean).sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))[0];

  if (first) {
    return {
      ok: false,
      ...summary,
      failedId: first.id,
      reason: first.reason,
      ...(first.prevHash ? { actualPrevHash: first.prevHash } : {}),
      missing: missing.slice(0, 20).map((m) => ({ id: m.id, ts: m.ts, prevHash: m.prevHash })),
      changed: changed.slice(0, 20).map((c) => c.id),
    };
  }
  return { ok: true, ...summary, headHash: chronological.length ? chronological[chronological.length - 1].hash : null };
}

// The row a new audit entry should follow: the newest row that no other row
// already follows. Appending to "the first row of the replica" forked the log
// without any concurrency at all, because the replica is read `order by ts
// desc` and rows written in the same millisecond come back in either order.
export function auditHead(rows = []) {
  if (!rows.length) return null;
  const followed = new Set(rows.map((row) => row.prevHash).filter(Boolean));
  let head = null;
  for (const row of rows) {
    if (!row.hash || followed.has(row.hash)) continue;
    if (!head || Number(row.ts || 0) > Number(head.ts || 0)) head = row;
  }
  return (head || rows[0]).hash || null;
}
