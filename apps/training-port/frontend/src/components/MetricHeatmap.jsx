import { useEffect, useRef } from 'react'
import { isoOf, todayISO, MONTHS } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// The same GitHub-style grid as Heatmap.jsx (workout activity), generalised to any {d, v} daily
// series instead of workout minutes — steps, sleep, resting heart rate, whatever an Apple Health
// import brings in. Reuses the exact .hm-* CSS so "more shaded = more of X" reads the same way
// everywhere in the app, not a different colour language per metric.
export default function MetricHeatmap({ series, tooltip, weeks = 52 }) {
  const wrapRef = useRef(null)
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollLeft = wrapRef.current.scrollWidth }, [])

  const agg = {}
  series.forEach(p => { agg[p.d] = p.v })
  const vals = Object.values(agg).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const level = v => !v ? 0 : v >= t3 ? 4 : v >= t2 ? 3 : v >= t1 ? 2 : 1

  const today = new Date(); today.setHours(12, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const start = new Date(end); start.setDate(end.getDate() - weeks * 7)

  const months = [], cols = []
  let lastMonth = -1
  for (let wk = 0; wk <= weeks; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7)
    const mo = colStart.getMonth()
    const showM = mo !== lastMonth && colStart.getDate() <= 7 && wk < weeks - 1
    months.push(<span key={wk}>{showM ? t(MONTHS[mo]) : ''}</span>)
    if (colStart.getDate() <= 7) lastMonth = mo
    const cells = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d)
      const key = isoOf(day)
      const v = agg[key]
      const cls = 'hm-c l' + level(v) + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '')
      cells.push(<div key={d} className={cls} title={v ? tooltip(key, v) : ''} />)
    }
    cols.push(<div key={wk} className="hm-col">{cells}</div>)
  }

  return <>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-months" style={{ marginLeft: 30 }}>{months}</div>
      <div className="hm-body">
        <div className="hm-days"><span>{t('Mon')}</span><span /><span>{t('Wed')}</span><span /><span>{t('Fri')}</span><span /><span /></div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">{t('Less')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {t('More')}</div>
  </>
}
