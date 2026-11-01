# Plan de prueba del propietario — staging (una página)

**Antes:** `sudo 2j-staging deploy && sudo 2j-staging seed --target-host 2jfit.com && sudo 2j-staging selftest` debe acabar en `RESULTADO: TODO OK`. Entra en `admin.2jfit.com` (usuario `staging`, contraseña en `/opt/2j/secrets/basic-auth.txt`). Todo son datos de prueba: puedes pulsar sin miedo. Si algo no pasa como se indica, apunta la pantalla y el paso. **Todo error debe decir qué ha pasado y qué hacer**; si ves «No se pudo completar» a secas, anótalo como fallo.

| # | Pantalla | Qué hacer | Qué debe pasar |
|---|---|---|---|
| 1 | **Resumen** | Abre el menú → Resumen. | 12 clientes activos, cargos vencidos 49,00 €, 1 mensaje sin leer, sesiones de hoy y «Requiere atención». Sin pantallas en blanco. |
| 2 | Resumen → **Nuevo cliente** | Pulsa, escribe nombre y apellidos, guarda. | El cliente aparece en Clientes. |
| 3 | Resumen → **Crear reserva** | Pulsa. | Abre Agenda con «Elige una sesión…»; la reserva se hace dentro de la sesión. |
| 4 | Resumen → **Fichar entrada/salida** | Pulsa y ficha la **entrada**. | «Entrada registrada» en Fichaje. (Sin entrada no se abre ni se cierra caja: te avisa y ofrece «Fichar entrada ahora».) |
| 5 | Resumen → **Abrir caja** | Elige Búnker; cuenta cada casilla (0 donde no haya; el total se ve en vivo), marca «Confirmo…». | «Caja abierta». En Caja ves «1 abiertas». |
| 6 | Resumen → **Cobrar** | En el cargo *María González · Cuota mensual · demo*: «Registrar pago» → Tarjeta → Confirmar. | «Pago registrado»; el cargo pasa a Pagado y aparece **Factura**. |
| 7 | **Resumen** (vuelve) | Vuelve a Resumen. | Se refresca solo: pendiente 0,00 € y el cobro en «Últimos movimientos». |
| 8 | Resumen → **Nueva venta** | Pulsa, busca *Hugo Vega* y elígelo; en Productos añade *Camiseta 2J*; Cobrar → método **Bizum** → Confirmar. | «Venta registrada». Es la misma ventana que en la ficha, sin cambiar de pantalla. |
| 9 | Resumen → **Vender** | Elige *Camiseta 2J*, añade, Pagado en el centro → Efectivo. | La venta aparece en Tienda → Ventas y baja el stock. |
| 10 | Resumen → **Cerrar caja** | Cuenta todas las casillas (a ciegas: no ves lo esperado) y confirma. | «Caja cerrada». Sin caja abierta: «No tienes una caja abierta a tu nombre». |
| 11 | **Fichaje** | Ficha la **salida**; pulsa salida otra vez. | Salida registrada **aunque haya una caja sin cerrar** (la caja no impide fichar). La segunda vez dice que no tienes entrada fichada y qué hacer. Una caja de ayer sin cerrar se avisa en Caja, sin bloquear. |
| 12 | **Clientes → ficha de Mateo Cruz** | Mira la cabecera: **Nueva venta**, **Registrar pago** (solo con cargo pendiente) y el menú **Acciones**. | Acciones: Reservar clase, Enviar mensaje, Subir documento, Emitir factura (desactivada sin cobro pagado), Editar datos, Archivar. Cada una abre su pantalla o diálogo. |
| 13 | Ficha → pestaña **Resumen** | Mira «Saldo de cuota» y «Calendario del mes». | Contador de sesiones con barra y las reservas del mes por día. En una cuota mensual recurrente, el interruptor de renovación automática está en la tarjeta de la cuota («Plan y sesiones»). |
| 14 | Ficha → **Enviar mensaje** | *Hugo Vega* → «Escribir mensaje»; escribe «Hola Hugo» y envía. | «Mensaje enviado. El cliente lo verá en su app». Hugo aparece en Mensajes. |
| 15 | **Mensajes** | Abre a *María González* (1 sin leer). | Ves su mensaje; al abrir se marca leído. Una nota interna dice «solo equipo». |
| 16 | Home del socio | En `home.2jfit.com` entra como *María González* (código `2j-member-a-local`). | Ve tu mensaje. Sus facturas en Perfil solo si Home está desplegado con #170. |
| 17 | **Configuración → Facturación** | Rellena emisor, NIF ficticio, dirección y serie; guarda. | «Datos de facturación guardados» y «Listo para emitir». |
| 18 | Economía → **Factura** | En el cobro de María: Emitir factura → Descargar; luego Rectificar con motivo. | PDF con número correlativo; la rectificativa lo referencia. Si faltan datos del cliente, dice cuáles. |
| 19 | **Informes** | Abre Informes → Descargar Excel. | KPIs y gráficos con datos; el Excel tiene varias hojas. El cobro Bizum sale como «Bizum». |
| 20 | **Mi gimnasio** | Datos del negocio; Cuestionarios y consentimientos: crea y publica un consentimiento. | Datos del negocio sin textos de «No conectado»; el consentimiento queda publicado (antes, vacío). |
| 21 | **Panel de gestión**, **Monitorización** | Ábrelos (solo lectura). | Datos sin errores. Si dicen «sin permiso», falta la variable del propietario. |
| 22 | **Invitaciones** | Emite un código temporal de incorporación. | Aparece **una sola vez**; la bandeja de revisiones H13 está vacía en staging. |
| 23 | **Importar clientes** | Sube un archivo sintético y revisa la vista previa. | Recuentos y avisos; **no confirmes** salvo con datos falsos. |

**Cómo decirme el resultado:** una línea por fila: `#6 OK` o `#6 FALLA: lo que ves`. Lo marcado «No conectado» en pantalla es esperado: descuentos de producto, IGIC por línea y notas en factura (sin API todavía), y los mensajes por email o WhatsApp.
