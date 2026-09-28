'use strict';

const express = require('express');
const path = require('path');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const PDFDocument = require('pdfkit');
const { CATALOGO, describirItem } = require('./catalogo');

// ---------- Configuración (se puede cambiar con variables de entorno) ----------
const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'pgd-interno';
const DATABASE_ID = process.env.FIRESTORE_DATABASE || 'solicitudes-equipos';
const DOMINIO = process.env.DOMINIO_PERMITIDO || 'pgd.com.co';
// Correos de Compras. Se pueden poner varios separados por coma.
// COMPRAS_PARA: destinatarios principales. COMPRAS_CC: siempre en copia (además de quien hizo la solicitud).
const lista = (valor) => valor.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
const COMPRAS_PARA = lista(process.env.COMPRAS_PARA || 'analista.compras@pgd.com.co,deisy.rodriguez@pgd.com.co');
const COMPRAS_CC = lista(process.env.COMPRAS_CC || 'javier.mora@pgd.com.co');

// Correos del equipo de TI (separados por coma). Solo ellos ven el prompt, cambian estados y envían a Compras.
const TI_ADMINS = lista(process.env.TI_ADMINS || '');

// Solo para pruebas en tu computador: simula el usuario que inició sesión.
// En Cloud Run se ignora y se usa el inicio de sesión de Google.
const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE);
const DEV_USER = EN_CLOUD_RUN ? '' : (process.env.DEV_USER || '').trim().toLowerCase();

const AREAS = ['Administrativa', 'Comercial', 'Financiera', 'Gerencia', 'Operaciones', 'Talento Humano', 'TI'];
const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente'];
const ESTADOS = ['Recibida', 'En cotización', 'Enviada a Compras', 'Aprobada', 'Rechazada', 'Entregada'];

const db = new Firestore({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
const solicitudes = db.collection('solicitudes');

const app = express();
app.use(express.json({ limit: '300kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Identidad y permisos ----------
app.use((req, res, next) => {
  const iap = req.get('x-goog-authenticated-user-email');
  req.usuario = iap ? iap.replace(/^accounts\.google\.com:/, '').toLowerCase() : DEV_USER || null;
  req.esTI = Boolean(req.usuario && TI_ADMINS.includes(req.usuario));
  next();
});

function soloTI(req, res, next) {
  if (!req.esTI) return res.status(403).json({ error: 'Esta opción es solo para el equipo de TI.' });
  next();
}

function puedeVer(req, s) {
  return req.esTI || (req.usuario && s.solicitanteCorreo === req.usuario);
}

// ---------- Utilidades ----------
function texto(valor, max) {
  return typeof valor === 'string' ? valor.trim().slice(0, max) : '';
}

function fecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' });
}

// Las solicitudes creadas con la primera versión tenían un solo equipo; se convierten al formato nuevo.
function itemsDe(s) {
  if (Array.isArray(s.items)) return s.items;
  if (s.tipo) return [{ tipo: s.tipo, cantidad: s.cantidad, especificaciones: {}, accesorios: [], observaciones: s.especificaciones || '' }];
  return [];
}

function resumenEquipos(items) {
  return items.map((i) => `${i.cantidad} ${i.tipo}`).join(', ');
}

function validarItems(items, errores) {
  if (!Array.isArray(items) || items.length === 0) {
    errores.push('Agrega al menos un equipo.');
    return [];
  }
  if (items.length > 20) {
    errores.push('Puedes pedir máximo 20 equipos distintos por solicitud.');
    return [];
  }
  return items.map((it, i) => {
    const def = CATALOGO[it?.tipo];
    const nombre = `Equipo ${i + 1}${def ? ` (${it.tipo})` : ''}`;
    if (!def) {
      errores.push(`${nombre}: el tipo de equipo no es válido.`);
      return null;
    }
    const cantidad = Number.parseInt(it.cantidad, 10);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 500) errores.push(`${nombre}: la cantidad debe estar entre 1 y 500.`);
    const especificaciones = {};
    const faltan = [];
    def.campos.forEach((c) => {
      const v = texto(it.especificaciones?.[c.id], 120);
      if (!c.opciones.includes(v)) faltan.push(c.etiqueta.toLowerCase());
      especificaciones[c.id] = v;
    });
    if (faltan.length) errores.push(`${nombre}: completa ${faltan.join(', ')}.`);
    const accesorios = Array.isArray(it.accesorios) ? it.accesorios.filter((a) => def.accesorios.includes(a)) : [];
    return { tipo: it.tipo, cantidad, especificaciones, accesorios, observaciones: texto(it.observaciones, 1000) };
  });
}

function validarSolicitud(body, req) {
  const errores = [];
  const s = {
    solicitanteNombre: texto(body.solicitanteNombre, 120),
    solicitanteCorreo: (req.usuario || texto(body.solicitanteCorreo, 120)).toLowerCase(),
    area: texto(body.area, 60),
    proyecto: texto(body.proyecto, 150),
    prioridad: texto(body.prioridad, 20),
    fechaRequerida: texto(body.fechaRequerida, 10),
    justificacion: texto(body.justificacion, 2000),
  };
  if (!s.solicitanteNombre) errores.push('Escribe tu nombre.');
  if (!s.solicitanteCorreo.endsWith('@' + DOMINIO)) errores.push(`Usa tu correo @${DOMINIO}.`);
  if (!AREAS.includes(s.area)) errores.push('Elige un área.');
  s.items = validarItems(body.items, errores);
  if (!PRIORIDADES.includes(s.prioridad)) errores.push('Elige la prioridad.');
  if (s.fechaRequerida && !/^\d{4}-\d{2}-\d{2}$/.test(s.fechaRequerida)) errores.push('La fecha requerida no es válida.');
  if (s.justificacion.length < 10) errores.push('Explica para qué se necesitan los equipos (mínimo 10 caracteres).');
  return { s, errores };
}

async function obtener(id) {
  if (!/^SOL-\d{4}-\d{4,}$/.test(id)) return null;
  const doc = await solicitudes.doc(id).get();
  return doc.exists ? doc.data() : null;
}

// Busca la solicitud y verifica que el usuario pueda verla
async function cargar(req, res) {
  const s = await obtener(req.params.id);
  if (!s || !puedeVer(req, s)) {
    res.status(404).json({ error: 'No existe una solicitud con ese radicado o no tienes acceso a ella.' });
    return null;
  }
  return s;
}

function construirPrompt(s) {
  const equipos = itemsDe(s)
    .map((it, i) => [`Equipo ${i + 1}: ${it.cantidad} x ${it.tipo}`, ...describirItem(it).map((l) => `   - ${l}`)].join('\n'))
    .join('\n\n');
  return `Actúa como asesor de compras de tecnología para una empresa en Colombia.
Necesito comparar opciones de compra para esta solicitud interna:

Radicado: ${s.radicado}
Área que lo solicita: ${s.area}${s.proyecto ? `\nProyecto o centro de costo: ${s.proyecto}` : ''}
Uso que se le dará: ${s.justificacion}
Prioridad: ${s.prioridad}${s.fechaRequerida ? `\nFecha en que se necesita: ${s.fechaRequerida}` : ''}

Equipos solicitados:
${equipos}

Para cada equipo solicitado:
1. Propón 3 opciones disponibles en Colombia que cumplan las especificaciones (marca y modelo).
2. Presenta una tabla comparativa con: marca y modelo, características principales, precio aproximado por unidad en pesos colombianos (COP), precio total para la cantidad pedida, garantía, ventajas y desventajas.
3. Indica cuál opción recomiendas y por qué, pensando en la relación costo-beneficio para el uso descrito.
4. Señala si alguna especificación parece excesiva o insuficiente para ese uso.

Al final, entrega un resumen con el costo total estimado de la solicitud usando las opciones recomendadas.
Aclara que los precios son aproximados y deben confirmarse con cotizaciones formales de proveedores.`;
}

// ---------- API ----------
app.get('/api/config', (req, res) => {
  res.json({
    areas: AREAS,
    prioridades: PRIORIDADES,
    estados: ESTADOS,
    catalogo: CATALOGO,
    comprasPara: COMPRAS_PARA,
    comprasCc: COMPRAS_CC,
    dominio: DOMINIO,
    usuario: req.usuario,
    esTI: req.esTI,
  });
});

// Registrar una solicitud nueva con radicado consecutivo por año (SOL-2026-0001)
app.post('/api/solicitudes', async (req, res, next) => {
  try {
    const { s, errores } = validarSolicitud(req.body || {}, req);
    if (errores.length) return res.status(400).json({ error: errores.join(' ') });

    const ahora = new Date().toISOString();
    const anio = new Date().getFullYear();
    const contador = db.collection('contadores').doc(`solicitudes-${anio}`);

    const radicado = await db.runTransaction(async (t) => {
      const snap = await t.get(contador);
      const n = (snap.exists ? snap.data().ultimo : 0) + 1;
      const id = `SOL-${anio}-${String(n).padStart(4, '0')}`;
      t.set(contador, { ultimo: n });
      t.create(solicitudes.doc(id), {
        ...s,
        radicado: id,
        estado: 'Recibida',
        comparacion: '',
        creadaEn: ahora,
        actualizadaEn: ahora,
        historial: [{ estado: 'Recibida', comentario: 'Solicitud registrada', por: s.solicitanteCorreo, fecha: ahora }],
      });
      return id;
    });

    res.status(201).json({ radicado });
  } catch (e) {
    next(e);
  }
});

// TI ve todas las solicitudes; los demás solo las suyas
app.get('/api/solicitudes', async (req, res, next) => {
  try {
    if (!req.usuario) return res.json([]);
    const snap = req.esTI
      ? await solicitudes.orderBy('creadaEn', 'desc').limit(500).get()
      : await solicitudes.where('solicitanteCorreo', '==', req.usuario).get();
    const lista = snap.docs.map((d) => {
      const s = d.data();
      const items = itemsDe(s);
      return {
        radicado: s.radicado,
        creadaEn: s.creadaEn,
        area: s.area,
        proyecto: s.proyecto || '',
        solicitanteNombre: s.solicitanteNombre,
        solicitanteCorreo: s.solicitanteCorreo,
        prioridad: s.prioridad,
        estado: s.estado,
        equipos: resumenEquipos(items),
        unidades: items.reduce((t, i) => t + (Number(i.cantidad) || 0), 0),
      };
    });
    lista.sort((a, b) => b.creadaEn.localeCompare(a.creadaEn));
    res.json(lista);
  } catch (e) {
    next(e);
  }
});

app.get('/api/solicitudes/:id', async (req, res, next) => {
  try {
    const s = await cargar(req, res);
    if (!s) return;
    const respuesta = { ...s, items: itemsDe(s) };
    if (!req.esTI) delete respuesta.comparacion;
    res.json(respuesta);
  } catch (e) {
    next(e);
  }
});

app.get('/api/solicitudes/:id/prompt', soloTI, async (req, res, next) => {
  try {
    const s = await cargar(req, res);
    if (!s) return;
    res.json({ prompt: construirPrompt(s) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/solicitudes/:id/estado', soloTI, async (req, res, next) => {
  try {
    const estado = texto(req.body?.estado, 40);
    if (!ESTADOS.includes(estado)) return res.status(400).json({ error: 'Ese estado no es válido.' });
    if (!(await cargar(req, res))) return;

    const ahora = new Date().toISOString();
    await solicitudes.doc(req.params.id).update({
      estado,
      actualizadaEn: ahora,
      historial: FieldValue.arrayUnion({ estado, comentario: texto(req.body?.comentario, 500), por: req.usuario, fecha: ahora }),
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.put('/api/solicitudes/:id/comparacion', soloTI, async (req, res, next) => {
  try {
    if (!(await cargar(req, res))) return;
    await solicitudes.doc(req.params.id).update({
      comparacion: texto(req.body?.texto, 20000),
      actualizadaEn: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Archivo PDF de la solicitud (la comparación solo aparece en el PDF que descarga TI)
app.get('/api/solicitudes/:id/pdf', async (req, res, next) => {
  try {
    const s = await cargar(req, res);
    if (!s) return;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${s.radicado}.pdf"`);

    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    doc.pipe(res);

    const gris = '#586377';
    const tinta = '#18202E';
    doc.font('Helvetica-Bold').fontSize(20).fillColor(tinta).text('Solicitud de equipos');
    doc.moveDown(0.2).font('Helvetica').fontSize(12).fillColor(gris).text(`Radicado ${s.radicado}    Estado: ${s.estado}`);
    doc.moveDown(1);

    const campo = (etiqueta, valor) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(gris).text(etiqueta);
      doc.font('Helvetica').fontSize(11).fillColor(tinta).text(valor || '-');
      doc.moveDown(0.5);
    };
    campo('Fecha de registro', fecha(s.creadaEn));
    campo('Solicitante', `${s.solicitanteNombre} (${s.solicitanteCorreo})`);
    campo('Área', s.area);
    if (s.proyecto) campo('Proyecto o centro de costo', s.proyecto);
    campo('Prioridad', s.prioridad);
    campo('Fecha en que se necesita', s.fechaRequerida || 'Sin fecha definida');
    campo('Para qué se necesitan', s.justificacion);

    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(14).fillColor(tinta).text('Equipos solicitados');
    doc.moveDown(0.4);
    itemsDe(s).forEach((it, i) => {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(tinta).text(`${i + 1}. ${it.cantidad} x ${it.tipo}`);
      doc.font('Helvetica').fontSize(10).fillColor(tinta);
      describirItem(it).forEach((l) => doc.text(`     ${l}`));
      doc.moveDown(0.6);
    });

    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).fillColor(tinta).text('Historial');
    doc.moveDown(0.3).font('Helvetica').fontSize(9);
    (s.historial || []).forEach((h) => {
      doc.text(`${fecha(h.fecha)}  |  ${h.estado}  |  ${h.por}${h.comentario ? `  |  ${h.comentario}` : ''}`);
    });

    if (req.esTI && s.comparacion) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).text('Comparación de opciones');
      doc.moveDown(0.5).font('Helvetica').fontSize(10).text(s.comparacion);
    }

    doc.end();
  } catch (e) {
    next(e);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: 'Ocurrió un error en el servidor. Revisa la terminal para ver el detalle.' });
});

app.listen(PORT, () => {
  console.log(`Solicitud de equipos lista en http://localhost:${PORT}`);
  console.log(`Proyecto: ${PROJECT_ID} | Base de datos: ${DATABASE_ID}`);
  console.log(`Compras (para): ${COMPRAS_PARA.join(', ')} | En copia: ${COMPRAS_CC.join(', ') || '(solo el solicitante)'}`);
  console.log(`Usuario de prueba: ${DEV_USER || '(ninguno)'} | Equipo de TI: ${TI_ADMINS.join(', ') || '(nadie configurado)'}`);
});
