// ==================== GLOBALS ====================
const socket = io();
let localStream;
let pc;                // peer connection for calls
let screenPC;           // peer connection for screen share
let username;
let remoteUserId = null;
let callActive = false;
let pendingOffer = null;
let screenSharerId = null;

const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localPlaceholder = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remotePlaceholder');

// ==================== LOGIN ====================
function login() {
    username = document.getElementById('username').value.trim();
    if (!username) return alert('Enter name');
    socket.emit('join', username);
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
    updateStatus('Logged in');
    console.log('✅ Logged in as', username);
}

// ==================== UTILITIES ====================
function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

function log(msg) {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ==================== GET MEDIA ====================
async function getLocalMedia(withVideo) {
    if (localStream) return localStream;
    try {
        const constraints = {
            audio: true,
            video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 30 } : false
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        localVideo.style.display = 'block';
        localPlaceholder.style.display = 'none';
        log('✅ Got local media, video=' + withVideo);
        return localStream;
    } catch (err) {
        log('❌ Media error: ' + err.message);
        alert('Could not access camera/microphone');
        throw err;
    }
}

// ==================== CREATE PEER CONNECTION FOR CALLS ====================
function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(iceConfig);
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        log('Added local tracks to peer connection');
    }

    pc.ontrack = (event) => {
        log('✅ Received remote track: ' + event.track.kind);
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.style.display = 'block';
        remotePlaceholder.style.display = 'none';
        updateStatus('Connected');
        callActive = true;
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            log('❄️ Sending ICE candidate to ' + targetId);
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                targetId: targetId
            });
        }
    };

    pc.oniceconnectionstatechange = () => {
        log('ICE state: ' + pc.iceConnectionState);
        const indicator = document.getElementById('quality-indicator');
        if (pc.iceConnectionState === 'connected') indicator.style.background = '#4caf50';
        else if (pc.iceConnectionState === 'disconnected') indicator.style.background = '#ff9800';
        else if (pc.iceConnectionState === 'failed') indicator.style.background = '#f44336';
        else indicator.style.background = '';

        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            updateStatus('Disconnected');
            callActive = false;
        }
    };

    return pc;
}

// ==================== CALL USER ====================
async function callUser(targetId, targetName, withVideo) {
    if (callActive) return alert('Already in a call');
    try {
        await getLocalMedia(withVideo);
    } catch { return; }

    remoteUserId = targetId;
    pc = createPeerConnection(remoteUserId);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    log('📤 Sending offer to ' + targetId);
    socket.emit('offer', { offer, targetId: remoteUserId });
    updateStatus(`Calling ${targetName}...`);
}

// ==================== ACCEPT CALL ====================
async function acceptCall() {
    if (!pendingOffer) return;
    document.getElementById('incoming-call').style.display = 'none';

    const hasVideo = pendingOffer.offer.sdp.includes('m=video');
    try {
        await getLocalMedia(hasVideo);
    } catch { return; }

    remoteUserId = pendingOffer.from;
    pc = createPeerConnection(remoteUserId);

    await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    log('📤 Sending answer to ' + remoteUserId);
    socket.emit('answer', { answer, targetId: remoteUserId });
    updateStatus('Connecting...');
    pendingOffer = null;
}

function rejectCall() {
    document.getElementById('incoming-call').style.display = 'none';
    socket.emit('call-rejected', { targetId: pendingOffer.from });
    pendingOffer = null;
}

// ==================== SCREEN SHARE ====================
let screenStream;
let screenShareActive = false;

async function toggleScreenShare() {
    if (screenShareActive) {
        // Stop sharing
        if (screenPC) screenPC.close();
        if (screenStream) screenStream.getTracks().forEach(t => t.stop());
        screenShareActive = false;
        socket.emit('screen-stopped');
        log('Stopped screen share');
        return;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 30 },
            audio: true
        });
        log('✅ Got screen stream');

        screenShareActive = true;
        screenPC = new RTCPeerConnection(iceConfig);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));

        screenPC.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('screen-ice-candidate', { candidate: event.candidate, to: 'broadcast' });
            }
        };

        const offer = await screenPC.createOffer();
        await screenPC.setLocalDescription(offer);
        socket.emit('screen-offer', { offer, to: 'all' });
        socket.emit('screen-started');
        log('📤 Screen offer sent');

        screenStream.getVideoTracks()[0].onended = () => toggleScreenShare();
    } catch (err) {
        log('❌ Screen share error: ' + err.message);
    }
}

function joinScreenShare(sharerId) {
    if (!sharerId || sharerId === socket.id) return;
    if (screenPC) screenPC.close();

    screenPC = new RTCPeerConnection(iceConfig);
    screenPC.ontrack = (event) => {
        log('✅ Received screen track');
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.style.display = 'block';
        remotePlaceholder.style.display = 'none';
        updateStatus('Viewing screen');
    };

    screenPC.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('screen-ice-candidate', { candidate: event.candidate, to: sharerId });
        }
    };

    screenPC.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        .then(offer => screenPC.setLocalDescription(offer))
        .then(() => {
            socket.emit('screen-offer', { offer: screenPC.localDescription, to: sharerId });
        })
        .catch(err => log('❌ Join screen error: ' + err.message));
}

// ==================== HANG UP ====================
function hangUp() {
    if (pc) {
        pc.close();
        pc = null;
    }
    if (screenShareActive) toggleScreenShare(); // stops screen share
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    localVideo.style.display = 'none';
    remoteVideo.style.display = 'none';
    localPlaceholder.style.display = 'flex';
    remotePlaceholder.style.display = 'flex';
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    callActive = false;
    remoteUserId = null;
    updateStatus('Call ended');
    document.getElementById('quality-indicator').style.background = '';
    log('Call ended');
}

// ==================== CHAT ====================
function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat-message', { message: msg });
    input.value = '';
}

function addChatMessage(user, msg, time) {
    const div = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message';
    el.innerHTML = `<strong>${user}</strong> ${msg} <small>${time}</small>`;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
}

// ==================== SOCKET EVENTS ====================

socket.on('user-list', (users) => {
    const listDiv = document.getElementById('users-list');
    listDiv.innerHTML = '';
    users.forEach(user => {
        if (user.id !== socket.id) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = user.name;
            div.onclick = () => {
                const withVideo = confirm(`Call ${user.name} with video? OK = Video, Cancel = Audio`);
                callUser(user.id, user.name, withVideo);
            };
            listDiv.appendChild(div);
        }
    });
});

socket.on('user-joined', (data) => {
    const listDiv = document.getElementById('users-list');
    const div = document.createElement('div');
    div.className = 'user-item';
    div.textContent = data.username;
    div.onclick = () => {
        const withVideo = confirm(`Call ${data.username} with video? OK = Video, Cancel = Audio`);
        callUser(data.id, data.username, withVideo);
    };
    listDiv.appendChild(div);
    addChatMessage('System', `${data.username} joined`, '');
});

socket.on('user-left', (data) => {
    const items = document.getElementById('users-list').children;
    for (let item of items) {
        if (item.textContent === data.username) {
            item.remove();
            break;
        }
    }
    addChatMessage('System', `${data.username} left`, '');
    if (data.id === remoteUserId) hangUp();
});

socket.on('offer', (data) => {
    if (data.from === socket.id || callActive) return;
    log('📲 Received offer from ' + data.from);
    pendingOffer = data;
    const callerName = Array.from(document.getElementById('users-list').children).find(
        item => item.onclick?.toString().includes(data.from)
    )?.textContent || 'Someone';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('incoming-call').style.display = 'block';
});

socket.on('answer', async (data) => {
    if (!pc) return;
    log('📲 Received answer from ' + data.from);
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        log('❄️ Added ICE candidate from ' + data.from);
    } catch (err) {
        log('❌ Error adding ICE candidate: ' + err.message);
    }
});

socket.on('screen-offer', async (data) => {
    if (data.from === socket.id) return;
    log('📲 Received screen offer from ' + data.from);

    if (screenShareActive && screenPC) {
        // We are the sharer, answer this viewer
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
        log('📤 Sent screen answer');
    } else if (screenPC) {
        // We are a viewer answering the sharer (from joinScreenShare)
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
        log('📤 Sent screen answer');
    }
});

socket.on('screen-answer', async (data) => {
    if (!screenPC) return;
    log('📲 Received screen answer from ' + data.from);
    await screenPC.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('screen-ice-candidate', async (data) => {
    if (!screenPC) return;
    try {
        await screenPC.addIceCandidate(new RTCIceCandidate(data.candidate));
        log('❄️ Added screen ICE candidate from ' + data.from);
    } catch (err) {
        log('❌ Error adding screen ICE candidate: ' + err.message);
    }
});

socket.on('screen-available', (data) => {
    if (confirm(`${data.username} started screen sharing. Join?`)) {
        joinScreenShare(data.sharer);
    }
});

socket.on('screen-unavailable', () => {
    if (!callActive) {
        remoteVideo.style.display = 'none';
        remotePlaceholder.style.display = 'flex';
        remoteVideo.srcObject = null;
    }
    if (screenPC) screenPC.close();
    screenPC = null;
    log('Screen share ended');
});

socket.on('chat-message', (data) => {
    addChatMessage(data.user, data.message, data.time);
});

// ==================== ENTER KEY ====================
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});