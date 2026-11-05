# Gymfullness — Guía de despliegue (Cloudflare Pages, costo $0)

Todo corre gratis para pocos usuarios y se puede usar comercialmente.

## Qué corre dónde

| Pieza | Servicio | Plan | Costo |
|---|---|---|---|
| App (PWA estática) | Cloudflare Pages | Free | $0, ancho de banda ilimitado, uso comercial permitido |
| Entrenador IA (`/api/coach`) y asistente (`/api/agent`) | Cloudflare Pages Functions | Free (100.000 peticiones/día) | $0 |
| Login con Google + copia en la nube | Firebase Auth + Firestore | Spark | $0 (límites muy por encima de pocos usuarios) |
| IA del entrenador (opcional) | Gemini / GLM / Groq / Claude | ver abajo | $0 – centavos |

Sin nada configurado la app ya funciona completa: sin cuenta, datos en el teléfono, comandos de voz locales y respuestas de técnica sin internet.

## 1. Publicar en Cloudflare Pages (obligatorio, ~3 min)

1. Entra a <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages → Connect to Git**.
2. Autoriza GitHub y elige el repositorio `Gymfullness`.
3. Configuración de build:
   - **Framework preset:** Vite (o ninguno)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Variable:** `NODE_VERSION` = `22`
4. **Save and Deploy**. Cada `git push` a `main` publica solo. Quedará en `https://gymfullness.pages.dev`.
5. En el celular abre esa dirección → menú del navegador → **Añadir a pantalla de inicio** (se instala como app).

Dominio propio (opcional): proyecto → **Custom domains**.

## 2. Login con Google + sincronización (opcional)

1. <https://console.firebase.google.com> → **Add project** (sin Analytics).
2. **Build → Authentication → Get started → Google → Enable**.
3. **Authentication → Settings → Authorized domains** → agrega `gymfullness.pages.dev` (y tu dominio propio).
4. **Project settings → Your apps → Web (`</>`)** → registra la app y copia la config.
5. **Build → Firestore Database → Create** (modo producción, región cercana) → pestaña **Rules** → pega el contenido de `firestore.rules` → Publish.
6. Cloudflare → tu proyecto → **Settings → Variables and secrets** → agrega (Production **y** Preview):
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
   (Son valores públicos de la app web, no secretos.) Luego **Deployments → Retry deployment**.

**iOS/Safari:** si el login en iPhone falla, define también `FIREBASE_PROJECT_ID` (misma id) en Cloudflare y pon
`VITE_FIREBASE_AUTH_DOMAIN` = tu dominio de la app (`gymfullness.pages.dev`). La función `functions/__/auth`
sirve las páginas de Firebase desde tu dominio. Añade `https://TU-DOMINIO/__/auth/handler` en Google Cloud →
Credentials → tu OAuth client → **Authorized redirect URIs**.

## 3. Entrenador con IA (opcional)

La app resuelve gratis y sin internet las órdenes comunes ("80 kilos 10 reps", "siguiente", "descanso"). La IA
solo responde preguntas abiertas. Elige UN proveedor y agrega las variables como **Secrets** en
**Settings → Variables and secrets** (no uses el prefijo `VITE_`); luego redeploy:

| Proveedor | Variables | Costo aproximado |
|---|---|---|
| **Gemini** (recomendado para $0) | `GEMINI_API_KEY` (de <https://aistudio.google.com/apikey>), opcional `COACH_MODEL` | Capa gratuita |
| **Claude Haiku 5.5** | `ANTHROPIC_API_KEY`, opcional `COACH_MODEL` | ~US$0.0015 por pregunta |
| **GLM / Groq / OpenRouter / DeepSeek / otro compatible OpenAI** | `COACH_API_KEY`, `COACH_BASE_URL` (p. ej. `https://open.bigmodel.cn/api/paas/v4`, `https://api.groq.com/openai/v1`, `https://openrouter.ai/api/v1`), `COACH_MODEL` | Muchos tienen modelos gratuitos |

Opcional: `COACH_PROVIDER` (`anthropic`, `gemini` u `openai`) para forzar uno si hay varias claves;
`COACH_DAILY_LIMIT` (p. ej. `200`) para limitar preguntas al día; `COACH_ALLOWED_ORIGINS` para dominios extra.
Si el proveedor falla o se agota la cuota, la app responde con su entrenador sin internet.

### 3b. Asistente con IA que "hace todo en la app" (opcional, mismas claves)

El asistente (`/api/agent`) usa **las mismas variables** del entrenador: si ya configuraste la IA en el paso 3, ya funciona;
no hay nada más que activar. Cómo está pensado para costar casi $0:

1. **Capa local gratis (sin internet):** órdenes como «80 por 10», «siguiente», «deshacer», «descanso de 2 minutos»,
   «registra mi peso 78», «qué entreno hoy», «cómo voy en press de banca», «añade dominadas», «cambia a libras» o dudas
   de técnica se resuelven en el teléfono, sin llamar a ninguna IA.
2. **Solo lo abierto va a la IA** («crea una rutina de pecho y tríceps»). El modelo propone acciones (herramientas) que el
   **navegador ejecuta sobre los datos locales**; el servidor solo ve los mensajes de ese turno (≤ 12 mensajes, ≤ 24 KB), no
   guarda nada y no tiene acceso a tu base de datos.
3. Las acciones delicadas (terminar el entreno, crear rutinas, cambiar el plan o ajustes) piden **confirmación** en pantalla.
4. Si la IA falla, se acaba la cuota o no hay clave, la app responde con lo que sabe hacer sin IA (nunca se queda en blanco).

Variables opcionales (si no existen se usan las `COACH_*` equivalentes): `AGENT_PROVIDER`, `AGENT_MODEL`,
`AGENT_DAILY_LIMIT` (tope diario por instancia del servidor), `AGENT_ALLOWED_ORIGINS`. Cada instalación además tiene un
tope suave de **40 consultas con IA por día** (guardado en el teléfono; las órdenes locales no cuentan).

Modelos por defecto: Claude `claude-haiku-5-5` (esfuerzo bajo, pensamiento desactivado, caché de prompt en instrucciones y
herramientas) y Gemini `gemini-2.5-flash-lite` (capa gratuita). Para GLM/Groq/OpenRouter/DeepSeek elige un modelo que
soporte *tool calling*. Límite por IP: 60 peticiones/hora. `COACH_BASE_URL` debe ser `https://…` (o `http://localhost`
real); cualquier otra cosa se rechaza.

**Costo estimado por consulta con IA** (medido: instrucciones ≈ 2.6 KB y 20 herramientas ≈ 8.2 KB, unos 3 300 tokens fijos
que se cachean; contexto de la app + mensaje ≈ 350 tokens; el caché de Haiku 5.5 empieza en 512 tokens, así que aplica):

| Concepto (Claude Haiku 5.5: US$0.10 entrada / US$0.50 salida por MTok, hasta 100 K de prompt) | Tokens | US$ |
| --- | --- | --- |
| Prefijo fijo con caché leído (0.1×) | 3 300 | 0.000033 |
| Prefijo fijo sin caché (primer uso o tras 5 min: escritura 1.25×) | 3 300 | 0.00041 |
| Contexto + mensaje (sin caché) | 350 | 0.000035 |
| Salida de una llamada a herramienta o respuesta corta | 60–100 | 0.00003–0.00005 |
| **Consulta típica (2 vueltas al modelo: acción + respuesta), caché caliente** | | **≈ 0.0003** |
| Consulta típica con caché frío | | ≈ 0.0007 |
| Peor caso (4 vueltas, caché frío) | | ≈ 0.002 |

Es decir, unos **US$0.30 por cada 1 000 consultas** con caché caliente. Con el tope de 40 consultas/día por instalación,
un usuario muy intensivo cuesta como máximo ≈ US$0.08/día y uno normal (≈ 10/día) ≈ US$0.003/día. Las órdenes locales
(«80 por 10», «siguiente»…) cuestan US$0 y suelen ser la mayoría.

**Gemini gratis (`gemini-2.5-flash-lite`):** sin costo, pero la capa gratuita tiene cuotas bajas por clave (del orden de
15 peticiones/minuto y unos cientos o pocos miles por día; revisa los límites vigentes en Google AI Studio). Cada consulta
usa 1–3 peticiones, así que alcanza para uso personal o un grupo pequeño; con muchos usuarios verás 429 (la app responde en
modo básico). Además, en la capa gratuita Google puede usar los mensajes para mejorar sus productos: no pongas datos sensibles.
Se activa con `GEMINI_API_KEY` (paso 3).

## 4. Desarrollo local

```bash
npm install
npm run dev          # app en http://localhost:5173 (el coach IA responde sin internet)
npm test             # pruebas unitarias
npm run e2e          # pruebas de extremo a extremo (Playwright)
npx wrangler pages dev dist   # (tras npm run build) probar también las Functions
```

## 5. Respaldo y mantenimiento

- Los datos de cada persona están en su teléfono; con Google además en Firestore.
- **Perfil → Exportar datos** descarga un JSON de respaldo; **Importar** lo restaura.
- Mantenimiento esperado ≈ 0: sin servidores que cuidar, sin base de datos propia, actualizaciones solo con `git push`.
- Si el tráfico crece: Pages Functions Free permite 100k peticiones/día; Firebase Spark ~50k lecturas/día.
