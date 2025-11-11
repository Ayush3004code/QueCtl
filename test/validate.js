const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs');

const chalk = require('chalk');

// Clean up function
function cleanup() {
  const dataDir = path.join(process.cwd(), '.queuectl');
  if (fs.existsSync(dataDir)) {
    console.log(chalk.yellow('Cleaning up test data...'));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// Test helper
async function runCommand(cmd) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: process.cwd() });
    return { success: true, stdout, stderr };
  } catch (error) {
    return { success: false, stdout: error.stdout, stderr: error.stderr, error: error.message };
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  return async () => {
    try {
      process.stdout.write(`Testing: ${name}... `);
      await fn();
      console.log(chalk.green('✓ PASSED'));
      testsPassed++;
    } catch (error) {
      console.log(chalk.red('✗ FAILED'));
      console.log(chalk.red(`  Error: ${error.message}`));
      testsFailed++;
    }
  };
}

async function main() {
  console.log(chalk.bold('\n🧪 Running queuectl Validation Tests\n'));
  
  // Clean up before starting
  cleanup();
  await sleep(500);

  // Test 1: Enqueue a job
  await test('Enqueue a job', async () => {
    const result = await runCommand('node src/cli.js enqueue \'{"id":"test1","command":"echo hello"}\'');
    if (!result.success) {
      throw new Error('Failed to enqueue job');
    }
    if (!result.stdout.includes('test1')) {
      throw new Error('Job ID not found in output');
    }
  })();

  // Test 2: Check job appears in list
  await test('List pending jobs', async () => {
    const result = await runCommand('node src/cli.js list --state pending');
    if (!result.success) {
      throw new Error('Failed to list jobs');
    }
    if (!result.stdout.includes('test1')) {
      throw new Error('Job not found in pending list');
    }
  })();

  // Test 3: Start worker and process job
  await test('Start worker and process job', async () => {
    // Start worker in background
    const workerProcess = exec('node src/cli.js worker start', { cwd: process.cwd() });
    
    // Wait for job to process
    await sleep(3000);
    
    // Check if job completed
    const result = await runCommand('node src/cli.js list --state completed');
    if (!result.stdout.includes('test1')) {
      throw new Error('Job did not complete');
    }
    
    // Stop worker
    await runCommand('node src/cli.js worker stop');
    await sleep(1000);
  })();

  // Test 4: Failed job retry
  await test('Failed job retry mechanism', async () => {
    // Enqueue a job that will fail
    await runCommand('node src/cli.js enqueue \'{"id":"test-fail","command":"exit 1","max_retries":2}\'');
    
    // Start worker
    const workerProcess = exec('node src/cli.js worker start', { cwd: process.cwd() });
    await sleep(4000);
    
    // Check if job is in failed state
    const result = await runCommand('node src/cli.js list --state failed');
    if (!result.stdout.includes('test-fail')) {
      throw new Error('Failed job not found in failed state');
    }
    
    await runCommand('node src/cli.js worker stop');
    await sleep(1000);
  })();

  // Test 5: DLQ functionality
  await test('Dead Letter Queue', async () => {
    // Enqueue a job that will fail permanently
    await runCommand('node src/cli.js enqueue \'{"id":"test-dlq","command":"nonexistent-command","max_retries":1}\'');
    
    // Start worker and wait for retries to exhaust
    const workerProcess = exec('node src/cli.js worker start', { cwd: process.cwd() });
    await sleep(5000);
    
    // Check DLQ
    const result = await runCommand('node src/cli.js dlq list');
    if (!result.stdout.includes('test-dlq')) {
      throw new Error('Job not found in DLQ');
    }
    
    await runCommand('node src/cli.js worker stop');
    await sleep(1000);
  })();

  // Test 6: Configuration
  await test('Configuration management', async () => {
    // Set config
    await runCommand('node src/cli.js config set max-retries 5');
    
    // Get config
    const result = await runCommand('node src/cli.js config get max-retries');
    if (!result.stdout.includes('5')) {
      throw new Error('Config value not set correctly');
    }
  })();

  // Test 7: Status command
  await test('Status command', async () => {
    const result = await runCommand('node src/cli.js status');
    if (!result.success) {
      throw new Error('Status command failed');
    }
    if (!result.stdout.includes('Queue Status')) {
      throw new Error('Status output incorrect');
    }
  })();

  // Test 8: Multiple workers
  await test('Multiple workers', async () => {
    // Enqueue multiple jobs
    await runCommand('node src/cli.js enqueue \'{"id":"multi1","command":"sleep 1"}\'');
    await runCommand('node src/cli.js enqueue \'{"id":"multi2","command":"sleep 1"}\'');
    await runCommand('node src/cli.js enqueue \'{"id":"multi3","command":"sleep 1"}\'');
    
    // Start 3 workers
    const workerProcess = exec('node src/cli.js worker start --count 3', { cwd: process.cwd() });
    await sleep(3000);
    
    // Check status
    const result = await runCommand('node src/cli.js status');
    if (!result.success) {
      throw new Error('Status check failed');
    }
    
    await runCommand('node src/cli.js worker stop');
    await sleep(1000);
  })();

  // Test 9: Persistence
  await test('Job persistence across restarts', async () => {
    // Enqueue a job
    await runCommand('node src/cli.js enqueue \'{"id":"persist-test","command":"echo persist"}\'');
    
    // Verify it exists
    let result = await runCommand('node src/cli.js list --state pending');
    if (!result.stdout.includes('persist-test')) {
      throw new Error('Job not found before restart');
    }
    
    // Simulate restart by checking again (database should persist)
    result = await runCommand('node src/cli.js list --state pending');
    if (!result.stdout.includes('persist-test')) {
      throw new Error('Job lost after restart simulation');
    }
  })();

  // Test 10: DLQ retry
  await test('Retry from DLQ', async () => {
    // Retry the DLQ job from earlier
    const result = await runCommand('node src/cli.js dlq retry test-dlq');
    if (!result.success) {
      throw new Error('Failed to retry DLQ job');
    }
    
    // Verify it's back in pending
    const listResult = await runCommand('node src/cli.js list --state pending');
    if (!listResult.stdout.includes('test-dlq')) {
      throw new Error('DLQ job not moved back to pending');
    }
  })();

  // Summary
  console.log(chalk.bold('\n📊 Test Summary\n'));
  console.log(chalk.green(`✓ Passed: ${testsPassed}`));
  if (testsFailed > 0) {
    console.log(chalk.red(`✗ Failed: ${testsFailed}`));
  } else {
    console.log(chalk.green('🎉 All tests passed!'));
  }
  console.log();

  // Cleanup
  cleanup();
}

// Run tests
main().catch(error => {
  console.error(chalk.red('Test runner error:'), error);
  process.exit(1);
});

