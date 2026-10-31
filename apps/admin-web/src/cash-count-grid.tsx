import * as React from 'react';

/** Denominaciones del recuento (A41): clave del API, etiqueta corta, etiqueta completa (lector de pantalla) y céntimos. */
export const CASH_DENOMINATIONS = [
  ['bill_500', '500 €', 'Billetes de 500 €', 50000], ['bill_200', '200 €', 'Billetes de 200 €', 20000], ['bill_100', '100 €', 'Billetes de 100 €', 10000],
  ['bill_50', '50 €', 'Billetes de 50 €', 5000], ['bill_20', '20 €', 'Billetes de 20 €', 2000], ['bill_10', '10 €', 'Billetes de 10 €', 1000], ['bill_5', '5 €', 'Billetes de 5 €', 500],
  ['coin_2', '2 €', 'Monedas de 2 €', 200], ['coin_1', '1 €', 'Monedas de 1 €', 100], ['coin_0_50', '50 c', 'Monedas de 50 céntimos', 50], ['coin_0_20', '20 c', 'Monedas de 20 céntimos', 20],
  ['coin_0_10', '10 c', 'Monedas de 10 céntimos', 10], ['coin_0_05', '5 c', 'Monedas de 5 céntimos', 5], ['coin_0_02', '2 c', 'Monedas de 2 céntimos', 2], ['coin_0_01', '1 c', 'Monedas de 1 céntimo', 1],
] as const;
export type CashDenominationKey = typeof CASH_DENOMINATIONS[number][0];
export type CashCounts = Record<CashDenominationKey, string>;

export const emptyCashCounts = (): CashCounts => Object.fromEntries(CASH_DENOMINATIONS.map(([key]) => [key, '0'])) as CashCounts;
export const isValidCashCount = (value: string | undefined) => /^(0|[1-9]\d{0,6})$/.test(value ?? '');
export const cashCountsValid = (counts: Partial<Record<string, string>>) => CASH_DENOMINATIONS.every(([key]) => isValidCashCount(counts[key]));
export const cashCountsTotalCents = (counts: Partial<Record<string, string>>) => CASH_DENOMINATIONS.reduce((sum, [key, , , cents]) => sum + (isValidCashCount(counts[key]) ? Number(counts[key]) * cents : 0), 0);
const euro = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);

type GridProps = {
  counts: Partial<Record<string, string>>;
  onChange: (key: CashDenominationKey, value: string) => void;
  /** Total en vivo. Se oculta en el cierre a ciegas (D111): quien custodia no debe ver el importe esperado ni inducirlo. */
  showTotal: boolean;
  disabled?: boolean;
};

/** Recuento compacto: billetes y monedas agrupados, campos pequeños en rejilla, 0 por defecto y teclado numérico en tablet. */
export function CashCountGrid({ counts, onChange, showTotal, disabled }: GridProps) {
  const groups = [['Billetes', CASH_DENOMINATIONS.filter(([key]) => key.startsWith('bill_'))], ['Monedas', CASH_DENOMINATIONS.filter(([key]) => key.startsWith('coin_'))]] as const;
  let first = true;
  return <div className="cash-count">
    {groups.map(([title, items]) => <fieldset key={title} className="cash-count-group"><legend>{title}</legend>
      <div className="cash-count-grid">{items.map(([key, short, full]) => {
        const initial = first; first = false;
        const invalid = !isValidCashCount(counts[key]);
        return <label key={key} className="cash-count-field"><span aria-hidden="true">{short}</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" aria-label={full} aria-invalid={invalid || undefined} disabled={disabled}
            data-dialog-initial-focus={initial ? true : undefined} value={counts[key] ?? ''}
            onFocus={event => event.currentTarget.select()}
            onChange={event => onChange(key, event.target.value.replace(/\s/g, ''))} /></label>;
      })}</div></fieldset>)}
    {showTotal && <p className="cash-count-total" role="status">Total contado: <strong>{cashCountsValid(counts) ? euro(cashCountsTotalCents(counts)) : '—'}</strong></p>}
  </div>;
}
