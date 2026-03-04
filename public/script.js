const socket = io();
let currentUser = '';
let localStream = null;
let peerConnections = {};
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

// Video call functions
async function startCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1920, height: 1080 }, 
            audio: true 
        });
        
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        
        document.getElementById('video-container').style.display = 'block';
        
        socket.emit('join-room', 'video-room-1');
    } catch (err) {
        console.error('Error accessing media devices:', err);
        alert('Could not access camera or microphone');
    }
}

async function shareScreen() {
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { width: 1920, height: 1080 },
            audio: true 
        });
        
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
        
        document.getElementById('video-container').style.display = 'block';
        
        socket.emit('join-room', 'video-room-1');
    } catch (err) {
        console.error('Error sharing screen:', err);
    }
}

function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(configuration);
    
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.ontrack = (event) => {
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
        
        videoEl.srcObject = event.streams[0];
    };
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: peerId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnections[peerId] = pc;
    return pc;
}

async function makeOffer(peerId) {
    const pc = createPeerConnection(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
        target: peerId,
        offer: offer
    });
}

socket.on('existing-users', (users) => {
    users.forEach(user => {
        makeOffer(user.id);
    });
});

socket.on('user-connected', (user) => {
    makeOffer(user.id);
});

socket.on('offer', async (data) => {
    const pc = createPeerConnection(data.sender);
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', {
        target: data.sender,
        answer: answer
    });
});

socket.on('answer', async (data) => {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.setRemoteDescription(data.answer);
    }
});

socket.on('ice-candidate', async (data) => {
    const pc = peerConnections[data.sender];
    if (pc) {
        await pc.addIceCandidate(data.candidate);
    }
});

socket.on('peer-left', (peerId) => {
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
    }
    
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    document.getElementById('video-container').style.display = 'none';
    document.getElementById('remote-videos').innerHTML = '';
}