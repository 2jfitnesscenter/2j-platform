import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { deleteSocialShare, fetchSocialShares } from '../lib/social-api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import CommunityShareCard from '../components/CommunityShareCard.jsx'
import ReportContentButton from '../components/ReportContentButton.jsx'
import Icon from '../components/Icon.jsx'
import { ListSkeleton, Pill } from '../components/v2.jsx'

// What kind of moment it is, at a glance: gold only for records / achievements / milestones, accent for everything else.
const KIND = { workout: ['Workout', 'figureStrength'], record: ['Record', 'trophy'], achievement: ['Achievement', 'sparkles'], streak: ['Streak', 'flame'], challenge: ['Challenge', 'flag'], routine: ['Routine', 'dumbbell'], program: ['Program', 'calendar'] }
const GOLD = new Set(['record', 'achievement', 'streak'])

export default function SocialMoments() {
  const user = useStore(s => s.user), toast = useUI(s => s.toast)
  const [items, setItems] = useState(null)
  const load = () => fetchSocialShares().then(setItems).catch(e => { setItems([]); toast(e.message) })
  useEffect(() => { load() }, [])
  const remove = async id => { try { await deleteSocialShare(id); load() } catch (e) { toast(e.message) } }
  return <section className="social-moments" aria-label={t('Shared moments')}>
    {items === null ? <ListSkeleton /> : items.length ? <div className="social-moments-grid">{items.map(item => <article className="social-moment" key={item.id}>
      <div className="social-moment-by"><span className="moment-avatar"><Icon name="person" /></span><div><strong>{item.authorName}</strong><small>{new Date(item.createdAt).toLocaleDateString()}</small></div>{KIND[item.kind] && <Pill tone={GOLD.has(item.kind) ? 'gold' : 'acc'} icon={KIND[item.kind][1]} className="v2-moment-kind">{t(KIND[item.kind][0])}</Pill>}</div>
      <div className="social-moment-card"><CommunityShareCard data={{ kind: item.kind, ...item.card, subtitle: item.authorName }} /></div>
      <div className="row between social-moment-actions">{item.authorId === user?.id ? <button className="btn ghost" onClick={() => remove(item.id)}>{t('Delete')}</button> : <ReportContentButton targetType="share" targetId={item.id} />}</div>
    </article>)}</div> : <div className="empty"><div className="ico"><Icon name="sparkles" /></div>{t('No shared moments yet')}<br /><span className="small muted">{t('Training moments appear here only after someone chooses to share them.')}</span></div>}
  </section>
}
