const $ = id => document.getElementById(id);
const number = (value, decimals = 0) => value == null ? '—' : Number(value).toLocaleString('ko-KR', {maximumFractionDigits: decimals, minimumFractionDigits: decimals});
const seconds = milliseconds => `${number(milliseconds / 1000, 2)}초`;
const categoryNames = {'fast': '더 빠르게', 'small-change': '더 적게 바꾸기', 'quality': '품질 우선', 'low-load': '작업 부담 줄이기'};
const signature = config => JSON.stringify([config.model, config.seed, config.materialReduction, config.balanceReduction, config.qualityGuard,config.humanEnabled,config.manualWorkers,config.pacePercent,config.breakEveryMinutes,config.breakMinutes]);

export function initGoalAdvisor({getConfig, applyConfig}) {
  let controller = null, requestVersion = 0, busy = false, connected = false;
  let interpretation = null, result = null, resultConfig = null, appliedId = null;
  let connectionVersion = 0;
  const setError = message => {$('advisorError').textContent = message || ''; $('advisorError').hidden = !message;};
  const process = message => {$('advisorProcessText').textContent = message;};
  function setBusy(value) {
    busy = value;
    $('advisorInterpretButton').disabled = value || !connected;
    $('advisorConfirmButton').disabled = value || !connected;
    $('advisorCancel').hidden = !value;
    $('advisorReconnect').disabled = value;
    $('advisor').setAttribute('aria-busy', String(value));
    $('advisorProcess').classList.toggle('is-busy', value);
    $('advisorCardGrid').querySelectorAll('button').forEach(button => {button.disabled = value;});
  }
  function cancel(message = '요청을 취소했습니다. 공장 설정은 그대로입니다.') {
    ++requestVersion;
    controller?.abort(); controller = null;
    setBusy(false); process(message);
  }
  function clearResults() {
    result = null; resultConfig = null; appliedId = null;
    $('advisorCandidates').hidden = true; $('advisorApplied').hidden = true;
    $('advisorCardGrid').replaceChildren();
  }
  async function api(path, body, signal) {
    const response = await fetch(`/api/advisor/${path}`, {method: body ? 'POST' : 'GET', headers: body ? {'Content-Type':'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined, signal});
    let data;
    try {data = await response.json();} catch {throw new Error('AI API에서 유효한 JSON 응답을 받지 못했습니다. 로컬 실행 서버와 모델 연결을 확인하세요.');}
    if (!response.ok || data.error) throw new Error(data.error?.message || `AI 요청 실패 (${response.status})`);
    return data;
  }
  async function checkConnection() {
    const version = ++connectionVersion;
    $('advisorConnection').textContent = '로컬 모델 연결 확인 중';
    $('advisorConnection').className = 'connection-badge';
    connected = false; setBusy(busy);
    try {
      const response = await fetch('/api/advisor/status');
      const data = await response.json();
      if (version !== connectionVersion) return;
      connected = response.ok && data.reachable === true && data.llmStatus === 'ready';
      $('advisorConnection').textContent = connected ? `실제 로컬 LLM 연결 · ${data.llmModel}` : '로컬 LLM 미연결';
      $('advisorConnection').title = data.endpoint || '';$('advisorModelAssumptions').textContent = `로컬 AI · ${data.llmModel || '미연결'} · 합성 공정·작업 부담·휴식 규칙 사용. 피로는 건강 측정값이 아니며 현장 보정값이 아닙니다.`;
      $('advisorConnection').classList.toggle('is-connected', connected);
      if (!connected) process(data.error?.message || '로컬 모델을 연결한 뒤 목표 해석을 요청하세요.');
      else if (!interpretation && !busy) process('로컬 LLM이 준비되었습니다. 목표를 해석할 수 있습니다.');
    } catch {
      if (version !== connectionVersion) return;
      $('advisorConnection').textContent = '로컬 AI API 연결 실패';
      process('로컬 실행 서버와 모델 연결을 확인하세요. AI 응답을 대신 생성하지 않습니다.');
    }
    if (version === connectionVersion) setBusy(busy);
  }
  function begin(message) {
    cancel(message); setError('');
    controller = new AbortController(); setBusy(true);
    return {version: requestVersion, signal: controller.signal};
  }
  function fail(error, version) {
    if (version !== requestVersion || error.name === 'AbortError') return;
    setError(error.message); process('요청을 완료하지 못했습니다. 공장 설정은 그대로입니다.');
  }
  function readable(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(readable).join(' · ');
    return value?.summary || value?.description || value?.text || (value ? JSON.stringify(value) : '');
  }
  function showInterpretation(data) {
    if (data.unsupported) throw new Error(`이 요청은 현재 생산 시뮬레이터에서 비교할 수 없습니다. ${readable(data.interpretation)} ${readable(data.questions)}`);
    if (!data.goal || !data.interpretation || data.llmStatus !== 'ready') throw new Error('로컬 LLM의 유효한 목표 해석을 받지 못했습니다.');
    interpretation = data;
    $('advisorGoalDescription').textContent = readable(data.interpretation);
    $('advisorInterpretModel').textContent = `로컬 LLM 응답 · ${data.llmModel} · ${seconds(data.llmInterpretMs)}`;
    $('advisorQuestions').textContent = readable(data.questions);
    $('advisorQuestions').hidden = !data.questions?.length;
    const labels = {targetGoodPairs:'목표 양품량', minQualityPct:'최소 양품률', maxChangedFactors:'공정 변경', maxFatigueScore:'최대 가정 피로',maxWorkloadPct:'최대 작업부하',allowHumanChanges:'인력·휴식 변경', objective:'비교 목적'};
    const units = {targetGoodPairs:'켤레', minQualityPct:'%', maxChangedFactors:'개',maxFatigueScore:'점',maxWorkloadPct:'%'};
    const applied = data.defaultsApplied;
    const fields = Array.isArray(applied) ? applied.map(item => typeof item === 'string' ? item : item.field || item.key).filter(Boolean) : Object.keys(applied || {});
    const defaults = fields.map(field => `${labels[field] || field} ${field === 'allowHumanChanges' ? (data.goal.allowHumanChanges?'허용':'고정') : field === 'objective' ? (data.goal.objective === 'maximize_good' ? '8시간 양품량 최대화' : '목표 양품까지 더 빠르게') : number(data.goal[field], field === 'minQualityPct' ? 1 : 0)}${units[field] || ''}`);
    $('advisorDefaults').textContent = defaults.length ? `${defaults.join(' · ')}. 아래 값을 확인하고 필요하면 수정하세요.` : '사용자가 지정한 조건을 반영했습니다. 아래 수치를 확인하세요.';
    $('advisorObjective').value = data.goal.objective || 'reach_target';
    $('advisorTarget').value = String(data.goal.targetGoodPairs ?? 1000);
    $('advisorQuality').value = String(data.goal.minQualityPct);
    $('advisorChanges').value = String(data.goal.maxChangedFactors);$('advisorFatigue').value=String(data.goal.maxFatigueScore??40);$('advisorWorkload').value=String(data.goal.maxWorkloadPct??90);$('advisorHumanChanges').checked=data.goal.allowHumanChanges??true;
    $('advisorLockMaterial').checked = data.goal.locks.materialReduction;
    $('advisorLockBalance').checked = data.goal.locks.balanceReduction;
    $('advisorLockQuality').checked = data.goal.locks.qualityGuard;
    updateObjective();updateGridPreview();
    $('advisorInterpret').hidden = false;
  }
  function updateObjective() {$('advisorTarget').disabled = $('advisorObjective').value === 'maximize_good';}
  function updateGridPreview(){const c=getConfig();['advisorFatigue','advisorWorkload','advisorHumanChanges'].forEach(id=>$(id).disabled=!c.humanEnabled);const current=[c.manualWorkers,c.pacePercent,c.breakEveryMinutes,c.breakMinutes];const profiles=[current];if(c.humanEnabled&&$('advisorHumanChanges').checked){profiles.push([Math.min(3,c.manualWorkers+1),c.pacePercent,c.breakEveryMinutes,c.breakMinutes],[c.manualWorkers,Math.max(90,c.pacePercent-10),c.breakEveryMinutes,c.breakMinutes],[c.manualWorkers,c.pacePercent,Math.min(90,c.breakEveryMinutes),Math.min(10,c.breakMinutes+5)]);}const count=new Set(profiles.map(p=>JSON.stringify(p))).size;const total=9*7*2*count;$('advisorGridDescription').textContent=`현재 제품·시드 · 공정 9×7×2 × 인력·휴식 ${count}조건 = ${number(total)}개를 계산합니다.`;$('advisorConfirmButton').firstChild.textContent=`이 목표로 ${number(total)}개 조건 비교 `;}
  function confirmedGoal() {
    return {...interpretation.goal, confirmed: true, objective: $('advisorObjective').value,
      targetGoodPairs: $('advisorObjective').value === 'maximize_good' ? null : Number($('advisorTarget').value),
      maxFatigueScore:Number($('advisorFatigue').value),maxWorkloadPct:Number($('advisorWorkload').value),allowHumanChanges:$('advisorHumanChanges').checked,minQualityPct: Number($('advisorQuality').value), maxChangedFactors: Number($('advisorChanges').value),
      locks: {materialReduction: $('advisorLockMaterial').checked, balanceReduction: $('advisorLockBalance').checked, qualityGuard: $('advisorLockQuality').checked}};
  }
  function metric(label, value, unit, detail) {
    const item = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const amount = document.createElement('dd'); amount.textContent = value;
    if (unit) {const small = document.createElement('small'); small.textContent = unit; amount.append(small);}
    const note = document.createElement('span'); note.textContent = detail || '';
    item.append(term, amount, note); return item;
  }
  function signed(value, decimals = 0) {return value == null ? '기준 대비 —' : `기준 대비 ${value > 0 ? '+' : ''}${number(value, decimals)}`;}
  function createCard(candidate, data) {
    const card = document.createElement('article'); card.className = `advisor-card category-${candidate.category}`; card.dataset.candidateId = candidate.id;
    const chosen = data.explanation?.recommendedId === candidate.id;
    const header = document.createElement('div'); header.className = 'advisor-card-heading';
    const title = document.createElement('h4'); title.textContent = categoryNames[candidate.category] || '개선 후보';
    const tag = document.createElement('span'); tag.textContent = chosen ? 'AI 추천' : `후보 ${candidate.id}`; tag.className = chosen ? 'advisor-recommended' : 'advisor-candidate-id';
    header.append(title, tag);
    const setup = document.createElement('p'); setup.className = 'advisor-candidate-setup';
    setup.textContent = `자재 대기 −${candidate.config.materialReduction}% · 성형 시간 −${candidate.config.balanceReduction}% · 검사 강화 ${candidate.config.qualityGuard ? '켜짐' : '꺼짐'}${candidate.config.humanEnabled?` · 공정별 ${candidate.config.manualWorkers}명(총 ${candidate.workers}명) · 속도 ${candidate.config.pacePercent}% · ${candidate.config.breakEveryMinutes}분마다 ${candidate.config.breakMinutes}분 휴식`:' · 작업 부담 모델 꺼짐'}`;
    const main = document.createElement('div'); main.className = 'advisor-main-metric';
    const label = document.createElement('span'); label.textContent = data.goal.targetGoodPairs == null ? '8시간 양품량' : `양품 ${number(data.goal.targetGoodPairs)}켤레 도달`;
    const value = document.createElement('strong'); value.textContent = data.goal.targetGoodPairs == null ? number(candidate.good) : candidate.minutesToTarget == null ? '미달' : number(candidate.minutesToTarget);
    const unit = document.createElement('small'); unit.textContent = data.goal.targetGoodPairs == null ? '켤레' : candidate.minutesToTarget == null ? '8시간 안에 도달하지 못함' : '분';
    main.append(label, value, unit);
    if (data.goal.targetGoodPairs !== null) {const delta = document.createElement('span'); delta.className = 'advisor-time-delta'; delta.textContent = `${signed(candidate.delta?.minutesToTarget)}분 · 1분 단위 관측`; main.append(delta);}
    const metrics = document.createElement('dl'); metrics.className = 'advisor-card-metrics';
    metrics.append(metric('총 생산량', number(candidate.total), '켤레', signed(candidate.delta?.total)), metric('양품량', number(candidate.good), '켤레', signed(candidate.delta?.good)), metric('양품률', number(candidate.qualityPct, 2), '%', `${signed(candidate.delta?.qualityPct, 2)}%p`), metric('교대 종료 재공품', number(candidate.wip), '켤레', signed(candidate.delta?.wip)));if(candidate.config.humanEnabled)metrics.append(metric('최대 가정 피로',number(candidate.maxFatigueScore,1),'점',signed(candidate.delta?.maxFatigueScore,1)),metric('최대 작업부하',number(candidate.maxWorkloadPct,1),'%',`${signed(candidate.delta?.maxWorkloadPct,1)}%p`),metric('버퍼 적체율',number(candidate.congestionPct,1),'%',`${signed(candidate.delta?.congestionPct,1)}%p`),metric('양품 / 인시',number(candidate.goodPairsPerPersonHour,2),'',`${candidate.workers}명 기준`));
    const constraints = document.createElement('p'); constraints.className = 'advisor-constraints';
    const changedCount = Array.isArray(candidate.changedFactors) ? candidate.changedFactors.length : candidate.changedFactors;
    constraints.textContent = `✓ 양품률 ${number(candidate.qualityPct, 2)}% ≥ ${number(data.goal.minQualityPct, 1)}% · 공정 변경 ${changedCount}/${data.goal.maxChangedFactors}개 · 인력·휴식 변경 ${candidate.humanChangedFactors?.length??0}개${candidate.config.humanEnabled?` · 피로 ${number(candidate.maxFatigueScore,1)} ≤ ${number(data.goal.maxFatigueScore,1)} · 부하 ${number(candidate.maxWorkloadPct,1)}% ≤ ${number(data.goal.maxWorkloadPct,1)}%`:""}`;
    const why = document.createElement('div'); why.className = 'advisor-ai-reason';
    const whyLabel = document.createElement('strong'); whyLabel.textContent = '검증 근거 중 로컬 LLM이 선택한 설명';
    const reason = document.createElement('p'); reason.textContent = data.explanation?.reasons?.find(item => item.candidateId === candidate.id)?.text || '이 후보에 대한 AI 설명이 응답에 포함되지 않았습니다.';
    why.append(whyLabel, reason);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'advisor-apply'; button.textContent = '이 후보를 3D 라인에 적용 ↑';
    button.addEventListener('click', () => {
      if (!result || signature(getConfig()) !== resultConfig) {setError('공장 조건이 바뀌었습니다. 현재 조건으로 다시 비교한 뒤 적용하세요.'); return;}
      applyConfig(candidate.config); appliedId = candidate.id;updateGridPreview();
      // All candidates were evaluated against the same reference configuration.
      resultConfig = signature(getConfig());
      $('advisorCardGrid').querySelectorAll('.advisor-apply').forEach(item => {item.textContent = item.closest('article').dataset.candidateId === appliedId ? '3D 라인에 적용됨 ✓' : '이 후보를 3D 라인에 적용 ↑';});
      $('advisorApplied').textContent = `${categoryNames[candidate.category]} 후보 ${candidate.id}를 적용했습니다. 제품·자재·성형·검사·인원·속도·휴식 설정과 개선 라인을 다시 계산했고, 기존 재생 시점은 유지했습니다. 위 3D 화면에서 확인하세요.`;
      $('advisorApplied').hidden = false; setError('');
    });
    card.append(header, setup, main, metrics, constraints, why, button); return card;
  }
  function showResults(data, configAtRequest) {
    if (!Array.isArray(data.candidates) || !data.baseline || !Number.isFinite(data.computationMs)) throw new Error('시뮬레이터의 비교 결과 형식이 유효하지 않습니다.');
    if (data.candidates.length && (data.llmStatus !== 'ready' || !data.explanation)) throw new Error('후보 계산 후 로컬 LLM의 유효한 추천 근거를 받지 못했습니다.');
    result = data; resultConfig = signature(configAtRequest);
    $('advisorEvaluated').textContent = `${number(data.evaluated)} / ${number(data.evaluated)}`;
    $('advisorEligible').textContent = `${number(data.eligible)}개`;
    $('advisorComputeTime').textContent = seconds(data.computationMs);
    $('advisorAITime').textContent = `${seconds(interpretation.llmInterpretMs)} / ${seconds(data.llmExplainMs)}`;
    $('advisorResultModel').textContent = data.llmStatus === 'ready' ? `검증 근거 선택 · ${data.llmModel}` : '제약 필터 결과 · AI 근거 선택 미실행';
    $('advisorResultSummary').textContent = `${number(data.evaluated)}개 조건 계산 완료 · ${number(data.eligible)}개 제약 충족 · 품질 제약 제외 ${number(data.qualityFiltered)}개 · 작업 부담 제약 제외 ${number(data.safetyFiltered??0)}개 · 인력·휴식 ${number(data.humanProfilesEvaluated??1)}조건${data.cacheHit ? ' · 같은 조건의 검증된 계산 캐시 사용' : ''}`;
    const b = data.baseline;
    $('advisorBaseline').textContent = `비교 요청 당시 설정 · ${configAtRequest.model} · 총 ${number(b.total)}켤레 / 양품 ${number(b.good)}켤레 / 양품률 ${number(b.qualityPct, 2)}% / 재공품 ${number(b.wip)}켤레${configAtRequest.humanEnabled?` / ${b.workers}명·속도 ${configAtRequest.pacePercent}%·${configAtRequest.breakEveryMinutes}분마다 ${configAtRequest.breakMinutes}분 휴식 / 가정 피로 ${number(b.maxFatigueScore,1)} / 작업부하 ${number(b.maxWorkloadPct,1)}%`:""}${data.goal.targetGoodPairs == null ? '' : ` / 목표 도달 ${b.minutesToTarget == null ? '8시간 내 미달' : `${number(b.minutesToTarget)}분`}`}`;
    $('advisorCardGrid').replaceChildren(...data.candidates.map(candidate => createCard(candidate, data)));
    $('advisorNoFeasible').hidden = data.candidates.length > 0;
    $('advisorNoFeasible').textContent = data.message || '현재 목표·품질·작업 부담·변경 범위를 모두 만족하는 조건이 없습니다. 목표 또는 제약을 수정한 뒤 다시 비교하세요. AI 추천은 생성하지 않았습니다.';
    $('advisorCandidates').hidden = false;
  }
  $('advisorRequest').addEventListener('submit', async event => {
    event.preventDefault(); if (!connected || busy || !$('advisorRequest').reportValidity()) return;
    clearResults(); interpretation = null; $('advisorInterpret').hidden = true;
    const currentConfig = {...getConfig()}, text = $('advisorText').value.trim();
    if (!text) {setError('원하는 생산 결과를 입력하세요.'); return;}
    const {version, signal} = begin('01 / 로컬 LLM이 요청을 읽고 목표·제약을 해석하고 있습니다…');
    try {
      const data = await api('interpret', {text, currentConfig}, signal);
      if (version !== requestVersion) return;
      showInterpretation(data); process('목표 해석을 받았습니다. 시스템 기본값과 수치를 확인한 뒤 비교를 시작하세요.');
    } catch (error) {fail(error, version);} finally {if (version === requestVersion) {controller = null; setBusy(false);}}
  });
  $('advisorConfirmForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!interpretation || !connected || busy || !$('advisorConfirmForm').reportValidity()) return;
    clearResults(); const currentConfig = {...getConfig()}, goal = confirmedGoal();
    const {version, signal} = begin('03 / 확인한 공정·인력·휴식 조건을 시뮬레이터로 계산하고, 실제 로컬 LLM이 검증된 후보·근거를 선택하고 있습니다…');
    try {
      const data = await api('recommend', {goal, currentConfig, text: $('advisorText').value.trim()}, signal);
      if (version !== requestVersion) return;
      showResults(data, currentConfig); process(data.candidates.length ? `${data.evaluated}개 조건 계산과 AI 설명을 완료했습니다. 적용할 후보를 직접 선택하세요.` : `${data.evaluated}개 조건 계산 완료. 제약을 만족하는 후보가 없습니다.`);
    } catch (error) {fail(error, version);} finally {if (version === requestVersion) {controller = null; setBusy(false);}}
  });
  $('advisorObjective').addEventListener('change', updateObjective);
  $('advisorCancel').addEventListener('click', () => cancel());
  $('advisorReconnect').addEventListener('click', checkConnection);
  $('advisorReset').addEventListener('click', () => {
    cancel('질문과 AI 결과를 초기화했습니다. 현재 공장 설정은 그대로입니다.'); clearResults(); interpretation = null;
    $('advisorText').value = ''; $('advisorInterpret').hidden = true; setError(''); $('advisorText').focus();
  });
  $('advisorText').addEventListener('input', () => {
    cancel('질문이 바뀌었습니다. 새 목표 해석을 요청하세요.'); clearResults(); interpretation = null; $('advisorInterpret').hidden = true; setError('');
  });
  ['advisorTarget', 'advisorQuality', 'advisorChanges', 'advisorFatigue','advisorWorkload','advisorHumanChanges','advisorObjective', 'advisorLockMaterial', 'advisorLockBalance', 'advisorLockQuality'].forEach(id => $(id).addEventListener('input', () => {
    updateGridPreview();cancel('확인할 목표가 바뀌었습니다. 수정한 조건으로 다시 비교하세요.'); clearResults(); setError('');
  }));
  ['material', 'balance', 'quality', 'model','humanEnabled','manualWorkers','pacePercent','breakEveryMinutes','breakMinutes','humanAggressive','humanNormal','humanStaff','presetButton'].forEach(id => $(id).addEventListener(['material','balance','pacePercent'].includes(id) ? 'input' : ['presetButton','humanAggressive','humanNormal','humanStaff'].includes(id) ? 'click' : 'change', () => {
    updateGridPreview();cancel('공장 설정이 바뀌었습니다. 현재 조건으로 다시 비교하세요.'); clearResults(); setError('');
  }));
  checkConnection();
  return {getEvidence: () => ({interpretation, result, appliedCandidateId: appliedId, connected})};
}
