// Dependencies that live outside this package in Búnker (exercise catalogue, feature flags, UI formatting).
// They are injected once by the host, so the training logic never pulls the catalogue or React into Platform.
// Defaults are explicit: the catalogue default says "not cardio" (the reps path), the feature default says "on". Host code must call
// configureTrainingPorts() at startup; tests configure their own.
import type { Formatter } from './format.js';
import type { TrainingState } from './training-state.js';

export interface TrainingPorts {
  /** True when the exercise id is a cardio exercise in the catalogue. */
  isCardio: (exerciseId: string | null | undefined) => boolean;
  /** Whether a feature flag is on for this member state (e.g. 'effort'). */
  uxOn: (state: TrainingState, feature: string) => boolean;
  formatter: Formatter;
}

let current: TrainingPorts = {
  isCardio: () => false,
  uxOn: () => true,
  formatter: { t: s => s, locale: 'en-GB' },
};

export function configureTrainingPorts(next: Partial<TrainingPorts>): void {
  current = { ...current, ...next };
}

export const ports = (): TrainingPorts => current;
