#!/usr/bin/env bun

/**
 * Check if the action trigger is from a human actor
 * Prevents automated tools or bots from triggering Claude
 */

import * as core from "@actions/core";
import type { Octokit } from "@octokit/rest";
import type { ParsedGitHubContext } from "../context";

export async function checkHumanActor(
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

  core.info(`Verified human actor: ${githubContext.actor}`);
}
