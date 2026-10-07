import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, STATIONS, explainAssumptions, runSimulation, runComparison } from '../simulation.js';

test('one shift has t0, 480 minute boundaries, eight exact hourly intervals', () => {
  const run = runSimulation();
  assert.equal(run.frames.length, 481);
  assert.equal(run.frames[0].minute, 0);
  assert.equal(run.frames[0].releasedPairs, 0);
  assert.equal(run.frames[0].qualityPct, null);
  assert.equal(run.frames[0].goodPairsPerPersonHour, null);
  assert.equal(run.frames[1].goodPairs, 0);
  assert.equal(run.frames[1].goodPairsPerPersonHour, 0);
  assert.equal(run.final, run.frames[480]);
  assert.equal(run.final.minute, 480);
  assert.equal(run.final.planPairs, 1440);
  assert.equal(run.workers, 12);
  assert.equal(run.hourly.length, 8);
  assert.equal(run.hourly.reduce((sum, hour) => sum + hour.hourProducedPairs, 0), run.final.producedPairs);
  assert.deepEqual(STATIONS.map(station => station.id), ['kit', 'upper', 'lasting', 'bonding', 'press', 'inspect']);
  assert.ok(explainAssumptions.some(line => line.includes('가상')));
});

test('every frame conserves pairs, FIFO tokens, capacity and quality across models and controls', () => {
  for (const model of ['FLEX', 'CORE']) {
    for (const controls of [{}, { materialReduction: 80, balanceReduction: 30, qualityGuard: true }, { materialReduction: 37.5, balanceReduction: 12.3 }]) {
      const run = runSimulation({ model, ...controls });
      let lastOutput = 0;
      for (const frame of run.frames) {
        assert.equal(frame.releasedPairs, frame.producedPairs + frame.wipPairs);
        assert.equal(frame.wipPairs, frame.tokens.length * 10);
        assert.equal(frame.goodPairs + frame.rejectedPairs, frame.producedPairs);
        assert.ok(frame.producedPairs >= lastOutput && frame.producedPairs <= 1440);
        assert.ok(frame.wipPairs >= 0 && frame.goodPairs >= 0 && frame.rejectedPairs >= 0);
        assert.equal(new Set(frame.tokens.map(token => token.id)).size, frame.tokens.length);
        for (let index = 0; index < frame.stations.length; index++) {
          const station = frame.stations[index];
          assert.ok(station.queue.length <= station.queueCapacity);
          assert.ok(station.progress >= 0 && station.progress <= 1);
          assert.ok(['running', 'starved', 'blocked', 'stopped'].includes(station.status));
          const ids = station.queue.map(id => Number(id.slice(1)));
          assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
          assert.equal(frame.tokens.filter(token => token.stationIndex === index).length, station.queue.length + (station.activeBatchId ? 1 : 0));
        }
        lastOutput = frame.producedPairs;
      }
    }
  }
});

test('same seed is deterministic, minute snapshots are deeply immutable and detached', () => {
  const first = runSimulation({ seed: 82, balanceReduction: 10 });
  assert.deepEqual(first, runSimulation({ seed: 82, balanceReduction: 10 }));
  assert.ok(Object.isFrozen(first.frames[25].stations[0].queue));
  assert.ok(Object.isFrozen(first.frames[25].tokens));
  assert.throws(() => { first.frames[25].stations[0].queue.push('fake'); }, TypeError);
  assert.notEqual(first.frames[25].stations, first.frames[26].stations);
  assert.notEqual(runSimulation({ seed: 83 }).final.rejectedPairs, runSimulation({ seed: 82 }).final.rejectedPairs);
});

test('zero controls reproduce baseline, stops are shared and quality guard compares identical pairs', () => {
  const zero = runComparison({ model: 'CORE', seed: 105 });
  assert.deepEqual(zero.baseline, zero.improved);
  assert.deepEqual(zero.delta, { producedPairs: 0, goodPairs: 0, attainmentPoints: 0, wipPairs: 0 });
  const guarded = runComparison({ qualityGuard: true });
  assert.equal(guarded.baseline.final.producedPairs, guarded.improved.final.producedPairs);
  assert.ok(guarded.improved.final.rejectedPairs <= guarded.baseline.final.rejectedPairs);
  assert.ok(guarded.improved.final.stations[5].cycleMinutes > guarded.baseline.final.stations[5].cycleMinutes);
  for (const frame of guarded.improved.frames) {
    assert.equal(frame.stations[4].stopMinutes, guarded.baseline.frames[frame.minute].stations[4].stopMinutes);
    assert.equal(frame.stations[0].stopMinutes, guarded.baseline.frames[frame.minute].stations[0].stopMinutes);
  }
  const material = runComparison({ materialReduction: 80 });
  assert.ok(material.improved.final.stations[0].stopMinutes < material.baseline.final.stations[0].stopMinutes);
  assert.equal(material.improved.final.stations[4].stopMinutes, material.baseline.final.stations[4].stopMinutes);
});

test('blocking and starvation emerge, and a non-bottleneck improvement need not increase output', () => {
  const base = runSimulation();
  assert.ok(base.frames.some(frame => frame.stations.some(station => station.status === 'blocked')));
  assert.ok(base.final.stations.some(station => station.blockedMinutes > 0));
  assert.ok(base.final.stations.some(station => station.starvedMinutes > 0));
  const reduced = runComparison({ materialReduction: 1 });
  assert.equal(reduced.delta.producedPairs, 0);
  const combined = runComparison({ materialReduction: 60, balanceReduction: 20, qualityGuard: true });
  assert.ok(combined.delta.producedPairs > 0);
  assert.ok(combined.improved.final.attainmentPct <= 100);
});

test('reject invalid configuration values without silently clamping', () => {
  for (const input of [null, [], 3, { seed: -1 }, { seed: 0.5 }, { seed: 2 ** 32 }, { model: 'OTHER' },
    { materialReduction: 81 }, { materialReduction: NaN }, { materialReduction: '20' },
    { balanceReduction: -1 }, { balanceReduction: 31 }, { qualityGuard: 1 }, { typo: true }]) {
    assert.throws(() => runSimulation(input), RangeError);
    assert.throws(() => runComparison(input), RangeError);
  }
  assert.deepEqual(runSimulation().config, DEFAULT_CONFIG);
});

test('boundary seeds and both models preserve conservation throughout the exact shift horizon', () => {
  for (const seed of [0, 1, 0xffffffff]) {
    for (const model of ['FLEX', 'CORE']) {
      const comparison = runComparison({ seed, model, materialReduction: 80, balanceReduction: 30, qualityGuard: true });
      for (const run of [comparison.baseline, comparison.improved]) {
        assert.equal(run.durationMinutes, 480);
        assert.equal(run.frames.length, 481);
        assert.equal(run.final.minute, run.durationMinutes);
        for (const frame of run.frames) {
          assert.equal(frame.releasedPairs, frame.producedPairs + frame.tokens.length * 10);
          assert.ok(frame.releasedPairs <= run.plannedPairs);
          assert.equal(frame.goodPairs + frame.rejectedPairs, frame.producedPairs);
          for (const station of frame.stations) {
            assert.ok(station.stopMinutes + station.blockedMinutes + station.starvedMinutes <= frame.minute + 1e-9);
          }
        }
      }
      assert.equal(comparison.baseline.final.stations[4].stopMinutes, comparison.improved.final.stations[4].stopMinutes);
    }
  }
});
