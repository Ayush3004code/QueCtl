const Storage = require('./storage');
const Config = require('./config');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class Queue {
  constructor() {
    this.storage = new Storage();
    this.config = new Config();
  }

  enqueue(jobData) {
    if (!jobData.id) {
      throw new Error('Job must have an id');
    }
    if (!jobData.command) {
      throw new Error('Job must have a command');
    }

    const existing = this.storage.getJob(jobData.id);
    if (existing) {
      throw new Error(`Job with id ${jobData.id} already exists`);
    }

    const job = {
      id: jobData.id,
      command: jobData.command,
      state: 'pending',
      attempts: 0,
      max_retries: jobData.max_retries || this.config.getMaxRetries(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return this.storage.createJob(job);
  }

  async executeJob(job, workerId) {
    // Lock the job
    const locked = this.storage.lockJob(job.id, workerId);
    if (!locked) {
      return null; // Job was already picked up by another worker
    }

    try {
      // Execute the command
      const { stdout, stderr } = await execAsync(job.command, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 // 1MB buffer
      });

      // Success
      this.storage.updateJob(job.id, {
        state: 'completed',
        worker_id: null,
        error_message: null
      });

      return { success: true, stdout, stderr };
    } catch (error) {
      // Failure
      const attempts = job.attempts + 1;
      const maxRetries = job.max_retries;
      const backoffBase = this.config.getBackoffBase();
      
      let nextState = 'failed';
      let nextRetryAt = null;
      let errorMessage = error.message || 'Command execution failed';

      if (attempts >= maxRetries) {
        // Move to DLQ
        nextState = 'dead';
        this.storage.updateJob(job.id, {
          state: 'dead',
          attempts: attempts,
          worker_id: null,
          error_message: errorMessage
        });
      } else {
        // Calculate exponential backoff
        const delaySeconds = Math.pow(backoffBase, attempts);
        const nextRetry = new Date(Date.now() + delaySeconds * 1000);
        nextRetryAt = nextRetry.toISOString();

        this.storage.updateJob(job.id, {
          state: 'failed',
          attempts: attempts,
          next_retry_at: nextRetryAt,
          worker_id: null,
          error_message: errorMessage
        });
      }

      return { success: false, error: errorMessage, attempts, nextRetryAt };
    }
  }

  getNextJob() {
    // First, try to get a pending job
    let job = this.storage.getNextPendingJob();
    if (job) {
      return job;
    }

    // Then, try to get a retryable failed job
    job = this.storage.getRetryableJobs();
    if (job) {
      // Reset to pending for retry
      this.storage.updateJob(job.id, {
        state: 'pending',
        next_retry_at: null
      });
      return this.storage.getJob(job.id);
    }

    return null;
  }

  list(state = null) {
    return this.storage.listJobs(state);
  }

  getStats() {
    return this.storage.getStats();
  }

  getDLQJobs() {
    return this.storage.getDLQJobs();
  }

  retryFromDLQ(jobId) {
    return this.storage.retryFromDLQ(jobId);
  }
}

module.exports = Queue;

