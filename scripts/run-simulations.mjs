import fs from 'node:fs';
import path from 'node:path';

const IMAGES_DIR = 'D:\\random images';
const API_URL = 'http://localhost:3000/api/v1/reports/found';
const AUTH_URL = 'http://localhost:3000/api/v1/auth/login';

const DEMO_EMAIL = 'superadmin@khozo.gov.in';
const DEMO_PASSWORD = 'password123'; 

async function runSimulation() {
  console.log('🧪 Starting Aarakshak Simulation Pipeline...');

  let token = '';

  try {
    console.log(`🔐 Logging in as ${DEMO_EMAIL}...`);
    const loginRes = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD })
    });
    
    if (!loginRes.ok) {
      console.log('Login failed (server might not be running or credentials changed). Assuming local demo mode...');
    } else {
      const loginData = await loginRes.json();
      token = loginData.data?.session?.access_token || '';
      console.log('✅ Logged in successfully.');
    }
  } catch (err) {
    console.log('Authentication Error:', err.message);
  }

  if (fs.existsSync(IMAGES_DIR)) {
    const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
    console.log(`📸 Found ${files.length} test images. Starting batch simulation...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.join(IMAGES_DIR, file);
      
      console.log(`\n⏳ Simulating report for [${file}]...`);
      
      const form = new FormData();
      form.append('name', `Test Subject ${i + 1}`);
      form.append('description', `Simulation report for ${file}`);
      form.append('latitude', '28.6139');
      form.append('longitude', '77.2090');
      
      // Use fs.openAsBlob for native FormData
      const blob = new Blob([fs.readFileSync(filePath)], { type: file.endsWith('.png') ? 'image/png' : 'image/jpeg' });
      form.append('photo', blob, file);

      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: form,
          headers: headers
        });

        if (res.ok) {
          const data = await res.json();
          const matchStatus = data.data?.status || 'unknown';
          console.log(`✅ Success! ID: ${data.data?.id}`);
          console.log(`🎯 Aarakshak Match Status: ${matchStatus}`);
        } else {
          console.log(`❌ Failed to submit: ${res.status} ${res.statusText}`);
          const errText = await res.text();
          console.log(`Error details: ${errText}`);
        }
      } catch (err) {
        console.error(`💥 Network Error: ${err.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    console.log('\n🎉 Simulation completed successfully!');
  } else {
    console.log(`❌ Test directory not found: ${IMAGES_DIR}`);
  }
}

runSimulation();
