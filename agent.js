/**
 * PC Remote Power Control - Target PC Agent (SaaS Version)
 * Runs on the target Windows PC. Generates pairing PIN on first execution
 * and registers itself as a background startup runner.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

// Central Firebase Configuration Fallback (Fill this in before compiling to EXE)
const DEFAULT_CONFIG = {
    firebase: {
        databaseURL: "",
        apiKey: "",
        projectId: "",
        appId: ""
    },
    broadcastIp: "192.168.1.255"
};

// Resolve paths relative to EXE directory (vital when compiled using pkg)
const EXE_DIR = path.dirname(process.execPath);
const CONFIG_PATH = path.join(EXE_DIR, 'agent-config.json');

// Log helper
function log(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${timestamp}] ${message}`);
}

// 1. Resolve Firebase Config & Pairing State
let config = null;
let firebaseConfig = null;
let isPaired = false;

if (fs.existsSync(CONFIG_PATH)) {
    try {
        const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
        config = JSON.parse(rawData);
        
        if (config.firebase && config.firebase.databaseURL) {
            firebaseConfig = config.firebase;
        }
        
        if (config.uid && config.pcId) {
            isPaired = true;
        }
    } catch (e) {
        log(`설정 파일 분석 실패: ${e.message}`);
    }
}

// Fallback to hardcoded keys if not set in config
if (!firebaseConfig) {
    if (DEFAULT_CONFIG.firebase && DEFAULT_CONFIG.firebase.databaseURL) {
        firebaseConfig = DEFAULT_CONFIG.firebase;
    }
}

if (!firebaseConfig || !firebaseConfig.databaseURL) {
    log("=========================================================================");
    log("오류: Firebase 설정 정보를 찾을 수 없습니다.");
    log("1. 이 프로그램 소스 코드의 DEFAULT_CONFIG 변수에 Firebase 설정값을 입력하거나");
    log("2. 프로그램이 위치한 폴더에 'agent-config.json' 파일을 배치해 주세요.");
    log("=========================================================================");
    setTimeout(() => process.exit(1), 15000);
    return;
}

// Load Firebase SDK (modular require)
let firebaseApp, db;
let ref, update, onValue, set, remove;

try {
    const { initializeApp } = require('firebase/app');
    const { getDatabase, ref: dbRef, update: dbUpdate, onValue: dbOnValue, set: dbSet, remove: dbRemove } = require('firebase/database');
    
    firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    ref = dbRef;
    update = dbUpdate;
    onValue = dbOnValue;
    set = dbSet;
    remove = dbRemove;
} catch (error) {
    log("=========================================================================");
    log("오류: Firebase SDK를 초기화할 수 없습니다.");
    log("먼저 'npm install'을 실행하여 패키지를 복구해 주세요.");
    log(`상세 내역: ${error.message}`);
    log("=========================================================================");
    setTimeout(() => process.exit(1), 10000);
    return;
}

// Native network resolver
function getNetworkInfo() {
    const interfaces = os.networkInterfaces();
    let localIp = '미등록';
    let localMac = '미등록';

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (!iface.internal && iface.family === 'IPv4') {
                localIp = iface.address;
                if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
                    localMac = iface.mac.toUpperCase();
                }
                return { ip: localIp, mac: localMac };
            }
        }
    }
    return { ip: localIp, mac: localMac };
}

const network = getNetworkInfo();

// 2. MAIN STATE FLOW EXECUTION
if (isPaired) {
    // START DIRECTLY IN NORMAL MODE
    runNormalAgent();
} else {
    // START PAIRING HANDSHAKE MODE
    runPairingHandshake();
}

// NORMAL BACKGROUND HEARTBEAT & SHUTDOWN LISTENER
function runNormalAgent() {
    log(`정상 모드 구동 - 사용자 UID: ${config.uid}, PC ID: ${config.pcId}`);
    
    const pcRef = ref(db, `users/${config.uid}/pcs/${config.pcId}`);
    let isShuttingDown = false;
    
    function sendHeartbeat() {
        if (isShuttingDown) return;
        
        update(pcRef, {
            last_seen: Date.now(),
            ip: network.ip,
            mac: network.mac,
            state: 'ONLINE' // Reset boot request status
        }).catch(err => {
            log(`하트비트 실패: ${err.message}`);
        });
    }
    
    // Heartbeat immediate and loop (10s)
    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 10000);
    
    // Command listener
    const dbUnsubscribe = onValue(pcRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        if (data.state === 'SHUTDOWN_REQUESTED' && !isShuttingDown) {
            isShuttingDown = true;
            clearInterval(heartbeatInterval);
            log("원격 종료 신호를 수신했습니다. 시스템 종료 프로세스를 시작합니다...");
            
            update(pcRef, { state: 'SHUTTING_DOWN' })
                .then(() => {
                    if (dbUnsubscribe) dbUnsubscribe();
                    setTimeout(executeWindowsShutdown, 2000);
                })
                .catch(() => {
                    executeWindowsShutdown();
                });
        }
    });
}

// PAIRING FLOW (GENERATING PIN & WAITING HANDSHAKE)
function runPairingHandshake() {
    // Generate unique random pin & temp pcId
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const hostname = os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const pcId = `${hostname}-${randomSuffix}`;
    
    log("=========================================================================");
    log("★ PC Remote Power Controller - 기기 신규 연동 대기 중 ★");
    log("=========================================================================");
    log("");
    log("대시보드 웹페이지에 접속하여 로그인한 뒤, [PC 추가] 메뉴를 선택하고");
    log("아래의 6자리 인증번호(PIN)를 입력해 주세요.");
    log("");
    log(`   ▶ 인증번호 (PIN): [  ${pin}  ]`);
    log("");
    log("연동이 완료될 때까지 이 창을 닫지 마세요...");
    log("=========================================================================");

    const pairingRef = ref(db, `pairing_codes/${pin}`);
    
    // Post pairing code to Firebase
    set(pairingRef, {
        pcId: pcId,
        mac: network.mac,
        ip: network.ip,
        status: 'PENDING',
        created_at: Date.now()
    }).catch(err => {
        log(`인증코드 등록 실패: ${err.message}`);
        setTimeout(() => process.exit(1), 10000);
    });
    
    // Listen for Pairing status update
    const pairingUnsubscribe = onValue(pairingRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        if (data.status === 'PAIRED' && data.paired_uid) {
            log(`기기 연동 감지! 사용자 UID: ${data.paired_uid}`);
            
            // 1. Write configuration file locally
            const savedConfig = {
                firebase: firebaseConfig,
                uid: data.paired_uid,
                pcId: pcId,
                broadcastIp: config ? config.broadcastIp || '192.168.1.255' : '192.168.1.255'
            };
            
            try {
                fs.writeFileSync(CONFIG_PATH, JSON.stringify(savedConfig, null, 2), 'utf8');
                log(`설정 파일 저장 완료: ${CONFIG_PATH}`);
            } catch (err) {
                log(`설정 저장 중 오류 발생: ${err.message}`);
            }
            
            // 2. Setup Windows Startup silent service registry
            registerWindowsStartup();
            
            // 3. Remove pairing code from database
            remove(pairingRef)
                .then(() => {
                    log("연동 신호 정리를 완료했습니다.");
                    if (pairingUnsubscribe) pairingUnsubscribe();
                    
                    log("백그라운드 모드를 시작합니다. 잠시 후 현재 창이 닫힙니다.");
                    
                    // 4. Spawn silent runner and exit console
                    setTimeout(spawnSilentBackgroundProcess, 2000);
                });
        }
    });
}

// SETUP WINDOWS STARTUP REPOSITORY (VBS WRAPPER & SHORTCUT)
function registerWindowsStartup() {
    try {
        const execFilename = path.basename(process.execPath);
        const isPackaged = typeof process.pkg !== 'undefined';
        
        const vbsPath = path.join(EXE_DIR, 'run-agent-silent.vbs');
        const runCmd = isPackaged 
            ? `""" & currentDir & "\\${execFilename}"""` 
            : `node """ & currentDir & "\\agent.js"""`;
            
        const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
currentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptPosition)
WshShell.Run "cmd.exe /c ${runCmd} >> """ & currentDir & "\\agent.log"" 2>&1", 0, false`;

        fs.writeFileSync(vbsPath, vbsContent, 'utf8');
        log("무음 실행 VBScript 작성 완료.");
        
        const startupFolder = path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs\\Startup');
        const shortcutPath = path.join(startupFolder, 'PC_Power_Agent.lnk');
        
        // Use PowerShell Command to generate Startup Link
        const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -Command ` +
            `"$s = New-Object -ComObject WScript.Shell; ` +
            `$u = $s.CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); ` +
            `$u.TargetPath = 'wscript.exe'; ` +
            `$u.Arguments = '\\"${vbsPath.replace(/'/g, "''")}\\"'; ` +
            `$u.WorkingDirectory = '${EXE_DIR.replace(/'/g, "''")}'; ` +
            `$u.Save();"`;
            
        exec(psCommand, (error) => {
            if (error) {
                log(`시작프로그램 바로가기 등록 실패: ${error.message}`);
            } else {
                log("시작프로그램(Startup) 바로가기 등록 성공!");
            }
        });
    } catch (err) {
        log(`시작프로그램 등록 중 예외 발생: ${err.message}`);
    }
}

// SPAWN SILENT AGENT IMMEDIATELY AFTER PAIRING SUCCESS
function spawnSilentBackgroundProcess() {
    const vbsPath = path.join(EXE_DIR, 'run-agent-silent.vbs');
    
    // Execute silent VBS (runs background process)
    exec(`wscript.exe "${vbsPath}"`, (err) => {
        if (err) {
            log(`백그라운드 구동 프로세스 실행 실패: ${err.message}`);
        }
        process.exit(0);
    });
}

// WINDOWS NATIVE SHUTDOWN
function executeWindowsShutdown() {
    log("로컬 윈도우 종료 커맨드 실행 (shutdown /s /t 5)...");
    exec('shutdown /s /t 5 /c "Antigravity Power Controller: Remote shutdown initiated"', (error) => {
        if (error) {
            log(`종료 실행 오류: ${error.message}`);
            return;
        }
        process.exit(0);
    });
}
