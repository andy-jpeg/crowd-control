import { useState } from 'react'
import './JoinSessionView.css'
import logo from '../assets/CrowdControl.png'

interface JoinSessionViewProps {
  onJoin: (sessionCode: string) => void
  onBack?: () => void
}

export function JoinSessionView({ onJoin, onBack }: JoinSessionViewProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [backHovered, setBackHovered] = useState(false)

  const handleJoinSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = code.trim().toUpperCase()

    if (!trimmed) {
      setError('Please enter a session code.')
      return
    }

    if (trimmed.length !== 4) {
      setError('Session code must be 4 letters.')
      return
    }

    if (!/^[A-Z]{4}$/.test(trimmed)) {
      setError('Only letters are allowed.')
      return
    }

    setError('')
    onJoin(trimmed)
  }

  return (
    <div className="join-container">
      {onBack && (
        <button
          type="button"
          className="join-back-link"
          onMouseEnter={() => setBackHovered(true)}
          onMouseLeave={() => setBackHovered(false)}
          onClick={onBack}
        >
          <span className={`join-back-text ${backHovered ? 'hovered' : ''}`}>
            ← Back to Profile
          </span>
        </button>
      )}

      <div className="join-content">
        <h1 className="join-brand-title">
          <img className="join-brand-logo" src={logo} alt="Crowd Control" />
        </h1>

        <form className="join-box" onSubmit={handleJoinSubmit}>
          <input
            type="text"
            className="join-code-input"
            placeholder="Code"
            maxLength={4}
            value={code}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setError('')
            }}
          />
          <button type="submit" className="join-submit-btn">
            Join
          </button>
        </form>

        {error && <p className="join-error-msg">{error}</p>}
      </div>
    </div>
  )
}
