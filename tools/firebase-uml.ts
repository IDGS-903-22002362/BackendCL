import * as fs from "fs";
import * as path from "path";

// --- Configuration ---
const CONFIG = {
  rootDir: path.resolve(process.cwd(), "functions/src"),
  outputDir: path.resolve(process.cwd(), "docs"),
  extensions: [".ts", ".js"],
};

console.log(`[DEBUG] Root: ${CONFIG.rootDir}`);
console.log(`[DEBUG] Output: ${CONFIG.outputDir}`);

// --- Types ---
interface CollectionInfo {
  name: string;
  subcollections: string[];
  files: string[];
  fields: { name: string; type: string }[];
}

interface FirebaseServiceUsage {
  firestore: boolean;
  auth: boolean;
  functions: boolean;
  storage: boolean;
  fcm: boolean;
}

interface SchemaData {
  collections: Record<string, CollectionInfo>;
  services: FirebaseServiceUsage;
  relationships: { from: string; to: string; field: string }[];
  findings: string[];
}

// --- Regex Patterns (Pragmatic Approach) ---
const PATTERNS = {
  // Catch: .collection("users"), .collection('users'), collection('users')
  collection: /\.(?:collection|doc)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,

  // Catch: admin.firestore(), getFirestore(), etc.
  firestoreInit: /(?:admin\.firestore|getFirestore|db\.collection)/,

  // Catch: admin.auth(), getAuth()
  authInit: /(?:admin\.auth|getAuth)/,

  // Catch: functions.https, functions.firestore
  functionsInit: /functions\.(?:https|firestore|pubsub|storage|auth)/,

  // Catch: admin.storage(), getStorage()
  storageInit: /(?:admin\.storage|getStorage|bucket)/,

  // Catch: admin.messaging(), getMessaging()
  fcmInit: /(?:admin\.messaging|getMessaging)/,

  // Catch potential reference fields: userId, productId, etc.
  refField: /(\w+Id)\s*[:?]?/g,

  // Catch Interface definitions
  interfaceDef: /export\s+interface\s+(\w+)\s*{([^}]+)}/gm,

  // Catch fields within interface
  fieldDef: /^\s*(\w+)\??\s*:\s*([^;/]+)/gm,
};

// --- Helper Functions ---

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`[WARN] Directory not found: ${dirPath}`);
    return [];
  }
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (CONFIG.extensions.includes(path.extname(file))) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

// --- Main Analysis Logic ---

function analyzeCodebase(): SchemaData {
  const schema: SchemaData = {
    collections: {},
    services: {
      firestore: false,
      auth: false,
      functions: false,
      storage: false,
      fcm: false,
    },
    relationships: [],
    findings: [],
  };

  const files = getAllFiles(CONFIG.rootDir);

  console.log(`Analyzing ${files.length} files in ${CONFIG.rootDir}...`);

  files.forEach((file) => {
    const content = fs.readFileSync(file, "utf-8");
    const relativePath = path.relative(CONFIG.rootDir, file);

    // 1. Detect Services
    if (PATTERNS.firestoreInit.test(content)) schema.services.firestore = true;
    if (PATTERNS.authInit.test(content)) schema.services.auth = true;
    if (PATTERNS.functionsInit.test(content)) schema.services.functions = true;
    if (PATTERNS.storageInit.test(content)) schema.services.storage = true;
    if (PATTERNS.fcmInit.test(content)) schema.services.fcm = true;

    // 2. Detect Collections
    let match;
    while ((match = PATTERNS.collection.exec(content)) !== null) {
      const pathSegment = match[1];

      const parts = pathSegment.split("/");

      const cleanName = parts
        .filter(
          (p) => !p.startsWith("{") && !p.startsWith("$") && !p.startsWith(":"),
        )
        .join("/");

      if (!schema.collections[pathSegment]) {
        schema.collections[pathSegment] = {
          name: pathSegment,
          subcollections: [],
          files: [],
          fields: [],
        };
      }
      if (!schema.collections[pathSegment].files.includes(relativePath)) {
        schema.collections[pathSegment].files.push(relativePath);
      }
    }

    // 3. Detect Potential Relationships (Fields ending in Id)
    while ((match = PATTERNS.refField.exec(content)) !== null) {
      const fieldName = match[1];
      // logic for relationships...
    }

    // 4. Parse Interfaces to find fields for Collections
    // Heuristic: If we find an interface in a file roughly named like the collection,
    // OR if we can match interface name to collection name.

    // Reset regex index
    PATTERNS.interfaceDef.lastIndex = 0;

    let interfaceMatch;
    while ((interfaceMatch = PATTERNS.interfaceDef.exec(content)) !== null) {
      const interfaceName = interfaceMatch[1];
      const interfaceBody = interfaceMatch[2];

      // Try to map Interface -> Collection
      // e.g. "UsuarioApp" -> "usuariosApp" or "usuarios"
      // e.g. "Producto" -> "productos"

      let targetCollection = null;

      // Exact match (case insensitive)
      const exactMatch = Object.keys(schema.collections).find(
        (c) =>
          c.toLowerCase().replace(/[^a-z]/g, "") ===
            interfaceName.toLowerCase() ||
          c.toLowerCase().replace(/[^a-z]/g, "") ===
            interfaceName.toLowerCase() + "s",
      );

      if (exactMatch) {
        targetCollection = exactMatch;
      }

      if (targetCollection) {
        // Extract fields
        const fieldRegex = /^\s*(\w+)\??\s*:\s*([^;\n]+)/gm;
        let fieldMatch;
        while ((fieldMatch = fieldRegex.exec(interfaceBody)) !== null) {
          const fName = fieldMatch[1];
          const fType = fieldMatch[2].trim();

          // Avoid duplicates
          if (
            !schema.collections[targetCollection].fields.find(
              (f) => f.name === fName,
            )
          ) {
            schema.collections[targetCollection].fields.push({
              name: fName,
              type: fType,
            });
          }
        }
      }
    }
  });

  return schema;
}

// --- Generation Functions ---

function generateArchitectureDiagram(schema: SchemaData): string {
  let mmd = "flowchart LR\n";
  mmd += "    App[Flutter App]\n";

  if (schema.services.auth) {
    mmd += "    Auth[Firebase Auth]\n";
    mmd += "    App --> Auth\n";
  }

  mmd += "    Backend[Node.js Backend / Cloud Functions]\n";
  mmd += "    App --> Backend\n";

  if (schema.services.firestore) {
    mmd += "    Firestore[(Firestore DB)]\n";
    mmd += "    Backend --> Firestore\n";
    mmd += "    App -.-> Firestore\n";
  }

  if (schema.services.storage) {
    mmd += "    Storage[Cloud Storage]\n";
    mmd += "    Backend --> Storage\n";
    mmd += "    App --> Storage\n";
  }

  if (schema.services.fcm) {
    mmd += "    FCM[Firebase Cloud Messaging]\n";
    mmd += "    Backend --> FCM\n";
    mmd += "    FCM -.-> App\n";
  }

  return mmd;
}

function generateDataModelDiagram(schema: SchemaData): string {
  let mmd = "classDiagram\n";

  const nodes = new Set<string>();
  const relationships = new Set<string>();

  Object.values(schema.collections).forEach((col) => {
    let nodeName = col.name.split("/").pop() || "";

    nodeName = nodeName.replace(/[{}]/g, "");
    if (!nodeName) nodeName = "Unknown";
    nodeName = nodeName.charAt(0).toUpperCase() + nodeName.slice(1);

    const safeNodeName = nodeName.replace(/[^a-zA-Z0-9]/g, "_");

    // Build class definition with fields
    let classDef = `    class ${safeNodeName} {\n`;
    classDef += `        path: "${col.name}"\n`;

    if (col.fields && col.fields.length > 0) {
      classDef += `        -- Fields --\n`;
      col.fields.slice(0, 15).forEach((f) => {
        classDef += `        ${f.type} ${f.name}\n`;
      });
      if (col.fields.length > 15) {
        classDef += `        ... (${col.fields.length - 15} more)\n`;
      }
    }

    classDef += `    }`;
    nodes.add(classDef);

    // Inferred Relationships
    const parts = col.name.split("/");
    if (parts.length > 1) {
      const parentNameRaw = parts[parts.length - 3] || parts[0];
      if (parentNameRaw && parentNameRaw !== nodeName.toLowerCase()) {
        let parentNodeName = parentNameRaw.replace(/[{}]/g, "");
        parentNodeName =
          parentNodeName.charAt(0).toUpperCase() + parentNodeName.slice(1);
        const safeParentName = parentNodeName.replace(/[^a-zA-Z0-9]/g, "_");

        relationships.add(
          `    ${safeParentName} "1" *-- "*" ${safeNodeName} : contains`,
        );
      }
    }

    // Field-based relationships (e.g. lineaId -> Lineas)
    if (col.fields) {
      col.fields.forEach((f) => {
        if (f.name.endsWith("Id") && f.name !== "id" && f.name !== "uid") {
          // Try to find target
          const possibleTarget = f.name.replace("Id", "");
          // Naive pluralization for matching
          const targetCandidates = [
            possibleTarget + "s",
            possibleTarget + "es",
            possibleTarget,
          ];

          // Check if any candidate matches a known collection key
          const match = Object.keys(schema.collections).find((key) => {
            const keyClean = key.toLowerCase().replace(/[^a-z]/g, "");
            return targetCandidates.some((t) => keyClean === t.toLowerCase());
          });

          if (match) {
            let targetNode = match.split("/").pop() || "";
            targetNode = targetNode.replace(/[{}]/g, "");
            targetNode =
              targetNode.charAt(0).toUpperCase() + targetNode.slice(1);
            const safeTarget = targetNode.replace(/[^a-zA-Z0-9]/g, "_");

            if (safeTarget !== safeNodeName) {
              relationships.add(
                `    ${safeTarget} "1" --> "*" ${safeNodeName} : ${f.name}`,
              );
            }
          }
        }
      });
    }
  });

  nodes.forEach((n) => (mmd += n + "\n"));
  relationships.forEach((r) => (mmd += r + "\n"));

  return mmd;
}

function generateMarkdownReport(schema: SchemaData): string {
  let md = "# Reporte de Arquitectura Firebase - Club León App\n\n";
  md += `**Fecha:** ${new Date().toLocaleDateString()}\n`;
  md += `**Fuente:** Análisis estático de código (${CONFIG.rootDir})\n\n`;

  md += "## Servicios Detectados\n";
  md += "- [x] Cloud Functions / Node.js Backend\n";
  md += `- [${schema.services.firestore ? "x" : " "}] Firestore Database\n`;
  md += `- [${schema.services.auth ? "x" : " "}] Firebase Auth\n`;
  md += `- [${schema.services.storage ? "x" : " "}] Cloud Storage\n`;
  md += `- [${schema.services.fcm ? "x" : " "}] Firebase Cloud Messaging (FCM)\n\n`;

  md += "## Colecciones Firestore Detectadas\n";
  md += "| Colección / Ruta | Archivos de Referencia | Observaciones |\n";
  md += "|---|---|---|\n";

  Object.values(schema.collections).forEach((col) => {
    const refs = col.files.map((f) => `\`${path.basename(f)}\``).join(", ");
    md += `| \`${col.name}\` | ${refs} | |\n`;
  });

  md += "\n## Hallazgos y Notas de Seguridad\n";
  md +=
    "- **Reglas de Seguridad:** Se recomienda revisar `firestore.rules` para asegurar que las colecciones detectadas tengan las reglas apropiadas.\n";
  md +=
    "- **Expansión Dinámica:** Las rutas que contienen parámetros (ej. `{uid}`) indican subcolecciones o documentos específicos. Asegurar validación de IDs en el backend.\n";

  if (schema.findings.length > 0) {
    md += "\n### Inconsistencias Detectadas\n";
    schema.findings.forEach((f) => (md += `- ${f}\n`));
  } else {
    md +=
      "\n> No se detectaron inconsistencias obvias en nombres de colecciones.\n";
  }

  md += "\n## Evidencia\n";
  md += "Se sugiere adjuntar capturas de pantalla de:\n";
  md +=
    "1. **Firebase Console > Firestore Data** (para validar estructura real).\n";
  md += "2. **Firebase Console > Usage** (para verificar cuotas).\n";

  return md;
}

// --- Execution ---

function main() {
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const schema = analyzeCodebase();

  // 1. JSON Schema
  fs.writeFileSync(
    path.join(CONFIG.outputDir, "firebase-schema.json"),
    JSON.stringify(schema, null, 2),
  );
  console.log(
    `Generated: ${path.join(CONFIG.outputDir, "firebase-schema.json")}`,
  );

  // 2. Architecture Diagram (Mermaid)
  const archMmd = generateArchitectureDiagram(schema);
  fs.writeFileSync(
    path.join(CONFIG.outputDir, "arquitectura-firebase.mmd"),
    archMmd,
  );
  console.log(
    `Generated: ${path.join(CONFIG.outputDir, "arquitectura-firebase.mmd")}`,
  );

  // 3. Data Model Diagram (Mermaid)
  const modelMmd = generateDataModelDiagram(schema);
  fs.writeFileSync(
    path.join(CONFIG.outputDir, "modelo-firestore.mmd"),
    modelMmd,
  );
  console.log(
    `Generated: ${path.join(CONFIG.outputDir, "modelo-firestore.mmd")}`,
  );

  // 4. Markdown Report
  const reportMd = generateMarkdownReport(schema);
  fs.writeFileSync(
    path.join(CONFIG.outputDir, "firebase-resultado.md"),
    reportMd,
  );
  console.log(
    `Generated: ${path.join(CONFIG.outputDir, "firebase-resultado.md")}`,
  );
}

main();
