const socket = io();
let currentUser = '';
let localStream = null;
let screenStream = null;
let peerConnection = null;
let isCallActive = false;
let isScreenSharing = false;
let callButton = null;
let screenButton = null;
let remoteAudio = null;
let remoteScreen = null;
let currentQuality = 'auto';
let bandwidthInterval = null;
let lastBitrate = 0;
let videoPlayAttempted = false;

// More STUN servers for better connection
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.ekiga.net:19302' },
        { urls: 'stun:stun.ideasip.com:19302' }
    ],
    iceCandidatePoolSize: 10,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
};

function login() {
    const username = document.getElementById('username-input').value.trim();
    if (username) {
        currentUser = username;
        socket.emit('join', username);
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        // Get button references
        callButton = document.getElementById('callBtn');
        screenButton = document.getElementById('screenBtn');
        
        // Create hidden audio element with optimized settings
        remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.controls = false;
        remoteAudio.style.display = 'none';
        document.body.appendChild(remoteAudio);
        
        // Get screen video element
        remoteScreen = document.getElementById('remote-screen');
        
        // Add click handler for video playback
        document.body.addEventListener('click', function playVideoOnClick() {
            if (remoteScreen && remoteScreen.paused && remoteScreen.srcObject) {
                remoteScreen.play().catch(e => console.log('Play on click error:', e));
            }
        }, { once: false });
    }
}

// Text chat
socket.on('new-message', (data) => {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.innerHTML = `<strong>${data.user}</strong> ${data.message} <small>${data.time}</small>`;
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

socket.on('user-joined', (data) => {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.innerHTML = `<em>${data.message}</em>`;
    messagesDiv.appendChild(messageEl);
});

socket.on('user-left', (data) => {
    const messagesDiv = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    messageEl.innerHTML = `<em>${data.message}</em>`;
    messagesDiv.appendChild(messageEl);
    
    if (isCallActive || isScreenSharing) {
        endCall();
        stopScreenShare();
    }
});

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (message) {
        socket.emit('send-message', { message });
        input.value = '';
    }
}

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Quality selection
function changeQuality() {
    const select = document.getElementById('quality-dropdown');
    currentQuality = select.value;
    console.log('📊 Quality changed to:', currentQuality);
    
    if (isScreenSharing && screenStream) {
        // Restart screen share with new quality
        stopScreenShare();
        setTimeout(() => startScreenShare(), 500);
    }
}

// Get video constraints based on quality setting
function getVideoConstraints() {
    switch(currentQuality) {
        case '480p':
            return {
                width: { ideal: 854, max: 854 },
                height: { ideal: 480, max: 480 },
                frameRate: { ideal: 30, max: 30 }
            };
        case '720p':
            return {
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 720 },
                frameRate: { ideal: 30, max: 30 }
            };
        case '1080p30':
            return {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 }
            };
        case '1080p60':
            return {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 60, max: 60 }
            };
        case 'auto':
        default:
            // Auto mode - detect bandwidth
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (connection) {
                const downlink = connection.downlink || 10;
                if (downlink < 3) {
                    return {
                        width: { ideal: 854, max: 1280 },
                        height: { ideal: 480, max: 720 },
                        frameRate: { ideal: 24, max: 30 }
                    };
                } else if (downlink < 6) {
                    return {
                        width: { ideal: 1280, max: 1280 },
                        height: { ideal: 720, max: 720 },
                        frameRate: { ideal: 30, max: 30 }
                    };
                } else if (downlink < 10) {
                    return {
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
                        frameRate: { ideal: 30, max: 30 }
                    };
                } else {
                    return {
                        width: { ideal: 1920, max: 1920 },
                        height: { ideal: 1080, max: 1080 },
                        frameRate: { ideal: 60, max: 60 }
                    };
                }
            }
            return {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 }
            };
    }
}

// Toggle audio call
async function toggleCall() {
    if (isCallActive) {
        endCall();
    } else {
        await startAudioCall();
    }
}

// Start audio call with better quality
async function startAudioCall() {
    try {
        console.log('🎤 Starting audio call...');
        
        updateStatus('Requesting microphone...', 'connecting');
        
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 2,
                volume: 1.0,
                latency: 0.01
            }
        });
        
        // Optimize audio settings
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            await audioTrack.applyConstraints({
                volume: 1.0,
                sampleRate: 48000,
                sampleSize: 16,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            });
        }
        
        console.log('✅ Microphone access granted');
        
        callButton.classList.add('active');
        callButton.textContent = '🔴';
        callButton.title = 'End Call';
        
        updateStatus('Connecting...', 'connecting');
        
        socket.emit('join-room', 'main-room');
        isCallActive = true;
        
    } catch (err) {
        console.error('❌ Microphone error:', err);
        alert('Could not access microphone: ' + err.message);
        updateStatus('', '');
    }
}

// End audio call
function endCall() {
    console.log('🔴 Ending call...');
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }
    
    callButton.classList.remove('active');
    callButton.textContent = '🎧';
    callButton.title = 'Audio Call';
    
    updateStatus('', '');
    isCallActive = false;
}

// Toggle screen share
async function toggleScreenShare() {
    if (isScreenSharing) {
        stopScreenShare();
    } else {
        await startScreenShare();
    }
}

// Start screen share with selected quality
async function startScreenShare() {
    try {
        console.log('📺 Starting screen share with quality:', currentQuality);
        
        updateStatus('Requesting screen access...', 'connecting');
        document.getElementById('quality-selector').classList.add('active');
        
        // Get video constraints based on selected quality
        const videoConstraints = getVideoConstraints();
        
        console.log('📊 Video constraints:', videoConstraints);
        
        // Request screen share
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: videoConstraints,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 2
            }
        });
        
        // Optimize video track
        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            console.log('📊 Actual screen resolution:', settings);
            
            // Show quality indicator
            const fps = settings.frameRate || 30;
            const height = settings.height || 1080;
            const quality = height >= 1080 ? '1080p' : height >= 720 ? '720p' : '480p';
            document.getElementById('quality-indicator').innerHTML = `📺 ${quality} ${fps}fps`;
            document.getElementById('quality-indicator').classList.add('visible');
        }
        
        // Handle audio
        const audioTracks = screenStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.log('Adding microphone for audio');
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 48000
                    }
                });
                micStream.getAudioTracks().forEach(track => {
                    screenStream.addTrack(track);
                    console.log('Added microphone track');
                });
            } catch (micError) {
                console.warn('Could not add microphone:', micError);
            }
        }
        
        // Update UI
        screenButton.classList.add('sharing');
        screenButton.textContent = '⏹️';
        screenButton.title = 'Stop Sharing';
        
        updateStatus('Sharing screen...', 'screen-sharing');
        
        socket.emit('join-room', 'main-room');
        isScreenSharing = true;
        
        // Start monitoring bandwidth
        startBandwidthMonitoring();
        
        // Handle stop event
        screenStream.getVideoTracks()[0].onended = () => {
            console.log('Screen sharing stopped');
            stopScreenShare();
        };
        
    } catch (err) {
        console.error('❌ Screen share error:', err);
        if (err.name !== 'NotAllowedError') {
            alert('Could not share screen: ' + err.message);
        }
        updateStatus('', '');
        document.getElementById('quality-selector').classList.remove('active');
    }
}

// Stop screen share
function stopScreenShare() {
    console.log('⏹️ Stopping screen share...');
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    screenButton.classList.remove('sharing');
    screenButton.textContent = '📺';
    screenButton.title = 'Share Screen';
    
    if (!isCallActive) {
        updateStatus('', '');
        document.getElementById('quality-selector').classList.remove('active');
    } else {
        updateStatus('Audio only', 'connected');
    }
    
    document.getElementById('quality-indicator').classList.remove('visible');
    document.getElementById('bitrate-indicator').classList.remove('visible');
    
    if (bandwidthInterval) {
        clearInterval(bandwidthInterval);
        bandwidthInterval = null;
    }
    
    isScreenSharing = false;
}

// Start bandwidth monitoring
function startBandwidthMonitoring() {
    if (bandwidthInterval) {
        clearInterval(bandwidthInterval);
    }
    
    bandwidthInterval = setInterval(async () => {
        if (peerConnection && isScreenSharing) {
            try {
                const stats = await peerConnection.getStats();
                let bitrate = 0;
                
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        if (report.availableOutgoingBitrate) {
                            bitrate = report.availableOutgoingBitrate;
                        }
                    }
                });
                
                if (bitrate > 0) {
                    const mbps = (bitrate / 1000000).toFixed(1);
                    document.getElementById('bitrate-indicator').innerHTML = `📊 ${mbps} Mbps`;
                    document.getElementById('bitrate-indicator').classList.add('visible');
                    
                    // Auto-adjust if in auto mode
                    if (currentQuality === 'auto' && isScreenSharing) {
                        const videoTrack = screenStream?.getVideoTracks()[0];
                        if (videoTrack) {
                            const settings = videoTrack.getSettings();
                            const currentFps = settings.frameRate || 30;
                            
                            // Adjust based on bitrate
                            if (bitrate < 2000000 && currentFps > 24) { // Less than 2 Mbps
                                console.log('Auto-reducing frame rate due to low bandwidth');
                                videoTrack.applyConstraints({ frameRate: 20 });
                            } else if (bitrate > 5000000 && currentFps < 30) { // More than 5 Mbps
                                console.log('Auto-increasing frame rate');
                                videoTrack.applyConstraints({ frameRate: 30 });
                            } else if (bitrate > 10000000 && currentFps < 60) { // More than 10 Mbps
                                console.log('Auto-increasing to 60fps');
                                videoTrack.applyConstraints({ frameRate: 60 });
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('Stats error:', e);
            }
        }
    }, 2000);
}

// Close fullscreen view
function closeScreenView() {
    document.getElementById('screen-container').classList.remove('active');
    if (remoteScreen) {
        remoteScreen.pause();
        remoteScreen.srcObject = null;
    }
}

// Update status display
function updateStatus(text, type) {
    const status = document.getElementById('call-status');
    if (text) {
        status.textContent = text;
        status.className = 'status-badge active ' + type;
    } else {
        status.className = 'status-badge';
    }
}

// Create peer connection with better settings
function createPeerConnection(peerId) {
    console.log('🔄 Creating optimized peer connection');
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add tracks
    const activeStream = screenStream || localStream;
    if (activeStream) {
        activeStream.getTracks().forEach(track => {
            console.log(`➕ Adding ${track.kind} track`);
            
            // Set high priority for video
            if (track.kind === 'video') {
                pc.addTransceiver(track, {
                    direction: 'sendonly',
                    streams: [activeStream],
                    sendEncodings: [
                        { maxBitrate: 20000000 } // 20 Mbps max
                    ]
                });
            } else {
                pc.addTrack(track, activeStream);
            }
        });
    }
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log(`📥 Received ${event.track.kind} track`);
        
        if (event.track.kind === 'audio') {
            // Handle audio
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.volume = 1.0;
            
            // Play audio with user interaction fallback
            const playAudio = () => {
                remoteAudio.play()
                    .then(() => console.log('✅ Audio playing'))
                    .catch(e => {
                        console.log('Audio play error:', e);
                        // Try again on user interaction
                        document.body.addEventListener('click', function playAudioOnClick() {
                            remoteAudio.play().catch(console.log);
                            document.body.removeEventListener('click', playAudioOnClick);
                        }, { once: true });
                    });
            };
            
            playAudio();
            
        } else if (event.track.kind === 'video') {
            // Handle video
            remoteScreen.srcObject = event.streams[0];
            document.getElementById('screen-container').classList.add('active');
            
            // Show quality info
            const settings = event.track.getSettings();
            const fps = settings.frameRate || 30;
            const height = settings.height || 1080;
            const quality = height >= 1080 ? '1080p' : height >= 720 ? '720p' : '480p';
            document.getElementById('quality-indicator').innerHTML = `📺 ${quality} ${fps}fps`;
            document.getElementById('quality-indicator').classList.add('visible');
            
            // Create a button for manual play if needed
            const playButton = document.createElement('button');
            playButton.textContent = 'Click to Play Video';
            playButton.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                padding: 15px 30px;
                background: #5865f2;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                cursor: pointer;
                z-index: 2100;
            `;
            
            // Try to play video
            const playVideo = () => {
                remoteScreen.play()
                    .then(() => {
                        console.log('✅ Video playing');
                        if (playButton.parentNode) {
                            playButton.remove();
                        }
                    })
                    .catch(e => {
                        console.log('Video play error:', e);
                        // Show play button if autoplay fails
                        if (!document.getElementById('manual-play-btn')) {
                            playButton.id = 'manual-play-btn';
                            document.getElementById('screen-container').appendChild(playButton);
                            playButton.onclick = () => {
                                remoteScreen.play();
                                playButton.remove();
                            };
                        }
                    });
            };
            
            // Try to play immediately
            playVideo();
            
            // Also try when track becomes active
            event.track.onunmute = () => {
                console.log('Video track unmuted, trying to play');
                playVideo();
            };
        }
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: peerId,
                candidate: event.candidate
            });
        }
    };
    
    // Monitor connection
    pc.onconnectionstatechange = () => {
        console.log('📊 Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            if (isScreenSharing) {
                updateStatus('Sharing screen...', 'screen-sharing');
            } else if (isCallActive) {
                updateStatus('Connected - Audio active', 'connected');
            }
        }
    };
    
    // Monitor ICE connection
    pc.oniceconnectionstatechange = () => {
        console.log('❄️ ICE state:', pc.iceConnectionState);
    };
    
    // Handle negotiation needed
    pc.onnegotiationneeded = async () => {
        console.log('🤝 Negotiation needed');
    };
    
    peerConnection = pc;
    return pc;
}

// Signaling events
socket.on('user-joined-room', async (userId) => {
    console.log('👤 User joined room:', userId);
    
    if ((isCallActive || isScreenSharing) && userId !== socket.id) {
        console.log('📞 Creating offer');
        
        const pc = createPeerConnection(userId);
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
            voiceActivityDetection: true
        });
        
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: userId, offer: offer });
    }
});

socket.on('offer', async (data) => {
    console.log('📥 Received offer');
    
    if (isCallActive || isScreenSharing) {
        const pc = createPeerConnection(data.sender);
        await pc.setRemoteDescription(data.offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', { target: data.sender, answer: answer });
    }
});

socket.on('answer', async (data) => {
    console.log('📥 Received answer');
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
        console.log('✅ Connection established');
    }
});

socket.on('ice-candidate', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
});

socket.on('user-left-room', (userId) => {
    console.log('👋 User left room');
    if (isScreenSharing) {
        closeScreenView();
    }
});

// Handle page close
window.addEventListener('beforeunload', () => {
    if (isScreenSharing) stopScreenShare();
    if (isCallActive) endCall();
    if (bandwidthInterval) clearInterval(bandwidthInterval);
});