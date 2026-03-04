const socket = io();
let currentUser = '';
let localStream = null;
let peerConnections = {};
let isCallActive = false;

// STUN servers for better connection
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
});

socket.on('update-users', (users) => {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = '<h3>Online Users</h3>';
    users.forEach(user => {
        const userEl = document.createElement('div');
        userEl.className = 'user-item';
        userEl.textContent = user.username;
        usersList.appendChild(userEl);
    });
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

// SIMPLIFIED: Start call with explicit audio first
async function startCall() {
    try {
        console.log('Starting call - requesting microphone...');
        
        // First, just test microphone alone
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('✅ Microphone access granted!');
        console.log('Audio tracks:', audioOnly.getAudioTracks().length);
        
        // Now get both video and audio
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Log audio track info
        const audioTracks = localStream.getAudioTracks();
        console.log('Audio tracks in main stream:', audioTracks.length);
        if (audioTracks.length > 0) {
            console.log('Audio track settings:', audioTracks[0].getSettings());
            // Make sure audio is enabled
            audioTracks[0].enabled = true;
        }
        
        // Display local video
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        await localVideo.play();
        
        // Show video container
        document.getElementById('video-container').style.display = 'block';
        
        // Join room
        socket.emit('join-room', 'video-room-1');
        isCallActive = true;
        
        alert('✅ Microphone is working! Say something and check if the audio indicator moves in your browser tab');
        
    } catch (err) {
        console.error('Error accessing media:', err);
        alert('Microphone error: ' + err.message);
    }
}

// SIMPLIFIED: Screen sharing with audio focus
async function shareScreen() {
    try {
        console.log('Starting screen share...');
        
        // Get screen with audio
        localStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true,
            audio: true  // This captures system audio
        });
        
        // Check if we have audio
        const audioTracks = localStream.getAudioTracks();
        console.log('Screen share audio tracks:', audioTracks.length);
        
        // If no system audio, add microphone
        if (audioTracks.length === 0) {
            console.log('No system audio, adding microphone...');
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream.getAudioTracks().forEach(track => {
                localStream.addTrack(track);
                console.log('Added microphone track');
            });
        } else {
            audioTracks[0].enabled = true;
            console.log('System audio captured');
        }
        
        // Display
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        await localVideo.play();
        
        document.getElementById('video-container').style.display = 'block';
        socket.emit('join-room', 'video-room-1');
        isCallActive = true;
        
    } catch (err) {
        console.error('Screen share error:', err);
    }
}

// SIMPLIFIED: Create peer connection
function createPeerConnection(peerId) {
    console.log('Creating peer connection for:', peerId);
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add all tracks from local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`Adding ${track.kind} track to peer ${peerId}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.error('No local stream available');
        return null;
    }
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log(`Received ${event.track.kind} track from ${peerId}`);
        
        // Get or create video element
        let remoteVideoContainer = document.getElementById('remote-videos');
        let videoEl = document.getElementById(`remote-${peerId}`);
        
        if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.id = `remote-${peerId}`;
            videoEl.autoplay = true;
            videoEl.playsInline = true;
            
            const videoBox = document.createElement('div');
            videoBox.className = 'video-box';
            videoBox.appendChild(videoEl);
            
            const nameP = document.createElement('p');
            nameP.textContent = 'Friend';
            videoBox.appendChild(nameP);
            
            remoteVideoContainer.appendChild(videoBox);
        }
        
        // Set stream
        if (!videoEl.srcObject) {
            videoEl.srcObject = new MediaStream();
        }
        videoEl.srcObject.addTrack(event.track);
        
        // For audio tracks, also play them (they play automatically)
        if (event.track.kind === 'audio') {
            console.log('Audio track received and should be playing');
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
    
    // Monitor connection state
    pc.onconnectionstatechange = () => {
        console.log(`Connection with ${peerId}:`, pc.connectionState);
    };
    
    peerConnections[peerId] = pc;
    return pc;
}

// WebRTC Signaling
async function makeOffer(peerId) {
    try {
        console.log('Making offer to:', peerId);
        const pc = createPeerConnection(peerId);
        if (!pc) return;
        
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        await pc.setLocalDescription(offer);
        socket.emit('offer', { target: peerId, offer: offer });
        
    } catch (err) {
        console.error('Offer error:', err);
    }
}

socket.on('existing-users', (users) => {
    console.log('Existing users:', users);
    users.forEach(user => makeOffer(user.id));
});

socket.on('user-connected', (user) => {
    console.log('User connected:', user);
    makeOffer(user.id);
});

socket.on('offer', async (data) => {
    try {
        console.log('Received offer from:', data.sender);
        const pc = createPeerConnection(data.sender);
        if (!pc) return;
        
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('answer', { target: data.sender, answer: answer });
        
    } catch (err) {
        console.error('Answer error:', err);
    }
});

socket.on('answer', async (data) => {
    try {
        console.log('Received answer from:', data.sender);
        const pc = peerConnections[data.sender];
        if (pc) {
            await pc.setRemoteDescription(data.answer);
        }
    } catch (err) {
        console.error('Answer handling error:', err);
    }
});

socket.on('ice-candidate', async (data) => {
    try {
        const pc = peerConnections[data.sender];
        if (pc) {
            await pc.addIceCandidate(data.candidate);
        }
    } catch (err) {
        console.error('ICE candidate error:', err);
    }
});

socket.on('peer-left', (peerId) => {
    console.log('Peer left:', peerId);
    const pc = peerConnections[peerId];
    if (pc) {
        pc.close();
        delete peerConnections[peerId];
    }
    const videoEl = document.getElementById(`remote-${peerId}`);
    if (videoEl) {
        videoEl.parentElement.remove();
    }
});

function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    document.getElementById('video-container').style.display = 'none';
    document.getElementById('remote-videos').innerHTML = '';
    document.getElementById('local-video').srcObject = null;
    
    isCallActive = false;
}