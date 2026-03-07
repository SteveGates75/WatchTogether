// ==================== GLOBALS ====================
const socket = io();
let localStream;
let pc;
let username;
let remoteUserId = null; // who we are currently connected to
let callActive = false;

// Multiple STUN servers for reliability
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
    document.getElementById('app').style.display = 'block';
    updateStatus('Joining...');

    // Get local media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            document.getElementById('localVideo').srcObject = stream;
            updateStatus('Logged in, ready to call');
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
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            updateStatus('Disconnected');
            callActive = false;
        }
    };

    return pc;
}

// ==================== START CALL ====================
function startCall() {
    if (!localStream) return alert('No media');
    // For simplicity, we call the first other user in the list.
    // In a full app, you'd have a user list to select.
    // Here we'll broadcast an offer and let the first responder connect.
    // But better: we need a target. Let's ask the server for the list of users.
    // For now, we'll just emit an offer with targetId = 'all'? No, we need a specific target.
    // To keep it simple, we'll let the server broadcast the offer and the first user to answer connects.
    // That's not robust. Let's implement a user list.

    // Instead, we'll ask the server for the list of users (the server already sent it on join).
    // We'll use the first other user.
    // But for this minimal example, we'll just broadcast and hope only one other user exists.
    // We'll target 'all' but our server doesn't handle 'all', so we need to change server to broadcast.
    // I'll modify server to handle 'all' for offer.

    // Wait, let's do it properly: we'll have a user list and let the user choose.
    // But to keep this minimal, we'll use a prompt.
    const target = prompt('Enter the remote user ID (you can find it in the console log)');
    if (!target) return;
    remoteUserId = target;

    pc = createPeerConnection(remoteUserId);

    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            console.log('📤 Sending offer to', remoteUserId);
            socket.emit('offer', {
                offer: pc.localDescription,
                targetId: remoteUserId
            });
            updateStatus('Calling...');
        })
        .catch(err => console.error('Offer error:', err));
}

// ==================== HANG UP ====================
function hangUp() {
    if (pc) {
        pc.close();
        pc = null;
    }
    document.getElementById('remoteVideo').srcObject = null;
    callActive = false;
    updateStatus('Call ended');
}

// ==================== SOCKET EVENTS ====================

// Receive list of users (sent after join)
socket.on('user-list', (users) => {
    console.log('Online users:', users);
    // You could display them in UI
});

// Someone joined
socket.on('user-joined', (data) => {
    console.log(`${data.username} joined, ID: ${data.id}`);
});

// Someone left
socket.on('user-left', (data) => {
    console.log(`${data.username} left`);
    if (data.id === remoteUserId) {
        hangUp();
    }
});

// Receive offer
socket.on('offer', async (data) => {
    console.log('📲 Received offer from', data.from);
    if (callActive) {
        console.log('Already in a call, ignoring');
        return;
    }
    remoteUserId = data.from;
    pc = createPeerConnection(remoteUserId);

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    console.log('📤 Sending answer to', remoteUserId);
    socket.emit('answer', {
        answer: pc.localDescription,
        targetId: remoteUserId
    });
    updateStatus('Connecting...');
});

// Receive answer
socket.on('answer', async (data) => {
    console.log('📲 Received answer from', data.from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
});

// Receive ICE candidate
socket.on('ice-candidate', async (data) => {
    console.log('❄️ Received ICE candidate from', data.from);
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
        console.error('Error adding ICE candidate:', err);
    }
});