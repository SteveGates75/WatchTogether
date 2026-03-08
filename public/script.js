const socket = io();

let localStream;
let pc;                // peer connection for calls
let screenPC;           // peer connection for screen share
let username;
let remoteUserId = null;
let callActive = false;
let pendingOffer = null;
let screenSharerId = null;
let screenShareActive = false;
let hasMedia = false;
let audioEnabled = true;
let videoEnabled = true;
let currentFacingMode = 'user';

const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const videoConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 }
};

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localPlaceholder = document.getElementById('localPlaceholder');
const remotePlaceholder = document.getElementById('remotePlaceholder');

function login() {
    username = document.getElementById('username').value.trim();
    if (!username) return alert('Enter name');
    socket.emit('join', username);
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    updateStatus('Logged in');
}

function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

async function getLocalMedia(withVideo) {
    if (hasMedia) return localStream;
    try {
        const constraints = { audio: true, video: withVideo ? videoConstraints : false };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        hasMedia = true;
        localVideo.style.display = 'block';
        localPlaceholder.style.display = 'none';
        localVideo.srcObject = localStream;
        document.getElementById('muteAudioBtn').disabled = false;
        if (withVideo) {
            document.getElementById('muteVideoBtn').disabled = false;
            document.getElementById('switchCameraBtn').disabled = false;
        }
        return localStream;
    } catch (err) {
        alert('Media error: ' + err.message);
        throw err;
    }
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(iceConfig);
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    pc.ontrack = (event) => {
        remoteVideo.style.display = 'block';
        remotePlaceholder.style.display = 'none';
        remoteVideo.srcObject = event.streams[0];
        updateStatus('Connected');
        callActive = true;
    };
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { candidate: event.candidate, targetId });
        }
    };
    pc.oniceconnectionstatechange = () => {
        const indicator = document.getElementById('quality-indicator');
        if (pc.iceConnectionState === 'connected') indicator.className = 'quality-badge quality-good';
        else if (pc.iceConnectionState === 'disconnected') indicator.className = 'quality-badge quality-poor';
        else if (pc.iceConnectionState === 'failed') indicator.className = 'quality-badge quality-bad';
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            updateStatus('Disconnected');
            callActive = false;
        }
    };
    return pc;
}

async function callUser(targetId, targetName, withVideo) {
    if (callActive) return alert('Already in a call');
    try {
        await getLocalMedia(withVideo);
    } catch { return; }
    remoteUserId = targetId;
    pc = createPeerConnection(remoteUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { offer, targetId: remoteUserId });
    updateStatus(`Calling ${targetName}...`);
}

function acceptCall() {
    if (!pendingOffer) return;
    document.getElementById('incoming-call').style.display = 'none';
    const hasVideo = pendingOffer.offer.sdp.includes('m=video');
    getLocalMedia(hasVideo).then(() => {
        remoteUserId = pendingOffer.from;
        pc = createPeerConnection(remoteUserId);
        pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.offer))
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => {
                socket.emit('answer', { answer: pc.localDescription, targetId: remoteUserId });
                updateStatus('Connecting...');
            });
    }).catch(() => {});
    pendingOffer = null;
}

function rejectCall() {
    document.getElementById('incoming-call').style.display = 'none';
    socket.emit('call-rejected', { targetId: pendingOffer.from });
    pendingOffer = null;
}

function toggleVideoCall() {
    if (callActive) hangUp();
    else alert('Click a user to start video call');
}

function toggleAudioCall() {
    if (callActive) hangUp();
    else alert('Click a user to start audio call');
}

async function toggleScreenShare() {
    if (screenShareActive) {
        if (screenPC) screenPC.close();
        if (window.screenStream) window.screenStream.getTracks().forEach(t => t.stop());
        screenShareActive = false;
        document.getElementById('screenShareBtn').classList.remove('active');
        socket.emit('screen-stopped');
        return;
    }
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 30 },
            audio: true
        });
        window.screenStream = screenStream;
        document.getElementById('screenShareBtn').classList.add('active');
        screenPC = new RTCPeerConnection(iceConfig);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));
        screenPC.onicecandidate = (event) => {
            if (event.candidate) socket.emit('screen-ice-candidate', { candidate: event.candidate, to: 'broadcast' });
        };
        const offer = await screenPC.createOffer();
        await screenPC.setLocalDescription(offer);
        socket.emit('screen-offer', { offer, to: 'all' });
        socket.emit('screen-started');
        screenShareActive = true;
        screenStream.getVideoTracks()[0].onended = () => toggleScreenShare();
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

function joinScreenShare(sharerId) {
    if (!sharerId || sharerId === socket.id) return;
    if (screenPC) screenPC.close();
    screenPC = new RTCPeerConnection(iceConfig);
    screenPC.ontrack = (event) => {
        remoteVideo.style.display = 'block';
        remotePlaceholder.style.display = 'none';
        remoteVideo.srcObject = event.streams[0];
        updateStatus('Viewing screen');
    };
    screenPC.onicecandidate = (event) => {
        if (event.candidate) socket.emit('screen-ice-candidate', { candidate: event.candidate, to: sharerId });
    };
    screenPC.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        .then(offer => screenPC.setLocalDescription(offer))
        .then(() => socket.emit('screen-offer', { offer: screenPC.localDescription, to: sharerId }));
}

function toggleMuteAudio() {
    if (!localStream) return;
    audioEnabled = !audioEnabled;
    localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    document.getElementById('muteAudioBtn').textContent = audioEnabled ? '🔊 Mute Mic' : '🔇 Unmute Mic';
    document.getElementById('localMuteIndicator').style.display = audioEnabled ? 'none' : 'block';
}

function toggleMuteVideo() {
    if (!localStream) return;
    videoEnabled = !videoEnabled;
    localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
    document.getElementById('muteVideoBtn').textContent = videoEnabled ? '🎥 Hide Video' : '🎥 Show Video';
}

async function switchCamera() {
    if (!localStream) return;
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    const constraints = { video: { facingMode: newFacingMode, ...videoConstraints }, audio: true };
    try {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = newStream;
        if (pc) {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(newStream.getVideoTracks()[0]);
        }
        localStream.getTracks().forEach(t => t.stop());
        localStream = newStream;
        currentFacingMode = newFacingMode;
    } catch (err) {
        console.error('Camera switch failed:', err);
    }
}

function copyInviteLink() {
    const url = window.location.href;
    navigator.clipboard?.writeText(url).then(() => alert('Link copied!')).catch(() => prompt('Copy manually:', url));
}

function toggleFullscreen() {
    if (remoteVideo.requestFullscreen) remoteVideo.requestFullscreen();
    else if (remoteVideo.webkitRequestFullscreen) remoteVideo.webkitRequestFullscreen();
    else if (remoteVideo.msRequestFullscreen) remoteVideo.msRequestFullscreen();
}

function hangUp() {
    if (pc) pc.close();
    if (screenShareActive) toggleScreenShare();
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
        hasMedia = false;
    }
    localVideo.style.display = 'none';
    remoteVideo.style.display = 'none';
    localPlaceholder.style.display = 'flex';
    remotePlaceholder.style.display = 'flex';
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    document.getElementById('muteAudioBtn').disabled = true;
    document.getElementById('muteVideoBtn').disabled = true;
    document.getElementById('switchCameraBtn').disabled = true;
    callActive = false;
    remoteUserId = null;
    updateStatus('Call ended');
    document.getElementById('quality-indicator').className = 'quality-badge';
}

function sendChatMessage() {
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

// Socket events
socket.on('user-list', (users) => {
    const list = document.getElementById('users-list');
    list.innerHTML = '';
    users.forEach(u => {
        if (u.id !== socket.id) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = u.name;
            div.onclick = () => {
                const withVideo = confirm(`Call ${u.name} with video? OK = Video, Cancel = Audio`);
                callUser(u.id, u.name, withVideo);
            };
            list.appendChild(div);
        }
    });
});

socket.on('user-joined', (data) => {
    const list = document.getElementById('users-list');
    const div = document.createElement('div');
    div.className = 'user-item';
    div.textContent = data.username;
    div.onclick = () => {
        const withVideo = confirm(`Call ${data.username} with video? OK = Video, Cancel = Audio`);
        callUser(data.id, data.username, withVideo);
    };
    list.appendChild(div);
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
    const callerName = Array.from(document.getElementById('users-list').children).find(
        item => item.onclick?.toString().includes(data.from)
    )?.textContent || 'Someone';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('incoming-call').style.display = 'block';
});

socket.on('answer', async (data) => {
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
});

socket.on('call-rejected', (data) => {
    if (data.from === remoteUserId) {
        hangUp();
        alert('Call rejected');
    }
});

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
    try { await screenPC.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
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
});

socket.on('chat-message', (data) => addChatMessage(data.user, data.message, data.time));

document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});