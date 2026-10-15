import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';

import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { resolveAgentCallingApplication } from 'src/engine/metadata-modules/ai/ai-agent-execution/utils/resolve-agent-calling-application.util';

const WORKSPACE_CUSTOM_APPLICATION_ID = 'workspace-custom-application-id';

const buildApplication = (
  application: Pick<FlatApplication, 'id' | 'universalIdentifier'>,
) => application as FlatApplication;

describe('resolveAgentCallingApplication', () => {
  it('scopes an installed application agent to its application', () => {
    const installedApplication = buildApplication({
      id: 'installed-application-id',
      universalIdentifier: 'installed-application-universal-identifier',
    });

    expect(
      resolveAgentCallingApplication({
        agentApplication: installedApplication,
        workspaceCustomApplicationId: WORKSPACE_CUSTOM_APPLICATION_ID,
      }),
    ).toBe(installedApplication);
  });

  it('keeps a workspace-wide reach for an agent of the workspace custom application', () => {
    expect(
      resolveAgentCallingApplication({
        agentApplication: buildApplication({
          id: WORKSPACE_CUSTOM_APPLICATION_ID,
          universalIdentifier:
            'workspace-custom-application-universal-identifier',
        }),
        workspaceCustomApplicationId: WORKSPACE_CUSTOM_APPLICATION_ID,
      }),
    ).toBeUndefined();
  });

  it('keeps a workspace-wide reach for an agent of the Twenty standard application', () => {
    expect(
      resolveAgentCallingApplication({
        agentApplication: buildApplication({
          id: 'twenty-standard-application-id',
          universalIdentifier: TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
        }),
        workspaceCustomApplicationId: WORKSPACE_CUSTOM_APPLICATION_ID,
      }),
    ).toBeUndefined();
  });
});
