import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { isDefined } from 'twenty-shared/utils';

import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';

// An installed application's agent reaches only what that application's token
// reaches; the workspace's own agents and Twenty's keep a user's reach
export const resolveAgentCallingApplication = ({
  agentApplication,
  workspaceCustomApplicationId,
}: {
  agentApplication: FlatApplication | undefined;
  workspaceCustomApplicationId: string | undefined;
}): FlatApplication | undefined =>
  isDefined(agentApplication) &&
  agentApplication.id !== workspaceCustomApplicationId &&
  agentApplication.universalIdentifier !==
    TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER
    ? agentApplication
    : undefined;
