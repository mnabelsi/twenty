import { type OAuthConnectionProviderConfig } from '@/application/oauthConnectionProviderConfigType';
import { type SyncableEntityOptions } from '@/application/syncableEntityOptionsType';

export const CONNECTION_PROVIDER_SCOPES = ['WORKSPACE', 'USER'] as const;

export type ConnectionProviderScope =
  (typeof CONNECTION_PROVIDER_SCOPES)[number];

export const isConnectionProviderScope = (
  scope: string,
): scope is ConnectionProviderScope =>
  (CONNECTION_PROVIDER_SCOPES as readonly string[]).includes(scope);

export const DEFAULT_CONNECTION_PROVIDER_SCOPE: ConnectionProviderScope =
  'WORKSPACE';

export type ConnectionProviderManifest = SyncableEntityOptions & {
  name: string;
  displayName: string;
  logo?: string;
  type: 'oauth';
  scope?: ConnectionProviderScope;
  oauth: OAuthConnectionProviderConfig;
  identifyAccountLogicFunction?: SyncableEntityOptions;
  onConnectLogicFunction?: SyncableEntityOptions;
  onDisconnectLogicFunction?: SyncableEntityOptions;
};
