// ==================== GLOBALS ====================
const socket = io();
let localStream;
let pc;
let screenPC;
let username;
let remoteUserId = null;
let callActive = false;
let pendingOffer = null;
let currentFacingMode = 'user';
let screenSharerId = null;
let screenShareActive = false;

// Media controls
let audioEnabled = true;
let videoEnabled = true;

// 1080p 60fps constraints
const videoConstraints = {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 60, max: 60 }
};

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
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    updateStatus('Joining...');

    navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;
            updateStatus('Logged in, ready to call');
        })
        .catch(err => {
            console.error('Media error, falling back to audio only', err);
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    localStream = stream;
                    updateStatus('Mic only');
                })
                .catch(err2 => {
                    console.error('No media devices', err2);
                    updateStatus('No media');
                });
        });
}

// ==================== UPDATE STATUS ====================
function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

// ==================== CREATE PEER CONNECTION ====================
function createPeerConnection(targetId, isScreen = false) {
    const pc = new RTCPeerConnection(iceConfig);

    if (!isScreen && localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        console.log('✅ Received remote track', event.track.kind);
        if (isScreen) {
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.srcObject = event.streams[0];
            updateStatus('Screen shared');
        } else {
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.srcObject = event.streams[0];
            updateStatus('Connected');
            callActive = true;
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const eventName = isScreen ? 'screen-ice-candidate' : 'ice-candidate';
            socket.emit(eventName, {
                candidate: event.candidate,
                targetId: targetId
            });
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        const indicator = document.getElementById('quality-indicator');
        if (pc.iceConnectionState === 'connected') {
            indicator.className = 'quality-badge quality-good';
        } else if (pc.iceConnectionState === 'disconnected') {
            indicator.className = 'quality-badge quality-poor';
        } else if (pc.iceConnectionState === 'failed') {
            indicator.className = 'quality-badge quality-bad';
        }

        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            if (!isScreen) {
                updateStatus('Disconnected');
                callActive = false;
                remoteUserId = null;
            }
        }
    };

    return pc;
}

// ==================== CALL USER ====================
function callUser(targetId, targetName, withVideo = true) {
    if (callActive) {
        alert('Already in a call');
        return;
    }
    if (!localStream) return alert('No media');

    remoteUserId = targetId;
    pc = createPeerConnection(remoteUserId, false);

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
    pc = createPeerConnection(remoteUserId, false);

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
    socket.emit('call-rejected', { targetId: pendingOffer.from });
    pendingOffer = null;
}

// ==================== VIDEO / AUDIO CALL TOGGLES ====================
function toggleVideoCall() {
    if (!localStream) return alert('No camera/mic');
    if (callActive) {
        hangUp();
        return;
    }
    alert('Click on a user in the sidebar to start a video call.');
}

function toggleAudioCall() {
    if (!localStream) return alert('No microphone');
    if (callActive) {
        hangUp();
        return;
    }
    alert('Click on a user in the sidebar to start an audio call.');
}

// ==================== SCREEN SHARE ====================
async function toggleScreenShare() {
    if (screenShareActive) {
        if (screenPC) screenPC.close();
        screenPC = null;
        if (window.screenStream) {
            window.screenStream.getTracks().forEach(t => t.stop());
        }
        screenShareActive = false;
        document.getElementById('screenShareBtn').classList.remove('active');
        socket.emit('screen-stopped');
        return;
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 60 },
            audio: true
        });
        window.screenStream = screenStream;

        document.getElementById('screenShareBtn').classList.add('active');
        screenPC = createPeerConnection('broadcast', true);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));

        const offer = await screenPC.createOffer();
        await screenPC.setLocalDescription(offer);

        socket.emit('screen-offer', { offer, to: 'all' });
        socket.emit('screen-started');

        screenShareActive = true;
        screenSharerId = socket.id;

        screenStream.getVideoTracks()[0].onended = () => toggleScreenShare();
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

// ==================== JOIN SCREEN SHARE ====================
function joinScreenShare(sharerId) {
    if (!sharerId || sharerId === socket.id) return;
    if (screenPC) screenPC.close();

    screenPC = new RTCPeerConnection(iceConfig);
    screenPC.ontrack = (event) => {
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = event.streams[0];
        updateStatus('Viewing screen');
    };

    screenPC.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('screen-ice-candidate', {
                candidate: event.candidate,
                targetId: sharerId
            });
        }
    };

    screenPC.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        .then(offer => screenPC.setLocalDescription(offer))
        .then(() => {
            socket.emit('screen-offer', { offer: screenPC.localDescription, to: sharerId });
        })
        .catch(err => console.error('Join screen error:', err));
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

// ==================== SWITCH CAMERA ====================
async function switchCamera() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (tracks.length === 0) return;
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    const constraints = {
        video: { facingMode: newFacingMode, ...videoConstraints },
        audio: true
    };
    try {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        document.getElementById('localVideo').srcObject = newStream;
        if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(newStream.getVideoTracks()[0]);
        }
        localStream.getTracks().forEach(t => t.stop());
        localStream = newStream;
        currentFacingMode = newFacingMode;
    } catch (err) {
        console.error('Camera switch failed:', err);
    }
}

// ==================== COPY INVITE LINK ====================
function copyInviteLink() {
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
    } else {
        prompt('Copy this link:', url);
    }
}

// ==================== FULLSCREEN ====================
function toggleFullscreen() {
    const remoteVideo = document.getElementById('remoteVideo');
    if (!remoteVideo) return;
    if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
    else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
    else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
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
    document.getElementById('quality-indicator').className = 'quality-badge';
}

// ==================== CHAT ====================
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat-message', { message: msg });
    input.value = '';
}

function addChatMessage(user, message, time) {
    const chatDiv = document.getElementById('messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.innerHTML = `<strong>${user}</strong> ${message} <small>${time}</small>`;
    chatDiv.appendChild(msgDiv);
    chatDiv.scrollTop = chatDiv.scrollHeight;
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
                const callType = confirm(`Call ${user.name} with video? OK = Video, Cancel = Audio`);
                callUser(user.id, user.name, callType);
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
        const callType = confirm(`Call ${data.username} with video? OK = Video, Cancel = Audio`);
        callUser(data.id, data.username, callType);
    };
    listDiv.appendChild(div);
});

socket.on('user-left', (data) => {
    const items = document.getElementById('users-list').children;
    for (let item of items) {
        if (item.textContent === data.username) {
            item.remove();
            break;
        }
    }
    if (data.id === remoteUserId) hangUp();
});

socket.on('offer', (data) => {
    if (data.from === socket.id) return;
    if (callActive) return;
    pendingOffer = data;
    const callerItem = Array.from(document.getElementById('users-list').children).find(
        item => item.onclick && item.onclick.toString().includes(data.from)
    );
    const callerName = callerItem ? callerItem.textContent : 'Someone';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('incoming-call').style.display = 'block';
});

socket.on('answer', async (data) => {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

socket.on('call-rejected', (data) => {
    if (data.from === remoteUserId) {
        hangUp();
        updateStatus('Call rejected');
        alert('Call was rejected.');
    }
});

// Screen share signaling
socket.on('screen-offer', async (data) => {
    if (data.from === socket.id) return;
    if (screenShareActive && screenPC) {
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    } else if (screenPC) {
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    }
});

socket.on('screen-answer', async (data) => {
    if (!screenPC) return;
    await screenPC.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('screen-ice-candidate', async (data) => {
    if (!screenPC) return;
    try {
        await screenPC.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding screen ICE candidate:', err);
    }
});

socket.on('screen-available', (data) => {
    screenSharerId = data.sharer;
    if (confirm(`${data.username} started screen sharing. Join?`)) {
        joinScreenShare(data.sharer);
    }
});

socket.on('screen-unavailable', () => {
    screenSharerId = null;
    if (screenPC) screenPC.close();
    screenPC = null;
    document.getElementById('remoteVideo').srcObject = null;
    updateStatus('Screen share ended');
});

// Chat messages
socket.on('chat-message', (data) => {
    addChatMessage(data.user, data.message, data.time);
});

// Enter key for chat
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});