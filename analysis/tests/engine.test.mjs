import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, parseCSV, validateRows, toCSV, summarize, filterRows, pareto, simulate, evidencePacket, packetMarkdown, fingerprint } from '../engine.js';
import { sampleRows } from '../sample.js';
const base = { row_id: 'r1', date: '2026-09-14', line: 'LINE-A', model: 'FLEX', hour: 8, planned_pairs: 100, produced_pairs: 80, good_pairs: 72, workers: 10, available_minutes: 60, downtime_minutes: 20, downtime_reason: '자재 대기' };
const make = changes => ({ ...base, ...changes });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('sample has 240 valid observations, three lines, two models, 10 × 8 shifts', () => {
  const rows = validateRows(sampleRows());
  assert.equal(rows.length, 240); assert.equal(new Set(rows.map(r => r.line)).size, 3); assert.equal(new Set(rows.map(r => r.model)).size, 2);
  assert.equal(new Set(rows.map(r => r.date)).size, 10); assert.equal(new Set(rows.map(r => r.hour)).size, 8);
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});
test('ratios use weighted totals and attendance person-hours, not uptime', () => {
  const rows = [make({}), make({ row_id: 'r2', hour: 9, planned_pairs: 400, produced_pairs: 200, good_pairs: 190, workers: 20, downtime_minutes: 10 })];
  const result = summarize(rows);
  near(result.plan_attainment_pct, 280 / 500 * 100); near(result.quality_pct, 262 / 280 * 100);
  near(result.person_hours, 30); near(result.good_pairs_per_person_hour, 262 / 30); near(result.downtime_per_1000_pairs, 30 / 280 * 1000);
});
test('line and model filters actually intersect and preserve mixed model differences', () => {
  const rows = sampleRows(); const flex = filterRows(rows, { model: 'FLEX' }); const core = filterRows(rows, { model: 'CORE' });
  assert.equal(flex.length + core.length, 240); assert.ok(flex.every(r => r.model === 'FLEX'));
  const selected = filterRows(rows, { line: 'LINE-B', model: 'CORE' });
  assert.ok(selected.length > 0 && selected.length < 80); assert.ok(selected.every(r => r.model === 'CORE' && r.line === 'LINE-B'));
  assert.notEqual(summarize(flex).good_pairs_per_person_hour, summarize(core).good_pairs_per_person_hour);
});
test('CSV quoted comma, escaped quote and newline survive; malformed CSV is rejected', () => {
  const row = make({ downtime_reason: '자재, "부족"\n확인' });
  assert.deepEqual(parseCSV(toCSV([row])), [row]);
  assert.throws(() => parseCSV(toCSV([row]).replace('"자재', 'x"자재')), /인용/);
  assert.throws(() => parseCSV(FIELDS.join(',') + '\n"unterminated'), /닫히지/);
  assert.throws(() => parseCSV(toCSV([base]).replace('row_id,date', 'row_id,row_id')), /중복/);
});
test('blank numeric values never become zero; missing required fields reject atomic import', () => {
  assert.throws(() => parseCSV(toCSV([make({ produced_pairs: '' })])), /빈 필수값/);
  assert.throws(() => parseCSV(toCSV([base]) + ',,,,,,,,,,,\n'), /빈 필수값/);
  assert.throws(() => parseCSV(toCSV([base]).replace('row_id,', 'other_id,')), /필수 열 누락/);
  const old = sampleRows(); const oldFingerprint = fingerprint(old);
  assert.throws(() => parseCSV(toCSV([base, make({ row_id: 'r2', hour: 9, good_pairs: 999 })])), /good_pairs/);
  assert.equal(fingerprint(old), oldFingerprint);
});
test('invalid ranges, nonfinite, decimal, duplicate ID/key and malformed timestamps reject', () => {
  for (const change of [{ planned_pairs: -1 }, { produced_pairs: Infinity }, { workers: 1.5 }, { available_minutes: 61 }, { downtime_minutes: 61 }, { available_minutes: 60, downtime_minutes: 60 }, { hour: 24 }, { hour: '08:30' }, { date: '2026-02-30' }, { date: '2026-9-14' }, { good_pairs: 81 }, { downtime_minutes: 0 }]) {
    assert.throws(() => validateRows([make(change)]));
  }
  assert.throws(() => validateRows([base, make({ hour: 9 })]), /row_id 중복/);
  assert.throws(() => validateRows([base, make({ row_id: 'r2', model: 'CORE' })]), /観測|관측 키 중복/);
});
test('zero denominators report null rather than false zero or infinity', () => {
  const result = summarize([make({ planned_pairs: 0, produced_pairs: 0, good_pairs: 0, workers: 0, available_minutes: 0, downtime_minutes: 0, downtime_reason: '무정지' })]);
  assert.equal(result.plan_attainment_pct, null); assert.equal(result.quality_pct, null);
  assert.equal(result.good_pairs_per_person_hour, null); assert.equal(result.downtime_per_1000_pairs, null);
  assert.equal(summarize([]).quality_pct, null);
});
test('Pareto shows every contributing reason and cumulative ends at 100%', () => {
  const rows = sampleRows(); const groups = pareto(rows);
  assert.equal(groups.length, 4); assert.equal(groups.at(-1).cumulative_pct, 100);
  near(groups.reduce((sum, r) => sum + r.minutes, 0), summarize(rows).downtime_minutes);
  assert.ok(groups.every((r, i) => i === 0 || r.minutes <= groups[i - 1].minutes));
});
test('scenario is bounded, monotonic in recovered production, and preserves each row quality and staffing', () => {
  const rows = validateRows(sampleRows()); let previous = 0;
  for (const pct of [0, 10, 40, 80]) {
    const scenario = simulate(rows, '자재 대기', pct);
    assert.ok(scenario.added_pairs >= previous); previous = scenario.added_pairs;
    scenario.rows.forEach((projected, i) => {
      assert.ok(projected.produced_pairs >= rows[i].produced_pairs);
      assert.ok(projected.produced_pairs <= Math.max(rows[i].planned_pairs, rows[i].produced_pairs));
      near(projected.good_pairs / projected.produced_pairs, rows[i].good_pairs / rows[i].produced_pairs);
      assert.equal(projected.workers, rows[i].workers); assert.equal(projected.available_minutes, rows[i].available_minutes);
      if (rows[i].downtime_reason !== '자재 대기') assert.deepEqual(projected, rows[i]);
    });
  }
  assert.equal(simulate(rows, '없는 원인', 80).added_pairs, 0);
  assert.throws(() => simulate(rows, '자재 대기', 81), RangeError);
  const fullStop = make({ produced_pairs: 0, good_pairs: 0, downtime_minutes: 60 });
  assert.equal(simulate([fullStop], '자재 대기', 80).added_pairs, 0);
  assert.equal(simulate([fullStop], '자재 대기', 80).unestimated_rows, 1);
});
test('overshooting baseline and very high rate cannot create production beyond shortfall', () => {
  assert.equal(simulate([make({ planned_pairs: 50 })], '자재 대기', 80).added_pairs, 0);
  const fast = make({ produced_pairs: 99, good_pairs: 90, downtime_minutes: 59 });
  assert.equal(simulate([fast], '자재 대기', 80).added_pairs, 1);
});
test('evidence exports are reproducible and include filters, policy, definitions and review questions', () => {
  const rows = sampleRows(); const filters = { line: 'LINE-B', model: 'CORE' };
  const p1 = evidencePacket(rows, filters, '자재 대기', 40); const p2 = evidencePacket(rows, filters, '자재 대기', 40);
  assert.deepEqual(p1, p2); assert.deepEqual(p1.exact_filter, filters); assert.equal(p1.data_status, 'SYNTHETIC');
  assert.equal(p1.dataset_fingerprint, fingerprint([...rows].reverse())); assert.notEqual(p1.selected_fingerprint, p1.dataset_fingerprint);
  assert.ok(p1.invalid_data_policy.includes('파일 전체')); assert.ok(p1.definitions.scenario); assert.equal(p1.a3.validation_questions.length, 5);
  assert.match(packetMarkdown(p1), /SIMULATED/); assert.match(packetMarkdown(p1), /line=LINE-B, model=CORE/);
  assert.equal(evidencePacket(rows, filters, '자재 대기', 0, 'uploaded.csv').data_status, 'USER_IMPORTED_UNVERIFIED');
});
