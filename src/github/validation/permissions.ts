import * as core from "@actions/core";
import type { ParsedGitHubContext } from "../context";
import type { Octokit } from "@octokit/rest";
import { type AuthContext, TokenSource } from "../auth-context";

/**
 * Check if the actor has write permissions to the repository
 * @param octokit - The Octokit REST client
 * @param context - The GitHub context
 * @param authContext - The authentication context
 * @returns true if the actor has write permissions, false otherwise
 */
export async function checkWritePermissions(
  octokit: Octokit,
  context: ParsedGitHubContext,
  authContext: AuthContext,
): Promise<boolean> {
  const { repository, actor, eventName, inputs } = context;

  // Log the authentication method being used
  core.info(`Checking permissions with ${authContext.source} token source`);

  // Defense in depth: Always verify token permissions first
  const tokenHasWritePermissions = await checkTokenWritePermissions(
    octokit,
    repository,
  );

  if (!tokenHasWritePermissions) {
    return false;
  }

  // Determine if actor check is required
  const shouldCheckActor = shouldCheckActorPermissions(
    authContext,
    actor,
    eventName,
    inputs.trustedActors,
  );

  if (!shouldCheckActor) {
    return true;
  }

  // Check actor permissions
  return checkActorWritePermissions(octokit, repository, actor);
}

/**
 * Determine if actor permission check is required based on auth context
 * @param authContext - The authentication context
 * @param actor - The actor to check
 * @param eventName - The GitHub event name
 * @param trustedActors - List of trusted actors that can bypass checks
 * @returns true if actor permissions should be checked, false if they can be skipped
 */
function shouldCheckActorPermissions(
  authContext: AuthContext,
  actor: string,
  eventName: string,
  trustedActors: string[],
): boolean {
  // OIDC tokens always require actor check
  if (authContext.source === TokenSource.OIDC) {
    return true;
  }

  // External tokens - check if this is a trusted actor scenario
  // Only allow bypass if trusted actors are configured and conditions are met
  if (
    trustedActors.length > 0 &&
    trustedActors.includes(actor) &&
    eventName === 'pull_request'
  ) {
    core.info(
      `Trusted actor detected: ${actor} on ${eventName} event - skipping actor permission check`,
    );
    return false;
  }

  // All other external token cases require actor check
  core.warning(
    `External token provided but actor ${actor} is not a trusted actor - checking actor permissions`,
  );
  return true;
}

/**
 * Check if the token has write permissions to the repository
 * @param octokit - The Octokit REST client authenticated with the token to check
 * @param repository - The repository info
 * @returns true if the token has write permissions, false otherwise
 */
async function checkTokenWritePermissions(
  octokit: Octokit,
  repository: { owner: string; repo: string },
): Promise<boolean> {
  let response;

  core.info(
    `Checking token permissions for repository: ${repository.owner}/${repository.repo}`,
  );

  try {
    response = await octokit.repos.get({
      owner: repository.owner,
      repo: repository.repo,
    });
  } catch (error: any) {
    // If we get a 403/404, the token doesn't have read access
    if (error.status === 403 || error.status === 404) {
      core.warning(`Token lacks read access to repository: ${error.message}`);
      return false;
    }

    // Log rate limiting specifically for operational visibility
    if (error.status === 429) {
      core.error(`Rate limited while checking permissions: ${error.message}`);
      throw new Error(`Rate limited while checking permissions: ${error.message}`);
    }

    // For other errors, rethrow as they might be network issues, etc.
    core.error(`Failed to check token permissions: ${error}`);
    throw new Error(`Failed to check token permissions: ${error}`);
  }

  const permissions = response.data.permissions;
  core.info(
    `Token permissions retrieved: push=${permissions?.push}, admin=${permissions?.admin}`,
  );

  if (!permissions) {
    core.warning("No permissions field in repository response");
    return false;
  }

  if (permissions.push === true || permissions.admin === true) {
    core.info(
      `Token has write access: push=${permissions.push}, admin=${permissions.admin}`,
    );
    return true;
  } else {
    core.warning("Token has insufficient permissions");
    return false;
  }
}

/**
 * Check if the actor has write permissions to the repository by verifying collaborator status
 * @param octokit - The Octokit REST client
 * @param repository - The repository info
 * @param actor - The actor to check
 * @returns true if the actor is a collaborator with write/admin permissions, false otherwise
 */
async function checkActorWritePermissions(
  octokit: Octokit,
  repository: { owner: string; repo: string },
  actor: string,
): Promise<boolean> {
  try {
    core.info(`Checking permissions for actor: ${actor}`);

    // Check permissions directly using the permission endpoint
    const response = await octokit.repos.getCollaboratorPermissionLevel({
      owner: repository.owner,
      repo: repository.repo,
      username: actor,
    });

    const permissionLevel = response.data.permission;
    core.info(`Permission level retrieved: ${permissionLevel}`);

    if (permissionLevel === "admin" || permissionLevel === "write") {
      core.info(`Actor has write access: ${permissionLevel}`);
      return true;
    } else {
      core.warning(`Actor has insufficient permissions: ${permissionLevel}`);
      return false;
    }
  } catch (error) {
    core.error(`Failed to check permissions: ${error}`);
    throw new Error(`Failed to check permissions for ${actor}: ${error}`);
  }
}
