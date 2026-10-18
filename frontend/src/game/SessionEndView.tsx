import './SessionEndView.css'
import logo from '../assets/CrowdControl.png'
import tokenIcon from '../assets/token.png'

export interface SessionEndViewProps {
  sessionCode: string
  correctPredictions: number
  totalRounds: number
  finalTokens?: number
  onBackToDashboard: () => void
  onJoinNewSession?: () => void
}

export function SessionEndView({
  sessionCode = 'KWPZ',
  correctPredictions = 3,
  totalRounds = 5,
  finalTokens = 310,
  onBackToDashboard,
  onJoinNewSession,
}: SessionEndViewProps) {
  const accuracyPct = Math.round((correctPredictions / Math.max(1, totalRounds)) * 100)

  return (
    <div className="end-container">
      {/* Top Header Bar */}
      <header className="end-topbar">
        <span className="end-app-title">
          <img className="end-app-logo" src={logo} alt="Crowd Control" />
          {sessionCode ? `• ${sessionCode}` : ''}
        </span>
      </header>

      <div className="end-content">
        <h1 className="end-title">Game Over!</h1>
        <p className="end-subtitle">Thank you for playing this session!</p>

        {/* Central Stat Card */}
        <div className="end-stats-card">
          <div className="end-stat-block">
            <span className="end-stat-label">Predictions Correct</span>
            <div className="end-stat-score">
              <span className="end-stat-number">{correctPredictions}</span>
              <span className="end-stat-total">/ {totalRounds}</span>
            </div>
            <span className="end-stat-badge">{accuracyPct}% Accuracy</span>
          </div>

          <div className="end-stat-divider" />

          <div className="end-stat-block">
            <span className="end-stat-label">Final Tokens Remaining</span>
            <div className="end-token-display">
              <img src={tokenIcon} className="basic-token-badge end-token-badge" alt="Tokens" />
              <span className="basic-token-count end-token-count">{finalTokens}</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="end-actions">
          {onJoinNewSession && (
            <button
              type="button"
              className="end-primary-btn"
              onClick={onJoinNewSession}
            >
              Join Another Session
            </button>
          )}

          <button
            type="button"
            className="end-dashboard-btn"
            onClick={onBackToDashboard}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
