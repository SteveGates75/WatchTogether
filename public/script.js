// ==================== GLOBALS ====================
const socket = io();
let localStream;
let pc;
let username;
let remoteUserId = null;
let callActive = false;
let incomingCall = false; // true when we receive an offer and haven't answered yet

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
            remoteUserId = null;
        }
    };

    return pc;
}

// ==================== START CALL TO A USER ====================
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

// ==================== ACCEPT INCOMING CALL ====================
function acceptCall() {
    if (!incomingCall || !pc) return;
    // The answer is already created in the 'offer' handler; we just need to send it.
    // Actually, in the offer handler we already created and sent the answer.
    // So we just need to set a flag. For simplicity, we'll auto-answer.
    // But if you want a manual accept, you'd store the answer and send on button click.
    // We'll auto-answer for simplicity.
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
}

// ==================== SOCKET EVENTS ====================

// Receive list of users (sent after join)
socket.on('user-list', (users) => {
    console.log('Online users:', users);
    const listDiv = document.getElementById('user-list');
    listDiv.innerHTML = '';
    users.forEach(user => {
        if (user.id !== socket.id) { // don't show yourself
            const div = document.createElement('div');
            div.className = 'user-item';
            div.textContent = user.name;
            div.onclick = () => callUser(user.id, user.name);
            listDiv.appendChild(div);
        }
    });
});

// Someone joined
socket.on('user-joined', (data) => {
    console.log(`${data.username} joined, ID: ${data.id}`);
    // Add to list
    const listDiv = document.getElementById('user-list');
    const div = document.createElement('div');
    div.className = 'user-item';
    div.textContent = data.username;
    div.onclick = () => callUser(data.id, data.username);
    listDiv.appendChild(div);
});

// Someone left
socket.on('user-left', (data) => {
    console.log(`${data.username} left`);
    // Remove from list
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
    // You could set a flag here for manual accept, but we'll auto-answer.
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