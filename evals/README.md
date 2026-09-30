# Run deterministic domain evaluations

1. Run the full suite from the project root with Node 24:

   ```sh
   node scripts/evaluate-scenarios.mjs
   ```

2. Read the result in `data/evaluation-results.json` or open the app's Evaluation lab.
3. If a case fails, use its ID to rerun it:

   ```sh
   node scripts/evaluate-scenarios.mjs --filter D03
   ```

   Filtered runs write to `evals/results/D03.json`. They do not replace the full report.

4. To select a category or output path, use:

   ```sh
   node scripts/evaluate-scenarios.mjs --filter persistence --output /tmp/return-voice-persistence.json
   ```

5. After changing domain code, rerun the full suite before sharing its pass count.

The command exits with code 1 if an assertion fails, a subprocess fails, or source files change during the run. A successful run exits with code 0.

See [the evaluation contract](evaluation-contract.md) for what the report proves and what remains untested.
