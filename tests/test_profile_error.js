const API_BASE = 'http://localhost:3000';

async function test() {
  const testPhone = '9999999999';
  const testPassword = 'password123';
  
  // Login
  const loginRes = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: testPhone, password: testPassword })
  });
  const loginJson = await loginRes.json();
  const token = loginJson.token;
  
  console.log("Token obtained:", token ? "YES" : "NO");

  const updatePayload = {
    name: 'Updated Farmer Name',
    village: 'Baramati',
    crop_type: 'Sugarcane'
  };

  const profileRes = await fetch(`${API_BASE}/api/farmer/update-profile`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(updatePayload)
  });
  
  console.log("Response Status:", profileRes.status);
  const text = await profileRes.text();
  console.log("Response Text:", text);
}

test();
