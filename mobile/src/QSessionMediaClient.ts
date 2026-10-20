import {
  ListenerCallbacks,
  ListenerState,
  QSessionChatMessage,
  QSessionApproximateLocation,
  QSessionParticipant,
  QSessionPrivateChat,
  QSessionPrivateMessage,
  QSessionLiveChatState,
  QSessionLiveChatVideo,
  QSessionSocialVideo,
  QSessionRoomInfo,
} from './QSessionListener';
import {QSessionSfuListenerClient} from './QSessionSfuListener';

export type {ListenerState};
export type {QSessionApproximateLocation, QSessionChatMessage, QSessionParticipant, QSessionPrivateChat, QSessionPrivateMessage, QSessionLiveChatState, QSessionLiveChatVideo, QSessionRoomInfo, QSessionSocialVideo};
export class QSessionListenerClient {
  private callbacks: ListenerCallbacks;
  private active: QSessionSfuListenerClient | null = null;
  private outputGain = 1;
  private profileId: string | null = null;
  private accountToken = '';
  private profileEditToken = '';
  private presenceLocation: QSessionApproximateLocation | null = null;

  constructor(callbacks: ListenerCallbacks) {
    this.callbacks = callbacks;
  }

  async start(serverUrl: string, roomCode: string) {
    this.stop(false);
    this.callbacks.onState('connecting', 'Conectando con Q Session…');
    const client = new QSessionSfuListenerClient(this.callbacks);
    client.setOutputGain(this.outputGain);
    if (this.profileId) client.setProfile(this.profileId, this.accountToken, this.profileEditToken);
    if (this.presenceLocation) client.setListenerLocation(this.presenceLocation);
    this.active = client;
    return client.start(serverUrl, roomCode);
  }

  stop(reportIdle = true) {
    this.active?.stop(reportIdle);
    this.active = null;
    if (reportIdle) this.callbacks.onState('idle');
    this.callbacks.onListenerCount(0);
  }

  async resume() {
    await this.active?.resume();
  }

  fallbackToWebRtc() {
    this.active?.fallbackToWebRtc();
  }

  setPeopleVideoEnabled(enabled: boolean) {
    this.active?.setPeopleVideoEnabled(enabled);
  }

  sendChat(text: string, kind: 'text' | 'reaction' = 'text', author?: string) {
    this.active?.sendChat(text, kind, author);
  }

  async setRoomChatMicrophoneEnabled(enabled: boolean) {
    await this.active?.setRoomChatMicrophoneEnabled(enabled);
  }

  createPrivateChat(memberIds: string[], title?: string) {
    this.active?.createPrivateChat(memberIds, title);
  }

  async createPrivateContactInvitation() {
    if (!this.active) throw new Error('Entra a una sala para crear una invitación privada.');
    return this.active.createPrivateContactInvitation();
  }

  async redeemPrivateContactInvitation(code: string) {
    if (!this.active) throw new Error('Entra a una sala para aceptar una invitación privada.');
    return this.active.redeemPrivateContactInvitation(code);
  }

  async sendProfileAction(profileId: string, type: 'touch' | 'gift', gift?: 'flower' | 'star') {
    if (!this.active) throw new Error('Entra a una sala para conectar con esta persona.');
    await this.active.sendProfileAction(profileId, type, gift);
  }

  respondPrivateChat(chatId: string, accept: boolean) {
    this.active?.respondPrivateChat(chatId, accept);
  }

  sendPrivateMessage(chatId: string, text: string) {
    this.active?.sendPrivateMessage(chatId, text);
  }

  async sendPrivateVoiceMessage(chatId: string, audio: {dataUrl: string; mimeType: string; durationMs: number}) {
    if (!this.active) throw new Error('Entra a una sala antes de enviar una nota de voz.');
    await this.active.sendPrivateVoiceMessage(chatId, audio);
  }

  requestLiveChat(chatId: string, start: boolean) {
    this.active?.requestLiveChat(chatId, start);
  }

  async setLiveChatMicrophoneEnabled(enabled: boolean) {
    await this.active?.setLiveChatMicrophoneEnabled(enabled);
  }

  async setLiveChatCameraEnabled(enabled: boolean) {
    return this.active?.setLiveChatCameraEnabled(enabled) || null;
  }

  setLiveChatSoundEnabled(enabled: boolean) {
    this.active?.setLiveChatSoundEnabled(enabled);
  }

  leaveLiveChat() {
    this.active?.leaveLiveChat();
  }

  setProfile(profileId: string, accountToken = '', profileEditToken = '') {
    this.profileId = profileId || null;
    this.accountToken = accountToken;
    this.profileEditToken = profileEditToken;
    this.active?.setProfile(profileId, accountToken, profileEditToken);
  }

  setListenerLocation(location: QSessionApproximateLocation) {
    this.presenceLocation = location;
    this.active?.setListenerLocation(location);
  }

  clearListenerLocation() {
    this.presenceLocation = null;
    this.active?.clearListenerLocation();
  }

  setOutputGain(gain: number) {
    this.outputGain = Math.max(0.501, Math.min(1, Number(gain) || 1));
    this.active?.setOutputGain(this.outputGain);
  }

  async setSocialCameraEnabled(enabled: boolean): Promise<string | null> {
    if (!this.active) throw new Error('Entra a una sala antes de activar tu cámara.');
    return this.active.setSocialCameraEnabled(enabled);
  }

  reportMessage(messageId: string) {
    this.active?.reportMessage(messageId);
  }
}
