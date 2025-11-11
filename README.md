# queuectl - CLI Background Job Queue System

A production-grade, CLI-based background job queue system built with Node.js. Manage background jobs with worker processes, automatic retries using exponential backoff, and a Dead Letter Queue (DLQ) for permanently failed jobs.

## 🚀 Features

- ✅ **Job Management**: Enqueue, list, and track background jobs
- ✅ **Worker Processes**: Run multiple workers in parallel
- ✅ **Automatic Retries**: Exponential backoff retry mechanism
- ✅ **Dead Letter Queue**: Handle permanently failed jobs
- ✅ **Persistent Storage**: SQLite database for job persistence
- ✅ **Configuration Management**: Configurable retry count and backoff base
- ✅ **Graceful Shutdown**: Workers finish current jobs before exiting
- ✅ **Job Locking**: Prevents duplicate job processing

## 📋 Prerequisites

- Node.js >= 14.0.0
- npm or yarn

## 🔧 Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Flam
```

2. Install dependencies:
```bash
npm install
```

3. Make the CLI executable (Linux/Mac):
```bash
chmod +x src/cli.js
```

## 📖 Usage

### Enqueue a Job

Add a new job to the queue:

```bash
queuectl enqueue '{"id":"job1","command":"echo Hello World"}'
```

With custom retry count:

```bash
queuectl enqueue '{"id":"job2","command":"sleep 2","max_retries":5}'
```

### Start Workers

Start a single worker:
```bash
queuectl worker start
```

Start multiple workers:
```bash
queuectl worker start --count 3
```

### Stop Workers

Stop all running workers gracefully:
```bash
queuectl worker stop
```

### Check Status

View queue statistics and active workers:
```bash
queuectl status
```

### List Jobs

List all jobs:
```bash
queuectl list
```

Filter by state:
```bash
queuectl list --state pending
queuectl list --state failed
queuectl list --state completed
```

### Dead Letter Queue

List all jobs in DLQ:
```bash
queuectl dlq list
```

Retry a job from DLQ:
```bash
queuectl dlq retry job1
```

### Configuration

Set max retries:
```bash
queuectl config set max-retries 5
```

Set backoff base (for exponential backoff):
```bash
queuectl config set backoff-base 2.5
```

Get a config value:
```bash
queuectl config get max-retries
```

List all configuration:
```bash
queuectl config list
```

## 🏗️ Architecture

### Job Lifecycle

```
pending → processing → completed
   ↓
failed → (retry with backoff) → pending
   ↓
dead (DLQ)
```

### Components

1. **Storage Layer** (`src/storage.js`)
   - SQLite database for persistent job storage
   - Handles all database operations
   - Manages job states and locking

2. **Queue Manager** (`src/queue.js`)
   - Job enqueueing and execution
   - Retry logic with exponential backoff
   - DLQ management

3. **Worker Processes** (`src/worker.js`)
   - Background job execution
   - Process locking to prevent duplicates
   - Graceful shutdown handling

4. **Configuration** (`src/config.js`)
   - Persistent configuration storage
   - Default values management

5. **CLI Interface** (`src/cli.js`)
   - Command-line interface using Commander.js
   - User-friendly output with colors

### Data Persistence

Jobs are stored in a SQLite database located at `.queuectl/jobs.db`. This ensures:
- Jobs persist across restarts
- Worker crashes don't lose job data
- Configuration is maintained

### Retry Mechanism

Failed jobs are automatically retried with exponential backoff:
- Delay = `backoff_base ^ attempts` seconds
- Default: `backoff_base = 2`, so delays are 2s, 4s, 8s, etc.
- After `max_retries` attempts, jobs move to DLQ

### Worker Locking

Each job is locked when picked up by a worker:
- State changes from `pending` to `processing`
- Worker ID is assigned
- Prevents multiple workers from processing the same job

## 🧪 Testing

Run the validation script to test core functionality:

```bash
npm test
```

Or manually:

```bash
node test/validate.js
```

### Manual Testing Scenarios

1. **Basic Job Completion**:
```bash
queuectl enqueue '{"id":"test1","command":"echo success"}'
queuectl worker start
# Wait a few seconds
queuectl list --state completed
```

2. **Failed Job Retry**:
```bash
queuectl enqueue '{"id":"test2","command":"exit 1","max_retries":3}'
queuectl worker start
# Watch the job retry with backoff
queuectl list --state failed
```

3. **DLQ Movement**:
```bash
queuectl enqueue '{"id":"test3","command":"nonexistent-command","max_retries":2}'
queuectl worker start
# After retries exhausted, check DLQ
queuectl dlq list
```

4. **Multiple Workers**:
```bash
queuectl enqueue '{"id":"job1","command":"sleep 1"}'
queuectl enqueue '{"id":"job2","command":"sleep 1"}'
queuectl enqueue '{"id":"job3","command":"sleep 1"}'
queuectl worker start --count 3
# Jobs should process in parallel
```

5. **Persistence Test**:
```bash
queuectl enqueue '{"id":"persist1","command":"echo test"}'
# Stop workers and restart
queuectl worker stop
queuectl worker start
# Job should still be there
queuectl list
```

## 📁 Project Structure

```
.
├── src/
│   ├── cli.js              # CLI interface
│   ├── queue.js             # Queue management
│   ├── worker.js            # Worker processes
│   ├── storage.js           # Database layer
│   ├── config.js            # Configuration
│   └── worker-process.js    # Worker entry point
├── test/
│   └── validate.js          # Validation script
├── .queuectl/               # Data directory (created at runtime)
│   └── jobs.db              # SQLite database
├── package.json
└── README.md
```

## ⚙️ Configuration

Default configuration:
- `max_retries`: 3
- `backoff_base`: 2

These can be changed using the `queuectl config` commands.

## 🔍 Job States

| State | Description |
|-------|-------------|
| `pending` | Waiting to be picked up by a worker |
| `processing` | Currently being executed |
| `completed` | Successfully executed |
| `failed` | Failed, but retryable |
| `dead` | Permanently failed (moved to DLQ) |

## 🎯 Assumptions & Trade-offs

### Assumptions

1. **Command Execution**: Jobs execute shell commands. Commands that don't exist or fail will trigger retries.
2. **Timeout**: Commands have a 30-second timeout to prevent hanging jobs.
3. **Exit Codes**: Exit code 0 = success, non-zero = failure.
4. **Single Machine**: Designed for single-machine deployment (not distributed).

### Trade-offs

1. **SQLite**: Chosen for simplicity and zero-configuration. For production at scale, consider PostgreSQL or Redis.
2. **File-based PID tracking**: Workers track PIDs in files. More robust solutions exist but add complexity.
3. **Polling**: Workers poll for jobs every second. Event-driven approach would be more efficient but more complex.
4. **No job priorities**: All jobs are processed FIFO. Priority queues could be added.

## 🐛 Troubleshooting

### Workers not starting
- Check Node.js version: `node --version` (should be >= 14)
- Check if port/process conflicts exist
- Review `.queuectl/` directory permissions

### Jobs stuck in processing
- Workers may have crashed. Restart workers: `queuectl worker stop && queuectl worker start`
- Manually reset stuck jobs in the database if needed

### Database locked errors
- Ensure only one process accesses the database at a time
- Close any database connections before restarting

## 📝 License

MIT

## 👤 Author

Built as a technical assessment project.


## 🎥 Demo Video

A working CLI demo video is available at: [https://drive.google.com/file/d/1MHmXmaa3TMCwfDELjl4RLiRJFjMSllZj/view?usp=sharing]

The demo showcases:
- Enqueueing jobs
- Starting multiple workers
- Job processing and completion
- Failed job retries with exponential backoff
- Dead Letter Queue operations
- Configuration management

