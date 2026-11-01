/**
 * Motivos de error del API en español, siempre con causa y acción (A74/A75): nunca «No se pudo completar».
 * Solo traduce códigos que el API ya devuelve; no decide ni bloquea nada. Los códigos que Platform retire
 * (p. ej. al desvincular el fichaje de la caja) se pueden borrar de aquí sin tocar nada más.
 */
export const REASONS: Record<string, string> = {
  // Fichaje
  shift_already_open: 'Ya tienes la entrada fichada y la jornada sigue abierta. Si has terminado, ficha la salida.',
  no_open_shift: 'No tienes ninguna entrada fichada, así que no hay salida que registrar. Ficha primero la entrada.',
  staff_account_unlinked: 'Tu cuenta no está vinculada a una ficha de equipo, y sin ella no se puede fichar ni usar la caja. Pide a Administración que la vincule.',
  cash_register_must_be_closed_or_handed_over: 'Tienes una caja a tu cargo y el sistema no deja fichar la salida con ella abierta. Ciérrala o entrégasela en Caja a otra persona que haya fichado la entrada; después ficha la salida.',
  // Caja
  clock_in_required: 'Para abrir la caja primero tienes que fichar la entrada. Pulsa «Fichar entrada ahora» y vuelve a intentarlo.',
  cash_custodian_not_clocked_in: 'Para cerrar la caja primero tienes que fichar la entrada. Pulsa «Fichar entrada ahora» y vuelve a intentarlo.',
  already_holds_register: 'Ya tienes otra caja a tu cargo. Ciérrala o entrégala en Caja antes de abrir otra.',
  cash_already_open: 'Esa caja ya está abierta. Actualiza la pantalla para verla y trabajar con ella.',
  cash_register_already_used_today: 'Esa caja ya tuvo su sesión de hoy (una sesión por caja y día). Usa la otra caja o espera a mañana.',
  cash_session_previous_day_requires_owner_resolution: 'Hay una caja de un día anterior sin cerrar: hoy no se puede cerrar ni abrir otra desde aquí, y mientras siga a tu cargo tampoco podrás fichar la salida. Avisa al propietario para que la resuelva (Economía → «Resolver caja pendiente»).',
  cash_legacy_session_requires_owner_resolution: 'Hay una caja antigua sin registro asignado. Avisa al propietario para que la resuelva en Caja antes de abrir otra.',
  cash_outflow_approval_pending: 'Hay un gasto o retirada pendiente de aprobación del propietario, y hasta entonces no se puede cerrar la caja. Pídele que lo apruebe o lo rechace.',
  cash_custodian_required: 'Solo quien tiene la caja a su cargo puede cerrarla. Pídele que la cierre o que te la entregue.',
  cash_already_closed: 'Esa caja ya está cerrada. Actualiza la pantalla.',
  cash_not_open: 'No hay una caja abierta a tu nombre. Ábrela en Caja antes de continuar.',
  cash_session_not_open: 'Esa caja ya no está abierta. Actualiza la pantalla.',
  cash_session_required: 'No hay una caja abierta a tu nombre, y el cobro necesita una. Ábrela en Caja y vuelve a cobrar.',
  cash_session_not_found: 'No se encuentra esa caja. Actualiza la pantalla.',
  cash_register_not_found: 'No se encuentra esa caja. Actualiza la pantalla.',
  handover_recipient_not_clocked_in: 'La persona que recibe la caja no ha fichado la entrada. Pídele que fiche y vuelve a entregarla.',
  handover_recipient_holds_register: 'La persona que recibe ya tiene otra caja a su cargo. Elige a otra persona o que cierre la suya.',
  handover_recipient_invalid: 'Esa persona no puede recibir la caja. Elige a otro profesional activo.',
  handover_already_pending: 'Ya hay una entrega de esta caja esperando confirmación. Confírmala antes de iniciar otra.',
  handover_already_completed: 'Esa entrega ya está completada. Actualiza la pantalla.',
  handover_custody_changed: 'La caja cambió de manos mientras tanto. Actualiza la pantalla y vuelve a intentarlo.',
  handover_not_found: 'No se encuentra esa entrega. Actualiza la pantalla.',
  // Ventas, cobros y tienda
  insufficient_stock: 'No hay stock suficiente de alguno de los productos. Baja la cantidad o quita la línea.',
  amount_exceeds_balance: 'El importe es mayor que lo pendiente de ese cargo. Escribe un importe igual o menor.',
  charge_not_pending: 'Ese cargo ya no está pendiente de cobro (puede estar pagado o anulado). Actualiza la ficha.',
  charge_closed: 'Ese cargo está cerrado y no admite más cobros. Actualiza la ficha.',
  charge_not_found: 'No se encuentra ese cargo. Actualiza la ficha.',
  client_not_found: 'No se encuentra al cliente. Actualiza la pantalla y vuelve a buscarlo.',
  idempotency_conflict: 'Esta operación ya se había enviado con otros datos. Cierra el cuadro y empieza de nuevo.',
  // Generales
  permission_denied: 'Tu perfil no tiene permiso para esta acción. Pídeselo a Administración.',
  authentication_required: 'Tu sesión ha caducado. Vuelve a iniciar sesión y repite la acción.',
  validation_error: 'Hay un dato que el servidor no acepta. Revisa los campos del formulario.',
  constraint_violation: 'El servidor rechazó los datos por una regla de integridad. Actualiza la pantalla y repite la acción; si se repite, avisa a Administración con este código.',
  internal_error: 'El servidor falló al procesar la acción (error interno). Espera unos segundos y repítela; si se repite, avisa a Administración.',
};

export type ReasonContext = { /** Qué se intentaba, p. ej. «fichar la entrada». */ action?: string };

/**
 * Texto con causa y acción para un fallo del API. Orden: código conocido (texto revisado) → mensaje propio del servidor →
 * respuesta por estado HTTP. El código técnico se añade siempre al texto de último recurso para que el personal pueda citarlo.
 */
export function reasonText(code: string | undefined | null, status?: number, serverMessage?: string | null, context: ReasonContext = {}): string {
  if (code && REASONS[code]) return REASONS[code]!;
  if (serverMessage && serverMessage.trim() && code !== 'internal_error') return serverMessage;
  const what = context.action ? ` al ${context.action}` : '';
  const ref = code ? ` (código: ${code})` : status ? ` (código HTTP ${status})` : '';
  if (status === 401) return REASONS.authentication_required!;
  if (status === 403) return REASONS.permission_denied!;
  if (status === 404) return `No se encontró lo que se pedía${what}. Actualiza la pantalla y vuelve a intentarlo${ref}.`;
  if (status && status >= 500) return `El servidor falló${what}. Espera unos segundos y repítelo; si se repite, avisa a Administración${ref}.`;
  return `El servidor no aceptó la acción${what}. Actualiza la pantalla y repítela; si se repite, avisa a Administración${ref}.`;
}

/** Fallo de red: sin respuesta del servidor. */
export function networkReason(action?: string): string {
  return `No hay conexión con el servidor${action ? ` para ${action}` : ''}. Comprueba la red y vuelve a intentarlo; lo que ya estaba registrado no se pierde.`;
}
