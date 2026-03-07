// ==================== CONFIG ====================
const socket = io();

let username = '';
let localStream = null;
let pc = null; // main peer connection for audio/video calls
let screenPC = null; // separate peer connection for screen sharing
let screenSharerId = null; // socket id of the person sharing screen

let isVideoCallActive = false;
let isAudioCallActive = false;
let isScreenSharing = false;
let isViewingScreen = false;

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// ==================== UTILS ====================
function addSystemMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = msg;
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

    // Request camera & microphone
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
                    console.error('No microphone:', err2);
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

// ==================== PEER CONNECTION HELPERS ====================
function createPeerConnection(isScreen = false) {
    const pc = new RTCPeerConnection(config);

    // Add local tracks if we have a stream
    if (localStream && !isScreen) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    // When remote adds tracks
    pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        const remoteVideo = document.getElementById('remote-video');
        if (event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // ICE candidate handling
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            const candidateData = {
                candidate: event.candidate,
                to: 'all' // we'll replace with actual target when sending
            };
            if (isScreen) {
                socket.emit('screen-ice-candidate', candidateData);
            } else {
                socket.emit('ice-candidate', candidateData);
            }
        }
    };

    // Log connection state
    pc.onconnectionstatechange = () => {
        console.log('PC connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            updateStatus('call-status', 'Connected', 'connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            if (!isScreen) {
                isVideoCallActive = false;
                isAudioCallActive = false;
                document.getElementById('video-call-btn').classList.remove('active');
                document.getElementById('audio-call-btn').classList.remove('active');
                updateStatus('call-status', 'Disconnected', 'error');
            }
        }
    };

    return pc;
}

// ==================== VIDEO CALL ====================
async function toggleVideoCall() {
    if (!localStream) return alert('No camera/mic available');

    if (isVideoCallActive) {
        // End call
        if (pc) pc.close();
        pc = null;
        isVideoCallActive = false;
        document.getElementById('video-call-btn').classList.remove('active');
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
        document.getElementById('video-call-btn').classList.add('active');
        updateStatus('call-status', 'Connecting...', 'connecting');
        addSystemMessage('Starting video call...');

        pc = createPeerConnection(false);

        // Create offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Broadcast offer
        socket.emit('offer', { offer, to: 'all' });

        isVideoCallActive = true;
    } catch (err) {
        console.error('Video call error:', err);
        updateStatus('call-status', 'Failed', 'error');
        document.getElementById('video-call-btn').classList.remove('active');
    }
}

// ==================== AUDIO CALL ====================
async function toggleAudioCall() {
    if (!localStream) return alert('No microphone available');

    if (isAudioCallActive) {
        if (pc) pc.close();
        pc = null;
        isAudioCallActive = false;
        document.getElementById('audio-call-btn').classList.remove('active');
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
        document.getElementById('audio-call-btn').classList.add('active');
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
        document.getElementById('audio-call-btn').classList.remove('active');
    }
}

// ==================== SCREEN SHARE ====================
async function toggleScreenShare() {
    if (isScreenSharing) {
        // Stop sharing
        if (screenPC) screenPC.close();
        screenPC = null;
        if (screenStream) {
            screenStream.getTracks().forEach(t => t.stop());
        }
        isScreenSharing = false;
        document.getElementById('screen-share-btn').classList.remove('sharing');
        socket.emit('screen-stopped');
        addSystemMessage('You stopped sharing screen');
        return;
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        document.getElementById('screen-share-btn').classList.add('sharing');
        addSystemMessage('You are sharing screen');

        screenPC = createPeerConnection(true);
        screenStream.getTracks().forEach(track => screenPC.addTrack(track, screenStream));

        const offer = await screenPC.createOffer();
        await screenPC.setLocalDescription(offer);

        socket.emit('screen-offer', { offer, to: 'all' });
        socket.emit('screen-started');

        isScreenSharing = true;

        // When user stops via browser UI
        screenStream.getVideoTracks()[0].onended = () => {
            toggleScreenShare();
        };
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

// Join screen share (view)
function joinScreenShare() {
    if (!screenSharerId || screenSharerId === socket.id) return;

    if (isViewingScreen) {
        if (screenPC) screenPC.close();
        screenPC = null;
        document.getElementById('screen-share-box').style.display = 'none';
        document.getElementById('screen-video').srcObject = null;
    }

    addSystemMessage('Connecting to screen share...');
    updateStatus('screen-status', 'Connecting...', 'connecting');

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
            socket.emit('screen-ice-candidate', {
                candidate: event.candidate,
                to: screenSharerId
            });
        }
    };

    screenPC.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true })
        .then(offer => screenPC.setLocalDescription(offer))
        .then(() => {
            socket.emit('screen-offer', {
                offer: screenPC.localDescription,
                to: screenSharerId
            });
        })
        .catch(err => {
            console.error('Error joining screen share:', err);
            updateStatus('screen-status', 'Failed', 'error');
        });
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

// Chat
socket.on('new-message', (data) => {
    const messagesDiv = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message';
    el.innerHTML = `<strong>${data.user}</strong> ${data.message} <small>${data.time}</small>`;
    messagesDiv.appendChild(el);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

socket.on('user-joined', (msg) => addSystemMessage(msg));
socket.on('user-left', (msg) => addSystemMessage(msg));

// Video/audio call signaling
socket.on('offer', async (data) => {
    if (data.from === socket.id) return;

    console.log('Received offer from', data.from);

    // If we are already in a call, we need to handle properly.
    // For simplicity, we will create a new peer connection if none exists.
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

    // If we are the sharer, we need to answer.
    if (isScreenSharing && screenPC) {
        await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPC.createAnswer();
        await screenPC.setLocalDescription(answer);
        socket.emit('screen-answer', { answer, to: data.from });
    } else {
        // We are a viewer, we already have a screenPC created in joinScreenShare
        if (screenPC) {
            await screenPC.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await screenPC.createAnswer();
            await screenPC.setLocalDescription(answer);
            socket.emit('screen-answer', { answer, to: data.from });
        }
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
    addSystemMessage(`📺 ${data.username} started sharing screen. Click "Join" to watch.`);
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