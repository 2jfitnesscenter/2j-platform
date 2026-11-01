// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { SECONDARY_FACTORS } from '../lib/muscles.js'
import { Section, Row, Switch, SelectRow } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

function statsHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Statistics')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Controls how a secondary — supporting — muscle counts toward the numbers this app derives from your training, wherever they’re shown.')}
    </div>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('What counts as secondary?')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('A bench press mainly trains chest — its primary muscle — but triceps and shoulders help too. Those helpers are the secondary muscles. With counting on, a secondary muscle credits a fraction of a full set (the factor below); with it off, only the primary muscle gets any credit at all.')}
    </div>
    <h4 className="sec">{t('Where this shows up')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5 }}>
      {t('The muscle map (Home and Progress), muscle recovery’s per-muscle % and the Progress screen’s muscle balance card all read the same two settings — turning secondaries off, or changing their factor, updates every one of them at once, never just one screen.')}
    </div>
  </>)
}

// Settings → Statistics. Both knobs here flow through lib/muscles.js's muscleOptsOf into
// every loadOf/musclesOf call that has `S` in scope — the muscle map, muscle recovery and the
// Progress screen's own muscle-balance card all read the same two settings, so turning
// secondaries off (or changing their weight) is consistent everywhere at once rather than a
// per-screen setting that could quietly disagree with itself.
export default function StatsSettings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const countSecondary = S.countSecondaryMuscles !== false

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Statistics')}</h1></div>
    </div>

    <Section title={t('Muscle volume')} footer={t('Applies to the muscle map, muscle recovery and the Progress screen’s muscle balance.')}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Count secondary muscles in data')}
        subtitle={t('A bench press also credits triceps and shoulders, not just chest.')}>
        <button className="helpbtn" aria-label={t('What does this affect?')} onClick={statsHelpSheet}><Icon name="info" /></button>
        <Switch checked={countSecondary} onChange={v => update(s => { s.countSecondaryMuscles = v })} />
      </Row>
      {countSecondary && <SelectRow icon="scale" iconTint="var(--teal)" title={t('Secondary muscle factor')}
        sheetTitle={t('Secondary muscle factor')}
        value={S.secondaryMuscleFactor ?? 0.5} onChange={v => update(s => { s.secondaryMuscleFactor = v })}
        options={SECONDARY_FACTORS.map(f => ({ value: f, label: `× ${f}`, subtitle: t('{0} sets credit {1} sets to a secondary muscle', 4, Math.round(4 * f * 100) / 100) }))} />}
    </Section>
  </div>
}
