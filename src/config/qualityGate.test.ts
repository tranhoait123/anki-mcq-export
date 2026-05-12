import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (path: string): string =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('release hardening configuration', () => {
  it('keeps Firebase Hosting configured as a Vite SPA with immutable hashed assets', () => {
    const firebaseConfig = JSON.parse(readRepoFile('firebase.json'));
    const hosting = firebaseConfig.hosting;

    expect(hosting.public).toBe('dist');
    expect(hosting.rewrites).toContainEqual({
      source: '**',
      destination: '/index.html',
    });
    expect(hosting.headers).toContainEqual({
      source: '/assets/**',
      headers: [{
        key: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      }],
    });
    expect(hosting.headers).toContainEqual({
      source: '**/*.html',
      headers: [{
        key: 'Cache-Control',
        value: 'no-cache',
      }],
    });
  });

  it('runs the full quality gate before Firebase preview and production deploys', () => {
    const previewWorkflow = readRepoFile('.github/workflows/firebase-hosting-pull-request.yml');
    const productionWorkflow = readRepoFile('.github/workflows/firebase-hosting-merge.yml');

    for (const workflow of [previewWorkflow, productionWorkflow]) {
      const installIndex = workflow.indexOf('npm ci');
      const browserIndex = workflow.indexOf('npx playwright install --with-deps chromium');
      const gateIndex = workflow.indexOf('npm run test:all');
      const deployIndex = workflow.indexOf('firebase-tools@latest');

      expect(installIndex).toBeGreaterThan(-1);
      expect(browserIndex).toBeGreaterThan(installIndex);
      expect(workflow).toContain('actions/checkout@v6');
      expect(workflow).toContain('actions/setup-node@v6');
      expect(workflow).toContain('GOOGLE_APPLICATION_CREDENTIALS');
      expect(gateIndex).toBeGreaterThan(browserIndex);
      expect(deployIndex).toBeGreaterThan(gateIndex);
    }
  });

  it('keeps a secret-free CI quality gate for pull requests and main', () => {
    const workflow = readRepoFile('.github/workflows/quality-gate.yml');

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('branches:');
    expect(workflow).toContain('- main');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('actions/checkout@v6');
    expect(workflow).toContain('actions/setup-node@v6');
    expect(workflow).toContain('npx playwright install --with-deps chromium');
    expect(workflow).toContain('npm run test:all');
    expect(workflow).not.toContain('FIREBASE_SERVICE_ACCOUNT');
  });

  it('documents the Google skill map, release smoke matrix, and security guardrails', () => {
    const playbook = readRepoFile('docs/google-cloud-skills-playbook.md');
    const release = readRepoFile('docs/release-hardening.md');
    const security = readRepoFile('docs/security.md');

    expect(playbook).toContain('Gemini API in Agent Platform');
    expect(playbook).toContain('Firebase Basics');
    expect(playbook).toContain('WAF Reliability');
    expect(playbook).toContain('WAF Security');
    expect(playbook).toContain('Cost Optimization');
    expect(release).toContain('Smoke Matrix');
    expect(release).toContain('PDF text');
    expect(release).toContain('Pause/resume/reload');
    expect(security).toContain('Do not commit API keys');
    expect(security).toContain('Firebase service accounts');
    expect(security).toContain('browser-first app');
  });
});
