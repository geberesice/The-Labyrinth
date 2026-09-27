// Extra powers when the game runs as the desktop app (see electron/preload.cjs).
interface DesktopBridge {
  saveLevelFile(name: string, text: string): Promise<string | null>;
  openLevelFile(): Promise<{ name: string; text: string } | null>;
}

export const desktop: DesktopBridge | undefined = (window as unknown as { desktop?: DesktopBridge }).desktop;
