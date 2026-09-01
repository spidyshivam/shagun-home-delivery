/* Minimal GitHub Contents API client — enough to read and write the menu,
   the locked token, and dish photos, straight from the browser. */

import { toB64, fromB64 } from "./bytes.js";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export function createClient({ owner, repo, branch = "main", token }) {
  if (!owner || !repo) throw new Error("createClient needs an owner and a repo");
  const base = `/repos/${owner}/${repo}`;

  async function request(path, { method = "GET", body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store"
    });

    if (res.status === 204) return null;

    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }

    if (!res.ok) {
      throw new GitHubError(data?.message || `GitHub returned ${res.status}`, res.status);
    }
    return data;
  }

  return {
    owner, repo, branch,
    slug: `${owner}/${repo}`,

    /* Cheapest call that proves the token works and can see the repo. */
    checkAccess() { return request(base); },

    async getFile(path) {
      try {
        return await request(
          `${base}/contents/${path}?ref=${encodeURIComponent(branch)}`
        );
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },

    async readJSON(path) {
      const file = await this.getFile(path);
      if (!file) return { data: null, sha: null };
      return { data: JSON.parse(fromB64(file.content)), sha: file.sha };
    },

    putFile(path, base64, message, sha) {
      const body = { message, content: base64, branch };
      if (sha) body.sha = sha;
      return request(`${base}/contents/${path}`, { method: "PUT", body });
    },

    /* Re-read the sha immediately before writing, so a concurrent edit from
       another device fails loudly instead of being silently clobbered. */
    async writeJSON(path, value, message) {
      const current = await this.getFile(path);
      const body = toB64(JSON.stringify(value, null, 2) + "\n");
      return this.putFile(path, body, message, current?.sha);
    }
  };
}

/* Turn an API failure into something a shop owner can act on. */
export function explainError(err, slug) {
  if (err?.status === 401) {
    return "That GitHub token was not accepted. Check you pasted the whole thing.";
  }
  if (err?.status === 404) {
    return `The token is valid, but it cannot see ${slug}. Give it access to that ` +
           "repository, or fix the names in config.js.";
  }
  if (err?.status === 409) {
    return "Someone else changed this file while you were editing. Reload and redo your change.";
  }
  return err?.message || "Something went wrong talking to GitHub.";
}
