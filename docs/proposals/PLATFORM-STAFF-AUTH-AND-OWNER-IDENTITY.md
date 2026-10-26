# Propuesta: autenticación de personal y vínculo de identidad del propietario

**Estado:** propuesta de diseño; no implementada.  
**Alcance:** login de Admin/Trainer en Platform y asignación segura de `owner.panel.read`.
**No autoriza:** despliegue, migraciones en una base real, alta de credenciales reales ni cambios de DNS.

## Objetivo

Permitir que el propietario y el personal entren en `admin.2jfitnesscenter.com` y `staff.2jfitnesscenter.com` con identidad verificada por el servidor. La sesión debe producir el `actorId` estable que consumen las APIs actuales, enlazándolo con la faceta profesional cuando corresponda. La interfaz nunca elegirá su rol ni sus permisos.

## Estado comprobado en el código actual

- `buildServer` usa un `authorizationResolver` que devuelve `null` si el host no inyecta uno. El servidor de producción no dispone todavía de un proveedor de autenticación de personal integrado.
- El login con passkey de Platform que existe está en `apps/api/src/member-pilot-auth.ts`; está limitado al piloto Member y su sesión de autorización cliente/persona no proporciona un contexto de staff.
- El login Member piloto con código está restringido a desarrollo/test. No se propone reutilizar ese flujo ni habilitarlo para Admin/Staff.
- Las passkeys de Platform ya tienen tablas de persona/credencial con `rp_id` registrado (`apps/api/migrations/0041_platform_passkeys.sql`). El servicio Member actual es la única ruta de uso verificada; reutilizar sus credenciales o desafíos para personal requiere comprobar expresamente el RP ID, origen, audiencia y aislamiento.
- `staff_professionals.auth_actor_id` vincula una identidad autenticada a la faceta profesional; no cubre al propietario si no existe una ficha de profesional.
- `owner.panel.read` es un permiso conocido que no hereda el wildcard de Admin. `apps/api/src/server.ts` puede derivarlo de un `ownerActorId` confiable configurado por el host. El resolver predeterminado sigue sin autenticar a nadie.
- El modelo de permisos efectivo está definido actualmente en `packages/permissions`; el perfil de propietario todavía no se alimenta desde un proveedor de identidad de producción.

## Diseño recomendado para discusión

### 1. Identidad y autorización

- El servidor autentica un sujeto opaco e inmutable (`actorId`/auth subject); nunca email, nombre, teléfono, `clientId` ni `professionalId` enviados por el navegador.
- Si la persona tiene faceta profesional, el resolver consulta el vínculo activo `staff_professionals.auth_actor_id`. La identidad humana puede tener facetas client y staff sin crear otra cuenta.
- El propietario también es un sujeto de identidad Platform. No se obliga a crearle una faceta `staff_professionals` solo para iniciar sesión.
- El contexto de autorización se construye server-side desde sesión, faceta y perfiles/permisos vigentes. Las APIs continúan llamando `can(...)` en cada solicitud; las capacidades del shell solo controlan presentación.
- `owner.panel.read` se concede mediante un perfil explícito de propietario asignado al sujeto verificado del propietario. No se deduce de `admin`, email, primer usuario, nombre ni pertenencia a la empresa. Pedro/Management no recibe este permiso por su rol.
- Para el periodo previo a perfiles persistidos, mantener el mecanismo de actor propietario explícitamente configurado como puente temporal y fail-closed; el futuro perfil persistido reemplaza la configuración, no se combinan dos fuentes ambiguas.

### 2. Login y sesiones

- Recomendación: passkey WebAuthn para cuentas de personal, con servidor como autoridad de challenge, RP ID y orígenes permitidos. No copiar credenciales de Training ni confiar en la cookie de Training.
- Reutilizar componentes criptográficos/almacenamiento de passkeys existentes solo si una revisión confirma aislamiento correcto entre orígenes y audiencias. Preferir endpoints, challenges, rate limits y sesión de personal separados del login Member.
- Emitir cookie host-only `HttpOnly`, `Secure` bajo HTTPS, `SameSite=Lax`; guardar únicamente hash del token de sesión, con caducidad, revocación, auditoría y sin credenciales en logs. No usar bearer tokens en `localStorage`.
- Recomendación de sesión inicial: duración limitada similar al piloto actual; exigir nueva aserción passkey para enrolamiento/revocación de factores, recuperación, cambios de perfil propietario y otras operaciones de seguridad. La duración y frecuencia definitivas requieren revisión de seguridad antes de habilitarlo.
- Invitaciones de personal: emitidas por un actor autorizado, de un solo uso, con expiración breve y vínculo previo a una identidad/persona estable. No buscar ni fusionar cuentas por coincidencia de email/teléfono.
- El acceso inicial del propietario requiere un procedimiento de bootstrap que verifique presencialmente o por un canal existente controlado la identidad, vincule el sujeto opaco y registre el actor/fecha. No se debe inferir el propietario a partir de una variable definida con email ni dejar una ruta pública de auto-asignación.

### 3. MFA, recuperación y controles

- Passkey es el factor principal recomendado; permitir más de una passkey registrada para reducir bloqueos. Definir una recuperación revisable, auditada y con controles equivalentes, sin reiniciar o duplicar identidades.
- Limitar intentos y desafíos, consumir challenges atómicamente, proteger contra replay, fijar origen/RP ID, usar respuestas genéricas ante errores de login y registrar eventos sin incluir secretos ni datos de autenticadores.
- Revocar sesiones tras baja/archivo de staff, revocación de sujeto, cambio de perfil privilegiado o incidente; invalidar permisos en cada request o con caché invalidable de forma explícita.
- Preparar aceptación de proxy HTTPS/cookies, monitorización de login y retención de sesiones como gates separados antes de producción.

## Secuencia propuesta

1. Aprobar el modelo de sujeto, el bootstrap del propietario, la política de passkeys/recuperación y la relación con perfiles D124.
2. Contrato de auth y threat model; pruebas de origen, RP ID, sesión, CSRF, revocación, replay, escalada de permisos y aislamiento Admin/Trainer/Owner.
3. Persistencia y servicio de login de personal en PR separado, flag apagado por defecto; tests de PostgreSQL y security review independiente.
4. Adaptador del host de producción que crea `AuthorizationContext` desde sesión verificada y perfiles activos; mantener fail-closed si no está configurado.
5. Bootstrap auditado de identidad del propietario y asignación única del perfil `owner.panel.read`; verificar respuestas de dashboard/economía ante Owner, Admin, Management y Trainer.
6. Prueba de staging sintético y aceptación operativa/security antes de cualquier decisión de despliegue.

## Límites y decisiones que esta propuesta no toma

- No determina proveedor externo de identidad, compra de servicio, precio ni suscripción.
- No cambia el RP ID de Training, no traslada sus passkeys y no implementa SSO.
- No concede `owner.panel.read` a ningún actor real ni cambia el `PLATFORM_OWNER_ACTOR_ID` actual.
- No define recuperación final, duración de sesión de producción, requisitos legales de MFA ni mecanismo físico/remoto de bootstrap.
- No habilita autenticación de producción. El estado actual es fail-closed y el piloto Member continúa separado.

## Criterios de aceptación para la implementación futura

- Sin sesión válida todas las rutas staff protegidas responden no autorizado; la UI no puede escoger actor, rol, perfil o permiso.
- Sesiones y desafíos no reutilizables; expiración y revocación probadas; cookie y CSRF/origen probados.
- Owner recibe `owner.panel.read` solo por vínculo de sujeto/profile aprobado; Admin, Management y Trainer no lo heredan.
- La baja/revocación impide acceso siguiente; la auditoría no contiene credenciales, tokens ni datos sensibles innecesarios.
- No se usa email/teléfono para hacer matching, no se crean cuentas duplicadas y el login Member existente no cambia.
- Tests reproducidos, quality/security checks verdes y revisión independiente antes de retirar la bandera apagada.
