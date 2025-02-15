/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import semver from 'semver';
import { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { SavedObjectsClientContract } from '@kbn/core-saved-objects-api-server';
import { EntityDefinition } from '@kbn/entities-schema';
import { Logger } from '@kbn/logging';
import {
  generateHistoryIndexTemplateId,
  generateLatestIndexTemplateId,
} from './helpers/generate_component_id';
import {
  createAndInstallHistoryIngestPipeline,
  createAndInstallLatestIngestPipeline,
} from './create_and_install_ingest_pipeline';
import {
  createAndInstallHistoryBackfillTransform,
  createAndInstallHistoryTransform,
  createAndInstallLatestTransform,
} from './create_and_install_transform';
import { validateDefinitionCanCreateValidTransformIds } from './transform/validate_transform_ids';
import { deleteEntityDefinition } from './delete_entity_definition';
import { deleteHistoryIngestPipeline, deleteLatestIngestPipeline } from './delete_ingest_pipeline';
import { findEntityDefinitions } from './find_entity_definition';
import {
  entityDefinitionExists,
  saveEntityDefinition,
  updateEntityDefinition,
} from './save_entity_definition';
import {
  stopAndDeleteHistoryBackfillTransform,
  stopAndDeleteHistoryTransform,
  stopAndDeleteLatestTransform,
} from './stop_and_delete_transform';
import { isBackfillEnabled } from './helpers/is_backfill_enabled';
import { deleteTemplate, upsertTemplate } from '../manage_index_templates';
import { generateEntitiesLatestIndexTemplateConfig } from './templates/entities_latest_template';
import { generateEntitiesHistoryIndexTemplateConfig } from './templates/entities_history_template';
import { EntityIdConflict } from './errors/entity_id_conflict_error';
import { EntityDefinitionNotFound } from './errors/entity_not_found';
import { EntityDefinitionWithState } from './types';

export interface InstallDefinitionParams {
  esClient: ElasticsearchClient;
  soClient: SavedObjectsClientContract;
  definition: EntityDefinition;
  logger: Logger;
}

const throwIfRejected = (values: Array<PromiseFulfilledResult<any> | PromiseRejectedResult>) => {
  const rejectedPromise = values.find(
    (value) => value.status === 'rejected'
  ) as PromiseRejectedResult;
  if (rejectedPromise) {
    throw new Error(rejectedPromise.reason);
  }
  return values;
};

// install an entity definition from scratch with all its required components
// after verifying that the definition id is valid and available.
// attempt to remove all installed components if the installation fails.
export async function installEntityDefinition({
  esClient,
  soClient,
  definition,
  logger,
}: InstallDefinitionParams): Promise<EntityDefinition> {
  validateDefinitionCanCreateValidTransformIds(definition);

  try {
    if (await entityDefinitionExists(soClient, definition.id)) {
      throw new EntityIdConflict(
        `Entity definition with [${definition.id}] already exists.`,
        definition
      );
    }

    const entityDefinition = await saveEntityDefinition(soClient, {
      ...definition,
      installStatus: 'installing',
      installStartedAt: new Date().toISOString(),
    });

    return await install({ esClient, soClient, logger, definition: entityDefinition });
  } catch (e) {
    logger.error(`Failed to install entity definition ${definition.id}: ${e}`);

    await Promise.all([
      stopAndDeleteHistoryTransform(esClient, definition, logger),
      isBackfillEnabled(definition)
        ? stopAndDeleteHistoryBackfillTransform(esClient, definition, logger)
        : Promise.resolve(),
      stopAndDeleteLatestTransform(esClient, definition, logger),
    ]);

    await Promise.all([
      deleteHistoryIngestPipeline(esClient, definition, logger),
      deleteLatestIngestPipeline(esClient, definition, logger),
    ]);

    await Promise.all([
      deleteTemplate({
        esClient,
        logger,
        name: generateHistoryIndexTemplateId(definition),
      }),
      deleteTemplate({
        esClient,
        logger,
        name: generateLatestIndexTemplateId(definition),
      }),
    ]);

    await deleteEntityDefinition(soClient, definition).catch((err) => {
      if (err instanceof EntityDefinitionNotFound) {
        return;
      }
      throw err;
    });

    throw e;
  }
}

export async function installBuiltInEntityDefinitions({
  esClient,
  soClient,
  logger,
  definitions,
}: Omit<InstallDefinitionParams, 'definition'> & {
  definitions: EntityDefinition[];
}): Promise<EntityDefinition[]> {
  if (definitions.length === 0) return [];

  logger.debug(`Starting installation of ${definitions.length} built-in definitions`);
  const installPromises = definitions.map(async (builtInDefinition) => {
    const installedDefinitions = await findEntityDefinitions({
      esClient,
      soClient,
      id: builtInDefinition.id,
    });

    if (installedDefinitions.length === 0) {
      return await installEntityDefinition({
        definition: builtInDefinition,
        esClient,
        soClient,
        logger,
      });
    }

    // verify existing installation
    const installedDefinition = installedDefinitions[0];
    if (!shouldReinstall(installedDefinition, builtInDefinition)) {
      return installedDefinition;
    }

    logger.debug(
      `Detected failed or outdated installation of definition [${installedDefinition.id}] v${installedDefinition.version}, installing v${builtInDefinition.version}`
    );
    return await reinstall({
      soClient,
      esClient,
      logger,
      definition: installedDefinition,
      latestDefinition: builtInDefinition,
    });
  });

  return await Promise.all(installPromises);
}

// perform installation of an entity definition components.
// assume definition saved object is already persisted
async function install({
  esClient,
  soClient,
  definition,
  logger,
}: InstallDefinitionParams): Promise<EntityDefinition> {
  logger.debug(
    () =>
      `Installing definition ${definition.id} v${definition.version}\n${JSON.stringify(
        definition,
        null,
        2
      )}`
  );

  logger.debug(`Installing index templates for definition ${definition.id}`);
  await Promise.allSettled([
    upsertTemplate({
      esClient,
      logger,
      template: generateEntitiesHistoryIndexTemplateConfig(definition),
    }),
    upsertTemplate({
      esClient,
      logger,
      template: generateEntitiesLatestIndexTemplateConfig(definition),
    }),
  ]).then(throwIfRejected);

  logger.debug(`Installing ingest pipelines for definition ${definition.id}`);
  await Promise.allSettled([
    createAndInstallHistoryIngestPipeline(esClient, definition, logger),
    createAndInstallLatestIngestPipeline(esClient, definition, logger),
  ]).then(throwIfRejected);

  logger.debug(`Installing transforms for definition ${definition.id}`);
  await Promise.allSettled([
    createAndInstallHistoryTransform(esClient, definition, logger),
    isBackfillEnabled(definition)
      ? createAndInstallHistoryBackfillTransform(esClient, definition, logger)
      : Promise.resolve(),
    createAndInstallLatestTransform(esClient, definition, logger),
  ]).then(throwIfRejected);

  await updateEntityDefinition(soClient, definition.id, { installStatus: 'installed' });

  return { ...definition, installStatus: 'installed' };
}

// stop and delete the current transforms and reinstall all the components
async function reinstall({
  esClient,
  soClient,
  definition,
  latestDefinition,
  logger,
}: InstallDefinitionParams & { latestDefinition: EntityDefinition }): Promise<EntityDefinition> {
  logger.debug(
    `Reinstalling definition ${definition.id} from v${definition.version} to v${latestDefinition.version}`
  );

  try {
    await updateEntityDefinition(soClient, latestDefinition.id, {
      ...latestDefinition,
      installStatus: 'upgrading',
      installStartedAt: new Date().toISOString(),
    });

    logger.debug(`Stopping transforms for definition ${definition.id} v${definition.version}`);
    await Promise.all([
      stopAndDeleteHistoryTransform(esClient, definition, logger),
      isBackfillEnabled(definition)
        ? stopAndDeleteHistoryBackfillTransform(esClient, definition, logger)
        : Promise.resolve(),
      stopAndDeleteLatestTransform(esClient, definition, logger),
    ]);

    return await install({
      esClient,
      soClient,
      logger,
      definition: latestDefinition,
    });
  } catch (err) {
    await updateEntityDefinition(soClient, latestDefinition.id, {
      installStatus: 'failed',
    });

    throw err;
  }
}

const INSTALLATION_TIMEOUT = 5 * 60 * 1000;
const shouldReinstall = (
  definition: EntityDefinitionWithState,
  latestDefinition: EntityDefinition
) => {
  const { installStatus, installStartedAt } = definition;

  const isStale =
    (installStatus === 'installing' || installStatus === 'upgrading') &&
    Date.now() - Date.parse(installStartedAt!) >= INSTALLATION_TIMEOUT;
  const isOutdated =
    installStatus === 'installed' && semver.neq(definition.version, latestDefinition.version);
  const isFailed = installStatus === 'failed';
  const isPartial = installStatus === 'installed' && !definition.state.installed;

  return isStale || isOutdated || isFailed || isPartial;
};
