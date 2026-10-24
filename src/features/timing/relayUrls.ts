interface TimingEnvironment { PROD?: boolean; VITE_TIMER_RELAY_URL?: string; VITE_PUBLIC_SITE_URL?: string }
const environment = (import.meta as ImportMeta & { env?: TimingEnvironment }).env ?? {};

export function publicHttpsOrigin(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.') ||
    url.pathname !== '/' || url.search || url.hash) throw new Error('Use a public HTTPS origin without a path.');
  return url.origin;
}

export function relayBaseUrl(env: TimingEnvironment = environment): string {
  if (env.VITE_TIMER_RELAY_URL) return publicHttpsOrigin(env.VITE_TIMER_RELAY_URL);
  if (env.PROD) throw new Error('Production timing relay URL is missing. Use single-device timing until configured.');
  return '';
}

export function timingJoinUrl(sessionId: string, joinToken: string,
  env: TimingEnvironment = environment, origin = window.location.origin): string {
  try {
    const base = env.VITE_PUBLIC_SITE_URL ? publicHttpsOrigin(env.VITE_PUBLIC_SITE_URL)
      : env.PROD ? publicHttpsOrigin(origin) : origin;
    return `${base}/timing/join#${new URLSearchParams({ id: sessionId, key: joinToken })}`;
  } catch { return ''; }
}
