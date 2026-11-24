# Mis Finanzas 360 — Fases 1 a 4

App de finanzas personales (PWA). Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

## Fase 4: respaldo cifrado en tu Google Drive (Más → Respaldo en Google Drive)
Cada cambio se sube solo, **cifrado en tu dispositivo** con una clave que solo tú conoces. En Drive queda un
archivo ilegible; ni Google ni el script pueden leerlo. Se guarda además una copia por día (últimos 30 días).

### Paso 1. Crear tu script (una sola vez, en la laptop)
1. Entra a **https://script.google.com** con tu Gmail → **Proyecto nuevo**.
2. Arriba, cambia el nombre "Proyecto sin título" por algo discreto, por ejemplo `Notas`.
3. Borra todo el texto del editor y pega el contenido de **`apps-script/Code.gs`**. Presiona **Guardar** (icono de disco).
4. En la barra de arriba, junto a "Depurar", elige la función **`configurar`** y presiona **Ejecutar**.
5. Google pedirá permiso: **Revisar permisos** → elige tu cuenta. Si aparece "Google no verificó esta app":
   **Configuración avanzada → Ir a Notas (no seguro) → Permitir**. Es tu propio script; solo usa tu Drive.
6. Abajo, en el **Registro de ejecución**, aparece **tu código de enlace** (por ejemplo `ABCD-EFGH-JKLM`). Anótalo.
7. Arriba a la derecha: **Implementar → Nueva implementación**. En el engrane elige **Aplicación web**.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).

"Cualquier usuario" es necesario para que la app pueda conectarse; aun así nadie puede usarlo sin tu código
de enlace, y lo que guarda está cifrado.

### Paso 2. Conectar tu primer dispositivo
En la app: **Más → Respaldo en Google Drive** → pega la URL y el código → **Conectar** → crea tu **clave de
cifrado** (mínimo 10 caracteres; por ejemplo cuatro palabras). **Si olvidas esta clave nadie puede abrir tus
datos de Drive**: anótala en un lugar seguro.

### Paso 3. Conectar tus otros dispositivos
Mismo menú → misma URL y código → escribe la **misma clave**. Lo que tenga ese dispositivo se combina con lo de
Drive sin perder nada. Desde ahí, todos ven lo mismo.

### Si te roban o pierdes un dispositivo
- Instala la app en otro, conéctala con tu URL, código y clave: recuperas todo hasta el último cambio.
- En **Respaldo en Google Drive → Dispositivos conectados**, presiona **Desconectar** en el robado. Deja de
  recibir datos y, si alguien abre la app ahí con internet, borra lo que tenga guardado.
- Si crees que alguien vio tu código de enlace, en el script ejecuta la función `nuevoCodigoDeEnlace`.

### Copias diarias
En la misma pantalla aparecen las copias de los últimos días; **Restaurar** regresa todo (en todos tus
dispositivos) a como estaba ese día.

### En tu Drive
Se crea la carpeta **Notas - respaldo** con `actual.dat` y la carpeta `historial`. No la borres ni la muevas.

## Novedades de la fase 3 (Más → Seguridad)
- **PIN de acceso** de 4 a 6 dígitos. Tras 5 intentos fallidos hay que esperar (30 s, luego más).
- **Huella, Face ID o Windows Hello** para entrar sin escribir el PIN (si el dispositivo lo permite).
- **Bloquear al salir:** de inmediato, 1, 5 o 15 minutos en segundo plano. Al salir, el contenido se oculta.
- **Entrada camuflada:** la app abre como una calculadora que funciona. Tu código secreto + "=" lleva al PIN.
- **Nombre e icono discretos:** Mis Finanzas, Notas o Calculadora. Para que cambie en el celular hay que
  reinstalar la app. **Antes descarga un respaldo**: en iPhone, quitar la app borra sus datos.
- **Segundo candado:** elige qué secciones piden PIN otra vez (Cuentas de confianza, Deudas, Personas,
  Tarjetas, Gastos, Movimientos, Cuentas). Puedes usar un PIN de secciones distinto.
- **Olvidé mi PIN:** no se puede recuperar; la única salida es borrar los datos del dispositivo (escribiendo
  BORRAR) y restaurar un respaldo. Por eso conviene descargar respaldos seguido.
- El bloqueo protege la app al abrirla; lo que sube a Drive va cifrado (fase 4).

## Novedades de la fase 2
- **Tarjetas de crédito:** día de corte, días para pagar, límite y disponible. Calcula el pago para no generar
  intereses (descontando las mensualidades de meses sin intereses que aún no vencen) y separa "mis gastos" de
  lo que compraste para otras personas.
- **Pagos y recordatorios** (pestaña Pagos): calendario del mes, atrasados y próximos 45 días con cortes, pagos de
  tarjeta, mensualidades de créditos, cobros y deudas con fecha, y recordatorios propios (una vez o cada mes).
- **Avisos de hoy** en Inicio, según los días de anticipación elegidos (5, 3, 1 o el mismo día). Se quitan solos al
  registrar el pago. Los avisos con la app cerrada llegarán en la fase 4 con Google Calendar.
- **Cuentas de confianza:** desde la ficha de una persona, "Mover a cuentas de confianza". Sin fechas ni avisos de
  cobro, fuera de "Me deben" (opcionalmente dentro del patrimonio). Estados: sin plazo, abonando a su ritmo, plan
  acordado. Se puede convertir el saldo en regalo conservando el historial.
- **Deudas personales:** lo que debes a personas y **créditos formales** (auto, banco, Infonavit) con mensualidad y
  día de pago.
- **Gastos del mes:** cuánto llevas por categoría comparado con el mes anterior, sin límites.

## Qué incluye la fase 1
- Cuentas de banco, efectivo (Efectivo / Caja) y tarjetas de crédito, sin límite de cantidad.
- Movimientos: gasto, ingreso, transferencia, retiro, depósito, pago de tarjeta, préstamo, pago recibido,
  compra para tercero, me prestaron, pago de lo que debo y sin identificar.
- Personas con sus saldos: préstamos, compras para terceros y lo que tú debes, con historial.
- Buscador por persona, banco, importe, concepto o mes.
- Respaldo: descargar y restaurar (JSON) y exportar movimientos para Excel (CSV).
- En pantallas de 900 px o más (laptop) se muestra la barra lateral en lugar de la barra inferior.

Los saldos no se guardan: se calculan siempre a partir de los movimientos, así que editar o borrar uno corrige todo.

## Probar en tu computadora
Dentro de esta carpeta:

```
python -m http.server 8080
```

Abre http://localhost:8080 en Chrome o Edge. (Abrir `index.html` con doble clic no funciona: la app necesita un servidor.)

## Publicar en GitHub Pages
1. Crea un repositorio nuevo (puede ser privado si tienes GitHub Pro; si no, público).
2. Sube todos los archivos de esta carpeta a la raíz del repositorio.
3. En el repositorio: Settings → Pages → Branch: `main`, carpeta `/ (root)` → Save.
4. En un minuto tendrás la dirección `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

## Instalar
- **Android (Chrome):** abre la dirección → menú ⋮ → *Instalar app*.
- **iPhone (Safari):** botón Compartir → *Agregar a inicio*.
- **Windows (Edge o Chrome):** icono de instalar en la barra de direcciones.

## Al publicar cambios
Sube la versión de `VERSION` en `sw.js` (ahora `mf360-v1.3.0`; por ejemplo a `mf360-v1.3.1`) para que los dispositivos descarguen la nueva versión.

## Si ya tenías una fase anterior instalada
Sube estos archivos encima de los anteriores en tu repositorio. Tus datos se conservan: la base de datos se
actualiza sola. Cierra y vuelve a abrir la app (a veces dos veces) para que tome la nueva versión.

## Respaldo en archivo
Además de Drive, en **Más → Respaldo en archivo** puedes descargar todo en un archivo (no va cifrado) o exportar
tus movimientos para Excel.

## Archivos
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/`
- `js/db.js` — almacenamiento local (IndexedDB) y respaldo
- `js/ledger.js` — reglas: tipos de movimiento, saldos, préstamos y pagos
- `js/ui.js` — formato de dinero y fechas, iconos, hojas y avisos
- `js/seguridad.js` — PIN, huella, calculadora camuflada y segundo candado
- `js/sync.js` — cifrado y sincronización con Google Drive
- `apps-script/Code.gs` — el script que pegas en script.google.com
- `manifest-notas.webmanifest`, `manifest-calc.webmanifest` — nombres discretos
- `js/app.js` — pantallas y navegación

## Siguientes fases
- Avisos en Google Calendar (para recibir los recordatorios con la app cerrada).
