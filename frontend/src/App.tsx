import { useCallback, useEffect, useState } from 'react'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import './App.css'
import { AuthPanel } from './auth/AuthPanel'
import {
  ApiError,
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

const ROUND_POLL_MS = 3000
const STARTED_STATES = new Set(['intermission', 'active', 'results']) // the game has left the lobby

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
  // The game's round, so the wheel's timer matches Roblox instead of counting on its own
  const [roundState, setRoundState] = useState<string | undefined>('lobby') // undefined: the backend doesn't report rounds
  const [roundEndsAt, setRoundEndsAt] = useState<number | null>(null)

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
      setRoundState('lobby')
      setRoundEndsAt(null)
      setCurrentView('waiting') // the waiting page moves on by itself once the host presses Start
    } catch (err) {
      console.warn('Join failed:', err)
      throw err // the join screen shows the message, so a wrong code or blocked request can't look like it worked
    }
  }, [getSpectatorIdentity, user])

  useEffect(() => {
    if (!sessionCode || (currentView !== 'waiting' && currentView !== 'vote' && currentView !== 'wheel')) return
    let cancelled = false

    const poll = async () => {
      try {
        const { token } = await getSpectatorIdentity()
        const info = await getSession(sessionCode, token)
        if (cancelled) return
        const clockOffset = Date.now() - info.serverTime * 1000
        setCurrentRound(info.currentRound)
        setTotalRounds(info.totalRounds)
        setRoundState(info.roundState) // an older backend doesn't send it, which puts the wheel back on its own timer
        setRoundEndsAt(info.endsAt === null ? null : info.endsAt * 1000 + clockOffset)
        if (typeof info.tokenBalance === 'number') setTokens(info.tokenBalance) // rewards are paid by the backend, so its balance is the real one
        if (typeof info.correctPredictions === 'number') setCorrectPredictions(info.correctPredictions) // an older backend leaves both out
        if (currentView === 'waiting' && (info.roundState === undefined || STARTED_STATES.has(info.roundState))) setCurrentView('vote') // the host pressed Start (or the backend can't tell us)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setRoundState('ended') // the game ended the session
          setCurrentView('end')
        }
      }
    }

    poll()
    const timer = setInterval(poll, ROUND_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [sessionCode, currentView, getSpectatorIdentity])

  const handleVoteEvent = useCallback(async (eventId: string) => {
    try {
      const { token, sub } = await getSpectatorIdentity()
      await voteComplexEvent(sessionCode, token, sub, eventId)
    } catch (err) {
      console.warn('Backend API unreachable, recorded vote locally:', err)
    }
  }, [getSpectatorIdentity, sessionCode])

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
      console.warn('Purchase failed:', err)
      throw err // the wheel shows the message instead of pretending the event was sent
    }
  }, [getSpectatorIdentity, sessionCode])

  const handleVoteComplete = useCallback((_selectedEventId: string | null, pred: string | null) => {
    setUserPrediction(pred)
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
          userPrediction={userPrediction}
          spectatorName={spectatorName}
          roundState={roundState}
          roundEndsAt={roundEndsAt}
          correctPredictions={correctPredictions}
          onSetTokens={(amount) => setTokens(amount)}
          onAddTokens={(amount) => setTokens((prev) => prev + amount)}
          onBackToVote={() => setCurrentView('vote')}
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
