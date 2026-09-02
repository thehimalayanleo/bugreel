import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicRepositories, parseGitHubUsername, publicRepositorySummary } from "./github.js";

test("accepts GitHub usernames and rejects unsafe path-like input", () => {
  assert.equal(parseGitHubUsername("thehimalayanleo"), "thehimalayanleo");
  assert.throws(() => parseGitHubUsername("owner/repo"), /valid GitHub username/);
  assert.throws(() => parseGitHubUsername("-leading-dash"), /valid GitHub username/);
});

test("maps only analyzable public repositories from a profile", async () => {
  const result = await fetchPublicRepositories("example-user", {
    fetchImpl: async (url) => {
      assert.match(url, /users\/example-user\/repos/);
      return new Response(JSON.stringify([
        { name: "open", full_name: "example-user/open", html_url: "https://github.com/example-user/open", description: "Open source", language: "JavaScript", default_branch: "main", stargazers_count: 3, updated_at: "2026-09-01T00:00:00Z", private: false, fork: false, archived: false },
        { name: "fork", html_url: "https://github.com/example-user/fork", fork: true },
        { name: "archived", html_url: "https://github.com/example-user/archived", archived: true }
      ]), { status: 200 });
    }
  });
  assert.equal(result.username, "example-user");
  assert.deepEqual(result.repositories, [{ name: "open", fullName: "example-user/open", url: "https://github.com/example-user/open", description: "Open source", language: "JavaScript", updatedAt: "2026-09-01T00:00:00Z", defaultBranch: "main", stars: 3 }]);
  assert.equal(publicRepositorySummary({ private: true, html_url: "https://github.com/x/y" }), null);
});
