// Setup simple para tests
import { vi } from 'vitest'

// Mock básico de console para tests
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn()
}

// Cleanup después de cada test
afterEach(() => {
  vi.clearAllMocks()
})
