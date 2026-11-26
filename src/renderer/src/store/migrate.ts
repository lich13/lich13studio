import {
  migrateAssistantSelectionState,
  migrateChatRequestModeState,
  migrateModelCatalogState,
  migratePlatformState,
  PROVIDER_RESET_VERSION,
  sanitizeState
} from '@shared/stateMigration'
import { createMigrate, type MigrationManifest, type PersistedState } from 'redux-persist'

const recentMigrateConfig: MigrationManifest = {
  '216': (state) => (state ? sanitizeState(state as Record<string, any>, true) : state) as PersistedState,
  '217': (state) => (state ? migratePlatformState(state as Record<string, any>) : state) as PersistedState,
  '218': (state) => (state ? sanitizeState(state as Record<string, any>) : state) as PersistedState,
  '220': (state) => (state ? migrateAssistantSelectionState(state as Record<string, any>) : state) as PersistedState,
  '222': (state) => (state ? migrateModelCatalogState(state as Record<string, any>) : state) as PersistedState,
  '223': (state) => (state ? migrateChatRequestModeState(state as Record<string, any>) : state) as PersistedState
}

const recentMigrate = createMigrate(recentMigrateConfig)

// 注意：添加新迁移时，记得同时更新 persistReducer (src/renderer/src/store/index.ts)
const migrate: typeof recentMigrate = async (state, version) => {
  if (!state) {
    return state
  }

  const inboundVersion = state._persist?.version ?? -1
  if (inboundVersion === version) {
    return sanitizeState(state as Record<string, any>) as PersistedState
  }

  let migrated: PersistedState
  if (inboundVersion < PROVIDER_RESET_VERSION) {
    const { legacyMigrateConfig } = await import('./migrateLegacy')
    const fullMigrate = createMigrate({
      ...(legacyMigrateConfig as unknown as MigrationManifest),
      ...recentMigrateConfig
    })
    migrated = await fullMigrate(state, version)
  } else {
    migrated = await recentMigrate(state, version)
  }

  return migrated
    ? (migrateChatRequestModeState(
        migrateModelCatalogState(sanitizeState(migrated as Record<string, any>))
      ) as PersistedState)
    : migrated
}

export default migrate
