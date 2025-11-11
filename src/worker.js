const Queue = require('./queue');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Simple ID generator
function generateId() {
  return 'worker-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
}

class Worker {
  constructor(workerId = null) {
    this.workerId = workerId || generateId();
    this.queue = new Queue();
    this.running = false;
    this.currentJob = null;
    this.processInterval = null;
    this.pidFile = path.join(process.cwd(), '.queuectl', `worker-${this.workerId}.pid`);
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.savePid();

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    console.log(`Worker ${this.workerId} started`);
    this.process();
  }

  savePid() {
    const dataDir = path.join(process.cwd(), '.queuectl');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(this.pidFile, process.pid.toString());
  }

  removePid() {
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }
  }

  async process() {
    while (this.running) {
      try {
        const job = this.queue.getNextJob();
        
        if (job) {
          this.currentJob = job;
          await this.queue.executeJob(job, this.workerId);
          this.currentJob = null;
        } else {
          // No jobs available, wait a bit
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`Worker ${this.workerId} error:`, error.message);
        this.currentJob = null;
        await this.sleep(1000);
      }
    }
  }

  stop() {
    console.log(`Worker ${this.workerId} stopping...`);
    this.running = false;

    // Wait for current job to finish (with timeout)
    if (this.currentJob) {
      console.log(`Waiting for job ${this.currentJob.id} to complete...`);
      const startTime = Date.now();
      const maxWait = 30000; // 30 seconds

      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.currentJob || Date.now() - startTime > maxWait) {
            clearInterval(checkInterval);
            this.removePid();
            process.exit(0);
          }
        }, 500);
      });
    } else {
      this.removePid();
      process.exit(0);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Worker manager for starting multiple workers
class WorkerManager {
  constructor() {
    this.workers = [];
    this.workerProcesses = [];
  }

  startWorkers(count = 1) {
    const { spawn } = require('child_process');
    const workerScript = path.join(__dirname, 'worker-process.js');

    for (let i = 0; i < count; i++) {
      const workerId = generateId();
      const workerProcess = spawn('node', [workerScript, workerId], {
        detached: false,
        stdio: 'inherit'
      });

      this.workerProcesses.push({
        id: workerId,
        process: workerProcess
      });

      workerProcess.on('exit', (code) => {
        console.log(`Worker ${workerId} exited with code ${code}`);
        this.workerProcesses = this.workerProcesses.filter(w => w.id !== workerId);
      });
    }

    console.log(`Started ${count} worker(s)`);
  }

  stopWorkers() {
    const path = require('path');
    const fs = require('fs');
    const dataDir = path.join(process.cwd(), '.queuectl');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    return new Promise(async (resolve) => {
      if (!fs.existsSync(dataDir)) {
        resolve();
        return;
      }

      const pidFiles = fs.readdirSync(dataDir)
        .filter(f => f.startsWith('worker-') && f.endsWith('.pid'));

      if (pidFiles.length === 0) {
        console.log('No workers running');
        resolve();
        return;
      }

      console.log(`Stopping ${pidFiles.length} worker(s)...`);

      for (const pidFile of pidFiles) {
        try {
          const pid = parseInt(fs.readFileSync(path.join(dataDir, pidFile), 'utf8').trim());
          process.kill(pid, 'SIGTERM');
        } catch (error) {
          // Process might already be dead
        }
      }

      // Wait a bit for graceful shutdown
      setTimeout(() => {
        // Force kill any remaining
        for (const pidFile of pidFiles) {
          try {
            const pid = parseInt(fs.readFileSync(path.join(dataDir, pidFile), 'utf8').trim());
            process.kill(pid, 'SIGKILL');
            fs.unlinkSync(path.join(dataDir, pidFile));
          } catch (error) {
            // Ignore
          }
        }
        console.log('All workers stopped');
        resolve();
      }, 5000);
    });
  }

  getActiveWorkers() {
    const path = require('path');
    const fs = require('fs');
    const dataDir = path.join(process.cwd(), '.queuectl');

    if (!fs.existsSync(dataDir)) {
      return 0;
    }

    const pidFiles = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('worker-') && f.endsWith('.pid'));

    let activeCount = 0;
    for (const pidFile of pidFiles) {
      try {
        const pid = parseInt(fs.readFileSync(path.join(dataDir, pidFile), 'utf8').trim());
        // Check if process is still running
        process.kill(pid, 0); // Signal 0 doesn't kill, just checks
        activeCount++;
      } catch (error) {
        // Process is dead, remove pid file
        try {
          fs.unlinkSync(path.join(dataDir, pidFile));
        } catch (e) {
          // Ignore
        }
      }
    }

    return activeCount;
  }
}

module.exports = { Worker, WorkerManager };

