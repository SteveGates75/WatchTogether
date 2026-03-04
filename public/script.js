const socket = io();
let currentUser = '';
let localStream = null;
let screenStream = null;
let peerConnection = null;
let isScreenSharing = false;
let screenButton = null;
let remoteScreen = null;

// Simple STUN servers
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function login() {
    const username = document.getElementById('username-input').value.trim();
    if (username) {
        currentUser = username;
        socket.emit('join', username);
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        
        screenButton = document.getElementById('screenBtn');
        remoteScreen = document.getElementById('remote-screen');
        
        // Tell user how to use
        alert('Click "Share Screen" to start sharing. Tell your friend to wait for the video.');
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

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (message) {
        socket.emit('send-message', { message });
        input.value = '';
    }
}

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Simple screen share
async function toggleScreenShare() {
    if (isScreenSharing) {
        stopScreenShare();
    } else {
        await startScreenShare();
    }
}

// Start sharing
async function startScreenShare() {
    try {
        console.log('Starting screen share...');
        
        // Simple screen capture
        screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true,
            audio: false  // Disable audio for simplicity first
        });
        
        // Update button
        screenButton.classList.add('sharing');
        screenButton.textContent = '⏹️';
        
        // Join room
        socket.emit('join-room', 'main-room');
        isScreenSharing = true;
        
        // Create connection immediately
        createPeerConnection();
        
        // Handle stop
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };
        
    } catch (err) {
        console.error('Error:', err);
        alert('Could not share screen: ' + err.message);
    }
}

// Stop sharing
function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    screenButton.classList.remove('sharing');
    screenButton.textContent = '📺';
    isScreenSharing = false;
    
    document.getElementById('screen-container').classList.remove('active');
}

// Simple peer connection
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    // Add video track
    if (screenStream) {
        screenStream.getVideoTracks().forEach(track => {
            peerConnection.addTrack(track, screenStream);
            console.log('Added video track');
        });
    }
    
    // When remote user adds video
    peerConnection.ontrack = (event) => {
        console.log('Received video track!');
        
        // Show video
        remoteScreen.srcObject = event.streams[0];
        document.getElementById('screen-container').classList.add('active');
        
        // Try to play
        remoteScreen.play()
            .then(() => console.log('Video playing'))
            .catch(e => {
                console.log('Autoplay failed, click to play');
                // Show play button
                const playBtn = document.createElement('button');
                playBtn.textContent = 'Click to Watch';
                playBtn.style.cssText = `
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    padding: 20px 40px;
                    background: #5865f2;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 18px;
                    cursor: pointer;
                    z-index: 3000;
                `;
                playBtn.onclick = () => {
                    remoteScreen.play();
                    playBtn.remove();
                };
                document.getElementById('screen-container').appendChild(playBtn);
            });
    };
    
    // ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: 'all',
                candidate: event.candidate
            });
        }
    };
    
    // Create offer
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            socket.emit('offer', {
                target: 'all',
                offer: peerConnection.localDescription
            });
        });
}

// Simple signaling
socket.on('offer', async (data) => {
    if (!peerConnection && isScreenSharing) {
        peerConnection = new RTCPeerConnection(configuration);
        
        peerConnection.ontrack = (event) => {
            remoteScreen.srcObject = event.streams[0];
            document.getElementById('screen-container').classList.add('active');
            remoteScreen.play().catch(console.log);
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    target: data.sender,
                    candidate: event.candidate
                });
            }
        };
        
        await peerConnection.setRemoteDescription(data.offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
    }
});

socket.on('answer', async (data) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
    }
});

socket.on('ice-candidate', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
    }
});

// Close video
function closeScreenView() {
    document.getElementById('screen-container').classList.remove('active');
}