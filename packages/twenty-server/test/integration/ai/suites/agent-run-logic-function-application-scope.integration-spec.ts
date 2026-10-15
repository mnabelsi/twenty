import { type LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import gql from 'graphql-tag';
import { TEST_AI_MODEL_ID } from 'test/integration/constants/test-ai-model-ids.constants';
import { getMcpToolCatalog } from 'test/integration/graphql/suites/application-role-intersection/utils/get-mcp-tool-catalog.util';
import { runAgentQueryFactory } from 'test/integration/graphql/suites/user-session/utils/run-agent-query-factory.util';
import { cleanupApplicationAndAppRegistration } from 'test/integration/metadata/suites/application/utils/cleanup-application-and-app-registration.util';
import {
  type ApplicationWithResources,
  setupApplicationWithResources,
} from 'test/integration/metadata/suites/application/utils/setup-application-with-resources.util';
import { createOneRole } from 'test/integration/metadata/suites/role/utils/create-one-role.util';
import { deleteOneRole } from 'test/integration/metadata/suites/role/utils/delete-one-role.util';
import { upsertPermissionFlags } from 'test/integration/metadata/suites/role-permission-flag/utils/upsert-permission-flags.util';
import { makeMetadataApiRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { generateApplicationTokenPair } from 'test/integration/utils/generate-application-token-pair.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { ToolCategory } from 'twenty-shared/ai';
import { PermissionFlagType } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';

import { buildLogicFunctionToolName } from 'src/engine/core-modules/tool-provider/utils/build-logic-function-tool-name.util';
import {
  type AiModelRegistryService,
  type RegisteredAiModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const TOOL_CALL_ID = 'reach-attempt';

// The model asks for one tool through execute_tool, then answers, so the test sees what the run returned
const mockModelExecutingTool = ({
  toolName,
  toolArguments,
}: {
  toolName: string;
  toolArguments: Record<string, unknown>;
}): { output?: unknown } => {
  const toolResult: { output?: unknown } = {};
  const model = new MockLanguageModelV4({
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      const resultPart = options.prompt
        .flatMap((message) => (message.role === 'tool' ? message.content : []))
        .find(
          (part) =>
            part.type === 'tool-result' && part.toolCallId === TOOL_CALL_ID,
        );

      if (!isDefined(resultPart) || resultPart.type !== 'tool-result') {
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: TOOL_CALL_ID,
              toolName: 'execute_tool',
              input: JSON.stringify({ toolName, arguments: toolArguments }),
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }

      toolResult.output = resultPart.output;

      return {
        content: [{ type: 'text', text: 'Done' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });

  jest
    .spyOn(
      getAppProviderByClassName<AiModelRegistryService>(
        'AiModelRegistryService',
      ),
      'resolveModelForAgent',
    )
    .mockReturnValue({
      modelId: TEST_AI_MODEL_ID,
      sdkPackage: '@ai-sdk/openai',
      model,
    } as unknown as RegisteredAiModel);

  return toolResult;
};

describe('Another application logic function should be out of an agent run reach', () => {
  let ownerApplication: ApplicationWithResources;
  let readerApplication: ApplicationWithResources;
  let readerAgentUniversalIdentifier: string;
  let readerAgentRoleId: string;
  let ownerToolName: string;
  let ownerApplicationToken: string;

  const runReaderAgentWithTool = async (request: {
    toolName: string;
    toolArguments: Record<string, unknown>;
  }) => {
    const toolResult = mockModelExecutingTool(request);

    const response = await makeMetadataApiRequest(
      runAgentQueryFactory({
        agentUniversalIdentifier: readerAgentUniversalIdentifier,
        prompt: 'Run',
      }),
      APPLE_JANE_ADMIN_ACCESS_TOKEN,
    );

    expect(response.body.errors).toBeUndefined();

    return toolResult.output;
  };

  beforeAll(async () => {
    ownerApplication = await setupApplicationWithResources({
      name: 'Logic Function Owner',
    });
    readerApplication = await setupApplicationWithResources({
      name: 'Logic Function Reader',
    });

    const [{ name: ownerLogicFunctionName }] =
      await globalThis.testDataSource.query(
        `SELECT name FROM core."logicFunction" WHERE id = $1`,
        [ownerApplication.logicFunctionId],
      );

    ownerToolName = buildLogicFunctionToolName(ownerLogicFunctionName);

    [{ universalIdentifier: readerAgentUniversalIdentifier }] =
      await globalThis.testDataSource.query(
        `SELECT "universalIdentifier" FROM core."agent" WHERE id = $1`,
        [readerApplication.agentId],
      );

    const { data } = await createOneRole({
      input: {
        label: 'Logic function reader agent',
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canBeAssignedToAgents: true,
      },
      expectToFail: false,
    });

    readerAgentRoleId = data.createOneRole.id;

    // offers the agent get_logic_function_source
    await upsertPermissionFlags({
      expectToFail: false,
      input: {
        roleId: readerAgentRoleId,
        permissionFlagKeys: [PermissionFlagType.WORKFLOWS],
      },
    });

    const assignResponse = await makeMetadataApiRequest({
      query: gql`
        mutation AssignRoleToAgent($agentId: UUID!, $roleId: UUID!) {
          assignRoleToAgent(agentId: $agentId, roleId: $roleId)
        }
      `,
      variables: {
        agentId: readerApplication.agentId,
        roleId: readerAgentRoleId,
      },
    });

    expect(assignResponse.body.errors).toBeUndefined();

    const { applicationAccessToken } = await generateApplicationTokenPair({
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      applicationId: ownerApplication.id,
    });

    ownerApplicationToken = applicationAccessToken.token;
  }, 180000);

  afterAll(async () => {
    for (const application of [ownerApplication, readerApplication]) {
      if (isDefined(application)) {
        await cleanupApplicationAndAppRegistration({
          applicationUniversalIdentifier: application.universalIdentifier,
        });
      }
    }

    if (isDefined(readerAgentRoleId)) {
      await deleteOneRole({
        input: { idToDelete: readerAgentRoleId },
        expectToFail: false,
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it('should offer the logic function tool to its own application', async () => {
    const catalog = await getMcpToolCatalog({ token: ownerApplicationToken });

    expect(
      (catalog[ToolCategory.LOGIC_FUNCTION] ?? []).map(({ name }) => name),
    ).toContain(ownerToolName);
  });

  it('should refuse the logic function tool to another application agent', async () => {
    const output = await runReaderAgentWithTool({
      toolName: ownerToolName,
      toolArguments: {},
    });

    expect(output).toEqual({
      type: 'json',
      value: expect.objectContaining({
        success: false,
        message: `Tool "${ownerToolName}" is not available`,
      }),
    });
  });

  it('should refuse the logic function source to another application agent', async () => {
    const output = await runReaderAgentWithTool({
      toolName: 'get_logic_function_source',
      toolArguments: { logicFunctionId: ownerApplication.logicFunctionId },
    });

    expect(output).toEqual({
      type: 'json',
      value: expect.objectContaining({
        success: false,
        error:
          'Only logic functions written in this workspace can be read or changed from source',
      }),
    });
  });
});
