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
import { createOneLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/create-logic-function.util';
import { deleteLogicFunction } from 'test/integration/metadata/suites/logic-function/utils/delete-logic-function.util';
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

describe('Logic functions of other applications should be out of an installed application agent reach', () => {
  let ownerApplication: ApplicationWithResources;
  let readerApplication: ApplicationWithResources;
  let readerAgentUniversalIdentifier: string;
  let readerAgentRoleId: string;
  let ownerToolName: string;
  let ownerApplicationToken: string;
  let workspaceLogicFunctionId: string;

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

    // offers the agent the workflow tools, so only the application rule refuses them
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

    const { data: logicFunctionData } = await createOneLogicFunction({
      input: { name: 'Workspace logic function' },
      expectToFail: false,
    });

    workspaceLogicFunctionId = logicFunctionData.createOneLogicFunction.id;
  }, 180000);

  afterAll(async () => {
    if (isDefined(workspaceLogicFunctionId)) {
      await deleteLogicFunction({
        input: { id: workspaceLogicFunctionId },
        expectToFail: false,
      });
    }

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

  it('should let an installed application agent read workflows', async () => {
    const output = await runReaderAgentWithTool({
      toolName: 'list_workflows',
      toolArguments: {},
    });

    expect(output).toEqual({
      type: 'json',
      value: expect.objectContaining({ success: true }),
    });
  });

  it.each([
    {
      title: 'run another application logic function tool',
      request: () => ({ toolName: ownerToolName, toolArguments: {} }),
    },
    {
      title: 'read another application logic function source',
      request: () => ({
        toolName: 'get_logic_function_source',
        toolArguments: { logicFunctionId: ownerApplication.logicFunctionId },
      }),
    },
    {
      title: 'read a workspace logic function source',
      request: () => ({
        toolName: 'get_logic_function_source',
        toolArguments: { logicFunctionId: workspaceLogicFunctionId },
      }),
    },
    {
      title: 'rewrite a workspace logic function source',
      request: () => ({
        toolName: 'update_logic_function_source',
        toolArguments: {
          logicFunctionId: workspaceLogicFunctionId,
          code: 'export const main = async () => ({});',
        },
      }),
    },
    {
      title: 'list the logic functions workflows can run',
      request: () => ({
        toolName: 'list_logic_function_tools',
        toolArguments: {},
      }),
    },
  ])(
    'should refuse an installed application agent to $title',
    async ({ request }) => {
      const { toolName, toolArguments } = request();

      const output = await runReaderAgentWithTool({ toolName, toolArguments });

      expect(output).toEqual({
        type: 'json',
        value: expect.objectContaining({
          success: false,
          message: `Tool "${toolName}" is not available`,
        }),
      });
    },
  );
});
