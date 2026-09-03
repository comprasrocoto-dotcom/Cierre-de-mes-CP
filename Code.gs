/**
 * ============================================================================
 *  BACKEND — Dashboard Centro de Producción (CP)
 *  Intermediario entre el navegador y la carpeta de Google Drive "Base de
 *  informes". Se despliega como Web App y es la ÚNICA pieza que toca
 *  credenciales de Google Drive: el navegador nunca las ve.
 * ============================================================================
 *
 *  INSTALACIÓN (una sola vez)
 *  ---------------------------------------------------------------------
 *  1. Ve a https://script.google.com/ y crea un proyecto nuevo (o, desde la
 *     carpeta de Drive, Nuevo > Más > Google Apps Script).
 *  2. Borra el contenido de Code.gs que trae por defecto y pega este archivo
 *     completo.
 *  3. Configura las Propiedades del script:
 *     Extensiones > Propiedades del proyecto > Propiedades del script > Añadir fila
 *       GOOGLE_DRIVE_FOLDER_ID  =  <ID de la carpeta "Base de informes">
 *       ACCESS_TOKEN            =  <una cadena larga y aleatoria que tú inventes>
 *     (El ID de la carpeta es la parte de su URL después de /folders/:
 *      https://drive.google.com/drive/folders/ESTE_ES_EL_ID)
 *  4. No hace falta compartir la carpeta con nadie: este script corre bajo tu
 *     propia cuenta de Google (Ejecutar como: Yo), la misma dueña de la
 *     carpeta, así que ya tiene acceso.
 *  5. Implementar > Nueva implementación > tipo "Aplicación web".
 *       Ejecutar como:        Yo (tu cuenta)
 *       Quién tiene acceso:   Cualquier usuario (el token en ACCESS_TOKEN es
 *                              la capa de seguridad real; si prefieres,
 *                              "Cualquier usuario de tu organización" es más
 *                              estricto todavía y sigue funcionando igual).
 *  6. Copia la URL que termina en /exec — esa es la que va en DRIVE_CONFIG.webAppUrl
 *     dentro de index.html, junto con el mismo ACCESS_TOKEN en DRIVE_CONFIG.token.
 *  7. Cada vez que edites este script y quieras que el cambio quede activo,
 *     tienes que crear una Nueva implementación (o gestionar versiones) — con
 *     solo guardar el archivo no alcanza para una Web App ya publicada.
 * ============================================================================
 */

// Extensiones de archivo que el dashboard sabe leer.
const EXTENSIONES_VALIDAS = ['.xlsx', '.xls'];

function doGet(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty('GOOGLE_DRIVE_FOLDER_ID');
    const expectedToken = props.getProperty('ACCESS_TOKEN');

    if (!folderId) {
      return jsonResponse({ ok: false, error: 'Falta configurar GOOGLE_DRIVE_FOLDER_ID en Propiedades del script.' });
    }

    const token = e.parameter.token || '';
    if (expectedToken && token !== expectedToken) {
      return jsonResponse({ ok: false, error: 'Token de acceso inválido.' });
    }

    const action = e.parameter.action || 'list';
    const folder = DriveApp.getFolderById(folderId);

    if (action === 'list') {
      return jsonResponse({ ok: true, files: listValidFiles(folder) });
    }

    if (action === 'get') {
      const fileId = e.parameter.fileId;
      if (!fileId) return jsonResponse({ ok: false, error: 'Falta el parámetro fileId.' });

      const file = DriveApp.getFileById(fileId);

      // Verifica que el archivo pedido esté dentro de la carpeta configurada,
      // para que nadie pueda pedir un fileId arbitrario de tu Drive.
      const parents = file.getParents();
      let perteneceALaCarpeta = false;
      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) { perteneceALaCarpeta = true; break; }
      }
      if (!perteneceALaCarpeta) {
        return jsonResponse({ ok: false, error: 'El archivo solicitado no pertenece a la carpeta configurada.' });
      }

      const blob = file.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      return jsonResponse({
        ok: true,
        fileName: file.getName(),
        lastUpdated: file.getLastUpdated().toISOString(),
        base64: base64,
      });
    }

    return jsonResponse({ ok: false, error: 'Acción no reconocida: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Error del servidor: ' + err.message });
  }
}

function listValidFiles(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const file = it.next();
    const name = file.getName();
    const lower = name.toLowerCase();
    if (!EXTENSIONES_VALIDAS.some(function (ext) { return lower.endsWith(ext); })) continue;
    out.push({
      id: file.getId(),
      name: name,
      lastUpdated: file.getLastUpdated().toISOString(),
      periodo: parsePeriod(name), // 'YYYY-MM', o null si el nombre no trae un período detectable
      size: file.getSize(),
    });
  }
  return out;
}

// Detecta un período YYYY-MM en el nombre del archivo, soportando varios
// formatos de nombre (según lo pedido: el dashboard debe poder trabajar con
// nombres que contengan el mes y el año, sin imponer todavía una única
// convención):
//   "Informe_CP_2026_07.xlsx"   -> 2026-07
//   "Cierre_CP_2026-07.xlsx"    -> 2026-07
//   "Base_Informes_Julio_2026.xlsx" -> 2026-07
//   "07-2026 cierre.xlsx"       -> 2026-07
//   "cierre_072026.xlsx"        -> 2026-07
// Si no se detecta ningún período, retorna null (el dashboard entonces usa
// el archivo más reciente de la carpeta sin filtrar por mes).
var MESES_ES = {
  'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
  'julio': 7, 'agosto': 8, 'septiembre': 9, 'setiembre': 9, 'octubre': 10,
  'noviembre': 11, 'diciembre': 12,
};

function parsePeriod(filename) {
  const name = filename.toLowerCase();

  // 1) YYYY-MM, YYYY_MM o YYYY.MM
  let m = name.match(/(20\d{2})[\-_.](0?[1-9]|1[0-2])(?!\d)/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');

  // 2) MM-YYYY, MM_YYYY o MM.YYYY
  m = name.match(/(?:^|[^0-9])(0?[1-9]|1[0-2])[\-_.](20\d{2})/);
  if (m) return m[2] + '-' + String(m[1]).padStart(2, '0');

  // 3) MMYYYY pegado sin separador (ej. 072026)
  m = name.match(/(?:^|[^0-9])(0[1-9]|1[0-2])(20\d{2})(?!\d)/);
  if (m) return m[2] + '-' + m[1];

  // 4) Nombre de mes en español + año en cualquier parte del nombre
  for (const mesNombre in MESES_ES) {
    if (name.indexOf(mesNombre) !== -1) {
      const yearMatch = name.match(/20\d{2}/);
      if (yearMatch) {
        return yearMatch[0] + '-' + String(MESES_ES[mesNombre]).padStart(2, '0');
      }
    }
  }

  return null;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
