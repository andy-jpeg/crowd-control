const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "https://api.survivalofthe.fit")
  .replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;

  constructor(
    message: string,
    status: number
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface SpectatorProfile {
  auth0UserId: string;
  username: string;
  totalSessionsJoined: number;
  totalTokensSpent: number;
  createdAt: string;
}

export interface JoinedSession {
  sessionId: string | number;
  tokenBalance: number;
  username: string;
  currentRound: number;
  totalRounds: number;
}

export interface SessionInfo {
  sessionId: string | number;
  currentRound: number;
  totalRounds: number;
  status: string;
  roundState: string; // lobby, intermission, active, results, or sessionOver, as reported by the game
  endsAt: number | null; // Unix seconds on the server's clock
  serverTime: number; // the server's clock when it answered, to correct for a phone clock that's off
  tokenBalance: number | null; // includes watch rewards the backend just paid; null if not joined
  correctPredictions: number | null;
}

export interface PurchaseResult {
  ok: true;
  eventType: string;
  tokenBalance: number;
}

export function getSession(
  code: string,
  token: string
): Promise<SessionInfo> {
  return request<SessionInfo>(
    `/api/sessions/${encodeURIComponent(code)}`,
    token,
    undefined,
    "GET"
  );
}

type Auth0User = {
  sub: string;
  nickname?: string;
};

async function request<T>(
  path: string,
  token: string,
  body?: Record<string, unknown>,
  method: "GET" | "POST" | "PATCH" = "POST"
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new ApiError("Could not reach Crowd Control. Check your connection and try again.", 0);
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiMessage = typeof result === "object" && result !== null &&
      "error" in result && typeof result.error === "string"
      ? result.error
      : "";
    const message = response.status === 401
      ? "Your login has expired. Please log in again."
      : response.status === 404
        ? "That session could not be found. Check the code and try again."
        : apiMessage || "The request could not be completed. Please try again.";
    throw new ApiError(message, response.status);
  }
  return result as T;
}

export function joinSession(
  code: string,
  token: string,
  user: Auth0User
): Promise<JoinedSession> {
  const nickname = user.nickname?.trim();
  const username = nickname && /^[\p{L}\p{N}_-]{1,32}$/u.test(nickname)
    ? nickname
    : undefined;
  return request<JoinedSession>(
    `/api/sessions/${encodeURIComponent(code)}/join`,
    token,
    { auth0UserId: user.sub, ...(username ? { username } : {}) }
  );
}

export async function getSpectatorProfile(
  token: string,
  sub: string
): Promise<SpectatorProfile | null> {
  try {
    return await request<SpectatorProfile>(
      `/api/profile/me?auth0UserId=${encodeURIComponent(sub)}`,
      token,
      undefined,
      "GET"
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function saveSpectatorUsername(
  token: string,
  sub: string,
  username: string
): Promise<SpectatorProfile> {
  return request<SpectatorProfile>(
    "/api/profile/me/username",
    token,
    { auth0UserId: sub, username },
    "PATCH"
  );
}

export function voteComplexEvent(
  code: string,
  token: string,
  sub: string,
  eventId: string
): Promise<{ ok: true; eventId: string }> {
  return request<{ ok: true; eventId: string }>(
    `/api/sessions/${encodeURIComponent(code)}/vote`,
    token,
    { auth0UserId: sub, eventId }
  );
}

export function submitPrediction(
  code: string,
  token: string,
  sub: string,
  type: "time_bracket" | "player",
  value: string
): Promise<{ ok: true; prediction: { type: string; value: string } }> {
  return request<{ ok: true; prediction: { type: string; value: string } }>(
    `/api/sessions/${encodeURIComponent(code)}/predict`,
    token,
    { auth0UserId: sub, type, value }
  );
}

export function purchaseBasicEvent(
  code: string,
  token: string,
  sub: string,
  eventType: string
): Promise<PurchaseResult> {
  return request<PurchaseResult>(
    `/api/sessions/${encodeURIComponent(code)}/purchase`,
    token,
    { auth0UserId: sub, eventType }
  );
}
