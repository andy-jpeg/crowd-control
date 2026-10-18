import { useEffect, useMemo, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { profileService, type ProfileRecord, UsernameTakenError } from './profileService'

type OnboardingState = 'choice' | 'onboarding' | 'dashboard'

const usernameMinLength = 3
const usernameMaxLength = 24

function validateUsername(value: string) {
  const trimmed = value.trim()

  if (trimmed.length < usernameMinLength) {
    return 'Username must be at least 3 characters.'
  }

  if (trimmed.length > usernameMaxLength) {
    return 'Username must be 24 characters or fewer.'
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return 'Only letters, numbers, underscores, and dashes are allowed.'
  }

  return ''
}

interface AuthPanelProps {
  onJoinSession?: () => void
}

export function AuthPanel({ onJoinSession }: AuthPanelProps = {}) {
  const {
    isLoading,
    isAuthenticated,
    user,
    error,
    loginWithRedirect,
    logout,
  } = useAuth0()

  const [usernameInput, setUsernameInput] = useState('')
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)

  const activeUserId = useMemo(() => user?.sub ?? null, [user?.sub])

  useEffect(() => {
    if (!isAuthenticated || !activeUserId) {
      setProfile(null)
      return
    }

    let cancelled = false

    setProfileLoading(true)
    setProfileError('')

    profileService
      .getProfile(activeUserId)
      .then((nextProfile) => {
        if (!cancelled) {
          setProfile(nextProfile)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfileError('Unable to load your profile right now. Please try again.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, activeUserId])

  const handleSignupEmail = () => {
    loginWithRedirect({
      authorizationParams: {
        screen_hint: 'signup',
      },
    })
  }

  const handleLoginEmail = () => {
    loginWithRedirect()
  }

  const handleLogout = () =>
    logout({
      logoutParams: {
        returnTo: window.location.origin,
      },
    })

  const handleUsernameSave = async () => {
    if (!activeUserId) {
      setSaveError('You must be authenticated before creating a username.')
      return
    }

    const validationError = validateUsername(usernameInput)
    if (validationError) {
      setSaveError(validationError)
      return
    }

    setSaveLoading(true)
    setSaveError('')

    try {
      const nextProfile = await profileService.saveUsername(activeUserId, usernameInput.trim())
      setProfile(nextProfile)
      setUsernameInput(nextProfile.username ?? '')
    } catch (error) {
      setSaveError(error instanceof UsernameTakenError
        ? error.message
        : 'Unable to save your username right now. Please try again.')
    } finally {
      setSaveLoading(false)
    }
  }

  const showOnboarding = isAuthenticated && !profileLoading && !profileError && (!profile || !profile.username)
  const showDashboard = isAuthenticated && !profileLoading && !profileError && profile !== null && !!profile.username
  const authMode: OnboardingState = !isAuthenticated ? 'choice' : showOnboarding ? 'onboarding' : showDashboard ? 'dashboard' : 'choice'

  if (isLoading || profileLoading) {
    return <div className="auth-card"><p>Loading…</p></div>
  }

  if (error) {
    return (
      <div className="auth-card auth-error">
        <p>Error: {error.message}</p>
      </div>
    )
  }

  if (authMode === 'choice') {
    return (
      <div className="auth-card">
        <h2>Welcome to Crowd Control</h2>
        <p>Create an account or log in to keep your spectator profile and rewards.</p>

        {profileError && (
          <div className="auth-error-block">
            <p className="auth-error-text">{profileError}</p>
            <button type="button" className="secondary" onClick={() => {
              if (activeUserId) {
                setProfileLoading(true)
                profileService.getProfile(activeUserId)
                  .then((nextProfile) => setProfile(nextProfile))
                  .catch(() => setProfileError('Unable to load your profile right now. Please try again.'))
                  .finally(() => setProfileLoading(false))
              }
            }}>
              Retry profile load
            </button>
          </div>
        )}

        <div className="auth-actions auth-stack">
          <button type="button" onClick={handleSignupEmail}>Sign Up</button>
          <button type="button" className="secondary" onClick={handleLoginEmail}>Log In</button>
        </div>
      </div>
    )
  }

  if (authMode === 'onboarding') {
    return (
      <div className="auth-card">
        <h2>Create your username</h2>
        <p>Choose a permanent spectator username before entering the dashboard.</p>

        <label className="auth-field" htmlFor="username">
          <span>Username</span>
          <input
            id="username"
            value={usernameInput}
            onChange={(event) => {
              setUsernameInput(event.target.value)
              setSaveError('')
            }}
            placeholder="Choose your username"
            maxLength={usernameMaxLength}
          />
        </label>

        {saveError && <p className="auth-error-text">{saveError}</p>}

        <div className="auth-actions">
          <button type="button" onClick={handleUsernameSave} disabled={saveLoading}>
            {saveLoading ? 'Saving…' : 'Save username'}
          </button>
        </div>

        
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2>Spectator Profile</h2>
      <p>
        Welcome back, <strong>@{profile?.username ?? user?.nickname ?? 'Spectator'}</strong>
      </p>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Session Joined</span>
          <strong className="stat-value">{profile?.totalSessionsJoined ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Overall Tokens Spent</span>
          <strong className="stat-value">{profile?.overallTokensSpent ?? 0}</strong>
        </div>
      </div>

      <div className="auth-actions auth-stack">
        <button type="button" onClick={() => onJoinSession?.()}>Join Session</button>
        <button type="button" className="secondary" onClick={handleLogout}>Log out</button>
      </div>
    </div>
  )
}
