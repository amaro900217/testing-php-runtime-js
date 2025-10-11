# Tests Unitarios para PHP Runtime JS

Tests simples para la librería PHP Runtime JS.

## Instalación

### 1. Instalar dependencias de testing
```bash
npm install
```

Esto instalará automáticamente:
- `vitest` - Framework de testing
- `jsdom` - Entorno de DOM para tests
- `vite` - Build tool (ya existente)

### 2. Verificar instalación
```bash
npm run test:run
```

## Estructura

```
tests/
├── setup.js          # Configuración básica (17 líneas)
├── simple.test.js    # Tests de utilidades (320 líneas, 15 tests)
└── README.md         # Este archivo
```

## Comandos

```bash
npm test              # Tests en modo watch
npm run test:run      # Tests una sola vez
```

### Archivos de configuración necesarios:
- `vitest.config.js` - Configuración de Vitest
- `package.json` - Scripts y dependencias

## Requisitos del Sistema

### Node.js
- **Versión mínima**: Node.js 16+
- **Recomendado**: Node.js 18+

### Dependencias instaladas automáticamente:
```json
{
  "devDependencies": {
    "vitest": "^1.0.0",      // Framework de testing
    "jsdom": "^23.0.0",      // Entorno DOM para tests
    "vite": "^5.0.0"         // Build tool
  }
}
```

### Verificar versión de Node:
```bash
node --version    # Debe ser 16+
npm --version     # Debe ser 8+
```

## Tests Incluidos

- ✅ **Configuración** - Valores por defecto y validación
- ✅ **Procesamiento de strings** - Escape de PHP y parsing de headers  
- ✅ **Parámetros de query** - GET/POST variables
- ✅ **Variables de servidor** - Generación de $_SERVER
- ✅ **Manejo de errores** - Categorización y validación
- ✅ **Funciones utilitarias** - IDs únicos, timestamps, validación de paths
- ✅ **Validación de datos** - Configuración y requests

## Agregar Tests

```javascript
// tests/nuevo.test.js
import { describe, it, expect } from 'vitest'

describe('Nueva Funcionalidad', () => {
  it('should work', () => {
    expect(true).toBe(true)
  })
})
```

## Troubleshooting

### Error: "Cannot find module 'vitest'"
```bash
npm install  # Reinstalar dependencias
```

### Error: "Cannot resolve module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Tests no ejecutan
```bash
# Verificar que los archivos existen:
ls tests/simple.test.js
ls vitest.config.js

# Ejecutar con verbose:
npm run test:run -- --reporter=verbose
```

### Error de permisos en Linux
```bash
sudo npm install -g npm  # Actualizar npm
```
