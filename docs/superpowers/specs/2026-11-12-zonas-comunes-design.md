# Sistema de horarios para zonas comunes — Diseño

- **Fecha:** 2026-11-12
- **Entrega:** entrega de la próxima semana (una semana de trabajo)
- **Equipo:** Andres Paul Banderas, Angel Esteven Espitia Salas
- **Contexto académico:** clase de persistencia de datos
- **Documento fuente:** `documentacion resumen proyecto PD.pdf` (ER, 16 entidades, 42 RF, 29 RNF)
- **Estado:** pendiente de aprobación

---

## 1. Intención

Los residentes de un conjunto residencial tienen derecho a usar las zonas comunes, pero en fines de semana y festivos todos llegan a la misma hora y no hay cabida. Este sistema permite **solicitar una franja horaria con antelación**, limitada por el **aforo** de cada zona, y entrega al administrador **información del uso real**.

El éxito, para esta entrega, es un sistema **desplegado y usable de punta a punta** donde la base de datos no sea un depósito: el modelo, las restricciones y la concurrencia son la parte que se sostiene sola.

## 2. Por qué esta forma y no otra

El PDF describe un producto completo (verificación de correo, QR, push, Ley 1581, bitácora de 12 meses, 42 RF). Eso es un proyecto de varias semanas. Con una semana y dos personas, intentar cubrirlo todo produce 42 requisitos a medias.

**Decisión:** entregar un núcleo **completo y verificable**, y dejar el resto modelado pero no operativo. Lo que se recorta no desaparece del modelo de datos: queda documentado como trabajo futuro, para que la entrega se lea como una decisión de alcance y no como un olvido.

## 3. Objetivos, no objetivos y anti-objetivos

**Objetivos**

- Reservar una zona en una franja válida, con cupos, sin sobreventa bajo concurrencia.
- Configurar zonas, horarios y límites sin tocar código.
- Que cada rol vea exactamente lo que le corresponde.
- Consultar ocupación, horas pico y cancelaciones.
- Dejar rastro auditable de las acciones administrativas.

**No objetivos (esta entrega)**

- Aplicación móvil nativa.
- Envío real de correo o notificaciones push.
- Cumplimiento completo de Ley 1581 (solo aceptación y consulta de datos).
- Cifrado en reposo y alta disponibilidad.

**Anti-objetivos** — así se vería un fracaso aunque el sistema "funcione"

- Dos residentes reservan el mismo bloque y el sistema lo permite.
- El aforo se controla en el cliente o leyendo y luego insertando.
- La base de datos es un montón de tablas sin restricciones, y la lógica vive solo en TypeScript.
- El administrador puede reservar por encima del aforo "porque es admin".
- Nada está probado: se entrega y se reza.

## 4. Restricciones

| Restricción | Consecuencia |
|---|---|
| **MariaDB obligatorio** | Sin exclusion constraints; la concurrencia se resuelve con transacciones y bloqueo de fila. |
| Una semana, dos personas | Un solo entregable; cero servicios extra. |
| Solo web | Responsive; sin app nativa ni empaquetado móvil. |
| Zona horaria `America/Bogota` | Fechas y horas de bloque en hora local; instantes de auditoría en UTC. |
| Sin presupuesto de infraestructura | Docker Compose local; despliegue en un host gratuito/económico. |

## 5. Enfoques considerados

| Enfoque | A favor | En contra | Veredicto |
|---|---|---|---|
| **A. Monolito server-rendered** (Express + EJS/HTMX + MariaDB, SQL explícito) | Un despliegue, un repo; el tiempo se va en el modelo; encaja con `SESION`, `TOKEN_VERIFICACION`, `BITACORA` | Interfaz sobria; recarga de página | **Elegido** |
| B. API REST + SPA React | Interfaz más vistosa; API documentada | Dos aplicaciones, CORS, auth duplicada; resta días a la base de datos | Descartado por tiempo |
| C. Django + admin | CRUD de administración gratis | Depende de Python; el ORM esconde el SQL que la clase quiere ver | Descartado |

**Decisión del equipo:** A.

## 6. Stack

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | Un lenguaje en todo el repo |
| Servidor | Express 5 | Explícito, sin magia |
| Vistas | EJS + HTMX | Interactividad sin SPA |
| Base de datos | **MariaDB 11** (InnoDB, `utf8mb4`) | Requisito |
| Acceso a datos | `mysql2/promise` con pool | SQL visible: JOIN, transacción, `FOR UPDATE` |
| Migraciones | `.sql` numerados + runner propio (~60 líneas) | Esquema versionado y legible |
| Sesiones | Tabla `SESION` + cookie `httpOnly` | Ya existe en el ER; sin JWT |
| Hash de contraseña | `argon2id` | RNF-10 |
| Validación | `zod` | Validar en la frontera |
| Tareas programadas | `node-cron` | Recordatorios y reservas vencidas, sin infraestructura |
| Pruebas | Vitest + Supertest contra MariaDB real | Probar concurrencia de verdad |
| Contenedores | Docker Compose (`mariadb`, `app`) | Reproducible para el equipo y el docente |

**Criterio rector:** se usa SQL explícito, no ORM. En una clase de persistencia, un ORM oculta justo lo que se evalúa. El repositorio debe poder mostrar el esquema, las restricciones y la transacción.

## 7. Arquitectura

Monolito en capas, una sola aplicación y un solo proceso.

```
Navegador ──HTTP──> Express (rutas) ──> Servicios (reglas + transacciones) ──> Repositorios (SQL) ──> MariaDB
                        │
                        └─> Vistas EJS (render en servidor) + HTMX (fragmentos)
```

- **Rutas**: autenticación, autorización por rol, validación de entrada, render.
- **Servicios**: reglas de negocio y límites transaccionales. Ninguna regla de negocio vive en la ruta ni en la vista.
- **Repositorios**: SQL parametrizado. Sin concatenación de cadenas.
- **Vistas**: solo presentación; nunca calculan aforo ni permisos.

```
src/
  app.ts                    # composición de Express
  server.ts                 # arranque
  config/env.ts             # validación de variables de entorno
  db/
    pool.ts                 # mysql2/promise
    migrate.ts              # runner de migraciones
    migrations/001_init.sql ...
  middleware/
    auth.ts                 # sesión -> usuario
    require-role.ts
    csrf.ts
    error.ts
  modules/
    auth/                   # registro, login, logout, recuperación
    apartamentos/
    zonas/
    reservas/
    notificaciones/
    estadisticas/
    auditoria/
    datos-personales/
  views/                    # EJS por módulo
  public/                   # CSS, JS mínimo, HTMX
tests/
  integration/
  concurrency/
```

## 8. Modelo de datos

Se conservan **las 16 entidades del PDF** con sus campos, tipos y relaciones. Cambios respecto al ER original, todos justificados:

1. **Tabla nueva `OCUPACION_BLOQUE`** — contador de cupos por `(zona, fecha, bloque)`. Es la pieza que hace segura la concurrencia (§9). No sustituye a `RESERVA`: `RESERVA` es el hecho, `OCUPACION_BLOQUE` es el agregado que se bloquea.
2. **Índices** para las consultas reales (§8.4).
3. **Restricciones `CHECK`** donde MariaDB las soporta (aforo > 0, cupos > 0, hora_fin > hora_inicio, `PARAMETRO_RESERVA.id = 1`).
4. **`PARAMETRO_RESERVA` fila única** garantizada por `CHECK (id = 1)` + seed.

### 8.1 Tipos y convenciones

- IDs: `CHAR(36)` con `UUID()` generado por la aplicación. *Decisión propia:* a escala de 500 cuentas, la legibilidad y la compatibilidad del driver pesan más que los 20 bytes ahorrados; MariaDB 11 tiene tipo nativo `UUID` como ruta de mejora.
- Motor `InnoDB`; charset `utf8mb4`; collation `utf8mb4_unicode_ci`.
- Fechas de bloque (`fecha`, `hora_inicio`, `hora_fin`): **hora local** `America/Bogota`, porque representan una franja del calendario, no un instante.
- Marcas de auditoría (`creada_en`, `cancelada_en`, `ultimo_uso`): **UTC** `DATETIME(3)`.
- Booleanos: `TINYINT(1)`.
- Enumeraciones: `VARCHAR` + `CHECK IN (...)` (no `ENUM`, para poder evolucionar sin `ALTER` destructivo).

### 8.2 Esquema (resumen)

```sql
APARTAMENTO(id PK, torre_interior, numero, creado_en,
            UNIQUE(torre_interior, numero))

USUARIO(id PK, rol CHECK IN ('RESIDENTE','ADMINISTRADOR','VIGILANTE'),
        apartamento_id FK NULL,        -- NOT NULL si rol = RESIDENTE
        nombre, correo UNIQUE, password_hash,
        estado CHECK IN ('PENDIENTE','ACTIVA','DESACTIVADA','BAJA'),
        correo_verificado, intentos_fallidos, bloqueado_hasta, creado_en)

INVITACION(id PK, apartamento_id FK, creada_por FK, usuario_id FK NULL,
           token_hash UNIQUE, estado CHECK IN ('VIGENTE','USADA','REVOCADA','VENCIDA'),
           creada_en, vence_en, usada_en)

TOKEN_VERIFICACION(id PK, usuario_id FK,
                   tipo CHECK IN ('VERIFICAR_CORREO','RESTABLECER_PASSWORD','CAMBIO_CORREO'),
                   token_hash UNIQUE, correo_nuevo, vence_en, usado_en)

SESION(id PK, usuario_id FK, token_hash UNIQUE, ultimo_uso, revocada_en)

DISPOSITIVO_PUSH(id PK, usuario_id FK, token_push, plataforma CHECK IN ('ANDROID','IOS'), registrado_en)

TEXTO_LEGAL(id PK, tipo CHECK IN ('AUTORIZACION','POLITICA','AVISO_PRIVACIDAD'),
            version, contenido, vigente_desde, UNIQUE(tipo, version))

AUTORIZACION_DATOS(id PK, usuario_id FK, texto_legal_id FK, aceptada_en, revocada_en,
                  UNIQUE(usuario_id, texto_legal_id))

ZONA(id PK, nombre UNIQUE, aforo CHECK (aforo > 0), duracion_bloque_min,
     max_cupos_reserva, activa)

HORARIO_ZONA(id PK, zona_id FK, dia_semana CHECK (dia_semana BETWEEN 1 AND 7),
             apertura, cierre, UNIQUE(zona_id, dia_semana))

PARAMETRO_RESERVA(id PK CHECK (id = 1), max_reservas_semana, max_reservas_dia, anticipacion_dias)

RESERVA(id PK, apartamento_id FK NULL, zona_id FK, fecha, hora_inicio, hora_fin,
        cupos CHECK (cupos > 0),
        estado CHECK IN ('CONFIRMADA','CANCELADA','VENCIDA'),
        cancelada_por CHECK IN ('RESIDENTE','ADMINISTRADOR','SISTEMA') NULL,
        cancelada_por_usuario FK NULL, motivo_cancelacion,
        creada_en, cancelada_en)

NOTIFICACION(id PK, usuario_id FK, reserva_id FK NULL,
             tipo CHECK IN ('CONFIRMACION','CANCELACION','RECORDATORIO'),
             titulo, mensaje, leida, creada_en)

ENVIO_NOTIFICACION(id PK, notificacion_id FK, canal CHECK IN ('CORREO','PUSH'),
                   estado CHECK IN ('PENDIENTE','ENVIADO','FALLIDO'),
                   intentos CHECK (intentos BETWEEN 0 AND 3), ultimo_intento)

SOLICITUD_DATOS(id PK, usuario_id FK NULL,
                tipo CHECK IN ('CONSULTA','RECLAMO','SUPRESION','REVOCATORIA'),
                estado CHECK IN ('RECIBIDA','EN_TRAMITE','PRORROGADA','ATENDIDA'),
                recibida_en, vence_en, prorrogada, atendida_en, respuesta)
                -- tabla creada, sin flujo en esta entrega

BITACORA(id PK, usuario_id FK, accion, entidad, entidad_id, detalle, creada_en)

-- NUEVA
OCUPACION_BLOQUE(zona_id FK, fecha, hora_inicio, cupos_ocupados CHECK (cupos_ocupados >= 0),
                 PRIMARY KEY (zona_id, fecha, hora_inicio))
```

### 8.3 Reglas de integridad que la base de datos garantiza

- `USUARIO.correo` único; `INVITACION.token_hash` y `SESION.token_hash` únicos.
- `HORARIO_ZONA` único por `(zona, dia_semana)`.
- `OCUPACION_BLOQUE.cupos_ocupados >= 0`: una cancelación no puede dejar el contador en negativo.
- `PARAMETRO_RESERVA` imposible de duplicar.
- Borrado: `ON DELETE RESTRICT` en todo lo que representa un hecho (reservas, bitácora, autorizaciones). No se borra historia para "limpiar".

### 8.4 Índices

| Índice | Consulta que sirve |
|---|---|
| `RESERVA(zona_id, fecha, estado)` | Disponibilidad y ocupación por zona/fecha |
| `RESERVA(apartamento_id, fecha)` | Historial del residente y límites día/semana |
| `RESERVA(fecha, estado)` | Vista de vigilancia del día |
| `NOTIFICACION(usuario_id, leida)` | Bandeja |
| `SESION(usuario_id, ultimo_uso)` | Limpieza de sesiones |
| `BITACORA(creada_en)` | Depuración a 12 meses |

## 9. La regla central: cupo y concurrencia

Este es el corazón del proyecto y la razón por la que es un trabajo de persistencia.

### 9.1 Lo que no se hace

```ts
// MAL: dos peticiones simultáneas leen 8, ambas suman 2, ambas escriben 10. Sobreventa.
const usados = await sumarCupos(zona, fecha, bloque);
if (usados + cupos <= aforo) await insertarReserva(...);
```

### 9.2 Lo que se hace

Una fila por bloque en `OCUPACION_BLOQUE`, y un `UPDATE` atómico que solo afecta a una fila si cabe. El `UPDATE` toma un lock exclusivo de esa fila; la segunda transacción espera y vuelve a evaluar contra el valor ya incrementado.

```sql
START TRANSACTION;

INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados)
VALUES (?, ?, ?, 0)
ON DUPLICATE KEY UPDATE zona_id = zona_id;          -- asegura la fila sin bloquear de más

UPDATE OCUPACION_BLOQUE
   SET cupos_ocupados = cupos_ocupados + ?
 WHERE zona_id = ? AND fecha = ? AND hora_inicio = ?
   AND cupos_ocupados + ? <= ?;                      -- ? = aforo vigente de la zona

-- affectedRows = 0  ->  no hay cupo  ->  ROLLBACK, responder 409
INSERT INTO RESERVA (...) VALUES (...);
COMMIT;
```

**Cancelación** — misma transacción, en sentido inverso:

```sql
START TRANSACTION;
UPDATE RESERVA SET estado='CANCELADA', cancelada_por=?, cancelada_por_usuario=?,
       motivo_cancelacion=?, cancelada_en=UTC_TIMESTAMP(3)
 WHERE id=? AND estado='CONFIRMADA';                 -- idempotente: si no afecta, ya estaba cancelada

UPDATE OCUPACION_BLOQUE
   SET cupos_ocupados = cupos_ocupados - ?
 WHERE zona_id=? AND fecha=? AND hora_inicio=?;      -- CHECK evita negativos
COMMIT;
```

### 9.3 Límites por apartamento (misma transacción)

Antes del `UPDATE`, dentro de la transacción, se cuentan las reservas **no canceladas** del apartamento:

- `max_reservas_dia`: reservas con `fecha = ?`
- `max_reservas_semana`: reservas con `fecha` dentro de la semana **lunes–domingo** de la fecha pedida
- `anticipacion_dias`: `fecha` entre hoy y hoy + N

*Decisión propia:* la semana se define lunes–domingo (convención colombiana), no ISO con domingo inicial.

### 9.4 Aforo y configuración cambiantes

- Bajar el aforo **no** invalida reservas existentes; impide nuevas que ya no caben. Coincide con RF-13..16 ("los cambios aplican solo a reservas futuras").
- Cambiar `duracion_bloque_min` o el horario no reescribe reservas: `RESERVA` guarda copia de `hora_inicio`/`hora_fin`, como define el PDF.
- Desactivar una zona (`activa = 0`) impide reservas nuevas; el historial permanece.

### 9.5 Una reserva ocupa exactamente un bloque

*Decisión tras la revisión:* `RESERVA.hora_fin = hora_inicio + ZONA.duracion_bloque_min`. No hay reservas de varios bloques consecutivos. El PDF dice que `hora_inicio` es "copia del bloque al reservar", y eso solo tiene sentido con bloques fijos. La regla de "múltiplo de la duración" de `HORARIO_ZONA` se refiere a que `cierre - apertura` debe ser divisible por la duración, no a reservas multi-bloque. Consecuencia: el `UPDATE` atómico de una fila de `OCUPACION_BLOQUE` es suficiente y el test de concurrencia cubre el caso real.

`ZONA.max_cupos_reserva` **sí se aplica**: `1 <= cupos <= max_cupos_reserva` y `cupos <= aforo`. Sin ese límite, un residente podría acaparar el aforo completo en una sola reserva.

### 9.6 Estado `VENCIDA`

Un job cada 15 minutos marca `CONFIRMADA → VENCIDA` cuando `TIMESTAMP(fecha, hora_fin)` ya pasó.

- **No devuelve cupos.** El bloque ya ocurrió; devolverlos rompería el invariante histórico de ocupación.
- **Cuenta como uso** en las estadísticas (es una reserva que ocupó el bloque).
- **No se puede cancelar** una reserva `VENCIDA`.
- Para los límites día/semana cuenta todo lo que **no** esté `CANCELADA`, igual que §9.3.

### 9.7 Casos borde cubiertos

| Caso | Comportamiento |
|---|---|
| Dos reservas simultáneas del último cupo | Una confirma, la otra recibe 409. Probado con test de concurrencia. |
| Doble submit del mismo apartamento en el mismo bloque | Una sola reserva no cancelada; la segunda recibe 409 y el contador no queda inflado. |
| Cancelar dos veces | Segunda devuelve 409; no hay filas afectadas y el contador no cambia. |
| Reserva en el pasado | Rechazada al validar `fecha`/`hora_inicio`. |
| Franja fuera del horario de la zona | Rechazada contra `HORARIO_ZONA`. |
| Bloque que no es múltiplo de la duración | Rechazado. |
| Zona inactiva | Rechazada. |
| Reserva que empieza en menos de X | Sin restricción propia; la anticipación fija la ventana. |

## 10. Autenticación y autorización

- **Registro:** solo con invitación vigente. El administrador crea `INVITACION` para un apartamento; el token se muestra una vez y se guarda como hash. El residente se registra, la invitación pasa a `USADA` y se vincula `usuario_id`.
- **Login:** correo + contraseña. `argon2id`. 5 fallos → `bloqueado_hasta = now + 15 min`. Mensaje de error genérico (no revelar si el correo existe).
- **Sesión:** token aleatorio de 32 bytes en cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción; en BD solo `SHA-256(token)`. Expira a los 30 días sin uso; `ultimo_uso` se actualiza como máximo una vez por hora para no escribir en cada request.
- **Roles:** `RESIDENTE` (reservar, cancelar lo suyo, historial), `ADMINISTRADOR` (todo lo anterior + configuración + supervisión + bitácora), `VIGILANTE` (solo lectura del día).
- **Autorización en servidor**, no en la vista: middleware `requireRole` y comprobación de pertenencia (`reserva.apartamento_id === usuario.apartamento_id`) en el servicio.
- **CSRF:** token por sesión, en campo oculto de cada formulario y validado en el servidor.
- **Rate limit:** en login y en recuperación.
- **Verificación de correo:** se genera `TOKEN_VERIFICACION` y la ruta existe; el "envío" escribe el enlace en el log (no hay SMTP). El registro queda `ACTIVA` con `correo_verificado = 0` y un aviso persistente.
- **Recuperación de contraseña:** mismo mecanismo, token en log. El token caduca en 1 hora y es de un solo uso.

## 11. Pantallas y rutas

| Ruta | Rol | Qué hace |
|---|---|---|
| `GET /login`, `POST /login`, `POST /logout` | público | Sesión |
| `GET/POST /registro/:token` | público con invitación | Alta de residente |
| `GET /recuperar`, `POST /recuperar`, `GET/POST /restablecer/:token` | público | Recuperación |
| `GET /` | autenticado | Inicio según rol |
| `GET /reservar` | RESIDENTE | Elegir zona y fecha |
| `GET /reservar/:zona/:fecha` | RESIDENTE | Bloques con cupo disponible |
| `POST /reservas` | RESIDENTE | Crear reserva |
| `POST /reservas/:id/cancelar` | RESIDENTE | Cancelar la propia |
| `GET /mis-reservas` | RESIDENTE | Historial |
| `GET /notificaciones`, `POST /notificaciones/:id/leida` | autenticado | Bandeja |
| `GET /admin/zonas`, `GET/POST /admin/zonas/:id` | ADMINISTRADOR | Configuración de zonas y horarios |
| `GET/POST /admin/parametros` | ADMINISTRADOR | Límites |
| `GET/POST /admin/apartamentos` | ADMINISTRADOR | Catálogo de torres/números (RF-42) |
| `GET/POST /admin/invitaciones` | ADMINISTRADOR | Crear y revocar invitaciones |
| `GET /admin/reservas` | ADMINISTRADOR | Supervisión y cancelación |
| `GET /admin/estadisticas` | ADMINISTRADOR | Ocupación, horas pico, cancelaciones |
| `GET /admin/bitacora` | ADMINISTRADOR | Auditoría |
| `GET /vigilancia` | VIGILANTE + ADMINISTRADOR | Reservas del día, solo lectura |
| `GET /mi-cuenta`, `POST /mi-cuenta` | autenticado | Ver/rectificar datos, aceptar política |

*Decisión propia:* la reserva se completa en **3 pasos** (zona → fecha y bloque → confirmar), por debajo del límite de 5 del RNF-22.

## 12. Notificaciones

- Al confirmar o cancelar se crea `NOTIFICACION` (bandeja in-app).
- Un `cron` cada 5 minutos crea el recordatorio de las reservas que empiezan en ~1 hora.
- `ENVIO_NOTIFICACION` se crea por cada canal con estado `PENDIENTE`; un **despachador con canal `console`** lo marca `ENVIADO` y escribe en el log. Los adaptadores de correo y push existen como interfaz, sin implementación real.
- Reintentos: el despachador incrementa `intentos`; al tercer fallo, `FALLIDO`. Así el RNF-07 (3 reintentos) queda demostrado sin proveedor externo.
- `DISPOSITIVO_PUSH` se crea pero no se usa en esta entrega.

## 13. Estadísticas

Tres consultas, todas sobre `RESERVA` confirmada:

1. **Ocupación por zona y bloque:** `SUM(cupos)` por `(zona, fecha, hora_inicio)` y el porcentaje contra el **aforo vigente** de la zona, en un rango de fechas. *Decisión:* no se guarda un snapshot del aforo en `RESERVA`; el valor absoluto de cupos es histórico y fiel, y el porcentaje se etiqueta como "contra aforo actual" para no mentir sobre el pasado.
2. **Horas pico:** conteo de reservas agrupado por `HOUR(hora_inicio)` y por día de la semana.
3. **Cancelaciones:** confirmadas vs. canceladas por zona, en porcentaje.

Se muestran en pantalla, con filtro de rango de fechas. Sin exportación (RNF-34/35 piden solo pantalla).

## 14. Datos personales (mínimo viable)

- `TEXTO_LEGAL` sembrado con tres versiones: `AUTORIZACION`, `POLITICA`, `AVISO_PRIVACIDAD`.
- En el registro se exige aceptar; se crea `AUTORIZACION_DATOS` con fecha y hora.
- `GET /mi-cuenta` muestra los datos y permite rectificar el **nombre**. El cambio de correo (RF-08) queda fuera de esta entrega: como `correo` es `UNIQUE` y está atado a la verificación, permitirlo sin flujo de verificación abriría un hueco. `TOKEN_VERIFICACION.tipo = CAMBIO_CORREO` existe en el esquema para el futuro.
- `SOLICITUD_DATOS` existe en el esquema pero **no hay flujo**: se documenta como trabajo futuro. La supresión/anonimización (RF-12, RF-40) queda fuera.

## 15. Bitácora

Se registra en el servicio, no en un trigger, para saber **quién** hizo qué:

- Crear/editar/desactivar zona y horario.
- Cambiar parámetros.
- Crear/revocar invitación.
- Cancelar reserva ajena.
- Desactivar cuenta.

`detalle` es JSON sin contraseñas, hashes ni tokens. Retención de 12 meses mediante job de limpieza.

## 16. Seguridad

| RNF | Cómo se cumple |
|---|---|
| Hash robusto | `argon2id`, parámetros por defecto de la librería |
| TLS | Terminación en el host de despliegue; `Secure` en cookies |
| Permisos por rol en servidor | Middleware + comprobación de pertenencia en servicios |
| Bloqueo tras 5 intentos | `intentos_fallidos` + `bloqueado_hasta` |
| Cifrado en reposo | **Fuera de alcance**; documentado |
| SQL injection | Consultas parametrizadas en el 100 % de los repositorios |
| XSS | Escape por defecto de EJS; sin `innerHTML` |
| CSRF | Token por sesión en formularios |

## 17. Pruebas

**Unitarias (servicios):** validación de bloques, límites día/semana, anticipación, transiciones de estado.

**Integración (Vitest + Supertest contra MariaDB en Docker):**

- Registro con invitación: válida, vencida, usada, revocada.
- Login correcto/incorrecto; bloqueo al quinto fallo.
- Permisos: residente no entra a `/admin/*`; vigilante no escribe.
- Reserva feliz; reserva sin cupo; reserva fuera de horario; zona inactiva.
- Cancelación devuelve cupo; cancelar dos veces no resta dos veces.
- Límite diario y semanal.

**Concurrencia (la prueba insignia):**

```
aforo = 10, cupos por reserva = 2
20 peticiones simultáneas (Promise.all) al mismo bloque
=> exactamente 5 responden 201
=> SUM(cupos_ocupados) = 10
=> ninguna respuesta 5xx
```

Se repite con cancelación concurrente para verificar que el contador nunca es negativo.

**Migraciones:** un test aplica todas las migraciones sobre una base vacía y verifica que el esquema resultante tiene las tablas y restricciones esperadas.

## 18. Operación

- `docker-compose.yml`: `mariadb:11` con volumen y healthcheck; `app` con Node.
- Variables: `DATABASE_URL`, `SESSION_COOKIE_SECRET`, `TZ=America/Bogota`, `NODE_ENV`.
- Migraciones al arrancar (`npm run migrate`) y `npm run seed` con datos de demostración: 3 torres, 12 apartamentos, 1 administrador, 1 vigilante, 8 residentes, 5 zonas con horarios y parámetros.
- `npm run dev`, `npm run test`, `npm run build`.
- **Criterio de entrega:** `docker compose up` debe levantar el sistema completo en una máquina limpia con solo Docker y Node instalados, y ejecutar migraciones y seed. Una URL pública es opcional y no bloquea la entrega; si se publica, se activan `Secure` en cookies y TLS en el host.

## 19. Riesgos

| Riesgo | Mitigación |
|---|---|
| El alcance crece | El §20 fija qué no se toca; lo nuevo entra como trabajo futuro |
| Concurrencia mal probada | Test insignia desde el día 1, no al final |
| Zona horaria | Fechas de bloque locales, auditoría UTC, `TZ` fijada en el contenedor |
| Migraciones divergentes | Un solo runner, migraciones numeradas, test de esquema |
| Sin tiempo para la interfaz | EJS + HTMX con un CSS único; la prioridad es el flujo, no el diseño |

## 20. Alcance reducido: qué se entrega y qué no

**Se entrega (núcleo completo):**

| Módulo | Estado |
|---|---|
| Cuentas y acceso (RF-01–12 + RF-42) | Completo salvo RF-12 (anonimización) y RF-08 (cambio de correo) |
| Configuración (RF-13–16) | Completo |
| Reservas (RF-17–25) | Completo, incluida concurrencia y supervisión |
| Notificaciones (RF-26–29) | In-app completo; correo/push simulado por log |
| Vigilancia (RF-30) | Completo, solo lectura |
| Estadísticas (RF-31–35) | 3 consultas en pantalla |
| Datos personales (RF-36–41) | Aceptación, consulta y rectificación; sin flujo de solicitudes |
| Bitácora | Completa para acciones administrativas |

**Fuera de alcance (documentado como trabajo futuro):** QR físico (el enlace sí), push real, SMTP real, cifrado en reposo, alta disponibilidad y respaldos automáticos, `SOLICITUD_DATOS` con plazos legales, anonimización/supresión, app nativa, exportación de estadísticas.

> Los textos literales de RF-01..42 están en el PDF fuente; este documento mapea por módulo para no reescribirlos ni inventarlos.

## 21. Lo que queda a criterio de quien implemente

- Estilo visual concreto, tipografía y paleta (debe cumplir contraste 4.5:1).
- Textos de los correos simulados y de los mensajes de error.
- Datos exactos del seed más allá de los mínimos del §18.
- Paginación y orden por defecto en listados.
- Nombres de clases y organización interna de cada módulo, respetando las capas del §7.

## 22. Registro de decisiones (revisión independiente)

Un revisor sin contexto leyó el documento y devolvió ocho preguntas. Ninguna requería una decisión del equipo; todas se resolvieron aquí y quedan marcadas para que se puedan impugnar al leer.

| # | Pregunta | Decisión | Por qué |
|---|---|---|---|
| 1 | ¿Reserva de uno o varios bloques? | **Un bloque.** `hora_fin = hora_inicio + duracion_bloque_min` | "Copia del bloque" en el ER; simplifica el lock y el test de concurrencia |
| 2 | ¿De quién es la reserva? | **Del apartamento**, como dice el ER. Cancela cualquier residente activo; `cancelada_por_usuario` registra a quién | No se añade columna; el ER ya lo define así |
| 3 | ¿A quién se notifica? | A **todos los residentes activos** del apartamento | Sin `usuario_id` en `RESERVA`, es la única lectura coherente |
| 4 | ¿Qué es `VENCIDA`? | Pasa el bloque sin cancelar; no devuelve cupos, cuenta como uso, no se cancela | §9.6 |
| 5 | ¿Se aplica `max_cupos_reserva`? | **Sí**, `1 <= cupos <= max_cupos_reserva` | Sin límite, un residente acapara la zona |
| 6 | ¿Cambio de correo? | **Fuera.** `/mi-cuenta` rectifica solo el nombre | RF-08 fuera de alcance; evita un hueco de verificación |
| 7 | ¿CRUD de apartamentos? | **Sí**, `/admin/apartamentos` | RF-42; sin él no se puede invitar a un apartamento nuevo |
| 8 | ¿Aforo histórico en estadísticas? | **Aforo vigente**, etiquetado como tal | No se añade snapshot; el dato absoluto sigue siendo fiel |
| 9 | ¿Dos reservas del mismo apartamento en el mismo bloque? | **Prohibido**: una sola no cancelada; la segunda recibe 409 | Un doble clic no infla el contador ni duplica la reserva |
| 10 | ¿Qué responde cancelar dos veces? | **409**, sin tocar el contador | El estado ya está resuelto; el error lo dice explícitamente |

**Decisiones menores de implementación:** el token CSRF se deriva como `HMAC-SHA256(token_de_sesión, secreto_del_servidor)`, sin columna nueva en `SESION`; y cada corrida de pruebas crea y destruye su propia base `ecc_test_<aleatorio>` para no compartir estado.

## 23. Aprobación

Este documento requiere aprobación antes de escribir el plan de implementación. Cualquier cambio de alcance posterior se anota aquí con fecha.
