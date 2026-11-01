// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Body-composition report export — PDF (jsPDF + jspdf-autotable) and Excel (exceljs), both
// generated entirely client-side (no server round-trip, same "the browser makes the file"
// pattern Settings' JSON backup already uses). Two visual themes, matching the picker the
// Measurements screen offers: 'dark' for on-screen sharing in 2J's own look, 'light' for
// actually printing without drowning a printer in toner.
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'
import { MEASUREMENTS, lastMeasurement } from './measurements.js'
import { fmtDate, todayISO } from './format.js'
import { t } from './i18n.js'

const BRAND_ACCENT = [115, 181, 46]       // #73b52e — the app's own default accent (lime)
const BRAND_ACCENT_HEX = 'FF73B52E'
const PDF_THEMES = {
  dark: { bg: [14, 14, 16], text: [235, 235, 240], sub: [160, 160, 168], line: [46, 46, 50], altRow: [22, 22, 25] },
  light: { bg: [255, 255, 255], text: [20, 20, 22], sub: [100, 100, 106], line: [222, 222, 226], altRow: [246, 246, 248] },
}
const XLSX_THEMES = {
  dark: { bg: 'FF0E0E10', text: 'FFEBEBF0', altBg: 'FF16161A' },
  light: { bg: 'FFFFFFFF', text: 'FF141416', altBg: 'FFF6F6F8' },
}

const SECTIONS = [
  { key: 'composition', title: 'Body composition' },
  { key: 'segments', title: 'Body composition by segment' },
  { key: 'folds', title: 'Skinfolds' },
]

// [label, value+unit, date] rows for one measurement group — the same "most recent entry"
// each group's Row already shows in the app, just flattened for a table instead of a list.
function sectionRows(S, group) {
  return MEASUREMENTS.filter(m => m.group === group).map(m => {
    const last = lastMeasurement(S, m.key)
    return [t(m.label), last ? `${last.v} ${m.unit}` : '—', last ? fmtDate(last.d, true) : '—']
  }).filter(row => row[1] !== '—')
}

/** Downloads a branded PDF report — one table per non-empty group, on the chosen theme. */
export function exportBioimpedancePdf(S, { memberName = '', theme = 'dark' } = {}) {
  const c = PDF_THEMES[theme] || PDF_THEMES.dark
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const paintBg = () => { doc.setFillColor(...c.bg); doc.rect(0, 0, W, H, 'F') }
  paintBg()
  // Repaints the theme background on every page ADDED after this one (autoTable inserts
  // pages of its own when a section's table runs long) — a document-level event, so it fires
  // exactly once per genuinely new page regardless of which section triggered it.
  doc.internal.events.subscribe('addPage', paintBg)

  doc.setFillColor(...BRAND_ACCENT)
  doc.rect(0, 0, W, 70, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text('2J Fitness Center', 40, 42)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11)
  doc.text(t('Body composition report'), 40, 58)

  let y = 96
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...c.text)
  if (memberName) { doc.text(memberName, 40, y); y += 18 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...c.sub)
  doc.text(fmtDate(todayISO(), true), 40, y)
  y += 22

  let any = false
  SECTIONS.forEach(sec => {
    const rows = sectionRows(S, sec.key)
    if (!rows.length) return
    any = true
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...BRAND_ACCENT)
    doc.text(t(sec.title), 40, y)
    autoTable(doc, {
      startY: y + 8,
      head: [[t('Measurement'), t('Value'), t('Date')]],
      body: rows,
      theme: 'plain',
      margin: { left: 40, right: 40 },
      styles: { textColor: c.text, fontSize: 10, cellPadding: 6, lineColor: c.line, lineWidth: 0.5 },
      headStyles: { textColor: c.sub, fontStyle: 'bold', fontSize: 9 },
      alternateRowStyles: { fillColor: c.altRow },
    })
    y = doc.lastAutoTable.finalY + 26
  })
  if (!any) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...c.sub)
    doc.text(t('No measurements logged yet.'), 40, y)
  }
  doc.save(`2jfitness-composicion-${todayISO()}.pdf`)
}

/** Downloads a branded Excel workbook — one worksheet per non-empty group, on the chosen theme. */
export async function exportBioimpedanceExcel(S, { memberName = '', theme = 'dark' } = {}) {
  const c = XLSX_THEMES[theme] || XLSX_THEMES.dark
  const wb = new ExcelJS.Workbook()
  wb.creator = '2J Fitness Center'
  wb.created = new Date()

  let any = false
  SECTIONS.forEach(sec => {
    const rows = sectionRows(S, sec.key)
    if (!rows.length) return
    any = true
    const ws = wb.addWorksheet(t(sec.title).slice(0, 31))
    ws.columns = [
      { header: t('Measurement'), key: 'label', width: 28 },
      { header: t('Value'), key: 'value', width: 14 },
      { header: t('Date'), key: 'date', width: 16 },
    ]
    if (memberName) { ws.insertRow(1, [memberName]); ws.mergeCells('A1:C1'); ws.getRow(1).font = { bold: true, size: 13, color: { argb: BRAND_ACCENT_HEX } } }
    const headerRow = ws.getRow(memberName ? 2 : 1)
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ACCENT_HEX } }
    })
    rows.forEach((r, i) => {
      const row = ws.addRow(r)
      row.eachCell(cell => {
        cell.font = { color: { argb: c.text } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 ? c.altBg : c.bg } }
      })
    })
    ws.views = [{ state: 'frozen', ySplit: memberName ? 2 : 1 }]
  })
  if (!any) {
    const ws = wb.addWorksheet(t('Body composition').slice(0, 31))
    ws.addRow([t('No measurements logged yet.')])
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `2jfitness-composicion-${todayISO()}.xlsx`; a.click()
  URL.revokeObjectURL(a.href)
}
