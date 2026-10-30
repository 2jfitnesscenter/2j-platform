# Lista de preparación para producción — Platform (30 oct 2026)

Solo documentación, escrita a partir del estado **real** de Git/GitHub (`main` posterior a #164). Lo no comprobado figura como `NO VERIFICADO`. Nada se ha desplegado: **producción, migraciones sobre BD real, DNS, secretos, borrado de datos y visibilidad del repositorio son solo del propietario, con su frase literal.** Siguiendo A67 no se pide verificación intermedia: esta lista es para la **única** pasada de staging cuando todo esté construido.

## 1. Veredicto

La construcción de Platform admin está **integrada en `main`**. Para datos reales siguen faltando acciones que solo puede hacer el propietario y lo que aún no está construido (sección 4). El bloqueo histórico «sin login de personal» está **resuelto en código** (#125, passkeys); falta configurarlo en el servidor real.

## 2. Integrado en `main` (verificado en GitHub)

- **Acceso y permisos:** login de personal con passkeys (#125, migración 0054), turnos y horario del centro (#124), perfiles por permiso.
- **Operación:** menú en 4 grupos (#131), Resumen ampliado (#134), Agenda y detalle de sesión (#140), acciones rápidas (#139), Contratos (#136), Promociones visible sin efecto en precios (#137), Mensajes (#145), búsqueda global con atajos (#146).
- **Dinero:** Caja con dos registros físicos y pantalla propia (#129, #150), Informes con KPIs, gráficos y Excel multihoja (#147), **facturas y tickets PDF con logo, numeración sin huecos y rectificativas** (#154, migración 0061).
- **Gestión del propietario:** Panel de gestión (#143), Monitorización de solo lectura (#144), datos de Mi gimnasio y consentimientos (#132, migración 0059).
- **Clientes:** documentos privados (#138, migración 0057) y su pestaña, **importación de TIMP**: vista previa (#141, 0058) y paso real con confirmación en pantalla (#153, 0060).
- **Staging:** script e instrucciones (#89), seed sintético Admin+Trainer (#142), arreglos (#152).

Numeración de migraciones en `main`: 0054, 0055, 0056, 0057, 0058, 0059, 0060, 0061 — sin huecos ni duplicados; no se reescribe.

## 3. Abierto (no está en `main`)

| PR | Qué es | Nota |
|---|---|---|
| #157, #126, #116 | Home: buzón de mensajes, estado de pago, lista de espera con elegibilidad | Bloque Home. |
| #127 | Staging: refrescar el upstream web de Búnker | Codex; herramienta de staging (nivel 1). |
| #130 | Diseño de invitaciones (H13 / fila 18) | Solo documento: **la pantalla de Invitaciones no está construida**. |
| #149, #148, #135, #133, #128, #123, #100, #98, #46, #9 | Documentación o propuestas | Sin efecto en producción. |

## 4. Qué NO está real todavía ("No conectado")

- **Invitaciones: alta de invitaciones y cuentas Búnker** — la bandeja de revisiones H13 ya abiertas está en `main` (#164, permiso explícito `platform_link_issue`); crear invitaciones, cuentas Búnker y activar acceso queda sin construir (puente bilateral con step-up en Búnker).
- **Evolución** — pestaña de solo lectura en la ficha ya en `main` (#163, exige `training.read`); depende de que Búnker publique los datos (#135).
- **Ajustes:** Centro (#158), Facturación (#154) y umbral de Tienda (#160) se guardan. **Apariencia** (tokens oficiales de 2J, globales) y **Reservas** (reglas por servicio) no tienen escritura propia, por diseño.
- **Textos de consentimiento/privacidad y cuestionarios**: ya se pueden crear, versionar y publicar desde Mi gimnasio (#162), pero nacen vacíos (A65) y **no se puede pedir un consentimiento hasta que el propietario publique uno**. Salud (D33): fuera del producto.
- **Multiárea** de «Entrenamiento personal», umbrales de atención/adherencia y motivos de atención: sin construir (faltan definiciones).

## 5. Decisiones tomadas por defecto (A67: sin preguntar)

- Facturación: se sigue **A66** (la más reciente) frente a A63; si el propietario no quiere emisión, basta con no rellenar Configuración → Facturación (sin datos no se emite).
- Agenda: rejilla horaria. App: arranca vacía; la carga masiva es la importación de TIMP.
- Importación: solo con perfil de administración, activada por variable de entorno y apagable tras usarla.

## 6. Lista para el día de la salida (todo del propietario, con frase literal)

- [ ] Login de personal real configurado en el servidor (passkeys); Basic Auth y `LOCAL_DEMO_ROLE` fuera.
- [ ] **Identidad del propietario (obligatoria):** definir `PLATFORM_OWNER_PERSON_ID` (UUID de su persona en Platform, para sesión passkey) o `PLATFORM_OWNER_ACTOR_ID` (sujeto de identidad de confianza). Sin una de las dos nadie recibe `owner.panel.read` ni `platform_link_issue`: el Panel de gestión y la bandeja de Invitaciones saldrán «sin permiso».
- [ ] `PLATFORM_LINK_ISSUERS` **solo si se usa**: lista separada por comas de `personId` UUID estables (nunca correos ni nombres) de quienes además del propietario pueden resolver revisiones H13. Un valor que no sea UUID **impide arrancar la API** (intencionado). Vacía = solo el propietario.
- [ ] Copia de seguridad restaurable probada y retención definida.
- [ ] Migraciones **0054 a 0061 en orden** sobre la base real.
- [ ] `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true` solo durante la importación; después, apagar el segundo.
- [ ] Configuración → Facturación rellenada (emisor, NIF, dirección, serie, IGIC, pie, logo); factura de prueba emitida y rectificada **en staging**.
- [ ] Texto de privacidad y consentimientos publicado antes de pedirlos a ningún socio.
- [ ] Importación de TIMP: subir el `.xls`, revisar y confirmar; comprobar recuentos (activos = última reserva en 365 días; inactivos archivados; sin deuda; fichas incompletas marcadas).
- [ ] Secretos (llaves de servicio Home↔Platform↔Búnker, almacenamiento privado `OBJECT_STORAGE_DIR`) generados en el servidor; ninguno en Git ni en logs.
- [ ] DNS, certificados, Home y Búnker apuntando a la API correcta.
- [ ] Monitorización en verde y alerta externa de disponibilidad.
- [ ] Vuelta atrás: `rollback` del script revierte código, **no** la base; la base se restaura desde copia.

## 7. Pasada única de staging (cuando A67 diga que todo está construido)

Con `sudo 2j-staging deploy && sudo 2j-staging seed && sudo 2j-staging selftest`: Resumen, Agenda, Clientes y ficha (Documentos, Pagos, Factura), Caja (abrir, cobrar, cerrar), Informes (Excel), Configuración → Facturación, Importar clientes (archivo sintético), Panel de gestión, Monitorización. **En staging: NO VERIFICADO** hasta esa pasada.
