// Minimal structural view of the Búnker state (S) used by these ports. Fields are optional because legacy data may omit them.
export interface SetRecord { done?: boolean; type?: string; w?: number; r?: number; rpe?: number; rir?: number; min?: number; sec?: number; speed?: number }
export interface WorkoutRecord { id?: string; d?: string; start: number; excludeFromProgression?: boolean; entries?: { id: string; sets?: SetRecord[] }[] }
export interface TestRecord { type?: string; exId?: string; d?: string; est1RM?: number }
export interface BodyWeightRecord { d: string; w: number; t?: number; src?: string }
export interface TrainingState { workouts?: WorkoutRecord[]; tests?: TestRecord[]; bodyweight?: BodyWeightRecord[] }
