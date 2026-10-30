# H13 — hueco del puente de activación asistida Platform ↔ Búnker

Estado: propuesta técnica breve para registrar el gap observado en la revisión de los comentarios retrospectivos de Platform #67 y #81. No activa H13, no cambia permisos ni emite vínculos.

## Estado comprobado

- Platform #81 implementa la cola de revisión y guarda la decisión aprobada con la cuenta Búnker verificada. Aprobar la revisión no crea el vínculo.
- Búnker #63/#68 implementa el issuer allowlist `PLATFORM_LINK_ISSUERS`, step-up de passkey por emisión, recibo cifrado de un solo uso con expiración de 24 horas y ledger append-only encadenado con HMAC.
- El emisor Búnker solo ve `requestId`, `personId` y `trainingUserId`; las rutas quedan apagadas por defecto.
- El flujo Platform actual de `apps/api/src/training-link-flow.ts` manda `origin: proof|provisioned`; no transmite `origin: admin_assisted`, `receiptId` ni `reviewId`.
- La revisión Platform tiene UUID estable (`training_link_review_cases.id`), pero hoy no existe una operación que presente ese identificador junto con el recibo Búnker para completar el vínculo.

## Cambio propuesto para la siguiente implementación

Completar la tercera fase con una operación Platform autenticada que:

1. Solo acepte una revisión `approved` y el mismo `personId` / `trainingUserId` registrados en ella.
2. Requiera el `receiptId` emitido por Búnker y use el UUID de la revisión como `reviewId`.
3. Cree/reutilice una única transición pendiente, con idempotencia y restricciones de unicidad por persona, cuenta y recibo.
4. Envíe a Búnker la activación firmada `origin: admin_assisted`, `receiptId` y `reviewId`; no active Platform hasta recibir el ACK esperado.
5. Mantenga fallo cerrado ante recibo ausente, par distinto, rechazo definitivo o estado inconsistente; los timeouts conservan una transición reintentable sin crear otro vínculo.
6. Registre actor, revisión, recibo, ACK y resultado en la auditoría Platform; nunca registre secretos ni notas libres.

La integración debe tener tests de autorización, revisión no aprobada, persona/cuenta distintas, recibo ausente/duplicado, replay idéntico, payload incompatible, conflicto de vínculo, timeout/reintento, rechazo de Búnker y ACK válido; además verificar que no se activa antes del ACK.

## Migración y orden

En `main` consultado al actualizar esta propuesta (`d6367168c52aee8bb3c927c7093439383443a17b`), la secuencia llega a `0063_member_evolution_consent_audit.sql`: #153 ocupa `0060_client_import_commit.sql`, #154 ocupa `0061_invoice_settings.sql`, #158 ocupa `0062_store_settings.sql` y #135 ocupa `0063_member_evolution_consent_audit.sql`. Esta propuesta no crea ni reserva migración. Antes de implementar el puente se debe volver a inspeccionar `main` y todas las ramas/PR abiertas para escoger el siguiente prefijo.

## Límites y revisión

- No cambia Búnker ni sus emisores, step-up, límite, almacén cifrado, recibos o ledger.
- No se inspeccionó ni se debe copiar configuración/secretos reales del servidor.
- El código actual de Búnker limita a 20 emisiones por ventana móvil de 24 horas por emisor. A28 dice «por día» sin fijar día natural/zona; esta diferencia queda documentada, sin inventar otro reset.
- Antes de integrar la implementación, requiere una única revisión independiente de seguridad H13 sobre el SHA exacto y CI verde.
