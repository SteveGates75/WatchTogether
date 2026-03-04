const socket = io();
let currentUser = '';
let localStream = null;
let peerConnection = null;
let isCallActive = false;
let callButton = null;
let remoteAudio = null;

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
        
        // Create a hidden audio element for remote audio
        remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        remoteAudio.controls = false;
        remoteAudio.style.display = 'none';
        document.body.appendChild(remoteAudio);
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

// Toggle call
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
        
        // Request microphone with specific settings
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 2
            }
        });
        
        console.log('✅ Microphone access granted');
        console.log('📊 Audio tracks:', localStream.getAudioTracks().length);
        
        // Log audio track info
        const audioTrack = localStream.getAudioTracks()[0];
        console.log('🎵 Audio track label:', audioTrack.label);
        console.log('🎵 Audio track enabled:', audioTrack.enabled);
        console.log('🎵 Audio track settings:', audioTrack.getSettings());
        
        // Test if microphone is actually capturing sound
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(localStream);
        const processor = audioContext.createScriptProcessor(256, 1, 1);
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        let soundDetected = false;
        processor.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < input.length; i++) {
                sum += Math.abs(input[i]);
            }
            const average = sum / input.length;
            if (average > 0.01) { // Threshold for sound detection
                soundDetected = true;
                console.log('🔊 Sound detected from microphone! Level:', average);
            }
        };
        
        // Stop processor after 2 seconds
        setTimeout(() => {
            processor.disconnect();
            source.disconnect();
            audioContext.close();
            if (!soundDetected) {
                console.warn('⚠️ No sound detected from microphone. Check if microphone is working.');
            } else {
                console.log('✅ Microphone is working and capturing sound');
            }
        }, 2000);
        
        // Update UI
        callButton.classList.add('active');
        callButton.textContent = '🔴';
        callButton.title = 'End Call';
        document.getElementById('call-status').classList.add('active');
        document.getElementById('call-status').textContent = '🔴 Connecting...';
        
        // Join audio room
        socket.emit('join-audio-room', 'audio-room-1');
        
        isCallActive = true;
        
    } catch (err) {
        console.error('❌ Microphone error:', err);
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
    console.log('🔴 Ending call...');
    
    // Stop all tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped track:', track.kind);
        });
        localStream = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Clear remote audio
    if (remoteAudio) {
        remoteAudio.srcObject = null;
    }
    
    // Update UI
    callButton.classList.remove('active');
    callButton.textContent = '🎧';
    callButton.title = 'Start Audio Call';
    document.getElementById('call-status').classList.remove('active');
    
    // Leave room
    socket.emit('leave-audio-room', 'audio-room-1');
    
    isCallActive = false;
    console.log('Call ended');
}

// Create peer connection for audio
function createPeerConnection(peerId) {
    console.log('🔄 Creating peer connection for audio with:', peerId);
    
    const pc = new RTCPeerConnection(configuration);
    
    // Add audio tracks
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            console.log('➕ Adding audio track to connection');
            pc.addTrack(track, localStream);
        });
    }
    
    // Handle incoming audio
    pc.ontrack = (event) => {
        console.log('📥 Received audio track from peer');
        console.log('Track kind:', event.track.kind);
        console.log('Track enabled:', event.track.enabled);
        console.log('Streams:', event.streams.length);
        
        if (event.streams && event.streams[0]) {
            // Set the remote audio
            remoteAudio.srcObject = event.streams[0];
            
            // Force play audio
            remoteAudio.play()
                .then(() => {
                    console.log('✅ Remote audio playing successfully');
                    document.getElementById('call-status').textContent = '🔴 Connected - Audio active';
                    
                    // Check if audio is actually playing
                    setTimeout(() => {
                        if (remoteAudio.paused) {
                            console.log('⚠️ Audio is paused, trying to play again');
                            remoteAudio.play();
                        } else {
                            console.log('✅ Audio is playing');
                        }
                    }, 1000);
                })
                .catch(e => {
                    console.error('❌ Error playing remote audio:', e);
                    // Try to play on user interaction
                    document.body.addEventListener('click', function playOnClick() {
                        remoteAudio.play();
                        document.body.removeEventListener('click', playOnClick);
                    }, { once: true });
                });
            
            // Monitor audio levels
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(event.streams[0]);
            const processor = audioContext.createScriptProcessor(256, 1, 1);
            
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                let sum = 0;
                for (let i = 0; i < input.length; i++) {
                    sum += Math.abs(input[i]);
                }
                const average = sum / input.length;
                if (average > 0.01) {
                    console.log('🔊 Remote audio level detected:', average);
                    // Show visual indicator
                    document.getElementById('call-status').style.backgroundColor = '#00ff00';
                    setTimeout(() => {
                        document.getElementById('call-status').style.backgroundColor = '#ed4245';
                    }, 100);
                }
            };
            
            // Clean up processor after 5 seconds
            setTimeout(() => {
                processor.disconnect();
                source.disconnect();
            }, 5000);
        }
    };
    
    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('❄️ Sending ICE candidate');
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
            document.getElementById('call-status').textContent = '🔴 Connected - Audio active';
            
            // Force unmute remote audio
            if (remoteAudio) {
                remoteAudio.muted = false;
                remoteAudio.volume = 1.0;
            }
        } else if (pc.connectionState === 'disconnected') {
            console.log('⚠️ Connection disconnected');
        } else if (pc.connectionState === 'failed') {
            console.log('❌ Connection failed');
            if (isCallActive) {
                endCall();
            }
        }
    };
    
    // Monitor ICE connection
    pc.oniceconnectionstatechange = () => {
        console.log('❄️ ICE connection state:', pc.iceConnectionState);
    };
    
    peerConnection = pc;
    return pc;
}

// Audio signaling
socket.on('user-joined-audio', async (userId) => {
    console.log('👤 User joined audio room:', userId);
    
    if (isCallActive && userId !== socket.id) {
        console.log('📞 Creating offer for new user');
        
        const pc = createPeerConnection(userId);
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        await pc.setLocalDescription(offer);
        console.log('📤 Sending offer');
        
        socket.emit('audio-offer', {
            target: userId,
            offer: offer
        });
    }
});

socket.on('audio-offer', async (data) => {
    console.log('📥 Received audio offer from:', data.sender);
    
    if (isCallActive) {
        const pc = createPeerConnection(data.sender);
        await pc.setRemoteDescription(data.offer);
        console.log('Remote description set');
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('📤 Sending answer');
        
        socket.emit('audio-answer', {
            target: data.sender,
            answer: answer
        });
    }
});

socket.on('audio-answer', async (data) => {
    console.log('📥 Received audio answer from:', data.sender);
    
    if (peerConnection) {
        await peerConnection.setRemoteDescription(data.answer);
        console.log('✅ Audio connection established');
    }
});

socket.on('ice-candidate', async (data) => {
    console.log('❄️ Received ICE candidate from:', data.sender);
    if (peerConnection) {
        await peerConnection.addIceCandidate(data.candidate);
        console.log('ICE candidate added');
    }
});

socket.on('user-left-audio', (userId) => {
    console.log('👋 User left audio room:', userId);
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

// Add click handler for debugging
document.addEventListener('click', () => {
    if (remoteAudio && remoteAudio.paused && isCallActive) {
        console.log('Manual play attempt');
        remoteAudio.play();
    }
});