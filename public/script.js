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
let screenShareActive = false; // Track if someone is sharing screen
let currentScreenSharer = null; // Store who is sharing

// Advanced audio constraints for better quality and noise cancellation
const audioConstraints = {
    audio: {
        // High quality audio
        channelCount: 2, // Stereo
        sampleRate: 48000, // 48kHz
        sampleSize: 24, // 24-bit
        volume: 1.0,
        
        // Advanced noise cancellation
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        
        // Additional audio processing
        voiceIsolation: true, // Isolate voice from background
        noiseSuppressionLevel: 'high', // 'low', 'medium', 'high'
        
        // Browser-specific optimizations
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        googTypingNoiseDetection: true,
        
        // Audio quality settings
        latency: 0.01, // Low latency
        volume: 1.0,
        
        // Modern audio processing
        audioProcessing: {
            enable: true,
            noiseReduction: 'high',
            echoReduction: 'high'
        }
    }
};

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.ekiga.net' },
        { urls: 'stun:stun.ideasip.com' },
        { urls: 'stun:stun.schlund.de' }
    ],
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
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

// Setup audio with advanced noise cancellation
async function setupAudio() {
    try {
        // Request audio with advanced constraints
        localStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
        
        console.log('✅ High-quality microphone access granted');
        console.log('Audio settings:', localStream.getAudioTracks()[0].getSettings());
        
        updateStatus('call-status', '🎤 High-quality mic ready', 'connected');
        
        // Apply additional audio processing
        const audioTrack = localStream.getAudioTracks()[0];
        
        // Apply audio processing if available
        if (audioTrack.applyConstraints) {
            try {
                await audioTrack.applyConstraints({
                    noiseSuppression: true,
                    echoCancellation: true,
                    autoGainControl: true
                });
                console.log('✅ Audio processing applied');
            } catch (err) {
                console.warn('Could not apply advanced audio constraints:', err);
            }
        }
        
        // Create muted local audio element to prevent echo
        localAudio = document.createElement('audio');
        localAudio.srcObject = localStream;
        localAudio.muted = true;
        localAudio.autoplay = true;
        document.body.appendChild(localAudio);
        
        // Visualize audio levels
        setupAudioVisualizer();
        
        // Monitor audio levels
        monitorAudioLevels();
        
    } catch (err) {
        console.error('❌ Microphone error:', err);
        updateStatus('call-status', '❌ Mic error', 'error');
        
        if (err.name === 'NotAllowedError') {
            alert('Please allow microphone access for high-quality audio');
        } else if (err.name === 'NotFoundError') {
            alert('No microphone found. Please connect a microphone.');
        } else if (err.name === 'NotReadableError') {
            alert('Microphone is busy. Please close other apps using it.');
        }
    }
}

// Monitor audio levels for debugging
function monitorAudioLevels() {
    if (!localStream) return;
    
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(localStream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    
    source.connect(analyzer);
    
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    
    function checkLevels() {
        analyzer.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        
        // Log if audio is too high (might cause distortion)
        if (average > 200) {
            console.log('⚠️ Audio level high, possible distortion');
        }
        
        requestAnimationFrame(checkLevels);
    }
    
    // checkLevels();
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
            
            // Change color based on volume
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
        
        // Remove remote audio
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
    
    // Add local audio tracks with high priority
    localStream.getTracks().forEach(track => {
        // Set audio track priority
        if (track.kind === 'audio') {
            track.enabled = true;
            // Add to connection with high priority
            peerConnection.addTrack(track, localStream);
            console.log('🎤 Added audio track with settings:', track.getSettings());
        }
    });
    
    // Handle incoming audio
    peerConnection.ontrack = (event) => {
        console.log('🔊 Received high-quality remote audio');
        
        // Create audio element for remote stream with high quality
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.volume = 1.0;
        remoteAudio.setAttribute('playsinline', true);
        remoteAudio.muted = false;
        
        // Set audio quality
        remoteAudio.audioTracks[0]?.applyConstraints({
            noiseSuppression: true,
            echoCancellation: true
        }).catch(() => {});
        
        // Add to DOM
        remoteAudio.id = 'remote-audio';
        const existing = document.getElementById('remote-audio');
        if (existing) existing.remove();
        document.body.appendChild(remoteAudio);
        
        updateStatus('call-status', 'Connected (HQ)', 'connected');
        addSystemMessage('🔊 Connected to high-quality remote audio');
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
        
        if (peerConnection.connectionState === 'connected') {
            // Get connection stats
            peerConnection.getStats().then(stats => {
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        console.log('✅ Audio connection established via:', report.localCandidateId);
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
            
            // Remove remote audio
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) remoteAudio.remove();
        }
    };
    
    // Create and send offer with high-quality audio
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
        // Stop screen sharing
        stopScreenShare();
    } else {
        // Start screen sharing
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
            
            await createScreenPeerConnection();
            
            isScreenSharing = true;
            screenShareActive = true;
            currentScreenSharer = socket.id;
            
            // Notify everyone that screen sharing started
            socket.emit('screen-sharing-started', {
                sharer: socket.id,
                username: username
            });
            
            addSystemMessage(`📺 ${username} started sharing screen`);
            
            // Handle stop from browser UI
            screenStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
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

// Stop screen share
function stopScreenShare() {
    if (screenPeerConnection) {
        screenPeerConnection.close();
        screenPeerConnection = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    
    isScreenSharing = false;
    screenShareActive = false;
    currentScreenSharer = null;
    document.getElementById('screenBtn').classList.remove('sharing');
    document.getElementById('joinVideoBtn').classList.remove('active');
    updateStatus('screen-status', '', '');
    
    // Notify everyone that screen sharing stopped
    socket.emit('screen-sharing-stopped');
    addSystemMessage('Screen sharing stopped');
}

// Join video (rejoin screen share)
function joinVideo() {
    if (screenShareActive && currentScreenSharer) {
        addSystemMessage('🔄 Rejoining video...');
        
        // Request to join the active screen share
        socket.emit('request-screen-join', {
            target: currentScreenSharer
        });
        
        updateStatus('video-status', 'Connecting to video...', 'connecting');
        document.getElementById('joinVideoBtn').classList.add('active');
    } else {
        addSystemMessage('No active screen share to join');
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
    
    document.getElementById('screen-container').classList.remove('active');
    const video = document.getElementById('remote-screen');
    video.srcObject = null;
    
    document.getElementById('fullscreenBtn').innerHTML = '<span id="fullscreenIcon">⛶</span> Fullscreen';
    document.getElementById('joinVideoBtn').classList.remove('active');
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

// Screen sharing notifications
socket.on('screen-sharing-started', (data) => {
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
    screenShareActive = false;
    currentScreenSharer = null;
    document.getElementById('joinVideoBtn').classList.remove('active');
    
    // Close video if currently viewing
    if (document.getElementById('screen-container').classList.contains('active')) {
        closeScreenView();
    }
    
    addSystemMessage('📺 Screen sharing ended');
});

socket.on('request-screen-join', async (data) => {
    // If we're sharing screen, send offer to the requester
    if (isScreenSharing && screenStream) {
        console.log('📺 Sending screen to rejoining user');
        
        // Create new peer connection for this user
        const tempPeerConnection = new RTCPeerConnection(configuration);
        
        // Add tracks
        screenStream.getTracks().forEach(track => {
            tempPeerConnection.addTrack(track, screenStream);
        });
        
        // Handle ICE candidates
        tempPeerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('screen-ice-candidate', {
                    candidate: event.candidate,
                    target: data.requester
                });
            }
        };
        
        // Create offer
        const offer = await tempPeerConnection.createOffer();
        await tempPeerConnection.setLocalDescription(offer);
        
        socket.emit('screen-offer', {
            offer: offer,
            target: data.requester
        });
        
        // Store connection
        if (!screenPeerConnection) {
            screenPeerConnection = tempPeerConnection;
        }
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

// Screen sharing signaling
socket.on('screen-offer', async (data) => {
    console.log('📺 Received screen offer');
    
    if (screenPeerConnection) {
        screenPeerConnection.close();
    }
    
    screenPeerConnection = new RTCPeerConnection(configuration);
    
    screenPeerConnection.ontrack = (event) => {
        console.log('📺 Received screen track');
        const video = document.getElementById('remote-screen');
        video.srcObject = event.streams[0];
        document.getElementById('screen-container').classList.add('active');
        document.getElementById('quality-indicator').classList.add('visible');
        updateStatus('screen-status', 'Viewing screen', 'connected');
        updateStatus('video-status', 'Watching', 'connected');
        
        showFullscreenHint('⛶ Click Fullscreen for better view');
        
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

// Keyboard shortcut for fullscreen (F key)
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