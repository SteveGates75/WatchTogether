// ==================== CONFIGURATION ====================
const socket = io();
let username = '';
let localStream = null;
let pc = null;           // PeerConnection for calls
let screenPC = null;     // PeerConnection for screen share
let screenSharerId = null; // Socket ID of the person sharing screen
let callActive = false;  // Is there an active audio/video call?
let callType = null;     // 'audio' or 'video'
let screenShareActive = false;

// Multiple STUN servers for faster NAT traversal
const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// ==================== UTILITY FUNCTIONS ====================
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
    if (!username) return alert('Enter your name');
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    socket.emit('join', username);
    addSystemMessage(`You joined as ${username}`);

    // Request camera and microphone
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('local-video').srcObject = stream;
            updateStatus('device-status', 'Camera & Mic OK', 'connected');
        })
        .catch(err => {
            console.warn('Camera error, falling back to audio only', err);
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
    const pc = new RTCPeerConnection(iceConfig);

    // When remote adds tracks
    pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        if (isScreen) {
            const screenVideo = document.getElementById('screen-video');
            screenVideo.srcObject = event.streams[0];
            document.getElementById('screen-share-box').style.display = 'block';
            updateStatus('screen-status', 'Viewing', 'connected');
        } else {
            const remoteVideo = document.getElementById('remote-video');
            remoteVideo.srcObject = event.streams[0];
            // For audio-only calls, also create an audio element to guarantee playback
            if (callType === 'audio') {
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
            }
            updateStatus('call-status', 'Connected', 'connected');
            addSystemMessage('Call connected');
        }
    };

    // Send ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            if (isScreen) {
                socket.emit('screen-ice-candidate', { candidate: event.candidate, to: screenSharerId || 'all' });
            } else {
                socket.emit('ice-candidate', { candidate: event.candidate, to: 'all' });
            }
        }
    };

    // Debug connection state
    pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
            console.warn('ICE failed, attempting restart');
            pc.restartIce();
        }
    };

    return pc;
}

// ==================== VIDEO CALL ====================
async function toggleVideoCall() {
    if (!localStream) return alert('Camera/mic not available');
    const btn = document.getElementById('video-call-btn');

    // If already in a video call, hang up
    if (callActive && callType === 'video') {
        if (pc) pc.close();
        pc = null;
        callActive = false;
        callType = null;
        btn.classList.remove('active');
        document.getElementById('remote-video').srcObject = null;
        updateStatus('call-status', 'Call ended', '');
        addSystemMessage('Video call ended');
        return;
    }

    // If another call type is active, close it first
    if (callActive) {
        if (pc) pc.close();
        pc = null;
        document.getElementById('audio-call-btn').classList.remove('active');
        document.getElementById('video-call-btn').classList.remove('active');
        document.getElementById('remote-video').srcObject = null;
        callActive = false;
    }

    try {
        btn.classList.add('active');
        updateStatus('call-status', 'Connecting...', 'connecting');
        addSystemMessage('Starting video call...');

        callType = 'video';
        callActive = true;
        pc = createPeerConnection(false);

        // Add local tracks
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Broadcast offer
        socket.emit('offer', { offer, to: 'all' });
    } catch (err) {
        console.error('Video call error:', err);
        updateStatus('call-status', 'Failed', 'error');
        btn.classList.remove('active');
        callActive = false;
        callType = null;
    }
}

// ==================== AUDIO CALL ====================
async function toggleAudioCall() {
    if (!localStream) return alert('Microphone not available');
    const btn = document.getElementById('audio-call-btn');

    if (callActive && callType === 'audio') {
        if (pc) pc.close();
        pc = null;
        callActive = false;
        callType = null;
        btn.classList.remove('active');
        updateStatus('call-status', 'Call ended', '');
        addSystemMessage('Audio call ended');
        return;
    }

    if (callActive) {
        if (pc) pc.close();
        pc = null;
        document.getElementById('video-call-btn').classList.remove('active');
        document.getElementById('audio-call-btn').classList.remove('active');
        document.getElementById('remote-video').srcObject = null;
        callActive = false;
    }

    try {
        btn.classList.add('active');
        updateStatus('call-status', 'Connecting...', 'connecting');
        addSystemMessage('Starting audio call...');

        callType = 'audio';
        callActive = true;
        pc = createPeerConnection(false);

        // Add only audio tracks
        localStream.getAudioTracks().forEach(track => pc.addTrack(track, localStream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('offer', { offer, to: 'all' });
    } catch (err) {
        console.error('Audio call error:', err);
        updateStatus('call-status', 'Failed', 'error');
        btn.classList.remove('active');
        callActive = false;
        callType = null;
    }
}

// ==================== SCREEN SHARE ====================
async function toggleScreenShare() {
    const btn = document.getElementById('screen-share-btn');

    if (screenShareActive) {
        // Stop sharing
        if (screenPC) screenPC.close();
        screenPC = null;
        if (window.screenStream) {
            window.screenStream.getTracks().forEach(t => t.stop());
        }
        screenShareActive = false;
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
        window.screenStream = screenStream;

        btn.classList.add('sharing');
        addSystemMessage('You are sharing screen');

        screenPC = createPeerConnection(true);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));

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

// ==================== JOIN SCREEN SHARE ====================
function joinScreenShare() {
    if (!screenSharerId || screenSharerId === socket.id) return;

    if (screenPC) screenPC.close();
    screenPC = new RTCPeerConnection(iceConfig);
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

// ==================== SOCKET EVENT HANDLERS ====================

// Chat messages
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

// Call signaling
socket.on('offer', async (data) => {
    if (data.from === socket.id) return;
    console.log('Received offer from', data.from);

    // If we are already in a call, ignore new offers (or you could accept multiple, but we keep it simple)
    if (callActive) {
        console.log('Already in a call, ignoring offer');
        return;
    }

    // Create peer connection and add local tracks
    pc = createPeerConnection(false);
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', { answer, to: data.from });

    callActive = true;
    // We don't know callType yet, but we'll set it when we receive tracks
    updateStatus('call-status', 'Connecting...', 'connecting');
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

    if (screenShareActive && screenPC) {
        // We are the sharer, answer this viewer
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    } else if (screenPC) {
        // We are a viewer answering the sharer (from joinScreenShare)
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
        console.error('Error adding screen ICE candidate:', err);
    }
});

// Screen share availability
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