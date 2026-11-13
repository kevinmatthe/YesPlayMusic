export * from './types';
export {
  createMusicApi,
  musicApi,
  MusicApiError,
  descriptorIdentity,
} from './api';
export { createPlayer, NativePlayer } from './player';
export type { PlayerState, PlayerOptions } from './player';
export { parseLrc, withTranslation } from './lyrics';
