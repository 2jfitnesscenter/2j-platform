// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Home's Premium block. Without a running program it is an invitation to the catalogue ("Entrenamientos Premium"); with one it becomes "Tu programa": the
// program, its cycle and week, the next workout and a quiet progress bar. The catalogue switch only decides the invitation — a running program is always shown.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { usePremium } from '../lib/premium-api.js'
import { runningView } from '../lib/premium.js'
import { allowedByAdmin } from '../lib/features.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import PremiumCover from './PremiumCover.jsx'
import '../views/premium.css'

export default function PremiumHomeCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const cached = usePremium(s => s.programs)
  const user = useStore(s => s.user)
  const v = runningView(S)
  const invite = !v && allowedByAdmin('premium')
  // The invitation borrows a cover from the catalogue (device copy first, instant), so it is loaded once, only when the invitation is what is shown.
  useEffect(() => { if (invite) usePremium.getState().load(user?.id) }, [invite, user?.id])
  if (!v && !invite) return null
  if (!v) {
    const pick = cached.find(p => p.featured && p.coverImage) || cached.find(p => p.coverImage) || {}
    return <button className="pm-active pm-home" onClick={() => nav('/premium')}>
      <PremiumCover p={pick} ratio="21 / 9" className="pm-home-cover"><span className="pm-active-cap">
        <span className="pm-kicker"><Icon name="trophy" /> 2J PREMIUM</span>
        <b>{t('Premium training')}</b>
        <span className="pm-card-sub">{t('Proven methods, adapted to you.')}</span></span></PremiumCover>
    </button>
  }
  const snap = v.inst.snapshot
  const prog = cached.find(p => p.id === v.inst.programId)
  const cover = snap.coverImage ? snap : prog || {}
  const paused = v.inst.status === 'paused'
  return <button className="pm-active pm-home" onClick={() => nav('/premium/active')}>
    <PremiumCover p={cover} ratio="21 / 9" className="pm-home-cover"><span className="pm-active-cap">
      <span className="pm-kicker">{t('Your program')}</span>
      <b>{v.inst.name}</b>
      <span className="pm-card-sub">{t('Cycle {0} · Week {1}/{2}', v.pos.cycle, v.pos.week, v.pos.weeks)}</span></span></PremiumCover>
    <span className="pm-active-foot">
      <span className="pm-bar" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={v.progress.percent}><i style={{ width: v.progress.percent + '%' }} /></span>
      <small>{paused ? t('Paused') : v.plan ? t('Next: {0}', v.plan.title) : t('Cycle complete')}</small>
      <span className="pm-open">{t('Continue')} <Icon name="chevronRight" /></span>
    </span>
  </button>
}
