import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// This fixture has no remote database or provider. Every application fetch is
// intercepted and evaluated by embedded PostgreSQL through the real SQL RPCs.
process.env.RIV_STORAGE = 'supabase';
process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_TEST_ONLY_NO_NETWORK';
process.env.RIV_VOICE_APPROVED = 'false';
delete process.env.ASSEMBLYAI_API_KEY;

const db = new PGlite();
const originalFetch = globalThis.fetch;
const checks = [];
const calls = [];
let failNextRpc = null;
let forbiddenRequests = 0;
const mark = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort();
const applyMigrations = async () => {
  for (const name of migrations) await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'));
};

try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await applyMigrations();
  assert.ok(migrations.includes('20260930042724_return_voice_durable_state.sql'));
  assert.ok(migrations.includes('20260930053014_voice_instance_control.sql'));
  mark('Both migrations applied in lexical order to embedded PostgreSQL');

  const controlDefinition = (await db.query("select prosecdef from pg_proc where oid='public.riv_voice_control(uuid,uuid,text,boolean)'::regprocedure")).rows;
  assert.deepEqual(controlDefinition, [{ prosecdef: false }]);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(
      db.query('select public.riv_voice_control($1,$2,null,true)', ['10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001']),
      /permission denied/,
    );
    await db.exec('reset role');
  }
  mark('Voice control is SECURITY INVOKER and denied to anon/authenticated');
  await db.exec('set role service_role');

  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    const match = parsed.pathname.match(/^\/rest\/v1\/rpc\/(riv_[a-z_]+)$/);
    if (parsed.origin !== 'https://fixture.supabase.co' || !match || init?.method !== 'POST') {
      forbiddenRequests += 1;
      throw new Error('Network/provider request forbidden by the voice coordination fixture');
    }
    const name = match[1];
    calls.push(name);
    if (failNextRpc === name) {
      failNextRpc = null;
      return new Response('{}', { status: 503 });
    }
    const args = JSON.parse(init.body);
    const keys = Object.keys(args);
    assert.ok(keys.every((key) => /^p_[a-z_]+$/.test(key)));
    const bindings = keys.map((key, index) => `${key} => $${index + 1}`).join(',');
    try {
      const result = await db.query(`select public.${name}(${bindings}) as result`, keys.map((key) => {
        const value = args[key];
        return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
      }));
      return new Response(JSON.stringify(result.rows[0].result), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (error) {
      const status = error.code?.startsWith('PT') ? Number(error.code.slice(2)) : 500;
      return new Response('{}', { status });
    }
  };

  const { persisted, rpc } = await import('../server/storage/supabase.ts');
  const { withKnownOwner } = await import('../server/access.ts');
  const { createVoiceObserver } = await import('../server/voice-control.ts');
  const app = await import('../agent/lib/demo/service.ts');
  const owner = '20000000-0000-4000-8000-000000000001';
  const stranger = '20000000-0000-4000-8000-000000000002';
  // Each HTTP operation hydrates a new request-local domain store from SQL.
  // The socket observer holds only its own revision/announcement bookkeeping.
  const httpB = (id, work, mode) => withKnownOwner(owner, () => persisted(id, work, mode));
  const pollAsOwner = (observer) => withKnownOwner(owner, () => observer.poll());
  const control = (sessionId, ownerId, ticketHash, cancel = false) => withKnownOwner(ownerId, () => rpc('riv_voice_control', {
    p_session_id: sessionId, p_owner_id: ownerId, p_ticket_hash: ticketHash, p_cancel: cancel,
  }));
  const reserve = (sessionId, ticketHash) => withKnownOwner(owner, () => rpc('riv_reserve_voice', {
    p_session_id: sessionId, p_owner_id: owner, p_ticket_hash: ticketHash, p_seconds: 180, p_cap_seconds: 720,
  }));
  const consume = (sessionId, ticketHash) => withKnownOwner(owner, () => rpc('riv_consume_voice_ticket', {
    p_session_id: sessionId, p_owner_id: owner, p_ticket_hash: ticketHash,
  }));
  const observe = (sessionId, ticketHash) => {
    const events = { stops: 0, snapshots: [], resolutions: [] };
    const observer = createVoiceObserver({
      sessionId, ticketHash,
      onStop: () => { events.stops += 1; },
      onSnapshot: (snapshot) => events.snapshots.push(snapshot),
      onResolution: (resolution) => events.resolutions.push(resolution),
    });
    return { observer, events };
  };
  const budgetState = async () => (await db.query("select to_jsonb(b) as state from riv_private.voice_budget b where id='global'")).rows[0].state;
  const ticketState = async (ticketHash) => (await db.query('select to_jsonb(t) as state from riv_private.voice_tickets t where ticket_hash=$1', [ticketHash])).rows[0].state;

  await db.exec("update riv_private.voice_budget set max_seconds=720 where id='global'");
  const session = await httpB(null, () => app.startSession({ customerId: 'CUST-001' }));
  const ticketA = 'a'.repeat(64);
  await reserve(session.id, ticketA);
  await assert.rejects(control(session.id, owner, ticketA), /rejected/);
  await consume(session.id, ticketA);
  const socketA = observe(session.id, ticketA);
  assert.equal(await pollAsOwner(socketA.observer), true);
  assert.equal(socketA.events.snapshots.length, 1);
  assert.deepEqual(socketA.events.resolutions, []);
  mark('Only a consumed ticket can initialize a connection-local observer');

  const diagnosis = await httpB(session.id, () => app.addMessage(session.id, 'The fit is too tight and the fabric is too hot.'));
  assert.ok(diagnosis.candidates.length > 0);
  const candidate = diagnosis.candidates[0];
  const proposed = await httpB(session.id, () => app.proposeResolution(session.id, {
    action: 'exchange', productId: candidate.productId, size: diagnosis.item.size, color: candidate.colors[0],
  }));
  const completed = await httpB(session.id, () => app.resolveProposal(session.id, {
    proposalId: proposed.pendingAction.proposalId, confirmed: true, conditionConfirmed: true,
  }));
  assert.equal(completed.phase, 'COMPLETED');
  assert.equal(socketA.events.resolutions.length, 0, 'HTTP instance cannot update observer A directly');
  assert.equal(await pollAsOwner(socketA.observer), true);
  assert.deepEqual(socketA.events.resolutions.map((record) => record.recordId), [completed.resolution.recordId]);
  assert.equal(socketA.events.snapshots.at(-1).resolution.recordId, completed.resolution.recordId);
  assert.equal(await pollAsOwner(socketA.observer), true);
  assert.equal(socketA.events.resolutions.length, 1);
  // Advance the revision with an idempotent domain confirmation; it must not
  // cause the same resolution record to be announced again.
  await httpB(session.id, () => app.resolveProposal(session.id, {
    proposalId: proposed.pendingAction.proposalId, confirmed: true, conditionConfirmed: true,
  }));
  await pollAsOwner(socketA.observer);
  assert.equal(socketA.events.resolutions.length, 1);
  assert.equal((await db.query("select count(*)::int as count from riv_private.records where kind='exchange'")).rows[0].count, 1);
  mark('HTTP B commits a real resolution; socket A sees SQL state and announces it once across revisions');

  const reloaded = observe(session.id, ticketA);
  assert.equal(await pollAsOwner(reloaded.observer), true);
  assert.equal(reloaded.events.snapshots[0].resolution.recordId, completed.resolution.recordId);
  assert.deepEqual(reloaded.events.resolutions, []);
  await pollAsOwner(reloaded.observer);
  assert.deepEqual(reloaded.events.resolutions, []);
  mark('New observer seeds existing outcomes without announcing historical completion');

  const untouchedTicket = await ticketState(ticketA);
  await assert.rejects(control(session.id, stranger, ticketA), /rejected/);
  await assert.rejects(control(session.id, stranger, ticketA, true), /rejected/);
  const strangerObserver = observe(session.id, ticketA);
  await assert.rejects(withKnownOwner(stranger, () => strangerObserver.observer.poll()), /rejected/);
  assert.deepEqual(strangerObserver.events, { stops: 0, snapshots: [], resolutions: [] });
  assert.deepEqual(await ticketState(ticketA), untouchedTicket);
  await assert.rejects(control(session.id, owner, 'f'.repeat(64)), /rejected/);
  mark('Stranger cannot read/cancel/observe; invalid control tickets fail closed');

  for (const failingRpc of ['riv_voice_control', 'riv_load_state']) {
    const failing = observe(session.id, ticketA);
    failNextRpc = failingRpc;
    await assert.rejects(pollAsOwner(failing.observer), /rejected/);
    assert.deepEqual(failing.events, { stops: 0, snapshots: [], resolutions: [] });
    assert.equal(await pollAsOwner(failing.observer), true, 'A failed poll must release its in-flight guard');
    assert.deepEqual(failing.events.resolutions, []);
  }
  mark('Control and hydration database errors propagate without success callbacks; polling can recover');

  const beforeCancel = await budgetState();
  assert.deepEqual(await control(session.id, owner, null, true), { stopRequested: true, providerEnded: false });
  assert.deepEqual(await budgetState(), beforeCancel, 'Cancellation cannot release the lease or refund allowance');
  const cancelledTicket = await ticketState(ticketA);
  assert.ok(cancelledTicket.stop_requested_at);
  const snapshotsBeforeCancel = socketA.events.snapshots.length;
  assert.equal(await pollAsOwner(socketA.observer), false);
  assert.equal(socketA.events.stops, 1);
  assert.equal(socketA.events.snapshots.length, snapshotsBeforeCancel);
  assert.equal(socketA.events.resolutions.length, 1);
  await control(session.id, owner, null, true);
  assert.deepEqual(await ticketState(ticketA), cancelledTicket, 'Repeated cancellation preserves its original timestamp');
  assert.deepEqual(await budgetState(), beforeCancel);
  mark('HTTP cancellation reaches socket A; lease, budget, and first cancellation timestamp remain unchanged');

  // Simulate provider-confirmed termination only after checking that stop alone
  // did not release anything. The second fixture retains the spent allowance.
  await rpc('riv_release_voice', { p_ticket_hash: ticketA });
  assert.equal((await budgetState()).reserved_seconds, 180);
  const second = await httpB(null, () => app.startSession({ customerId: 'CUST-001' }));
  const ticketB = 'b'.repeat(64);
  await reserve(second.id, ticketB);
  await control(second.id, owner, null, true);
  await consume(second.id, ticketB);
  const cancelledBeforeConnect = observe(second.id, ticketB);
  let providerStarts = 0;
  if (await pollAsOwner(cancelledBeforeConnect.observer)) providerStarts += 1;
  assert.equal(providerStarts, 0);
  assert.deepEqual(cancelledBeforeConnect.events, { stops: 1, snapshots: [], resolutions: [] });
  mark('Cancellation before ticket consumption stops the initial observer before provider initialization');

  const beforeReapply = { budget: await budgetState(), ticketA: await ticketState(ticketA), ticketB: await ticketState(ticketB) };
  assert.equal(beforeReapply.budget.reserved_seconds, 360);
  await db.exec('reset role');
  await applyMigrations();
  await db.exec('set role service_role');
  assert.deepEqual({ budget: await budgetState(), ticketA: await ticketState(ticketA), ticketB: await ticketState(ticketB) }, beforeReapply);
  assert.equal((await control(second.id, owner, ticketB)).cancelled, true);
  mark('Reapplying both migrations preserves reserved budget, active lease, and cancellation state');

  assert.equal(forbiddenRequests, 0);
  assert.ok(calls.includes('riv_voice_control') && calls.includes('riv_commit_session') && calls.includes('riv_load_state'));
  console.log(`${checks.length} voice coordination checks passed; ${calls.length} RPC fetches intercepted locally; 0 provider requests. Embedded PGlite only, not a deployed Supabase/Vercel verification.`);
} finally {
  globalThis.fetch = originalFetch;
  await db.close();
}
