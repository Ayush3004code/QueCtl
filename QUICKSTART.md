# Quick Start Guide

## Installation

```bash
npm install
```

## Basic Usage

### 1. Enqueue a Job

```bash
node src/cli.js enqueue '{"id":"job1","command":"echo Hello World"}'
```

### 2. Start a Worker

```bash
node src/cli.js worker start
```

### 3. Check Status

```bash
node src/cli.js status
```

### 4. List Jobs

```bash
node src/cli.js list
```

### 5. Stop Workers

```bash
node src/cli.js worker stop
```

## Testing

Run the validation script:

```bash
npm test
```

## Common Workflows

### Process Multiple Jobs

```bash
# Enqueue jobs
node src/cli.js enqueue '{"id":"job1","command":"sleep 1"}'
node src/cli.js enqueue '{"id":"job2","command":"sleep 1"}'
node src/cli.js enqueue '{"id":"job3","command":"sleep 1"}'

# Start 3 workers
node src/cli.js worker start --count 3

# Check progress
node src/cli.js status

# Stop workers when done
node src/cli.js worker stop
```

### Handle Failed Jobs

```bash
# Enqueue a job that will fail
node src/cli.js enqueue '{"id":"fail1","command":"exit 1","max_retries":3}'

# Start worker (will retry automatically)
node src/cli.js worker start

# Check failed jobs
node src/cli.js list --state failed

# After retries exhausted, check DLQ
node src/cli.js dlq list

# Retry from DLQ
node src/cli.js dlq retry fail1
```

### Configure Retries

```bash
# Set max retries
node src/cli.js config set max-retries 5

# Set backoff base (for exponential backoff)
node src/cli.js config set backoff-base 2.5

# View config
node src/cli.js config list
```

