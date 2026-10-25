import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { formatTime, positions } from './timerOnly';
import type { TimerRace } from './timerOnly';
export function exportTimerResults(format: 'csv' | 'xlsx' | 'pdf', races: TimerRace[]) {
  if (!races.length) return;
  const rows = races.flatMap(r => {
    const ranked = positions(r.lanes);
    return r.lanes.map(l => ({ Race: r.number, 'Race ID': r.id, Lane: l.lane, Position: ranked[l.lane] ?? '', Time: l.milliseconds === null ? '' : formatTime(l.milliseconds), Milliseconds: l.milliseconds ?? '', Status: l.status, Corrected: l.corrected ? 'Yes' : '', Confirmed: r.confirmedAt ?? '', ...(r.startReference === 'relay' ? { 'Start reference': 'Relay receipt - internet test; physical start delay unknown' } : {}), ...(r.startReference === 'chief-local' ? { 'Start reference': 'Chief original local tap', 'Timing source': l.timingSource ?? 'manual', 'Volunteer verification': 'Not implemented; raw volunteer captures excluded' } : {}) }));
  });
  const filename = races.length === 1 ? `raceflow-race-${races[0].number}` : 'raceflow-all-races';
  if (format === 'pdf') {
    const doc = new jsPDF(); let y = 22;
    doc.setFontSize(16); doc.text('RaceFlow - Timer Only results', 14, y); y += 12; doc.setFontSize(10);
    for (const row of rows) {
      if (y > 262) { doc.addPage(); y = 20; }
      if (row['Start reference']?.startsWith('Relay receipt')) { doc.text('Internet test: relay receipt start; physical start delay unknown', 14, y); y += 6; }
      if (row['Timing source']) { doc.text(`Chief original local start | Source: ${row['Timing source']}`, 14, y); y += 6;
        doc.text('Volunteer raw captures: pending verification, excluded from official times', 14, y); y += 6; }
      doc.text(`Race ${row.Race} | Lane ${row.Lane} | Place ${row.Position || '-'} | ${row.Time || '-'} ${row.Status}${row.Corrected ? ' (corrected)' : ''}`, 14, y); y += 8;
    }
    doc.save(`${filename}.pdf`);
  } else {
    const sheet = XLSX.utils.json_to_sheet(rows);
    if (format === 'xlsx') {
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Results'); XLSX.writeFile(book, `${filename}.xlsx`);
    } else {
      const url = URL.createObjectURL(new Blob(['\uFEFF', XLSX.utils.sheet_to_csv(sheet)], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a'); link.href = url; link.download = `${filename}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}
