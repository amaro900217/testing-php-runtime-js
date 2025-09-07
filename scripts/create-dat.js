// create-dat.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gzipSync } from "fflate"; // Importar compresión gzip

// Polyfill para __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createProjectDat(projectPath, outputPath) {
  console.log(`📁 Procesando directorio: ${projectPath}`);
  console.log(`💾 Archivo de salida: ${outputPath}`);

  // Verificar si el directorio existe
  if (!fs.existsSync(projectPath)) {
    throw new Error(`❌ El directorio '${projectPath}' no existe`);
  }

  const files = [];

  // Recorrer recursivamente el directorio del proyecto
  function traverseDirectory(currentPath) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        // Para directorios, agregar una entrada con barra diagonal
        const relativePath = path.relative(projectPath, fullPath) + "/";
        files.push({
          name: relativePath,
          content: new Uint8Array(0),
        });

        console.log(`📂 Directorio: ${relativePath}`);
        traverseDirectory(fullPath);
      } else {
        // Para archivos, leer el contenido
        const relativePath = path.relative(projectPath, fullPath);
        const content = fs.readFileSync(fullPath);

        files.push({
          name: relativePath,
          content: new Uint8Array(content),
        });

        console.log(`📄 Archivo: ${relativePath} (${content.length} bytes)`);
      }
    }
  }

  traverseDirectory(projectPath);

  if (files.length === 0) {
    throw new Error(`❌ No se encontraron archivos en '${projectPath}'`);
  }

  // Calcular el tamaño total del buffer
  let totalSize = 4; // Para el número de archivos

  for (const file of files) {
    totalSize += 2; // Longitud del nombre
    totalSize += new TextEncoder().encode(file.name).length; // Nombre
    totalSize += 4; // Longitud del contenido
    totalSize += file.content.length; // Contenido
  }

  // Crear el buffer
  const buffer = new ArrayBuffer(totalSize);
  const dataView = new DataView(buffer);
  let offset = 0;

  // Escribir número de archivos
  dataView.setUint32(offset, files.length, true);
  offset += 4;

  // Escribir cada archivo
  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);

    // Escribir longitud del nombre
    dataView.setUint16(offset, nameBytes.length, true);
    offset += 2;

    // Escribir nombre
    new Uint8Array(buffer, offset, nameBytes.length).set(nameBytes);
    offset += nameBytes.length;

    // Escribir longitud del contenido
    dataView.setUint32(offset, file.content.length, true);
    offset += 4;

    // Escribir contenido
    new Uint8Array(buffer, offset, file.content.length).set(file.content);
    offset += file.content.length;
  }

  // Comprimir el buffer con gzip
  console.log("🗜️ Comprimiendo archivo .dat con gzip...");
  const compressedData = gzipSync(new Uint8Array(buffer));

  // Crear directorio de salida si no existe
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Directorio creado: ${outputDir}`);
  }

  // Escribir el archivo .dat comprimido
  fs.writeFileSync(outputPath, compressedData);
  console.log(
    `✅ Archivo .dat.gz creado: ${outputPath} (${files.length} archivos, ${compressedData.length} bytes comprimidos)`,
  );

  // Calcular ratio de compresión
  const originalSize = buffer.byteLength;
  const compressedSize = compressedData.length;
  const compressionRatio = ((compressedSize / originalSize) * 100).toFixed(2);

  console.log(
    `📊 Ratio de compresión: ${compressionRatio}% (${originalSize} → ${compressedSize} bytes)`,
  );
}

// Uso: node create-dat.js <ruta-al-proyecto> <ruta-de-salida>
const projectPath = process.argv[2];
const outputPath = process.argv[3];

if (!projectPath || !outputPath) {
  console.log(
    "ℹ️  Uso: node create-dat.js <ruta-al-proyecto> <ruta-de-salida>",
  );
  console.log(
    "📋 Ejemplo: node create-dat.js assets/www/php assets/www/laravel.dat.gz",
  );
  process.exit(1);
}

try {
  // Resolver rutas relativas
  const resolvedProjectPath = path.resolve(process.cwd(), projectPath);
  const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

  createProjectDat(resolvedProjectPath, resolvedOutputPath);
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}
