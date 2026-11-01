import { t } from '../lib/i18n.js'
import { ACCENTS } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'

/* Compact accent picker: Settings shows one row with the current colour; the palette lives here, in a sheet. Same persistence as
   before (S.accent), the sheet just closes once a colour is chosen. */
export function AccentSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const cur = S.accent || 'lime'
  return <div className="v3-accent-sheet">
    <h3>{t('Accent color')}</h3>
    <div className="v3-accent-grid" role="radiogroup" aria-label={t('Accent color')}>
      {Object.entries(ACCENTS).map(([k, c]) => <button key={k} type="button" role="radio" aria-checked={cur === k} aria-label={k}
        className={'v3-accent-dot' + (cur === k ? ' on' : '')} style={{ '--dot': c }}
        onClick={() => { update(s => { s.accent = k }); close && close() }}>
        {cur === k && <Icon name="check" />}
      </button>)}
    </div>
  </div>
}

export const openAccent = () => useUI.getState().openSheet(close => <AccentSheet close={close} />)
