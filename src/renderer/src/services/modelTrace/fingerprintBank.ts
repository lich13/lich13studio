import manifest from './data/manifest.json'
import bundledRaw from './data/unified_bank.json?raw'

export interface FingerprintModel {
  id: string
  display_name: string
  family: string
  family_name: string
  counts: number[]
}

interface FeatureSpace {
  feature_mean: number[]
  feature_scale: number[]
  nuisance_basis: number[][]
  centroids: number[][]
}

export interface FingerprintBank {
  schema: string
  built_at: string
  minimum_valid_numbers: number
  recommended_queries: number
  method: { range: number[]; alpha: number; ordered_block_weight: number; [key: string]: unknown }
  models: FingerprintModel[]
  robust: {
    model_order: string[]
    robust_ready: boolean
    hellinger: FeatureSpace
    ordered_blocks: FeatureSpace & { weight: number; environment_centroids: number[][][] }
  }
  calibration: Record<string, { beta: number; cv_accuracy: number; [key: string]: unknown }>
}

export interface FingerprintBankVersion {
  revision: string
  sha256: string
  builtAt: string
  analyzerVersion: number
}

export interface FingerprintBankSnapshot {
  bank: FingerprintBank
  version: FingerprintBankVersion
}

export class IncompatibleFingerprintBankError extends Error {
  constructor() {
    super('Incompatible ModelTrace data or analyzer')
    this.name = 'IncompatibleFingerprintBankError'
  }
}

/** Bound dimensions and reject non-finite statistics before any scoring or persistence. */
export function validateFingerprintBank(value: unknown): asserts value is FingerprintBank {
  const fail = () => {
    throw new IncompatibleFingerprintBankError()
  }
  if (!value || typeof value !== 'object') fail()
  const bank = value as FingerprintBank
  const vector = (v: unknown, length: number, predicate: (n: number) => boolean = () => true) =>
    Array.isArray(v) &&
    v.length === length &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && predicate(n))
  const matrix = (v: unknown, rows: number, columns: number) =>
    Array.isArray(v) && v.length === rows && v.every((row) => vector(row, columns))
  if (
    bank.schema !== 'robust-number-fingerprint-bank' ||
    !Number.isFinite(Date.parse(bank.built_at)) ||
    bank.minimum_valid_numbers !== 80 ||
    bank.recommended_queries !== 3 ||
    !Array.isArray(bank.method?.range) ||
    bank.method.range.join(',') !== '1,355' ||
    bank.method.alpha !== 0.5 ||
    bank.method.ordered_block_weight !== 0.25 ||
    !Array.isArray(bank.models) ||
    bank.models.length === 0 ||
    bank.models.length > 256 ||
    bank.robust?.robust_ready !== true
  )
    fail()
  const ids = bank.models.map((model) => model?.id)
  if (
    new Set(ids).size !== ids.length ||
    !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)
  )
    fail()
  if (
    !Array.isArray(bank.robust.model_order) ||
    bank.robust.model_order.some((id, i) => id !== ids[i]) ||
    bank.robust.model_order.length !== ids.length
  )
    fail()
  for (const model of bank.models) {
    if (
      ![model.display_name, model.family, model.family_name].every(
        (v) => typeof v === 'string' && v.length > 0 && v.length <= 256
      ) ||
      !vector(model.counts, 355, (n) => Number.isSafeInteger(n) && n >= 0)
    )
      fail()
  }
  for (const [feature, dimensions] of [
    [bank.robust.hellinger, 355],
    [bank.robust.ordered_blocks, 74]
  ] as const) {
    if (
      !feature ||
      !vector(feature.feature_mean, dimensions) ||
      !vector(feature.feature_scale, dimensions, (n) => n > 0) ||
      !Array.isArray(feature.nuisance_basis) ||
      feature.nuisance_basis.length > dimensions ||
      !matrix(feature.nuisance_basis, feature.nuisance_basis.length, dimensions) ||
      !matrix(feature.centroids, ids.length, dimensions)
    )
      fail()
  }
  const ordered = bank.robust.ordered_blocks
  if (
    ordered.weight !== 0.25 ||
    !Array.isArray(ordered.environment_centroids) ||
    ordered.environment_centroids.length === 0 ||
    ordered.environment_centroids.length > 256 ||
    !ordered.environment_centroids.every((env) => matrix(env, ids.length, 74))
  )
    fail()
  for (const count of ['1', '2', '3']) {
    const calibration = bank.calibration?.[count]
    if (
      !calibration ||
      !Number.isFinite(calibration.beta) ||
      calibration.beta <= 0 ||
      !Number.isFinite(calibration.cv_accuracy) ||
      calibration.cv_accuracy < 0 ||
      calibration.cv_accuracy > 1
    )
      fail()
  }
}

export function freezeBankSnapshot(snapshot: FingerprintBankSnapshot): FingerprintBankSnapshot {
  const freeze = (value: object) => {
    if (Object.isFrozen(value)) return
    for (const entry of Object.values(value)) if (entry && typeof entry === 'object') freeze(entry)
    Object.freeze(value)
  }
  freeze(snapshot)
  return snapshot
}

const bundled: unknown = JSON.parse(bundledRaw)
validateFingerprintBank(bundled)
export const bundledBankSnapshot = freezeBankSnapshot({
  bank: bundled,
  version: {
    revision: manifest.revision,
    sha256: manifest.files.bank.sha256,
    builtAt: bundled.built_at,
    analyzerVersion: manifest.analyzerVersion
  }
})

export { bundledRaw, manifest as modelTraceManifest }
