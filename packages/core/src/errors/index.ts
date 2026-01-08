/**
 * Custom Error Classes
 */

import { JobState } from '../stateMachine.js';

/**
 * Base error class for all media-bot errors
 */
export class MediaBotError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MediaBotError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    
    // Maintains proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error for invalid inputs
 */
export class ValidationError extends MediaBotError {
  constructor(field: string, message: string) {
    super(
      `Validation failed for ${field}: ${message}`,
      'VALIDATION_ERROR',
      400,
      { field, message }
    );
    this.name = 'ValidationError';
  }
}

/**
 * State transition error for invalid state changes
 */
export class StateTransitionError extends MediaBotError {
  constructor(
    jobId: string,
    fromState: JobState,
    toState: JobState,
    message?: string
  ) {
    super(
      message ?? `Invalid state transition from ${fromState} to ${toState}`,
      'STATE_TRANSITION_ERROR',
      400,
      { jobId, fromState, toState }
    );
    this.name = 'StateTransitionError';
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends MediaBotError {
  constructor(resource: string, identifier: string) {
    super(
      `${resource} not found: ${identifier}`,
      'NOT_FOUND',
      404,
      { resource, identifier }
    );
    this.name = 'NotFoundError';
  }
}

/**
 * External command error
 */
export class CommandExecutionError extends MediaBotError {
  constructor(
    command: string,
    exitCode: number,
    stderr: string
  ) {
    super(
      `Command failed with exit code ${exitCode}`,
      'COMMAND_EXECUTION_ERROR',
      500,
      { command, exitCode, stderr: stderr.substring(0, 1000) }
    );
    this.name = 'CommandExecutionError';
  }
}
