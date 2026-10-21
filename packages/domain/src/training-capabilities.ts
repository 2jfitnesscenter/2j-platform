export const TRAINING_CAPABILITIES_CONTRACT = '2J-CAPABILITIES-V1' as const;
export const TRAINING_CAPABILITIES_TTL_MS = 60_000;

export type CapabilityLevel = 'full' | 'autonomous' | 'blocked';
export type CapabilityAccessState = 'active' | 'provisional' | 'blocked_unpaid' | 'ended';
export type MembershipKind = 'force' | 'other';
export type TrainingLinkStatus = 'active' | 'not_linked' | 'revoked';
export type CapabilityReasonCode =
  | 'ACTIVE_FORCE' | 'ACTIVE_OTHER_MEMBERSHIP'
  | 'PROVISIONAL_FORCE' | 'PROVISIONAL_OTHER_MEMBERSHIP'
  | 'UNPAID_BLOCK' | 'NO_ACTIVE_MEMBERSHIP' | 'PERIOD_ENDED' | 'TRAINING_LINK_REVOKED' | 'TRAINING_LINK_MISSING';

export interface EffectiveMembershipForCapabilities {
  readonly kind: MembershipKind;
  /** Pass through Platform's effective-entitlement result; do not recalculate 098E here. */
  readonly accessState: CapabilityAccessState;
  readonly effectiveFrom: string;
}

export interface TrainingCapabilityContract {
  readonly contract: typeof TRAINING_CAPABILITIES_CONTRACT;
  readonly version: 1;
  readonly personId: string;
  readonly trainingSubject: { readonly linkStatus: TrainingLinkStatus; readonly trainingUserId?: string };
  readonly capabilityLevel: CapabilityLevel;
  readonly accessState: CapabilityAccessState;
  readonly capabilities: {
    readonly autonomousTraining: boolean;
    readonly routineCreation: boolean;
    readonly guidedTraining: boolean;
    readonly premiumPrograms: boolean;
    readonly aiCoach: boolean;
    readonly professionalFollowUp: boolean;
  };
  readonly reasonCode: CapabilityReasonCode;
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
}

const blockedCapabilities = {
  autonomousTraining: false, routineCreation: false, guidedTraining: false,
  premiumPrograms: false, aiCoach: false, professionalFollowUp: false,
} as const;

/** Maps Platform's already-resolved effective membership states to the downstream V1 contract. */
export function resolveTrainingCapabilities(input: ResolveTrainingCapabilitiesInput): TrainingCapabilityContract {
  const generatedAt = canonicalInstant(input.generatedAt);
  const expiresAt = new Date(Date.parse(generatedAt) + TRAINING_CAPABILITIES_TTL_MS).toISOString();
  const link = input.link;
  const effective = input.memberships.filter(item => item.accessState === 'active' || item.accessState === 'provisional');
  const selected = effective.find(item => item.kind === 'force' && item.accessState === 'active')
    ?? effective.find(item => item.kind === 'force')
    ?? effective.find(item => item.kind === 'other' && item.accessState === 'active')
    ?? effective.find(item => item.kind === 'other');
  const accessState = selected?.accessState ?? (input.memberships.some(item => item.accessState === 'blocked_unpaid') ? 'blocked_unpaid' : 'ended');
  if (link.status !== 'active' || typeof link.trainingUserId !== 'string' || link.trainingUserId.length === 0) {
    const revoked = link.status === 'revoked';
    return {
      contract: TRAINING_CAPABILITIES_CONTRACT, version: 1, personId: canonicalUuid(input.personId),
      trainingSubject: { linkStatus: revoked ? 'revoked' : 'not_linked' }, capabilityLevel: 'blocked',
      accessState, capabilities: blockedCapabilities,
      reasonCode: revoked ? 'TRAINING_LINK_REVOKED' : 'TRAINING_LINK_MISSING', effectiveFrom: null,
      expiresAt, generatedAt, source: { platform: true },
    };
  }

  if (!selected) {
    return {
      contract: TRAINING_CAPABILITIES_CONTRACT, version: 1, personId: canonicalUuid(input.personId),
      trainingSubject: { linkStatus: 'active', trainingUserId: link.trainingUserId }, capabilityLevel: 'blocked',
      accessState, capabilities: blockedCapabilities,
      reasonCode: accessState === 'blocked_unpaid' ? 'UNPAID_BLOCK' : input.memberships.length ? 'PERIOD_ENDED' : 'NO_ACTIVE_MEMBERSHIP',
      effectiveFrom: null, expiresAt, generatedAt, source: { platform: true },
    };
  }

  const full = selected.kind === 'force';
  const provisional = selected.accessState === 'provisional';
  return {
    contract: TRAINING_CAPABILITIES_CONTRACT, version: 1, personId: canonicalUuid(input.personId),
    trainingSubject: { linkStatus: 'active', trainingUserId: link.trainingUserId },
    capabilityLevel: full ? 'full' : 'autonomous', accessState: selected.accessState,
    capabilities: {
      autonomousTraining: true, routineCreation: true, guidedTraining: true, premiumPrograms: true,
      aiCoach: full, professionalFollowUp: full,
    },
    reasonCode: provisional
      ? (full ? 'PROVISIONAL_FORCE' : 'PROVISIONAL_OTHER_MEMBERSHIP')
      : (full ? 'ACTIVE_FORCE' : 'ACTIVE_OTHER_MEMBERSHIP'),
    effectiveFrom: selected.effectiveFrom, expiresAt, generatedAt, source: { platform: true },
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
