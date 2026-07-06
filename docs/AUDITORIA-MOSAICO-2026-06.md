# Auditoría de Arquitectura y Consistencia — MOSAICO

**Fecha:** 2026-06-29 · **Alcance:** repo `dtalero78/mosaico` (rama `soroban`/`main`), ~96k LOC, 522 archivos TS/TSX · **Base de datos:** `mosaico-db` (PostgreSQL DO, compartida con prod)

**Método:** auditoría multi-agente en 3 etapas — (1) 3 exploraciones de línea base, (2) barrido por 4 dimensiones con verificación adversarial (run `high`), (3) profundización forense en `xhigh` de los 12 huecos del motor + caza de P0. **31 agentes**, ~7.5M tokens. Cada hallazgo P0/P1 fue verificado leyendo el código real e intentando refutarlo; varios se validaron incluso **contra producción en vivo** (`doctl apps spec get`, presign+PUT real a `mosaico-bucket`).

> **Caveat de grounding:** el barrido inicial reconstruyó el esquema de `mosaico-db` de forma estática. **Actualización 2026-06-29:** se verificó contra la BD viva vía `doctl` + `psql` (ver §9). Correcciones materiales:
> - ✅ **`ADVISORS` NO existe** en `mosaico-db` (solo `GUIAS`) → **P0-1 confirmado**. `COMPLEMENTARIA_ATTEMPTS` **sí** existe (PROD-COMPLEMENTARIA-01 correctamente refutado).
> - ⚠️ **`DATA-NIVELES-06` más acotado:** YOJI/OKINA/**KODOMO/DANSHI/SENPAI** están sembrados (315 filas); **solo IMPULSA falta**. El riesgo de "nivel/step vacío" aplica hoy únicamente a IMPULSA.
> - 🔎 **`DATA-EVENTGEN-12` — mecanismo corregido:** en `mosaico-db` **NO hay FK** en `ACADEMICA_BOOKINGS` (0 constraints), así que re-editar un curso **no borra por CASCADE** — deja los bookings **huérfanos** (`eventoId` colgante) + `inscritos=0`. Menos catastrófico, pero el fix in-place aplicado lo previene igual. Hoy hay **0 bookings huérfanos**.
> - ✅ **`DATA-SEQ-09`:** solo plantilla **Chile**; **0 duplicados de contrato** entre titulares → se creó `idx_people_contrato_titular` (UNIQUE parcial) que cierra la race. `numeroRecibo` **no existe** aún y hay 0 pagos → la race del recibo es inaplicable hoy.
> - ℹ️ **`SCHEMA-RUNTIME-DDL-11`:** las 9 columnas del motor en `ACADEMICA` (`fechaInicioESS`, `pruebainter`, etc.) **ya existen** (el DDL en caliente ya corrió) → el riesgo no está materializado.
> - 📊 Datos actuales: **3 titulares, 24 guías, 3 ACADEMICA, 4490 eventos** — plataforma casi sin datos reales aún (momento ideal para endurecer esquema).

---

## 1. Resumen ejecutivo

| Severidad | # | Significado |
|---|---|---|
| **P0** | 6 | Rompe o expone usuarios reales / la marca **ahora**, en ruta viva. Actuar de inmediato. |
| **P1** | 15 | Riesgo serio latente (se materializa al arrancar los cursos / bajo concurrencia / curso no sembrado). |
| **P2** | 21 | Deuda estructural, marca user-facing, robustez. |
| **P3** | 6 | Limpieza (código muerto, deps, refs internas). |
| Refutados | 3 | Hipótesis descartadas con prueba (trazabilidad, §7). |

### Los 3 titulares

1. **La migración `ADVISORS → GUIAS` quedó a medias (P0).** 23 archivos vivos ejecutan SQL crudo contra la tabla `"ADVISORS"`, que **no existe en `mosaico-db`** (su único creador, `scripts/migrate-advisors.js`, hace fetch a la Wix API de *LGS* y nunca corrió para MOSAICO). Esto **rompe el panel del estudiante** (historial, próxima clase, comentarios → 500 en cada login real), el botón "Registrar Sesión" del guía, Ctrl Horas y ~10 informes. Fix mecánico `"ADVISORS"`→`"GUIAS"` (mismas columnas).

2. **Superficie de seguridad de un fork apresurado (P0/P1).** Secretos productivos hardcodeados en el repo (WHAPI ×2, API2PDF ×4, password admin); un endpoint público (`/api/internal/verify-credentials`) **devuelve la contraseña** de cualquier usuario con solo el email; las 8 rutas `/api/wix/*` mutantes aceptan **"cualquier sesión"** → un **estudiante** puede borrar/inactivar beneficiarios y titulares; `/nuevo-usuario/[id]` permite **account takeover por IDOR**; `reset-password` **no valida el OTP** (cualquiera resetea la clave de cualquier cuenta, incl. SUPER_ADMIN); contraseñas en **texto plano**.

3. **El motor académico sigue siendo el de LGS sobre el modelo de datos de MOSAICO (P1).** El riesgo dominante del fork **no produce 500s sino corrupción/incoherencia silenciosa**: el split-brain WELCOME (motor lee `ACADEMICA` atascado, curso real en `PEOPLE`, promoción 100% manual), el motor de avance hardcodeado a `Step N`/Jumps%5 que es **inerte** sobre `Leccion NN`, el clúster de **email compartido de hermanos menores** (login por `userLogin` pero todo resuelve por `email`), y re-editar un curso **borra los bookings precargados** vía `ON DELETE CASCADE`.

> **Recomendación de proceso:** el build de MOSAICO no valida nada (`ignoreBuildErrors` + `ignoreDuringBuilds`), no hay CI ni tests, y el deploy es `deploy_on_push` a `soroban`. Cualquier remediación debería ir acompañada de un gate mínimo (typecheck + lint + build en PR) para no reintroducir lo mismo.

---

## 2. Cómo leer este informe

Cada hallazgo tiene: **ID · severidad · estado** (confirmado / parcial / refutado) · **dimensión** · impacto · evidencia (`archivo:línea`) · recomendación · esfuerzo (S/M/L/XL). Los IDs son estables para convertir a issues. La tabla completa machine-readable está en el Apéndice (§10). El roadmap por fases (§8) agrupa los hallazgos en orden de ejecución.

---

## 3. Hallazgos P0 — crítico, actuar ya

### P0-1 · `PROD-ADVISORS-01` · confirmado · Producción
**23 archivos vivos hacen SQL contra `"ADVISORS"`, tabla inexistente en `mosaico-db` → 500.** [verificar en BD]
La refactorización a `GUIAS` se hizo en `advisor.repository.ts` y `calendar.repository.ts`, pero quedaron 23 archivos con `FROM/JOIN/UPDATE "ADVISORS"`. PostgreSQL falla la query entera (incluso un `LEFT JOIN`) con `relation "ADVISORS" does not exist`.
- **Rompe (rutas vivas):** panel del estudiante — `booking.repository.findByStudentId` (historial de `/student/[id]`), `findUpcomingByStudentId` (card NEXT SESSION, **cada login de estudiante**), `findCommentsForStudent`; `advisors/by-email` (botón "Registrar Sesión" del guía + selector Panel Guía); `advisors/[id]/control-horas`; `students/[id]/ultimos-agendamientos`; `advisor-event-log.service`, `evaluations.service`, `admin-events.service`; ~10 informes (`reports/programacion/advisors/*`, `academica/horas-advisor`, `asistencia/usuario`, `performance-evaluation`, `sesiones-sin-gestion`, `eventos-informe`, `export/events`).
- **Evidencia:** `src/repositories/booking.repository.ts:148,435,452,497`; `src/app/api/postgres/advisors/by-email/[email]/route.ts:22`; `…/advisors/[id]/control-horas/route.ts:38`; `…/students/[id]/ultimos-agendamientos/route.ts:5`; `src/services/advisor-event-log.service.ts:128`; +16 más (lista completa en Apéndice).
- **Fix:** reemplazo mecánico `"ADVISORS"`→`"GUIAS"` en los 23 (GUIAS tiene las mismas columnas). Mitigación puente opcional: crear vista `CREATE VIEW "ADVISORS" AS SELECT * FROM "GUIAS"` en `mosaico-db`. **Esfuerzo: M.**

### P0-2 · `SEC-SECRETS-01` · confirmado · Seguridad
**Secretos productivos hardcodeados y versionados en el repo.** WHAPI con **dos** tokens distintos, API2PDF repetido en 4 archivos, password admin `'tarelo5*'`. Verificado: los 8 archivos están *tracked* en git y los valores se usan en headers `Authorization` reales (no son placeholders).
- **Evidencia:** `src/lib/whatsapp.ts:11`; `src/app/api/wix/sendWhatsApp/route.ts:50`; `src/app/api/contracts/[id]/send-pdf/route.ts:8-9`; `src/app/api/wix/sendWelcomeWhatsApp/route.ts:55` (2º token); `…/regenerate-drive/route.ts:10`; `…/consent/[id]/auto-approve/route.ts:9`; `src/services/pagos-titulares.service.ts:21`; `scripts/mosaico-seed.js:29`.
- **Fix:** **rotar todos** los tokens/clave expuestos, eliminar los literales (exigir env y fallar al arranque si falta), purgar del historial git si la rotación no es inmediata. **Esfuerzo: M.**

### P0-3 · `SEC-CREDS-LEAK-02` · confirmado · Seguridad
**`POST /api/internal/verify-credentials` es público y devuelve `password` con solo el email.** Usa `handler()` (sin auth) y el middleware excluye `/api`. Como las claves se guardan en texto plano (P1-7), es exfiltración directa de credenciales por enumeración de emails (estudiantes/guías; admin si su clave no es bcrypt). El endpoint además es vestigial (solo lo llamaría el `auth.ts` legacy, no el `auth-postgres.ts` vivo).
- **Evidencia:** `src/app/api/internal/verify-credentials/route.ts:49-58` (`password: user.password` en la respuesta).
- **Fix:** nunca devolver `password`; verificar server-side y devolver `{valid, rol}`. Idealmente **eliminar** el endpoint (auth-postgres ya consulta la BD en proceso). **Esfuerzo: M.**

### P0-4 · `SEC-WIX-AUTHZ-04` · confirmado · Seguridad
**Las 8 rutas `/api/wix/*` mutantes autorizan con "cualquier sesión" (`return !!session`), sin chequear rol.** Un **ESTUDIANTE** autenticado puede `deleteBeneficiario` (DELETE en ACADEMICA_BOOKINGS+ACADEMICA+PEOPLE), `updateTitularEstado`, `inactivateBeneficiario` de terceros, o disparar WhatsApp. El bypass por `WIX_SECRET` es fail-open (si la env falta, la sesión basta igual).
- **Evidencia:** `src/app/api/wix/deleteBeneficiario/route.ts:6-10` (y idéntico en `updateTitularEstado`, `inactivateBeneficiario`, `approveBeneficiario`, `createNewBeneficiario`, `updateBeneficiario`, `sendWelcomeWhatsApp`, `sendWhatsApp`).
- **Fix:** gatear cada ruta con `requirePermission()` / verificación de rol (ADMIN/SERVICIO según la operación). **Esfuerzo: M.**

### P0-5 · `SEC-ACCOUNT-TAKEOVER-05` · confirmado · Seguridad
**`POST /api/nuevo-usuario/[id]` es público y fija la clave + `activo=true` por el `ACADEMICA._id` de la URL (IDOR).** Sin verificación de `alreadyRegistered` en el POST; `ON CONFLICT(email) DO UPDATE SET password`. Un atacante que enumere/obtenga un `_id` toma la cuenta. Clave en texto plano. Los `_id` se generan con `Date.now()+Math.random` (no cripto).
- **Evidencia:** `src/app/api/nuevo-usuario/[id]/route.ts:231-244,67-68`.
- **Fix:** token firmado de un solo uso (con expiración) embebido en el link de WhatsApp, en vez del `_id` crudo; hashear con bcrypt; invalidar token tras el primer uso. **Esfuerzo: L.**

### P0-6 · `SEC-RESET-NO-OTP` (sub de `SEC-OTP-BRUTEFORCE-07`) · confirmado · Seguridad
**`reset-password` no valida el OTP server-side** — solo comprueba que el email exista y hace `UPDATE password`. La verificación del OTP es puramente client-side. Cualquiera puede resetear la contraseña de **cualquier** cuenta (incluido SUPER_ADMIN) llamando el endpoint con un email válido, sin brute-force.
- **Evidencia:** `src/app/api/auth/forgot-password/reset-password/route.ts` (no llama `verifyOtp`); contexto en `src/lib/otp-store.ts:38-55`.
- **Fix:** exigir y validar el OTP (one-time, con contador de intentos) en el servidor antes de permitir el reset. **Esfuerzo: M.**

---

## 4. Hallazgos P1 — riesgo serio latente

**Seguridad**
- **`SEC-PII-IDOR-03` (confirmado).** `GET /api/consent/[id]/contract-data` es público y, por `id` de titular, devuelve PII completa (numeroId, celular, email, domicilio, financieros) del titular **y de todos sus beneficiarios**. IDOR sin auth ni rate limit. El `_id` (~46 bits) limita el dump masivo ciego, pero los links de contrato filtrados/UUID Wix migrados son vector real. *Fix:* token de un solo uso por contrato; validar `numeroDocumento` **antes** de devolver datos; minimizar campos; rate limit. (`contract-data/route.ts:7-43`)
- **`SEC-PUBLIC-ACCT-06` (confirmado).** `POST /api/postgres/advisors/create` público (página `/nuevo-guia` fuera del middleware) crea cuenta rol **GUIA** con default `'MOSAICO2026'` → escalada de privilegios + polución de datos. *Fix:* auth (ADMIN/COORDINADOR) o captcha+aprobación; nunca default fijo. (`advisors/create/route.ts:13,93`)
- **`SEC-OTP-BRUTEFORCE-07` (confirmado).** OTP de 6 dígitos sin contador de intentos ni rate limit → brute-force en la ventana de 10 min sobre `consent/verify`; `send-otp`/`check-email` sin rate limit → enumeración + spam WHAPI. *Fix:* lockout tras 3-5 fallos, rate limit por IP+id, respuesta uniforme en `check-email`. (`otp-store.ts:38-55`)
- **`SEC-PLAINTEXT-PW-09` (confirmado).** Claves guardadas y comparadas en texto plano (`isPasswordValid = password === user.password`), + `console.log` que expone longitudes y el match. Amplifica P0-3. *Fix:* bcrypt al escribir; migrar en el próximo login; quitar el log. (`auth-postgres.ts:88-94`)

**Proceso / build**
- **`SCHEMA-ADHOC-06` (confirmado).** ~120 scripts de migración sueltos, **sin tabla de tracking ni runner** (`_schema_version` no se usa), idempotencia inconsistente. Aprovisionar un `mosaico-db` nuevo requiere ejecutar a mano ~120 scripts en orden desconocido. Riesgo **ya materializado** (caídas por columnas faltantes documentadas en el changelog). *Fix:* tabla `_migrations` + runner; consolidar baseline con `pg_dump --schema-only`; estandarizar `ADD COLUMN IF NOT EXISTS`. **Esfuerzo: L.**
- **`QUALITY-09` (confirmado).** `next.config.js` con `ignoreBuildErrors:true` + `ignoreDuringBuilds:true` → el build pasa verde con errores de tipo/lint reales. Sin red de seguridad estática. *Fix:* `tsc --noEmit` + `next lint` como gate de PR; bajar a `ignoreBuildErrors:false` cuando se limpien los residuales. (`next.config.js:17-25`)

**Motor académico vs modelo MOSAICO**
- **`ENG-WELCOME-01` (confirmado).** Split-brain: `ACADEMICA` nace en `curso='WELCOME'` (nivel=módulo, step='Leccion 00') mientras el curso real vive en `PEOPLE`; el motor lee `ACADEMICA`; la promoción es **100% manual** ("Aprobar Welcome", único caller). Además la rama de auto-avance WELCOME heredada de LGS es **código muerto** que, si disparara, lanza 500 (`changeStep('Step 1')` → NIVELES MOSAICO usa 'Leccion NN'). Mientras el alumno siga en WELCOME, el diagnóstico "¿Cómo voy?", el effectiveStep y el header quedan congelados/incoherentes. *Fix:* hook automático de promoción al marcar asistencia WELCOME; eliminar la rama LGS muerta; cron/alerta de "aprobados en WELCOME con inicioCurso vencido". (`student.service.ts:442-456`, `contracts/route.ts:228-244`, `progress.service.ts:143-146`)
- **`ENG-CURRICULUM-02` (confirmado).** El motor de avance/diagnóstico cuelga de `extractStepNumber` (regex `/Step N/`), que devuelve `null` para `'Leccion NN'`. Efectos vivos: en "¿Cómo voy?" `null===null` **confla todas las lecciones en un solo balde** → diagnóstico basura; `getEffectiveStepNumber` retorna 0 ("todo completo"); `autoAdvanceStep` nunca avanza. *Fix:* reescribir la progresión sobre `NIVELES.orden` (clave canónica MOSAICO), no sobre el número de step; definir "completitud de lección/módulo"; blindar el `autoAdvanceStep` del POST `/academic/attendance` con `.catch`. **Esfuerzo: XL.** (`progress.service.ts:34-43,178-180`, `student.service.ts:456`)
- **`DATA-NIVELES-06` (parcial → riesgo confirmado).** Solo YOJI/OKINA sembrados; KODOMO/DANSHI/SENPAI/IMPULSA pendientes, pero **creables** en el wizard (no se valida que el curso esté en NIVELES). Un contrato de curso no sembrado → `nivel/step=''` en PEOPLE; al "Aprobar Welcome", `UPDATE ACADEMICA SET nivel='', step=''` **sin error** → motor degrada en silencio. *Fix:* **guarda dura** al crear contrato (rechazar curso sin NIVELES) y en `promoteFromWelcome`; filtrar el dropdown por cursos sembrados; sembrar los 4 cursos. (`contracts/route.ts:199-207`, `student.service.ts:82-88,160-192`)
- **`DATA-SEQ-09` (confirmado).** (a) Número de contrato con `MAX()+1` sin lock, fuera de la transacción, sin `UNIQUE` en `PEOPLE.contrato` → **race condition** (dos titulares con el mismo número → finanzas/beneficiarios cruzados). (b) Mismo defecto en recibo `LGS-####`. (c) **Solo plantilla Chile sembrada**: para otro país, la página pública de firma renderiza un **contrato vacío que el cliente firma por OTP** (hash de documento en blanco) — corrupción de un acto jurídico. *Fix:* SEQUENCE/advisory-lock para el consecutivo + `UNIQUE INDEX`; bloquear firma si falta plantilla. (`contracts/route.ts:47-56,107-149`, `pagos-titulares.repository.ts:452-466`, `contrato/[id]/page.tsx:59`)
- **`DATA-APPROVE-04` (parcial).** La precarga de bookings **sí** es atómica (refutado el "parcial"), pero: el catch de la aprobación es `console.warn` → un beneficiario puede quedar **aprobado + login activado sin sesiones** (curso sin eventos, o fallo); sin idempotencia DB (no hay `UNIQUE(studentId,eventoId)`) → doble-submit duplica bookings y cupos; la generación está cableada **solo** a `people/[id]/approve` (otras vías aprueban sin bookings). *Fix:* índice único + `ON CONFLICT DO NOTHING`; persistir el fallo (no solo log); regenerar en el early-return; sellar/cablear las otras vías. (`approve/route.ts:35-48,148-164`, `cursos-campaign-eventos.service.ts:152-213`)
- **`DATA-EVENTGEN-12` (confirmado, grave).** `PATCH /campaigns/[id]` llama `generarEventosCurso` que **siempre** hace `DELETE FROM CALENDARIO WHERE cursoCampaignId` + reinserta con `_id` nuevos. La FK `ACADEMICA_BOOKINGS.eventoId … ON DELETE CASCADE` (nunca dropeada) **borra en silencio los bookings precargados** de los beneficiarios aprobados. El disparador es inminente: los 32 cursos del backfill nacieron **sin guía** y asignarla = exactamente esta edición destructiva. *Fix:* regeneración no destructiva (UPDATE in-place si hay inscritos; diff de fechas; separar metadatos de estructura); evaluar cambiar la FK a RESTRICT. (`cursos-campaign-eventos.service.ts:37-53,81`, `campaigns/[id]/route.ts:75-79`, `schema.sql:306`)
- **`ENG-LOGIN-SHARED-EMAIL-14` (confirmado).** El login acepta `userLogin`, pero la sesión y todo el panel resuelven por `email`. Para hermanos menores que **comparten el email del apoderado** (permitido a propósito): el 2º hermano no obtiene fila en USUARIOS_ROLES (dedupe por email → nunca loguea), y `findByEmail … LIMIT 1` sin `ORDER BY` devuelve un ACADEMICA **arbitrario** → un menor ve el panel/progreso del hermano. **Fuga de datos entre menores.** *Fix:* propagar `userLogin` a la sesión y resolver el panel por `userLogin`, no por email. (`auth-postgres.ts:36,102`, `panel-estudiante.service.ts:59,68`, `academica.repository.ts:70-76`, `contracts/route.ts:252-267`)
- **`DATA-NULLSTATE-15` (confirmado).** Estado "Contrato nulo / Devuelto / Rechazado" inactiva **solo** `PEOPLE` — **no** toca `USUARIOS_ROLES.activo` ni `ACADEMICA.estadoInactivo`. Un beneficiario de contrato anulado **sigue pudiendo loguear** (y quizá agendar). Diverge de `toggleStatus`/expiración, que sí sincronizan las 3 tablas. *Fix:* sincronizar las 3 tablas (reusar el patrón de `toggleStatus`). (`people/[id]/route.ts:373-395`)
- **`DATA-NUEVOUSUARIO-OVERWRITE-16` (confirmado).** `nuevo-usuario` hace `ON CONFLICT(email) DO UPDATE` → con email compartido de hermanos, el 2º **machaca** password/nombre/numberid/contrato del 1º; además no escribe `userLogin`. Robo/colisión de credenciales entre hermanos. *Fix:* desambiguar por `userLogin`/`_id`, no por email. (`nuevo-usuario/[id]/route.ts` INSERT USUARIOS_ROLES)

---

## 5. Hallazgos P2 — deuda estructural, marca, robustez

**Seguridad**
- `SEC-CRON-FAILOPEN-08` (confirmado, ajustado de P1). Crons fail-open: `if (CRON_SECRET && …)` → si la env falta, pasa sin auth. *Fix:* `if (!CRON_SECRET || …) return 401`. (`cron/*/route.ts`)
- `SEC-IDOR-PAGES-10` (confirmado). `alwaysAllowedRoutes` deja a cualquier rol abrir `/person`, `/student`, `/advisor`, `/sesion` por URL; la protección depende 100% de cada API. *Fix:* restringir por rol + auditar ownership en las APIs. (`middleware.ts:78-82`)
- `SEC-PII-LOGS-11` (confirmado). Celular/email/password-len en logs; `x-forwarded-for` completo sin truncar. (`approve/route.ts:184-187`, `consent/[id]/verify/route.ts:15-18`)
- `SEC-PDF-NOAUTH-12` (confirmado). `send-pdf`/`upload-url`/`documents` sin auth → reenvío de PDF (gasto API2PDF/WHAPI), subida a contratos ajenos. (`send-pdf/route.ts:12`)

**Arquitectura**
- `ARCH-GODFILES-01` (P2). God files: `student.service.ts` (802 LOC, hub), `pagos-titulares.service.ts` (652), `advisor-event-log.service.ts` (551), `booking.repository.ts` (661)… *Fix:* dividir por subdominio, incremental.
- `ARCH-COUPLING-02` (P2). `student.service` como hub + ciclos resueltos con `await import()` dinámico (5 puntos). *Fix:* extraer `step-progression.service` neutral.
- `ARCH-FETCH-03` (P2). ~101 `fetch()` en componentes saltándose hooks/React Query (`StudentAcademic.tsx` 10, `PersonAdmin.tsx` 8, `GuiaEditForm.tsx` 5). *Fix:* migrar los más pesados a hooks.
- `ARCH-SKIP-SERVICE-04` (P2, roza P1). God-routes con escrituras multi-tabla en el handler; `approve` y `people PATCH/DELETE` escriben **sin transacción** (riesgo de desync). *Fix:* extraer a services + `withTransaction`.

**Marca / legacy user-facing**
- `LGS-USERFACING-01` (P2). Tras firmar, el cliente es redirigido a **`https://letsgospeak.cl/`** (la marca origen). (`contrato/[id]/page.tsx:77-84`)
- `LGS-USERFACING-02` (P2). Recibo PDF dice "Departamento de Recaudos · Let's Go Speak" y numera `LGS-####`. (`pagos-titulares.service.ts:542`, `pagos-titulares.repository.ts:459`)
- `LGS-USERFACING-03` (P2). WhatsApp/IA al estudiante dicen "Let's Go Speak" (examen internacional, Jump-tutor, generación de actividad). (`exam-intern.service.ts:123`, `jump-tutor.service.ts:239`, `academic/activity/route.ts:43`)
- `LGS-USERFACING-04` / `LGS-MATERIAL-07` (P2). Badge "LGS" en el panel + el mapa de material es taxonomía LGS (`lgsplataforma.com/material-{BN1..F3}`) → para un alumno MOSAICO la sección Material sale **siempre vacía**. *Fix:* poblar `NIVELES.materialUsuario` por módulo/lección (Spaces ya operativo) + borrar el mapa Wix. (`MaterialsList.tsx:11-29`)

**Motor / integridad (resto)**
- `ENG-TZ-03` (parcial, P2). Mezcla Santiago (generación de eventos) vs UTC/Bogotá (semana ISO, complementaria, dashboard). **Refutado** que rompa expiración/OnHold/ventanas (son TZ-independientes por diseño). Efecto real: corrimiento de ~3h en el límite semanal los domingos noche Chile. *Fix:* módulo `tz.ts` con `PLATAFORMA_TZ` + helpers de inicio de semana/día.
- `RBAC-ORPHAN-05` (parcial, P2). `ASISTENTE_ACADEMICO`/`ACADEMICO_JEFE`/jefes existen en `ROL_PERMISOS` pero no en el enum/matriz de fallback. **Refutado** que rompa RBAC en runtime (resuelve por string desde BD); el único fallo es **fail-closed** en outage de BD (deniega de más). *Fix:* agregar al enum + matriz; CI que detecte rol-en-BD-sin-enum.
- `PROD-SPACES-08` (refutado → reorientado, P2). El alta de guías por Spaces **no está rota** (verificado en vivo: presign+PUT 200 a `mosaico-bucket`; las env DO_SPACES_* **sí** están desplegadas — la doc está estale). **El env realmente ausente es `OPENAI_API_KEY`** → complementarias/Jump-tutor/moderación dan 500 al primer uso. *Fix:* agregar `OPENAI_API_KEY` al spec; degradar a 503 limpio si falta; corregir CLAUDE.md.
- `DATA-MONEY-10` (parcial, P2). `parseCurrency` asume formato Colombia, pero **ningún write produce decimales** (saldo siempre entero) → sin corrupción activa. Único hueco: edición manual de saldo en `/contrato/[id]` sin `parseMoney`. *Fix:* aplicar `parseMoney` en ese PUT.
- `SCHEMA-RUNTIME-DDL-11` (parcial, P2). ~12 sitios corren `ALTER/CREATE TABLE IF NOT EXISTS` **en el path de request**. **Refutado** que corrompa datos (la rama ESS está gateada por `nivel==='ESS'`, inexistente en MOSAICO; los demás dan 500 visible, no silencioso). Deuda: DDL por request, depende de privilegios DDL. *Fix:* mover las columnas a scripts idempotentes y eliminar los `ensure*()` en caliente. (`panel-estudiante.service.ts:28-37`, `booking.repository.ts:16-24`)
- `DATA-DELETE-ORPHAN-17` (confirmado, P2). Eliminar beneficiario deja `USUARIOS_ROLES` (login activo) y bookings huérfanos, no decrementa `inscritos`; en titular-es-beneficiario borra el ACADEMICA compartido. *Fix:* borrado en cascada controlado de las 3 tablas + bookings.
- `DATA-APPROVE-WELCOME-18` (confirmado, P2). El fallback de `approve` crea ACADEMICA con `step='WELCOME'` (no 'Leccion 00') y **sin `inicioCurso`** → el cron `activate-academica` nunca lo activa. *Fix:* unificar con el INSERT canónico de `contracts/route.ts`.
- `DATA-CRON-ACTIVATE-EMAIL-19` (confirmado, P2). El cron activa `USUARIOS_ROLES` por `email`/`numberid` → con email compartido activa **hermanos cuyo curso aún no inicia**. *Fix:* matchear por `userLogin` (1:1 con la cuenta).
- `QUALITY-10` (P2). Sin CI, sin pre-commit, 2 tests E2E / 0 unit sobre 522 archivos, deploy_on_push. *Fix:* GitHub Actions (typecheck+lint+build) como gate; husky; tests de la lógica crítica.

---

## 6. Hallazgos P3 — limpieza

- `ARCH-PATTERN-05`. 7 repos no extienden `BaseRepository`; 11 rutas nuevas sin `handler()` (forma de error inconsistente).
- `LGS-INTERNAL-05`. Refs LGS internas: `lgs-bucket` fallback (`spaces.ts:31`), URLs fallback `lgs-plataforma.com`, `empresa:'LGS'` a bsl-utilidades (**verificar** si enruta el PDF a la carpeta de LGS → subiría a P2), email `cron@lgs-plataforma.com`, `BASE_URL` hardcodeada en `edicion-contrato`.
- `DEADDEP-07`. 8 dependencias con 0 imports: `moment`, `moment-timezone`, `chart.js`, `react-chartjs-2`, `@react-pdf/renderer`, `react-pdf`, `exceljs`, `xlsx` (esta con CVEs). *Fix:* `npm uninstall`.
- `DEADCODE-08`. `DashboardCharts.tsx` + `/api/postgres/dashboard/charts` huérfanos (no montados).
- `PROD-COMENTARIOS-DEAD-01`. `comments.repository.ts` → tabla `COMENTARIOS` inexistente, pero no importado (código muerto). *Fix:* borrar.
- `PROD-WIX-LEGACY-01`. `src/backend/FUNCIONES WIX/**` referencia ADVISORS/Wix; no ejecutable. *Fix:* mover fuera de `src/`.

---

## 7. Refutados / descartados (trazabilidad)

- **`PROD-COMPLEMENTARIA-01` (refutado).** La hipótesis "COMPLEMENTARIA_ATTEMPTS no existe" es falsa: la crea `migration/11-create-complementaria-attempts.js` y el manifiesto del fork la lista como provisionada. (El verificador la marcó con confianza media por no poder consultar la BD viva.)
- **`PROD-CRONS-OK-01` (descarte).** Los 4 crons solo tocan tablas provisionadas; el patrón `COALESCE(eventoId,idEvento)`/`(tipo,tipoEvento)` es seguro (columnas legacy presentes). Sin acción.
- **`PROD-SPACES-08` (hipótesis refutada).** Spaces operativo en prod; el alta de guías funciona (validado en vivo). El hallazgo se reorientó al env realmente ausente (`OPENAI_API_KEY`, ahora P2).

---

## 8. Plan de remediación por fases

### Fase A — Hotfix P0 (esta semana)
1. **ADVISORS→GUIAS** en los 23 archivos (P0-1). Empezar por `booking.repository.ts` (panel estudiante) + `advisors/by-email` + `control-horas` + `ultimos-agendamientos`; luego informes. Opcional puente: vista SQL `ADVISORS`.
2. **Rotar y desincrustar secretos** (P0-2): rotar WHAPI×2, API2PDF, password admin; exigir env; purgar git.
3. **Cerrar fugas de auth** (P0-3,4,5,6): eliminar/blindar `verify-credentials`; gatear `/api/wix/*` por rol; token de un solo uso en `/nuevo-usuario`; validar OTP en `reset-password`.
4. **Validación de OTP server-side** (P0-6) y **gate de build mínimo** (typecheck+lint en PR) para no reintroducir lo anterior.

### Fase B — P1: integridad del motor + hardening (próximas 2-3 semanas)
5. **Hashear contraseñas** (bcrypt) + quitar rama plaintext y logs (P1 SEC-PLAINTEXT-PW-09).
6. **Cluster email-compartido de menores** (ENG-LOGIN-14 / NUEVOUSUARIO-16 / CRON-ACTIVATE-19 / NULLSTATE-15): propagar `userLogin` a sesión + resolver panel/dedupe/cron/activación por `userLogin`, no por email; sincronizar las 3 tablas en estados de anulación.
7. **Eventgen no destructivo** (DATA-EVENTGEN-12): UPDATE in-place si hay inscritos / diff de fechas — **antes** de asignar guía a los 32 cursos.
8. **Aprobación idempotente** (DATA-APPROVE-04): `UNIQUE(studentId,eventoId)` + `ON CONFLICT`; persistir fallos; cablear/sellar vías.
9. **Guarda de cursos no sembrados** (DATA-NIVELES-06) + **firma sin plantilla bloqueada** + **consecutivo con lock** (DATA-SEQ-09).
10. **Promoción WELCOME automática** + eliminar rama LGS muerta (ENG-WELCOME-01); **gate de build/CI** (QUALITY-09) y **runner de migraciones** (SCHEMA-ADHOC-06).
11. Hardening seguridad P1: rate limit + lockout OTP, auth en `/nuevo-guia`/`advisors/create`, token+min-campos en consent (SEC-06,07, PII-03).

### Fase C — P2: motor de progreso, estructura, marca
12. **Reescribir la progresión sobre `NIVELES.orden`** (ENG-CURRICULUM-02) — prerequisito para que "¿Cómo voy?"/auto-avance funcionen en MOSAICO (XL; coordinar con la definición de "evaluaciones por módulo").
13. Sweep de **marca user-facing** (LGS-USERFACING-01..04, MATERIAL-07): redirect, recibo PDF, mensajes WhatsApp/IA, badge, material.
14. **Estructura**: extraer `step-progression.service`, romper ciclos, descomponer `people/[id]`/`approve` a services con transacción, migrar `fetch()` de componentes a hooks.
15. Robustez: `OPENAI_API_KEY` + degradación 503; `tz.ts` único; sacar DDL del request; crons fail-closed; cerrar IDOR de páginas; truncar PII en logs.

### Fase D — P3: limpieza
16. `npm uninstall` de las 8 deps muertas (xlsx por CVE); borrar `DashboardCharts` + endpoint, `comments.repository.ts`; mover `FUNCIONES WIX/` fuera de `src/`; uniformar `handler()`/`BaseRepository`; limpiar refs LGS internas (verificar antes `empresa:'LGS'`).

---

## 9. Verificación recomendada (read-only)

Para cerrar los pocos puntos que dependen de la BD viva (no hay `.env.local` en este checkout):

```bash
# 1) Confirmar que ADVISORS NO existe y GUIAS SÍ (ancla P0-1)
psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables
  WHERE table_name IN ('ADVISORS','GUIAS','COMPLEMENTARIA_ATTEMPTS');"

# 2) Listar las columnas del motor que dependen de DDL en caliente (SCHEMA-RUNTIME-DDL-11)
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns
  WHERE table_name='ACADEMICA'
    AND column_name IN ('fechaInicioESS','pruebainter','fechaPromocionEspecial','cambioStepHistory','inicianivel');"

# 3) Confirmar materialUsuario vacío en NIVELES (LGS-MATERIAL-07)
psql "$DATABASE_URL" -c "SELECT curso, code, step, (\"materialUsuario\" IS NULL) sin_material FROM \"NIVELES\" LIMIT 20;"

# 4) Secretos versionados (P0-2)
git grep -nE "VSyDX4j7|I1s8u9Fi|9450b12a-4c5f|tarelo5\*|MOSAICO2026"

# 5) ¿FK eventoId ON DELETE CASCADE viva? (DATA-EVENTGEN-12)
psql "$DATABASE_URL" -c "SELECT conname, confdeltype FROM pg_constraint
  WHERE conrelid='\"ACADEMICA_BOOKINGS\"'::regclass AND contype='f';"
```

**Cómo se verificó este informe:** cada hallazgo P0/P1 fue confirmado leyendo `archivo:línea` e intentando refutarlo; los estados (confirmado/parcial/refutado) y los matices de severidad reflejan esa verificación adversarial. `PROD-SPACES-08` se validó contra producción en vivo. Lo único pendiente de confirmación binaria es la ausencia física de `ADVISORS` en `mosaico-db` (comando #1) — todo el resto de la evidencia (único creador es un script Wix-LGS, CLAUDE.md lo afirma 6×, `create-guias-table.js` lo dice verbatim) apunta a que falta.

---

## 10. Apéndice — tabla completa de hallazgos

| ID | Sev | Estado | Dim | Título corto | Esfuerzo |
|---|---|---|---|---|---|
| PROD-ADVISORS-01 | P0 | confirmado | prod | 23 archivos SQL contra ADVISORS inexistente | M |
| SEC-SECRETS-01 | P0 | confirmado | seg | Secretos hardcodeados versionados | M |
| SEC-CREDS-LEAK-02 | P0 | confirmado | seg | verify-credentials devuelve password | M |
| SEC-WIX-AUTHZ-04 | P0 | confirmado | seg | /api/wix/* mutable por cualquier sesión | M |
| SEC-ACCOUNT-TAKEOVER-05 | P0 | confirmado | seg | nuevo-usuario account takeover IDOR | L |
| SEC-RESET-NO-OTP | P0 | confirmado | seg | reset-password no valida OTP | M |
| SEC-PII-IDOR-03 | P1 | confirmado | seg | consent contract-data PII IDOR | L |
| SEC-PUBLIC-ACCT-06 | P1 | confirmado | seg | creación pública cuenta GUIA default | M |
| SEC-OTP-BRUTEFORCE-07 | P1 | confirmado | seg | OTP sin lockout/rate-limit + spam | M |
| SEC-PLAINTEXT-PW-09 | P1 | confirmado | seg | contraseñas en texto plano | L |
| SCHEMA-ADHOC-06 | P1 | confirmado | legacy | 120 scripts sin tracking ni runner | L |
| QUALITY-09 | P1 | confirmado | legacy | build no valida (ignoreBuildErrors) | M |
| ENG-WELCOME-01 | P1 | confirmado | motor | split-brain WELCOME, promoción manual | M |
| ENG-CURRICULUM-02 | P1 | confirmado | motor | motor hardcodeado a Step N / Jumps%5 | XL |
| DATA-NIVELES-06 | P1 | parcial | motor | cursos no sembrados → nivel/step vacío | S |
| DATA-SEQ-09 | P1 | confirmado | datos | nº contrato race + firma plantilla vacía | M |
| DATA-APPROVE-04 | P1 | parcial | datos | aprobación: aprobado sin bookings / no idempotente | M |
| DATA-EVENTGEN-12 | P1 | confirmado | datos | re-editar curso borra bookings (CASCADE) | M |
| ENG-LOGIN-SHARED-EMAIL-14 | P1 | confirmado | datos | userLogin vs email: cruce de hermanos | M |
| DATA-NULLSTATE-15 | P1 | confirmado | datos | anulación no bloquea login/ACADEMICA | S |
| DATA-NUEVOUSUARIO-OVERWRITE-16 | P1 | confirmado | datos | ON CONFLICT(email) machaca hermano | S |
| SEC-CRON-FAILOPEN-08 | P2 | confirmado | seg | crons fail-open sin CRON_SECRET | S |
| SEC-IDOR-PAGES-10 | P2 | confirmado | seg | páginas /person /student por URL | L |
| SEC-PII-LOGS-11 | P2 | confirmado | seg | PII/IP en logs | S |
| SEC-PDF-NOAUTH-12 | P2 | confirmado | seg | send-pdf/upload sin auth | M |
| ARCH-GODFILES-01 | P2 | confirmado | arq | god files (student.service 802 LOC) | XL |
| ARCH-COUPLING-02 | P2 | confirmado | arq | hub student.service + ciclos dinámicos | L |
| ARCH-FETCH-03 | P2 | confirmado | arq | ~101 fetch() en componentes | L |
| ARCH-SKIP-SERVICE-04 | P2 | confirmado | arq | god-routes escritura sin transacción | L |
| LGS-USERFACING-01 | P2 | confirmado | legacy | redirect a letsgospeak.cl tras firmar | S |
| LGS-USERFACING-02 | P2 | confirmado | legacy | recibo PDF marca LGS / LGS-#### | S |
| LGS-USERFACING-03 | P2 | confirmado | legacy | WhatsApp/IA dicen Let's Go Speak | S |
| LGS-USERFACING-04 | P2 | confirmado | legacy | badge LGS + URLs material Wix | M |
| LGS-MATERIAL-07 | P2 | confirmado | motor | sección Material siempre vacía | M |
| ENG-TZ-03 | P2 | parcial | motor | mezcla Santiago/UTC en semana ISO | M |
| RBAC-ORPHAN-05 | P2 | parcial | rbac | roles huérfanos (fail-closed en outage) | S |
| PROD-SPACES-08 | P2 | refutado→OPENAI | prod | falta OPENAI_API_KEY (Spaces OK) | S |
| DATA-MONEY-10 | P2 | parcial | datos | parseCurrency formato Colombia | S |
| SCHEMA-RUNTIME-DDL-11 | P2 | parcial | datos | DDL en path de request | M |
| DATA-DELETE-ORPHAN-17 | P2 | confirmado | datos | delete beneficiario deja login/bookings huérfanos | M |
| DATA-APPROVE-WELCOME-18 | P2 | confirmado | datos | approve crea ACADEMICA sin inicioCurso | S |
| DATA-CRON-ACTIVATE-EMAIL-19 | P2 | confirmado | datos | cron activa hermanos por email | S |
| ARCH-PATTERN-05 | P3 | confirmado | arq | repos sin BaseRepository / rutas sin handler | M |
| LGS-INTERNAL-05 | P3 | confirmado | legacy | refs LGS internas (verificar empresa:'LGS') | M |
| DEADDEP-07 | P3 | confirmado | legacy | 8 dependencias muertas (xlsx CVE) | S |
| DEADCODE-08 | P3 | confirmado | legacy | DashboardCharts + endpoint huérfanos | S |
| PROD-COMENTARIOS-DEAD-01 | P3 | confirmado | prod | comments.repository tabla inexistente (muerto) | S |
| PROD-WIX-LEGACY-01 | P3 | confirmado | prod | FUNCIONES WIX legacy en src/ | S |
| PROD-COMPLEMENTARIA-01 | — | refutado | prod | tabla SÍ existe (migration 11) | — |
| PROD-CRONS-OK-01 | — | descarte | prod | crons sin riesgo | — |
