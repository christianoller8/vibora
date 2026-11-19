# Víbora

Plataforma para reservar pistas de pádel en clubes y montar partidos abiertos en los que otros jugadores se apuntan.
Backend Spring Boot (REST + JWT + WebSocket STOMP, PostgreSQL) y frontend Angular con Angular Material.

## Qué incluye

- **Reservas:** clubes, pistas, tarifas por franja, agenda por día, reservas sin solapamientos (garantizado por una
  restricción de PostgreSQL) y cancelación con plazo.
- **Partidos abiertos y pagos compartidos:** hasta 4 jugadores por reserva, reparto de la cuota en céntimos, deudas,
  pago simulado y saldos.
- **Notificaciones en tiempo real** por WebSocket (STOMP) con el mismo JWT.
- **Incidencias:** reporte con fotos, estados, historial, asignación al personal de mantenimiento y bloqueo de pistas
  sin tocar las reservas ya hechas.
- **Gestión del club:** personal por email, bloqueos y reservas del día con cancelación del administrador.
- **Solo API, todavía sin pantalla:** facturas (numeración correlativa, IVA, rectificativas, PDF; documentos
  simulados sin validez fiscal), datos fiscales del club y métricas del panel (ingresos, ocupación, franjas, cancelaciones).

## Requisitos

JDK 25, Node 24 (el mismo que usa el flujo de CI; `node --test` con comodines necesita Node 22 o superior) y Docker
Desktop (la base de datos y los tests del backend usan contenedores).

## Arranque en local

```bash
docker compose up -d db                      # PostgreSQL (puerto 15433, solo accesible desde tu máquina)
cd vibora-backend && ./mvnw spring-boot:run  # API en http://localhost:8081
cd vibora-frontend && npm start              # app en http://localhost:4200
```

En Windows, si Docker falla con `bind: An attempt was made to access a socket in a way forbidden by its access
permissions`, el puerto del host cae en un rango reservado por el sistema (`netsh interface ipv4 show
excludedportrange protocol=tcp`; cambia tras reiniciar). Elige otro con `POSTGRES_PORT` (compose) y el mismo valor en
`VIBORA_DB_PORT` (backend).

## Tests

```bash
cd vibora-backend && ./mvnw test                          # necesita Docker (Testcontainers); unos 8 minutos
cd vibora-frontend && npx ng test --watch=false           # Vitest
cd vibora-frontend && npm run test:csp                    # comprueba la política CSP generada
node --test "scripts/lib/*.test.mjs"                      # helper de fechas del script de datos
```

Si Maven falla con un error de certificados (PKIX) detrás de un antivirus, exporta
`MAVEN_OPTS="-Djavax.net.ssl.trustStoreType=Windows-ROOT"` antes de lanzarlo (Windows).

## Stack completo con Docker

Base de datos, backend y frontend (nginx) en contenedores. Los dos últimos viven bajo el perfil `app`, así que el
flujo de desarrollo de arriba no cambia: `docker compose up -d db` sigue levantando solo PostgreSQL.

```bash
cp .env.example .env       # edita .env: pon un VIBORA_JWT_SECRET propio (el fichero explica cómo generarlo)
docker compose --profile app up -d --build
```

La web queda en http://localhost:8088 (cambia el puerto con `FRONTEND_PORT` en `.env`). Nginx sirve la SPA y reenvía
`/api` y `/ws` al backend, que no se publica en el host.

`VIBORA_JWT_SECRET` es obligatorio. Un servicio de comprobación (`comprobar-VIBORA_JWT_SECRET`, solo con el perfil
`app`) corre antes que el backend y aborta el `up` al instante si el secreto está vacío, tiene menos de 32 caracteres o
sigue siendo el marcador `CAMBIAME-...` de `.env.example`:

```text
service "comprobar-VIBORA_JWT_SECRET" didn't complete successfully: exit 1
```

El motivo exacto sale con `docker compose --profile app logs comprobar-VIBORA_JWT_SECRET`. El backend ni se crea (no
hay bucle de reinicios), y `docker compose up -d db` no se ve afectado: no necesita `.env`. Si arrancas el backend
saltándote la comprobación (`--no-deps`), su `ENTRYPOINT` también se niega a arrancar sin secreto.

Si levantaste la app con `docker compose --profile app up -d --build --no-deps backend frontend` y luego paras el
backend, arráncalo de nuevo con `docker start vibora-backend-1` (o repitiendo `up -d --no-deps backend`):
`docker compose start backend` falla con `missing dependency comprobar-VIBORA_JWT_SECRET` porque el servicio de
comprobación nunca llegó a crearse.

```bash
docker compose --profile app stop backend frontend   # para solo la app; la base de datos sigue en marcha
docker compose --profile app up -d --build           # la vuelve a levantar (reconstruye si hay cambios)
```

> No uses `docker compose down -v` si quieres conservar los datos: `-v` borra el volumen `vibora-pgdata` **y**
> `vibora-uploads` (las fotos de las incidencias).

### Fotos de incidencias

Las fotos (JPEG, PNG o WebP, hasta 5 MB y 4 por incidencia) se guardan como ficheros, no en la base de datos, en la
carpeta `vibora.almacen.directorio`:

- **Desarrollo local**: `./data/uploads` relativo a donde arranques el backend (`vibora-backend/data/uploads` con
  `./mvnw spring-boot:run`). La carpeta se crea sola y está en `.gitignore`.
- **Docker**: el servicio `backend` monta el volumen con nombre `vibora-uploads` en `/data/uploads`
  (`VIBORA_ALMACEN_DIRECTORIO`), y la imagen deja esa carpeta a nombre del usuario sin privilegios. Sobrevive a
  `docker compose --profile app up -d --build`; solo `down -v` lo borra. Para copiarlo: `docker run --rm -v
  vibora_vibora-uploads:/datos -v "$PWD":/copia alpine tar czf /copia/uploads.tgz -C /datos .`

Las fotos se recodifican al subirlas (se pierden EXIF y GPS; los WebP se guardan tal cual, con sus metadatos). Se
descargan con `GET /api/incidencias/{id}/fotos/{fotoId}`, que exige el JWT: un `<img src>` no puede enviar la cabecera
`Authorization`, así que el frontend debe pedirlas con `HttpClient` como blob. El nginx del frontend debe permitir
cuerpos de al menos 6 MB en `/api` (`client_max_body_size 6m;`; por defecto nginx corta en 1 MB).

El script de datos de ejemplo también sirve contra este stack (entra por nginx, que es `localhost`):
`node scripts/seed-dev.mjs --base-url http://localhost:8088`.

## Límites y protecciones

Todos los valores son propiedades de `application.properties` (se pueden pisar con variables de entorno). Al superar un
límite de frecuencia la API responde **429** con `{"error": "..."}` y la cabecera **`Retry-After`** (segundos).

| Qué | Propiedad | Por defecto |
|---|---|---|
| Intentos de login por (IP, email) | `vibora.seguridad.login-max-por-email` / `login-ventana` | 5 cada 15 min (un login correcto reinicia el contador) |
| Intentos de login por IP | `vibora.seguridad.login-max-por-ip` | 30 cada 15 min |
| Registros por IP | `vibora.seguridad.registro-max-por-ip` / `registro-ventana` | 10 por hora |
| Antelación máxima de una reserva | `vibora.reservas.horizonte-dias` | 60 días (día natural de Madrid) → 400 |
| Reservas activas por jugador | `vibora.reservas.max-activas-por-usuario` | 10 (confirmadas que no han empezado) → 409; apuntarse a un partido abierto no cuenta |
| Decodificaciones de imagen simultáneas | `vibora.almacen.decodificaciones-simultaneas` / `espera-decodificacion` | 2; si no hay hueco en 10 s → 503 |
| Resolución máxima de una foto | `vibora.almacen.max-megapixeles` | 16 MP |
| Fotos por persona | `vibora.almacen.cuota-diaria-por-usuario` | 40 en 24 h móviles → 429 (con `Retry-After` = segundos hasta que la foto más antigua salga de la ventana, máx. 86400) |
| Temporales huérfanos del almacén | `vibora.almacen.limpieza-tmp-horas` / `limpieza-tmp-cron` | se borran los `tmp-*` de más de 1 h, cada hora |
| Sesiones WebSocket por persona | `vibora.websocket.max-sesiones-por-usuario` | 10 (la siguiente recibe ERROR `Demasiadas conexiones`) |

Además, nginx limita por IP `/api/auth/login` (10 peticiones/min, ráfaga 5) y `/api/auth/registro` (5/min, ráfaga 3) con un 429 en
JSON, sin afectar al resto de `/api/`.

La cuota de fotos es una **cuota sobre las fotos existentes en 24 h**: cuenta las filas subidas por la persona en las últimas
24 horas, así que subir, borrar y volver a subir libera cupo (a propósito: no es un contador de subidas históricas). Se
comprueba al principio de la petición (antes de decodificar nada) y otra vez, ya con el usuario bloqueado, al guardar.

**Topología y limitación por IP (importante).** Los límites por IP (zonas `limit_req` de nginx y los contadores por IP
del backend) solo distinguen clientes si nginx ve su IP real. Con el stack por defecto de Docker Desktop (NAT), en una wifi
compartida o detrás de un balanceador/terminador TLS, **todos los clientes llegan con la misma IP** (la de la pasarela
o el balanceador) y comparten un único cubo: un solo origen insistente puede agotar el límite y dejar fuera a los demás. Dos
palancas, sin debilitar la protección por defecto:

- **IP real en nginx** (opcional, desactivado por defecto): monta un fichero `*.conf` en `/etc/nginx/realip/` del contenedor
  `frontend` con el rango del proxy de confianza (nunca `0.0.0.0/0` en producción, o cualquiera podría falsear su IP):

  ```
  set_real_ip_from 10.0.0.0/8;          # balanceador / terminador TLS de confianza
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;
  ```

  (en compose: `volumes: ["./ops/realip.conf:/etc/nginx/realip/realip.conf:ro"]` en el servicio `frontend`). Con él, nginx
  y el backend (que recibe la IP resultante en `X-Forwarded-For`) cuentan por cliente real. Sin el fichero no cambia nada.
- **Subir los umbrales** en entornos donde la IP no se pueda distinguir (demos, red compartida): `vibora.seguridad.login-max-por-ip`,
  `vibora.seguridad.registro-max-por-ip` (variables `VIBORA_SEGURIDAD_LOGIN_MAX_POR_IP`, ...) y, en nginx, los `rate=`/`burst=`
  de las zonas `auth_login` y `auth_registro`. El límite por (IP, email) protege cada cuenta aunque se suban los de IP.
- Las IPv6 se agrupan por /64 (una sola persona suele controlar un /64 entero) y `::ffff:a.b.c.d` cuenta como la IPv4.

**El limitador de login/registro es en memoria y por instancia**: con más de una instancia del backend cada una cuenta
por separado (el límite real se multiplica). Si algún día se despliega más de una, hay que moverlo a Redis (o similar).
La IP del cliente es la del socket; detrás de nginx, Tomcat usa `X-Forwarded-For` solo si quien conecta es un proxy
interno (`server.forward-headers-strategy=native`) y nginx la sobrescribe, así que un cliente no puede falsearla.

## Roles de base de datos (producción)

En desarrollo la aplicación usa el usuario `vibora` de la base (superusuario del contenedor): no se cambia. En producción
conviene el menor privilegio. `ops/db-roles.sql` (no se ejecuta solo) crea tres roles: `vibora_owner` (dueño del esquema,
para las migraciones de Flyway), `vibora_app` (la aplicación: `SELECT/INSERT/UPDATE/DELETE`, sin DDL, sin `TRUNCATE`, sin
poder desactivar triggers; en `factura` solo `SELECT` e `INSERT`) y `vibora_ro` (solo lectura). Los privilegios por defecto
hacen que las tablas que cree `vibora_owner` en migraciones futuras lleguen ya concedidas.

1. Como superusuario (es idempotente): `psql -U postgres -d vibora -v ON_ERROR_STOP=1 -f ops/db-roles.sql`. En una **base
   nueva** el script se ejecuta **dos veces**: una antes de la primera migración (crea roles y extensión) y **otra vez después
   de la primera migración correcta**, porque `factura` y `flyway_schema_history` no existen en la primera pasada y sus
   `REVOKE` no se pueden aplicar; hasta la segunda pasada la aplicación tendría `UPDATE`/`DELETE` sobre ellas. En una base
   existente basta una vez. Repítelo también tras migraciones que creen tablas inmutables.
2. Poner contraseñas (el script no guarda secretos): `ALTER ROLE vibora_app PASSWORD '...';` y lo mismo con `vibora_owner` y `vibora_ro`.
3. Arrancar la aplicación con una conexión para cada cosa:

   ```
   SPRING_DATASOURCE_USERNAME=vibora_app    SPRING_DATASOURCE_PASSWORD=...   # la aplicación
   SPRING_FLYWAY_USER=vibora_owner          SPRING_FLYWAY_PASSWORD=...       # las migraciones
   ```

Si una migración futura crea otra tabla inmutable, debe incluir su propio `REVOKE UPDATE, DELETE ... FROM vibora_app`.
`RolesBdTest` ejecuta el script real contra un PostgreSQL de prueba y comprueba todo lo anterior.

La migración V7 añade restricciones (emails únicos sin mayúsculas, horario del club, franjas de tarifa sin solape) y falla
con un mensaje claro, sin aplicar nada, si la base ya contiene datos que las violan.

### Copia de seguridad del entorno de desarrollo

`node ops/backup-dev.mjs [--out <carpeta>]` (por defecto `./backups`) guarda `vibora-<fecha>.sql.gz` (pg_dump del contenedor
`vibora-postgres`, solo lectura) y `vibora-uploads-<fecha>.tar.gz` (volumen de fotos, si existe). No sobrescribe nada; los
comandos para restaurar están en la cabecera del script.

## Integración continua (definida, todavía sin ejecutar)

`.github/workflows/ci.yml` está pensado para ejecutarse en cada push y pull request a `main`, pero **aún no se ha
ejecutado nunca en GitHub**: la cuenta tiene un bloqueo de facturación que impide arrancar los jobs. Los comandos que
usa se han comprobado en local (véase «Tests»); el flujo de Actions en sí no está probado. Estaría formado por:

- **backend**: `./mvnw verify` con Java 25 (los tests usan Testcontainers).
- **frontend**: `ng test` y `ng build --configuration production` con Node 24.
- **scripts**: tests del helper de fechas del seed.
- **docker**: construye las dos imágenes, levanta el stack con `docker compose --profile app` y comprueba por nginx
  que la web responde, que una ruta de la SPA devuelve `index.html`, que `/api/auth/me` da 401 y que
  `/actuator/health` no queda publicado.

## Datos de ejemplo para desarrollo

Con el backend en marcha:

```bash
node scripts/seed-dev.mjs [--base-url http://localhost:8081]
```

Requiere Node 20 o superior. Es idempotente: se puede repetir sin duplicar datos. Crea el club "Club Vibora Demo"
(09:00-21:00) con dos pistas, tarifas para todos los días y un partido abierto a 3 días vista, a las 18:00 (hora de
Madrid), con 2 plazas libres.

| Usuario                 | Rol        |
| ----------------------- | ---------- |
| `admin@vibora.test`     | ADMIN_CLUB |
| `jugador1@vibora.test` (organiza el partido) | JUGADOR |
| `jugador2@vibora.test` (apuntado al partido) | JUGADOR |
| `jugador3@vibora.test`, `jugador4@vibora.test` | JUGADOR |

Contraseña de todos: `Vibora-dev-2026`.

> **Solo desarrollo.** El script crea usuarios con una contraseña conocida y se niega a ejecutarse contra hosts que no
> sean `localhost`, `127.0.0.1` o `[::1]`. No lo uses en ningún entorno compartido ni de producción.

Tests del helper de fechas del script: `node --test "scripts/lib/*.test.mjs"`.
