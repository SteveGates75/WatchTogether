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

// Better STUN servers for faster connection
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
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

// Toggle audio call
async function toggleCall() {
    if (isCallActive) {
        endCall();
    } else {
        await startAudioCall();
    }
}

// OPTIMIZED: Start audio call with better quality
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
                volume: 1.0
            }
        });
        
        // Optimize audio settings
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            const constraints = audioTrack.getConstraints();
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

// OPTIMIZED: Start 1080p screen share with better bitrate control
async function startScreenShare() {
    try {
        console.log('📺 Starting optimized screen share...');
        
        updateStatus('Requesting screen access...', 'connecting');
        
        // Check bandwidth first
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        let bandwidth = 'high';
        if (connection) {
            const downlink = connection.downlink || 10;
            if (downlink < 2) bandwidth = 'low';
            else if (downlink < 5) bandwidth = 'medium';
            else bandwidth = 'high';
        }
        
        console.log('📊 Detected bandwidth:', bandwidth);
        
        // Adjust quality based on bandwidth
        let videoConstraints = {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30 }
        };
        
        if (bandwidth === 'low') {
            videoConstraints = {
                width: { ideal: 854, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 15, max: 20 }
            };
            updateBitrate('Low bandwidth mode (480p)');
        } else if (bandwidth === 'medium') {
            videoConstraints = {
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 720 },
                frameRate: { ideal: 24, max: 30 }
            };
            updateBitrate('Medium bandwidth mode (720p)');
        } else {
            updateBitrate('High bandwidth mode (1080p)');
        }
        
        // Request screen share
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: videoConstraints,
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        });
        
        // Optimize video track
        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            console.log('📊 Screen resolution:', settings);
            
            // Apply additional constraints for smoother playback
            await videoTrack.applyConstraints({
                width: { ideal: settings.width },
                height: { ideal: settings.height },
                frameRate: { ideal: 30, max: 30 }
            });
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
    } else {
        updateStatus('Audio only', 'connected');
    }
    
    document.getElementById('quality-indicator').classList.remove('visible');
    updateBitrate('');
    isScreenSharing = false;
}

// Close fullscreen view
function closeScreenView() {
    document.getElementById('screen-container').classList.remove('active');
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

// Update bitrate display
function updateBitrate(text) {
    const bitrateStatus = document.getElementById('bitrate-status');
    if (text) {
        bitrateStatus.textContent = text;
        bitrateStatus.classList.add('active');
    } else {
        bitrateStatus.classList.remove('active');
    }
}

// OPTIMIZED: Create peer connection with better settings
function createPeerConnection(peerId) {
    console.log('🔄 Creating optimized peer connection');
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add tracks
    const activeStream = screenStream || localStream;
    if (activeStream) {
        activeStream.getTracks().forEach(track => {
            console.log(`➕ Adding ${track.kind} track`);
            pc.addTrack(track, activeStream);
        });
    }
    
    // Handle incoming tracks with optimizations
    pc.ontrack = (event) => {
        console.log(`📥 Received ${event.track.kind} track`);
        
        if (event.track.kind === 'audio') {
            // Optimized audio playback
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.volume = 1.0;
            remoteAudio.play()
                .then(() => console.log('✅ Audio playing'))
                .catch(e => console.log('Audio play error:', e));
        } else if (event.track.kind === 'video') {
            // Optimized video playback
            remoteScreen.srcObject = event.streams[0];
            document.getElementById('screen-container').classList.add('active');
            document.getElementById('quality-indicator').classList.add('visible');
            
            // Get video settings
            const settings = event.track.getSettings();
            const resolution = settings.width >= 1920 ? '1080p' : 
                             settings.width >= 1280 ? '720p' : '480p';
            document.getElementById('quality-indicator').innerHTML = `📺 ${resolution} ${settings.frameRate || 30}fps`;
            
            remoteScreen.play()
                .then(() => console.log('✅ Video playing'))
                .catch(e => console.log('Video play error:', e));
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
    
    // Monitor connection stats
    pc.onconnectionstatechange = () => {
        console.log('📊 Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            if (isScreenSharing) {
                updateStatus('Sharing screen...', 'screen-sharing');
            } else if (isCallActive) {
                updateStatus('Connected - Audio active', 'connected');
            }
            
            // Start monitoring stats
            monitorConnectionStats(pc);
        }
    };
    
    peerConnection = pc;
    return pc;
}

// Monitor connection statistics
async function monitorConnectionStats(pc) {
    try {
        const stats = await pc.getStats();
        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                if (report.availableOutgoingBitrate) {
                    const bitrate = (report.availableOutgoingBitrate / 1000000).toFixed(1);
                    console.log(`📊 Available bitrate: ${bitrate} Mbps`);
                }
            }
            if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
                if (report.qualityLimitationReason !== 'none') {
                    console.log(`⚠️ Quality limited by: ${report.qualityLimitationReason}`);
                }
            }
        });
    } catch (e) {
        console.log('Stats monitoring error:', e);
    }
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
});