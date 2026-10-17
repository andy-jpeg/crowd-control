import { useEffect, useState } from 'react'
import './ComplexVoteView.css'

export interface PlayerInfo {
  id: string
  name: string
}

interface ComplexVoteViewProps {
  sessionCode: string
  players?: PlayerInfo[]
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
]

export const TIME_INTERVALS = [
  '0:00 - 0:30',
  '0:30 - 1:00',
  '1:00 - 1:30',
  '1:30 - 2:00',
] as const

const DEFAULT_SINGLE_PLAYER: PlayerInfo[] = [{ id: 'p1', name: 'Player 1' }]
const DEFAULT_MULTI_PLAYERS: PlayerInfo[] = [
  { id: 'p1', name: 'Player 1' },
  { id: 'p2', name: 'Player 2' },
  { id: 'p3', name: 'Player 3' },
]

export function ComplexVoteView({
  sessionCode,
  players,
  onVoteComplete,
  onLeaveSession,
}: ComplexVoteViewProps) {
  const [secondsLeft, setSecondsLeft] = useState(15)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [prediction, setPrediction] = useState<string>('')
  const [isLocked, setIsLocked] = useState(false)

  // Demo toggle for testing 1 player vs multiple players
  const [demoMultiPlayer, setDemoMultiPlayer] = useState(false)

  const activePlayers = players && players.length > 0
    ? players
    : (demoMultiPlayer ? DEFAULT_MULTI_PLAYERS : DEFAULT_SINGLE_PLAYER)

  const isSinglePlayer = activePlayers.length === 1

  // 15-second countdown timer
  useEffect(() => {
    if (secondsLeft <= 0) {
      setIsLocked(true)
      if (onVoteComplete) {
        onVoteComplete(selectedEventId, prediction || null)
      }
      return
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => prev - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [secondsLeft, selectedEventId, prediction, onVoteComplete])

  const formattedTime = `0:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`

  const handleVote = (id: string) => {
    if (isLocked) return
    setSelectedEventId(id)
  }

  return (
    <div className="vote-container">
      {onLeaveSession && (
        <button type="button" className="vote-back-link" onClick={onLeaveSession}>
          ← Exit Session ({sessionCode})
        </button>
      )}

      <header className="vote-header">
        <h1 className="vote-brand-title">Crowd Control</h1>
        <div className="vote-status-bar">
          <span className="vote-timer">{formattedTime}</span>
          <div className="vote-circle-badge" title="Session active" />
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
                  disabled={isLocked}
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
                onChange={(e) => setPrediction(e.target.value)}
                disabled={isLocked}
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
                    onClick={() => !isLocked && setPrediction(player.id)}
                    disabled={isLocked}
                  >
                    <span>{player.name}</span>
                    {isSelected && <span className="vote-checkmark">✓</span>}
                  </button>
                )
              })}
            </div>
          )}

          <p className="prediction-reward-note">
            🎯 Correct guess awards <strong>+50 tokens</strong> at round end!
          </p>
        </section>
      </main>

      {/* Developer preview toggle for testing & Proceed button */}
      <footer className="vote-footer">
        <button
          type="button"
          className="proceed-round-btn"
          onClick={() => onVoteComplete?.(selectedEventId, prediction || null)}
        >
          Start Round (Go to Wheel) →
        </button>

        <button
          type="button"
          className="demo-toggle-btn"
          onClick={() => {
            setDemoMultiPlayer((prev) => !prev)
            setPrediction('')
          }}
        >
          Toggle Preview: {isSinglePlayer ? '1 Player (Dropdown)' : '3 Players (Choice)'}
        </button>
      </footer>
    </div>
  )
}
