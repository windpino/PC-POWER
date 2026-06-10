/**
 * PC Remote Power Control - SaaS Client Logic
 * Real-time Firebase Sync, Authentication, Multi-tenant DB & PIN Pairing
 */

// Central SaaS Firebase Configuration Fallback (Leave blank for user input, or pre-configure)
const DEFAULT_CONFIG = {
    databaseURL: "",
    apiKey: "",
    projectId: "",
    appId: ""
};

// Global variables
let db = null;
let firebaseApp = null;
let currentConfig = null;
let currentUser = null;

// Database Refs & Listeners
let devicesRef = null;
let selectedPcRef = null;
let stateCheckInterval = null;
let pcList = {};
let selectedPcId = null;
let pcData = null;

// DOM Elements - Auth Screen
const authContainer = document.getElementById('authContainer');
const authCard = document.querySelector('.auth-card');
const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('auth_email');
const authPassword = document.getElementById('auth_password');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authToggleText = document.getElementById('authToggleText');
const authToggleLink = document.getElementById('authToggleLink');
const googleLoginBtn = document.getElementById('googleLoginBtn');

// DOM Elements - Main App
const appContainer = document.getElementById('appContainer');
const connectionStatus = document.getElementById('connectionStatus');
const connectionStatusDot = connectionStatus.querySelector('.status-dot');
const connectionStatusText = connectionStatus.querySelector('.status-text');
const userNameText = document.getElementById('userNameText');
const userAvatar = document.getElementById('userAvatar');
const logoutBtn = document.getElementById('logoutBtn');

// DOM Elements - Tabs and Control Panel
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const deviceSelect = document.getElementById('deviceSelect');
const addDeviceInlineBtn = document.getElementById('addDeviceInlineBtn');
const emptyAddPcBtn = document.getElementById('emptyAddPcBtn');
const emptyStateCard = document.getElementById('emptyStateCard');
const mainControlCard = document.getElementById('mainControlCard');

const powerBtn = document.getElementById('powerBtn');
const powerOuterRing = document.getElementById('powerOuterRing');
const pcStateBadge = document.getElementById('pcStateBadge');
const mainStatusText = document.getElementById('mainStatusText');
const subStatusText = document.getElementById('subStatusText');
const pcIpText = document.getElementById('pcIpText');
const pcMacText = document.getElementById('pcMacText');
const pcLastSeenText = document.getElementById('pcLastSeenText');
const targetPcNameDisplay = document.getElementById('targetPcNameDisplay');

// DOM Elements - Modals
const addPcModal = document.getElementById('addPcModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelAddPcBtn = document.getElementById('cancelAddPcBtn');
const addPcForm = document.getElementById('addPcForm');
const pairingPinInput = document.getElementById('pairing_pin');
const newPcNameInput = document.getElementById('new_pc_name');
const newPcMacInput = document.getElementById('new_pc_mac');

// DOM Elements - Settings
const configForm = document.getElementById('configForm');
const dbUrlInput = document.getElementById('db_url');
const apiKeyInput = document.getElementById('api_key');
const projectIdInput = document.getElementById('project_id');
const appIdInput = document.getElementById('app_id');
const resetConfigBtn = document.getElementById('resetConfigBtn');
const pcListSettingsContainer = document.getElementById('pcListSettingsContainer');

// Auth Form toggle state (Login vs Register)
let isRegistering = false;

// 1. TAB SWITCHING LOGIC
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        
        tabButtons.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(`tab-${targetTab}`).classList.add('active');
    });
});

// ACCORDION FOR GUIDE
const accordionHeaders = document.querySelectorAll('.accordion-header');
accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
        const item = header.parentElement;
        const isActive = item.classList.contains('active');
        
        document.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('active'));
        
        if (!isActive) {
            item.classList.add('active');
        }
    });
});

// 2. MODAL DIALOG MANAGEMENT
function openAddPcModal() {
    addPcModal.classList.add('active');
    pairingPinInput.focus();
}

function closeAddPcModal() {
    addPcModal.classList.remove('active');
    addPcForm.reset();
}

addDeviceInlineBtn.addEventListener('click', openAddPcModal);
emptyAddPcBtn.addEventListener('click', openAddPcModal);
closeModalBtn.addEventListener('click', closeAddPcModal);
cancelAddPcBtn.addEventListener('click', closeAddPcModal);
addPcModal.addEventListener('click', (e) => {
    if (e.target === addPcModal) closeAddPcModal();
});

// 3. AUTHENTICATION UI INTERACTIVE TOGGLES
authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isRegistering = !isRegistering;
    
    if (isRegistering) {
        authTitle.textContent = "회원가입";
        authSubtitle.textContent = "새 계정을 만들어 원격 전원 제어판을 이용하세요.";
        authSubmitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> 회원가입';
        authToggleText.textContent = "이미 계정이 있으신가요?";
        authToggleLink.textContent = "로그인";
    } else {
        authTitle.textContent = "로그인";
        authSubtitle.textContent = "계정에 로그인하여 원격 전원 제어판에 액세스하세요.";
        authSubmitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> 로그인';
        authToggleText.textContent = "계정이 없으신가요?";
        authToggleLink.textContent = "회원가입";
    }
});

// 4. CONFIGURATION MANAGEMENT
function loadConfig() {
    const saved = localStorage.getItem('pc_power_config');
    if (saved) {
        try {
            currentConfig = JSON.parse(saved);
        } catch (e) {
            console.error("Error parsing saved configuration", e);
        }
    }
    
    // Default config logic fallback
    if (!currentConfig) {
        if (DEFAULT_CONFIG.databaseURL && DEFAULT_CONFIG.apiKey) {
            currentConfig = DEFAULT_CONFIG;
        }
    }
    
    if (currentConfig) {
        dbUrlInput.value = currentConfig.databaseURL || '';
        apiKeyInput.value = currentConfig.apiKey || '';
        projectIdInput.value = currentConfig.projectId || '';
        appIdInput.value = currentConfig.appId || '';
        
        // Hide settings tab button if using the hardcoded default config (SaaS mode)
        const settingsTabBtn = document.getElementById('settingsTabBtn');
        if (settingsTabBtn) {
            if (currentConfig === DEFAULT_CONFIG) {
                settingsTabBtn.style.display = 'none';
            } else {
                settingsTabBtn.style.display = 'flex'; // show for custom self-hosted config
            }
        }
        
        initializeFirebase(currentConfig);
    } else {
        // Show config tab and update status
        authContainer.style.display = 'none';
        appContainer.style.display = 'block';
        document.getElementById('settingsTabBtn').click();
        updateConnectionStatus('danger', '설정 필요');
    }
}

// SAVE CONFIG FORM
configForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const config = {
        databaseURL: dbUrlInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        projectId: projectIdInput.value.trim(),
        appId: appIdInput.value.trim()
    };
    
    localStorage.setItem('pc_power_config', JSON.stringify(config));
    currentConfig = config;
    
    alert("설정이 브라우저에 저장되었습니다. 로그인 화면으로 연결합니다.");
    location.reload();
});

// RESET CONFIG
resetConfigBtn.addEventListener('click', () => {
    if (confirm("정말로 모든 데이터베이스 설정을 초기화하시겠습니까?")) {
        localStorage.removeItem('pc_power_config');
        location.reload();
    }
});

// CONNECTION STATUS UI HELPER
function updateConnectionStatus(type, text) {
    connectionStatusDot.className = 'status-dot';
    connectionStatusDot.classList.add(type === 'success' ? 'success' : (type === 'warning' ? 'warning' : 'danger'));
    connectionStatusText.textContent = text;
}

// 5. INITIALIZE FIREBASE & REGISTER AUTH / DB SYNC
function initializeFirebase(config) {
    try {
        const firebaseConfig = {
            apiKey: config.apiKey,
            authDomain: `${config.projectId}.firebaseapp.com`,
            databaseURL: config.databaseURL,
            projectId: config.projectId,
            storageBucket: `${config.projectId}.appspot.com`,
            appId: config.appId
        };
        
        if (firebase.apps.length === 0) {
            firebaseApp = firebase.initializeApp(firebaseConfig);
        } else {
            firebaseApp = firebase.app();
        }
        db = firebase.database();
        
        updateConnectionStatus('warning', '인증 확인 중...');
        
        // Listen to Auth Changes
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                currentUser = user;
                authContainer.style.display = 'none';
                appContainer.style.display = 'flex';
                updateConnectionStatus('success', '연결됨');
                
                // Show profile
                userNameText.textContent = user.displayName || user.email;
                userAvatar.textContent = (user.displayName || user.email).charAt(0).toUpperCase();
                
                // Start listening to user devices
                syncUserDevices();
            } else {
                currentUser = null;
                appContainer.style.display = 'none';
                authContainer.style.display = 'flex';
                updateConnectionStatus('danger', '로그인 필요');
                cleanupListeners();
            }
        });
        
    } catch (error) {
        console.error("Firebase init failed:", error);
        updateConnectionStatus('danger', '연결 에러');
        alert("Firebase 연결 실패: " + error.message);
    }
}

// 6. FIREBASE AUTH SERVICE ACTIONS
authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = authEmail.value.trim();
    const password = authPassword.value;
    
    if (isRegistering) {
        firebase.auth().createUserWithEmailAndPassword(email, password)
            .then(() => alert("회원가입에 성공했습니다!"))
            .catch(error => alert("회원가입 실패: " + error.message));
    } else {
        firebase.auth().signInWithEmailAndPassword(email, password)
            .catch(error => alert("로그인 실패: " + error.message));
    }
});

googleLoginBtn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
        .catch(error => alert("Google 로그인 실패: " + error.message));
});

logoutBtn.addEventListener('click', () => {
    if (confirm("로그아웃 하시겠습니까?")) {
        firebase.auth().signOut();
    }
});

// CLEANUP DB LISTENERS ON LOGOUT
function cleanupListeners() {
    if (devicesRef) {
        try { devicesRef.off('value'); } catch (e) {}
        devicesRef = null;
    }
    if (selectedPcRef) {
        try { selectedPcRef.off('value'); } catch (e) {}
        selectedPcRef = null;
    }
    if (stateCheckInterval) {
        clearInterval(stateCheckInterval);
        stateCheckInterval = null;
    }
    pcList = {};
    selectedPcId = null;
    pcData = null;
}

// 7. REALTIME DATABASE - SYNC USER DEVICES
function syncUserDevices() {
    if (!currentUser || !db) return;
    
    devicesRef = db.ref(`users/${currentUser.uid}/pcs`);
    
    devicesRef.on('value', (snapshot) => {
        pcList = snapshot.val() || {};
        renderDeviceSelector();
        renderSettingsPcList();
    }, (error) => {
        console.error("Failed to read user devices:", error);
    });
}

// RENDER DEVICE DROPDOWN
function renderDeviceSelector() {
    const pcIds = Object.keys(pcList);
    
    // Clear dropdown
    deviceSelect.innerHTML = '';
    
    if (pcIds.length === 0) {
        // Show Empty State UI
        emptyStateCard.style.display = 'flex';
        mainControlCard.style.display = 'none';
        selectedPcId = null;
        cleanupActivePcListener();
        return;
    }
    
    // Show Control Card UI
    emptyStateCard.style.display = 'none';
    mainControlCard.style.display = 'flex';
    
    // Populate dropdown
    pcIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = pcList[id].name || id;
        deviceSelect.appendChild(option);
    });
    
    // Default to first device or keep existing selection
    if (!selectedPcId || !pcList[selectedPcId]) {
        selectedPcId = pcIds[0];
    }
    deviceSelect.value = selectedPcId;
    
    listenToActivePc(selectedPcId);
}

// DYNAMIC PC DETAILS SYNC
function listenToActivePc(pcId) {
    if (!db || !currentUser) return;
    
    // Cleanup previous listener
    cleanupActivePcListener();
    
    selectedPcRef = db.ref(`users/${currentUser.uid}/pcs/${pcId}`);
    
    selectedPcRef.on('value', (snapshot) => {
        pcData = snapshot.val();
        evaluatePcState();
    }, (error) => {
        console.error("Error reading target PC:", error);
    });
    
    // Start polling check (every 2 seconds)
    if (stateCheckInterval) clearInterval(stateCheckInterval);
    stateCheckInterval = setInterval(evaluatePcState, 2000);
}

function cleanupActivePcListener() {
    if (selectedPcRef) {
        try { selectedPcRef.off('value'); } catch (e) {}
        selectedPcRef = null;
    }
    if (stateCheckInterval) {
        clearInterval(stateCheckInterval);
        stateCheckInterval = null;
    }
}

// CHANGE PC DROPDOWN TRIGGER
deviceSelect.addEventListener('change', (e) => {
    selectedPcId = e.target.value;
    listenToActivePc(selectedPcId);
});

// LIVE STATE MACHINE EVALUATION
function evaluatePcState() {
    if (!pcData || !selectedPcId) return;
    
    const now = Date.now();
    const lastSeen = pcData.last_seen || 0;
    const timeDiff = now - lastSeen;
    
    // Heartbeat threshold: 25 seconds
    const isCommunicating = timeDiff < 25000;
    
    // Parse timestamp to human readable text
    let lastSeenStr = "기록 없음";
    if (lastSeen > 0) {
        const lastSeenDate = new Date(lastSeen);
        const hours = String(lastSeenDate.getHours()).padStart(2, '0');
        const minutes = String(lastSeenDate.getMinutes()).padStart(2, '0');
        const seconds = String(lastSeenDate.getSeconds()).padStart(2, '0');
        lastSeenStr = `${hours}:${minutes}:${seconds}`;
    }
    
    targetPcNameDisplay.textContent = pcData.name || selectedPcId;
    pcIpText.textContent = pcData.ip || '미등록';
    pcMacText.textContent = pcData.mac || '미등록';
    pcLastSeenText.textContent = lastSeenStr;
    
    powerBtn.disabled = false;
    
    // Determine status state
    if (pcData.state === 'SHUTDOWN_REQUESTED' || pcData.state === 'SHUTTING_DOWN') {
        setTransitioningUI("시스템 종료 중...", "컴퓨터가 종료 신호를 처리하는 중입니다.");
    } else if (pcData.state === 'BOOT_REQUESTED') {
        setTransitioningUI("원격 부팅 중...", "Wake-on-LAN 브릿지 신호가 전송되었습니다.");
    } else if (isCommunicating) {
        setOnlineUI();
    } else {
        setOfflineUI(lastSeenStr);
    }
}

function setOnlineUI() {
    powerBtn.className = 'power-btn online';
    powerOuterRing.className = 'outer-ring pulse-online';
    pcStateBadge.className = 'device-badge online';
    pcStateBadge.textContent = 'ONLINE';
    mainStatusText.textContent = 'PC가 켜져 있습니다';
    mainStatusText.style.color = '#ffffff';
    subStatusText.textContent = '버튼을 클릭하면 컴퓨터가 즉시 안전하게 종료됩니다.';
}

function setOfflineUI(lastSeenStr) {
    powerBtn.className = 'power-btn offline';
    powerOuterRing.className = 'outer-ring';
    pcStateBadge.className = 'device-badge offline';
    pcStateBadge.textContent = 'OFFLINE';
    mainStatusText.textContent = 'PC가 꺼져 있습니다';
    mainStatusText.style.color = 'var(--text-secondary)';
    
    if (lastSeenStr === "기록 없음") {
        subStatusText.textContent = '버튼을 클릭하면 컴퓨터 부팅 신호(WOL)를 보냅니다.';
    } else {
        subStatusText.textContent = `마지막 활성화 시간: 오늘 ${lastSeenStr}. 버튼을 클릭하면 부팅됩니다.`;
    }
}

function setTransitioningUI(mainMsg, subMsg) {
    powerBtn.className = 'power-btn transition';
    powerOuterRing.className = 'outer-ring spinning';
    pcStateBadge.className = 'device-badge transition';
    pcStateBadge.textContent = 'PENDING';
    mainStatusText.textContent = mainMsg;
    mainStatusText.style.color = 'var(--color-warning)';
    subStatusText.textContent = subMsg;
    powerBtn.disabled = true; // Block actions during transitions
}

// POWER BUTTON TOGGLE ACTION
powerBtn.addEventListener('click', () => {
    if (!db || !currentUser || !selectedPcId || !pcData || !selectedPcRef) return;
    
    const now = Date.now();
    const lastSeen = pcData.last_seen || 0;
    const isOnline = (now - lastSeen) < 25000 && pcData.state !== 'SHUTDOWN_REQUESTED' && pcData.state !== 'SHUTTING_DOWN';
    
    if (isOnline) {
        if (confirm(`정말로 컴퓨터 '${pcData.name || selectedPcId}'을(가) 종료하시겠습니까?`)) {
            setTransitioningUI("시스템 종료 요청 중...", "종료 신호를 데이터베이스에 쓰고 있습니다.");
            selectedPcRef.update({ state: 'SHUTDOWN_REQUESTED' })
                .catch(err => {
                    alert("명령 전송 실패: " + err.message);
                    evaluatePcState();
                });
        }
    } else {
        setTransitioningUI("부팅 요청 중...", "WOL 부팅 신호를 데이터베이스에 쓰고 있습니다.");
        
        const mac = pcData.mac;
        if (!mac || mac === '미등록') {
            alert("부팅하기 전에 PC MAC 주소가 입력되어야 합니다! 설정 탭에서 입력해 주세요.");
            evaluatePcState();
            return;
        }
        
        selectedPcRef.update({ 
            state: 'BOOT_REQUESTED',
            mac: mac,
            broadcast_ip: pcData.broadcast_ip || '192.168.1.255'
        })
        .then(() => {
            // Auto timeout (25 seconds)
            setTimeout(() => {
                if (pcData && pcData.state === 'BOOT_REQUESTED') {
                    selectedPcRef.update({ state: 'OFFLINE' });
                    alert("부팅 실패: 신호를 보냈으나 WOL 브릿지 또는 PC 에이전트의 응답이 없습니다.");
                }
            }, 25000);
        })
        .catch(err => {
            alert("명령 전송 실패: " + err.message);
            evaluatePcState();
        });
    }
});

// 8. ADD PC (PAIRING HANDSHAKE FORM SUBMIT)
addPcForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!db || !currentUser) return;
    
    const pin = pairingPinInput.value.trim();
    const pcName = newPcNameInput.value.trim();
    const customMac = newPcMacInput.value.trim().toUpperCase();
    
    const pinRegex = /^[0-9]{6}$/;
    if (!pinRegex.test(pin)) {
        alert("6자리 인증번호(PIN)를 입력해 주세요.");
        return;
    }
    
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (customMac && !macRegex.test(customMac)) {
        alert("올바른 MAC 주소 형식을 입력해 주세요. (예: AA:BB:CC:DD:EE:FF)");
        return;
    }
    
    updateConnectionStatus('warning', '기기 연동 및 승인 요청 중...');
    
    const pairingRef = db.ref(`pairing_codes/${pin}`);
    
    pairingRef.once('value').then((snapshot) => {
        const pairingData = snapshot.val();
        if (!pairingData || pairingData.status !== 'PENDING') {
            updateConnectionStatus('success', '연결됨');
            alert("유효하지 않거나 이미 만료된 PIN 번호입니다. 에이전트 화면의 숫자를 확인하세요.");
            return;
        }
        
        const pcId = pairingData.pcId;
        const macAddress = customMac || pairingData.mac || '미등록';
        const ipAddress = pairingData.ip || '미등록';
        
        // 1. Create PC profile under the logged-in user
        const newPcRef = db.ref(`users/${currentUser.uid}/pcs/${pcId}`);
        const initialPcData = {
            name: pcName,
            state: 'ONLINE',
            last_seen: Date.now(), // set now so it turns online instantly
            mac: macAddress,
            ip: ipAddress,
            broadcast_ip: '192.168.1.255'
        };
        
        return newPcRef.set(initialPcData)
            .then(() => {
                // 2. Mark pairing code node as PAIRED so Agent picks it up
                return pairingRef.update({
                    status: 'PAIRED',
                    paired_uid: currentUser.uid,
                    pcId: pcId
                });
            })
            .then(() => {
                updateConnectionStatus('success', '연결됨');
                alert(`기기 '${pcName}'가 성공적으로 연결되었습니다!`);
                selectedPcId = pcId; // auto-focus new device
                closeAddPcModal();
            });
            
    }).catch(error => {
        updateConnectionStatus('success', '연결됨');
        console.error("Pairing failure:", error);
        alert("기기 등록 중 오류 발생: " + error.message);
    });
});

// 9. RENDER REGISTERED PC LIST IN SETTINGS
function renderSettingsPcList() {
    pcListSettingsContainer.innerHTML = '';
    const pcIds = Object.keys(pcList);
    
    if (pcIds.length === 0) {
        pcListSettingsContainer.innerHTML = '<p style="font-size: 0.82rem; color: var(--text-secondary); text-align: center; padding: 20px;">등록된 PC가 없습니다.</p>';
        return;
    }
    
    pcIds.forEach(id => {
        const pc = pcList[id];
        
        const pcItem = document.createElement('div');
        pcItem.className = 'pc-item-settings';
        
        pcItem.innerHTML = `
            <div class="pc-item-info">
                <span class="pc-item-name">${pc.name || id} (${id})</span>
                <span class="pc-item-details">IP: ${pc.ip || '-'} | MAC: ${pc.mac || '-'}</span>
            </div>
            <button class="pc-item-delete-btn" data-id="${id}" title="기기 삭제"><i class="fa-solid fa-trash-can"></i></button>
        `;
        
        pcListSettingsContainer.appendChild(pcItem);
    });
    
    // Bind delete buttons
    const deleteBtns = pcListSettingsContainer.querySelectorAll('.pc-item-delete-btn');
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pcId = btn.getAttribute('data-id');
            const name = pcList[pcId].name || pcId;
            
            if (confirm(`정말로 PC 기기 '${name}' 연동을 해제(삭제)하시겠습니까?`)) {
                db.ref(`users/${currentUser.uid}/pcs/${pcId}`).remove()
                    .then(() => {
                        alert("성공적으로 삭제되었습니다.");
                        if (selectedPcId === pcId) selectedPcId = null;
                    })
                    .catch(err => alert("삭제 실패: " + err.message));
            }
        });
    });
}

// 10. Load configuration on entry
window.addEventListener('DOMContentLoaded', loadConfig);
