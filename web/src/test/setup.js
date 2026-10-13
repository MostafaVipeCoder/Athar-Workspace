import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// the lazy node chunks (first render of a file) can take longer than the 1 s default under a loaded machine; assertions stay the same
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  try {
    window.localStorage.clear()
  } catch {
    /* ignore */
  }
})
