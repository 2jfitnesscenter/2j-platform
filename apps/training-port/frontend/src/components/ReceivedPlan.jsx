import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t, nameFor } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { uid, fmtDate, exCount, routineCount } from '../lib/format.js'
import { exLine } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { GOAL_LABEL } from '../lib/plan-cards.js'
import { saveSharedRoutine, saveSharedProgram, savedShare, resolveStart, estimateMinutes, sharedFit } from '../lib/shared-plans.js'
import { discardSocialShare } from '../lib/social-api.js'
import { startFlow } from '../sheets.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import ReportContentButton from './ReportContentButton.jsx'

const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
const FIT_LABEL = { compatible: 'Compatible with this place', partial: 'Partially compatible', requires: 'Needs other equipment' }
const ORIGIN_LABEL = { plan: 'From their plan', '2j': 'A 2J workout', community: 'From the community' }

function Exercises({ routine, unit }) {
  const defs = Object.fromEntries((routine.customExDefs || []).map(d => [d.id, d]))
  return <div className="list rcv-ex">
    {routine.ex.map((e, i) => {
      const ex = defs[e.id] || exOr(e.id)
      return <div key={i} className="item"><Thumb ex={ex} /><div className="grow"><div className="tt capitalize">{nameFor(ex)}</div><div className="ss">{exLine(e, unit)}</div></div></div>
    })}
  </div>
}

/**
 * The single screen for a routine or program a friend sent privately: who sent it, what is in it, whether it works where this person trains,
 * and three choices — save a copy, start it, or set it aside. Everything it shows comes from the snapshot the server kept; the sender's own
 * routine is not consulted, so it stays whole even if they change or delete theirs.
 */
export default function ReceivedPlan({ item, onChanged }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const { snapshot, meta = {} } = item.content
  const program = item.kind === 'program'
  const routines = program ? snapshot.routines : [snapshot]
  const saved = savedShare(S, item)
  const fit = sharedFit(S, routines)
  const minutes = routines.map(r => estimateMinutes(r))
  const perWorkout = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length)   // a program's length is what one workout takes, not the sum of all
  const sender = meta.senderLabel || item.authorName

  const save = () => {
    let result
    update(s => { result = program ? saveSharedProgram(s, item, { makeId: uid }) : saveSharedRoutine(s, item, { makeId: uid }) })
    if (result?.ok) toast(program ? t('Saved to your programs') : t('Saved to your routines'))
    else if (result?.reason === 'already-saved') toast(t('Already saved'))
    else toast(t('Could not save this'))
    return result
  }
  const start = () => {
    let go
    update(s => { go = resolveStart(s, item, { makeId: uid }) })
    if (!go?.ok) { toast(t('Could not save this')); return }
    if (go.created) toast(program ? t('Saved to your programs') : t('Saved to your routines'))
    if (program) nav('/plan/p/' + go.id)
    else startFlow(go.id)
  }
  const discard = async () => {
    setBusy(true)
    try { await discardSocialShare(item.id); toast(t('Set aside')); onChanged?.() }
    catch (e) { toast(e.message) }
    finally { setBusy(false) }
  }

  return <article className="rcv">
    <p className="rcv-from"><Icon name="person" /><span><b className="capitalize">{sender}</b> {t(program ? 'sent you a program' : 'sent you a routine')} · {fmtDate(new Date(item.createdAt).toISOString().slice(0, 10))}</span></p>
    <h2 className="rcv-title">{snapshot.name}</h2>
    <dl className="rcv-facts">
      <div><dt>{program ? t('Per workout') : t('Duration')}</dt><dd className="num">{meta.duration || `~${perWorkout} min`}</dd></div>
      {meta.level && <div><dt>{t('Level')}</dt><dd>{t(LEVEL_LABEL[meta.level])}</dd></div>}
      {meta.goal && <div><dt>{t('Training goal')}</dt><dd>{t(GOAL_LABEL[meta.goal])}</dd></div>}
      <div><dt>{program ? t('Routines') : t('Exercises')}</dt><dd className="num">{program ? routines.length : routines[0].ex.length}</dd></div>
      {meta.origin && ORIGIN_LABEL[meta.origin] && <div><dt>{t('Origin')}</dt><dd>{t(ORIGIN_LABEL[meta.origin])}</dd></div>}
    </dl>

    <section className={'t2-fitbox ' + fit.level} aria-label={t('Your gym')}>
      <h3>{t(FIT_LABEL[fit.level])}</h3>
      {fit.level === 'compatible' ? <p>{t('Everything in this works with the equipment of your current place.')}</p>
        : <><p>{fit.equipment.length ? t('Missing here: {0}', fit.equipment.join(', ')) : t('{0} of {1} exercises need equipment not confirmed here. You can swap them for alternatives while you train.', fit.missing, fit.total)}</p>
          <ul>{fit.missingIds.slice(0, 6).map(id => <li key={id}>{nameFor(exOr(id))}</li>)}</ul></>}
    </section>

    {program ? routines.map((r, i) => <details key={i} className="rcv-routine" open={routines.length <= 2}>
      <summary><span className="grow"><b>{r.name}</b><small>{exCount(r.ex.length)} · ~{minutes[i]} min</small></span><Icon name="chevronDown" /></summary>
      <Exercises routine={r} unit={S.unit} />
    </details>) : <>
      <h3 className="rcv-h">{t('Exercises')}</h3>
      <Exercises routine={routines[0]} unit={S.unit} />
    </>}
    {program && <p className="rcv-note">{routineCount(routines.length)} · {t('The routines are saved with the program; later changes by the sender never reach your copy.')}</p>}

    {item.discarded && <p className="rcv-set-aside" role="status"><Icon name="info" />{t('You set this aside. You can still save it.')}</p>}

    <div className="rcv-cta" role="group" aria-label={t('What do you want to do?')}>
      {!item.discarded && !saved && <button className="btn plain" disabled={busy} onClick={discard}>{t('Not now')}</button>}
      <button className={'btn tinted rcv-save' + (saved ? ' on' : '')} disabled={!!saved} onClick={save}><Icon name={saved ? 'checkCircle' : 'plus'} />{saved ? t('Saved') : t('Save')}</button>
      <button className="btn primary rcv-start" onClick={start}><Icon name={program ? 'calendar' : 'play'} />{program ? t('Open program') : t('Start')}</button>
    </div>
    <div className="rcv-foot"><ReportContentButton targetType="share" targetId={item.id} /></div>
  </article>
}
