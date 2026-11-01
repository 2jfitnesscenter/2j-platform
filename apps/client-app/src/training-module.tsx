import React from 'react';

/** A81 slice 1: Entrenamiento del socio dentro de Platform. Los datos y el acceso los decide la API (/api/me/training/*). */

type Exercise = { position: number; exerciseName: string; targetSets: number };
type TodayResponse =
  | { status: 'rest_day'; date: string; openSessionId: string | null }
  | { status: 'training_day'; date: string; openSessionId: string | null; routine: { id: string; name: string; exercises: Exercise[] } };
export type TrainingSet = { exerciseName: string; setIndex: number; reps: number; weightKg: number; rir: number | null };
type HistorySession = { id: string; routineName: string | null; startedAt: string; finishedAt: string; setCount: number; exercises: { exerciseName: string; sets: Omit<TrainingSet, 'exerciseName'>[] }[] };
export type SetDraft = { reps: string; weight: string; rir: string };

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

/**
 * Valida lo que escribe el socio antes de enviarlo. Devuelve null si el borrador no es válido.
 * Los mismos límites están en la API (training-member.ts); aquí solo evitan una petición inútil.
 */
export function parseSetDraft(draft: SetDraft): { reps: number; weightKg: number; rir: number | null } | null {
  const reps = Number(draft.reps);
  const weightKg = Number(draft.weight.replace(',', '.'));
  const rir = draft.rir.trim() === '' ? null : Number(draft.rir);
  if (draft.reps.trim() === '' || !Number.isInteger(reps) || reps < 0 || reps > 100) return null;
  if (draft.weight.trim() === '' || !Number.isFinite(weightKg) || weightKg < 0 || weightKg > 1000) return null;
  if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > 10)) return null;
  return { reps, weightKg, rir };
}

const blockedCopy = { reason: 'Tu plan no incluye entrenamiento.', action: 'Pide a recepción que revisen tu acceso de entrenamiento.' };
const dateFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'medium', timeStyle: 'short' });
const setKey = (exerciseName: string, setIndex: number) => `${exerciseName}#${setIndex}`;
const describeSet = (set: { reps: number; weightKg: number; rir: number | null }) => `${set.reps} × ${set.weightKg} kg${set.rir === null ? '' : ` · RIR ${set.rir}`}`;

export function TrainingModule({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = React.useState<'today' | 'session' | 'history'>('today');
  const [today, setToday] = React.useState<TodayResponse | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [session, setSession] = React.useState<{ id: string; exercises: Exercise[]; routineName: string } | null>(null);
  const [sets, setSets] = React.useState<Record<string, TrainingSet>>({});
  const [drafts, setDrafts] = React.useState<Record<string, SetDraft>>({});
  const [history, setHistory] = React.useState<HistorySession[] | null>(null);

  const load = React.useCallback(async () => {
    setError('');
    try {
      setToday(await trainingApi<TodayResponse>('/api/me/training/today'));
      setBlocked(false);
    } catch (caught) {
      if (caught instanceof TrainingApiError && caught.status === 403) setBlocked(true);
      else setError('No se ha podido cargar el entrenamiento de hoy.');
    }
  }, []);

  const loadHistory = React.useCallback(async () => {
    setError('');
    try {
      setHistory((await trainingApi<{ sessions: HistorySession[] }>('/api/me/training/history')).sessions);
    } catch (caught) {
      if (caught instanceof TrainingApiError && caught.status === 403) setBlocked(true);
      else setError('No se ha podido cargar tu historial.');
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { if (mode === 'history') void loadHistory(); }, [mode, loadHistory]);

  const startSession = async () => {
    if (!today || today.status !== 'training_day') return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await trainingApi<{ session: { id: string } }>('/api/me/training/sessions', { method: 'POST', body: JSON.stringify({}) });
      setSession({ id: result.session.id, exercises: today.routine.exercises, routineName: today.routine.name });
      setSets({}); setDrafts({}); setMode('session');
    } catch (caught) {
      if (caught instanceof TrainingApiError && caught.status === 403) setBlocked(true);
      else setError(caught instanceof TrainingApiError && caught.body.error === 'no_routine_today' ? 'Hoy no tienes rutina asignada.' : 'No se ha podido empezar la sesión.');
    } finally { setBusy(false); }
  };

  const saveSet = async (exerciseName: string, setIndex: number) => {
    if (!session) return;
    const parsed = parseSetDraft(drafts[setKey(exerciseName, setIndex)] ?? { reps: '', weight: '', rir: '' });
    if (!parsed) { setError('Revisa repeticiones (0–100), peso (0–1000 kg) y RIR (0–10).'); return; }
    setBusy(true); setError('');
    try {
      const result = await trainingApi<{ set: TrainingSet }>(`/api/me/training/sessions/${session.id}/sets`, { method: 'POST', body: JSON.stringify({ exerciseName, setIndex, ...parsed }) });
      setSets(current => ({ ...current, [setKey(exerciseName, setIndex)]: result.set }));
    } catch (caught) {
      setError(caught instanceof TrainingApiError && caught.body.error === 'session_not_open' ? 'Esta sesión ya está cerrada.' : 'No se ha podido guardar la serie.');
    } finally { setBusy(false); }
  };

  const finishSession = async () => {
    if (!session) return;
    setBusy(true); setError('');
    try {
      await trainingApi(`/api/me/training/sessions/${session.id}/finish`, { method: 'POST', body: JSON.stringify({}) });
      setSession(null); setMessage('Sesión guardada.'); setMode('history');
    } catch (caught) {
      setError(caught instanceof TrainingApiError && caught.body.error === 'no_sets_logged' ? 'Guarda al menos una serie antes de terminar.' : 'No se ha podido terminar la sesión.');
    } finally { setBusy(false); }
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

  return (
    <section className="settings-card training-module" aria-labelledby="training-title">
      <button type="button" className="text-button contextual-link" onClick={onBack}>← Volver</button>
      <p className="eyebrow">ENTRENAMIENTO</p>
      <h2 id="training-title">{mode === 'history' ? 'Historial' : mode === 'session' ? session?.routineName ?? 'Sesión' : 'Hoy'}</h2>
      <nav className="training-tabs" aria-label="Entrenamiento">
        <button type="button" className={`button ${mode === 'today' ? 'primary' : 'secondary'}`} aria-pressed={mode === 'today'} onClick={() => { setMode('today'); void load(); }}>Hoy</button>
        <button type="button" className={`button ${mode === 'history' ? 'primary' : 'secondary'}`} aria-pressed={mode === 'history'} onClick={() => setMode('history')}>Historial</button>
      </nav>
      {message && <p className="muted" role="status">{message}</p>}
      {error && <p className="state-card error-card" role="alert">{error}</p>}

      {mode === 'today' && !today && !error && <p className="muted">Cargando…</p>}
      {mode === 'today' && today?.status === 'rest_day' && (
        <div className="empty-card">
          <p>Hoy toca descanso.</p>
          <button type="button" className="button secondary" onClick={() => setMode('history')}>Ver historial</button>
        </div>
      )}
      {mode === 'today' && today?.status === 'training_day' && (
        <div>
          <p className="section-heading">{today.routine.name}</p>
          <ul aria-label="Ejercicios de hoy">
            {today.routine.exercises.map(exercise => <li key={exercise.position}>{exercise.exerciseName} · {exercise.targetSets} series</li>)}
          </ul>
          <button type="button" className="button primary full" disabled={busy} onClick={startSession}>Empezar entrenamiento</button>
        </div>
      )}

      {mode === 'session' && session && (
        <div>
          {session.exercises.map(exercise => (
            <fieldset key={exercise.position} className="training-exercise">
              <legend>{exercise.exerciseName}</legend>
              {Array.from({ length: exercise.targetSets }, (_, index) => index + 1).map(setIndex => {
                const key = setKey(exercise.exerciseName, setIndex);
                const draft = drafts[key] ?? { reps: '', weight: '', rir: '' };
                const saved = sets[key];
                return (
                  <div key={key} className="training-set">
                    <span>Serie {setIndex}</span>
                    <label>Reps <input inputMode="numeric" value={draft.reps} onChange={event => setDrafts(current => ({ ...current, [key]: { ...draft, reps: event.target.value } }))} /></label>
                    <label>Peso (kg) <input inputMode="decimal" value={draft.weight} onChange={event => setDrafts(current => ({ ...current, [key]: { ...draft, weight: event.target.value } }))} /></label>
                    <label>RIR <input inputMode="numeric" value={draft.rir} onChange={event => setDrafts(current => ({ ...current, [key]: { ...draft, rir: event.target.value } }))} /></label>
                    <button type="button" className="button secondary" disabled={busy} onClick={() => saveSet(exercise.exerciseName, setIndex)}>{saved ? 'Actualizar' : 'Guardar'}</button>
                    {saved && <small className="muted">Guardada: {describeSet(saved)}</small>}
                  </div>
                );
              })}
            </fieldset>
          ))}
          <button type="button" className="button primary full" disabled={busy} onClick={finishSession}>Terminar y guardar</button>
        </div>
      )}

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
