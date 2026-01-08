/**
 * Job State Machine
 * 
 * Strict state machine for job lifecycle management.
 * 
 * State Flow:
 * PENDING → DOWNLOADING → ANALYZING → SYNCING → PROCESSING → VALIDATING → PACKAGED → UPLOADED → DONE
 *                    ↘ FAILED (from any state)
 * 
 * Rules:
 * - State transitions MUST be explicit
 * - Invalid transitions throw errors
 * - Every transition is logged
 */

import { JobState } from '@prisma/client';
import { StateTransitionError } from './errors/index.js';

// Re-export JobState from Prisma for convenience
export { JobState };

/**
 * Represents a state transition with metadata
 */
export interface JobStateTransition {
  from: JobState;
  to: JobState;
  timestamp: Date;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Valid state transitions
 * Maps each state to the set of states it can transition to
 */
const validTransitions: Record<JobState, Set<JobState>> = {
  PENDING: new Set<JobState>([
    'DOWNLOADING',
    'CANCELLED',
    'FAILED',
  ]),
  DOWNLOADING: new Set<JobState>([
    'ANALYZING',
    'CANCELLED',
    'FAILED',
  ]),
  ANALYZING: new Set<JobState>([
    'SYNCING',
    'PROCESSING', // Skip sync if not needed
    'CANCELLED',
    'FAILED',
  ]),
  SYNCING: new Set<JobState>([
    'PROCESSING',
    'CANCELLED',
    'FAILED',
  ]),
  PROCESSING: new Set<JobState>([
    'VALIDATING',
    'CANCELLED',
    'FAILED',
  ]),
  VALIDATING: new Set<JobState>([
    'PACKAGED',
    'PROCESSING', // Retry processing if validation fails
    'CANCELLED',
    'FAILED',
  ]),
  PACKAGED: new Set<JobState>([
    'UPLOADED',
    'CANCELLED',
    'FAILED',
  ]),
  UPLOADED: new Set<JobState>([
    'DONE',
    'CANCELLED',
    'FAILED',
  ]),
  DONE: new Set<JobState>([]), // Terminal state
  FAILED: new Set<JobState>([
    'PENDING', // Allow retry from failed
  ]),
  CANCELLED: new Set<JobState>([
    'PENDING', // Allow retry from cancelled
  ]),
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(from: JobState, to: JobState): boolean {
  const allowedTransitions = validTransitions[from];
  return allowedTransitions?.has(to) ?? false;
}

/**
 * Get all valid next states from the current state
 */
export function getNextStates(current: JobState): JobState[] {
  const transitions = validTransitions[current];
  return transitions ? Array.from(transitions) : [];
}

/**
 * Job State Machine class
 * Manages state transitions with validation and logging
 */
export class JobStateMachine {
  private currentState: JobState;
  private history: JobStateTransition[];
  private readonly jobId: string;

  constructor(jobId: string, initialState: JobState = 'PENDING') {
    this.jobId = jobId;
    this.currentState = initialState;
    this.history = [];
  }

  /**
   * Get the current state
   */
  getState(): JobState {
    return this.currentState;
  }

  /**
   * Get the full transition history
   */
  getHistory(): ReadonlyArray<JobStateTransition> {
    return [...this.history];
  }

  /**
   * Check if a transition to the target state is valid
   */
  canTransitionTo(targetState: JobState): boolean {
    return isValidTransition(this.currentState, targetState);
  }

  /**
   * Transition to a new state
   * Throws StateTransitionError if the transition is invalid
   */
  transitionTo(
    targetState: JobState,
    reason?: string,
    metadata?: Record<string, unknown>
  ): JobStateTransition {
    // Validate the transition
    if (!this.canTransitionTo(targetState)) {
      throw new StateTransitionError(
        this.jobId,
        this.currentState,
        targetState,
        `Invalid state transition from ${this.currentState} to ${targetState}`
      );
    }

    // Create transition record
    const transition: JobStateTransition = {
      from: this.currentState,
      to: targetState,
      timestamp: new Date(),
      reason,
      metadata,
    };

    // Update state and history
    this.history.push(transition);
    this.currentState = targetState;

    return transition;
  }

  /**
   * Check if the job is in a terminal state
   */
  isTerminal(): boolean {
    return this.currentState === 'DONE' || this.currentState === 'FAILED';
  }

  /**
   * Check if the job has failed
   */
  hasFailed(): boolean {
    return this.currentState === 'FAILED';
  }

  /**
   * Check if the job is complete
   */
  isComplete(): boolean {
    return this.currentState === 'DONE';
  }

  /**
   * Fail the job with a reason
   */
  fail(reason: string, metadata?: Record<string, unknown>): JobStateTransition {
    return this.transitionTo('FAILED', reason, metadata);
  }

  /**
   * Serialize the state machine for storage
   */
  serialize(): { state: JobState; history: JobStateTransition[] } {
    return {
      state: this.currentState,
      history: [...this.history],
    };
  }

  /**
   * Create a state machine from serialized data
   */
  static deserialize(
    jobId: string,
    data: { state: JobState; history: JobStateTransition[] }
  ): JobStateMachine {
    const machine = new JobStateMachine(jobId, data.state);
    machine.history = [...data.history];
    return machine;
  }
}
