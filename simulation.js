// Illustrative, fictional production model. No company measurements or CSV inputs.
const BATCH_PAIRS = 10;
const SHIFT_MINUTES = 480;
const PLANNED_PAIRS = 1440;
const WORKERS = 12;
const QUEUE_CAPACITY = 3;
// Fictional work fractions; these are not measured ergonomic coefficients.
const MANUAL_FRACTIONS = [0, 0.8, 0, 0.6, 0, 0.7];

export const STATIONS = Object.freeze([
  { id: 'kit', name: '자재공급', cycleMinutes: 2.7 },
  { id: 'upper', name: '갑피준비', cycleMinutes: 2.9 },
  { id: 'lasting', name: '성형', cycleMinutes: 3.7 },
  { id: 'bonding', name: '접착', cycleMinutes: 3.05 },
  { id: 'press', name: '압착', cycleMinutes: 3.1 },
  { id: 'inspect', name: '검사·포장', cycleMinutes: 2.5 },
].map(station => Object.freeze({ ...station, queueCapacity: QUEUE_CAPACITY, batchPairs: BATCH_PAIRS })));

export const DEFAULT_CONFIG = Object.freeze({
  seed: 20261007, model: 'FLEX', materialReduction: 0, balanceReduction: 0, qualityGuard: false,
  humanEnabled: false, manualWorkers: 2, pacePercent: 100, breakEveryMinutes: 90, breakMinutes: 5,
});

export const explainAssumptions = Object.freeze([
  '가상 교육용 모델이며 창신의 실측 데이터, 운영 성과 또는 디지털 트윈이 아닙니다.',
  '10켤레 묶음이 6개 공정을 순서대로 통과합니다. 각 공정의 대기 버퍼는 3묶음이며 작업 중 1묶음은 별도입니다.',
  'FLEX와 CORE는 임의로 설정한 제품군입니다. 공정 시간은 실측값이 아니며 CSV에서 가져오지 않습니다.',
  '480분, 계획 1,440켤레입니다. 사람 모델을 끄면 작업자 12명·기존 계산을 유지하고, 켜면 고정 6명과 수작업 3공정별 배치 인원으로 계산합니다.',
  '갑피준비·접착·검사의 수작업 비중은 가정값 80%·60%·70%입니다. 배치 인원·속도·휴식·피로가 실제 처리 시간을 바꾸며 피로 점수와 부하는 사고확률이나 안전 판정이 아닙니다.',
  '재공품 적체는 여섯 대기 버퍼의 시간 평균 점유율입니다. 보행자 동선이나 충돌을 모델링하지 않습니다.',
  '자재 중단은 주기적인 시드 기반 일정입니다. 자재 개선은 같은 일정의 중단 길이를 줄입니다. 압착 설비 중단은 동일하게 유지합니다.',
  '균형 개선은 성형 시간을 줄입니다. 이후 다른 공정이 병목이 되면 추가 개선 효과는 제한됩니다.',
  '품질 보호는 같은 묶음·켤레별 난수에 대해 불량 기준을 절반으로 줄이며 검사 시간은 12% 늘립니다. 불량은 검사에서 확정하며 재작업은 없습니다.',
  '1초 간격으로 작업·중단을 계산합니다. 완성된 묶음은 다음 버퍼가 찰 경우 현재 공정을 점유하며, 버퍼를 건너뛰거나 유실되지 않습니다.',
  '정지·막힘·대기 시간은 공정별 누적 시간입니다. 여러 공정의 시간이 겹칠 수 있으므로 합계를 교대 경과 시간으로 해석하지 않습니다.',
]);

function normalizedConfig(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('config must be an object');
  const allowed = Object.keys(DEFAULT_CONFIG);
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new RangeError('Unknown simulation option');
  const config = { ...DEFAULT_CONFIG, ...input };
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new RangeError('seed must be an unsigned 32-bit integer');
  if (!['FLEX', 'CORE'].includes(config.model)) throw new RangeError('model must be FLEX or CORE');
  for (const [key, maximum] of [['materialReduction', 80], ['balanceReduction', 30]]) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > maximum) throw new RangeError(`${key} must be between 0 and ${maximum}`);
  }
  if (typeof config.qualityGuard !== 'boolean') throw new RangeError('qualityGuard must be boolean');
  if (typeof config.humanEnabled !== 'boolean') throw new RangeError('humanEnabled must be boolean');
  if (!Number.isInteger(config.manualWorkers) || config.manualWorkers < 1 || config.manualWorkers > 3) throw new RangeError('manualWorkers must be an integer from 1 to 3');
  if (!Number.isInteger(config.pacePercent) || config.pacePercent < 90 || config.pacePercent > 120) throw new RangeError('pacePercent must be an integer from 90 to 120');
  if (![60, 90, 120].includes(config.breakEveryMinutes)) throw new RangeError('breakEveryMinutes must be 60, 90 or 120');
  if (![0, 5, 10].includes(config.breakMinutes)) throw new RangeError('breakMinutes must be 0, 5 or 10');
  return config;
}

// Counter-based draws do not depend on execution order, release time, or improvements.
function draw(seed, stream, index) {
  let x = (seed ^ Math.imul(stream, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

export function runSimulation(input = {}, { compact = false } = {}) {
  const config = normalizedConfig(input);
  const workers = config.humanEnabled ? 6 + 3 * config.manualWorkers : WORKERS;
  const cycles = config.model === 'FLEX' ? [2.7, 2.9, 3.7, 3.05, 3.1, 2.5] : [2.4, 2.8, 3.45, 3.15, 3.0, 2.6];
  cycles[2] *= 1 - config.balanceReduction / 100;
  if (config.qualityGuard) cycles[5] *= 1.12;
  const stations = STATIONS.map((definition, index) => ({
    ...definition, cycleSeconds: Math.round(cycles[index] * 60), queue: [], active: null,
    completedBatches: 0, stopSeconds: 0, blockedSeconds: 0, starvedSeconds: 0,
    manualFraction: MANUAL_FRACTIONS[index], fatigue: 0, peakFatigue: 0,
    activeSeconds: 0, breakSeconds: 0, fatigueExposureSeconds: 0,
  }));
  const materialWindows = Array.from({ length: 6 }, (_, index) => ({
    start: (60 + index * 70) * 60,
    duration: Math.round((10 * 60 + draw(config.seed, 1, index) * 6 * 60) * (1 - config.materialReduction / 100)),
  }));
  const pressWindows = [110, 240, 370].map((minute, index) => ({
    start: minute * 60, duration: Math.round(6 * 60 + draw(config.seed, 2, index) * 3 * 60),
  }));
  function isStopped(index, second) {
    const windows = index === 0 ? materialWindows : index === 4 ? pressWindows : [];
    return windows.some(window => second >= window.start && second < window.start + window.duration);
  }
  let releasedPairs = 0;
  let producedPairs = 0;
  let goodPairs = 0;
  let rejectedPairs = 0;
  let nextOrdinal = 0;
  const frames = [];
  let bufferOccupancySeconds = 0;
  function onBreak(station, second) {
    return config.humanEnabled && station.manualFraction > 0 && config.breakMinutes > 0
      && second >= config.breakEveryMinutes * 60 && second < SHIFT_MINUTES * 60
      && second % (config.breakEveryMinutes * 60) < config.breakMinutes * 60;
  }
  function updateHuman(station, busy, resting) {
    if (!config.humanEnabled) return;
    if (resting) station.breakSeconds++;
    if (busy) station.activeSeconds++;
    if (!station.manualFraction) return;
    const changePerMinute = resting ? -0.6 : busy
      ? 0.1 * station.manualFraction * (config.pacePercent / 100) ** 2 * (2 / config.manualWorkers) : -0.06;
    station.fatigue = Math.max(0, Math.min(100, station.fatigue + changePerMinute / 60));
    station.peakFatigue = Math.max(station.peakFatigue, station.fatigue);
    station.fatigueExposureSeconds += station.fatigue / 100;
  }
  function humanTimeFactor(station) {
    return config.humanEnabled && station.manualFraction
      ? (1 - station.manualFraction) + station.manualFraction * (2 / config.manualWorkers) * (100 / config.pacePercent) * (1 + 0.25 * station.fatigue / 100) : 1;
  }
  function humanSnapshot(minute) {
    const elapsed = minute * 60;
    const stationData = stations.map(station => ({
      id: station.id, name: station.name, manual: station.manualFraction > 0,
      assignedWorkers: config.humanEnabled && station.manualFraction > 0 ? config.manualWorkers : 2,
      fatigueScore: station.fatigue,
      workloadPct: config.humanEnabled && elapsed > station.breakSeconds
        ? station.activeSeconds / (elapsed - station.breakSeconds) * (station.manualFraction ? config.pacePercent : 100) : 0,
      onBreak: onBreak(station, elapsed), activeMinutes: station.activeSeconds / 60, breakMinutes: station.breakSeconds / 60,
    }));
    const manual = stationData.filter(station => station.manual);
    return { enabled: config.humanEnabled, workers,
      maxFatigueScore: Math.max(...stations.map(station => station.peakFatigue)),
      avgFatigueScore: manual.reduce((sum, station) => sum + station.fatigueScore, 0) / manual.length,
      maxWorkloadPct: Math.max(...manual.map(station => station.workloadPct)),
      congestionPct: elapsed ? bufferOccupancySeconds / (elapsed * stations.length * QUEUE_CAPACITY) * 100 : 0,
      fatigueExposureMinutes: stations.reduce((sum, station) => sum + station.fatigueExposureSeconds, 0) / 60,
      stations: stationData };
  }

  function status(index, second) {
    const station = stations[index];
    if (onBreak(station, second)) return 'resting';
    if (isStopped(index, second)) return 'stopped';
    if (station.active?.remainingSeconds === 0) return 'blocked';
    if (station.active || station.queue.length) return 'running';
    return 'starved';
  }
  function snapshot(minute) {
    const human = humanSnapshot(minute);
    // Advisor grids retain only metrics and minute output; full public runs remain immutable.
    if (compact) return { minute, producedPairs, goodPairs, qualityPct: producedPairs ? goodPairs / producedPairs * 100 : null, wipPairs: releasedPairs - producedPairs, human };
    const stationFrames = stations.map((station, index) => ({
      id: station.id, name: station.name, cycleMinutes: station.cycleSeconds / 60 * humanTimeFactor(station),
      queueCapacity: QUEUE_CAPACITY, status: status(index, minute * 60),
      progress: station.active ? 1 - station.active.remainingSeconds / station.cycleSeconds : 0,
      queue: station.queue.map(batch => batch.id), activeBatchId: station.active?.batch.id ?? null,
      completedBatches: station.completedBatches, stopMinutes: station.stopSeconds / 60,
      blockedMinutes: station.blockedSeconds / 60, starvedMinutes: station.starvedSeconds / 60,
      human: human.stations[index],
    }));
    const tokens = stations.flatMap((station, stationIndex) => [
      ...station.queue.map((batch, queueIndex) => ({ id: batch.id, stationIndex, kind: 'queue', queueIndex, progress: 0 })),
      ...(station.active ? [{ id: station.active.batch.id, stationIndex, kind: 'active', queueIndex: 0, progress: 1 - station.active.remainingSeconds / station.cycleSeconds }] : []),
    ]);
    const stopMinutes = stations.reduce((sum, station) => sum + station.stopSeconds, 0) / 60;
    return freezeTree({
      minute, producedPairs, goodPairs, rejectedPairs, releasedPairs, wipPairs: releasedPairs - producedPairs,
      planPairs: PLANNED_PAIRS * minute / SHIFT_MINUTES,
      attainmentPct: producedPairs / PLANNED_PAIRS * 100,
      qualityPct: producedPairs ? goodPairs / producedPairs * 100 : null,
      goodPairsPerPersonHour: minute ? goodPairs / (workers * minute / 60) : null,
      human,
      downtimeMinutes: stopMinutes, stations: stationFrames, tokens,
      reasonMinutes: [
        { reason: '자재 공급 중단', minutes: stations[0].stopSeconds / 60 },
        { reason: '압착 설비 정지', minutes: stations[4].stopSeconds / 60 },
        { reason: '후공정 막힘', minutes: stations.reduce((sum, station) => sum + station.blockedSeconds, 0) / 60 },
        { reason: '자재·전공정 대기', minutes: stations.reduce((sum, station) => sum + station.starvedSeconds, 0) / 60 },
      ],
    });
  }
  function finish(index) {
    const station = stations[index];
    if (index < stations.length - 1) {
      if (stations[index + 1].queue.length >= QUEUE_CAPACITY) return false;
      stations[index + 1].queue.push(station.active.batch);
    } else {
      const ordinal = station.active.batch.ordinal;
      const defectThreshold = (config.model === 'FLEX' ? 0.042 : 0.032) * (config.qualityGuard ? 0.5 : 1);
      let defects = 0;
      for (let pair = 0; pair < BATCH_PAIRS; pair++) {
        if (draw(config.seed, 3, ordinal * BATCH_PAIRS + pair) < defectThreshold) defects++;
      }
      producedPairs += BATCH_PAIRS;
      rejectedPairs += defects;
      goodPairs += BATCH_PAIRS - defects;
    }
    station.completedBatches++;
    station.active = null;
    return true;
  }

  frames.push(snapshot(0));
  for (let second = 0; second < SHIFT_MINUTES * 60; second++) {
    // External supply respects the first FIFO capacity and the plan release limit.
    while (stations[0].queue.length < QUEUE_CAPACITY && releasedPairs < PLANNED_PAIRS) {
      const ordinal = nextOrdinal++;
      stations[0].queue.push({ id: `B${String(ordinal + 1).padStart(3, '0')}`, ordinal });
      releasedPairs += BATCH_PAIRS;
    }
    // Downstream first: a transfer cannot be processed by two stations in one second.
    for (let index = stations.length - 1; index >= 0; index--) {
      const station = stations[index];
      if (onBreak(station, second)) { updateHuman(station, false, true); continue; }
      if (isStopped(index, second)) { station.stopSeconds++; updateHuman(station, false, false); continue; }
      if (station.active?.remainingSeconds === 0 && !finish(index)) { station.blockedSeconds++; updateHuman(station, false, false); continue; }
      if (!station.active && station.queue.length) {
        station.active = { batch: station.queue.shift(), remainingSeconds: station.cycleSeconds };
      }
      if (!station.active) { station.starvedSeconds++; updateHuman(station, false, false); continue; }
      station.active.remainingSeconds = Math.max(0, station.active.remainingSeconds - 1 / humanTimeFactor(station));
      updateHuman(station, true, false);
      if (station.active.remainingSeconds === 0) finish(index);
    }
    if (config.humanEnabled) bufferOccupancySeconds += stations.reduce((sum, station) => sum + station.queue.length, 0);
    if ((second + 1) % 60 === 0) frames.push(snapshot((second + 1) / 60));
  }
  if (compact) return { config, workers, frames, final: frames[SHIFT_MINUTES] };
  const hourly = Array.from({ length: 8 }, (_, index) => {
    const frame = frames[(index + 1) * 60];
    const previous = frames[index * 60];
    return freezeTree({ ...frame, hour: index + 1,
      hourProducedPairs: frame.producedPairs - previous.producedPairs,
      hourGoodPairs: frame.goodPairs - previous.goodPairs,
      hourRejectedPairs: frame.rejectedPairs - previous.rejectedPairs,
    });
  });
  return freezeTree({ config, durationMinutes: SHIFT_MINUTES, plannedPairs: PLANNED_PAIRS, workers,
    frames, hourly, final: frames[SHIFT_MINUTES] });
}

export function runComparison(input = {}) {
  const config = normalizedConfig(input);
  const baseline = runSimulation({ ...DEFAULT_CONFIG, seed: config.seed, model: config.model, humanEnabled: config.humanEnabled });
  const improved = runSimulation(config);
  return freezeTree({ baseline, improved, delta: {
    producedPairs: improved.final.producedPairs - baseline.final.producedPairs,
    goodPairs: improved.final.goodPairs - baseline.final.goodPairs,
    attainmentPoints: improved.final.attainmentPct - baseline.final.attainmentPct,
    wipPairs: improved.final.wipPairs - baseline.final.wipPairs,
  } });
}
