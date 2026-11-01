// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

// A small, consistent "this is gym staff" mark — next to a name on Profile, or wherever an
// author line in Social shows who posted something (a routine/program, a Wall record, a
// comment). One badge covers both roles: every admin is already a trainer too (isTrainer in
// api/server.js), so there is nothing a plain "trainer" badge would misrepresent for them.
export default function StaffBadge({ size = 13, style }) {
  return <span title={t('Trainer')} style={{ display: 'inline-flex', flex: 'none', color: 'var(--yellow)', ...style }}>
    <Icon name="crown" style={{ fontSize: size }} />
  </span>
}
