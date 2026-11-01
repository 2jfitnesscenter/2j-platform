// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import { scanRoutine } from '../../lib/media.js'
import { matchScannedRoutine } from '../../lib/routine-scan.js'
import ScanUpload from '../../components/ScanUpload.jsx'
import PlanReviewCard from './PlanReviewCard.jsx'
import Topbar from './Topbar.jsx'

// A printed/handwritten/photographed routine for this member, read by the same Gemini scan the
// bioimpedance report uses (api/lib/routine-scan.js), matched against the real exercise library
// client-side (lib/routine-scan.js's matchScannedRoutine — the same job lib/import-csv.js's CSV
// importer already does for another app's export), then reviewed and saved through the exact
// same PlanReviewCard the AI-generate flow uses — the result is the same kind of plan bundle
// either way, just read off a page instead of drafted from a brief.
export default function TrainerScanRoutine() {
  const nav = useNavigate()
  const { memberId } = useParams()
  const [bundle, setBundle] = useState(null)
  const back = () => nav('/trainer/' + memberId)

  const onScan = raw => setBundle(matchScannedRoutine(raw))

  if (bundle) return <PlanReviewCard memberId={memberId} bundle={bundle} onBack={back} onDiscard={back} onSaved={() => {}} />

  return <div id="trainer-app">
    <Topbar title={t('Scan a routine')} onBack={back} />
    <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div className="muted small" style={{ marginBottom: 16 }}>
        {t('Upload a photo or PDF of this member’s printed routine — sets, reps and weight are read automatically, and you’ll get to review everything before it’s saved.')}
      </div>
      <ScanUpload onResult={onScan} scanFn={scanRoutine} label={t('Scan a routine')} busyLabel={t('Reading the routine…')} />
    </div>
  </div>
}
