import React from 'react';
import { Button, Card, CardHeader, EmptyState, StatusChip, icons } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';

type ClientFile = { id: string; title: string; documentType: 'contract' | 'consent' | 'identity' | 'other'; visibility: 'staff_only' | 'client_visible'; mimeType: string; sizeBytes: number; createdAt: string };
type LoadState = 'loading' | 'ready' | 'denied' | 'unavailable' | 'error';

const typeLabel: Record<ClientFile['documentType'], string> = { contract: 'Contrato', consent: 'Consentimiento', identity: 'Identidad', other: 'Otro' };
const stamp = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', day: 'numeric', month: 'short', year: 'numeric' });
const MAX_BYTES = 5 * 1024 * 1024;
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const uploadErrors: Record<string, string> = {
  file_too_large: 'El archivo supera los 5 MB.',
  unsupported_document_type: 'Solo se admiten PDF, JPG o PNG.',
  file_required: 'Elige un archivo.',
  validation_error: 'Revisa el título y el tipo.',
  storage_unavailable: 'El almacenamiento no está disponible ahora. Inténtalo más tarde.',
};

/**
 * Archivos del cliente (fila 16 de paridad): documentos privados subidos por el personal. El servidor genera la clave del
 * archivo, comprueba el tipo por contenido y decide quién lo ve; esta pantalla solo lista, sube, cambia la visibilidad y
 * descarga. «Visible para el cliente» es una decisión explícita: por defecto el archivo es solo del personal.
 */
export function ClientFilesPanel({ clientId }: { clientId: string }) {
  const [files, setFiles] = React.useState<ClientFile[]>([]);
  const [state, setState] = React.useState<LoadState>('loading');
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [documentType, setDocumentType] = React.useState<ClientFile['documentType']>('contract');
  const [visibility, setVisibility] = React.useState<ClientFile['visibility']>('staff_only');
  const [file, setFile] = React.useState<File | null>(null);
  const [fileKey, setFileKey] = React.useState(0);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/clients/${clientId}/documents`, signal ? { signal } : undefined);
      if (response.status === 403 || response.status === 401) { setState('denied'); return; }
      if (response.status === 404) { setState('unavailable'); return; }
      if (!response.ok) throw new Error(String(response.status));
      setFiles((await response.json() as { items: ClientFile[] }).items);
      setState('ready');
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState('error'); }
  }, [clientId]);
  React.useEffect(() => { setState('loading'); const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    setError(''); setMessage('');
    if (!file) { setError(uploadErrors.file_required!); return; }
    if (file.size > MAX_BYTES) { setError(uploadErrors.file_too_large!); return; }
    if (title.trim().length < 2) { setError(uploadErrors.validation_error!); return; }
    setBusy(true);
    try {
      // The text fields go before the file: the server reads them from the same multipart stream.
      const form = new FormData();
      form.append('title', title.trim()); form.append('documentType', documentType); form.append('visibility', visibility); form.append('file', file);
      const response = await fetch(`${apiUrl}/api/clients/${clientId}/documents`, { method: 'POST', body: form });
      if (response.status === 403) throw new Error('Tu perfil no puede subir archivos.');
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(uploadErrors[body.error ?? ''] ?? 'No se pudo subir el archivo.'); }
      setTitle(''); setFile(null); setFileKey((value) => value + 1); setVisibility('staff_only');
      setMessage('Archivo guardado.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo subir el archivo.'); }
    finally { setBusy(false); }
  }

  async function changeVisibility(item: ClientFile) {
    const next = item.visibility === 'staff_only' ? 'client_visible' : 'staff_only';
    setError(''); setMessage(''); setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/clients/${clientId}/documents/${item.id}/visibility`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: next }) });
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu perfil no puede cambiar la visibilidad.' : 'No se pudo cambiar la visibilidad.');
      setMessage(next === 'client_visible' ? 'El cliente ya puede ver este archivo.' : 'El archivo vuelve a ser solo del personal.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo cambiar la visibilidad.'); }
    finally { setBusy(false); }
  }

  return <Card as="section" aria-labelledby="client-files-title">
    <CardHeader title="Archivos" titleId="client-files-title" level={2} description="PDF, JPG o PNG de hasta 5 MB. Privados por defecto." />
    {state === 'loading' && <p className="client-muted" role="status">Cargando archivos…</p>}
    {state === 'denied' && <p className="client-muted" role="status">Tu perfil no puede ver los archivos de este cliente.</p>}
    {state === 'unavailable' && <p className="client-muted" role="status">Los archivos de cliente todavía no están disponibles en este entorno.</p>}
    {state === 'error' && <EmptyState role="alert" tone="danger" icon={icons.TriangleAlert} title="No se pudieron cargar los archivos" action={<Button onClick={() => { setState('loading'); void load(); }}>Reintentar</Button>} />}
    {state === 'ready' && (files.length === 0
      ? <p className="client-muted">Este cliente no tiene archivos.</p>
      : <ul className="client-files-list" aria-label="Archivos del cliente">{files.map((item) => <li key={item.id} className="client-document">
        <div className="client-document-head"><div><strong>{item.title}</strong><span>{typeLabel[item.documentType]} · {size(item.sizeBytes)}</span><small>Subido {stamp.format(new Date(item.createdAt))}</small></div>
          <StatusChip tone={item.visibility === 'client_visible' ? 'info' : 'neutral'}>{item.visibility === 'client_visible' ? 'Visible para el cliente' : 'Solo personal'}</StatusChip></div>
        <div className="client-document-actions">
          <a className="button secondary" href={`${apiUrl}/api/clients/${clientId}/documents/${item.id}/download`} download>Descargar</a>
          <Button disabled={busy} onClick={() => void changeVisibility(item)}>{item.visibility === 'staff_only' ? 'Hacer visible al cliente' : 'Volver a solo personal'}</Button>
        </div></li>)}</ul>)}
    {state === 'ready' && <form className="client-files-form" onSubmit={(event) => void upload(event)} aria-label="Subir archivo" aria-busy={busy}>
      <label>Título<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Contrato de la cuota…" /></label>
      <label>Tipo<select value={documentType} onChange={(event) => setDocumentType(event.target.value as ClientFile['documentType'])}>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Archivo<input key={fileKey} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <label className="client-check"><input type="checkbox" checked={visibility === 'client_visible'} onChange={(event) => setVisibility(event.target.checked ? 'client_visible' : 'staff_only')} />Visible para el cliente</label>
      <Button type="submit" variant="primary" loading={busy}>Subir archivo</Button>
    </form>}
    <div aria-live="polite">{error && <p className="ui-form-error" role="alert">{error}</p>}{message && !error && <p className="client-muted" role="status">{message}</p>}</div>
  </Card>;
}
