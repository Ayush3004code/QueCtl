#!/bin/bash

# Quick demo script for queuectl
# This demonstrates the core functionality

echo "🚀 queuectl Demo"
echo "================"
echo ""

# Clean up any existing data
rm -rf .queuectl

echo "1. Enqueue some jobs..."
node ../src/cli.js enqueue '{"id":"demo1","command":"echo Hello from job 1"}'
node ../src/cli.js enqueue '{"id":"demo2","command":"sleep 1 && echo Hello from job 2"}'
node ../src/cli.js enqueue '{"id":"demo3","command":"echo Hello from job 3"}'

echo ""
echo "2. Check status..."
node ../src/cli.js status

echo ""
echo "3. List pending jobs..."
node ../src/cli.js list --state pending

echo ""
echo "4. Start a worker..."
node ../src/cli.js worker start &
WORKER_PID=$!

echo "Waiting for jobs to process..."
sleep 3

echo ""
echo "5. Check status again..."
node ../src/cli.js status

echo ""
echo "6. List completed jobs..."
node ../src/cli.js list --state completed

echo ""
echo "7. Stop worker..."
node ../src/cli.js worker stop

echo ""
echo "✅ Demo complete!"

