import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// A program as a card of its own: its name, a few facts and the routines it is made of (up to six; the rest are counted).
// Same family as CommunityShareCard (fixed dark palette, logo, date) so the exported image never depends on the viewer's theme.
export default function ProgramShareCard({ data, cardRef, aspect = 'card' }) {
  const items = data.items || []
  const shown = items.slice(0, 6)
  return <article ref={cardRef} className="community-sharecard program-sharecard" data-share-kind="program" data-aspect={aspect}>
    <div className="csc-brand"><span className="csc-mark"><Icon name="dumbbell" /></span><span>2J FITNESS CENTER</span><span className="csc-brand-dot" /></div>
    <div className="csc-kicker">{t('A program to inspire')}</div>
    <h2>{data.title || t('A program')}</h2>
    {data.facts?.length > 0 && <ul className="psc-facts">{data.facts.map(f => <li key={f}>{f}</li>)}</ul>}
    {shown.length > 0 && <ul className="psc-days">{shown.map((name, i) => <li key={i}><span className="psc-dot" /><span>{name}</span></li>)}
      {items.length > shown.length && <li className="psc-more">{t('+{0} more', items.length - shown.length)}</li>}</ul>}
    {data.subtitle && <p>{data.subtitle}</p>}
    <div className="csc-bottom"><span>{data.date}</span><span>2J · KEEP MOVING</span></div>
  </article>
}
