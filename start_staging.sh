#!/bin/bash

# Staging script to start both backend and frontend servers

echo "🚀 Starting Convo Book Staging Environment..."

# Set environment for staging
export ENVIRONMENT=staging

# Copy appropriate env files if they exist
echo "📝 Setting up staging environment files..."
if [ -f "backend/app/.env.staging" ]; then
    cp backend/app/.env.staging backend/app/.env
    echo "✅ Copied backend/.env.staging to backend/.env"
else
    echo "❌ backend/app/.env.staging not found!"
    echo "Please create backend/app/.env.staging with staging configuration"
    exit 1
fi

if [ -f "frontend/.env.staging" ]; then
    cp frontend/.env.staging frontend/.env
    echo "✅ Copied frontend/.env.staging to frontend/.env"
else
    echo "❌ frontend/.env.staging not found!"
    echo "Please create frontend/.env.staging with staging configuration"
    exit 1
fi

# Function to kill background processes on exit
cleanup() {
    echo "🛑 Stopping staging servers..."
    
    # Kill specific processes if PIDs are available
    if [ ! -z "$BACKEND_PID" ]; then
        echo "Stopping backend server (PID: $BACKEND_PID)..."
        kill $BACKEND_PID 2>/dev/null
        # Wait a bit and force kill if necessary
        sleep 2
        kill -9 $BACKEND_PID 2>/dev/null
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        echo "Stopping frontend server (PID: $FRONTEND_PID)..."
        kill $FRONTEND_PID 2>/dev/null
        # Wait a bit and force kill if necessary
        sleep 2
        kill -9 $FRONTEND_PID 2>/dev/null
    fi
    
    # Kill any remaining processes that might be using our ports
    echo "Cleaning up any remaining processes on ports 5173 and 8000..."
    lsof -ti:5173 | xargs kill -9 2>/dev/null
    lsof -ti:8000 | xargs kill -9 2>/dev/null
    
    # Kill any remaining vite or uvicorn processes
    pkill -f "vite" 2>/dev/null
    pkill -f "uvicorn.*--port 8000" 2>/dev/null
    
    echo "🏁 Staging cleanup complete!"
    exit
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Start backend server
echo "🔧 Starting Backend (FastAPI) for staging on port 8000..."
cd backend
if [ -d "../venv" ]; then
    source ../venv/bin/activate
fi
uvicorn app.main:app --reload --reload-dir app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 2

# Start frontend development server with staging mode
echo "⚛️  Starting Frontend (React) for staging on port 5173..."
cd frontend
npm run dev:staging &
FRONTEND_PID=$!
cd ..

echo "✅ Staging environment is ready!"
echo "📱 Frontend (React): http://localhost:5173"
echo "🔧 Backend API: http://localhost:8000"
echo "📚 API Documentation: http://localhost:8000/docs"
echo "🌍 Environment: STAGING"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for background processes
wait 