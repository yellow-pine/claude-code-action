#!/usr/bin/env bun

import { describe, test, expect } from "bun:test";
import {
  prepareRunConfig,
  synchronizeGitHubTokens,
  type ClaudeOptions,
} from "../src/run-claude";

describe("prepareRunConfig", () => {
  test("should prepare config with basic arguments", () => {
    const options: ClaudeOptions = {};
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs.slice(0, 4)).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
    ]);
  });

  test("should include promptPath", () => {
    const options: ClaudeOptions = {};
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.promptPath).toBe("/tmp/test-prompt.txt");
  });

  test("should include allowed tools in command arguments", () => {
    const options: ClaudeOptions = {
      allowedTools: "Bash,Read",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--allowedTools");
    expect(prepared.claudeArgs).toContain("Bash,Read");
  });

  test("should include disallowed tools in command arguments", () => {
    const options: ClaudeOptions = {
      disallowedTools: "Bash,Read",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--disallowedTools");
    expect(prepared.claudeArgs).toContain("Bash,Read");
  });

  test("should include max turns in command arguments", () => {
    const options: ClaudeOptions = {
      maxTurns: "5",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--max-turns");
    expect(prepared.claudeArgs).toContain("5");
  });

  test("should include mcp config in command arguments", () => {
    const options: ClaudeOptions = {
      mcpConfig: "/path/to/mcp-config.json",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--mcp-config");
    expect(prepared.claudeArgs).toContain("/path/to/mcp-config.json");
  });

  test("should include system prompt in command arguments", () => {
    const options: ClaudeOptions = {
      systemPrompt: "You are a senior backend engineer.",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--system-prompt");
    expect(prepared.claudeArgs).toContain("You are a senior backend engineer.");
  });

  test("should include append system prompt in command arguments", () => {
    const options: ClaudeOptions = {
      appendSystemPrompt:
        "After writing code, be sure to code review yourself.",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--append-system-prompt");
    expect(prepared.claudeArgs).toContain(
      "After writing code, be sure to code review yourself.",
    );
  });

  test("should include fallback model in command arguments", () => {
    const options: ClaudeOptions = {
      fallbackModel: "claude-sonnet-4-20250514",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toContain("--fallback-model");
    expect(prepared.claudeArgs).toContain("claude-sonnet-4-20250514");
  });

  test("should use provided prompt path", () => {
    const options: ClaudeOptions = {};
    const prepared = prepareRunConfig("/custom/prompt/path.txt", options);

    expect(prepared.promptPath).toBe("/custom/prompt/path.txt");
  });

  test("should not include optional arguments when not set", () => {
    const options: ClaudeOptions = {};
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).not.toContain("--allowedTools");
    expect(prepared.claudeArgs).not.toContain("--disallowedTools");
    expect(prepared.claudeArgs).not.toContain("--max-turns");
    expect(prepared.claudeArgs).not.toContain("--mcp-config");
    expect(prepared.claudeArgs).not.toContain("--system-prompt");
    expect(prepared.claudeArgs).not.toContain("--append-system-prompt");
    expect(prepared.claudeArgs).not.toContain("--fallback-model");
  });

  test("should preserve order of claude arguments", () => {
    const options: ClaudeOptions = {
      allowedTools: "Bash,Read",
      maxTurns: "3",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--allowedTools",
      "Bash,Read",
      "--max-turns",
      "3",
    ]);
  });

  test("should preserve order with all options including fallback model", () => {
    const options: ClaudeOptions = {
      allowedTools: "Bash,Read",
      disallowedTools: "Write",
      maxTurns: "3",
      mcpConfig: "/path/to/config.json",
      systemPrompt: "You are a helpful assistant",
      appendSystemPrompt: "Be concise",
      fallbackModel: "claude-sonnet-4-20250514",
    };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.claudeArgs).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--allowedTools",
      "Bash,Read",
      "--disallowedTools",
      "Write",
      "--max-turns",
      "3",
      "--mcp-config",
      "/path/to/config.json",
      "--system-prompt",
      "You are a helpful assistant",
      "--append-system-prompt",
      "Be concise",
      "--fallback-model",
      "claude-sonnet-4-20250514",
    ]);
  });

  describe("maxTurns validation", () => {
    test("should accept valid maxTurns value", () => {
      const options: ClaudeOptions = { maxTurns: "5" };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.claudeArgs).toContain("--max-turns");
      expect(prepared.claudeArgs).toContain("5");
    });

    test("should throw error for non-numeric maxTurns", () => {
      const options: ClaudeOptions = { maxTurns: "abc" };
      expect(() => prepareRunConfig("/tmp/test-prompt.txt", options)).toThrow(
        "maxTurns must be a positive number, got: abc",
      );
    });

    test("should throw error for negative maxTurns", () => {
      const options: ClaudeOptions = { maxTurns: "-1" };
      expect(() => prepareRunConfig("/tmp/test-prompt.txt", options)).toThrow(
        "maxTurns must be a positive number, got: -1",
      );
    });

    test("should throw error for zero maxTurns", () => {
      const options: ClaudeOptions = { maxTurns: "0" };
      expect(() => prepareRunConfig("/tmp/test-prompt.txt", options)).toThrow(
        "maxTurns must be a positive number, got: 0",
      );
    });
  });

  describe("timeoutMinutes validation", () => {
    test("should accept valid timeoutMinutes value", () => {
      const options: ClaudeOptions = { timeoutMinutes: "15" };
      expect(() =>
        prepareRunConfig("/tmp/test-prompt.txt", options),
      ).not.toThrow();
    });

    test("should throw error for non-numeric timeoutMinutes", () => {
      const options: ClaudeOptions = { timeoutMinutes: "abc" };
      expect(() => prepareRunConfig("/tmp/test-prompt.txt", options)).toThrow(
        "timeoutMinutes must be a positive number, got: abc",
      );
    });

    test("should throw error for negative timeoutMinutes", () => {
      const options: ClaudeOptions = { timeoutMinutes: "-5" };
      expect(() => prepareRunConfig("/tmp/test-prompt.txt", options)).toThrow(
        "timeoutMinutes must be a positive number, got: -5",
      );
    });

    test("should throw error for zero timeoutMinutes", () => {
      const options: ClaudeOptions = { timeoutMinutes: "0" };
      expect(() => prepareRunConfig("/tmp/test-prompt.txt", options)).toThrow(
        "timeoutMinutes must be a positive number, got: 0",
      );
    });
  });

  describe("custom environment variables", () => {
    test("should parse empty claudeEnv correctly", () => {
      const options: ClaudeOptions = { claudeEnv: "" };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({});
    });

    test("should parse single environment variable", () => {
      const options: ClaudeOptions = { claudeEnv: "API_KEY: secret123" };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({ API_KEY: "secret123" });
    });

    test("should parse multiple environment variables", () => {
      const options: ClaudeOptions = {
        claudeEnv: "API_KEY: secret123\nDEBUG: true\nUSER: testuser",
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({
        API_KEY: "secret123",
        DEBUG: "true",
        USER: "testuser",
      });
    });

    test("should handle environment variables with spaces around values", () => {
      const options: ClaudeOptions = {
        claudeEnv: "API_KEY:  secret123  \n  DEBUG  :  true  ",
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({
        API_KEY: "secret123",
        DEBUG: "true",
      });
    });

    test("should skip empty lines and comments", () => {
      const options: ClaudeOptions = {
        claudeEnv:
          "API_KEY: secret123\n\n# This is a comment\nDEBUG: true\n# Another comment",
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({
        API_KEY: "secret123",
        DEBUG: "true",
      });
    });

    test("should skip lines without colons", () => {
      const options: ClaudeOptions = {
        claudeEnv: "API_KEY: secret123\nINVALID_LINE\nDEBUG: true",
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({
        API_KEY: "secret123",
        DEBUG: "true",
      });
    });

    test("should handle undefined claudeEnv", () => {
      const options: ClaudeOptions = {};
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);
      expect(prepared.env).toEqual({});
    });
  });
});

describe("synchronizeGitHubTokens", () => {
  test("should set both tokens when only GITHUB_TOKEN exists", () => {
    const env = {
      GITHUB_TOKEN: "test-github-token",
      OTHER_VAR: "other-value",
    };

    const result = synchronizeGitHubTokens(env);

    expect(result.GITHUB_TOKEN).toBe("test-github-token");
    expect(result.GH_TOKEN).toBe("test-github-token");
    expect(result.OTHER_VAR).toBe("other-value");
  });

  test("should set both tokens when only GH_TOKEN exists", () => {
    const env = {
      GH_TOKEN: "test-gh-token",
      OTHER_VAR: "other-value",
    };

    const result = synchronizeGitHubTokens(env);

    expect(result.GITHUB_TOKEN).toBe("test-gh-token");
    expect(result.GH_TOKEN).toBe("test-gh-token");
    expect(result.OTHER_VAR).toBe("other-value");
  });

  test("should prefer GITHUB_TOKEN when both exist", () => {
    const env = {
      GITHUB_TOKEN: "github-token-primary",
      GH_TOKEN: "gh-token-secondary",
      OTHER_VAR: "other-value",
    };

    const result = synchronizeGitHubTokens(env);

    expect(result.GITHUB_TOKEN).toBe("github-token-primary");
    expect(result.GH_TOKEN).toBe("github-token-primary");
    expect(result.OTHER_VAR).toBe("other-value");
  });

  test("should handle undefined values in env", () => {
    const env: Record<string, string | undefined> = {
      GITHUB_TOKEN: undefined,
      GH_TOKEN: "gh-token",
      OTHER_VAR: undefined,
    };

    const result = synchronizeGitHubTokens(env);

    expect(result.GITHUB_TOKEN).toBe("gh-token");
    expect(result.GH_TOKEN).toBe("gh-token");
    expect(result.OTHER_VAR).toBeUndefined();
  });

  test("should return new object without mutating original", () => {
    const env: Record<string, string | undefined> = {
      GITHUB_TOKEN: "test-token",
    };

    const result = synchronizeGitHubTokens(env);

    expect(result).not.toBe(env);
    expect(env.GH_TOKEN).toBeUndefined();
    expect(result.GH_TOKEN).toBe("test-token");
  });
});
