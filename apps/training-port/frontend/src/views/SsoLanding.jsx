// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// /sso — the page Platform sends the browser to after "Open Búnker". Renders before the app (and before its router, which
// uses the URL hash) so the one-time code in the fragment is consumed and cleared first. See lib/sso-landing.js.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { START_PATH, confirmSsoSwitch, runSsoLanding } from '../lib/sso-landing.js'

const MESSAGES = {
  binding: 'This link was not started in this browser, so it cannot sign you in. Start from here and your 2J space will bring you back.',
  invalid: 'This sign-in link has expired or was already used. Open Búnker again from your 2J space.',
  blocked: 'Your Búnker access is not available right now. Talk to the centre if you think this is a mistake.',
  link: 'Your 2J account is not confirmed with this Búnker account yet. Sign in with your passkey and ask the centre to link them.',
  busy: 'Too many attempts. Wait a minute and try again.',
  disabled: 'Signing in with your 2J account is not available yet. Use your passkey.',
  unavailable: 'We could not open Búnker with your 2J account. Use your passkey instead.',
}

export default function SsoLanding() {
  const [state, setState] = useState({ phase: 'working', kind: null })
  useEffect(() => {
    let alive = true
    runSsoLanding({ location: window.location, history: window.history, fetchImpl: window.fetch.bind(window), go: path => window.location.replace(path) })
      .then(result => { if (alive && result && !result.ok) setState(result.kind === 'confirm' ? { phase: 'confirm', kind: 'confirm', ticket: result.ticket, current: result.current, target: result.target } : { phase: 'failed', kind: result.kind }) })
    return () => { alive = false }
  }, [])
  if (state.phase === 'confirm') {
    // Someone else is signed in on this browser: never switch without an explicit yes.
    const confirm = async () => {
      setState(prev => ({ ...prev, phase: 'working' }))
      const result = await confirmSsoSwitch(state.ticket)
      if (result.ok) window.location.replace('/'); else setState({ phase: 'failed', kind: result.kind === 'link' ? 'link' : 'invalid' })
    }
    return (
      <div className="narrow"><div className="card" role="alertdialog" aria-labelledby="sso-switch-title">
        <h1 id="sso-switch-title">{t('Switch account?')}</h1>
        <p>{t('This browser is signed in as {0}. The link you opened would sign you in as {1} instead.', state.current, state.target)}</p>
        <p>{t('Only continue if you asked to open Búnker with that 2J account.')}</p>
        <button className="btn" onClick={confirm}>{t('Continue as {0}', state.target)}</button>
        <a className="btn ghost" href="/">{t('Stay signed in as {0}', state.current)}</a>
      </div></div>
    )
  }
  if (state.phase === 'working') return <div className="narrow"><div className="card" role="status">{t('Opening Búnker with your 2J account…')}</div></div>
  return <SsoFailure kind={state.kind} />
}

/** What the person sees when the sign-in could not complete. A link that was not started in this browser, or one that expired, can start again from here. */
export function SsoFailure({ kind }) {
  const restartable = kind === 'binding' || kind === 'invalid'
  return (
    <div className="narrow"><div className="card" role="alert">
      <h1>{t('Búnker')}</h1>
      <p>{t(MESSAGES[kind] || MESSAGES.unavailable)}</p>
      {restartable && <a className="btn" href={START_PATH}>{t('Continue with your 2J account')}</a>}
      <a className={restartable ? 'btn ghost' : 'btn'} href="/">{t('Sign in with passkey')}</a>
    </div></div>
  )
}
