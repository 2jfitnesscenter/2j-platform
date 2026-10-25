# Contrato de lectura Member para Home — V1

**Estado:** propuesta de contrato, pendiente de revisión del equipo Home. Este PR solo documenta el contrato; no cambia rutas ni respuestas.
**Autoridad:** Platform calcula elegibilidad, saldo, vencimiento y acceso. Home presenta el resultado y no replica reglas comerciales.
**Zona horaria:** `Atlantic/Canary`.

## 1. Estado de pago y acceso contractual

### Ruta

`GET /api/me/membership`

La identidad y el `clientId` se obtienen exclusivamente de la sesión Member. No admite un `clientId` elegido por el navegador. La respuesta existente conserva `timezone`, `asOf`, `assignments` y `active`; V1 añade `payment` a cada asignación y mantiene compatibilidad con los consumidores actuales.

### Campo propuesto por asignación

```json
{
  "payment": {
    "status": "partially_paid",
    "accessStatus": "provisional",
    "amountCents": 6000,
    "paidCents": 2000,
    "pendingAmountCents": 4000,
    "dueOn": "2026-11-10",
    "effectiveBlockAt": "2026-11-11T00:00:00+00:00",
    "timezone": "Atlantic/Canary",
    "payments": [
      { "amountCents": 2000, "occurredAt": "2026-11-05T12:30:00Z" }
    ]
  }
}
```

- `status`: `pending | unpaid | partially_paid | paid | refunded | exempt | void | not_applicable`. `unpaid` significa que la fecha local de vencimiento ya pasó y sigue existiendo saldo; no es un cálculo del cliente.
- `accessStatus`: `active | provisional | blocked_unpaid | ended | unavailable`; `unavailable` es un estado contractual inconsistente que Platform cierra de forma segura. Es la evaluación efectiva de acceso de Platform, no una deducción de Home.
- `amountCents`, `paidCents` y `pendingAmountCents` son importes enteros en céntimos de euro. `pendingAmountCents` nunca es negativo. Para `refunded`, el neto pendiente es cero, aunque se conserva el historial de pagos y devoluciones en Platform.
- `dueOn` es una fecha local de negocio (`YYYY-MM-DD`), inclusiva. No es una hora UTC.
- `effectiveBlockAt` es el instante ISO 8601 exacto en que Platform aplica el bloqueo. Para `monthly_day10_v1`, el vencimiento es el día 10 y el bloqueo comienza a las 00:00 locales del día 11. La serialización muestra ese instante con su offset UTC real, que varía con el horario de verano.
- `payments` contiene solo abonos confirmados que afectan a esta obligación. Los importes parciales se conservan como hechos separados; un justificante pendiente no es un pago confirmado.
- Si la asignación no tiene obligación económica aplicable, `payment` es `null` o `status: not_applicable` de forma consistente para todas las asignaciones; se recomienda `null` para evitar objetos vacíos.

El estado sale de los cargos y movimientos económicos autoritativos de Platform (D250), aplicando su semántica de pagos parciales, devolución completa, exención y anulación. El estado de acceso conserva las reglas D99/D103 y los términos congelados de la asignación. El cliente no calcula fechas, vencimientos, netos ni bloqueos.

### Errores y privacidad

- `401 client_authentication_required` cuando no hay sesión Member válida.
- `Cache-Control: no-store`; respuestas únicamente del cliente autenticado.
- No incluir `chargeId`, `assignmentId` de otras personas, notas internas, actor IDs, claves de idempotencia, datos bancarios ni documentos fiscales.
- No incluir cargos independientes de la asignación en su `payment` contractual. Los saldos ajenos al contrato no alteran este estado de acceso.

## 2. Elegibilidad por sesión en el listado

### Ruta

`GET /api/me/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD`

Se añade `availability` a cada sesión del listado existente. Se calcula en el servidor por sesión y por Member autenticado; Home no necesita una llamada de detalle por tarjeta. Se conserva el resto de los campos actuales y no se expone el orden de la cola.

```json
{
  "timezone": "Atlantic/Canary",
  "sessions": [
    {
      "id": "d0840000-0000-4000-8000-000000000101",
      "startsAt": "2026-11-06T18:00:00Z",
      "occupiedCount": 7,
      "capacity": 8,
      "availability": {
        "status": "full",
        "reason": null,
        "canJoinWaitlist": true
      }
    }
  ]
}
```

`availability.status` será exactamente uno de:

- `available`: puede reservar ahora.
- `full`: no queda plaza; la lista de espera puede aceptarse si `canJoinWaitlist` es true.
- `booked`: ya tiene una reserva activa o conservada por las reglas de asistencia.
- `not_allowed_by_plan`: no puede reservar por su acceso contractual o derecho.
- `waitlisted`: ya tiene una entrada activa en la lista de espera.
- `waitlist_suspended`: la entrada en lista de espera está suspendida para esta sesión/servicio.

`reason` es `null` salvo para `not_allowed_by_plan`, cuando usa un código estable y no sensible, por ejemplo `no_entitlement`, `entitlement_not_started`, `entitlement_expired`, `entitlement_paused`, `entitlement_cancelled`, `entitlement_exhausted`, `payment_blocked`, `weekly_limit_reached` o `monthly_limit_reached`. No incluir conceptos, importes ni detalles de cargos como motivo.

`canJoinWaitlist` es booleano y solo describe si el endpoint de alta permite intentar la operación con el estado actual. La escritura vuelve a validar capacidad, derecho, deuda y estado en una transacción; esta respuesta es una instantánea de lectura y puede quedar obsoleta inmediatamente.

### Reglas de privacidad y seguridad

- No devolver `queuePosition`, posición, orden, número de personas delante, `waitlistEntryId` ni identidad de otros miembros. `waitlistCount` puede seguir usándose para ocupación agregada si la política de Home lo permite, pero nunca identifica al solicitante.
- El servidor deriva el Member de la sesión y ejecuta las mismas reglas de elegibilidad que la escritura de reserva/lista de espera. El navegador no envía `clientId`, saldo ni derechos.
- Las sesiones individuales solo aparecen para el cliente asignado, como en el comportamiento actual.
- Mantener `Cache-Control: no-store`; no cachear una elegibilidad ligada a identidad.

## 3. Compatibilidad y validación

- Cambios aditivos; no eliminar ni renombrar campos existentes.
- Tests deben comprobar aislamiento entre Member A/B, pagos parciales, devolución completa, vencimiento y transición de bloqueo en medianoche Canaria; más cada estado de elegibilidad y la ausencia de posición/IDs de cola en JSON.
- Comparar la lista y el detalle para que ambas superficies usen la misma evaluación por sesión.
- Verificar que `payment.effectiveBlockAt` representa el mismo instante que el motor de elegibilidad y que el cambio horario no se calcula sumando 24 horas.

## 4. Secuencia

1. Revisar este contrato con Work Home.
2. Implementar `payment` en `/api/me/membership` y `availability` en `/api/me/sessions` en un PR de API separado, con pruebas de PostgreSQL y sin cambios en reglas de producto.
3. Entregar el handoff de campos y motivos estables a Home cuando el PR de implementación esté disponible.

