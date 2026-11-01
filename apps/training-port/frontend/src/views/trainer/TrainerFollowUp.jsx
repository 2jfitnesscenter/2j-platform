import CoachBoard from '../../components/coach/CoachBoard.jsx'
import CoachMember from '../../components/coach/CoachMember.jsx'

// Seguimiento inside the desktop trainer panel: centre-wide member access for trainers.
export function TrainerFollowBoard() { return <CoachBoard base="/trainer/seguimiento" back="/trainer" /> }
export function TrainerFollowMember() { return <CoachMember back="/trainer/seguimiento" /> }
