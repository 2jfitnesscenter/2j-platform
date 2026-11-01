// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Legal & credits — opened from Settings' footer, next to the version history. Who made what
// (the original openGym project and this fork), the license and where to read it and get the
// source, third parties, and the trademark note. The same facts live in NOTICE.md, AUTHORS.md,
// THIRD_PARTY_NOTICES.md and TRADEMARKS.md; keep them in step.
import { t } from '../lib/i18n.js'
import { PrivacySheet } from './Privacy.jsx'

export const SOURCE_URL = 'https://github.com/2jfitnesscenter/2jfitnessapp'
export const UPSTREAM_URL = 'https://github.com/DuarteSantos8/openGym'
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'

const Link = ({ href, children }) =>
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--acc)' }}>{children}</a>
const H = ({ children }) => <div className="tt" style={{ fontWeight: 700, margin: '16px 0 4px' }}>{children}</div>

export function LegalSheet() {
  return <>
    <h3>{t('Legal & credits')}</h3>
    <div className="small" style={{ lineHeight: 1.6 }}>
      <div className="tt" style={{ fontWeight: 700 }}>2J Fitness Center App</div>
      <div className="dim">{t('Development and fork modifications: {0}', 'Juan Jose Perez Sanchez — 2J Fitness Center')}</div>
      <div className="dim">Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center</div>

      <H>{t('Based on openGym')}</H>
      <div className="dim">openGym — Copyright (C) 2026 Duarte Santos · <Link href={UPSTREAM_URL}>github.com/DuarteSantos8/openGym</Link></div>
      <div className="dim">{t('Includes the AI Coach first added in Alex Costa’s fork of openGym, and contributions from the openGym community.')}</div>

      <H>{t('License')}</H>
      <div className="dim">{t('Free software under the GNU Affero General Public License v3.0 or later (AGPL). You may use, study, share and modify it; whoever offers a modified version over a network must offer its source code under the same license.')}</div>
      <div style={{ marginTop: 6 }}>
        <Link href={LICENSE_URL}>{t('Read the license (AGPL v3)')}</Link><br />
        <Link href={SOURCE_URL}>{t('Source code and legal notices')}</Link>
      </div>

      <H>{t('Third parties')}</H>
      <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t('Exercise records and non-media instructions: hasaneyldrm/exercises-dataset, MIT.')}</li>
        <li>{t('Exercise images and animations: © Gym visual; display is enabled by project-owner decision. This does not establish a 2J licence or ownership; see the provenance inventory.')}</li>
        <li>{t('Body diagram geometry: MuscleMap by Melih Colpan (MIT).')}</li>
        <li>{t('Open-source libraries such as React, React Router, Zustand and Vite, each under its own license.')}</li>
      </ul>

      <H>{t('Privacy')}</H>
      <div className="dim">{t('How 2J handles your data, which AI and outside providers are involved, and your rights are in one place: the privacy policy.')}</div>
      <div style={{ marginTop: 6 }}>
        <span className="tap" style={{ color: 'var(--acc)', cursor: 'pointer' }}
          onClick={async () => { const { useUI } = await import('../store/useUI.js'); useUI.getState().openSheet(() => <PrivacySheet topic="policy" />) }}>{t('Privacy policy')}</span>
      </div>

      <H>{t('Trademarks')}</H>
      <div className="dim">{t('The 2J Fitness Center name and the 2J logo identify 2J Fitness Center. The software license does not grant permission to use them; the code itself remains free under the AGPL.')}</div>
    </div>
  </>
}
