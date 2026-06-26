export const isVercel = (): boolean => process.env.VERCEL === '1';

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

export const canUseBrowserAutomation = (): boolean =>
  !isVercel() && process.env.DISABLE_PUPPETEER !== '1';

export const canUseLocalBinaries = (): boolean =>
  !isVercel() || process.env.ENABLE_LOCAL_BINARIES === '1';

export function devLog(...args: unknown[]): void {
  if (!isProduction()) {
    console.log(...args);
  }
}
