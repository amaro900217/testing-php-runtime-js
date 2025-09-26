// create-dat.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { zipSync } from "fflate"; // 👈 usar ZIP estándar

// Polyfill para __dirname en ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createProjectZip(projectPath, outputPath) {
  console.log(`📁 Procesando directorio: ${projectPath}`);
  console.log(`💾 Archivo de salida: ${outputPath}`);

  // Verificar si el directorio existe
  if (!fs.existsSync(projectPath)) {
    throw new Error(`❌ El directorio '${projectPath}' no existe`);
  }

  const filesObject = {}; // { relativePath: Uint8Array }

  // Recorrer recursivamente el directorio del proyecto
  function traverseDirectory(currentPath) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        traverseDirectory(fullPath);
      } else {
        // Para archivos, leer el contenido
        const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, "/");
        const content = fs.readFileSync(fullPath);

        filesObject[relativePath] = new Uint8Array(content);

        console.log(`📄 Archivo: ${relativePath} (${content.length} bytes)`);
      }
    }
  }

  traverseDirectory(projectPath);

  if (Object.keys(filesObject).length === 0) {
    throw new Error(`❌ No se encontraron archivos en '${projectPath}'`);
  }

  // Crear ZIP
  console.log("🗜️ Comprimiendo archivos en ZIP...");
  const compressedData = zipSync(filesObject);

  // Crear directorio de salida si no existe
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Directorio creado: ${outputDir}`);
  }

  // Escribir el archivo .zip
  fs.writeFileSync(outputPath, compressedData);
  console.log(
    `✅ Archivo .zip creado: ${outputPath} (${Object.keys(filesObject).length} archivos, ${compressedData.length} bytes comprimidos)`,
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
    "📋 Ejemplo: node create-dat.js assets/www/php assets/www/laravel.zip",
  );
  process.exit(1);
}

try {
  // Resolver rutas relativas
  const resolvedProjectPath = path.resolve(process.cwd(), projectPath);
  const resolvedOutputPath = path.resolve(process.cwd(), outputPath);

  createProjectZip(resolvedProjectPath, resolvedOutputPath);
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}

