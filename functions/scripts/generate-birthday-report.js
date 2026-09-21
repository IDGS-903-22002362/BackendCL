/**
 * Genera un reporte (HTML + PDF) con los socios que cumplen anios en una fecha dada.
 *
 * El campo `fechaNacimiento` de `usuariosApp` conviene tratarlo como fecha de
 * calendario, no como instante: los registros antiguos se guardaron como
 * Timestamp a medianoche UTC y los nuevos como cadena ISO sin zona horaria.
 * Por eso los Timestamp se leen en UTC y las cadenas por su prefijo literal;
 * cualquier conversion a hora local correria la fecha un dia.
 *
 * Uso:
 *   node scripts/generate-birthday-report.js --day=25 --month=8
 *   node scripts/generate-birthday-report.js --day=25 --month=8 --out=reports/mi-reporte
 *
 * El PDF queda en reports/, que esta en .gitignore por contener datos de socios.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { firestoreApp } = require("../lib/config/app.firebase");

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const BRAND = {
  green: "#006A54",
  darkGreen: "#206734",
  gold: "#F3C24B",
  ink: "#0B0B0B",
};

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  const now = new Date();
  return {
    day: Number(out.day || now.getDate()),
    month: Number(out.month || now.getMonth() + 1),
    year: Number(out.year || now.getFullYear()),
    out: out.out || null,
  };
}

/** Devuelve la fecha de calendario almacenada, sin desplazamientos de zona horaria. */
function extraerFechaNacimiento(raw) {
  if (raw === null || raw === undefined || raw === "") return null;

  if (typeof raw.toDate === "function") {
    const dt = raw.toDate();
    if (Number.isNaN(dt.getTime())) return null;
    return {
      year: dt.getUTCFullYear(),
      month: dt.getUTCMonth() + 1,
      day: dt.getUTCDate(),
      formato: "Timestamp",
    };
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return {
      year: raw.getUTCFullYear(),
      month: raw.getUTCMonth() + 1,
      day: raw.getUTCDate(),
      formato: "Date",
    };
  }

  if (typeof raw === "string") {
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      formato: "string",
    };
  }

  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function construirHtml({ filas, dia, mes, anio, stats, duplicados }) {
  const titulo = `Cumpleaños del ${dia} de ${MESES[mes - 1]}`;
  const generado = new Date().toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "long",
    timeStyle: "short",
  });

  const cuerpo = filas
    .map((f, i) => {
      const dup = duplicados.has(f.uid) ? ' class="dup"' : "";
      return `        <tr${dup}>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(f.nombre) || '<span class="vacio">(sin nombre)</span>'}</td>
          <td class="mail">${escapeHtml(f.email) || '<span class="vacio">(sin email)</span>'}</td>
          <td class="uid">${escapeHtml(f.uid)}</td>
          <td class="num">${f.year}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}</td>
          <td class="num edad">${anio - f.year}</td>
        </tr>`;
    })
    .join("\n");

  const notaDuplicados = duplicados.size
    ? `<p class="nota"><span class="chip"></span> Filas marcadas: mismo nombre y fecha de nacimiento en mas de una cuenta. Revisar antes de otorgar puntos o enviar promociones, para no duplicar el beneficio.</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(titulo)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: ${BRAND.ink};
    margin: 0;
    font-size: 9.5pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  header {
    border-bottom: 3px solid ${BRAND.gold};
    padding-bottom: 10px;
    margin-bottom: 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
  }
  h1 { font-size: 18pt; margin: 0 0 2px; color: ${BRAND.green}; letter-spacing: -0.2px; }
  .sub { font-size: 9pt; color: #5a5a5a; margin: 0; }
  .stats { display: flex; gap: 10px; flex-shrink: 0; }
  .stat {
    background: ${BRAND.green};
    color: #fff;
    border-radius: 10px;
    padding: 8px 14px;
    text-align: center;
    min-width: 82px;
  }
  .stat.alt { background: #f2f4f3; color: ${BRAND.darkGreen}; }
  .stat b { display: block; font-size: 16pt; line-height: 1.1; }
  .stat span { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.85; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th {
    background: ${BRAND.green};
    color: #fff;
    text-align: left;
    padding: 7px 8px;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  th:first-child { border-radius: 5px 0 0 0; }
  th:last-child { border-radius: 0 5px 0 0; }
  td { padding: 5.5px 8px; border-bottom: 1px solid #e6e8e7; vertical-align: middle; }
  tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #f7f9f8; }
  tr.dup td { background: #fdf6e3; }
  tr.dup td:first-child { box-shadow: inset 3px 0 0 ${BRAND.gold}; }
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .edad { font-weight: 700; color: ${BRAND.darkGreen}; text-align: center; }
  .mail { color: #3c3c3c; word-break: break-all; }
  .uid { font-family: Consolas, "Courier New", monospace; font-size: 8pt; color: #4a4a4a; }
  .vacio { color: #9a9a9a; font-style: italic; }
  .nota { font-size: 8pt; color: #5a5a5a; margin-top: 12px; line-height: 1.5; }
  .chip {
    display: inline-block; width: 9px; height: 9px; border-radius: 2px;
    background: #fdf6e3; border-left: 3px solid ${BRAND.gold}; vertical-align: middle;
  }
  footer { margin-top: 10px; font-size: 7.5pt; color: #8a8a8a; border-top: 1px solid #e6e8e7; padding-top: 6px; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(titulo)}</h1>
      <p class="sub">Club León &middot; Socios registrados en la app &middot; Generado el ${escapeHtml(generado)}</p>
    </div>
    <div class="stats">
      <div class="stat"><b>${filas.length}</b><span>Cumpleañeros</span></div>
      <div class="stat alt"><b>${stats.total.toLocaleString("es-MX")}</b><span>Socios totales</span></div>
      <div class="stat alt"><b>${stats.sinFecha.toLocaleString("es-MX")}</b><span>Sin fecha</span></div>
    </div>
  </header>

  <table>
    <thead>
      <tr>
        <th style="width:28px">#</th>
        <th style="width:23%">Nombre</th>
        <th style="width:29%">Email</th>
        <th style="width:29%">UID</th>
        <th style="width:11%">Nacimiento</th>
        <th style="width:8%">Cumple</th>
      </tr>
    </thead>
    <tbody>
${cuerpo}
    </tbody>
  </table>

  ${notaDuplicados}

  <footer>
    Documento con datos personales de socios. Uso interno; no compartir fuera del equipo autorizado.
  </footer>
</body>
</html>`;
}

function localizarNavegador() {
  const candidatos = [
    path.join(process.env["ProgramFiles"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env["ProgramFiles"] || "", "Microsoft/Edge/Application/msedge.exe"),
  ];
  return candidatos.find((c) => c && fs.existsSync(c)) || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { day: dia, month: mes, year: anio } = args;

  if (!(mes >= 1 && mes <= 12) || !(dia >= 1 && dia <= 31)) {
    console.error("ABORTADO: dia o mes invalido.");
    process.exit(1);
  }

  console.log(`Buscando socios que cumplen el ${dia} de ${MESES[mes - 1]}...`);

  const snap = await firestoreApp.collection("usuariosApp").get();
  const filas = [];
  let sinFecha = 0;
  let ilegibles = 0;

  snap.forEach((doc) => {
    const data = doc.data() || {};
    const fecha = extraerFechaNacimiento(data.fechaNacimiento);
    if (!fecha) {
      if (data.fechaNacimiento === null || data.fechaNacimiento === undefined || data.fechaNacimiento === "") {
        sinFecha += 1;
      } else {
        ilegibles += 1;
      }
      return;
    }
    if (fecha.month !== mes || fecha.day !== dia) return;

    filas.push({
      uid: doc.id,
      nombre: String(data.nombre || "").trim(),
      email: String(data.email || "").trim(),
      year: fecha.year,
      formato: fecha.formato,
      activo: data.activo !== false,
    });
  });

  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Misma persona con varias cuentas: nombre normalizado + anio de nacimiento.
  const porClave = new Map();
  for (const f of filas) {
    const clave = f.nombre
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim() + "|" + f.year;
    porClave.set(clave, (porClave.get(clave) || []).concat(f.uid));
  }
  const duplicados = new Set();
  for (const uids of porClave.values()) {
    if (uids.length > 1) uids.forEach((u) => duplicados.add(u));
  }

  const stats = { total: snap.size, sinFecha, ilegibles };
  const html = construirHtml({ filas, dia, mes, anio, stats, duplicados });

  const base = args.out
    ? path.resolve(args.out)
    : path.resolve(__dirname, "..", "reports", `cumpleanos-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`);
  fs.mkdirSync(path.dirname(base), { recursive: true });

  const htmlPath = `${base}.html`;
  const pdfPath = `${base}.pdf`;
  fs.writeFileSync(htmlPath, html, "utf8");

  const navegador = localizarNavegador();
  if (!navegador) {
    console.warn("No se encontro Chrome ni Edge. Solo se genero el HTML.");
  } else {
    execFileSync(navegador, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ], { stdio: "ignore" });
  }

  console.log("");
  console.log(`Socios revisados   : ${stats.total}`);
  console.log(`Sin fecha registrada: ${stats.sinFecha}`);
  console.log(`Fecha ilegible      : ${stats.ilegibles}`);
  console.log(`Cumpleaneros        : ${filas.length}`);
  console.log(`Posibles duplicados : ${duplicados.size}`);
  console.log("");
  console.log(`HTML: ${htmlPath}`);
  if (navegador) console.log(`PDF : ${pdfPath}`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
