#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const Queue = require('./queue');
const Config = require('./config');
const { WorkerManager } = require('./worker');

const program = new Command();

program
  .name('queuectl')
  .description('CLI-based background job queue system')
  .version('1.0.0');

// Enqueue command
program
  .command('enqueue')
  .description('Add a new job to the queue')
  .argument('<job-json>', 'Job JSON string')
  .action((jobJson) => {
    try {
      const jobData = JSON.parse(jobJson);
      const queue = new Queue();
      const job = queue.enqueue(jobData);
      console.log(chalk.green(`✓ Job ${job.id} enqueued successfully`));
      console.log(JSON.stringify(job, null, 2));
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

// Worker commands
const workerCmd = program
  .command('worker')
  .description('Manage worker processes');

workerCmd
  .command('start')
  .description('Start one or more workers')
  .option('-c, --count <number>', 'Number of workers to start', '1')
  .action((options) => {
    try {
      const count = parseInt(options.count, 10);
      if (isNaN(count) || count < 1) {
        throw new Error('Count must be a positive integer');
      }
      const manager = new WorkerManager();
      manager.startWorkers(count);
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

workerCmd
  .command('stop')
  .description('Stop all running workers gracefully')
  .action(async () => {
    try {
      const manager = new WorkerManager();
      await manager.stopWorkers();
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show summary of all job states & active workers')
  .action(() => {
    try {
      const queue = new Queue();
      const stats = queue.getStats();
      const manager = new WorkerManager();
      const activeWorkers = manager.getActiveWorkers();

      console.log(chalk.bold('\n📊 Queue Status\n'));
      console.log(`Active Workers: ${chalk.cyan(activeWorkers)}`);
      console.log(`Pending: ${chalk.yellow(stats.pending)}`);
      console.log(`Processing: ${chalk.blue(stats.processing)}`);
      console.log(`Completed: ${chalk.green(stats.completed)}`);
      console.log(`Failed: ${chalk.magenta(stats.failed)}`);
      console.log(`Dead (DLQ): ${chalk.red(stats.dead)}`);
      console.log(`Total: ${chalk.bold(Object.values(stats).reduce((a, b) => a + b, 0))}\n`);
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

// List command
program
  .command('list')
  .description('List jobs by state')
  .option('-s, --state <state>', 'Filter by state (pending, processing, completed, failed, dead)')
  .action((options) => {
    try {
      const queue = new Queue();
      const jobs = queue.list(options.state || null);

      if (jobs.length === 0) {
        console.log(chalk.yellow('No jobs found'));
        return;
      }

      console.log(chalk.bold(`\n📋 Jobs${options.state ? ` (${options.state})` : ''}\n`));
      jobs.forEach(job => {
        const stateColor = {
          pending: chalk.yellow,
          processing: chalk.blue,
          completed: chalk.green,
          failed: chalk.magenta,
          dead: chalk.red
        }[job.state] || chalk.white;

        console.log(`${stateColor(job.state.padEnd(12))} ${job.id}`);
        console.log(`  Command: ${job.command}`);
        console.log(`  Attempts: ${job.attempts}/${job.max_retries}`);
        if (job.next_retry_at) {
          console.log(`  Next Retry: ${job.next_retry_at}`);
        }
        if (job.error_message) {
          console.log(`  Error: ${chalk.red(job.error_message)}`);
        }
        console.log(`  Created: ${job.created_at}\n`);
      });
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

// DLQ commands
const dlqCmd = program
  .command('dlq')
  .description('Dead Letter Queue operations');

dlqCmd
  .command('list')
  .description('List all jobs in the Dead Letter Queue')
  .action(() => {
    try {
      const queue = new Queue();
      const jobs = queue.getDLQJobs();

      if (jobs.length === 0) {
        console.log(chalk.yellow('No jobs in Dead Letter Queue'));
        return;
      }

      console.log(chalk.bold('\n💀 Dead Letter Queue\n'));
      jobs.forEach(job => {
        console.log(chalk.red(`✗ ${job.id}`));
        console.log(`  Command: ${job.command}`);
        console.log(`  Attempts: ${job.attempts}/${job.max_retries}`);
        console.log(`  Error: ${chalk.red(job.error_message || 'Unknown error')}`);
        console.log(`  Failed at: ${job.updated_at}\n`);
      });
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

dlqCmd
  .command('retry')
  .description('Retry a job from the Dead Letter Queue')
  .argument('<job-id>', 'Job ID to retry')
  .action((jobId) => {
    try {
      const queue = new Queue();
      const job = queue.retryFromDLQ(jobId);
      if (!job) {
        console.error(chalk.red(`✗ Job ${jobId} not found in DLQ or already retried`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Job ${job.id} moved back to pending queue`));
      console.log(JSON.stringify(job, null, 2));
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

// Config commands
const configCmd = program
  .command('config')
  .description('Manage configuration');

configCmd
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key (max-retries, backoff-base)')
  .argument('<value>', 'Configuration value')
  .action((key, value) => {
    try {
      const config = new Config();
      
      if (key === 'max-retries') {
        config.setMaxRetries(value);
        console.log(chalk.green(`✓ max-retries set to ${value}`));
      } else if (key === 'backoff-base') {
        config.setBackoffBase(value);
        console.log(chalk.green(`✓ backoff-base set to ${value}`));
      } else {
        throw new Error(`Unknown config key: ${key}. Use 'max-retries' or 'backoff-base'`);
      }
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

configCmd
  .command('get')
  .description('Get a configuration value')
  .argument('<key>', 'Configuration key')
  .action((key) => {
    try {
      const config = new Config();
      const value = config.get(key);
      if (value === null) {
        console.error(chalk.red(`✗ Config key '${key}' not found`));
        process.exit(1);
      }
      console.log(value);
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

configCmd
  .command('list')
  .description('List all configuration values')
  .action(() => {
    try {
      const config = new Config();
      const allConfig = config.getAll();
      
      console.log(chalk.bold('\n⚙️  Configuration\n'));
      Object.entries(allConfig).forEach(([key, value]) => {
        console.log(`${key}: ${chalk.cyan(value)}`);
      });
      console.log();
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();

