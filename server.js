const socket = io();
let localStream;    // your mic
let screenStream;   // screen share stream
let peers = {};
let roomId;
let username;
let isMuted = false;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// Join the room
async function joinRoom() {
  username = document.getElementById("username").value;
  roomId = document.getElementById("roomId").value;
  if (!username || !roomId) return alert("Enter info");

  // Get your microphone audio
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  socket.emit("join-room", { roomId, username });

  document.getElementById("joinScreen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("roomLabel").innerText = "Room: " + roomId;
}

// Receive list of existing users
socket.on("existing-users", users => {
  users.forEach(id => createPeer(id, true));
});

// New user joined
socket.on("user-joined", id => {
  createPeer(id, false);
});

// Receive signaling data
socket.on("signal", async ({ from, data }) => {
  const peer = peers[from];

  if (data.type === "offer") {
    await peer.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("signal", { to: from, data: answer });
  }

  if (data.type === "answer") {
    await peer.setRemoteDescription(new RTCSessionDescription(data));
  }

  if (data.candidate) {
    await peer.addIceCandidate(new RTCIceCandidate(data));
  }
});

// Create a peer connection
function createPeer(id, initiator) {
  const peer = new RTCPeerConnection(config);
  peers[id] = peer;

  // Add your microphone tracks
  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  // Handle incoming tracks (audio + screen video)
  peer.ontrack = e => {
    e.streams.forEach(stream => {
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();

      // If screen video exists, show in main video
      if (videoTracks.length > 0) {
        document.getElementById("screenVideo").srcObject = stream;
      }

      // If audio exists, create hidden audio element to play
      if (audioTracks.length > 0) {
        const audio = document.createElement("audio");
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
      }
    });
  };

  // ICE candidates
  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { to: id, data: e.candidate });
    }
  };

  // Initiate offer
  if (initiator) {
    peer.createOffer().then(offer => {
      peer.setLocalDescription(offer);
      socket.emit("signal", { to: id, data: offer });
    });
  }
}

// Start screen share (with audio if available)
async function startScreenShare() {
  // Request display media
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: true // include system audio if supported by browser
  });

  const videoTrack = screenStream.getVideoTracks()[0];
  const audioTrack = screenStream.getAudioTracks()[0];

  Object.values(peers).forEach(peer => {
    // Replace video track if exists
    const senderVideo = peer.getSenders().find(s => s.track.kind === "video");
    if (senderVideo) senderVideo.replaceTrack(videoTrack);
    else peer.addTrack(videoTrack, screenStream);

    // Replace audio track if exists
    if (audioTrack) {
      const senderAudio = peer.getSenders().find(s => s.track.kind === "audio" && s !== localStream.getAudioTracks()[0]);
      if (senderAudio) senderAudio.replaceTrack(audioTrack);
      else peer.addTrack(audioTrack, screenStream);
    }
  });

  document.getElementById("screenVideo").srcObject = screenStream;

  // Stop screen share properly when user stops
  screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
}

function stopScreenShare() {
  if (!screenStream) return;
  screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;

  // Optionally, restore video track from camera (if you add camera later)
  Object.values(peers).forEach(peer => {
    const senderVideo = peer.getSenders().find(s => s.track.kind === "video");
    if (senderVideo && localStream) senderVideo.replaceTrack(localStream.getVideoTracks()[0]);
  });

  document.getElementById("screenVideo").srcObject = null;
}

// Toggle microphone
function toggleMic() {
  if (!localStream) return;
  localStream.getAudioTracks()[0].enabled = isMuted;
  isMuted = !isMuted;
}

// Send text chat
function sendMessage() {
  const input = document.getElementById("chatInput");
  if (!input.value) return;
  socket.emit("chat-message", input.value);
  input.value = "";
}

// Receive chat messages
socket.on("chat-message", data => {
  const chatBox = document.getElementById("chat");
  if (!chatBox) return;
  chatBox.innerHTML += `<div><b>${data.username}:</b> ${data.message}</div>`;
  chatBox.scrollTop = chatBox.scrollHeight;
});

// Update user list
socket.on("user-list", users => {
  const div = document.getElementById("users");
  div.innerHTML = Object.values(users).map(u => `<div>${u}</div>`).join("");
});

// Copy invite
function copyInvite() {
  navigator.clipboard.writeText(window.location.origin + "?room=" + roomId);
  alert("Copied!");
}

// Leave room
function leaveRoom() {
  location.reload();
}