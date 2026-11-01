// Minimal structural view of the Búnker state (S) used by these ports. Fields are optional because legacy data may omit them.
export interface SetRecord { done?: boolean | undefined; type?: string | undefined; w?: number | undefined; r?: number | undefined; rpe?: number | undefined; rir?: number | undefined; min?: number | undefined; sec?: number | undefined; speed?: number | undefined; feel?: string }
export interface WorkoutEntryRecord { id: string; sets: SetRecord[]; target?: unknown; topW?: number | null; sg?: string }
export interface WorkoutRecord { id?: string; d: string; start: number; excludeFromProgression?: boolean; entries?: WorkoutEntryRecord[] }
export interface TestRecord { type?: string; exId?: string; d?: string; est1RM?: number }
export interface BodyWeightRecord { d: string; w: number; t?: number; src?: string }
export interface RoutineRecord { id: string; name?: string; exercises?: ExerciseConfig[] }
export interface ExerciseConfig {
  id: string; mode?: "reps" | "time" | "cardio" | undefined; sets?: number | undefined; reps?: number | undefined; weight?: number | undefined; min?: number | undefined; speed?: number | undefined; sec?: number | undefined;
  targetRepsMin?: number | null | undefined; targetRepsMax?: number | null | undefined; dropset?: boolean | undefined; sg?: string | undefined;
}
export interface TrainingState {
  workouts?: WorkoutRecord[]; tests?: TestRecord[]; bodyweight?: BodyWeightRecord[];
  routines?: RoutineRecord[]; week?: Record<number, string | null>; dayPlan?: Record<string, unknown>;
  programs?: { id: string; week?: Record<number, string | null> }[]; activeProgramId?: string | null;
  exWeights?: Record<string, { w?: number; sourceWorkoutId?: string }>; unit?: 'kg' | 'lb';
  warmupEnabled?: boolean; showPreviousResults?: boolean; effort?: string; showRir?: boolean;
}
