// Ported from 2jfitnessapp frontend/src/lib/equipment.js (commit b7d8e68). Behaviour unchanged.
export const DUMBBELL_WEIGHTS_2J: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40];
export const MACHINE_WEIGHTS_CONFIG = { min: 5, max: 100, step: 5 } as const;
export const BARBELL_PLATES_2J: readonly number[] = [2.5, 5, 10, 15, 20, 25];
export const BARBELL_LIKE_EQ: readonly string[] = ['barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'smith machine'];

export type EquipmentClass = 'dumbbell' | 'barbell' | 'machine';

export function equipmentClassOf(eq: string | null | undefined): EquipmentClass {
  if (eq === 'dumbbell') return 'dumbbell';
  if (eq != null && BARBELL_LIKE_EQ.includes(eq)) return 'barbell';
  return 'machine';
}

export interface EquipmentSettings {
  use2JRoomEquipment?: boolean;
  customIncrements?: { barbell: number; dumbbell: number; machineOther: number };
}

export function stepDumbbell2J(current: number | null | undefined, dir: number): number {
  const cur = current || 0;
  if (dir > 0) {
    const next = DUMBBELL_WEIGHTS_2J.find(w => w > cur + 1e-9);
    return next !== undefined ? next : cur;
  }
  for (let i = DUMBBELL_WEIGHTS_2J.length - 1; i >= 0; i--) {
    if (DUMBBELL_WEIGHTS_2J[i]! < cur - 1e-9) return DUMBBELL_WEIGHTS_2J[i]!;
  }
  return cur;
}

export function stepMachine2J(current: number | null | undefined, dir: number): number {
  const { min, max, step } = MACHINE_WEIGHTS_CONFIG;
  const cur = current || 0;
  if (dir > 0) return cur < min ? min : Math.min(max, cur + step);
  return cur <= min ? cur : Math.max(min, cur - step);
}

export function stepFlat(current: number | null | undefined, dir: number, step: number): number {
  return Math.max(0, Math.round(((current || 0) + dir * step) * 100) / 100);
}

/** Smallest reachable load ≥ target going up, largest ≤ target going down; null when the equipment cannot get there. */
export function realizableToward(S: EquipmentSettings, eq: string, from: number, target: number): number | null {
  const dir = target > from ? 1 : target < from ? -1 : 0;
  let x = from;
  for (let i = 0; i <= 400; i++) {
    if (dir >= 0 ? x >= target - 1e-9 : x <= target + 1e-9) return x;
    const nx = stepWeight(S, eq, x, dir);
    if (dir > 0 ? nx <= x : nx >= x) return null;
    x = nx;
  }
  return null;
}

export function stepWeight(S: EquipmentSettings, eq: string, current: number | null | undefined, dir: number): number {
  const cls = equipmentClassOf(eq);
  if (S.use2JRoomEquipment !== false) {
    if (cls === 'dumbbell') return stepDumbbell2J(current, dir);
    if (cls === 'machine') return stepMachine2J(current, dir);
    return stepFlat(current, dir, 5);
  }
  const inc = S.customIncrements ?? { barbell: 5, dumbbell: 2, machineOther: 5 };
  const step = cls === 'dumbbell' ? inc.dumbbell : cls === 'barbell' ? inc.barbell : inc.machineOther;
  return stepFlat(current, dir, step);
}
