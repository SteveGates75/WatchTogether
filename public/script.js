// public/script.js
const socket = io({
    transports: ['websocket', 'polling']
});

let username = '';
let localStream;
let peerConnection;
let screenPeerConnection;
let currentRoom = 'main-room';
let isCallActive = false;
let isScreenSharing = false;
let audioContext;
let localAudio;
let isFullscreen = false;
let screenShareActive = false;
let currentScreenSharer = null;
let isViewingScreen = false;
let pendingIceCandidates = [];
let screenStream = null;

// Audio constraints
const audioConstraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
    }
};

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Login
function login() {
    username = document.getElementById('username-input').value.trim();
    
    if (!username) {
        alert('Please enter your name');
        return;
    }
    
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    
    socket.emit('join', username);
    
    addSystemMessage(`You joined as ${username}`);
    setupAudio();
}

// Setup audio
async function setupAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        console.log('✅ Microphone ready');
        updateStatus('call-status', '🎤 Mic ready', 'connected');
        
        localAudio = document.createElement('audio');
        localAudio.srcObject = localStream;
        localAudio.muted = true;
        localAudio.autoplay = true;
        document.body.appendChild(localAudio);
        
    } catch (err) {
        console.error('❌ Microphone error:', err);
        updateStatus('call-status', '❌ Mic error', 'error');
    }
}

// Send message
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('send-message', { message });
        input.value = '';
    }
}

// Toggle audio call
async function toggleCall() {
    const callBtn = document.getElementById('callBtn');
    
    if (!localStream) return;
    
    if (isCallActive) {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        isCallActive = false;
        callBtn.classList.remove('active');
        updateStatus('call-status', 'Call ended', '');
    } else {
        try {
            callBtn.classList.add('active');
            updateStatus('call-status', 'Connecting...', 'connecting');
            
            peerConnection = new RTCPeerConnection(configuration);
            
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            peerConnection.ontrack = (event) => {
                const remoteAudio = new Audio();
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.autoplay = true;
                remoteAudio.id = 'remote-audio';
                document.body.appendChild(remoteAudio);
                updateStatus('call-status', 'Connected', 'connected');
            };
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        candidate: event.candidate,
                        target: currentRoom
                    });
                }
            };
            
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('offer', { offer, target: currentRoom });
            
            isCallActive = true;
            
        } catch (err) {
            console.error('Call error:', err);
            updateStatus('call-status', 'Call failed', 'error');
            callBtn.classList.remove('active');
        }
    }
}

// ============= SCREEN SHARING - FIXED =============

// Toggle screen share
async function toggleScreenShare() {
    const screenBtn = document.getElementById('screenBtn');
    
    if (isScreenSharing) {
        stopScreenShare();
    } else {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            
            screenBtn.classList.add('sharing');
            updateStatus('screen-status', 'Sharing screen', 'connected');
            
            // Create peer connection
            screenPeerConnection = new RTCPeerConnection(configuration);
            
            // Add tracks
            screenStream.getTracks().forEach(track => {
                screenPeerConnection.addTrack(track, screenStream);
            });
            
            // Handle ICE candidates
            screenPeerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('screen-ice-candidate', {
                        candidate: event.candidate,
                        target: currentRoom
                    });
                }
            };
            
            // Create offer
            const offer = await screenPeerConnection.createOffer();
            await screenPeerConnection.setLocalDescription(offer);
            
            // Notify everyone
            socket.emit('screen-sharing-started', {
                sharer: socket.id,
                username: username,
                offer: offer
            });
            
            isScreenSharing = true;
            screenShareActive = true;
            currentScreenSharer = socket.id;
            
            addSystemMessage(`📺 You started sharing screen`);
            
            // Handle stop
            screenStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
            
        } catch (err) {
            console.error('Screen share error:', err);
            screenBtn.classList.remove('sharing');
        }
    }
}

// Stop screen share
function stopScreenShare() {
    if (screenPeerConnection) {
        screenPeerConnection.close();
        screenPeerConnection = null;
    }
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    screenShareActive = false;
    currentScreenSharer = null;
    document.getElementById('screenBtn').classList.remove('sharing');
    document.getElementById('joinVideoBtn').classList.remove('active');
    updateStatus('screen-status', '', '');
    
    socket.emit('screen-sharing-stopped');
    addSystemMessage('Screen sharing stopped');
}

// Join video - FIXED
async function joinVideo() {
    if (!screenShareActive || !currentScreenSharer) {
        addSystemMessage('❌ No active screen share');
        return;
    }
    
    if (currentScreenSharer === socket.id) {
        addSystemMessage('❌ You are sharing screen');
        return;
    }
    
    addSystemMessage('🔄 Connecting to video...');
    updateStatus('video-status', 'Connecting...', 'connecting');
    
    try {
        // Close old connection
        if (screenPeerConnection) {
            screenPeerConnection.close();
            screenPeerConnection = null;
        }
        
        pendingIceCandidates = [];
        
        // Create new connection
        screenPeerConnection = new RTCPeerConnection(configuration);
        
        // Handle incoming video
        screenPeerConnection.ontrack = (event) => {
            const video = document.getElementById('remote-screen');
            video.srcObject = event.streams[0];
            document.getElementById('screen-container').classList.add('active');
            
            isViewingScreen = true;
            updateStatus('screen-status', 'Viewing', 'connected');
            updateStatus('video-status', 'Watching', 'connected');
            
            addSystemMessage('✅ Connected to video');
            video.play().catch(() => {});
        };
        
        // Handle ICE candidates
        screenPeerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('screen-ice-candidate', {
                    candidate: event.candidate,
                    target: currentScreenSharer
                });
            }
        };
        
        // Create offer
        const offer = await screenPeerConnection.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: true
        });
        
        await screenPeerConnection.setLocalDescription(offer);
        
        // Send offer to sharer
        socket.emit('request-screen-join', {
            target: currentScreenSharer,
            offer: offer
        });
        
        // Timeout
        setTimeout(() => {
            if (!isViewingScreen) {
                addSystemMessage('⏱️ Connection timeout');
                updateStatus('video-status', 'Timeout', 'error');
            }
        }, 10000);
        
    } catch (err) {
        console.error('Join error:', err);
        addSystemMessage('❌ Failed to join');
        updateStatus('video-status', 'Failed', 'error');
    }
}

// Fullscreen
function toggleFullScreen() {
    const container = document.getElementById('screen-container');
    
    if (!isFullscreen) {
        if (container.requestFullscreen) {
            container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        }
        isFullscreen = true;
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        isFullscreen = false;
    }
}

// Close screen
function closeScreenView() {
    if (isFullscreen) {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        isFullscreen = false;
    }
    
    document.getElementById('screen-container').classList.remove('active');
    document.getElementById('remote-screen').srcObject = null;
    isViewingScreen = false;
    updateStatus('video-status', '', '');
}

// Update status
function updateStatus(id, text, className) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'status-badge';
    if (className) el.classList.add('active', className);
}

// Add message
function addSystemMessage(msg) {
    const div = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message system';
    el.textContent = msg;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
}

// ============= SOCKET HANDLERS =============

socket.on('connect', () => console.log('✅ Connected'));

socket.on('new-message', (data) => {
    const div = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message';
    el.innerHTML = `<strong>${data.user}</strong> ${data.message} <small>${data.time}</small>`;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
});

socket.on('user-joined', (data) => addSystemMessage(data.message));
socket.on('user-left', (data) => addSystemMessage(data.message));

// Screen sharing started
socket.on('screen-sharing-started', (data) => {
    screenShareActive = true;
    currentScreenSharer = data.sharer;
    document.getElementById('joinVideoBtn').classList.add('active');
    
    const div = document.getElementById('messages');
    const el = document.createElement('div');
    el.className = 'message video-offer';
    el.innerHTML = `<strong>📺 ${data.username}</strong> sharing screen <button class="join-btn" onclick="joinVideo()">Join</button>`;
    div.appendChild(el);
    div.scrollTop = div.scrollHeight;
    
    addSystemMessage(`📺 ${data.username} is sharing screen`);
});

socket.on('screen-sharing-stopped', () => {
    screenShareActive = false;
    currentScreenSharer = null;
    document.getElementById('joinVideoBtn').classList.remove('active');
    if (document.getElementById('screen-container').classList.contains('active')) {
        closeScreenView();
    }
    addSystemMessage('📺 Screen sharing ended');
});

// Handle screen offer (for sharer)
socket.on('screen-offer', async (data) => {
    if (!isScreenSharing || !screenStream) return;
    
    try {
        const pc = new RTCPeerConnection(configuration);
        
        screenStream.getTracks().forEach(track => {
            pc.addTrack(track, screenStream);
        });
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('screen-ice-candidate', {
                    candidate: event.candidate,
                    target: data.sender
                });
            }
        };
        
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('screen-answer', {
            answer: answer,
            target: data.sender
        });
        
        if (!screenPeerConnection) {
            screenPeerConnection = pc;
        }
        
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

// Handle screen answer (for viewer)
socket.on('screen-answer', async (data) => {
    if (!screenPeerConnection) return;
    
    try {
        await screenPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        
        while (pendingIceCandidates.length) {
            await screenPeerConnection.addIceCandidate(new RTCIceCandidate(pendingIceCandidates.shift()));
        }
        
    } catch (err) {
        console.error('Error handling answer:', err);
    }
});

// Handle ICE candidates
socket.on('screen-ice-candidate', async (data) => {
    if (!screenPeerConnection) {
        pendingIceCandidates.push(data.candidate);
        return;
    }
    
    try {
        if (screenPeerConnection.remoteDescription) {
            await screenPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
            pendingIceCandidates.push(data.candidate);
        }
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Audio signaling
socket.on('offer', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { answer, target: data.sender });
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

socket.on('answer', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (err) {
        console.error('Error handling answer:', err);
    }
});

socket.on('ice-candidate', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Keyboard shortcut
document.addEventListener('keydown', (e) => {
    if (e.key === 'f' && document.getElementById('screen-container').classList.contains('active')) {
        toggleFullScreen();
    }
});

// Clean up
window.addEventListener('beforeunload', () => {
    if (localAudio) localAudio.remove();
    if (peerConnection) peerConnection.close();
    if (screenPeerConnection) screenPeerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
});

// Initialize chat input
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});