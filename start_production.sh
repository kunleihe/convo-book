#!/bin/bash

# Production script to build and start the application

echo "🚀 Starting Convo Book Production Environment..."

# Set environment for production
export ENVIRONMENT=production

# Copy appropriate env files if they exist
echo "📝 Setting up production environment files..."
if [ -f "backend/app/.env.production" ]; then
    cp backend/app/.env.production backend/app/.env
    echo "✅ Copied backend/.env.production to backend/.env"
else
    echo "❌ backend/app/.env.production not found!"
    echo "Please create backend/app/.env.production with production configuration"
    exit 1
fi

if [ -f "frontend/.env.production" ]; then
    cp frontend/.env.production frontend/.env
    echo "✅ Copied frontend/.env.production to frontend/.env"
else
    echo "❌ frontend/.env.production not found!"
    echo "Please create frontend/.env.production with production configuration"
    exit 1
fi

# Function to kill background processes on exit
cleanup() {
    echo "🛑 Stopping production server..."
    
    # Kill specific processes if PIDs are available
    if [ ! -z "$BACKEND_PID" ]; then
        echo "Stopping backend server (PID: $BACKEND_PID)..."
        kill $BACKEND_PID 2>/dev/null
        # Wait a bit and force kill if necessary
        sleep 2
        kill -9 $BACKEND_PID 2>/dev/null
    fi
    
    echo "🏁 Production cleanup complete!"
    exit
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Build frontend for production
echo "🏗️  Building Frontend for production..."
cd frontend
npm run build:production
if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed!"
    exit 1
fi
echo "✅ Frontend built successfully"
cd ..

# Start backend server for production
echo "🔧 Starting Backend (FastAPI) for production..."
cd backend
if [ -d "../venv" ]; then
    source ../venv/bin/activate
fi

# Use production settings (no reload, optimized for performance)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 &
BACKEND_PID=$!
cd ..

echo "✅ Production environment is ready!"
echo "🌐 Application: http://localhost:8000/app"
echo "🔧 Backend API: http://localhost:8000"
echo "📚 API Documentation: http://localhost:8000/docs"
echo "🌍 Environment: PRODUCTION"
echo ""
echo "Press Ctrl+C to stop the server"

# Wait for backend process
wait 