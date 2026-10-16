import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, icons } from '@2j/ui';
import {
  DISPLAY_WEEKDAYS, DURATION_PRESETS, MAX_SCHEDULES_PER_OPERATION, WEEKDAY_LETTER, WEEKDAY_NAME,
  buildBatchPayload, canSelectWeekday, counterLabel, draftCount, duplicateDraft, endTime, findConflicts, gridExtent, blockGeometry,
  groupExisting, isHalfHourStart, laneBox, layoutDay, limitMessage, overflowChips, remainingSchedules, serviceColorIndex, slotCount,
  sortWeekdays, timeOptionsFor, timeRangeLabel, toMinutes, totalCount, upsertDraft, validateDraft, weekdaysLabel, weekdaysShort,
  type BatchPayload, type ExistingGroup, type ExistingTemplate, type PreviewBlock, type ScheduleDraft,
} from './schedule-logic';

type Service = { id: string; name: string; areaId: string };
type Professional = { id: string; displayName: string };
type Area = { id: string; name: string };
export type ScheduleSubmitItem = { draftId: string; payload: BatchPayload };
export type ScheduleSubmitResult = { createdDraftIds: string[]; failed: boolean };

export type ScheduleEditorProps = {
  templates: ExistingTemplate[];
  services: Service[];
  areas: Area[];
  professionals: Professional[];
  today: string;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (items: ScheduleSubmitItem[]) => Promise<ScheduleSubmitResult>;
  onArchive: (group: ExistingGroup, opener: HTMLElement) => void;
};

type Panel = { mode: 'new' | 'edit' | 'duplicate'; draft: ScheduleDraft } | null;
let draftSequence = 0;
const newId = () => { draftSequence += 1; return `draft-${draftSequence}`; };
const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('es-ES', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const validityLabel = (startsOn: string, endsOn: string | null | undefined) => `Desde ${shortDate(String(startsOn).slice(0, 10))}${endsOn ? ` · Hasta ${shortDate(String(endsOn).slice(0, 10))}` : ' · Sin fecha de fin'}`;

export function ScheduleEditor(props: ScheduleEditorProps) {
  const { templates, services, areas, professionals, today, busy, error, onClearError, onCancel, onDirtyChange, onSubmit, onArchive } = props;
  const [drafts, setDrafts] = useState<ScheduleDraft[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelProblems, setPanelProblems] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewDay, setPreviewDay] = useState<number>(1);
  const [overflowOpen, setOverflowOpen] = useState<string | null>(null);
  const [existingOpen, setExistingOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => { onDirtyChange(drafts.length > 0); }, [drafts.length]);
  const serviceById = (id: string) => services.find((item) => item.id === id);
  const professionalName = (id: string) => professionals.find((item) => item.id === id)?.displayName ?? '';
  const existingGroups = useMemo(() => groupExisting(templates), [templates]);
  const total = totalCount(drafts);
  const remaining = remainingSchedules(drafts);
  const draftLabel = (draft: ScheduleDraft) => `${serviceById(draft.serviceId)?.name ?? 'Servicio'} ${weekdaysShort(draft.weekdays)} ${draft.startTime}`;
  const conflicts = useMemo(() => findConflicts(drafts, templates, draftLabel), [drafts, templates, services]);

  function openPanel(mode: 'new' | 'edit' | 'duplicate', draft: ScheduleDraft) {
    onClearError(); setPanelProblems([]); setPanel({ mode, draft });
    window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('[data-schedule-focus]')?.focus(), 0);
  }
  function startNew() {
    openPanel('new', { id: newId(), serviceId: '', professionalId: '', weekdays: [], startTime: '08:00', durationMinutes: 60, capacity: 12, startsOn: today, endsOn: '' });
  }
  function startDuplicateDraft(draft: ScheduleDraft) { openPanel('duplicate', duplicateDraft(draft, newId())); }
  function startDuplicateExisting(group: ExistingGroup) {
    const first = group.first;
    openPanel('duplicate', { id: newId(), serviceId: first.serviceId, professionalId: first.professionalId ?? '', weekdays: group.weekdays, startTime: first.localStartTime.slice(0, 5), durationMinutes: first.durationMinutes, capacity: first.capacity, startsOn: today > String(first.startsOn).slice(0, 10) ? today : String(first.startsOn).slice(0, 10), endsOn: first.endsOn ? String(first.endsOn).slice(0, 10) : '' });
  }
  function commitPanel() {
    if (!panel) return;
    const draft = panel.draft;
    const problems = validateDraft(draft);
    if (problems.length) { setPanelProblems(problems); return; }
    if (totalCount(drafts.filter((item) => item.id !== draft.id)) + draftCount(draft) > MAX_SCHEDULES_PER_OPERATION) { setPanelProblems([limitMessage()]); return; }
    const next = upsertDraft(drafts, draft);
    if (!next.accepted) { setPanelProblems([limitMessage()]); return; }
    const mine = findConflicts(next.drafts, templates, (item) => `${serviceById(item.serviceId)?.name ?? 'Servicio'} ${weekdaysShort(item.weekdays)} ${item.startTime}`).filter((item) => item.draftId === draft.id || item.otherId === draft.id);
    if (mine.length) {
      const first = mine[0]!;
      setPanelProblems([`${WEEKDAY_NAME[first.weekday]}: se solapa con otro horario del mismo servicio o profesional (${first.label}). Cambia la hora, los días o el profesional.`]);
      return;
    }
    setDrafts(next.drafts); setSelectedKey(`draft:${draft.id}`); setPanel(null); setPanelProblems([]);
  }
  function removeDraft(id: string) { setDrafts((items) => items.filter((item) => item.id !== id)); if (selectedKey?.startsWith(`draft:${id}`)) setSelectedKey(null); }
  function patchPanel(patch: Partial<ScheduleDraft>) { setPanel((current) => current ? { ...current, draft: { ...current.draft, ...patch } } : current); setPanelProblems([]); }

  async function submit() {
    if (!drafts.length || conflicts.length) return;
    const items: ScheduleSubmitItem[] = [];
    for (const draft of drafts) {
      const service = serviceById(draft.serviceId);
      if (!service) return;
      items.push({ draftId: draft.id, payload: buildBatchPayload(draft, service.areaId) });
    }
    const result = await onSubmit(items);
    if (result.createdDraftIds.length) setDrafts((current) => current.filter((item) => !result.createdDraftIds.includes(item.id)));
  }

  // ---------- Preview data ----------
  const previewBlocks = useMemo(() => {
    const entries: (PreviewBlock & { kind: 'draft' | 'existing'; label: string; serviceId: string; draftId?: string; group?: string })[] = [];
    templates.forEach((template) => {
      const startMinute = toMinutes(template.localStartTime);
      entries.push({ key: `tpl:${template.id}`, weekday: template.weekday, startMinute, endMinute: startMinute + template.durationMinutes, kind: 'existing', serviceId: template.serviceId, label: `${template.serviceName}, ${WEEKDAY_NAME[template.weekday]}, ${timeRangeLabel(template.localStartTime.slice(0, 5), template.durationMinutes)}, ${template.professionalName ?? 'sin profesional'}, ${template.capacity} plazas, horario existente` });
    });
    drafts.forEach((draft) => {
      const startMinute = toMinutes(draft.startTime);
      draft.weekdays.forEach((weekday) => entries.push({ key: `draft:${draft.id}:${weekday}`, weekday, startMinute, endMinute: startMinute + draft.durationMinutes, kind: 'draft', serviceId: draft.serviceId, draftId: draft.id, label: `${serviceById(draft.serviceId)?.name ?? 'Servicio'}, ${WEEKDAY_NAME[weekday]}, ${timeRangeLabel(draft.startTime, draft.durationMinutes)}, ${professionalName(draft.professionalId) || 'sin profesional'}, ${draft.capacity} plazas, borrador nuevo` }));
    });
    return entries;
  }, [templates, drafts, services, professionals]);
  const extent = useMemo(() => gridExtent(previewBlocks), [previewBlocks]);
  const slots = slotCount(extent);
  const byDay = useMemo(() => {
    const map = new Map<number, ReturnType<typeof layoutDay>>();
    for (const weekday of DISPLAY_WEEKDAYS) map.set(weekday, layoutDay(previewBlocks.filter((item) => item.weekday === weekday)));
    return map;
  }, [previewBlocks]);
  const entryByKey = (key: string) => previewBlocks.find((item) => item.key === key);

  function activateBlock(key: string) {
    const entry = entryByKey(key);
    if (!entry) return;
    setSelectedKey(key.startsWith('draft:') ? `draft:${entry.draftId}` : key);
    if (entry.kind === 'draft') { const draft = drafts.find((item) => item.id === entry.draftId); if (draft) openPanel('edit', { ...draft }); }
    else { setExistingOpen(true); window.setTimeout(() => document.getElementById(`sched-existing-${key.slice(4)}`)?.scrollIntoView?.({ block: 'nearest' }), 0); }
  }

  const summaryLines = drafts.map((draft) => ({ draft, text: `${serviceById(draft.serviceId)?.name ?? 'Servicio'} · ${weekdaysShort(draft.weekdays)} · ${timeRangeLabel(draft.startTime, draft.durationMinutes)} · ${draft.capacity} plazas${draft.professionalId ? ` · ${professionalName(draft.professionalId)}` : ''}` }));

  return <div className="sched" data-schedule-editor>
    <div className="sched-lead">
      <div>
        <h3 id="sched-list-title">Horarios recurrentes</h3>
        <p>Define cada horario con su servicio, días, hora y duración. La vista previa de la derecha solo sirve para comprobarlo; no se edita haciendo clic en ella.</p>
      </div>
      <div className="sched-counter" aria-live="polite">
        <strong data-testid="schedule-counter">{counterLabel(drafts)}</strong>
        <span>{total === 1 ? '1 horario a crear' : `${total} horarios a crear`}</span>
      </div>
    </div>

    <div className="sched-body">
      <div className="sched-left">
        <div className="sched-add-row">
          <Button variant="primary" icon={icons.Plus} onClick={startNew} disabled={busy || remaining < 1 || panel !== null}>Añadir horario</Button>
          {remaining < 1 && <p className="sched-limit" role="status">{limitMessage()}</p>}
        </div>

        {panel && <ScheduleForm
          key={panel.draft.id}
          panelRef={panelRef}
          mode={panel.mode}
          draft={panel.draft}
          services={services} areas={areas} professionals={professionals}
          drafts={drafts}
          problems={panelProblems}
          onChange={patchPanel}
          onCancel={() => { setPanel(null); setPanelProblems([]); }}
          onCommit={commitPanel}
        />}

        <section className="sched-section" aria-labelledby="sched-new-title">
          <header><h4 id="sched-new-title">Nuevos <span className="sched-pill sched-pill--new">Borrador</span></h4></header>
          {drafts.length === 0 && <p className="sched-empty">Todavía no has añadido ningún horario nuevo. Pulsa «Añadir horario».</p>}
          <ul className="sched-cards">{drafts.map((draft) => {
            const service = serviceById(draft.serviceId);
            const conflict = conflicts.find((item) => item.draftId === draft.id || item.otherId === draft.id);
            return <li key={draft.id} id={`sched-draft-${draft.id}`} className="sched-card sched-card--draft" data-service-color={serviceColorIndex(draft.serviceId)} data-selected={selectedKey === `draft:${draft.id}`} aria-label={`Horario nuevo: ${service?.name ?? 'Servicio'}`}>
              <div className="sched-card-main">
                <strong>{service?.name ?? 'Servicio'}</strong>
                <span className="sched-days">{weekdaysLabel(draft.weekdays)}</span>
                <span className="sched-time">{timeRangeLabel(draft.startTime, draft.durationMinutes)} · {draft.capacity} plazas</span>
                <span className="sched-meta">{draft.professionalId ? professionalName(draft.professionalId) : 'Sin profesional asignado'}</span>
                <span className="sched-meta">{validityLabel(draft.startsOn, draft.endsOn)} · {draftCount(draft)} {draftCount(draft) === 1 ? 'horario' : 'horarios'}</span>
                {conflict && <span className="sched-conflict" role="alert">Se solapa con otro horario del mismo servicio o profesional ({conflict.label}).</span>}
              </div>
              <div className="sched-card-actions">
                <Button size="sm" variant="ghost" disabled={busy || panel !== null} aria-label={`Editar ${service?.name ?? 'horario'} ${weekdaysShort(draft.weekdays)} ${draft.startTime}`} onClick={() => openPanel('edit', { ...draft })}>Editar</Button>
                <Button size="sm" variant="ghost" disabled={busy || panel !== null || remaining < 1} aria-label={`Duplicar ${service?.name ?? 'horario'} ${weekdaysShort(draft.weekdays)} ${draft.startTime}`} onClick={() => startDuplicateDraft(draft)}>Duplicar</Button>
                <Button size="sm" variant="danger" disabled={busy} aria-label={`Eliminar ${service?.name ?? 'horario'} ${weekdaysShort(draft.weekdays)} ${draft.startTime}`} onClick={() => removeDraft(draft.id)}>Eliminar</Button>
              </div>
            </li>;
          })}</ul>
        </section>

        <details className="sched-section sched-existing" open={existingOpen} onToggle={(event) => setExistingOpen((event.currentTarget as HTMLDetailsElement).open)}>
          <summary><span>Existentes <span className="sched-pill">{templates.length}</span></span><small>Ya generan sesiones</small></summary>
          {existingGroups.length === 0 ? <p className="sched-empty">Todavía no hay horarios recurrentes.</p> : <>
            <p className="sched-note">Un horario existente no se edita: duplícalo para crear la variante y archiva el original si ya no hace falta.</p>
            <ul className="sched-cards">{existingGroups.map((group) => <li key={group.key} id={`sched-existing-${group.first.id}`} className="sched-card sched-card--existing" data-service-color={serviceColorIndex(group.first.serviceId)} data-selected={group.templates.some((item) => selectedKey === `tpl:${item.id}`)} aria-label={`Horario existente: ${group.first.serviceName}`}>
              <div className="sched-card-main">
                <strong>{group.first.serviceName}</strong>
                <span className="sched-days">{weekdaysLabel(group.weekdays)}</span>
                <span className="sched-time">{timeRangeLabel(group.first.localStartTime.slice(0, 5), group.first.durationMinutes)} · {group.first.capacity} plazas</span>
                <span className="sched-meta">{group.first.professionalName ?? 'Sin profesional asignado'}</span>
                <span className="sched-meta">{validityLabel(group.first.startsOn, group.first.endsOn)}</span>
              </div>
              <div className="sched-card-actions">
                <Button size="sm" variant="ghost" disabled={busy || panel !== null || remaining < 1} aria-label={`Duplicar horario existente ${group.first.serviceName} ${weekdaysShort(group.weekdays)} ${group.first.localStartTime.slice(0, 5)}`} onClick={() => startDuplicateExisting(group)}>Duplicar</Button>
                <Button size="sm" variant="danger" disabled={busy} aria-label={`Archivar horario: ${group.first.serviceName} ${weekdaysShort(group.weekdays)} ${group.first.localStartTime.slice(0, 5)}`} onClick={(event) => onArchive(group, event.currentTarget)}>Archivar</Button>
              </div>
            </li>)}</ul>
          </>}
        </details>
      </div>

      <section className="sched-right" aria-labelledby="sched-preview-title">
        <header className="sched-preview-head">
          <div><h4 id="sched-preview-title">Vista previa semanal</h4><p>Solo lectura. Franjas de 30 minutos: la línea fuerte marca la hora en punto y la suave la media hora.</p></div>
          <ul className="sched-legend" aria-label="Leyenda"><li><span className="sched-swatch sched-swatch--existing" aria-hidden="true" />Existentes</li><li><span className="sched-swatch sched-swatch--new" aria-hidden="true" />Nuevos</li></ul>
        </header>
        <div className="sched-day-tabs" role="tablist" aria-label="Día de la vista previa">{DISPLAY_WEEKDAYS.map((weekday) => <button key={weekday} type="button" role="tab" aria-selected={previewDay === weekday} aria-label={WEEKDAY_NAME[weekday]} className={previewDay === weekday ? 'selected' : ''} onClick={() => setPreviewDay(weekday)}>{WEEKDAY_LETTER[weekday]}</button>)}</div>
        <div className="sched-preview-scroll">
          <div className="sched-preview" role="group" aria-label="Vista previa semanal de horarios" style={{ '--slots': slots } as React.CSSProperties}>
            <div className="sched-col sched-col--axis" aria-hidden="true">
              <div className="sched-col-head" />
              <div className="sched-col-body">
                {Array.from({ length: slots }, (_, index) => { const minute = extent.start + index * 30; const hh = String(Math.floor(minute / 60)).padStart(2, '0'); const mm = minute % 60 === 0 ? '00' : '30'; return <span key={minute} className={minute % 60 === 0 ? 'sched-hour' : 'sched-half'} style={{ '--row': index } as React.CSSProperties}>{hh}:{mm}</span>; })}
              </div>
            </div>
            {DISPLAY_WEEKDAYS.map((weekday) => {
              const placed = byDay.get(weekday) ?? [];
              const chips = overflowChips(placed);
              return <div key={weekday} className="sched-col sched-day" data-weekday={weekday} data-selected={previewDay === weekday}>
                <div className="sched-col-head"><span>{WEEKDAY_LETTER[weekday]}</span><strong>{WEEKDAY_NAME[weekday]}</strong></div>
                <div className="sched-col-body" role="group" aria-label={`${WEEKDAY_NAME[weekday]}, horarios`}>
                  {placed.filter((item) => !item.hidden).map((item) => {
                    const entry = entryByKey(item.key)!;
                    const geo = blockGeometry(item, extent);
                    const box = laneBox(item);
                    const selected = selectedKey === (entry.kind === 'draft' ? `draft:${entry.draftId}` : item.key);
                    return <button key={item.key} type="button" className={`sched-block sched-block--${entry.kind}`} data-kind={entry.kind} data-key={item.key} data-service-color={serviceColorIndex(entry.serviceId)} data-weekday={weekday} data-start={item.startMinute} data-end={item.endMinute} data-top={geo.top} data-height={geo.height} data-lane={item.lane} data-lanes={item.lanes} data-left={box.left} data-width={box.width} data-selected={selected} aria-label={entry.label} title={entry.label} onClick={() => activateBlock(item.key)}
                      style={{ '--top': geo.top, '--span': geo.height, '--lane': item.lane, '--lanes': item.lanes } as React.CSSProperties}>
                      <strong>{String(Math.floor(item.startMinute / 60)).padStart(2, '0')}:{String(item.startMinute % 60).padStart(2, '0')}</strong>
                      <span>{serviceById(entry.serviceId)?.name ?? templates.find((template) => `tpl:${template.id}` === item.key)?.serviceName ?? 'Servicio'}</span>
                    </button>;
                  })}
                  {chips.map((chip) => {
                    const geo = blockGeometry(chip, extent);
                    const box = laneBox(chip);
                    const open = overflowOpen === `${weekday}:${chip.cluster}`;
                    return <button key={`more-${chip.cluster}`} type="button" className="sched-more" data-weekday={weekday} data-lane={chip.lane} data-lanes={chip.lanes} data-top={geo.top} data-height={geo.height} aria-expanded={open} aria-label={`${chip.hiddenKeys.length} horarios más solapados el ${WEEKDAY_NAME[weekday]}`} onClick={() => setOverflowOpen(open ? null : `${weekday}:${chip.cluster}`)} style={{ '--top': geo.top, '--span': geo.height, '--lane': chip.lane, '--lanes': chip.lanes } as React.CSSProperties}>+{chip.hiddenKeys.length}</button>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>
        {overflowOpen && (() => {
          const [dayText, clusterText] = overflowOpen.split(':');
          const placed = byDay.get(Number(dayText)) ?? [];
          const chip = overflowChips(placed).find((item) => String(item.cluster) === clusterText);
          if (!chip) return null;
          return <div className="sched-overflow" role="group" aria-label={`Horarios solapados el ${WEEKDAY_NAME[Number(dayText)]}`}>
            <strong>Solapados el {WEEKDAY_NAME[Number(dayText)]}</strong>
            <ul>{placed.filter((item) => chip.hiddenKeys.includes(item.key)).map((item) => { const entry = entryByKey(item.key)!; return <li key={item.key}><button type="button" onClick={() => activateBlock(item.key)}>{entry.label}</button></li>; })}</ul>
          </div>;
        })()}
      </section>
    </div>

    <section className="sched-summary" aria-labelledby="sched-summary-title">
      <h4 id="sched-summary-title">{total === 0 ? 'Todavía no hay nada que crear' : total === 1 ? 'Se creará 1 horario recurrente' : `Se crearán ${total} horarios recurrentes`}</h4>
      {summaryLines.length > 0 && <ul>{summaryLines.map((line) => <li key={line.draft.id}>{line.text}</li>)}</ul>}
      {conflicts.length > 0 && <p className="sched-conflict" role="alert">Hay horarios que se solapan. Corrígelos antes de crear.</p>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>
        <button type="button" className="button primary" disabled={busy || drafts.length === 0 || conflicts.length > 0 || panel !== null} onClick={() => void submit()}>{busy ? 'Creando…' : 'Crear horarios'}</button>
      </div>
    </section>
  </div>;
}

function ScheduleForm({ panelRef, mode, draft, services, areas, professionals, drafts, problems, onChange, onCancel, onCommit }: {
  panelRef: React.RefObject<HTMLElement>; mode: 'new' | 'edit' | 'duplicate'; draft: ScheduleDraft; services: Service[]; areas: Area[]; professionals: Professional[]; drafts: ScheduleDraft[]; problems: string[];
  onChange: (patch: Partial<ScheduleDraft>) => void; onCancel: () => void; onCommit: () => void;
}) {
  const editingId = mode === 'edit' ? draft.id : null;
  const remaining = remainingSchedules(drafts, editingId);
  const overLimit = draft.weekdays.length > remaining;
  const preset = (DURATION_PRESETS as readonly number[]).includes(draft.durationMinutes);
  const [custom, setCustom] = useState(!preset);
  const heading = mode === 'edit' ? 'Editar horario' : mode === 'duplicate' ? 'Duplicar horario' : 'Añadir horario';
  const rangeOk = /^\d{2}:\d{2}$/.test(draft.startTime) && Number.isInteger(draft.durationMinutes) && draft.durationMinutes > 0;
  return <section ref={panelRef} className="sched-form" role="group" aria-labelledby="sched-form-title">
    <h4 id="sched-form-title">{heading}</h4>
    {mode === 'duplicate' && <p className="sched-note">Se copian servicio, profesional, duración, plazas y vigencia. Cambia los días y la hora.</p>}
    <fieldset className="sched-fieldset">
      <legend>Horario</legend>
      <div className="sched-field">
        <span className="sched-label" id="sched-days-label">Días de la semana *</span>
        <div className="sched-days-toggle" role="group" aria-labelledby="sched-days-label">{DISPLAY_WEEKDAYS.map((weekday) => {
          const on = draft.weekdays.includes(weekday);
          const allowed = canSelectWeekday(drafts, editingId, draft.weekdays, weekday);
          return <button key={weekday} type="button" className={`sched-day-chip${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={WEEKDAY_NAME[weekday]} title={allowed ? WEEKDAY_NAME[weekday] : limitMessage()} disabled={!allowed} data-schedule-focus={weekday === 1 ? '' : undefined} onClick={() => onChange({ weekdays: sortWeekdays(on ? draft.weekdays.filter((item) => item !== weekday) : [...draft.weekdays, weekday]) })}>{WEEKDAY_LETTER[weekday]}</button>;
        })}</div>
      </div>
      <div className="sched-grid-2">
        <label className="sched-field"><span className="sched-label">Hora de inicio *</span>
          <select value={draft.startTime} onChange={(event) => onChange({ startTime: event.target.value })}>{timeOptionsFor(draft.startTime).map((time) => <option key={time} value={time}>{time}{isHalfHourStart(time) ? ' · y media' : ' · en punto'}</option>)}</select>
        </label>
        <label className="sched-field"><span className="sched-label">Duración *</span>
          <select value={custom ? 'custom' : String(draft.durationMinutes)} onChange={(event) => { if (event.target.value === 'custom') { setCustom(true); } else { setCustom(false); onChange({ durationMinutes: Number(event.target.value) }); } }}>{DURATION_PRESETS.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}<option value="custom">Personalizada…</option></select>
        </label>
      </div>
      {custom && <label className="sched-field"><span className="sched-label">Duración personalizada (minutos)</span><input type="number" min={5} max={480} step={5} value={Number.isFinite(draft.durationMinutes) ? draft.durationMinutes : ''} onChange={(event) => onChange({ durationMinutes: Number(event.target.value) })} /></label>}
      <p className="sched-range" aria-live="polite">{rangeOk ? <>Ocupará <strong>{timeRangeLabel(draft.startTime, draft.durationMinutes)}</strong> ({draft.durationMinutes} min)</> : 'Elige hora y duración.'}</p>
    </fieldset>
    <fieldset className="sched-fieldset">
      <legend>Sesión</legend>
      <label className="sched-field"><span className="sched-label">Servicio *</span>
        <select value={draft.serviceId} onChange={(event) => onChange({ serviceId: event.target.value })}><option value="">Selecciona un servicio</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {areas.find((area) => area.id === service.areaId)?.name}</option>)}</select>
      </label>
      <div className="sched-grid-2">
        <label className="sched-field"><span className="sched-label">Profesional</span>
          <select value={draft.professionalId} onChange={(event) => onChange({ professionalId: event.target.value })}><option value="">Sin asignar</option>{professionals.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select>
        </label>
        <label className="sched-field"><span className="sched-label">Plazas *</span>
          <input type="number" min={1} max={500} value={Number.isFinite(draft.capacity) ? draft.capacity : ''} onChange={(event) => onChange({ capacity: Number(event.target.value) })} />
        </label>
      </div>
    </fieldset>
    <fieldset className="sched-fieldset">
      <legend>Vigencia</legend>
      <div className="sched-grid-2">
        <label className="sched-field"><span className="sched-label">Desde *</span><input type="date" value={draft.startsOn} onChange={(event) => onChange({ startsOn: event.target.value })} /></label>
        <label className="sched-field"><span className="sched-label">Hasta (opcional)</span><input type="date" value={draft.endsOn} onChange={(event) => onChange({ endsOn: event.target.value })} /></label>
      </div>
    </fieldset>
    {overLimit && <p className="sched-limit" role="alert">{limitMessage()} Quita algún día para continuar.</p>}
    {problems.length > 0 && <ul className="sched-problems" role="alert">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
    <div className="sched-form-actions">
      <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      <Button variant="primary" disabled={overLimit} onClick={onCommit}>{mode === 'edit' ? 'Actualizar horario' : 'Añadir a la lista'}</Button>
    </div>
  </section>;
}
