import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as core from "@actions/core";
import { checkWritePermissions } from "../src/github/validation/permissions";
import {
  checkHumanActor,
  validateTrustedBot,
} from "../src/github/validation/actor";
import {
  createMockOctokit,
  createMockContext,
  mockOidcTokenContext,
  mockExternalTokenContext,
} from "./mockContext";

// Helper function to create context with type assertion
const createTestContext = (overrides?: any): any =>
  createMockContext(overrides) as any;

describe("Permissions - OIDC Tokens", () => {
  const oidcTestCases = [
    { permission: "admin", tokenPerms: { push: true }, expected: true },
    { permission: "write", tokenPerms: { push: true }, expected: true },
    { permission: "read", tokenPerms: { push: false }, expected: false },
    { permission: "none", tokenPerms: { push: false }, expected: false },
  ];

  oidcTestCases.forEach(({ permission, tokenPerms, expected }) => {
    test(`should return ${expected} for ${permission} permissions`, async () => {
      const result = await checkWritePermissions(
        createMockOctokit(permission, tokenPerms),
        createMockContext(),
        mockOidcTokenContext,
      );
      expect(result).toBe(expected);
    });
  });

  test("should return false when permissions field is missing", async () => {
    const mockOctokit = {
      repos: {
        get: async () => ({
          data: {}, // No permissions field
        }),
        getCollaboratorPermissionLevel: async () => ({
          data: { permission: "admin" },
        }),
      },
    } as any;
    const context = createMockContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcTokenContext,
    );

    expect(result).toBe(false);
  });

  test("should return true when token has admin but not push (edge case)", async () => {
    const mockOctokit = createMockOctokit("write", {
      push: false,
      admin: true,
    });
    const context = createMockContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcTokenContext,
    );

    expect(result).toBe(true);
  });
});

describe("Permissions - External Tokens", () => {
  const externalTokenTests = [
    {
      name: "should fail for external tokens without write permissions",
      setup: {
        failLabelCreate: true,
        labelCreateError: { status: 403, message: "Forbidden" },
      },
      expected: false,
    },
    {
      name: "should handle 403 for external tokens",
      setup: {
        failLabelCreate: true,
        labelCreateError: { status: 403, message: "Forbidden" },
      },
      expected: false,
    },
  ];

  externalTokenTests.forEach(({ name, setup, expected }) => {
    test(name, async () => {
      const result = await checkWritePermissions(
        createMockOctokit("admin", undefined, setup),
        createMockContext(),
        mockExternalTokenContext,
      );
      expect(result).toBe(expected);
    });
  });
});

describe("Permissions - Error Handling", () => {
  test("should return false when token lacks read access (403)", async () => {
    const error = new Error("Forbidden");
    (error as any).status = 403;
    const mockOctokit = {
      repos: {
        get: async () => {
          throw error;
        },
        getCollaboratorPermissionLevel: async () => ({
          data: { permission: "write" },
        }),
      },
    } as any;
    const context = createMockContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcTokenContext,
    );

    expect(result).toBe(false);
  });

  test("should return false when repository not found (404)", async () => {
    const error = new Error("Not Found");
    (error as any).status = 404;
    const mockOctokit = {
      repos: {
        get: async () => {
          throw error;
        },
        getCollaboratorPermissionLevel: async () => ({
          data: { permission: "write" },
        }),
      },
    } as any;
    const context = createMockContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcTokenContext,
    );

    expect(result).toBe(false);
  });

  test("should throw error when permission check fails", async () => {
    const error = new Error("API error");
    const mockOctokit = {
      repos: {
        get: async () => ({
          data: { permissions: { push: true } },
        }),
        getCollaboratorPermissionLevel: async () => {
          throw error;
        },
      },
    } as any;
    const context = createMockContext();

    await expect(
      checkWritePermissions(mockOctokit, context, mockOidcTokenContext),
    ).rejects.toThrow("Failed to check permissions for test-actor");
  });

  test("should throw error with specific message for rate limiting (429)", async () => {
    const error = new Error("API rate limit exceeded");
    (error as any).status = 429;
    const mockOctokit = {
      repos: {
        get: async () => {
          throw error;
        },
      },
    } as any;
    const context = createMockContext();

    await expect(
      checkWritePermissions(mockOctokit, context, mockOidcTokenContext),
    ).rejects.toThrow("Rate limited: API rate limit exceeded");
  });
});

describe("Actor Validation - Trusted Bots", () => {
  const testCases = [
    {
      name: "should skip actor check for valid trusted bot on PR",
      setup: {
        permission: "admin",
        senderType: "Bot" as const,
        eventName: "pull_request" as const,
      },
      expected: true,
    },
    {
      name: "should check permissions when bot sender type doesn't match",
      setup: {
        permission: "none",
        senderType: "User" as const,
        eventName: "pull_request" as const,
      },
      expected: false,
    },
    {
      name: "should check permissions when event is not pull_request",
      setup: {
        permission: "none",
        senderType: "Bot" as const,
        eventName: "issue_comment" as const,
      },
      expected: false,
    },
  ];

  testCases.forEach(({ name, setup, expected }) => {
    test(name, async () => {
      const mockOctokit = createMockOctokit("admin", undefined, {
        collaboratorPermission: setup.permission,
      });
      const context = createTestContext({
        actor: "dependabot[bot]",
        eventName: setup.eventName,
        payload:
          setup.eventName === "pull_request"
            ? {
                ...createTestContext().payload,
                sender: { type: setup.senderType } as any,
                pull_request: { user: { login: "dependabot[bot]" } } as any,
              }
            : createTestContext().payload,
        inputs: {
          ...createTestContext().inputs,
          trustedBots: ["dependabot[bot]"],
        },
      }) as any;

      const result = await checkWritePermissions(
        mockOctokit,
        context,
        mockExternalTokenContext,
      );
      expect(result).toBe(expected);
    });
  });

  test("should check permissions when bot is not trusted", async () => {
    const mockOctokit = createMockOctokit("admin", undefined, {
      collaboratorPermission: "read",
    });
    const context = createTestContext({
      actor: "external-contributor",
      eventName: "pull_request",
      payload: {
        ...createTestContext().payload,
        sender: { type: "User" } as any,
        pull_request: { user: { login: "external-contributor" } } as any,
      },
      inputs: {
        ...createTestContext().inputs,
        trustedBots: ["dependabot[bot]"],
      },
    });

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalTokenContext,
    );
    expect(result).toBe(false);
  });

  test("should skip actor check for github-actions bot", async () => {
    const result = await checkWritePermissions(
      createMockOctokit("admin", undefined, {
        collaboratorPermission: "admin",
      }),
      createTestContext({
        actor: "github-actions[bot]",
        eventName: "pull_request",
        payload: {
          ...createTestContext().payload,
          sender: { type: "Bot" } as any,
          pull_request: { user: { login: "github-actions[bot]" } } as any,
        },
        inputs: {
          ...createTestContext().inputs,
          trustedBots: ["github-actions[bot]"],
        },
      }),
      mockExternalTokenContext,
    );
    expect(result).toBe(true);
  });

  test("should fail for random bot not in trusted list", async () => {
    const mockOctokit = createMockOctokit("admin", undefined, {
      collaboratorPermission: "none",
    });
    const context = createTestContext({
      actor: "random-bot[bot]",
      eventName: "pull_request",
      payload: {
        ...createTestContext().payload,
        sender: { type: "Bot" } as any,
        pull_request: {
          user: { login: "random-bot[bot]" },
        } as any,
      },
      inputs: {
        ...createTestContext().inputs,
        trustedBots: ["dependabot[bot]", "github-actions[bot]"],
      },
    });

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalTokenContext,
    );
    expect(result).toBe(false);
  });
});

describe("checkHumanActor", () => {
  let coreInfoSpy: any;

  beforeEach(() => {
    coreInfoSpy = spyOn(core, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    coreInfoSpy.mockRestore();
  });

  test("should skip check for trusted bots", async () => {
    const mockOctokit = createMockOctokit("admin");
    const context = createTestContext({
      actor: "dependabot[bot]",
      inputs: {
        trustedBots: ["dependabot[bot]"],
      },
    });

    await checkHumanActor(mockOctokit, context);

    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Actor dependabot[bot] is in trusted bots list, skipping human check",
    );
  });

  test("should verify human actor successfully", async () => {
    const mockOctokit = {
      users: {
        getByUsername: async () => ({
          data: { type: "User" },
        }),
      },
    } as any;
    const context = createTestContext({
      actor: "test-user",
    });

    await checkHumanActor(mockOctokit, context);

    expect(coreInfoSpy).toHaveBeenCalledWith("Actor type: User");
    expect(coreInfoSpy).toHaveBeenCalledWith("Verified human actor: test-user");
  });

  test("should throw error for bot actor", async () => {
    const mockOctokit = {
      users: {
        getByUsername: async ({ username }: { username: string }) => ({
          data: { type: "Bot", login: username },
        }),
      },
    } as any;
    const context = createTestContext({
      actor: "some-bot",
    });

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Workflow initiated by non-human actor: some-bot (type: Bot).",
    );

    expect(coreInfoSpy).toHaveBeenCalledWith("Actor type: Bot");
  });

  test("should throw error for organization actor", async () => {
    const mockOctokit = {
      users: {
        getByUsername: async ({ username }: { username: string }) => ({
          data: { type: "Organization", login: username },
        }),
      },
    } as any;
    const context = createTestContext({
      actor: "some-org",
    });

    await expect(checkHumanActor(mockOctokit, context)).rejects.toThrow(
      "Workflow initiated by non-human actor: some-org (type: Organization).",
    );

    expect(coreInfoSpy).toHaveBeenCalledWith("Actor type: Organization");
  });
});

describe("validateTrustedBot", () => {
  test("should pass validation for bot with correct sender type on pull_request", () => {
    const context = createTestContext({
      actor: "dependabot[bot]",
      eventName: "pull_request",
      payload: {
        action: "created",
        sender: { type: "Bot", login: "dependabot[bot]" },
        pull_request: {
          user: { login: "dependabot[bot]" },
        },
      },
    });

    const result = validateTrustedBot(
      "dependabot[bot]",
      "pull_request",
      context,
    );
    expect(result.isValid).toBe(true);
  });

  test("should fail validation for bot with incorrect sender type", () => {
    const context = createTestContext({
      actor: "dependabot[bot]",
      eventName: "pull_request",
      payload: {
        action: "created",
        sender: { type: "User", login: "dependabot[bot]" },
        pull_request: {
          user: { login: "dependabot[bot]" },
        },
      },
    });

    const result = validateTrustedBot(
      "dependabot[bot]",
      "pull_request",
      context,
    );
    expect(result.isValid).toBe(false);
    if (!result.isValid)
      expect(result.reason).toContain("sender type doesn't match");
  });

  test("should fail validation for pull_request_target event", () => {
    const context = createTestContext({
      actor: "dependabot[bot]",
      eventName: "pull_request" as any, // Using as any for test-only non-standard event
      payload: {
        action: "created",
        sender: { type: "Bot", login: "dependabot[bot]" },
        pull_request: {
          user: { login: "dependabot[bot]" },
        },
      },
    });

    const result = validateTrustedBot(
      "dependabot[bot]",
      "pull_request_target" as any,
      context,
    );
    expect(result.isValid).toBe(false);
    if (!result.isValid)
      expect(result.reason).toContain(
        "pull_request_target event - actor check required for security",
      );
  });

  test("should fail validation for non-pull_request events", () => {
    const context = createTestContext({
      actor: "dependabot[bot]",
      eventName: "issue_comment",
      payload: {
        action: "created",
        sender: { type: "Bot", login: "dependabot[bot]" },
      },
    });

    const result = validateTrustedBot(
      "dependabot[bot]",
      "issue_comment",
      context,
    );
    expect(result.isValid).toBe(false);
    if (!result.isValid)
      expect(result.reason).toContain(
        "only pull_request events can skip actor checks",
      );
  });

  test("should fail validation when PR author doesn't match actor", () => {
    const context = createTestContext({
      actor: "dependabot[bot]",
      eventName: "pull_request",
      payload: {
        action: "created",
        sender: { type: "Bot", login: "dependabot[bot]" },
        pull_request: {
          user: { login: "other-bot[bot]" },
        },
      },
    });

    const result = validateTrustedBot(
      "dependabot[bot]",
      "pull_request",
      context,
    );
    expect(result.isValid).toBe(false);
    if (!result.isValid)
      expect(result.reason).toContain("didn't create the PR");
  });

  test("should pass validation for non-bot actors", () => {
    const context = createTestContext({
      actor: "human-user",
      eventName: "pull_request",
      payload: {
        action: "created",
        sender: { type: "User", login: "human-user" },
        pull_request: {
          user: { login: "human-user" },
        },
      },
    });

    const result = validateTrustedBot("human-user", "pull_request", context);
    expect(result.isValid).toBe(true);
  });

  test("should handle missing pull_request data gracefully", () => {
    const context = createTestContext({
      actor: "dependabot[bot]",
      eventName: "pull_request",
      payload: {
        action: "created",
        sender: { type: "Bot", login: "dependabot[bot]" },
        // No pull_request data
      },
    });

    const result = validateTrustedBot(
      "dependabot[bot]",
      "pull_request",
      context,
    );
    expect(result.isValid).toBe(true);
  });
});
