import { useState } from 'react'
import { Auth0Provider } from '@auth0/auth0-react'
import './App.css'
import { AuthPanel } from './auth/AuthPanel'
import { JoinSessionView } from './game/JoinSessionView'
import { ComplexVoteView } from './game/ComplexVoteView'
import { BasicEventWheelView } from './game/BasicEventWheelView'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const redirectUri = import.meta.env.VITE_AUTH0_REDIRECT_URI ?? `${window.location.origin}/`

function SpectatorApp() {
  const [currentView, setCurrentView] = useState<'profile' | 'join' | 'vote' | 'wheel'>('profile')
  const [sessionCode, setSessionCode] = useState<string>('KWPZ')

  const handleJoin = (code: string) => {
    setSessionCode(code)
    setCurrentView('vote')
  }

  const handleVoteComplete = (selectedEventId: string | null, prediction: string | null) => {
    console.log('15s voting window finished. Selected event:', selectedEventId, 'Prediction:', prediction)
    setCurrentView('wheel')
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
          onVoteComplete={handleVoteComplete}
        />
      )}

      {currentView === 'wheel' && (
        <BasicEventWheelView
          sessionCode={sessionCode}
          currentRound={1}
          totalRounds={5}
          initialTokens={50}
          onBackToVote={() => setCurrentView('vote')}
          onTriggerEvent={(id) => {
            console.log('Triggered basic event:', id)
          }}
        />
      )}
    </>
  )
}

function App() {
  if (!window.isSecureContext) {
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
            <h2>Open this page over HTTPS</h2>
            <p>
              Login only works on https:// or localhost. You opened {window.location.origin}, so use the HTTPS tunnel link (or the hosted site) instead.
            </p>
          </div>
        </section>
      </main>
    )
  }

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
