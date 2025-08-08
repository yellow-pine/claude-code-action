#!/usr/bin/env bun

import { describe, test, expect } from "bun:test";
import { checkHumanActor } from "../src/github/validation/actor";
import type { Octokit } from "@octokit/rest";
import { createMockContext } from "./mockContext";

function createMockOctokit(userType: string): Octokit {
  return {
    users: {
      getByUsername: async () => ({
        data: {
          type: userType,
        },
      }),
    },
  } as unknown as Octokit;
}

describe("checkHumanActor", () => {
  test("should pass for human actor", async () => {
    const mockOctokit = createMockOctokit("User");
    const context = createMockContext();
    context.actor = "human-user";

    await expect(
      checkHumanActor(mockOctokit, context),
    ).resolves.toBeUndefined();
  });

  test("should throw error for bot actor when not allowed", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "test-bot[bot]";
    context.inputs.allowedBots = "";

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Workflow initiated by non-human actor: test-bot (type: Bot). Add bot to allowed_bots list or use '*' to allow all bots.",
    );
  });

  test("should pass for bot actor when all bots allowed", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "test-bot[bot]";
    context.inputs.allowedBots = "*";

    await expect(
      checkHumanActor(mockOctokit, context),
    ).resolves.toBeUndefined();
  });

  test("should pass for specific bot when in allowed list", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "dependabot[bot]";
    context.inputs.allowedBots = "dependabot[bot],renovate[bot]";

    await expect(
      checkHumanActor(mockOctokit, context),
    ).resolves.toBeUndefined();
  });

  test("should pass for specific bot when in allowed list (without [bot])", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "dependabot[bot]";
    context.inputs.allowedBots = "dependabot,renovate";

    await expect(
      checkHumanActor(mockOctokit, context),
    ).resolves.toBeUndefined();
  });

  test("should throw error for bot not in allowed list", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "other-bot[bot]";
    context.inputs.allowedBots = "dependabot[bot],renovate[bot]";

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Workflow initiated by non-human actor: other-bot (type: Bot). Add bot to allowed_bots list or use '*' to allow all bots.",
    );
  });

  test("should throw error for bot not in allowed list (without [bot])", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "other-bot[bot]";
    context.inputs.allowedBots = "dependabot,renovate";

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Workflow initiated by non-human actor: other-bot (type: Bot). Add bot to allowed_bots list or use '*' to allow all bots.",
    );
  });

  test("should block bots on pull_request_target events", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "dependabot[bot]";
    context.eventName = "pull_request_target" as any;
    context.inputs.allowedBots = "dependabot[bot]";

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Bots are not allowed on pull_request_target events for security reasons",
    );
  });

  test("should detect bot spoofing attempts", async () => {
    const mockOctokit = createMockOctokit("Bot");
    const context = createMockContext();
    context.actor = "fake-bot[bot]";
    context.inputs.allowedBots = "*";
    context.payload = { sender: { type: "User" } } as any;

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Security violation: fake-bot[bot] claims to be a bot but sender type is 'User'",
    );
  });
});
