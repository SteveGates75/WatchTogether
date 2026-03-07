// ==================== GLOBALS ====================
const socket = io();
let username = '';
let localStream = null;
let pc = null;           // main peer connection for audio/video calls
let screenPC = null;     // separate peer connection for screen share
let screenSharerId = null;
let callActive = false;  // true if any call (audio or video) is active
let callType = null;     // 'audio' or 'video'
let screenShareActive = false;

// ICE servers for faster connectivity
const iceServers = {
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

// ==================== PEER CONNECTION MANAGEMENT ====================
function createPeerConnection(isScreen = false) {
    const pc = new RTCPeerConnection(iceServers);

    // Add local tracks if we have a stream and it's not a screen share (screen tracks added separately)
    if (localStream && !isScreen && callActive) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        if (isScreen) {
            const screenVideo = document.getElementById('screen-video');
            screenVideo.srcObject = event.streams[0];
            document.getElementById('screen-share-box').style.display = 'block';
            updateStatus('screen-status', 'Viewing', 'connected');
        } else {
            // For audio/video calls
            const remoteVideo = document.getElementById('remote-video');
            remoteVideo.srcObject = event.streams[0];
            // If it's an audio-only call, we still show the video element (it will be black, but audio plays)
            // To ensure audio plays even if video element is hidden, we also create an audio element.
            if (callType === 'audio' && event.track.kind === 'audio') {
                // For audio-only, create a separate Audio element to guarantee playback
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                audio.play().catch(e => console.warn('Audio play failed:', e));
            }
            updateStatus('call-status', 'Connected', 'connected');
            addSystemMessage('Call connected');
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            if (isScreen) {
                socket.emit('screen-ice-candidate', { candidate: event.candidate, to: screenSharerId || 'all' });
            } else {
                // For regular calls, we need to know the target. We'll store the remote peer ID.
                // For simplicity, we broadcast ICE candidates and let the client ignore its own.
                socket.emit('ice-candidate', { candidate: event.candidate, to: 'all' });
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
            console.error('ICE failed, restarting...');
            pc.restartIce();
        }
    };

    return pc;
}

// ==================== VIDEO CALL ====================
async function toggleVideoCall() {
    if (!localStream) return alert('Camera/mic not available');
    const btn = document.getElementById('video-call-btn');

    if (callActive && callType === 'video') {
        // End call
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

        // Add local tracks (we already added them in createPeerConnection if callActive true, but ensure)
        // Actually createPeerConnection adds tracks only if callActive && localStream. So after setting callActive true, we need to add them.
        // Let's add them explicitly after pc creation.
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
    screenPC = new RTCPeerConnection(iceServers);
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

// Handle incoming offer
socket.on('offer', async (data) => {
    if (data.from === socket.id) return;
    console.log('Received offer from', data.from);

    // If we are already in a call, we may need to handle multiple offers.
    // For simplicity, if we have an active call, we ignore new offers.
    // But if we are not in a call, we accept.
    if (callActive) {
        console.log('Already in a call, ignoring offer');
        return;
    }

    // Create peer connection
    pc = createPeerConnection(false);
    // Add local tracks (if any) - but we only add if we are going to answer.
    // Actually we need to add them before setting remote description, because we will answer with our media.
    if (localStream) {
        // For video call, add all tracks; for audio only, we need to know the type from the offer?
        // We can just add all tracks we have; remote can handle.
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', { answer, to: data.from });

    // Mark call as active; we don't know if it's audio or video yet, but we'll set based on presence of video tracks?
    callActive = true;
    // We'll set callType later when we receive tracks.
    updateStatus('call-status', 'Connecting...', 'connecting');
});

// Handle answer
socket.on('answer', async (data) => {
    if (data.from === socket.id || !pc) return;
    console.log('Received answer from', data.from);
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

// Handle ICE candidate
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
        // We are a viewer, answer the sharer (this happens when we initiated join)
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