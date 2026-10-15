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
  it('should let a user create workflows', async () => {
    expect(await listToolNames()).toContain('create_complete_workflow');
  });

  it('should let the workspace custom application create workflows', async () => {
    expect(await listToolNames(WORKSPACE_CUSTOM_APPLICATION)).toContain(
      'create_complete_workflow',
    );
  });

  it('should hide workflow creation from an installed application', async () => {
    const toolNames = await listToolNames(INSTALLED_APPLICATION);

    expect(toolNames).not.toContain('create_complete_workflow');
    expect(toolNames).toContain('list_workflows');
  });

  it('should refuse workflow creation to an installed application', async () => {
    await expect(
      buildProvider().executeStaticTool(
        'create_complete_workflow',
        {},
        buildContext(INSTALLED_APPLICATION),
      ),
    ).rejects.toThrow('Tool "create_complete_workflow" not found');
  });
});
