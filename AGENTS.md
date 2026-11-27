# Teacher Diego — instrucciones para agentes

Cliente: **Diego**, maestro de inglés (cliente de Asesor Sebas desde nov 2026). Marca **"Teacher Diego · El manual"**: la plataforma es su manual de inglés en línea con membresía.
Objetivo: que se registren y paguen solos (suscripción mensual en Mercado Pago), que solo entren los que están al corriente y que su metodología no circule fuera de la plataforma.

## Estado (25 nov 2026): cascarón / primera versión
- Hecho desde cero (sin Lovable). Landing, entrar con código, área de alumnos `/clases`, panel `/admin`, Mercado Pago listo para conectar, videos en Cloudflare Stream. 12 pruebas pasan.
- **Falta de Diego** (ya se le pidió): precios Normal y VIP, qué incluye cada una, lista y orden de los 36–40 videos (y su duración), ejemplos de sus documentos, si habrá clases en vivo, su correo (admin) y WhatsApp, dominio, fotos (solo hay 1: `public/s/img/diego-*.webp`), nombre completo y domicilio para el aviso de privacidad.
- Textos de la landing ("Hi! I'm Diego", preguntas, beneficios VIP) son de borrador: Diego los revisa. VIP tiene puntos marcados "por definir".

## Concepto de marca (lo que dijo Diego, 26–27 nov 2026)
- La marca es **"el método Teacher Diego"**, no Diego en persona: sin fotos suyas en la página; alumnos de todas las edades y distintos maestros. Le gusta el nombre Teacher Diego.
- **Eslogan elegido por Diego: "Fácil y rápido"** (el inglés es fácil y rápido). Las dos flechas significan eso: rápido, sencillo, dirigido.
- Colores que le gustan y se respetan: azul, rojo y perla (los de su logo anterior "Aprende inglés"). Propuestas de logo en `diseno/logo-*.html` (flechas planas; favoritas de Sebas: con líneas de velocidad, opción 3 "flecha con cola"). Bocetos de personaje en `diseno/personaje-conceptos.html` (Manu, el manual, recomendado).
- Historia: maestro de inglés desde hace **18 años**. Empezó a hacer TikTok por una tarea de la universidad y se volvió creador de contenido de inglés; quiere hacer muy bien YouTube y TikTok. La plataforma es para monetizar a la gente que llega por redes. Para él es el proyecto central, su siguiente paso.
- **El manual**: lo hizo él (con su conocimiento y ayuda de IA) para venderlo; muy práctico y sencillo: explicación breve de cada tema + práctica. Mucha gente se lo pide.
- Le gusta el concepto de multinivel, pero quiere enfocarse en ser maestro de inglés (posible idea futura: maestros o embajadores que impartan o recomienden el método).
- Oferta: una sola membresía (grabaciones, ejercicios en línea, manual y asesoría semanal); clases personalizadas con él aparte. Hoy tiene ~5 alumnos. Precio de la plataforma pendiente de cerrar con Sebas (Diego esperaba máx. $4,000); videos en Stream a costo real.

## Modelo de venta que propone Diego (audio largo, 27 nov 2026) — CAMBIA el modelo de la plataforma, falta confirmar detalles
- Embudo: TikTok/YouTube + tarjetas con QR → **landing que vende la plataforma** ("¿Quieres aprender inglés y no has podido?") → se registra y paga → acceso automático.
- **3 niveles = 3 manuales**: Básico (12 temas), Intermedio (12), Avanzado (resto; ~35 temas en total). Cada tema = explicación breve + actividades + clase grabada. Avanzado incluye examen.
- **Pago por nivel, $400**: incluye los 12 temas y 12 clases grabadas **para siempre** + **1 asesoría en vivo por semana durante un mes (4)**. Al terminar el mes pierde las asesorías (no los temas); puede pagar otro mes para volver a tener asesorías.
- Diego da 3 asesorías en vivo por semana: una de básicos, una de intermedios y una de avanzados, agendadas. Quiere que queden grabadas y que cada alumno vea al menos las de su mes.
- No quiere vender el manual solo (decepciona al que esperaba clases). Botón final "Quiero clases particulares" → WhatsApp.
- Habla de alumnos de Perú y Colombia: revisar cobro internacional en Mercado Pago.
- Implica: pago único por nivel (Checkout Pro) en vez de suscripción; tabla de compras por nivel; asesorías con horario y liga en vivo; grabaciones de asesorías en Stream con caducidad sugerida (~2 meses) para que el almacenamiento no crezca sin fin.

## Reglas de negocio
- Membresías: `normal` y `vip`. VIP ve todo; Normal solo lo marcado "Normal y VIP". Módulos, videos y lecciones tienen `plan_min`; manda el más alto entre el módulo y el elemento.
- Acceso (`accesoDe` en `worker/db.js`): cortesía siempre; si no, mientras `acceso_hasta` (pagado hasta) + `GRACIA_DIAS` (3) no haya pasado. Estados: cortesia, al_corriente, gracia, vencido, sin_pago, baja. Los admins (`ADMIN_EMAILS`) siempre entran como VIP.
- Cada cobro aprobado suma **un mes** (`registrarPago` en `worker/mp.js`, una sola vez por id de MP): si estaba vigente se suma a su fecha, si había vencido cuenta desde hoy. Si cancela, conserva lo pagado y se apaga solo al vencer.
- Pagos en efectivo/transferencia: ficha del alumno → "Registrar pago en efectivo" (también suma un mes).
- **Una sola sesión por alumno**: entrar en otro dispositivo cierra la anterior (frena cuentas prestadas). Admins pueden tener varias.
- Login: código de 6 dígitos por correo (Resend), 15 min, 5 intentos, 5 códigos por hora; cookie `td_sesion` de 30 días (en la base solo el hash). Correo nuevo → registro con nombre, correo y WhatsApp.
- Mensajes de WhatsApp: "Hola Teacher Diego, vengo de <dominio>." (+ "vi tu anuncio" con `?utm_source=`).

## Protección del material
- Las lecciones no existen como PDF: se escriben en el panel con un formato sencillo (`public/s/formato.js`, la chuleta está en el editor) y se guardan en D1. Al alumno nunca le llegan las respuestas correctas: califica el Worker.
- Marca de agua en mosaico con el correo del alumno y la fecha sobre la lección; sobre el video, su correo se mueve cada 9 s. Sin seleccionar texto, sin menú contextual, al imprimir sale en blanco. Las capturas de pantalla no se pueden evitar: la marca sirve para saber de qué cuenta salió.
- Videos en **Cloudflare Stream** (decisión de Sebas, 25 nov 2026: Vimeo Core con candado de dominio cuesta $900/mes o ~$7,650 de golpe al año; Stream se paga por uso, ~$430–590/mes con 30 alumnos, y lo cobra la cuenta de Sebas, que se lo incluye a Diego en su mensualidad). `worker/stream.js`: Diego sube desde el panel (subida por partes, protocolo tus, del navegador directo a Stream; el Worker solo crea la subida con `requiresignedurls` y máx. 4 h); el panel revisa cada 20 s hasta que Stream termina de procesar (`stream_listo`, minutos automáticos); al alumno solo le llega un iframe con **permiso firmado (JWT RS256) que caduca en 4 h**. La llave de firma se crea sola la primera vez (`meta.stream_llave`). Borrar o reemplazar un video lo borra de Stream (para no pagar almacenamiento). Vimeo sigue soportado como respaldo (pegar liga).
- Config Stream: var `CF_ACCOUNT_ID` (cuenta de Sebas, en `wrangler.jsonc`) + Secret `CF_STREAM_TOKEN` (token de API con permiso **Stream: Edit**). Stream debe estar contratado en la cuenta (mínimo USD 5/mes por 1,000 min guardados; USD 1 por cada 1,000 min vistos).

## Mercado Pago (worker/mp.js) — falta probar con cuentas de prueba
- API de Suscripciones sin plan: `POST /preapproval` por alumno con `external_reference = alumno:<id>:<plan>`, `payer_email`, mensual en MXN, `back_url = /clases?pago=listo`, `status: pending` → se manda al alumno al `init_point`.
- Webhook: `POST /api/mp/aviso` (configurar en la app de MP: Webhooks → eventos **Planes y suscripciones**: `subscription_preapproval` y `subscription_authorized_payment`). Valida `x-signature` con `MP_WEBHOOK_SECRET`; luego consulta a MP el estado real. Todo queda en la tabla `mp_avisos` (pestaña Pagos del panel).
- Al volver del checkout, `/clases` llama a `/api/pago/revisar` (consulta la suscripción y `/authorized_payments/search`) por si el aviso tarda. En el panel: "Revisar en Mercado Pago".
- Cambiar de plan con suscripción activa: `PUT /preapproval/:id` con el monto nuevo (aplica desde el siguiente cobro; el plan cambia ya).
- Ojo a probar: MP puede pedir que el correo del alumno coincida con el de su cuenta de MP.
- Secrets: `MP_ACCESS_TOKEN` (producción, de la cuenta de Diego), `MP_WEBHOOK_SECRET`. Sin token, el botón de pagar manda a WhatsApp.

## Arquitectura (sin compilación, sin npm)
- `worker/index.js` (rutas) · `db.js` (tablas que se crean solas + acceso) · `auth.js` (código por correo, sesiones) · `contenido.js` (catálogo, video, lección) · `admin.js` (panel) · `mp.js` (Mercado Pago) · `stream.js` (videos) · `util.js`.
- `public/`: `index.html` (landing), `entrar.html`, `clases.html` + `s/clases.js`, `admin.html` + `s/admin.js`, `s/hoja.js` (pinta lecciones), `s/formato.js` (lo usan Worker y panel), `s/estilos.css`, `s/app.css`, fuentes Lora + Poppins servidas desde `s/fuentes/`.
- D1 `teacherdiego` (ID 42ea061f-a4fb-4c5a-9ed2-57b25c7bee7a, binding `DB`): `alumnos`, `codigos`, `sesiones`, `modulos`, `videos`, `lecciones`, `respuestas`, `pagos`, `mp_avisos`, `meta`. **Se crean solas** al primer `/api/*` (con un módulo y una lección de ejemplo). Columnas nuevas: agregar a `MIGRACIONES` en `db.js`.
- Precios, WhatsApp, admins y remitente en `vars` de `wrangler.jsonc` (la landing los lee de `/api/publico`). Secrets: `RESEND_API_KEY` (remitente `teacherdiego@asesorsebas.com`), `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`.
- Dominio temporal: `teacherdiego.asesorsebas.com` (custom domain en `routes`). Al tener el dominio de Diego: comprarlo en Cloudflare a su nombre, cambiar `routes`, `DOMINIO`, `REDIRIGIR` (el subdominio viejo), las URLs absolutas `og:`/canonical/robots/sitemap, y (si hubiera videos en Vimeo) agregar el dominio allá.

## Marca
- Colores: marino `#13233F`, azul real `#2148A0` (como su saco), rojo `#C8102E`, perla `#F6F2EA`. Lora (títulos) + Poppins (texto). Logo provisional: portada de manual con "TD" y cinta roja de separador (`public/logo.svg`, `diseno/icono.html`); Edder puede hacer la versión final.
- Estándar cumplido: OG `public/og.jpg` (fuente `diseno/og.html`), favicon e íconos (fuente `diseno/icono.html`), manifest, `EducationalOrganization`, robots, sitemap, 404 y aviso de privacidad (borrador).
- Regenerar imágenes: `google-chrome --headless=new --window-size=1200,630 --screenshot=/tmp/og.png file://$PWD/diseno/og.html` (y 512×512 para el ícono), luego convertir con PIL.

## Pruebas
- `node --test test/*.test.js` (Node 22+, `node:sqlite` simula D1; Mercado Pago simulado). Correr antes de cada commit.
- `node herramientas/dev.mjs` → http://localhost:8787 con alumnos de prueba (diego@demo.mx admin, ana@demo.mx VIP, luis en gracia, carla vencida, pedro sin pago, maría cortesía). El código sale en pantalla. `PRECIO_NORMAL=499 PRECIO_VIP=899 node herramientas/dev.mjs` para ver precios.

## Siguiente etapa (ideas aprobadas en el plan)
- V2: progreso por módulo, Diego comenta las respuestas abiertas, clases en vivo VIP (liga de Zoom/Meet), correo cuando falla un pago, cupones.
- V3: examen de colocación gratis como imán de prospectos, píxel de Meta, constancias de nivel.
