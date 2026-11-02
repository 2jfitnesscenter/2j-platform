import React from 'react';

// Biblioteca de ejercicios (A86): lectura libre para cualquier socio con cuenta activa. No exige derecho de entrenamiento.
// Contrato de la API: GET /api/me/exercises (limit ≤ 200, offset, q, muscleGroup) y GET /api/me/exercises/:id.

export const PAGE_SIZE = 50;

// Grupos musculares tal como vienen del catálogo de Búnker (datos en inglés). Test: library-module.test.mjs los compara con el catálogo.
export const MUSCLE_GROUPS = [
  'hamstrings', 'biceps', 'triceps', 'shoulders', 'quadriceps', 'glutes', 'forearms', 'hip flexors', 'obliques', 'chest', 'traps', 'trapezius',
  'deltoids', 'calves', 'lower back', 'upper back', 'core', 'rotator cuff', 'abdominals', 'soleus', 'lats', 'latissimus dorsi', 'rhomboids',
  'ankle stabilizers', 'ankles', 'wrist flexors', 'wrist extensors', 'wrists', 'hands',
] as const;

export type ExerciseSummary = { id: string; name: string; muscleGroup: string; bodyPart: string; equipment: string; target: string; imageFile: string | null };
export type ExerciseDetail = ExerciseSummary & { secondaryMuscles: string[]; steps: string[]; gifFile: string | null };

/** Query string de la lista: solo los filtros que tienen valor, sin espacios sobrantes. */
export function buildExerciseQuery({ q, muscleGroup, offset }: { q: string; muscleGroup: string; offset: number }): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  const search = q.trim();
  if (search) params.set('q', search);
  if (muscleGroup) params.set('muscleGroup', muscleGroup);
  return params.toString();
}

/** Una búsqueda nueva (offset 0) sustituye la lista; cargar más la amplía. */
export function mergeExercisePage(current: ExerciseSummary[], page: ExerciseSummary[], offset: number): ExerciseSummary[] {
  return offset === 0 ? page : [...current, ...page];
}

async function libraryApi<T>(path: string): Promise<T> {
  const origin = import.meta.env?.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? '';
  const response = await fetch(`${origin}${path}`, { headers: { 'content-type': 'application/json' }, credentials: 'include', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error ?? 'exercise_request_failed'));
  return body as T;
}

/** Entrada en Inicio: siempre visible para socios con sesión (no depende de la cuota). */
export function LibraryEntryCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="profile-link-card library-home-card" onClick={onOpen}>
      <span className="eyebrow">BIBLIOTECA</span>
      <strong>Ejercicios</strong>
      <small className="muted">Busca un ejercicio y revisa cómo se hace.</small>
    </button>
  );
}

export function LibraryModule({ onBack, previewMode }: { onBack: () => void; previewMode: boolean }) {
  const [query, setQuery] = React.useState('');
  const [muscle, setMuscle] = React.useState('');
  const [items, setItems] = React.useState<ExerciseSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<ExerciseDetail | null>(null);
  const [detailFailed, setDetailFailed] = React.useState(false);

  const load = React.useCallback(async (offset: number, signal: { active: boolean }) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await libraryApi<{ items: ExerciseSummary[]; page: { totalCount: number } }>(`/api/me/exercises?${buildExerciseQuery({ q: query, muscleGroup: muscle, offset })}`);
      if (!signal.active) return;
      setItems(current => mergeExercisePage(current, page.items, offset));
      setTotal(page.page.totalCount);
    } catch {
      if (signal.active) setFailed(true);
    } finally {
      if (signal.active) setLoading(false);
    }
  }, [query, muscle]);

  React.useEffect(() => {
    // La vista previa no llama a la API nunca.
    if (previewMode) return;
    const signal = { active: true };
    const timer = window.setTimeout(() => { setItems([]); void load(0, signal); }, 250);
    return () => { signal.active = false; window.clearTimeout(timer); };
  }, [load, previewMode]);

  React.useEffect(() => {
    if (!selectedId || previewMode) return;
    let active = true;
    setDetail(null);
    setDetailFailed(false);
    libraryApi<{ exercise: ExerciseDetail }>(`/api/me/exercises/${selectedId}`)
      .then(result => { if (active) setDetail(result.exercise); })
      .catch(() => { if (active) setDetailFailed(true); });
    return () => { active = false; };
  }, [selectedId, previewMode]);

  if (selectedId) {
    return (
      <>
        <button className="text-button contextual-link" onClick={() => setSelectedId(null)}>← Volver a la biblioteca</button>
        {detailFailed && <section className="empty-card" role="alert"><h2>No se ha podido cargar el ejercicio</h2><button className="button secondary" onClick={() => setSelectedId(selectedId)}>Intentar de nuevo</button></section>}
        {!detail && !detailFailed && <p role="status">Cargando ejercicio…</p>}
        {detail && (
          <article className="library-detail">
            <p className="eyebrow">{detail.bodyPart} · {detail.equipment}</p>
            <h1>{detail.name}</h1>
            <p>Músculo principal: {detail.muscleGroup}</p>
            {detail.secondaryMuscles.length > 0 && <p>Músculos secundarios: {detail.secondaryMuscles.join(', ')}</p>}
            {detail.steps.length > 0 && <ol className="library-steps">{detail.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
          </article>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-intro"><p className="eyebrow">BIBLIOTECA</p><h1>Ejercicios</h1><p>Busca por nombre o filtra por grupo muscular.</p></div>
      <button className="text-button contextual-link" onClick={onBack}>← Volver a Inicio</button>
      {previewMode && <p className="inline-message" role="status">La biblioteca no está disponible en la vista previa.</p>}
      {!previewMode && <>
        <div className="library-filters">
          <label><span>Buscar</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre del ejercicio" maxLength={80} /></label>
          <label><span>Grupo muscular</span>
            <select value={muscle} onChange={event => setMuscle(event.target.value)}>
              <option value="">Todos</option>
              {MUSCLE_GROUPS.map(group => <option key={group} value={group}>{group}</option>)}
            </select>
          </label>
        </div>
        {failed && <p className="inline-message" role="alert">No se han podido cargar los ejercicios. <button className="text-button" onClick={() => void load(items.length, { active: true })}>Reintentar</button></p>}
        {!failed && !loading && items.length === 0 && <section className="empty-card"><h2>No hay ejercicios con esos filtros</h2><p>Prueba con otro nombre o quita el grupo muscular.</p></section>}
        <ul className="library-list">
          {items.map(exercise => (
            <li key={exercise.id}>
              <button type="button" className="library-item" onClick={() => setSelectedId(exercise.id)}>
                <strong>{exercise.name}</strong>
                <small className="muted">{exercise.muscleGroup} · {exercise.equipment}</small>
              </button>
            </li>
          ))}
        </ul>
        {loading && <p role="status">Cargando…</p>}
        {!loading && items.length > 0 && items.length < total && <button className="button secondary full" onClick={() => void load(items.length, { active: true })}>Cargar más ({total - items.length})</button>}
      </>}
    </>
  );
}
