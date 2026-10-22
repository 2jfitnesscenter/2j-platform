# 2J-HOME-VISUAL-UNIFICATION — Handoff

## Estado

- Repositorio: `2jfitnesscenter/2j-platform`
- Rama: `agent/codex/2J-HOME-VISUAL-UNIFICATION`
- Base funcional: `0987639f212402e987c20a049aacdfca3a73bd17` (`2j-home-004`)
- Commit de implementación: `88b7163f1b9330bb5d98ee99c64e61d1a10e4f95`
- Referencia visual Expo revisada: `880fb9db03c17466cd8edc1dae1926a3ac8517c5` (`2j-mobile`)
- No hay integración real, despliegue, cambios en Caddy/DNS/Contabo, Platform, Búnker ni bases de datos.

## Implementado

- La capa visual de `apps/client-app` ahora usa el tema grafito/lima de Expo: fondo `#151719`, superficies carbón, acento `#A4D65E`, texto sobre lima `#151719`, bordes translúcidos, brillos suaves y superficies de cristal con desenfoque.
- Los tokens se limitan a `.client-app.hub-theme`; los tokens compartidos de `admin-web` y `staff-app` no se cambiaron.
- Se conserva navegación y contenido de Inicio, Búnker, Tienda, Perfil y Ajustes. Se mantienen Noticias, calendario y reserva sintética, compras informativas, perfil, notificaciones y opciones Sistema/Claro/Oscuro. No se añadió lógica de negocio ni se cambió ningún contrato API.
- Se ajustó el encabezado para evitar desplazamiento horizontal a 375–430 px y se corrigió el texto de la opción Oscuro («Grafito y acentos lima»).
- Se añadió una regresión de CSS para paleta, cristal, cinco columnas, responsive y aislamiento visual del cliente.
- Se mantiene el sello `DEMO · DATOS FICTICIOS`. La compilación sintética conserva su protección de no llamar APIs y mantiene Búnker desactivado.

## Marca y tipografía

- No se encontró en el PWA ni en la referencia Expo un archivo de logotipo registrado verificable. El `icon.svg` del PWA no coincide con un archivo oficial aportado por el propietario y los iconos de Expo son marcadores de Emergent. No se modificaron esos assets ni se creó un sustituto; la aprobación del logo requiere el archivo oficial.
- No hay una fuente Montserrat local. La capa visual prioriza `Montserrat` y mantiene Inter/sistema como fallback sin descargar recursos externos.

## Evidencia visual

Capturas reales del PWA local en `C:\Users\juanj\Documents\Codex\2026-10-22\home-visual-unification-review`:

- `inicio-mobile-390x844.png`
- `reservas-mobile-390x844.png`
- `bunker-mobile-390x844.png`
- `tienda-mobile-390x844.png`
- `perfil-mobile-390x844.png`
- `ajustes-mobile-390x844.png`
- `inicio-desktop-1440x1000.png`

La vista se abrió desde Chromium aislado contra `http://127.0.0.1:4187/`; no se usó la web pública para las capturas. Responsive comprobado a 375×812, 390×844, 412×915 y 1440×1000. El tema Claro también se revisó a 390×844: conserva el acento `#A4D65E`, texto oscuro legible y no desborda. No se simula aquí un dispositivo físico.

## Validación

- Tests `@2j/client-app`: **15/15**.
- TypeScript: **correcto**.
- Build web de producción: **correcto**.
- `build:demo`: **correcto**.
- Compose `config --quiet`: **correcto**.
- Docker: imagen local `2j-home-visual-unification:0987639`, digest `sha256:f43ea866dcb06b222c0d0db43dc7eb2710ce0eb22794f21f6df32eeeed2a6024`.
- Nginx `-t`: **correcto**. Smoke local en contenedor temporal: raíz y bundle **200**, marca sintética presente; `/api`, `/api/me`, `/pilot`, `/pilot/member/login`, `/auth/login`, `/payments` y `/bookings`: **404**. El contenedor temporal se detuvo y retiró.
- Navegador: cinco destinos funcionales, Búnker desactivado y cero llamadas `fetch` durante el recorrido.
- `admin-web`, `staff-app`, reglas de negocio y API: sin cambios.
- No se ejecutó lint: el proyecto no define una tarea de lint.
- No se corrieron suites API/DB; el alcance es visual y no hubo cambios en ellas.

## Siguiente paso

Revisión visual del propietario con las capturas adjuntas; solicitar el logo registrado y, si se desea, Montserrat en formato aprobado. Después se puede preparar un nuevo candidato de publicación, conservando rollback. Este trabajo no publica en `home.2jfitnesscenter.com`.
