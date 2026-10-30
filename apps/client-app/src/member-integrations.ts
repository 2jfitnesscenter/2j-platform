/** Contracts consumed by Home. Business decisions remain on Platform. */
export type SessionAvailability =
  | 'available'
  | 'full'
  | 'booked'
  | 'not_allowed_by_plan'
  | 'waitlisted'
  | 'waitlist_suspended';

export type TrainingLinkReviewReason =
  | 'lost_device'
  | 'no_home_access'
  | 'support_request'
  | 'other';

export const trainingLinkEndpoints = {
  createTransaction: '/api/platform/v1/training-link-transactions',
  finishLink: '/api/me/training/link',
  revokeLink: '/api/me/training/link',
  review: '/api/me/training/link-review',
  trainingSummary: '/api/me/training-summary',
} as const;

export function isMemberIntegrationEnabled(flag: unknown, demoMode: boolean): boolean {
  return !demoMode && (flag === true || flag === 'true');
}

const availabilityLabels: Record<SessionAvailability, string> = {
  available: 'Disponible',
  full: 'Completa',
  booked: 'Reservada',
  not_allowed_by_plan: 'No disponible con tu cuota',
  waitlisted: 'En espera',
  waitlist_suspended: 'Lista de espera suspendida',
};

export function sessionAvailabilityLabel(value: unknown): string | null {
  return typeof value === 'string' && value in availabilityLabels
    ? availabilityLabels[value as SessionAvailability]
    : null;
}

export const evolutionSections = [
  { id: 'measurements', label: 'Mediciones', description: 'Medidas y pliegues registrados.' },
  { id: 'graphs', label: 'Gráficos', description: 'Consulta la evolución entre fechas.' },
  { id: 'evaluations', label: 'Evaluaciones', description: 'Revisa las evaluaciones del centro.' },
  { id: 'health', label: 'Mi salud', description: 'Información de salud bajo consentimiento.' },
] as const;

export type EvolutionSection = typeof evolutionSections[number]['id'];
