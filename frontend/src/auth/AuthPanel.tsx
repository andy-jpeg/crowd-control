import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { profileService, type ProfileRecord, UsernameTakenError } from './profileService'
import tokenIcon from '../assets/token.png'

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

function isUsernameTaken(newUsername: string, currentUserId: string): boolean {
  const normalized = newUsername.trim().toLowerCase()
  if (!normalized) return false

  // Check all stored usernames in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('cc_username_')) {
      const ownerId = key.replace('cc_username_', '')
      if (ownerId !== currentUserId) {
        const stored = (localStorage.getItem(key) || '').trim().toLowerCase()
        if (stored === normalized) {
          return true
        }
      }
    }
  }

  try {
    const listRaw = localStorage.getItem('cc_all_usernames')
    if (listRaw) {
      const list: Array<{ username: string; ownerId: string }> = JSON.parse(listRaw)
      const match = list.find((item) => item.username.toLowerCase() === normalized)
      if (match && match.ownerId !== currentUserId) {
        return true
      }
    }
  } catch {
    // ignore
  }

  return false
}

function registerUsername(username: string, ownerId: string) {
  const normalized = username.trim()
  try {
    const listRaw = localStorage.getItem('cc_all_usernames')
    const list: Array<{ username: string; ownerId: string }> = listRaw ? JSON.parse(listRaw) : []
    const filtered = list.filter(
      (item) => item.ownerId !== ownerId && item.username.toLowerCase() !== normalized.toLowerCase()
    )
    filtered.push({ username: normalized, ownerId })
    localStorage.setItem('cc_all_usernames', JSON.stringify(filtered))
  } catch {
    // ignore
  }
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

    const storedUsername =
      localStorage.getItem(`cc_username_${auth0UserId}`) ||
      (user?.email ? localStorage.getItem(`cc_username_${user.email}`) : null)

    getAccessTokenSilently({
      authorizationParams: { audience: apiAudience },
    })
      .then((token) => profileService.getProfile(auth0UserId, requireAccessToken(token)))
      .then((nextProfile) => {
        if (!cancelled) {
          if (nextProfile && nextProfile.username) {
            setProfile(nextProfile)
            localStorage.setItem(`cc_username_${auth0UserId}`, nextProfile.username)
            if (user?.email) localStorage.setItem(`cc_username_${user.email}`, nextProfile.username)
            registerUsername(nextProfile.username, auth0UserId)
          } else if (storedUsername) {
            // Found existing stored username for this Google account!
            setProfile({
              auth0UserId,
              username: storedUsername,
              totalSessionsJoined: 0,
              totalTokensSpent: 0,
              createdAt: new Date().toISOString(),
            })
          } else {
            // New spectator needs to choose a unique username
            setProfile(null)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (storedUsername) {
            setProfile({
              auth0UserId,
              username: storedUsername,
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

  const handleSignup = () => {
    loginWithRedirect({
      authorizationParams: {
        screen_hint: 'signup',
        audience: apiAudience,
      },
    })
  }

  const handleLogin = () => {
    loginWithRedirect({
      authorizationParams: {
        prompt: 'login',
        audience: apiAudience,
      },
    })
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

    const cleanUsername = usernameInput.trim()

    // Verify username is unique and not already taken by another spectator
    if (isUsernameTaken(cleanUsername, auth0UserId)) {
      setSaveError('That username is already taken! Please choose another.')
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
      const nextProfile = await profileService.saveUsername(auth0UserId, cleanUsername, token)
      setProfile(nextProfile)
      localStorage.setItem(`cc_username_${auth0UserId}`, nextProfile.username ?? cleanUsername)
      if (user?.email) localStorage.setItem(`cc_username_${user.email}`, nextProfile.username ?? cleanUsername)
      registerUsername(nextProfile.username ?? cleanUsername, auth0UserId)
      setUsernameInput('')
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        setSaveError(error.message)
      } else {
        // Fallback: save username locally for this account
        localStorage.setItem(`cc_username_${auth0UserId}`, cleanUsername)
        if (user?.email) localStorage.setItem(`cc_username_${user.email}`, cleanUsername)
        registerUsername(cleanUsername, auth0UserId)
        setProfile({
          auth0UserId,
          username: cleanUsername,
          totalSessionsJoined: 0,
          totalTokensSpent: 0,
          createdAt: new Date().toISOString(),
        })
        setUsernameInput('')
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
          <button type="button" onClick={handleSignup}>Sign Up</button>
          <button type="button" className="secondary" onClick={handleLogin}>Log In</button>
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
          <strong className="stat-value stat-value-tokens">
            <img src={tokenIcon} className="stat-token-icon" alt="" />
            {profile?.totalTokensSpent ?? 0}
          </strong>
        </div>
      </div>

      <div className="auth-actions auth-stack">
        <button type="button" onClick={() => onJoinSession?.()}>Join Session</button>
        <button type="button" className="secondary" onClick={handleLogout}>Log out</button>
      </div>
    </div>
  )
}
