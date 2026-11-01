import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchSharedItem } from '../lib/social-api.js'
import { t } from '../lib/i18n.js'
import CommunityShareCard from '../components/CommunityShareCard.jsx'
import ReportContentButton from '../components/ReportContentButton.jsx'
import ReceivedPlan from '../components/ReceivedPlan.jsx'
import Icon from '../components/Icon.jsx'

export default function SocialShareDetail() {
  const { id } = useParams(), nav = useNavigate()
  const [item, setItem] = useState(undefined)
  const load = () => fetchSharedItem(id).then(x => setItem(x)).catch(() => setItem(null))
  useEffect(() => { let live = true; fetchSharedItem(id).then(x => { if (live) setItem(x) }).catch(() => { if (live) setItem(null) }); return () => { live = false } }, [id])
  return <main className="narrow social-share-detail"><header className="hdr"><button className="iconbtn" onClick={() => (item?.content ? nav(-1) : nav('/social'))} aria-label={t('Back')}><Icon name="chevronLeft" /></button><div><h1>{item?.content ? t('Shared with you') : t('Shared moment')}</h1></div></header>
    {item === undefined ? <div className="muted small">{t('Loading…')}</div> : item?.content ? <ReceivedPlan item={item} onChanged={load} /> : item ? <><div className="social-moment-by"><span className="moment-avatar"><Icon name="person" /></span><strong>{item.authorName}</strong></div><div className="social-moment-card"><CommunityShareCard data={{ kind: item.kind, ...item.card }} /></div><ReportContentButton targetType="share" targetId={item.id} /></> : <div className="empty"><div className="ico"><Icon name="lock" /></div>{t('This moment is no longer available')}<br /><span className="small muted">{t('It may have been deleted or its privacy settings may have changed.')}</span><button className="btn tinted" onClick={() => nav('/social')}>{t('Back to Community')}</button></div>}
  </main>
}
