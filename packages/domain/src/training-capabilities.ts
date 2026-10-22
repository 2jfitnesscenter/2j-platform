export const TRAINING_CAPABILITIES_CONTRACT = '2J-CAPABILITIES-V2' as const;
export const MAX_CAPABILITY_TTL_SECONDS = 60;
export const TRAINING_CAPABILITIES_TTL_MS = MAX_CAPABILITY_TTL_SECONDS * 1_000;

export type CapabilityLevel = 'full' | 'autonomous' | 'baseline' | 'blocked';
export type CapabilityAccessState = 'active' | 'provisional' | 'blocked_unpaid' | 'ended' | 'baseline' | 'suspended';
export type TrainingAccessLevel = 'full' | 'autonomous';
export type TrainingLinkStatus = 'active' | 'not_linked' | 'revoked';
export type CapabilityReasonCode =
  | 'ACTIVE_FULL' | 'ACTIVE_AUTONOMOUS'
  | 'PROVISIONAL_FULL' | 'PROVISIONAL_AUTONOMOUS'
  | 'TRAINING_LINK_REVOKED' | 'TRAINING_LINK_MISSING'
  | 'FREE_BASELINE' | 'ADMIN_SUSPENDED';

export interface EffectiveMembershipForCapabilities {
  readonly trainingAccessLevel: TrainingAccessLevel;
  /** Pass through Platform's effective-entitlement result; do not recalculate 098E here. */
  readonly accessState: CapabilityAccessState;
  readonly effectiveFrom: string;
}

export interface TrainingCapabilityContract {
  readonly contract: typeof TRAINING_CAPABILITIES_CONTRACT;
  readonly version: 2;
  readonly personId: string;
  readonly trainingSubject: { readonly linkStatus: TrainingLinkStatus; readonly trainingUserId?: string };
  readonly capabilityLevel: CapabilityLevel;
  readonly accessState: CapabilityAccessState;
  readonly capabilities: {
    readonly autonomousTraining: boolean;
    readonly routineCreation: boolean;
    readonly personalRoutineCreation: boolean;
    readonly personalRoutineManagement: boolean;
    readonly workoutRecording: boolean;
    readonly workoutHistory: boolean;
    readonly guidedTraining: boolean;
    readonly premiumPrograms: boolean;
    readonly aiCoach: boolean;
    readonly professionalFollowUp: boolean;
  };
  readonly reasonCode: CapabilityReasonCode;
  readonly suspensionStatus: 'none' | 'suspended' | 'lifted';
  readonly effectiveFrom: string | null;
  readonly expiresAt: string;
  readonly generatedAt: string;
  readonly source: { readonly platform: true };
}

export interface ResolveTrainingCapabilitiesInput {
  readonly personId: string;
  readonly link: { readonly status: TrainingLinkStatus; readonly trainingUserId?: string };
  readonly memberships: readonly EffectiveMembershipForCapabilities[];
  readonly generatedAt: string;
  readonly nextKnownAccessTransition?: string | null;
  readonly suspensionStatus?: 'none' | 'suspended' | 'lifted';
}

const blockedCapabilities = {
  autonomousTraining: false, routineCreation: false, personalRoutineCreation: false, personalRoutineManagement: false, workoutRecording: false, workoutHistory: false, guidedTraining: false,
  premiumPrograms: false, aiCoach: false, professionalFollowUp: false,
} as const;

/** Maps effective commercial rights over the separately authorized, free autonomous baseline. */
export function resolveTrainingCapabilities(input: ResolveTrainingCapabilitiesInput): TrainingCapabilityContract {
  const generatedAt = canonicalInstant(input.generatedAt);
  const ttlExpiry = Date.parse(generatedAt) + TRAINING_CAPABILITIES_TTL_MS;
  const transition = input.nextKnownAccessTransition == null ? null : Date.parse(input.nextKnownAccessTransition);
  if (transition !== null && !Number.isFinite(transition)) throw new RangeError('nextKnownAccessTransition must be an ISO timestamp');
  const expiresAt = new Date(transition !== null && transition > Date.parse(generatedAt) ? Math.min(ttlExpiry, transition) : ttlExpiry).toISOString();
  const link = input.link;
  const suspensionStatus = input.suspensionStatus ?? 'none';
  const effective = input.memberships.filter(item => item.accessState === 'active' || item.accessState === 'provisional');
  const selected = effective.find(item => item.trainingAccessLevel === 'full' && item.accessState === 'active')
    ?? effective.find(item => item.trainingAccessLevel === 'full')
    ?? effective.find(item => item.trainingAccessLevel === 'autonomous' && item.accessState === 'active')
    ?? effective.find(item => item.trainingAccessLevel === 'autonomous');
  const accessState = selected?.accessState ?? (input.memberships.some(item => item.accessState === 'blocked_unpaid') ? 'blocked_unpaid' : 'ended');
  if (link.status !== 'active' || typeof link.trainingUserId !== 'string' || link.trainingUserId.length === 0) {
    const revoked = link.status === 'revoked';
    return {
      contract: TRAINING_CAPABILITIES_CONTRACT, version: 2, personId: canonicalUuid(input.personId),
      trainingSubject: { linkStatus: revoked ? 'revoked' : 'not_linked' }, capabilityLevel: 'blocked',
      accessState, capabilities: blockedCapabilities,
      reasonCode: revoked ? 'TRAINING_LINK_REVOKED' : 'TRAINING_LINK_MISSING', suspensionStatus, effectiveFrom: null,
      expiresAt, generatedAt, source: { platform: true },
    };
  }

  if (suspensionStatus === 'suspended') {
    return {
      contract: TRAINING_CAPABILITIES_CONTRACT, version: 2, personId: canonicalUuid(input.personId),
      trainingSubject: { linkStatus: 'active', trainingUserId: link.trainingUserId }, capabilityLevel: 'blocked',
      accessState: 'suspended', capabilities: blockedCapabilities,
      reasonCode: 'ADMIN_SUSPENDED', suspensionStatus, effectiveFrom: null, expiresAt, generatedAt, source: { platform: true },
    };
  }

  if (!selected) return {
    contract: TRAINING_CAPABILITIES_CONTRACT, version: 2, personId: canonicalUuid(input.personId),
    trainingSubject: { linkStatus: 'active', trainingUserId: link.trainingUserId }, capabilityLevel: 'baseline',
    accessState: 'baseline', capabilities: { ...blockedCapabilities, autonomousTraining: true, personalRoutineCreation: true, personalRoutineManagement: true, workoutRecording: true, workoutHistory: true },
    reasonCode: 'FREE_BASELINE', suspensionStatus, effectiveFrom: null, expiresAt, generatedAt, source: { platform: true },
  };

  const full = selected.trainingAccessLevel === 'full';
  const provisional = selected.accessState === 'provisional';
  return {
    contract: TRAINING_CAPABILITIES_CONTRACT, version: 2, personId: canonicalUuid(input.personId),
    trainingSubject: { linkStatus: 'active', trainingUserId: link.trainingUserId },
    capabilityLevel: full ? 'full' : 'autonomous', accessState: selected.accessState,
    capabilities: {
      autonomousTraining: true, routineCreation: true, personalRoutineCreation: true, personalRoutineManagement: true, workoutRecording: true, workoutHistory: true, guidedTraining: true, premiumPrograms: true,
      aiCoach: full, professionalFollowUp: full,
    },
    reasonCode: provisional
      ? (full ? 'PROVISIONAL_FULL' : 'PROVISIONAL_AUTONOMOUS')
      : (full ? 'ACTIVE_FULL' : 'ACTIVE_AUTONOMOUS'),
    suspensionStatus, effectiveFrom: selected.effectiveFrom, expiresAt, generatedAt, source: { platform: true },
  };
}

function canonicalUuid(value: string) {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) throw new RangeError('personId must be a UUID');
  return normalized;
}

function canonicalInstant(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError('generatedAt must be an ISO timestamp');
  return new Date(timestamp).toISOString();
}
