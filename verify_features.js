import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3000';

async function runTests() {
  console.log("Starting verification tests...");
  
  const testPhone = '9999999999';
  const testPassword = 'password123';
  
  // 1. Register a new user
  console.log("\n1. Testing Registration...");
  const regPayload = {
    name: 'Test Farmer',
    phone: testPhone,
    village: 'Solapur',
    crop_type: 'Tomato',
    language: 'mr',
    password: testPassword
  };

  let token = '';
  let farmerId = null;

  try {
    const regRes = await fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload)
    });
    const regJson = await regRes.json();
    if (regRes.ok && regJson.success) {
      console.log("✅ Registration Successful!");
      token = regJson.token;
      farmerId = regJson.farmer.id;
      console.log("Token:", token.substring(0, 20) + "...");
    } else {
      // If already registered, let's login
      console.log("User might be registered already, error:", regJson.error);
    }
  } catch (err) {
    console.error("❌ Registration Failed:", err.message);
  }

  // 2. Login
  console.log("\n2. Testing Login...");
  try {
    const loginRes = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone, password: testPassword })
    });
    const loginJson = await loginRes.json();
    if (loginRes.ok && loginJson.success) {
      console.log("✅ Login Successful!");
      token = loginJson.token;
      farmerId = loginJson.farmer.id;
    } else {
      throw new Error(loginJson.error);
    }
  } catch (err) {
    console.error("❌ Login Failed:", err.message);
    process.exit(1);
  }

  // 3. Update Farmer Profile
  console.log("\n3. Testing Profile Update...");
  const updatePayload = {
    name: 'Updated Farmer Name',
    village: 'Baramati',
    crop_type: 'Sugarcane'
  };
  
  try {
    const profileRes = await fetch(`${API_BASE}/api/farmer/update-profile`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(updatePayload)
    });
    const profileJson = await profileRes.json();
    if (profileRes.ok && profileJson.success) {
      console.log("✅ Profile Update Successful!");
      console.log("Updated Farmer Info:", profileJson.farmer);
      if (profileJson.farmer.name === updatePayload.name && 
          profileJson.farmer.village === updatePayload.village && 
          profileJson.farmer.crop_type === updatePayload.crop_type) {
        console.log("✅ Verified: Profile values match update payload perfectly.");
      } else {
        console.error("❌ Mismatch in returned profile data.");
      }
    } else {
      throw new Error(profileJson.error);
    }
  } catch (err) {
    console.error("❌ Profile Update Failed:", err.message);
  }

  // 4. Test Crop Analysis with Weather Context
  console.log("\n4. Testing Crop Analysis Endpoint...");
  
  // Create a tiny 1x1 black pixel PNG buffer to send as image
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 
    'base64'
  );
  
  const formData = new FormData();
  const blob = new Blob([dummyPng], { type: 'image/png' });
  formData.append('image', blob, 'test_crop.png');
  formData.append('language', 'hi');
  formData.append('crop_type', 'Sugarcane');
  formData.append('weather_temp', '32');
  formData.append('weather_cond', 'Light Rain');
  formData.append('mobilenet', 'plant (95%)');

  try {
    const analyzeRes = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    const analyzeJson = await analyzeRes.json();
    if (analyzeRes.ok && analyzeJson.success) {
      console.log("✅ Crop Analysis Successful!");
      console.log("AI Recommendations returned:");
      console.log("  Status:", analyzeJson.result.status);
      console.log("  Disease:", analyzeJson.result.disease);
      console.log("  Irrigation Advice:", analyzeJson.result.irrigationRecommendation);
      console.log("  Fertilizer Advice:", analyzeJson.result.fertilizerRecommendation);
    } else {
      throw new Error(analyzeJson.error);
    }
  } catch (err) {
    console.error("❌ Crop Analysis Failed:", err.message);
  }

  // 5. Test History Fetching
  console.log("\n5. Testing History Fetching...");
  try {
    const historyRes = await fetch(`${API_BASE}/api/history`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const historyJson = await historyRes.json();
    if (historyRes.ok && historyJson.success) {
      console.log("✅ History Fetching Successful!");
      console.log(`Found ${historyJson.history.length} history records.`);
      const latest = historyJson.history[0];
      console.log("Latest record weather recorded in DB:");
      console.log(`  Temp: ${latest.weather_temp}°C`);
      console.log(`  Condition: ${latest.weather_cond}`);
      console.log(`  Image Path: ${latest.image_path}`);
      
      if (latest.weather_temp === 32 && latest.weather_cond === 'Light Rain') {
        console.log("✅ Verified: Weather parameters stored correctly in DB history table.");
      } else {
        console.error("❌ Mismatch in weather history data in DB.");
      }
    } else {
      throw new Error(historyJson.error);
    }
  } catch (err) {
    console.error("❌ History Fetching Failed:", err.message);
  }


  console.log("\nVerification Tests Completed.");
}

runTests();
