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

// STUN servers for better connection
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
    ]
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
        
        // Create hidden audio element
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
    
    // If other user left, end everything
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

// Start audio call
async function startAudioCall() {
    try {
        console.log('🎤 Starting audio call...');
        
        updateStatus('Requesting microphone...', 'connecting');
        
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        });
        
        console.log('✅ Microphone access granted');
        
        // Update UI
        callButton.classList.add('active');
        callButton.textContent = '🔴';
        callButton.title = 'End Call';
        
        updateStatus('Connecting...', 'connecting');
        
        // Join room
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
    callButton.title = 'Start Audio Call';
    
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

// Start 1080p screen share
async function startScreenShare() {
    try {
        console.log('📺 Starting 1080p screen share...');
        
        updateStatus('Requesting screen access...', 'connecting');
        
        // Request screen with 1080p quality
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 }
            },
            audio: true // Include system audio if available
        });
        
        console.log('✅ Screen access granted');
        console.log('📊 Screen resolution:', screenStream.getVideoTracks()[0].getSettings());
        
        // Check if we have audio
        const audioTracks = screenStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.log('No system audio, using microphone');
            // Add microphone if no system audio
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                micStream.getAudioTracks().forEach(track => {
                    screenStream.addTrack(track);
                    console.log('Added microphone track');
                });
            } catch (micError) {
                console.warn('Could not add microphone:', micError);
            }
        } else {
            console.log('System audio captured');
        }
        
        // Update UI
        screenButton.classList.add('sharing');
        screenButton.textContent = '⏹️';
        screenButton.title = 'Stop Sharing';
        
        updateStatus('Sharing screen...', 'screen-sharing');
        
        // Join room for sharing
        socket.emit('join-room', 'main-room');
        isScreenSharing = true;
        
        // Handle when user stops sharing via browser UI
        screenStream.getVideoTracks()[0].onended = () => {
            console.log('Screen sharing stopped by user');
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
        screenStream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped track:', track.kind);
        });
        screenStream = null;
    }
    
    screenButton.classList.remove('sharing');
    screenButton.textContent = '📺';
    screenButton.title = 'Share Screen in 1080p';
    
    if (!isCallActive) {
        updateStatus('', '');
    } else {
        updateStatus('Audio only', 'connected');
    }
    
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
        status.className = 'active ' + type;
    } else {
        status.className = '';
    }
}

// Create peer connection
function createPeerConnection(peerId) {
    console.log('🔄 Creating peer connection');
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add tracks based on what's active
    const activeStream = screenStream || localStream;
    
    if (activeStream) {
        activeStream.getTracks().forEach(track => {
            console.log(`➕ Adding ${track.kind} track to connection`);
            pc.addTrack(track, activeStream);
        });
    }
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log(`📥 Received ${event.track.kind} track from peer`);
        
        if (event.track.kind === 'audio') {
            // Handle audio
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.play()
                .then(() => console.log('✅ Remote audio playing'))
                .catch(e => console.log('Audio play error:', e));
        } else if (event.track.kind === 'video') {
            // Handle video (screen share)
            console.log('🎬 Received video track - this is a screen share');
            remoteScreen.srcObject = event.streams[0];
            document.getElementById('screen-container').classList.add('active');
            remoteScreen.play()
                .then(() => console.log('✅ Remote video playing'))
                .catch(e => console.log('Video play error:', e));
            
            updateStatus('Receiving screen share...', 'screen-sharing');
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
        } else if (pc.connectionState === 'disconnected') {
            console.log('Connection disconnected');
        } else if (pc.connectionState === 'failed') {
            console.log('Connection failed');
        }
    };
    
    peerConnection = pc;
    return pc;
}

// Signaling events
socket.on('user-joined-room', async (userId) => {
    console.log('👤 User joined room:', userId);
    
    if ((isCallActive || isScreenSharing) && userId !== socket.id) {
        console.log('📞 Creating offer for new user');
        
        const pc = createPeerConnection(userId);
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        await pc.setLocalDescription(offer);
        console.log('📤 Sending offer');
        
        socket.emit('offer', {
            target: userId,
            offer: offer
        });
    }
});

socket.on('offer', async (data) => {
    console.log('📥 Received offer from:', data.sender);
    
    if (isCallActive || isScreenSharing) {
        const pc = createPeerConnection(data.sender);
        await pc.setRemoteDescription(data.offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        console.log('📤 Sending answer');
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
    }
});

socket.on('answer', async (data) => {
    console.log('📥 Received answer from:', data.sender);
    
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
        console.log('✅ Connection established');
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('❄️ Received ICE candidate');
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
});

socket.on('user-left-room', (userId) => {
    console.log('👋 User left room:', userId);
    if (isScreenSharing) {
        closeScreenView();
    }
});

// Handle page close
window.addEventListener('beforeunload', () => {
    if (isScreenSharing) {
        stopScreenShare();
    }
    if (isCallActive) {
        endCall();
    }
});