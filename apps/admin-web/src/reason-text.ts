/**
 * Motivos de error del API en español, siempre con causa y acción (A74/A75): nunca «No se pudo completar».
 * Solo traduce códigos que el API ya devuelve; no decide ni bloquea nada. Si Platform retira un código, se borra de aquí
 * sin tocar nada más (A76 retiró los bloqueos de caja de día anterior y de fichar salida con caja a cargo).
 */
export const REASONS: Record<string, string> = {
  // Fichaje
  shift_already_open: 'Ya tienes la entrada fichada y la jornada sigue abierta. Si has terminado, ficha la salida.',
  no_open_shift: 'No tienes ninguna entrada fichada, así que no hay salida que registrar. Ficha primero la entrada.',
  staff_account_unlinked: 'Tu cuenta no está vinculada a una ficha de equipo, y sin ella no se puede fichar ni usar la caja. Pide a Administración que la vincule.',
  // Caja
  clock_in_required: 'Para abrir la caja primero tienes que fichar la entrada. Pulsa «Fichar entrada ahora» y vuelve a intentarlo.',
  cash_custodian_or_clocked_staff_required: 'No tienes la custodia de esta caja ni un turno fichado para cerrar una caja de un día anterior. Ficha la entrada o pide a quien tiene la custodia que la cierre.',
  already_holds_register: 'Ya tienes otra caja a tu cargo. Ciérrala o entrégala en Caja antes de abrir otra.',
  cash_already_open: 'Esa caja ya está abierta. Actualiza la pantalla para verla y trabajar con ella.',
  cash_legacy_session_requires_owner_resolution: 'Hay una caja antigua sin registro asignado. Avisa al propietario para que la resuelva en Economía → «Resolver caja pendiente» antes de abrir otra.',
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
  cash_handover_start_failed: 'El servidor no confirmó el inicio del traspaso. Actualiza Caja y comprueba si ya aparece pendiente antes de repetirlo; si no aparece, vuelve a iniciarlo. Si se repite, avisa a Administración.',
  cash_handover_confirmation_failed: 'El servidor no confirmó la recepción. Actualiza Caja y comprueba si la custodia ya cambió; si el traspaso sigue pendiente, vuelve a confirmar tu recuento. Si se repite, avisa a Administración.',
  cash_outflow_failed: 'El servidor no confirmó si el gasto o la retirada quedó registrado. Actualiza los movimientos de la caja antes de repetirlo para evitar duplicados; si no aparece, vuelve a guardarlo.',
  cash_outflow_decision_failed: 'El servidor no confirmó si la aprobación o el rechazo quedó guardado. Actualiza los movimientos pendientes antes de repetir la decisión; si sigue pendiente, vuelve a resolverlo.',
  cash_outflow_not_found: 'Ese gasto o retirada ya no existe o no está disponible. Actualiza los movimientos de la caja.',
  cash_outflow_already_decided: 'Ese gasto o retirada ya se aprobó o rechazó. Actualiza los movimientos antes de continuar.',
  cash_outflow_cash_session_required: 'No hay una caja abierta bajo tu custodia para registrar este gasto o retirada. Abre o recibe una caja y vuelve a intentarlo.',
  cash_outflow_reason_required: 'El gasto o la retirada necesita un motivo de al menos tres caracteres. Añádelo y vuelve a guardar.',
  cash_outflow_limit_exceeded: 'El movimiento supera el límite configurado y necesita aprobación del propietario. Espera a que lo resuelva antes de cerrar la caja.',
  cash_outflow_approval_required: 'Este movimiento necesita aprobación del propietario. Envíalo para revisión y espera su resolución.',
  cash_handover_count_required: 'Falta el recuento por denominación de la entrega. Completa todas las cantidades y vuelve a confirmar.',
  cash_handover_incoming_count_required: 'Falta tu recuento independiente por denominación. Complétalo y vuelve a confirmar la recepción.',
  cash_handover_not_recipient: 'Esta entrega está asignada a otra persona. Inicia sesión con la cuenta receptora o pide que actualicen el traspaso.',
  cash_handover_not_custodian: 'No tienes la custodia de esta caja para iniciar el traspaso. Actualiza Caja y continúa con quien la tenga asignada.',
  payment_split_invalid: 'El reparto del pago contiene un importe o método no válido. Revisa los métodos y sus importes antes de confirmar.',
  payment_total_exceeds_balance: 'El total del pago supera el saldo pendiente del cargo. Reduce el importe y vuelve a confirmar.',
  charge_refunded: 'Este cargo se devolvió completamente y ya no admite nuevos cobros. Selecciona un cargo pendiente distinto.',
  refund_exceeds_payment: 'El importe supera lo que queda disponible de ese pago para devolver. Revisa los reembolsos anteriores e indica un importe menor.',
  payment_not_found: 'No se encuentra el pago que intentas devolver. Actualiza la ficha del cliente y selecciona un pago válido.',
  refund_requires_open_cash_session: 'Para registrar una devolución en efectivo necesitas tener abierta una caja del día y ser quien la custodia. Abre o recibe una caja antes de continuar.',
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
  if (code && REASONS[code] && !(code === 'internal_error' && context.action === 'registrar el pago')) return REASONS[code]!;
  if (serverMessage && serverMessage.trim() && code !== 'internal_error') return serverMessage;
  const what = context.action ? ` al ${context.action}` : '';
  const ref = code ? ` (código: ${code})` : status ? ` (código HTTP ${status})` : '';
  if (code === 'internal_error' && context.action === 'registrar el pago') return `El servidor devolvió un error${what}; no se puede confirmar si el cambio quedó registrado. Actualiza la información y comprueba el estado antes de repetirlo; si no aparece, vuelve a intentarlo. Si se repite, avisa a Administración${ref}.`;
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
