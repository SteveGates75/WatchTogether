// ==================== CONFIG ====================
const socket = io();
let username = '';
let localStream = null;
let pc = null;           // for audio/video calls
let screenPC = null;     // for screen share
let screenSharerId = null;
let isVideoCallActive = false;
let isAudioCallActive = false;
let isScreenSharing = false;

// Multiple STUN servers for faster ICE gathering
const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.ekiga.net' },
    { urls: 'stun:stun.ideasip.com' }
];
const config = { iceServers };

// ==================== UTILS ====================
function addSystemMessage(msg) {
    const div = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = msg;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
}

function updateStatus(id, text, state = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'status-badge';
    if (state) el.classList.add(state);
}

// ==================== LOGIN ====================
function login() {
    username = document.getElementById('username').value.trim();
    if (!username) return alert('Enter name');
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    socket.emit('join', username);
    addSystemMessage(`You joined as ${username}`);

    // Request media
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
            updateStatus('device-status', 'Camera & Mic OK', 'connected');
        })
        .catch(err => {
            console.warn('Camera error, falling back to audio', err);
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    localStream = stream;
                    updateStatus('device-status', 'Mic OK', 'connected');
                })
                .catch(err2 => {
                    console.error('No media devices', err2);
                    updateStatus('device-status', 'No devices', 'error');
                });
        });
}

// ==================== CHAT ====================
function sendMessage() {
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('send-message', { message: msg });
    input.value = '';
}

// ==================== PEER CONNECTION FACTORY ====================
function createPeerConnection(isScreen = false) {
    const pc = new RTCPeerConnection(config);

    // Add local tracks if we have a stream and it's not screen share (screen tracks added separately)
    if (localStream && !isScreen) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        if (isScreen) {
            const screenVideo = document.getElementById('screen-video');
            screenVideo.srcObject = event.streams[0];
            document.getElementById('screen-share-box').style.display = 'block';
        } else {
            const remoteVideo = document.getElementById('remote-video');
            remoteVideo.srcObject = event.streams[0];
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            if (isScreen) {
                socket.emit('screen-ice-candidate', { candidate: event.candidate, to: 'all' });
            } else {
                socket.emit('ice-candidate', { candidate: event.candidate, to: 'all' });
            }
        }
    };

    // Log connection state for debugging
    pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            if (!isScreen) {
                updateStatus('call-status', 'Connected', 'connected');
            }
        } else if (pc.iceConnectionState === 'failed') {
            console.error('ICE failed');
            if (!isScreen) {
                updateStatus('call-status', 'Failed', 'error');
            }
        }
    };

    return pc;
}

// ==================== VIDEO CALL ====================
async function toggleVideoCall() {
    if (!localStream) return alert('No camera/mic');
    const btn = document.getElementById('video-call-btn');

    if (isVideoCallActive) {
        // End call
        if (pc) pc.close();
        pc = null;
        isVideoCallActive = false;
        btn.classList.remove('active');
        document.getElementById('remote-video').srcObject = null;
        updateStatus('call-status', 'Call ended', '');
        addSystemMessage('Video call ended');
        return;
    }

    // If audio call active, end it first
    if (isAudioCallActive) {
        if (pc) pc.close();
        pc = null;
        isAudioCallActive = false;
        document.getElementById('audio-call-btn').classList.remove('active');
    }

    try {
        btn.classList.add('active');
        updateStatus('call-status', 'Connecting...', 'connecting');
        addSystemMessage('Starting video call...');

        pc = createPeerConnection(false);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Broadcast offer
        socket.emit('offer', { offer, to: 'all' });

        isVideoCallActive = true;
    } catch (err) {
        console.error('Video call error:', err);
        updateStatus('call-status', 'Failed', 'error');
        btn.classList.remove('active');
    }
}

// ==================== AUDIO CALL ====================
async function toggleAudioCall() {
    if (!localStream) return alert('No microphone');
    const btn = document.getElementById('audio-call-btn');

    if (isAudioCallActive) {
        if (pc) pc.close();
        pc = null;
        isAudioCallActive = false;
        btn.classList.remove('active');
        updateStatus('call-status', 'Call ended', '');
        addSystemMessage('Audio call ended');
        return;
    }

    if (isVideoCallActive) {
        if (pc) pc.close();
        pc = null;
        isVideoCallActive = false;
        document.getElementById('video-call-btn').classList.remove('active');
    }

    try {
        btn.classList.add('active');
        updateStatus('call-status', 'Connecting...', 'connecting');
        addSystemMessage('Starting audio call...');

        pc = createPeerConnection(false);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('offer', { offer, to: 'all' });

        isAudioCallActive = true;
    } catch (err) {
        console.error('Audio call error:', err);
        updateStatus('call-status', 'Failed', 'error');
        btn.classList.remove('active');
    }
}

// ==================== SCREEN SHARE ====================
async function toggleScreenShare() {
    const btn = document.getElementById('screen-share-btn');

    if (isScreenSharing) {
        // Stop sharing
        if (screenPC) screenPC.close();
        screenPC = null;
        if (window.screenStream) {
            window.screenStream.getTracks().forEach(t => t.stop());
        }
        isScreenSharing = false;
        btn.classList.remove('sharing');
        socket.emit('screen-stopped');
        addSystemMessage('You stopped sharing screen');
        return;
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });
        window.screenStream = screenStream; // save for stop

        btn.classList.add('sharing');
        addSystemMessage('You are sharing screen');

        screenPC = createPeerConnection(true);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));

        const offer = await screenPC.createOffer();
        await screenPC.setLocalDescription(offer);

        socket.emit('screen-offer', { offer, to: 'all' });
        socket.emit('screen-started');

        isScreenSharing = true;

        screenStream.getVideoTracks()[0].onended = () => toggleScreenShare();
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

// ==================== JOIN SCREEN SHARE ====================
function joinScreenShare() {
    if (!screenSharerId || screenSharerId === socket.id) return;

    if (screenPC) screenPC.close();
    screenPC = new RTCPeerConnection(config);
    screenPC.ontrack = (event) => {
        const screenVideo = document.getElementById('screen-video');
        screenVideo.srcObject = event.streams[0];
        document.getElementById('screen-share-box').style.display = 'block';
        updateStatus('screen-status', 'Viewing', 'connected');
        addSystemMessage('Connected to screen share');
    };

    screenPC.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('screen-ice-candidate', { candidate: event.candidate, to: screenSharerId });
        }
    };

    screenPC.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        .then(offer => screenPC.setLocalDescription(offer))
        .then(() => {
            socket.emit('screen-offer', { offer: screenPC.localDescription, to: screenSharerId });
        })
        .catch(err => {
            console.error('Error joining screen share:', err);
            updateStatus('screen-status', 'Failed', 'error');
        });

    updateStatus('screen-status', 'Connecting...', 'connecting');
    addSystemMessage('Connecting to screen share...');
}

// ==================== FULLSCREEN ====================
function showFullscreen(videoElement) {
    const container = document.getElementById('fullscreen-video');
    const player = document.getElementById('fullscreen-video-player');
    player.srcObject = videoElement.srcObject;
    container.classList.add('active');
    player.play();
}
function exitFullscreen() {
    document.getElementById('fullscreen-video').classList.remove('active');
}

// ==================== SOCKET HANDLERS ====================
socket.on('new-message', (data) => {
    const div = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message';
    el.innerHTML = `<strong>${data.user}</strong> ${data.message} <small>${data.time}</small>`;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
});

socket.on('user-joined', (msg) => addSystemMessage(msg));
socket.on('user-left', (msg) => addSystemMessage(msg));

// Video/audio call signaling
socket.on('offer', async (data) => {
    if (data.from === socket.id) return;
    console.log('Received offer from', data.from);

    if (!pc) {
        pc = createPeerConnection(false);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', { answer, to: data.from });
});

socket.on('answer', async (data) => {
    if (data.from === socket.id || !pc) return;
    console.log('Received answer from', data.from);
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (data.from === socket.id || !pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Screen share signaling
socket.on('screen-offer', async (data) => {
    if (data.from === socket.id) return;

    if (isScreenSharing && screenPC) {
        // We are the sharer, answer this viewer
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    } else if (screenPC) {
        // We are a viewer, answer the sharer
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    }
});

socket.on('screen-answer', async (data) => {
    if (data.from === socket.id || !screenPC) return;
    await screenPC.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('screen-ice-candidate', async (data) => {
    if (data.from === socket.id || !screenPC) return;
    try {
        await screenPC.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding screen ICE:', err);
    }
});

socket.on('screen-available', (data) => {
    screenSharerId = data.sharer;
    document.getElementById('join-screen-btn').classList.add('active');
    addSystemMessage(`📺 ${data.username} is sharing screen. Click "Join" to watch.`);
});

socket.on('screen-unavailable', () => {
    screenSharerId = null;
    document.getElementById('join-screen-btn').classList.remove('active');
    document.getElementById('screen-share-box').style.display = 'none';
    document.getElementById('screen-video').srcObject = null;
    addSystemMessage('📺 Screen sharing ended');
});

// Enter key for chat
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});