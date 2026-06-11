import fs from 'node:fs';

export interface PlaywrightStatus {
  ok: boolean;
  installed: boolean;
  version: string | null;
  chromium: boolean;
  firefox: boolean;
  webkit: boolean;
}

async function resolveExecutableExists(browserName: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright');
    const browserType = playwright[browserName];
    if (!browserType || typeof browserType.executablePath !== 'function') return false;
    const executablePath = browserType.executablePath();
    return Boolean(executablePath && fs.existsSync(executablePath));
  } catch {
    return false;
  }
}

async function resolveVersion(): Promise<string | null> {
  try {
    const pkg = await import('playwright/package.json');
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export async function getPlaywrightStatus(): Promise<PlaywrightStatus> {
  const version = await resolveVersion();
  if (!version) {
    return {
      ok: true,
      installed: false,
      version: null,
      chromium: false,
      firefox: false,
      webkit: false,
    };
  }

  const [chromium, firefox, webkit] = await Promise.all([
    resolveExecutableExists('chromium'),
    resolveExecutableExists('firefox'),
    resolveExecutableExists('webkit'),
  ]);

  return {
    ok: true,
    installed: true,
    version,
    chromium,
    firefox,
    webkit,
  };
}
