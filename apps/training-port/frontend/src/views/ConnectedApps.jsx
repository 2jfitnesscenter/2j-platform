import { Navigate, useLocation } from 'react-router-dom'

// "Connected apps" used to be a second place to connect WHOOP and Strava next to Health → Fitness integrations. There is one place now (/health/integrations); this route stays
// only because WHOOP and Strava still send people back to #/connected-apps after signing in — it forwards them, query string included (?strava=connected …).
export default function ConnectedApps() {
  const { search } = useLocation()
  return <Navigate to={'/health/integrations' + search} replace />
}
