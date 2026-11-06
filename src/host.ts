// Bridges to the claude.ai artifact runtime when Hookky is hosted there.
// Elsewhere `window.claude` is absent and every capability resolves to null.

type SampleFn = ((input: string | { role: "user" | "assistant"; content: string }[], opts?: Record<string, unknown>) => Promise<{ text: string; truncated: boolean }>) & {
  limits?: () => Promise<{ images?: { maxCount: number; mediaTypes: string[] }; tools?: { maxCount: number } }>;
};
type DownloadsNs = { save: (r: { filename: string; data: Blob | string }) => Promise<{ status: string }> };

const runtime = (window as any).claude as { use: (n: string) => Promise<any> } | undefined;

export const isHosted = !!runtime?.use;
export const sampleCap: Promise<SampleFn | null> = isHosted ? runtime!.use("sample").catch(() => null) : Promise.resolve(null);
export const downloadsCap: Promise<DownloadsNs | null> = isHosted ? runtime!.use("downloads").catch(() => null) : Promise.resolve(null);

export async function sampleLimits() {
  const s = await sampleCap;
  return (await s?.limits?.().catch(() => null)) ?? null;
}
