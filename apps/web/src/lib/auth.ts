export type LoginBeginResponse = {
  challengeId: string;
  expiresAt: number;
};

export type LoginVerifyResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    role: "owner" | "viewer";
  };
};

const ACCESS_TOKEN_KEY = "ccmt_access_token";
const REFRESH_TOKEN_KEY = "ccmt_refresh_token";

export function setAuthTokens(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearAuthTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function hasAccessToken(): boolean {
  return Boolean(getAccessToken());
}
