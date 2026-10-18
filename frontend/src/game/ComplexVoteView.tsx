import { useEffect, useRef, useState } from 'react'
import './ComplexVoteView.css'
import logo from '../assets/CrowdControl.png'

export interface PlayerInfo {
  id: string
  name: string
}

interface ComplexVoteViewProps {
  sessionCode: string
  currentRound?: number
  totalRounds?: number
  players?: PlayerInfo[]
  onVoteEvent?: (eventId: string) => Promise<void>
  onSubmitPrediction?: (type: 'time_bracket' | 'player', value: string) => Promise<void>
  onVoteComplete?: (selectedEventId: string | null, prediction: string | null) => void
  onLeaveSession?: () => void
}

interface ComplexEventOption {
  id: string
  name: string
}

const COMPLEX_EVENTS: ComplexEventOption[] = [
  { id: 'giant_boulder', name: 'Giant Boulder' },
  { id: 'tsunami', name: 'Tsunami' },
  { id: 'shrinking_podium', name: 'Shrinking Podium' },
  { id: 'floor_is_lava', name: 'Floor Is Lava' },
  { id: 'tornado', name: 'Tornado' },
  { id: 'flood_escape', name: 'Flood Escape' },
  { id: 'blob_fight', name: 'Blob Fight' },
]

export const TIME_INTERVALS = [
  '0:00 - 0:30',
  '0:30 - 1:00',
  '1:00 - 1:30',
  '1:30 - 2:00',
] as const

const DEFAULT_SINGLE_PLAYER: PlayerInfo[] = [{ id: 'p1', name: 'Player 1' }]
export function ComplexVoteView({
  sessionCode,
  currentRound = 1,
  totalRounds = 5,
  players,
  onVoteEvent,
  onSubmitPrediction,
  onVoteComplete,
  onLeaveSession,
}: ComplexVoteViewProps) {
  const [secondsLeft, setSecondsLeft] = useState(15)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [prediction, setPrediction] = useState<string>('')
  const [isLocked, setIsLocked] = useState(false)
  const [exitHovered, setExitHovered] = useState(false)
  const [pendingWrites, setPendingWrites] = useState(0)
  const [actionError, setActionError] = useState('')
  const completedRef = useRef(false)

  const activePlayers = players && players.length > 0
    ? players
    : DEFAULT_SINGLE_PLAYER

  const isSinglePlayer = activePlayers.length === 1

  useEffect(() => {
    if (secondsLeft <= 0) return

    const timer = setInterval(() => {
      setSecondsLeft((prev) => prev - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [secondsLeft])

  useEffect(() => {
    if (secondsLeft > 0) return
    setIsLocked(true)
    if (pendingWrites === 0 && !completedRef.current) {
      completedRef.current = true
      onVoteComplete?.(selectedEventId, prediction || null)
    }
  }, [secondsLeft, pendingWrites, selectedEventId, prediction, onVoteComplete])

  const formattedTime = `0:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`

  const handleVote = async (id: string) => {
    if (isLocked || pendingWrites > 0 || !onVoteEvent) return
    setSelectedEventId(id)
    setActionError('')
    setPendingWrites((count) => count + 1)
    try {
      await onVoteEvent(id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Vote could not be saved. Try again.')
    } finally {
      setPendingWrites((count) => Math.max(0, count - 1))
    }
  }

  const handlePrediction = async (type: 'time_bracket' | 'player', value: string) => {
    if (isLocked || pendingWrites > 0 || !onSubmitPrediction) return
    setPrediction(value)
    setActionError('')
    setPendingWrites((count) => count + 1)
    try {
      await onSubmitPrediction(type, value)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Prediction could not be saved. Try again.')
    } finally {
      setPendingWrites((count) => Math.max(0, count - 1))
    }
  }

  return (
    <div className="vote-container">
      {onLeaveSession && (
        <button
          type="button"
          className="vote-back-link"
          onMouseEnter={() => setExitHovered(true)}
          onMouseLeave={() => setExitHovered(false)}
          onClick={onLeaveSession}
        >
          <span className={`vote-back-text ${exitHovered ? 'hovered' : ''}`}>
            ← Exit Session ({sessionCode})
          </span>
        </button>
      )}

      <header className="vote-header">
        <div>
          <h1 className="vote-brand-title">
            <img className="vote-brand-logo" src={logo} alt="Crowd Control" />
          </h1>
          <span className="vote-round-badge">Round {currentRound} of {totalRounds}</span>
        </div>
        <div className="vote-status-bar">
          <span className="vote-timer">{formattedTime}</span>
        </div>
      </header>

      <main className="vote-content">
        {/* Section 1: Complex Event Voting */}
        <section className="vote-section">
          <p className="vote-section-label">
            {isLocked
              ? 'Voting closed! Starting round...'
              : 'Vote for a Complex Event:'}
          </p>

          <div className="vote-grid">
            {COMPLEX_EVENTS.map((event) => {
              const isSelected = selectedEventId === event.id
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`vote-card-btn ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleVote(event.id)}
                  disabled={isLocked || pendingWrites > 0}
                >
                  <span className="vote-card-text">{event.name}</span>
                  {isSelected && <span className="vote-checkmark">✓</span>}
                </button>
              )
            })}
          </div>
        </section>

        {/* Section 2: Survival Prediction */}
        <section className="vote-section prediction-section">
          <p className="vote-section-label">
            {isSinglePlayer
              ? `Predict: How long will ${activePlayers[0]?.name ?? 'the player'} survive?`
              : 'Predict: Who will survive the longest?'}
          </p>

          {isSinglePlayer ? (
            /* 1 Player: Dropdown of intervals */
            <div className="prediction-dropdown-wrapper">
              <select
                className="prediction-select"
                value={prediction}
                onChange={(e) => {
                  if (e.target.value) void handlePrediction('time_bracket', e.target.value)
                  else setPrediction('')
                }}
                disabled={isLocked || pendingWrites > 0}
              >
                <option value="">Select interval...</option>
                {TIME_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {interval}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* More than 1 Player: Guess which player survives longest */
            <div className="prediction-players-grid">
              {activePlayers.map((player) => {
                const isSelected = prediction === player.id
                return (
                  <button
                    key={player.id}
                    type="button"
                    className={`player-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => void handlePrediction('player', player.id)}
                    disabled={isLocked || pendingWrites > 0}
                  >
                    <span>{player.name}</span>
                    {isSelected && <span className="vote-checkmark">✓</span>}
                  </button>
                )
              })}
            </div>
          )}

          <p className="prediction-reward-note">
            Correct guess awards <strong>+50 tokens</strong> at round end!
          </p>
          {actionError && <p className="vote-api-error" role="alert">{actionError}</p>}
          {pendingWrites > 0 && <p className="vote-api-status" role="status">Saving your choice…</p>}
        </section>
      </main>

      <footer className="vote-footer">
        <p className="vote-api-status" role="status">
          {secondsLeft > 0
            ? 'Your vote and prediction can be changed until the timer ends.'
            : 'Voting closed. Starting the round…'}
        </p>
      </footer>
    </div>
  )
}
