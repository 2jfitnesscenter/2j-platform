import { t } from '../lib/i18n.js'

const GUIDE_STEPS = {
  'ios-safari': ["Tap Safari's Share button.", 'Choose Add to Home Screen.', 'Confirm Add.'],
  ios: ['Open the browser share menu.', 'Choose Add to Home Screen, if available.', 'Confirm Add.'],
  'android-chrome': ["Open Chrome's menu (⋮).", 'Choose Install app or Add to Home screen.', 'Confirm the installation.'],
  'android-edge': ["Open Edge's menu (⋯).", 'Choose Add to phone or Install app, if available.', 'Confirm the installation.'],
  android: ['Open the browser menu (⋮).', 'Choose Install app or Add to Home screen, if available.', 'Confirm the installation.'],
  'desktop-chrome': ['Open the Install icon in the address bar or Chrome menu.', 'Choose Install 2J Fitness or Install page as app, if shown.', 'Confirm the installation.'],
  'desktop-edge': ['Open Edge menu → Apps.', 'Choose Install this site as an app, if available.', 'Confirm the installation.'],
  generic: ['Open the browser menu or sharing options.', 'Choose Install app or Add to Home screen, if available.', 'Confirm the installation.'],
}

export default function PwaInstallBanner({ mode, guide = 'generic', instructionsOpen = false, onInstall, onHowToInstall, onNowNot, onCloseInstructions }) {
  if (!mode) return null
  const steps = GUIDE_STEPS[guide] || GUIDE_STEPS.generic
  return <section id="pwa-install-prompt" className="card pwa-install-banner" aria-label={t('Install 2J Fitness')}>
    <span className="install-i" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>
    </span>
    <div className="pwa-install-copy">
      <h2>{t('Install 2J Fitness')}</h2>
      <p>{t('Access it faster from your phone and use it like an app.')}</p>
      {mode === 'guide' && instructionsOpen && <div id="pwa-install-instructions" className="pwa-install-instructions" aria-live="polite">
        <p>{t('Open your browser menu and choose an install option:')}</p>
        <ol>{steps.map(step => <li key={step}>{t(step)}</li>)}</ol>
        <button type="button" className="btn plain sm" onClick={onCloseInstructions}>{t('Got it')}</button>
      </div>}
    </div>
    <div className="pwa-install-actions">
      {mode === 'prompt'
        ? <button type="button" className="btn primary sm" onClick={onInstall}>{t('Install')}</button>
        : <button type="button" className="btn primary sm" aria-expanded={instructionsOpen} aria-controls="pwa-install-instructions" onClick={onHowToInstall}>{t('How to install')}</button>}
      <button type="button" className="btn plain sm" onClick={onNowNot}>{t('Not now')}</button>
    </div>
  </section>
}
