import * as core from "@actions/core";
import type { ParsedGitHubContext, Repository } from "../context";
import type { Octokit } from "@octokit/rest";
import { type TokenContext, TokenSource } from "../token";
import { executeApiCall, logApiResult } from "../api/client";
import { canSkipActorCheck, checkActorWritePermissions } from "./actor";

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

  // Step 1: Verify token has write access
  const tokenHasWriteAccess = await verifyTokenAccess(
    octokit,
    repository,
    tokenContext,
  );

  if (!tokenHasWriteAccess) {
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

  return logApiResult(
    hasWriteAccess,
    `Token has write access: push=${push}, admin=${admin}`,
    "Token has insufficient permissions",
  );
}

async function verifyExternalTokenWriteCapability(
  octokit: Octokit,
  repository: Repository,
): Promise<boolean> {
  const testLabel = `claude-action-test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  const result = await executeApiCall(
    async () => {
      await octokit.issues.createLabel({
        owner: repository.owner,
        repo: repository.repo,
        name: testLabel,
        color: "ffffff",
        description: "Temporary test label - safe to delete",
      });

      await octokit.issues
        .deleteLabel({
          owner: repository.owner,
          repo: repository.repo,
          name: testLabel,
        })
        .catch(() =>
          core.warning(`Could not clean up test label ${testLabel}`),
        );

      return true;
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

  if (result === true)
    core.info("External token verified with write capability");
  return result !== false;
}
