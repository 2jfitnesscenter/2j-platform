# Plan de prueba del propietario — staging (una página)

**Antes:** `sudo 2j-staging deploy && sudo 2j-staging seed --target-host 2jfit.com && sudo 2j-staging selftest` debe acabar en `RESULTADO: TODO OK`. Entra en `admin.2jfit.com` (usuario `staging`, contraseña en `/opt/2j/secrets/basic-auth.txt`). Todo son datos de prueba: puedes pulsar sin miedo. Si algo no pasa como se indica, apunta la pantalla y el paso.

| # | Pantalla | Qué hacer | Qué debe pasar |
|---|---|---|---|
| 1 | **Resumen** | Abre el menú → Resumen. | Ves 12 clientes activos, cargos vencidos 49,00 €, 1 mensaje sin leer, sesiones de hoy y una lista «Requiere atención». Sin pantallas en blanco. |
| 2 | Resumen → **Nuevo cliente** | Pulsa el botón, escribe nombre y apellidos, guarda. | Se abre el diálogo y el cliente aparece en Clientes. |
| 3 | Resumen → **Crear reserva** | Pulsa el botón. | Abre Agenda con «Elige una sesión…»; la reserva se hace dentro de la sesión. |
| 4 | Resumen → **Asignar cuota** | Pulsa, elige a *Hugo Vega*. | Se abre su ficha con la venta de cuota (si el catálogo tiene un plan activo). |
| 5 | Resumen → **Abrir caja** | Pulsa, elige Búnker, escribe un número en **cada** casilla (0 donde no haya), marca «Confirmo…» y abre. | «Caja abierta». En Caja ves «1 abiertas». |
| 6 | Resumen → **Cobrar** | Pulsa; en el cargo *María González · Cuota mensual · demo* pulsa «Registrar pago» → Tarjeta → Confirmar pago. | «Pago registrado»; el cargo pasa a Pagado y aparece el botón **Factura**. |
| 7 | **Resumen** (vuelve) | Vuelve a Resumen. | Se refresca solo: pendiente de cobro 0,00 € y el cobro en «Últimos movimientos». |
| 8 | Resumen → **Vender** | Pulsa; elige *Camiseta 2J* (18,00 €), añade al pedido, Pagado en el centro → Efectivo. | Se registra la venta y aparece en Tienda → Ventas. |
| 9 | Resumen → **Fichar entrada/salida** | Pulsa. | «Entrada registrada» en Fichaje; vuelve a pulsar para fichar la salida. |
| 10 | Resumen → **Cerrar caja** | Pulsa, cuenta todas las casillas, confirma. | «Caja cerrada». Si no hay caja abierta, avisa «No tienes una caja abierta a tu nombre». |
| 11 | Resumen → **Enviar mensaje** | Pulsa, elige *Hugo Vega*, pestaña Mensajes → «Escribir mensaje». Escribe «Hola Hugo» y envía. | «Mensaje enviado. El cliente lo verá en su app». Hugo aparece en Mensajes. |
| 12 | **Mensajes** | Abre a *María González* (tiene 1 sin leer). | Ves su mensaje; al abrir se marca leído. Prueba una nota interna: dice «solo equipo». |
| 13 | Home del socio | En `home.2jfit.com` entra como socio de prueba (*María González*, código `2j-member-a-local`). | Ve el mensaje que le escribiste. (Facturas en Perfil: solo si está desplegado #170.) |
| 14 | **Configuración → Facturación** | Rellena emisor, NIF ficticio, dirección y serie; guarda. | «Datos de facturación guardados» y «Listo para emitir». |
| 15 | Economía → **Factura** | En el cobro de María: Emitir factura → Descargar. Luego Rectificar con un motivo. | Se descarga un PDF con número correlativo; la rectificativa lo referencia. Si faltan datos del cliente, te dice cuáles. |
| 16 | **Informes** | Abre Informes → Descargar Excel. | KPIs y gráficos con datos; el Excel se abre con varias hojas. |
| 17 | **Clientes → ficha** | Abre *Mateo Cruz*: Documentos, Pagos, Seguimiento. | Cada pestaña carga sin error; el seguimiento muestra su respuesta pendiente de revisar. |
| 18 | **Mi gimnasio** | Datos del negocio → Cuestionarios y consentimientos: crea y publica un consentimiento de prueba. | Se guarda y queda publicado; antes de eso, vacío («nacen vacíos»). |
| 19 | **Panel de gestión**, **Monitorización** | Ábrelos (solo lectura). | Datos sin errores. Si dicen «sin permiso», falta la variable del propietario. |
| 20 | **Invitaciones** | Ábrela. | Bandeja de revisiones (vacía en staging); no «sin permiso». Crear invitaciones **no existe** todavía. |
| 21 | **Importar clientes** | Sube un archivo sintético y revisa la vista previa. | Muestra recuentos y avisos; **no confirmes** salvo que vayas a probar con datos falsos. |

**Cómo decirme el resultado:** una línea por fila: `#6 OK` o `#6 FALLA: lo que ves`. Lo que está marcado «no existe» o «No conectado» en pantalla es esperado, no un fallo.
