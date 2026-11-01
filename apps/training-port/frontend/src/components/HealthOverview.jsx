// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, fmtVol, todayISO } from '../lib/format.js'
import { useUI } from '../store/useUI.js'
import { uxOn } from '../lib/features.js'
import { loadOfWorkouts, muscleOptsOf } from '../lib/muscles.js'
import { activityBlock, trainingBlock, recoveryBlock, compositionBlock, healthState } from '../lib/health-v2.js'
import { Sparkline, ProgressBar } from './v2.jsx'
import BodyMapPanel from './BodyMapPanel.jsx'
import { WhoopCard } from './ProgressModules.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/* Health V2 overview (Experience V2): four compact tiles — Activity · Training · Recovery · Composition — each only when
   there is real data behind it, each opening a short detail (what it is made of, where it comes from). No big empty blocks:
   what is missing becomes ONE compact line about the Health state (not connected / no permission / partial / estimates only).
   PRIVATE: read-only over data the member already holds; it publishes nothing and has no share path. Social V2 may later
   offer a member-chosen item through plain props — nothing here does it.
   Gates: Activity ← admin+member 'health'; Recovery ← 'recovery'; Composition ← 'bodyweight' or 'bioimpedance'. */

const signed = (v, unit) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtNum(Math.abs(v)) + (unit ? ' ' + unit : '')
const time = at => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null

const STATE_TEXT = {
  off: 'Connect {0} to see your steps and energy here.',
  noPermission: '2J has no permission yet to read your steps or energy.',
  partial: 'Some of your data is not shared with 2J — showing what is available.',
  wearable: 'A wearable is recording calories for your workouts.',
  estimateOnly: 'Calories are 2J estimates until a device records them.',
}
export function HealthStateLine({ state, platform, onOpen }) {
  const msg = STATE_TEXT[state]
  if (!msg) return null
  const action = state === 'off' || state === 'noPermission'
  return <div className={'v2-hs ' + state} role="status">
    <Icon name={action ? 'heart' : state === 'wearable' ? 'checkCircle' : 'info'} />
    <span>{t(msg, platform || t('Health'))}</span>
    {action && onOpen && <button type="button" onClick={onOpen}>{t('Open')}</button>}
  </div>
}

function Tile({ icon, tint, title, fig, unit, sub, extra, onClick }) {
  return <button type="button" className="v2-ho-tile v2-surface v2-tap" onClick={onClick}>
    <span className="v2-ho-top"><span className="v2-ho-ic" style={{ '--tint': tint }}><Icon name={icon} /></span><span className="v2-eyebrow">{title}</span></span>
    <span className="v2-ho-fig">{fig}{unit && <small> {unit}</small>}</span>
    {sub && <span className="v2-ho-sub">{sub}</span>}
    {extra}
  </button>
}

function Row({ k, v, sub }) {
  return <div className="v2-hd-row"><span className="k">{k}</span><span className="v">{v}{sub && <small>{sub}</small>}</span></div>
}

function Detail({ title, icon, children, action, close, note }) {
  return <div className="v2-hd">
    <div className="v2-hd-head"><span className="v2-ho-ic"><Icon name={icon} /></span><h3>{title}</h3></div>
    {children}
    {note && <p className="v2-ind-meta"><Icon name="shield" />{note}</p>}
    {action && <Button variant="tinted" onClick={() => { close(); action.go() }}>{action.label}</Button>}
  </div>
}

const open = render => useUI.getState().openSheet(close => render(close))

export default function HealthOverview({ S, user, nav }) {
  const uid = user?.id
  const state = healthState(S, uid)
  const activity = uxOn(S, 'health') ? activityBlock(S, uid) : null
  const training = trainingBlock(S)
  const recovery = uxOn(S, 'recovery') ? recoveryBlock(S) : null
  const comp = uxOn(S, 'bodyweight') || uxOn(S, 'bioimpedance') ? compositionBlock(S) : null
  const whoop = uxOn(S, 'recovery') && !!user?.whoop
  const tiles = [activity, training, (recovery || whoop), comp].filter(Boolean)
  if (!tiles.length && !['off', 'noPermission'].includes(state.state)) return null
  const goHealth = () => nav('/health/integrations')
  const private_ = t('Visual information, not a diagnosis. It stays private to you.')

  return <section className="v2-ho" data-private="true" aria-label={t('Health overview')}>
    {tiles.length > 0 && <div className="v2-ho-grid">
      {activity && <Tile icon="figureRun" tint="var(--orange)" title={t('Activity')}
        fig={activity.steps != null ? fmtNum(activity.steps) : fmtNum(activity.activeKcal)} unit={activity.steps != null ? t('steps') : 'kcal'}
        sub={activity.steps != null && activity.activeKcal != null ? `${fmtNum(activity.activeKcal)} kcal · ${t('active')}` : t('Today')}
        onClick={() => open(close => <Detail title={t('Activity today')} icon="figureRun" close={close} note={private_} action={{ label: t('Fitness integrations'), go: goHealth }}>
          {activity.steps != null && <Row k={t('Steps')} v={fmtNum(activity.steps)} />}
          {activity.activeKcal != null && <Row k={t('Active energy')} v={`${fmtNum(activity.activeKcal)} kcal`} sub={t('Read from {0}', activity.platform || t('Health'))} />}
          <p className="v2-ind-basis">{t('Read from {0} on this device at the last sync{1}. 2J shows it as the health store reports it and does not add sources together.', activity.platform || t('Health'), time(activity.at) ? ' (' + time(activity.at) + ')' : '')}</p>
        </Detail>)} />}

      {training && <Tile icon="dumbbell" tint="var(--acc)" title={t('Training')}
        fig={training.sessions} unit={t(training.sessions === 1 ? 'session' : 'sessions')}
        sub={training.minutes ? `${fmtNum(training.minutes)} min${training.perWeek != null ? ' · ' + fmtNum(training.perWeek) + '×/' + t('wk') : ''}` : (training.perWeek != null ? fmtNum(training.perWeek) + '×/' + t('wk') : t('This week'))}
        onClick={() => open(close => <Detail title={t('Training this week')} icon="dumbbell" close={close} note={private_} action={{ label: t('View progress'), go: () => nav('/stats') }}>
          <Row k={t('Sessions')} v={training.sessions} />
          {training.minutes > 0 && <Row k={t('Time trained')} v={`${fmtNum(training.minutes)} min`} />}
          {training.sets > 0 && <Row k={t('Sets')} v={training.sets} />}
          {training.volume != null && <Row k={t('Volume')} v={fmtVol(training.volume, S.unit)} />}
          {training.perWeek != null && <Row k={t('Frequency')} v={`${fmtNum(training.perWeek)}×/${t('wk')}`} sub={t('last 4 weeks')} />}
          <BodyMapPanel load={loadOfWorkouts((S.workouts || []).filter(w => w.d >= weekStart()), null, muscleOptsOf(S))} body={S.body} top={3} S={S} />
        </Detail>)} />}

      {(recovery || whoop) && <Tile icon="bolt" tint="var(--green)" title={t('Recovery')}
        fig={recovery?.restingHr ? recovery.restingHr.bpm : recovery?.sessionHr ? recovery.sessionHr.avg : 'WHOOP'}
        unit={recovery ? t('bpm') : null}
        sub={recovery?.restingHr ? t('Resting HR') : recovery?.sessionHr ? t('Avg HR, last session') : t('Connected')}
        onClick={() => open(close => <Detail title={t('Recovery')} icon="bolt" close={close} note={private_} action={{ label: t('Fitness integrations'), go: goHealth }}>
          {recovery?.restingHr && <Row k={t('Resting HR')} v={`${recovery.restingHr.bpm} ${t('bpm')}`} sub={fmtDate(recovery.restingHr.d)} />}
          {recovery?.sessionHr && <Row k={t('Avg HR, last session')} v={`${recovery.sessionHr.avg} ${t('bpm')}`} sub={`${t(recovery.sessionHr.source)} · ${fmtDate(recovery.sessionHr.d)}`} />}
          {recovery?.sessionHr?.max && <Row k={t('Session max HR')} v={`${recovery.sessionHr.max} ${t('bpm')}`} />}
          <WhoopCard nav={nav} connected={!!user?.whoop} />
          <p className="v2-ind-basis">{t('Only what your devices recorded is shown. 2J does not turn it into a readiness score.')}</p>
        </Detail>)} />}

      {comp && <Tile icon="scale" tint="var(--teal)" title={t('Composition')}
        fig={comp.weight ? fmtNum(comp.weight.v) : fmtNum(comp.scan[0].v)} unit={comp.weight ? S.unit : comp.scan[0].unit}
        sub={comp.delta != null ? `${signed(comp.delta, S.unit)} · 3M` : comp.weight ? fmtDate(comp.weight.d) : t(comp.scan[0].label)}
        extra={<Sparkline points={comp.points} width={110} height={26} label={t('Weight, last 3 months')} />}
        onClick={() => open(close => <Detail title={t('Weight & composition')} icon="scale" close={close} note={private_} action={{ label: t('Measurements'), go: () => nav('/measurements') }}>
          {comp.weight && <Row k={t('Weight')} v={`${fmtNum(comp.weight.v)} ${S.unit}`} sub={fmtDate(comp.weight.d)} />}
          {comp.delta != null && <Row k={t('Change, 3 months')} v={signed(comp.delta, S.unit)} />}
          <Sparkline points={comp.points} width={280} height={56} label={t('Weight, last 3 months')} />
          {comp.goal && <><Row k={t('Goal')} v={`${fmtNum(comp.goal.target)} ${S.unit}`} sub={comp.goal.toGo === 0 ? t('Reached') : t('{0} to go', fmtNum(Math.abs(comp.goal.toGo)))} />
            <ProgressBar value={goalProgress(S, comp)} label={t('Goal')} /></>}
          {comp.scan.map(s => <Row key={s.key} k={t(s.label)} v={`${fmtNum(s.v)} ${s.unit}`} sub={fmtDate(s.d)} />)}
          {comp.scan.length > 0 && <p className="v2-ind-basis">{t('Body-composition values come from your scans; 2J shows them without judging them.')}</p>}
        </Detail>)} />}
    </div>}
    <HealthStateLine state={state.state} platform={state.platform} onOpen={goHealth} />
  </section>
}

function weekStart() {
  const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
// Progress towards the goal from the member's first weight in the last 3 months — only when there is a base and a direction.
function goalProgress(S, comp) {
  const first = comp.points[0]
  if (!comp.goal || first == null || !comp.weight) return 0
  const total = comp.goal.target - first, done = comp.weight.v - first
  return total === 0 ? 1 : Math.max(0, Math.min(1, done / total))
}
