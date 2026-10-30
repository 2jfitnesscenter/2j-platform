import React from 'react';
import { Button, Card, CardHeader, EmptyState, StatusChip, icons } from '@2j/ui';
import { Modal } from './modal.js';

const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
const MAX_LOGO_BYTES = 512 * 1024;

type Series = { id: string; name: string; prefix: string; nextNumber: number; active: boolean };
type Settings = {
  issuerName: string | null; issuerTaxId: string | null; issuerAddress: string | null; issuerPostalCode: string | null; issuerLocality: string | null; issuerProvince: string | null;
  defaultIgicBasisPoints: number; defaultSeriesId: string | null; footerText: string | null; legalText: string | null; hasLogo: boolean; logoMime: string | null;
  series: Series[]; missing: string[]; canManage: boolean;
};
type LoadState = { status: 'loading' } | { status: 'ready'; data: Settings } | { status: 'denied' } | { status: 'error' };

const logoErrors: Record<string, string> = { unsupported_logo_type: 'Solo se admiten PNG, JPG o SVG.', unsafe_svg: 'Ese SVG contiene elementos no permitidos (scripts, enlaces o imágenes externas).', file_too_large: 'El logo supera los 512 KB.', file_required: 'Elige un archivo.', storage_unavailable: 'El almacenamiento no está disponible ahora.' };
const field = (value: string | null | undefined) => value ?? '';
const percentInput = (basisPoints: number) => String(basisPoints / 100).replace('.', ',');
const toBasisPoints = (value: string) => { const normalized = value.trim().replace(',', '.'); if (!/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/.test(normalized)) return null; return Math.round(Number(normalized) * 100); };

/**
 * Configuración · Facturación (A65/A66). La app sale con todos los campos vacíos: el propietario escribe aquí los datos del emisor, la serie,
 * el tipo de IGIC por defecto y los textos del pie. Mientras falte algo no se puede emitir, y la pantalla dice qué falta.
 * Las facturas ya emitidas conservan los datos y el logo con los que se emitieron.
 */
export function InvoiceSettingsPanel() {
  const [state, setState] = React.useState<LoadState>({ status: 'loading' });
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [newSeries, setNewSeries] = React.useState({ name: '', prefix: '' });
  const [logoKey, setLogoKey] = React.useState(0);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${apiUrl}/api/economics/invoice-settings`, signal ? { signal } : undefined);
      if (response.status === 401 || response.status === 403) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as Settings;
      setState({ status: 'ready', data });
      setForm({ issuerName: field(data.issuerName), issuerTaxId: field(data.issuerTaxId), issuerAddress: field(data.issuerAddress), issuerPostalCode: field(data.issuerPostalCode), issuerLocality: field(data.issuerLocality), issuerProvince: field(data.issuerProvince), igic: percentInput(data.defaultIgicBasisPoints), seriesId: field(data.defaultSeriesId), footerText: field(data.footerText), legalText: field(data.legalText) });
    } catch (caught) { if ((caught as Error).name !== 'AbortError') setState({ status: 'error' }); }
  }, []);
  React.useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    const igic = toBasisPoints(form.igic ?? '');
    if (igic === null) { setError('El IGIC debe ser un porcentaje entre 0 y 100 (por ejemplo 3 o 7).'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/economics/invoice-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        issuerName: form.issuerName ?? '', issuerTaxId: form.issuerTaxId ?? '', issuerAddress: form.issuerAddress ?? '', issuerPostalCode: form.issuerPostalCode ?? '', issuerLocality: form.issuerLocality ?? '', issuerProvince: form.issuerProvince ?? '',
        defaultIgicBasisPoints: igic, defaultSeriesId: form.seriesId ? form.seriesId : null, footerText: form.footerText ?? '', legalText: form.legalText ?? '' }) });
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu perfil no puede cambiar la facturación.' : 'No se pudo guardar. Revisa los campos.');
      setMessage('Datos de facturación guardados.'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo guardar.'); } finally { setBusy(false); }
  }
  async function createSeries(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    if (!newSeries.name.trim() || !newSeries.prefix.trim()) { setError('Indica el nombre y el prefijo de la serie.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/economics/invoice-series`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ name: newSeries.name.trim(), prefix: newSeries.prefix.trim() }) });
      if (!response.ok) throw new Error(response.status === 409 ? 'Ya existe una serie con ese nombre.' : 'No se pudo crear la serie.');
      const created = await response.json() as { id: string };
      setNewSeries({ name: '', prefix: '' }); setMessage('Serie creada. Elígela y guarda para usarla.'); await load(); set('seriesId', created.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo crear la serie.'); } finally { setBusy(false); }
  }
  async function uploadLogo(file: File | null) {
    setError(''); setMessage('');
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) { setError(logoErrors.file_too_large!); return; }
    setBusy(true);
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`${apiUrl}/api/economics/invoice-settings/logo`, { method: 'PUT', body });
      if (!response.ok) { const problem = await response.json().catch(() => ({})) as { error?: string }; throw new Error(logoErrors[problem.error ?? ''] ?? 'No se pudo guardar el logo.'); }
      setMessage('Logo guardado. Las facturas nuevas lo usarán; las ya emitidas conservan el suyo.'); setLogoKey((value) => value + 1); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo guardar el logo.'); } finally { setBusy(false); }
  }
  async function removeLogo() {
    setError(''); setMessage(''); setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/economics/invoice-settings/logo`, { method: 'DELETE' });
      if (!response.ok) throw new Error('No se pudo quitar el logo.');
      setMessage('Logo quitado. Las facturas nuevas llevarán el nombre del negocio.'); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo quitar el logo.'); } finally { setBusy(false); }
  }

  if (state.status === 'loading') return <div className="summary-state" role="status"><span className="spinner" /> Cargando la facturación…</div>;
  if (state.status === 'denied') return <EmptyState icon={icons.ShieldCheck} title="Tu perfil no puede consultar la facturación" role="status">Pide ayuda a una persona con permiso de lectura fiscal.</EmptyState>;
  if (state.status === 'error') return <div className="summary-state summary-error" role="alert"><strong>No se pudo cargar la facturación</strong><Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></div>;
  const { data } = state;
  const disabled = busy || !data.canManage;
  return <div className="invoice-settings">
    {data.missing.length > 0
      ? <p className="invoice-missing" role="status"><strong>Todavía no se pueden emitir facturas.</strong> Falta: {data.missing.join(', ')}.</p>
      : <p className="invoice-ready" role="status"><StatusChip tone="success" icon={null}>Listo para emitir</StatusChip> Los datos obligatorios están completos.</p>}
    {!data.canManage && <p className="settings-hint">Tu perfil puede consultar estos datos pero no cambiarlos.</p>}
    <form className="invoice-form" onSubmit={(event) => void save(event)} aria-label="Datos de facturación" aria-busy={busy}>
      <h3 className="settings-subtitle">Emisor</h3>
      <div className="settings-grid">
        <label>Nombre o razón social<input value={form.issuerName ?? ''} maxLength={160} disabled={disabled} onChange={(event) => set('issuerName', event.target.value)} /></label>
        <label>NIF<input value={form.issuerTaxId ?? ''} maxLength={30} disabled={disabled} onChange={(event) => set('issuerTaxId', event.target.value)} /></label>
        <label className="is-wide">Dirección<input value={form.issuerAddress ?? ''} maxLength={240} disabled={disabled} onChange={(event) => set('issuerAddress', event.target.value)} /></label>
        <label>Código postal<input value={form.issuerPostalCode ?? ''} maxLength={20} disabled={disabled} onChange={(event) => set('issuerPostalCode', event.target.value)} /></label>
        <label>Localidad<input value={form.issuerLocality ?? ''} maxLength={100} disabled={disabled} onChange={(event) => set('issuerLocality', event.target.value)} /></label>
        <label>Provincia<input value={form.issuerProvince ?? ''} maxLength={100} disabled={disabled} onChange={(event) => set('issuerProvince', event.target.value)} /></label>
      </div>
      <h3 className="settings-subtitle">Numeración e impuesto</h3>
      <div className="settings-grid">
        <label>Serie de facturas<select value={form.seriesId ?? ''} disabled={disabled} onChange={(event) => set('seriesId', event.target.value)}><option value="">Sin elegir</option>{data.series.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.prefix}-{item.nextNumber})</option>)}</select></label>
        <label>IGIC por defecto (%)<input inputMode="decimal" value={form.igic ?? ''} disabled={disabled} onChange={(event) => set('igic', event.target.value)} /></label>
      </div>
      <p className="settings-hint">La numeración es correlativa y no admite huecos. El nombre y el prefijo de una serie no se pueden cambiar cuando ya se ha usado.</p>
      <h3 className="settings-subtitle">Pie y texto legal</h3>
      <div className="settings-grid">
        <label className="is-wide">Pie de factura<textarea rows={2} maxLength={600} value={form.footerText ?? ''} disabled={disabled} onChange={(event) => set('footerText', event.target.value)} /></label>
        <label className="is-wide">Texto legal<textarea rows={3} maxLength={1500} value={form.legalText ?? ''} disabled={disabled} onChange={(event) => set('legalText', event.target.value)} /></label>
      </div>
      {data.canManage && <div className="invoice-actions"><Button type="submit" variant="primary" loading={busy}>Guardar datos</Button></div>}
    </form>
    {data.canManage && <form className="invoice-form" onSubmit={(event) => void createSeries(event)} aria-label="Nueva serie">
      <h3 className="settings-subtitle">Nueva serie</h3>
      <div className="settings-grid">
        <label>Nombre de la serie<input value={newSeries.name} maxLength={80} disabled={busy} onChange={(event) => setNewSeries((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>Prefijo<input value={newSeries.prefix} maxLength={20} disabled={busy} onChange={(event) => setNewSeries((current) => ({ ...current, prefix: event.target.value }))} /></label>
      </div>
      <div className="invoice-actions"><Button type="submit" disabled={busy}>Crear serie</Button></div>
    </form>}
    <h3 className="settings-subtitle">Logo</h3>
    <Card padding="none" className="invoice-logo">
      <div className="invoice-logo-preview">{data.hasLogo ? <img key={logoKey} src={`${apiUrl}/api/economics/invoice-settings/logo?v=${logoKey}`} alt="Logo actual de las facturas" /> : <span className="client-muted">Sin logo: las facturas llevarán el nombre del negocio.</span>}</div>
      {data.canManage && <div className="invoice-actions">
        <label className="button secondary invoice-file">Subir logo<input type="file" accept="image/png,image/jpeg,image/svg+xml" disabled={busy} onChange={(event) => { void uploadLogo(event.target.files?.[0] ?? null); event.target.value = ''; }} /></label>
        {data.hasLogo && <Button disabled={busy} onClick={() => void removeLogo()}>Quitar logo</Button>}
      </div>}
      <p className="settings-hint">PNG, JPG o SVG de hasta 512 KB. Se guarda en privado, nunca en el código. Las facturas ya emitidas conservan el logo con el que se emitieron.</p>
    </Card>
    <div aria-live="polite">{error && <p className="ui-form-error" role="alert">{error}</p>}{message && !error && <p className="client-muted" role="status">{message}</p>}</div>
  </div>;
}

type DocItem = { id: string; documentType: 'simplified_ticket' | 'full_invoice'; status: 'issued' | 'rectified'; documentNumber: string; documentDate: string; grossCents: number; isRectified: boolean };
type DocsState = { status: 'loading' } | { status: 'ready'; items: DocItem[]; canIssue: boolean } | { status: 'denied' } | { status: 'error' };
const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const issueErrors: Record<string, string> = {
  issuer_incomplete: 'Faltan datos del emisor en Configuración · Facturación.', client_fiscal_data_missing: 'Falta el NIF o la dirección del cliente: complétalos en su ficha para emitir una factura completa.',
  payment_required: 'El cargo todavía no tiene ningún pago registrado.', already_documented: 'Este cargo ya tiene un documento.', charge_void: 'El cargo está anulado.', already_rectified: 'Este documento ya está rectificado.', cannot_rectify_a_rectification: 'Una factura rectificativa no se puede rectificar.',
};

/** Documentos de un cargo: descargar o imprimir el PDF, emitir factura o ticket y rectificar. Solo se muestra a quien tiene permiso de lectura fiscal. */
export function InvoiceDialog({ chargeId, title, onClose }: { chargeId: string; title: string; onClose: () => void }) {
  const [state, setState] = React.useState<DocsState>({ status: 'loading' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [rectifying, setRectifying] = React.useState<DocItem | null>(null);
  const [reason, setReason] = React.useState('');
  const load = React.useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/economics/charges/${chargeId}/documents`);
      if (response.status === 401 || response.status === 403) { setState({ status: 'denied' }); return; }
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { items: DocItem[]; canIssue: boolean };
      setState({ status: 'ready', items: body.items, canIssue: body.canIssue });
    } catch { setState({ status: 'error' }); }
  }, [chargeId]);
  React.useEffect(() => { void load(); }, [load]);

  async function call(url: string, body: unknown) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${apiUrl}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { error?: string; missing?: string[] };
      if (!response.ok) throw new Error(`${issueErrors[payload.error ?? ''] ?? 'No se pudo completar la operación.'}${payload.missing?.length ? ` Falta: ${payload.missing.join(', ')}.` : ''}`);
      setRectifying(null); setReason(''); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo completar la operación.'); } finally { setBusy(false); }
  }
  const pdfUrl = (id: string, variant: 'a4' | 'ticket') => `${apiUrl}/api/economics/documents/${id}/pdf?variant=${variant}`;
  const print = (id: string, variant: 'a4' | 'ticket') => { const opened = window.open(pdfUrl(id, variant), '_blank', 'noopener'); if (!opened) setError('El navegador bloqueó la ventana. Usa «Descargar» y abre el archivo.'); };

  return <Modal titleId="invoice-dialog-title" title="Factura y ticket" description={title} onClose={onClose} closeDisabled={busy}>
    {state.status === 'loading' && <p className="client-muted" role="status">Cargando documentos…</p>}
    {state.status === 'denied' && <p className="client-muted" role="status">Tu perfil no puede consultar facturas.</p>}
    {state.status === 'error' && <p className="ui-form-error" role="alert">No se pudieron cargar los documentos. <Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Reintentar</Button></p>}
    {state.status === 'ready' && <>
      {state.items.length === 0 ? <p className="client-muted">Este cargo no tiene factura ni ticket.</p>
        : <ul className="invoice-docs" aria-label="Documentos del cargo">{state.items.map((item) => <li key={item.id}>
          <div><strong>{item.status === 'rectified' ? 'Rectificativa' : item.documentType === 'full_invoice' ? 'Factura' : 'Ticket'} {item.documentNumber}</strong><small>{item.documentDate.split('-').reverse().join('/')} · {euros(item.grossCents)}{item.isRectified ? ' · rectificada' : ''}</small></div>
          <div className="invoice-actions">
            <a className="button secondary" href={pdfUrl(item.id, 'a4')} download>Descargar</a>
            <Button onClick={() => print(item.id, 'a4')}>Imprimir</Button>
            <a className="button secondary" href={pdfUrl(item.id, 'ticket')} download>Ticket</a>
            {state.canIssue && item.status === 'issued' && !item.isRectified && <Button disabled={busy} onClick={() => { setRectifying(item); setError(''); }}>Rectificar</Button>}
          </div></li>)}</ul>}
      {rectifying && <form className="invoice-form" onSubmit={(event) => { event.preventDefault(); void call(`/api/economics/documents/${rectifying.id}/rectify`, { reason: reason.trim() }); }} aria-label="Rectificar factura">
        <p>Se emitirá una factura rectificativa que anula {rectifying.documentNumber} con un número nuevo. La original no se modifica.</p>
        <label>Motivo de la rectificación<textarea rows={2} maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="invoice-actions"><Button type="submit" variant="primary" loading={busy} disabled={reason.trim().length < 3}>Emitir rectificativa</Button><Button disabled={busy} onClick={() => setRectifying(null)}>Cancelar</Button></div></form>}
      {state.canIssue && state.items.filter((item) => item.status === 'issued' && !item.isRectified).length === 0 && !rectifying && <div className="invoice-actions">
        <Button variant="primary" disabled={busy} loading={busy} onClick={() => void call(`/api/economics/charges/${chargeId}/invoice`, { documentType: 'full_invoice' })}>Emitir factura</Button>
        <Button disabled={busy} onClick={() => void call(`/api/economics/charges/${chargeId}/invoice`, { documentType: 'simplified_ticket' })}>Emitir ticket</Button></div>}
    </>}
    <div aria-live="polite">{error && <p className="ui-form-error" role="alert">{error}</p>}</div>
  </Modal>;
}
