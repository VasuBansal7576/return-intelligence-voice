#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCENARIOS, loadDomain } from '../evals/scenarios.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const self = fileURLToPath(import.meta.url);
const oneCase = process.argv.indexOf('--case');
if (oneCase !== -1) {
  const definition = SCENARIOS.find(c => c.id === process.argv[oneCase + 1]);
  if (!definition) throw new Error('Unknown evaluation case');
  if (!process.env.RIV_RECORDS_FILE?.startsWith(tmpdir())) throw new Error('An isolated temporary RIV_RECORDS_FILE is required');
  const start = performance.now();
  try {
    const evidence = await definition.run(await loadDomain());
    console.log(JSON.stringify({ status: 'PASS', evidence, durationMs: Math.round(performance.now() - start) }));
  } catch (error) {
    console.log(JSON.stringify({ status: 'FAIL', classification: error?.name === 'AssertionError' ? 'behavior_mismatch' : 'runtime_error',
      error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined,
      durationMs: Math.round(performance.now() - start) }));
    process.exitCode = 1;
  }
} else {
  const startedAt = new Date().toISOString();
  const outputArg = process.argv.indexOf('--output');
  const filterArg = process.argv.indexOf('--filter');
  const filter = filterArg !== -1 ? process.argv[filterArg + 1] : null;
  const output = outputArg !== -1 ? process.argv[outputArg + 1] : filter ? join(root, 'evals/results', `${filter}.json`) : join(root, 'data/evaluation-results.json');
  const selected = filter ? SCENARIOS.filter(c => c.id === filter || c.category === filter) : SCENARIOS;
  if (!selected.length) throw new Error(`No cases selected for ${filter}`);
  const results = [];
  const sourceFiles = ['evals/scenarios.mjs', 'scripts/evaluate-scenarios.mjs'];
  for (const folder of ['agent/lib/demo', 'agent/lib/engine', 'agent/lib/knowledge']) {
    for (const entry of readdirSync(join(root, folder))) if ((entry.endsWith('.ts') || entry.endsWith('.json'))) sourceFiles.push(`${folder}/${entry}`);
  }
  const hashes = () => Object.fromEntries(sourceFiles.sort().map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
  const before = hashes();
  for (const { run: _run, ...definition } of selected) {
    const directory = mkdtempSync(join(tmpdir(), 'riv-eval-'));
    try {
      const env = { ...process.env, RIV_STORAGE: 'local', RIV_RECORDS_FILE: join(directory, 'records.jsonl') };
      // The suite imports only local domain modules. Do not load provider SDKs or call an LLM.
      const worker = spawnSync(process.execPath, [self, '--case', definition.id], { cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 });
      const line = worker.stdout?.trim().split('\n').at(-1);
      let result;
      try { result = JSON.parse(line); } catch { result = { status: 'FAIL', classification: 'execution_error', error: worker.error?.message ?? worker.stderr ?? 'No result' }; }
      if (worker.status !== 0 && result.status === 'PASS') result = { status: 'FAIL', classification: 'execution_error', error: `Unexpected process exit ${worker.status}` };
      results.push({ ...definition, mode: 'deterministic_domain', ...result });
      console.log(`${result.status.padEnd(4)} ${definition.id} ${definition.title}${result.status === 'FAIL' ? `: ${result.error}` : ''}`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  const after = hashes();
  const changedDuringRun = sourceFiles.filter(path => before[path] !== after[path]);
  const requirements = JSON.parse(readFileSync(join(root, 'evals/prd-requirements.json'), 'utf8'));
  const categories = {};
  for (const result of results) {
    const category = categories[result.category] ??= { passed: 0, failed: 0, total: 0 };
    category.total += 1; category[result.status === 'PASS' ? 'passed' : 'failed'] += 1;
  }
  const passed = results.filter(r => r.status === 'PASS').length;
  const report = {
    schemaVersion: 1, title: 'Return Intelligence Voice deterministic domain evaluations',
    startedAt, completedAt: new Date().toISOString(), mode: 'deterministic_domain',
    idempotencyScope: 'Each new demo session intentionally creates a fresh synthetic copy of the seed order. Duplicate/conflicting actions are blocked within that simulation run. Direct legacy tools use a global order-line scope. This is not proof of production global order idempotency.',
    fixtureNotice: 'Customers, orders, policy and inventory are synthetic. Catalog cases distinguish legacy synthetic fixtures from dated official public product attributes. Each executable case uses an isolated temporary ledger, deleted afterward. The measured pass rate is for these assertions only.',
    scope: { actualDomainCode: true, actualModelCalls: 0, actualAudioSessions: 0, providerIntegrationTested: false,
      realCommerceTransactions: 0, productionDatabaseTested: false, browserUiTested: false },
    summary: { total: results.length, passed, failed: results.length - passed, passRate: passed / results.length, categories },
    sourceIntegrity: { stableDuringRun: changedDuringRun.length === 0, changedDuringRun, aggregateSha256: createHash('sha256').update(JSON.stringify(after)).digest('hex'), sha256: after },
    results,
    requirementsMatrix: requirements.cases.map(c => ({ evalId: c.eval_id, category: c.category,
      evaluationStatus: 'NOT_RUN_AS_WRITTEN', relatedDeterministicChecks: results.filter(r => r.requirements.includes(c.eval_id)).map(r => ({ id: r.id, status: r.status })),
      note: c.eval_id.startsWith('VOICE_') ? 'Native audio, interruption, transcription and critical-field recognition require a real voice run.' : 'Related checks use the app fixtures and documented assertions; they do not imply execution of this original matrix scenario or every expectation.' })),
    notTested: [
      'Native AssemblyAI session, speech recognition, spoken latency, generated responses and audio barge-in',
      'End-to-end model hallucination, tool selection or instruction-following accuracy',
      'Foreign-market policy routing, gift-history exclusion and merchant-configurable policy variants',
      'Live catalog, live inventory, Supabase or real commerce integrations',
      'Cohort success, second-return performance and business uplift',
      'Remote session persistence, concurrent database writes, and distributed idempotency; local serialization/hydration is tested',
    ],
  };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${passed}/${results.length} deterministic scenarios passed. ${results.length - passed} failed. Model calls: 0. Audio sessions: 0.`);
  console.log(`Report: ${output}`);
  if (changedDuringRun.length) console.error(`Source changed during execution: ${changedDuringRun.join(', ')}. Rerun before claiming a stable result.`);
  process.exitCode = results.some(r => r.status !== 'PASS') || changedDuringRun.length ? 1 : 0;
}
