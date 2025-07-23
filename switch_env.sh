#!/bin/bash

# Environment switching script for Convo Book

if [ $# -eq 0 ]; then
    echo "🔧 Environment Switcher for Convo Book"
    echo ""
    echo "Usage: ./switch_env.sh <environment>"
    echo ""
    echo "Available environments:"
    echo "  development  - Local development with SQLite"
    echo "  staging      - Staging environment with RDS"
    echo "  production   - Production environment with RDS"
    echo ""
    echo "Current environment files:"
    echo "  Backend: $([ -f "backend/app/.env" ] && echo "✅ Found" || echo "❌ Not found")"
    echo "  Frontend: $([ -f "frontend/.env" ] && echo "✅ Found" || echo "❌ Not found")"
    exit 1
fi

ENVIRONMENT=$1

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    echo "❌ Invalid environment: $ENVIRONMENT"
    echo "Valid options: development, staging, production"
    exit 1
fi

echo "🔄 Switching to $ENVIRONMENT environment..."

# Set environment variable
export ENVIRONMENT=$ENVIRONMENT

# Copy backend env file
if [ -f "backend/app/.env.$ENVIRONMENT" ]; then
    cp "backend/app/.env.$ENVIRONMENT" "backend/app/.env"
    echo "✅ Backend: Copied .env.$ENVIRONMENT to .env"
else
    echo "❌ Backend: .env.$ENVIRONMENT not found!"
    echo "Please create backend/app/.env.$ENVIRONMENT"
    exit 1
fi

# Copy frontend env file
if [ -f "frontend/.env.$ENVIRONMENT" ]; then
    cp "frontend/.env.$ENVIRONMENT" "frontend/.env"
    echo "✅ Frontend: Copied .env.$ENVIRONMENT to .env"
else
    echo "❌ Frontend: .env.$ENVIRONMENT not found!"
    echo "Please create frontend/.env.$ENVIRONMENT"
    exit 1
fi

echo ""
echo "🎉 Successfully switched to $ENVIRONMENT environment!"
echo ""
echo "Next steps:"
case $ENVIRONMENT in
    "development")
        echo "  ./start_dev.sh"
        ;;
    "staging")
        echo "  ./start_staging.sh"
        ;;
    "production")
        echo "  ./start_production.sh"
        ;;
esac 