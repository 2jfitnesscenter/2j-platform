import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, TextField } from './ui.jsx'

/* Delete my account: explains exactly what goes, asks for the username, then the passkey (the server requires a fresh assertion). */
export default function DeleteAccountSheet({ close }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const deleteAccount = useStore(s => s.deleteAccount)
  const toast = useUI(s => s.toast)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const name = user?.username || ''
  const ok = !!name && typed.trim().toLowerCase() === name.toLowerCase()
  const run = async () => {
    if (!ok || busy) return
    setBusy(true)
    try { await deleteAccount(typed.trim()); close(); nav('/home'); toast(t('Your account was deleted')) }
    catch (e) { setBusy(false); toast(e?.name === 'NotAllowedError' ? t('Passkey confirmation was cancelled') : t('Could not delete the account')) }
  }
  return <div className="stack" style={{ gap: 12 }}>
    <h3>{t('Delete your account?')}</h3>
    <p className="small">{t('This permanently deletes your workouts, body measurements, Health data, messages, community posts and passkeys from this server. It cannot be undone.')}</p>
    <p className="small dim">{t('Copies inside security backups disappear when those backups expire. Permissions you gave to WHOOP or Strava stay in those apps until you revoke them there. See the privacy policy for the details.')}</p>
    <p className="small muted">{t('Export your data first if you want a copy.')} {t('Apps you connected (WHOOP, Strava) keep their own access until you remove 2J in their settings.')}</p>
    <label className="small" htmlFor="del-confirm">{t('Type your username to confirm')}: <b>{name}</b></label>
    <TextField id="del-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={name} />
    <p className="small muted">{t('Then you will confirm with your passkey.')}</p>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="plain" onClick={close} disabled={busy}>{t('Cancel')}</Button>
      <Button variant="danger" onClick={run} disabled={!ok || busy}>{t('Delete everything')}</Button>
    </div>
  </div>
}
