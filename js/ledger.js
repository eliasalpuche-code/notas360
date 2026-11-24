// Reglas de negocio: tipos de movimiento y cálculo de saldos.
// Los saldos nunca se guardan: siempre se calculan a partir de los movimientos,
// así un movimiento editado o borrado corrige todo automáticamente.

export const TIPOS_CUENTA = {
  debito: 'Débito',
  ahorro: 'Ahorro',
  digital: 'Digital',
  inversion: 'Inversión',
  efectivo: 'Efectivo',
  credito: 'Tarjeta de crédito',
  credito_formal: 'Crédito (auto, banco, Infonavit…)',
  otra: 'Otra'
};

export const esDeuda = (c) => !!c && (c.tipo === 'credito' || c.tipo === 'credito_formal');

export const ESTADO_CONFIANZA = {
  sin_plazo: 'Sin plazo',
  abonando: 'Abonando a su ritmo',
  plan: 'Plan acordado'
};

export const CATEGORIAS = ['Alimentos', 'Gasolina', 'Hogar', 'Servicios', 'Transporte', 'Salud', 'Ropa', 'Entretenimiento', 'Regalos', 'Nómina', 'Otros'];

export const RECUPERACION = {
  despues: 'Me pagará después',
  partes: 'Me pagará en partes',
  pagado: 'Ya me pagó',
  regalo: 'Es regalo',
  no: 'No necesito recuperarlo'
};

// origen = cuenta de donde sale el dinero; destino = cuenta a donde entra.
// persona: 'req' obligatoria, 'opc' opcional.
export const TIPOS = {
  gasto:           { label: 'Gasto / Compra',            origen: 'Pagado con',             persona: 'opc', categoria: true },
  ingreso:         { label: 'Ingreso',                   destino: 'Recibido en',           persona: 'opc', categoria: true },
  transferencia:   { label: 'Transferencia entre mis cuentas', origen: 'Desde', destino: 'Hacia' },
  retiro:          { label: 'Retiro de efectivo',        origen: 'Retirado de',            destino: 'Hacia (efectivo)' },
  deposito:        { label: 'Depósito de efectivo',      origen: 'Desde (efectivo)',       destino: 'Depositado en' },
  pago_tarjeta:    { label: 'Pago de tarjeta o crédito', origen: 'Pagado desde',           destino: 'Tarjeta o crédito pagado' },
  prestamo:        { label: 'Préstamo a una persona',    origen: 'Sale de',                persona: 'req', acordada: true },
  pago_recibido:   { label: 'Pago recibido de una persona', destino: 'Depositado en',      persona: 'req', aplica: 'cobro' },
  compra_tercero:  { label: 'Compra para tercero',       origen: 'Tarjeta o cuenta usada', persona: 'req', acordada: true, compra: true },
  deuda:           { label: 'Me prestaron',              destino: 'Lo recibí en',          persona: 'req', acordada: true },
  pago_deuda:      { label: 'Pago de lo que debo',       origen: 'Pagado desde',           persona: 'req', aplica: 'deuda' },
  sin_identificar: { label: 'Sin identificar',           origen: 'Salió de' },
  condonacion:     { label: 'Saldo convertido en regalo', persona: 'req', interno: true }
};

export const ORDEN_TIPOS = ['gasto', 'ingreso', 'transferencia', 'prestamo', 'pago_recibido', 'compra_tercero', 'pago_tarjeta', 'retiro', 'deposito', 'deuda', 'pago_deuda', 'sin_identificar'];

const round = (n) => Math.round(n * 100) / 100;

// ¿Este movimiento crea algo por cobrar?
export function esCobro(m) {
  if (m.tipo === 'prestamo') return true;
  if (m.tipo === 'compra_tercero') return ['despues', 'partes', 'pagado'].includes(m.recuperacion || 'despues');
  return false;
}

// ¿Cuenta como gasto personal real?
export function esGastoReal(m) {
  if (m.tipo === 'gasto') return true;
  if (m.tipo === 'compra_tercero') return ['regalo', 'no'].includes(m.recuperacion);
  return false;
}

export function categoriaGasto(m) {
  if (m.tipo === 'compra_tercero') return 'Regalos';
  return m.categoria || 'Otros';
}

export function saldosCuentas(cuentas, movs) {
  const s = {};
  for (const c of cuentas) s[c.id] = Number(c.saldoInicial) || 0;
  for (const m of movs) {
    const imp = Number(m.importe) || 0;
    if (m.origenId && m.origenId in s) s[m.origenId] -= imp;
    if (m.destinoId && m.destinoId in s) s[m.destinoId] += imp;
  }
  for (const k in s) s[k] = round(s[k]);
  return s;
}

// Reparte pagos entre los saldos abiertos: primero al que el pago indica (aplicaA),
// después del más antiguo al más reciente.
function asignar(items, pagos) {
  const abiertos = items
    .map((m) => ({ mov: m, monto: Number(m.importe) || 0, pagado: 0 }))
    .sort((a, b) => (a.mov.fecha || '').localeCompare(b.mov.fecha || '') || (a.mov.creado || '').localeCompare(b.mov.creado || ''));
  let exceso = 0;
  const ordenPagos = [...pagos].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  for (const p of ordenPagos) {
    let resto = Number(p.importe) || 0;
    if (p.aplicaA) {
      const it = abiertos.find((x) => x.mov.id === p.aplicaA);
      if (it) { const t = Math.min(resto, it.monto - it.pagado); it.pagado += t; resto -= t; }
    }
    for (const it of abiertos) {
      if (resto <= 0) break;
      const t = Math.min(resto, it.monto - it.pagado);
      if (t > 0) { it.pagado += t; resto -= t; }
    }
    exceso += resto;
  }
  for (const it of abiertos) {
    it.pagado = round(it.pagado);
    it.pendiente = round(it.monto - it.pagado);
    it.estado = it.pendiente <= 0 ? 'pagado' : (it.pagado > 0 ? 'parcial' : 'pendiente');
  }
  return { items: abiertos, exceso: round(exceso) };
}

export function resumenPersonas(personas, movs) {
  const out = {};
  for (const p of personas) {
    const mios = movs.filter((m) => m.personaId === p.id);
    const cobro = asignar(mios.filter(esCobro), mios.filter((m) => m.tipo === 'pago_recibido' || m.tipo === 'condonacion'));
    const deuda = asignar(mios.filter((m) => m.tipo === 'deuda'), mios.filter((m) => m.tipo === 'pago_deuda'));
    const pendPrestamos = round(cobro.items.filter((i) => i.mov.tipo === 'prestamo').reduce((a, i) => a + i.pendiente, 0));
    const pendCompras = round(cobro.items.filter((i) => i.mov.tipo === 'compra_tercero').reduce((a, i) => a + i.pendiente, 0));
    const yoDebo = round(deuda.items.reduce((a, i) => a + i.pendiente, 0) + cobro.exceso);
    const meDebe = round(pendPrestamos + pendCompras + deuda.exceso);
    const abonos = mios.filter((m) => m.tipo === 'pago_recibido').map((m) => m.fecha).sort();
    const abiertos = cobro.items.filter((i) => i.pendiente > 0).map((i) => i.mov.fecha).sort();
    out[p.id] = {
      confianza: !!p.confianza,
      ultimoAbono: abonos.length ? abonos[abonos.length - 1] : '',
      desde: abiertos.length ? abiertos[0] : '',
      cobros: cobro.items, deudas: deuda.items,
      pendPrestamos, pendCompras, meDebe, yoDebo,
      neto: round(meDebe - yoDebo),
      movimientos: mios
    };
  }
  return out;
}

export function resumenGeneral(cuentas, personas, movs, opts = {}) {
  const saldos = saldosCuentas(cuentas, movs);
  const activas = cuentas.filter((c) => c.activa !== false);
  let bancos = 0, efectivo = 0, tarjetas = 0, creditos = 0;
  for (const c of activas) {
    const v = saldos[c.id] || 0;
    if (c.tipo === 'credito') tarjetas += -v;
    else if (c.tipo === 'credito_formal') creditos += -v;
    else if (c.tipo === 'efectivo') efectivo += v;
    else bancos += v;
  }
  const rp = resumenPersonas(personas, movs);
  let meDeben = 0, compras = 0, deboPersonas = 0, confianza = 0, nConfianza = 0;
  for (const id in rp) {
    const r = rp[id];
    if (r.confianza) { confianza += r.pendPrestamos + r.pendCompras; if (r.pendPrestamos + r.pendCompras > 0) nConfianza++; }
    else { meDeben += r.pendPrestamos; compras += r.pendCompras; }
    deboPersonas += r.yoDebo;
  }
  const disponible = bancos + efectivo;
  const yoDebo = deboPersonas + creditos;
  const patrimonio = disponible - tarjetas + meDeben + compras - yoDebo + (opts.incluirConfianza ? confianza : 0);
  return {
    saldos, personas: rp,
    bancos: round(bancos), efectivo: round(efectivo), disponible: round(disponible),
    tarjetas: round(tarjetas), creditos: round(creditos), meDeben: round(meDeben), compras: round(compras),
    yoDeboPersonas: round(deboPersonas), yoDebo: round(yoDebo),
    confianza: round(confianza), nConfianza,
    patrimonio: round(patrimonio),
    sinIdentificar: movs.filter((m) => m.tipo === 'sin_identificar').length
  };
}

// Efecto de un movimiento en palabras, para la vista previa y el detalle.
export function efectos(m, cuentasById, personasById) {
  const imp = Number(m.importe) || 0;
  const out = [];
  const nombre = (id) => (cuentasById[id] ? cuentasById[id].nombre : 'Cuenta');
  const esCred = (id) => esDeuda(cuentasById[id]);
  const per = personasById[m.personaId] ? personasById[m.personaId].nombre : 'La persona';
  if (m.origenId) out.push({ k: esCred(m.origenId) ? nombre(m.origenId) + ' (por pagar)' : nombre(m.origenId), v: esCred(m.origenId) ? +imp : -imp, clase: 'neutro' });
  if (m.destinoId) out.push({ k: esCred(m.destinoId) ? nombre(m.destinoId) + ' (por pagar)' : nombre(m.destinoId), v: esCred(m.destinoId) ? -imp : +imp, clase: m.tipo === 'ingreso' ? 'ingreso' : 'neutro' });
  if (esCobro(m)) out.push({ k: per + ' me debe', v: +imp, clase: 'neutro' });
  if (m.tipo === 'pago_recibido' || m.tipo === 'condonacion') out.push({ k: per + ' me debe', v: -imp, clase: 'neutro' });
  if (m.tipo === 'deuda') out.push({ k: 'Le debo a ' + per, v: +imp, clase: 'neutro' });
  if (m.tipo === 'pago_deuda') out.push({ k: 'Le debo a ' + per, v: -imp, clase: 'neutro' });
  if (m.tipo === 'ingreso') out.push({ k: 'Ingresos del mes', v: +imp, clase: 'ingreso' });
  if (esGastoReal(m)) out.push({ k: 'Gasto · ' + categoriaGasto(m), v: +imp, clase: 'gasto' });
  else if (!['ingreso', 'sin_identificar', 'condonacion'].includes(m.tipo)) out.push({ k: 'Gasto personal', v: 0, clase: 'cero' });
  if (m.tipo === 'sin_identificar') out.push({ k: 'Clasificación', v: null, texto: 'Pendiente', clase: 'cero' });
  return out;
}

export function notaTipo(m) {
  switch (m.tipo) {
    case 'gasto': return 'Es un gasto real: cuenta en tus gastos del mes.';
    case 'ingreso': return 'Suma a tus ingresos del mes.';
    case 'transferencia': case 'retiro': case 'deposito': return 'Solo cambia de lugar tu dinero. No es ingreso ni gasto.';
    case 'pago_tarjeta': return 'Los gastos se contaron al comprar con la tarjeta; pagarla no es un gasto nuevo.';
    case 'condonacion': return 'El saldo se cierra sin entrada de dinero y se conserva su historial.';
    case 'prestamo': return 'Se crea un préstamo por cobrar con su historial.';
    case 'pago_recibido': return 'Se aplica al saldo que elijas o al más antiguo.';
    case 'deuda': return 'Queda registrado lo que debes. Pagarlo no contará como gasto.';
    case 'pago_deuda': return 'Se descuenta de lo que debes, del saldo más antiguo al más reciente.';
    case 'sin_identificar': return 'Regístralo ahora y clasifícalo cuando sepas qué fue.';
    case 'compra_tercero':
      if (['regalo', 'no'].includes(m.recuperacion)) return 'Al no recuperarlo, sí cuenta como gasto personal tuyo (Regalos).';
      if (m.recuperacion === 'pagado') return 'También se registrará el pago recibido en la cuenta donde te pagó.';
      return 'No es gasto tuyo: queda por recuperar.';
    default: return '';
  }
}

// Validación de un movimiento antes de guardar. Devuelve el primer error o null.
export function validar(m, cuentasById) {
  const t = TIPOS[m.tipo];
  if (!t) return 'Elige el tipo de movimiento.';
  if (!(Number(m.importe) > 0)) return 'Escribe un importe mayor a cero.';
  if (!m.fecha) return 'Elige la fecha.';
  if (t.origen && !m.origenId) return 'Falta elegir «' + t.origen + '».';
  if (t.destino && !m.destinoId) return 'Falta elegir «' + t.destino + '».';
  if (t.origen && t.destino && m.origenId === m.destinoId) return 'La cuenta de origen y destino no pueden ser la misma.';
  if (t.persona === 'req' && !m.personaId) return 'Elige la persona.';
  if (m.tipo === 'pago_tarjeta' && cuentasById[m.destinoId] && !esDeuda(cuentasById[m.destinoId])) return 'Lo pagado debe ser una tarjeta o un crédito.';
  if (m.tipo === 'compra_tercero' && m.recuperacion === 'pagado' && !m.pagadoEnId) return 'Elige en qué cuenta te pagó.';
  return null;
}

// ---------------------------------------------------------------- Fechas
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parse(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function sumarDias(iso, n) { const d = parse(iso); d.setDate(d.getDate() + n); return ymd(d); }
export function diaEnMes(y, m0, dia) { const ult = new Date(y, m0 + 1, 0).getDate(); return ymd(new Date(y, m0, Math.min(dia, ult))); }
export function sumarMeses(iso, n, dia) { const d = parse(iso); return diaEnMes(d.getFullYear(), d.getMonth() + n, dia || d.getDate()); }

// Corte más reciente en o antes de 'hoyIso'.
export function ultimoCorte(diaCorte, hoyIso) {
  const d = parse(hoyIso);
  const este = diaEnMes(d.getFullYear(), d.getMonth(), diaCorte);
  return este <= hoyIso ? este : diaEnMes(d.getFullYear(), d.getMonth() - 1, diaCorte);
}
function primerCorteDesde(diaCorte, iso) {
  const d = parse(iso);
  const este = diaEnMes(d.getFullYear(), d.getMonth(), diaCorte);
  return este >= iso ? este : diaEnMes(d.getFullYear(), d.getMonth() + 1, diaCorte);
}
function mesesEntre(a, b) { const x = parse(a), y = parse(b); return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()); }

// Estado de cuenta de una tarjeta para el corte indicado.
export function estadoTarjeta(c, movs, corteIso) {
  const diasPago = Number(c.diasPago) || 20;
  const limite = sumarDias(corteIso, diasPago);
  let saldo = Number(c.saldoInicial) || 0;
  let msiNoVencido = 0, pagosDespues = 0;
  const msi = [];
  for (const m of movs) {
    const imp = Number(m.importe) || 0;
    if (m.fecha <= corteIso) {
      if (m.origenId === c.id) saldo -= imp;
      if (m.destinoId === c.id) saldo += imp;
      const n = Number(m.msi) || 0;
      if (m.origenId === c.id && n > 1) {
        const k = Math.min(n, mesesEntre(primerCorteDesde(c.diaCorte, m.fecha), corteIso) + 1);
        const resta = imp * (1 - k / n);
        msiNoVencido += resta;
        if (k < n || resta > 0) msi.push({ mov: m, n, k, mensualidad: round(imp / n), pendiente: round(resta + imp / n) });
      }
    } else if (m.destinoId === c.id && m.fecha <= limite) {
      pagosDespues += imp;
    }
  }
  const deudaCorte = round(-saldo);
  const pagoNoIntereses = round(Math.max(0, deudaCorte - msiNoVencido));
  const falta = round(Math.max(0, pagoNoIntereses - pagosDespues));
  return { corte: corteIso, limite, deudaCorte, pagoNoIntereses, pagado: round(pagosDespues), falta, liquidado: falta <= 0.009, msi };
}

// Agenda de pagos, cobros y cortes entre 'desde' y 'hasta' (incluye atrasados).
export function agenda({ cuentas, movs, R, recordatorios = [] }, desde, hasta, hoyIso) {
  const out = [];
  for (const c of cuentas.filter((x) => x.activa !== false)) {
    if (c.tipo === 'credito' && c.diaCorte) {
      let corte = ultimoCorte(c.diaCorte, sumarDias(desde, -(Number(c.diasPago) || 20)));
      for (let i = 0; i < 4 && corte <= hasta; i++) {
        const e = estadoTarjeta(c, movs, corte);
        const futuro = corte > hoyIso;
        if (corte < (c.fechaSaldoInicial || '')) { corte = sumarMeses(corte, 1, c.diaCorte); continue; }
        if (corte >= desde) out.push({ fecha: corte, tipo: 'corte', titulo: 'Corte ' + c.nombre, importe: null, cuentaId: c.id, hecho: corte < hoyIso, avisos: c.avisoCorte === false ? [] : [0] });
        const lim = sumarDias(corte, Number(c.diasPago) || 20);
        if ((lim >= desde && lim <= hasta) || (!futuro && !e.liquidado && lim < desde)) {
          out.push({ fecha: lim, tipo: 'pago', titulo: 'Pago ' + c.nombre, sub: futuro ? 'Estimado: aún no corta' : 'Para no generar intereses', importe: e.falta, cuentaId: c.id, hecho: !futuro && e.liquidado, avisos: c.avisos || [5, 3, 1] });
        }
        corte = sumarMeses(corte, 1, c.diaCorte);
      }
    }
    if (c.tipo === 'credito_formal' && c.diaPago) {
      let f = diaEnMes(parse(desde).getFullYear(), parse(desde).getMonth() - 1, c.diaPago);
      for (let i = 0; i < 4 && f <= hasta; i++) {
        const mes = f.slice(0, 7);
        const pagado = movs.filter((m) => m.destinoId === c.id && m.fecha.slice(0, 7) === mes).reduce((a, m) => a + Number(m.importe), 0);
        const mens = Number(c.mensualidad) || 0;
        const hecho = mens ? pagado >= mens - 0.009 : pagado > 0;
        if (f < (c.fechaSaldoInicial || '')) { f = sumarMeses(f, 1, c.diaPago); continue; }
        if ((f >= desde && f <= hasta) || (!hecho && f < desde && f >= sumarDias(desde, -40))) out.push({ fecha: f, tipo: 'pago', titulo: 'Mensualidad ' + c.nombre, importe: mens ? round(Math.max(0, mens - pagado)) : null, cuentaId: c.id, hecho, avisos: c.avisos || [3, 1] });
        f = sumarMeses(f, 1, c.diaPago);
      }
    }
  }
  for (const pid in R.personas) {
    const r = R.personas[pid];
    if (r.confianza) continue;
    for (const i of r.cobros) if (i.pendiente > 0 && i.mov.fechaAcordada && i.mov.fechaAcordada <= hasta) out.push({ fecha: i.mov.fechaAcordada, tipo: 'cobro', personaId: pid, movId: i.mov.id, importe: i.pendiente, hecho: false, avisos: [2, 0] });
    for (const i of r.deudas) if (i.pendiente > 0 && i.mov.fechaAcordada && i.mov.fechaAcordada <= hasta) out.push({ fecha: i.mov.fechaAcordada, tipo: 'deuda', personaId: pid, movId: i.mov.id, importe: i.pendiente, hecho: false, avisos: [2, 0] });
  }
  for (const rec of recordatorios) {
    let fechas = [];
    if (rec.repetir === 'mensual') {
      const dia = Number(rec.fecha.slice(8, 10));
      let f = diaEnMes(parse(desde).getFullYear(), parse(desde).getMonth() - 1, dia);
      if (f < rec.fecha) f = rec.fecha;
      for (let i = 0; i < 4 && f <= hasta; i++) { fechas.push(f); f = sumarMeses(f, 1, dia); }
    } else fechas = [rec.fecha];
    for (const f of fechas) {
      const hecho = (rec.hechos || []).includes(f);
      if ((f >= desde && f <= hasta) || (!hecho && f < desde)) out.push({ fecha: f, tipo: rec.tipo === 'cobro' ? 'cobro' : 'pago', titulo: rec.titulo, importe: rec.importe || null, recId: rec.id, hecho, avisos: rec.avisos || [1, 0] });
    }
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Gastos reales de un mes ('AAAA-MM') por categoría.
export function gastosMes(movs, mes) {
  const cats = {};
  let total = 0, ingresos = 0;
  for (const m of movs) {
    if (!m.fecha || m.fecha.slice(0, 7) !== mes) continue;
    if (m.tipo === 'ingreso') ingresos += Number(m.importe) || 0;
    if (!esGastoReal(m)) continue;
    const k = categoriaGasto(m);
    if (!cats[k]) cats[k] = { categoria: k, total: 0, movs: [] };
    cats[k].total += Number(m.importe) || 0;
    cats[k].movs.push(m);
    total += Number(m.importe) || 0;
  }
  const lista = Object.values(cats).map((c) => ({ ...c, total: round(c.total) })).sort((a, b) => b.total - a.total);
  return { total: round(total), ingresos: round(ingresos), categorias: lista };
}
