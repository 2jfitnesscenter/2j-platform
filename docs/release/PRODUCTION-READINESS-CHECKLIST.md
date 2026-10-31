# Lista de preparación para producción — Platform (30 oct 2026)

Solo documentación, escrita a partir del estado **real** de Git/GitHub y de una pasada con la API y el admin reales sobre datos sintéticos (A67, cierre). Lo no comprobado figura como `NO VERIFICADO`. Nada se ha desplegado: **producción, migraciones sobre BD real, DNS, secretos, borrado de datos y visibilidad del repositorio son solo del propietario, con su frase literal.** Siguiendo A67 no se pide verificación intermedia: esta lista es para la **única** pasada de staging; el guion para hacerla está en `docs/release/PLAN-DE-PRUEBA-PROPIETARIO-STAGING.md`.

## 1. Veredicto

La construcción de Platform admin está **integrada en `main`** y no queda ningún PR de código de Platform abierto, salvo #170 (Home: facturas del socio en Perfil, bloque Home). Para datos reales siguen faltando acciones que solo puede hacer el propietario y lo que aún no está construido (sección 4). El bloqueo histórico «sin login de personal» está **resuelto en código** (#125, passkeys); falta configurarlo en el servidor real.

## 2. Integrado en `main` (verificado en GitHub)

- **Acceso y permisos:** login de personal con passkeys (#125, migración 0054), turnos y horario del centro (#124), perfiles por permiso.
- **Operación:** menú en 4 grupos (#131), Resumen con todos sus bloques y acciones rápidas (#134, #139), Agenda y detalle de sesión (#140), Contratos (#136), Promociones visible sin efecto en precios (#137), búsqueda global con atajos (#146).
- **Mensajes:** bandeja, envío a un cliente (también el primero, sin conversación previa), plantillas, notas internas y lectura en la app del cliente (#145 y cierre A67). Desde la ficha del cliente, «Escribir mensaje» abre su conversación. El envío por email o WhatsApp **no existe**: los mensajes se leen en la app del cliente.
- **Dinero:** Caja con dos registros físicos y pantalla propia (#129, #150), Informes con KPIs, gráficos y Excel multihoja (#147), **facturas y tickets PDF con logo, numeración sin huecos y rectificativas** (#154, migración 0061), **facturas del propio socio** `GET /api/me/invoices` y su PDF (#166; la pantalla en la app del cliente es #170, bloque Home).
- **Gestión del propietario:** Panel de gestión (#143), Monitorización de solo lectura (#144), datos de Mi gimnasio (#132, migración 0059), cuestionarios y consentimientos (#162), ajustes de Centro (#158) y umbral de stock de Tienda (#160, migración 0062).
- **Invitaciones:** bandeja de revisiones H13 (#164, permiso explícito `platform_link_issue`). **Evolución:** pestaña de solo lectura en la ficha (#163, exige `training.read`; migración 0063).
- **Clientes:** documentos privados (#138, migración 0057) y su pestaña, **importación de TIMP**: vista previa (#141, 0058) y paso real con confirmación en pantalla (#153, 0060).
- **Staging:** script e instrucciones (#89), seed sintético Admin+Trainer (#142), arreglos (#152, #127).

Numeración de migraciones en `main`: 0054 a 0066 más la 0067 de este PR (Bizum como método propio), sin huecos ni duplicados; no se reescribe.

## 3. Abierto (no está en `main`)

| PR | Qué es | Nota |
|---|---|---|
| #170 | Home: facturas del socio en Perfil | Bloque Home; consume el endpoint de #166. |
| #130, #149 | Diseño de invitaciones y gap del puente de activación | Solo documentos. |
| #133, #128, #123, #100, #98, #46, #9 | Documentación o propuestas | Sin efecto en producción. |

## 4. Qué NO está real todavía ("No conectado")

- **Invitaciones: alta de invitaciones y cuentas Búnker** — la bandeja de revisiones ya abiertas está en `main`; crear invitaciones, cuentas Búnker y activar acceso queda sin construir (puente bilateral con step-up en Búnker).
- **Evolución** — depende de que Búnker publique los datos (#135).
- **Ajustes:** Centro, Facturación y umbral de Tienda se guardan. **Apariencia** (tokens oficiales de 2J, globales) y **Reservas** (reglas por servicio) no tienen escritura propia, por diseño.
- **Textos de consentimiento/privacidad y cuestionarios:** se crean, versionan y publican desde Mi gimnasio, pero nacen vacíos (A65) y **no se puede pedir un consentimiento hasta que el propietario publique uno**. Salud (D33): fuera del producto.
- **Mensajes por email o WhatsApp**, **multiárea** de «Entrenamiento personal», umbrales de atención/adherencia y motivos de atención: sin construir (faltan definiciones).
- **Facturas del socio:** la lista está limitada a 200 documentos, sin paginación.

## 5. Decisiones tomadas por defecto (A67: sin preguntar)

- Facturación: se sigue **A66** (la más reciente) frente a A63; si el propietario no quiere emisión, basta con no rellenar Configuración → Facturación (sin datos no se emite).
- Agenda: rejilla horaria. App: arranca vacía; la carga masiva es la importación de TIMP.
- Importación: solo con perfil de administración, activada por variable de entorno y apagable tras usarla.
- Caja: abrir y cerrar exigen contar **todas** las denominaciones (0 donde no haya), por diseño del recuento ciego.

## 6. Lista para el día de la salida (todo del propietario, con frase literal)

- [ ] Login de personal real configurado en el servidor (passkeys); Basic Auth y `LOCAL_DEMO_ROLE` fuera.
- [ ] **Identidad del propietario (obligatoria):** definir `PLATFORM_OWNER_PERSON_ID` (UUID de su persona en Platform, para sesión passkey) o `PLATFORM_OWNER_ACTOR_ID` (sujeto de identidad de confianza). Sin una de las dos nadie recibe `owner.panel.read` ni `platform_link_issue`: el Panel de gestión y la bandeja de Invitaciones saldrán «sin permiso».
- [ ] `PLATFORM_LINK_ISSUERS` **solo si se usa**: lista separada por comas de `personId` UUID estables (nunca correos ni nombres) de quienes además del propietario pueden resolver revisiones H13. Un valor que no sea UUID **impide arrancar la API** (intencionado). Vacía = solo el propietario.
- [ ] Copia de seguridad restaurable probada y retención definida.
- [ ] Migraciones **0054 a 0067 en orden** sobre la base real (la 0067 solo amplía los valores admitidos de método de pago: Bizum; no cambia filas).
- [ ] `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true` solo durante la importación; después, apagar el segundo.
- [ ] Configuración → Facturación rellenada (emisor, NIF, dirección, serie, IGIC, pie, logo); factura de prueba emitida y rectificada **en staging**.
- [ ] Texto de privacidad y consentimientos publicado antes de pedirlos a ningún socio.
- [ ] Importación de TIMP: subir el `.xls`, revisar y confirmar; comprobar recuentos (activos = última reserva en 365 días; inactivos archivados; sin deuda; fichas incompletas marcadas).
- [ ] Secretos (llaves de servicio Home↔Platform↔Búnker, almacenamiento privado `OBJECT_STORAGE_DIR`) generados en el servidor; ninguno en Git ni en logs.
- [ ] DNS, certificados, Home y Búnker apuntando a la API correcta.
- [ ] Monitorización en verde y alerta externa de disponibilidad.
- [ ] Vuelta atrás: `rollback` del script revierte código, **no** la base; la base se restaura desde copia.

## 7. Pasada única de staging

Orden: `sudo 2j-staging deploy`, `sudo 2j-staging seed --target-host 2jfit.com`, `sudo 2j-staging selftest`; después, el guion de una página `docs/release/PLAN-DE-PRUEBA-PROPIETARIO-STAGING.md` (Resumen y sus nueve acciones rápidas, Mensajes, Caja, Facturación, Informes, Panel de gestión, Monitorización, Invitaciones, Mi gimnasio, Importar clientes). El Admin de staging solo ve el Panel de gestión si el servicio arranca con `PLATFORM_OWNER_ACTOR_ID=local-demo:admin` (ya está en el compose de staging; **no** en producción).

**Verificado antes de esta pasada (sin servidor):** Resumen, Cobrar, Vender, Fichar, Abrir caja, Cerrar caja y Enviar mensaje se recorrieron con el admin y la API reales sobre el seed sintético en PostgreSQL desechable: abrir caja → cobrar un cargo vencido → el Resumen refleja el cobro → cerrar caja, y escribir a un cliente sin conversación. **En staging: NO VERIFICADO** hasta que el propietario haga la pasada.

## 8. Perímetro, step-up y auditoría de servidor

La preparación de Caddy de producción, la regla de no publicar rutas internas, el estado del step-up de promoción del propietario, el esquema opcional de allowlist, la plantilla de auditd y la renovación del token de lectura Búnker están en [Endurecimiento del perímetro de producción](PRODUCTION-EDGE-HARDENING.md). Son requisitos pendientes: el Caddyfile del repositorio es únicamente de staging y `ADMIN_PROMOTION_STEP_UP` aún no está implementado. No aplicar cambios de servidor desde este repositorio.
