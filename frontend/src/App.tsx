import { useCallback, useEffect, useState } from 'react'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import './App.css'
import { AuthPanel } from './auth/AuthPanel'
import {
  getSession,
  joinSession,
  purchaseBasicEvent,
  submitPrediction,
  voteComplexEvent,
} from './api/client'
import { JoinSessionView } from './game/JoinSessionView'
import { WaitingForHostView } from './game/WaitingForHostView'
import { ComplexVoteView } from './game/ComplexVoteView'
import { BasicEventWheelView } from './game/BasicEventWheelView'
import { SessionEndView } from './game/SessionEndView'

const domain = import.meta.env.VITE_AUTH0_DOMAIN
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID
const apiAudience = 'https://api.crowdcontrol'
const redirectUri = import.meta.env.VITE_AUTH0_REDIRECT_URI ?? `${window.location.origin}/`

function readAuth0Subject(subject: unknown): string | null {
  return typeof subject === 'string' && subject.length > 0 ? subject : null
}

function SpectatorApp() {
  const { user, getAccessTokenSilently } = useAuth0()
  const [currentView, setCurrentView] = useState<'profile' | 'join' | 'waiting' | 'vote' | 'wheel' | 'end'>('profile')
  const [sessionCode, setSessionCode] = useState('')
  const [spectatorName, setSpectatorName] = useState('')
  const [currentRound, setCurrentRound] = useState(1)
  const [totalRounds, setTotalRounds] = useState(5)
  // Spectator gets 50 tokens on joining a session
  const [tokens, setTokens] = useState(50)
  const [userPrediction, setUserPrediction] = useState<string | null>(null)
  const [correctPredictions, setCorrectPredictions] = useState(0)

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
    const sub = readAuth0Subject(user?.sub) ?? ''
    const storedUsername =
      localStorage.getItem(`cc_username_${sub}`) ||
      (user?.email ? localStorage.getItem(`cc_username_${user.email}`) : null)
    const effectiveName = storedUsername || user?.nickname || 'Spectator'

    try {
      const { token, sub: activeSub } = await getSpectatorIdentity()
      const joined = await joinSession(code, token, {
        sub: activeSub,
        nickname: effectiveName,
      })
      setSessionCode(code)
      // When the spectator joins a session, they get 50 tokens
      const initialTokens = typeof joined.tokenBalance === 'number' && joined.tokenBalance >= 50
        ? joined.tokenBalance
        : 50
      setTokens(initialTokens)
      setSpectatorName(joined.username || effectiveName)
      setCurrentRound(joined.currentRound)
      setTotalRounds(joined.totalRounds ?? 5)
      setCurrentView('waiting')
    } catch (err) {
      console.warn('Backend API unreachable, proceeding in spectator demo mode:', err)
      setSessionCode(code)
      // When the spectator joins a session, they get 50 tokens
      setTokens(50)
      setSpectatorName(effectiveName)
      setCurrentRound(1)
      setTotalRounds(5)
      setCurrentView('waiting')
    }
  }, [getSpectatorIdentity, user])

  const handleCheckSessionStatus = useCallback(async (): Promise<string | null> => {
    try {
      const { token } = await getSpectatorIdentity()
      const session = await getSession(sessionCode, token)
      return session.status
    } catch {
      return null
    }
  }, [getSpectatorIdentity, sessionCode])

  const handleVoteEvent = useCallback(async (eventId: string) => {
    try {
      const { token, sub } = await getSpectatorIdentity()
      await voteComplexEvent(sessionCode, token, sub, eventId, currentRound)
    } catch (err) {
      console.warn('Backend API unreachable, recorded vote locally:', err)
    }
  }, [getSpectatorIdentity, sessionCode, currentRound])

  const handlePrediction = useCallback(async (
    type: 'time_bracket' | 'player',
    value: string,
  ) => {
    try {
      const { token, sub } = await getSpectatorIdentity()
      await submitPrediction(sessionCode, token, sub, type, value)
    } catch (err) {
      console.warn('Backend API unreachable, recorded prediction locally:', err)
    }
  }, [getSpectatorIdentity, sessionCode])

  const handlePurchase = useCallback(async (eventType: string) => {
    try {
      const { token, sub } = await getSpectatorIdentity()
      const result = await purchaseBasicEvent(sessionCode, token, sub, eventType)
      setTokens(result.tokenBalance)
      return result.tokenBalance
    } catch (err) {
      console.warn('Backend API unreachable, deducting tokens locally:', err)
      const nextBalance = Math.max(0, tokens - 30)
      setTokens(nextBalance)
      return nextBalance
    }
  }, [getSpectatorIdentity, sessionCode, tokens])

  const handleVoteComplete = useCallback(async (selectedEventId: string | null, pred: string | null) => {
    if (selectedEventId) {
      try {
        const { token, sub } = await getSpectatorIdentity()
        await voteComplexEvent(sessionCode, token, sub, selectedEventId, currentRound)
      } catch (err) {
        console.warn('Backend API unreachable, recorded vote locally:', err)
      }
    }
    setUserPrediction(pred)
    setCurrentView('wheel')
  }, [getSpectatorIdentity, sessionCode, currentRound])

  const handleNextRound = useCallback(() => {
    if (currentRound < totalRounds) {
      setCurrentRound((prev) => prev + 1)
      setUserPrediction(null)
      setCurrentView('vote')
    } else {
      setCurrentView('end')
    }
  }, [currentRound, totalRounds])

  useEffect(() => {
    if (!sessionCode || (currentView !== 'vote' && currentView !== 'wheel')) return
    let active = true

    const pollSession = async () => {
      try {
        const { token } = await getSpectatorIdentity()
        const session = await getSession(sessionCode, token)
        if (!active) return

        if (session.status === 'ended') {
          setCurrentView('end')
          return
        }

        if (typeof session.currentRound === 'number' && session.currentRound > currentRound) {
          setCurrentRound(session.currentRound)
          setUserPrediction(null)
          setCurrentView('vote')
        }
      } catch {
        // Silently ignore polling network failures
      }
    }

    const interval = setInterval(pollSession, 2500)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [sessionCode, currentView, currentRound, getSpectatorIdentity])

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
          <AuthPanel key={currentView} onJoinSession={() => setCurrentView('join')} />
        </section>
      </main>

      {currentView === 'join' && (
        <JoinSessionView
          onJoin={handleJoin}
          onBack={() => setCurrentView('profile')}
        />
      )}

      {currentView === 'waiting' && (
        <WaitingForHostView
          sessionCode={sessionCode}
          spectatorName={spectatorName}
          tokens={tokens}
          onHostStart={() => setCurrentView('vote')}
          onLeaveSession={() => setCurrentView('join')}
          checkSessionStatus={handleCheckSessionStatus}
        />
      )}

      {currentView === 'vote' && (
        <ComplexVoteView
          key={`vote-${currentRound}`}
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
          key={`wheel-${currentRound}`}
          sessionCode={sessionCode}
          currentRound={currentRound}
          totalRounds={totalRounds}
          tokens={tokens}
          userPrediction={userPrediction}
          spectatorName={spectatorName}
          onAddTokens={(amount) => setTokens((prev) => prev + amount)}
          onSetTokens={(amount) => setTokens(amount)}
          onCorrectPrediction={() => setCorrectPredictions((prev) => prev + 1)}
          onBackToVote={() => setCurrentView('vote')}
          onNextRound={handleNextRound}
          onEndSession={(endTokens) => {
            setTokens(endTokens)
            setCurrentView('end')
          }}
          onTriggerEvent={handlePurchase}
        />
      )}

      {currentView === 'end' && (
        <SessionEndView
          sessionCode={sessionCode}
          correctPredictions={correctPredictions}
          totalRounds={totalRounds}
          finalTokens={tokens}
          onBackToDashboard={() => setCurrentView('profile')}
          onJoinNewSession={() => {
            setTokens(50)
            setUserPrediction(null)
            setCorrectPredictions(0)
            setCurrentView('join')
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
        audience: apiAudience,
      }}
    >
      <SpectatorApp />
    </Auth0Provider>
  )
}

export default App
