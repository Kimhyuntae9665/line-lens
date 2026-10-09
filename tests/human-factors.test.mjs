import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, runSimulation, runComparison } from '../simulation.js';
import { DEMO_GOAL, clearAdvisorCache, evaluateRecommendations, validateGoal } from '../advisor-engine.js';
import { createAdvisorService } from '../advisor-service.js';

const goal = overrides => ({ ...DEMO_GOAL, confirmed: true, locks: { ...DEMO_GOAL.locks }, ...overrides });
const enabled = { humanEnabled: true };

test('legacy off mode preserves FLEX/CORE output even when disabled human inputs change', () => {
  for (const model of ['FLEX', 'CORE']) {
    const base = runSimulation({ model });
    const changed = runSimulation({ model, humanEnabled: false, manualWorkers: 1, pacePercent: 120, breakEveryMinutes: 60, breakMinutes: 10 });
    assert.deepEqual(changed.frames, base.frames);
    assert.equal(changed.workers, 12);
    assert.equal(changed.final.human.enabled, false);
  }
  assert.equal(runSimulation().final.producedPairs, 1250);
  assert.equal(runSimulation().final.goodPairs, 1191);
});

test('human inputs reject invalid values, without coercion or clamping', () => {
  for (const config of [{ humanEnabled: 1 }, { manualWorkers: 0 }, { manualWorkers: 4 }, { manualWorkers: 2.1 }, { pacePercent: 89 }, { pacePercent: 121 }, { pacePercent: 100.5 }, { breakEveryMinutes: 75 }, { breakMinutes: 6 }, { breakMinutes: '5' }]) {
    assert.throws(() => runSimulation(config), RangeError);
  }
  for (const overrides of [{ maxFatigueScore: -1 }, { maxFatigueScore: 101 }, { maxWorkloadPct: 121 }, { maxWorkloadPct: NaN }, { allowHumanChanges: 1 }]) assert.throws(() => validateGoal(goal(overrides)), { code: 'INVALID_GOAL' });
  const { maxFatigueScore, maxWorkloadPct, allowHumanChanges, ...legacyGoal } = goal();
  assert.equal(validateGoal(legacyGoal).maxFatigueScore, 40);
  assert.equal(validateGoal(legacyGoal).maxWorkloadPct, 90);
});

test('scheduled rest pauses manual service, recovers fatigue, and leaves machines running', () => {
  const run = runSimulation(enabled);
  for (const index of [1, 3, 5]) {
    const before = run.frames[90].stations[index];
    const resting = run.frames[91].stations[index];
    assert.equal(before.status, 'resting');
    assert.equal(resting.human.onBreak, true);
    assert.equal(resting.progress, before.progress);
    assert.equal(resting.human.activeMinutes, before.human.activeMinutes);
    assert.equal(resting.human.breakMinutes, 1);
    assert.ok(resting.human.fatigueScore < before.human.fatigueScore);
    assert.equal(run.frames[95].stations[index].human.onBreak, false);
    assert.equal(run.final.stations[index].human.breakMinutes, 25);
  }
  assert.notEqual(run.frames[91].stations[2].status, 'resting');
  assert.equal(run.final.stations[2].human.breakMinutes, 0);
});

test('staffing, pace and rest alter actual throughput and fatigue with dynamic person-hour denominator', () => {
  const base = runSimulation(enabled);
  const more = runSimulation({ ...enabled, manualWorkers: 3 });
  const slower = runSimulation({ ...enabled, pacePercent: 90 });
  const rested = runSimulation({ ...enabled, breakMinutes: 10 });
  const stress = runSimulation({ ...enabled, manualWorkers: 1, pacePercent: 120, breakMinutes: 0 });
  assert.ok(more.final.goodPairs > base.final.goodPairs);
  assert.ok(more.final.human.maxFatigueScore < base.final.human.maxFatigueScore);
  assert.ok(more.final.stations[1].cycleMinutes < base.final.stations[1].cycleMinutes);
  assert.equal(more.workers, 15);
  assert.equal(more.final.goodPairsPerPersonHour, more.final.goodPairs / (15 * 8));
  assert.ok(more.final.goodPairsPerPersonHour < base.final.goodPairsPerPersonHour);
  assert.ok(slower.final.goodPairs < base.final.goodPairs);
  assert.ok(slower.final.human.maxFatigueScore < base.final.human.maxFatigueScore);
  assert.ok(rested.final.goodPairs < base.final.goodPairs);
  assert.ok(rested.final.human.maxFatigueScore < base.final.human.maxFatigueScore);
  assert.equal(stress.workers, 9);
  assert.ok(stress.final.goodPairs < base.final.goodPairs);
  assert.ok(stress.final.human.maxFatigueScore > base.final.human.maxFatigueScore);
  assert.ok(stress.final.human.maxWorkloadPct > 100);
});

test('human frames conserve FIFO material and bounded fatigue, are immutable, and reproduce compact metrics', () => {
  for (const model of ['FLEX', 'CORE']) {
    const config = { ...enabled, model, manualWorkers: 1, pacePercent: 120, breakEveryMinutes: 60, breakMinutes: 5 };
    const run = runSimulation(config);
    assert.deepEqual(run, runSimulation(config));
    for (const frame of run.frames) {
      assert.equal(frame.releasedPairs, frame.producedPairs + frame.tokens.length * 10);
      assert.equal(frame.goodPairs + frame.rejectedPairs, frame.producedPairs);
      assert.ok(frame.human.congestionPct >= 0 && frame.human.congestionPct <= 100);
      assert.ok(Number.isFinite(frame.human.fatigueExposureMinutes));
      assert.ok(frame.human.maxFatigueScore >= 0 && frame.human.maxFatigueScore <= 100);
      for (const station of frame.stations) {
        assert.ok(station.progress >= 0 && station.progress <= 1);
        assert.ok(station.queue.length <= station.queueCapacity);
        assert.equal(station.human, frame.human.stations.find(item => item.id === station.id));
        assert.ok(station.human.fatigueScore >= 0 && station.human.fatigueScore <= 100);
        assert.ok(Number.isFinite(station.human.workloadPct));
        assert.ok(station.human.workloadPct >= 0 && station.human.workloadPct <= 120 + 1e-9);
      }
    }
    assert.ok(Object.isFrozen(run.final.human.stations[1]));
    assert.throws(() => { run.final.human.stations[1].fatigueScore = 999; }, TypeError);
    const compact = runSimulation(config, { compact: true });
    assert.deepEqual(compact.final.human, run.final.human);
    assert.deepEqual(compact.frames.map(frame => frame.goodPairs), run.frames.map(frame => frame.goodPairs));
  }
});

test('comparison resets both production and human controls for a true default reference', () => {
  const comparison = runComparison({ ...enabled, manualWorkers: 3, pacePercent: 110, breakEveryMinutes: 60, breakMinutes: 10, materialReduction: 60, balanceReduction: 20 });
  assert.deepEqual(comparison.baseline.config, { ...DEFAULT_CONFIG, humanEnabled: true });
  assert.equal(comparison.baseline.workers, 12);
  assert.equal(comparison.improved.workers, 15);
  assert.notEqual(comparison.delta.goodPairs, 0);
});

test('advisor evaluates distinct bounded human profiles, enforces separate filters and invalidates cache', () => {
  clearAdvisorCache();
  const standard = evaluateRecommendations({ goal: goal(), currentConfig: enabled });
  assert.equal(standard.evaluated, 504);
  assert.equal(standard.humanProfilesEvaluated, 4);
  assert.equal(standard.cacheHit, false);
  assert.equal(evaluateRecommendations({ goal: goal(), currentConfig: enabled }).cacheHit, true);
  assert.ok(standard.safetyFiltered > 0);
  assert.ok(standard.candidates.every(candidate => candidate.maxFatigueScore <= 40 && candidate.maxWorkloadPct <= 90));
  assert.ok(standard.candidates.some(candidate => candidate.category === 'low-load'));
  assert.ok(standard.candidates.every(candidate => candidate.id.includes('-H') && candidate.changedFactors.length <= 3));
  const locked = evaluateRecommendations({ goal: goal({ allowHumanChanges: false }), currentConfig: enabled });
  assert.equal(locked.evaluated, 126);
  assert.equal(locked.humanProfilesEvaluated, 1);
  assert.ok(locked.candidates.every(candidate => candidate.humanChangedFactors.length === 0));
  const changed = evaluateRecommendations({ goal: goal(), currentConfig: { ...enabled, manualWorkers: 3, pacePercent: 90, breakEveryMinutes: 60, breakMinutes: 10 } });
  assert.equal(changed.evaluated, 126);
  assert.equal(changed.cacheHit, false);
  assert.equal(changed.humanProfilesEvaluated, 1);
  const failed = evaluateRecommendations({ goal: goal({ minQualityPct: 100, maxFatigueScore: 0 }), currentConfig: enabled });
  assert.equal(failed.eligible, 0);
  assert.equal(failed.qualityFiltered, 504);
  assert.ok(failed.safetyFiltered > 0);
  assert.deepEqual(failed.candidates, []);
  const zeroWorkload = evaluateRecommendations({ goal: goal({ maxWorkloadPct: 0 }), currentConfig: enabled });
  assert.equal(zeroWorkload.safetyFiltered, 504);
  assert.equal(zeroWorkload.eligible, 0);
  assert.deepEqual(zeroWorkload.candidates, []);
});

test('production change count remains independent of human changes and off mode ignores burden limits', () => {
  const humanOnly = evaluateRecommendations({ goal: goal({ objective: 'maximize_good', targetGoodPairs: null, minQualityPct: 0, maxChangedFactors: 0 }), currentConfig: enabled });
  assert.ok(humanOnly.candidates.every(candidate => candidate.changedFactors.length === 0));
  assert.ok(humanOnly.candidates.some(candidate => candidate.humanChangedFactors.length > 0));
  const off = evaluateRecommendations({ goal: goal({ maxFatigueScore: 0, maxWorkloadPct: 0 }), currentConfig: {} });
  assert.equal(off.evaluated, 126);
  assert.equal(off.safetyFiltered, 0);
  assert.ok(off.eligible > 0);
});

function mockedService(result) {
  const service = createAdvisorService({ fetchImpl: async url => ({ ok: true, json: async () => url.endsWith('/models') ? { data: [{ id: 'test-model' }] } : { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] } }) });
  return service;
}
const extracted = { objective: 'reach_target', targetGoodPairs: 1000, minQualityPct: null, maxChangedFactors: null, maxFatigueScore: 30, maxWorkloadPct: 85, allowHumanChanges: null, locks: { materialReduction: null, balanceReduction: null, qualityGuard: null }, interpretation: '양품 목표와 가정 피로·부하 상한을 확인해 주세요.', questions: [] };
test('human thresholds distinguish literal requests, invented values and explicit defaults', async () => {
  const literal = await mockedService(extracted).interpret({ text: '양품 1000켤레, 가정 피로 30 이하, 작업부하 85 이하로 비교해 줘.', currentConfig: enabled });
  assert.equal(literal.requestedGoal.maxFatigueScore, 30);
  assert.equal(literal.goal.maxWorkloadPct, 85);
  assert.equal(literal.goal.confirmed, false);
  const invented = await mockedService(extracted).interpret({ text: '양품 1000켤레를 작업자 부담을 줄여 만들고 싶어.', currentConfig: enabled });
  assert.equal(invented.requestedGoal.maxFatigueScore, null);
  assert.equal(invented.goal.maxFatigueScore, 40);
  assert.equal(invented.goal.maxWorkloadPct, 90);
  assert.ok(invented.defaultsApplied.some(item => item.field === 'maxWorkloadPct'));
  assert.equal(invented.groundingWarnings.length, 2);
});

test('human candidate explanations require one grounded reason for every engine candidate', async () => {
  const calculation = evaluateRecommendations({ goal: goal(), currentConfig: enabled });
  const explanation = { recommendedId: calculation.candidates[0].id, reasons: calculation.candidates.map(candidate => ({ candidateId: candidate.id, text: candidate.changedFactors.length + candidate.humanChangedFactors.length ? '확인된 제약을 만족하며 현재 설정에서 요인을 변경하는 후보입니다.' : '현재 설정을 유지하면서 확인된 목표와 제약을 만족하는 후보입니다.' })), questions: [] };
  const accepted = await mockedService(explanation).recommend({ goal: goal(), currentConfig: enabled });
  assert.deepEqual(accepted.explanation, explanation);
  await assert.rejects(mockedService({ ...explanation, reasons: explanation.reasons.slice(1) }).recommend({ goal: goal(), currentConfig: enabled }), { code: 'LLM_INVALID_CANDIDATE' });
  await assert.rejects(mockedService({ ...explanation, reasons: explanation.reasons.map(reason => ({ ...reason, text: '실제 사고확률이 줄어듭니다.' })) }).recommend({ goal: goal(), currentConfig: enabled }), { code: 'LLM_INVALID_CANDIDATE' });
});
