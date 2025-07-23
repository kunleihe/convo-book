# Environment Configuration Guide

This document explains how to configure and run Convo Book in different environments (development, staging, production).

## 📁 File Structure

After completing the environment setup, your project should have these environment files:

```
convo-book/
├── backend/app/
│   ├── .env.development     # Development backend config
│   ├── .env.staging         # Staging backend config  
│   ├── .env.production      # Production backend config
│   └── .env                 # Active environment (symlink/copy)
├── frontend/
│   ├── .env.development     # Development frontend config
│   ├── .env.staging         # Staging frontend config
│   ├── .env.production      # Production frontend config  
│   └── .env                 # Active environment (symlink/copy)
├── start_dev.sh             # Development startup script
├── start_staging.sh         # Staging startup script
├── start_production.sh      # Production startup script
└── switch_env.sh            # Environment switching utility
```

## 🔧 Environment Files

### Backend Environment Files

**`backend/app/.env.development`:**
```env
# Development Environment
ENVIRONMENT=development
OPENAI_API_KEY=your-openai-api-key
OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01
USE_AZURE_OPENAI=False
DATABASE_URL=sqlite:///./app_dev.db
JWT_SECRET_KEY=your-dev-jwt-secret-key
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
```

**`backend/app/.env.staging`:**
```env
# Staging Environment
ENVIRONMENT=staging
OPENAI_API_KEY=your-openai-api-key
OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01
USE_AZURE_OPENAI=False
DATABASE_URL=postgresql://user:password@staging-rds-endpoint:5432/dbname
JWT_SECRET_KEY=your-staging-jwt-secret-key
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
```

**`backend/app/.env.production`:**
```env
# Production Environment
ENVIRONMENT=production
OPENAI_API_KEY=your-production-openai-api-key
OPENAI_REALTIME_URL=wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01
USE_AZURE_OPENAI=False
DATABASE_URL=postgresql://user:password@production-rds-endpoint:5432/dbname
JWT_SECRET_KEY=your-production-jwt-secret-key
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=30
```

### Frontend Environment Files

**`frontend/.env.development`:**
```env
# Development Environment
VITE_ENVIRONMENT=development
VITE_API_URL=http://localhost:8000
```

**`frontend/.env.staging`:**
```env
# Staging Environment  
VITE_ENVIRONMENT=staging
VITE_API_URL=https://your-staging-api-domain.com
```

**`frontend/.env.production`:**
```env
# Production Environment
VITE_ENVIRONMENT=production
VITE_API_URL=https://your-production-api-domain.com
```

## 🚀 Running Different Environments

### Option 1: Using Environment-Specific Scripts

**Development:**
```bash
./start_dev.sh
```
- Uses SQLite database
- Frontend and backend both run locally
- Hot reload enabled
- Auto-generates JWT secret if not provided

**Staging:**
```bash
./start_staging.sh
```
- Uses RDS database
- Can test against staging APIs
- Hot reload enabled for development
- Requires all environment variables

**Production:**
```bash
./start_production.sh
```
- Builds frontend for production
- Uses RDS database
- Optimized server settings (multiple workers)
- Requires all environment variables

### Option 2: Using Environment Switcher

```bash
# Switch to development
./switch_env.sh development

# Switch to staging  
./switch_env.sh staging

# Switch to production
./switch_env.sh production

# Then run the appropriate script
./start_dev.sh      # or start_staging.sh or start_production.sh
```

### Option 3: Manual Environment Variable

```bash
# Set environment and run
export ENVIRONMENT=staging
./start_dev.sh

# Or for backend only
cd backend
ENVIRONMENT=production ./start_server.sh
```

## 📦 Frontend Build Commands

The frontend now supports environment-specific builds:

```bash
cd frontend

# Development builds
npm run dev                    # Development mode
npm run build:development      # Build for development

# Staging builds  
npm run dev:staging           # Staging mode
npm run build:staging         # Build for staging

# Production builds
npm run dev:production        # Production mode  
npm run build:production      # Build for production (default)
npm run build                 # Also production (default)

# Preview builds
npm run preview               # Preview production build
npm run preview:staging       # Preview staging build
```

## 🔍 Configuration Validation

The backend automatically validates required environment variables:

- **Development**: Only requires `OPENAI_API_KEY`
- **Staging**: Requires `OPENAI_API_KEY`, `DATABASE_URL`, `JWT_SECRET_KEY`  
- **Production**: Requires `OPENAI_API_KEY`, `DATABASE_URL`, `JWT_SECRET_KEY`

Missing variables will cause startup to fail with a clear error message.

## 🗄️ Database Configuration

**Development:**
- Uses SQLite: `app_dev.db`
- No external dependencies
- Data persists locally

**Staging/Production:**
- Uses PostgreSQL (RDS)
- Requires `DATABASE_URL` environment variable
- Shared data across deployments

## 🌐 CORS Configuration

CORS origins are automatically configured based on environment:

**Development:**
- `http://localhost:5173` (Vite dev server)
- `http://localhost:8000` (Backend)
- `https://dev.d2j24wh52qkpf2.amplifyapp.com` (Dev frontend)

**Staging:**
- `https://staging.d2j24wh52qkpf2.amplifyapp.com`
- `http://localhost:5173` (for local testing)

**Production:**
- `https://cs6460.d2j24wh52qkpf2.amplifyapp.com`

## 🔐 Security Considerations

**Development:**
- JWT secret auto-generated if not provided
- SQLite database (local only)
- Debug logging enabled

**Staging:**
- Requires secure JWT secret
- RDS database with network security
- Similar to production but with debug features

**Production:**
- Requires secure JWT secret
- RDS database with strict security
- Optimized performance (multiple workers)
- No debug features

## 🐛 Troubleshooting

**Environment file not found:**
```bash
❌ backend/app/.env.staging not found!
```
- Create the missing environment file
- Use the templates above as reference

**Database connection failed:**
```bash
❌ DATABASE_URL environment variable must be set for staging environment
```
- Set the `DATABASE_URL` in your environment file
- Ensure the database is accessible

**Frontend can't connect to backend:**
- Check `VITE_API_URL` in frontend environment file
- Ensure backend is running on the correct URL
- Verify CORS configuration

**JWT token issues:**
- Set `JWT_SECRET_KEY` in staging/production
- Use a secure, random key for production
- Ensure key is consistent across deployments

## 📝 Best Practices

1. **Never commit `.env` files** - Add them to `.gitignore`
2. **Use different API keys** for each environment
3. **Set secure JWT secrets** for staging/production  
4. **Test environment switching** before deploying
5. **Use the switcher script** for quick environment changes
6. **Validate configs** by running each environment locally
7. **Document environment-specific settings** for your team

## 🔄 Migration from Old Setup

If you had an existing `.env` file:

1. **Backup your current `.env` files:**
   ```bash
   cp backend/app/.env backend/app/.env.backup
   cp frontend/.env frontend/.env.backup  # if it exists
   ```

2. **Create environment-specific files** using the templates above

3. **Test each environment:**
   ```bash
   ./switch_env.sh development && ./start_dev.sh
   # Test your app, then Ctrl+C
   
   ./switch_env.sh staging && ./start_staging.sh  
   # Test your app, then Ctrl+C
   ```

4. **Update your deployment scripts** to use the new environment system 