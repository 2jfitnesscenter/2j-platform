import { useUI } from '../store/useUI.js'

/** Opens the "send to a friend" sheet for a routine or program built by lib/shared-plans.js (routineShare / programShare). */
export async function openPrivatePlanShare(share, title) {
  if (!share) return
  const { default: PrivatePlanShareSheet } = await import('../components/PrivatePlanShareSheet.jsx')
  useUI.getState().openSheet(close => <PrivatePlanShareSheet share={share} title={title} close={close} />)
}
