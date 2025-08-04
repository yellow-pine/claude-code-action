#!/usr/bin/env bun

/**
 * Actor validation functions for checking human actors and trusted bots
 */

import * as core from "@actions/core";
import type { Octokit } from "@octokit/rest";
import type { ParsedGitHubContext, Repository } from "../context";
import {
  BOT_SUFFIX,
  SENDER_TYPE_BOT,
  WRITE_PERMISSION_LEVELS,
} from "../context";
import { type TokenContext, TokenSource } from "../token";
import { executeApiCall, logApiResult } from "../api/client";

/**
 * Check if the action trigger is from a human actor
 * Prevents automated tools or bots from triggering Claude
 */
export async function checkHumanActor(
  octokit: Octokit,
  githubContext: ParsedGitHubContext,
) {
  // Check if actor is in trusted bots list
  if (githubContext.inputs?.trustedBots?.includes(githubContext.actor)) {
    core.info(
      `Actor ${githubContext.actor} is in trusted bots list, skipping human check`,
    );
    return;
  }

  // Fetch user information from GitHub API
  const { data: userData } = await octokit.users.getByUsername({
    username: githubContext.actor,
  });

  const actorType = userData.type;

  core.info(`Actor type: ${actorType}`);

  if (actorType !== "User") {
    throw new Error(
      `Workflow initiated by non-human actor: ${githubContext.actor} (type: ${actorType}).`,
    );
  }

  core.info(`Verified human actor: ${githubContext.actor}`);
}

/**
 * Check if bot actor can skip permission verification
 * @returns ValidationResult indicating if check passed with reason if not
 */
export function validateTrustedBot(
  actor: string,
  eventName: string,
  context: ParsedGitHubContext,
) {
  // Check bot authenticity
  if (actor.endsWith(BOT_SUFFIX)) {
    const senderType = context.payload?.sender?.type;
    if (!senderType?.includes(SENDER_TYPE_BOT)) {
      return {
        isValid: false,
        reason: `Account ${actor} claims to be a bot but sender type doesn't match - requiring permission check`,
      };
    }
  }

  // Security check for pull_request_target
  if (eventName === "pull_request_target") {
    return {
      isValid: false,
      reason: `Trusted bot ${actor} on pull_request_target event - actor check required for security`,
    };
  }

  // Only allow pull_request events
  if (eventName !== "pull_request") {
    return {
      isValid: false,
      reason: `Trusted bot ${actor} on ${eventName} event - only pull_request events can skip actor checks`,
    };
  }

  // Verify PR authorship
  const payload = context.payload as any;
  const prAuthor = payload.pull_request?.user?.login;
  if (prAuthor && prAuthor !== actor) {
    return {
      isValid: false,
      reason: `Bot ${actor} is trusted but didn't create the PR (created by ${prAuthor}) - requiring permission check`,
    };
  }

  return { isValid: true };
}

/**
 * Determine if actor permission check can be skipped for trusted bots
 * @returns true if check can be skipped, false if actor check is required
 */
export function canSkipActorCheck(
  tokenContext: TokenContext,
  actor: string,
  eventName: string,
  trustedBots: string[],
  context: ParsedGitHubContext,
): boolean {
  // OIDC tokens always require actor verification
  if (tokenContext.source === TokenSource.OIDC) {
    return false;
  }

  // Must be a trusted bot
  if (!trustedBots.includes(actor)) {
    core.warning(
      `External token provided but actor ${actor} is not a trusted bot - checking actor permissions`,
    );
    return false;
  }

  // Validate trusted bot conditions
  const validationResult = validateTrustedBot(actor, eventName, context);
  if (!validationResult.isValid) {
    core.warning(validationResult.reason || "Validation failed");
    return false;
  }

  core.info(
    `Trusted bot verified: ${actor} created PR on ${eventName} event - skipping actor permission check`,
  );
  return true;
}

/**
 * Check actor write permissions via collaborator status
 */
export async function checkActorWritePermissions(
  octokit: Octokit,
  repository: Repository,
  actor: string,
): Promise<boolean> {
  const result = await executeApiCall(
    () =>
      octokit.repos.getCollaboratorPermissionLevel({
        owner: repository.owner,
        repo: repository.repo,
        username: actor,
      }),
    `check permissions for ${actor}`,
  );

  if (!result) {
    throw new Error(`Failed to check permissions for ${actor}`);
  }

  const permission = result.data.permission;
  const hasWriteAccess = WRITE_PERMISSION_LEVELS.includes(
    permission as (typeof WRITE_PERMISSION_LEVELS)[number],
  );

  return logApiResult(
    hasWriteAccess,
    `Actor has write access: ${permission}`,
    `Actor has insufficient permissions: ${permission}`,
  );
}
