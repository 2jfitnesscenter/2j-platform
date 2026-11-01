// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { resizeImageFile, scanMeasurements } from '../lib/media.js'
import { scanAfterExplicitConsent } from '../lib/scan-consent.js'
import { Button } from './ui.jsx'

const readAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error(t('Could not read that file')))
  reader.onload = () => resolve(reader.result)
  reader.readAsDataURL(file)
})

// Shared by Admin's BioimpedanceSheet, Measurements' own scan sheet, and the routine-scan flows
// (Plan.jsx for a member's own routine, the trainer panel for a member's) — opens the file/camera
// picker, reads the file (downsizing a photo the same way every other upload in the app does;
// a PDF goes through as-is since a canvas can't decode one), sends it off for a one-shot AI read
// via `scanFn` (defaults to the bioimpedance scan, the original and still most common caller),
// and hands the result back. Never saves anything itself — the caller always shows the result in
// an editable form/review first, exactly like a manual entry would be.
export default function ScanUpload({ onResult, scanFn = scanMeasurements, label, busyLabel }) {
  const toast = useUI(s => s.toast)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)
  const [phase, setPhase] = useState(null)   // what the server is doing: reading | retrying | verifying
  const [slow, setSlow] = useState(false)    // it has been a while: say so instead of looking frozen

  const onFile = e => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setPendingFile(file)
  }

  const sendAfterConsent = async () => {
    const file = pendingFile
    if (!file) return
    setPendingFile(null)
    setBusy(true); setPhase('reading'); setSlow(false)
    try {
      const result = await scanAfterExplicitConsent({
        file,
        accepted: true,
        readFile: f => f.type === 'application/pdf' ? readAsDataUrl(f) : resizeImageFile(f),
        scan: scanFn,
        onPhase: (p, ms) => { setPhase(p); setSlow(ms > 20000) },
      })
      onResult(result)
      // Values the server could not confirm were left empty on purpose: say where to look.
      if (result?.review?.length) toast(t('Some values could not be confirmed and were left empty — please check them.'))
    } catch (err) {
      toast(err.message || t('Could not read that file'))
    } finally {
      setBusy(false); setPhase(null); setSlow(false)
    }
  }

  return <>
    {/* No `capture` attribute on purpose — that forces iOS straight into the camera and skips
        its own picker, so there was never a way to import an existing photo or PDF (issue: iOS
        "scan report" only opened the camera). Leaving it off gets the native action sheet back
        (Take Photo / Photo Library / Browse), and a live capture is still one tap away in it. */}
    <input ref={inputRef} type="file" accept="image/*,application/pdf"
      style={{ display: 'none' }} onChange={onFile} />
    {pendingFile ? <div className="card" role="dialog" aria-label={t('Confirm external AI scan')} style={{ padding: 14 }}>
      <div className="tt" style={{ fontWeight: 700, marginBottom: 6 }}>{t('Before sending this file')}</div>
      <div className="muted small" style={{ lineHeight: 1.5, display: 'grid', gap: 6 }}>
        <div><strong>{t('File')}:</strong> {pendingFile.name}</div>
        <div>{t('This file will be sent to the external AI provider Google Gemini to analyze it for this scan. It may contain personal or health information.')}</div>
        <div>{t('The scan is processed for this request and is not added to your account. If you cancel, the file is not sent.')}</div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <Button size="sm" variant="primary" disabled={busy} onClick={sendAfterConsent}>{t('Accept and continue')}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPendingFile(null)}>{t('Cancel')}</Button>
      </div>
    </div> : <Button size="sm" variant="tinted" icon="scan" disabled={busy} onClick={() => inputRef.current.click()}>
      {busy ? (slow ? t('Taking a little longer than usual…') : phase === 'verifying' ? t('Double-checking…') : (busyLabel || t('Reading…'))) : (label || t('Scan report'))}
    </Button>}
  </>
}
