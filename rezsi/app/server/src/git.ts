import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { redact, registerSecret } from './log.js';

export interface GitConfig {
  dir: string;
  /** HTTPS URL of the remote; empty = local repository only. */
  url: string;
  token: string;
  branch: string;
  authorName: string;
  authorEmail: string;
}

export class GitError extends Error {}

/**
 * Small wrapper around the git CLI. The token never appears on the command line or in
 * .git/config: it is passed as an HTTP header through GIT_CONFIG_* environment variables.
 */
export class Git {
  constructor(private readonly cfg: GitConfig) {
    registerSecret(cfg.token);
    if (cfg.token) registerSecret(Buffer.from(`x-access-token:${cfg.token}`).toString('base64'));
    // Credentials embedded in the URL must not leak into logs either.
    try {
      const u = new URL(cfg.url);
      registerSecret(decodeURIComponent(u.password));
    } catch {
      /* not a URL (empty) */
    }
  }

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: this.cfg.authorName,
      GIT_AUTHOR_EMAIL: this.cfg.authorEmail,
      GIT_COMMITTER_NAME: this.cfg.authorName,
      GIT_COMMITTER_EMAIL: this.cfg.authorEmail,
    };
    if (this.cfg.token) {
      const basic = Buffer.from(`x-access-token:${this.cfg.token}`).toString('base64');
      env.GIT_CONFIG_COUNT = '1';
      env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
      env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
    }
    return env;
  }

  run(args: string[], { allowFail = false } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.cfg.dir, env: this.env(), timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
        if (err && !allowFail) {
          reject(new GitError(redact(`git ${args[0]} failed (${code}): ${(stderr || err.message).trim()}`)));
        } else {
          resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
        }
      });
    });
  }

  private async hasCommits(): Promise<boolean> {
    return (await this.run(['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true })).code === 0;
  }

  private async remoteBranchExists(): Promise<boolean> {
    const ref = `refs/remotes/origin/${this.cfg.branch}`;
    return (await this.run(['rev-parse', '--verify', '-q', ref], { allowFail: true })).code === 0;
  }

  /** Makes sure the local repository exists and is up to date with the remote. */
  async prepare(): Promise<void> {
    const { dir, url, branch } = this.cfg;
    await mkdir(dir, { recursive: true });
    if (!existsSync(join(dir, '.git'))) {
      await this.run(['init', '-q', '-b', branch]);
    }
    const head = (await this.run(['symbolic-ref', '--short', 'HEAD'], { allowFail: true })).stdout.trim();
    if (head !== branch) await this.run(['checkout', '-q', '-B', branch]);
    if (!url) return;

    const remotes = (await this.run(['remote'])).stdout.split('\n').map((s) => s.trim());
    await this.run(remotes.includes('origin') ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
    await this.run(['fetch', '-q', 'origin']);
    if (!(await this.remoteBranchExists())) return;
    if (!(await this.hasCommits())) {
      await this.run(['reset', '-q', '--hard', `origin/${branch}`]);
      return;
    }
    const rebase = await this.run(['rebase', '-q', `origin/${branch}`], { allowFail: true });
    if (rebase.code !== 0) {
      await this.run(['rebase', '--abort'], { allowFail: true });
      throw new GitError(redact(`Cannot rebase local export commits onto origin/${branch}: ${rebase.stderr.trim()}`));
    }
  }

  /** Stages everything; commits only when something changed. Returns the new commit hash. */
  async commitAll(message: string): Promise<string | undefined> {
    await this.run(['add', '-A']);
    const diff = await this.run(['diff', '--cached', '--quiet'], { allowFail: true });
    if (diff.code === 0) return undefined;
    await this.run(['commit', '-q', '-m', message]);
    return (await this.run(['rev-parse', '--short', 'HEAD'])).stdout.trim();
  }

  /** Pushes when there is something the remote does not have. Returns true if pushed. */
  async push(): Promise<boolean> {
    if (!this.cfg.url || !(await this.hasCommits())) return false;
    if (await this.remoteBranchExists()) {
      const ahead = (await this.run(['rev-list', '--count', `origin/${this.cfg.branch}..HEAD`])).stdout.trim();
      if (ahead === '0') return false;
    }
    await this.run(['push', '-q', 'origin', `HEAD:refs/heads/${this.cfg.branch}`]);
    await this.run(['fetch', '-q', 'origin'], { allowFail: true });
    return true;
  }

  async head(): Promise<string | undefined> {
    const r = await this.run(['rev-parse', '--short', 'HEAD'], { allowFail: true });
    return r.code === 0 ? r.stdout.trim() : undefined;
  }
}
