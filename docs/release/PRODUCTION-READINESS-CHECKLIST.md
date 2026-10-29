# Lista de preparación para producción — Platform (29 oct 2026)

Solo documentación. Escrita por el agente Claude Code de Platform a partir del estado **real** de Git/GitHub a esta fecha. Lo que no se ha podido comprobar se marca `NO VERIFICADO`. Nada de lo de aquí se ha desplegado: **producción, migraciones sobre BD real, DNS, secretos, borrado de datos y visibilidad del repositorio son solo del propietario, con su frase literal.**

## 1. Veredicto corto

Todavía **no** está listo para datos reales. Bloqueos, por orden de gravedad:

| # | Bloqueo | Estado |
|---|---|---|
| B1 | **No hay inicio de sesión del personal en producción.** El admin solo arranca con `LOCAL_DEMO_ROLE` (desarrollo, loopback) y, en staging, con Basic Auth delante. El script de staging lo dice: el día que entren datos de personas reales, la administración debe estar tras autenticación real. El PR de passkeys del personal es **#125** (abierto, **en conflicto con main**, migración 0054). | BLOQUEA |
| B2 | Migraciones pendientes de integrar en orden: 0054 (#125), 0058 (#141), 0059 (#132), 0060 (#153), 0061 (#154). | Pendiente |
| B3 | Ninguna comprobación en staging hecha por este agente tras los últimos lotes. | NO VERIFICADO |
| B4 | Revisión independiente pendiente (nivel 2) de #153 (importación real) y #154 (facturas PDF); #141 y #132 siguen en espera de la suya. | Pendiente |
| B5 | Datos fiscales, texto de privacidad/consentimientos y logo los rellena el propietario en Configuración (A65); mientras estén vacíos no se puede emitir factura. | Acción del propietario |

## 2. Qué está en `main` (verificado en GitHub)

Menú en 4 grupos (#131), Promociones visible sin efecto (#137), Contratos (#136), Resumen ampliado (#134), Panel de gestión y Monitorización del propietario (#143, #144), búsqueda global con atajos (#146), Caja con dos registros físicos y pantalla propia (#129, #150), Mensajes (#145), Informes con pestaña de KPIs y Excel multihoja (#147), documentos privados de cliente (#138), detalle de sesión (#140), acciones rápidas (#139), seed sintético Admin+Trainer (#142), turnos y horario del centro (#124), arreglos de staging (#152).

## 3. Abierto (no está en `main`)

| PR | Qué es | Nivel | Observación |
|---|---|---|---|
| #125 | Login de personal con passkeys | 2 | **Conflicto con main.** Migración 0054. Es B1. |
| #141 | Vista previa de importación TIMP | 2 | Migración 0058. Base de #153. |
| #153 | **Importación real de TIMP** con confirmación en pantalla (A63) | 2 | Migración 0060. Apilado sobre #141: no corre CI hasta que #141 entre y se retargetee a `main`. Validado en local contra Postgres desechable. |
| #132 | Datos de Mi gimnasio y consentimientos (API) | 2 | Migración 0059. |
| #154 | **Facturas y tickets en PDF** (A66) | 2 | Migración 0061. Retira la puerta cerrada de emisión. |
| #126, #116 | Home: estado de pago y lista de espera con elegibilidad | — | Ramas de Codex/Home. |
| #149, #148, #135, #133, #130, #128, #123, #100, #98, #89, #46, #9 | Documentación o propuestas (H13, diseño de invitaciones, cajas, turnos, staging, 2J-098…) | 1 | Sin efecto en producción. |

## 4. Orden de integración recomendado

1. #125 (resolver conflicto) → 0054.
2. #141 → 0058, después retargetear #153 a `main` → 0060.
3. #132 → 0059.
4. #154 → 0061.
5. Tras cada lote: CI (calidad, secret scan y e2e) en verde sobre el head exacto y redeploy de **staging** con datos sintéticos.
La numeración no se reescribe: 0053 (#124) y 0056/0057 (#140/#138) ya están en `main`.

## 5. Decisiones del propietario que condicionan la salida

- **Facturación:** A63 decía «sin facturas»; A65/A66, posteriores, piden facturas y tickets PDF con logo. Este documento sigue la **más reciente (A66)**. Confirma que es lo que quieres: si no, #154 no se fusiona y la app sale sin emisión.
- **Salud y cuestionarios (D33):** excluidos; nada de eso está en el producto.
- **Agenda:** rejilla horaria (A63).
- **App vacía:** sin datos al arrancar; la única vía de carga masiva es la importación de TIMP (#153) por el propietario.
- **Umbrales de atención/adherencia, multiárea de «Entrenamiento personal», Invitaciones y Evolución:** siguen sin construirse (faltan definiciones o contratos con Búnker/Home); no bloquean la salida si se aceptan como fase posterior.

## 6. Lista para el día de la salida (todo reservado al propietario)

- [ ] B1 resuelto: login de personal real en producción; Basic Auth/`LOCAL_DEMO_ROLE` fuera.
- [ ] Copia de seguridad restaurable probada y política de retención definida.
- [ ] Migraciones 0054, 0058, 0059, 0060 y 0061 aplicadas **en ese orden** sobre la base real (frase literal).
- [ ] `CLIENT_IMPORT_PREVIEW_ENABLED=true` y `CLIENT_IMPORT_COMMIT_ENABLED=true` solo durante la importación; después `CLIENT_IMPORT_COMMIT_ENABLED` vuelve a apagarse.
- [ ] Configuración → Facturación rellenada (emisor, NIF, dirección, serie, IGIC, pie, logo) y una factura de prueba emitida y rectificada **fuera de producción**.
- [ ] Texto de privacidad y consentimientos publicado antes de pedirlos a ningún socio.
- [ ] Importación de TIMP: subir el `.xls`, revisar la vista previa, confirmar; comprobar recuentos (activos = última reserva en 365 días; inactivos archivados; sin deuda; fichas incompletas marcadas).
- [ ] Variables y secretos (llaves de servicio Home↔Platform↔Búnker, `OBJECT_STORAGE_DIR` privado) generados en el servidor; ninguno en Git ni en logs.
- [ ] DNS y certificados; Home y Búnker apuntando a la API correcta.
- [ ] Supervisión: pantalla Monitorización en verde y alerta externa de disponibilidad.
- [ ] Plan de vuelta atrás: el script de staging hace `rollback` de código, **no** de base de datos; la base se restaura desde copia.

## 7. Qué se ha probado y cómo

- Cada PR de Claude Code lleva sus pruebas (API contra PostgreSQL descartable y UI con jsdom), todas con datos sintéticos; las de API se ejecutaron en una base nueva por lote.
- Importación real y facturas: probadas en local contra Postgres desechable (no CI todavía en #153).
- **En staging: NO VERIFICADO** por este agente. Antes de la salida hace falta una pasada manual del propietario con el seed sintético (`2j-staging seed`) sobre: Resumen, Agenda, Clientes y ficha (Documentos, Pagos, Factura), Caja (abrir, cobrar, cerrar), Informes (descarga Excel), Configuración → Facturación, Importar clientes (con un archivo sintético) y Monitorización.
