# PILOT-02 — Guion de prueba manual (Clientes y Cliente 360)

Para Juanjo. No hace falta conocer el código. Todo es datos sintéticos del piloto local; no es producción.

## 0. Antes de empezar

1. Abre PowerShell en el worktree `C:\Users\juanj\Dev\2J\worktrees\claude\platform\2J-DESIGN-V2-PILOT-02` y ejecuta `pnpm owner:review` (necesita Docker Desktop). Si ya está arrancado, no hace falta.
2. Si una pantalla sale **en blanco**: `pnpm owner:review:stop` y vuelve a ejecutar `pnpm owner:review` (es un fallo de caché de Vite en Windows, no de la aplicación).
3. URLs (los puertos exactos salen al terminar el comando):
   - **Admin:** http://127.0.0.1:5174/#clients
   - **Trainer:** http://127.0.0.1:5175/#clients
   - Member (sin cambios en este piloto): http://127.0.0.1:5173

Datos útiles del piloto: **María González** y **Mateo Cruz** tienen un *Bono piloto · 12 sesiones* activo y una reserva; **Diego Suárez** está en lista de espera; **Álvaro Martín** tiene 2 reservas; el resto no tiene plan.

## A. Admin — lista de Clientes

1. Abre la URL de **Admin**. En el menú lateral verás **Clientes** marcado (barra verde).
2. Comprueba la cabecera: título **Clientes** y, arriba a la derecha, el botón verde **Nuevo cliente**.
3. Escribe **«mar»** en *Buscar por nombre*. Tras una pausa breve la lista se reduce (María…). Pulsa la **✕** del buscador: vuelve la lista completa.
4. Escribe **«zzz»**: aparece *Sin resultados*. Límpialo con la ✕.
5. Pulsa **Archivados** (a la derecha del buscador): aparece *No hay clientes archivados*. Vuelve a **Activos**.
6. Comprueba que cada fila muestra iniciales, nombre y «Cliente desde…», sin botones repetidos.

## B. Admin — abrir un Cliente 360

7. Pulsa **María González**. Se abre una **página** (no un panel lateral): botón **← Todos los clientes**, avatar, nombre, «Cliente desde…» y el chip **Plan activo**.
8. A la derecha de la cabecera hay tres acciones con peso distinto: **Añadir cuota** (verde, principal), **Editar datos** (secundaria) y **Archivar** (borde rojo, destructiva).
9. Debajo, tres datos reales: **Próxima reserva**, **Sesiones disponibles** (12) y **Pago** (Al día).
10. Mira las pestañas: **Resumen · Reservas · Plan y sesiones · Pagos · Documentos · Mensajes · Seguimiento · Historial**. En *Resumen* ves *Próximas reservas*, *Plan actual* y *Actividad reciente*.
11. Pulsa **Reservas**: lista con servicio, fecha (hora de Canarias), sala y el estado como etiqueta (p. ej. *Reservada*).
12. Pulsa **Plan y sesiones**: tarjeta del bono con estado *Activa*, vigencia, «12 sesiones · 12 restantes» y acciones: **Renovar**, **Cambiar plan**, **Pausar**, **Ajustar saldo**, **Ver movimientos** y **Cancelar** (rojo, la última).
13. Pulsa **Ver movimientos**: se abre una ventana con el historial; ciérrala.
14. Pulsa **Pagos**: *Saldo pendiente*, *Cargos vencidos*, *Cargos recientes* con etiquetas **Pendiente / Vencido / Pagado** y *Movimientos recientes*. No hay ningún estado «Planificado».
15. Pulsa **Historial** y comprueba que la URL del navegador ahora acaba en `&tab=history`. **Recarga la página (F5)**: sigues en Historial, en el mismo cliente.
16. Pulsa **← Todos los clientes** (o el botón Atrás del navegador): vuelves a la lista con tu búsqueda y filtro intactos.

## C. Admin — acciones (sin riesgo)

17. En María González pulsa **Editar datos**: se abre el formulario; cambia el apellido y **Cancelar** (no se guarda nada).
18. Pulsa **Añadir cuota**: se abre la venta; el plan viene elegido; comprueba precio, fechas y «Asignar y dejar pendiente». **Cancelar**.
19. En *Plan y sesiones* pulsa **Cancelar** (plan): la ventana avisa de que *la cuota dejará de estar activa desde hoy*, exige un **motivo** y su botón rojo **Confirmar cancelación** está desactivado hasta escribirlo. **No confirmes**; pulsa *Cerrar*.
20. (Opcional, modifica datos de prueba) En **Clientes → Nuevo cliente** crea «Prueba Piloto». Se abre su ficha: **Sin plan**. Pulsa **Archivar** → ventana de confirmación *¿Archivar este cliente?* → **Archivar cliente**. Aparece el aviso verde, el chip **Archivado** y ya no hay *Añadir cuota* ni *Archivar*. En la lista, filtro **Archivados**, aparece.

### Caso de venta de plan recurrente (re-test)

18b. En **Lucía Díaz** (sin plan) pulsa **Añadir cuota** → elige el plan **3 dias** → el precio sale **50.00** y **no** aparece «Motivo del ajuste de precio». Verás una nota gris sobre la duración legacy. Pulsa **Asignar y dejar pendiente**: se guarda sin pedir motivo. Si cambias el precio a 45,00 el motivo aparece y es obligatorio; si lo devuelves a 50,00 desaparece. Tras asignar, el plan aparece en *Plan y sesiones* **sin cifra de sesiones** (este plan legacy solo da acceso): es lo esperado hasta 2J-098E.

## D. Admin — atención y otros estados

21. Abre **Diego Suárez** → pestaña **Resumen**: tarjeta **Requiere atención** con «En lista de espera · 1». Solo aparece cuando hay una señal real.
22. Abre **Sara Gil** (sin plan): chip **Sin plan**, *Plan actual* dice «Este cliente aún no tiene una cuota activa», sin tarjetas vacías ni datos inventados.

## E. Trainer

23. Abre la URL de **Trainer** (http://127.0.0.1:5175/#clients). El menú lateral **no** tiene *Negocio* (Economía, Tienda, Noticias, Ajustes).
24. No hay botón **Nuevo cliente**. Abre **María González**.
25. En la cabecera **no** hay *Añadir cuota*, *Editar datos* ni *Archivar*. Ves *Próxima reserva* y *Sesiones disponibles*, pero **no hay dato de Pago**.
26. Las pestañas son **Resumen · Reservas · Plan y sesiones · Documentos · Mensajes · Seguimiento · Historial**: **no hay Pagos**.
27. En *Plan y sesiones* no aparece el importe ni *Renovar / Pausar / Ajustar saldo / Cancelar*; sí **Ver movimientos** (lectura).
28. Copia la URL de la ficha de María en el Trainer y añade `&tab=payments` al final (…`#clients?clientId=…&tab=payments`). La pestaña Pagos no existe para el Trainer: la ficha se abre en *Resumen*.

## F. Responsive (cualquier rol)

29. Reduce la ventana (o usa las herramientas del navegador) a **1024 px**: la barra lateral pasa a iconos; la lista y la ficha siguen igual de usables.
30. A **768 px**: la barra pasa a menú **☰**; la cabecera del cliente y las pestañas se ajustan, las pestañas se desplazan en horizontal.
31. A **390 px**: botones de la cabecera a ancho completo, datos clave en dos columnas, ventanas emergentes como panel inferior. No hay scroll horizontal de página. (Esto es operación básica: la app móvil profesional sigue siendo `staff-app`.)

## Qué anotar

Para cada punto: ✔ funciona / ✘ falla / comentario visual (radio, densidad, color, jerarquía). Marca aparte si **te gusta cómo se ve** y si **funciona como esperas**: ese veredicto es tuyo (`VISUAL_APPROVED` y `FUNCTIONAL_APPROVED` siguen en `no`).
