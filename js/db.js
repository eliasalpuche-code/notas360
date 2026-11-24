// Almacenamiento local con IndexedDB. Todo funciona sin internet.
// Cada cambio guarda su fecha ('actualizado') y cada borrado deja una marca en 'borrados',
// así la sincronización sabe qué versión es la más reciente en cada dispositivo.
const DB_NAME = 'mf360';
const DB_VERSION = 3;
const STORES = ['cuentas', 'personas', 'movimientos', 'recordatorios', 'meta', 'borrados'];
export const DATOS = ['cuentas', 'personas', 'movimientos', 'recordatorios', 'meta'];
// Registros de 'meta' que pertenecen solo a este dispositivo y nunca se sincronizan.
export const META_LOCAL = ['seguridad', 'sync'];

let dbPromise = null;
const oyentes = [];

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const esLocal = (store, id) => store === 'meta' && META_LOCAL.includes(id);
function avisar(store, id) {
  if (esLocal(store, id) || store === 'borrados') return;
  for (const f of oyentes) { try { f(store, id); } catch (e) { /* nada */ } }
}

export const db = {
  onCambio(f) { oyentes.push(f); },
  all: (store) => tx(store, 'readonly', (s) => reqP(s.getAll())),
  get: (store, id) => tx(store, 'readonly', (s) => reqP(s.get(id))),
  put: (store, obj) => {
    const now = new Date().toISOString();
    const rec = { ...obj, id: obj.id || uid(), actualizado: now, creado: obj.creado || now };
    return tx(store, 'readwrite', (s) => reqP(s.put(rec))).then(() => { avisar(store, rec.id); return rec; });
  },
  async del(store, id) {
    await tx(store, 'readwrite', (s) => reqP(s.delete(id)));
    if (!esLocal(store, id)) {
      await tx('borrados', 'readwrite', (s) => reqP(s.put({ id: store + '|' + id, store, recId: id, actualizado: new Date().toISOString() })));
    }
    avisar(store, id);
  },
  clear: (store) => tx(store, 'readwrite', (s) => reqP(s.clear())),

  // Escritura directa (sin cambiar fechas ni avisar). La usa la sincronización.
  putRaw: (store, rec) => tx(store, 'readwrite', (s) => reqP(s.put(rec))),
  delRaw: (store, id) => tx(store, 'readwrite', (s) => reqP(s.delete(id))),

  // Todo lo que se sincroniza: datos + marcas de borrado.
  async snapshot() {
    const out = {};
    for (const s of DATOS) {
      const l = await this.all(s);
      out[s] = s === 'meta' ? l.filter((r) => !META_LOCAL.includes(r.id)) : l;
    }
    out.borrados = await this.all('borrados');
    return out;
  },

  // Deja la base local exactamente como 'snap' (sin tocar los registros locales del dispositivo).
  async aplicar(snap) {
    for (const s of [...DATOS, 'borrados']) {
      const actuales = await this.all(s);
      const nuevos = new Map((snap[s] || []).map((r) => [r.id, r]));
      for (const r of actuales) {
        if (esLocal(s, r.id)) continue;
        if (!nuevos.has(r.id)) await this.delRaw(s, r.id);
      }
      const porId = new Map(actuales.map((r) => [r.id, r]));
      for (const [id, r] of nuevos) {
        if (esLocal(s, id)) continue;
        const a = porId.get(id);
        if (!a || a.actualizado !== r.actualizado) await this.putRaw(s, r);
      }
    }
  },

  async exportAll() {
    const out = { app: 'mis-finanzas-360', version: 1, exportado: new Date().toISOString() };
    for (const s of DATOS) {
      const l = await this.all(s);
      out[s] = s === 'meta' ? l.filter((r) => r.id !== 'sync') : l;
    }
    return out;
  },
  async importAll(data) {
    if (!data || data.app !== 'mis-finanzas-360') throw new Error('El archivo no es un respaldo de Mis Finanzas 360.');
    const sync = await this.get('meta', 'sync');
    const ahora = new Date().toISOString();
    for (const s of ['borrados', ...DATOS]) {
      // Marca como borrado lo que no viene en el respaldo, para que otros dispositivos también lo quiten.
      const previos = s === 'borrados' ? [] : await this.all(s);
      await this.clear(s);
      const vienen = new Set((data[s] || []).map((r) => r.id));
      for (const r of previos) if (!vienen.has(r.id) && !esLocal(s, r.id)) await this.putRaw('borrados', { id: s + '|' + r.id, store: s, recId: r.id, actualizado: ahora });
      for (const rec of data[s] || []) {
        if (s === 'meta' && rec.id === 'sync') continue;
        // Lo restaurado cuenta como cambio reciente para que gane al sincronizar.
        await this.putRaw(s, META_LOCAL.includes(rec.id) && s === 'meta' ? rec : { ...rec, actualizado: ahora });
      }
    }
    if (sync) await this.putRaw('meta', sync);
    avisar('import', '');
  },

  async borrarTodo() {
    for (const s of STORES) await this.clear(s);
  }
};
