// Shared, dependency-free calculation contract for the UI and evidence exports.
export const FIELDS = ['row_id', 'date', 'line', 'model', 'hour', 'planned_pairs', 'produced_pairs', 'good_pairs', 'workers', 'available_minutes', 'downtime_minutes', 'downtime_reason'];
const NUMERIC = ['planned_pairs', 'produced_pairs', 'good_pairs', 'workers', 'available_minutes', 'downtime_minutes'];
export const DEFINITIONS = {
  row_id: '관측 행 고유 ID. 파일 전체에서 중복 금지.',
  date: '작업일 YYYY-MM-DD. 실제 존재하는 날짜만 허용.',
  line: '가상 생산 라인. date + line + hour 조합은 파일에서 유일.',
  model: '해당 시간의 단일 제품 모델. 제품 혼합에 따른 비교 차이를 확인하는 필터.',
  hour: '작업 시작 시각의 시(0–23). 행은 1시간 관측 구간.',
  planned_pairs: '시간당 계획 생산량, 켤레. 불량을 포함한 총 생산 계획.',
  produced_pairs: '시간당 총 생산량, 켤레. 양품과 불량 합계.',
  good_pairs: '시간당 양품량, 켤레. 총 생산량 이하.',
  workers: '해당 시간의 배치 인원, 명. 구간 전체에 동일하게 배치된다고 가정.',
  available_minutes: '해당 구간의 배치 시간, 분(0–60). 정지 시간을 포함.',
  downtime_minutes: '구간 내 정지 시간, 분. 배치 시간 이하. 행당 하나의 주 정지 원인으로 집계.',
  downtime_reason: '정지 원인 분류. 정지 0분인 행은 무정지.',
  plan_attainment: 'Σ총 생산 켤레 / Σ계획 켤레 × 100. 행별 비율 평균을 사용하지 않음.',
  quality: 'Σ양품 켤레 / Σ총 생산 켤레 × 100.',
  good_pairs_per_person_hour: 'Σ양품 켤레 / Σ(배치 인원 × 배치 분 / 60). 정지 시간을 포함한 배치 인시 기준.',
  downtime_per_1000_pairs: 'Σ정지 분 / Σ총 생산 켤레 × 1,000. 분/1,000켤레.',
  scenario: '선택 원인 정지 분 × 감축률. 행별 가정 속도 = 총 생산 / (배치 분 − 정지 분). 추가 총 생산 = min(가정 속도 × 회복 분, max(계획 − 총 생산, 0)). 추가 양품 = 추가 총 생산 × 기존 행별 양품률. 배치 인원·시간 불변.',
};
export const INVALID_POLICY = '필수 열 누락/중복, 잘못된 CSV 인용, 빈 필수값, 잘못된 날짜·시간, 유한하지 않거나 음수·소수인 원본 수치, 양품>총 생산, 정지>배치 시간, 배치>60분, ID/관측 키 중복이면 파일 전체를 거부. 기존 데이터는 보존. 추가 열은 허용하되 계산에서 제외.';
export const ASSUMPTIONS = [
  '모든 데이터는 독립적으로 만든 합성 데이터이며 회사 생산 데이터가 아니다.',
  '정지 시간은 행당 하나의 주 원인에 귀속된다. 동시 원인과 원인 간 중복은 모델링하지 않는다.',
  '시나리오는 회복한 시간에 해당 행의 관측 가동 중 평균 속도로 생산할 수 있다고 가정한다.',
  '추가 총 생산은 계획 미달분 이하이며 기존 행별 양품률이 유지된다고 가정한다. 분수 켤레는 기대값이다.',
  '인원과 배치 시간은 동일하다. 수요, 재공품, 전후 공정 병목, 자재, 품질 변화는 알 수 없다.',
  '가동 시간이 0이거나 총 생산이 0인 행은 추정 생산 속도를 확보할 수 없어 추가 생산을 0으로 둔다.',
  '집계 양품률은 제품·행별 추가 물량 비중이 달라지면 변할 수 있다. 개선의 인과효과나 실제 측정 결과를 주장하지 않는다.',
];

export class DataValidationError extends Error {
  constructor(errors) { super(errors.join('\n')); this.name = 'DataValidationError'; this.errors = errors; }
}

// RFC-style quoted fields, escaped quotes and embedded newlines; malformed quotes fail closed.
export function parseCSV(text) {
  if (typeof text !== 'string' || !text.trim()) throw new DataValidationError(['CSV가 비어 있습니다.']);
  const source = text.replace(/^\uFEFF/, '');
  const records = []; let row = []; let field = ''; let quoted = false; let closedQuote = false;
  const pushField = () => { row.push(field); field = ''; closedQuote = false; };
  const pushRow = () => { pushField(); if (row.length > 1 || row[0] !== '') records.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closedQuote = true; }
      else field += c;
    } else if (c === '"') {
      if (field !== '' || closedQuote) throw new DataValidationError(['CSV 인용 형식이 잘못되었습니다.']);
      quoted = true;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      pushRow();
    } else {
      if (closedQuote) throw new DataValidationError(['닫힌 인용 뒤에 잘못된 문자가 있습니다.']);
      field += c;
    }
  }
  if (quoted) throw new DataValidationError(['닫히지 않은 CSV 인용이 있습니다.']);
  if (field !== '' || row.length || closedQuote) pushRow();
  if (records.length < 2) throw new DataValidationError(['헤더와 데이터 행이 필요합니다.']);
  const headers = records.shift().map(value => value.trim());
  const errors = [];
  if (new Set(headers).size !== headers.length) errors.push('CSV 헤더에 중복 열이 있습니다.');
  for (const fieldName of FIELDS) if (!headers.includes(fieldName)) errors.push(`필수 열 누락: ${fieldName}`);
  if (errors.length) throw new DataValidationError(errors);
  const objects = records.map((values, index) => {
    if (values.length !== headers.length) errors.push(`${index + 2}행: 열 개수가 헤더와 다릅니다.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
  if (errors.length) throw new DataValidationError(errors);
  return validateRows(objects);
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function validateRows(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new DataValidationError(['데이터 행이 필요합니다.']);
  const errors = []; const ids = new Set(); const keys = new Set();
  const rows = rawRows.map((raw, index) => {
    const row = {}; const label = `${index + 2}행`;
    for (const name of FIELDS) {
      const value = raw[name];
      if (value === undefined || value === null || String(value).trim() === '') { errors.push(`${label}: ${name} 빈 필수값.`); row[name] = null; }
      else row[name] = String(value).trim();
    }
    if (!validDate(row.date ?? '')) errors.push(`${label}: date는 실제 날짜 YYYY-MM-DD여야 합니다.`);
    if (!/^\d{1,2}$/.test(row.hour ?? '') || Number(row.hour) > 23) errors.push(`${label}: hour는 0–23 정수여야 합니다.`);
    row.hour = row.hour === null ? null : Number(row.hour);
    for (const name of NUMERIC) {
      const value = row[name];
      if (value === null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) errors.push(`${label}: ${name}은 유한한 0 이상 정수여야 합니다.`);
      row[name] = value === null ? null : Number(value);
    }
    if (row.good_pairs > row.produced_pairs) errors.push(`${label}: good_pairs가 produced_pairs보다 큽니다.`);
    if (row.downtime_minutes > row.available_minutes) errors.push(`${label}: downtime_minutes가 available_minutes보다 큽니다.`);
    if (row.available_minutes > 60) errors.push(`${label}: available_minutes는 시간 구간당 60분 이하입니다.`);
    if (row.available_minutes === 0 && row.produced_pairs > 0) errors.push(`${label}: 배치 시간 0분에 생산량이 존재합니다.`);
    if (row.available_minutes > 0 && row.downtime_minutes === row.available_minutes && row.produced_pairs > 0) errors.push(`${label}: 전 구간 정지인데 생산량이 존재합니다.`);
    if (row.downtime_minutes === 0 && row.downtime_reason !== '무정지') errors.push(`${label}: 정지 0분인 행은 downtime_reason=무정지여야 합니다.`);
    if (row.downtime_minutes > 0 && row.downtime_reason === '무정지') errors.push(`${label}: 정지 시간이 있으면 원인 분류가 필요합니다.`);
    const key = `${row.date}|${row.line}|${row.hour}`;
    if (ids.has(row.row_id)) errors.push(`${label}: row_id 중복.`);
    if (keys.has(key)) errors.push(`${label}: date + line + hour 관측 키 중복.`);
    ids.add(row.row_id); keys.add(key);
    return row;
  });
  if (errors.length) throw new DataValidationError(errors);
  return rows;
}

export function toCSV(rows) {
  const quote = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  return `${FIELDS.join(',')}\n${rows.map(row => FIELDS.map(field => quote(row[field])).join(',')).join('\n')}\n`;
}

export function fingerprint(rows) {
  const canonical = toCSV([...rows].sort((a, b) => a.row_id.localeCompare(b.row_id, 'en')));
  let hash = 2166136261;
  for (const char of canonical) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export function filterRows(rows, filters = {}) {
  return rows.filter(row => (!filters.line || filters.line === 'all' || row.line === filters.line) && (!filters.model || filters.model === 'all' || row.model === filters.model));
}
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);
const ratio = (numerator, denominator, scale = 1) => denominator > 0 ? numerator / denominator * scale : null;
export function summarize(rows) {
  const planned = sum(rows, 'planned_pairs'); const produced = sum(rows, 'produced_pairs'); const good = sum(rows, 'good_pairs');
  const downtime = sum(rows, 'downtime_minutes'); const available = sum(rows, 'available_minutes');
  const personHours = rows.reduce((total, row) => total + row.workers * row.available_minutes / 60, 0);
  return {
    row_count: rows.length, planned_pairs: planned, produced_pairs: produced, good_pairs: good,
    rejected_pairs: produced - good, downtime_minutes: downtime, available_minutes: available, person_hours: personHours,
    plan_attainment_pct: ratio(produced, planned, 100), quality_pct: ratio(good, produced, 100),
    good_pairs_per_person_hour: ratio(good, personHours), downtime_per_1000_pairs: ratio(downtime, produced, 1000),
    plan_shortfall_pairs: Math.max(0, planned - produced),
  };
}
export function pareto(rows) {
  const groups = new Map();
  for (const row of rows) if (row.downtime_minutes > 0) groups.set(row.downtime_reason, (groups.get(row.downtime_reason) ?? 0) + row.downtime_minutes);
  const total = [...groups.values()].reduce((a, b) => a + b, 0); let cumulative = 0;
  return [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([reason, minutes]) => {
    cumulative += minutes;
    return { reason, minutes, share_pct: minutes / total * 100, cumulative_pct: cumulative / total * 100 };
  });
}
export function hourly(rows) {
  const hours = [...new Set(rows.map(row => row.hour))].sort((a, b) => a - b);
  return hours.map(hour => ({ hour, ...summarize(rows.filter(row => row.hour === hour)) }));
}
export function simulate(rows, reason, reductionPct) {
  if (!Number.isFinite(reductionPct) || reductionPct < 0 || reductionPct > 80) throw new RangeError('정지 감축률은 0–80%입니다.');
  let recoveredMinutes = 0; let addedPairs = 0; let addedGood = 0; let unestimatedRows = 0;
  const simulated = rows.map(row => {
    const recovered = row.downtime_reason === reason ? row.downtime_minutes * reductionPct / 100 : 0;
    const uptime = row.available_minutes - row.downtime_minutes;
    const productionRate = uptime > 0 && row.produced_pairs > 0 ? row.produced_pairs / uptime : 0;
    const extra = Math.min(Math.max(0, row.planned_pairs - row.produced_pairs), recovered * productionRate);
    const quality = row.produced_pairs > 0 ? row.good_pairs / row.produced_pairs : 0;
    if (recovered > 0 && productionRate === 0) unestimatedRows++;
    recoveredMinutes += recovered; addedPairs += extra; addedGood += extra * quality;
    return { ...row, produced_pairs: row.produced_pairs + extra, good_pairs: row.good_pairs + extra * quality, downtime_minutes: row.downtime_minutes - recovered };
  });
  return { reason, reduction_pct: reductionPct, recovered_minutes: recoveredMinutes, added_pairs: addedPairs, added_good_pairs: addedGood, unestimated_rows: unestimatedRows, baseline: summarize(rows), projected: summarize(simulated), rows: simulated };
}

export function evidencePacket(allRows, filters, reason, reductionPct, source = 'synthetic-sample') {
  const selected = filterRows(allRows, filters); const scenario = simulate(selected, reason, reductionPct);
  const losses = pareto(selected);
  return {
    schema_version: '1.0.0', project: 'Line Lens / 풋웨어 생산 손실 분석', data_status: source === 'synthetic-sample' ? 'SYNTHETIC' : 'USER_IMPORTED_UNVERIFIED',
    data_source: source, dataset_fingerprint: fingerprint(allRows), selected_fingerprint: fingerprint(selected),
    fingerprint_method: 'FNV-1a 32-bit, Unicode code points of row_id-sorted canonical CSV; reproducibility identifier, not cryptographic proof.',
    exact_filter: { line: filters.line || 'all', model: filters.model || 'all' }, selected_row_count: selected.length,
    date_range: selected.length ? { from: [...selected.map(r => r.date)].sort()[0], to: [...selected.map(r => r.date)].sort().at(-1) } : null,
    definitions: DEFINITIONS, invalid_data_policy: INVALID_POLICY,
    baseline: scenario.baseline,
    simulation: { reason, reduction_pct: reductionPct, recovered_minutes: scenario.recovered_minutes, added_pairs: scenario.added_pairs, added_good_pairs: scenario.added_good_pairs, unestimated_rows: scenario.unestimated_rows, projected: scenario.projected },
    pareto: losses, hourly: hourly(selected), assumptions: ASSUMPTIONS,
    a3: {
      problem: `선택 범위의 계획 미달 ${scenario.baseline.plan_shortfall_pairs.toFixed(0)}켤레와 정지 ${scenario.baseline.downtime_minutes.toFixed(0)}분을 관찰했다. 정지와 미달의 인과관계는 미확인이다.`,
      hypothesis: `${reason || '원인 없음'} 정지가 계획 달성 저하에 기여할 수 있다. 제품 혼합·시간대·전후 공정 병목을 분리해 확인한다.`,
      action: `${reason || '원인 없음'}의 현장 원인과 재발 조건을 확인한 후 담당자와 소규모 PDCA 실험을 설계한다.`,
      validation_questions: ['정지 시작·종료 로그와 원인 분류가 실제 현상과 일치하는가?', '동일 모델·인원·수요·자재·시간 조건의 비교군을 확보할 수 있는가?', '회복 시간이 다음 공정 병목이나 품질 문제로 다시 소실되는가?', '시험 전후 양품, 불량, 재작업, 납기 및 안전 지표를 함께 확인했는가?', '개선 후 충분한 기간 재측정해 효과와 재발 여부를 확인했는가?'],
    },
    ai_review_prompt: '아래 근거 묶음만 사용해 A3 초안을 검토하세요. 합성 데이터 또는 미검증 업로드의 지위를 먼저 밝히세요. 관측값과 가정 기반 시뮬레이션을 분리하고 개선 효과·인과관계를 단정하지 마세요. 제품 혼합, 분모, 정지 분류, 수요·병목·품질 유지 가정을 점검하세요. 추가로 필요한 현장 검증 질문을 제안하세요. 외부 회사 정보나 실제 성과 수치를 만들어 넣지 마세요.',
  };
}
export function packetMarkdown(packet) {
  const p = packet; const n = value => value === null ? 'N/A (분모 0)' : Number(value).toFixed(2);
  return `# ${p.project}\n\n데이터 지위: **${p.data_status}**\n\n출처: ${p.data_source}\n\n전체 지문: ${p.dataset_fingerprint}\n\n선택 지문: ${p.selected_fingerprint}\n\n지문 방식: ${p.fingerprint_method}\n\n정확한 필터: line=${p.exact_filter.line}, model=${p.exact_filter.model}\n\n선택 ${p.selected_row_count}행, ${p.date_range ? p.date_range.from + ' ~ ' + p.date_range.to : '선택 데이터 없음'}\n\n## 관측 기준과 가정 기반 시나리오\n\n| 지표 | 관측 기준 | SIMULATED |\n|---|---:|---:|\n| 계획 달성률 (%) | ${n(p.baseline.plan_attainment_pct)} | ${n(p.simulation.projected.plan_attainment_pct)} |\n| 양품률 (%) | ${n(p.baseline.quality_pct)} | ${n(p.simulation.projected.quality_pct)} |\n| 양품/배치 인시 (켤레/인시) | ${n(p.baseline.good_pairs_per_person_hour)} | ${n(p.simulation.projected.good_pairs_per_person_hour)} |\n| 정지 분/1,000켤레 | ${n(p.baseline.downtime_per_1000_pairs)} | ${n(p.simulation.projected.downtime_per_1000_pairs)} |\n\n선택 원인: ${p.simulation.reason || '없음'}, 감축 가정: ${p.simulation.reduction_pct}%, 회복 시간: ${n(p.simulation.recovered_minutes)}분, 추가 총 생산 기대값: ${n(p.simulation.added_pairs)}켤레, 추가 양품 기대값: ${n(p.simulation.added_good_pairs)}켤레. 속도를 추정할 수 없는 행: ${p.simulation.unestimated_rows}.\n\n## 전체 정지 기여 원인\n\n| 원인 | 분 | 비중 (%) | 누적 (%) |\n|---|---:|---:|---:|\n${p.pareto.map(r => `| ${r.reason.replaceAll('|', '\\|')} | ${n(r.minutes)} | ${n(r.share_pct)} | ${n(r.cumulative_pct)} |`).join('\n')}\n\n## A3 검토\n\n문제: ${p.a3.problem}\n\n가설: ${p.a3.hypothesis}\n\n실행 제안: ${p.a3.action}\n\n${p.a3.validation_questions.map(q => '- ' + q).join('\n')}\n\n## 가정과 한계\n\n${p.assumptions.map(a => '- ' + a).join('\n')}\n\n## 데이터 정의\n\n${Object.entries(p.definitions).map(([key, value]) => '- **' + key + '**: ' + value).join('\n')}\n\n## 무효 데이터 정책\n\n${p.invalid_data_policy}\n\n## AI 검토용 프롬프트 (자동 실행 없음)\n\n${p.ai_review_prompt}\n\n전체 계산값은 함께 제공하는 JSON 근거 묶음에서 확인할 수 있다. 실제 개선 효과는 현장 검증 후 판단한다.\n`;
}
