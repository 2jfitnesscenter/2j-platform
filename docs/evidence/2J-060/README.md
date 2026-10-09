# 2J-060 — evidencia de interfaz

La pantalla añadida es la bandeja de Comunicación, con conversación compartida, mensajes al cliente, notas internas separadas, estados de carga/error/vacío, lectura y marcado manual como no leído. Clientes 360 incorpora los contadores documentales, mensajes y seguimiento.

## Responsive

Se incluye una captura real de la bandeja a 1440 px: [communications-1440.png](./communications-1440.png). Muestra una ejecución local con datos de prueba, estado listo y ninguna conversación seleccionada. No se guardaron capturas a 768 ni 390 px; la inspección responsive en navegador queda pendiente para QA independiente. No se presentan renders estáticos como capturas reales.

La hoja de estilos contiene breakpoints para tablet y móvil; los tests de Admin Web verifican estados, acciones accesibles y renderizado funcional, y el build de Vite comprueba el bundle. La inspección visual en navegador a esos tres anchos queda como QA independiente previo al merge.

## Límites visibles de producto

- La interfaz Admin implementa la bandeja y el acceso a los paneles de Clientes 360.
- La configuración/versionado de formularios, consentimientos, requisitos documentales y asignación de check-ins se ofrece mediante API autenticada; no hay todavía un constructor visual de formularios ni flujos de aceptación del cliente dentro de Admin Web.
- No se habilitan adjuntos porque aún no existe almacenamiento de objetos seguro configurado.
