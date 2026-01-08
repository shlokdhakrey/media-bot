/**
 * Retry Logic
 * 
 * Configurable retry wrapper with exponential backoff.
 */

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryIf?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const defaultOptions: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

/**
 * Execute a function with automatic retry on failure
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  
  let lastError: unknown;
  let delay = opts.initialDelay;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (opts.retryIf && !opts.retryIf(error)) {
        throw error;
      }
      
      // Last attempt, throw the error
      if (attempt === opts.maxAttempts) {
        throw error;
      }
      
      // Call onRetry callback
      opts.onRetry?.(error, attempt);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Calculate next delay with exponential backoff
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  throw lastError;
}
