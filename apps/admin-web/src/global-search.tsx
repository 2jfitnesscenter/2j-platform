import React from 'react';

export type SearchScreen = { id: string; label: string; href: string; section: string };
type Group = { type: string; label: string; items: Array<{ id: string; label: string }> };

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
const hrefOf = (group: Group, item: { id: string }) => group.type === 'clients' ? `#clients?clientId=${item.id}` : group.type === 'team' ? '#staff' : '#services';

/**
 * Búsqueda global (Ctrl K o «/»). Busca personas y servicios en la API —que filtra por permisos— y también las pantallas del
 * menú a las que este perfil tiene acceso, sin distinguir tildes. Teclado: ↓ baja a los resultados, ↑↓ se mueven entre ellos,
 * ↑ desde el primero vuelve al campo, Intro abre el resultado enfocado y Esc cierra.
 */
export function GlobalSearchDialog({ open, onClose, api, screens }: { open: boolean; onClose: () => void; api: string; screens: SearchScreen[] }) {
  const [query, setQuery] = React.useState('');
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { if (open) inputRef.current?.focus(); else { setQuery(''); setGroups([]); } }, [open]);
  React.useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 2) { setGroups([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const response = await fetch(`${api}/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as { groups?: Group[] };
        setGroups(body.groups ?? []);
      } catch { if (!controller.signal.aborted) setGroups([]); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, api]);

  if (!open) return null;
  const term = normalize(query.trim());
  const matchedScreens = term ? screens.filter((screen) => normalize(`${screen.label} ${screen.section}`).includes(term)) : screens;
  const apiGroups = groups.filter((group) => group.items.length > 0);
  const links = () => [...(resultsRef.current?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])];
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = links();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    event.preventDefault();
    if (event.key === 'ArrowDown') items[Math.min(items.length - 1, index + 1)]?.focus();
    else if (index <= 0) inputRef.current?.focus();
    else items[index - 1]?.focus();
  };
  return <div className="search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Búsqueda global" onKeyDown={onKeyDown}>
      <label htmlFor="global-search-input">Buscar en 2J</label>
      <input ref={inputRef} id="global-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, profesional, servicio o pantalla…" autoComplete="off" />
      <div className="global-search-results" aria-live="polite" ref={resultsRef}>
        {busy ? <p role="status">Buscando…</p>
          : query.trim().length < 2 ? <p>Escribe al menos dos caracteres para buscar personas y servicios.</p>
          : apiGroups.length === 0 && matchedScreens.length === 0 ? <p>No hay resultados accesibles.</p>
          : null}
        {!busy && apiGroups.map((group) => <section key={group.type}><h2>{group.label}</h2>{group.items.map((item) => <a key={item.id} href={hrefOf(group, item)} onClick={onClose}>{item.label}</a>)}</section>)}
        {matchedScreens.length > 0 && <section><h2>Ir a</h2>{matchedScreens.slice(0, 8).map((screen) => <a key={screen.id} href={screen.href} onClick={onClose}>{screen.label}<small> · {screen.section}</small></a>)}</section>}
      </div>
      <button className="button secondary" onClick={onClose}>Cerrar · Esc</button>
    </section>
  </div>;
}
