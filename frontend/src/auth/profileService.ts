export type ProfileRecord = {
  auth0UserId: string
  username: string | null
  email: string | null
  provider: 'auth0-email-password' | 'google-oauth2' | 'unknown'
  totalSessionsJoined?: number
  overallTokensSpent?: number
  createdAt: string
  updatedAt: string
}

export class UsernameTakenError extends Error {
  constructor() {
    super('That username is already taken!')
    this.name = 'UsernameTakenError'
  }
}

export interface ProfileService {
  getProfile(auth0UserId: string): Promise<ProfileRecord | null>
  saveUsername(auth0UserId: string, username: string): Promise<ProfileRecord>
}

export const PROFILE_API_REQUIRED = {
  get: 'GET /api/profile/me -> returns { auth0UserId, username, email, provider, createdAt, updatedAt }',
  saveUsername: 'PATCH /api/profile/me/username -> accepts { username } and returns the updated profile',
  identity: 'Use Auth0 user.sub as the stable user ID, never the email address',
  note: 'This development mock is intentionally replaceable and does not count as production persistence.',
} as const

class DevelopmentProfileService implements ProfileService {
  private readonly storageKey = 'crowd-control-dev-profile-mock'

  private readAll(): Record<string, ProfileRecord> {
    if (typeof window === 'undefined') {
      return {}
    }

    const raw = window.localStorage.getItem(this.storageKey)

    if (!raw) {
      return {}
    }

    try {
      return JSON.parse(raw) as Record<string, ProfileRecord>
    } catch {
      return {}
    }
  }

  private writeAll(data: Record<string, ProfileRecord>) {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(this.storageKey, JSON.stringify(data))
  }

  async getProfile(auth0UserId: string): Promise<ProfileRecord | null> {
    const profiles = this.readAll()
    return profiles[auth0UserId] ?? null
  }

  async saveUsername(auth0UserId: string, username: string): Promise<ProfileRecord> {
    const profiles = this.readAll()
    const existing = profiles[auth0UserId]
    const normalizedUsername = username.toLowerCase()
    const usernameTaken = Object.values(profiles).some(
      (profile) => profile.auth0UserId !== auth0UserId && profile.username?.toLowerCase() === normalizedUsername,
    )

    if (usernameTaken) {
      throw new UsernameTakenError()
    }

    const now = new Date().toISOString()

    const nextProfile: ProfileRecord = {
      auth0UserId,
      username,
      email: existing?.email ?? null,
      provider: existing?.provider ?? 'unknown',
      totalSessionsJoined: existing?.totalSessionsJoined ?? 0,
      overallTokensSpent: existing?.overallTokensSpent ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    profiles[auth0UserId] = nextProfile
    this.writeAll(profiles)

    return nextProfile
  }
}

export const profileService: ProfileService = new DevelopmentProfileService()
