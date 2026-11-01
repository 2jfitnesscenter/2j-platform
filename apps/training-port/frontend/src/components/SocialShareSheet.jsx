import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'
import CommunityShareCard from './CommunityShareCard.jsx'
import ProgramShareCard from './ProgramShareCard.jsx'
import { capturePng, sharePng } from '../lib/share-image.js'
import InternalShareActions from './InternalShareActions.jsx'
import { useStore } from '../store/useStore.js'

export default function SocialShareSheet({ data, shareTarget, close }) {
  const cardRef = useRef(null)
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [aspect, setAspect] = useState('card')
  const Card = data.kind === 'program' ? ProgramShareCard : CommunityShareCard
  useEffect(() => {
    const key = `community-share-help:v1:${user?.id || 'guest'}`
    if (!localStorage.getItem(key)) setShowHelp(true)
  }, [user?.id])
  const dismissHelp = () => { localStorage.setItem(`community-share-help:v1:${user?.id || 'guest'}`, '1'); setShowHelp(false) }
  const share = async () => {
    if (busy || !cardRef.current) return
    setBusy(true)
    try { await sharePng(await capturePng(cardRef.current), `2J-${data.kind}-${Date.now()}.png`, data.title, data.subtitle); close() }
    catch (e) { if (e?.name !== 'AbortError') toast(e.message || t('Could not export image')) }
    finally { setBusy(false) }
  }
  return <div className="social-share-sheet">
    <header className="row between"><div><h3>{t('Share')}</h3><div className="small muted">{t('A private-ready 2J card')}</div></div><button className="iconbtn" aria-label={t('Close')} onClick={close}><span aria-hidden="true">×</span></button></header>
    <div className="share-aspect"><Segmented value={aspect} onChange={setAspect} className="seg-inline" options={[{ value: 'card', label: t('Card') }, { value: 'story', label: '9:16' }, { value: 'square', label: '1:1' }]} /></div>
    <div className="community-share-preview"><Card data={data} cardRef={cardRef} aspect={aspect} /></div>
    <div className="small muted" style={{ margin: '12px 0' }}>{t('This card contains only the details shown above.')}</div>
    {showHelp && <div className="share-first-use"><Icon name="lock" /><span>{t('Your training stays private until you choose a destination. Community and chat recheck your privacy settings.')}</span><button onClick={dismissHelp}>{t('Got it')}</button></div>}
    {shareTarget && <InternalShareActions target={shareTarget} />}
    <Button variant="primary" disabled={busy} icon="upload" onClick={share}>{t('Share image')}</Button>
  </div>
}
