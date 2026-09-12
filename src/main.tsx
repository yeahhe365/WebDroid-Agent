import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container is missing from index.html.')
}

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
