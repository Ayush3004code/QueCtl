# queuectl - Detailed Architecture & Working Documentation

## 📖 Table of Contents
1. [What is queuectl?](#what-is-queuectl)
2. [Simple Analogy](#simple-analogy)
3. [How It Works - High Level](#how-it-works-high-level)
4. [Component Breakdown](#component-breakdown)
5. [Data Flow](#data-flow)
6. [Job Lifecycle Explained](#job-lifecycle-explained)
7. [Retry Mechanism Deep Dive](#retry-mechanism-deep-dive)
8. [Worker System Explained](#worker-system-explained)
9. [Database Schema](#database-schema)
10. [Step-by-Step Examples](#step-by-step-examples)

---

## What is queuectl?

**queuectl** is a command-line tool that helps you run background jobs (tasks) on your computer. Think of it like a smart task manager that:

- **Stores tasks** you want to run later
- **Executes them automatically** in the background
- **Retries failed tasks** with smart delays
- **Keeps track** of everything that happens
- **Never loses your tasks** even if you restart your computer

### Real-World Example

Imagine you have 100 files to process, but you don't want to wait for each one. Instead of running them one by one, you can:
1. Add all 100 tasks to the queue
2. Start 5 workers (helpers) to process them
3. Go do something else while they work
4. Come back later to see the results

---

## Simple Analogy

Think of **queuectl** like a **restaurant kitchen**:

- **Jobs** = Orders from customers
- **Queue** = The order board where orders wait
- **Workers** = Chefs who cook the orders
- **Retry** = If a dish burns, the chef tries again with a longer wait time
- **DLQ (Dead Letter Queue)** = Orders that failed too many times go to a special "problem orders" list
- **Database** = The restaurant's record book that remembers all orders

---

## How It Works - High Level

```
┌─────────────┐
│   You (CLI) │  ← You type commands
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  CLI Tool   │  ← Interprets your commands
└──────┬──────┘
       │
       ├─────────────────┬──────────────────┐
       ▼                 ▼                  ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Queue     │   │   Workers   │   │  Database   │
│  Manager    │   │  (Helpers)  │   │  (Storage)  │
└─────────────┘   └─────────────┘   └─────────────┘
```

### The Flow:

1. **You enqueue a job** → Goes into the database
2. **Worker picks it up** → Changes status to "processing"
3. **Worker executes it** → Runs the command
4. **Success?** → Mark as "completed"
5. **Failed?** → Mark as "failed", schedule retry
6. **Too many failures?** → Move to DLQ

---

## Component Breakdown

### 1. **CLI Interface** (`src/cli.js`)

**What it does:** This is the "face" of the system - what you interact with.

**How it works:**
- Uses the `commander` library to parse your commands
- Takes your input and calls the right functions
- Shows you pretty, colored output

**Example:**
```bash
queuectl enqueue '{"id":"job1","command":"echo hello"}'
```

**What happens:**
1. CLI receives the command
2. Parses the JSON
3. Calls `queue.enqueue()`
4. Shows you the result

---

### 2. **Storage Layer** (`src/storage.js`)

**What it does:** This is the "memory" of the system - it remembers everything.

**How it works:**
- Uses SQLite (a file-based database)
- Stores all jobs in a table
- Stores configuration in another table
- Provides functions to read/write data

**Key Functions:**

```javascript
createJob(job)        // Save a new job
getJob(id)           // Find a job by ID
updateJob(id, data)  // Update job information
lockJob(id, worker)  // Mark job as "being processed"
getNextPendingJob()  // Find the next job to process
getRetryableJobs()   // Find jobs that need retrying
```

**Database Location:** `.queuectl/jobs.db` (created automatically)

---

### 3. **Queue Manager** (`src/queue.js`)

**What it does:** This is the "brain" - it manages all the logic.

**How it works:**
- Connects Storage and Workers
- Handles job execution
- Implements retry logic
- Manages the Dead Letter Queue

**Key Functions:**

```javascript
enqueue(jobData)      // Add a job to the queue
executeJob(job, workerId)  // Run a job and handle result
getNextJob()          // Get the next job for a worker
list(state)           // List jobs by state
getDLQJobs()          // Get all DLQ jobs
retryFromDLQ(id)      // Move job back from DLQ
```

**The executeJob function is the heart:**

```javascript
executeJob(job, workerId) {
  1. Lock the job (so no other worker takes it)
  2. Try to run the command
  3. If success → mark as "completed"
  4. If failure → calculate retry delay
  5. If retries left → mark as "failed", schedule retry
  6. If no retries left → move to DLQ
}
```

---

### 4. **Worker System** (`src/worker.js`)

**What it does:** These are the "workers" - they actually do the work.

**How it works:**
- Each worker runs as a separate process
- Continuously looks for jobs
- Picks up jobs and executes them
- Handles graceful shutdown

**Worker Lifecycle:**

```
Start → Loop Forever:
  ├─ Get next job
  ├─ If job found:
  │   ├─ Lock it
  │   ├─ Execute it
  │   └─ Update status
  └─ Wait 1 second
  └─ Repeat
```

**Multiple Workers:**
- Each worker runs in its own Node.js process
- They all read from the same database
- Database locking prevents conflicts
- They can work in parallel

**Graceful Shutdown:**
- When you stop workers, they finish current job first
- Maximum wait: 30 seconds
- Then they exit cleanly

---

### 5. **Configuration** (`src/config.js`)

**What it does:** Stores settings that control behavior.

**Settings:**
- `max_retries`: How many times to retry (default: 3)
- `backoff_base`: Base number for exponential backoff (default: 2)

**How it works:**
- Stores config in the database
- Provides getter/setter functions
- Used by Queue Manager for retry calculations

---

## Data Flow

### Scenario: Enqueue and Process a Job

```
Step 1: User runs command
┌─────────────────────────────────────┐
│ queuectl enqueue '{"id":"job1"...}' │
└──────────────┬──────────────────────┘
               │
               ▼
Step 2: CLI parses and validates
┌─────────────────────────────────────┐
│ CLI validates JSON format            │
│ Checks: id exists, command exists    │
└──────────────┬──────────────────────┘
               │
               ▼
Step 3: Queue Manager processes
┌─────────────────────────────────────┐
│ queue.enqueue(jobData)              │
│ - Creates job object                │
│ - Sets default values               │
└──────────────┬──────────────────────┘
               │
               ▼
Step 4: Storage saves to database
┌─────────────────────────────────────┐
│ storage.createJob(job)              │
│ - Inserts into jobs table           │
│ - State: "pending"                  │
│ - Returns saved job                 │
└──────────────┬──────────────────────┘
               │
               ▼
Step 5: CLI shows result
┌─────────────────────────────────────┐
│ ✓ Job job1 enqueued successfully    │
└─────────────────────────────────────┘
```

### Scenario: Worker Processing a Job

```
Step 1: Worker starts looking
┌─────────────────────────────────────┐
│ Worker wakes up (every 1 second)     │
│ Calls: queue.getNextJob()            │
└──────────────┬──────────────────────┘
               │
               ▼
Step 2: Find available job
┌─────────────────────────────────────┐
│ Storage checks database:             │
│ - Looks for "pending" jobs           │
│ - Or "failed" jobs ready to retry    │
│ Returns: job1                        │
└──────────────┬──────────────────────┘
               │
               ▼
Step 3: Lock the job
┌─────────────────────────────────────┐
│ storage.lockJob("job1", "worker-1") │
│ - Changes state: "pending" → "processing" │
│ - Sets worker_id                     │
│ - Prevents other workers from taking │
└──────────────┬──────────────────────┘
               │
               ▼
Step 4: Execute the command
┌─────────────────────────────────────┐
│ queue.executeJob(job1, "worker-1")  │
│ - Runs: exec("echo hello")           │
│ - Waits for result                   │
└──────────────┬──────────────────────┘
               │
         ┌─────┴─────┐
         │           │
    Success      Failure
         │           │
         ▼           ▼
Step 5a: Success          Step 5b: Failure
┌──────────────┐         ┌──────────────┐
│ Update state │         │ Calculate    │
│ to:          │         │ retry delay: │
│ "completed"  │         │ delay = 2^1  │
│ Clear worker │         │ = 2 seconds  │
└──────────────┘         │              │
                         │ Update state │
                         │ to: "failed" │
                         │ Set next_retry_at │
                         └──────────────┘
```

---

## Job Lifecycle Explained

### State Transitions

```
                    ┌─────────┐
                    │ pending │  ← New jobs start here
                    └────┬────┘
                         │
                         │ Worker picks it up
                         ▼
                 ┌──────────────┐
                 │ processing   │  ← Currently running
                 └──────┬───────┘
                        │
            ┌───────────┴───────────┐
            │                       │
      Success                  Failure
            │                       │
            ▼                       ▼
    ┌─────────────┐         ┌──────────┐
    │  completed  │         │   failed    │  ← Will retry
    └─────────────┘         └──────┬───────┘
                                    │
                                    │ Retry time arrives
                                    │ (exponential backoff)
                                    ▼
                            ┌──────────────┐
                            │   pending    │  ← Back to queue
                            └──────┬───────┘
                                   │
                                   │ (if retries exhausted)
                                   ▼
                            ┌──────────────┐
                            │     dead     │  ← In DLQ
                            └──────────────┘
```

### Detailed State Descriptions

#### 1. **pending**
- **Meaning:** Job is waiting to be processed
- **When:** Right after enqueue, or when retry is scheduled
- **What workers do:** Workers look for jobs in this state

#### 2. **processing**
- **Meaning:** A worker is currently executing this job
- **When:** Worker has locked the job and is running the command
- **Protection:** Only one worker can have a job in this state

#### 3. **completed**
- **Meaning:** Job finished successfully
- **When:** Command executed with exit code 0
- **Final state:** Job stays here (can be cleaned up later)

#### 4. **failed**
- **Meaning:** Job failed but can be retried
- **When:** Command failed AND retries are still available
- **Next:** Will be retried after calculated delay

#### 5. **dead**
- **Meaning:** Job permanently failed (in DLQ)
- **When:** All retries exhausted
- **Recovery:** Can be manually retried using `dlq retry` command

---

## Retry Mechanism Deep Dive

### Exponential Backoff Formula

```
delay_seconds = backoff_base ^ attempts
```

### Example Calculation

**Settings:**
- `backoff_base = 2` (default)
- `max_retries = 3`

**Timeline:**

```
Attempt 1: Fails immediately
  └─ Wait: 2^1 = 2 seconds
  └─ Attempt 2: Fails
      └─ Wait: 2^2 = 4 seconds
      └─ Attempt 3: Fails
          └─ Wait: 2^3 = 8 seconds
          └─ Attempt 4: Fails
              └─ No more retries → Move to DLQ
```

**Visual Timeline:**

```
Time:  0s    2s    6s    14s
       │     │     │     │
       ▼     ▼     ▼     ▼
      Try1  Try2  Try3  Try4 → DLQ
       ✗     ✗     ✗     ✗
```

### Why Exponential Backoff?

1. **Gives system time to recover** - If a service is down, waiting longer helps
2. **Reduces load** - Doesn't hammer a failing service
3. **Handles temporary issues** - Short problems get fixed quickly, long problems wait longer

### Customizing Backoff

```bash
# Make retries happen faster (base = 1.5)
queuectl config set backoff-base 1.5

# Result: 1.5s, 2.25s, 3.375s delays

# Make retries happen slower (base = 3)
queuectl config set backoff-base 3

# Result: 3s, 9s, 27s delays
```

---

## Worker System Explained

### Single Worker Flow

```
┌─────────────────────────────────────────┐
│         Worker Process Starts           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Loop Forever:                          │
│  1. Call queue.getNextJob()             │
│  2. If job found:                       │
│     a. Lock it (state → processing)      │
│     b. Execute command                  │
│     c. Update result (success/fail)      │
│  3. Sleep 1 second                      │
│  4. Repeat                               │
└─────────────────────────────────────────┘
```

### Multiple Workers

**How they coordinate:**

```
Worker 1          Worker 2          Worker 3
   │                 │                 │
   │                 │                 │
   ▼                 ▼                 ▼
┌─────────────────────────────────────────┐
│         Shared Database                 │
│  (SQLite with row-level locking)        │
└─────────────────────────────────────────┘
   │                 │                 │
   │                 │                 │
   ▼                 ▼                 ▼
Worker 1          Worker 2          Worker 3
gets job1         gets job2         gets job3
```

**Locking prevents conflicts:**

```
Time    Worker 1              Worker 2              Database
─────────────────────────────────────────────────────────────
T1      Looks for job         -                     job1: pending
T2      Locks job1            -                     job1: processing (worker1)
T3      Executing...          Looks for job          job1: processing (worker1)
T4      Executing...          Gets job2              job1: processing, job2: processing
T5      Completes job1        Executing...           job1: completed, job2: processing
```

### Worker Process Management

**Starting Workers:**
```bash
queuectl worker start --count 3
```

**What happens:**
1. CLI spawns 3 separate Node.js processes
2. Each runs `worker-process.js` with a unique ID
3. Each process runs independently
4. PID files stored in `.queuectl/worker-*.pid`

**Stopping Workers:**
```bash
queuectl worker stop
```

**What happens:**
1. CLI reads all PID files
2. Sends SIGTERM signal to each process
3. Each worker finishes current job (max 30s wait)
4. Workers exit cleanly
5. PID files removed

---

## Database Schema

### Jobs Table

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,              -- Unique job identifier
  command TEXT NOT NULL,             -- Command to execute
  state TEXT NOT NULL,               -- pending/processing/completed/failed/dead
  attempts INTEGER DEFAULT 0,        -- Number of times attempted
  max_retries INTEGER DEFAULT 3,     -- Maximum retry attempts
  created_at TEXT NOT NULL,          -- When job was created (ISO 8601)
  updated_at TEXT NOT NULL,          -- Last update time (ISO 8601)
  next_retry_at TEXT,                -- When to retry (for failed jobs)
  worker_id TEXT,                    -- Which worker is processing it
  error_message TEXT                 -- Error message if failed
);
```

### Config Table

```sql
CREATE TABLE config (
  key TEXT PRIMARY KEY,              -- Config key (e.g., "max_retries")
  value TEXT NOT NULL                -- Config value (e.g., "3")
);
```

### Indexes

```sql
CREATE INDEX idx_state ON jobs(state);           -- Fast lookup by state
CREATE INDEX idx_next_retry ON jobs(next_retry_at);  -- Fast retry queries
CREATE INDEX idx_worker ON jobs(worker_id);     -- Fast worker lookups
```

---

## Step-by-Step Examples

### Example 1: Simple Successful Job

```bash
# Step 1: Enqueue
$ queuectl enqueue '{"id":"hello1","command":"echo Hello World"}'
✓ Job hello1 enqueued successfully

# What happened in database:
# INSERT INTO jobs VALUES (
#   'hello1',           -- id
#   'echo Hello World', -- command
#   'pending',          -- state
#   0,                  -- attempts
#   3,                  -- max_retries
#   '2025-01-15T10:00:00Z',  -- created_at
#   '2025-01-15T10:00:00Z'   -- updated_at
# )

# Step 2: Start worker
$ queuectl worker start
Worker worker-1234 started

# What worker does:
# 1. Calls getNextJob() → finds hello1
# 2. Locks hello1 (state → processing, worker_id → worker-1234)
# 3. Executes: exec("echo Hello World")
# 4. Gets exit code 0 (success)
# 5. Updates: state → completed, worker_id → null

# Step 3: Check status
$ queuectl status
Active Workers: 1
Pending: 0
Processing: 0
Completed: 1  ← hello1 is here
Failed: 0
Dead (DLQ): 0
```

### Example 2: Failed Job with Retries

```bash
# Step 1: Enqueue a job that will fail
$ queuectl enqueue '{"id":"fail1","command":"exit 1","max_retries":3}'
✓ Job fail1 enqueued successfully

# Step 2: Start worker
$ queuectl worker start

# Timeline:
# T=0s:  Worker picks up fail1
#        Executes: exit 1
#        Exit code: 1 (failure)
#        Attempts: 0 → 1
#        Delay = 2^1 = 2 seconds
#        State: failed
#        next_retry_at: T+2s

# T=2s:  Worker finds fail1 (retryable)
#        Executes: exit 1
#        Exit code: 1 (failure)
#        Attempts: 1 → 2
#        Delay = 2^2 = 4 seconds
#        State: failed
#        next_retry_at: T+6s

# T=6s:  Worker finds fail1 (retryable)
#        Executes: exit 1
#        Exit code: 1 (failure)
#        Attempts: 2 → 3
#        Delay = 2^3 = 8 seconds
#        State: failed
#        next_retry_at: T+14s

# T=14s: Worker finds fail1 (retryable)
#        Executes: exit 1
#        Exit code: 1 (failure)
#        Attempts: 3 → 4
#        Attempts (4) >= max_retries (3)
#        State: dead (moved to DLQ)

# Step 3: Check DLQ
$ queuectl dlq list
💀 Dead Letter Queue
✗ fail1
  Command: exit 1
  Attempts: 4/3
  Error: Command failed: exit 1
```

### Example 3: Multiple Workers Processing in Parallel

```bash
# Step 1: Enqueue 5 jobs
$ queuectl enqueue '{"id":"job1","command":"sleep 2 && echo 1"}'
$ queuectl enqueue '{"id":"job2","command":"sleep 2 && echo 2"}'
$ queuectl enqueue '{"id":"job3","command":"sleep 2 && echo 3"}'
$ queuectl enqueue '{"id":"job4","command":"sleep 2 && echo 4"}'
$ queuectl enqueue '{"id":"job5","command":"sleep 2 && echo 5"}'

# Step 2: Start 3 workers
$ queuectl worker start --count 3

# What happens:
# Worker 1: Locks job1 → Executes (2 seconds)
# Worker 2: Locks job2 → Executes (2 seconds)
# Worker 3: Locks job3 → Executes (2 seconds)
# 
# After 2 seconds:
# Worker 1: Completes job1, picks up job4
# Worker 2: Completes job2, picks up job5
# Worker 3: Completes job3, no more jobs
#
# After 4 seconds total:
# All 5 jobs completed (instead of 10 seconds with 1 worker)

# Step 3: Check results
$ queuectl list --state completed
📋 Jobs (completed)
completed    job1
completed    job2
completed    job3
completed    job4
completed    job5
```

### Example 4: Retry from DLQ

```bash
# Step 1: Job is in DLQ (from previous example)
$ queuectl dlq list
✗ fail1
  Command: exit 1
  Attempts: 4/3

# Step 2: Retry it (resets attempts)
$ queuectl dlq retry fail1
✓ Job fail1 moved back to pending queue

# What happened:
# UPDATE jobs SET
#   state = 'pending',
#   attempts = 0,
#   next_retry_at = NULL,
#   error_message = NULL
# WHERE id = 'fail1'

# Step 3: Worker picks it up again
# (Will retry 3 more times with fresh attempt counter)
```

---

## Key Concepts Summary

### 1. **Persistence**
- All jobs stored in SQLite database
- Survives restarts, crashes, power loss
- Database file: `.queuectl/jobs.db`

### 2. **Concurrency**
- Multiple workers can run simultaneously
- Database locking prevents conflicts
- Each job processed by exactly one worker

### 3. **Reliability**
- Failed jobs automatically retried
- Exponential backoff prevents system overload
- DLQ captures permanently failed jobs

### 4. **Flexibility**
- Configurable retry count
- Configurable backoff base
- Can retry jobs from DLQ manually

### 5. **Observability**
- Status command shows overview
- List command shows details
- DLQ shows problematic jobs

---

## Technical Details

### Command Execution

```javascript
execAsync(job.command, {
  timeout: 30000,        // 30 second timeout
  maxBuffer: 1024 * 1024  // 1MB output buffer
})
```

**Success Criteria:** Exit code 0
**Failure Criteria:** Non-zero exit code OR timeout OR command not found

### Locking Mechanism

Uses SQLite's row-level locking:
```sql
UPDATE jobs 
SET state = 'processing', worker_id = ?
WHERE id = ? AND state = 'pending'
```

This is **atomic** - only one worker can successfully lock a job.

### Process Management

- Workers run as separate Node.js processes
- PID files track running workers
- SIGTERM signal for graceful shutdown
- SIGKILL as fallback if needed

---

## Common Questions

### Q: What happens if a worker crashes?
**A:** The job stays in "processing" state. You can manually reset it or restart workers (they'll skip stuck jobs after timeout).

### Q: Can I change max_retries for an existing job?
**A:** No, max_retries is set when the job is created. You'd need to create a new job.

### Q: How are jobs ordered?
**A:** FIFO (First In, First Out) - oldest pending jobs are processed first.

### Q: Can I pause workers?
**A:** Not directly, but you can stop them and start again later. Jobs will wait.

### Q: What if the database gets corrupted?
**A:** SQLite is very reliable, but you can backup `.queuectl/jobs.db` regularly.

---

## Conclusion

**queuectl** is a robust, production-ready job queue system that:
- ✅ Handles background job execution reliably
- ✅ Retries failed jobs intelligently
- ✅ Supports multiple workers for parallel processing
- ✅ Persists all data across restarts
- ✅ Provides a clean CLI interface

The architecture is modular, making it easy to understand, maintain, and extend.


