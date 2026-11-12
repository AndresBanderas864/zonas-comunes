# Sistema de horarios para zonas comunes — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar un monolito web funcional donde los residentes reservan bloques de zonas comunes con cupos limitados por aforo, sin sobreventa bajo concurrencia, con administración, vigilancia y estadísticas.

**Architecture:** Monolito Express 5 + TypeScript con render en servidor (EJS + HTMX) sobre MariaDB 11, SQL explícito y capas rutas → servicios → repositorios. La concurrencia se resuelve con una fila de contador por bloque (`OCUPACION_BLOQUE`) y un `UPDATE` atómico dentro de una transacción.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, HTMX, MariaDB 11, `mysql2/promise`, `zod`, `argon2`, `node-cron`, Vitest, Supertest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-12-zonas-comunes-design.md`

## Global Constraints

- Base de datos: **MariaDB 11**, motor `InnoDB`, charset `utf8mb4`, collation `utf8mb4_unicode_ci`.
- IDs `CHAR(36)` generados en la aplicación con `crypto.randomUUID()`.
- `fecha`, `hora_inicio`, `hora_fin` en hora local `America/Bogota`; toda marca de auditoría en **UTC** con `DATETIME(3)`.
- **Cero ORM.** Todo el SQL es parametrizado (`?`), nunca concatenado.
- Las reglas de negocio viven en `src/modules/**/service.ts`. Las rutas validan y renderizan; las vistas no calculan aforo ni permisos.
- Roles: `RESIDENTE`, `ADMINISTRADOR`, `VIGILANTE`. Toda autorización se comprueba en el servidor.
- Contraseñas con `argon2id`. Tokens de sesión y de invitación se guardan solo como `SHA-256`.
- Un solo bloque por reserva: `hora_fin = hora_inicio + ZONA.duracion_bloque_min`.
- Códigos HTTP: 400 validación, 401 sin sesión, 403 sin permiso, 404 inexistente, **409 conflicto de cupo, duplicado o estado ya resuelto**, **429 cuenta bloqueada o rate limit**, 500 inesperado.
- UI en español; contraste mínimo 4.5:1.
- `TZ=America/Bogota` en el contenedor; `npm test` exige MariaDB arriba (`docker compose up -d mariadb`).
- Los tests de integración corren **en serie** (`fileParallelism: false`) contra una base `ecc_test_<aleatorio>` creada por corrida y destruida al final. Cada archivo limpia las tablas en `beforeEach`.
- Dependencias permitidas (no añadir otras): `express`, `ejs`, `mysql2`, `zod`, `argon2`, `helmet`, `express-rate-limit`, `node-cron`, `dotenv`. Dev: `typescript`, `tsx`, `vitest`, `supertest`, `@types/*`.

## Review Focus

Cinco fallos que la spec implica pero que ningún requisito enumera. Cada uno tiene su test en la tarea que lo posee.

1. **Doble submit del formulario de reserva** (doble clic o reenvío del POST): un apartamento no puede terminar con dos reservas activas en el mismo bloque. Test en Task 13.
2. **Zona sin horario para ese día de la semana**: la disponibilidad devuelve lista vacía, nunca 500. Test en Task 12.
3. **Cupos manipulados en el POST** (0, negativo, mayor que `max_cupos_reserva` o que el aforo): 400 con mensaje, nunca 500 ni reserva parcial. Test en Task 13.
4. **El aforo cambia entre el GET de disponibilidad y el POST**: el servicio revalida contra la base, no contra el formulario; responde 409. Test en Task 13.
5. **Sesión revocada o expirada mientras hay un formulario abierto**: el POST responde 401 y redirige a login, sin 500 ni pérdida silenciosa. Test en Task 8.

---

### Task 1: Esqueleto del proyecto y entorno reproducible

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `docker-compose.yml`, `src/app.ts`, `src/server.ts`, `tests/health.test.ts`

**Interfaces:**
- Produces: `createApp(): Express` en `src/app.ts`; `GET /health` → `200 {"status":"ok","db":"up"}`.

- [x] **Step 1: Escribir el test que falla**

```ts
// tests/health.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('responde 200 con estado ok y la base arriba', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });
});
```

- [x] **Step 2: Ejecutarlo y verlo fallar**

Run: `npx vitest run tests/health.test.ts`
Expected: FAIL — no existe `src/app`.

- [x] **Step 3: Crear el esqueleto**

`package.json` con `"type": "module"`, scripts `dev` (`tsx watch src/server.ts`), `test` (`vitest run`), `migrate`, `seed`, `build`. `docker-compose.yml` con `mariadb:11`, base `ecc`, usuario/clave `ecc`/`ecc`, `MARIADB_ROOT_PASSWORD=root`, healthcheck `mariadb-admin ping`, y servicio `app` que espera a la base. `.env.example` con `DATABASE_URL=mysql://ecc:ecc@localhost:3306/ecc`, `SESSION_SECRET`, `PORT=3000`, `TZ=America/Bogota`. `.gitignore` excluye `node_modules`, `dist`, `.env`, `coverage`. `vitest.config.ts` calcula `TEST_DB_NAME = 'ecc_test_' + process.pid`, asigna `process.env.TEST_DB_NAME = TEST_DB_NAME` y fija `test: { fileParallelism: false, globalSetup: ['tests/global-setup.ts'], setupFiles: ['tests/setup.ts'], env: { NODE_ENV: 'test', SESSION_SECRET: 'test-secret-con-mas-de-32-caracteres', DATABASE_URL: 'mysql://root:root@localhost:3306/' + TEST_DB_NAME, TEST_DB_NAME } }` (root solo para crear/destruir la base de prueba).
Implementar `src/app.ts` exportando `createApp()` con `express.json()`, `express.urlencoded({extended:true})`, y `GET /health` que ejecuta `SELECT 1` con el pool y responde el JSON del test.

- [x] **Step 4: Verificar que pasa**

Run: `docker compose up -d mariadb && npx vitest run tests/health.test.ts`
Expected: PASS (1 test).

- [x] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example docker-compose.yml src tests
git commit -m "chore: esqueleto del proyecto y healthcheck"
```

---

### Task 2: Pool, transacciones y esquema completo

**Files:**
- Create: `src/db/pool.ts`, `src/db/migrate.ts`, `src/db/migrations/001_init.sql`, `src/db/migrate-cli.ts`, `tests/global-setup.ts`, `tests/helpers/db.ts`, `tests/setup.ts`, `tests/schema.test.ts`
- Modify: `src/app.ts` (usar el pool)

**Interfaces:**
- Produces:
  - `pool: Pool` (mysql2/promise), `query<T>(sql: string, params?: unknown[]): Promise<T[]>`
  - `withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T>`
  - `runMigrations(conn: PoolConnection): Promise<number>`
  - `tests/helpers/db.ts`: `crearBaseDePrueba(nombre: string): Promise<void>` (crea la base, migra y cierra la conexión administrativa), `resetearBase(): Promise<void>` (trunca todas las tablas en orden seguro de FKs), `destruirBaseDePrueba(nombre: string): Promise<void>` (DROP DATABASE).
  - `tests/global-setup.ts`: `setup()` llama `crearBaseDePrueba(process.env.TEST_DB_NAME!)`; devuelve `teardown()` que llama `destruirBaseDePrueba`.
  - `tests/setup.ts`: `beforeEach(resetearBase)`.
  - Tablas del diseño §8 con sus `CHECK`, `UNIQUE`, `FK` e índices.

- [x] **Step 1: Escribir el test de esquema**

```ts
// tests/schema.test.ts — tras migrar una base vacía
it('crea las 17 tablas y las restricciones clave', async () => {
  const tablas = await query<{ TABLE_NAME: string }>(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
  );
  const nombres = tablas.map(t => t.TABLE_NAME);
  expect(nombres).toEqual(expect.arrayContaining([
    'APARTAMENTO','USUARIO','INVITACION','TOKEN_VERIFICACION','SESION','DISPOSITIVO_PUSH',
    'TEXTO_LEGAL','AUTORIZACION_DATOS','ZONA','HORARIO_ZONA','PARAMETRO_RESERVA','RESERVA',
    'NOTIFICACION','ENVIO_NOTIFICACION','SOLICITUD_DATOS','BITACORA','OCUPACION_BLOQUE'
  ]));
  await expect(query("INSERT INTO ZONA (id,nombre,aforo,duracion_bloque_min,max_cupos_reserva,activa) VALUES (UUID(),'X',-1,120,2,1)"))
    .rejects.toThrow(); // CHECK aforo > 0
  await expect(query("INSERT INTO PARAMETRO_RESERVA (id,max_reservas_semana,max_reservas_dia,anticipacion_dias) VALUES (2,7,3,7)"))
    .rejects.toThrow(); // CHECK id = 1
});
```

- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — no existe `src/db/pool`.

- [x] **Step 3: Implementar pool y migraciones**

`001_init.sql` con las 17 tablas del diseño §8.2, `PARAMETRO_RESERVA` con `CHECK (id = 1)`, `OCUPACION_BLOQUE` con PK `(zona_id, fecha, hora_inicio)` y `CHECK (cupos_ocupados >= 0)`, los 6 índices del §8.4, y `ON DELETE RESTRICT` en los hechos. Añadir `UNIQUE(usuario_id, texto_legal_id)` en `AUTORIZACION_DATOS` y `CHECK (rol <> 'RESIDENTE' OR apartamento_id IS NOT NULL)` en `USUARIO`. `runMigrations` crea la tabla `MIGRACIONES` (`nombre`, `aplicada_en`), aplica en orden los `.sql` no registrados dentro de una transacción por archivo, y es idempotente. `tests/helpers/db.ts` usa una conexión `mysql2` sin `database` para `CREATE DATABASE`/`DROP DATABASE` (el pool apunta a una base que aún no existe), y `resetearBase` hace `SET FOREIGN_KEY_CHECKS=0; TRUNCATE ...; SET FOREIGN_KEY_CHECKS=1`.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS. Volver a correr: sigue PASS (idempotencia).

- [x] **Step 5: Commit**

```bash
git add src/db tests/schema.test.ts tests/setup.ts tests/global-setup.ts tests/helpers
git commit -m "feat: pool, transacciones y esquema inicial"
```

---

### Task 3: Seed de demostración

**Files:**
- Create: `src/db/seed.ts`, `src/db/seed-cli.ts`, `tests/seed.test.ts`

**Interfaces:**
- Produces: `runSeed(conn: Pool | PoolConnection): Promise<void>`; datos: 3 torres × 4 apartamentos, 1 `ADMINISTRADOR`, 1 `VIGILANTE`, 8 `RESIDENTE` (contraseña `Demo1234!`), 5 zonas con horario lunes–domingo, `PARAMETRO_RESERVA` (semana 7 / día 3 / anticipación 7), 3 `TEXTO_LEGAL` v1.

- [x] **Step 1: Test de seed idempotente**

```ts
it('siembra una vez y no duplica al repetir', async () => {
  await runSeed(pool);
  await runSeed(pool);
  const [{ n }] = await query<{ n: number }>('SELECT COUNT(*) n FROM APARTAMENTO');
  expect(n).toBe(12);
  const [{ z }] = await query<{ z: number }>('SELECT COUNT(*) z FROM ZONA');
  expect(z).toBe(5);
});
```

- [x] **Step 2: Verlo fallar.** Run: `npx vitest run tests/seed.test.ts` → FAIL.

- [x] **Step 3: Implementar** `runSeed` con `INSERT ... ON DUPLICATE KEY UPDATE` o comprobación previa por clave natural. Horarios: BBQ 10:00–22:00 con bloques de 240; PISCINA/GIMNASIO/CANCHA/JUEGOS 08:00–20:00 con bloques de 120. Todas las zonas con `max_cupos_reserva = 4` y `aforo` entre 8 y 20.

- [x] **Step 4: Verificar.** Run: `npx vitest run tests/seed.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/db/seed.ts src/db/seed-cli.ts tests/seed.test.ts
git commit -m "feat: seed de demostracion"
```

---

### Task 4: Configuración, errores y criptografía

**Files:**
- Create: `src/config/env.ts`, `src/lib/errors.ts`, `src/lib/crypto.ts`, `src/lib/types.ts`, `src/middleware/error.ts`, `tests/lib.test.ts`

**Interfaces:**
- Produces:
  - `parseEnv(raw: NodeJS.ProcessEnv): Env`, `env: Env` con `Env = { DATABASE_URL: string; SESSION_SECRET: string; NODE_ENV: 'development'|'test'|'production'; PORT: number; TEST_DATABASE_URL?: string }` (zod, falla al arrancar si falta algo)
  - `AppError` (`status`, `code`), `ValidationError(400)`, `UnauthorizedError(401)`, `ForbiddenError(403)`, `NotFoundError(404)`, `ConflictError(409)`
  - `type Rol = 'RESIDENTE' | 'ADMINISTRADOR' | 'VIGILANTE'` en `src/lib/types.ts`
  - `generarToken(): string` (32 bytes base64url), `hashToken(t: string): string` (sha256 hex)
  - `hashPassword(p: string): Promise<string>`, `verifyPassword(hash: string, p: string): Promise<boolean>`
  - `errorHandler(err, req, res, next)` — mapea `AppError` a `{ error: { code, message } }`; en producción no filtra stack
  - `derivarCsrf(sessionToken: string, secret: string): string` — HMAC-SHA256 en hex

- [x] **Step 1: Tests**

```ts
it('rechaza un env sin DATABASE_URL', () => {
  expect(() => parseEnv({})).toThrow();
});
it('hashToken es determinista y no reversible en el valor', () => {
  expect(hashToken('abc')).toBe(hashToken('abc'));
  expect(hashToken('abc')).not.toContain('abc');
});
it('AppError 409 se serializa como conflicto', async () => {
  const res = await request(createApp()).get('/_test/conflict');
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('CONFLICTO');
});
```

- [x] **Step 2: Verlo fallar.** Run: `npx vitest run tests/lib.test.ts` → FAIL.

- [x] **Step 3: Implementar** los cuatro archivos. La ruta `/_test/conflict` existe solo cuando `NODE_ENV === 'test'`.

- [x] **Step 4: Verificar.** Run: `npx vitest run tests/lib.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/config src/lib src/middleware/error.ts tests/lib.test.ts
git commit -m "feat: configuracion, errores y utilidades criptograficas"
```

---

### Task 5: UI base y navegación por rol

**Files:**
- Create: `src/views/layout.ejs`, `src/views/partials/nav.ejs`, `src/views/partials/flash.ejs`, `src/views/errors/404.ejs`, `src/views/errors/500.ejs`, `src/public/styles.css`, `src/middleware/flash.ts`, `tests/ui.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `res.locals.usuario` (o `null`), `req.flash(tipo, mensaje)`, `res.render` con `layout`; nav que muestra solo enlaces permitidos por rol.

- [x] **Step 1: Test de render**

```ts
it('el layout no muestra /admin a un residente', async () => {
  // en NODE_ENV=test, /_test/layout?rol=RESIDENTE inyecta res.locals.usuario
  const res = await request(createApp()).get('/_test/layout?rol=RESIDENTE');
  expect(res.status).toBe(200);
  expect(res.text).not.toContain('/admin/zonas');
  expect(res.text).toContain('/mis-reservas');
});
```

- [x] **Step 2: Verlo fallar.** → FAIL.

- [x] **Step 3: Implementar** layout con `<!doctype html>`, `lang="es"`, `meta viewport`, salto al contenido, CSS con variables, foco visible y contraste ≥ 4.5:1. Si `usuario && !usuario.correoVerificado`, el layout muestra un aviso persistente "Tu correo no está verificado"; el enlace de verificación se escribe en el log hasta que Task 6 lo implemente. La ruta `/_test/layout` solo existe con `NODE_ENV === 'test'` y sirve para probar el render sin depender del login (que llega en Task 7). HTMX por CDN local en `src/public/htmx.min.js` (descargado una vez, no en runtime).

- [x] **Step 4: Verificar.** → PASS.

- [x] **Step 5: Commit**

```bash
git add src/views src/public src/middleware/flash.ts tests/ui.test.ts
git commit -m "feat: layout base y navegacion por rol"
```

---

### Task 6: Registro con invitación

**Files:**
- Create: `src/modules/auth/repository.ts`, `src/modules/auth/service.ts`, `src/modules/auth/routes.ts`, `src/views/auth/registro.ejs`, `tests/auth-registro.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `type Usuario = { id: string; nombre: string; correo: string; rol: Rol; estado: 'PENDIENTE'|'ACTIVA'|'DESACTIVADA'|'BAJA'; apartamentoId: string | null; correoVerificado: boolean }`; `registrarConInvitacion(token: string, datos: { nombre: string; correo: string; password: string }): Promise<Usuario>` — transacción: valida invitación `VIGENTE` y `vence_en > now`, crea `USUARIO` (`ACTIVA`, `correo_verificado = 0`), marca invitación `USADA` con `usada_en` y `usuario_id`, crea `AUTORIZACION_DATOS` con el `TEXTO_LEGAL` `AUTORIZACION` vigente, y crea `TOKEN_VERIFICACION` tipo `VERIFICAR_CORREO` con `vence_en = now + 24h` escribiendo el enlace en `console.info`.
- `verificarCorreo(token: string): Promise<void>` — marca `correo_verificado = 1` y el token como usado; idempotente mientras no esté vencido.
- Rutas: `GET /registro/:token`, `POST /registro/:token`, `GET /verificar/:token`.

- [x] **Step 1: Tests**

```ts
it('registra con invitación vigente y la marca usada', async () => { /* 302 a /login, USUARIO ACTIVA, INVITACION USADA */ });
it('rechaza invitación vencida', async () => { /* 400, mensaje */ });
it('rechaza invitación ya usada', async () => { /* 400 */ });
it('rechaza correo duplicado', async () => { /* 400 */ });
it('rechaza contraseña de menos de 8 caracteres', async () => { /* 400 */ });
it('el registro crea TOKEN_VERIFICACION y GET /verificar/:token marca el correo', async () => {
  // tras registrar: 1 fila VERIFICAR_CORREO; GET /verificar/<token> -> 302; correo_verificado = 1
});
```

Los tests insertan la `INVITACION` directamente con SQL y un `token_hash` conocido; la UI de invitaciones llega en Task 10b.

- [x] **Step 2: Verlo fallar.** → FAIL.

- [x] **Step 3: Implementar** servicio y rutas con `zod` (`nombre` 2–120, `correo` email, `password` ≥ 8). Mensajes de error en español. El registro con invitación sí puede decir que el correo ya está en uso: la invitación prueba que el alta es legítima.

- [x] **Step 4: Verificar.** → PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/auth tests/auth-registro.test.ts
git commit -m "feat: registro con invitacion de un solo uso"
```

---

### Task 7: Login, logout y sesiones

**Files:**
- Create: `src/modules/auth/sessions.ts`, `src/modules/auth/login-routes.ts`, `src/views/auth/login.ejs`, `tests/auth-login.test.ts`
- Modify: `src/modules/auth/service.ts`, `src/app.ts`

**Interfaces:**
- Produces:
  - `crearSesion(usuarioId: string): Promise<{ token: string; sesionId: string }>`
  - `validarSesion(token: string): Promise<UsuarioSesion | null>` — actualiza `ultimo_uso` como máximo una vez por hora
  - `revocarSesion(token: string): Promise<void>`
  - `UsuarioSesion = { id: string; rol: Rol; apartamentoId: string | null; nombre: string; correo: string; correoVerificado: boolean }`
- Cookie `sid`: `httpOnly`, `SameSite=Lax`, `Secure` si `NODE_ENV === 'production'`, `maxAge` 30 días.

- [x] **Step 1: Tests**

```ts
it('login correcto crea SESION y cookie httpOnly', async () => { /* 302, Set-Cookie contiene HttpOnly */ });
it('login incorrecto no revela si el correo existe', async () => { /* mismo mensaje que correo inexistente */ });
it('cinco fallos bloquean la cuenta 15 minutos', async () => { /* sexto intento: 429 con bloqueado_hasta */ });
it('logout revoca la sesion y la cookie ya no sirve', async () => { /* 302 y GET / con esa cookie -> 302 a /login */ });
it('una sesion con mas de 30 dias sin uso no vale', async () => { /* ultimo_uso hace 31 dias -> 302 /login */ });
```

- [x] **Step 2: Verlo fallar.** → FAIL.

- [x] **Step 3: Implementar** con `argon2.verify`, `intentos_fallidos` + `bloqueado_hasta`, y comparación de tiempo constante. Actualizar `ultimo_uso` solo si `TIMESTAMPDIFF(MINUTE, ultimo_uso, UTC_TIMESTAMP()) >= 60`.

- [x] **Step 4: Verificar.** → PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/auth tests/auth-login.test.ts
git commit -m "feat: login, logout y sesiones persistentes"
```

---

### Task 8: Middleware de autenticación, roles y CSRF

**Files:**
- Create: `src/middleware/auth.ts`, `src/middleware/require-role.ts`, `src/middleware/csrf.ts`, `tests/middleware.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `requireAuth`, `requireRole(...roles: Rol[])`, `attachUsuario` (lee cookie `sid`, pone `res.locals.usuario`), `csrfProtection` (inyecta `res.locals.csrfToken = derivarCsrf(token, SESSION_SECRET)` y valida el campo `_csrf` en todo `POST`).
- `GET /` redirige según rol: `RESIDENTE` → `/reservar`, `ADMINISTRADOR` → `/admin/zonas`, `VIGILANTE` → `/vigilancia`.

- [x] **Step 1: Tests**

```ts
it('sin sesion, GET / devuelve 302 a /login', async () => {});
it('GET / redirige a cada rol a su inicio', async () => {
  // cookie de residente -> /reservar; admin -> /admin/zonas; vigilante -> /vigilancia
});
it('un residente recibe 403 en POST /admin/zonas', async () => {});
it('un POST sin token CSRF se rechaza con 403', async () => {});
it('con sesion revocada a mitad de un POST responde 401 y redirige a /login', async () => {
  // Review Focus 5: la cookie existe pero SESION.revocada_en no es NULL
  const res = await request(createApp()).post('/reservas').set('Cookie', cookieRevocada).send({});
  expect(res.status).toBe(401);
  expect(res.headers.location).toBe('/login');
});
```

- [x] **Step 2: Verlo fallar.** → FAIL.

- [x] **Step 3: Implementar** CSRF como `derivarCsrf(token_de_sesión, SESSION_SECRET)` comparado en tiempo constante contra el campo `_csrf`. Excluir `GET/HEAD/OPTIONS` y las rutas públicas de login/registro/recuperación. Para peticiones de navegador sin sesión, `requireAuth` responde 302 a `/login`; para peticiones `Accept: application/json`, 401.

- [x] **Step 4: Verificar.** → PASS.

- [x] **Step 5: Commit**

```bash
git add src/middleware tests/middleware.test.ts
git commit -m "feat: autenticacion, roles y proteccion CSRF"
```

---

### Task 9: Recuperación de contraseña

**Files:**
- Create: `src/modules/auth/recovery.ts`, `src/views/auth/recuperar.ejs`, `src/views/auth/restablecer.ejs`, `tests/auth-recovery.test.ts`

**Interfaces:**
- Produces: `solicitarRecuperacion(correo: string): Promise<string | null>` (devuelve el token en claro solo para el log), `restablecerPassword(token: string, nueva: string): Promise<void>` — `TOKEN_VERIFICACION` tipo `RESTABLECER_PASSWORD`, vence en 1 hora, un solo uso.

- [ ] **Step 1: Tests**

```ts
it('correo inexistente responde igual que uno existente', async () => { /* 200 con el mismo mensaje */ });
it('token válido cambia el hash y queda usado', async () => { /* login con la nueva funciona */ });
it('token caducado o usado se rechaza', async () => { /* 400 */ });
```

- [ ] **Step 2: Verlo fallar**

Run: `npx vitest run tests/auth-recovery.test.ts`
Expected: FAIL — no existe `src/modules/auth/recovery`.

- [ ] **Step 3: Implementar** `solicitarRecuperacion` y `restablecerPassword`; el "envío" es `console.info` del enlace y la ruta nunca devuelve el token en la respuesta HTTP.

- [ ] **Step 4: Verificar**

Run: `npx vitest run tests/auth-recovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth tests/auth-recovery.test.ts
git commit -m "feat: recuperacion de contrasena por token"
```

---

### Task 10: Configuración de zonas y horarios (admin)

**Files:**
- Create: `src/modules/zonas/repository.ts`, `src/modules/zonas/service.ts`, `src/modules/zonas/routes.ts`, `src/views/admin/zonas.ejs`, `src/views/admin/zona-form.ejs`, `tests/zonas.test.ts`
- Create (compartido): `src/modules/auditoria/service.ts`

**Interfaces:**
- Produces:
  - `type HorarioZona = { diaSemana: 1|2|3|4|5|6|7; apertura: string; cierre: string }`
  - `type Zona = { id: string; nombre: string; aforo: number; duracionBloqueMin: number; maxCuposReserva: number; activa: boolean; horarios: HorarioZona[] }`
  - `type ZonaInput = { nombre: string; aforo: number; duracionBloqueMin: number; maxCuposReserva: number; activa: boolean; horarios: HorarioZona[] }`
  - `listarZonas(): Promise<Zona[]>`, `crearZona(input: ZonaInput): Promise<Zona>`, `actualizarZona(id: string, input: ZonaInput): Promise<Zona>`
  - `validarHorario(apertura: string, cierre: string, duracionMin: number): void` — lanza `ValidationError` si `(cierre - apertura) % duracionMin !== 0` o `cierre <= apertura`
  - `registrarAuditoria(conn: PoolConnection, entrada: { usuarioId: string; accion: string; entidad: string; entidadId: string; detalle?: unknown }): Promise<void>`
- Rutas: `GET /admin/zonas`, `GET/POST /admin/zonas/nueva`, `GET/POST /admin/zonas/:id`.

- [x] **Step 1: Tests**

```ts
it('rechaza cierre que no es multiplo de la duracion', async () => { /* 400 */ });
it('crea zona y escribe BITACORA', async () => { /* 302, fila en ZONA, fila en BITACORA con accion='zona.crear' */ });
it('desactivar zona no borra sus reservas', async () => { /* activa=0, RESERVA intacta */ });
it('cambiar la duracion del bloque no reescribe reservas existentes', async () => { /* RESERVA.hora_fin conserva el valor original */ });
```

- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/zonas.test.ts`
Expected: FAIL — no existe `src/modules/zonas`.

- [x] **Step 3: Implementar** `src/modules/zonas/*` con `requireRole('ADMINISTRADOR')`; los horarios se guardan en `HORARIO_ZONA` dentro de la misma transacción de la zona y cada cambio llama a `registrarAuditoria`.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/zonas.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/zonas src/modules/auditoria src/views/admin tests/zonas.test.ts
git commit -m "feat: configuracion de zonas y horarios"
```

---

### Task 10b: Apartamentos, invitaciones y desactivación de cuentas (admin)

Sin esta tarea no hay forma de crear una invitación desde la aplicación, y sin invitación no hay registro. Va después de Task 10 porque usa `registrarAuditoria`.

**Files:**
- Create: `src/modules/apartamentos/repository.ts`, `src/modules/apartamentos/service.ts`, `src/modules/apartamentos/routes.ts`, `src/modules/invitaciones/repository.ts`, `src/modules/invitaciones/service.ts`, `src/modules/invitaciones/routes.ts`, `src/modules/usuarios/routes.ts`, `src/views/admin/apartamentos.ejs`, `src/views/admin/invitaciones.ejs`, `src/views/admin/usuarios.ejs`, `tests/apartamentos.test.ts`, `tests/invitaciones.test.ts`, `tests/usuarios-admin.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces:
  - `listarApartamentos(): Promise<Apartamento[]>`, `crearApartamento(input: { torreInterior: string; numero: string }): Promise<Apartamento>`, `actualizarApartamento(id: string, input: { torreInterior: string; numero: string }): Promise<Apartamento>`, `eliminarApartamento(id: string): Promise<void>`
  - `type Apartamento = { id: string; torreInterior: string; numero: string; creadoEn: string }`
  - `crearInvitacion(apartamentoId: string, actor: UsuarioSesion): Promise<{ token: string; invitacionId: string; venceEn: string }>` — token de 32 bytes, en BD solo `SHA-256`, vigencia 7 días, enlace en `console.info`
  - `revocarInvitacion(invitacionId: string, actor: UsuarioSesion): Promise<void>`
  - `listarUsuarios(): Promise<Usuario[]>`, `desactivarUsuario(usuarioId: string, actor: UsuarioSesion): Promise<void>` — estado `DESACTIVADA`, revoca sus `SESION` y deja `BITACORA`. Rechaza desactivarse a sí mismo y dejar el sistema sin administradores activos.
  - Rutas: `GET/POST /admin/apartamentos`, `GET/POST /admin/apartamentos/:id`, `POST /admin/apartamentos/:id/eliminar`, `GET/POST /admin/invitaciones`, `POST /admin/invitaciones/:id/revocar`, `GET /admin/usuarios`, `POST /admin/usuarios/:id/desactivar`.

- [x] **Step 1: Tests**

```ts
it('crea un apartamento y rechaza torre+numero duplicado', async () => { /* 302 + fila; segundo intento 409 */ });
it('no elimina un apartamento con usuarios o reservas', async () => { /* 409 y el apartamento sigue */ });
it('crea una invitación y devuelve el token una sola vez', async () => { /* 302; INVITACION.token_hash !== token; GET /registro/:token -> 200 */ });
it('una invitación revocada no permite registrarse', async () => { /* GET/POST /registro/:token -> 400 */ });
it('desactivar un usuario revoca sus sesiones y deja BITACORA', async () => { /* estado DESACTIVADA; cookie vieja -> 302 /login; accion='usuario.desactivar' */ });
it('un residente recibe 403 en /admin/usuarios y /admin/invitaciones', async () => {});
```

- [x] **Step 2: Verlo fallar.** Run: `npx vitest run tests/apartamentos.test.ts tests/invitaciones.test.ts tests/usuarios-admin.test.ts` → FAIL.

- [x] **Step 3: Implementar** con `requireRole('ADMINISTRADOR')`. La invitación se muestra en pantalla **una sola vez** (el token en claro no se recupera); la lista muestra solo estado y vencimiento. Toda acción llama a `registrarAuditoria` con `detalle` sin tokens ni hashes.

- [x] **Step 4: Verificar.** Run: `npx vitest run tests/apartamentos.test.ts tests/invitaciones.test.ts tests/usuarios-admin.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/apartamentos src/modules/invitaciones src/modules/usuarios src/views/admin tests/apartamentos.test.ts tests/invitaciones.test.ts tests/usuarios-admin.test.ts
git commit -m "feat: apartamentos, invitaciones y desactivacion de cuentas"
```

---

### Task 11: Parámetros de reserva

**Files:**
- Create: `src/modules/zonas/parametros.ts`, `src/views/admin/parametros.ejs`, `tests/parametros.test.ts`

**Interfaces:**
- Produces: `type Parametros = { maxReservasSemana: number; maxReservasDia: number; anticipacionDias: number }`; `obtenerParametros(): Promise<Parametros>`, `actualizarParametros(p: Parametros, actorId: string): Promise<void>`.

- [x] **Step 1: Test** — `POST /admin/parametros` con `maxReservasDia > maxReservasSemana` devuelve 400 y no cambia la fila; un cambio válido persiste y deja `BITACORA` con `accion='parametros.actualizar'`.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/parametros.test.ts`
Expected: FAIL — no existe `src/modules/zonas/parametros.ts`.

- [x] **Step 3: Implementar** `obtenerParametros`/`actualizarParametros` sobre la fila única `PARAMETRO_RESERVA` y la ruta `GET/POST /admin/parametros` con `requireRole('ADMINISTRADOR')`.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/parametros.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/zonas/parametros.ts src/views/admin/parametros.ejs tests/parametros.test.ts
git commit -m "feat: parametros de reserva configurables"
```

---

### Task 12: Disponibilidad por bloque

**Files:**
- Create: `src/modules/reservas/bloques.ts`, `src/modules/reservas/disponibilidad.ts`, `src/modules/reservas/disponibilidad-routes.ts`, `src/views/reservas/elegir-zona.ejs`, `src/views/reservas/disponibilidad.ejs`, `tests/disponibilidad.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces:
  - `generarBloques(apertura: string, cierre: string, duracionMin: number): { horaInicio: string; horaFin: string }[]`
  - `obtenerDisponibilidad(zonaId: string, fecha: string): Promise<BloqueDisponible[]>`
  - `type BloqueDisponible = { horaInicio: string; horaFin: string; aforo: number; cuposDisponibles: number }`
  - Rutas: `GET /reservar` (lista de zonas activas), `GET /reservar/:zonaId/:fecha` (bloques del día).

- [x] **Step 1: Tests**

```ts
it('genera bloques de 120 minutos entre 08:00 y 20:00', () => {
  expect(generarBloques('08:00', '20:00', 120)).toHaveLength(6);
});
it('devuelve lista vacía si la zona no tiene horario ese día', async () => {
  // Review Focus 2
  const r = await obtenerDisponibilidad(zonaSinHorario, '2026-11-14');
  expect(r).toEqual([]);
});
it('descuenta los cupos ya ocupados', async () => {
  // aforo 10, OCUPACION_BLOQUE.cupos_ocupados = 4 -> el bloque devuelve cuposDisponibles = 6
});
it('GET /reservar/:zona/:fecha muestra solo bloques con cupos disponibles', async () => {
  // zona con horario, 200, aparece la hora del bloque y no un bloque lleno
});
```

- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/disponibilidad.test.ts`
Expected: FAIL — no existe `src/modules/reservas/bloques`.

- [x] **Step 3: Implementar** `generarBloques`, `obtenerDisponibilidad` (consulta a `HORARIO_ZONA` por `dia_semana` y `LEFT JOIN OCUPACION_BLOQUE`) y las vistas de elegir zona y bloques.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/disponibilidad.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/reservas src/views/reservas tests/disponibilidad.test.ts
git commit -m "feat: calculo de disponibilidad por bloque"
```

---

### Task 13: Reserva con cupos y concurrencia (núcleo)

**Files:**
- Create: `src/modules/reservas/repository.ts`, `src/modules/reservas/service.ts`, `src/modules/reservas/routes.ts`, `src/views/reservas/confirmar.ejs`, `tests/helpers/fixtures.ts`, `tests/reservas.test.ts`, `tests/concurrencia.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces:
  - `type EstadoReserva = 'CONFIRMADA' | 'CANCELADA' | 'VENCIDA'`
  - `type Reserva = { id: string; apartamentoId: string; zonaId: string; fecha: string; horaInicio: string; horaFin: string; cupos: number; estado: EstadoReserva; creadaEn: string }`
  - `crearReserva(usuario: UsuarioSesion, input: { zonaId: string; fecha: string; horaInicio: string; cupos: number }): Promise<Reserva>`
  - `tests/helpers/fixtures.ts`: `crearUsuarioConApartamento(rol, numero): Promise<UsuarioSesion>`, `crearZonaConAforo(aforo: number, duracionMin: number): Promise<Zona>`, `postReserva(usuario, body)` (supertest con cookie de sesión; completa `zonaId`, `fecha` y `horaInicio` con el contexto del test de concurrencia).
- Reglas: zona activa; `fecha` entre hoy y hoy + `anticipacion_dias`; bloque existe en `HORARIO_ZONA` del día; `1 <= cupos <= max_cupos_reserva`; cupos ≤ aforo; límites día/semana del apartamento (no canceladas); **no puede existir otra reserva no cancelada del mismo apartamento en la misma zona+fecha+hora_inicio**.

- [x] **Step 1: Tests de reglas**

```ts
it('crea la reserva y la deja CONFIRMADA', async () => { /* 201 */ });
it('devuelve 409 cuando no hay cupo', async () => { /* aforo 10, ya hay 9, pide 2 */ });
it('rechaza bloque fuera del horario', async () => { /* 400 */ });
it('rechaza fecha fuera de la anticipación', async () => { /* 400 */ });
it('rechaza el cuarto bloque en el mismo día', async () => { /* max_reservas_dia = 3 -> 409 */ });
it('rechaza cupos 0, negativos, mayores que max_cupos_reserva o que el aforo', async () => {
  // Review Focus 3: max_cupos_reserva = 4, aforo = 10
  for (const cupos of [0, -1, 5, 11]) {
    const res = await postReserva(usuario, { zonaId, fecha, horaInicio: '10:00', cupos });
    expect(res.status).toBe(400);
  }
  // ninguna RESERVA creada y cupos_ocupados = 0
});
it('rechaza el doble submit en el mismo bloque', async () => {
  // Review Focus 1
  const usuario = await crearUsuarioConApartamento('RESIDENTE', '101');
  await crearReserva(usuario, { zonaId, fecha, horaInicio: '10:00', cupos: 2 });
  await expect(crearReserva(usuario, { zonaId, fecha, horaInicio: '10:00', cupos: 2 }))
    .rejects.toMatchObject({ status: 409 });
  // una sola RESERVA no cancelada y cupos_ocupados = 2 (el rollback revirtió el segundo incremento)
});
it('revalida el aforo cambiado después del GET', async () => {
  // Review Focus 4: GET ve aforo 10; se baja el aforo a 1; POST de 2 cupos -> 409
  await query('UPDATE ZONA SET aforo = 1 WHERE id = ?', [zonaId]);
  await expect(crearReserva(usuario, { zonaId, fecha, horaInicio: '10:00', cupos: 2 }))
    .rejects.toMatchObject({ status: 409 });
  // las reservas ya creadas siguen CONFIRMADA y el contador no cambió
});
```

- [x] **Step 2: Test de concurrencia (debe fallar con la implementación ingenua)**

El setup crea **20 usuarios en 20 apartamentos distintos** (el límite es por apartamento y el duplicado es por apartamento; con menos apartamentos el test mediría otra cosa), una zona con aforo 10 y un bloque de 10:00.

```ts
it('20 reservas simultáneas de 2 cupos sobre aforo 10: exactamente 5 exitosas', async () => {
  const respuestas = await Promise.all(
    Array.from({ length: 20 }, (_, i) => postReserva(usuarios[i], { cupos: 2 }))
  );
  expect(respuestas.filter(r => r.status === 201)).toHaveLength(5);
  expect(respuestas.filter(r => r.status === 409)).toHaveLength(15);
  const [{ total }] = await query<{ total: number }>(
    'SELECT cupos_ocupados total FROM OCUPACION_BLOQUE WHERE zona_id=? AND fecha=? AND hora_inicio=?',
    [zonaId, fecha, '10:00']
  );
  expect(total).toBe(10);
});
```

- [x] **Step 3: Implementar la transacción del diseño §9.2**

```
START TRANSACTION
  INSERT INTO OCUPACION_BLOQUE (zona_id, fecha, hora_inicio, cupos_ocupados) VALUES (?,?,?,0)
    ON DUPLICATE KEY UPDATE zona_id = zona_id
  UPDATE OCUPACION_BLOQUE SET cupos_ocupados = cupos_ocupados + ?
   WHERE zona_id=? AND fecha=? AND hora_inicio=?
     AND cupos_ocupados + ? <= (SELECT aforo FROM ZONA WHERE id=? AND activa=1)
  -- affectedRows === 0 -> ROLLBACK + ConflictError
  -- con el lock de la fila ya tomado, comprobar duplicado con lectura bloqueante:
  SELECT id FROM RESERVA
   WHERE apartamento_id=? AND zona_id=? AND fecha=? AND hora_inicio=? AND estado <> 'CANCELADA'
   FOR UPDATE
  -- si existe -> ROLLBACK + ConflictError
  INSERT INTO RESERVA (...)
COMMIT
```

El chequeo de duplicado va **después** del `UPDATE` y usa `FOR UPDATE` (lectura del último estado comprometido, no del snapshot de la transacción); por eso dos POST simultáneos del mismo apartamento se serializan sobre la misma fila de `OCUPACION_BLOQUE` y el segundo ve la reserva del primero. Si el duplicado se detecta, el `ROLLBACK` revierte también el incremento del contador.

Si MariaDB responde `1213` (deadlock) al insertar la fila del bloque, la transacción se reintenta **una vez** con un `ROLLBACK` previo; si vuelve a fallar, responde 409. Sin este reintento, el test de 20 peticiones puede producir un 5xx esporádico.

- [x] **Step 4: Verificar.** Run: `npx vitest run tests/reservas.test.ts tests/concurrencia.test.ts` → PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/reservas src/views/reservas tests/helpers/fixtures.ts tests/reservas.test.ts tests/concurrencia.test.ts
git commit -m "feat: reserva de bloques con control de aforo concurrente"
```

---

### Task 14: Cancelación

**Files:**
- Create: `src/modules/reservas/cancelacion.ts`, `src/views/reservas/mis-reservas.ejs`, `tests/cancelacion.test.ts`
- Modify: `src/modules/reservas/routes.ts`

**Interfaces:**
- Produces: `cancelarReserva(usuario: UsuarioSesion, reservaId: string, motivo?: string): Promise<void>` — permitido si es `RESIDENTE` del mismo apartamento o `ADMINISTRADOR`; no permitido si `VENCIDA`; si ya estaba `CANCELADA`, lanza `ConflictError(409)` sin volver a restar cupos. Si el actor es `ADMINISTRADOR`, deja `BITACORA` con `accion='reserva.cancelar_admin'`.

- [x] **Step 1: Tests**

```ts
it('cancelar devuelve los cupos al bloque', async () => { /* contador baja exactamente cupos */ });
it('cancelar dos veces no resta dos veces', async () => { /* segundo POST 409; contador igual al de la primera cancelación */ });
it('un residente no puede cancelar la reserva de otro apartamento', async () => { /* 403 */ });
it('un administrador si puede cancelar una reserva ajena y deja BITACORA', async () => { /* 302/204; estado CANCELADA; accion='reserva.cancelar_admin' */ });
it('no se puede cancelar una reserva VENCIDA', async () => { /* 409 */ });
it('cancelaciones simultáneas nunca dejan el contador negativo', async () => {
  // 5 reservas de 2 cupos, 10 cancelaciones concurrentes -> cupos_ocupados = 0
});
```

- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/cancelacion.test.ts`
Expected: FAIL — no existe `src/modules/reservas/cancelacion.ts`.

- [x] **Step 3: Implementar** la transacción §9.2 inversa: `UPDATE RESERVA ... WHERE estado='CONFIRMADA'`; si afecta 0 filas, `ConflictError`; si afecta 1, `UPDATE OCUPACION_BLOQUE ... - cupos` y auditoría cuando corresponde.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/cancelacion.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/reservas tests/cancelacion.test.ts
git commit -m "feat: cancelacion con devolucion de cupos"
```

---

### Task 15: Historial y supervisión del administrador

**Files:**
- Create: `src/views/reservas/historial.ejs`, `src/views/admin/reservas.ejs`, `src/modules/reservas/consultas.ts`, `tests/consultas.test.ts`
- Modify: `src/modules/reservas/routes.ts`

**Interfaces:**
- Produces: `historialDe(apartamentoId: string): Promise<Reserva[]>` (orden descendente por fecha y hora), `listarReservas(filtros: { desde?: string; hasta?: string; zonaId?: string; estado?: EstadoReserva }): Promise<ReservaConApartamento[]>` con `type ReservaConApartamento = Reserva & { torreInterior: string; numero: string; zonaNombre: string }`.

- [x] **Step 1: Tests** — el historial solo muestra reservas del propio apartamento (200 y el HTML no contiene la reserva de otro); el admin ve todas y el filtro por zona y estado reduce la lista; un residente recibe 403 en `/admin/reservas`.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/consultas.test.ts`
Expected: FAIL — no existe `src/modules/reservas/consultas.ts`.

- [x] **Step 3: Implementar** `historialDe` y `listarReservas` con SQL parametrizado y las vistas `historial.ejs` y `admin/reservas.ejs`.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/consultas.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/reservas src/views tests/consultas.test.ts
git commit -m "feat: historial de residente y supervision administrativa"
```

---

### Task 16: Vista de vigilancia (solo lectura)

**Files:**
- Create: `src/modules/reservas/vigilancia.ts`, `src/views/vigilancia/hoy.ejs`, `tests/vigilancia.test.ts`

**Interfaces:**
- Produces: `reservasDelDia(fecha: string): Promise<{ apartamento: string; zona: string; horaInicio: string; horaFin: string; cupos: number }[]>`.

- [x] **Step 1: Tests** — `VIGILANTE` ve la lista; un `POST` del vigilante a cualquier ruta de escritura devuelve 403; un `RESIDENTE` no entra.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/vigilancia.test.ts`
Expected: FAIL — no existe `src/modules/reservas/vigilancia.ts`.

- [x] **Step 3: Implementar** `reservasDelDia` y la vista de solo lectura; la ruta exige `requireRole('VIGILANTE','ADMINISTRADOR')` y no registra formularios de escritura.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/vigilancia.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/reservas/vigilancia.ts src/views/vigilancia tests/vigilancia.test.ts
git commit -m "feat: vista de vigilancia de solo lectura"
```

---

### Task 17: Notificaciones in-app y despachador

**Files:**
- Create: `src/modules/notificaciones/repository.ts`, `src/modules/notificaciones/service.ts`, `src/modules/notificaciones/dispatcher.ts`, `src/modules/notificaciones/routes.ts`, `src/views/notificaciones/bandeja.ejs`, `tests/notificaciones.test.ts`
- Modify: `src/modules/reservas/service.ts` (crear notificación al confirmar), `src/modules/reservas/cancelacion.ts`

**Interfaces:**
- Produces:
  - `type TipoNotificacion = 'CONFIRMACION' | 'CANCELACION' | 'RECORDATORIO'`
  - `type Canal = 'CORREO' | 'PUSH'`
  - `type Envio = { id: string; notificacionId: string; canal: Canal; intentos: number }`
  - `crearNotificacion(conn: PoolConnection, input: { usuarioId: string; reservaId?: string; tipo: TipoNotificacion; titulo: string; mensaje: string }): Promise<void>`
  - `notificarApartamento(conn: PoolConnection, apartamentoId: string, input: { reservaId?: string; tipo: TipoNotificacion; titulo: string; mensaje: string }): Promise<void>` — a todos los `USUARIO` activos del apartamento; crea una `ENVIO_NOTIFICACION` por cada canal `CORREO` y `PUSH`
  - `interface CanalEnvio { canal: Canal; enviar(envio: Envio): Promise<void> }`
  - `despacharPendientes(canal: CanalEnvio, limite?: number): Promise<{ enviados: number; fallidos: number }>` — máximo 3 intentos, luego `FALLIDO`
  - `despachadorConsola: CanalEnvio` (escribe en `console.info`)

- [x] **Step 1: Tests** — confirmar crea una `NOTIFICACION` por residente activo y una `ENVIO_NOTIFICACION` por canal; el despachador marca `ENVIADO`; con un canal que falla 3 veces queda `FALLIDO` y `intentos = 3`; la bandeja solo muestra las del usuario y marca leídas.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/notificaciones.test.ts`
Expected: FAIL — no existe `src/modules/notificaciones`.

- [x] **Step 3: Implementar** `crearNotificacion`, `notificarApartamento`, el despachador con reintentos y la bandeja; conectar la creación de notificaciones a `crearReserva` y `cancelarReserva`.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/notificaciones.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/notificaciones src/modules/reservas src/views/notificaciones tests/notificaciones.test.ts
git commit -m "feat: notificaciones in-app con despachador y reintentos"
```

---

### Task 18: Jobs: recordatorios, vencidas y limpieza

**Files:**
- Create: `src/jobs/index.ts`, `src/jobs/vencidas.ts`, `src/jobs/recordatorios.ts`, `src/jobs/limpieza.ts`, `tests/jobs.test.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Produces:
  - `marcarVencidas(ahora?: Date): Promise<number>` — `CONFIRMADA → VENCIDA` si terminó el bloque; no toca `OCUPACION_BLOQUE`
  - `crearRecordatorios(ahora?: Date): Promise<number>` — reservas que empiezan en 55–65 minutos
  - `limpiarSesionesExpiradas(ahora?: Date): Promise<number>`, `limpiarBitacoraAntigua(ahora?: Date): Promise<number>` (12 meses)

- [x] **Step 1: Tests** con fechas inyectadas (sin esperar al reloj): una reserva de ayer pasa a `VENCIDA` y el contador **no** cambia; una de dentro de una hora genera `RECORDATORIO`; una sesión de hace 31 días se borra.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/jobs.test.ts`
Expected: FAIL — no existe `src/jobs`.

- [x] **Step 3: Implementar** los cuatro jobs con el reloj inyectable y registrarlos en `src/jobs/index.ts` con `node-cron` (vencidas cada 15 min, recordatorios cada 5 min, limpieza diaria).

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/jobs.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/jobs src/server.ts tests/jobs.test.ts
git commit -m "feat: jobs de vencimiento, recordatorios y limpieza"
```

---

### Task 19: Estadísticas

**Files:**
- Create: `src/modules/estadisticas/queries.ts`, `src/modules/estadisticas/routes.ts`, `src/views/admin/estadisticas.ejs`, `tests/estadisticas.test.ts`

**Interfaces:**
- Produces:
  - `ocupacionPorBloque(desde: string, hasta: string): Promise<{ zona: string; fecha: string; horaInicio: string; cupos: number; aforo: number }[]>`
  - `horasPico(desde: string, hasta: string): Promise<{ hora: number; diaSemana: number; reservas: number }[]>`
  - `cancelacionesPorZona(desde: string, hasta: string): Promise<{ zona: string; confirmadas: number; canceladas: number; porcentaje: number }[]>`

- [x] **Step 1: Tests** con datos sembrados: ocupación suma `CONFIRMADA` y `VENCIDA` (todo lo no cancelado); horas pico agrupa por hora y día; el porcentaje de cancelación se calcula sobre `(CONFIRMADA + VENCIDA)` y `CANCELADA`, de modo que una reserva vencida cuenta como uso y no como cancelación.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/estadisticas.test.ts`
Expected: FAIL — no existe `src/modules/estadisticas`.

- [x] **Step 3: Implementar** las tres consultas con rango de fechas y la vista con filtros; la etiqueta de ocupación dice "contra aforo actual".

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/estadisticas.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/estadisticas src/views/admin tests/estadisticas.test.ts
git commit -m "feat: estadisticas de ocupacion, horas pico y cancelaciones"
```

---

### Task 20: Mi cuenta y textos legales

**Files:**
- Create: `src/modules/datos-personales/routes.ts`, `src/modules/datos-personales/service.ts`, `src/views/cuenta/mi-cuenta.ejs`, `tests/cuenta.test.ts`

**Interfaces:**
- Produces: `type TextoLegal = { id: string; tipo: 'AUTORIZACION'|'POLITICA'|'AVISO_PRIVACIDAD'; version: number; contenido: string; vigenteDesde: string }`; `actualizarNombre(usuarioId: string, nombre: string): Promise<void>`; `aceptarPolitica(usuarioId: string, textoLegalId: string): Promise<void>`; `politicaVigente(): Promise<TextoLegal>`.

- [x] **Step 1: Tests** — rectificar nombre persiste y deja `BITACORA`; el formulario de correo no existe (RF-08 fuera); aceptar política crea `AUTORIZACION_DATOS` una sola vez por versión.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/cuenta.test.ts`
Expected: FAIL — no existe `src/modules/datos-personales`.

- [x] **Step 3: Implementar** `actualizarNombre`, `aceptarPolitica`, `politicaVigente` y la vista `/mi-cuenta`; no hay campo de correo (RF-08 fuera).

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/cuenta.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/datos-personales src/views/cuenta tests/cuenta.test.ts
git commit -m "feat: mi cuenta y aceptacion de politica de datos"
```

---

### Task 21: Vista de bitácora

**Files:**
- Create: `src/modules/auditoria/routes.ts`, `src/views/admin/bitacora.ejs`, `tests/bitacora.test.ts`
- Modify: `src/modules/auditoria/service.ts`

**Interfaces:**
- Produces: `type Auditoria = { id: string; usuario: string; accion: string; entidad: string; entidadId: string; detalle: unknown; creadaEn: string }`; `listarAuditoria(filtros: { desde?: string; hasta?: string }): Promise<Auditoria[]>`; `registrarAuditoria` se llama desde zonas, parámetros, invitaciones, cancelación administrativa, desactivación de cuentas y mi cuenta.

- [x] **Step 1: Test** — solo `ADMINISTRADOR`; las acciones de las tareas 10, 10b, 11, 14 y 20 aparecen; el `detalle` nunca contiene `password_hash` ni tokens.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/bitacora.test.ts`
Expected: FAIL — no existe `src/modules/auditoria/routes.ts`.

- [x] **Step 3: Implementar** `listarAuditoria` con filtros de fecha y la vista de solo lectura para el administrador.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/bitacora.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/modules/auditoria src/views/admin tests/bitacora.test.ts
git commit -m "feat: vista de bitacora de auditoria"
```

---

### Task 22: Endurecimiento

**Files:**
- Modify: `src/app.ts`, `src/middleware/auth.ts`, `src/server.ts`
- Create: `tests/seguridad.test.ts`

**Interfaces:**
- Produces: `helmet()` con CSP para HTMX local; `rateLimit` en `/login` (10 intentos / 15 min / IP); cookies `Secure` en producción; arranque que falla si `SESSION_SECRET` mide menos de 32 caracteres.

- [x] **Step 1: Tests** — cabeceras de `helmet` presentes; el intento 11 de login en 15 minutos devuelve 429; `SESSION_SECRET` corto impide arrancar.
- [x] **Step 2: Verlo fallar**

Run: `npx vitest run tests/seguridad.test.ts`
Expected: FAIL — faltan `helmet`, `express-rate-limit` y la validación de secreto.

- [x] **Step 3: Implementar** `helmet` con CSP que permita solo `self` y el HTMX local, `rateLimit` en `/login` y recuperación, cookies `Secure` en producción y `parseEnv` rechazando `SESSION_SECRET` de menos de 32 caracteres.

- [x] **Step 4: Verificar**

Run: `npx vitest run tests/seguridad.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src tests/seguridad.test.ts
git commit -m "feat: endurecimiento de cabeceras, rate limit y secretos"
```

---

### Task 23: Prueba de humo end-to-end y documentación de entrega

**Files:**
- Create: `tests/e2e.test.ts`, `README.md`, `docs/operacion.md`

**Interfaces:**
- Produces: un recorrido completo en un solo test: migrar → seed → login admin → crear invitación → registro de residente → login → ver disponibilidad → reservar → ver notificación → cancelar → ver estadísticas → ver bitácora.

- [ ] **Step 1: Escribir el test e2e** con `supertest` y cookies encadenadas.
- [ ] **Step 2: Verlo fallar** si algo del flujo quedó desconectado.
- [ ] **Step 3: Corregir lo que falte** (sin añadir funcionalidad nueva).
- [ ] **Step 4: Verificar toda la suite**

Run: `npm test`
Expected: todos los archivos en PASS, incluidos `tests/concurrencia.test.ts` y `tests/e2e.test.ts`.

- [ ] **Step 5: README y operación** — requisitos, `docker compose up`, `npm run migrate`, `npm run seed`, credenciales demo, mapa de rutas, decisiones de alcance y trabajo futuro (los recortes del diseño §20).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e.test.ts README.md docs/operacion.md
git commit -m "test: recorrido end-to-end y documentacion de entrega"
```

---

## Cobertura del alcance

| Requisito del diseño | Tarea |
|---|---|
| Pool, transacciones, esquema, índices | 2 |
| Seed y datos demo | 3 |
| Registro con invitación (RF-01, RF-02) | 6 |
| Verificación de correo (RF-05, §10) | 6 |
| Login, sesión, bloqueo (RF-03, RF-10, RF-11) | 7, 8 |
| Recuperación de contraseña (RF-04) | 9 |
| Apartamentos, invitaciones y desactivación de cuentas (RF-09, RF-42) | 10b |
| Zonas, horarios, parámetros (RF-13–16) | 10, 11 |
| Disponibilidad (RF-17) | 12 |
| Reserva con aforo y concurrencia (RF-18–25) | 13 |
| Cancelación e historial (RF-22, RF-23) | 14, 15 |
| Vigilancia (RF-30) | 16 |
| Notificaciones in-app y simulación de envío (RF-26–29) | 17 |
| Recordatorios, vencidas, limpieza | 18 |
| Estadísticas (RF-31–35) | 19 |
| Datos personales mínimos (RF-36–38) | 20 |
| Bitácora (RF-41) | 10, 10b, 11, 14, 20, 21 |
| Seguridad (RNF-08–14) | 7, 8, 22 |
| Pruebas y despliegue (RNF-25–29) | 1, 2, 13, 23 |

## Notas para quien ejecute

- Las tareas 1–9 son secuenciales: cada una usa interfaces de la anterior.
- Las tareas 10, 10b, 11 y 12 pueden ir en paralelo entre sí una vez cerrada la 9; 13 depende de 12. 10b no depende de 13.
- 14–21 dependen de 13. 22–23 van al final.
- Ningún paso autoriza a añadir dependencias fuera de la lista de Global Constraints.
- Si un test de concurrencia falla de forma intermitente, el problema es el aislamiento de la transacción, no el test: revisar que el `UPDATE` y el `INSERT` estén en la **misma** transacción y que no haya un `SELECT` previo fuera de ella.
