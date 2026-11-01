// A scan file is not read or sent until the user confirms the per-file disclosure.
export const EXTERNAL_AI_SCAN_CONSENT = 'external-ai-scan-v1'

export async function scanAfterExplicitConsent({ file, accepted, readFile, scan, onPhase }) {
  if (!accepted) return null
  const dataUrl = await readFile(file)
  return scan(dataUrl, onPhase ? { externalAiConsent: EXTERNAL_AI_SCAN_CONSENT, onPhase } : { externalAiConsent: EXTERNAL_AI_SCAN_CONSENT })
}
