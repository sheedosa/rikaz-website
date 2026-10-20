// Minimal GitHub REST client for the dashboard. Everything goes through the signed-in person's own token,
// straight from the browser to api.github.com — there is no Rikaz server in between.
import { REPO } from './config.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

// UTF-8 safe base64 for text and binary.
export const b64 = {
  fromText: (s) => b64.fromBytes(new TextEncoder().encode(s)),
  fromBytes(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); },
  toText: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0))),
};

export function createClient(token) {
  const repoPath = `/repos/${REPO.owner}/${REPO.name}`;
  async function call(method, path, body, { raw = false, accept } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method, cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new GitHubError(0, 'Could not reach GitHub. Check your internet connection and try again.');
    }
    if (!res.ok) {
      let data = null; try { data = await res.json(); } catch {}
      throw new GitHubError(res.status, (data && data.message) || res.statusText, data);
    }
    if (res.status === 204) return null;
    return raw ? res.text() : res.json();
  }
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

  const api = {
    user: () => call('GET', '/user'),
    repo: () => call('GET', repoPath),
    head: async (branch) => (await call('GET', `${repoPath}/git/ref/heads/${enc(branch)}`)).object.sha,
    // Text of a file at a commit/branch.
    file: (path, ref) => call('GET', `${repoPath}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, null, { raw: true, accept: 'application/vnd.github.raw+json' }),
    // Reads the three catalogue files at one commit, so they always belong together.
    async content(ref) {
      const [brands, products, settings] = await Promise.all(['brands', 'products', 'settings'].map(f => api.file(`content/${f}.json`, ref).then(JSON.parse)));
      return { brands, products, settings };
    },
    // One commit with any number of files. `files`: [{ path, text } | { path, base64 }].
    // Fails with status 409 'moved' if the branch changed after `parentSha` (nothing is written then).
    async commit({ branch, parentSha, files, message }) {
      const parent = await call('GET', `${repoPath}/git/commits/${parentSha}`);
      const tree = [];
      for (const f of files) {
        if (f.base64 != null) {
          const blob = await call('POST', `${repoPath}/git/blobs`, { content: f.base64, encoding: 'base64' });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        } else tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text });
      }
      const newTree = await call('POST', `${repoPath}/git/trees`, { base_tree: parent.tree.sha, tree });
      const commit = await call('POST', `${repoPath}/git/commits`, { message, tree: newTree.sha, parents: [parentSha] });
      try {
        await call('PATCH', `${repoPath}/git/refs/heads/${enc(branch)}`, { sha: commit.sha, force: false });
      } catch (e) {
        if (e.status === 409 || (e.status === 422 && /fast.?forward/i.test(e.message))) throw new GitHubError(409, 'moved');
        throw e;
      }
      return commit;
    },
    async exists(path, ref) {
      try { await call('GET', `${repoPath}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, null, { accept: 'application/vnd.github.object+json' }); return true; }
      catch (e) { if (e.status === 404) return false; throw e; }
    },
    // Commits that changed the catalogue, newest first.
    history: (branch, page = 1) => call('GET', `${repoPath}/commits?sha=${encodeURIComponent(branch)}&path=content&per_page=25&page=${page}`),
    commitInfo: (sha) => call('GET', `${repoPath}/commits/${sha}`),
    runs: (branch) => call('GET', `${repoPath}/actions/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=10`),
  };
  return api;
}

// Plain-language message for an error, for the person using the dashboard.
export function explain(e) {
  if (!(e instanceof GitHubError)) return (e && e.message) || 'Something went wrong.';
  if (e.status === 0) return e.message;
  if (e.status === 401) return 'GitHub did not accept the access key. It may have expired or been deleted — sign out and sign in with a new key.';
  if (e.status === 403 && /rate limit/i.test(e.message)) return 'GitHub is limiting requests for a few minutes. Wait a moment and try again.';
  if (e.status === 403) return 'Your access key is not allowed to do this. Make sure it has “Contents: Read and write” for the Rikaz repository.';
  if (e.status === 404) return 'GitHub could not find the Rikaz repository with this access key. Check that the key was made for the right repository.';
  if (e.status === 409) return 'The catalogue changed on GitHub while you were publishing.';
  if (e.status >= 500) return 'GitHub is having trouble right now. Wait a minute and try again.';
  return `GitHub said: ${e.message}`;
}
