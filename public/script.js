// public/script.js
const socket = io();

let username = '';
let localStream = null;
let peerConnection = null;
let screenStream = null;
let isCallActive = false;
let isScreenSharing = false;
let currentCall = null;
let screenSharer = null;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Login
function login() {
    username = document.getElementById('username').value.trim();
    if (!username) {
        alert('Please enter your name');
        return;
    }
    
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    
    socket.emit('join', username);
    addMessage('system', `You joined as ${username}`);
    
    // Get microphone
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            localStream = stream;
            updateStatus('audio-status', 'Mic ready', 'connected');
            console.log('Microphone ready');
        })
        .catch(err => {
            console.error('Mic error:', err);
            updateStatus('audio-status', 'Mic error', 'error');
        });
}

// Send message
function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (message) {
        socket.emit('send-message', { message });
        input.value = '';
    }
}

// Add message to chat
function addMessage(type, content, user = '', time = '') {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message';
    
    if (type === 'system') {
        div.classList.add('system');
        div.textContent = content;
    } else {
        div.innerHTML = `<strong>${user}</strong> ${content} <small>${time}</small>`;
    }
    
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

// Update status badge
function updateStatus(id, text, state) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'status-badge active';
    if (state === 'connected') el.classList.add('connected');
    if (state === 'connecting') el.classList.add('connecting');
}

// ============= AUDIO CALL =============

async function toggleCall() {
    const btn = document.getElementById('callBtn');
    
    if (!localStream) {
        alert('Microphone not available');
        return;
    }
    
    if (isCallActive) {
        // End call
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        isCallActive = false;
        btn.classList.remove('active');
        updateStatus('audio-status', 'Call ended', 'connected');
        addMessage('system', 'Call ended');
    } else {
        // Start call
        try {
            btn.classList.add('active');
            updateStatus('audio-status', 'Connecting...', 'connecting');
            
            peerConnection = new RTCPeerConnection(configuration);
            
            // Add local audio
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
            
            // Handle remote audio
            peerConnection.ontrack = (event) => {
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                updateStatus('audio-status', 'Connected', 'connected');
                addMessage('system', 'Connected to audio call');
            };
            
            // ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', {
                        candidate: event.candidate,
                        target: 'all'
                    });
                }
            };
            
            // Create offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('offer', {
                offer: offer,
                target: 'all'
            });
            
            isCallActive = true;
            
        } catch (err) {
            console.error('Call error:', err);
            updateStatus('audio-status', 'Call failed', 'error');
            btn.classList.remove('active');
        }
    }
}

// ============= SCREEN SHARE =============

async function toggleScreen() {
    const btn = document.getElementById('screenBtn');
    
    if (isScreenSharing) {
        // Stop sharing
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        isScreenSharing = false;
        btn.classList.remove('sharing');
        updateStatus('screen-status', '', '');
        socket.emit('screen-stopped');
        addMessage('system', 'You stopped sharing screen');
        
    } else {
        // Start sharing
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            
            btn.classList.add('sharing');
            updateStatus('screen-status', 'Sharing', 'connected');
            
            // Create connection
            peerConnection = new RTCPeerConnection(configuration);
            
            // Add screen tracks
            screenStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, screenStream);
            });
            
            // ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('screen-ice-candidate', {
                        candidate: event.candidate,
                        target: 'all'
                    });
                }
            };
            
            // Create offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('screen-offer', {
                offer: offer,
                target: 'all'
            });
            
            isScreenSharing = true;
            screenSharer = socket.id;
            
            // Notify others
            socket.emit('screen-started');
            addMessage('system', 'You are sharing screen');
            
            // Handle stop
            screenStream.getVideoTracks()[0].onended = () => {
                toggleScreen();
            };
            
        } catch (err) {
            console.error('Screen share error:', err);
            btn.classList.remove('sharing');
        }
    }
}

// Join screen share
function joinScreen() {
    if (!screenSharer || screenSharer === socket.id) return;
    
    addMessage('system', 'Connecting to screen share...');
    
    // Create connection
    peerConnection = new RTCPeerConnection(configuration);
    
    // Handle incoming video
    peerConnection.ontrack = (event) => {
        const video = document.getElementById('remote-video');
        video.srcObject = event.streams[0];
        document.getElementById('video-container').classList.add('active');
        addMessage('system', 'Connected to screen share');
    };
    
    // ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('screen-ice-candidate', {
                candidate: event.candidate,
                target: screenSharer
            });
        }
    };
    
    // Create offer
    peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
    })
    .then(offer => peerConnection.setLocalDescription(offer))
    .then(() => {
        socket.emit('screen-offer', {
            offer: peerConnection.localDescription,
            target: screenSharer
        });
    });
}

// Fullscreen
function toggleFullscreen() {
    const container = document.getElementById('video-container');
    if (!document.fullscreenElement) {
        container.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// Close video
function closeVideo() {
    document.getElementById('video-container').classList.remove('active');
    document.getElementById('remote-video').srcObject = null;
}

// ============= SOCKET HANDLERS =============

// Messages
socket.on('new-message', (data) => {
    addMessage('message', data.message, data.user, data.time);
});

socket.on('user-joined', (msg) => addMessage('system', msg));
socket.on('user-left', (msg) => addMessage('system', msg));

// Audio signaling
socket.on('offer', async (data) => {
    if (data.sender === socket.id) return;
    
    if (!peerConnection) {
        peerConnection = new RTCPeerConnection(configuration);
        
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }
        
        peerConnection.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    target: data.sender
                });
            }
        };
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('answer', {
        answer: answer,
        target: data.sender
    });
});

socket.on('answer', async (data) => {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Screen signaling
socket.on('screen-offer', async (data) => {
    if (data.sender === socket.id) return;
    
    // If we're the sharer
    if (isScreenSharing) {
        const pc = new RTCPeerConnection(configuration);
        
        screenStream.getTracks().forEach(track => {
            pc.addTrack(track, screenStream);
        });
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('screen-ice-candidate', {
                    candidate: event.candidate,
                    target: data.sender
                });
            }
        };
        
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('screen-answer', {
            answer: answer,
            target: data.sender
        });
    }
});

socket.on('screen-answer', async (data) => {
    if (!peerConnection) return;
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('screen-ice-candidate', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding screen ICE candidate:', err);
    }
});

// Screen availability
socket.on('screen-available', (data) => {
    screenSharer = data.sharer;
    document.getElementById('join-btn').classList.add('active');
    addMessage('system', `📺 ${data.username} is sharing screen. Click "Join Screen Share" to watch.`);
});

socket.on('screen-unavailable', () => {
    screenSharer = null;
    document.getElementById('join-btn').classList.remove('active');
    closeVideo();
    addMessage('system', '📺 Screen sharing ended');
});

// Enter key for messages
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});