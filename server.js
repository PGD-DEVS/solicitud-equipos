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

// Correo automático de confirmación al registrar una solicitud.
// Va al solicitante y, en copia, a NOTIFICAR_CC.
// Se envía por Microsoft Graph (Microsoft 365) con MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET y MAIL_FROM.
const NOTIFICAR_CC = lista(process.env.NOTIFICAR_CC || 'luis.ruge@pgd.com.co');
const MAIL_FROM = (process.env.MAIL_FROM || '').trim().toLowerCase();
const APP_URL = process.env.APP_URL || '';
const MS_TENANT_ID = process.env.MS_TENANT_ID || '';
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || '';
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || '';
const CORREO_ACTIVO = Boolean(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MAIL_FROM);

// Solo para pruebas en tu computador: simula el usuario que inició sesión.
// En Cloud Run se ignora y se usa el inicio de sesión de Google.
const EN_CLOUD_RUN = Boolean(process.env.K_SERVICE);

// MODO PRUEBAS: la persona escribe su correo al entrar (sin verificar con Google).
// Solo para el enlace de pruebas. En producción NO se activa: se usa el inicio de sesión de Google.
const MODO_PRUEBAS = /^(1|true|si|sí)$/i.test(process.env.MODO_PRUEBAS || '');
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
  if (!req.usuario && MODO_PRUEBAS) {
    const correo = (req.get('x-usuario-prueba') || '').trim().toLowerCase();
    if (/^[a-z0-9._%+-]+@/.test(correo) && correo.endsWith('@' + DOMINIO)) req.usuario = correo;
  }
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
// Fecha de hoy en Colombia, en formato AAAA-MM-DD
function hoyBogota() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

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
  else if (s.fechaRequerida && s.fechaRequerida < hoyBogota()) errores.push('La fecha en que necesitas los equipos no puede ser anterior a hoy.');
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
    modoPruebas: MODO_PRUEBAS,
    correoActivo: CORREO_ACTIVO,
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

    let registrada = null;
    const radicado = await db.runTransaction(async (t) => {
      const snap = await t.get(contador);
      const n = (snap.exists ? snap.data().ultimo : 0) + 1;
      const id = `SOL-${anio}-${String(n).padStart(4, '0')}`;
      t.set(contador, { ultimo: n });
      registrada = {
        ...s,
        radicado: id,
        estado: 'Recibida',
        comparacion: '',
        creadaEn: ahora,
        actualizadaEn: ahora,
        historial: [{ estado: 'Recibida', comentario: 'Solicitud registrada', por: s.solicitanteCorreo, fecha: ahora }],
      };
      t.create(solicitudes.doc(id), registrada);
      return id;
    });

    res.status(201).json({ radicado, correoEnviado: CORREO_ACTIVO });
    // El correo se envía después de responder, para que la persona no tenga que esperar
    enviarConfirmacion(registrada);
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

// ---------- PDF ----------
// Escribe el contenido del PDF en el documento y lo cierra
function escribirPDF(doc, s, conComparacion) {
  const gris = '#5B6781';
  const tinta = '#264574';
  doc.image(path.join(__dirname, 'public', 'logo-pgd.png'), doc.page.width - 56 - 80, 40, { width: 80 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(tinta).text('Solicitud de equipos');
  doc.moveDown(0.2).font('Helvetica').fontSize(12).fillColor(gris).text(`Radicado ${s.radicado}    Estado: ${s.estado}`);
  doc.moveTo(56, doc.y + 14).lineTo(doc.page.width - 56, doc.y + 14).lineWidth(2).strokeColor('#ECBF1E').stroke();
  doc.moveDown(1.6);

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

  if (conComparacion && s.comparacion) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(14).text('Comparación de opciones');
    doc.moveDown(0.5).font('Helvetica').fontSize(10).text(s.comparacion);
  }
  doc.end();
}

function pdfEnMemoria(s) {
  return new Promise((resolver, fallar) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const partes = [];
    doc.on('data', (p) => partes.push(p));
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', fallar);
    escribirPDF(doc, s, false);
  });
}

// Archivo PDF de la solicitud (la comparación solo aparece en el PDF que descarga TI)
app.get('/api/solicitudes/:id/pdf', async (req, res, next) => {
  try {
    const s = await cargar(req, res);
    if (!s) return;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${s.radicado}.pdf"`);
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    doc.pipe(res);
    escribirPDF(doc, s, req.esTI);
  } catch (e) {
    next(e);
  }
});

// ---------- Correo de confirmación ----------
function html(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function correoConfirmacion(s) {
  const items = itemsDe(s);
  const equiposHtml = items.map((it) => `
      <tr><td style="padding:12px 0;border-top:1px solid #DFE4EE">
        <strong style="color:#264574">${html(it.cantidad)} × ${html(it.tipo)}</strong>
        <div style="color:#5B6781;font-size:13px;line-height:1.5;margin-top:4px">${describirItem(it).map(html).join('<br>')}</div>
      </td></tr>`).join('');
  const enlace = APP_URL
    ? `<p style="margin:24px 0 0"><a href="${html(APP_URL)}" style="background:#ECBF1E;color:#1B2B4B;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">Ver mis solicitudes</a></p>`
    : '';
  const cuerpo = `
  <div style="background:#F4F6FA;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1B2B4B">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;border-collapse:collapse">
      <tr><td style="background:#0E1D45;padding:24px 28px">
        <div style="color:#ECBF1E;font-size:11px;font-weight:700;letter-spacing:2px">PGD · TI · GESTIÓN DE EQUIPOS</div>
        <div style="color:#FFFFFF;font-size:22px;font-weight:700;margin-top:6px">Recibimos tu solicitud</div>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <p style="margin:0 0 16px">Hola, ${html(s.solicitanteNombre)}. Tu solicitud quedó registrada con el radicado:</p>
        <div style="display:inline-block;background:#ECBF1E;color:#1B2B4B;font-size:24px;font-weight:800;padding:8px 18px;border-radius:4px 16px 16px 4px">${html(s.radicado)}</div>
        <p style="margin:20px 0 4px;color:#5B6781;font-size:13px">Área: <strong style="color:#1B2B4B">${html(s.area)}</strong>${s.proyecto ? ` · Proyecto: <strong style="color:#1B2B4B">${html(s.proyecto)}</strong>` : ''} · Prioridad: <strong style="color:#1B2B4B">${html(s.prioridad)}</strong></p>
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:12px">${equiposHtml}</table>
        <p style="margin:20px 0 0"><strong>¿Qué sigue?</strong> TI revisará tu pedido, comparará opciones y lo enviará a Compras. Puedes ver cada cambio de estado en la aplicación, en Mis solicitudes.</p>
        ${enlace}
        <p style="margin:24px 0 0;color:#5B6781;font-size:12px">Adjuntamos el PDF de la solicitud. Este es un mensaje automático; si necesitas corregir algo, escríbele a TI indicando el radicado.</p>
      </td></tr>
    </table>
  </div>`;
  const texto = [
    `Hola, ${s.solicitanteNombre}.`,
    `Tu solicitud quedó registrada con el radicado ${s.radicado}.`,
    '',
    ...items.map((it) => `- ${it.cantidad} x ${it.tipo}`),
    '',
    'TI revisará tu pedido, comparará opciones y lo enviará a Compras.',
    APP_URL ? `Consulta el estado en: ${APP_URL}` : 'Consulta el estado en la aplicación, en Mis solicitudes.',
  ].join('\n');
  return { asunto: `Recibimos tu solicitud ${s.radicado}`, cuerpo, texto };
}

// Envío por Microsoft Graph (Microsoft 365), con permiso de aplicación Mail.Send
const tokenGraph = { valor: '', vence: 0 };
async function obtenerTokenGraph() {
  if (tokenGraph.valor && Date.now() < tokenGraph.vence) return tokenGraph.valor;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || !datos.access_token) throw new Error(`Microsoft no entregó el token: ${datos.error_description || r.status}`);
  tokenGraph.valor = datos.access_token;
  tokenGraph.vence = Date.now() + (Number(datos.expires_in || 3600) - 300) * 1000;
  return tokenGraph.valor;
}

async function enviarPorGraph({ para, copia, asunto, cuerpo, adjunto }) {
  const token = await obtenerTokenGraph();
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAIL_FROM)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: 'HTML', content: cuerpo },
        toRecipients: para.map((c) => ({ emailAddress: { address: c } })),
        ccRecipients: copia.map((c) => ({ emailAddress: { address: c } })),
        attachments: [{
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: adjunto.nombre,
          contentType: 'application/pdf',
          contentBytes: adjunto.contenido.toString('base64'),
        }],
      },
      saveToSentItems: true,
    }),
  });
  if (r.status !== 202) {
    const detalle = await r.text().catch(() => '');
    throw new Error(`Microsoft Graph respondió ${r.status}: ${detalle.slice(0, 200)}`);
  }
}

async function enviarConfirmacion(s) {
  if (!CORREO_ACTIVO || !s) return;
  const ref = solicitudes.doc(s.radicado);
  try {
    const { asunto, cuerpo } = correoConfirmacion(s);
    const pdf = await pdfEnMemoria(s);
    const copia = NOTIFICAR_CC.filter((c) => c !== s.solicitanteCorreo);
    await enviarPorGraph({ para: [s.solicitanteCorreo], copia, asunto, cuerpo, adjunto: { nombre: `${s.radicado}.pdf`, contenido: pdf } });
    await ref.update({ confirmacion: { enviada: true, fecha: new Date().toISOString() } });
    console.log(`Correo de confirmación enviado: ${s.radicado} -> ${s.solicitanteCorreo}`);
  } catch (e) {
    console.error(`No se pudo enviar el correo de ${s.radicado}:`, e.message);
    await ref.update({ confirmacion: { enviada: false, error: String(e.message).slice(0, 300), fecha: new Date().toISOString() } }).catch(() => {});
  }
}

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
  console.log(CORREO_ACTIVO
    ? `Correo de confirmación: ACTIVO vía Microsoft 365 desde ${MAIL_FROM} | En copia: ${NOTIFICAR_CC.join(', ')}`
    : 'Correo de confirmación: INACTIVO (faltan los datos de Microsoft 365)');
  if (MODO_PRUEBAS) console.log('MODO PRUEBAS ACTIVO: los usuarios se identifican escribiendo su correo.');
  console.log(`Usuario de prueba: ${DEV_USER || '(ninguno)'} | Equipo de TI: ${TI_ADMINS.join(', ') || '(nadie configurado)'}`);
});
