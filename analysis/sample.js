// 3 fictional lines × 10 shifts × 8 hourly intervals = 240 rows.
export function sampleRows() {
  const rows = []; const reasons = ['자재 대기', '설비 조정', '작업 전환', '품질 확인', '무정지'];
  for (let day = 0; day < 10; day++) {
    for (let lineIndex = 0; lineIndex < 3; lineIndex++) {
      for (let slot = 0; slot < 8; slot++) {
        const line = `LINE-${String.fromCharCode(65 + lineIndex)}`;
        const model = (day + slot + lineIndex * 2) % 5 < (lineIndex === 1 ? 1 : 3) ? 'FLEX' : 'CORE';
        const workers = model === 'FLEX' ? 12 : 14;
        const planned = (model === 'FLEX' ? 300 : 240) + lineIndex * 12;
        const code = (day * 7 + slot * 3 + lineIndex * 11) % 17;
        const reasonIndex = code < 7 ? 0 : code < 11 ? 1 : code < 14 ? 2 : code < 16 ? 3 : 4;
        const downtime = reasonIndex === 4 ? 0 : 4 + (day * 3 + slot * 5 + lineIndex * 7) % (reasonIndex === 0 ? 17 : 11);
        const speedFactor = 0.96 + ((day + slot + lineIndex) % 4) * 0.01;
        const produced = Math.floor(planned * (60 - downtime) / 60 * speedFactor);
        const rejected = 2 + (day + slot * 2 + lineIndex) % (model === 'CORE' ? 9 : 6);
        rows.push({ row_id: `S${String(day + 1).padStart(2, '0')}-${line}-${slot + 1}`, date: `2026-09-${String(14 + day).padStart(2, '0')}`, line, model, hour: 8 + slot, planned_pairs: planned, produced_pairs: produced, good_pairs: Math.max(0, produced - rejected), workers, available_minutes: 60, downtime_minutes: downtime, downtime_reason: reasons[reasonIndex] });
      }
    }
  }
  return rows;
}
