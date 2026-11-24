# Mis Finanzas 360 — Fases 1, 2 y 3

App de finanzas personales (PWA). Funciona sin internet y guarda los datos en el dispositivo (IndexedDB).

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
- El bloqueo protege la app al abrirla. El cifrado completo de los datos llega en la fase 4 con la
  sincronización a Google Drive.

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
Sube la versión de `VERSION` en `sw.js` (ahora `mf360-v1.2.0`; por ejemplo a `mf360-v1.2.1`) para que los dispositivos descarguen la nueva versión.

## Si ya tenías una fase anterior instalada
Sube estos archivos encima de los anteriores en tu repositorio. Tus datos se conservan: la base de datos se
actualiza sola. Cierra y vuelve a abrir la app (a veces dos veces) para que tome la nueva versión.

## Importante mientras no haya sincronización
Los datos viven solo en el dispositivo donde los capturas. Hasta la fase 4 (Google Drive), usa
**Más → Respaldo → Descargar respaldo completo** de vez en cuando y guarda el archivo en tu Drive.
Ese mismo archivo sirve para pasar tus datos a otro dispositivo (*Restaurar desde un respaldo*).

## Archivos
- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/`
- `js/db.js` — almacenamiento local (IndexedDB) y respaldo
- `js/ledger.js` — reglas: tipos de movimiento, saldos, préstamos y pagos
- `js/ui.js` — formato de dinero y fechas, iconos, hojas y avisos
- `js/seguridad.js` — PIN, huella, calculadora camuflada y segundo candado
- `manifest-notas.webmanifest`, `manifest-calc.webmanifest` — nombres discretos
- `js/app.js` — pantallas y navegación

## Siguientes fases
4. Sincronización cifrada con Google Drive (Apps Script) y recordatorios en Google Calendar.
