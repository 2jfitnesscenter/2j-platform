# Economía — errores de pagos, traspasos y gastos

## Cambio

Los rechazos de cobros, traspasos y gastos/retiradas pasan por `reasonText` para mostrar la causa conocida y el siguiente paso. Si el servidor devuelve `internal_error` al registrar un pago, el mensaje pide actualizar y comprobar el cargo antes de reintentar, porque la respuesta no confirma si se guardó. No cambian las reglas económicas ni las respuestas del API.

## Recorrido sintético verificado

1. En un cargo con saldo parcial, un importe superior al pendiente muestra el motivo y pide reducirlo.
2. Un fallo interno al registrar el pago indica que se compruebe el cargo antes de repetir la operación.
3. Un error al iniciar un traspaso pide consultar si ya figura pendiente antes de volver a iniciarlo.
4. Un error al confirmar un traspaso pide comprobar si cambió la custodia antes de confirmar otra vez.
5. Un error al registrar un gasto/retirada pide comprobar los movimientos antes de reintentar para evitar duplicados.

Los pasos se verificaron con fixtures sintéticos en las pruebas de interfaz. No se usó staging ni información real.

## Verificación

- Admin Web: **449/449 PASS**, secuencial.
- Pruebas enfocadas de reason-text y Economía: **18/18 PASS**.
- Typecheck: **11/11 PASS**.
- Build del Admin Web: **PASS**.
- `git diff --check`: **PASS**.
- Sin cambios en API, migraciones, datos o infraestructura. Sin despliegue.
