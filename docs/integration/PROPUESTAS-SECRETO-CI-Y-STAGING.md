# Dos propuestas para aprobar (nada de esto está creado)

Fecha: 2026-10-23. Autor: integrador. **No he creado ningún secreto, servidor, dominio ni DNS.** Cada propuesta espera el «sí» explícito del propietario.

## 1. Secreto de CI entre repositorios (aprobado con límites; aquí el detalle exacto)

Para qué: que el E2E de Home + Platform + Búnker corra en CI de `2j-platform` y pueda hacer checkout del código de Búnker.

| Campo | Propuesta |
|---|---|
| Tipo | **Fine-grained personal access token** de GitHub |
| Lo crea | El propietario, en GitHub → Settings → Developer settings → Fine-grained tokens (yo no creo ni veo tokens) |
| Resource owner | Organización `2jfitnesscenter` |
| Repositorios | **Uno solo**: `2jfitnesscenter/2jfitnessapp` («Only select repositories») |
| Permisos | **Contents: Read-only** (Metadata: Read, implícito). Nada más: sin write, sin Actions, sin Pull requests, sin Secrets |
| Caducidad | **90 días** (fecha concreta en el momento de crearlo; recordatorio de renovación 10 días antes). Nunca «sin caducidad» |
| Dónde se guarda | **Repository secret** `BUNKER_REPO_READ_TOKEN` en `2jfitnesscenter/2j-platform` → Settings → Secrets and variables → Actions. No de organización, no en código, no en variables, no en `.env` |
| Uso | Solo el workflow `e2e` y solo en `pull_request` de ramas del propio repositorio (nunca de forks); `actions/checkout` con `token:` y `persist-credentials: false`; el token no se imprime ni se pasa a procesos hijos |
| Si se filtra | Revocar el token en GitHub (efecto inmediato); el daño máximo es la lectura del código de Búnker |
| Alternativa descartada | Deploy key de solo lectura: mismo alcance mínimo, pero **no caduca**, por eso no cumple la condición |
| Límite conocido | Un PAT depende de la cuenta que lo crea; si esa persona deja la organización el token deja de funcionar (a largo plazo, GitHub App) |
| Aviso | Si la organización exige aprobación de tokens fine-grained, hay que aprobarlo en Settings de la organización |

Mientras no exista, el E2E sigue corriendo en local (16 + 9 casos) y no se añade ningún workflow que lo necesite.

## 2. Staging: una propuesta concreta

Objetivo: probar Home + Platform + Búnker reales (SSO, push, dispositivos) **sin datos ni secretos de producción**.

| Campo | Propuesta |
|---|---|
| Dónde | **Un VPS aparte** (no el de producción), mismo proveedor que hoy (Contabo): **Cloud VPS 10** (≈ 3–4 vCPU, 8 GB RAM, 75 GB NVMe), Docker Compose, Caddy para TLS automático |
| Coste mensual | **≈ 4,40 €/mes el primer periodo y ≈ 5,50 €/mes en renovación**, más impuestos (precios de web de terceros, **sin verificar en contabo.com**; la fuente más reciente es de semana 25 de 2026). Cuota de alta ≈ 0–5 € según promoción |
| Dominio | **Opción A (recomendada): dominio propio solo para staging** (≈ 10–15 €/año, precio por verificar), con `home.`, `app.` y `admin.` bajo él. **Opción B (0 €):** subdominios `stg-home.`, `stg-app.`, `stg-admin.` bajo el dominio actual |
| Por qué recomiendo A | Con B, un subdominio de pruebas puede fijar cookies para todo el dominio principal (*cookie tossing*) y afectar a producción. Con A no comparten dominio registrable |
| Base de datos | **Aislada**: PostgreSQL 17 en un contenedor del propio VPS, volumen propio, sin puerto público (solo red interna de Docker). Dos bases (`platform`, y datos de Búnker en su carpeta propia). Marcador de entorno `staging` obligatorio al arrancar (diseño en `docs/design/2J-INT-staging-mode.md`) |
| Datos | **Solo sintéticos**: personas de prueba generadas por un script de seed que se niega a ejecutarse sin el marcador de staging. Nunca copia ni restauración de producción |
| Secretos | **Generados nuevos solo para staging** (claves de servicio con identificador `stg-`, secreto de sesión, VAPID de staging cuando se apruebe). Ninguno comparte valor con producción; guardados en el VPS con permisos 600, no en el repositorio |
| Acceso | Basic auth delante de todo (Caddy) + `X-Robots-Tag: noindex` + cortafuegos 80/443/22; SSH solo con clave |
| Flags | Todos **apagados** al inicio; se encienden uno a uno siguiendo `REAL-DEVICE-QA.md` |
| Despliegue | Manual y bajo demanda desde una rama etiquetada; sin despliegue automático desde `main` |
| Qué no hace | No toca el VPS de producción, ni su Caddy, ni su DNS, ni sus datos. No envía correo, push ni cobros reales |
| Plazo | Montarlo ≈ 1 día de trabajo una vez aprobados dominio y VPS; se puede destruir cuando acabe la QA |
| Qué necesito de ti | Elegir A o B; crear (o autorizarme a pedir) el VPS y el registro DNS; confirmar el proveedor |

Fuentes del precio: [PricingSaaS, cambios de semana 25 de 2026](https://pricingsaas.com/companies/contabo/diffs/2026W25), [resumen Q2 2026](https://pricingsaas.com/companies/contabo.main/diffs/2026Q2), [VPS Benchmarks](https://www.vpsbenchmarks.com/hosters/contabo/plans/cloud-vps-10). Confirmar en la web del proveedor antes de contratar.

## 3. Hallazgo que bloquea la sugerencia por correo (D142/A20)

Lo pedido (sugerir vínculos por correo verificado + cola de revisión apilada sobre #64–#67) **no se ha construido**, porque su premisa no se cumple en el código:

- **Búnker no guarda correo de usuario.** `api/server.js` lo dice expresamente («the deliberate alternative to adding real passwords + email back into the app»): los usuarios tienen `id`, `name`, `username` y credenciales passkey; ningún campo `email` ni estado de verificación (comprobado en `origin/main` de `2jfitnessapp` y en #56/#57). La regla A20 («los correos de Búnker sí están verificados») no tiene dónde apoyarse en este repositorio.
- **Platform tampoco modela verificación de correo**: `clients.email` existe, sin estado de verificación (D140 pide estados separados y no está implementado).
- La documentación de Búnker ya prohíbe vincular por correo y solo admite que la coincidencia «guíe al usuario a iniciar prueba».

Opciones (el propietario decide): **(1)** Búnker añade un correo opcional con verificación propia (hace falta un mecanismo de envío que hoy no existe en ningún sistema y contradice la decisión de no tener correo en Búnker); **(2)** los correos verificados viven solo en Platform/Home y el emparejamiento sugiere por **otra señal** acordada (por ejemplo, el miembro inicia el vínculo desde Home y demuestra el control de su cuenta de Búnker con la passkey, que ya está implementado y es lo que usa el flujo bilateral); **(3)** confirmar si la producción de Búnker tiene correos que este código no refleja. Mi recomendación: **(2)** más una cola de revisión manual para los casos que no puedan demostrar control. Hasta que decidas, la cola de revisión por sí sola no tiene casos que la alimenten.
