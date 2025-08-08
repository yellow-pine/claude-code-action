#!/usr/bin/env bun

import * as core from "@actions/core";
import { retryWithBackoff } from "../utils/retry";

export const TokenSource = {
  OIDC: "oidc",
  EXTERNAL: "external",
} as const;

export type TokenSourceType = (typeof TokenSource)[keyof typeof TokenSource];

export interface TokenContext {
  token: string;
  source: TokenSourceType;
}

async function getOidcToken(): Promise<string> {
  try {
    const oidcToken = await core.getIDToken("claude-code-github-action");

    return oidcToken;
  } catch (error) {
    console.error("Failed to get OIDC token:", error);
    throw new Error(
      "Could not fetch an OIDC token. Did you remember to add `id-token: write` to your workflow permissions?",
    );
  }
}

async function exchangeForAppToken(oidcToken: string): Promise<string> {
  const response = await fetch(
    "https://api.anthropic.com/api/github/github-app-token-exchange",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${oidcToken}`,
      },
    },
  );

  if (!response.ok) {
    const responseJson = (await response.json()) as {
      error?: {
        message?: string;
      };
    };
    console.error(
      `App token exchange failed: ${response.status} ${response.statusText} - ${responseJson?.error?.message ?? "Unknown error"}`,
    );
    throw new Error(`${responseJson?.error?.message ?? "Unknown error"}`);
  }

  const appTokenData = (await response.json()) as {
    token?: string;
    app_token?: string;
  };
  const appToken = appTokenData.token || appTokenData.app_token;

  if (!appToken) {
    throw new Error("App token not found in response");
  }

  return appToken;
}

export async function setupTokenContext(
  providedEnvVarName: false | string,
): Promise<TokenContext> {
  try {
    // Check for environment variable token
    const envVarName = providedEnvVarName || "OVERRIDE_GITHUB_TOKEN";
    const token = process.env[envVarName];

    if (token) {
      console.log(`Using ${envVarName} for authentication`);
      core.setOutput("GITHUB_TOKEN", token);
      return { token, source: TokenSource.EXTERNAL };
    }

    // If a specific env var was requested but not found, fail early
    // This is important for modes like "experimental-review" that require
    // a specific token ("DEFAULT_WORKFLOW_TOKEN") to function correctly
    if (providedEnvVarName) {
      throw new Error(`${providedEnvVarName} not found`);
    }

    // Fall back to OIDC token exchange
    console.log("Requesting OIDC token...");
    const oidcToken = await retryWithBackoff(() => getOidcToken());
    console.log("OIDC token successfully obtained");

    console.log("Exchanging OIDC token for app token...");
    const appToken = await retryWithBackoff(() =>
      exchangeForAppToken(oidcToken),
    );
    console.log("App token successfully obtained");

    console.log("Using GITHUB_TOKEN from OIDC");
    core.setOutput("GITHUB_TOKEN", appToken);
    return { token: appToken, source: TokenSource.OIDC };
  } catch (error) {
    core.setFailed(
      `Failed to setup GitHub token: ${error}.\n\nIf you instead wish to use this action with a custom GitHub token or custom GitHub app, provide a \`github_token\` in the \`uses\` section of the app in your workflow yml file.`,
    );
    process.exit(1);
  }
}
