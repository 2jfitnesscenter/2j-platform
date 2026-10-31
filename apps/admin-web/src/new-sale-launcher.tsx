import * as React from 'react';
import { Button, icons } from '@2j/ui';
import { apiFetch } from './api-fetch.js';
import { Modal } from './modal.js';
import { NewSaleDialog, type NewSaleCapabilities } from './new-sale-dialog.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';

type Match = { id: string; firstName: string; lastName: string };
type Chosen = { id: string; name: string; capabilities: NewSaleCapabilities };

/**
 * «Nueva venta» desde el Resumen (A73): se elige el cliente y se abre la misma venta unificada de la ficha.
 * No hay reglas nuevas: el cliente y sus permisos de venta los devuelve el API (`GET /api/clients/:id`), y el diálogo
 * de venta decide precios, stock, caja (D113) y factura igual que desde la ficha.
 */
export function NewSaleLauncher({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [matches, setMatches] = React.useState<Match[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState('');
  const [loadingId, setLoadingId] = React.useState('');
  const [chosen, setChosen] = React.useState<Chosen | null>(null);
  // Cada apertura/cierre del selector invalida las búsquedas de ficha en vuelo: una respuesta tardía no puede abrir la venta de otro cliente.
  const session = React.useRef(0);

  React.useEffect(() => {
    if (!open || chosen) return;
    if (query.trim().length < 2) { setMatches([]); setSearching(false); return; }
    let current = true;
    const timer = window.setTimeout(() => {
      setSearching(true); setError('');
      void apiFetch(`${api}/api/clients?q=${encodeURIComponent(query.trim())}&status=active&limit=8`)
        .then(async (response) => { const body = await response.json().catch(() => ({})) as { items?: Match[]; error?: string }; if (!response.ok) throw new Error('search'); return body.items ?? []; })
        .then((items) => { if (current) setMatches(items); })
        .catch(() => { if (current) { setMatches([]); setError('No se pudo buscar el cliente. Inténtalo de nuevo.'); } })
        .finally(() => { if (current) setSearching(false); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query, open, chosen]);

  const close = () => { session.current += 1; setOpen(false); setQuery(''); setMatches([]); setError(''); setLoadingId(''); setChosen(null); };

  async function choose(match: Match) {
    const mine = session.current;
    setLoadingId(match.id); setError('');
    try {
      const response = await apiFetch(`${api}/api/clients/${match.id}`);
      const body = await response.json().catch(() => ({})) as { client?: { id: string; firstName: string; lastName: string; status: string }; capabilities?: NewSaleCapabilities };
      if (mine !== session.current) return;
      if (!response.ok || !body.client || !body.capabilities) { setError('No se pudo abrir la ficha del cliente. Inténtalo de nuevo.'); return; }
      if (body.client.status !== 'active') { setError('Este cliente está archivado: no se le puede vender.'); return; }
      if (!body.capabilities.assignPlans && !body.capabilities.collectPayments) { setError('Tu perfil no puede registrar ventas.'); return; }
      setChosen({ id: body.client.id, name: `${body.client.firstName} ${body.client.lastName}`, capabilities: body.capabilities });
    } catch { if (mine === session.current) setError('No se pudo conectar con el servidor. Inténtalo de nuevo.'); } finally { if (mine === session.current) setLoadingId(''); }
  }

  return <>
    <Button variant="primary" icon={icons.ShoppingBag} onClick={() => setOpen(true)}>Nueva venta</Button>
    {open && !chosen && <Modal titleId="launch-sale-title" title="Nueva venta" description="¿Para quién es la venta?" onClose={close}>
      <div className="ui-modal-grid"><label>Buscar cliente
        <input data-modal-initial-focus autoComplete="off" placeholder="Nombre, apellidos o correo…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label></div>
      {error && <p role="alert" className="client-feedback">{error}</p>}
      {query.trim().length < 2 && <p className="client-muted">Escribe al menos dos letras.</p>}
      {searching && <p role="status" className="client-muted">Buscando…</p>}
      {!searching && query.trim().length >= 2 && !error && matches.length === 0 && <p role="status" className="client-muted">Sin resultados entre los clientes activos.</p>}
      {matches.length > 0 && <ul className="client-list" aria-label="Clientes encontrados">{matches.map((match) => <li key={match.id} className="client-list-row">
        <button type="button" className="client-row" disabled={loadingId !== ''} onClick={() => void choose(match)}><span className="client-row-copy"><strong>{match.firstName} {match.lastName}</strong></span></button>
      </li>)}</ul>}
    </Modal>}
    {open && chosen && <NewSaleDialog clientId={chosen.id} clientName={chosen.name} capabilities={chosen.capabilities} onClose={close} onDone={onDone} />}
  </>;
}
