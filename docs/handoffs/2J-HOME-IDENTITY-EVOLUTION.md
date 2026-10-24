# 2J-HOME-IDENTITY-EVOLUTION — handoff Home

**Estado:** reconstruida sobre PR #86 y lista para publicar como Draft PR; sin merge ni despliegue.
**Rama:** `agent/codex/2J-HOME-IDENTITY-EVOLUTION`
**Base:** PR #86, HEAD `3384bd15797567647aebb0840e4f8a04048973f8`; contiene exactamente los tres commits propios reaplicados sobre esta base, sin el merge de preview `2602953`.
**Commit de implementación:** `9eabe41a14909e985ca790f0ca63e03ad4d1dbad`.
**PR:** pendiente de creación como Draft sobre la pila indicada por Claude Code; la rama local ya está restackeada.
**PR #86:** no modificado.
**Diseño:** cinco destinos existentes; grafito y lima `#A4D65E`; demo con la marca `DEMO · DATOS FICTICIOS`.

## Hecho en Home

- Se añadió Perfil → Cuenta de Búnker / Mi evolución y acceso a Gestión de vinculación desde el destino Búnker. La navegación inferior conserva exactamente Inicio, Búnker, Tienda, Perfil y Ajustes.
- Vinculación usa `POST /api/platform/v1/training-link-transactions` (`{requestId}`), luego `POST /api/me/training/link` (`{transactionId, challenge, code}`) y `DELETE /api/me/training/link`. Cada petición usa `fetch` con `credentials: include` y `cache: no-store` mediante el cliente API existente. Los botones y llamadas están apagados salvo `VITE_2J_TRAINING_ACCOUNT_LINKING=true`; la respuesta del servidor sigue siendo autoridad.
- El estado visible se lee del endpoint existente `GET /api/me/training-summary`, que responde `linked` o `not_linked`; no se inventó una ruta de estado. La revocación distingue el caso pendiente de confirmación Búnker.
- La prueba de passkey ocurre en Búnker. Home crea la transacción, conserva el desafío solo en memoria y recibe el código de un solo uso. La UI no captura, pide ni simula passkeys. Búnker todavía necesita una pantalla de usuario que inicie la prueba para el `transactionId` y emita el código; hasta entonces el flujo Home no es extremo a extremo.
- Revisión manual consume `GET/POST /api/me/training/link-review`, solo con motivos `lost_passkey`, `no_access_to_training_account`, `proof_failed`, `other` y nota opcional. Se activa por separado con `VITE_2J_TRAINING_LINK_REVIEW=true`; no se envía un identificador de Búnker. El estado aprobado explica que aprobación administrativa no crea por sí sola el vínculo.
- En Platform, las banderas de servidor observadas para el flujo de vínculo son `TRAINING_LINK_LIFECYCLE_ENABLED`, `TRAINING_VERIFIED_LINKING_ENABLED`, `TRAINING_CANONICAL_LINKING_ENABLED` y `TRAINING_SERVICE_CALLS_ENABLED`. La sesión de esta rama sigue siendo de piloto/portal, no la identidad central de producción. La implementación #81 de revisión no está presente en esta base; activar su bandera en Home no crea esos endpoints.
- Elegibilidad D185 consume opcionalmente `availability` / `availabilityReason` aditivos en `GET /api/me/sessions`, solamente con `VITE_2J_SESSION_ELIGIBILITY=true`. Home muestra las seis etiquetas del contrato v1 y no calcula el derecho. El flag de build y la compatibilidad con campos ausentes dejan el comportamiento anterior intacto.
- “Mi evolución” presenta Mediciones, Gráficos, Evaluaciones y Mi salud como pantallas navegables. No hace llamadas ni muestra valores ficticios: indica que el contrato Platform está pendiente. Mi salud recuerda la necesidad de consentimiento expreso y control Platform.
- El modo demo mantiene el aspecto aprobado y los cinco destinos. El perfil principal, el bono de 12 sesiones, los IDs de ejemplo y los dos productos reflejan filas sintéticas fijas de `apps/api/scripts/seed-demo.ts`, copiadas como fixtures locales; el build no lee la base de datos ni hace llamadas. Noticias, compra de muestra, avisos y las sesiones extra son fixtures visuales locales, no registros del seed. Las nuevas pantallas muestran expresamente que no consultan ni cambian cuentas reales. `build:demo` borra todas las variables `VITE_*`, por lo que las nuevas integraciones quedan desactivadas.

## Base y contratos revisados

Refs locales disponibles al preparar esta rama:

- #67 / cierre SSO y protocolo bilateral: `origin/agent/claude/2J-INT-CLOSURE` = `79ffcd47a663b51047944e51ac6eb1283c35d2ca`; la base integrada de Home es `2602953500bff4d1e2eb9ccc372736ca74927eeb`.
- #81 revisión manual: `origin/agent/claude/2J-LINK-REVIEW-QUEUE` = `95fa720c569f687dd86ef1a8f809e7a8937b79ce`. Esta API no está en la base de la rama; Home solo implementa su consumo contractual.
- #80 D185 elegibilidad: ref local `origin/agent/codex/2J-D185-session-eligibility` = `3ed78d4875a0c10aa078b0e487af366d378584ab`. Contrato `GET /api/me/sessions` v1, seis estados; campos opcionales y aditivos. No se actualizó ni se fusionó el API.

Las refs son snapshots locales observados, no una comprobación del estado remoto actual. Antes de apilar o publicar, Work Platform/Claude debe confirmar las cabezas vigentes. No se modificó la autoridad de capacidades ni PR #86, bloqueado por #73.

## Datos reales, sintéticos y límites

- **Real en código Home:** integración de endpoints anteriores bajo flags cliente; aún requiere sesión central de miembro que resuelva la persona y activación de las banderas Platform/Búnker.
- **Demo:** fixture ficticio local de `makeHubPreview`; no API, no autenticación productiva, no reservas/pagos reales, no SSO y no navegación externa a Búnker.
- **Mi evolución:** estructura de interfaz únicamente. No hay mediciones, gráficas ni evaluaciones presentadas como datos reales.
- **No probado:** servidor Platform con #81, Búnker real con passkey, canje real de código, revocación bilateral real, integración API de #80 en `main`, ni prueba en dispositivo físico.
- La sesión de Home en esta base sigue siendo la sesión piloto/portal que consume cookies; no se activa identidad central productiva aquí.

## Registro: brechas Home observadas (sin cambios de producto)

Fuente consultada: `REGISTRO-DECISIONES-2J.md` del escritorio. Se listan brechas que siguen visibles en esta base, no decisiones nuevas.

1. **D01/D05/D08/D10/D12/D13/D16/D17/D28/D33/D43/D45/D47:** no existe contrato de Platform para mediciones, evaluaciones, gráficos, consentimiento/salud o historial migrado. La UI vacía preparada no es implementación de dominio. Resolución operativa del propietario ya comunicada en esta sesión: cliente escribe con cuota activa; personal autorizado puede escribir para quien no tenga cuota. Corrección, eliminación y conservación de datos de salud aún dependen del contrato/política aplicable.
2. **D31/D40/D41 y capacidades:** Home conserva las secciones sin cuota, pero no consume capacidades V2.1 ni decide capacidades de entrenamiento autónomo frente a IA/seguimiento. PR #86 queda fuera de esta rama y bloqueado por #73; no duplicar la regla en Home.
3. **D37/D55–D59:** buzón de notificaciones no equivale a mensajería con entrenadores ni a chat/social. Esas pantallas, preferencias de privacidad, bloqueo/moderación y suspensión unificada no están completas.
4. **D38/D152/D176/D199/D209/D211/D248:** Home ya contiene cliente push y centro de notificaciones en la pila integrada, pero el comportamiento de reintentos, agrupación por evento y todas las consecuencias de reserva requiere backend coordinado; no se afirma que todas las decisiones push estén cerradas.
5. **D49/D52–D54:** Tienda e historial existentes muestran productos y compras de tienda; historial económico unificado con cuotas, facturas y pagos, flujos configurables de solicitud/compra, devoluciones y tickets no están cubiertos de extremo a extremo.
6. **D63/D64/D65/D150–D158:** formularios y consentimientos disponibles no implementan firma manuscrita en PDF, clasificación y descarga completa de documentos, consentimiento/legal gate de contratos, ni el ciclo de derechos de datos y baja.
7. **D67/D68:** noticias actuales no expresan aún de forma tipada todas las prioridades normal/importante/urgente, programación/caducidad, confirmación de lectura urgente y permisos de publicación.
8. **D185–D214/D219–D248:** Home reserva y muestra estados existentes; los nuevos campos D185 quedan listos bajo flag. Quedan dependencias de backend para disponibilidad autoritativa, colas/promoción, avisos, concurrencia, consecuencias de ausencia y saldo. Revisar D194–D198 uno a uno cuando #80/main y contratos de reserva estén integrados.
9. **D238/D239:** Home no permite editar los datos personales, consistente con la decisión vigente de solo lectura; el proceso presencial/WhatsApp y verificación por el personal es operación fuera de esta UI.
10. **Identidad/A23/D141/D143:** falta probar el onboarding real y la conservación de UID/passkeys/datos Búnker en cuentas reales. #81 no habilita matching; su aprobación administrativa no completa la asociación Búnker ni da SSO (H13).

## Verificación

- `pnpm --filter @2j/client-app test`: **31/31 pasaron sobre PR #86 restackeado**, incluye los cinco destinos, cero llamadas de red en demo, prueba de payloads de link/review con sesión, revocación, gating por flag y estados de elegibilidad.
- `pnpm --filter @2j/client-app typecheck`: **pasó**.
- `pnpm --filter @2j/client-app build`: **pasó**.
- `pnpm --filter @2j/client-app build:demo`: **pasó sobre PR #86 restackeado**; artefacto local `apps/client-app/dist-demo`, con las banderas `VITE_*` retiradas por el script de demo.
- `git diff --check`: **pasó**.
- Revisión independiente/QA: pendiente.
