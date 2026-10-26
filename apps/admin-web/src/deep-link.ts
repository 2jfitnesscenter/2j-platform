/**
 * Enlaces profundos de los accesos rápidos del Resumen (paridad visual 9).
 *
 * Convención: `#<ruta>?<acción>=1`, por ejemplo `#clients?new=1`. La pantalla destino lee el parámetro UNA sola vez al abrirse,
 * lo retira de la URL con `history.replaceState` (no recarga ni dispara `hashchange`, así que el enrutador no se entera y el
 * botón «atrás» no vuelve a abrir el diálogo) y solo actúa si el perfil tiene permiso para esa acción.
 *
 * Acciones definidas:
 * - `#clients?new=1`                       abre «Nuevo cliente».
 * - `#clients?intent=assign-plan|message`  muestra «Elige un cliente…» y, al abrir su ficha, abre la venta de cuota o la pestaña Mensajes.
 * - `#calendar?book=1`                     muestra «Elige una sesión…»; la reserva se hace dentro del detalle de la sesión.
 * - `#store?sale=1`                        abre «Nueva venta en el centro».
 */
function split() {
  const [path = '', query = ''] = window.location.hash.slice(1).split('?');
  return { path, params: new URLSearchParams(query) };
}

/**
 * Lectura PURA de los parámetros (sin tocar la URL): segura dentro de un inicializador de `useState`, que React 18 ejecuta dos
 * veces en StrictMode. Si la lectura retirara el parámetro, la segunda ejecución no lo vería y la acción se perdería.
 */
export function readDeepLink<K extends string>(keys: readonly K[]): Partial<Record<K, string>> {
  const found: Partial<Record<K, string>> = {};
  if (typeof window === 'undefined') return found;
  const { params } = split();
  for (const key of keys) { const value = params.get(key); if (value !== null) found[key] = value; }
  return found;
}

/** Retira los parámetros de la URL (idempotente). Se llama desde un efecto, una vez ya leídos. */
export function clearDeepLink(keys: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const { path, params } = split();
  let changed = false;
  for (const key of keys) if (params.has(key)) { params.delete(key); changed = true; }
  if (!changed) return;
  const rest = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${path}${rest ? `?${rest}` : ''}`);
}

/** Lee y retira en un solo paso (para código que no es un componente React). */
export function takeDeepLink<K extends string>(keys: readonly K[]): Partial<Record<K, string>> {
  const found = readDeepLink(keys);
  clearDeepLink(keys);
  return found;
}
