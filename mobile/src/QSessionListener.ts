export type ListenerState =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'live'
  | 'reconnecting'
  | 'ended'
  | 'error';

export type ListenerCallbacks = {
  onState: (state: ListenerState, detail?: string) => void;
  onListenerCount: (count: number) => void;
  onRoom?: (room: QSessionRoomInfo | null) => void;
  onChatMessage?: (message: QSessionChatMessage) => void;
  onChatHistory?: (messages: QSessionChatMessage[]) => void;
  onRoomChatMicrophone?: (enabled: boolean) => void;
  onProfileSet?: () => void;
  onReportReceived?: () => void;
  onAudioLevel?: (level: number) => void;
  onVideoStream?: (streamURL: string | null) => void;
  onBroadcastPlayback?: (url: string | null) => void;
  onSocialVideos?: (videos: QSessionSocialVideo[]) => void;
  onSocialCameraStream?: (streamURL: string | null) => void;
  onParticipants?: (participants: QSessionParticipant[], selfId?: string) => void;
  onPrivateChats?: (chats: QSessionPrivateChat[]) => void;
  onPrivateChatOpened?: (chatId: string) => void;
  onPrivateChatInvite?: (chatId: string) => void;
  onPrivateMessage?: (chatId: string, message: QSessionPrivateMessage) => void;
  onPrivateChatError?: (message: string) => void;
  onLiveChatState?: (state: QSessionLiveChatState) => void;
  onLiveChatVideos?: (videos: QSessionLiveChatVideo[]) => void;
};

export type QSessionRoomInfo = {
  name?: string | null;
  djName?: string | null;
  description?: string | null;
  promotions?: Array<{
    id?: string;
    sponsor: string;
    headline?: string | null;
    linkUrl?: string | null;
    media?: {
      id: string;
      url: string;
      contentType: string;
    } | null;
  }>;
};

export type QSessionApproximateLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
  countryCode?: string;
};

export type QSessionSocialVideo = {
  participantId: string;
  streamURL: string;
};

export type QSessionChatMessage = {
  id: string;
  author: string;
  kind: 'text' | 'reaction' | 'notice';
  text: string;
  createdAt: string;
};

export type QSessionParticipant = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  photos?: Array<{id: string; url: string; caption?: string | null}>;
  stories?: Array<{id: string; text?: string | null; mediaUrl?: string | null; createdAt: string; expiresAt: string}>;
  city?: string | null;
  bio?: string | null;
  interests: string[];
  visible: boolean;
  canMessage: boolean;
  canMatch: boolean;
  online: boolean;
  status?: 'accepted' | 'pending' | 'declined';
};

export type QSessionPrivateMessage = {
  id: string;
  chatId: string;
  senderId: string;
  author: string;
  kind?: 'text' | 'voice' | 'image' | 'video';
  text: string;
  audio?: {dataUrl: string; mimeType: string; durationMs: number; url?: string};
  createdAt: string;
};

export type QSessionPrivateChat = {
  id: string;
  kind: 'direct' | 'group';
  title: string;
  createdBy: string;
  status: 'accepted' | 'pending';
  members: QSessionParticipant[];
  messages: QSessionPrivateMessage[];
  liveVoiceEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QSessionLiveChatState = {
  chatId: string;
  status: 'idle' | 'connecting' | 'live' | 'error';
  micEnabled: boolean;
  soundEnabled: boolean;
  participants: number;
  cameraEnabled?: boolean;
  message?: string;
};

export type QSessionLiveChatVideo = {
  participantId: string;
  displayName: string;
  streamURL: string;
  local?: boolean;
};

export type QSessionServerFeatures = {
  accounts: boolean;
  profiles: boolean;
  stories: boolean;
  roomParticipants: boolean;
  privateChats: boolean;
  privateContactInvites: boolean;
  voiceNotes: boolean;
  liveChat: boolean;
  socialCamera: boolean;
};

export type QSessionServerStatus = {
  ok: boolean;
  version: string;
  transport?: 'sfu';
  features: QSessionServerFeatures;
};

export function normalizeServerUrl(value: string): string {
  let server = String(value || '').trim();
  if (!server) throw new Error('Escribe la dirección de Q Session.');
  if (!/^https?:\/\//i.test(server) && !/^wss?:\/\//i.test(server)) server = `https://${server}`;
  server = server.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  const match = server.match(/^(https?):\/\/([^/?#]+)(?:[/?#].*)?$/i);
  if (!match) throw new Error('La dirección de Q Session no es válida.');
  return `${match[1].toLowerCase()}://${match[2]}`;
}

export async function verifyQSessionServer(value: string): Promise<QSessionServerStatus> {
  const serverUrl = normalizeServerUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${serverUrl}/api/status`, {signal: controller.signal});
    if (!response.ok) throw new Error(`El servidor respondió ${response.status}.`);
    const status = await response.json();
    if (!status?.ok || status?.media?.transport !== 'sfu') {
      throw new Error('La respuesta no corresponde al servicio actual de Q Session.');
    }
    const features = status.features && typeof status.features === 'object' ? status.features : {};
    return {
      ok: true,
      version: String(status.version || 'anterior'),
      transport: 'sfu',
      features: {
        accounts: features.accounts === true,
        profiles: features.profiles === true,
        stories: features.stories === true,
        roomParticipants: features.roomParticipants === true,
        privateChats: features.privateChats === true,
        privateContactInvites: features.privateContactInvites === true,
        voiceNotes: features.voiceNotes === true,
        liveChat: features.liveChat === true,
        socialCamera: features.socialCamera === true,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Q Session no respondió. Revisa tu conexión a Internet.');
    }
    throw new Error(
      error instanceof Error && (error.message.startsWith('El servidor') || error.message.startsWith('La respuesta'))
        ? error.message
        : 'No encontramos Q Session en esa dirección.',
    );
  } finally {
    clearTimeout(timeout);
  }
}
