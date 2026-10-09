import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../simulation.js';
import { DEMO_GOAL, clearAdvisorCache, evaluateRecommendations } from '../advisor-engine.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  throw new Error('Usage: npm run benchmark:advisor -- [--out path/to/report.json]');
}

const input = {
  currentConfig: { ...DEFAULT_CONFIG, humanEnabled: true },
  goal: { ...DEMO_GOAL, locks: { ...DEMO_GOAL.locks }, confirmed: true },
};
clearAdvisorCache();
const fresh = evaluateRecommendations(input);
const cached = evaluateRecommendations(input);
const report = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  runtime: process.version,
  dataStatus: 'SYNTHETIC_SIMULATION',
  llmCalled: false,
  scope: 'Deterministic calculation benchmark only; not a live LLM or safety validation.',
  input,
  fresh,
  cached: { evaluated: cached.evaluated, eligible: cached.eligible, computationMs: cached.computationMs, cacheHit: cached.cacheHit },
};
if (args.length) await writeFile(resolve(args[1]), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
