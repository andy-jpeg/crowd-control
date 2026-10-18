import { ApiError, getSpectatorProfile, saveSpectatorUsername } from '../api/client'

export type ProfileRecord = {
  auth0UserId: string
  username: string | null
  totalSessionsJoined: number
  totalTokensSpent: number
  createdAt: string
}

export class UsernameTakenError extends Error {
  constructor() {
    super('That username is already taken!')
    this.name = 'UsernameTakenError'
  }
}

export interface ProfileService {
  getProfile(auth0UserId: string, token: string): Promise<ProfileRecord | null>
  saveUsername(auth0UserId: string, username: string, token: string): Promise<ProfileRecord>
}

class ApiProfileService implements ProfileService {
  getProfile(auth0UserId: string, token: string): Promise<ProfileRecord | null> {
    return getSpectatorProfile(token, auth0UserId)
  }

  async saveUsername(
    auth0UserId: string,
    username: string,
    token: string
  ): Promise<ProfileRecord> {
    try {
      return await saveSpectatorUsername(token, auth0UserId, username)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new UsernameTakenError()
      }
      throw error
    }
  }
}

export const profileService: ProfileService = new ApiProfileService()
