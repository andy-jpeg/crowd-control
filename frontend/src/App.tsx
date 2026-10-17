import { useState } from 'react'
import { Auth0Provider } from '@auth0/auth0-react'
import './App.css'
import { AuthPanel } from './auth/AuthPanel'
import { JoinSessionView } from './game/JoinSessionView'
import { ComplexVoteView } from './game/ComplexVoteView'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const redirectUri = import.meta.env.VITE_AUTH0_REDIRECT_URI ?? `${window.location.origin}/`

function SpectatorApp() {
  const [currentView, setCurrentView] = useState<'profile' | 'join' | 'vote'>('profile')
  const [sessionCode, setSessionCode] = useState<string>('')

  const handleJoin = (code: string) => {
    setSessionCode(code)
    setCurrentView('vote')
  }

  return (
    <>
      <main
        className="app-shell"
        style={{ display: currentView === 'profile' ? 'flex' : 'none' }}
      >
        <header className="topbar">
          <div>
            <p className="eyebrow">Roblox Party Game</p>
            <h1>Spectator Hub</h1>
          </div>
        </header>

        <section className="panel">
          <AuthPanel onJoinSession={() => setCurrentView('join')} />
        </section>
      </main>

      {currentView === 'join' && (
        <JoinSessionView
          onJoin={handleJoin}
          onBack={() => setCurrentView('profile')}
        />
      )}

      {currentView === 'vote' && (
        <ComplexVoteView
          sessionCode={sessionCode}
          onLeaveSession={() => setCurrentView('join')}
          onVoteComplete={(selectedEventId) => {
            console.log('15s voting window finished. Selected event:', selectedEventId)
          }}
        />
      )}
    </>
  )
}

function App() {
  if (!domain || !clientId) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Roblox Party Game</p>
            <h1>Spectator Hub</h1>
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
      <SpectatorApp />
    </Auth0Provider>
  )
}

export default App
