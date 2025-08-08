#!/usr/bin/env bun

/**
 * Actor validation functions for checking authorized actors (humans and trusted bots)
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
import { executeApiCall } from "../api/client";

/**
 * Check if the action trigger is from an allowed actor
 * Allows humans and explicitly allowed bots, blocks all other automated actors
 */
export async function checkAllowedActor(
  octokit: Octokit,
  githubContext: ParsedGitHubContext,
) {
  // Fetch user information from GitHub API
  const { data: userData } = await octokit.users.getByUsername({
    username: githubContext.actor,
  });

  const actorType = userData.type;

  core.info(`Actor type: ${actorType}`);

  // Check bot permissions if actor is not a User
  if (actorType !== "User") {
    const allowedBots = githubContext.inputs.allowedBots;

    // Check if all bots are allowed
    if (allowedBots.trim() === "*") {
      core.info(
        `All bots are allowed, skipping human actor check for: ${githubContext.actor}`,
      );
      return;
    }

    // Parse allowed bots list
    const allowedBotsList = allowedBots
      .split(",")
      .map((bot) =>
        bot
          .trim()
          .toLowerCase()
          .replace(/\[bot\]$/, ""),
      )
      .filter((bot) => bot.length > 0);

    const botName = githubContext.actor.toLowerCase().replace(/\[bot\]$/, "");

    // Check if specific bot is allowed
    if (allowedBotsList.includes(botName)) {
      core.info(
        `Bot ${botName} is in allowed list, skipping human actor check`,
      );
      return;
    }

    // Bot not allowed
    throw new Error(
      `Workflow initiated by non-human actor: ${botName} (type: ${actorType}). Add bot to allowed_bots list or use '*' to allow all bots.`,
    );
  }

  core.info(
    `Verified authorized actor: ${githubContext.actor} (type: ${actorType})`,
  );
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
  // Strict bot authenticity check
  // GitHub convention: Bot accounts should end with '[bot]' suffix (e.g., 'dependabot[bot]', 'renovate[bot]')
  // Non-standard bot names (without '[bot]' suffix) are considered suspicious and require full validation
  const senderType = context.payload?.sender?.type;

  // Check if bot suffix indicator matches sender type
  const hasBotSuffix = actor.endsWith(BOT_SUFFIX);
  const isBotSender = senderType === SENDER_TYPE_BOT;

  if (hasBotSuffix !== isBotSender) {
    return {
      isValid: false,
      reason: hasBotSuffix
        ? `Account ${actor} claims to be a bot but sender type is '${senderType}' (expected '${SENDER_TYPE_BOT}') - requiring permission check`
        : `Non-standard bot name '${actor}' with sender type '${SENDER_TYPE_BOT}' - requiring permission check for safety`,
    };
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
 * Determine if actor permission check can be skipped for allowed bots
 * @returns true if check can be skipped, false if actor check is required
 */
export function canSkipActorCheck(
  tokenContext: TokenContext,
  actor: string,
  eventName: string,
  allowedBots: string[],
  context: ParsedGitHubContext,
): boolean {
  core.info("=== Actor Check Skip Decision ===");
  core.info(`Token source: ${tokenContext.source}`);
  core.info(`Actor: ${actor}`);
  core.info(`Event: ${eventName}`);
  core.info(`Allowed bots: ${JSON.stringify(allowedBots)}`);

  // OIDC tokens always require actor verification
  if (tokenContext.source === TokenSource.OIDC) {
    core.info("OIDC token detected - actor check required");
    return false;
  }

  // Must be an allowed bot
  if (!allowedBots.includes(actor)) {
    core.warning(
      `External token provided but actor ${actor} is not an allowed bot - checking actor permissions`,
    );
    return false;
  }

  core.info(`Actor ${actor} is in allowed bots list`);

  // Validate allowed bot conditions
  const validationResult = validateTrustedBot(actor, eventName, context);
  if (!validationResult.isValid) {
    core.warning(validationResult.reason || "Validation failed");
    return false;
  }

  // Log metrics for allowed bot usages
  core.info(`Allowed bot bypass used: actor=${actor}, event=${eventName}`);
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
    return false;
  }

  const permission = result.data.permission;
  const hasWriteAccess = WRITE_PERMISSION_LEVELS.includes(
    permission as (typeof WRITE_PERMISSION_LEVELS)[number],
  );

  if (hasWriteAccess) {
    core.info(`Actor has write access: ${permission}`);
  } else {
    core.warning(`Actor has insufficient permissions: ${permission}`);
  }

  return hasWriteAccess;
}
