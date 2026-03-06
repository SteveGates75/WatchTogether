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
let isVideoActive = false;
let audioContext;
let localAudio;
let isFullscreen = false;
let screenShareActive = false;
let currentScreenSharer = null;
let isViewingScreen = false;
let pendingIceCandidates = []; // Store ICE candidates until connection is ready

// Advanced audio constraints for better quality and noise cancellation
const audioConstraints = {
    audio: {
        channelCount: 2,
        sampleRate: 48000,
        sampleSize: 24,
        volume: 1.0,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: true,
        noiseSuppressionLevel: 'high',
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
        latency: 0.01,
        volume: 1.0
    }
};

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10
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
        if (e.key === 'Enter') sendMessage();
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

// Setup audio with advanced noise cancellation
async function setupAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        console.log('✅ High-quality microphone access granted');
        updateStatus('call-status', '🎤 High-quality mic ready', 'connected');
        
        localAudio = document.createElement('audio');
        localAudio.srcObject = localStream;
        localAudio.muted = true;
        localAudio.autoplay = true;
        document.body.appendChild(localAudio);
        
        setupAudioVisualizer();
        
    } catch (err) {
        console.error('❌ Microphone error:', err);
        updateStatus('call-status', '❌ Mic error', 'error');
    }
}

// Audio visualizer
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
            if (percentage > 70) {
                visualizer.style.background = 'linear-gradient(90deg, #ed4245, #5865f2)';
            } else {
                visualizer.style.background = 'linear-gradient(90deg, #3ba55d, #5865f2)';
            }
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
        alert('Microphone not available. Setting up now...');
        await setupAudio();
        if (!localStream) return;
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
        
        const remoteAudio = document.getElementById('remote-audio');
        if (remoteAudio) remoteAudio.remove();
    } else {
        // Start call
        try {
            callBtn.classList.add('active');
            updateStatus('call-status', 'Connecting high-quality audio...', 'connecting');
            
            await createPeerConnection();
            
            isCallActive = true;
            addSystemMessage('📞 High-quality audio call started');
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
    
    localStream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
            track.enabled = true;
            peerConnection.addTrack(track, localStream);
        }
    });
    
    peerConnection.ontrack = (event) => {
        console.log('🔊 Received high-quality remote audio');
        
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.volume = 1.0;
        remoteAudio.setAttribute('playsinline', true);
        remoteAudio.muted = false;
        
        remoteAudio.id = 'remote-audio';
        const existing = document.getElementById('remote-audio');
        if (existing) existing.remove();
        document.body.appendChild(remoteAudio);
        
        updateStatus('call-status', 'Connected (HQ)', 'connected');
        addSystemMessage('🔊 Connected to high-quality remote audio');
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                target: currentRoom
            });
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'connected') {
            peerConnection.getStats().then(stats => {
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        console.log('✅ Audio connection established');
                    }
                });
            });
        }
        
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'closed') {
            
            isCallActive = false;
            document.getElementById('callBtn').classList.remove('active');
            updateStatus('call-status', 'Disconnected', 'error');
            addSystemMessage('Call disconnected');
            
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) remoteAudio.remove();
        }
    };
    
    try {
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false,
            voiceActivityDetection: true
        });
        
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('offer', {
            offer: offer,
            target: currentRoom
        });
        
        console.log('📞 High-quality audio offer sent');
    } catch (err) {
        console.error('Error creating offer:', err);
        throw err;
    }
}

// Toggle screen share
async function toggleScreenShare() {
    const screenBtn = document.getElementById('screenBtn');
    
    if (isScreenSharing) {
        stopScreenShare();
    } else {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 3840, max: 3840 },
                    height: { ideal: 2160, max: 2160 },
                    frameRate: { ideal: 60, max: 60 }
                },
                audio: true
            });
            
            screenBtn.classList.add('sharing');
            updateStatus('screen-status', 'Sharing screen', 'connected');
            
            // Create new connection for screen sharing
            await createScreenPeerConnection();
            
            isScreenSharing = true;
            screenShareActive = true;
            currentScreenSharer = socket.id;
            
            // Notify everyone
            socket.emit('screen-sharing-started', {
                sharer: socket.id,
                username: username
            });
            
            addSystemMessage(`📺 ${username} started sharing screen`);
            
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
    // Close all peer connections
    if (screenPeerConnection) {
        screenPeerConnection.close();
        screenPeerConnection = null;
    }
    
    // Stop all tracks
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

// JOIN VIDEO - FIXED VERSION
async function joinVideo() {
    console.log('🎬 Join video clicked. Active:', screenShareActive, 'Sharer:', currentScreenSharer);
    
    if (!screenShareActive || !currentScreenSharer) {
        addSystemMessage('❌ No active screen share to join');
        return;
    }
    
    // Don't try to join if we're already viewing
    if (isViewingScreen) {
        console.log('Already viewing screen');
        return;
    }
    
    addSystemMessage('🔄 Connecting to video stream...');
    updateStatus('video-status', 'Connecting...', 'connecting');
    document.getElementById('joinVideoBtn').classList.add('active');
    
    try {
        // Close any existing connection
        if (screenPeerConnection) {
            screenPeerConnection.close();
            screenPeerConnection = null;
        }
        
        // Clear any pending ICE candidates
        pendingIceCandidates = [];
        
        // Create new peer connection for receiving
        screenPeerConnection = new RTCPeerConnection(configuration);
        
        // Set up event handlers
        screenPeerConnection.ontrack = handleScreenTrack;
        screenPeerConnection.onicecandidate = handleScreenIceCandidate;
        screenPeerConnection.onconnectionstatechange = handleScreenConnectionState;
        screenPeerConnection.oniceconnectionstatechange = handleIceConnectionState;
        
        // Create data channel for signaling (optional)
        screenPeerConnection.createDataChannel('screen');
        
        // Create and send offer to the sharer
        console.log('Creating offer for screen share');
        const offer = await screenPeerConnection.createOffer({
            offerToReceiveVideo: true,
            offerToReceiveAudio: true
        });
        
        await screenPeerConnection.setLocalDescription(offer);
        
        // Send offer to the screen sharer
        socket.emit('request-screen-join', {
            target: currentScreenSharer,
            offer: offer
        });
        
        // Set timeout for connection
        setTimeout(() => {
            if (!isViewingScreen) {
                console.log('Connection timeout');
                addSystemMessage('⏱️ Connection timeout. Please try again.');
                updateStatus('video-status', 'Timeout', 'error');
                
                if (screenPeerConnection) {
                    screenPeerConnection.close();
                    screenPeerConnection = null;
                }
            }
        }, 10000);
        
    } catch (err) {
        console.error('Error joining video:', err);
        addSystemMessage('❌ Failed to join video: ' + err.message);
        updateStatus('video-status', 'Failed', 'error');
        
        if (screenPeerConnection) {
            screenPeerConnection.close();
            screenPeerConnection = null;
        }
    }
}

// Handle incoming screen track
function handleScreenTrack(event) {
    console.log('📺 Received screen track:', event.track.kind);
    
    const video = document.getElementById('remote-screen');
    if (!video) return;
    
    // Set the stream
    video.srcObject = event.streams[0];
    
    // Show the video container
    document.getElementById('screen-container').classList.add('active');
    document.getElementById('quality-indicator').classList.add('visible');
    
    // Update status
    isViewingScreen = true;
    updateStatus('screen-status', 'Viewing screen', 'connected');
    updateStatus('video-status', 'Watching', 'connected');
    
    addSystemMessage('✅ Connected to video stream');
    showFullscreenHint('⛶ Click Fullscreen for better view');
    
    // Log video info
    if (event.track.kind === 'video') {
        const settings = event.track.getSettings();
        console.log('Video resolution:', settings.width, 'x', settings.height);
    }
    
    // Play video
    video.play().catch(err => console.warn('Auto-play prevented:', err));
}

// Handle ICE candidates for screen
function handleScreenIceCandidate(event) {
    if (event.candidate) {
        console.log('Sending ICE candidate');
        socket.emit('screen-ice-candidate', {
            candidate: event.candidate,
            target: currentScreenSharer
        });
    }
}

// Handle connection state changes
function handleScreenConnectionState(event) {
    console.log('Screen connection state:', screenPeerConnection?.connectionState);
    
    if (screenPeerConnection?.connectionState === 'connected') {
        console.log('✅ Screen connection established');
        isViewingScreen = true;
    } else if (screenPeerConnection?.connectionState === 'failed' || 
               screenPeerConnection?.connectionState === 'disconnected') {
        console.log('❌ Screen connection lost');
        isViewingScreen = false;
        updateStatus('video-status', 'Disconnected', 'error');
    }
}

// Handle ICE connection state
function handleIceConnectionState(event) {
    console.log('ICE connection state:', screenPeerConnection?.iceConnectionState);
    
    if (screenPeerConnection?.iceConnectionState === 'failed') {
        console.log('ICE failed, attempting restart');
        screenPeerConnection.restartIce();
    }
}

// FULLSCREEN FUNCTIONS
function toggleFullScreen() {
    const container = document.getElementById('screen-container');
    const fullscreenIcon = document.getElementById('fullscreenIcon');
    
    if (!isFullscreen) {
        if (container.requestFullscreen) {
            container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        } else if (container.msRequestFullscreen) {
            container.msRequestFullscreen();
        }
        
        fullscreenIcon.textContent = '✕';
        document.getElementById('fullscreenBtn').innerHTML = '<span id="fullscreenIcon">✕</span> Exit Fullscreen';
        isFullscreen = true;
        
        showFullscreenHint('Press ESC to exit fullscreen');
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        
        fullscreenIcon.textContent = '⛶';
        document.getElementById('fullscreenBtn').innerHTML = '<span id="fullscreenIcon">⛶</span> Fullscreen';
        isFullscreen = false;
    }
}

function showFullscreenHint(message) {
    const hint = document.getElementById('fullscreen-hint');
    hint.textContent = message;
    hint.classList.add('show');
    
    setTimeout(() => {
        hint.classList.remove('show');
    }, 3000);
}

// Handle fullscreen change events
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

function handleFullscreenChange() {
    const fullscreenIcon = document.getElementById('fullscreenIcon');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    
    if (document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.mozFullScreenElement || 
        document.msFullscreenElement) {
        isFullscreen = true;
        if (fullscreenIcon) {
            fullscreenIcon.textContent = '✕';
            fullscreenBtn.innerHTML = '<span id="fullscreenIcon">✕</span> Exit Fullscreen';
        }
    } else {
        isFullscreen = false;
        if (fullscreenIcon) {
            fullscreenIcon.textContent = '⛶';
            fullscreenBtn.innerHTML = '<span id="fullscreenIcon">⛶</span> Fullscreen';
        }
    }
}

// Close screen view
function closeScreenView() {
    if (isFullscreen) {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        isFullscreen = false;
    }
    
    // Clean up connection
    if (screenPeerConnection) {
        screenPeerConnection.close();
        screenPeerConnection = null;
    }
    
    document.getElementById('screen-container').classList.remove('active');
    const video = document.getElementById('remote-screen');
    video.srcObject = null;
    
    isViewingScreen = false;
    document.getElementById('fullscreenBtn').innerHTML = '<span id="fullscreenIcon">⛶</span> Fullscreen';
    updateStatus('video-status', '', '');
    
    // Keep join button active if screen share is still active
    if (screenShareActive) {
        document.getElementById('joinVideoBtn').classList.add('active');
    }
}

// Update status badge
function updateStatus(elementId, text, className) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
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

// Screen sharing notifications
socket.on('screen-sharing-started', (data) => {
    console.log('Screen sharing started by:', data.username);
    screenShareActive = true;
    currentScreenSharer = data.sharer;
    
    // Show join button
    document.getElementById('joinVideoBtn').classList.add('active');
    
    // Add to chat with join button
    const messagesDiv = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.className = 'message video-offer';
    messageElement.innerHTML = `
        <strong>📺 ${data.username}</strong> started sharing screen
        <button class="join-btn" onclick="joinVideo()">Join Video</button>
    `;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    addSystemMessage(`📺 ${data.username} is sharing screen. Click Join Video to watch.`);
});

socket.on('screen-sharing-stopped', () => {
    console.log('Screen sharing stopped');
    screenShareActive = false;
    currentScreenSharer = null;
    document.getElementById('joinVideoBtn').classList.remove('active');
    
    // Close video if currently viewing
    if (document.getElementById('screen-container').classList.contains('active')) {
        closeScreenView();
    }
    
    addSystemMessage('📺 Screen sharing ended');
});

// Handle screen join request response - FIXED VERSION
socket.on('screen-offer', async (data) => {
    console.log('📺 Received screen offer from sharer');
    
    if (!screenPeerConnection) {
        console.log('Creating new peer connection for screen');
        screenPeerConnection = new RTCPeerConnection(configuration);
        
        screenPeerConnection.ontrack = handleScreenTrack;
        screenPeerConnection.onicecandidate = handleScreenIceCandidate;
        screenPeerConnection.onconnectionstatechange = handleScreenConnectionState;
        screenPeerConnection.oniceconnectionstatechange = handleIceConnectionState;
    }
    
    try {
        await screenPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        console.log('Remote description set');
        
        const answer = await screenPeerConnection.createAnswer();
        await screenPeerConnection.setLocalDescription(answer);
        console.log('Answer created and set');
        
        socket.emit('screen-answer', {
            answer: answer,
            target: data.sender
        });
        
        // Process any pending ICE candidates
        while (pendingIceCandidates.length > 0) {
            const candidate = pendingIceCandidates.shift();
            try {
                await screenPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('Added pending ICE candidate');
            } catch (err) {
                console.warn('Error adding pending ICE candidate:', err);
            }
        }
        
    } catch (err) {
        console.error('Error handling screen offer:', err);
        addSystemMessage('❌ Failed to connect to video');
    }
});

socket.on('screen-answer', async (data) => {
    console.log('📺 Received screen answer');
    
    if (!screenPeerConnection) {
        console.warn('No peer connection for answer');
        return;
    }
    
    try {
        await screenPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('Remote description set from answer');
    } catch (err) {
        console.error('Error handling screen answer:', err);
    }
});

socket.on('screen-ice-candidate', async (data) => {
    console.log('❄️ Received ICE candidate');
    
    if (!screenPeerConnection) {
        console.log('Storing ICE candidate for later');
        pendingIceCandidates.push(data.candidate);
        return;
    }
    
    try {
        if (screenPeerConnection.remoteDescription) {
            await screenPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('Added ICE candidate');
        } else {
            console.log('No remote description yet, storing candidate');
            pendingIceCandidates.push(data.candidate);
        }
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Audio signaling
socket.on('offer', async (data) => {
    console.log('📲 Received high-quality audio offer from:', data.sender);
    
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
        
        console.log('📲 High-quality audio answer sent');
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

socket.on('answer', async (data) => {
    console.log('📲 Received audio answer');
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

// Keyboard shortcut for fullscreen
document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
        const screenContainer = document.getElementById('screen-container');
        if (screenContainer.classList.contains('active')) {
            toggleFullScreen();
        }
    }
    
    if (e.key === 'Escape' && isFullscreen) {
        isFullscreen = false;
        document.getElementById('fullscreenBtn').innerHTML = '<span id="fullscreenIcon">⛶</span> Fullscreen';
    }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (localAudio) localAudio.remove();
    if (peerConnection) peerConnection.close();
    if (screenPeerConnection) screenPeerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (screenStream) screenStream.getTracks().forEach(track => track.stop());
});