'use strict';

// Catálogo de equipos: aquí se define qué se puede pedir y qué opciones ve el usuario.
// Para agregar o cambiar una opción, edita solo este archivo.

const PERFIL = [
  'Oficina: correo, Office, navegador',
  'Análisis de datos o desarrollo',
  'Diseño, planos o video',
  'Otro (ajustaré la configuración)',
];
const PROCESADOR = [
  'Básico (Intel Core i3 / AMD Ryzen 3)',
  'Intermedio (Intel Core i5 / AMD Ryzen 5)',
  'Avanzado (Intel Core i7 / AMD Ryzen 7)',
  'Alto rendimiento (Intel Core i9 / AMD Ryzen 9)',
];
const MEMORIA = ['8 GB', '16 GB', '32 GB', '64 GB'];
const DISCO = ['256 GB', '512 GB', '1 TB', '2 TB'];
const GRAFICA = ['Integrada (suficiente para oficina)', 'Dedicada (diseño, planos, video)'];
const SO = ['Windows 11 Pro', 'Windows 11 Home', 'Linux', 'Sin sistema operativo'];

const campoPerfil = {
  id: 'perfil',
  etiqueta: 'Perfil de uso',
  opciones: PERFIL,
  ayuda: 'Al elegir el perfil te sugerimos una configuración. Puedes cambiar cualquier valor.',
};
const camposComputador = [
  campoPerfil,
  { id: 'procesador', etiqueta: 'Procesador', opciones: PROCESADOR },
  { id: 'memoria', etiqueta: 'Memoria RAM', opciones: MEMORIA },
  { id: 'disco', etiqueta: 'Disco de estado sólido (SSD)', opciones: DISCO },
  { id: 'grafica', etiqueta: 'Tarjeta gráfica', opciones: GRAFICA },
];

// Configuraciones sugeridas según el perfil de uso
const sugerencia = {
  [PERFIL[0]]: { procesador: PROCESADOR[1], memoria: '16 GB', disco: '512 GB', grafica: GRAFICA[0], so: 'Windows 11 Pro' },
  [PERFIL[1]]: { procesador: PROCESADOR[2], memoria: '32 GB', disco: '1 TB', grafica: GRAFICA[0], so: 'Windows 11 Pro' },
  [PERFIL[2]]: { procesador: PROCESADOR[3], memoria: '32 GB', disco: '1 TB', grafica: GRAFICA[1], so: 'Windows 11 Pro' },
};

const CATALOGO = {
  'Computador portátil': {
    grupo: 'Equipos de cómputo e impresión',
    campos: [
      ...camposComputador,
      { id: 'pantalla', etiqueta: 'Tamaño de pantalla', opciones: ['13 a 14 pulgadas', '15,6 pulgadas', '16 pulgadas o más'] },
      { id: 'so', etiqueta: 'Sistema operativo', opciones: SO },
      { id: 'monitor', etiqueta: 'Monitor adicional', opciones: ['No necesita', 'Sí, de 22 a 24 pulgadas', 'Sí, de 27 pulgadas', 'Sí, dos monitores'] },
    ],
    accesorios: ['Teclado inalámbrico', 'Mouse inalámbrico', 'Diadema con micrófono', 'Base elevadora', 'Maletín o morral'],
    perfiles: {
      [PERFIL[0]]: { ...sugerencia[PERFIL[0]], pantalla: '13 a 14 pulgadas', monitor: 'No necesita' },
      [PERFIL[1]]: { ...sugerencia[PERFIL[1]], pantalla: '15,6 pulgadas', monitor: 'Sí, de 22 a 24 pulgadas' },
      [PERFIL[2]]: { ...sugerencia[PERFIL[2]], pantalla: '16 pulgadas o más', monitor: 'Sí, de 27 pulgadas' },
    },
  },

  'Computador de escritorio': {
    grupo: 'Equipos de cómputo e impresión',
    campos: [
      ...camposComputador,
      { id: 'formato', etiqueta: 'Formato', opciones: ['Torre', 'Mini PC (compacto)', 'Todo en uno (pantalla integrada)'] },
      { id: 'so', etiqueta: 'Sistema operativo', opciones: SO },
      { id: 'monitor', etiqueta: 'Monitor', opciones: ['Un monitor de 22 a 24 pulgadas', 'Un monitor de 27 pulgadas', 'Dos monitores de 22 a 24 pulgadas', 'No necesita (ya tiene o es todo en uno)'] },
      { id: 'tecladoMouse', etiqueta: 'Teclado y mouse', opciones: ['Inalámbricos', 'Alámbricos', 'No necesita'] },
    ],
    accesorios: ['Cámara web', 'Diadema con micrófono', 'Parlantes'],
    perfiles: {
      [PERFIL[0]]: { ...sugerencia[PERFIL[0]], formato: 'Mini PC (compacto)', monitor: 'Un monitor de 22 a 24 pulgadas', tecladoMouse: 'Inalámbricos' },
      [PERFIL[1]]: { ...sugerencia[PERFIL[1]], formato: 'Torre', monitor: 'Dos monitores de 22 a 24 pulgadas', tecladoMouse: 'Inalámbricos' },
      [PERFIL[2]]: { ...sugerencia[PERFIL[2]], formato: 'Torre', monitor: 'Un monitor de 27 pulgadas', tecladoMouse: 'Inalámbricos' },
    },
  },

  'Impresora': {
    grupo: 'Equipos de cómputo e impresión',
    campos: [
      { id: 'tecnologia', etiqueta: 'Tipo de impresora', opciones: ['Láser blanco y negro', 'Láser a color', 'De tinta a color', 'Multifuncional (imprime, copia y escanea)'] },
      { id: 'volumen', etiqueta: 'Páginas al mes (aprox.)', opciones: ['Hasta 1.000', 'De 1.000 a 5.000', 'Más de 5.000'] },
      { id: 'papel', etiqueta: 'Tamaño de papel', opciones: ['Carta y oficio', 'Hasta doble carta (A3)'] },
      { id: 'dobleCara', etiqueta: 'Impresión a doble cara automática', opciones: ['Sí', 'No'] },
      { id: 'conexion', etiqueta: 'Conexión', opciones: ['Red (cable)', 'Wi-Fi', 'USB directo al computador'] },
    ],
    accesorios: ['Bandeja adicional de papel', 'Tóner o tinta de repuesto'],
  },

  'Escáner': {
    grupo: 'Equipos de cómputo e impresión',
    campos: [
      { id: 'tipoEscaner', etiqueta: 'Tipo de escáner', opciones: ['Con alimentador automático de hojas', 'De cama plana (libros, documentos frágiles)', 'Portátil', 'De producción (alto volumen)'] },
      { id: 'volumen', etiqueta: 'Páginas al día (aprox.)', opciones: ['Hasta 500', 'De 500 a 3.000', 'Más de 3.000'] },
      { id: 'dobleCara', etiqueta: 'Escaneo a doble cara', opciones: ['Sí', 'No'] },
      { id: 'papel', etiqueta: 'Tamaño máximo de documento', opciones: ['Carta y oficio', 'Hasta doble carta (A3)'] },
      { id: 'conexion', etiqueta: 'Conexión', opciones: ['USB directo al computador', 'Red (cable)', 'Wi-Fi'] },
    ],
    accesorios: ['Software con reconocimiento de texto (OCR)', 'Kit de rodillos de repuesto'],
  },
  // ---------- Puntos de autoservicio ----------
  'Kiosko': {
    grupo: 'Puntos de autoservicio',
    campos: [
      { id: 'uso', etiqueta: 'Uso principal', opciones: ['Asignación de turnos o citas', 'Consulta de información', 'Radicación de documentos o trámites', 'Pagos', 'Impresión de documentos o certificados'] },
      { id: 'formato', etiqueta: 'Formato', opciones: ['De piso', 'De mesa o mostrador', 'De pared'] },
      { id: 'pantalla', etiqueta: 'Pantalla táctil', opciones: ['15 a 19 pulgadas', '21 a 24 pulgadas', '27 pulgadas o más'] },
      { id: 'ubicacion', etiqueta: 'Ubicación', opciones: ['Interior', 'Exterior (resistente a intemperie)'] },
      { id: 'so', etiqueta: 'Sistema operativo', opciones: ['Windows 11 IoT', 'Android', 'Linux', 'Lo define el proveedor'] },
      { id: 'software', etiqueta: 'Software del kiosko', opciones: ['Ya existe (de PGD o del cliente)', 'Se requiere desarrollo o licencia'] },
      { id: 'conexion', etiqueta: 'Conexión', opciones: ['Red (cable)', 'Wi-Fi', 'Datos móviles (4G/5G)'] },
    ],
    accesorios: ['Impresora térmica de tiquetes', 'Lector de código de barras o QR', 'Lector de cédula o documento', 'Datáfono para pagos', 'Cámara', 'Parlantes', 'Diseño accesible (altura para silla de ruedas)'],
  },

  'Tótem': {
    grupo: 'Puntos de autoservicio',
    campos: [
      { id: 'uso', etiqueta: 'Uso principal', opciones: ['Señalización o publicidad digital', 'Llamado de turnos (turnero)', 'Directorio o información interactiva'] },
      { id: 'tactil', etiqueta: 'Tipo de pantalla', opciones: ['Táctil (interactiva)', 'No táctil (solo visualización)'] },
      { id: 'pantalla', etiqueta: 'Tamaño de pantalla', opciones: ['32 pulgadas', '43 pulgadas', '49 a 55 pulgadas', '65 pulgadas o más'] },
      { id: 'orientacion', etiqueta: 'Orientación', opciones: ['Vertical', 'Horizontal'] },
      { id: 'ubicacion', etiqueta: 'Ubicación', opciones: ['Interior', 'Exterior (resistente a intemperie y alto brillo)'] },
      { id: 'contenido', etiqueta: 'Manejo del contenido', opciones: ['Software de gestión de contenidos (remoto)', 'Carga manual por USB', 'Lo define el proveedor'] },
      { id: 'conexion', etiqueta: 'Conexión', opciones: ['Red (cable)', 'Wi-Fi', 'Datos móviles (4G/5G)'] },
    ],
    accesorios: ['Parlantes', 'Cámara', 'Impresora térmica de tiquetes', 'Lector de código QR', 'Anclaje al piso o base antivuelco'],
  },
};


// Convierte un equipo pedido en líneas de texto legibles ("Memoria RAM: 16 GB")
function describirItem(item) {
  const def = CATALOGO[item.tipo];
  const lineas = [];
  if (def) {
    def.campos.forEach((c) => {
      const v = item.especificaciones?.[c.id];
      if (v) lineas.push(`${c.etiqueta}: ${v}`);
    });
  }
  if (item.accesorios?.length) lineas.push(`Accesorios: ${item.accesorios.join(', ')}`);
  if (item.observaciones) lineas.push(`Observaciones: ${item.observaciones}`);
  return lineas;
}

module.exports = { CATALOGO, describirItem };
