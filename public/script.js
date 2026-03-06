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

// Setup audio
async function setupAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        console.log('✅ Microphone access granted');
        updateStatus('call-status', '🎤 Mic ready', 'connected');
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
    
    // Add local audio tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    // Handle incoming audio
    peerConnection.ontrack = (event) => {
        const remoteAudio = new Audio();
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.volume = 1.0;
        
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

// Toggle screen share
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
        // Start screen sharing
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: 3840 },
                    height: { ideal: 2160 },
                    frameRate: { ideal: 60 }
                },
                audio: false
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
    
    // Add screen video track
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