// ==================== GLOBALS ====================
const socket = io();

let username;
let localStream = null;
let pc = null;               // main peer connection for calls
let screenPC = null;         // peer connection for screen sharing
let remoteUserId = null;
let callActive = false;
let pendingOffer = null;
let screenSharerId = null;
let screenShareActive = false;

// UI elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localPlaceholder = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remotePlaceholder');
const muteAudioBtn = document.getElementById('muteAudioBtn');
const muteVideoBtn = document.getElementById('muteVideoBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');

let audioEnabled = true;
let videoEnabled = true;
let currentFacingMode = 'user';

// 1080p 60fps constraints
const videoConstraints = {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 60, max: 60 }
};

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
    updateStatus('Logged in. Click on a user to call.');
}

// ==================== UPDATE STATUS ====================
function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

// ==================== MEDIA HELPERS ====================
async function getLocalMedia(withVideo) {
    if (localStream) return localStream;
    try {
        const constraints = {
            audio: true,
            video: withVideo ? videoConstraints : false
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        localVideo.style.display = 'block';
        localPlaceholder.style.display = 'none';
        muteAudioBtn.disabled = false;
        if (withVideo) {
            muteVideoBtn.disabled = false;
            switchCameraBtn.disabled = false;
        }
        return localStream;
    } catch (err) {
        console.error('Media error:', err);
        alert('Could not access camera/microphone');
        throw err;
    }
}

function stopLocalMedia() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    localVideo.style.display = 'none';
    localPlaceholder.style.display = 'flex';
    muteAudioBtn.disabled = true;
    muteVideoBtn.disabled = true;
    switchCameraBtn.disabled = true;
}

// ==================== PEER CONNECTION ====================
function createPeerConnection(targetId, isScreen = false) {
    const pc = new RTCPeerConnection(iceConfig);

    // Add tracks if we have a stream (for non-screen connections)
    if (!isScreen && localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        // For screen share, we want to show it in remote video element
        // For call, also show in remote video
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.style.display = 'block';
        remotePlaceholder.style.display = 'none';
        updateStatus(isScreen ? 'Viewing screen' : 'Connected');
        if (!isScreen) callActive = true;
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const eventName = isScreen ? 'screen-ice-candidate' : 'ice-candidate';
            socket.emit(eventName, {
                candidate: event.candidate,
                targetId: targetId
            });
        }
    };

    // Connection state
    pc.oniceconnectionstatechange = () => {
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
async function callUser(targetId, targetName, withVideo) {
    if (callActive) {
        alert('Already in a call');
        return;
    }
    try {
        await getLocalMedia(withVideo);
    } catch {
        return;
    }

    remoteUserId = targetId;
    pc = createPeerConnection(remoteUserId, false);

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            socket.emit('offer', { offer: pc.localDescription, targetId: remoteUserId });
            updateStatus(`Calling ${targetName}...`);
        })
        .catch(err => console.error('Offer error:', err));
}

// ==================== ACCEPT CALL ====================
async function acceptCall() {
    if (!pendingOffer) return;
    document.getElementById('incoming-call').style.display = 'none';

    // Determine if video call by checking SDP for video line
    const isVideo = pendingOffer.offer.sdp.includes('m=video');
    try {
        await getLocalMedia(isVideo);
    } catch {
        return;
    }

    remoteUserId = pendingOffer.from;
    pc = createPeerConnection(remoteUserId, false);

    pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.offer))
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => {
            socket.emit('answer', { answer: pc.localDescription, targetId: remoteUserId });
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

// ==================== HANG UP ====================
function hangUp() {
    if (pc) {
        pc.close();
        pc = null;
    }
    // Stop screen share if active
    if (screenShareActive) {
        stopScreenShare();
    }
    stopLocalMedia();
    remoteVideo.srcObject = null;
    remoteVideo.style.display = 'none';
    remotePlaceholder.style.display = 'flex';
    callActive = false;
    remoteUserId = null;
    updateStatus('Call ended');
    document.getElementById('quality-indicator').className = 'quality-badge';
}

// ==================== SCREEN SHARE ====================
async function toggleScreenShare() {
    if (screenShareActive) {
        stopScreenShare();
        return;
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 60 },
            audio: true
        });

        document.getElementById('screenShareBtn').classList.add('active');
        screenPC = createPeerConnection('broadcast', true);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));

        const offer = await screenPC.createOffer();
        await screenPC.setLocalDescription(offer);

        socket.emit('screen-offer', { offer, to: 'all' });
        socket.emit('screen-started');

        screenShareActive = true;
        screenSharerId = socket.id;

        screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

function stopScreenShare() {
    if (screenPC) {
        screenPC.close();
        screenPC = null;
    }
    if (window.screenStream) {
        window.screenStream.getTracks().forEach(t => t.stop());
    }
    screenShareActive = false;
    document.getElementById('screenShareBtn').classList.remove('active');
    socket.emit('screen-stopped');
    // If not in a call, clear remote video
    if (!callActive) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
        remotePlaceholder.style.display = 'flex';
    }
}

// ==================== JOIN SCREEN SHARE ====================
function joinScreenShare(sharerId) {
    if (!sharerId || sharerId === socket.id) return;
    if (screenPC) screenPC.close();

    screenPC = new RTCPeerConnection(iceConfig);
    screenPC.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.style.display = 'block';
        remotePlaceholder.style.display = 'none';
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
    localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    muteAudioBtn.textContent = audioEnabled ? '🔊 Mute Mic' : '🔇 Unmute Mic';
    document.getElementById('localMuteIndicator').style.display = audioEnabled ? 'none' : 'block';
}

function toggleMuteVideo() {
    if (!localStream) return;
    videoEnabled = !videoEnabled;
    localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
    muteVideoBtn.textContent = videoEnabled ? '🎥 Hide Video' : '🎥 Show Video';
}

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
        localVideo.srcObject = newStream;
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

// ==================== FULLSCREEN ====================
function toggleFullscreen() {
    if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
    else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
    else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
}

// ==================== COPY LINK ====================
function copyInviteLink() {
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
    } else {
        prompt('Copy this link:', url);
    }
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
    if (data.from === socket.id || callActive) return;
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

// Screen share
socket.on('screen-offer', async (data) => {
    if (data.from === socket.id) return;
    if (screenShareActive && screenPC) {
        // We are the sharer, answer this viewer
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    } else if (screenPC) {
        // We are a viewer answering the sharer
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
    if (screenPC) {
        screenPC.close();
        screenPC = null;
    }
    if (!callActive) {
        remoteVideo.srcObject = null;
        remoteVideo.style.display = 'none';
        remotePlaceholder.style.display = 'flex';
    }
    updateStatus('Screen share ended');
});

// Chat
socket.on('chat-message', (data) => {
    addChatMessage(data.user, data.message, data.time);
});

// Enter key
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// ==================== VIDEO/AUDIO BUTTONS (just wrappers) ====================
function toggleVideoCall() {
    if (callActive) {
        hangUp();
        return;
    }
    alert('Click on a user in the sidebar to start a video call.');
}

function toggleAudioCall() {
    if (callActive) {
        hangUp();
        return;
    }
    alert('Click on a user in the sidebar to start an audio call.');
}