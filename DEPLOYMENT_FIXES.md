# Deployment Fixes for 500 Errors

## Issues Fixed

1. **Missing Environment Variables**: Added fallback paths for binary locations
2. **Binary Permissions**: Ensured all ggwave binaries have execute permissions
3. **Missing Dependencies**: Fixed Dockerfile to copy all required binaries
4. **Error Handling**: Added better error logging and health checks
5. **ffmpeg Dependency**: Added ffmpeg availability check

## Changes Made

### Server Code (`app/server/src/index.js`)
- Added fallback paths for environment variables
- Enhanced error logging and binary existence checks
- Added ffmpeg availability check to health endpoint
- Improved error handling for file operations

### Dockerfile
- Fixed binary copying to include all required executables
- Added execute permissions for all binaries
- Ensured proper library path setup

## Deployment Steps

1. **Rebuild and Redeploy**:
   ```bash
   # If using Render, trigger a new deployment
   # If using Docker, rebuild the image:
   docker build -t your-app .
   docker run -p 5055:5055 your-app
   ```

2. **Test the Health Endpoint**:
   ```bash
   curl https://vocrypt.onrender.com/health
   ```
   
   Expected response:
   ```json
   {
     "ok": true,
     "toFile": true,
     "fromFile": true,
     "cli": true,
     "ffmpeg": true
   }
   ```

3. **Test Encode Endpoint**:
   ```bash
   curl -X POST https://vocrypt.onrender.com/encode \
     -H "Content-Type: application/json" \
     -d '{"message": "Hello World"}' \
     --output test.wav
   ```

## Troubleshooting

If you still get 500 errors:

1. **Check Server Logs**: Look for the startup logs showing binary paths and availability
2. **Verify Environment Variables**: Ensure `GGWAVE_BIN_DIR` and `GGWAVE_CLI` are set correctly
3. **Check Binary Permissions**: Ensure all binaries in `/opt/ggwave/bin/` are executable
4. **Verify ffmpeg**: Ensure ffmpeg is installed and available in the container

## Local Testing

To test locally before deploying:

```bash
# Start the server
cd app/server
npm install
node src/index.js

# In another terminal, test the endpoints
node test-server.js
```

## Expected Behavior

After these fixes:
- `/health` endpoint should return all services as available
- `/encode` endpoint should work without 500 errors
- `/decode-webm` endpoint should work with proper ffmpeg conversion
- Server logs should show successful binary detection
