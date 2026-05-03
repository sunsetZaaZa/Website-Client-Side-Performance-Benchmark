import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';

export interface ScreenshotOptions {
  page: Page;
  path: string;
  fullPage: boolean;
}

export async function captureScreenshot(options: ScreenshotOptions): Promise<void> {
  fs.mkdirSync(path.dirname(options.path), { recursive: true });
  await options.page.screenshot({
    path: options.path,
    fullPage: options.fullPage,
  });
}
