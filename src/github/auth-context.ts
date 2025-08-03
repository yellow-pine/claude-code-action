/**
 * Authentication context that unifies token source information
 */

export const TokenSource = {
  OIDC: "oidc", // Token from OIDC exchange - check actor permissions
  EXTERNAL: "external", // External token (PAT, GitHub App, etc) - check token permissions
} as const;

export type TokenSourceType = (typeof TokenSource)[keyof typeof TokenSource];

export interface AuthContext {
  token: string;
  source: TokenSourceType;
}

export function createAuthContext(
  token: string,
  source: TokenSourceType,
): AuthContext {
  return { token, source };
}
