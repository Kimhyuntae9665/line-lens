import { sampleRows } from './sample.js';
import { validateRows, parseCSV, filterRows, summarize, pareto, hourly, simulate, toCSV, evidencePacket, packetMarkdown, DEFINITIONS, INVALID_POLICY } from './engine.js';

const $ = id => document.getElementById(id);
const fmt = (value, decimals = 0) => value === null || !Number.isFinite(value) ? 'N/A' : value.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const safe = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const modelLabel = value => value === 'FLEX' ? 'FLEX · 경량 운동화' : value === 'CORE' ? 'CORE · 구조형 워킹화' : value;
let rows = validateRows(sampleRows());
let source = 'synthetic-sample';
let selectedHour = 11;
let selectedReason = '자재 대기';
let locked = false;
let currentPacket;

function filters() { return { line: $('line-filter').value, model: $('model-filter').value }; }
function download(name, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setOptions(id, values, allLabel, formatter = value => value) {
  const options = [];
  if (allLabel) options.push(new Option(allLabel, 'all'));
  for (const value of values) options.push(new Option(formatter(value), value));
  $(id).replaceChildren(...options);
}
function populateFilters() {
  setOptions('line-filter', [...new Set(rows.map(r => r.line))].sort(), '전체 라인');
  setOptions('model-filter', [...new Set(rows.map(r => r.model))].sort(), '전체 모델', modelLabel);
  setLocked(false);
}
function setLocked(value) {
  locked = value; $('line-filter').disabled = locked; $('model-filter').disabled = locked;
  $('lock-filter').setAttribute('aria-pressed', String(locked));
  $('lock-filter').innerHTML = `<span aria-hidden="true">${locked ? '▣' : '⌑'}</span> ${locked ? '비교 범위 잠김' : '비교 범위 잠금'}`;
}
function render() {
  const selected = filterRows(rows, filters()); const baseline = summarize(selected); const losses = pareto(selected); const hours = hourly(selected);
  if (!losses.some(loss => loss.reason === selectedReason)) selectedReason = losses[0]?.reason ?? '';
  setOptions('reason-select', losses.map(loss => loss.reason), null);
  if (!losses.length) $('reason-select').replaceChildren(new Option('정지 원인 없음', ''));
  $('reason-select').value = selectedReason;
  $('reason-select').disabled = !losses.length;
  $('reduction-slider').disabled = !losses.length;
  if (!hours.some(hour => hour.hour === selectedHour)) selectedHour = hours[0]?.hour ?? null;
  const reduction = Number($('reduction-slider').value);
  const scenario = simulate(selected, selectedReason, reduction);
  currentPacket = evidencePacket(rows, filters(), selectedReason, reduction, source);
  const dates = [...new Set(rows.map(row => row.date))].sort();
  $('data-badge').textContent = source === 'synthetic-sample' ? 'SYNTHETIC DATA' : 'IMPORTED / UNVERIFIED';
  $('dataset-label').textContent = source === 'synthetic-sample' ? '가상 생산 표본' : `업로드: ${source.replace(/^import:/, '')}`;
  $('dataset-summary').textContent = `${rows.length}행 · ${new Set(rows.map(r => r.line)).size}라인 · ${dates.length}개 작업일 · ${new Set(rows.map(r => r.hour)).size}개 시간대`;
  $('date-range').textContent = `${dates[0].replaceAll('-', '.')} — ${dates.at(-1).replaceAll('-', '.')}`;

  $('kpi-attainment').innerHTML = baseline.plan_attainment_pct === null ? 'N/A' : `${fmt(baseline.plan_attainment_pct, 1)}<small>%</small>`;
  $('attainment-track').style.width = `${Math.min(100, baseline.plan_attainment_pct ?? 0)}%`;
  $('kpi-plan-detail').textContent = `${fmt(baseline.produced_pairs)} / ${fmt(baseline.planned_pairs)} 켤레`;
  $('kpi-quality').innerHTML = baseline.quality_pct === null ? 'N/A' : `${fmt(baseline.quality_pct, 1)}<small>%</small>`;
  $('kpi-quality-detail').textContent = `양품 ${fmt(baseline.good_pairs)} / 총 생산 ${fmt(baseline.produced_pairs)}`;
  $('kpi-labor').textContent = fmt(baseline.good_pairs_per_person_hour, 2);
  $('kpi-labor-detail').textContent = `켤레 / 인시 · 배치 ${fmt(baseline.person_hours)} 인시`;
  $('kpi-downtime').textContent = fmt(baseline.downtime_per_1000_pairs, 1);
  $('kpi-stop-detail').textContent = `분 / 1,000켤레 · 총 정지 ${fmt(baseline.downtime_minutes)}분`;
  const days = new Set(selected.map(r => r.date)).size; const lines = new Set(selected.map(r => r.line)).size;
  $('hourly-context').textContent = `${days}개 작업일 · ${lines}라인 · 선택 ${selected.length}행 합산 (켤레)`;
  renderHours(hours);
  renderPareto(losses, baseline);

  $('reduction-value').innerHTML = `${reduction}<span>%</span>`;
  const scope = `${filters().line === 'all' ? '전체 라인' : filters().line} · ${filters().model === 'all' ? '전체 모델' : modelLabel(filters().model)} · ${selected.length}행`;
  $('comparison-scope').textContent = scope;
  const percent = value => value === null ? 'N/A' : `${fmt(value, 1)}<small>%</small>`;
  $('baseline-attainment').innerHTML = percent(baseline.plan_attainment_pct);
  $('projected-attainment').innerHTML = percent(scenario.projected.plan_attainment_pct);
  $('baseline-production').textContent = `총 생산 ${fmt(baseline.produced_pairs)} 켤레`;
  $('projected-production').textContent = `총 생산 기대값 ${fmt(scenario.projected.produced_pairs, 1)} 켤레`;
  $('recovered-minutes').innerHTML = `${fmt(scenario.recovered_minutes, 1)}<small>분</small>`;
  $('added-good').innerHTML = `+${fmt(scenario.added_good_pairs, 1)}<small>켤레</small>`;
  $('projected-labor').innerHTML = `${fmt(baseline.good_pairs_per_person_hour, 2)} → ${fmt(scenario.projected.good_pairs_per_person_hour, 2)}`;
  $('unestimated-note').textContent = scenario.unestimated_rows > 0 ? ` 속도를 추정할 수 없는 ${scenario.unestimated_rows}행의 추가 생산은 0으로 계산했습니다.` : '';
  $('a3-problem').textContent = currentPacket.a3.problem;
  $('a3-hypothesis').textContent = currentPacket.a3.hypothesis;
  $('a3-action').textContent = currentPacket.a3.action;
  $('fingerprint-info').textContent = `전체 지문 ${currentPacket.dataset_fingerprint} / 선택 지문 ${currentPacket.selected_fingerprint} · 재현 확인용 비암호학적 지문`;
  $('raw-table').innerHTML = selected.slice(0, 24).map(row => `<tr>${['date', 'line', 'model', 'hour', 'planned_pairs', 'produced_pairs', 'good_pairs', 'workers', 'available_minutes', 'downtime_minutes', 'downtime_reason'].map(field => `<td>${safe(field === 'hour' ? `${String(row.hour).padStart(2, '0')}:00` : row[field])}</td>`).join('')}</tr>`).join('');
}
function renderHours(hours) {
  if (!hours.length) { $('hourly-chart').innerHTML = '<div class="empty-state">선택 범위에 관측 데이터가 없습니다.</div>'; $('hour-detail').textContent = '다른 라인 또는 모델을 선택하세요.'; return; }
  const max = Math.max(1, ...hours.flatMap(hour => [hour.planned_pairs, hour.produced_pairs]));
  $('hourly-chart').innerHTML = hours.map(hour => `<button class="hour-button" data-hour="${hour.hour}" aria-pressed="${hour.hour === selectedHour}" aria-label="${hour.hour}시 계획 ${fmt(hour.planned_pairs)}켤레, 실제 ${fmt(hour.produced_pairs)}켤레, 상세 선택"><span class="hour-number">${fmt(hour.produced_pairs)}</span><span class="hour-bars" aria-hidden="true"><i class="bar plan" style="height:${hour.planned_pairs / max * 100}%"></i><i class="bar actual" style="height:${hour.produced_pairs / max * 100}%"></i></span><span class="hour-label">${String(hour.hour).padStart(2, '0')}:00</span></button>`).join('');
  for (const button of $('hourly-chart').querySelectorAll('button')) button.addEventListener('click', () => { selectedHour = Number(button.dataset.hour); render(); });
  const detail = hours.find(hour => hour.hour === selectedHour);
  $('hour-detail').innerHTML = `<strong>${String(selectedHour).padStart(2, '0')}:00 — ${String(selectedHour + 1).padStart(2, '0')}:00</strong><span>계획 ${fmt(detail.planned_pairs)} / 실제 ${fmt(detail.produced_pairs)}</span><span class="shortfall">미달 ${fmt(detail.plan_shortfall_pairs)} 켤레</span>`;
}
function renderPareto(losses, baseline) {
  $('total-stop').innerHTML = `${fmt(baseline.downtime_minutes)}<small>분</small>`;
  $('top-reason-share').textContent = losses.length ? `최대 원인 ${fmt(losses[0].share_pct, 1)}%` : '정지 기여 원인 없음';
  if (!losses.length) { $('pareto-chart').innerHTML = '<div class="empty-state">관측된 정지 시간이 없습니다.</div>'; return; }
  const max = losses[0].minutes;
  $('pareto-chart').innerHTML = losses.map((loss, index) => `<button class="pareto-row" data-index="${index}" aria-pressed="${loss.reason === selectedReason}" aria-label="${safe(loss.reason)} ${fmt(loss.minutes)}분, 기여 ${fmt(loss.share_pct, 1)}%, 누적 ${fmt(loss.cumulative_pct, 1)}%. 시나리오 원인으로 선택"><span class="pareto-labels"><span class="pareto-name">${safe(loss.reason)}</span><span class="pareto-values"><b>${fmt(loss.minutes)}</b><span>누적 ${fmt(loss.cumulative_pct, 1)}%</span></span></span><span class="pareto-track" aria-hidden="true"><i style="width:${loss.minutes / max * 100}%"></i></span></button>`).join('');
  for (const button of $('pareto-chart').querySelectorAll('button')) button.addEventListener('click', () => { selectedReason = losses[Number(button.dataset.index)].reason; render(); });
}

populateFilters();
$('line-filter').addEventListener('change', render); $('model-filter').addEventListener('change', render);
$('lock-filter').addEventListener('click', () => setLocked(!locked));
$('reason-select').addEventListener('change', () => { selectedReason = $('reason-select').value; render(); });
$('reduction-slider').addEventListener('input', render);
$('sample-download').addEventListener('click', () => download('line-lens-synthetic-240.csv', toCSV(validateRows(sampleRows())), 'text/csv;charset=utf-8'));
$('filtered-download').addEventListener('click', () => download('line-lens-filtered-observed.csv', toCSV(filterRows(rows, filters())), 'text/csv;charset=utf-8'));
$('reset-data').addEventListener('click', () => {
  rows = validateRows(sampleRows()); source = 'synthetic-sample'; selectedHour = 11; selectedReason = '자재 대기'; $('reduction-slider').value = '40'; $('csv-upload').value = '';
  populateFilters(); render(); $('data-message').classList.remove('error'); $('data-message').textContent = '합성 표본과 초기 조건을 복원했습니다. 동일 필터에서 관측 기준과 시나리오를 비교합니다.';
});
$('csv-upload').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const incoming = parseCSV(await file.text()); // commit only after complete validation; old rows survive any failure.
    rows = incoming; source = `import:${file.name}`; selectedHour = 11; selectedReason = ''; populateFilters(); render();
    $('data-message').classList.remove('error'); $('data-message').textContent = `${file.name}: ${incoming.length}행 유효성 검사 통과. 업로드는 출처·사실 여부를 검증하지 않습니다.`;
  } catch (error) {
    const errors = error.errors ?? [error.message];
    $('data-message').classList.add('error'); $('data-message').textContent = `불러오기를 거부했습니다. 기존 데이터와 비교 조건을 보존했습니다.\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n외 ${errors.length - 5}개 오류` : ''}`;
  }
  event.target.value = '';
});
$('export-markdown').addEventListener('click', () => download('line-lens-evidence.md', packetMarkdown(currentPacket), 'text/markdown;charset=utf-8'));
$('export-json').addEventListener('click', () => download('line-lens-evidence.json', JSON.stringify(currentPacket, null, 2) + '\n', 'application/json;charset=utf-8'));
$('export-prompt').addEventListener('click', () => download('line-lens-ai-review.txt', `${currentPacket.ai_review_prompt}\n\n--- 근거 묶음 ---\n${JSON.stringify(currentPacket, null, 2)}\n`, 'text/plain;charset=utf-8'));
$('definition-list').innerHTML = Object.entries(DEFINITIONS).map(([key, value]) => `<dt>${safe(key)}</dt><dd>${safe(value)}</dd>`).join('');
$('invalid-policy').textContent = INVALID_POLICY;
render();
