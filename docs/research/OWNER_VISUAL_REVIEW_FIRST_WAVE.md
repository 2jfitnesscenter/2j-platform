# Revisión visual del producto profesional 2J

**Estado: OWNER VISUAL ACCEPTANCE: PENDING.** La revisión automatizada y las opiniones de otras personas no sustituyen tu valoración personal.

## Abrir la aplicación

1. Inicia Docker Desktop.
2. Abre PowerShell en la carpeta principal del repositorio `2j-platform`.
3. Ejecuta `pnpm owner:review` y espera a que aparezca “Piloto local 2J listo”.
4. Abre las direcciones de Admin y Trainer que imprime el lanzador. Normalmente son `http://127.0.0.1:5174` y `http://127.0.0.1:5175`. El lanzador indicará otro puerto si alguno está ocupado.
5. Para cerrar las aplicaciones y APIs ejecuta `pnpm owner:review:stop`. La base local sintética se conserva para la siguiente sesión.

El entorno usa PostgreSQL 17 local en Docker, separado en el puerto `55441` y ligado solo a `127.0.0.1`. Aplica las migraciones y prepara ejemplos ficticios automáticamente. Esta variante conserva intacta cualquier base del piloto anterior, incluso si tiene una versión de migración antigua. No introduzcas datos reales.

Necesitas Node 24, pnpm 10.34.6 o compatible y Docker Desktop iniciado. La primera ejecución puede instalar las dependencias bloqueadas del proyecto.

## Cómo distinguir Admin y Trainer

- **Admin**: abre la dirección Admin. El permiso se decide en el servidor para el perfil local `admin`.
- **Trainer**: abre la dirección Trainer. Es otra copia del shell profesional que usa el perfil local `trainer`; no hace falta editar archivos ni reiniciar servicios.
- Para volver a Admin, cambia a la dirección Admin. Las dos vistas pueden permanecer abiertas a la vez.

La vista Trainer no incluye Economía, precios ni la gestión comercial de cuotas y planes. Solo enseña los datos permitidos a ese perfil. Este atajo local no es autenticación real ni está preparado para producción.

## Orden recomendado de revisión

Usa primero una ventana de escritorio de aproximadamente **1440 × 900**. Recorre estas pantallas en orden y juzga si las distintas partes parecen un mismo producto:

1. Admin — Resumen: `http://127.0.0.1:5174/#home`
2. Admin — Clientes: `http://127.0.0.1:5174/#clients`
3. Admin — Client 360: `http://127.0.0.1:5174/#clients?clientId=d0700000-0000-4000-8000-000000000001`
4. Admin — Agenda semanal: `http://127.0.0.1:5174/#calendar`
5. Admin — Detalle de sesión: en la Agenda, abre la sesión de las **17:00**. Tiene reservas y lista de espera.
6. Admin — Espacios y servicios: `http://127.0.0.1:5174/#services`; usa las pestañas **Espacios**, **Servicios** y **Cuotas y planes**.
7. Trainer — Resumen: `http://127.0.0.1:5175/#home`
8. Trainer — Clientes: `http://127.0.0.1:5175/#clients`
9. Trainer — Client 360: `http://127.0.0.1:5175/#clients?clientId=d0700000-0000-4000-8000-000000000001`
10. Trainer — Agenda: `http://127.0.0.1:5175/#calendar`
11. Trainer — Espacios y servicios: `http://127.0.0.1:5175/#services`; Espacios y Servicios están disponibles, Cuotas y planes y los precios no.

María González es la ficha sintética principal. Tiene reservas, un plan con derechos, un seguimiento pendiente, mensajes y un cargo local de ejemplo. Otras fichas incluyen un seguimiento ya respondido para que puedas comparar estados.

No hace falta probar cada botón. Mira la composición, la jerarquía, la densidad, el lenguaje y la continuidad entre pantallas.

## Claro y oscuro

La aplicación no incorpora un selector de tema para esta revisión. Para probar el tema oscuro, abre las herramientas de desarrollador del navegador, entra en **Consola** y ejecuta:

```js
document.documentElement.dataset.theme = 'dark'
```

Para volver al tema claro, ejecuta:

```js
document.documentElement.removeAttribute('data-theme')
```

Este cambio solo afecta a la pestaña abierta y desaparece al recargarla.

## Revisión en tablet y móvil

Después del escritorio, cambia el tamaño del área visible del navegador a aproximadamente **768 px** de ancho y luego **390 px**. En Chrome puedes abrir las herramientas de desarrollador y activar la barra de dispositivos. No es necesario repetir todas las tareas: comprueba que navegación, listas, ficha y Agenda sigan siendo legibles, que las acciones se puedan tocar y que no aparezca una barra horizontal inesperada.

## Lista de valoración

En cada apartado anota una nota del 1 al 5 y cualquier cambio concreto que harías. La nota 1 significa “no encaja” y 5 “lo dejaría así”.

### A. Shell y navegación

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### B. Resumen

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### C. Clientes

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### D. Cliente 360

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### E. Agenda

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### F. Detalle de sesión

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### G. Espacios y servicios

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### H. Vista Trainer

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

### I. Tablet y móvil

¿Me gusta visualmente? ¿Se entiende rápido? ¿Está demasiado cargado? ¿Falta información? ¿Sobran cosas? ¿Se parece al nivel que quiero de Atlas/TIMP? ¿Cambiaría colores, tamaños o distribución? ¿Me parece premium? ¿Lo usaría un entrenador sin explicación?

**Nota / comentario:**

## Al terminar

Anota qué tres cosas conservarías y qué tres cambiarías primero. La aceptación visual seguirá **pendiente** hasta que Juanjo haga esta revisión y comparta su opinión. Después se agruparán sus observaciones antes de proponer cambios de diseño. No se inicia 2J-098 en esta revisión.
