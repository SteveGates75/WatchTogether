// public/script.js
const socket = io();

let username = '';
let localStream = null;
let peerConnection = null;
let screenStream = null;
let isAudioActive = false;
let isVideoActive = false;
let isScreenSharing = false;
let screenSharer = null;
let isViewingScreen = false;
let pendingCandidates = [];

// Media constraints with noise cancellation
const mediaConstraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000
    },
    video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
    }
};

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Login
function login() {
    username = document.getElementById('username-input').value.trim();
    if (!username) {
        alert('Please enter your name');
        return;
    }
    
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    
    socket.emit('join', username);
    addMessage('system', `You joined as ${username}`);
    
    // Get camera and microphone
    navigator.mediaDevices.getUserMedia(mediaConstraints)
        .then(stream => {
            localStream = stream;
            updateStatus('call-status', 'Mic & Camera ready', 'connected');
            
            // Show local video preview
            const localVideo = document.getElementById('local-video');
            localVideo.srcObject = stream;
            document.getElementById('local-video-preview').classList.add('active');
            
            console.log('✅ Camera and microphone ready');
        })
        .catch(err => {
            console.error('❌ Media error:', err);
            updateStatus('call-status', 'Device error', 'error');
            // Fallback to audio only
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    localStream = stream;
                    updateStatus('call-status', 'Mic ready', 'connected');
                    console.log('✅ Microphone ready (fallback)');
                })
                .catch(err => {
                    console.error('❌ Mic error:', err);
                });
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

// Update status
function updateStatus(id, text, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'status-badge active';
    if (state === 'connected') el.classList.add('connected');
    if (state === 'connecting') el.classList.add('connecting');
}

// ============= VIDEO CALL =============

async function toggleVideoCall() {
    const btn = document.getElementById('videoBtn');
    
    if (!localStream) {
        alert('Camera not available');
        return;
    }
    
    if (isVideoActive) {
        // End video call
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        isVideoActive = false;
        btn.classList.remove('active');
        updateStatus('video-status', 'Call ended', 'connected');
        addMessage('system', 'Video call ended');
        document.getElementById('remote-video-container').classList.remove('active');
    } else {
        // Start video call
        try {
            btn.classList.add('active');
            updateStatus('video-status', 'Connecting...', 'connecting');
            
            // Close any existing audio call
            if (isAudioActive) {
                document.getElementById('callBtn').classList.remove('active');
                isAudioActive = false;
            }
            
            // Show remote video container
            document.getElementById('remote-video-container').classList.add('active');
            
            peerConnection = new RTCPeerConnection(configuration);
            
            // Add all tracks (audio and video)
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
                console.log(`Added local track: ${track.kind}`);
            });
            
            // Handle remote stream
            peerConnection.ontrack = (event) => {
                console.log('Received remote track:', event.track.kind);
                const remoteVideo = document.getElementById('remote-video');
                remoteVideo.srcObject = event.streams[0];
                updateStatus('video-status', 'Connected', 'connected');
                addMessage('system', 'Video call connected');
            };
            
            // ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('Sending ICE candidate');
                    socket.emit('ice-candidate', {
                        candidate: event.candidate,
                        target: 'all' // will be broadcast by server
                    });
                }
            };
            
            // Handle connection state
            peerConnection.onconnectionstatechange = () => {
                console.log('Peer connection state:', peerConnection.connectionState);
                if (peerConnection.connectionState === 'connected') {
                    console.log('✅ Video call established');
                }
                if (peerConnection.connectionState === 'disconnected' || 
                    peerConnection.connectionState === 'failed') {
                    isVideoActive = false;
                    btn.classList.remove('active');
                    updateStatus('video-status', 'Disconnected', 'error');
                }
            };
            
            // Create offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            console.log('Created offer, sending...');
            
            socket.emit('offer', {
                offer: offer,
                target: 'all' // server will broadcast
            });
            
            isVideoActive = true;
            
        } catch (err) {
            console.error('Video call error:', err);
            updateStatus('video-status', 'Call failed', 'error');
            btn.classList.remove('active');
        }
    }
}

// ============= AUDIO CALL =============

async function toggleCall() {
    const btn = document.getElementById('callBtn');
    
    if (!localStream) {
        alert('Microphone not available');
        return;
    }
    
    if (isAudioActive) {
        // End audio call
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        isAudioActive = false;
        btn.classList.remove('active');
        updateStatus('call-status', 'Call ended', 'connected');
        addMessage('system', 'Audio call ended');
    } else {
        // Start audio call
        try {
            btn.classList.add('active');
            updateStatus('call-status', 'Connecting...', 'connecting');
            
            // Close any existing video call
            if (isVideoActive) {
                document.getElementById('videoBtn').classList.remove('active');
                document.getElementById('remote-video-container').classList.remove('active');
                isVideoActive = false;
            }
            
            peerConnection = new RTCPeerConnection(configuration);
            
            // Add only audio tracks
            localStream.getAudioTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
                console.log(`Added audio track`);
            });
            
            // Handle remote audio
            peerConnection.ontrack = (event) => {
                console.log('Received remote audio');
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                updateStatus('call-status', 'Connected', 'connected');
                addMessage('system', 'Audio call connected');
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
            
            isAudioActive = true;
            
        } catch (err) {
            console.error('Audio call error:', err);
            updateStatus('call-status', 'Call failed', 'error');
            btn.classList.remove('active');
        }
    }
}

// ============= SCREEN SHARE =============

async function toggleScreenShare() {
    const btn = document.getElementById('screenBtn');
    
    if (isScreenSharing) {
        stopScreenShare();
    } else {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
            
            btn.classList.add('sharing');
            updateStatus('screen-status', 'Sharing', 'connected');
            
            // Close any ongoing calls
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            if (isVideoActive) {
                document.getElementById('videoBtn').classList.remove('active');
                document.getElementById('remote-video-container').classList.remove('active');
                isVideoActive = false;
            }
            if (isAudioActive) {
                document.getElementById('callBtn').classList.remove('active');
                isAudioActive = false;
            }
            
            // Create connection for screen share
            peerConnection = new RTCPeerConnection(configuration);
            
            screenStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, screenStream);
            });
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('screen-ice-candidate', {
                        candidate: event.candidate,
                        target: 'all'
                    });
                }
            };
            
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('screen-offer', {
                offer: offer,
                target: 'all'
            });
            
            isScreenSharing = true;
            screenSharer = socket.id;
            
            socket.emit('screen-started');
            addMessage('system', 'You are sharing screen');
            
            screenStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
            
        } catch (err) {
            console.error('Screen share error:', err);
            btn.classList.remove('sharing');
        }
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    isScreenSharing = false;
    screenSharer = null;
    document.getElementById('screenBtn').classList.remove('sharing');
    updateStatus('screen-status', '', '');
    socket.emit('screen-stopped');
    addMessage('system', 'You stopped sharing screen');
}

// Join screen share (view)
function joinVideo() {
    if (!screenSharer || screenSharer === socket.id) {
        addMessage('system', 'No active screen share');
        return;
    }
    
    if (isViewingScreen) {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        pendingCandidates = [];
    }
    
    addMessage('system', 'Connecting to screen share...');
    updateStatus('screen-status', 'Connecting...', 'connecting');
    
    peerConnection = new RTCPeerConnection(configuration);
    
    peerConnection.ontrack = (event) => {
        console.log('Received screen track');
        const video = document.getElementById('remote-screen');
        video.srcObject = event.streams[0];
        document.getElementById('screen-container').classList.add('active');
        isViewingScreen = true;
        updateStatus('screen-status', 'Viewing', 'connected');
        addMessage('system', 'Connected to screen share');
        video.play().catch(err => console.log('Play error:', err));
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('screen-ice-candidate', {
                candidate: event.candidate,
                target: screenSharer
            });
        }
    };
    
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
    })
    .catch(err => {
        console.error('Error creating offer:', err);
        updateStatus('screen-status', 'Failed', 'error');
    });
}

// ============= VIDEO CONTROLS =============

function toggleFullScreen() {
    const container = document.getElementById('screen-container');
    if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
            container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        } else if (container.msRequestFullscreen) {
            container.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

function toggleFullscreenRemote() {
    const container = document.getElementById('remote-video-container');
    if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
            container.requestFullscreen();
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        } else if (container.msRequestFullscreen) {
            container.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

function closeScreenView() {
    document.getElementById('screen-container').classList.remove('active');
    document.getElementById('remote-screen').srcObject = null;
    isViewingScreen = false;
}

function closeRemoteVideo() {
    document.getElementById('remote-video-container').classList.remove('active');
    document.getElementById('remote-video').srcObject = null;
    if (isVideoActive) {
        document.getElementById('videoBtn').classList.remove('active');
        isVideoActive = false;
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
    }
}

// ============= SOCKET HANDLERS =============

socket.on('new-message', (data) => {
    addMessage('message', data.message, data.user, data.time);
});

socket.on('user-joined', (msg) => addMessage('system', msg));
socket.on('user-left', (msg) => addMessage('system', msg));

// WebRTC signaling (for audio/video calls)
socket.on('offer', async (data) => {
    if (data.sender === socket.id) return;
    console.log('Received offer from', data.sender);
    
    if (!peerConnection) {
        peerConnection = new RTCPeerConnection(configuration);
        
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track:', event.track.kind);
            if (event.track.kind === 'video') {
                const remoteVideo = document.getElementById('remote-video');
                remoteVideo.srcObject = event.streams[0];
                document.getElementById('remote-video-container').classList.add('active');
                updateStatus('video-status', 'Connected', 'connected');
            } else {
                // Audio only
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.autoplay = true;
                updateStatus('call-status', 'Connected', 'connected');
            }
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
    console.log('Sending answer to', data.sender);
    
    socket.emit('answer', {
        answer: answer,
        target: data.sender
    });
});

socket.on('answer', async (data) => {
    if (!peerConnection) return;
    console.log('Received answer from', data.sender);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    if (!peerConnection) return;
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('Added ICE candidate');
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

// Screen share signaling
socket.on('screen-offer', async (data) => {
    if (data.sender === socket.id) return;
    console.log('Received screen offer from', data.sender);
    
    if (isScreenSharing && screenStream) {
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
    console.log('Received screen answer');
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        
        while (pendingCandidates.length > 0) {
            const candidate = pendingCandidates.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (err) {
        console.error('Error handling screen answer:', err);
    }
});

socket.on('screen-ice-candidate', async (data) => {
    if (!peerConnection) {
        pendingCandidates.push(data.candidate);
        return;
    }
    
    try {
        if (peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
            pendingCandidates.push(data.candidate);
        }
    } catch (err) {
        console.error('Error adding screen ICE candidate:', err);
    }
});

// Screen availability
socket.on('screen-available', (data) => {
    screenSharer = data.sharer;
    document.getElementById('joinVideoBtn').classList.add('active');
    addMessage('system', `📺 ${data.username} is sharing screen. Click "Join" to watch.`);
});

socket.on('screen-unavailable', () => {
    screenSharer = null;
    document.getElementById('joinVideoBtn').classList.remove('active');
    addMessage('system', '📺 Screen sharing ended');
});

// Enter key
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});