import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REASONS, networkReason, reasonText } from '../src/reason-text.ts';

test('every known reason names a cause and tells the person what to do, and none is the generic text', () => {
  for (const [code, text] of Object.entries(REASONS)) {
    assert.ok(text.length > 40, `${code} is too short to hold a cause and an action`);
    assert.ok(!/No se pudo completar/.test(text), `${code} is generic`);
    assert.match(text, /[.!]$/, `${code} must end as a sentence`);
  }
  // Los códigos que el API devuelve hoy en fichaje y caja tienen texto propio.
  for (const code of ['shift_already_open', 'no_open_shift', 'staff_account_unlinked', 'clock_in_required', 'cash_custodian_or_clocked_staff_required', 'cash_custodian_required', 'cash_outflow_approval_pending', 'cash_already_closed', 'handover_recipient_not_clocked_in', 'internal_error']) assert.ok(REASONS[code], code);
});

test('a code without text still gets a cause by status, the attempted action and the code to quote; a server message wins over a status guess but not over a known code', () => {
  assert.match(reasonText('brand_new', 409, null, { action: 'cerrar la caja' }), /al cerrar la caja.*código: brand_new/);
  assert.match(reasonText(undefined, 503, null, { action: 'fichar la salida' }), /El servidor falló al fichar la salida.*código HTTP 503/);
  assert.match(reasonText(undefined, 404, null, { action: 'abrir la caja' }), /No se encontró/);
  assert.match(reasonText(undefined, 401), /sesión ha caducado/);
  assert.match(reasonText(undefined, 403), /no tiene permiso/);
  assert.equal(reasonText('brand_new', 409, 'Mensaje propio del servidor.'), 'Mensaje propio del servidor.');
  assert.equal(reasonText('no_open_shift', 409, 'Mensaje del servidor'), REASONS.no_open_shift, 'a known code keeps the reviewed text');
  assert.match(networkReason('cerrar la caja'), /No hay conexión con el servidor para cerrar la caja/);
});

test('cash handover, outflow and payment failures explain the cause and next action', () => {
  for (const code of [
    'handover_recipient_not_clocked_in',
    'handover_recipient_holds_register',
    'handover_already_pending',
    'handover_custody_changed',
    'cash_outflow_failed',
    'cash_outflow_decision_failed',
    'cash_outflow_not_found',
    'cash_outflow_already_decided',
    'cash_session_required',
    'amount_exceeds_balance',
    'charge_refunded',
  ]) {
    assert.ok(REASONS[code], `${code} has a reviewed cause/action message`);
    assert.ok(REASONS[code].length > 40, `${code} explains the concrete cause and next step`);
  }
  assert.match(reasonText('cash_outflow_unexpected', 409, null, { action: 'registrar el gasto o la retirada' }), /al registrar el gasto o la retirada.*cash_outflow_unexpected/);
  assert.match(reasonText('payment_unexpected', 503, null, { action: 'registrar el pago' }), /falló al registrar el pago.*payment_unexpected/);
});

test('economic operation failures say what was not confirmed and how to avoid duplicate actions', () => {
  assert.match(REASONS.cash_handover_start_failed, /no confirmó el inicio del traspaso.*comprueba si ya aparece pendiente antes de repetirlo/i);
  assert.match(REASONS.cash_handover_confirmation_failed, /no confirmó la recepción.*comprueba si la custodia ya cambió/i);
  assert.match(REASONS.cash_outflow_failed, /no confirmó si el gasto o la retirada quedó registrado.*antes de repetirlo para evitar duplicados/i);
  assert.match(REASONS.cash_outflow_decision_failed, /no confirmó si la aprobación o el rechazo quedó guardado.*antes de repetir la decisión/i);

  const payment = reasonText('internal_error', 500, null, { action: 'registrar el pago' });
  assert.match(payment, /error al registrar el pago/i);
  assert.match(payment, /no se puede confirmar si el cambio quedó registrado/i);
  assert.match(payment, /comprueba el estado antes de repetirlo/i);
  assert.doesNotMatch(payment, /El servidor falló al procesar la acción/);
});
