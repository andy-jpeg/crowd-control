import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { profileService, type ProfileRecord, UsernameTakenError } from './profileService'

type OnboardingState = 'choice' | 'onboarding' | 'dashboard'

const usernameMinLength = 3
const usernameMaxLength = 24
const apiAudience = 'https://api.crowdcontrol'

function readAuth0Subject(subject: unknown): string | null {
  return typeof subject === 'string' && subject.length > 0 ? subject : null
}

function requireAccessToken(token: string | undefined): string {
  if (!token) {
    throw new Error('Unable to get an API access token. Please log in again.')
  }
  return token
}

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
    getAccessTokenSilently,
  } = useAuth0()

  const [usernameInput, setUsernameInput] = useState('')
  const [profile, setProfile] = useState<ProfileRecord | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)

  const activeUserId: string = readAuth0Subject(user?.sub) ?? ''

  useEffect(() => {
    if (!isAuthenticated || !activeUserId) {
      setProfile(null)
      return
    }
    const auth0UserId = activeUserId

    let cancelled = false

    setProfileLoading(true)
    setProfileError('')

    getAccessTokenSilently({
      authorizationParams: { audience: apiAudience },
    })
      .then((token) => profileService.getProfile(auth0UserId, requireAccessToken(token)))
      .then((nextProfile) => {
        if (!cancelled) {
          setProfile(nextProfile)
        }
      })
      .catch(() => {
        if (!cancelled) {
          const cachedName = localStorage.getItem(`cc_username_${auth0UserId}`)
          if (cachedName) {
            setProfile({
              auth0UserId,
              username: cachedName,
              totalSessionsJoined: 0,
              totalTokensSpent: 0,
              createdAt: new Date().toISOString(),
            })
          } else {
            setProfile(null)
          }
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
  }, [getAccessTokenSilently, isAuthenticated, activeUserId, user])

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
    const auth0UserId = activeUserId
    if (!auth0UserId) {
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
      const token = requireAccessToken(
        await getAccessTokenSilently({
          authorizationParams: { audience: apiAudience },
        })
      )
      const nextProfile = await profileService.saveUsername(auth0UserId, usernameInput.trim(), token)
      setProfile(nextProfile)
      setUsernameInput(nextProfile.username ?? '')
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        setSaveError(error.message)
      } else {
        // If the backend deployment is pending, save locally so spectator can enter dashboard
        const chosenUsername = usernameInput.trim()
        localStorage.setItem(`cc_username_${auth0UserId}`, chosenUsername)
        setProfile({
          auth0UserId,
          username: chosenUsername,
          totalSessionsJoined: 0,
          totalTokensSpent: 0,
          createdAt: new Date().toISOString(),
        })
      }
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
        <button
          type="button"
          className="secondary"
          style={{ marginTop: '0.75rem' }}
          onClick={() => {
            window.location.href = window.location.origin
          }}
        >
          Return to Login
        </button>
      </div>
    )
  }

  if (authMode === 'choice') {
    return (
      <div className="auth-card">
        <h2>Welcome to Crowd Control</h2>
        <p>Create an account or log in to keep your spectator profile and rewards.</p>



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
          <span className="stat-label">Total Sessions Joined</span>
          <strong className="stat-value">{profile?.totalSessionsJoined ?? 0}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Overall Tokens Spent</span>
          <strong className="stat-value">{profile?.totalTokensSpent ?? 0}</strong>
        </div>
      </div>

      <div className="auth-actions auth-stack">
        <button type="button" onClick={() => onJoinSession?.()}>Join Session</button>
        <button type="button" className="secondary" onClick={handleLogout}>Log out</button>
      </div>
    </div>
  )
}
