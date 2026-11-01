import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { reportSocialContent } from '../lib/social-api.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'

const REASONS = [['inappropriate', 'Inappropriate content'], ['spam', 'Spam'], ['privacy', 'Privacy concern'], ['other', 'Other']]

/** The same report, as a small flag that opens a sheet: for a chat message or a comment, where an inline form would not fit. */
function ReportSheet({ targetType, targetId, close }) {
  const toast = useUI(s => s.toast)
  const [reason, setReason] = useState('inappropriate')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await reportSocialContent(targetType, targetId, reason); toast(t('Report sent to the team')); close() }
    catch (e) { toast(e.message || t('Could not send report')); setBusy(false) }
  }
  return <div className="report-sheet">
    <h3>{t('Report')}</h3>
    <p className="small muted">{t('The team will review it. The person is not told who reported.')}</p>
    <div className="list">{REASONS.map(([value, label]) => <label key={value} className="item"><span className="grow">{t(label)}</span><input type="radio" name="report-reason" checked={reason === value} onChange={() => setReason(value)} /></label>)}</div>
    <button className="btn primary" disabled={busy} onClick={submit}>{t('Send report')}</button>
  </div>
}

export default function ReportContentButton({ targetType, targetId, icon = false }) {
  const toast = useUI(s => s.toast)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('inappropriate')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await reportSocialContent(targetType, targetId, reason); toast(t('Report sent to the team')); setOpen(false) }
    catch (e) { toast(e.message || t('Could not send report')) }
    finally { setBusy(false) }
  }
  if (icon) return <button type="button" className="report-icon" aria-label={t('Report')} title={t('Report')} onClick={() => useUI.getState().openSheet(close => <ReportSheet targetType={targetType} targetId={targetId} close={close} />)}><Icon name="flag" /></button>
  return <div className="report-control">
    {!open ? <button className="btn ghost" onClick={() => setOpen(true)}><Icon name="flag" />{t('Report')}</button> : <div className="report-mini">
      <select className="input" aria-label={t('Report reason')} value={reason} onChange={e => setReason(e.target.value)}>
        <option value="inappropriate">{t('Inappropriate content')}</option><option value="spam">{t('Spam')}</option><option value="privacy">{t('Privacy concern')}</option><option value="other">{t('Other')}</option>
      </select>
      <button className="btn primary" disabled={busy} onClick={submit}>{t('Send report')}</button>
      <button className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>{t('Cancel')}</button>
    </div>}
  </div>
}
