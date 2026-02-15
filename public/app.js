const socket = io();
const video = document.getElementById("video");
let localStream;
let peer;

function sendMessage() {
  const msg = document.getElementById("msg").value;
  socket.emit("chat", msg);
  document.getElementById("msg").value = "";
}

socket.on("chat", msg => {
  const div = document.createElement("div");
  div.innerText = msg;
  document.getElementById("chat").appendChild(div);
});

// Create peer connection
const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function createPeer() {
  peer = new RTCPeerConnection(config);

  peer.onicecandidate = e => {
    if (e.candidate) socket.emit("ice", e.candidate);
  };

  peer.ontrack = e => {
    video.srcObject = e.streams[0];
  };

  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
}

async function startVoice() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  video.srcObject = localStream;
  startCall();
}

async function startScreen() {
  localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  video.srcObject = localStream;
  startCall();
}

async function startCall() {
  createPeer();
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  socket.emit("offer", offer);
}

// Socket.io signaling
socket.on("offer", async offer => {
  createPeer();
  await peer.setRemoteDescription(offer);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  socket.emit("answer", answer);
});

socket.on("answer", async answer => {
  await peer.setRemoteDescription(answer);
});

socket.on("ice", async candidate => {
  if (peer) await peer.addIceCandidate(candidate);
});
