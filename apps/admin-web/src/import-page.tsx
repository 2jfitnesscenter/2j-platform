import React from 'react';
import { Button, Card, CardHeader, EmptyState, Icon, PageHeader, StatusChip, icons } from '@2j/ui';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
const MAX_BYTES = 5 * 1024 * 1024;

type PreviewRow = { rowNumber: number; errors: string[] };
type Preview = {
  commitAvailable: boolean; previewId: string; fileDigest: string; rowCount: number; validCount: number; invalidCount: number; sourceFormat: string; rows: PreviewRow[];
  timpSummary?: { total: number; asOfDate: string; active: number; inactive: number; incomplete: number; incompleteByField: Record<string, number>; duplicateEmailRows: number; duplicatePhoneRows: number; minorsReview: number };
};
type Result = { replayed: boolean; rowCount: number; created: number; skipped: number; active: number; inactive: number; incomplete: number; emailNotStored: number; skippedRows: PreviewRow[] };
type Phase = { name: 'choose' } | { name: 'previewing' } | { name: 'preview'; preview: Preview } | { name: 'importing'; preview: Preview } | { name: 'done'; result: Result };

const fieldLabel: Record<string, string> = { email: 'sin correo', phone: 'sin teléfono', gender: 'sin género', birthDate: 'sin fecha de nacimiento' };
const errorLabel: Record<string, string> = {
  source_id_missing: 'falta el ID', first_name_invalid: 'nombre vacío o demasiado largo', last_name_invalid: 'apellidos vacíos o demasiado largos', birth_date_invalid: 'fecha de nacimiento no válida',
  joined_date_invalid: 'fecha de alta no válida', last_reservation_date_invalid: 'fecha de última reserva no válida', last_reservation_in_future: 'última reserva en el futuro', gender_invalid: 'género no válido',
  email_invalid: 'correo no válido', phone_invalid: 'teléfono demasiado largo', column_count_mismatch: 'número de columnas distinto', already_imported: 'ya importado antes', email_duplicate_or_invalid: 'correo repetido o no válido',
};
const requestErrors: Record<string, string> = {
  spreadsheet_format_unsupported: 'Solo se admiten archivos .xls, .xlsx o .csv.', file_too_large: 'El archivo supera los 5 MB.', too_many_rows: 'El archivo tiene más de 2.000 filas.',
  timp_columns_missing: 'No parece una exportación de TIMP: faltan columnas.', unsupported_columns: 'El archivo trae columnas con datos que no se importan (por ejemplo, dirección o NIF). Quítalas y vuelve a probar.',
  duplicate_columns: 'Hay columnas repetidas.', required_columns_missing: 'Faltan las columnas Nombre y Apellidos.', invalid_excel: 'El archivo de Excel no es válido.', one_sheet_required: 'El libro debe tener una sola hoja.',
  formula_not_allowed: 'El archivo contiene fórmulas o enlaces; guárdalo solo con valores.', invalid_encoding: 'No se pudo leer el texto del archivo.', permission_denied: 'Tu perfil no puede importar clientes.',
  client_import_preview_disabled: 'La importación no está activada en este entorno.', client_import_commit_disabled: 'La importación real no está activada en este entorno.',
  file_changed_since_preview: 'El archivo no es el mismo que se revisó. Vuelve a elegirlo y revisa la vista previa.', row_count_changed: 'El número de filas cambió desde la vista previa. Vuelve a revisarla.',
  preview_not_found: 'La vista previa ya no está disponible para esta sesión. Genera una nueva antes de confirmar.',
  preview_date_changed: 'Ha cambiado el día en Canarias desde la vista previa. Genera una nueva para revisar el corte de actividad actualizado.',
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const reason = (codes: string[]) => codes.map((code) => errorLabel[code] ?? code).join(', ');

/**
 * Importar clientes (A63): el propietario sube la exportación de TIMP, revisa la vista previa y confirma en pantalla. Nada se guarda hasta
 * esa confirmación; el archivo solo vive en esta pestaña del navegador y el servidor no conserva ni registra su contenido (la auditoría
 * guarda recuentos y la huella del archivo). Todos los registros se importan: activos si reservaron en los últimos 365 días, inactivos el
 * resto, sin deuda, con las fichas incompletas marcadas.
 */
export function ImportPage() {
  const [phase, setPhase] = React.useState<Phase>({ name: 'choose' });
  const [file, setFile] = React.useState<File | null>(null);
  const [fileKey, setFileKey] = React.useState(0);
  const [understood, setUnderstood] = React.useState(false);
  const [error, setError] = React.useState('');

  async function failureOf(response: Response) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    return requestErrors[body.error ?? ''] ?? (response.status === 403 ? requestErrors.permission_denied! : 'No se pudo completar la operación. Inténtalo de nuevo.');
  }
  function reset() { setPhase({ name: 'choose' }); setFile(null); setFileKey((value) => value + 1); setUnderstood(false); setError(''); }

  async function preview(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!file) { setError('Elige el archivo de TIMP.'); return; }
    if (file.size > MAX_BYTES) { setError(requestErrors.file_too_large!); return; }
    setPhase({ name: 'previewing' });
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`${apiUrl}/api/clients/import/preview`, { method: 'POST', body: form });
      if (!response.ok) throw new Error(await failureOf(response));
      setPhase({ name: 'preview', preview: await response.json() as Preview }); setUnderstood(false);
    } catch (caught) { setPhase({ name: 'choose' }); setError(caught instanceof Error ? caught.message : 'No se pudo leer el archivo.'); }
  }

  async function confirm(current: Preview) {
    if (!file) return;
    setError(''); setPhase({ name: 'importing', preview: current });
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`${apiUrl}/api/clients/import/commit`, { method: 'POST', body: form, headers: { 'x-import-confirm': 'IMPORTAR', 'x-import-preview-id': current.previewId, 'x-import-digest': current.fileDigest, 'x-import-expected-rows': String(current.rowCount) } });
      if (!response.ok) throw new Error(await failureOf(response));
      setPhase({ name: 'done', result: await response.json() as Result });
    } catch (caught) { setPhase({ name: 'preview', preview: current }); setError(caught instanceof Error ? caught.message : 'No se pudo importar.'); }
  }

  const header = <PageHeader title="Importar clientes" description="Sube la exportación de TIMP, revisa la vista previa y confirma. Hasta que confirmes no se guarda nada." />;
  if (phase.name === 'done') {
    const { result } = phase;
    return <main className="summary import-page" id="import" data-2j-design="v2">{header}
      <Card as="section" aria-labelledby="import-done-title"><CardHeader title={result.replayed ? 'Este archivo ya se había importado' : 'Importación terminada'} titleId="import-done-title" level={2} />
        <ul className="import-facts" aria-label="Resultado de la importación">
          <li><strong>{result.created}</strong> {result.created === 1 ? 'cliente creado' : 'clientes creados'} de {result.rowCount}</li>
          <li><strong>{result.active}</strong> activos · <strong>{result.inactive}</strong> inactivos (archivados)</li>
          <li><strong>{result.incomplete}</strong> con la ficha incompleta, marcadas para completar</li>
          {result.emailNotStored > 0 && <li><strong>{result.emailNotStored}</strong> sin correo guardado por estar repetido con otro cliente activo</li>}
          {result.skipped > 0 && <li><strong>{result.skipped}</strong> filas no importadas</li>}
        </ul>
        {result.skippedRows.length > 0 && <details><summary>Filas no importadas</summary><ul>{result.skippedRows.slice(0, 100).map((row) => <li key={row.rowNumber}>Fila {row.rowNumber}: {reason(row.errors)}</li>)}</ul></details>}
        <div className="import-actions"><Button href="#clients" variant="primary">Ver clientes</Button><Button onClick={reset}>Importar otro archivo</Button></div>
      </Card></main>;
  }

  const current = phase.name === 'preview' || phase.name === 'importing' ? phase.preview : null;
  const summary = current?.timpSummary;
  const problems = current ? current.rows.filter((row) => row.errors.length > 0) : [];
  const busy = phase.name === 'previewing' || phase.name === 'importing';
  return <main className="summary import-page" id="import" data-2j-design="v2">
    {header}
    <Card as="section" aria-labelledby="import-file-title">
      <CardHeader title="1. Elige el archivo" titleId="import-file-title" level={2} description=".xls, .xlsx o .csv, hasta 5 MB y 2.000 filas. La deuda de TIMP no se importa." />
      <form className="import-form" onSubmit={(event) => void preview(event)} aria-busy={busy}>
        <label>Archivo de TIMP<input key={fileKey} type="file" accept=".xls,.xlsx,.csv" disabled={busy || phase.name === 'preview'} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></label>
        <Button type="submit" variant="primary" loading={phase.name === 'previewing'} disabled={busy || phase.name === 'preview' || !file}>Ver vista previa</Button>
      </form>
    </Card>
    {error && <p className="ui-form-error" role="alert">{error}</p>}
    {current && summary && <Card as="section" aria-labelledby="import-preview-title">
      <CardHeader title="2. Revisa la vista previa" titleId="import-preview-title" level={2} description="Se importarán todos los registros sin errores de formato." />
      <ul className="import-facts" aria-label="Vista previa de la importación">
        <li>Actividad calculada a {summary.asOfDate} (Atlantic/Canary)</li>
        <li><strong>{summary.total}</strong> {summary.total === 1 ? 'registro' : 'registros'} en el archivo</li>
        <li><StatusChip tone="success" icon={null}>Activos</StatusChip> <strong>{summary.active}</strong> con reserva en los últimos 365 días</li>
        <li><StatusChip tone="neutral" icon={null}>Inactivos</StatusChip> <strong>{summary.inactive}</strong> sin reserva reciente (quedan archivados, no se borra a nadie)</li>
        <li><strong>{summary.incomplete}</strong> con la ficha incompleta{Object.entries(summary.incompleteByField).filter(([, n]) => n > 0).length > 0 && <> ({Object.entries(summary.incompleteByField).filter(([, n]) => n > 0).map(([field, n]) => `${n} ${fieldLabel[field] ?? field}`).join(', ')})</>}</li>
        {(summary.duplicateEmailRows > 0 || summary.duplicatePhoneRows > 0) && <li><strong>{summary.duplicateEmailRows}</strong> filas con correo repetido y <strong>{summary.duplicatePhoneRows}</strong> con teléfono repetido: se importan y se marcan para revisar</li>}
        {summary.minorsReview > 0 && <li><strong>{summary.minorsReview}</strong> sin fecha de nacimiento: se marcan por si son menores</li>}
        <li><strong>{current.invalidCount}</strong> {current.invalidCount === 1 ? 'fila con error que no se importará' : 'filas con error que no se importarán'}</li>
      </ul>
      {problems.length > 0 && <details><summary>Ver filas con error</summary><ul>{problems.slice(0, 100).map((row) => <li key={row.rowNumber}>Fila {row.rowNumber}: {reason(row.errors)}</li>)}</ul>{problems.length > 100 && <p className="client-muted">Y {problems.length - 100} más.</p>}</details>}
    </Card>}
    {current && <Card as="section" aria-labelledby="import-confirm-title">
      <CardHeader title="3. Confirma" titleId="import-confirm-title" level={2} />
      {current.commitAvailable
        ? <div className="import-confirm">
          <label className="client-check"><input type="checkbox" checked={understood} disabled={phase.name === 'importing'} onChange={(event) => setUnderstood(event.target.checked)} />Entiendo que se crearán {plural(current.validCount, 'cliente', 'clientes')} y que no se puede deshacer desde la app.</label>
          <div className="import-actions"><Button variant="primary" loading={phase.name === 'importing'} disabled={!understood || phase.name === 'importing' || current.validCount === 0} onClick={() => void confirm(current)}>Importar {plural(current.validCount, 'cliente', 'clientes')}</Button><Button disabled={phase.name === 'importing'} onClick={reset}>Cancelar</Button></div></div>
        : <EmptyState icon={icons.ShieldCheck} title="La importación real no está disponible" role="status">Solo la persona con permiso de administración puede importar, y la importación debe estar activada en este entorno. Puedes revisar la vista previa, pero no se guardará nada.</EmptyState>}
    </Card>}
    {!current && phase.name === 'choose' && !error && <p className="client-muted"><Icon icon={icons.ShieldCheck} size={16} /> El contenido del archivo no se guarda en el servidor ni en ningún registro: solo quedan los clientes creados y un recuento de auditoría.</p>}
  </main>;
}
