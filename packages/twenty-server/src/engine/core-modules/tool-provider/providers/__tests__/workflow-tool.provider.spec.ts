import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { WorkflowToolProvider } from 'src/engine/core-modules/tool-provider/providers/workflow-tool.provider';
import { createEmptyFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/constant/create-empty-flat-entity-maps.constant';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { type PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { WorkflowToolWorkspaceService } from 'src/modules/workflow/workflow-tools/services/workflow-tool.workspace-service';

const WORKSPACE_ID = 'workspace-id';
const ROLE_ID = 'role-id';
const WORKSPACE_CUSTOM_APPLICATION_ID = 'workspace-custom-application-id';

const WORKSPACE_CUSTOM_APPLICATION = {
  id: WORKSPACE_CUSTOM_APPLICATION_ID,
} as FlatApplication;
const INSTALLED_APPLICATION = {
  id: 'installed-application-id',
} as FlatApplication;

const WORKFLOW_EDITION_TOOL_NAMES = [
  'create_complete_workflow',
  'create_workflow_version_step',
  'update_workflow_version_step',
  'update_workflow_version_trigger',
  'delete_workflow_version_step',
  'create_workflow_version_edge',
  'delete_workflow_version_edge',
  'create_draft_from_workflow_version',
  'update_workflow_version_positions',
  'activate_workflow_version',
  'deactivate_workflow_version',
  'delete_workflow',
  'get_logic_function_source',
  'update_logic_function_source',
  'list_logic_function_tools',
  'update_workflow_agent',
];

const WORKFLOW_READ_TOOL_NAMES = [
  'compute_step_output_schema',
  'get_workflow_current_version',
  'list_workflows',
  'get_workflow_run',
  'list_workflow_runs',
  'validate_workflow',
];

const buildProvider = () => {
  // The tools only reach their dependencies once executed
  const workflowToolService = new WorkflowToolWorkspaceService(
    ...(new Array(11).fill({}) as ConstructorParameters<
      typeof WorkflowToolWorkspaceService
    >),
  );

  const flatEntityMapsCacheService = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn().mockResolvedValue({
      flatObjectMetadataMaps: createEmptyFlatEntityMaps(),
    }),
  } as unknown as WorkspaceManyOrAllFlatEntityMapsCacheService;

  const applicationService = {
    findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
      .fn()
      .mockResolvedValue({
        workspaceCustomFlatApplication: WORKSPACE_CUSTOM_APPLICATION,
      }),
  } as unknown as ApplicationService;

  return new WorkflowToolProvider(
    workflowToolService,
    {} as PermissionsService,
    flatEntityMapsCacheService,
    applicationService,
  );
};

const buildContext = (application?: FlatApplication): ToolProviderContext => ({
  workspaceId: WORKSPACE_ID,
  rolePermissionConfig: { intersectionOf: { userWorkspaceRoleId: ROLE_ID } },
  application,
});

const listToolNames = async (application?: FlatApplication) => {
  const descriptors = await buildProvider().generateDescriptors(
    buildContext(application),
    { includeSchemas: false },
  );

  return descriptors.map(({ name }) => name);
};

describe('WorkflowToolProvider', () => {
  it('should let a user edit workflows', async () => {
    expect(await listToolNames()).toEqual([
      ...WORKFLOW_EDITION_TOOL_NAMES,
      ...WORKFLOW_READ_TOOL_NAMES,
    ]);
  });

  it('should let the workspace custom application edit workflows', async () => {
    expect(await listToolNames(WORKSPACE_CUSTOM_APPLICATION)).toEqual([
      ...WORKFLOW_EDITION_TOOL_NAMES,
      ...WORKFLOW_READ_TOOL_NAMES,
    ]);
  });

  it('should only let an installed application read workflows', async () => {
    expect(await listToolNames(INSTALLED_APPLICATION)).toEqual(
      WORKFLOW_READ_TOOL_NAMES,
    );
  });

  it('should refuse logic function edition to an installed application', async () => {
    await expect(
      buildProvider().executeStaticTool(
        'update_logic_function_source',
        {},
        buildContext(INSTALLED_APPLICATION),
      ),
    ).rejects.toThrow('Tool "update_logic_function_source" not found');
  });
});
