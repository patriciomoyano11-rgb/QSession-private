export type RoomInvitation = {
  room?: string;
  server?: string;
};

function cleanRoom(value?: string | null): string | undefined {
  const room = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(room) ? room : undefined;
}

export function parseRoomInvitation(value: string): RoomInvitation {
  const input = value.trim();
  if (!input) return {};

  try {
    if (/^qsession:\/\/join\?/i.test(input)) {
      const query = input.slice(input.indexOf('?') + 1);
      const values: Record<string, string> = {};
      for (const pair of query.split('&')) {
        const [key, rawValue = ''] = pair.split('=');
        values[decodeURIComponent(key)] = decodeURIComponent(rawValue);
      }
      return {room: cleanRoom(values.room), server: values.server?.trim() || undefined};
    }

    if (/^https?:\/\//i.test(input)) {
      const urlMatch = input.match(/^(https?):\/\/([^/]+)(\/.*)?$/i);
      if (!urlMatch) return {};
      const path = urlMatch[3] || '/';
      const joinMatch = path.match(/^\/join\/([A-Z0-9]{6})(?:[/?#]|$)/i);
      const queryMatch = path.match(/[?&]room=([A-Z0-9]{6})(?:[&#]|$)/i);
      return {
        room: cleanRoom(joinMatch?.[1] || queryMatch?.[1]),
        server: `${urlMatch[1].toLowerCase()}://${urlMatch[2]}`,
      };
    }

    if (/^wss?:\/\//i.test(input)) return {server: input};
    if (/^[A-Za-z0-9.-]+(?::\d+)?(?:\/.*)?$/.test(input)) return {server: input};
  } catch {
    return {};
  }

  return {};
}

export async function roomIsActiveOnServer(
  server: string,
  roomCode: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 4500,
): Promise<boolean> {
  const room = cleanRoom(roomCode);
  if (!room) return false;
  let base = server.trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:').replace(/\/ws$/i, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${base}/api/rooms/${room}`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.ok === true && payload?.room?.status !== 'archived';
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
