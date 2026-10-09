import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAdvisorCache, DEMO_GOAL, evaluateRecommendations } from '../advisor-engine.js';
import { createAdvisorService } from '../advisor-service.js';

const currentConfig = { seed: 20261007, model: 'FLEX', materialReduction: 0, balanceReduction: 0, qualityGuard: false };
const goal = (overrides = {}) => ({ ...DEMO_GOAL, confirmed: true, locks: { ...DEMO_GOAL.locks }, ...overrides });
let reference;
test('compares all 126 combinations, returns distinct IDs and measured cache state', () => {
  clearAdvisorCache();
  reference = evaluateRecommendations({ goal: goal(), currentConfig });
  assert.equal(reference.evaluated, 126);
  assert.equal(reference.cacheHit, false);
  assert.ok(reference.computationMs > 0);
  assert.ok(reference.candidates.length >= 2 && reference.candidates.length <= 3);
  assert.equal(new Set(reference.candidates.map(item => item.id)).size, reference.candidates.length);
  assert.ok(reference.candidates.every(item => item.qualityPct >= 95 && item.minutesToTarget !== null));
  const small = reference.candidates.find(item => item.category === 'small-change');
  assert.ok(small && small.minutesToTarget < reference.baseline.minutesToTarget);
  assert.ok(small.changedFactors.length > 0);
  const repeated = evaluateRecommendations({ goal: goal(), currentConfig });
  assert.equal(repeated.cacheHit, true);
  assert.ok(repeated.computationMs > 0);
  assert.deepEqual(repeated.candidates, reference.candidates);
});
test('locks and zero changed factors permit only the unchanged baseline', () => {
  const result = evaluateRecommendations({ goal: goal({ objective: 'maximize_good', targetGoodPairs: null, minQualityPct: 0, maxChangedFactors: 0 }), currentConfig });
  assert.equal(result.eligible, 1);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].changedFactors, []);
  assert.equal(result.candidates[0].delta.good, 0);
  const locked = evaluateRecommendations({ goal: goal({ locks: { materialReduction: true, balanceReduction: false, qualityGuard: true }, maxChangedFactors: 1 }), currentConfig });
  assert.ok(locked.candidates.every(candidate => candidate.config.materialReduction === 0 && candidate.config.qualityGuard === false && candidate.changedFactors.length <= 1));
});
test('objective ties choose the smallest change magnitude', () => {
  const result = evaluateRecommendations({ goal: goal({ targetGoodPairs: 1, minQualityPct: 0 }), currentConfig });
  // The first batch finishes before any material outage: material increases have no earlier-target advantage.
  assert.equal(result.candidates[0].config.materialReduction, 0);
  assert.equal(result.candidates[0].config.qualityGuard, false);
  assert.deepEqual(result.candidates[0].changedFactors, ['balanceReduction']);
});
test('quality and unreachable goals produce transparent no-feasible results', () => {
  const strict = evaluateRecommendations({ goal: goal({ minQualityPct: 100 }), currentConfig });
  assert.equal(strict.evaluated, 126);
  assert.equal(strict.qualityFiltered, 126);
  assert.equal(strict.eligible, 0);
  assert.deepEqual(strict.candidates, []);
  const unreachable = evaluateRecommendations({ goal: goal({ targetGoodPairs: 100000 }), currentConfig });
  assert.equal(unreachable.eligible, 0);
  assert.equal(unreachable.baseline.minutesToTarget, null);
});
test('CORE recomputes its own grid and baseline respects current values', () => {
  const result = evaluateRecommendations({ goal: goal({ objective: 'maximize_good', targetGoodPairs: null }), currentConfig: { ...currentConfig, model: 'CORE', materialReduction: 20, balanceReduction: 5 } });
  assert.equal(result.evaluated, 126);
  assert.equal(result.cacheHit, false);
  assert.equal(result.baseline.config.model, 'CORE');
  assert.equal(result.baseline.config.materialReduction, 20);
  assert.ok(result.candidates.every(candidate => candidate.config.model === 'CORE' && candidate.minutesToTarget === null));
});
test('confirmation, supported objectives and numeric constraints are mandatory', () => {
  assert.throws(() => evaluateRecommendations({ goal: goal({ confirmed: false }), currentConfig }), { code: 'CONFIRMATION_REQUIRED' });
  assert.throws(() => evaluateRecommendations({ goal: goal({ objective: 'lower_cost' }), currentConfig }), { code: 'UNSUPPORTED_GOAL' });
  assert.throws(() => evaluateRecommendations({ goal: goal({ minQualityPct: 101 }), currentConfig }), { code: 'INVALID_GOAL' });
  assert.throws(() => evaluateRecommendations({ goal: goal(), currentConfig: { ...currentConfig, model: 'UNKNOWN' } }), { code: 'INVALID_CONFIG' });
});

function mockedService(result) {
  const calls = [];
  const service = createAdvisorService({ fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/models') ? { data: [{ id: 'actual-test-model' }] } : { model: 'actual-test-model', choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }] } };
  } });
  return { service, calls };
}
const vagueResult = { objective: 'clarify', targetGoodPairs: null, minQualityPct: null, maxChangedFactors: null, locks: { materialReduction: null, balanceReduction: null, qualityGuard: null }, interpretation: '더 빠른 생산을 원하지만 목표 양품량이 지정되지 않았습니다.', questions: ['목표 양품량과 품질 기준을 확인해 주세요.'] };
test('vague interpretation preserves requested nulls separately from demo assumptions', async () => {
  const { service, calls } = mockedService(vagueResult);
  const result = await service.interpret({ text: '더 빨리 만들고 싶어', currentConfig });
  assert.equal(result.requestedGoal.targetGoodPairs, null);
  assert.equal(result.goal.targetGoodPairs, 1000);
  assert.equal(result.goal.confirmed, false);
  assert.equal(result.requiresConfirmation, true);
  assert.ok(result.defaultsApplied.some(item => item.field === 'minQualityPct'));
  assert.equal(result.llmModel, 'actual-test-model');
  assert.ok(result.llmInterpretMs >= 0);
  const request = JSON.parse(calls[1].options.body);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.temperature, 0);
  assert.equal(request.max_tokens, 300);
});
test('unsupported goals do not become production recommendations', async () => {
  const { service } = mockedService({ ...vagueResult, objective: 'unsupported', interpretation: '비용 자료가 없어 비용 목표를 계산할 수 없습니다.' });
  const result = await service.interpret({ text: '인건비 최소화', currentConfig });
  assert.equal(result.unsupported, true);
  assert.equal(result.goal, null);
});
test('invented extraction numbers and implicit quality locks are not explicit user requests', async () => {
  const { service } = mockedService({ ...vagueResult, objective: 'reach_target', targetGoodPairs: 1000, minQualityPct: 95, maxChangedFactors: 3, locks: { materialReduction: null, balanceReduction: null, qualityGuard: true } });
  const result = await service.interpret({ text: '양품 1000켤레를 빨리 만들고 양품률 95% 이상 유지해 줘.', currentConfig });
  assert.equal(result.requestedGoal.targetGoodPairs, 1000);
  assert.equal(result.requestedGoal.maxChangedFactors, null);
  assert.equal(result.requestedGoal.locks.qualityGuard, null);
  assert.equal(result.goal.locks.qualityGuard, false);
  assert.ok(result.defaultsApplied.some(item => item.field === 'maxChangedFactors'));
  assert.equal(result.groundingWarnings.length, 2);
});
test('LLM explanation IDs must come from authoritative candidates', async () => {
  const good = reference.candidates[0].id;
  const { service } = mockedService({ recommendedId: good, reasons: reference.candidates.map(candidate => ({ candidateId: candidate.id, text: '확인된 제약을 만족하며 현재 설정에서 요인을 변경하는 후보입니다.' })), questions: [] });
  const result = await service.recommend({ goal: goal(), currentConfig });
  assert.equal(result.explanation.recommendedId, good);
  assert.equal(result.llmStatus, 'ready');
  assert.equal(result.llmRole, 'constrained-candidate-and-reason-selection');
  const bad = mockedService({ recommendedId: 'invented-id', reasons: [{ candidateId: good, text: '선택하세요.' }], questions: [] }).service;
  await assert.rejects(bad.recommend({ goal: goal(), currentConfig }), { code: 'LLM_INVALID_CANDIDATE' });
  const badNumber = mockedService({ recommendedId: good, reasons: [{ candidateId: good, text: '비용이 90% 감소합니다.' }], questions: [] }).service;
  await assert.rejects(badNumber.recommend({ goal: goal(), currentConfig }), { code: 'LLM_INVALID_CANDIDATE' });
});
test('malformed LLM reason entries preserve the structured model error contract', async () => {
  for (const entry of [null, [], 'invalid reason', 7]) {
    const { service } = mockedService({ recommendedId: reference.candidates[0].id, reasons: reference.candidates.map(() => entry), questions: [] });
    await assert.rejects(service.recommend({ goal: goal(), currentConfig }), error => {
      assert.equal(error.code, 'LLM_INVALID_CANDIDATE');
      assert.equal(error.status, 502);
      assert.equal(error.llmStatus, 'error');
      assert.equal(error.llmModel, 'actual-test-model');
      assert.ok(error.llmExplainMs >= 0);
      return true;
    });
  }
});

test('unavailable LLM remains explicit and no-feasible result makes no LLM call', async () => {
  let calls = 0;
  const service = createAdvisorService({ fetchImpl: async () => { calls++; throw new Error('connection refused'); } });
  const status = await service.status();
  assert.equal(status.reachable, false);
  assert.equal(status.llmStatus, 'unavailable');
  await assert.rejects(service.interpret({ text: '빨리 만들고 싶어', currentConfig }), { code: 'LLM_UNAVAILABLE' });
  await assert.rejects(service.recommend({ goal: goal(), currentConfig }), { code: 'LLM_UNAVAILABLE' });
  const before = calls;
  const result = await service.recommend({ goal: goal({ minQualityPct: 100 }), currentConfig });
  assert.equal(calls, before);
  assert.equal(result.llmStatus, 'not_needed');
  assert.equal(result.explanation, null);
});
