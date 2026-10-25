# Handoff — 2J-CASH-D113

## Objetivo

Aplicar D113 a las rutas de cobro existentes: cualquier cobro confirmado necesita un turno de caja abierto y queda asociado a ese turno. Platform sigue siendo la autoridad económica; no se añaden movimientos manuales.

## Alcance implementado en esta rama

- Los pagos, pagos iniciales de asignaciones y reembolsos/anulaciones requieren turno abierto para cualquier método. Los movimientos quedan vinculados al turno activo.
- Las ventas POS pagadas, con cualquier método, requieren turno abierto y conservan el vínculo a `economic_cash_sessions`; solo las ventas en efectivo aumentan el efectivo físico esperado.
- D102: validar un justificante de transferencia no requiere caja abierta y el movimiento de transferencia no se vincula a un turno.
- La diferencia de caja solo se devuelve al contexto que trae el permiso explícito server-side `owner.panel.read`. El rol genérico `admin` y su comodín no lo conceden. Se oculta en la API de caja, su respuesta de cierre y el Command Center para manager/staff; Admin Web también la muestra solo con la capacidad concedida.
- Sin turno abierto las operaciones D113 se rechazan dentro de la transacción. Los reintentos idempotentes de operaciones completadas siguen reproduciendo el resultado.
- El fixture E2E de Platform abre una caja sintética antes de los escenarios de pago. No modifica Home, Búnker ni el runtime de Búnker.

## Límites y secuencia siguiente

Tras integrar y revisar D113 independientemente, el orden acordado es D97 (explicación obligatoria de diferencias y validación de Admin), D111 (recuento ciego) y después las pantallas de caja, usando el prototipo solo como referencia visual. Aún no hay conteo por denominación: la vista actual sigue mostrando el esperado hasta que se implemente D111. No se adoptan `CashMovement`, entradas/salidas manuales ni gastos (D98).

La secuencia posterior confirmada por el propietario:

- Abrir caja requiere fichaje de entrada. El entrenador registra el fondo de apertura.
- No se puede fichar la salida mientras se mantenga la caja abierta, salvo cerrar o traspasar la caja a otro entrenador que ya haya fichado entrada.
- Traspaso como movimiento separado: ambos entrenadores cuentan a ciegas por denominación y confirman; los descuadres son solo para el propietario.
- Cada recuento (apertura, traspaso, cierre) almacena cantidades por denominación de monedas y billetes en euros; Platform calcula el total. No enseñar el esperado al entrenador.
- Fondo base por defecto de 50 €, pero se registra el recuento real de cada día.
- El panel `owner.panel.read` mostrará movimientos del día, denominaciones, traspasos y si cuadra.
- Si alguien olvida cerrar: propuesta para aprobación, no implementada: mantener turno abierto y permitir solo al propietario un cierre forzado auditado con hora real, recuento y explicación, sin fabricar ni retrofechar fichajes (D123).

Decisiones aún abiertas para el propietario: (1) si varios entrenadores comparten una única sesión/cajón con traspasos durante el día o usan sesiones separadas; (2) si al día siguiente se sugiere como fondo el último recuento real o se vuelve al valor por defecto de 50 € solicitando un nuevo recuento. Antes de implementar traspasos y denominaciones se preparará una PR documental breve de propuesta para aprobación del propietario (A39–A41).

La migración `0046_store_sales_cash_session.sql` está en esta rama y no se ha aplicado a ninguna base real.

## Validación local

En una PostgreSQL 17 sintética desechable, con base nueva:

- Suite completa: **636/636** — design-tokens 6, domain 34, permissions 10, ui 18, auth 2, audit 3, API/PostgreSQL 318, Admin Web 187, Client App 45, Staff App 7, deploy-kit 6.
- Suite API/PostgreSQL por separado: **318/318**.
- Typecheck: **11/11** tareas.
- Build forzado: **9/9** tareas.
- Migraciones: **46/46** verificadas con checksum; `db:migrate` se volvió a ejecutar sin reaplicar cambios.
- `pnpm audit --audit-level high`: PASS; 10 avisos (6 bajos, 4 moderados), 0 altos/críticos según el umbral ejecutado.
- `git diff --check`: PASS.
- El repositorio/workflow no define un gate de lint independiente.

CI de GitHub debe verificarse para el nuevo SHA después del push. No se ha desplegado ni se ha migrado una base real. El PR sigue sin fusionar. Se requiere revisión independiente de solo lectura; Claude Code tiene delimitado no tocar los archivos de caja.
