import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { timerExportRows } from './timerExportRows';
import type { TimerRace } from './timerOnly';
export function exportTimerResults(format: 'csv' | 'xlsx' | 'pdf', races: TimerRace[]) {
  if (!races.length) return;
  const rows = timerExportRows(races);
  const filename = races.length === 1 ? `raceflow-race-${races[0].number}` : 'raceflow-all-races';
  if (format === 'pdf') {
    const doc = new jsPDF(); let y = 22;
    doc.setFontSize(16); doc.text('RaceFlow - Timer Only results', 14, y); y += 12; doc.setFontSize(10);
    for (const row of rows) {
      if (y > 246) { doc.addPage(); y = 20; }
      if (row['Start reference']?.startsWith('Relay receipt')) { doc.text('Internet test: relay receipt start; physical start delay unknown', 14, y); y += 6; }
      doc.text(`Source: ${row['Timing source']} | ${row['Start reference'].split(';')[0]}`, 14, y); y += 6;
      doc.text(row.Verification, 14, y); y += 6;
      if (row['Clock policy']) { doc.text(`Clock uncertainty: +/-${Math.ceil(Number(row['Uncertainty (ms)']))} ms | ${row['Clock policy']}`, 14, y); y += 6; }
      if (row['Capture ID']) { doc.text(`Capture: ${row['Capture ID']}`, 14, y); y += 6; }
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
