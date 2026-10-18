import { useEffect, useRef, useState } from 'react'
import './BasicEventWheelView.css'
import logo from '../assets/CrowdControl.png'

export interface BasicEventItem {
  id: string
  name: string
  type: 'spammable' | 'duration'
  duration?: number
  cost: number
}

const BASIC_EVENTS: BasicEventItem[] = [
  { id: 'bombs', name: 'Bombs', type: 'spammable', cost: 30 },
  { id: 'spring_traps', name: 'Spring Traps', type: 'spammable', cost: 30 },
  { id: 'slime_puddles', name: 'Slime Puddles', type: 'spammable', cost: 30 },
  { id: 'banana_peels', name: 'Banana Peels', type: 'spammable', cost: 30 },
  { id: 'inverted_controls', name: 'Inverted Controls', type: 'duration', duration: 10, cost: 30 },
  { id: 'low_gravity', name: 'Low Gravity', type: 'duration', duration: 10, cost: 30 },
  { id: 'ink_screen', name: 'Squid Screen', type: 'duration', duration: 10, cost: 30 },
]

interface BasicEventWheelViewProps {
  sessionCode?: string
  currentRound?: number
  totalRounds?: number
  tokens: number
  userPrediction?: string | null
  spectatorName?: string
  onSetTokens?: (amount: number) => void
  onAddTokens?: (amount: number) => void // only used while the backend doesn't report rounds
  correctPredictions?: number // settled by the backend when a round's results come in
  onTriggerEvent: (eventId: string) => Promise<number>
  roundState?: string // from the game; leave undefined to use the local demo timer
  roundEndsAt?: number | null // when the current phase ends, in local milliseconds
  onBackToVote?: () => void
  onEndSession?: (finalTokens: number) => void
}

export function BasicEventWheelView({
  sessionCode = 'KWPZ',
  currentRound = 1,
  totalRounds = 5,
  tokens,
  userPrediction,
  spectatorName,
  onSetTokens,
  onAddTokens,
  correctPredictions = 0,
  onTriggerEvent,
  onBackToVote,
  onEndSession,
  roundState,
  roundEndsAt,
}: BasicEventWheelViewProps) {
  const isLive = roundState !== undefined
  const isRoundActive = !isLive || roundState === 'active'
  const [phaseSecondsLeft, setPhaseSecondsLeft] = useState(0)

  // Center selection index in the wheel (defaults to center event index 3: Banana Peels)
  const [selectedIndex, setSelectedIndex] = useState(3)

  // 2-minute round timer (120 seconds)
  const [secondsRemaining, setSecondsRemaining] = useState(120)

  // Cooldown tracker for duration events (10 seconds)
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})

  const [isPurchasing, setIsPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState('')
  const [triggerFeedback, setTriggerFeedback] = useState<string | null>(null)

  // "Not enough tokens!" Pop-up state
  const [notEnoughTokensPopup, setNotEnoughTokensPopup] = useState(false)
  const notEnoughTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track if prediction reward was already claimed this round
  const [predictionAwarded, setPredictionAwarded] = useState(false)

  // Touch gesture tracking for wheel swipe
  const touchStartY = useRef<number | null>(null)
  const isDragging = useRef(false)

  // Floating token gain animation state: { id, amount }
  const [tokenGain, setTokenGain] = useState<{ id: number; amount: number } | null>(null)
  const prevTokensRef = useRef(tokens)

  // Helper to show "Not enough tokens!" pop up for 2.5 seconds
  const showNotEnoughTokens = () => {
    setNotEnoughTokensPopup(true)
    if (notEnoughTimerRef.current) clearTimeout(notEnoughTimerRef.current)
    notEnoughTimerRef.current = setTimeout(() => {
      setNotEnoughTokensPopup(false)
    }, 2500)
  }

  // Trigger floating gain popup whenever tokens increase (+ [O] 30 or + [O] 50)
  useEffect(() => {
    if (tokens > prevTokensRef.current) {
      const amount = tokens - prevTokensRef.current
      setTokenGain({ id: Date.now(), amount })
      const timeout = setTimeout(() => setTokenGain(null), 1800)
      prevTokensRef.current = tokens
      return () => clearTimeout(timeout)
    }
    prevTokensRef.current = tokens
  }, [tokens])

  // Round (+30), every 30s of a round (+30) and correct prediction (+50) rewards are all paid by the backend.
  // The new balance arrives through the tokens prop, and the gain popup above shows the increase.

  // +30 every 30s of a round (at 1:30, 1:00 and 0:30 left). The updated backend pays these itself,
  // so they're only added here while it isn't reporting rounds (isLive is false)
  const awardedIntervalsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    awardedIntervalsRef.current = new Set()
  }, [currentRound])

  useEffect(() => {
    if (isLive) return
    if (secondsRemaining > 0 && secondsRemaining < 120 && secondsRemaining % 30 === 0 &&
        !awardedIntervalsRef.current.has(secondsRemaining)) {
      awardedIntervalsRef.current.add(secondsRemaining)
      onAddTokens?.(30)
    }
  }, [isLive, secondsRemaining, onAddTokens])

  // Show the win when the backend settles a correct prediction
  const seenPredictionsRef = useRef(correctPredictions)
  useEffect(() => {
    if (correctPredictions > seenPredictionsRef.current) {
      setPredictionAwarded(true)
      setTriggerFeedback('Prediction Correct! +50')
      const timer = setTimeout(() => setTriggerFeedback(null), 2500)
      seenPredictionsRef.current = correctPredictions
      return () => clearTimeout(timer)
    }
    seenPredictionsRef.current = correctPredictions
  }, [correctPredictions])


  // Round timer countdown (2:00 -> 0:00) when there's no game to follow
  useEffect(() => {
    if (isLive || secondsRemaining <= 0) return
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [isLive, secondsRemaining])

  // Follow the game's round: count down to its end time, and hold at 2:00 between rounds
  useEffect(() => {
    if (!isLive) return
    const update = () => {
      const left = roundEndsAt ? Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000)) : 0
      setPhaseSecondsLeft(left)
      setSecondsRemaining(roundState === 'active' ? Math.min(120, left) : 120)
    }
    update()
    const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [isLive, roundState, roundEndsAt])

  // Cooldown countdown for duration events (10s -> 0s)
  useEffect(() => {
    const timer = setInterval(() => {
      setCooldowns((prev) => {
        let hasActive = false
        const next: Record<string, number> = {}
        for (const [key, val] of Object.entries(prev)) {
          if (val > 1) {
            next[key] = val - 1
            hasActive = true
          }
        }
        return hasActive ? next : {}
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Format mm:ss
  const minutes = Math.floor(secondsRemaining / 60)
  const seconds = secondsRemaining % 60
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
  const phaseClock = `${Math.floor(phaseSecondsLeft / 60)}:${String(phaseSecondsLeft % 60).padStart(2, '0')}`
  const phaseLabel = isRoundActive ? null
    : roundState === 'intermission' ? `Next round in ${phaseClock}`
      : roundState === 'results' ? 'Round over'
        : roundState === 'sessionOver' || roundState === 'ended' ? 'Session over'
          : 'Waiting for host to start'

  // Wheel rotation functions - non-continuous bounded scrolling (stops at indices 0 and 6)
  const scrollUp = () => {
    setSelectedIndex((prev) => Math.max(0, prev - 1))
  }

  const scrollDown = () => {
    setSelectedIndex((prev) => Math.min(BASIC_EVENTS.length - 1, prev + 1))
  }

  // Handle Mouse Wheel
  const handleWheel = (e: React.WheelEvent) => {
    if (e.deltaY > 20) {
      scrollDown()
    } else if (e.deltaY < -20) {
      scrollUp()
    }
  }

  // Handle Touch Gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY
    isDragging.current = true
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || touchStartY.current === null) return
    const currentY = e.touches[0].clientY
    const deltaY = touchStartY.current - currentY

    if (deltaY > 35) {
      scrollDown()
      touchStartY.current = currentY
    } else if (deltaY < -35) {
      scrollUp()
      touchStartY.current = currentY
    }
  }

  const handleTouchEnd = () => {
    isDragging.current = false
    touchStartY.current = null
  }

  // Handle clicking on an event
  const handleSpokeClick = async (index: number) => {
    if (isPurchasing) return
    if (index !== selectedIndex) {
      // Tap any spoke on the wheel -> rotates it into the fixed middle slot!
      setSelectedIndex(index)
      return
    }

    // Tap the center/selected spoke -> trigger the event!
    const currentEvent = BASIC_EVENTS[selectedIndex]

    if (!isRoundActive) {
      setPurchaseError('Events can be sent once the round starts.')
      return
    }

    // Check if spectator has enough tokens!
    if (tokens < currentEvent.cost) {
      showNotEnoughTokens()
      return
    }

    // Check cooldown for duration events
    if (currentEvent.type === 'duration' && (cooldowns[currentEvent.id] ?? 0) > 0) {
      return
    }

    setPurchaseError('')
    setIsPurchasing(true)
    try {
      const nextBalance = await onTriggerEvent(currentEvent.id)
      if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {
        throw new Error('The server returned an invalid token balance.')
      }

      // Set 10s cooldown for duration events
      if (currentEvent.type === 'duration') {
        setCooldowns((prev) => ({ ...prev, [currentEvent.id]: 10 }))
      }

      setTriggerFeedback(currentEvent.name)
      setTimeout(() => setTriggerFeedback(null), 1200)
    } catch (error) {
      setPurchaseError(error instanceof Error
        ? error.message
        : 'Purchase could not be completed. Please try again.')
    } finally {
      setIsPurchasing(false)
    }
  }

  return (
    <div
      className="basic-page-container"
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top Header Bar */}
      <header className="basic-topbar">
        <span className="basic-app-title">
          <img className="basic-app-logo" src={logo} alt="Crowd Control" />
          {sessionCode ? ` • ${sessionCode}` : ''}
          {spectatorName ? ` • @${spectatorName}` : ''}
        </span>
      </header>

      {/* Sub-header info: Timer & Tokens */}
      <div className="basic-sub-header">
        <div className="basic-timer-group">
          {phaseLabel ? (
            <span className="basic-timer basic-timer-waiting">{phaseLabel}</span>
          ) : (
            <span className="basic-timer">{formattedTime}</span>
          )}
          <span className="basic-round-label">
            Round {currentRound}/{totalRounds}
          </span>
        </div>

        <div className="basic-token-group">
          <div className="basic-token-badge" />
          <span className={`basic-token-count ${tokenGain ? 'pulse' : ''}`}>{tokens}</span>

          {/* Floating Gain Animation: + [O] 30 or + [O] 50 */}
          {tokenGain && (
            <div key={tokenGain.id} className="token-gain-popup">
              <span className="token-gain-plus">+</span>
              <div className="token-gain-mini-badge" />
              <span className="token-gain-amount">{tokenGain.amount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Prediction indicator banner */}
      {userPrediction && (
        <div className="basic-prediction-banner">
          <span className="basic-prediction-pill">
            🎯 Predicted: <strong>{userPrediction}</strong>
          </span>
          {!predictionAwarded ? (
            <span className="prediction-claim-pill" title="Paid when the round's results come in">
              Pays +50 pts if right
            </span>
          ) : (
            <span className="prediction-won-pill">Won (+50 pts)</span>
          )}
        </div>
      )}

      {/* Main Wheel Area */}
      <div className={`wheel-stage ${isRoundActive ? '' : 'wheel-waiting'}`}>
        {/* The Circular Rim (Arc) - larger and empty */}
        <div className="wheel-arc" />

        {/* The Radial Spoke Buttons - Selected value always remains locked in the middle (0 deg) */}
        <div className="wheel-spokes-container">
          {BASIC_EVENTS.map((event, index) => {
            // Non-continuous offset relative to selectedIndex:
            const offset = index - selectedIndex

            // Selected item is always at offset 0 (fixed in the horizontal middle slot)
            const distance = Math.abs(offset)
            const isSelected = distance === 0
            const rotationDeg = offset * 17

            // Smoothly fade items if they scroll beyond the visible arc
            const opacity = distance > 3 ? Math.max(0, 1 - (distance - 3) * 0.75) : 1
            const pointerEvents = distance > 3 ? 'none' : 'auto'

            let sizeClass = 'size-small'
            if (distance === 0) {
              sizeClass = 'size-large selected'
            } else if (distance === 1) {
              sizeClass = 'size-medium'
            } else if (distance === 2) {
              sizeClass = 'size-smaller-medium'
            } else {
              sizeClass = 'size-small'
            }

            const cooldownTime = cooldowns[event.id] ?? 0
            const onCooldown = cooldownTime > 0

            return (
              <button
                key={event.id}
                type="button"
                disabled={isPurchasing || (isSelected && onCooldown)}
                className={`spoke-btn ${sizeClass} ${onCooldown ? 'cooldown' : ''}`}
                style={{
                  transform: `translateY(-50%) rotate(${rotationDeg}deg)`,
                  opacity,
                  pointerEvents,
                }}
                onClick={() => handleSpokeClick(index)}
              >
                <div className="spoke-content">
                  <span className="spoke-title">{event.name}</span>
                  {isSelected && onCooldown && (
                    <span className="spoke-cooldown-badge">⏳ {cooldownTime}s</span>
                  )}
                  {isSelected && !onCooldown && (
                    <span className="spoke-cost-badge">{event.cost} pts</span>
                  )}
                  {!isSelected && onCooldown && (
                    <span className="spoke-mini-cooldown">{cooldownTime}s</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Action Prompt / Trigger Toast */}
      <div className="wheel-footer">
        {purchaseError ? (
          <p className="wheel-error" role="alert">{purchaseError}</p>
        ) : triggerFeedback ? (
          <div className="trigger-toast">⚡ {triggerFeedback}</div>
        ) : isPurchasing ? (
          <p className="wheel-instruction" role="status">Processing purchase…</p>
        ) : (
          <p className="wheel-instruction">
            Scroll or swipe wheel • Tap center to trigger
          </p>
        )}

        {/* Demo / Test Controls */}
        <div className="wheel-demo-controls">
          <button
            type="button"
            className="dev-nav-btn dev-reset-btn"
            onClick={() => onSetTokens?.(0)}
          >
            ⚠️ Set Tokens to 0 (Test "Not enough tokens")
          </button>
        </div>

        {onBackToVote && (
          <button type="button" className="dev-nav-btn" onClick={onBackToVote}>
            ← Back to 15s Vote Screen
          </button>
        )}

        {onEndSession && (
          <button
            type="button"
            className="dev-nav-btn"
            style={{ marginTop: '0.35rem' }}
            onClick={() => onEndSession(tokens)}
          >
            Finish Session → (Demo Ending Screen)
          </button>
        )}
      </div>

      {/* "Not enough tokens!" Pop-up Modal */}
      {notEnoughTokensPopup && (
        <div
          className="not-enough-popup-overlay"
          onClick={() => setNotEnoughTokensPopup(false)}
          role="presentation"
        >
          <div
            className="not-enough-popup-dialog"
            role="alert"
            aria-live="assertive"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="not-enough-popup-icon">⚠️</div>
            <h3 className="not-enough-popup-title">Not enough tokens!</h3>
            <p className="not-enough-popup-message">
              You need 30 tokens to trigger this event. Earn more every 30 seconds or from your prediction!
            </p>
            <button
              type="button"
              className="not-enough-popup-btn"
              onClick={() => setNotEnoughTokensPopup(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
