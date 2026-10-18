// Pure logic of the recurring-schedule editor (Configurar horarios). No React, no I/O: everything the screen
// shows or sends is derived here so it can be tested without a browser.
// Weekdays use the API numbering (0 = Domingo … 6 = Sábado); the screen shows them Lunes → Domingo.

export function serviceColorIndex(serviceId: string) { let hash = 2166136261; for (const char of serviceId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return (hash >>> 0) % 5; }
export const MAX_SCHEDULES_PER_OPERATION = 50;
export const SLOT_MINUTES = 30;
export const DEFAULT_GRID_START = 6 * 60;
export const DEFAULT_GRID_END = 22 * 60;
export const MAX_VISIBLE_LANES = 3;
export const DURATION_PRESETS = [30, 45, 60, 75, 90] as const;
export const DISPLAY_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_LETTER: Record<number, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
export const WEEKDAY_NAME: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };

export type ScheduleDraft = {
  id: string;
  serviceId: string;
  professionalId: string;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  capacity: number;
  startsOn: string;
  endsOn: string;
};
export type ExistingTemplate = { id: string; serviceId: string; serviceName: string; professionalId?: string | null; professionalName?: string | null; weekday: number; localStartTime: string; durationMinutes: number; capacity: number; startsOn: string; endsOn: string | null };
export type BatchPayload = { serviceId: string; areaId: string; professionalId?: string; weekdays: number[]; blocks: { localStartTime: string; durationMinutes: number; capacity: number }[]; startsOn: string; endsOn: string | null };

export function toMinutes(time: string) {
  const [hour, minute] = time.slice(0, 5).split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
export function formatMinutes(total: number) {
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}
export function endTime(start: string, durationMinutes: number) {
  return formatMinutes(toMinutes(start) + durationMinutes);
}
export function timeRangeLabel(start: string, durationMinutes: number) {
  return `${start.slice(0, 5)}–${endTime(start, durationMinutes)}`;
}
export function isHalfHourStart(time: string) { return toMinutes(time) % 60 === 30; }

/** Start times offered by the selector: every 30 minutes from 06:00 to 21:30. */
export function timeOptions() {
  return Array.from({ length: (22 * 60 - DEFAULT_GRID_START) / SLOT_MINUTES }, (_, index) => formatMinutes(DEFAULT_GRID_START + index * SLOT_MINUTES));
}
/** The selector options, plus the current value when it is not a 30-minute mark (an existing 08:15 template, for instance). */
export function timeOptionsFor(current: string) {
  const options = timeOptions();
  const value = current.slice(0, 5);
  return value && !options.includes(value) ? [...options, value].sort() : options;
}

/** A draft can never end the next day: the API refuses it. */
export function endsSameDay(start: string, durationMinutes: number) { return toMinutes(start) + durationMinutes <= 1440; }

// ---------- Counter and the 50-per-operation limit ----------
export function draftCount(draft: Pick<ScheduleDraft, 'weekdays'>) { return new Set(draft.weekdays).size; }
export function totalCount(drafts: Pick<ScheduleDraft, 'weekdays'>[]) { return drafts.reduce((sum, draft) => sum + draftCount(draft), 0); }
/** How many more weekly schedules fit, ignoring the draft being edited (it will be replaced). */
export function remainingSchedules(drafts: ScheduleDraft[], editingId: string | null = null) {
  const used = totalCount(drafts.filter((draft) => draft.id !== editingId));
  return Math.max(0, MAX_SCHEDULES_PER_OPERATION - used);
}
/** Can this weekday still be ticked in the form? Already-ticked days can always be unticked. */
export function canSelectWeekday(drafts: ScheduleDraft[], editingId: string | null, selected: number[], weekday: number) {
  if (selected.includes(weekday)) return true;
  return selected.length < remainingSchedules(drafts, editingId);
}
export function limitMessage() { return `Has alcanzado el máximo de ${MAX_SCHEDULES_PER_OPERATION} horarios por operación.`; }
export function counterLabel(drafts: Pick<ScheduleDraft, 'weekdays'>[]) {
  const total = Math.min(totalCount(drafts), MAX_SCHEDULES_PER_OPERATION);
  return `${total} / ${MAX_SCHEDULES_PER_OPERATION}`;
}
/** Adds (or replaces) a draft. Returns the unchanged list when it would pass the limit, so the counter never goes over 50. */
export function upsertDraft(drafts: ScheduleDraft[], draft: ScheduleDraft): { drafts: ScheduleDraft[]; accepted: boolean } {
  const others = drafts.filter((item) => item.id !== draft.id);
  if (totalCount(others) + draftCount(draft) > MAX_SCHEDULES_PER_OPERATION) return { drafts, accepted: false };
  const exists = drafts.some((item) => item.id === draft.id);
  return { drafts: exists ? drafts.map((item) => (item.id === draft.id ? draft : item)) : [...drafts, draft], accepted: true };
}

// ---------- Duplicate ----------
/** Copies service, professional, duration, capacity and validity; days and time are the two things the owner is expected to change. */
export function duplicateDraft(source: Pick<ScheduleDraft, 'serviceId' | 'professionalId' | 'durationMinutes' | 'capacity' | 'startsOn' | 'endsOn' | 'weekdays' | 'startTime'>, id: string): ScheduleDraft {
  return { id, serviceId: source.serviceId, professionalId: source.professionalId, weekdays: [...source.weekdays], startTime: source.startTime, durationMinutes: source.durationMinutes, capacity: source.capacity, startsOn: source.startsOn, endsOn: source.endsOn };
}

// ---------- Payload ----------
/** One draft = one call to the existing batch endpoint: weekdays × a single block. */
export function buildBatchPayload(draft: ScheduleDraft, areaId: string): BatchPayload {
  return {
    serviceId: draft.serviceId,
    areaId,
    ...(draft.professionalId ? { professionalId: draft.professionalId } : {}),
    weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b),
    blocks: [{ localStartTime: draft.startTime, durationMinutes: draft.durationMinutes, capacity: draft.capacity }],
    startsOn: draft.startsOn,
    endsOn: draft.endsOn || null,
  };
}

// ---------- Validation ----------
export function validateDraft(draft: ScheduleDraft): string[] {
  const problems: string[] = [];
  if (!draft.serviceId) problems.push('Elige un servicio.');
  if (draft.weekdays.length === 0) problems.push('Elige al menos un día de la semana.');
  if (!/^\d{2}:\d{2}$/.test(draft.startTime)) problems.push('Elige la hora de inicio.');
  if (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes < 5 || draft.durationMinutes > 480) problems.push('La duración debe estar entre 5 y 480 minutos.');
  else if (/^\d{2}:\d{2}$/.test(draft.startTime) && !endsSameDay(draft.startTime, draft.durationMinutes)) problems.push('El horario no puede terminar al día siguiente.');
  if (!Number.isInteger(draft.capacity) || draft.capacity < 1 || draft.capacity > 500) problems.push('Las plazas deben estar entre 1 y 500.');
  if (!draft.startsOn) problems.push('Indica desde cuándo vale el horario.');
  if (draft.endsOn && draft.startsOn && draft.endsOn < draft.startsOn) problems.push('La fecha final no puede ser anterior a la inicial.');
  return problems;
}

type Range = { weekday: number; startMinute: number; endMinute: number; startsOn: string; endsOn: string | null };
/** Same rule as POST /api/calendar/templates/batch, so a conflict is explained before anything is sent. */
export function templatesOverlap(a: Range, b: Range) {
  if (a.weekday !== b.weekday || a.startMinute >= b.endMinute || b.startMinute >= a.endMinute) return false;
  const from = new Date(`${a.startsOn > b.startsOn ? a.startsOn : b.startsOn}T00:00:00Z`);
  const endA = a.endsOn ?? '9999-12-31';
  const endB = b.endsOn ?? '9999-12-31';
  const through = new Date(`${endA < endB ? endA : endB}T00:00:00Z`);
  if (from > through) return false;
  from.setUTCDate(from.getUTCDate() + ((a.weekday - from.getUTCDay() + 7) % 7));
  return from <= through;
}
const draftRanges = (draft: ScheduleDraft): Range[] => draft.weekdays.map((weekday) => ({ weekday, startMinute: toMinutes(draft.startTime), endMinute: toMinutes(draft.startTime) + draft.durationMinutes, startsOn: draft.startsOn, endsOn: draft.endsOn || null }));
const existingRange = (template: ExistingTemplate): Range => ({ weekday: template.weekday, startMinute: toMinutes(template.localStartTime), endMinute: toMinutes(template.localStartTime) + template.durationMinutes, startsOn: String(template.startsOn).slice(0, 10), endsOn: template.endsOn ? String(template.endsOn).slice(0, 10) : null });
const sharesResource = (a: { serviceId: string; professionalId?: string | null }, b: { serviceId: string; professionalId?: string | null }) => a.serviceId === b.serviceId || Boolean(a.professionalId && b.professionalId && a.professionalId === b.professionalId);

export type ScheduleConflict = { draftId: string; otherId?: string; with: 'draft' | 'existing'; weekday: number; label: string };
/** Conflicts the API would answer with schedule_conflict (same service or same professional, overlapping time and validity). */
export function findConflicts(drafts: ScheduleDraft[], existing: ExistingTemplate[], labelFor: (draft: ScheduleDraft) => string = (draft) => draft.id): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  drafts.forEach((draft, index) => {
    for (const range of draftRanges(draft)) {
      for (const other of drafts.slice(index + 1)) {
        if (!sharesResource(draft, other)) continue;
        if (draftRanges(other).some((candidate) => templatesOverlap(range, candidate))) conflicts.push({ draftId: draft.id, otherId: other.id, with: 'draft', weekday: range.weekday, label: `${labelFor(draft)} y ${labelFor(other)}` });
      }
      for (const template of existing) {
        if (!sharesResource(draft, template)) continue;
        if (templatesOverlap(range, existingRange(template))) conflicts.push({ draftId: draft.id, with: 'existing', weekday: range.weekday, label: `${labelFor(draft)} y ${template.serviceName} ${template.localStartTime.slice(0, 5)}` });
      }
    }
  });
  return conflicts;
}

// ---------- Weekly preview geometry ----------
export type PreviewBlock = { key: string; weekday: number; startMinute: number; endMinute: number };
export type PlacedBlock = PreviewBlock & { lane: number; lanes: number; hidden: boolean; cluster: number };

export function gridExtent(blocks: { startMinute: number; endMinute: number }[]) {
  let start = DEFAULT_GRID_START;
  let end = DEFAULT_GRID_END;
  for (const block of blocks) {
    start = Math.min(start, Math.floor(block.startMinute / 60) * 60);
    end = Math.max(end, Math.ceil(block.endMinute / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(1440, end) };
}
export const slotCount = (extent: { start: number; end: number }) => (extent.end - extent.start) / SLOT_MINUTES;

/** Rows are real 30-minute slots. A block starts on its start slot and spans exactly duration / 30 slots (fractions kept, never rounded up). */
export function blockGeometry(block: { startMinute: number; endMinute: number }, extent: { start: number; end: number }) {
  const top = (block.startMinute - extent.start) / SLOT_MINUTES;
  const height = (block.endMinute - block.startMinute) / SLOT_MINUTES;
  return { top, height, bottom: top + height };
}

/** Overlapping blocks of one day share the column side by side. Each cluster of overlapping blocks gets its own number of lanes.
 *  When a cluster needs more than maxLanes, the last lane is reserved for a "+N" chip and the blocks that do not fit are marked hidden. */
export function layoutDay(blocks: PreviewBlock[], maxLanes = MAX_VISIBLE_LANES): PlacedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.key.localeCompare(b.key));
  const placed: PlacedBlock[] = [];
  let cluster: PlacedBlock[] = [];
  let clusterEnd = -Infinity;
  let clusterIndex = 0;
  let laneEnds: number[] = [];
  const flush = () => {
    const needed = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    const overflow = needed > maxLanes;
    cluster.forEach((item) => { item.lanes = Math.min(needed, maxLanes); item.hidden = overflow && item.lane >= maxLanes - 1; });
    placed.push(...cluster);
    cluster = []; clusterEnd = -Infinity; laneEnds = []; clusterIndex += 1;
  };
  for (const block of sorted) {
    if (cluster.length && block.startMinute >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(block.endMinute); } else laneEnds[lane] = block.endMinute;
    cluster.push({ ...block, lane, lanes: 1, hidden: false, cluster: clusterIndex });
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  if (cluster.length) flush();
  return placed;
}
export type OverflowChip = { cluster: number; weekday: number; startMinute: number; endMinute: number; lane: number; lanes: number; hiddenKeys: string[] };
/** One chip per cluster that has hidden blocks; it takes the reserved last lane across the whole cluster. */
export function overflowChips(placed: PlacedBlock[], maxLanes = MAX_VISIBLE_LANES): OverflowChip[] {
  const byCluster = new Map<number, PlacedBlock[]>();
  for (const item of placed) byCluster.set(item.cluster, [...(byCluster.get(item.cluster) ?? []), item]);
  const chips: OverflowChip[] = [];
  for (const [cluster, items] of byCluster) {
    const hidden = items.filter((item) => item.hidden);
    if (!hidden.length) continue;
    chips.push({ cluster, weekday: items[0]!.weekday, startMinute: Math.min(...items.map((item) => item.startMinute)), endMinute: Math.max(...items.map((item) => item.endMinute)), lane: maxLanes - 1, lanes: maxLanes, hiddenKeys: hidden.map((item) => item.key) });
  }
  return chips;
}
/** Horizontal placement of a lane, as percentages of the day column. Lanes never exceed 0–100%. */
export function laneBox(block: { lane: number; lanes: number }) {
  const width = 100 / block.lanes;
  return { left: width * block.lane, width };
}

// ---------- Existing templates, grouped for the list ----------
export type ExistingGroup = { key: string; templates: ExistingTemplate[]; weekdays: number[]; first: ExistingTemplate };
export function groupExisting(templates: ExistingTemplate[]): ExistingGroup[] {
  const groups = new Map<string, ExistingTemplate[]>();
  for (const template of templates) {
    const key = [template.serviceId, template.professionalId ?? '', template.localStartTime.slice(0, 5), template.durationMinutes, template.capacity, String(template.startsOn).slice(0, 10), template.endsOn ?? ''].join('|');
    groups.set(key, [...(groups.get(key) ?? []), template]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({ key, templates: items, weekdays: sortWeekdays(items.map((item) => item.weekday)), first: items[0]! }))
    .sort((a, b) => toMinutes(a.first.localStartTime) - toMinutes(b.first.localStartTime) || a.first.serviceName.localeCompare(b.first.serviceName));
}
export function sortWeekdays(weekdays: number[]) { return [...new Set(weekdays)].sort((a, b) => DISPLAY_WEEKDAYS.indexOf(a as never) - DISPLAY_WEEKDAYS.indexOf(b as never)); }
export function weekdaysLabel(weekdays: number[]) {
  const sorted = sortWeekdays(weekdays);
  if (sorted.length === 7) return 'Todos los días';
  return sorted.map((day) => WEEKDAY_NAME[day]).join(' · ');
}
export function weekdaysShort(weekdays: number[]) { return sortWeekdays(weekdays).map((day) => WEEKDAY_LETTER[day]).join('-'); }
