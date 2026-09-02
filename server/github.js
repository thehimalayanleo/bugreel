const GITHUB_USERNAME = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/;

export function parseGitHubUsername(value) {
  const username = String(value || "").trim();
  if (!GITHUB_USERNAME.test(username)) {
    throw new Error("Enter a valid GitHub username.");
  }
  return username;
}

export function publicRepositorySummary(repository) {
  if (!repository || repository.private || repository.fork || repository.archived || !repository.html_url) return null;
  return {
    name: String(repository.name || "").slice(0, 120),
    fullName: String(repository.full_name || repository.name || "").slice(0, 180),
    url: String(repository.html_url),
    description: String(repository.description || "").slice(0, 280),
    language: repository.language ? String(repository.language).slice(0, 40) : null,
    updatedAt: repository.updated_at || null,
    defaultBranch: String(repository.default_branch || "main").slice(0, 120),
    stars: Number.isFinite(repository.stargazers_count) ? repository.stargazers_count : 0
  };
}

export async function fetchPublicRepositories(input, { fetchImpl = fetch } = {}) {
  const username = parseGitHubUsername(input);
  const endpoint = `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`;
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "BugReel-public-repository-picker"
    }
  });
  if (response.status === 404) throw new Error("GitHub could not find that public profile.");
  if (response.status === 403 || response.status === 429) throw new Error("GitHub public API is temporarily rate limited. Try again shortly.");
  if (!response.ok) throw new Error("GitHub could not load public repositories right now.");
  const repositories = await response.json();
  if (!Array.isArray(repositories)) throw new Error("GitHub returned an unexpected repository list.");
  return {
    username,
    repositories: repositories.map(publicRepositorySummary).filter(Boolean).slice(0, 30)
  };
}
