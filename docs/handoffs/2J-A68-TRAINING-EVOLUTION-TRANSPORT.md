# 2J-A68 — Transporte de Mi evolución

## Estado

Implementación en curso sobre `main` `6d46f06523285882e518de0512af11e11be46461`. Este handoff no autoriza merge ni despliegue.

## Cambio

- Se conserva `GET /api/me/training-summary` y su transporte 2J-089 para la superficie Búnker.
- Se añade `GET /api/me/evolution` para Mi evolución. Platform deriva `personId`, cliente y vínculo activo desde la sesión; exige asignación efectiva con `training_access` y aceptación vigente de la versión publicada `home_evolution` antes de llamar a Búnker.
- El transporte nuevo envía `POST /api/platform/v1/training-evolution` con el envelope firmado `2J-SERVICE-AUTH-V1` y `authorization.consent.purpose = home_evolution`. Reutiliza flags y credenciales ya configurados para el servicio, sin claves nuevas.
- La respuesta remota se valida con esquema estricto, IDs remotos no llegan a Home, y cualquier campo corporal/de medidas no admitido hace fallar la respuesta cerrada. Se devuelve `Cache-Control: no-store`; la auditoría conserva decisión sin contenido.
- Home cambia la pantalla «Mi evolución» a la lista de entrenamientos finalizados. Los bloques por consentimiento, cuota, vínculo y servicio no disponible siguen mostrando «Sin datos»/«No conectado»; gráficos, medidas, evaluaciones y salud siguen «No conectado».

## Seguridad y compatibilidad

- El gate #169 permanece antes de cualquier solicitud remota: vínculo activo, derecho efectivo de entrenamiento, consentimiento `home_evolution` vigente y auditoría.
- El resumen 2J-089 continúa disponible y separado; no es un bypass de la pantalla A68.
- No se añade migración, no se persiste el cuerpo exportado y no se cambian decisiones fiscales/sanitarias.
- El exportador Búnker entrega el campo `weight` como carga/rendimiento de ejercicio según el contrato A68; no se incluye peso corporal ni mediciones antropométricas. Campos ajenos como `bodyMeasurements` o `measurements` se rechazan.

## Verificación local

- API focalizada en PostgreSQL sintético: 113/113 PASS después de hacer hermética una fixture preexistente de lista de espera.
- Suite API completa sobre PostgreSQL sintético nuevo: 433/433 PASS, 0 fallos, 0 omitidos.
- Client App: 49/49 PASS.
- Typecheck del repositorio: 11/11 PASS; build: 9/9 PASS.
- No hay cambios de migración. `git diff --check` pendiente tras este ajuste documental.
- `pnpm audit` informa 11 vulnerabilidades transitivas (6 low, 5 moderate); no se ha cambiado el lockfile en este alcance.

## Pendiente

- Ejecutar `git diff --check`, publicar el mismo PR y comprobar CI sobre su SHA exacto.
- Revisión independiente de nivel 2 sobre el SHA publicado. No habilitar despliegue.
