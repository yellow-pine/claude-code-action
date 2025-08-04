import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import * as core from "@actions/core";
import { GITHUB_API_URL } from "./config";

export type Octokits = {
  rest: Octokit;
  graphql: typeof graphql;
};

export function createOctokit(token: string): Octokits {
  return {
    rest: new Octokit({
      auth: token,
      baseUrl: GITHUB_API_URL,
    }),
    graphql: graphql.defaults({
      baseUrl: GITHUB_API_URL,
      headers: {
        authorization: `token ${token}`,
      },
    }),
  };
}

// Types for better error handling and results
export type ApiResult<T> = T | false;

/**
 * Execute a GitHub API call with standardized error handling
 *
 * @param operation - The async operation to execute
 * @param operationName - Human-readable name for logging
 * @param handlers - Optional custom handlers for specific error codes
 * @returns The operation result or false on handled errors
 * @throws Error for unhandled errors (rate limits, other failures)
 */
export async function executeApiCall<T>(
  operation: () => Promise<T>,
  operationName: string,
  handlers?: {
    onAccessDenied?: (error: any) => ApiResult<T>;
    onNotFound?: (error: any) => ApiResult<T>;
  },
): Promise<ApiResult<T>> {
  try {
    return await operation();
  } catch (error: any) {
    const { status, message = String(error) } = error;

    // Handle common GitHub API errors
    if (status === 403 || status === 404) {
      const handler =
        status === 403 ? handlers?.onAccessDenied : handlers?.onNotFound;
      if (handler) {
        return handler(error);
      }
      core.warning(`${operationName} failed (${status}): ${message}`);
      return false;
    }

    // Rate limiting requires special handling - always throw
    if (status === 429) {
      const msg = `Rate limited: ${message}`;
      core.error(msg);
      throw new Error(msg);
    }

    // Other errors are unexpected - log and throw
    const msg = `Failed to ${operationName}: ${message}`;
    core.error(msg);
    throw new Error(msg);
  }
}

/**
 * Log the result of a GitHub API operation
 *
 * @param success - Whether the operation succeeded
 * @param successMessage - Message to log on success
 * @param failureMessage - Message to log on failure
 * @returns The success value for chaining
 */
export function logApiResult(
  success: boolean,
  successMessage: string,
  failureMessage: string,
): boolean {
  (success ? core.info : core.warning)(
    success ? successMessage : failureMessage,
  );
  return success;
}
