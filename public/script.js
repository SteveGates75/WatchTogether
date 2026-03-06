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
let localAudio; // Store reference to local audio element

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// Login function
function login() {
    username = document.getElementById('username-input').value.trim();
    
    if (!username) {
        alert('Please enter your name');
        return;
    }
    
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    
    socket.emit('join', username);
    socket.emit('join-room', currentRoom);
    
    initializeChat();
    setupAudio();
    
    addSystemMessage(`You joined as ${username}`);
}

// Initialize chat
function initializeChat() {
    const messageInput = document.getElementById('message-input');
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
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

// Setup audio with echo cancellation
async function setupAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                latency: 0,
                channelCount: 1,
                sampleRate: 48000,
                sampleSize: 16
            }
        });
        
        console.log('✅ Microphone access granted');
        updateStatus('call-status', '🎤 Mic ready', 'connected');
        
        // Create muted local audio element to prevent echo
        localAudio = document.createElement('audio');
        localAudio.srcObject = localStream;
        localAudio.muted = true; // CRITICAL: This prevents echo!
        localAudio.autoplay = true;
        document.body.appendChild(localAudio);
        
        // Optional: Visualize audio levels
        setupAudioVisualizer();
        
    } catch (err) {
        console.error('❌ Microphone error:', err);
        updateStatus('call-status', '❌ Mic blocked', 'error');
        
        if (err.name === 'NotAllowedError') {
            alert('Please allow microphone access to use audio calls');
        } else if (err.name === 'NotFoundError') {
            alert('No microphone found. Please connect a microphone.');
        }
    }
}

// Audio visualizer (optional)
function setupAudioVisualizer() {
    if (!localStream) return;
    
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(localStream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    
    source.connect(analyzer);
    
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    
    function updateVisualizer() {
        if (!isCallActive) return;
        
        analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const percentage = (average / 255) * 100;
        
        const visualizer = document.getElementById('visualizer-bar');
        if (visualizer) {
            visualizer.style.width = percentage + '%';
        }
        
        requestAnimationFrame(updateVisualizer);
    }
    
    document.getElementById('audio-visualizer').classList.add('active');
    updateVisualizer();
}

// Toggle audio call
async function toggleCall() {
    const callBtn = document.getElementById('callBtn');
    
    if (!localStream) {
        alert('Microphone not available. Please check permissions.');
        return;
    }
    
    if (isCallActive) {
        // End call
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        isCallActive = false;
        callBtn.classList.remove('active');
        updateStatus('call-status', 'Call ended', '');
        document.getElementById('audio-visualizer').classList.remove('active');
        addSystemMessage('Call ended');
    } else {
        // Start call
        try {
            callBtn.classList.add('active');
            updateStatus('call-status', 'Connecting...', 'connecting');
            
            await createPeerConnection();
            
            isCallActive = true;
            addSystemMessage('Call started...');
        } catch (err) {
            console.error('Call error:', err);
            updateStatus('call-status', 'Call failed', 'error');
            callBtn.classList.remove('active');
        }
    }
}

// Create peer connection for audio
async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    // Add local audio tracks (these will be sent to remote user)
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    // Handle incoming audio (from remote user)
    peerConnection.ontrack = (event) => {
        console.log('🔊 Received remote audio');
        
        // Create audio element for remote stream
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.volume = 1.0;
        remoteAudio.setAttribute('playsinline', true);
        remoteAudio.muted = false; // This should NOT be muted!
        
        // Add to DOM
        remoteAudio.id = 'remote-audio';
        const existing = document.getElementById('remote-audio');
        if (existing) existing.remove();
        document.body.appendChild(remoteAudio);
        
        updateStatus('call-status', 'Connected', 'connected');
        addSystemMessage('🔊 Connected to remote audio');
    };
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                target: currentRoom
            });
        }
    };
    
    // Handle connection state
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'closed') {
            
            isCallActive = false;
            document.getElementById('callBtn').classList.remove('active');
            updateStatus('call-status', 'Disconnected', 'error');
            addSystemMessage('Call disconnected');
            
            // Remove remote audio
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) remoteAudio.remove();
        }
    };
    
    // Create and send offer
    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            offer: offer,
            target: currentRoom
        });
        
        console.log('📞 Offer sent');
    } catch (err) {
        console.error('Error creating offer:', err);
        throw err;
    }
}

// Toggle screen share (WITH AUDIO OPTION)
async function toggleScreenShare() {
    const screenBtn = document.getElementById('screenBtn');
    
    if (isScreenSharing) {
        // Stop screen sharing
        if (screenPeerConnection) {
            screenPeerConnection.close();
            screenPeerConnection = null;
        }
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
        }
        
        isScreenSharing = false;
        screenBtn.classList.remove('sharing');
        updateStatus('screen-status', '', '');
        addSystemMessage('Screen sharing stopped');
    } else {
        // Start screen sharing WITH SYSTEM AUDIO
        try {
            // Set audio: true to include system audio (for videos, etc.)
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 3840 },
                    height: { ideal: 2160 },
                    frameRate: { ideal: 60 }
                },
                audio: true  // Set to true to share system audio
            });
            
            screenBtn.classList.add('sharing');
            updateStatus('screen-status', 'Sharing screen', 'connected');
            
            await createScreenPeerConnection();
            
            isScreenSharing = true;
            addSystemMessage('📺 Started screen sharing');
            
            // Handle stop from browser UI
            screenStream.getVideoTracks()[0].onended = () => {
                toggleScreenShare();
            };
            
        } catch (err) {
            console.error('Screen share error:', err);
            if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') {
                alert('Could not start screen sharing');
            }
            screenBtn.classList.remove('sharing');
        }
    }
}

// Create peer connection for screen sharing
async function createScreenPeerConnection() {
    screenPeerConnection = new RTCPeerConnection(configuration);
    
    // Add screen video track (and audio if available)
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
    
    // Create and send offer
    const offer = await screenPeerConnection.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false
    });
    
    await screenPeerConnection.setLocalDescription(offer);
    
    socket.emit('screen-offer', {
        offer: offer,
        target: currentRoom
    });
}

// Close screen view
function closeScreenView() {
    document.getElementById('screen-container').classList.remove('active');
    const video = document.getElementById('remote-screen');
    video.srcObject = null;
}

// Update status badge
function updateStatus(elementId, text, className) {
    const element = document.getElementById(elementId);
    element.textContent = text;
    element.className = 'status-badge';
    if (className) {
        element.classList.add('active', className);
    } else {
        element.classList.remove('active');
    }
}

// Add system message to chat
function addSystemMessage(message) {
    const messagesDiv = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message system';
    messageElement.textContent = message;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Socket event handlers
socket.on('connect', () => {
    console.log('✅ Connected to server');
});

socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
    addSystemMessage('Disconnected from server');
});

socket.on('new-message', (data) => {
    const messagesDiv = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    messageElement.innerHTML = `
        <strong>${data.user}</strong>
        <span>${data.message}</span>
        <small>${data.time}</small>
    `;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

socket.on('user-joined', (data) => {
    addSystemMessage(data.message);
});

socket.on('user-left', (data) => {
    addSystemMessage(data.message);
});

// Audio signaling
socket.on('offer', async (data) => {
    console.log('📲 Received offer from:', data.sender);
    
    if (!peerConnection) {
        await createPeerConnection();
    }
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            answer: answer,
            target: data.sender
        });
        
        console.log('📲 Answer sent');
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

socket.on('answer', async (data) => {
    console.log('📲 Received answer');
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (err) {
        console.error('Error handling answer:', err);
    }
});

socket.on('ice-candidate', async (data) => {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Screen sharing signaling
socket.on('screen-offer', async (data) => {
    console.log('📺 Received screen offer');
    
    screenPeerConnection = new RTCPeerConnection(configuration);
    
    screenPeerConnection.ontrack = (event) => {
        console.log('📺 Received screen track');
        const video = document.getElementById('remote-screen');
        video.srcObject = event.streams[0];
        document.getElementById('screen-container').classList.add('active');
        document.getElementById('quality-indicator').classList.add('visible');
        updateStatus('screen-status', 'Viewing screen', 'connected');
        
        // If screen includes audio, it will play automatically with video
        if (event.track.kind === 'audio') {
            console.log('🔊 Screen audio received');
        }
    };
    
    screenPeerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('screen-ice-candidate', {
                candidate: event.candidate,
                target: data.sender
            });
        }
    };
    
    try {
        await screenPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await screenPeerConnection.createAnswer();
        await screenPeerConnection.setLocalDescription(answer);
        
        socket.emit('screen-answer', {
            answer: answer,
            target: data.sender
        });
    } catch (err) {
        console.error('Error handling screen offer:', err);
    }
});

socket.on('screen-answer', async (data) => {
    try {
        await screenPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (err) {
        console.error('Error handling screen answer:', err);
    }
});

socket.on('screen-ice-candidate', async (data) => {
    try {
        if (screenPeerConnection) {
            await screenPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (err) {
        console.error('Error adding screen ICE candidate:', err);
    }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (localAudio) {
        localAudio.remove();
    }
    if (peerConnection) {
        peerConnection.close();
    }
    if (screenPeerConnection) {
        screenPeerConnection.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
});