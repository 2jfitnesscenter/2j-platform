// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Program editor (admins): weeks and days, each session an official routine. The server dry-runs
// every change (references, week rules, publishing checks) so what the admin sees as "problems" is
// exactly what a save would refuse.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../../store/useStore.js'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { useGuided } from '../../../lib/guided-api.js'
import { GOALS, LEVELS, GOAL_LABEL, LEVEL_LABEL, CATEGORY_LABEL, ROUTINE_CATEGORIES } from '../../../lib/protocol/index.js'
import { STATUSES, STATUS_LABEL, statusOf, emptyProgram, programTotals, nextDay, duplicateWeek, WEEKDAYS } from '../../../lib/studio.js'
import { confirmSheet } from '../../../sheets.jsx'
import WorkoutCover from '../../../components/WorkoutCover.jsx'
import Icon from '../../../components/Icon.jsx'
import { RoutinePicker, StatusPill } from './parts.jsx'
import { HistoryButton } from './History.jsx'

export default function ProgramEditor() {
  const nav = useNavigate()
  const { id } = useParams()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const g = useGuided()
  const [p, setP] = useState(null)
  const [problems, setProblems] = useState([])
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(false)
  const timer = useRef(0)
  useEffect(() => { g.load(user?.id, true).finally(() => setFresh(true)) }, [user?.id])
  useEffect(() => {
    if (p || !fresh || g.status !== 'ready') return
    if (id === 'new') { setP(emptyProgram()); return }
    const found = g.programs.find(x => x.id === id)
    if (!found) { toast(t('That program no longer exists.')); nav('/trainer/guided'); return }
    const copy = JSON.parse(JSON.stringify(found))
    copy.status = statusOf(found)
    setP(copy)
  }, [g.status, fresh, id])
  const byId = useMemo(() => new Map(g.routines.map(r => [r.id, r])), [g.routines])
  const totals = useMemo(() => p ? programTotals(p, byId) : null, [p, byId])

  // Ask the server what it would say, a moment after the last edit (dry run, nothing is saved).
  useEffect(() => {
    if (!p) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try { const r = await g.saveProgram({ ...p, status: 'active' }, true); setProblems(r.problems || []) }
      catch (e) { setProblems(e.data?.problems || [e.message]) }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [p])

  if (!p) return <div className="cx-shell st" />
  const set = patch => setP(x => ({ ...x, ...patch }))
  const setWeek = (i, fn) => setP(x => ({ ...x, weeks: x.weeks.map((w, k) => k === i ? fn(w) : w) }))
  const addSession = i => openSheet(close => <RoutinePicker routines={g.routines} close={close} onPick={r => setWeek(i, w => {
    const day = nextDay(w); if (day == null) { toast(t('A week holds up to seven sessions.')); return w }
    return { ...w, sessions: [...w.sessions, { day, routineId: r.id }].sort((a, b) => a.day - b.day) }
  })} />, { wide: true })
  const swapSession = (i, k) => openSheet(close => <RoutinePicker routines={g.routines} close={close} onPick={r => setWeek(i, w => ({ ...w, sessions: w.sessions.map((s, n) => n === k ? { ...s, routineId: r.id } : s) }))} />, { wide: true })
  const setDay = (i, k, day) => setWeek(i, w => w.sessions.some((s, n) => n !== k && s.day === day) ? w
    : { ...w, sessions: w.sessions.map((s, n) => n === k ? { ...s, day } : s).sort((a, b) => a.day - b.day) })
  const dropSession = (i, k) => setWeek(i, w => ({ ...w, sessions: w.sessions.filter((_, n) => n !== k) }))
  const addWeek = () => set({ weeks: [...p.weeks, { sessions: [] }] })
  const dropWeek = i => p.weeks.length > 1 && confirmSheet({ title: t('Remove week {0}?', i + 1), message: t('Its sessions are removed from the program.'), confirmText: t('Remove'), danger: true,
    onConfirm: () => set({ weeks: p.weeks.filter((_, k) => k !== i) }) })
  const save = async status => {
    if (!(p.name || '').trim()) { toast(t('Give the program a name')); return }
    setBusy(true)
    try {
      const r = await g.saveProgram({ ...p, status })
      toast(status === 'active' ? t('Published') : t('Saved'))
      if (id === 'new') nav('/trainer/guided/program/' + r.program.id, { replace: true })
      setP(x => ({ ...x, id: r.program.id, status }))
    } catch (e) { toast(e.message); setProblems(e.data?.problems || [e.message]) }
    setBusy(false)
  }
  const sel = (k, label, options) => <label className="cx-field"><span>{label}</span>
    <select className="input" value={p[k] || ''} onChange={e => set({ [k]: e.target.value })}>{options}</select></label>
  const isCustom = p.id && !/^g2j-/.test(p.id)

  return <div className="cx-shell st">
    <header className="st-top">
      <a className="trainer-back" href="#/trainer/guided"><Icon name="chevronLeft" />{t('Studio')}</a>
      <div className="st-title"><input className="st-name" value={p.name ? t(p.name) : ''} placeholder={t('Program name')} maxLength={70} aria-label={t('Program name')} onChange={e => set({ name: e.target.value })} />
        <p className="dim small num">{t('{0} weeks', totals.weeks)} · {t('{0} sessions', totals.sessions)} · ~{totals.minutes} min</p></div>
      <div className="st-top-acts">
        {p.id && <a className="btn plain" href={'#/train2j/program/' + p.id}><Icon name="play" />{t('Preview')}</a>}
        {p.id && <StatusPill x={{ draft: p.status === 'draft', active: p.status === 'active' ? true : p.status === 'hidden' ? false : undefined }} />}
        <button className="btn tinted" disabled={busy} onClick={() => save(p.status === 'active' ? 'active' : p.status === 'hidden' ? 'hidden' : 'draft')}><Icon name="check" />{t('Save')}</button>
        {p.status !== 'active' && <button className="btn primary" disabled={busy || problems.length > 0} onClick={() => save('active')}><Icon name="rocket" />{t('Publish')}</button>}
      </div>
    </header>

    <div className="st-grid">
      <main className="st-weeks">
        {p.weeks.map((w, i) => <section key={i} className="st-week" aria-label={t('Week {0}', i + 1)}>
          <header><h2>{t('Week {0}', i + 1)}</h2>
            <span className="grow" />
            <button className="btn plain" onClick={() => set({ weeks: duplicateWeek(p.weeks, i) })}><Icon name="clipboard" />{t('Copy week')}</button>
            {p.weeks.length > 1 && <button className="btn plain danger" aria-label={t('Remove week {0}', i + 1)} onClick={() => dropWeek(i)}><Icon name="trash" /></button>}
          </header>
          {w.sessions.map((s, k) => { const r = byId.get(s.routineId); return <div key={k} className={'st-session' + (r ? '' : ' bad')}>
            <select className="input st-day" value={s.day} aria-label={t('Day')} onChange={e => setDay(i, k, Number(e.target.value))}>
              {WEEKDAYS.map((d, n) => <option key={n} value={n}>{t(d)}</option>)}</select>
            <button className="st-sessbtn" onClick={() => swapSession(i, k)}>
              {r ? <><WorkoutCover r={r} shape="square" /><span className="grow"><b>{t(r.name)}</b><small className="num">{t(CATEGORY_LABEL[r.category])} · {t(LEVEL_LABEL[r.level])} · ~{r.estimatedMinutes} min</small></span></>
                : <span className="grow"><b>{t('Routine not found')}</b><small>{s.routineId}</small></span>}
            </button>
            <button className="cx-icon" aria-label={t('Remove session')} onClick={() => dropSession(i, k)}><Icon name="xmark" /></button>
          </div> })}
          {w.sessions.length < 7 && <button className="st-add" onClick={() => addSession(i)}><Icon name="plus" />{t('Add a session')}</button>}
        </section>)}
        <button className="btn tinted st-addweek" onClick={addWeek}><Icon name="plus" />{t('Add a week')}</button>
      </main>

      <aside className="st-side">
        <div className="cx-form">
          <label className="cx-field"><span>{t('Description')}</span><textarea className="input" rows={4} maxLength={400} value={p.description ? t(p.description) : ''} onChange={e => set({ description: e.target.value })} /></label>
          <div className="cx-form-row">
            {sel('goal', t('Training goal'), GOALS.map(x => <option key={x} value={x}>{t(GOAL_LABEL[x])}</option>))}
            {sel('level', t('Level'), LEVELS.map(x => <option key={x} value={x}>{t(LEVEL_LABEL[x])}</option>))}
          </div>
          {sel('cover', t('Cover'), ROUTINE_CATEGORIES.map(c => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>))}
          {sel('status', t('State'), STATUSES.map(x => <option key={x} value={x}>{t(STATUS_LABEL[x])}</option>))}
          <label className="cx-check"><input type="checkbox" checked={!!p.featured} onChange={e => set({ featured: e.target.checked })} />{t('Featured')}</label>
        </div>
        <div className={'st-check ' + (problems.length ? 'bad' : 'ok')} role="status">
          <b><Icon name={problems.length ? 'info' : 'checkCircle'} />{problems.length ? t('Needs attention') : t('Ready to publish')}</b>
          {problems.length > 0 ? <ul>{problems.slice(0, 6).map((x, k) => <li key={k}>{x}</li>)}</ul>
            : <p>{t('All routines exist, are active and each week passes the 2J protocol.')}</p>}
        </div>
        {p.id && <HistoryButton id={p.id} />}
        {isCustom && <button className="btn plain danger" onClick={() => confirmSheet({ title: t('Delete this program?'), message: t('People who already started it keep their own copy.'), confirmText: t('Delete'), danger: true,
          onConfirm: async () => { try { await g.removeProgram(p.id); toast(t('Deleted')); nav('/trainer/guided') } catch (e) { toast(e.message) } } })}><Icon name="trash" />{t('Delete program')}</button>}
      </aside>
    </div>
  </div>
}
