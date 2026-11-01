import { useUI } from '../store/useUI.js'
import { socialCardPayload } from './social-share.js'

export async function openSocialShare({ kind, targetId, title, metric, subtitle = '', date = '' }) {
  const { default: SocialShareSheet } = await import('../components/SocialShareSheet.jsx')
  const data = socialCardPayload(kind, { title, metric, subtitle, date })
  useUI.getState().openSheet(close => <SocialShareSheet data={data} shareTarget={{ kind, targetId }} close={close} />, { kind: 'center' })
}
