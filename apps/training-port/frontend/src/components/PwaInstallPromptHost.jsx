import { useLocation } from 'react-router-dom'
import InstallPrompt from './InstallPrompt.jsx'

/** One browser-wide install invitation, outside route content so it also reaches Login. */
export default function PwaInstallPromptHost() {
  const { pathname } = useLocation()
  // Bunker is a shared gym kiosk, not a personal browsing/install surface.
  if (pathname === '/bunker' || pathname.startsWith('/bunker/')) return null
  return <div className="narrow"><InstallPrompt /></div>
}
