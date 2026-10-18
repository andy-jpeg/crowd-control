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
  initialTokens?: number
  onTriggerEvent?: (eventId: string) => void
  onBackToVote?: () => void
}

export function BasicEventWheelView({
  sessionCode = 'KWPZ',
  currentRound = 1,
  totalRounds = 5,
  initialTokens = 50,
  onTriggerEvent,
  onBackToVote,
}: BasicEventWheelViewProps) {
  // Center selection index in the wheel (defaults to center event index 3: Banana Peels)
  const [selectedIndex, setSelectedIndex] = useState(3)

  // 2-minute round timer (120 seconds)
  const [secondsRemaining, setSecondsRemaining] = useState(120)

  // Token balance
  const [tokens, setTokens] = useState(initialTokens)

  // Cooldown tracker for duration events (10 seconds)
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({})

  // Trigger feedback toast
  const [triggerFeedback, setTriggerFeedback] = useState<string | null>(null)

  // Touch gesture tracking for wheel swipe
  const touchStartY = useRef<number | null>(null)
  const isDragging = useRef(false)

  // Floating token gain animation state: { id, amount }
  const [tokenGain, setTokenGain] = useState<{ id: number; amount: number } | null>(null)
  const prevTokensRef = useRef(tokens)

  // Trigger floating gain popup whenever tokens increase
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

  // Periodic +30 token reward every 30 seconds during round (at 90s, 60s, 30s)
  useEffect(() => {
    if (secondsRemaining > 0 && secondsRemaining < 120 && secondsRemaining % 30 === 0) {
      setTokens((prev) => prev + 30)
    }
  }, [secondsRemaining])

  // Round timer countdown (2:00 -> 0:00)
  useEffect(() => {
    if (secondsRemaining <= 0) return
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [secondsRemaining])

  // Cooldown countdown for duration events
  useEffect(() => {
    const timer = setInterval(() => {
      setCooldowns((prev) => {
        const next: Record<string, number> = {}
        for (const [key, val] of Object.entries(prev)) {
          if (val > 1) {
            next[key] = val - 1
          }
        }
        return next
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Format mm:ss
  const minutes = Math.floor(secondsRemaining / 60)
  const seconds = secondsRemaining % 60
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`

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
  const handleSpokeClick = (index: number) => {
    if (index !== selectedIndex) {
      // Tap any spoke on the wheel -> rotates it into the fixed middle slot!
      setSelectedIndex(index)
      return
    }

    // Tap the center/selected spoke -> trigger the event!
    const currentEvent = BASIC_EVENTS[selectedIndex]

    // Check cooldown for duration events
    if (currentEvent.type === 'duration' && (cooldowns[currentEvent.id] ?? 0) > 0) {
      return
    }

    // Deduct tokens
    setTokens((prev) => Math.max(0, prev - currentEvent.cost))

    // Set 10s cooldown for duration events
    if (currentEvent.type === 'duration') {
      setCooldowns((prev) => ({ ...prev, [currentEvent.id]: 10 }))
    }

    // Visual feedback animation
    setTriggerFeedback(currentEvent.name)
    setTimeout(() => setTriggerFeedback(null), 1200)

    if (onTriggerEvent) {
      onTriggerEvent(currentEvent.id)
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
          {sessionCode ? `• ${sessionCode}` : ''}
        </span>
      </header>

      {/* Sub-header info: Timer & Tokens */}
      <div className="basic-sub-header">
        <div className="basic-timer-group">
          <span className="basic-timer">{formattedTime}</span>
          <span className="basic-round-label">
            Round {currentRound}/{totalRounds}
          </span>
        </div>

        <div className="basic-token-group">
          <div className="basic-token-badge" />
          <span className={`basic-token-count ${tokenGain ? 'pulse' : ''}`}>{tokens}</span>

          {/* Floating Gain Animation: + [O] 30 */}
          {tokenGain && (
            <div key={tokenGain.id} className="token-gain-popup">
              <span className="token-gain-plus">+</span>
              <div className="token-gain-mini-badge" />
              <span className="token-gain-amount">{tokenGain.amount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Wheel Area */}
      <div className="wheel-stage">
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

            // Distance-based sizing requested by user:
            // - Highlighted: large
            // - 1 away: medium
            // - 2 away: smaller than medium
            // - 3+ away: small
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
                disabled={isSelected && onCooldown}
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
        {triggerFeedback ? (
          <div className="trigger-toast">{triggerFeedback} Triggered!</div>
        ) : (
          <p className="wheel-instruction">
            Scroll or swipe wheel • Tap center to trigger
          </p>
        )}

        {/* Demo buttons to test token reward animations */}
        <div className="token-demo-controls">
          <button
            type="button"
            className="demo-gain-btn"
            onClick={() => setTokens((prev) => prev + 30)}
          >
            +30 Tokens (Demo)
          </button>
          <button
            type="button"
            className="demo-gain-btn"
            onClick={() => setTokens((prev) => prev + 50)}
          >
            +50 Tokens (Demo)
          </button>
        </div>

        {onBackToVote && (
          <button type="button" className="dev-nav-btn" onClick={onBackToVote}>
            ← Back to 15s Vote Screen
          </button>
        )}
      </div>
    </div>
  )
}
