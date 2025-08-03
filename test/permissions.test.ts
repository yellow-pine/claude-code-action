import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as core from "@actions/core";
import { checkWritePermissions } from "../src/github/validation/permissions";
import type { ParsedGitHubContext } from "../src/github/context";
import { createAuthContext, TokenSource } from "../src/github/auth-context";

describe("checkWritePermissions", () => {
  let coreInfoSpy: any;
  let coreWarningSpy: any;
  let coreErrorSpy: any;

  // Reusable mock auth contexts
  const mockOidcAuthContext = createAuthContext("test-token", TokenSource.OIDC);
  const mockExternalAuthContext = createAuthContext(
    "github-app-token",
    TokenSource.EXTERNAL,
  );

  beforeEach(() => {
    // Spy on core methods
    coreInfoSpy = spyOn(core, "info").mockImplementation(() => {});
    coreWarningSpy = spyOn(core, "warning").mockImplementation(() => {});
    coreErrorSpy = spyOn(core, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    coreInfoSpy.mockRestore();
    coreWarningSpy.mockRestore();
    coreErrorSpy.mockRestore();
  });

  const createMockOctokit = (
    permission: string,
    tokenPermissions?: { push?: boolean; admin?: boolean },
  ) => {
    return {
      repos: {
        getCollaboratorPermissionLevel: async () => ({
          data: { permission },
        }),
        ...(tokenPermissions && {
          get: async () => ({
            data: { permissions: tokenPermissions },
          }),
        }),
      },
    } as any;
  };

  const createContext = (): ParsedGitHubContext => ({
    runId: "1234567890",
    eventName: "issue_comment",
    eventAction: "created",
    repository: {
      full_name: "test-owner/test-repo",
      owner: "test-owner",
      repo: "test-repo",
    },
    actor: "test-user",
    payload: {
      action: "created",
      issue: {
        number: 1,
        title: "Test Issue",
        body: "Test body",
        user: { login: "test-user" },
      },
      comment: {
        id: 123,
        body: "@claude test",
        user: { login: "test-user" },
        html_url:
          "https://github.com/test-owner/test-repo/issues/1#issuecomment-123",
      },
    } as any,
    entityNumber: 1,
    isPR: false,
    inputs: {
      mode: "tag",
      triggerPhrase: "@claude",
      assigneeTrigger: "",
      labelTrigger: "",
      allowedTools: [],
      disallowedTools: [],
      customInstructions: "",
      directPrompt: "",
      overridePrompt: "",
      branchPrefix: "claude/",
      useStickyComment: false,
      additionalPermissions: new Map(),
      useCommitSigning: false,
    },
  });

  // === OIDC Token Tests (Success Cases) ===
  test("should return true for admin permissions", async () => {
    const mockOctokit = createMockOctokit("admin", { push: true });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(true);
    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Checking permissions with oidc token source",
    );
    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Checking token permissions for repository: test-owner/test-repo",
    );
    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Token permissions retrieved: push=true, admin=undefined",
    );
    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Token has write access: push=true, admin=undefined",
    );
    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Checking permissions for actor: test-user",
    );
    expect(coreInfoSpy).toHaveBeenCalledWith(
      "Permission level retrieved: admin",
    );
    expect(coreInfoSpy).toHaveBeenCalledWith("Actor has write access: admin");
  });

  test("should return true for write permissions", async () => {
    const mockOctokit = createMockOctokit("write", { push: true });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(true);
    expect(coreInfoSpy).toHaveBeenCalledWith("Actor has write access: write");
  });

  // === OIDC Token Tests (Failure Cases) ===
  test("should return false for read permissions", async () => {
    const mockOctokit = createMockOctokit("read", { push: false });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(false);
    // First check for token warning, then actor warning
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token has insufficient permissions",
    );
  });

  test("should return false for none permissions", async () => {
    const mockOctokit = createMockOctokit("none", { push: false });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(false);
    // First check for token warning, then actor warning
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token has insufficient permissions",
    );
  });

  test("should return false when token lacks write permissions", async () => {
    const mockOctokit = createMockOctokit("write", {
      push: false,
      admin: false,
    });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(false);
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token has insufficient permissions",
    );
  });

  // === Error Handling Tests ===
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
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(false);
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token lacks read access to repository: Forbidden",
    );
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
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(false);
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token lacks read access to repository: Not Found",
    );
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
    const context = createContext();

    await expect(
      checkWritePermissions(mockOctokit, context, mockOidcAuthContext),
    ).rejects.toThrow(
      "Failed to check permissions for test-user: Error: API error",
    );
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
    const context = createContext();

    await expect(
      checkWritePermissions(mockOctokit, context, mockOidcAuthContext),
    ).rejects.toThrow(
      "Rate limited while checking permissions: API rate limit exceeded",
    );
  });

  // === External Token Tests (New Behavior) ===
  test("should skip actor check for Dependabot when configured as trusted and PR author matches", async () => {
    // Mock token with write permissions but actor has no permissions
    const mockOctokit = createMockOctokit("none", { push: true });
    const context = createContext();
    // Simulate Dependabot actor on pull_request event with trusted actors configured
    context.actor = "dependabot[bot]";
    context.eventName = "pull_request";
    context.inputs.trustedActors = ["dependabot[bot]"];
    // Add pullRequest data with matching author
    (context as any).payload = {
      action: "opened",
      pull_request: {
        user: { login: "dependabot[bot]" },
      },
    };

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should pass because Dependabot is in trusted actors list AND created the PR
    expect(result).toBe(true);
  });

  test("should require actor check when trusted actor didn't create the PR", async () => {
    // Mock token with write permissions but actor has no permissions
    const mockOctokit = createMockOctokit("none", { push: true });
    const context = createContext();
    // Dependabot is the actor but someone else created the PR
    context.actor = "dependabot[bot]";
    context.eventName = "pull_request";
    context.inputs.trustedActors = ["dependabot[bot]"];
    // PR created by different user
    (context as any).payload = {
      action: "opened",
      pull_request: {
        user: { login: "some-other-user" },
      },
    };

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should fail because actor didn't create the PR
    expect(result).toBe(false);
  });

  test("should require actor check for trusted actors on pull_request_target", async () => {
    // Mock token with write permissions but actor has no permissions
    const mockOctokit = createMockOctokit("none", { push: true });
    const context = createContext();
    context.actor = "dependabot[bot]";
    (context as any).eventName = "pull_request_target"; // Dangerous event type
    context.inputs.trustedActors = ["dependabot[bot]"];
    (context as any).payload = {
      action: "opened",
      pull_request: {
        user: { login: "dependabot[bot]" },
      },
    };

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should fail because pull_request_target is dangerous
    expect(result).toBe(false);
  });

  test("should check actor permissions for Dependabot when not in trusted list", async () => {
    // Mock token with write permissions but actor has no permissions
    const mockOctokit = createMockOctokit("none", { push: true });
    const context = createContext();
    // Dependabot on pull_request but NOT in trusted actors (empty list)
    context.actor = "dependabot[bot]";
    context.eventName = "pull_request";
    context.inputs.trustedActors = []; // Empty trusted actors

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should fail because trusted actors list is empty
    expect(result).toBe(false);
  });

  test("should check actor permissions for Dependabot on non-pull_request events", async () => {
    // Mock token with write permissions but actor has no permissions
    const mockOctokit = createMockOctokit("none", { push: true });
    const context = createContext();
    context.actor = "dependabot[bot]";
    context.eventName = "issue_comment"; // Not pull_request
    context.inputs.trustedActors = ["dependabot[bot]"]; // Even with trust, wrong event

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should fail because it's not a pull_request event
    expect(result).toBe(false);
  });

  test("should check actor permissions for non-trusted actors with external tokens", async () => {
    // Mock token with write permissions but actor has read permissions only
    const mockOctokit = createMockOctokit("read", { push: true });
    const context = createContext();
    context.actor = "external-contributor";

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should fail because actor doesn't have write permissions
    expect(result).toBe(false);
  });

  test("should fail for external tokens without write permissions", async () => {
    // Mock token without write permissions
    const mockOctokit = createMockOctokit("write", {
      push: false,
      admin: false,
    });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    // Should fail due to insufficient token permissions
    expect(result).toBe(false);
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token has insufficient permissions",
    );
    // Actor check should NOT be called since token check failed
    expect(coreInfoSpy).not.toHaveBeenCalledWith(
      "Checking permissions for actor: test-user",
    );
  });

  test("should handle 403 for external tokens", async () => {
    const error = new Error("Forbidden");
    (error as any).status = 403;
    const mockOctokit = {
      repos: {
        get: async () => {
          throw error;
        },
        getCollaboratorPermissionLevel: async () => ({
          data: { permission: "admin" },
        }),
      },
    } as any;
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );

    expect(result).toBe(false);
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "Token lacks read access to repository: Forbidden",
    );
    // Should not attempt actor check for external tokens
    expect(coreInfoSpy).not.toHaveBeenCalledWith(
      "Checking permissions for actor: test-user",
    );
  });

  // === Edge Cases ===
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
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(false);
    expect(coreWarningSpy).toHaveBeenCalledWith(
      "No permissions field in repository response",
    );
  });

  test("should handle multiple trusted actors correctly", async () => {
    const mockOctokit = createMockOctokit("none", { push: true });
    const context = createContext();
    context.eventName = "pull_request";
    context.inputs.trustedActors = ["dependabot[bot]", "github-actions[bot]"];

    // Test first trusted actor
    context.actor = "dependabot[bot]";
    (context as any).payload = {
      action: "opened",
      pull_request: {
        user: { login: "dependabot[bot]" },
      },
    };
    let result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );
    expect(result).toBe(true);

    // Test second trusted actor
    context.actor = "github-actions[bot]";
    (context as any).payload = {
      action: "opened",
      pull_request: {
        user: { login: "github-actions[bot]" },
      },
    };
    result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );
    expect(result).toBe(true);

    // Test non-trusted actor
    context.actor = "random-bot[bot]";
    result = await checkWritePermissions(
      mockOctokit,
      context,
      mockExternalAuthContext,
    );
    expect(result).toBe(false);
  });

  test("should return true when token has admin but not push (edge case)", async () => {
    const mockOctokit = createMockOctokit("write", {
      push: false,
      admin: true,
    });
    const context = createContext();

    const result = await checkWritePermissions(
      mockOctokit,
      context,
      mockOidcAuthContext,
    );

    expect(result).toBe(true);
  });

  test("should call API with correct parameters", async () => {
    let capturedParams: any;
    const mockOctokit = {
      repos: {
        get: async () => ({
          data: { permissions: { push: true } },
        }),
        getCollaboratorPermissionLevel: async (params: any) => {
          capturedParams = params;
          return { data: { permission: "write" } };
        },
      },
    } as any;
    const context = createContext();

    await checkWritePermissions(mockOctokit, context, mockOidcAuthContext);

    expect(capturedParams).toEqual({
      owner: "test-owner",
      repo: "test-repo",
      username: "test-user",
    });
  });
});
