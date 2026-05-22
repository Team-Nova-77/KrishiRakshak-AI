import './style.css';
import { translations } from './translations.js';

let mobilenetModel = null;
let currentModalRecord = null;

async function loadMobilenet() {
    try {
        if (window.mobilenet && !mobilenetModel) {
            mobilenetModel = await window.mobilenet.load({version: 2, alpha: 1.0});
            console.log("MobileNetV2 loaded");
        }
    } catch (e) {
        console.log("Failed to load MobileNet", e);
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide Icons
    if (window.lucide) {
        window.lucide.createIcons();
    }
    loadMobilenet();
    initState();
    initEventListeners();
    updateUI();
});

let state = {
    view: 'landing', // 'landing', 'auth', 'dashboard', 'profile'
    authMode: 'login', // 'login', 'register'
    language: 'en',
    user: null,
    token: null,
    selectedFile: null,
    isGenerating: false,
    history: [],
    activeRecCrop: null,
    realTimeWeather: null
};

function initState() {
    state.language = localStorage.getItem('krishi_lang') || 'en';
    const savedToken = localStorage.getItem('krishi_token');
    const savedUser = localStorage.getItem('krishi_user');
    
    if (savedToken && savedUser) {
        state.token = savedToken;
        state.user = JSON.parse(savedUser);
        state.view = 'dashboard';
        fetchHistory();
    }
    
    document.getElementById('lang-switcher').value = state.language;
    applyLanguage(state.language);
    
    fetchRealTimeWeather();
}

function initEventListeners() {
    // Nav Navigation
    document.getElementById('btn-nav-home').addEventListener('click', () => setView('landing'));
    document.getElementById('btn-nav-login').addEventListener('click', () => setView('auth'));
    document.getElementById('btn-nav-dash').addEventListener('click', () => setView('dashboard'));
    document.getElementById('btn-nav-profile').addEventListener('click', () => setView('profile'));
    document.getElementById('btn-page-logout').addEventListener('click', logout);
    document.getElementById('btn-get-started').addEventListener('click', () => {
        setView(state.token ? 'dashboard' : 'auth');
    });

    // Auth Toggles
    document.getElementById('btn-show-register').addEventListener('click', () => toggleAuthForm('register'));
    document.getElementById('btn-show-login').addEventListener('click', () => toggleAuthForm('login'));

    // Forms
    document.getElementById('form-login').addEventListener('submit', handleLogin);
    document.getElementById('form-register').addEventListener('submit', handleRegister);

    // Language
    document.getElementById('lang-switcher').addEventListener('change', (e) => applyLanguage(e.target.value));

    // Image Upload
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const btnRemove = document.getElementById('btn-remove-img');
    const btnAnalyze = document.getElementById('btn-analyze');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-green-500', 'bg-green-50'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('border-green-500', 'bg-green-50'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-green-500', 'bg-green-50');
        if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileSelect(e.target.files[0]);
    });

    btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFile();
    });

    btnAnalyze.addEventListener('click', handleAnalysis);
    
    // TTS
    document.getElementById('btn-listen').addEventListener('click', playSpeech);
    
    // Crop change sync
    document.getElementById('dash-crop').addEventListener('change', async (e) => {
        if (state.user) {
            state.user.crop_type = e.target.value;
            localStorage.setItem('krishi_user', JSON.stringify(state.user));
            try {
                await fetch('/api/farmer/update-crop', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.token}` 
                    },
                    body: JSON.stringify({ crop_type: e.target.value })
                });
            } catch (err) {
                console.error("Failed to sync crop change to DB", err);
            }
            state.activeRecCrop = e.target.value;
            renderCropTabs();
            updateCropRecommendations(e.target.value);
        }
    });

    // History Search & Filter listeners
    document.getElementById('history-search').addEventListener('input', filterAndRenderHistory);
    document.getElementById('history-filter-crop').addEventListener('change', filterAndRenderHistory);
    document.getElementById('history-filter-status').addEventListener('change', filterAndRenderHistory);
    
    // Modal Close listeners
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    
    // Modal Outside click listener
    document.getElementById('report-modal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('report-modal')) closeModal();
    });
    
    // Modal TTS button
    document.getElementById('modal-listen-btn').addEventListener('click', () => {
        if (!currentModalRecord) return;
        let recs = { fertilizer: '--' };
        try {
            recs = JSON.parse(currentModalRecord.recommendation || '{}');
        } catch (e) {}
        speakAdvisory(currentModalRecord.status, currentModalRecord.disease, recs.fertilizer);
    });
    
    // Modal Delete button
    document.getElementById('modal-delete-btn').addEventListener('click', () => {
        if (!currentModalRecord) return;
        deleteRecord(currentModalRecord.id);
        closeModal();
    });
    
    // Profile Edit events
    const btnEditProfile = document.getElementById('btn-edit-profile');
    if (btnEditProfile) {
        btnEditProfile.addEventListener('click', () => {
            if (!state.user) return;
            document.getElementById('edit-profile-name').value = state.user.name || '';
            document.getElementById('edit-profile-village').value = state.user.village || '';
            document.getElementById('edit-profile-crop').value = state.user.crop_type || 'Tomato';
            
            document.getElementById('profile-view-mode').classList.add('hidden');
            document.getElementById('profile-edit-mode').classList.remove('hidden');
        });
    }

    const btnCancelEdit = document.getElementById('btn-cancel-edit');
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', () => {
            document.getElementById('profile-view-mode').classList.remove('hidden');
            document.getElementById('profile-edit-mode').classList.add('hidden');
        });
    }

    const formEditProfile = document.getElementById('profile-edit-mode');
    if (formEditProfile) {
        formEditProfile.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('edit-profile-name').value;
            const village = document.getElementById('edit-profile-village').value;
            const crop_type = document.getElementById('edit-profile-crop').value;
            
            try {
                const res = await fetch('/api/farmer/update-profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.token}`
                    },
                    body: JSON.stringify({ name, village, crop_type })
                });
                const json = await res.json();
                if (res.ok && json.success) {
                    state.user = json.farmer;
                    localStorage.setItem('krishi_user', JSON.stringify(json.farmer));
                    
                    updateUI();
                    applyLanguage(state.language);
                    
                    document.getElementById('profile-view-mode').classList.remove('hidden');
                    document.getElementById('profile-edit-mode').classList.add('hidden');
                } else {
                    alert(json.error || 'Failed to update profile');
                }
            } catch (err) {
                console.error('Failed to update profile', err);
                alert('Failed to update profile');
            }
        });
    }


}


function updateUI() {
    // Hide all views
    document.getElementById('view-landing').classList.add('hidden');
    document.getElementById('view-auth').classList.add('hidden');
    document.getElementById('view-dashboard').classList.add('hidden');
    document.getElementById('view-profile').classList.add('hidden');

    // Hide both auth forms
    document.getElementById('form-login-container').classList.add('hidden');
    document.getElementById('form-register-container').classList.add('hidden');

    // Show correct view
    document.getElementById(`view-${state.view}`).classList.remove('hidden');

    if (state.view === 'auth') {
        document.getElementById(`form-${state.authMode}-container`).classList.remove('hidden');
    }

    // Nav Links
    if (state.token) {
        document.getElementById('nav-auth-links').classList.add('hidden');
        document.getElementById('nav-user-links').classList.remove('hidden');
    } else {
        document.getElementById('nav-auth-links').classList.remove('hidden');
        document.getElementById('nav-user-links').classList.add('hidden');
    }

    // User Info
    if (state.user) {
        if (document.getElementById('dash-name')) document.getElementById('dash-name').innerText = state.user.name;
        if (document.getElementById('dash-village')) document.getElementById('dash-village').innerText = state.user.village;
        if (document.getElementById('dash-crop')) document.getElementById('dash-crop').value = state.user.crop_type;
        
        let initial = state.user.name ? state.user.name.charAt(0).toUpperCase() : 'U';
        if (document.getElementById('profile-name-page')) document.getElementById('profile-name-page').innerText = state.user.name;
        if (document.getElementById('profile-phone-page')) document.getElementById('profile-phone-page').innerText = state.user.phone;
        if (document.getElementById('profile-village-page')) document.getElementById('profile-village-page').innerText = state.user.village;
        if (document.getElementById('profile-crop-page')) document.getElementById('profile-crop-page').innerText = state.user.crop_type;
        if (document.getElementById('profile-initial-page')) document.getElementById('profile-initial-page').innerText = initial;
        
        updateWeatherInfo();
    } else {
        // Clear all fields on logout
        if (document.getElementById('dash-name')) document.getElementById('dash-name').innerText = '--';
        if (document.getElementById('dash-village')) document.getElementById('dash-village').innerText = '--';
        if (document.getElementById('dash-crop')) document.getElementById('dash-crop').value = 'Tomato';
        
        if (document.getElementById('profile-name-page')) document.getElementById('profile-name-page').innerText = '--';
        if (document.getElementById('profile-phone-page')) document.getElementById('profile-phone-page').innerText = '--';
        if (document.getElementById('profile-village-page')) document.getElementById('profile-village-page').innerText = '--';
        if (document.getElementById('profile-crop-page')) document.getElementById('profile-crop-page').innerText = '--';
        if (document.getElementById('profile-initial-page')) document.getElementById('profile-initial-page').innerText = '--';
        
        document.getElementById('report-card').classList.add('hidden');
        document.getElementById('result-alerts-card').classList.add('hidden');
        
        state.activeRecCrop = null;
        
        const tbody = document.getElementById('history-table-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-6 text-center text-sm text-gray-500">No records found.</td></tr>`;
        }
        
        clearFile();
    }
}


function setView(view) {
    state.view = view;
    updateUI();
}

function toggleAuthForm(mode) {
    state.authMode = mode;
    updateUI();
}

// Translations
function applyLanguage(lang) {
    state.language = lang;
    localStorage.setItem('krishi_lang', lang);
    const dict = translations[lang] || translations['en'];
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                el.placeholder = dict[key];
            } else {
                if (el.children.length === 0) {
                   el.innerText = dict[key];
                } else {
                   el.innerText = dict[key];
                }
            }
        }
    });

    updateWeatherInfo();
    if (state.token) {
        filterAndRenderHistory();
        renderCropsUI();
        renderCropTabs();
        updateCropRecommendations(state.activeRecCrop || (state.user ? state.user.crop_type : 'Tomato'));
    }
}


// File handling
function handleFileSelect(file) {
    if (!file.type.startsWith('image/')) return alert('Please upload an image file (jpg/png).');
    state.selectedFile = file;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('image-preview').src = e.target.result;
        document.getElementById('preview-container').classList.remove('hidden');
        document.getElementById('upload-prompt').classList.add('hidden');
        document.getElementById('btn-analyze').disabled = false;
    };
    reader.readAsDataURL(file);
}

function clearFile() {
    state.selectedFile = null;
    document.getElementById('file-input').value = "";
    document.getElementById('preview-container').classList.add('hidden');
    document.getElementById('upload-prompt').classList.remove('hidden');
    document.getElementById('btn-analyze').disabled = true;
}

// API Calls
async function handleRegister(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('reg-name').value,
        phone: document.getElementById('reg-phone').value,
        village: document.getElementById('reg-village').value,
        crop_type: document.getElementById('reg-crop').value,
        password: document.getElementById('reg-pwd').value,
        language: state.language
    };
    try {
        const res = await fetch('/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        finishLogin(json);
    } catch (err) { alert(err.message); }
}

async function handleLogin(e) {
    e.preventDefault();
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: document.getElementById('login-phone').value,
                password: document.getElementById('login-pwd').value
            })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        finishLogin(json);
    } catch (err) { alert(err.message); }
}

function finishLogin(json) {
    state.token = json.token;
    state.user = json.farmer;
    localStorage.setItem('krishi_token', json.token);
    localStorage.setItem('krishi_user', JSON.stringify(json.farmer));
    if (json.farmer.language) {
      applyLanguage(json.farmer.language);
      document.getElementById('lang-switcher').value = json.farmer.language;
    }
    setView('dashboard');
    fetchHistory();
}

function logout() {
    state.token = null; state.user = null;
    localStorage.removeItem('krishi_token');
    localStorage.removeItem('krishi_user');
    setView('landing');
}

async function handleAnalysis() {
    if (!state.selectedFile) return;
    
    document.getElementById('loading-state').classList.remove('hidden');
    document.getElementById('report-card').classList.add('hidden');
    document.getElementById('result-alerts-card').classList.add('hidden');
    document.getElementById('btn-analyze').disabled = true;

    const fd = new FormData();
    fd.append('image', state.selectedFile);
    fd.append('language', state.language);
    fd.append('crop_type', document.getElementById('dash-crop').value);
    
    const weather = getWeatherData(state.user ? state.user.village : '', 'en');
    fd.append('weather_temp', weather.temp);
    fd.append('weather_cond', weather.condition);

    try {
        if (mobilenetModel) {
            const imgEl = document.getElementById('image-preview');
            const predictions = await mobilenetModel.classify(imgEl);
            const tags = predictions.map(p => `${p.className} (${(p.probability * 100).toFixed(1)}%)`).join(', ');
            fd.append('mobilenet', tags);
            console.log("MobileNet tags:", tags);
        }
    } catch(e) {
        console.error("MobileNet prediction failed", e);
    }

    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.token}` },
            body: fd
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        
        displayReport(json.result);
        fetchHistory(); // refresh table
    } catch (err) {
        alert("Analysis Error: " + err.message);
    } finally {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('btn-analyze').disabled = false;
        
        // Ensure lucid icons run on dynamic new markup if we inject raw HTML icons
        if (window.lucide) window.lucide.createIcons();
    }
}

function displayReport(data) {
    document.getElementById('report-card').classList.remove('hidden');
    
    // Core stats
    document.getElementById('res-score').innerText = `${data.healthScore}%`;
    document.getElementById('res-status').innerText = data.status;
    document.getElementById('res-disease').innerText = data.disease || "No Risk / None";
    document.getElementById('res-confidence').innerText = `${data.confidence || 0}%`;

    // Colors
    const scoreColor = data.healthScore > 80 ? 'text-green-600' : (data.healthScore > 50 ? 'text-orange-500' : 'text-red-600');
    document.getElementById('res-score').className = `text-3xl font-black ${scoreColor}`;
    
    const statusColor = data.healthScore > 80 ? 'text-green-600' : (data.healthScore > 50 ? 'text-orange-500' : 'text-red-600');
    document.getElementById('res-status').className = `text-lg mt-1 font-bold ${statusColor}`;

    // Recommendations
    document.getElementById('res-irrigation').innerText = data.irrigationRecommendation || "Maintain regular schedule.";
    document.getElementById('res-fertilizer').innerText = data.fertilizerRecommendation || "Continue optimal feeding schedule.";
    document.getElementById('res-management').innerText = data.fieldManagementSupport || "No immediate field action required.";

    // Tips list
    const tipsList = document.getElementById('res-tips');
    tipsList.innerHTML = '';
    const tips = data.preventionAdvice || [];
    if (tips.length > 0) {
        tips.forEach(t => {
            const li = document.createElement('li');
            li.innerText = t;
            tipsList.appendChild(li);
        });
    } else {
        tipsList.innerHTML = '<li>Monitor crop visually.</li>';
    }

    // Alerts
    const alertsCard = document.getElementById('result-alerts-card');
    const alertsList = document.getElementById('alerts-list');
    alertsList.innerHTML = '';
    
    if (data.alerts && data.alerts.length > 0) {
        alertsCard.classList.remove('hidden');
        data.alerts.forEach(a => {
            const div = document.createElement('div');
            div.className = 'bg-orange-50 border-l-4 border-orange-500 p-3 text-orange-900 text-sm font-semibold rounded';
            div.innerText = a;
            alertsList.appendChild(div);
        });
    } else {
        alertsCard.classList.add('hidden');
    }
}

async function fetchHistory() {
    if (!state.token) return;
    try {

        
        const res = await fetch('/api/history', {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const json = await res.json();
        if (json.success) {
            state.history = json.history;
            filterAndRenderHistory();
        }
        
        renderCropsUI();
        renderCropTabs();
        if (!state.activeRecCrop && state.user) {
            state.activeRecCrop = state.user.crop_type || 'Tomato';
        }
        updateCropRecommendations(state.activeRecCrop || 'Tomato');
    } catch (e) { console.error('Failed to load history', e); }
}

function filterAndRenderHistory() {
    const searchVal = document.getElementById('history-search');
    const query = searchVal ? searchVal.value.toLowerCase() : '';
    const cropFilter = document.getElementById('history-filter-crop').value;
    const statusFilter = document.getElementById('history-filter-status').value;
    
    let filtered = state.history || [];
    
    if (query) {
        filtered = filtered.filter(r => {
            const disease = (r.disease || '').toLowerCase();
            const crop = (r.crop_type || '').toLowerCase();
            const dict = translations[state.language] || translations['en'];
            const cropTrans = (dict[`crop_${r.crop_type}`] || r.crop_type || '').toLowerCase();
            return disease.includes(query) || crop.includes(query) || cropTrans.includes(query);
        });
    }
    
    if (cropFilter !== 'all') {
        filtered = filtered.filter(r => r.crop_type === cropFilter);
    }
    
    if (statusFilter !== 'all') {
        filtered = filtered.filter(r => r.status === statusFilter);
    }
    
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const dict = translations[state.language] || translations['en'];
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-6 text-center text-sm text-gray-500">${dict.no_records || 'No records found.'}</td></tr>`;
        return;
    }
    
    filtered.forEach(r => {
        const dateStr = new Date(r.date).toLocaleDateString();
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-green-50/40 cursor-pointer transition-colors border-b';
        
        const imgPath = (r.image_path && r.image_path !== 'N/A') ? r.image_path : '';
        const imgHtml = imgPath 
            ? `<img src="${imgPath}" alt="crop" class="w-10 h-10 object-cover rounded-lg border">`
            : `<div class="w-10 h-10 rounded-lg bg-green-50 border flex items-center justify-center text-green-600"><i data-lucide="image" class="w-5 h-5"></i></div>`;
            
        const badgeColor = r.health_score > 80 
            ? 'bg-green-50 text-green-700 border border-green-200' 
            : (r.health_score > 50 
                ? 'bg-orange-50 text-orange-700 border border-orange-200' 
                : 'bg-red-50 text-red-700 border border-red-200');
        
        const cropDisplay = dict[`crop_${r.crop_type}`] || r.crop_type;
        
        tr.innerHTML = `
            <td class="px-6 py-3 whitespace-nowrap text-sm">${imgHtml}</td>
            <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-900">${dateStr}</td>
            <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-700">${cropDisplay}</td>
            <td class="px-6 py-3 whitespace-nowrap text-sm font-black text-gray-900 hidden sm:table-cell">${r.health_score}%</td>
            <td class="px-6 py-3 whitespace-nowrap text-sm">
               <span class="px-2.5 py-0.5 rounded-full inline-flex items-center text-xs font-semibold ${badgeColor}">
                  <span class="w-1.5 h-1.5 rounded-full mr-1.5 ${r.health_score > 80 ? 'bg-green-500' : (r.health_score > 50 ? 'bg-orange-500' : 'bg-red-500')}"></span>
                  ${r.status}
               </span>
            </td>
            <td class="px-6 py-3 text-sm text-red-600 font-semibold max-w-xs truncate hidden md:table-cell">${r.disease || '-'}</td>
            <td class="px-6 py-3 text-right text-sm font-medium">
               <button class="btn-history-view text-green-600 hover:text-green-900 mr-3 focus:outline-none" data-id="${r.id}"><i data-lucide="eye" class="w-4 h-4 inline"></i></button>
               <button class="btn-history-delete text-red-600 hover:text-red-900 focus:outline-none" data-id="${r.id}"><i data-lucide="trash-2" class="w-4 h-4 inline"></i></button>
            </td>
        `;
        
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openModal(r);
        });
        
        tbody.appendChild(tr);
    });
    
    tbody.querySelectorAll('.btn-history-view').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.getAttribute('data-id'));
            const record = state.history.find(rec => rec.id === id);
            if (record) openModal(record);
        });
    });

    tbody.querySelectorAll('.btn-history-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.getAttribute('data-id'));
            deleteRecord(id);
        });
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
}



function renderCropsUI() {
    const dashCrop = document.getElementById('dash-crop');
    const profileCrop = document.getElementById('edit-profile-crop');
    const filterCrop = document.getElementById('history-filter-crop');

    const prevDashVal = dashCrop ? dashCrop.value : null;
    const prevProfileVal = profileCrop ? profileCrop.value : null;
    const prevFilterVal = filterCrop ? filterCrop.value : null;

    const dict = translations[state.language] || translations['en'];
    const builtInCrops = ['Tomato', 'Potato', 'Wheat', 'Rice', 'Corn', 'Sugarcane', 'Cotton'];
    
    const options = builtInCrops.map(crop => ({
        value: crop,
        text: dict[`crop_${crop}`] || crop
    }));



    if (dashCrop) {
        dashCrop.innerHTML = options.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
        if (prevDashVal && options.some(opt => opt.value === prevDashVal)) {
            dashCrop.value = prevDashVal;
        } else if (state.user && state.user.crop_type) {
            dashCrop.value = state.user.crop_type;
        }
    }

    if (profileCrop) {
        profileCrop.innerHTML = options.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
        if (prevProfileVal && options.some(opt => opt.value === prevProfileVal)) {
            profileCrop.value = prevProfileVal;
        } else if (state.user && state.user.crop_type) {
            profileCrop.value = state.user.crop_type;
        }
    }

    if (filterCrop) {
        const filterOptions = [
            { value: 'all', text: dict['filter_crop_all'] || 'All Crops' },
            ...options
        ];
        filterCrop.innerHTML = filterOptions.map(opt => `<option value="${opt.value}">${opt.text}</option>`).join('');
        if (prevFilterVal && filterOptions.some(opt => opt.value === prevFilterVal)) {
            filterCrop.value = prevFilterVal;
        } else {
            filterCrop.value = 'all';
        }
    }
}

function renderCropTabs() {
    const tabsContainer = document.getElementById('crop-rec-tabs');
    if (!tabsContainer) return;

    const dict = translations[state.language] || translations['en'];
    const builtInCrops = ['Tomato', 'Potato', 'Wheat', 'Rice', 'Corn', 'Sugarcane', 'Cotton'];
    
    const cropNames = builtInCrops;

    tabsContainer.innerHTML = '';

    cropNames.forEach(crop => {
        const btn = document.createElement('button');
        const isSelected = state.activeRecCrop === crop;
        
        btn.className = isSelected
            ? 'px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold shadow-sm transition-all focus:outline-none'
            : 'px-3 py-1.5 bg-white text-gray-700 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50 transition-all focus:outline-none';
        
        btn.innerText = dict[`crop_${crop}`] || crop;
        btn.addEventListener('click', () => {
            state.activeRecCrop = crop;
            renderCropTabs();
            updateCropRecommendations(crop);
        });
        tabsContainer.appendChild(btn);
    });
}

function updateCropRecommendations(activeCrop) {
    if (!activeCrop) return;
    
    const dict = translations[state.language] || translations['en'];
    const builtInCrops = ['Tomato', 'Potato', 'Wheat', 'Rice', 'Corn', 'Sugarcane', 'Cotton'];

    let tempText = '--';
    let soilText = '--';
    let pestsText = '--';
    let fertText = '--';

    if (builtInCrops.includes(activeCrop)) {
        tempText = dict[`${activeCrop}_temp`] || '--';
        soilText = dict[`${activeCrop}_soil`] || '--';
        pestsText = dict[`${activeCrop}_pests`] || '--';
        fertText = dict[`${activeCrop}_fertilizer`] || '--';
    }

    document.getElementById('rec-temp').innerText = tempText;
    document.getElementById('rec-soil').innerText = soilText;
    document.getElementById('rec-pests').innerText = pestsText;
    document.getElementById('rec-fertilizer-guide').innerText = fertText;

    if (state.user) {
        const weather = getWeatherData(state.user.village, state.language);
        const condKey = weather.condition.replace(/\s+/g, '').replace('&', '');
        const adviceKey = `weather_advice_${condKey}`;
        const weatherAdvisory = dict[adviceKey] || '--';
        
        document.getElementById('rec-weather-advisory').innerText = weatherAdvisory;
        
        const recWeatherIcon = document.getElementById('rec-weather-icon');
        if (recWeatherIcon) {
            recWeatherIcon.setAttribute('data-lucide', weather.icon);
        }
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
}

function openModal(record) {
    currentModalRecord = record;
    const modal = document.getElementById('report-modal');
    if (!modal) return;
    
    document.getElementById('modal-date').innerText = new Date(record.date).toLocaleDateString();
    
    const dict = translations[state.language] || translations['en'];
    document.getElementById('modal-crop').innerText = dict[`crop_${record.crop_type}`] || record.crop_type;
    document.getElementById('modal-score').innerText = `${record.health_score}%`;
    document.getElementById('modal-status').innerText = record.status;
    document.getElementById('modal-disease').innerText = record.disease || "None";
    document.getElementById('modal-confidence').innerText = `${record.confidence || 0}%`;
    
    const modalWeather = document.getElementById('modal-weather');
    if (modalWeather) {
        if (record.weather_temp && record.weather_cond) {
            let condLocal = record.weather_cond;
            if (state.language === 'hi') {
                const condMap = {
                    'Clear Sky': 'साफ आसमान',
                    'Scattered Clouds': 'छिटपुट बादल',
                    'Light Rain': 'हल्की बारिश',
                    'Thunderstorms': 'गरज के साथ बौछारें',
                    'Windy & Overcast': 'तेज हवा और बादल'
                };
                condLocal = condMap[record.weather_cond] || record.weather_cond;
            } else if (state.language === 'mr') {
                const condMap = {
                    'Clear Sky': 'स्वच्छ आकाश',
                    'Scattered Clouds': 'अंशतः ढगाळ',
                    'Light Rain': 'हलका पाऊस',
                    'Thunderstorms': 'वादळी पाऊस',
                    'Windy & Overcast': 'वारा आणि ढगाळ'
                };
                condLocal = condMap[record.weather_cond] || record.weather_cond;
            }
            modalWeather.innerText = `${record.weather_temp}°C, ${condLocal}`;
        } else {
            modalWeather.innerText = '--';
        }
    }
    
    const scoreColor = record.health_score > 80 ? 'text-green-600' : (record.health_score > 50 ? 'text-orange-500' : 'text-red-600');
    document.getElementById('modal-score').className = `text-2xl font-black ${scoreColor}`;
    
    const statusColor = record.health_score > 80 ? 'text-green-600' : (record.health_score > 50 ? 'text-orange-500' : 'text-red-600');
    document.getElementById('modal-status').className = `text-sm mt-1 font-bold ${statusColor}`;

    let recs = { fertilizer: '--', irrigation: '--', management: '--', tips: [] };
    try {
        recs = JSON.parse(record.recommendation || '{}');
    } catch (e) {
        console.error("Failed to parse recommendations", e);
    }
    
    document.getElementById('modal-fertilizer').innerText = recs.fertilizer || "--";
    document.getElementById('modal-irrigation').innerText = recs.irrigation || "--";
    document.getElementById('modal-management').innerText = recs.management || "--";
    
    const tipsList = document.getElementById('modal-tips');
    tipsList.innerHTML = '';
    const tips = recs.tips || [];
    if (tips.length > 0) {
        tips.forEach(t => {
            const li = document.createElement('li');
            li.innerText = t;
            tipsList.appendChild(li);
        });
    } else {
        tipsList.innerHTML = '<li>Monitor crop visually.</li>';
    }

    const modalImg = document.getElementById('modal-img');
    if (record.image_path && record.image_path !== 'N/A') {
        modalImg.src = record.image_path;
        modalImg.parentElement.classList.remove('hidden');
    } else {
        modalImg.src = '';
        modalImg.parentElement.classList.add('hidden');
    }
    
    modal.classList.remove('hidden');
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function closeModal() {
    const modal = document.getElementById('report-modal');
    if (modal) modal.classList.add('hidden');
    currentModalRecord = null;
}

async function deleteRecord(id) {
    const dict = translations[state.language] || translations['en'];
    if (!confirm(dict.confirm_delete || 'Are you sure you want to delete this record?')) return;
    
    try {
        const res = await fetch(`/api/history/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const json = await res.json();
        if (res.ok && json.success) {
            state.history = state.history.filter(r => r.id !== id);
            filterAndRenderHistory();
        } else {
            alert(json.error || "Failed to delete record");
        }
    } catch (e) {
        console.error("Delete record failed", e);
        alert("Failed to delete record");
    }
}

function getWeatherData(village, language = 'en') {
    if (state.realTimeWeather) {
        const temp = state.realTimeWeather.temp;
        const cond = state.realTimeWeather.condition;
        
        let icon = 'sun';
        if (cond.includes('Cloud')) icon = 'cloud';
        else if (cond.includes('Rain')) icon = 'cloud-rain';
        else if (cond.includes('Thunder')) icon = 'cloud-lightning';
        else if (cond.includes('Windy')) icon = 'wind';
        
        let condLocal = cond;
        if (language === 'hi') {
            const condMap = {
                'Clear Sky': 'साफ आसमान',
                'Scattered Clouds': 'छिटपुट बादल',
                'Light Rain': 'हल्की बारिश',
                'Thunderstorms': 'गरज के साथ बौछारें',
                'Windy & Overcast': 'तेज हवा और बादल'
            };
            condLocal = condMap[cond] || cond;
        } else if (language === 'mr') {
            const condMap = {
                'Clear Sky': 'स्वच्छ आकाश',
                'Scattered Clouds': 'अंशतः ढगाळ',
                'Light Rain': 'हलका पाऊस',
                'Thunderstorms': 'वादळी पाऊस',
                'Windy & Overcast': 'वारा आणि ढगाळ'
            };
            condLocal = condMap[cond] || cond;
        }
        return { temp, condition: cond, conditionLocal: condLocal, icon };
    }

    if (!village) return { temp: 28, condition: 'Clear Sky', conditionLocal: 'Clear Sky', icon: 'sun' };
    let hash = 0;
    for (let i = 0; i < village.length; i++) {
        hash = village.charCodeAt(i) + ((hash << 5) - hash);
    }
    const temp = 24 + Math.abs(hash % 13);
    const conditions = ['Clear Sky', 'Scattered Clouds', 'Light Rain', 'Thunderstorms', 'Windy & Overcast'];
    const idx = Math.abs(hash) % conditions.length;
    const cond = conditions[idx];
    
    let icon = 'sun';
    if (cond.includes('Cloud')) icon = 'cloud';
    else if (cond.includes('Rain')) icon = 'cloud-rain';
    else if (cond.includes('Thunder')) icon = 'cloud-lightning';
    else if (cond.includes('Windy')) icon = 'wind';
    
    let condLocal = cond;
    if (language === 'hi') {
        const condMap = {
            'Clear Sky': 'साफ आसमान',
            'Scattered Clouds': 'छिटपुट बादल',
            'Light Rain': 'हल्की बारिश',
            'Thunderstorms': 'गरज के साथ बौछारें',
            'Windy & Overcast': 'तेज हवा और बादल'
        };
        condLocal = condMap[cond] || cond;
    } else if (language === 'mr') {
        const condMap = {
            'Clear Sky': 'स्वच्छ आकाश',
            'Scattered Clouds': 'अंशतः ढगाळ',
            'Light Rain': 'हलका पाऊस',
            'Thunderstorms': 'वादळी पाऊस',
            'Windy & Overcast': 'वारा आणि ढगाळ'
        };
        condLocal = condMap[cond] || cond;
    }
    return { temp, condition: cond, conditionLocal: condLocal, icon };
}

function updateWeatherInfo() {
    const weatherInfo = document.getElementById('weather-info');
    if (!weatherInfo || !state.user) return;
    
    const data = getWeatherData(state.user.village, state.language);
    weatherInfo.innerHTML = `<i data-lucide="${data.icon}" class="w-5 h-5 mr-1.5 text-green-700"></i> <span>${data.temp}°C, ${data.conditionLocal}</span>`;
    if (window.lucide) window.lucide.createIcons();
}

function fetchRealTimeWeather() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                try {
                    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
                    if (!response.ok) throw new Error("Weather API failed");
                    const data = await response.json();
                    const current = data.current;
                    if (current && typeof current.temperature_2m === 'number') {
                        const temp = current.temperature_2m;
                        const code = current.weather_code;
                        
                        let cond = 'Clear Sky';
                        if (code === 0) {
                            cond = 'Clear Sky';
                        } else if (code >= 1 && code <= 3) {
                            cond = 'Scattered Clouds';
                        } else if (code === 45 || code === 48) {
                            cond = 'Windy & Overcast';
                        } else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
                            cond = 'Light Rain';
                        } else if (code >= 95 && code <= 99) {
                            cond = 'Thunderstorms';
                        } else {
                            cond = 'Clear Sky';
                        }
                        
                        state.realTimeWeather = {
                            temp: Math.round(temp),
                            condition: cond
                        };
                        updateWeatherInfo();
                        if (state.token && state.activeRecCrop) {
                            updateCropRecommendations(state.activeRecCrop);
                        }
                    }
                } catch (err) {
                    console.error("Error fetching real time weather data:", err);
                    state.realTimeWeather = null;
                    updateWeatherInfo();
                }
            },
            (error) => {
                console.warn("Geolocation permission denied or error occurred:", error);
                state.realTimeWeather = null;
                updateWeatherInfo();
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    } else {
        console.warn("Geolocation is not supported by this browser.");
        state.realTimeWeather = null;
        updateWeatherInfo();
    }
}

// Text to Speech Helper
let preloadedVoices = [];
if ('speechSynthesis' in window) {
    preloadedVoices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        preloadedVoices = window.speechSynthesis.getVoices();
    };
}

function speakAdvisory(status, disease, fertilizer) {
    if (!('speechSynthesis' in window)) {
        alert("Speech Synthesis is not supported in this browser.");
        return;
    }
    window.speechSynthesis.cancel();
    
    const msg = new SpeechSynthesisUtterance();
    const lowerDisease = (disease || '').toLowerCase();
    const isNone = !disease || lowerDisease === 'none' || lowerDisease === 'no risk / none' || lowerDisease.includes('नाही') || lowerDisease.includes('कोणताही') || lowerDisease.includes('कोई नहीं') || lowerDisease.includes('नहीं');
    
    if (state.language === 'hi') {
        msg.text = `फसल की स्थिति: ${status}. ${!isNone ? 'बीमारी का जोखिम ' + disease : 'कोई बीमारी नहीं है.'} सुझाव: ${fertilizer}`;
        msg.lang = 'hi-IN';
    } else if (state.language === 'mr') {
        msg.text = `पिकाची स्थिती: ${status}. ${!isNone ? 'रोगाचा धोका ' + disease : 'कोणतेही रोग आढळले नाहीत.'} शिफारस: ${fertilizer}`;
        msg.lang = 'mr-IN';
    } else {
        msg.text = `Crop status is ${status}. ${!isNone ? 'Disease risk ' + disease : 'No visible diseases detected.'} Recommendation: ${fertilizer}`;
        msg.lang = 'en-US';
    }
    
    let voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) voices = preloadedVoices;
    
    if (state.language === 'mr' && !voices.some(v => v.lang.toLowerCase().includes('mr'))) {
        msg.lang = 'hi-IN';
    }
    
    if (voices.length > 0) {
        let langPrefix = msg.lang.split('-')[0].toLowerCase();
        let selectedVoice = voices.find(v => v.lang.replace('_', '-').toLowerCase().includes(msg.lang.toLowerCase()));
        if (!selectedVoice) {
             selectedVoice = voices.find(v => v.lang.replace('_', '-').toLowerCase().includes(langPrefix));
        }
        if (!selectedVoice && msg.lang.startsWith('hi')) {
             selectedVoice = voices.find(v => v.name.toLowerCase().includes('hindi'));
        }
        if (selectedVoice) {
            msg.voice = selectedVoice;
        }
    }
    
    window.speechSynthesis.speak(msg);
}

function playSpeech() {
    const status = document.getElementById('res-status').innerText;
    const disease = document.getElementById('res-disease').innerText;
    const fert = document.getElementById('res-fertilizer').innerText;
    speakAdvisory(status, disease, fert);
}

