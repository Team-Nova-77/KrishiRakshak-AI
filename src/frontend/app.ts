import './styles/style.css';
import { translations } from './utils/translations.js';

declare global {
    interface Window {
        mobilenet: any;
        lucide: any;
    }
}

interface FarmerUser {
    id: number;
    name: string;
    phone: string;
    village: string;
    crop_type: string;
    language?: string;
    district?: string;
    state?: string;
    land_size?: string;
    soil_type?: string;
    farming_type?: string;
}

interface AppState {
    view: 'landing' | 'auth' | 'dashboard' | 'profile';
    authMode: 'login' | 'register';
    language: string;
    user: FarmerUser | null;
    token: string | null;
    selectedFile: File | null;
    isGenerating: boolean;
    history: any[];
    activeRecCrop: string | null;
    realTimeWeather: { temp: number; condition: string } | null;
}

let mobilenetModel: any = null;
let currentModalRecord: any = null;

async function loadMobilenet() {
    try {
        if (window.mobilenet && !mobilenetModel) {
            mobilenetModel = await window.mobilenet.load({ version: 2, alpha: 1.0 });
            console.log("MobileNetV2 loaded");
        }
    } catch (e) {
        console.log("Failed to load MobileNet", e);
    }
}

let state: AppState = {
    view: 'landing',
    authMode: 'login',
    language: 'en',
    user: null,
    token: null,
    selectedFile: null,
    isGenerating: false,
    history: [],
    activeRecCrop: null,
    realTimeWeather: null
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        window.lucide.createIcons();
    }
    loadMobilenet();
    initState();
    initEventListeners();
    updateUI();
});

async function initState() {
    state.language = localStorage.getItem('krishi_lang') || 'en';
    const langSwitcher = document.getElementById('lang-switcher') as HTMLSelectElement | null;
    if (langSwitcher) langSwitcher.value = state.language;
    applyLanguage(state.language);

    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (res.ok) {
            const json = await parseJsonResponse(res);
            if (json.success && json.farmer) {
                state.user = json.farmer;
                state.view = 'dashboard';
                fetchHistory();
            }
        }
    } catch (e) {
        state.user = null;
    }

    fetchRealTimeWeather();
    updateUI();
}

const BUILTIN_CROPS = [
    'Tomato', 'Potato', 'Wheat', 'Rice', 'Corn', 'Sugarcane', 'Cotton',
    'Onion', 'Brinjal', 'Chili', 'Cucumber', 'Cabbage', 'Cauliflower', 'Okra',
    'Garlic', 'Spinach', 'Soybean', 'Chickpea', 'Groundnut', 'Mustard', 'Sunflower',
    'Lentil', 'Grape', 'Apple', 'Banana', 'Mango', 'Papaya', 'Orange',
    'Strawberry', 'Tea', 'Coffee', 'Pomegranate', 'Watermelon', 'Turmeric'
];

function getCustomCrops(): string[] {
    try {
        return JSON.parse(localStorage.getItem('krishi_custom_crops') || '[]');
    } catch (e) {
        return [];
    }
}

function saveCustomCropName(cropName: string) {
    const clean = cropName.trim();
    if (!clean) return;
    const custom = getCustomCrops();
    if (!custom.includes(clean) && !BUILTIN_CROPS.includes(clean)) {
        custom.push(clean);
        localStorage.setItem('krishi_custom_crops', JSON.stringify(custom));
    }
}

function getAllAvailableCrops(): string[] {
    const custom = getCustomCrops();
    const set = new Set([...BUILTIN_CROPS, ...custom]);
    if (state.user && state.user.crop_type) {
        set.add(state.user.crop_type);
    }
    return Array.from(set);
}

function populateCropDropdowns() {
    const crops = getAllAvailableCrops();
    const dict = translations[state.language] || translations['en'];

    const dropdownIds = ['reg-crop', 'dash-crop', 'edit-profile-crop', 'profile-crop-select', 'history-filter-crop'];
    dropdownIds.forEach(id => {
        const select = document.getElementById(id) as HTMLSelectElement | null;
        if (!select) return;

        const currentVal = select.value;
        select.innerHTML = '';

        if (id === 'history-filter-crop') {
            const optAll = document.createElement('option');
            optAll.value = 'ALL';
            optAll.innerText = dict.filter_crop_all || 'All Crops';
            select.appendChild(optAll);
        }

        crops.forEach(crop => {
            const opt = document.createElement('option');
            opt.value = crop;
            opt.innerText = dict[`crop_${crop}`] || crop;
            select.appendChild(opt);
        });

        if (currentVal && crops.includes(currentVal)) {
            select.value = currentVal;
        } else if (state.user && state.user.crop_type && crops.includes(state.user.crop_type)) {
            select.value = state.user.crop_type;
        }
    });
}

function initEventListeners() {
    // Nav Navigation
    document.getElementById('brand-logo')?.addEventListener('click', () => setView(state.user ? 'dashboard' : 'landing'));
    document.getElementById('btn-nav-home')?.addEventListener('click', () => setView(state.user ? 'dashboard' : 'landing'));
    document.getElementById('btn-nav-login')?.addEventListener('click', () => setView('auth'));
    document.getElementById('btn-nav-dash')?.addEventListener('click', () => setView('dashboard'));
    document.getElementById('btn-nav-profile')?.addEventListener('click', () => setView('profile'));
    document.getElementById('btn-nav-logout')?.addEventListener('click', logout);
    document.getElementById('btn-page-logout')?.addEventListener('click', logout);
    document.getElementById('btn-get-started')?.addEventListener('click', () => {
        setView(state.user ? 'dashboard' : 'auth');
    });

    // Auth Toggles
    document.getElementById('btn-show-register')?.addEventListener('click', () => toggleAuthForm('register'));
    document.getElementById('btn-show-login')?.addEventListener('click', () => toggleAuthForm('login'));

    // Forms
    document.getElementById('form-login')?.addEventListener('submit', handleLogin);
    document.getElementById('form-register')?.addEventListener('submit', handleRegister);

    // Language
    document.getElementById('lang-switcher')?.addEventListener('change', (e: any) => applyLanguage(e.target.value));

    // Image Upload
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
    const btnRemove = document.getElementById('btn-remove-img');
    const btnAnalyze = document.getElementById('btn-analyze');

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-green-500', 'bg-green-50'); });
    dropZone?.addEventListener('dragleave', () => { dropZone.classList.remove('border-green-500', 'bg-green-50'); });
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-green-500', 'bg-green-50');
        if (e.dataTransfer?.files.length) handleFileSelect(e.dataTransfer.files[0]);
    });
    
    fileInput?.addEventListener('change', (e: any) => {
        if (e.target.files?.length) handleFileSelect(e.target.files[0]);
    });

    btnRemove?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFile();
    });

    btnAnalyze?.addEventListener('click', handleAnalysis);
    
    // TTS
    document.getElementById('btn-listen')?.addEventListener('click', playSpeech);
    
    // Crop change sync handlers
    const syncCropChange = async (newCrop: string) => {
        if (!state.user) return;
        state.user.crop_type = newCrop;
        localStorage.setItem('krishi_user', JSON.stringify(state.user));
        try {
            await fetch('/api/farmer/update-crop', {
                method: 'POST',
                credentials: 'include',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ crop_type: newCrop })
            });
        } catch (err) {
            console.error("Failed to sync crop change to DB", err);
        }
        state.activeRecCrop = newCrop;
        populateCropDropdowns();
        renderCropTabs();
        updateCropRecommendations(newCrop);
        updateUI();
    };

    document.getElementById('dash-crop')?.addEventListener('change', (e: any) => syncCropChange(e.target.value));
    document.getElementById('profile-crop-select')?.addEventListener('change', (e: any) => syncCropChange(e.target.value));

    // Custom Crop Modal Handlers
    const openCustomCropModal = () => {
        const modal = document.getElementById('modal-custom-crop');
        const input = document.getElementById('custom-crop-input') as HTMLInputElement | null;
        if (input) input.value = '';
        if (modal) modal.classList.remove('hidden');
    };

    const closeCustomCropModal = () => {
        const modal = document.getElementById('modal-custom-crop');
        if (modal) modal.classList.add('hidden');
    };

    document.getElementById('btn-trigger-add-crop')?.addEventListener('click', openCustomCropModal);
    document.getElementById('custom-crop-close')?.addEventListener('click', closeCustomCropModal);
    document.getElementById('custom-crop-cancel')?.addEventListener('click', closeCustomCropModal);

    document.getElementById('custom-crop-save')?.addEventListener('click', async () => {
        const input = document.getElementById('custom-crop-input') as HTMLInputElement | null;
        const cropName = input ? input.value.trim() : '';
        if (!cropName) {
            alert('Please enter a crop name.');
            return;
        }

        saveCustomCropName(cropName);
        closeCustomCropModal();
        await syncCropChange(cropName);
    });

    // History Search & Filter listeners
    document.getElementById('history-search')?.addEventListener('input', filterAndRenderHistory);
    document.getElementById('history-filter-crop')?.addEventListener('change', filterAndRenderHistory);
    document.getElementById('history-filter-status')?.addEventListener('change', filterAndRenderHistory);
    
    // Modal Close listeners
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
    
    // Modal Outside click listener
    document.getElementById('report-modal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('report-modal')) closeModal();
    });
    
    // Modal TTS button
    document.getElementById('modal-listen-btn')?.addEventListener('click', () => {
        if (!currentModalRecord) return;
        let recs = { fertilizer: '--' };
        try {
            recs = JSON.parse(currentModalRecord.recommendation || '{}');
        } catch (e) {}
        speakAdvisory(currentModalRecord.status, currentModalRecord.disease, recs.fertilizer);
    });
    
    // Modal Delete button
    document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
        if (!currentModalRecord) return;
        deleteRecord(currentModalRecord.id);
        closeModal();
    });
    
    // Profile Edit events
    document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
        if (!state.user) return;
        populateCropDropdowns();
        (document.getElementById('edit-profile-name') as HTMLInputElement).value = state.user.name || '';
        (document.getElementById('edit-profile-village') as HTMLInputElement).value = state.user.village || '';
        (document.getElementById('edit-profile-crop') as HTMLSelectElement).value = state.user.crop_type || 'Tomato';
        if (document.getElementById('edit-profile-district')) {
            (document.getElementById('edit-profile-district') as HTMLInputElement).value = state.user.district || '';
        }
        if (document.getElementById('edit-profile-state')) {
            (document.getElementById('edit-profile-state') as HTMLInputElement).value = state.user.state || '';
        }
        if (document.getElementById('edit-profile-land')) {
            (document.getElementById('edit-profile-land') as HTMLInputElement).value = state.user.land_size || '';
        }
        if (document.getElementById('edit-profile-soil')) {
            (document.getElementById('edit-profile-soil') as HTMLSelectElement).value = state.user.soil_type || 'Black Soil';
        }
        if (document.getElementById('edit-profile-farming')) {
            (document.getElementById('edit-profile-farming') as HTMLSelectElement).value = state.user.farming_type || 'Organic Farming';
        }
        
        document.getElementById('profile-view-mode')?.classList.add('hidden');
        document.getElementById('profile-edit-mode')?.classList.remove('hidden');
    });

    document.getElementById('btn-cancel-edit')?.addEventListener('click', () => {
        document.getElementById('profile-view-mode')?.classList.remove('hidden');
        document.getElementById('profile-edit-mode')?.classList.add('hidden');
    });

    document.getElementById('profile-edit-mode')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (document.getElementById('edit-profile-name') as HTMLInputElement).value;
        const village = (document.getElementById('edit-profile-village') as HTMLInputElement).value;
        const crop_type = (document.getElementById('edit-profile-crop') as HTMLSelectElement).value;
        const district = (document.getElementById('edit-profile-district') as HTMLInputElement)?.value || '';
        const stateName = (document.getElementById('edit-profile-state') as HTMLInputElement)?.value || '';
        const land_size = (document.getElementById('edit-profile-land') as HTMLInputElement)?.value || '';
        const soil_type = (document.getElementById('edit-profile-soil') as HTMLSelectElement)?.value || '';
        const farming_type = (document.getElementById('edit-profile-farming') as HTMLSelectElement)?.value || '';
        
        try {
            const res = await fetch('/api/farmer/update-profile', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, village, crop_type, district, state: stateName, land_size, soil_type, farming_type })
            });
            const json = await res.json();
            if (res.ok && json.success) {
                state.user = json.farmer;
                localStorage.setItem('krishi_user', JSON.stringify(json.farmer));
                
                updateUI();
                applyLanguage(state.language);
                
                document.getElementById('profile-view-mode')?.classList.remove('hidden');
                document.getElementById('profile-edit-mode')?.classList.add('hidden');
            } else {
                alert(json.error || 'Failed to update profile');
            }
        } catch (err) {
            console.error('Failed to update profile', err);
            alert('Failed to update profile');
        }
    });
}

function updateUI() {
    // Hide all views
    document.getElementById('view-landing')?.classList.add('hidden');
    document.getElementById('view-auth')?.classList.add('hidden');
    document.getElementById('view-dashboard')?.classList.add('hidden');
    document.getElementById('view-profile')?.classList.add('hidden');

    // Hide both auth forms
    document.getElementById('form-login-container')?.classList.add('hidden');
    document.getElementById('form-register-container')?.classList.add('hidden');

    // Show correct view
    document.getElementById(`view-${state.view}`)?.classList.remove('hidden');

    if (state.view === 'auth') {
        document.getElementById(`form-${state.authMode}-container`)?.classList.remove('hidden');
    }

    // Nav Links
    if (state.user) {
        document.getElementById('nav-auth-links')?.classList.add('hidden');
        document.getElementById('nav-user-links')?.classList.remove('hidden');
    } else {
        document.getElementById('nav-auth-links')?.classList.remove('hidden');
        document.getElementById('nav-user-links')?.classList.add('hidden');
    }

    populateCropDropdowns();

    // User Info
    if (state.user) {
        const dict = translations[state.language] || translations['en'];
        const cropDisplay = dict[`crop_${state.user.crop_type}`] || state.user.crop_type;

        const dashName = document.getElementById('dash-name');
        const dashVillage = document.getElementById('dash-village');
        const dashCrop = document.getElementById('dash-crop') as HTMLSelectElement | null;
        const profileCropSelect = document.getElementById('profile-crop-select') as HTMLSelectElement | null;

        if (dashName) dashName.innerText = state.user.name;
        if (dashVillage) dashVillage.innerText = state.user.village;
        if (dashCrop) dashCrop.value = state.user.crop_type;
        if (profileCropSelect) profileCropSelect.value = state.user.crop_type;
        
        let initial = state.user.name ? state.user.name.charAt(0).toUpperCase() : 'U';
        const pName = document.getElementById('profile-name-page');
        const pPhone = document.getElementById('profile-phone-page');
        const pLocation = document.getElementById('profile-location-page');
        const pLand = document.getElementById('profile-land-page');
        const pSoil = document.getElementById('profile-soil-page');
        const pFarming = document.getElementById('profile-farming-page');
        const pCrop = document.getElementById('profile-crop-page');
        const pInitial = document.getElementById('profile-initial-page');

        const locParts = [state.user.village, state.user.district, state.user.state].filter(Boolean);
        const locationText = locParts.length > 0 ? locParts.join(', ') : '--';

        if (pName) pName.innerText = state.user.name;
        if (pPhone) pPhone.innerText = state.user.phone;
        if (pLocation) pLocation.innerText = locationText;
        if (pLand) pLand.innerText = state.user.land_size ? `${state.user.land_size} Acres` : '-- Acres';
        if (pSoil) pSoil.innerText = state.user.soil_type || '--';
        if (pFarming) pFarming.innerText = state.user.farming_type || '--';
        if (pCrop) pCrop.innerText = cropDisplay;
        if (pInitial) pInitial.innerText = initial;

        // Diagnostic Stats Counter Calculation
        const totalScans = state.history.length;
        const healthyScans = state.history.filter(r => (r.status || '').toLowerCase() === 'healthy' || r.health_score > 80).length;
        const riskScans = totalScans - healthyScans;

        const statTotal = document.getElementById('profile-stat-total');
        const statHealthy = document.getElementById('profile-stat-healthy');
        const statRisks = document.getElementById('profile-stat-risks');

        if (statTotal) statTotal.innerText = String(totalScans);
        if (statHealthy) statHealthy.innerText = String(healthyScans);
        if (statRisks) statRisks.innerText = String(riskScans);
        
        updateWeatherInfo();
    } else {
        // Clear all fields on logout
        const dashName = document.getElementById('dash-name');
        const dashVillage = document.getElementById('dash-village');
        const dashCrop = document.getElementById('dash-crop') as HTMLSelectElement | null;
        if (dashName) dashName.innerText = '--';
        if (dashVillage) dashVillage.innerText = '--';
        if (dashCrop) dashCrop.value = 'Tomato';
        
        const pName = document.getElementById('profile-name-page');
        const pPhone = document.getElementById('profile-phone-page');
        const pVillage = document.getElementById('profile-village-page');
        const pCrop = document.getElementById('profile-crop-page');
        const pInitial = document.getElementById('profile-initial-page');

        if (pName) pName.innerText = '--';
        if (pPhone) pPhone.innerText = '--';
        if (pVillage) pVillage.innerText = '--';
        if (pCrop) pCrop.innerText = '--';
        if (pInitial) pInitial.innerText = '--';
        
        const statTotal = document.getElementById('profile-stat-total');
        const statHealthy = document.getElementById('profile-stat-healthy');
        const statRisks = document.getElementById('profile-stat-risks');

        if (statTotal) statTotal.innerText = '0';
        if (statHealthy) statHealthy.innerText = '0';
        if (statRisks) statRisks.innerText = '0';

        document.getElementById('report-card')?.classList.add('hidden');
        document.getElementById('result-alerts-card')?.classList.add('hidden');
        
        state.activeRecCrop = null;
        
        const tbody = document.getElementById('history-table-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="px-6 py-6 text-center text-sm text-gray-500">No records found.</td></tr>`;
        }
        
        clearFile();
    }
}

function setView(view: 'landing' | 'auth' | 'dashboard' | 'profile') {
    state.view = view;
    updateUI();
}

function toggleAuthForm(mode: 'login' | 'register') {
    state.authMode = mode;
    updateUI();
}

// Translations
function applyLanguage(lang: string) {
    state.language = lang;
    localStorage.setItem('krishi_lang', lang);
    const dict = translations[lang] || translations['en'];
    
    document.querySelectorAll('[data-i18n]').forEach((el: any) => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                el.placeholder = dict[key];
            } else {
                el.innerText = dict[key];
            }
        }
    });

    updateWeatherInfo();
    if (state.user) {
        filterAndRenderHistory();
        renderCropsUI();
        renderCropTabs();
        updateCropRecommendations(state.activeRecCrop || (state.user ? state.user.crop_type : 'Tomato'));
    }
}

// File handling
function handleFileSelect(file: File) {
    if (!file.type.startsWith('image/')) return alert('Please upload an image file (jpg/png).');
    state.selectedFile = file;
    
    const reader = new FileReader();
    reader.onload = (e: any) => {
        const preview = document.getElementById('image-preview') as HTMLImageElement | null;
        if (preview) preview.src = e.target.result;
        document.getElementById('preview-container')?.classList.remove('hidden');
        document.getElementById('upload-prompt')?.classList.add('hidden');
        const btnAnalyze = document.getElementById('btn-analyze') as HTMLButtonElement | null;
        if (btnAnalyze) btnAnalyze.disabled = false;
    };
    reader.readAsDataURL(file);
}

function clearFile() {
    state.selectedFile = null;
    const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
    if (fileInput) fileInput.value = "";
    document.getElementById('preview-container')?.classList.add('hidden');
    document.getElementById('upload-prompt')?.classList.remove('hidden');
    const btnAnalyze = document.getElementById('btn-analyze') as HTMLButtonElement | null;
    if (btnAnalyze) btnAnalyze.disabled = true;
}

// API Calls
async function handleRegister(e: Event) {
    e.preventDefault();
    const data = {
        name: ((document.getElementById('reg-name') as HTMLInputElement)?.value || '').trim(),
        phone: ((document.getElementById('reg-phone') as HTMLInputElement)?.value || '').trim(),
        village: ((document.getElementById('reg-village') as HTMLInputElement)?.value || '').trim(),
        crop_type: (document.getElementById('reg-crop') as HTMLSelectElement)?.value || 'Tomato',
        password: (document.getElementById('reg-pwd') as HTMLInputElement)?.value || '',
        language: state.language
    };
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        finishLogin(json);
    } catch (err: any) { alert(err.message); }
}

async function handleLogin(e: Event) {
    e.preventDefault();
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: ((document.getElementById('login-phone') as HTMLInputElement)?.value || '').trim(),
                password: (document.getElementById('login-pwd') as HTMLInputElement)?.value || ''
            })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        finishLogin(json);
    } catch (err: any) { alert(err.message); }
}

function finishLogin(json: any) {
    state.user = json.farmer;
    localStorage.setItem('krishi_user', JSON.stringify(json.farmer));
    
    // Reset form fields
    const loginPhone = document.getElementById('login-phone') as HTMLInputElement | null;
    const loginPwd = document.getElementById('login-pwd') as HTMLInputElement | null;
    const regName = document.getElementById('reg-name') as HTMLInputElement | null;
    const regPhone = document.getElementById('reg-phone') as HTMLInputElement | null;
    const regVillage = document.getElementById('reg-village') as HTMLInputElement | null;
    const regPwd = document.getElementById('reg-pwd') as HTMLInputElement | null;
    
    if (loginPhone) loginPhone.value = '';
    if (loginPwd) loginPwd.value = '';
    if (regName) regName.value = '';
    if (regPhone) regPhone.value = '';
    if (regVillage) regVillage.value = '';
    if (regPwd) regPwd.value = '';

    if (json.farmer.language) {
        applyLanguage(json.farmer.language);
        const langSwitcher = document.getElementById('lang-switcher') as HTMLSelectElement | null;
        if (langSwitcher) langSwitcher.value = json.farmer.language;
    }
    setView('dashboard');
    fetchHistory();
}

async function logout() {
    state.user = null;
    localStorage.removeItem('krishi_user');
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
        console.error("Logout error", e);
    }
    
    // Reset inputs
    const loginPhone = document.getElementById('login-phone') as HTMLInputElement | null;
    const loginPwd = document.getElementById('login-pwd') as HTMLInputElement | null;
    const regName = document.getElementById('reg-name') as HTMLInputElement | null;
    const regPhone = document.getElementById('reg-phone') as HTMLInputElement | null;
    const regVillage = document.getElementById('reg-village') as HTMLInputElement | null;
    const regPwd = document.getElementById('reg-pwd') as HTMLInputElement | null;

    if (loginPhone) loginPhone.value = '';
    if (loginPwd) loginPwd.value = '';
    if (regName) regName.value = '';
    if (regPhone) regPhone.value = '';
    if (regVillage) regVillage.value = '';
    if (regPwd) regPwd.value = '';

    setView('landing');
}

async function handleAnalysis() {
    if (!state.selectedFile) return;
    
    document.getElementById('loading-state')?.classList.remove('hidden');
    document.getElementById('report-card')?.classList.add('hidden');
    document.getElementById('result-alerts-card')?.classList.add('hidden');
    const btnAnalyze = document.getElementById('btn-analyze') as HTMLButtonElement | null;
    if (btnAnalyze) btnAnalyze.disabled = true;

    const fd = new FormData();
    fd.append('image', state.selectedFile);
    fd.append('language', state.language);
    
    const dashCrop = document.getElementById('dash-crop') as HTMLSelectElement | null;
    fd.append('crop_type', dashCrop ? dashCrop.value : 'Tomato');
    
    const weather = getWeatherData(state.user ? state.user.village : '', 'en');
    fd.append('weather_temp', String(weather.temp));
    fd.append('weather_cond', weather.condition);

    try {
        if (mobilenetModel) {
            const imgEl = document.getElementById('image-preview') as HTMLImageElement;
            const predictions = await mobilenetModel.classify(imgEl);
            const tags = predictions.map((p: any) => `${p.className} (${(p.probability * 100).toFixed(1)}%)`).join(', ');
            fd.append('mobilenet', tags);
            console.log("MobileNet tags:", tags);
        }
    } catch(e) {
        console.error("MobileNet prediction failed", e);
    }

    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            credentials: 'include',
            body: fd
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        
        displayReport(json.result);
        fetchHistory();
    } catch (err: any) {
        alert("Analysis Error: " + err.message);
    } finally {
        document.getElementById('loading-state')?.classList.add('hidden');
        if (btnAnalyze) btnAnalyze.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }
}

function displayReport(data: any) {
    document.getElementById('report-card')?.classList.remove('hidden');
    
    // Core stats
    const resScore = document.getElementById('res-score');
    const resStatus = document.getElementById('res-status');
    const resDisease = document.getElementById('res-disease');
    const resConfidence = document.getElementById('res-confidence');

    if (resScore) resScore.innerText = `${data.healthScore}%`;
    if (resStatus) resStatus.innerText = data.status;
    if (resDisease) resDisease.innerText = data.disease || "No Risk / None";
    if (resConfidence) resConfidence.innerText = `${data.confidence || 0}%`;

    // Colors
    const scoreColor = data.healthScore > 80 ? 'text-green-600' : (data.healthScore > 50 ? 'text-orange-500' : 'text-red-600');
    if (resScore) resScore.className = `text-3xl font-black ${scoreColor}`;
    
    const statusColor = data.healthScore > 80 ? 'text-green-600' : (data.healthScore > 50 ? 'text-orange-500' : 'text-red-600');
    if (resStatus) resStatus.className = `text-lg mt-1 font-bold ${statusColor}`;

    // Recommendations
    const resIrrigation = document.getElementById('res-irrigation');
    const resFertilizer = document.getElementById('res-fertilizer');
    const resManagement = document.getElementById('res-management');

    if (resIrrigation) resIrrigation.innerText = data.irrigationRecommendation || "Maintain regular schedule.";
    if (resFertilizer) resFertilizer.innerText = data.fertilizerRecommendation || "Continue optimal feeding schedule.";
    if (resManagement) resManagement.innerText = data.fieldManagementSupport || "No immediate field action required.";

    // Tips list
    const tipsList = document.getElementById('res-tips');
    if (tipsList) {
        tipsList.innerHTML = '';
        const tips = data.preventionAdvice || [];
        if (tips.length > 0) {
            tips.forEach((t: string) => {
                const li = document.createElement('li');
                li.innerText = t;
                tipsList.appendChild(li);
            });
        } else {
            tipsList.innerHTML = '<li>Monitor crop visually.</li>';
        }
    }

    // Alerts
    const alertsCard = document.getElementById('result-alerts-card');
    const alertsList = document.getElementById('alerts-list');
    if (alertsList && alertsCard) {
        alertsList.innerHTML = '';
        if (data.alerts && data.alerts.length > 0) {
            alertsCard.classList.remove('hidden');
            data.alerts.forEach((a: string) => {
                const div = document.createElement('div');
                div.className = 'bg-orange-50 border-l-4 border-orange-500 p-3 text-orange-900 text-sm font-semibold rounded';
                div.innerText = a;
                alertsList.appendChild(div);
            });
        } else {
            alertsCard.classList.add('hidden');
        }
    }
}

async function parseJsonResponse(res: Response): Promise<any> {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const text = await res.text();
        console.error(`[API Non-JSON Response ${res.status}]`, text.substring(0, 200));
        throw new Error(`Server returned non-JSON response (${res.status}). Please check API backend routing.`);
    }
    return res.json();
}

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    options.credentials = 'include';
    let res = await fetch(url, options);

    if (res.status === 401 && url !== '/api/auth/refresh' && url !== '/api/login') {
        try {
            const refreshRes = await fetch('/api/auth/refresh', {
                method: 'POST',
                credentials: 'include'
            });
            if (refreshRes.ok) {
                res = await fetch(url, options);
            }
        } catch (e) {
            console.error("Token auto-refresh failed", e);
        }
    }

    return res;
}

async function fetchHistory() {
    if (!state.user) return;
    try {
        const res = await authenticatedFetch('/api/history');
        if (res.status === 401) {
            console.warn("Session expired or invalid. Logging out.");
            logout();
            return;
        }
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
    const searchVal = document.getElementById('history-search') as HTMLInputElement | null;
    const cropFilterEl = document.getElementById('history-filter-crop') as HTMLSelectElement | null;
    const statusFilterEl = document.getElementById('history-filter-status') as HTMLSelectElement | null;

    const query = searchVal ? searchVal.value.toLowerCase() : '';
    const cropFilter = cropFilterEl ? cropFilterEl.value : 'all';
    const statusFilter = statusFilterEl ? statusFilterEl.value : 'all';
    
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
        
        tr.addEventListener('click', (e: any) => {
            if (e.target.closest('button')) return;
            openModal(r);
        });
        
        tbody.appendChild(tr);
    });
    
    tbody.querySelectorAll('.btn-history-view').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const id = parseInt((btn as HTMLElement).getAttribute('data-id') || '0', 10);
            const record = state.history.find(rec => rec.id === id);
            if (record) openModal(record);
        });
    });

    tbody.querySelectorAll('.btn-history-delete').forEach(btn => {
        btn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const id = parseInt((btn as HTMLElement).getAttribute('data-id') || '0', 10);
            deleteRecord(id);
        });
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function renderCropsUI() {
    populateCropDropdowns();
}

function renderCropTabs() {
    const tabsContainer = document.getElementById('crop-rec-tabs');
    if (!tabsContainer) return;

    const dict = translations[state.language] || translations['en'];
    const allCrops = getAllAvailableCrops();
    
    tabsContainer.innerHTML = '';

    allCrops.forEach(crop => {
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

function updateCropRecommendations(activeCrop: string) {
    if (!activeCrop) return;
    
    const dict = translations[state.language] || translations['en'];

    let tempText = dict[`${activeCrop}_temp`] || "20 - 30°C";
    let soilText = dict[`${activeCrop}_soil`] || "Well-drained fertile loamy soil";
    let pestsText = dict[`${activeCrop}_pests`] || "Visual inspection for aphids, leaf spots, and blight recommended.";
    let fertText = dict[`${activeCrop}_fertilizer`] || "Apply organic compost before sowing and balanced NPK fertilizer during vegetative growth.";

    const recTemp = document.getElementById('rec-temp');
    const recSoil = document.getElementById('rec-soil');
    const recPests = document.getElementById('rec-pests');
    const recFert = document.getElementById('rec-fertilizer-guide');

    if (recTemp) recTemp.innerText = tempText;
    if (recSoil) recSoil.innerText = soilText;
    if (recPests) recPests.innerText = pestsText;
    if (recFert) recFert.innerText = fertText;

    if (state.user) {
        const weather = getWeatherData(state.user.village, state.language);
        const condKey = weather.condition.replace(/\s+/g, '').replace('&', '');
        const adviceKey = `weather_advice_${condKey}`;
        const weatherAdvisory = dict[adviceKey] || '--';
        
        const recAdvisory = document.getElementById('rec-weather-advisory');
        if (recAdvisory) recAdvisory.innerText = weatherAdvisory;
        
        const recWeatherIcon = document.getElementById('rec-weather-icon');
        if (recWeatherIcon) {
            recWeatherIcon.setAttribute('data-lucide', weather.icon);
        }
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
}

function openModal(record: any) {
    currentModalRecord = record;
    const modal = document.getElementById('report-modal');
    if (!modal) return;
    
    const mDate = document.getElementById('modal-date');
    const mCrop = document.getElementById('modal-crop');
    const mScore = document.getElementById('modal-score');
    const mStatus = document.getElementById('modal-status');
    const mDisease = document.getElementById('modal-disease');
    const mConfidence = document.getElementById('modal-confidence');
    
    if (mDate) mDate.innerText = new Date(record.date).toLocaleDateString();
    
    const dict = translations[state.language] || translations['en'];
    if (mCrop) mCrop.innerText = dict[`crop_${record.crop_type}`] || record.crop_type;
    if (mScore) mScore.innerText = `${record.health_score}%`;
    if (mStatus) mStatus.innerText = record.status;
    if (mDisease) mDisease.innerText = record.disease || "None";
    if (mConfidence) mConfidence.innerText = `${record.confidence || 0}%`;
    
    const modalWeather = document.getElementById('modal-weather');
    if (modalWeather) {
        if (record.weather_temp && record.weather_cond) {
            let condLocal = record.weather_cond;
            if (state.language === 'hi') {
                const condMap: Record<string, string> = {
                    'Clear Sky': 'साफ आसमान',
                    'Scattered Clouds': 'छिटपुट बादल',
                    'Light Rain': 'हल्की बारिश',
                    'Thunderstorms': 'गरज के साथ बौछारें',
                    'Windy & Overcast': 'तेज हवा और बादल'
                };
                condLocal = condMap[record.weather_cond] || record.weather_cond;
            } else if (state.language === 'mr') {
                const condMap: Record<string, string> = {
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
    if (mScore) mScore.className = `text-2xl font-black ${scoreColor}`;
    
    const statusColor = record.health_score > 80 ? 'text-green-600' : (record.health_score > 50 ? 'text-orange-500' : 'text-red-600');
    if (mStatus) mStatus.className = `text-sm mt-1 font-bold ${statusColor}`;

    let recs: any = { fertilizer: '--', irrigation: '--', management: '--', tips: [] };
    try {
        recs = JSON.parse(record.recommendation || '{}');
    } catch (e) {
        console.error("Failed to parse recommendations", e);
    }
    
    const mFert = document.getElementById('modal-fertilizer');
    const mIrrigation = document.getElementById('modal-irrigation');
    const mManagement = document.getElementById('modal-management');

    if (mFert) mFert.innerText = recs.fertilizer || "--";
    if (mIrrigation) mIrrigation.innerText = recs.irrigation || "--";
    if (mManagement) mManagement.innerText = recs.management || "--";
    
    const tipsList = document.getElementById('modal-tips');
    if (tipsList) {
        tipsList.innerHTML = '';
        const tips = recs.tips || [];
        if (tips.length > 0) {
            tips.forEach((t: string) => {
                const li = document.createElement('li');
                li.innerText = t;
                tipsList.appendChild(li);
            });
        } else {
            tipsList.innerHTML = '<li>Monitor crop visually.</li>';
        }
    }

    const modalImg = document.getElementById('modal-img') as HTMLImageElement | null;
    if (modalImg) {
        if (record.image_path && record.image_path !== 'N/A') {
            modalImg.src = record.image_path;
            modalImg.parentElement?.classList.remove('hidden');
        } else {
            modalImg.src = '';
            modalImg.parentElement?.classList.add('hidden');
        }
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

async function deleteRecord(id: number) {
    const dict = translations[state.language] || translations['en'];
    if (!confirm(dict.confirm_delete || 'Are you sure you want to delete this record?')) return;
    
    try {
        const res = await fetch(`/api/history/${id}`, {
            method: 'DELETE',
            credentials: 'include'
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

function getWeatherData(village: string, language: string = 'en') {
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
            const condMap: Record<string, string> = {
                'Clear Sky': 'साफ आसमान',
                'Scattered Clouds': 'छिटपुट बादल',
                'Light Rain': 'हल्की बारिश',
                'Thunderstorms': 'गरज के साथ बौछारें',
                'Windy & Overcast': 'तेज हवा और बादल'
            };
            condLocal = condMap[cond] || cond;
        } else if (language === 'mr') {
            const condMap: Record<string, string> = {
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
        const condMap: Record<string, string> = {
            'Clear Sky': 'साफ आसमान',
            'Scattered Clouds': 'छिटपुट बादल',
            'Light Rain': 'हल्की बारिश',
            'Thunderstorms': 'गरज के साथ बौछारें',
            'Windy & Overcast': 'तेज हवा और बादल'
        };
        condLocal = condMap[cond] || cond;
    } else if (language === 'mr') {
        const condMap: Record<string, string> = {
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
                        if (state.user && state.activeRecCrop) {
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
let preloadedVoices: SpeechSynthesisVoice[] = [];
if ('speechSynthesis' in window) {
    preloadedVoices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        preloadedVoices = window.speechSynthesis.getVoices();
    };
}

function speakAdvisory(status: string, disease: string, fertilizer: string) {
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
    const resStatus = document.getElementById('res-status');
    const resDisease = document.getElementById('res-disease');
    const resFert = document.getElementById('res-fertilizer');

    const status = resStatus ? resStatus.innerText : '';
    const disease = resDisease ? resDisease.innerText : '';
    const fert = resFert ? resFert.innerText : '';
    speakAdvisory(status, disease, fert);
}
