# Gymfullness — Guía de puesta en producción (costo $0)

Esta guía te lleva paso a paso, sin necesidad de ser experto, desde el código hasta la app
funcionando en tu dominio, con inicio de sesión con Google y sincronización en la nube.
No hace falta instalar herramientas de línea de comandos: todo se hace desde páginas web.

> **Importante:** todo es opcional excepto el paso 1. Sin Firebase la app funciona completa en
> modo invitado (los datos se guardan en el celular). Firebase solo agrega "Continuar con Google"
> y la copia en la nube. La clave de Claude solo mejora las respuestas del entrenador.

---

## 0. Qué corre dónde y por qué cuesta $0

| Pieza | Dónde | Plan | Costo |
|---|---|---|---|
| La app (PWA: HTML/JS) | Vercel | Hobby | Gratis |
| Entrenador con IA (`/api/coach`) | Vercel Functions | Hobby | Gratis (la función); la IA es opcional (ver abajo) |
| Inicio de sesión con Google | Firebase Authentication | Spark | Gratis |
| Copia en la nube (sincronización) | Cloud Firestore | Spark | Gratis dentro de la cuota diaria |
| Datos del día a día | El propio celular (IndexedDB) | — | Gratis |

**Por qué no genera gastos:**

- **La app es "local primero".** Todo se guarda en el celular y funciona sin internet. La nube
  es solo una copia, así que casi no se usa.
- **Firebase Spark no pide tarjeta.** Si algún día se llegara al límite gratuito, las peticiones
  a la nube fallan hasta el día siguiente (la app sigue funcionando y sincroniza después);
  **nunca te cobran** porque no hay cuenta de facturación.
- **Pocas lecturas:** la app no usa "tiempo real". Al abrirla solo pide lo que cambió desde la
  última vez (unas 5 lecturas). Solo la primera vez en un dispositivo nuevo lee todo el historial.
  Cuota gratuita de Firestore: **50 000 lecturas, 20 000 escrituras y 20 000 borrados por día,
  1 GiB guardado**. Un usuario activo usa menos de 100 lecturas y 20 escrituras al día, así que
  alcanza para cientos de usuarios.
- **Vercel Hobby:** incluye transferencia y ejecuciones de funciones de sobra para pocos usuarios.
  Ojo: el plan Hobby es para **uso personal / no comercial**. Si vas a cobrar por la app, pasa a
  Vercel Pro o publica la parte estática en un hosting gratuito que permita uso comercial.
- **IA (opcional):** si pones una clave de Claude, cada pregunta al entrenador cuesta
  aproximadamente **0,0003 US$** (modelo Claude Haiku 5.5: 0,10 US$ por millón de tokens de entrada
  y 0,50 US$ por millón de salida; una pregunta usa ~900 de entrada y ~300 de salida).
  Es decir, **unas 3 000 preguntas por 1 US$**. Revisa los precios vigentes en la página de
  precios de Claude antes de presupuestar. Sin clave, el entrenador responde sin internet con
  respuestas predefinidas (gratis).

---

## 1. Publicar la app en Vercel (obligatorio)

1. Sube este repositorio a tu cuenta de GitHub.
2. Entra a <https://vercel.com>, inicia sesión con GitHub y elige **Add New… → Project**.
3. Importa el repositorio. Vercel detecta Vite automáticamente (el archivo `vercel.json` ya trae
   la configuración). No cambies nada y pulsa **Deploy**.
4. Al terminar tendrás una dirección como `https://tu-app.vercel.app`. Ábrela en el celular:
   la app ya funciona en modo invitado. En Chrome/Android: menú → **Instalar app**; en iPhone:
   Safari → Compartir → **Agregar a inicio**.
5. (Opcional) Dominio propio: Vercel → tu proyecto → **Settings → Domains** → agrega tu dominio y
   sigue las instrucciones de DNS.

Apunta tu dominio de producción (por ejemplo `tu-app.vercel.app` y/o `midominio.com`): lo
necesitarás en el paso 4.

---

## 2. Crear el proyecto de Firebase

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google.
2. **Crear un proyecto** (o "Add project") → ponle un nombre, por ejemplo `gymfullness`.
3. Google Analytics: **desactívalo** (no se necesita) → **Crear proyecto**.
4. El proyecto queda en el plan **Spark (gratis)**. No agregues tarjeta ni actives Blaze.

## 3. Activar el inicio de sesión con Google

1. En el menú izquierdo: **Compilación (Build) → Authentication → Comenzar (Get started)**.
2. Pestaña **Sign-in method** → **Google** → **Habilitar**.
3. Elige tu correo como "correo de asistencia" → **Guardar**.

## 4. Autorizar tus dominios

Sin esto, al tocar "Continuar con Google" verás el mensaje *"Dominio no autorizado en Firebase"*.

1. **Authentication → Settings → Authorized domains (Dominios autorizados) → Add domain**.
2. Agrega tu dominio de Vercel: `tu-app.vercel.app` (sin `https://`).
3. Agrega también tu dominio propio si tienes uno: `midominio.com` (y `www.midominio.com` si lo usas).
4. `localhost` ya viene autorizado (sirve para pruebas en tu computador).

> Las versiones de prueba de Vercel (Preview) usan direcciones distintas en cada despliegue;
> prueba el inicio de sesión en la dirección de producción, o agrega cada una si la necesitas.

## 5. Registrar la app web y copiar la configuración

1. Arriba a la izquierda, el engranaje ⚙ → **Configuración del proyecto (Project settings)**.
2. En **Tus apps (Your apps)** pulsa el ícono **Web `</>`**.
3. Ponle un apodo (`gymfullness-web`). **No** marques Firebase Hosting. → **Registrar app**.
4. Verás un bloque `firebaseConfig` como este:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "gymfullness-xxxx.firebaseapp.com",
     projectId: "gymfullness-xxxx",
     storageBucket: "gymfullness-xxxx.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

   Estos valores **no son secretos** (viajan en la app de todas formas). La seguridad la dan las
   reglas del paso 7.

## 6. Pasar la configuración a Vercel

1. Vercel → tu proyecto → **Settings → Environment Variables**.
2. Crea estas variables (entorno **Production**; marca también **Preview** si quieres):

   | Nombre | Valor (del bloque anterior) |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | `apiKey` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `VITE_FIREBASE_PROJECT_ID` | `projectId` |
   | `VITE_FIREBASE_APP_ID` | `appId` |
   | `VITE_FIREBASE_STORAGE_BUCKET` (opcional) | `storageBucket` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` (opcional) | `messagingSenderId` |

3. Guarda. Todavía no redespliegues: primero crea la base de datos.

## 7. Crear Firestore y pegar las reglas de seguridad

1. Firebase → **Compilación (Build) → Firestore Database → Crear base de datos**.
2. Si te pregunta la edición, elige **Standard**.
3. **Ubicación:** la más cercana a tus usuarios. Ejemplos: Colombia, Centroamérica, México o el
   Caribe → `us-east1` (Carolina del Sur); Sudamérica → `southamerica-east1` (São Paulo).
   **No se puede cambiar después.**
4. Elige **Modo de producción (Production mode)** → **Crear**.
5. Ve a la pestaña **Reglas (Rules)**, borra todo el contenido y pega el archivo
   [`firestore.rules`](../firestore.rules) de este repositorio → **Publicar**.

   Estas reglas permiten que cada persona lea y escriba **solo sus propios datos**
   (`users/{su uid}/…`) y bloquean todo lo demás.

## 8. Redesplegar

Las variables `VITE_…` se incluyen al construir la app, así que hay que volver a construirla:

1. Vercel → tu proyecto → **Deployments** → en el último despliegue, menú **⋯ → Redeploy**.
2. Abre la app → **Perfil** (o la bienvenida) → **Continuar con Google**.
3. Tras iniciar sesión, tus datos se suben solos. En otro dispositivo, inicia sesión con la misma
   cuenta y aparecerán tus rutinas, entrenos y medidas.

Si algo falla, revisa la tabla de **Solución de problemas** al final.

---

## 9. iPhone / Safari: inicio de sesión por redirección (opcional, recomendado si tienes usuarios de iPhone)

La app intenta primero una **ventana emergente** de Google. Si el navegador la bloquea, o si la
app está instalada en la pantalla de inicio del iPhone, usa **redirección** (la página va a Google
y vuelve).

Safari (y otros navegadores con protección de rastreo) puede romper la redirección cuando el
dominio de la app (`tu-app.vercel.app`) es distinto del `authDomain` de Firebase
(`tu-proyecto.firebaseapp.com`): vuelves a la app sin sesión iniciada. La solución es servir las
páginas de inicio de sesión de Firebase desde tu propio dominio:

1. En `vercel.json`, agrega esta regla **al principio** de `"rewrites"` (antes de la regla que
   envía todo a `/index.html`). Cambia `TU-PROYECTO` por tu `projectId`:

   ```json
   {
     "rewrites": [
       { "source": "/__/auth/:path*", "destination": "https://TU-PROYECTO.firebaseapp.com/__/auth/:path*" },
       { "source": "/((?!api/|assets/|.*\\..*).*)", "destination": "/index.html" }
     ]
   }
   ```

2. En Vercel, cambia `VITE_FIREBASE_AUTH_DOMAIN` a tu dominio de la app, por ejemplo
   `tu-app.vercel.app` (o `midominio.com`).
3. En <https://console.cloud.google.com> (mismo proyecto) → **APIs y servicios → Credenciales** →
   el cliente OAuth "Web client (auto created by Google Service)" → **URIs de redireccionamiento
   autorizados** → agrega `https://tu-app.vercel.app/__/auth/handler` → Guardar.
4. Asegúrate de que el service worker no intercepte esas páginas: en `vite.config.ts`,
   `workbox.navigateFallbackDenylist` debe incluir `/^\/__\//` (además de `/^\/api\//`).
5. Redespliega.

---

## 10. Entrenador con IA (opcional)

Sin esto, el botón "Pregúntale al entrenador" responde al instante con consejos predefinidos
(técnica, respiración, errores, dolor, peso, reps, descanso, calentamiento, alternativas,
agujetas, progresión), incluso sin internet.

Para respuestas personalizadas con Claude:

1. Crea una cuenta en la consola de Claude (<https://platform.claude.com>), carga un poco de
   saldo y crea una **API key**.
2. **Pon un límite de gasto mensual** en la sección de límites de la consola (por ejemplo 5 US$)
   para no llevarte sorpresas.
3. Vercel → **Settings → Environment Variables** → agrega `ANTHROPIC_API_KEY` con tu clave.
   **Nunca** le pongas el prefijo `VITE_`: debe quedarse solo en el servidor.
4. (Opcional) `COACH_DAILY_LIMIT` = máximo de preguntas al día por instancia (por ejemplo `200`).
5. Redespliega. La app detecta sola que la IA está disponible.

Protecciones incluidas: solo acepta peticiones de tu propia app, preguntas de hasta 500
caracteres, 20 preguntas por hora por persona (aprox.), respuestas cortas y un modelo económico.
Si la IA falla o tarda más de 15 s, la app responde con los consejos sin internet.

---

## 11. Copias de seguridad

- **Exportar:** **Perfil → Exportar datos (JSON)**. Guarda el archivo en Google Drive o en tu correo.
  Hazlo de vez en cuando aunque uses la nube.
- **Importar:** **Perfil → Importar datos** con ese archivo.
- Con sesión iniciada, Firestore guarda una copia adicional. El plan gratuito no incluye copias
  automáticas de Firestore, por eso conviene exportar.
- Para borrar la copia de la nube de una cuenta, usa la opción de borrar datos en **Perfil**
  (con sesión iniciada) o elimina el usuario en Firebase → Authentication → Users.

## 12. Mantenimiento

- **Uso de la nube:** Firebase → Firestore → **Uso (Usage)**. Con pocos usuarios estarás muy lejos
  de los límites.
- **Errores del servidor:** Vercel → tu proyecto → **Logs** (solo aplica al entrenador con IA).
- **Actualizar la app:** cada `git push` a la rama principal redespliega solo. Los usuarios reciben
  la nueva versión automáticamente al volver a abrir la app.
- **Cambiar de dominio:** agrégalo en Vercel (Domains) y en Firebase (Authorized domains).

## 13. Desarrollo local (opcional)

```bash
cp .env.example .env.local   # rellena las VITE_FIREBASE_* si quieres probar el login
npm install
npm run dev                  # http://localhost:5173
```

El endpoint `/api/coach` no corre con `npm run dev` (la app usa las respuestas sin internet).
Para probarlo localmente puedes usar `npx vercel dev`.

---

## Solución de problemas

| Mensaje o síntoma | Causa | Solución |
|---|---|---|
| "Dominio no autorizado en Firebase: añade … en Authentication → Settings" | El dominio no está en la lista | Paso 4 |
| "El acceso con Google no está activado…" | Proveedor Google apagado | Paso 3 |
| "La configuración de Firebase no es válida…" | Variable mal copiada | Paso 6 y redesplegar |
| No aparece "Continuar con Google" | Faltan variables `VITE_FIREBASE_*` o no redesplegaste | Pasos 6 y 8 |
| "No hay permiso para sincronizar…" | Reglas sin publicar | Paso 7.5 |
| "Falta crear la base de datos Firestore…" | Firestore no creado | Paso 7 |
| "Se alcanzó el límite gratuito de hoy…" | Cuota diaria agotada | Se reanuda solo al día siguiente; los datos siguen en el celular |
| En iPhone vuelves de Google sin sesión | Redirección bloqueada por Safari | Paso 9 |
| Se cierra la ventana de Google sin hacer nada | La cerraste o el navegador la bloqueó | Vuelve a intentarlo; si persiste, permite ventanas emergentes |
| El entrenador responde siempre igual (sin IA) | Falta `ANTHROPIC_API_KEY`, sin internet o límite alcanzado | Paso 10 |
