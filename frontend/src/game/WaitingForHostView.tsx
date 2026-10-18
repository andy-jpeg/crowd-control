import { useEffect, useState } from 'react'
import './WaitingForHostView.css'
import logo from '../assets/CrowdControl.png'
import tokenIcon from '../assets/token.png'

interface WaitingForHostViewProps {
  sessionCode: string
  spectatorName?: string
  tokens?: number
  onHostStart: () => void
  onLeaveSession?: () => void
  checkSessionStatus?: () => Promise<string | null>
}

export function WaitingForHostView({
  sessionCode,
  spectatorName = 'Spectator',
  tokens = 50,
  onHostStart,
  onLeaveSession,
  checkSessionStatus,
}: WaitingForHostViewProps) {
  const [exitHovered, setExitHovered] = useState(false)

  // Auto-poll the backend to detect when the Roblox host starts the game (state transitions from 'lobby' to 'intermission' or 'active')
  useEffect(() => {
    if (!checkSessionStatus) return

    let cancelled = false
    const interval = setInterval(async () => {
      if (cancelled) return
      try {
        const status = await checkSessionStatus()
        if (status && status !== 'lobby') {
          onHostStart()
        }
      } catch {
        // ignore background poll errors
      }
    }, 2500)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [checkSessionStatus, onHostStart])

  return (
    <div className="waiting-container">
      {/* Top action bar */}
      <div className="waiting-topbar">
        {onLeaveSession && (
          <button
            type="button"
            className="waiting-back-link"
            onMouseEnter={() => setExitHovered(true)}
            onMouseLeave={() => setExitHovered(false)}
            onClick={onLeaveSession}
          >
            <span className={`waiting-back-text ${exitHovered ? 'hovered' : ''}`}>
              ← Leave Session
            </span>
          </button>
        )}

        <div className="waiting-user-meta">
          <span>{spectatorName}</span>
          <span className="waiting-meta-badge">
            <img src={tokenIcon} className="waiting-meta-token-dot" alt="Tokens" />
            {tokens}
          </span>
        </div>
      </div>

      {/* Header with logo & session code */}
      <header className="waiting-header">
        <img className="waiting-brand-logo" src={logo} alt="Crowd Control" />
        <span className="waiting-session-pill">Session: {sessionCode}</span>
      </header>

      {/* Main waiting card in the middle of the screen */}
      <main className="waiting-content">
        <div className="waiting-card">
          <h2 className="waiting-title">Waiting for Host...</h2>

          <p className="waiting-subtitle">
            You are connected! The host will start the game soon.
          </p>

          <div className="waiting-dots-container" aria-label="Loading indicator">
            <span className="waiting-dot dot-1" />
            <span className="waiting-dot dot-2" />
            <span className="waiting-dot dot-3" />
          </div>
        </div>
      </main>
    </div>
  )
}
