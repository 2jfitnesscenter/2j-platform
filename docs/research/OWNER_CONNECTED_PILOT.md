# Prueba conectada de reservas — guía del propietario

Esta guía usa solo el entorno de revisión local y datos sintéticos. Al iniciar `pnpm owner:review`, las aplicaciones de Miembro, Trainer y Admin apuntan a la misma base PostgreSQL local. No uses estas instrucciones en una web pública ni introduzcas información real.

## Entrar como Miembro

1. Abre la dirección `MEMBER · Inicio / Reservar` que imprime el lanzador.
2. Inicia sesión con **María González** usando el código local **`2j-member-a-local`**.
3. En **Inicio**, comprueba que aparece su próxima reserva sintética. La ficha de prueba está en **Perfil**.

## Completar el recorrido conectado

1. En la navegación inferior, abre **Reservar**.
2. Elige un servicio, una fecha y una sesión concreta disponible. La selección es manual; no se apuntan sesiones futuras automáticamente.
3. Revisa el resumen y confirma la reserva explícitamente.
4. Vuelve a **Inicio**. Actualiza la pantalla si fuera necesario y comprueba la próxima reserva.
5. Abre **Admin · Agenda** o **Trainer · Agenda**, ambos conectados a la misma base.
6. Busca la sesión que acabas de elegir y ábrela. María debe aparecer en su lista de reservas.
7. Desde el detalle, marca la asistencia o cancela la reserva si quieres probar la otra acción.
8. Regresa a la app de Miembro y actualiza Inicio o **Reservar → Próximas reservas**. Debe verse el estado canónico actualizado.

## Revisar otras pantallas

- **Admin:** Resumen, Clientes, ficha de María, Agenda, Tienda y Espacios y servicios. El lanzador imprime enlaces directos; la ficha de María puede abrirse con `?clientId=`.
- **Trainer:** Resumen, Clientes, Agenda y Espacios y servicios. Los precios comerciales y las áreas restringidas siguen sometidos a los permisos existentes.
- **Miembro:** Tienda, Perfil, Búnker y Ajustes se abren desde las pestañas de la propia aplicación. Sus estados son los que ya ofrece el producto; no se presentan funciones incompletas como terminadas.
- En Agenda, las sesiones del día sintético incluyen varias clases en paralelo de profesionales/espacios distintos, sesiones llenas y una lista de espera para probar la lectura visual.

## Asignación de cuota y pago

Se puede inspeccionar desde **Admin → Clientes → ficha de María → Cuotas** usando el catálogo sintético. La cuota y el pago usan el modelo económico actual, que conserva periodo de inicio/fin y vencimiento explícitos. Esta guía no atribuye mensualidad natural, día de gracia ni suspensión automática a esos campos; esa política requiere la decisión de dominio y la migración propuestas en el handoff.

## Cerrar el entorno

Cuando termines, ejecuta `pnpm owner:review:stop`. Detiene solo los procesos del entorno local de revisión; conserva la base sintética para la siguiente sesión. El código de María es una credencial local de demostración, no una contraseña de producción.
