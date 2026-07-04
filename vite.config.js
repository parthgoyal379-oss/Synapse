import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // SYNAPSE ships as a single large App.jsx (5800+ lines) — raise the warning
    // threshold so the build doesn't spam chunk-size warnings on every deploy.
    // Real fix for bundle size is code-splitting AdminDashboard via React.lazy()
    // which requires extracting it to its own file (pending task).
    chunkSizeWarningLimit: 1500,
  },
})