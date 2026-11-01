import { useNavigate, useParams } from 'react-router-dom'
import { RoutineHero } from '../components/DetailHeroes.jsx'
import { coverSheet } from '../components/CoverSheet.jsx'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { dayPlanRoutineId, parseMovedDay } from '../lib/day-plan.js'
import { useUI } from '../store/useUI.js'
import { exOr, isUnavailable } from '../lib/exercises.js'
import { uid, fmtDate } from '../lib/format.js'
import { t, nameFor } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine } from '../lib/history.js'
import { supersetGroupInfo, supersetLabel } from '../lib/superset-colors.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, alternativesSheet, exConfigSheet, confirmSheet, exerciseMenuSheet, exerciseNotesSheet, supersetPickerSheet, celebrateBadges } from '../sheets.jsx'
import { printRoutine } from '../lib/plan-share.js'
import { routineShare } from '../lib/shared-plans.js'
import { openPrivatePlanShare } from '../lib/open-private-share.jsx'
import { evaluateBadgesIn } from '../lib/badges.js'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, SelectRow } from '../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap, { MuscleIcon } from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, pctOf, MUSCLE_NAME, muscleOptsOf } from '../lib/muscles.js'
import { mediaUrl } from '../lib/media.js'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  const move = (i, dir) => edit(ex => { const j = i + dir; if (j < 0 || j >= ex.length) return;[ex[i], ex[j]] = [ex[j], ex[i]]; cleanupSg(ex) })
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })
  const removeAt = i => edit(ex => { ex.splice(i, 1); cleanupSg(ex) })
  // The member's own "don't offer me this again" list (RoutineEdit's "…" menu) — gym-wide
  // admin hiding is a separate, global mechanism (isHidden/setHiddenExercises); this one is
  // per-profile and only ever affects what a picker offers from here on, see allExercises().
  const excludeEx = exId => update(s => { if (!(s.excludedEx || []).includes(exId)) (s.excludedEx = s.excludedEx || []).push(exId) })
  // Leaving a superset just drops this entry's own sg (cleanupSg then strips it from whatever
  // partner is left without a match) — joining one reuses the current entry's sg if it's already
  // in a group, so a third exercise can chain onto an existing pair instead of always making
  // a brand-new pair.
  const leaveSuperset = i => edit(ex => { delete ex[i].sg; cleanupSg(ex) })
  const joinSuperset = (i, j) => edit(ex => {
    const cur = ex[i]
    const target = ex.splice(j, 1)[0]
    const newI = j < i ? i - 1 : i
    ex.splice(newI + 1, 0, target)
    const gid = cur.sg || ('sg' + uid())
    ex[newI].sg = gid; target.sg = gid
    cleanupSg(ex)
  })

  const menuActions = (ex, e, i) => ({
    onReplace: () => alternativesSheet(ex, newEx => {
      edit(x => { x[i] = { ...x[i], id: newEx.id } })
      toast(t('Replaced with {0}', nameFor(newEx)))
    }),
    onReplaceExclude: () => alternativesSheet(ex, newEx => {
      edit(x => { x[i] = { ...x[i], id: newEx.id } })
      excludeEx(ex.id)
      toast(t('{0} won’t be suggested again', nameFor(ex)))
    }),
    onProgression: () => exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => removeAt(i), r),
    onSuperset: () => e.sg ? leaveSuperset(i) : supersetPickerSheet(r, i, j => joinSuperset(i, j)),
    onDropsetToggle: () => edit(x => { x[i].dropset = !x[i].dropset }),
    onNotes: () => exerciseNotesSheet(ex, e, note => edit(x => { if (note) x[i].note = note; else delete x[i].note })),
    onRemove: () => removeAt(i),
    onRemoveExclude: () => confirmSheet({
      title: t('Remove and don’t recommend?'), message: t('“{0}” leaves this routine and won’t be suggested to you again.', nameFor(ex)),
      confirmText: t('Remove'), danger: true, onConfirm: () => { removeAt(i); excludeEx(ex.id) }
    }),
  })

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  const ssInfo = supersetGroupInfo(r.ex)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Library')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} style={r.image ? { overflow: 'hidden', padding: 0 } : undefined}
        onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }),
          { image: r.image, onImage: imgId => update(s => { s.routines.find(x => x.id === id).image = imgId }) })}>
        {r.image ? <img src={mediaUrl(r.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={glyphOf(r.emoji)} />}
      </button>
      <button className="iconbtn" aria-label={t('Send to a friend')} title={t('Send to a friend')} disabled={!r.ex.length}
        onClick={() => openPrivatePlanShare(routineShare(S, r), r.name)}><Icon name="send" /></button>
      <button className="iconbtn" aria-label={t('Print routine')} title={t('Print routine')} disabled={!r.ex.length}
        onClick={() => {
          printRoutine(r, user?.name || '', S.unit)
          celebrateBadges(evaluateBadgesIn(update, s => { s.badgeFlags = { ...(s.badgeFlags || {}), sharedRoutine: true } }))
        }}><Icon name="download" /></button>
    </div>

    {r.fromShare && <p className="rcv-origin"><Icon name="users" />{t('Sent by {0}', r.fromShare.senderLabel)} · {fmtDate(new Date(r.fromShare.createdAt).toISOString().slice(0, 10))}</p>}
    <RoutineHero r={r} S={S} onCover={() => coverSheet({ image: r.image, name: r.name, onChange: imgId => update(s => { const x = s.routines.find(y => y.id === id); if (imgId) x.image = imgId; else delete x.image }) })} />

    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r, muscleOptsOf(S))
      const { worked } = rankOf(load)
      const pct = pctOf(load)
      return <>
        <h4 className="sec">{t('Muscle distribution')}</h4>
        <div className="mgrid" style={{ marginBottom: 16 }}>
          {worked.map(m => <div key={m} className="mitem">
            <div className="mitem-icon"><MuscleIcon slug={m} body={S.body} /></div>
            <div className="mitem-t">
              <div className="mitem-name">{t(MUSCLE_NAME[m])}</div>
              <div className="mitem-pct">{pct[m]}%</div>
            </div>
          </div>)}
        </div>
      </>
    })()}

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>

    {r.ex.length ? <div className="list">{r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const info = ssInfo[i]
      const ssStyle = info ? { '--ss-color': `var(--${info.token})` } : undefined
      return <div key={i} style={ssStyle}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" />{t('Superset')}</div>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => {
          exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => removeAt(i), r)
        }}>
          <Thumb ex={ex} />
          <div className="grow">
            <div className="tt capitalize">{info && <span className="ss-badge">{supersetLabel(info)}</span>}{nameFor(ex)}</div>
            <div className="ss">{isUnavailable(ex) ? <span style={{ color: 'var(--orange)' }}>{t('Not currently offered — skipped when you start this workout')}</span> : exLine(e, S.unit)}
              {e.dropset && <span className="tag acc" style={{ marginLeft: 6 }}>{t('Dropset')}</span>}</div>
            {e.note && <div className="ss">{e.note}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            <button className="iconbtn" aria-label={t('More options')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }}
              onClick={ev => { ev.stopPropagation(); exerciseMenuSheet(ex, e, menuActions(ex, e, i)) }}><Icon name="moreH" /></button>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" aria-label={t('Move up')} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
              <button className="iconbtn" aria-label={t('Move down')} style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
            </div>
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r, muscleOptsOf(S))
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}</div>
    <Button variant="primary" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan).forEach(k => {
            const value = s.dayPlan[k], move = parseMovedDay(value)
            if (dayPlanRoutineId(value) === id) {
              if (move && s.dayPlan[move.to] === id) delete s.dayPlan[move.to]
              delete s.dayPlan[k]
            }
          })
          ;(s.programs || []).forEach(p => {
            p.routineIds = (p.routineIds || []).filter(x => x !== id)
            if (p.week) Object.keys(p.week).forEach(k => { if (p.week[k] === id) delete p.week[k] })
          })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}
