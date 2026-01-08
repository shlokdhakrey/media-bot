/**
 * @media-bot/packaging
 * 
 * Output packaging layer.
 * 
 * Responsibilities:
 * - Organize final output files
 * - Generate manifest with hashes
 * - Create NFO files if needed
 * - Prepare for upload
 */

export { Packager, type PackageResult, type PackageManifest } from './packager.js';
