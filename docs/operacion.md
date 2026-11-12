# Operación — Zonas+

Notas para desplegar y operar el sistema. Para arrancar en local, ver el
README; este documento cubre lo que un operador necesita saber.

## Despliegue

### Variables de entorno

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | `mysql://<user>:<pass>@<host>:3306/ecc` | Obligatoria |
| `SESSION_SECRET` | ≥ 32 caracteres | El arranque muere si es más corta (`src/config/env.ts`). Deriva el token CSRF: rotarla invalida las sesiones activas |
| `NODE_ENV` | `development` / `production` | Cambia el flag `Secure` de la cookie (ver abajo) |
| `PORT` | 3000 por defecto | |
| `TZ` | `America/Bogota` | Obligatoria, ver abajo |

### Zona horaria (requisito, no opción)

`TZ=America/Bogota` debe estar fijada en el contenedor/proceso y en el
servidor MariaDB (ya viene así en `docker-compose.yml`, recreando el
contenedor si se cambia). Las fechas de bloque (`fecha`, `hora_inicio`,
`hora_fin`) se interpretan en hora local de Bogotá y toda marca de auditoría
se escribe en UTC explícito (`UTC_TIMESTAMP(3)`). Un `TZ` distinto produce un
skew de horas en expiración de sesiones, vencidas y recordatorios; la propia
suite lo bloquea (`tests/tz-guard.test.ts`). Si el contenedor MariaDB ya
estaba creado sin `TZ`, hay que recrearlo (`docker compose up -d --force-recreate mariadb`).

### Cookies seguras y `NODE_ENV`

La cookie de sesión lleva `Secure` solo con `NODE_ENV=production`. Si la
URL pública termina en TLS en el host, use `NODE_ENV=production`; en caso
contrario el navegador no enviará la cookie y el login no funcionará. La
especificación considera la URL pública opcional: sin TLS público, mantenga
`NODE_ENV=development` o `production` solo detrás de TLS.

### Proxy inverso (topología soportada: proceso directo / TLS en el host)

La topología soportada por defecto es el proceso escuchando directamente (o
TLS terminado en el host sobre él). **Detrás de un proxy inverso (nginx,
ALB, Caddy) es obligatorio** añadir `app.set('trust proxy', ...)` con el
número de saltos correcto (p. ej. `1`) antes de montar los middlewares de
límites de peticiones. Qué ocurre en cada escenario, según la versión
instalada de `express-rate-limit`:

- **`trust proxy` desactivado (el valor por defecto) con un proxy que añade
  `X-Forwarded-For`:** cada petición que traiga ese encabezado falla con un
  error de validación visible (HTTP 500 con código de error de la librería),
  no un bloqueo silencioso. El servidor deja de responder al login en cuanto
  el proxy manda la cabecera: es ruidoso y se detecta al momento.
- **`trust proxy = true`:** error de validación distinto, de evasión/suplantación:
  con `true` cualquiera puede poner un `X-Forwarded-For` falso y saltarse el
  límite por IP. No es una opción segura; use siempre un número de saltos.
- **`trust proxy` con número de saltos (la config correcta, p. ej. `1`):**
  no se dispara ningún error de validación. Aquí es donde el fallo es
  **silencioso**: si el proxy no rellena realmente `X-Forwarded-For`, o si el
  número de saltos no coincide con la topología real, todas las peticiones
  comparten la IP del proxy y los límites de `/login` (10/15 min) y
  `/recuperar` (5/15 min) terminan bloqueando el despliegue **completo** tras
  unos pocos intentos de un solo usuario.

Verifique en el proxy que efectivamente reescribe `X-Forwarded-For` y ajuste
el número de saltos al conteo real de capas entre el cliente y el proceso.

### Base de datos

- MariaDB 11, InnoDB, `utf8mb4_unicode_ci` (`docker-compose.yml` incluye
  healthcheck y volumen `ecc-datos`).
- Migraciones: `npm run migrate` es idempotente (tabla `MIGRACIONES`);
  ejecutela en cada despliegue antes de iniciar la app.
- Seed demo: `npm run seed` (datos de prueba; en una instalación real puede
  omitirse o limpiarse después).
- Para correr la suite de pruebas local/CI se necesita MariaDB arriba:
  `docker compose up -d mariadb` antes de `npm test` (cada corrida crea y
  destruye su base `ecc_test_<pid>` con el usuario de `DATABASE_URL`).

## Jobs y despachador (node-cron dentro del proceso)

Todo corre en el mismo proceso de la app (`src/jobs/index.ts`,
`src/modules/notificaciones/dispatcher.ts`); no hay cron externo. Con
`NODE_ENV=test` son no-op.

| Trabajo | Frecuencia | Qué hace |
|---|---|---|
| `marcarVencidas` | cada 15 min | CONFIRMADA cuyo bloque ya pasó → `VENCIDA` (no devuelve cupos, cuenta como uso) |
| `crearRecordatorios` | cada 5 min | Notificaciones RECORDATORIO de reservas próximas |
| Despachador CORREO y PUSH | cada 1 min por canal, `noOverlap` | Drena hasta 50 `ENVIO_NOTIFICACION` pendientes por pasada con `FOR UPDATE SKIP LOCKED` |
| Limpieza | diario 03:00 hora Bogotá | Sesiones expiradas y bitácora antigua |

Implicaciones operativas:

- **Semántica at-least-once** del despachador: si la pasada aborta a mitad,
  los envíos ya hechos se revierten en el bookkeeping y la siguiente pasada
  los vuelve a enviar. Con canales reales, el receptor debe tolerar
  duplicados o ser idempotente.
- Un fallo de envío se registra como intento fallido (máximo 3 intentos);
  no aborta la pasada.
- Si el proceso se ejecuta en **varias réplicas**, el `SKIP LOCKED` hace el
  despachador seguro entre réplicas, pero los demás jobs no están diseñados
  para duplicarse: opere una sola instancia o mueva los jobs a una.
- Si se conecta un canal real (SMTP/push), configure timeouts del canal:
  hoy corren dentro de la transacción de la pasada.

## Respaldo

No hay respaldos automáticos (recorte expreso de alcance §20). El mínimo
operativo recomendado:

- Volcado regular: `docker exec ecc-mariadb mariadb-dump --single-transaction -u root -p ecc > backup.sql`, almacenado fuera del host.
- El volumen `ecc-datos` persiste los datos; no lo borre con `docker compose down -v`.
- La bitácora de auditoría y las sesiones se purgan por la limpieza diaria;
  si necesita retención más larga, respalde antes de las 03:00.

## Logs

El sistema no tiene logfile propio: todo va al stdout del proceso (capte con
`docker logs` / systemd / el supervisor que use). Lo que debe esperar ver:

- `Enlace de invitacion: /registro/<token>` y `Enlace de verificación: /verificar/<token>`
  en `console.info` — los adaptadores de correo son simulados, así que **el
  log es hoy el único canal de entrega**. Es información sensible (quien lea
  el log puede tomar el control de esas cuentas): restrinja el acceso al
  log y roteelo con criterio. El enlace de invitación se muestra además una
  sola vez en la pantalla del admin (flash), para que pueda compartirlo.
- `[notificaciones] envio … por CORREO/PUSH, intento n/3` — simulación de
  envío (adaptadores de consola; SMTP/push reales quedan fuera de alcance).
- `[despachador] CANAL: n enviados, m fallidos` y `[jobs] <nombre>: n filas`
  por pasada.
- Errores no esperados salen por `console.error` del manejador de errores.

## Qué significan los recortes de alcance (§20) para el usuario

Entregado completo: cuentas con invitación y verificación de correo,
configuración de zonas/horarios/parámetros, reservas con aforo, concurrencia
y supervisión, cancelación e historial, vigilancia (solo lectura),
notificaciones in-app, estadísticas (3 consultas en pantalla), datos
personales mínimos (aceptación, consulta y rectificación de nombre) y
bitácora administrativa.

Fuera de alcance — el usuario no debe esperar estas funciones, son trabajo
futuro documentado:

- **QR físico** para el control de acceso (el enlace de invitación por correo
  sí existe; el escaneo en portería no).
- **Correo y push reales**: los envíos se simulan por log; un invitado o un
  residente verificado verá el enlace en la pantalla del admin o deberá
  pedírselo al administrador.
- **Cifrado en reposo, alta disponibilidad y respaldos automáticos**:
  dependerán de la infraestructura que lo aloje.
- **Solicitudes formales de datos (`SOLICITUD_DATOS`) con plazos legales,
  anonimización/supresión (RF-12) y cambio de correo (RF-08)**: `/mi-cuenta`
  solo permite rectificar el nombre y consultar/aceptar la política.
- **App nativa y exportación de estadísticas**: solo interfaz web.

## Pendientes técnicos

La lista de menores diferidos por tarea (para la revisión final separada)
vive en `.superpowers/sdd/zonas-comunes/progress.md` y no forma parte de la
documentación de usuario.
