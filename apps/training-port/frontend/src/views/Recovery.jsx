// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import RecoveryRing from '../components/RecoveryRing.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { recoveryOf, overallRecovery, recoveryColor, hoursToReady, GROUPS, GROUP_LABEL, GROUP_MUSCLES, MUSCLE_NAME } from '../lib/recovery.js'

function RecoveryLegend() {
  return <div className="hm-legend" style={{ justifyContent: 'center', gap: 16 }}>
    <span className="row" style={{ gap: 4 }}><i className="hm-c" style={{ background: 'var(--red)' }} />{t('Fatigued')}</span>
    <span className="row" style={{ gap: 4 }}><i className="hm-c" style={{ background: 'var(--yellow)' }} />{t('Recovering')}</span>
    <span className="row" style={{ gap: 4 }}><i className="hm-c" style={{ background: 'var(--green)' }} />{t('Ready')}</span>
  </div>
}

// The bar+% row already told you *how much*; the trailing note tells you *when* — the same
// exponential curve read forward instead of just at "now", so it agrees with the % by
// construction rather than being a second, independent guess (see lib/recovery.js's
// hoursToReady). Nothing to say once a muscle is already in the green.
function MuscleRow({ slug, value, recovery }) {
  const color = recoveryColor(value)
  const eta = hoursToReady(recovery, slug)
  return <div className="item">
    <div className="grow">
      <div className="row between">
        <span className="tt">{t(MUSCLE_NAME[slug])}</span>
        <span className="small" style={{ color, fontWeight: 600 }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: value + '%', background: color, borderRadius: 99 }} />
      </div>
      {eta > 0 && <div className="dim small" style={{ marginTop: 4 }}>{t('Ready in ~{0}h', eta)}</div>}
    </div>
  </div>
}

function InfoSheet() {
  return <>
    <h3>{t('How recovery works')}</h3>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('About')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Muscle recovery estimates how ready each muscle group is to train again, based on your recently logged sets.')}
    </div>
    <h4 className="sec">{t('How it’s calculated')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('We give more weight to recent sessions. Each set counts for the muscle it targets — full for the main muscle, half for supporting ones — more reps count for more, and a set taken closer to failure (RIR/RPE) counts for more too. Time-based work (holds, cardio) isn’t included.')}
    </div>
    <h4 className="sec">{t('Recovery windows')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Bigger muscle groups (back, quads, hamstrings, glutes) take longer to read as fully recovered — up to 72h — than smaller ones (chest, shoulders, arms, calves, core), which clear in about 48h.')}
    </div>
    <h4 className="sec">{t('Keep in mind')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5 }}>
      {t('This is only an estimate. It doesn’t account for sleep, stress or nutrition. Custom exercises need a muscle tag to be included.')}
    </div>
  </>
}

export default function Recovery() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const recovery = recoveryOf(S)
  const overall = overallRecovery(recovery)
  const [sel, setSel] = useState(null)
  const groupAvg = g => Math.round(GROUP_MUSCLES[g].reduce((s, m) => s + recovery[m], 0) / GROUP_MUSCLES[g].length)
  // Traffic-light colours, not a single-accent intensity ramp — the diagram should read at a
  // glance the same way the ring and the list below it already do, not need its own legend to
  // decode a different scale.
  const colorOf = slug => recoveryColor(recovery[slug] ?? 100)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Muscle recovery')}</h1></div>
      <button className="iconbtn" onClick={() => openSheet(() => <InfoSheet />)} aria-label={t('How recovery works')}><Icon name="info" /></button>
    </div>

    <div className="card" style={{ textAlign: 'center' }}>
      <div className="row" style={{ justifyContent: 'center', marginBottom: 8 }}><RecoveryRing value={overall} size={110} stroke={11} /></div>
      <div className="tt" style={{ fontWeight: 600 }}>{t('Overall recovery')}</div>
      <div className="muted small" style={{ marginTop: 2 }}>{t('Average recovery across every muscle group, based on your recent training.')}</div>
    </div>

    <BodyMap className="tappable" colorOf={colorOf} selected={sel} onMuscle={m => setSel(s => (s === m ? null : m))} body={S.body} />
    <RecoveryLegend />
    {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 8, paddingTop: 10 }}>
      <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
      <span className="v" style={{ color: recoveryColor(recovery[sel]), fontWeight: 600 }}>{recovery[sel]}%</span>
    </div>}
    <div style={{ height: 14 }} />

    {GROUPS.map(g => <div key={g} style={{ marginBottom: 18 }}>
      <h4 className="sec">{t(GROUP_LABEL[g])}</h4>
      <div className="list" style={{ gap: 0 }}>
        {GROUP_MUSCLES[g].map(slug => <MuscleRow key={slug} slug={slug} value={recovery[slug]} recovery={recovery} />)}
      </div>
    </div>)}
    <div style={{ height: 20 }} />
  </div>
}
