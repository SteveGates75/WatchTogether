const socket = io();
let currentUser = '';
let localStream = null;
let peerConnection = null;
let isCallActive = false;
let callButton = null;

// STUN servers for connection
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

function login() {
    const username = document.getElementById('username-input').value.trim();
    if (username) {
        currentUser = username;
        socket.emit('join', username);
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        // Get call button reference
        callButton = document.getElementById('callBtn');
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
    
    // If other user left, end call
    if (isCallActive) {
        endCall();
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

// AUDIO ONLY - Toggle call
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
        console.log('Starting audio call...');
        
        // Request only microphone
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('✅ Microphone access granted');
        console.log('Audio tracks:', localStream.getAudioTracks().length);
        
        // Update UI
        callButton.classList.add('active');
        callButton.textContent = '🔴';
        callButton.title = 'End Call';
        document.getElementById('call-status').classList.add('active');
        
        // Join audio room
        socket.emit('join-audio-room', 'audio-room-1');
        
        isCallActive = true;
        
    } catch (err) {
        console.error('Microphone error:', err);
        let message = 'Could not access microphone. ';
        if (err.name === 'NotAllowedError') {
            message += 'Please allow microphone access in your browser.';
        } else if (err.name === 'NotFoundError') {
            message += 'No microphone found.';
        }
        alert(message);
    }
}

// End call
function endCall() {
    console.log('Ending call...');
    
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Update UI
    callButton.classList.remove('active');
    callButton.textContent = '🎧';
    callButton.title = 'Start Audio Call';
    document.getElementById('call-status').classList.remove('active');
    
    // Leave room
    socket.emit('leave-audio-room', 'audio-room-1');
    
    isCallActive = false;
}

// Create peer connection for audio
function createPeerConnection(peerId) {
    console.log('Creating peer connection for audio');
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add audio tracks
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            console.log('Adding audio track to connection');
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle incoming audio
    pc.ontrack = (event) => {
        console.log('Received audio track from peer');
        
        // Create audio element and play it
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.play().catch(e => console.log('Audio play error:', e));
        
        // Show status
        document.getElementById('call-status').textContent = '🔴 Connected - Audio active';
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
        console.log('Connection state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            document.getElementById('call-status').textContent = '🔴 Connected - Audio active';
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            if (isCallActive) {
                endCall();
            }
        }
    };
    
    peerConnection = pc;
    return pc;
}

// Audio signaling
socket.on('user-joined-audio', async (userId) => {
    console.log('User joined audio room:', userId);
    
    if (isCallActive && userId !== socket.id) {
        console.log('Creating offer for new user');
        
        const pc = createPeerConnection(userId);
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        await pc.setLocalDescription(offer);
        
        socket.emit('audio-offer', {
            target: userId,
            offer: offer
        });
    }
});

socket.on('audio-offer', async (data) => {
    console.log('Received audio offer');
    
    if (isCallActive) {
        const pc = createPeerConnection(data.sender);
        await pc.setRemoteDescription(data.offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('audio-answer', {
            target: data.sender,
            answer: answer
        });
        
        console.log('Sent audio answer');
    }
});

socket.on('audio-answer', async (data) => {
    console.log('Received audio answer');
    
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
        console.log('Audio connection established');
    }
});

socket.on('ice-candidate', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
});

socket.on('user-left-audio', () => {
    console.log('User left audio room');
    if (isCallActive) {
        endCall();
    }
});

// Handle page close
window.addEventListener('beforeunload', () => {
    if (isCallActive) {
        endCall();
    }
});