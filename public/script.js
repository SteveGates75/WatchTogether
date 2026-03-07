// ==================== GLOBALS ====================
const socket = io();
let localStream;
let pc;
let username;
let remoteUserId = null;
let callActive = false;
let pendingOffer = null; // store offer when received

// Media controls
let audioEnabled = true;
let videoEnabled = true;

// STUN servers
const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// ==================== LOGIN ====================
function login() {
    username = document.getElementById('username').value.trim();
    if (!username) return alert('Enter name');
    socket.emit('join', username);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    updateStatus('Joining...');

    // Get local media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;
            updateStatus('Logged in, ready to call');
        })
        .catch(err => {
            console.error('Media error:', err);
            alert('Cannot access camera/microphone');
        });
}

// ==================== UPDATE STATUS ====================
function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

// ==================== CREATE PEER CONNECTION ====================
function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(iceConfig);

    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log('✅ Received remote track');
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = event.streams[0];
        updateStatus('Connected');
        callActive = true;
    };

    // ICE candidate
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('❄️ Sending ICE candidate to', targetId);
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                targetId: targetId
            });
        }
    };

    // Connection state changes
    pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            updateStatus('Disconnected');
            callActive = false;
            remoteUserId = null;
        }
    };

    return pc;
}

// ==================== START CALL ====================
function callUser(targetId, targetName) {
    if (callActive) {
        alert('Already in a call');
        return;
    }
    if (!localStream) return alert('No media');

    remoteUserId = targetId;
    pc = createPeerConnection(remoteUserId);

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            console.log('📤 Sending offer to', remoteUserId);
            socket.emit('offer', {
                offer: pc.localDescription,
                targetId: remoteUserId
            });
            updateStatus(`Calling ${targetName}...`);
        })
        .catch(err => console.error('Offer error:', err));
}

// ==================== ACCEPT CALL ====================
function acceptCall() {
    if (!pendingOffer) return;
    document.getElementById('incoming-call').style.display = 'none';

    remoteUserId = pendingOffer.from;
    pc = createPeerConnection(remoteUserId);

    pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.offer))
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => {
            console.log('📤 Sending answer to', remoteUserId);
            socket.emit('answer', {
                answer: pc.localDescription,
                targetId: remoteUserId
            });
            updateStatus('Connecting...');
        })
        .catch(err => console.error('Accept error:', err));

    pendingOffer = null;
}

// ==================== REJECT CALL ====================
function rejectCall() {
    document.getElementById('incoming-call').style.display = 'none';
    // Optionally send a rejection signal to the caller
    socket.emit('call-rejected', { targetId: pendingOffer.from });
    pendingOffer = null;
}

// ==================== HANG UP ====================
function hangUp() {
    if (pc) {
        pc.close();
        pc = null;
    }
    document.getElementById('remoteVideo').srcObject = null;
    callActive = false;
    remoteUserId = null;
    updateStatus('Call ended');
}

// ==================== MUTE CONTROLS ====================
function toggleMuteAudio() {
    if (!localStream) return;
    audioEnabled = !audioEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = audioEnabled);
    const btn = document.getElementById('muteAudioBtn');
    btn.textContent = audioEnabled ? '🔊 Mute Mic' : '🔇 Unmute Mic';
    document.getElementById('localMuteIndicator').style.display = audioEnabled ? 'none' : 'block';
}

function toggleMuteVideo() {
    if (!localStream) return;
    videoEnabled = !videoEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = videoEnabled);
    const btn = document.getElementById('muteVideoBtn');
    btn.textContent = videoEnabled ? '🎥 Hide Video' : '🎥 Show Video';
}

// ==================== FULLSCREEN ====================
function toggleFullscreen() {
    const remoteVideo = document.getElementById('remoteVideo');
    if (!remoteVideo) return;
    if (remoteVideo.requestFullscreen) {
        remoteVideo.requestFullscreen();
    } else if (remoteVideo.webkitRequestFullscreen) {
        remoteVideo.webkitRequestFullscreen();
    } else if (remoteVideo.msRequestFullscreen) {
        remoteVideo.msRequestFullscreen();
    }
}

// ==================== SOCKET EVENTS ====================

// Receive list of users
socket.on('user-list', (users) => {
    console.log('Online users:', users);
    const listDiv = document.getElementById('user-list');
    listDiv.innerHTML = '';
    users.forEach(user => {
        if (user.id !== socket.id) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = user.name;
            div.onclick = () => callUser(user.id, user.name);
            listDiv.appendChild(div);
        }
    });
});

// Someone joined
socket.on('user-joined', (data) => {
    console.log(`${data.username} joined`);
    const listDiv = document.getElementById('user-list');
    const div = document.createElement('div');
    div.className = 'user-item';
    div.textContent = data.username;
    div.onclick = () => callUser(data.id, data.username);
    listDiv.appendChild(div);
});

// Someone left
socket.on('user-left', (data) => {
    console.log(`${data.username} left`);
    const items = document.getElementById('user-list').children;
    for (let item of items) {
        if (item.textContent === data.username) {
            item.remove();
            break;
        }
    }
    if (data.id === remoteUserId) {
        hangUp();
    }
});

// Receive offer
socket.on('offer', (data) => {
    console.log('📲 Received offer from', data.from);
    if (callActive) {
        console.log('Already in a call, ignoring');
        return;
    }
    // Store offer and show incoming call popup
    pendingOffer = data;
    // Find caller's name (optional)
    const callerItem = Array.from(document.getElementById('user-list').children).find(
        item => item.onclick && item.onclick.toString().includes(data.from)
    );
    const callerName = callerItem ? callerItem.textContent : 'Someone';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('incoming-call').style.display = 'block';
});

// Receive answer
socket.on('answer', async (data) => {
    console.log('📲 Received answer from', data.from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

// Receive ICE candidate
socket.on('ice-candidate', async (data) => {
    console.log('❄️ Received ICE candidate from', data.from);
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Call rejection
socket.on('call-rejected', (data) => {
    if (data.from === remoteUserId) {
        hangUp();
        updateStatus('Call rejected');
        alert('The other party rejected your call.');
    }
});