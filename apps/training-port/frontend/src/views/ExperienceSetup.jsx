// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { PRESETS, configurable, currentUses, makeUx, allowedByAdmin } from '../lib/features.js'
import { PROGRESS_CARDS, normalizeProgress, progressOrder, progressChoice, recommendedFor } from '../lib/progress-cards.js'
import { HOME_BLOCKS, homeLayoutOf, homeChoice, defaultHomeLayout } from '../lib/home-blocks.js'
import { orderedBodyWeightSeries } from '../lib/bodyweight.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'
import './experience.css'

/* "Personalise my experience" — ONE configurator, two entry points: a short visual setup right after a brand-new profile
   finishes the physical-profile wizard (App.jsx), and Settings → My experience (route /settings/experience) for anyone,
   any time. It only writes S.ux (lib/features.js): the member's own choices, narrowing what the admin allows. Cards for
   features the admin turned off are not offered, so there is never a switch that does nothing. */

const PRESET_CARDS = [
  { id: 'simple', icon: 'dumbbell', title: 'Just train', sub: 'Log weights and reps. Nothing else in the way.' },
  { id: 'balanced', icon: 'chart', title: 'Balanced', sub: 'Tips, recovery and your body weight — without the heavy analysis.' },
  { id: 'complete', icon: 'sparkles', title: 'Everything', sub: 'Effort, volume, health, the Coach… all the depth 2J has.' },
]

const GROUPS = [
  { id: 'training', title: 'Training', lead: 'How much do you want to track while you train?', items: [
    { key: 'effort', icon: 'flame', title: 'Effort (RPE / RIR)', sub: 'Note how hard each set felt — how many reps you had left.' },
    { key: 'volume', icon: 'chart', title: 'Volume & progress analysis', sub: 'See how many sets each muscle gets per week and how your training is spread.' },
    { key: 'suggestions', icon: 'sparkles', title: 'Suggestions & progression', sub: 'Gentle tips and what weight to aim for next. It never changes your plan by itself.' },
    { key: 'train2j', icon: 'dumbbell', title: 'Train with 2J', sub: 'Ready-to-start workouts: Tabata, HIIT, circuits, cardio and mobility.' },
  ] },
  { id: 'health', title: 'Health', lead: 'What about your body do you want to follow?', items: [
    { key: 'bodyweight', icon: 'scale', title: 'Body weight', sub: 'Log your weight and watch how it changes.' },
    { key: 'bioimpedance', icon: 'figureStrength', title: 'Body composition', sub: 'Bioimpedance scans and measurements, with a reminder when it is time for a new one.' },
    { key: 'health', icon: 'heart', title: 'Health & daily activity', sub: 'Steps, sleep and heart rate from your phone or watch.' },
    { key: 'recovery', icon: 'bolt', title: 'Recovery', sub: 'A simple map of which muscles are ready to train again.' },
    { key: 'activity', icon: 'figureRun', title: 'Activity indicators', sub: 'Three rings on Home: your training, your daily activity and your recovery.' },
    { key: 'timeline', icon: 'chartLine', title: 'Progress timeline', sub: 'A short timeline of your latest sessions, records and milestones.' },
  ] },
  { id: 'experience', title: 'Experience', lead: 'Help and company along the way.', items: [
    { key: 'helps', icon: 'checkCircle', title: 'Visual hints', sub: 'Short explanations the first time you meet something new.' },
    { key: 'coach', icon: 'sparkles', title: 'AI Coach', sub: 'Builds and adjusts your plan from what you log, if your gym offers it.' },
    { key: 'social', icon: 'users', title: 'Social', sub: 'Friends, chat, challenges and the community wall.' },
  ] },
]

// Groups reduced to what can really be switched (admin-allowed + the member-only hints); empty groups vanish.
export function visibleGroups() {
  const ok = new Set(configurable())
  return GROUPS.map(g => ({ ...g, items: g.items.filter(i => ok.has(i.key)) })).filter(g => g.items.length)
}

function PrefCard({ item, on, onChange }) {
  return <div className={'ux-card' + (on ? ' on' : '')}>
    <span className="ux-ico"><Icon name={item.icon} /></span>
    <div className="ux-txt"><div className="ux-t">{t(item.title)}</div><div className="ux-s">{t(item.sub)}</div></div>
    <Switch checked={on} onChange={onChange} />
  </div>
}

function Presets({ onPick, active }) {
  return <div className="ux-presets">
    {PRESET_CARDS.map(p => <button key={p.id} type="button" className={'ux-preset' + (active === p.id ? ' on' : '')} onClick={() => onPick(p.id)}>
      <span className="ux-ico"><Icon name={p.icon} /></span>
      <span className="ux-txt"><span className="ux-t">{t(p.title)}</span><span className="ux-s">{t(p.sub)}</span></span>
    </button>)}
  </div>
}

// Which preset the current choices equal (for the highlight), looking only at what is configurable.
// A Progress block is offered when the feature behind it is on (the member's own switch above AND the gym's), so there is never a row that does nothing.
const cardOffered = (card, uses) => !card.feature || (uses[card.feature] !== false && allowedByAdmin(card.feature))

// One editor for both layouts (Progress page and Home): `cards` is the closed catalogue, a card with `optional: false` can be moved but not hidden.
function ProgressLayout({ layout, setLayout, uses, cards = PROGRESS_CARDS }) {
  const listed = layout.order.filter(id => cardOffered(cards.find(c => c.id === id), uses))
  const move = (id, dir) => setLayout(l => {
    const L = l.order.filter(i => cardOffered(cards.find(c => c.id === i), uses))
    const a = L.indexOf(id), b = a + dir
    if (a < 0 || b < 0 || b >= L.length) return l
    const order = [...l.order]; const pa = order.indexOf(L[a]), pb = order.indexOf(L[b]); [order[pa], order[pb]] = [order[pb], order[pa]]
    return { ...l, order }
  })
  const toggle = (id, on) => setLayout(l => ({ ...l, hidden: on ? l.hidden.filter(h => h !== id) : [...l.hidden, id] }))
  return <div className="ux-pc">
    {listed.map((id, i) => {
      const c = cards.find(x => x.id === id), on = !layout.hidden.includes(id), fixed = cards === HOME_BLOCKS && !c.optional
      return <div key={id} className={'ux-pc-row' + (on ? '' : ' off')}>
        <span className="ux-ico"><Icon name={c.icon} /></span>
        <span className="ux-pc-t">{t(c.label)}</span>
        <button type="button" className="iconbtn ux-pc-mv" disabled={i === 0} onClick={() => move(id, -1)} aria-label={t('Move up: {0}', t(c.label))}><Icon name="arrowUp" /></button>
        <button type="button" className="iconbtn ux-pc-mv" disabled={i === listed.length - 1} onClick={() => move(id, 1)} aria-label={t('Move down: {0}', t(c.label))}><Icon name="arrowDown" /></button>
        {fixed ? <span className="ux-pc-fixed muted small">{t('Always shown')}</span> : <Switch checked={on} onChange={v => toggle(id, v)} />}
      </div>
    })}
  </div>
}

const presetOf = (uses, keys) => PRESET_CARDS.find(p => keys.every(k => (PRESETS[p.id][k] !== false) === (uses[k] !== false)))?.id || null

export default function ExperienceSetup({ mode = 'settings' }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  useStore(s => s.features)   // re-render if the admin's switches arrive while this is open
  const update = useStore(s => s.update)
  const onboarding = mode === 'onboarding'
  const groups = visibleGroups()
  const keys = groups.flatMap(g => g.items.map(i => i.key))
  const [uses, setUses] = useState(() => onboarding ? { ...currentUses(S), ...PRESETS.balanced } : currentUses(S))
  const [step, setStep] = useState(0)          // onboarding: 0 = presets, 1..n = groups
  // The Progress-page layout being edited: the saved one, or the default when never touched (S.ux.progress absent).
  const [layout, setLayout] = useState(() => ({ order: progressOrder(S), hidden: normalizeProgress(S.ux?.progress).hidden }))
  // The Home layout being edited: the saved one, or the default when never touched (S.ux.home absent).
  const [home, setHome] = useState(() => homeLayoutOf(S))
  const set = (k, v) => setUses(u => ({ ...u, [k]: v }))
  // Applying a preset (or restoring the recommended settings) is the ONLY moment the member's goal shapes the layout; afterwards their choices rule.
  const recommend = id => {
    const r = recommendedFor(S, PRESETS[id], { minimal: id === 'simple', logged: { bodyweight: orderedBodyWeightSeries(S).length > 0 } })
    setUses(u => ({ ...u, ...r.uses }))
    setLayout({ order: progressOrder({ ux: { progress: r.progress } }), hidden: [] })
  }
  const pick = recommend

  const save = () => {
    update(s => { s.ux = makeUx(uses, Date.now(), { progress: progressChoice(layout.order, layout.hidden), home: homeChoice(home.order, home.hidden), guide: S.ux?.guide }); s.uxSetup = false; s.uxInviteDismissed = true })
    if (!onboarding) nav('/settings')
  }
  const skip = () => update(s => { s.uxSetup = false })   // keeps everything on (S.ux stays null)

  const last = step === groups.length
  const body = onboarding
    ? (step === 0
      ? <><h1 className="ux-h">{t('How do you want to use 2J?')}</h1><p className="ux-lead">{t('Pick a starting point. You can change every detail now or later in Settings.')}</p>
        <Presets onPick={id => { pick(id); setStep(1) }} active={presetOf(uses, keys)} /></>
      : <><h1 className="ux-h">{t(groups[step - 1].title)}</h1><p className="ux-lead">{t(groups[step - 1].lead)}</p>
        <div className="ux-list">{groups[step - 1].items.map(i => <PrefCard key={i.key} item={i} on={uses[i.key] !== false} onChange={v => set(i.key, v)} />)}</div></>)
    : <>
      <h4 className="sec">{t('Start from')}</h4>
      <Presets onPick={pick} active={presetOf(uses, keys)} />
      <Button size="sm" variant="plain" icon="reset" onClick={() => recommend(presetOf(uses, keys) || 'balanced')}>{t('Restore recommended settings')}</Button>
      {groups.map(g => <div key={g.id}><h4 className="sec">{t(g.title)}</h4>
        <div className="ux-list">{g.items.map(i => <PrefCard key={i.key} item={i} on={uses[i.key] !== false} onChange={v => set(i.key, v)} />)}</div></div>)}
      <h4 className="sec">{t('Home')}</h4>
      <p className="ux-lead" style={{ margin: '0 0 8px' }}>{t('Choose which blocks Home shows and in which order.')}</p>
      <ProgressLayout layout={home} setLayout={setHome} uses={uses} cards={HOME_BLOCKS} />
      <Button size="sm" variant="plain" icon="reset" onClick={() => setHome(defaultHomeLayout())}>{t('Restore default Home layout')}</Button>
      <h4 className="sec">{t('Progress page')}</h4>
      <p className="ux-lead" style={{ margin: '0 0 8px' }}>{t('Show or hide each block and put them in the order you like.')}</p>
      <ProgressLayout layout={layout} setLayout={setLayout} uses={uses} />
      <p className="ux-foot">{t('Nothing is deleted: turning something off only hides it, and your data stays. Your gym may also switch some features off for everyone.')}</p>
    </>

  // Nothing configurable (the admin switched everything off): there is nothing to ask.
  const empty = onboarding && !groups.length
  useEffect(() => { if (empty) skip() }, [empty])
  if (empty) return null

  return <div className="narrow ux-page" style={onboarding ? { minHeight: '100vh', paddingBottom: 90 } : undefined}>
    {onboarding
      ? <div className="row between" style={{ marginBottom: 14 }}>
        {step > 0 ? <button className="iconbtn" onClick={() => setStep(step - 1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button> : <div style={{ width: 36 }} />}
        <Button size="sm" variant="tinted" onClick={skip}>{t('Skip for now')}</Button>
      </div>
      : <div className="hdr"><button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
        <div><h1>{t('Personalise my experience')}</h1><div className="sub">{t('Choose what you want to see. Change it any time.')}</div></div></div>}

    {onboarding && <div className="row" style={{ gap: 5, margin: '0 0 22px' }}>
      {[0, ...groups.map((_, i) => i + 1)].map(i => <div key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i <= step ? 'var(--acc)' : 'var(--surface-3)' }} />)}
    </div>}

    {body}

    {(!onboarding || step > 0) && <div className={'ux-cta' + (onboarding ? ' ob' : '')}>
      {onboarding && !last
        ? <Button variant="primary" onClick={() => setStep(step + 1)}>{t('Continue')}</Button>
        : <Button variant="primary" onClick={save}>{onboarding ? t('Finish') : t('Save')}</Button>}
    </div>}
  </div>
}
