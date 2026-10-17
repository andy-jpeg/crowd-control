import { Auth0Provider } from '@auth0/auth0-react'
import './App.css'
import { AuthPanel } from './auth/AuthPanel'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const redirectUri = import.meta.env.VITE_AUTH0_REDIRECT_URI ?? `${window.location.origin}/`

function App() {
  if (!domain || !clientId) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Crowd Control</p>
            <h1>Audience auth</h1>
          </div>
        </header>

        <section className="panel">
          <div className="auth-card auth-error">
            <h2>Auth configuration error</h2>
            <p>
              Missing Auth0 environment variables. Add VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID to the frontend .env file, then restart the frontend server.
            </p>
          </div>
        </section>
      </main>
    )
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: redirectUri,
      }}
    >
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Crowd Control</p>
            <h1>Audience auth</h1>
          </div>
        </header>

        <section className="panel">
          <AuthPanel />
        </section>
      </main>
    </Auth0Provider>
  )
}

export default App
