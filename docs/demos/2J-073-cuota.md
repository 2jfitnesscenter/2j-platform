# Demo — flujo de cuota 2J-073

Usar solamente una base local descartable y el rol demo Admin. No apuntar a producción.

1. En **Servicios**, crear o elegir un servicio activo; en **Planes**, crear `Funcional 2 días/semana` como recurrente con cadencia mensual, precio base opcional, dos accesos semanales al servicio y acceso `training · limitado`.
2. Activar el borrador. Un catálogo activo no se edita: para cambiar precio/derechos se crea una versión nueva; la asignación anterior conserva su versión.
3. Abrir **Clientes**, elegir un cliente activo y usar **Añadir cuota**. La selección sugiere el precio catálogo; mantenerlo o, con permiso de pricing, cambiarlo e introducir el motivo.
4. Elegir vigencia y vencimiento del cargo. Marcar **Cobrar ahora** solo para simular el registro explícito dentro de Economics (efectivo requiere caja abierta), o dejarlo pendiente. No existe cobro automático.
5. En Cliente 360 → **Cuotas**, verificar snapshot, fechas, derechos, precio vendido, estado económico y módulo Training limitado. Usar **Ver movimientos** para consultar los eventos.
6. Para renovar, pulsar **Renovar** en una asignación recurrente activa. Se crea una nueva asignación y cargo con idempotencia; la anterior y su factura permanecen en historial. Para un cambio, usar **Cambiar plan** y fecha efectiva futura; la cuota nueva queda programada hasta esa fecha.
7. Pausar/reanudar/cancelar desde su acción; se conserva ledger e historial. La pausa no amplía fechas automáticamente.

Verificación central independiente de la UI: `GET /api/clients/{clientId}/entitlements/effective?date=YYYY-MM-DD` con sesión local autorizada, usando fecha local `Atlantic/Canary`.
