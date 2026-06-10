/**
 * PC Remote Power Control - Wake-on-LAN Bridge Agent
 * Runs on a secondary always-on local device (e.g., Raspberry Pi, old PC) on the same network.
 * Listens for BOOT_REQUESTED from the database and broadcasts a Wake-on-LAN Magic Packet.
 */

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');

// Define configuration path
const CONFIG_PATH = path.join(__dirname, 'agent-config.json');

// Log helper
function log(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${timestamp}] ${message}`);
}

// 1. Load configuration file
if (!fs.existsSync(CONFIG_PATH)) {
    log("=========================================================================");
    log("오류: 'agent-config.json' 파일을 찾을 수 없습니다.");
    log("웹 대시보드의 [시스템 설정] 탭에서 설정을 저장하고 다운로드한 후,");
    log("이 bridge.js 파일과 동일한 폴더에 'agent-config.json' 이름으로 저장해 주세요.");
    log("=========================================================================");
    setTimeout(() => process.exit(1), 10000);
    return;
}

let config;
try {
    const rawData = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(rawData);
    log(`설정을 로드했습니다. 브릿지 대상 PC ID: ${config.pcId}`);
} catch (error) {
    log(`설정 파일 파싱 오류: ${error.message}`);
    setTimeout(() => process.exit(1), 5000);
    return;
}

// Ensure Firebase SDK is installed
let firebaseApp, db;
let ref, update, onValue;

try {
    const { initializeApp } = require('firebase/app');
    const { getDatabase, ref: dbRef, update: dbUpdate, onValue: dbOnValue } = require('firebase/database');
    
    firebaseApp = initializeApp(config.firebase);
    db = getDatabase(firebaseApp);
    ref = dbRef;
    update = dbUpdate;
    onValue = dbOnValue;
    log("Firebase 연결 성공. WOL 브릿지 모니터링을 시작합니다.");
} catch (error) {
    log("=========================================================================");
    log("오류: Firebase SDK를 로드할 수 없습니다.");
    log("먼저 'npm install'을 실행하여 패키지를 설치해 주세요.");
    log(`세부 오류: ${error.message}`);
    log("=========================================================================");
    setTimeout(() => process.exit(1), 10000);
    return;
}

// 2. Pure JavaScript Wake-on-LAN Magic Packet Sender
function sendWakeOnLAN(macAddress, broadcastIp = '255.255.255.255', port = 9) {
    return new Promise((resolve, reject) => {
        // Clean MAC address (strip colons, dashes, and whitespace)
        const cleanMac = macAddress.replace(/[^0-9A-Fa-f]/g, '');
        
        if (cleanMac.length !== 12) {
            return reject(new Error(`올바르지 않은 MAC 주소 형식입니다: ${macAddress}`));
        }
        
        log(`WOL 패킷 생성 중 - MAC: ${macAddress}, 브로드캐스트 IP: ${broadcastIp}:${port}`);
        
        // Construct Magic Packet buffer (102 bytes total)
        // 6 bytes of 0xFF followed by MAC address repeated 16 times (6 * 16 = 96 bytes)
        const buffer = Buffer.alloc(102);
        
        // Fill first 6 bytes with 0xFF
        for (let i = 0; i < 6; i++) {
            buffer[i] = 0xFF;
        }
        
        // Parse MAC into byte array
        const macBytes = Buffer.alloc(6);
        for (let i = 0; i < 6; i++) {
            macBytes[i] = parseInt(cleanMac.substr(i * 2, 2), 16);
        }
        
        // Repeat MAC address 16 times
        for (let i = 0; i < 16; i++) {
            macBytes.copy(buffer, 6 + i * 6);
        }
        
        // Create UDP socket
        const socket = dgram.createSocket('udp4');
        
        socket.once('error', (err) => {
            socket.close();
            reject(err);
        });
        
        socket.bind(() => {
            socket.setBroadcast(true);
            socket.send(buffer, 0, buffer.length, port, broadcastIp, (err) => {
                socket.close();
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

// 3. Database Listener for Boot Requests
const pcRef = ref(db, `devices/${config.pcId}`);

onValue(pcRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    
    if (data.state === 'BOOT_REQUESTED') {
        log("원격 부팅 요청(BOOT_REQUESTED)을 감지했습니다.");
        
        const targetMac = data.mac;
        const broadcastIp = data.broadcast_ip || config.broadcastIp || '192.168.1.255';
        
        if (!targetMac || targetMac === '미등록') {
            log("[오류] 대상 PC의 MAC 주소가 등록되어 있지 않아 부팅할 수 없습니다.");
            update(pcRef, { state: 'OFFLINE' });
            return;
        }
        
        // Send the WOL packet
        sendWakeOnLAN(targetMac, broadcastIp)
            .then(() => {
                log(`[성공] MAC [${targetMac}] 번으로 Wake-on-LAN 매직 패킷이 전송되었습니다.`);
                // Reset database state to OFFLINE to clear boot request loop.
                // The PC will update state to ONLINE itself once its agent runs.
                return update(pcRef, { state: 'OFFLINE' });
            })
            .then(() => {
                log("DB 상태를 'OFFLINE'으로 재설정했습니다. PC 부팅 완료를 기다리는 중...");
            })
            .catch((err) => {
                log(`[실패] WOL 전송 중 에러 발생: ${err.message}`);
                update(pcRef, { state: 'OFFLINE' });
            });
    }
});
