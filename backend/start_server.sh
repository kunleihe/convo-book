#!/bin/bash

# Production server launcher for FastAPI backend
echo "🚀 Starting FastAPI Development Server..."

# Set default environment if not provided
ENVIRONMENT=${ENVIRONMENT:-development}
echo "🔧 Environment: $ENVIRONMENT"

# Navigate to the backend directory
cd "$(dirname "$0")"

# Copy appropriate env file if it exists
echo "📝 Setting up environment files..."
if [ -f "app/.env.$ENVIRONMENT" ]; then
    cp "app/.env.$ENVIRONMENT" "app/.env"
    echo "✅ Copied app/.env.$ENVIRONMENT to app/.env"
else
    echo "⚠️  app/.env.$ENVIRONMENT not found, using existing .env"
fi

# Activate virtual environment if it exists
if [ -d "../venv" ]; then
    echo "📦 Activating virtual environment..."
    source ../venv/bin/activate
else
    echo "⚠️  No virtual environment found at ../venv"
fi

# Start the FastAPI server based on environment
if [ "$ENVIRONMENT" = "production" ]; then
    echo "🔧 Starting FastAPI server for PRODUCTION (optimized)..."
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
elif [ "$ENVIRONMENT" = "staging" ]; then
    echo "🔧 Starting FastAPI server for STAGING..."
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
else
    echo "🔧 Starting FastAPI server for DEVELOPMENT..."
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
fi 