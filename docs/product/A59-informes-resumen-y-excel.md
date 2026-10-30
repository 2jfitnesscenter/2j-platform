# A59 — Informes: lista de ventas + pestaña Resumen (revisa D108) y Excel D109

**Decisión del propietario (28 oct 2026).** Informes conserva la lista simple de ventas de D108 (#117) y añade, en una pestaña aparte llamada **Resumen**, KPIs y gráficos. D108 deja de prohibir los gráficos, pero solo dentro de esa pestaña.

**Alcance**
- `GET /api/reports/summary?from&to`: permiso `billing.read-basic`, rango máximo 366 días, consultas parametrizadas de solo lectura sobre los mismos asientos que la lista. Devuelve solo agregados: ingresos mensuales (vendido y cobrado), vencido sin cobrar (a día de hoy), cuota media, ocupación, asistencia, reservas por servicio, cuotas por plan y cobros por método. Sin nombres de clientes ni datos de salud (D33).
- `GET /api/reports/export.xlsx?from&to` (D109): permiso `billing.export`. Libro de seis hojas: Resumen, Ventas, Cobros por método, Ingresos mensuales, Reservas por servicio y Cuotas por plan. El texto libre que una hoja de cálculo leería como fórmula (`= + - @`, tabulador, retorno) se neutraliza con un apóstrofo, igual que el CSV. Sin ninguna fórmula en el libro.
- El `.xlsx` se genera sin dependencias nuevas (`apps/api/src/xlsx.ts`: OOXML mínimo y zip con `node:zlib`).
- Gráficos en SVG propios con los tokens de color (claro y oscuro), con texto alternativo y una tabla equivalente para lectores de pantalla.

**Sin cambios**: no se emiten facturas (D106); el CSV de ventas sigue como estaba.

**Definiciones de los indicadores**
- Ocupación = plazas con reserva (reservada, asistida o ausente) ÷ capacidad de las sesiones programadas del periodo.
- Asistencia = asistidas ÷ (asistidas + ausencias) de las sesiones ya celebradas.
- Cobros por método: cobros registrados, sin descontar devoluciones.
