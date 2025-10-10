#!/usr/bin/env node

// Simple test script to verify server endpoints work
import axios from 'axios';

const API_BASE = 'http://localhost:5055';

async function testHealth() {
  try {
    console.log('Testing /health endpoint...');
    const response = await axios.get(`${API_BASE}/health`);
    console.log('Health check response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Health check failed:', error.message);
    return null;
  }
}

async function testEncode() {
  try {
    console.log('Testing /encode endpoint...');
    const response = await axios.post(`${API_BASE}/encode`, {
      message: 'Hello World'
    }, {
      responseType: 'arraybuffer'
    });
    console.log('Encode response: Success, WAV file size:', response.data.length, 'bytes');
    return true;
  } catch (error) {
    console.error('Encode test failed:', error.response?.data || error.message);
    return false;
  }
}

async function main() {
  console.log('Testing server endpoints...\n');
  
  const health = await testHealth();
  if (!health) {
    console.log('Server is not running or not accessible. Please start the server first.');
    process.exit(1);
  }
  
  console.log('\nHealth check results:');
  console.log('- Server OK:', health.ok);
  console.log('- ggwave-to-file available:', health.toFile);
  console.log('- ggwave-from-file available:', health.fromFile);
  console.log('- ggwave-cli available:', health.cli);
  console.log('- ffmpeg available:', health.ffmpeg);
  
  if (health.toFile) {
    await testEncode();
  } else {
    console.log('Skipping encode test - ggwave-to-file not available');
  }
  
  console.log('\nTest completed!');
}

main().catch(console.error);
