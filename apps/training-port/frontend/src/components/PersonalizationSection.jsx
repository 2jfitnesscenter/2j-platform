// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Personalisation: the same controls as the "Personalise" mode of Home and Progress, shown directly (no deeper screen) — Home layout, Progress layout and the
// first-time guide. Edits are stored straight away in S.ux (lib/ux-layout.js); "Restore default layout" removes the stored choice.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { HOME_BLOCKS, homeLayoutOf, isHomeOptional } from '../lib/home-blocks.js'
import { PROGRESS_CARDS, progressOrder, normalizeProgress } from '../lib/progress-cards.js'
import { setLayout, restoreLayout, guideSeen, resetGuide } from '../lib/ux-layout.js'
import LayoutEditor from './LayoutEditor.jsx'
import { Section, Row } from './ui.jsx'

export default function PersonalizationSection() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  useStore(s => s.features)
  const toast = useUI(s => s.toast)
  return <>
    <div className="card pz-set" aria-label={t('Home')}>
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Home')}</h4>
      <LayoutEditor S={S} catalog={HOME_BLOCKS} layout={homeLayoutOf(S)} canHide={isHomeOptional} compact isDefault={!S.ux?.home}
        onChange={l => update(s => { setLayout(s, 'home', l) })} onRestore={() => update(s => { restoreLayout(s, 'home') })} />
    </div>
    <div className="card pz-set" aria-label={t('Progress')}>
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Progress')}</h4>
      <LayoutEditor S={S} catalog={PROGRESS_CARDS} compact isDefault={!S.ux?.progress}
        layout={{ order: progressOrder(S), hidden: normalizeProgress(S.ux?.progress).hidden }}
        onChange={l => update(s => { setLayout(s, 'progress', l) })} onRestore={() => update(s => { restoreLayout(s, 'progress') })} />
    </div>
    <Section title={t('Guide')} footer={t('The guide appears the first time you press "Personalise" in Home or Progress.')}>
      <Row icon="lightbulb" iconTint="var(--yellow)" title={t('Show the personalisation guide again')}
        subtitle={guideSeen(S) ? t('It will appear the next time you press Personalise') : t('It has not been shown yet')}
        onClick={() => { update(s => { resetGuide(s) }); toast(t('The guide will appear again')) }} accessory="chevron" />
    </Section>
  </>
}
