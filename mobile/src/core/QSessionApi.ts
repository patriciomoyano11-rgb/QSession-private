import {
  CreateRoomRequest,
  CreatedRoom,
  MediaCredentials,
  QSessionRoom,
  QSESSION_PRODUCTION_ORIGIN,
} from './QSessionContracts';

export type QSessionFetch = typeof fetch;

export type BroadcastDeliveryStatus = {
  configured: boolean;
  provider?: string | null;
  roomCode: string;
  state: string;
  ready: boolean;
  playbackUrl?: string | null;
  segmentDuration?: number;
  approximateLatencySeconds?: number;
};

type JsonOptions = Omit<RequestInit, 'body'> & {body?: unknown};

export function normalizeQSessionOrigin(value = QSESSION_PRODUCTION_ORIGIN): string {
  let origin = value.trim().replace(/\/+$/, '');
  if (!origin) throw new Error('Q Session no tiene un servidor configurado.');
  if (!/^https?:\/\//i.test(origin) && !/^wss?:\/\//i.test(origin)) origin = `https://${origin}`;
  return origin
    .replace(/^ws:/i, 'http:')
    .replace(/^wss:/i, 'https:')
    .replace(/\/ws$/i, '');
}

export class QSessionApi {
  readonly origin: string;
  private readonly fetcher: QSessionFetch;
  private readonly accountToken: string;

  constructor(
    origin = QSESSION_PRODUCTION_ORIGIN,
    fetcher: QSessionFetch = fetch,
    accountToken = '',
  ) {
    this.origin = normalizeQSessionOrigin(origin);
    this.fetcher = fetcher;
    this.accountToken = accountToken.trim();
  }

  async createRoom(input: CreateRoomRequest): Promise<CreatedRoom> {
    const payload = await this.json<{
      room?: QSessionRoom;
      hostToken?: string;
      joinUrl?: string;
      mediaConfigured?: boolean;
    }>('/api/rooms', {method: 'POST', body: input});
    const code = String(payload.room?.code || '').toUpperCase();
    const hostToken = String(payload.hostToken || '');
    if (!payload.room || !/^[A-Z0-9]{6}$/.test(code) || !hostToken) {
      throw new Error('Q Session creó la sala sin entregar el control del anfitrión.');
    }
    if (payload.mediaConfigured === false) {
      throw new Error('El servidor multimedia de Q Session todavía no está disponible.');
    }
    return {
      room: {...payload.room, code},
      hostToken,
      joinUrl: String(payload.joinUrl || `${this.origin}/join/${code}`),
      mediaConfigured: true,
    };
  }

  async getRoom(code: string): Promise<QSessionRoom> {
    const roomCode = this.roomCode(code);
    const payload = await this.json<{room?: QSessionRoom}>(`/api/rooms/${roomCode}`);
    if (!payload.room) throw new Error(`La sala ${roomCode} no está disponible.`);
    return payload.room;
  }

  async listActiveRooms(): Promise<QSessionRoom[]> {
    const payload = await this.json<{rooms?: QSessionRoom[]}>('/api/rooms');
    return Array.isArray(payload.rooms) ? payload.rooms : [];
  }

  mediaCredentials(code: string, role: 'dj', hostToken: string): Promise<MediaCredentials>;
  mediaCredentials(code: string, role: 'listener', accessToken?: string): Promise<MediaCredentials>;
  async mediaCredentials(
    code: string,
    role: 'dj' | 'listener',
    credential = '',
  ): Promise<MediaCredentials> {
    const body = role === 'dj'
      ? {role, hostToken: credential}
      : {role, ...(credential ? {accessToken: credential} : {})};
    const payload = await this.json<Partial<MediaCredentials>>(
      `/api/rooms/${this.roomCode(code)}/media-token`,
      {method: 'POST', body},
    );
    if (payload.transport !== 'sfu' || !payload.url || !payload.token) {
      throw new Error('Q Session no entregó una conexión multimedia válida.');
    }
    return {
      transport: 'sfu',
      url: payload.url,
      token: payload.token,
      ...(payload.presenceTicket ? {presenceTicket: payload.presenceTicket} : {}),
      ...(Array.isArray(payload.permissions) ? {permissions: payload.permissions} : {}),
      ...(payload.delivery ? {delivery: payload.delivery} : {}),
      ...(payload.limits ? {limits: payload.limits} : {}),
    };
  }

  async endRoom(code: string, hostToken: string): Promise<QSessionRoom> {
    const payload = await this.json<{room?: QSessionRoom}>(
      `/api/rooms/${this.roomCode(code)}/end`,
      {method: 'POST', body: {hostToken}},
    );
    if (!payload.room) throw new Error('Q Session no confirmó el cierre de la sala.');
    return payload.room;
  }

  async startBroadcastDelivery(code: string, hostToken: string): Promise<BroadcastDeliveryStatus> {
    const payload = await this.json<{broadcast?: BroadcastDeliveryStatus}>(
      `/api/rooms/${this.roomCode(code)}/broadcast/start`,
      {method: 'POST', body: {hostToken}},
    );
    if (!payload.broadcast) throw new Error('Q Session no confirmó la distribución de la señal.');
    return payload.broadcast;
  }

  private roomCode(value: string): string {
    const code = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('El código debe tener seis letras o números.');
    return code;
  }

  private async json<T>(path: string, options: JsonOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.fetcher(`${this.origin}${path}`, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          accept: 'application/json',
          ...(options.body === undefined ? {} : {'content-type': 'application/json'}),
          ...(this.accountToken ? {authorization: `Bearer ${this.accountToken}`} : {}),
          ...(options.headers || {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      let payload: any = null;
      try {
        payload = await response.json();
      } catch {
        // La validación inferior convierte respuestas HTML o vacías en un error útil.
      }
      if (!response.ok) throw new Error(payload?.error || `Q Session respondió ${response.status}.`);
      if (!payload || payload.ok === false) throw new Error(payload?.error || 'Q Session respondió de forma inválida.');
      return payload as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Q Session tardó demasiado en responder. Comprueba tu conexión e inténtalo otra vez.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
