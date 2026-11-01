import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSocialReports, resolveSocialReport } from '../lib/social-api.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

export default function SocialReports() {
  const nav = useNavigate(), toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const load = () => fetchSocialReports().then(setRows).catch(e => { setRows([]); toast(e.message) })
  useEffect(() => { load() }, [])
  const resolve = async (id, action) => { try { await resolveSocialReport(id, action); load() } catch (e) { toast(e.message) } }
  return <main className="narrow"><header className="hdr"><button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><div><h1>{t('Community reports')}</h1><div className="sub">{t('Review only items members have reported.')}</div></div></header>
    {rows === null ? <div className="muted small">{t('Loading…')}</div> : rows.length ? <div className="list">{rows.map(r => <article className="item report-item" key={r.id}>
      <span className="lrow-i"><Icon name="flag" /></span><div className="grow"><strong>{r.content?.title || t('Content no longer available')}</strong><div className="ss">{r.targetType} · {t('Reason')}: {t(r.reason)} · {new Date(r.createdAt).toLocaleString()}</div><div className="ss">{t('Reported by')} {r.reporterId}</div></div>
      <Button size="sm" variant="tinted" onClick={() => resolve(r.id, 'dismiss')}>{t('Dismiss')}</Button><Button size="sm" variant="primary" onClick={() => resolve(r.id, 'remove')}>{t('Remove')}</Button>
    </article>)}</div> : <div className="empty"><div className="ico"><Icon name="checkCircle" /></div>{t('No pending reports')}</div>}
  </main>
}
