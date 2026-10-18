import { useState } from 'react'
import './JoinSessionView.css'
import logo from '../assets/CrowdControl.png'

interface JoinSessionViewProps {
  onJoin: (sessionCode: string) => Promise<void> | void
  onBack?: () => void
}

export function JoinSessionView({ onJoin, onBack }: JoinSessionViewProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [backHovered, setBackHovered] = useState(false)
  const [isJoining, setIsJoining] = useState(false)

  const handleJoinSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (isJoining) return
    const trimmed = code.trim().toUpperCase()

    if (!trimmed) {
      setError('Please enter a session code.')
      return
    }

    if (trimmed.length !== 4) {
      setError('Session code must be 4 letters.')
      return
    }

    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(trimmed)) {
      setError('Use four valid session letters. The letters I and O are not used.')
      return
    }

    setError('')
    setIsJoining(true)
    try {
      await onJoin(trimmed)
    } catch (joinError) {
      setError(joinError instanceof Error
        ? joinError.message
        : 'Unable to join that session. Please try again.')
    } finally {
      setIsJoining(false)
    }
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
            disabled={isJoining}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              setError('')
            }}
          />
          <button type="submit" className="join-submit-btn" disabled={isJoining}>
            {isJoining ? 'Joining…' : 'Join'}
          </button>
        </form>

        {error && <p className="join-error-msg">{error}</p>}
      </div>
    </div>
  )
}
