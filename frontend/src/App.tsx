import { useCallback, useState } from 'react'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import './App.css'
import { AuthPanel } from './auth/AuthPanel'
import {
  joinSession,
  purchaseBasicEvent,
  submitPrediction,
  voteComplexEvent,
} from './api/client'
import { JoinSessionView } from './game/JoinSessionView'
import { ComplexVoteView } from './game/ComplexVoteView'
import { BasicEventWheelView } from './game/BasicEventWheelView'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const apiAudience = 'https://api.crowdcontrol'
const redirectUri = import.meta.env.VITE_AUTH0_REDIRECT_URI ?? `${window.location.origin}/`

function readAuth0Subject(subject: unknown): string | null {
  return typeof subject === 'string' && subject.length > 0 ? subject : null
}

function SpectatorApp() {
  const { user, getAccessTokenSilently } = useAuth0()
  const [currentView, setCurrentView] = useState<'profile' | 'join' | 'vote' | 'wheel'>('profile')
  const [sessionCode, setSessionCode] = useState('')
  const [spectatorName, setSpectatorName] = useState('')
  const [currentRound, setCurrentRound] = useState(1)
  const [totalRounds, setTotalRounds] = useState(5)
  const [tokens, setTokens] = useState(0)

  const getSpectatorIdentity = useCallback(async (): Promise<{ token: string; sub: string }> => {
    const sub: string = readAuth0Subject(user?.sub) ?? ''
    if (!sub) {
      throw new Error('Please log in before joining a session.')
    }
    const token = await getAccessTokenSilently({
      authorizationParams: { audience: apiAudience },
    })
    if (!token) {
      throw new Error('Unable to get an API access token. Please log in again.')
    }
    return { token, sub }
  }, [getAccessTokenSilently, user?.sub])

  const handleJoin = useCallback(async (code: string) => {
    const { token, sub } = await getSpectatorIdentity()
    const joined = await joinSession(code, token, {
      sub,
      nickname: user?.nickname,
    })
    setSessionCode(code)
    setTokens(joined.tokenBalance)
    setSpectatorName(joined.username)
    setCurrentRound(joined.currentRound)
    setTotalRounds(joined.totalRounds ?? 5)
    setCurrentView('vote')
  }, [getSpectatorIdentity, user])

  const handleVoteEvent = useCallback(async (eventId: string) => {
    const { token, sub } = await getSpectatorIdentity()
    await voteComplexEvent(sessionCode, token, sub, eventId)
  }, [getSpectatorIdentity, sessionCode])

  const handlePrediction = useCallback(async (
    type: 'time_bracket' | 'player',
    value: string,
  ) => {
    const { token, sub } = await getSpectatorIdentity()
    await submitPrediction(sessionCode, token, sub, type, value)
  }, [getSpectatorIdentity, sessionCode])

  const handlePurchase = useCallback(async (eventType: string) => {
    const { token, sub } = await getSpectatorIdentity()
    const result = await purchaseBasicEvent(sessionCode, token, sub, eventType)
    setTokens(result.tokenBalance)
    return result.tokenBalance
  }, [getSpectatorIdentity, sessionCode])

  const handleVoteComplete = useCallback(() => {
    setCurrentView('wheel')
  }, [])

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
          currentRound={currentRound}
          totalRounds={totalRounds}
          onVoteEvent={handleVoteEvent}
          onSubmitPrediction={handlePrediction}
          onLeaveSession={() => setCurrentView('join')}
          onVoteComplete={handleVoteComplete}
        />
      )}

      {currentView === 'wheel' && (
        <BasicEventWheelView
          sessionCode={sessionCode}
          currentRound={currentRound}
          totalRounds={totalRounds}
          tokens={tokens}
          spectatorName={spectatorName}
          onBackToVote={() => setCurrentView('vote')}
          onTriggerEvent={handlePurchase}
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
        audience: apiAudience,
      }}
    >
      <SpectatorApp />
    </Auth0Provider>
  )
}

export default App
