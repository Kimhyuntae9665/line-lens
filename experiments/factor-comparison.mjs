// The portfolio's five comparisons. Fictional assumptions, not measured improvements.
import { runSimulation, DEFAULT_CONFIG } from '../simulation.js';
import { writeFile } from 'node:fs/promises';

const cases = [
  ['기준', {}],
  ['자재 대기만', { materialReduction: 60 }],
  ['성형 주기만', { balanceReduction: 20 }],
  ['검사 강화만', { qualityGuard: true }],
  ['세 가정 함께', { materialReduction: 60, balanceReduction: 20, qualityGuard: true }],
];
const results = cases.map(([label, changes]) => {
  const config = { ...DEFAULT_CONFIG, ...changes };
  return { label, config, final: runSimulation(config).final };
});
await writeFile(new URL('./factor-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
console.table(results.map(({ label, final }) => ({
  label, produced: final.producedPairs, good: final.goodPairs,
  attainment: final.attainmentPct.toFixed(2), endingWip: final.wipPairs,
})));
