// ==================== GLOBALS ====================
const socket = io();
let localStream;
let pc;
let username;
let remoteUserId = null;
let callActive = false;
let pendingOffer = null;
let currentFacingMode = 'user'; // 'user' = front, 'environment' = back

// Media controls
let audioEnabled = true;
let videoEnabled = true;

// Adaptive video quality based on device (mobile now gets 720p)
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
const videoConstraints = isMobile
    ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 30 }
    : { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: 30 };

// STUN servers
const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// ==================== LOGIN ====================
function login() {
    username = document.getElementById('username').value.trim();
    if (!username) return alert('Enter name');
    socket.emit('join', username);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    updateStatus('Joining...');

    // Get local media with adaptive quality
    navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;
            updateStatus('Logged in, ready to call');
            startConfetti();
            setTimeout(stopConfetti, 3000);
        })
        .catch(err => {
            console.error('Media error:', err);
            alert('Cannot access camera/microphone');
        });
}

// ==================== UPDATE STATUS ====================
function updateStatus(msg) {
    document.getElementById('status').textContent = msg;
}

// ==================== CREATE PEER CONNECTION ====================
function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection(iceConfig);

    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle incoming tracks
    pc.ontrack = (event) => {
        console.log('✅ Received remote track');
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = event.streams[0];
        updateStatus('Connected');
        callActive = true;
        startConfetti();
        setTimeout(stopConfetti, 3000);
    };

    // ICE candidate
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('❄️ Sending ICE candidate to', targetId);
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                targetId: targetId
            });
        }
    };

    // Connection state changes
    pc.oniceconnectionstatechange = () => {
        console.log('ICE state:', pc.iceConnectionState);
        const indicator = document.getElementById('quality-indicator');
        if (pc.iceConnectionState === 'connected') {
            indicator.className = 'quality-badge quality-good';
        } else if (pc.iceConnectionState === 'disconnected') {
            indicator.className = 'quality-badge quality-poor';
        } else if (pc.iceConnectionState === 'failed') {
            indicator.className = 'quality-badge quality-bad';
        }

        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            updateStatus('Disconnected');
            callActive = false;
            remoteUserId = null;
        }
    };

    return pc;
}

// ==================== START CALL ====================
function callUser(targetId, targetName) {
    if (callActive) {
        alert('Already in a call');
        return;
    }
    if (!localStream) return alert('No media');

    remoteUserId = targetId;
    pc = createPeerConnection(remoteUserId);

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            console.log('📤 Sending offer to', remoteUserId);
            socket.emit('offer', {
                offer: pc.localDescription,
                targetId: remoteUserId
            });
            updateStatus(`Calling ${targetName}...`);
        })
        .catch(err => console.error('Offer error:', err));
}

// ==================== ACCEPT CALL ====================
function acceptCall() {
    if (!pendingOffer) return;
    document.getElementById('incoming-call').style.display = 'none';

    remoteUserId = pendingOffer.from;
    pc = createPeerConnection(remoteUserId);

    pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.offer))
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer))
        .then(() => {
            console.log('📤 Sending answer to', remoteUserId);
            socket.emit('answer', {
                answer: pc.localDescription,
                targetId: remoteUserId
            });
            updateStatus('Connecting...');
        })
        .catch(err => console.error('Accept error:', err));

    pendingOffer = null;
}

// ==================== REJECT CALL ====================
function rejectCall() {
    document.getElementById('incoming-call').style.display = 'none';
    socket.emit('call-rejected', { targetId: pendingOffer.from });
    pendingOffer = null;
}

// ==================== HANG UP ====================
function hangUp() {
    if (pc) {
        pc.close();
        pc = null;
    }
    document.getElementById('remoteVideo').srcObject = null;
    callActive = false;
    remoteUserId = null;
    updateStatus('Call ended');
    document.getElementById('quality-indicator').className = 'quality-badge';
}

// ==================== MUTE CONTROLS ====================
function toggleMuteAudio() {
    if (!localStream) return;
    audioEnabled = !audioEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = audioEnabled);
    const btn = document.getElementById('muteAudioBtn');
    btn.textContent = audioEnabled ? '🔊 Mute Mic' : '🔇 Unmute Mic';
    document.getElementById('localMuteIndicator').style.display = audioEnabled ? 'none' : 'block';
}

function toggleMuteVideo() {
    if (!localStream) return;
    videoEnabled = !videoEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = videoEnabled);
    const btn = document.getElementById('muteVideoBtn');
    btn.textContent = videoEnabled ? '🎥 Hide Video' : '🎥 Show Video';
}

// ==================== SWITCH CAMERA ====================
async function switchCamera() {
    if (!localStream) return;
    const tracks = localStream.getVideoTracks();
    if (tracks.length === 0) return;
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    const constraints = {
        video: { facingMode: newFacingMode, ...videoConstraints },
        audio: true
    };
    try {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        // Replace local video
        document.getElementById('localVideo').srcObject = newStream;
        // Update peer connection if in a call
        if (pc) {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(newStream.getVideoTracks()[0]);
        }
        // Stop old tracks
        localStream.getTracks().forEach(t => t.stop());
        localStream = newStream;
        currentFacingMode = newFacingMode;
    } catch (err) {
        console.error('Camera switch failed:', err);
        alert('Could not switch camera');
    }
}

// ==================== COPY INVITE LINK ====================
function copyInviteLink() {
    const url = window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            alert('Link copied to clipboard!');
        }).catch(() => {
            prompt('Copy this link manually:', url);
        });
    } else {
        prompt('Copy this link manually:', url);
    }
}

// ==================== FULLSCREEN ====================
function toggleFullscreen() {
    const remoteVideo = document.getElementById('remoteVideo');
    if (!remoteVideo) return;
    if (remoteVideo.requestFullscreen) {
        remoteVideo.requestFullscreen();
    } else if (remoteVideo.webkitRequestFullscreen) {
        remoteVideo.webkitRequestFullscreen();
    } else if (remoteVideo.msRequestFullscreen) {
        remoteVideo.msRequestFullscreen();
    }
}

// ==================== CONFETTI ====================
let confettiCanvas = document.getElementById('confetti-canvas');
let ctx = confettiCanvas.getContext('2d');
let width, height;
let particles = [];
let animationId = null;

function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    confettiCanvas.width = width;
    confettiCanvas.height = height;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function createParticle() {
    return {
        x: Math.random() * width,
        y: Math.random() * height - height,
        size: randomRange(5, 15),
        speedY: randomRange(2, 8),
        speedX: randomRange(-2, 2),
        color: `hsl(${randomRange(0, 360)}, 100%, 60%)`,
        rotation: randomRange(0, 360),
        rotationSpeed: randomRange(-2, 2)
    };
}

function updateConfetti() {
    ctx.clearRect(0, 0, width, height);
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y += p.speedY;
        p.x += p.speedX;
        p.rotation += p.rotationSpeed;
        if (p.y > height + 50) {
            particles.splice(i, 1);
            continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        ctx.restore();
    }
    if (particles.length > 0) {
        animationId = requestAnimationFrame(updateConfetti);
    } else {
        animationId = null;
    }
}

function startConfetti() {
    if (animationId) cancelAnimationFrame(animationId);
    particles = [];
    for (let i = 0; i < 150; i++) {
        particles.push(createParticle());
    }
    animationId = requestAnimationFrame(updateConfetti);
}

function stopConfetti() {
    // Let particles fade out naturally
}

// ==================== SOCKET EVENTS ====================

socket.on('user-list', (users) => {
    console.log('Online users:', users);
    const listDiv = document.getElementById('user-list');
    listDiv.innerHTML = '';
    users.forEach(user => {
        if (user.id !== socket.id) {
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = user.name;
            div.onclick = () => callUser(user.id, user.name);
            listDiv.appendChild(div);
        }
    });
});

socket.on('user-joined', (data) => {
    console.log(`${data.username} joined`);
    const listDiv = document.getElementById('user-list');
    const div = document.createElement('div');
    div.className = 'user-item';
    div.textContent = data.username;
    div.onclick = () => callUser(data.id, data.username);
    listDiv.appendChild(div);
    startConfetti();
    setTimeout(stopConfetti, 2000);
});

socket.on('user-left', (data) => {
    console.log(`${data.username} left`);
    const items = document.getElementById('user-list').children;
    for (let item of items) {
        if (item.textContent === data.username) {
            item.remove();
            break;
        }
    }
    if (data.id === remoteUserId) {
        hangUp();
    }
});

socket.on('offer', (data) => {
    console.log('📲 Received offer from', data.from);
    if (callActive) {
        console.log('Already in a call, ignoring');
        return;
    }
    pendingOffer = data;
    // Find caller's name
    const callerItem = Array.from(document.getElementById('user-list').children).find(
        item => item.onclick && item.onclick.toString().includes(data.from)
    );
    const callerName = callerItem ? callerItem.textContent : 'Someone';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('incoming-call').style.display = 'block';
});

socket.on('answer', async (data) => {
    console.log('📲 Received answer from', data.from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
    console.log('❄️ Received ICE candidate from', data.from);
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});

socket.on('call-rejected', (data) => {
    if (data.from === remoteUserId) {
        hangUp();
        updateStatus('Call rejected');
        alert('The other party rejected your call.');
    }
});