import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function developmentLogPlugin(): Plugin {
  return {
    name: 'development-log',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const startedAt = Date.now()
        if (request.method === 'POST' && request.url === '/__new-theme-park-log') {
          let body = ''
          request.on('data', (chunk) => { body += chunk })
          request.on('end', () => {
            try {
              const { event, details } = JSON.parse(body)
              console.info(`[game] ${event}`, details ?? '')
            } catch {
              console.warn('[game] invalid log payload')
            }
            response.statusCode = 204
            response.end()
          })
          return
        }

        response.on('finish', () => {
          if (request.headers.accept?.includes('text/html')) {
            console.info(`[access] ${request.method} ${request.url} ${response.statusCode} ${Date.now() - startedAt}ms`)
          }
        })
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), developmentLogPlugin()],
  server: {
    // 同じ LAN の端末からも開けるようにする
    host: true,
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
