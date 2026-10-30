import React from 'react';
import { Card, CardHeader, EmptyState, PageHeader, StatusChip, icons } from '@2j/ui';

/**
 * Promociones (paridad con Promotions.jsx de 2jfit-admin). A46/D93: el menú se deja visible, pero las promociones
 * no tienen efecto sobre ningún precio hasta que el propietario decida y apruebe el diseño. Por eso esta pantalla
 * no permite crear, editar ni eliminar nada y lo dice con claridad: no hay datos ni API de promociones.
 */
export function PromotionsPage() {
  return <main className="summary promotions-page" id="promotions" data-2j-design="v2">
    <PageHeader title="Promociones" description="Descuentos y ofertas del centro. Esta sección está visible por paridad con el panel anterior." actions={<StatusChip tone="neutral" icon={null}>No conectado</StatusChip>} />
    <Card as="section" padding="none" className="summary-card" aria-labelledby="promotions-state-title">
      <div className="summary-card-head"><CardHeader title="Estado de las promociones" titleId="promotions-state-title" level={2} /></div>
      <EmptyState icon={icons.Ticket} title="Las promociones todavía no se aplican a ningún precio">
        Cuotas, tienda y cobros se calculan siempre con los precios de sus tarifas. Cuando el propietario decida cómo deben funcionar los descuentos y apruebe su diseño, se podrán crear aquí.
      </EmptyState>
      <ul className="promotions-notes" aria-label="Qué significa esto">
        <li>No se puede crear, editar ni eliminar promociones desde esta pantalla.</li>
        <li>Ningún importe de Planes y cuotas, Tienda ni Economía cambia por lo que aparezca aquí.</li>
        <li>Para ajustar un precio hoy, edita la tarifa del plan o del producto.</li>
      </ul>
    </Card>
  </main>;
}
