import React from 'react';

/** A81: Entrenamiento del socio dentro de Platform. Los datos y el acceso los decide la API (/api/me/training/*). */

export type ExerciseMode = 'reps' | 'time' | 'cardio';
export type SetType = 'work' | 'warmup' | 'drop' | 'failure';
export type RoutineExercise = { position: number; exerciseId: string | null; exerciseName: string; targetSets: number; mode: ExerciseMode; target: Record<string, unknown> };
export type Routine = { id: string; name: string; status: 'active' | 'archived'; scheduledWeekdays: number[]; exercises: RoutineExercise[] };
type TodayResponse =
  | { status: 'rest_day'; date: string; openSessionId: string | null }
  | { status: 'training_day'; date: string; openSessionId: string | null; routine: { id: string; name: string; exercises: RoutineExercise[] } };
export type TrainingSet = { exerciseName: string; setIndex: number; setType?: SetType; done?: boolean; reps: number | null; weightKg: number | null; rir: number | null; seconds?: number | null; minutes?: number | null; speedKmh?: number | null };
type HistorySession = { id: string; routineName: string | null; startedAt: string; finishedAt: string; setCount: number; exercises: { exerciseName: string; sets: TrainingSet[] }[] };
type SessionView = { id: string; status: string; routineName: string | null; exercises: RoutineExercise[]; sets: TrainingSet[] };
type LastEntry = { exerciseName: string; finishedAt: string; sets: TrainingSet[] };
export type SetDraft = { reps: string; weight: string; rir: string; seconds?: string; minutes?: string; speed?: string; setType?: SetType };
export type ExerciseDraft = { exerciseId: string | null; exerciseName: string; mode: ExerciseMode; targetSets: string; goal: string };
export type RoutineDraft = { name: string; scheduledWeekdays: number[]; exercises: ExerciseDraft[] };

export class TrainingApiError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.error ?? 'training_request_failed')); }
}

async function trainingApi<T>(path: string, init?: RequestInit): Promise<T> {
  const origin = import.meta.env?.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';
  const response = await fetch(`${origin}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers }, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new TrainingApiError(response.status, body);
  return body as T;
}

const decimal = (text: string) => Number(text.replace(',', '.'));

/**
 * Valida lo que escribe el socio antes de enviarlo. Devuelve null si el borrador no es válido.
 * Los mismos límites están en la API (training-member.ts); aquí solo evitan una petición inútil.
 */
export function parseSetDraft(draft: SetDraft): { reps: number; weightKg: number; rir: number | null } | null {
  const reps = Number(draft.reps);
  const weightKg = decimal(draft.weight);
  const rir = draft.rir.trim() === '' ? null : decimal(draft.rir);
  if (draft.reps.trim() === '' || !Number.isInteger(reps) || reps < 0 || reps > 100) return null;
  if (draft.weight.trim() === '' || !Number.isFinite(weightKg) || weightKg < 0 || weightKg > 1000) return null;
  if (rir !== null && (!Number.isInteger(rir * 2) || rir < 0 || rir > 10)) return null;
  return { reps, weightKg, rir };
}

/** Borrador según el modo: repeticiones (reps, peso, RIR), tiempo (segundos) o cardio (minutos y velocidad opcional). */
export function parseModeDraft(draft: SetDraft, mode: ExerciseMode): Record<string, number | string | null> | null {
  const setType = draft.setType ?? 'work';
  if (mode === 'reps') { const parsed = parseSetDraft(draft); return parsed ? { ...parsed, setType } : null; }
  if (mode === 'time') {
    const seconds = Number(draft.seconds ?? '');
    if ((draft.seconds ?? '').trim() === '' || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return null;
    const weightKg = draft.weight.trim() === '' ? null : decimal(draft.weight);
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 1000)) return null;
    return { seconds, weightKg, setType };
  }
  const minutes = decimal(draft.minutes ?? '');
  if ((draft.minutes ?? '').trim() === '' || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) return null;
  const speedKmh = (draft.speed ?? '').trim() === '' ? null : decimal(draft.speed ?? '');
  if (speedKmh !== null && (!Number.isFinite(speedKmh) || speedKmh < 0 || speedKmh > 60)) return null;
  return { minutes, speedKmh, setType: 'work' };
}

const setTypeLabel: Record<SetType, string> = { work: 'Trabajo', warmup: 'Calentamiento', drop: 'Descendente', failure: 'Al fallo' };
const modeLabel: Record<ExerciseMode, string> = { reps: 'Repeticiones', time: 'Tiempo', cardio: 'Cardio' };

/** Texto corto de una serie guardada, según lo que tenga: repeticiones y peso, tiempo o cardio. */
export function describeSet(set: Omit<TrainingSet, 'exerciseName' | 'setIndex'>): string {
  const parts: string[] = [];
  if (set.minutes != null) parts.push(`${set.minutes} min${set.speedKmh != null ? ` a ${set.speedKmh} km/h` : ''}`);
  else if (set.seconds != null) parts.push(`${set.seconds} s${set.weightKg ? ` · ${set.weightKg} kg` : ''}`);
  else parts.push(`${set.reps ?? 0} × ${set.weightKg ?? 0} kg`);
  if (set.rir != null) parts.push(`RIR ${set.rir}`);
  if (set.setType && set.setType !== 'work') parts.push(setTypeLabel[set.setType]);
  return parts.join(' · ');
}

/** Objetivo de un ejercicio en una línea: "3 × 8-10", "3 × 45 s", "20 min". */
export function describeTarget(exercise: Pick<RoutineExercise, 'mode' | 'targetSets' | 'target'>): string {
  const goal = typeof exercise.target?.goal === 'string' ? exercise.target.goal : '';
  if (exercise.mode === 'cardio') return goal ? `${goal} min` : `${exercise.targetSets} ${exercise.targetSets === 1 ? 'bloque' : 'bloques'}`;
  if (exercise.mode === 'time') return `${exercise.targetSets} × ${goal ? `${goal} s` : 'tiempo'}`;
  return `${exercise.targetSets} × ${goal || 'reps'}`;
}

/** Convierte el formulario de rutina en el cuerpo que espera la API, o devuelve el mensaje de lo que falta. */
export function routineDraftToPayload(draft: RoutineDraft): { payload: Record<string, unknown> } | { error: string } {
  const name = draft.name.trim();
  if (!name) return { error: 'Ponle un nombre a la rutina.' };
  if (draft.exercises.length === 0) return { error: 'Añade al menos un ejercicio.' };
  if (draft.exercises.length > 40) return { error: 'Una rutina admite como máximo 40 ejercicios.' };
  const exercises = [];
  for (const exercise of draft.exercises) {
    const exerciseName = exercise.exerciseName.trim();
    const targetSets = Number(exercise.targetSets);
    if (!exerciseName) return { error: 'Cada ejercicio necesita un nombre.' };
    if (!Number.isInteger(targetSets) || targetSets < 1 || targetSets > 20) return { error: `Las series de "${exerciseName}" deben estar entre 1 y 20.` };
    const goal = exercise.goal.trim().slice(0, 40);
    exercises.push({ exerciseId: exercise.exerciseId, exerciseName: exerciseName.slice(0, 80), mode: exercise.mode, targetSets, target: goal ? { goal } : {} });
  }
  return { payload: { name: name.slice(0, 120), scheduledWeekdays: [...new Set(draft.scheduledWeekdays)].sort((a, b) => a - b), exercises } };
}

export const routineToDraft = (routine: Routine): RoutineDraft => ({
  name: routine.name, scheduledWeekdays: routine.scheduledWeekdays,
  exercises: routine.exercises.map(exercise => ({ exerciseId: exercise.exerciseId, exerciseName: exercise.exerciseName, mode: exercise.mode, targetSets: String(exercise.targetSets), goal: typeof exercise.target?.goal === 'string' ? exercise.target.goal : '' })),
});

const blockedCopy = { reason: 'Tu plan no incluye entrenamiento.', action: 'Pide a recepción que revisen tu acceso de entrenamiento.' };
const dateFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short' });
const weekdayShort = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const weekdayLong = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const setKey = (exerciseName: string, setIndex: number) => `${exerciseName}#${setIndex}`;
const emptyDraft: SetDraft = { reps: '', weight: '', rir: '', seconds: '', minutes: '', speed: '', setType: 'work' };

type Tab = 'today' | 'routines' | 'history';
type Mode = Tab | 'session' | 'editor';

export function TrainingModule({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = React.useState<Mode>('today');
  const [today, setToday] = React.useState<TodayResponse | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [session, setSession] = React.useState<{ id: string; exercises: RoutineExercise[]; routineName: string } | null>(null);
  const [sets, setSets] = React.useState<Record<string, TrainingSet>>({});
  const [drafts, setDrafts] = React.useState<Record<string, SetDraft>>({});
  const [extraSets, setExtraSets] = React.useState<Record<string, number>>({});
  const [last, setLast] = React.useState<Record<string, LastEntry>>({});
  const [history, setHistory] = React.useState<HistorySession[] | null>(null);
  const [routines, setRoutines] = React.useState<Routine[] | null>(null);
  const [editing, setEditing] = React.useState<{ id: string | null; draft: RoutineDraft } | null>(null);

  /** 403 = sin derecho de entrenamiento; cualquier otro fallo muestra el mensaje dado. */
  const fail = React.useCallback((caught: unknown, fallback: string, known: Record<string, string> = {}) => {
    if (caught instanceof TrainingApiError && caught.status === 403) { setBlocked(true); return; }
    setError(caught instanceof TrainingApiError ? known[String(caught.body.error)] ?? fallback : fallback);
  }, []);

  const load = React.useCallback(async () => {
    setError('');
    try { setToday(await trainingApi<TodayResponse>('/api/me/training/today')); setBlocked(false); }
    catch (caught) { fail(caught, 'No se ha podido cargar el entrenamiento de hoy.'); }
  }, [fail]);
  const loadHistory = React.useCallback(async () => {
    setError('');
    try { setHistory((await trainingApi<{ sessions: HistorySession[] }>('/api/me/training/history')).sessions); }
    catch (caught) { fail(caught, 'No se ha podido cargar tu historial.'); }
  }, [fail]);
  const loadRoutines = React.useCallback(async () => {
    setError('');
    try { setRoutines((await trainingApi<{ routines: Routine[] }>('/api/me/training/routines')).routines); }
    catch (caught) { fail(caught, 'No se han podido cargar tus rutinas.'); }
  }, [fail]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { if (mode === 'history') void loadHistory(); if (mode === 'routines') void loadRoutines(); }, [mode, loadHistory, loadRoutines]);

  /** Abre la sesión con sus series ya guardadas y la referencia de la última vez de cada ejercicio. */
  const openSession = async (sessionId: string) => {
    const view = (await trainingApi<{ session: SessionView }>(`/api/me/training/sessions/${sessionId}`)).session;
    const saved: Record<string, TrainingSet> = {}; const extra: Record<string, number> = {};
    for (const set of view.sets) {
      saved[setKey(set.exerciseName, set.setIndex)] = set;
      const planned = view.exercises.find(exercise => exercise.exerciseName === set.exerciseName)?.targetSets ?? 0;
      if (set.setIndex > planned) extra[set.exerciseName] = Math.max(extra[set.exerciseName] ?? 0, set.setIndex - planned);
    }
    setSession({ id: view.id, exercises: view.exercises, routineName: view.routineName ?? 'Sesión' });
    setSets(saved); setDrafts({}); setExtraSets(extra); setLast({}); setMode('session');
    if (view.exercises.length > 0) {
      const query = view.exercises.map(exercise => `exercise=${encodeURIComponent(exercise.exerciseName)}`).join('&');
      trainingApi<{ last: LastEntry[] }>(`/api/me/training/last?${query}`)
        .then(result => setLast(Object.fromEntries(result.last.map(entry => [entry.exerciseName, entry]))))
        .catch(() => setLast({}));
    }
  };

  const startSession = async (routineId?: string) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await trainingApi<{ session: { id: string } }>('/api/me/training/sessions', { method: 'POST', body: JSON.stringify(routineId ? { routineId } : {}) });
      await openSession(result.session.id);
    } catch (caught) { fail(caught, 'No se ha podido empezar la sesión.', { no_routine_today: 'Hoy no tienes rutina asignada.', training_routine_not_found: 'Esa rutina ya no está disponible.' }); }
    finally { setBusy(false); }
  };
  const resumeSession = async (sessionId: string) => {
    setBusy(true); setError('');
    try { await openSession(sessionId); } catch (caught) { fail(caught, 'No se ha podido abrir la sesión en curso.'); } finally { setBusy(false); }
  };

  const saveSet = async (exercise: RoutineExercise, setIndex: number) => {
    if (!session) return;
    const key = setKey(exercise.exerciseName, setIndex);
    const parsed = parseModeDraft(drafts[key] ?? emptyDraft, exercise.mode);
    if (!parsed) {
      setError(exercise.mode === 'reps' ? 'Revisa repeticiones (0–100), peso (0–1000 kg) y RIR (0–10).' : exercise.mode === 'time' ? 'Indica los segundos (1–86400).' : 'Indica los minutos y, si quieres, la velocidad (0–60 km/h).');
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await trainingApi<{ set: TrainingSet }>(`/api/me/training/sessions/${session.id}/sets`, { method: 'POST', body: JSON.stringify({ exerciseName: exercise.exerciseName, setIndex, ...parsed }) });
      setSets(current => ({ ...current, [key]: result.set }));
    } catch (caught) { fail(caught, 'No se ha podido guardar la serie.', { session_not_open: 'Esta sesión ya está cerrada.' }); }
    finally { setBusy(false); }
  };

  const finishSession = async () => {
    if (!session) return;
    setBusy(true); setError('');
    try {
      await trainingApi(`/api/me/training/sessions/${session.id}/finish`, { method: 'POST', body: JSON.stringify({}) });
      setSession(null); setMessage('Sesión guardada.'); setMode('history'); void load();
    } catch (caught) { fail(caught, 'No se ha podido terminar la sesión.', { no_sets_logged: 'Guarda al menos una serie antes de terminar.' }); }
    finally { setBusy(false); }
  };

  const saveRoutine = async () => {
    if (!editing) return;
    const built = routineDraftToPayload(editing.draft);
    if ('error' in built) { setError(built.error); return; }
    setBusy(true); setError('');
    try {
      await trainingApi(editing.id ? `/api/me/training/routines/${editing.id}` : '/api/me/training/routines', { method: editing.id ? 'PATCH' : 'POST', body: JSON.stringify(built.payload) });
      setMessage(editing.id ? 'Rutina actualizada.' : 'Rutina creada.'); setEditing(null); setMode('routines'); void load();
    } catch (caught) { fail(caught, 'No se ha podido guardar la rutina.', { training_routine_limit: 'Has llegado al máximo de rutinas activas. Archiva una para crear otra.', invalid_training_routine: 'Revisa los datos de la rutina.' }); }
    finally { setBusy(false); }
  };
  const setRoutineStatus = async (routine: Routine, status: 'active' | 'archived') => {
    setBusy(true); setError('');
    try { await trainingApi(`/api/me/training/routines/${routine.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setMessage(status === 'archived' ? 'Rutina archivada.' : 'Rutina recuperada.'); await loadRoutines(); void load(); }
    catch (caught) { fail(caught, 'No se ha podido cambiar la rutina.'); }
    finally { setBusy(false); }
  };

  if (blocked) {
    return (
      <section className="settings-card" role="alert" aria-labelledby="training-blocked-title">
        <p className="eyebrow">ENTRENAMIENTO</p>
        <h2 id="training-blocked-title">Entrenamiento no disponible</h2>
        <p className="muted">Motivo: {blockedCopy.reason}</p>
        <p>{blockedCopy.action}</p>
        <button type="button" className="button secondary" onClick={onBack}>Volver</button>
      </section>
    );
  }

  const tab: Tab = mode === 'history' ? 'history' : mode === 'routines' || mode === 'editor' ? 'routines' : 'today';
  const title = mode === 'history' ? 'Historial' : mode === 'session' ? session?.routineName ?? 'Sesión' : mode === 'routines' ? 'Mis rutinas' : mode === 'editor' ? (editing?.id ? 'Editar rutina' : 'Nueva rutina') : 'Hoy';
  const go = (next: Tab) => { setMessage(''); setError(''); setEditing(null); setMode(next); if (next === 'today') void load(); };
  const savedCount = Object.keys(sets).length;

  return (
    <section className="settings-card training-module" aria-labelledby="training-title">
      <button type="button" className="text-button contextual-link" onClick={onBack}>← Volver</button>
      <p className="eyebrow">ENTRENAMIENTO</p>
      <h2 id="training-title">{title}</h2>
      <nav className="training-tabs" aria-label="Entrenamiento">
        {([['today', 'Hoy'], ['routines', 'Rutinas'], ['history', 'Historial']] as const).map(([id, label]) => (
          <button key={id} type="button" className={`button ${tab === id ? 'primary' : 'secondary'}`} aria-pressed={tab === id} onClick={() => go(id)}>{label}</button>
        ))}
      </nav>
      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="state-card error-card" role="alert">{error}</p>}

      {mode === 'today' && !today && !error && <p className="muted">Cargando…</p>}
      {mode === 'today' && today?.openSessionId && (
        <div className="empty-card">
          <p>Tienes una sesión en curso.</p>
          <button type="button" className="button primary full" disabled={busy} onClick={() => resumeSession(today.openSessionId!)}>Continuar sesión</button>
        </div>
      )}
      {mode === 'today' && today?.status === 'rest_day' && !today.openSessionId && (
        <div className="empty-card">
          <p>Hoy no tienes rutina programada.</p>
          <button type="button" className="button secondary" onClick={() => go('routines')}>Elegir o crear una rutina</button>
        </div>
      )}
      {mode === 'today' && today?.status === 'training_day' && !today.openSessionId && (
        <div>
          <p className="section-heading">{today.routine.name}</p>
          <ul aria-label="Ejercicios de hoy" className="training-plan-list">
            {today.routine.exercises.map(exercise => <li key={exercise.position}>{exercise.exerciseName} · {describeTarget(exercise)}</li>)}
          </ul>
          <button type="button" className="button primary full" disabled={busy} onClick={() => startSession()}>Empezar entrenamiento</button>
        </div>
      )}

      {mode === 'session' && session && (
        <div>
          {session.exercises.length === 0 && <p className="muted">Esta rutina no tiene ejercicios. Edítala en Rutinas.</p>}
          {session.exercises.map(exercise => {
            const count = exercise.targetSets + (extraSets[exercise.exerciseName] ?? 0);
            const previous = last[exercise.exerciseName];
            return (
              <fieldset key={exercise.position} className="training-exercise">
                <legend>{exercise.exerciseName}</legend>
                <small className="muted">Objetivo: {describeTarget(exercise)}{previous ? ` · Última vez (${dayFormat.format(new Date(previous.finishedAt))}): ${previous.sets.map(describeSet).join(', ')}` : ''}</small>
                {Array.from({ length: count }, (_, index) => index + 1).map(setIndex => {
                  const key = setKey(exercise.exerciseName, setIndex);
                  const draft = drafts[key] ?? emptyDraft;
                  const saved = sets[key];
                  const edit = (patch: Partial<SetDraft>) => setDrafts(current => ({ ...current, [key]: { ...draft, ...patch } }));
                  return (
                    <div key={key} className="training-set">
                      <span>Serie {setIndex}</span>
                      {exercise.mode === 'reps' && <>
                        <label>Reps <input inputMode="numeric" value={draft.reps} onChange={event => edit({ reps: event.target.value })} /></label>
                        <label>Peso (kg) <input inputMode="decimal" value={draft.weight} onChange={event => edit({ weight: event.target.value })} /></label>
                        <label>RIR <input inputMode="decimal" value={draft.rir} onChange={event => edit({ rir: event.target.value })} /></label>
                      </>}
                      {exercise.mode === 'time' && <>
                        <label>Segundos <input inputMode="numeric" value={draft.seconds ?? ''} onChange={event => edit({ seconds: event.target.value })} /></label>
                        <label>Peso (kg, opcional) <input inputMode="decimal" value={draft.weight} onChange={event => edit({ weight: event.target.value })} /></label>
                      </>}
                      {exercise.mode === 'cardio' && <>
                        <label>Minutos <input inputMode="decimal" value={draft.minutes ?? ''} onChange={event => edit({ minutes: event.target.value })} /></label>
                        <label>Velocidad (km/h, opcional) <input inputMode="decimal" value={draft.speed ?? ''} onChange={event => edit({ speed: event.target.value })} /></label>
                      </>}
                      {exercise.mode !== 'cardio' && <label>Tipo <select value={draft.setType ?? 'work'} onChange={event => edit({ setType: event.target.value as SetType })}>{(Object.keys(setTypeLabel) as SetType[]).map(type => <option key={type} value={type}>{setTypeLabel[type]}</option>)}</select></label>}
                      <button type="button" className="button secondary" disabled={busy} onClick={() => saveSet(exercise, setIndex)}>{saved ? 'Actualizar' : 'Guardar'}</button>
                      {saved && <small className="muted">Guardada: {describeSet(saved)}</small>}
                    </div>
                  );
                })}
                {count < 50 && <button type="button" className="text-button" onClick={() => setExtraSets(current => ({ ...current, [exercise.exerciseName]: (current[exercise.exerciseName] ?? 0) + 1 }))}>+ Añadir serie</button>}
              </fieldset>
            );
          })}
          <p className="muted" role="status">{savedCount} {savedCount === 1 ? 'serie guardada' : 'series guardadas'}</p>
          <button type="button" className="button primary full" disabled={busy} onClick={finishSession}>Terminar y guardar</button>
        </div>
      )}

      {mode === 'routines' && (routines === null ? <p className="muted">Cargando…</p> : (
        <div>
          <button type="button" className="button primary full" onClick={() => { setError(''); setMessage(''); setEditing({ id: null, draft: { name: '', scheduledWeekdays: [], exercises: [] } }); setMode('editor'); }}>Nueva rutina</button>
          {routines.length === 0 && <div className="empty-card"><p>Aún no tienes rutinas. Crea la primera y asígnale los días que entrenas.</p></div>}
          <ul className="training-routines" aria-label="Mis rutinas">
            {routines.map(routine => (
              <li key={routine.id} className="settings-card">
                <strong>{routine.name}</strong>
                <small className="muted"> {routine.status === 'archived' ? 'Archivada' : routine.scheduledWeekdays.length ? routine.scheduledWeekdays.map(day => weekdayLong[day - 1]).join(', ') : 'Sin días fijos'} · {routine.exercises.length} {routine.exercises.length === 1 ? 'ejercicio' : 'ejercicios'}</small>
                <div className="training-actions">
                  {routine.status === 'active' ? <>
                    <button type="button" className="button primary" disabled={busy || routine.exercises.length === 0} onClick={() => startSession(routine.id)}>Entrenar ahora</button>
                    <button type="button" className="button secondary" onClick={() => { setError(''); setMessage(''); setEditing({ id: routine.id, draft: routineToDraft(routine) }); setMode('editor'); }}>Editar</button>
                    <button type="button" className="text-button" disabled={busy} onClick={() => setRoutineStatus(routine, 'archived')}>Archivar</button>
                  </> : <button type="button" className="button secondary" disabled={busy} onClick={() => setRoutineStatus(routine, 'active')}>Recuperar</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {mode === 'editor' && editing && <RoutineEditor draft={editing.draft} busy={busy} onChange={draft => setEditing({ id: editing.id, draft })} onSave={saveRoutine} onCancel={() => go('routines')} />}

      {mode === 'history' && (history === null ? <p className="muted">Cargando…</p> : history.length === 0 ? (
        <div className="empty-card"><p>Aún no tienes sesiones guardadas.</p></div>
      ) : (
        <ol className="training-history" aria-label="Sesiones guardadas">
          {history.map(item => (
            <li key={item.id} className="settings-card">
              <strong>{item.routineName ?? 'Sesión libre'}</strong>
              <small className="muted"> {dateFormat.format(new Date(item.startedAt))} · {item.setCount} series</small>
              <ul>
                {item.exercises.map(exercise => (
                  <li key={exercise.exerciseName}>{exercise.exerciseName}: {exercise.sets.map(describeSet).join(' · ')}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ))}
    </section>
  );
}

type CatalogHit = { id: string; name: string; muscleGroup: string; equipment: string };

/** Formulario de rutina: nombre, días y ejercicios elegidos de la biblioteca o escritos a mano. */
function RoutineEditor({ draft, busy, onChange, onSave, onCancel }: { draft: RoutineDraft; busy: boolean; onChange: (draft: RoutineDraft) => void; onSave: () => void; onCancel: () => void }) {
  const [search, setSearch] = React.useState('');
  const [hits, setHits] = React.useState<CatalogHit[]>([]);
  React.useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setHits([]); return; }
    let active = true;
    const timer = window.setTimeout(() => {
      trainingApi<{ items: CatalogHit[] }>(`/api/me/exercises?limit=8&offset=0&q=${encodeURIComponent(q)}`)
        .then(result => { if (active) setHits(result.items); })
        .catch(() => { if (active) setHits([]); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);
  const patch = (index: number, change: Partial<ExerciseDraft>) => onChange({ ...draft, exercises: draft.exercises.map((exercise, position) => position === index ? { ...exercise, ...change } : exercise) });
  const add = (exerciseId: string | null, exerciseName: string) => { onChange({ ...draft, exercises: [...draft.exercises, { exerciseId, exerciseName: exerciseName.slice(0, 80), mode: 'reps', targetSets: '3', goal: '' }] }); setSearch(''); setHits([]); };
  const move = (index: number, delta: number) => {
    const next = [...draft.exercises]; const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...draft, exercises: next });
  };
  const toggleDay = (day: number) => onChange({ ...draft, scheduledWeekdays: draft.scheduledWeekdays.includes(day) ? draft.scheduledWeekdays.filter(item => item !== day) : [...draft.scheduledWeekdays, day] });
  return (
    <form className="training-editor" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <label>Nombre <input value={draft.name} maxLength={120} onChange={event => onChange({ ...draft, name: event.target.value })} placeholder="Por ejemplo: Fuerza A" /></label>
      <fieldset className="training-days"><legend>Días</legend>
        {weekdayShort.map((label, index) => <button key={index} type="button" className={`button ${draft.scheduledWeekdays.includes(index + 1) ? 'primary' : 'secondary'}`} aria-pressed={draft.scheduledWeekdays.includes(index + 1)} aria-label={weekdayLong[index]} onClick={() => toggleDay(index + 1)}>{label}</button>)}
      </fieldset>
      <ol className="training-editor-list" aria-label="Ejercicios de la rutina">
        {draft.exercises.map((exercise, index) => (
          <li key={index} className="training-set">
            <strong>{index + 1}. {exercise.exerciseName}</strong>
            <label>Modo <select value={exercise.mode} onChange={event => patch(index, { mode: event.target.value as ExerciseMode })}>{(Object.keys(modeLabel) as ExerciseMode[]).map(item => <option key={item} value={item}>{modeLabel[item]}</option>)}</select></label>
            <label>Series <input inputMode="numeric" value={exercise.targetSets} onChange={event => patch(index, { targetSets: event.target.value })} /></label>
            <label>{exercise.mode === 'reps' ? 'Repeticiones objetivo' : exercise.mode === 'time' ? 'Segundos objetivo' : 'Minutos objetivo'} <input value={exercise.goal} maxLength={40} onChange={event => patch(index, { goal: event.target.value })} placeholder={exercise.mode === 'reps' ? '8-10' : exercise.mode === 'time' ? '45' : '20'} /></label>
            <div className="training-actions">
              <button type="button" className="text-button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Subir ${exercise.exerciseName}`}>↑ Subir</button>
              <button type="button" className="text-button" disabled={index === draft.exercises.length - 1} onClick={() => move(index, 1)} aria-label={`Bajar ${exercise.exerciseName}`}>↓ Bajar</button>
              <button type="button" className="text-button" onClick={() => onChange({ ...draft, exercises: draft.exercises.filter((_, position) => position !== index) })} aria-label={`Quitar ${exercise.exerciseName}`}>Quitar</button>
            </div>
          </li>
        ))}
      </ol>
      <label>Añadir ejercicio <input type="search" value={search} maxLength={80} onChange={event => setSearch(event.target.value)} placeholder="Busca en la biblioteca o escribe el nombre" /></label>
      {search.trim().length >= 2 && (
        <ul className="library-list" aria-label="Resultados de la biblioteca">
          {hits.map(hit => <li key={hit.id}><button type="button" className="library-item" onClick={() => add(hit.id, hit.name)}><strong>{hit.name}</strong><small className="muted">{hit.muscleGroup} · {hit.equipment}</small></button></li>)}
          <li><button type="button" className="text-button" onClick={() => add(null, search.trim())}>Añadir «{search.trim()}» tal cual</button></li>
        </ul>
      )}
      <div className="training-actions">
        <button type="submit" className="button primary" disabled={busy}>Guardar rutina</button>
        <button type="button" className="button secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

/** Tarjeta de Inicio: solo aparece con el derecho de entrenamiento. Sin derecho, el motivo y la acción se muestran al abrir Entrenar. */
export function TrainingEntryCard({ onOpen, previewMode }: { onOpen: () => void; previewMode: boolean }) {
  const [entitled, setEntitled] = React.useState(false);
  React.useEffect(() => {
    // La vista previa no llama a la API nunca.
    if (previewMode) return;
    let active = true;
    trainingApi<{ entitled: boolean }>('/api/me/training/access')
      .then(result => { if (active) setEntitled(result.entitled); })
      .catch(() => { if (active) setEntitled(false); });
    return () => { active = false; };
  }, [previewMode]);
  if (previewMode || !entitled) return null;
  return (
    <button type="button" className="profile-link-card training-home-card" onClick={onOpen}>
      <strong>Entrenar</strong>
      <small className="muted">Sesión de hoy, rutinas e historial.</small>
    </button>
  );
}
