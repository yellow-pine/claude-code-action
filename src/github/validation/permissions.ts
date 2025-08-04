import * as core from "@actions/core";
import type { ParsedGitHubContext, Repository } from "../context";
import type { Octokit } from "@octokit/rest";
import { type TokenContext, TokenSource } from "../token";
import { executeApiCall } from "../api/client";
import { canSkipActorCheck, checkActorWritePermissions } from "./actor";
import { retryWithBackoff } from "../../utils/retry";

/**
 * Check if the actor has write permissions to the repository
 * @param octokit - The Octokit REST client
 * @param context - The GitHub context
 * @param tokenContext - The token context
 * @returns true if the actor has write permissions, false otherwise
 */
export async function checkWritePermissions(
  octokit: Octokit,
  context: ParsedGitHubContext,
  tokenContext: TokenContext,
): Promise<boolean> {
  const { repository, actor, eventName, inputs } = context;

  // Log key permission check context
  core.info(`Checking permissions for actor: ${actor}`);
  if (inputs.trustedBots?.length) {
    core.info(`Trusted bots configured: ${inputs.trustedBots.join(", ")}`);
  }

  // Step 1: Verify token has write access
  const tokenHasWriteAccess = await verifyTokenAccess(
    octokit,
    repository,
    tokenContext,
  );

  if (!tokenHasWriteAccess) {
    core.error("Token verification failed - no write access");
    return false;
  }
  // Step 2: Check if actor verification is needed
  const skipActorCheck = canSkipActorCheck(
    tokenContext,
    actor,
    eventName,
    inputs.trustedBots || [],
    context,
  );

  if (skipActorCheck) {
    core.info("Actor check skipped - using token permissions");
    return true;
  }

  // Step 3: Verify actor has write permissions
  return checkActorWritePermissions(octokit, repository, actor);
}

async function verifyTokenAccess(
  octokit: Octokit,
  repository: Repository,
  tokenContext: TokenContext,
): Promise<boolean> {
  const repoFullName = `${repository.owner}/${repository.repo}`;

  if (tokenContext.source === TokenSource.OIDC) {
    core.info(`Checking OIDC token permissions for ${repoFullName}`);
    return checkTokenWritePermissions(octokit, repository);
  }

  core.info(`Verifying external token write capability for ${repoFullName}`);
  const hasWriteCapability = await verifyExternalTokenWriteCapability(
    octokit,
    repository,
  );

  if (!hasWriteCapability) {
    core.error("External token lacks write permissions");
  }

  return hasWriteCapability;
}

async function checkTokenWritePermissions(
  octokit: Octokit,
  repository: Repository,
): Promise<boolean> {
  const result = await executeApiCall(
    () => octokit.repos.get({ owner: repository.owner, repo: repository.repo }),
    "check token permissions",
    {
      onAccessDenied: () => (core.warning("Token lacks read access"), false),
      onNotFound: () => (core.warning("Token lacks read access"), false),
    },
  );

  if (!result) {
    return false;
  }

  const { push, admin } = result.data.permissions || {};
  const hasWriteAccess = push === true || admin === true;

  if (hasWriteAccess) {
    core.info(`Token has write access: push=${push}, admin=${admin}`);
  } else {
    core.warning("Token has insufficient permissions");
  }

  return hasWriteAccess;
}

async function verifyExternalTokenWriteCapability(
  octokit: Octokit,
  repository: Repository,
): Promise<boolean> {
  // Use workflow run ID for uniqueness if available, fallback to timestamp + random
  const workflowId = process.env.GITHUB_RUN_ID || Date.now();
  const testLabel = `claude-action-test-${workflowId}-${Math.random().toString(36).substring(2, 11)}`;
  const TIMEOUT_MS = 5000; // 5 second timeout for label operations

  const result = await executeApiCall(
    async () => {
      let labelCreated = false;

      try {
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("Label operation timed out")),
            TIMEOUT_MS,
          );
        });

        // Create label operation promise with retry logic
        const labelOperation = async () => {
          // Use retry for label creation in case of transient failures
          await retryWithBackoff(
            () =>
              octokit.issues.createLabel({
                owner: repository.owner,
                repo: repository.repo,
                name: testLabel,
                color: "ffffff",
                description: "Temporary test label - safe to delete",
              }),
            { maxAttempts: 3, initialDelayMs: 1000, maxDelayMs: 5000 },
          );
          labelCreated = true;

          // Clean up immediately (with retry)
          await retryWithBackoff(
            () =>
              octokit.issues.deleteLabel({
                owner: repository.owner,
                repo: repository.repo,
                name: testLabel,
              }),
            { maxAttempts: 2, initialDelayMs: 500, maxDelayMs: 2000 },
          );
          return true;
        };

        // Race between timeout and operation
        return await Promise.race([timeoutPromise, labelOperation()]);
      } catch (error) {
        // If we created the label but failed during deletion, try cleanup
        if (labelCreated) {
          await octokit.issues
            .deleteLabel({
              owner: repository.owner,
              repo: repository.repo,
              name: testLabel,
            })
            .catch(() =>
              core.warning(
                `Could not clean up test label ${testLabel} after timeout`,
              ),
            );
        }
        throw error;
      }
    },
    "verify token write capability",
    {
      onAccessDenied: () => (
        core.warning("External token lacks write permissions"), false
      ),
      onNotFound: () => (
        core.warning("External token cannot access repository"), false
      ),
    },
  );

  if (result === true) {
    core.info("External token verified with write capability");
  }

  return result !== false;
}
