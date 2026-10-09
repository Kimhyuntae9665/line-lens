import { DEFAULT_CONFIG, runSimulation } from './simulation.js';

// All production figures come from the existing fictional simulation, never the LLM.
const FACTORS = ['materialReduction', 'balanceReduction', 'qualityGuard'];
const HUMAN_FACTORS = ['manualWorkers', 'pacePercent', 'breakEveryMinutes', 'breakMinutes'];
const grids = new Map();
export const DEMO_GOAL = Object.freeze({ objective: 'reach_target', targetGoodPairs: 1000, minQualityPct: 95, maxChangedFactors: 3, maxFatigueScore: 40, maxWorkloadPct: 90, allowHumanChanges: true, locks: Object.freeze({ materialReduction: false, balanceReduction: false, qualityGuard: false }) });

export class AdvisorError extends Error {
  constructor(code, message, status = 400, metadata = {}) { super(message); this.name = 'AdvisorError'; this.code = code; this.status = status; Object.assign(this, metadata); }
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
export function validateGoal(goal, requireConfirmation = true) {
  if (!object(goal)) throw new AdvisorError('INVALID_GOAL', '확인할 목표를 입력해 주세요.');
  const keys = ['confirmed', 'objective', 'targetGoodPairs', 'minQualityPct', 'maxChangedFactors', 'locks', 'maxFatigueScore', 'maxWorkloadPct', 'allowHumanChanges'];
  if (Object.keys(goal).some(key => !keys.includes(key))) throw new AdvisorError('INVALID_GOAL', '지원하지 않는 목표 필드입니다.');
  if (requireConfirmation && goal.confirmed !== true) throw new AdvisorError('CONFIRMATION_REQUIRED', '해석된 목표와 제약을 확인한 뒤 추천을 실행해 주세요.');
  if (!['reach_target', 'maximize_good'].includes(goal.objective)) throw new AdvisorError('UNSUPPORTED_GOAL', '목표 양품량 도달 시간 또는 교대 양품량만 계산할 수 있습니다.');
  if (goal.objective === 'reach_target' && (!Number.isSafeInteger(goal.targetGoodPairs) || goal.targetGoodPairs < 1 || goal.targetGoodPairs > 100000)) throw new AdvisorError('INVALID_GOAL', '목표 양품량은 1~100000의 정수여야 합니다.');
  if (goal.objective === 'maximize_good' && goal.targetGoodPairs !== null) throw new AdvisorError('INVALID_GOAL', '교대 양품량 최대화는 목표 양품량을 null로 설정해 주세요.');
  if (!Number.isFinite(goal.minQualityPct) || goal.minQualityPct < 0 || goal.minQualityPct > 100) throw new AdvisorError('INVALID_GOAL', '최소 양품률은 0~100이어야 합니다.');
  if (!Number.isInteger(goal.maxChangedFactors) || goal.maxChangedFactors < 0 || goal.maxChangedFactors > 3) throw new AdvisorError('INVALID_GOAL', '변경할 요인 수는 0~3의 정수여야 합니다.');
  if (!object(goal.locks) || Object.keys(goal.locks).some(key => !FACTORS.includes(key)) || FACTORS.some(key => typeof goal.locks[key] !== 'boolean')) throw new AdvisorError('INVALID_GOAL', '각 요인의 고정 여부를 지정해 주세요.');
  const humanGoal = Object.fromEntries(['maxFatigueScore', 'maxWorkloadPct', 'allowHumanChanges'].map(key => [key, goal[key] === undefined ? DEMO_GOAL[key] : goal[key]]));
  if (!Number.isFinite(humanGoal.maxFatigueScore) || humanGoal.maxFatigueScore < 0 || humanGoal.maxFatigueScore > 100) throw new AdvisorError('INVALID_GOAL', '가정 피로 점수 상한은 0~100이어야 합니다.');
  if (!Number.isFinite(humanGoal.maxWorkloadPct) || humanGoal.maxWorkloadPct < 0 || humanGoal.maxWorkloadPct > 120) throw new AdvisorError('INVALID_GOAL', '작업부하 지표 상한은 0~120이어야 합니다.');
  if (typeof humanGoal.allowHumanChanges !== 'boolean') throw new AdvisorError('INVALID_GOAL', '인력·속도·휴식 변경 허용 여부를 지정해 주세요.');
  return { confirmed: goal.confirmed === true, objective: goal.objective, targetGoodPairs: goal.targetGoodPairs, minQualityPct: goal.minQualityPct, maxChangedFactors: goal.maxChangedFactors, locks: { ...goal.locks }, ...humanGoal };
}

function compactRun(config) {
  const simulation = runSimulation(config, { compact: true });
  return { config: simulation.config, total: simulation.final.producedPairs, good: simulation.final.goodPairs, qualityPct: simulation.final.qualityPct, wip: simulation.final.wipPairs, human: simulation.final.human, goodByMinute: simulation.frames.map(frame => frame.goodPairs) };
}
function humanProfiles(config, allowChanges) {
  const current = Object.fromEntries(HUMAN_FACTORS.map(key => [key, config[key]]));
  const profiles = [current];
  if (config.humanEnabled && allowChanges) profiles.push(
    { ...current, manualWorkers: Math.min(3, current.manualWorkers + 1) },
    { ...current, pacePercent: Math.max(90, current.pacePercent - 10) },
    { ...current, breakMinutes: Math.min(10, current.breakMinutes + 5), breakEveryMinutes: Math.min(90, current.breakEveryMinutes) });
  return [...new Map(profiles.map(profile => [JSON.stringify(profile), profile])).values()];
}
function gridFor(config, allowChanges) {
  const profiles = humanProfiles(config, allowChanges);
  const key = JSON.stringify([config.model, config.seed, config.humanEnabled, profiles]);
  if (grids.has(key)) return { grid: grids.get(key), cacheHit: true };
  const grid = [];
  for (let materialReduction = 0; materialReduction <= 80; materialReduction += 10) {
    for (let balanceReduction = 0; balanceReduction <= 30; balanceReduction += 5) {
      for (const qualityGuard of [false, true]) {
        for (const profile of profiles) grid.push(compactRun({ ...config, ...profile, materialReduction, balanceReduction, qualityGuard }));
      }
    }
  }
  // Bound memory; a cached grid contains metrics and 481 minute observations only.
  if (grids.size >= 4) grids.delete(grids.keys().next().value);
  grids.set(key, grid);
  return { grid, cacheHit: false };
}
function metrics(run, target) {
  const index = target === null ? -1 : run.goodByMinute.findIndex(good => good >= target);
  return { total: run.total, good: run.good, qualityPct: run.qualityPct, wip: run.wip, minutesToTarget: index < 0 ? null : index,
    maxFatigueScore: run.human.maxFatigueScore, avgFatigueScore: run.human.avgFatigueScore,
    maxWorkloadPct: run.human.maxWorkloadPct, congestionPct: run.human.congestionPct,
    fatigueExposureMinutes: run.human.fatigueExposureMinutes, workers: run.human.workers,
    goodPairsPerPersonHour: run.good / (run.human.workers * 8) };
}
function candidate(run, current, baseline, goal) {
  const changedFactors = FACTORS.filter(key => run.config[key] !== current[key]);
  const humanChangedFactors = run.config.humanEnabled ? HUMAN_FACTORS.filter(key => run.config[key] !== current[key]) : [];
  const value = metrics(run, goal.targetGoodPairs);
  const changeMagnitude = Math.abs(run.config.materialReduction - current.materialReduction) / 80 + Math.abs(run.config.balanceReduction - current.balanceReduction) / 30 + Number(run.config.qualityGuard !== current.qualityGuard);
  const humanChangeMagnitude = Math.abs(run.config.manualWorkers - current.manualWorkers) + Math.abs(run.config.pacePercent - current.pacePercent) / 30 + Math.abs(run.config.breakEveryMinutes - current.breakEveryMinutes) / 60 + Math.abs(run.config.breakMinutes - current.breakMinutes) / 10;
  const humanId = run.config.humanEnabled ? `-H${run.config.manualWorkers}-P${run.config.pacePercent}-E${run.config.breakEveryMinutes}-R${run.config.breakMinutes}` : '';
  return { id: `${run.config.model}-${run.config.seed}-M${run.config.materialReduction}-B${run.config.balanceReduction}-Q${Number(run.config.qualityGuard)}${humanId}`, config: { ...run.config }, ...value, human: run.human, changedFactors, changeMagnitude, humanChangedFactors, humanChangeMagnitude,
    delta: Object.fromEntries(Object.keys(value).map(key => [key, value[key] === null || baseline[key] === null ? null : value[key] - baseline[key]])) };
}
function conservative(a, b) {
  return a.changedFactors.length - b.changedFactors.length || a.changeMagnitude - b.changeMagnitude || a.humanChangedFactors.length - b.humanChangedFactors.length || a.humanChangeMagnitude - b.humanChangeMagnitude || b.good - a.good || b.qualityPct - a.qualityPct || a.wip - b.wip || a.id.localeCompare(b.id);
}

/** Deterministic, rule-based calculation. This function makes no LLM call. */
export function evaluateRecommendations({ goal: inputGoal, currentConfig = DEFAULT_CONFIG }) {
  const started = performance.now();
  const goal = validateGoal(inputGoal);
  let baselineRun;
  try { baselineRun = compactRun(currentConfig); } catch (error) { throw new AdvisorError('INVALID_CONFIG', error.message); }
  const current = baselineRun.config;
  const baselineMetrics = metrics(baselineRun, goal.targetGoodPairs);
  const baseline = candidate(baselineRun, current, baselineMetrics, goal);
  const { grid, cacheHit } = gridFor(current, goal.allowHumanChanges);
  const all = grid.map(run => candidate(run, current, baselineMetrics, goal));
  const qualityFiltered = all.filter(item => item.qualityPct === null || item.qualityPct < goal.minQualityPct).length;
  const meetsHumanLimits = item => !current.humanEnabled || (item.maxFatigueScore <= goal.maxFatigueScore && item.maxWorkloadPct <= goal.maxWorkloadPct);
  const safetyFiltered = all.filter(item => !meetsHumanLimits(item)).length;
  const feasible = all.filter(item => item.qualityPct !== null && item.qualityPct >= goal.minQualityPct && meetsHumanLimits(item) && item.changedFactors.length <= goal.maxChangedFactors && FACTORS.every(key => !goal.locks[key] || item.config[key] === current[key]) && (goal.objective !== 'reach_target' || item.minutesToTarget !== null));
  const primary = (a, b) => (goal.objective === 'reach_target' ? a.minutesToTarget - b.minutesToTarget : b.good - a.good) || conservative(a, b);
  const candidates = [];
  const add = (category, comparator, pool = feasible) => {
    const best = [...pool].sort(comparator)[0];
    if (best && !candidates.some(selected => selected.id === best.id)) candidates.push({ ...best, category });
  };
  add('fast', primary);
  const improvements = feasible.filter(item => goal.objective === 'reach_target' ? baseline.minutesToTarget === null || item.minutesToTarget < baseline.minutesToTarget : item.good > baseline.good);
  add('small-change', (a, b) => a.changedFactors.length + a.humanChangedFactors.length - b.changedFactors.length - b.humanChangedFactors.length || a.changeMagnitude + a.humanChangeMagnitude - b.changeMagnitude - b.humanChangeMagnitude || primary(a, b), improvements.length ? improvements : feasible);
  if (current.humanEnabled) {
    const lowerBurden = feasible.filter(item => item.maxFatigueScore < baseline.maxFatigueScore || item.maxWorkloadPct < baseline.maxWorkloadPct);
    add('low-load', (a, b) => a.maxFatigueScore - b.maxFatigueScore || a.maxWorkloadPct - b.maxWorkloadPct || a.fatigueExposureMinutes - b.fatigueExposureMinutes || primary(a, b), lowerBurden.length ? lowerBurden : feasible);
  } else add('quality', (a, b) => b.qualityPct - a.qualityPct || primary(a, b));
  return { goal, baseline, candidates, evaluated: all.length, humanProfilesEvaluated: humanProfiles(current, goal.allowHumanChanges).length, eligible: feasible.length, qualityFiltered, safetyFiltered, computationMs: performance.now() - started, cacheHit,
    engine: 'rule-based-simulation', timeResolutionMinutes: 1, message: feasible.length ? null : '현재 목표·양품률·가정 피로·작업부하·변경 수·고정 조건을 모두 만족하는 후보가 없습니다. 제약 또는 목표를 수정해 주세요.' };
}

export function clearAdvisorCache() { grids.clear(); }
