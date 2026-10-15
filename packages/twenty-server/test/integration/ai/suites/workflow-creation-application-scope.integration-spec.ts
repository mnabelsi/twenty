import { type LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import gql from 'graphql-tag';
import { TEST_AI_MODEL_ID } from 'test/integration/constants/test-ai-model-ids.constants';
import { callMcpTool } from 'test/integration/graphql/suites/application-role-intersection/utils/call-mcp-tool.util';
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

import {
  type AiModelRegistryService,
  type RegisteredAiModel,
} from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

const CREATE_WORKFLOW_TOOL_NAME = 'create_complete_workflow';
const LIST_WORKFLOWS_TOOL_NAME = 'list_workflows';

const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

// A lazy agent run lists its tool catalog in the instructions it sends the model
const mockModelCapturingInstructions = (): string[] => {
  const instructions: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options: LanguageModelV4CallOptions) => {
      instructions.push(
        options.prompt
          .flatMap((message) =>
            message.role === 'system' ? [message.content] : [],
          )
          .join('\n'),
      );

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

  return instructions;
};

const listMcpWorkflowToolNames = async (token: string) => {
  const catalog = await getMcpToolCatalog({ token });

  return (catalog[ToolCategory.WORKFLOW] ?? []).map(({ name }) => name);
};

describe('Workflow creation outside the workspace custom application should be refused', () => {
  let application: ApplicationWithResources;
  let agentRoleId: string;
  let agentUniversalIdentifier: string;
  let applicationToken: string;

  beforeAll(async () => {
    application = await setupApplicationWithResources({
      name: 'Workflow Creation Scope Probe',
    });

    [{ universalIdentifier: agentUniversalIdentifier }] =
      await globalThis.testDataSource.query(
        `SELECT "universalIdentifier" FROM core."agent" WHERE id = $1`,
        [application.agentId],
      );

    const { data } = await createOneRole({
      input: {
        label: 'Workflow creation scope probe',
        canReadAllObjectRecords: false,
        canUpdateAllObjectRecords: false,
        canSoftDeleteAllObjectRecords: false,
        canDestroyAllObjectRecords: false,
        canBeAssignedToAgents: true,
      },
      expectToFail: false,
    });

    agentRoleId = data.createOneRole.id;

    await upsertPermissionFlags({
      expectToFail: false,
      input: {
        roleId: agentRoleId,
        permissionFlagKeys: [PermissionFlagType.WORKFLOWS],
      },
    });

    const assignResponse = await makeMetadataApiRequest({
      query: gql`
        mutation AssignRoleToAgent($agentId: UUID!, $roleId: UUID!) {
          assignRoleToAgent(agentId: $agentId, roleId: $roleId)
        }
      `,
      variables: { agentId: application.agentId, roleId: agentRoleId },
    });

    expect(assignResponse.body.errors).toBeUndefined();

    const { applicationAccessToken } = await generateApplicationTokenPair({
      workspaceId: SEED_APPLE_WORKSPACE_ID,
      applicationId: application.id,
    });

    applicationToken = applicationAccessToken.token;
  }, 180000);

  afterAll(async () => {
    if (isDefined(application)) {
      await cleanupApplicationAndAppRegistration({
        applicationUniversalIdentifier: application.universalIdentifier,
      });
    }

    if (isDefined(agentRoleId)) {
      await deleteOneRole({
        input: { idToDelete: agentRoleId },
        expectToFail: false,
      });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it('should let a user create workflows through MCP', async () => {
    expect(
      await listMcpWorkflowToolNames(APPLE_JANE_ADMIN_ACCESS_TOKEN),
    ).toContain(CREATE_WORKFLOW_TOOL_NAME);
  });

  it('should hide workflow creation from an installed application token', async () => {
    const workflowToolNames = await listMcpWorkflowToolNames(applicationToken);

    expect(workflowToolNames).toContain(LIST_WORKFLOWS_TOOL_NAME);
    expect(workflowToolNames).not.toContain(CREATE_WORKFLOW_TOOL_NAME);
  });

  it('should refuse workflow creation to an installed application token', async () => {
    const result = await callMcpTool({
      toolName: 'execute_tool',
      toolArguments: { toolName: CREATE_WORKFLOW_TOOL_NAME, arguments: {} },
      token: applicationToken,
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).message).toBe(
      `Tool "${CREATE_WORKFLOW_TOOL_NAME}" not found`,
    );
  });

  it('should hide workflow creation from an installed application agent', async () => {
    const instructions = mockModelCapturingInstructions();

    const response = await makeMetadataApiRequest(
      runAgentQueryFactory({ agentUniversalIdentifier, prompt: 'Run' }),
      APPLE_JANE_ADMIN_ACCESS_TOKEN,
    );

    expect(response.body.errors).toBeUndefined();
    expect(instructions[0]).toContain(`\`${LIST_WORKFLOWS_TOOL_NAME}\``);
    expect(instructions[0]).not.toContain(`\`${CREATE_WORKFLOW_TOOL_NAME}\``);
  });
});
