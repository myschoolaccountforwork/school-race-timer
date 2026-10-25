// getRandomValues also works on a school LAN served over HTTP.
export function timerId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
}
