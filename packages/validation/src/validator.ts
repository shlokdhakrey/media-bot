/**
 * Output Validator
 * 
 * Complete validation pipeline for processed output.
 */

import { SampleGenerator, type Sample } from './samples.js';
import { SyncVerifier, type VerificationResult } from './syncVerifier.js';
import { HashGenerator, type HashResult } from './hash.js';
import { MediaAnalyzer, type AnalysisResult } from '@media-bot/media';

export interface ValidationResult {
  passed: boolean;
  
  // File analysis
  analysis: AnalysisResult;
  
  // Samples generated
  samples: Sample[];
  
  // Sync verification
  syncVerification: VerificationResult;
  
  // File hashes
  hashes: HashResult;
  
  // Issues found
  issues: string[];
  
  // Warnings
  warnings: string[];
  
  // Validation timestamp
  validatedAt: Date;
}

export class OutputValidator {
  private sampleGenerator: SampleGenerator;
  private syncVerifier: SyncVerifier;
  private hashGenerator: HashGenerator;
  private mediaAnalyzer: MediaAnalyzer;

  constructor(
    ffmpegPath: string = 'ffmpeg',
    ffprobePath: string = 'ffprobe',
    mediainfoPath: string = 'mediainfo'
  ) {
    this.sampleGenerator = new SampleGenerator(ffmpegPath);
    this.syncVerifier = new SyncVerifier();
    this.hashGenerator = new HashGenerator();
    this.mediaAnalyzer = new MediaAnalyzer(ffprobePath, mediainfoPath);
  }

  /**
   * Perform complete validation of output file
   */
  async validate(
    outputFile: string,
    jobId: string,
    samplesDir: string
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Step 1: Analyze output file
    const analysis = await this.mediaAnalyzer.analyze(outputFile);
    warnings.push(...analysis.warnings);
    issues.push(...analysis.errors);

    // Step 2: Generate samples
    const durationMs = analysis.metadata.duration * 1000;
    const samples = await this.sampleGenerator.generateSamples(
      outputFile,
      durationMs,
      jobId,
      { outputDir: samplesDir }
    );

    // Step 3: Verify sync
    const syncVerification = await this.syncVerifier.verify(samples);
    if (!syncVerification.passed) {
      issues.push('Sync verification failed');
      syncVerification.notes.forEach(note => warnings.push(note));
    }

    // Step 4: Generate hashes
    const hashes = await this.hashGenerator.generate(outputFile);

    // Determine overall pass/fail
    const passed = issues.length === 0 && syncVerification.passed;

    return {
      passed,
      analysis,
      samples,
      syncVerification,
      hashes,
      issues,
      warnings,
      validatedAt: new Date(),
    };
  }
}
