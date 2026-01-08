/**
 * @media-bot/validation
 * 
 * Output validation layer.
 * 
 * Responsibilities:
 * - Parse scene release names
 * - Parse NFO files
 * - Validate release structure
 * - Enforce quality rules
 * - Generate samples (start, middle, end)
 * - Verify sync is correct
 * - Generate file hashes
 * - Validate output integrity
 * 
 * Any failure must rollback job state.
 */

// Scene naming
export {
  SceneNameParser,
  sceneNameParser,
  type ParsedReleaseName,
} from './sceneNameParser.js';

// NFO parsing
export {
  NFOParser,
  nfoParser,
  type NFOParseResult,
  type NFOSection,
} from './nfoParser.js';

// Release validation
export {
  ReleaseValidator,
  releaseValidator,
  type ReleaseFile,
  type ReleaseStructure,
  type ValidationRule,
  type RuleResult,
  type ReleaseValidationResult,
} from './releaseValidator.js';

// Quality rules
export {
  QualityRulesEngine,
  qualityRulesEngine,
  type QualityRule,
  type QualityCheckResult,
  type QualityProfile,
  type QualityValidationResult,
} from './qualityRules.js';

// Sample generation
export { SampleGenerator, type Sample } from './samples.js';

// Sync verification
export { SyncVerifier, type VerificationResult } from './syncVerifier.js';

// Hash generation
export { HashGenerator, type HashResult } from './hash.js';

// Output validator (combines all)
export { OutputValidator, type ValidationResult } from './validator.js';
