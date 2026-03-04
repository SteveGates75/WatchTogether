const socket = io();
let currentUser = '';
let localStream = null;
let screenStream = null;
let peerConnections = {};
let isCallActive = false;
let isScreenSharing = false;

// Better STUN servers for connection
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
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

// IMPROVED: Video call with better audio handling
async function startCall() {
    try {
        console.log('Starting call...');
        
        // Stop any existing streams
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        
        // Request both video and audio with specific settings
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 }
            }, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Check if audio tracks exist
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn('No audio tracks found');
            alert('Warning: No microphone detected. Voice may not work.');
        } else {
            console.log('Audio track found:', audioTracks[0].label);
            // Enable audio
            audioTracks[0].enabled = true;
        }
        
        // Display local video
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        
        // Ensure video plays
        try {
            await localVideo.play();
        } catch (playError) {
            console.error('Error playing video:', playError);
        }
        
        // Show video container
        document.getElementById('video-container').style.display = 'block';
        
        // Join room for video call
        socket.emit('join-room', 'video-room-1');
        isCallActive = true;
        
        console.log('Call started successfully');
        
    } catch (err) {
        console.error('Error accessing media devices:', err);
        let errorMessage = 'Could not access camera or microphone. ';
        
        if (err.name === 'NotAllowedError') {
            errorMessage += 'Please allow camera and microphone access in your browser settings.';
        } else if (err.name === 'NotFoundError') {
            errorMessage += 'No camera or microphone found.';
        } else if (err.name === 'NotReadableError') {
            errorMessage += 'Your camera or microphone is already in use by another app.';
        }
        
        alert(errorMessage);
    }
}

// IMPROVED: Screen sharing with audio
async function shareScreen() {
    try {
        console.log('Starting screen share...');
        
        // Stop any existing screen stream
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Request screen sharing with audio
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { 
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 30 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Check if we got audio (system audio)
        const audioTracks = screenStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.log('No system audio - will use microphone instead');
            // If no system audio, get microphone separately
            try {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                micStream.getAudioTracks().forEach(track => {
                    screenStream.addTrack(track);
                });
                console.log('Added microphone for audio');
            } catch (micError) {
                console.warn('Could not get microphone:', micError);
            }
        } else {
            console.log('System audio captured successfully');
            audioTracks[0].enabled = true;
        }
        
        // Replace local video with screen stream
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = screenStream;
        
        // Ensure video plays
        try {
            await localVideo.play();
        } catch (playError) {
            console.error('Error playing video:', playError);
        }
        
        // Show video container
        document.getElementById('video-container').style.display = 'block';
        
        // Join room for video call
        socket.emit('join-room', 'video-room-1');
        isCallActive = true;
        isScreenSharing = true;
        
        // Update button text
        const shareButton = document.querySelector('.call-controls button:nth-child(2)');
        if (shareButton) {
            shareButton.textContent = 'Stop Sharing';
            shareButton.onclick = stopScreenShare;
        }
        
        console.log('Screen share started successfully');
        
        // Handle when user stops sharing via browser UI
        screenStream.getVideoTracks()[0].onended = () => {
            console.log('Screen sharing stopped by user');
            stopScreenShare();
        };
        
    } catch (err) {
        console.error('Error sharing screen:', err);
        if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') {
            alert('Could not share screen. Please try again.');
        }
    }
}

// Stop screen sharing and switch back to camera
async function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Switch back to camera
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1920, height: 1080 }, 
            audio: true 
        });
        
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        
        // Update all peer connections with new stream
        Object.keys(peerConnections).forEach(peerId => {
            const pc = peerConnections[peerId];
            const sender = pc.getSenders().find(s => s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(localStream.getVideoTracks()[0]);
            }
        });
        
    } catch (err) {
        console.error('Error switching back to camera:', err);
    }
    
    isScreenSharing = false;
    
    // Reset button
    const shareButton = document.querySelector('.call-controls button:nth-child(2)');
    if (shareButton) {
        shareButton.textContent = 'Share Screen';
        shareButton.onclick = shareScreen;
    }
}

// IMPROVED: Create peer connection with better audio handling
function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(configuration);
    
    // Get current stream (either screen or camera)
    const currentStream = screenStream || localStream;
    
    if (!currentStream) {
        console.error('No stream available for peer connection');
        return null;
    }
    
    // Add all tracks from current stream
    currentStream.getTracks().forEach(track => {
        console.log(`Adding track to peer ${peerId}:`, track.kind, track.label);
        pc.addTrack(track, currentStream);
    });
    
    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log(`Received track from ${peerId}:`, event.track.kind);
        
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
        
        // Set remote stream
        if (!videoEl.srcObject) {
            videoEl.srcObject = new MediaStream();
        }
        
        // Add track to the stream
        if (event.track) {
            videoEl.srcObject.addTrack(event.track);
        }
        
        // Ensure video plays
        videoEl.play().catch(e => console.log('Autoplay prevented:', e));
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
    
    // Log connection state changes
    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${peerId}:`, pc.connectionState);
        if (pc.connectionState === 'connected') {
            console.log(`Successfully connected to ${peerId}`);
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            console.log(`Connection failed with ${peerId}`);
        }
    };
    
    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${peerId}:`, pc.iceConnectionState);
    };
    
    peerConnections[peerId] = pc;
    return pc;
}

// Rest of the WebRTC signaling remains the same
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
        
        socket.emit('offer', {
            target: peerId,
            offer: offer
        });
        
        console.log('Offer sent to:', peerId);
    } catch (err) {
        console.error('Error making offer:', err);
    }
}

socket.on('existing-users', (users) => {
    console.log('Existing users in room:', users);
    users.forEach(user => {
        makeOffer(user.id);
    });
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
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
        
        console.log('Answer sent to:', data.sender);
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

socket.on('answer', async (data) => {
    try {
        console.log('Received answer from:', data.sender);
        const pc = peerConnections[data.sender];
        if (pc) {
            await pc.setRemoteDescription(data.answer);
            console.log('Remote description set for:', data.sender);
        }
    } catch (err) {
        console.error('Error handling answer:', err);
    }
});

socket.on('ice-candidate', async (data) => {
    try {
        console.log('Received ICE candidate from:', data.sender);
        const pc = peerConnections[data.sender];
        if (pc) {
            await pc.addIceCandidate(data.candidate);
        }
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Improved end call function
function endCall() {
    console.log('Ending call...');
    
    // Stop all streams
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped track:', track.kind);
        });
        localStream = null;
    }
    
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped screen track:', track.kind);
        });
        screenStream = null;
    }
    
    // Close all peer connections
    Object.keys(peerConnections).forEach(peerId => {
        const pc = peerConnections[peerId];
        pc.close();
        console.log('Closed connection with:', peerId);
    });
    peerConnections = {};
    
    // Reset UI
    document.getElementById('video-container').style.display = 'none';
    document.getElementById('remote-videos').innerHTML = '';
    
    // Clear local video
    const localVideo = document.getElementById('local-video');
    localVideo.srcObject = null;
    
    // Reset button if screen sharing was active
    if (isScreenSharing) {
        const shareButton = document.querySelector('.call-controls button:nth-child(2)');
        if (shareButton) {
            shareButton.textContent = 'Share Screen';
            shareButton.onclick = shareScreen;
        }
    }
    
    isCallActive = false;
    isScreenSharing = false;
    console.log('Call ended');
}

// Handle disconnection
socket.on('disconnect', () => {
    console.log('Disconnected from server');
    if (isCallActive) {
        endCall();
    }
});