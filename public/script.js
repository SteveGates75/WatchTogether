const socket = io();
let localStream;
let screenStream;
let peers = {};
let roomId;
let username;
let isMuted = false;

const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function joinRoom() {
  username = document.getElementById("username").value;
  roomId = document.getElementById("roomId").value;
  if (!username || !roomId) return alert("Enter info");

  // get microphone audio
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  socket.emit("join-room", { roomId, username });

  document.getElementById("joinScreen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("roomLabel").innerText = "Room: " + roomId;
}

// SIGNALING HANDLERS
socket.on("existing-users", users => {
  users.forEach(id => createPeer(id, true));
});

socket.on("user-joined", id => createPeer(id, false));

socket.on("signal", async ({ from, data }) => {
  const peer = peers[from];
  if (!peer) return;

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

function createPeer(id, initiator) {
  const peer = new RTCPeerConnection(config);
  peers[id] = peer;

  // add audio
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { to: id, data: e.candidate });
  };

  peer.ontrack = e => {
    // show screen video
    if (e.streams[0].getVideoTracks().length > 0)
      document.getElementById("screenVideo").srcObject = e.streams[0];
  };

  if (initiator) {
    peer.createOffer().then(offer => {
      peer.setLocalDescription(offer);
      socket.emit("signal", { to: id, data: offer });
    });
  }
}

// SCREEN SHARE
async function startScreenShare() {
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: 1920 }, height: { ideal: 1080 } }
  });

  const videoTrack = screenStream.getVideoTracks()[0];

  Object.values(peers).forEach(peer => {
    const sender = peer.getSenders().find(s => s.track.kind === "video");
    if (sender) sender.replaceTrack(videoTrack);
    else peer.addTrack(videoTrack, screenStream);
  });

  document.getElementById("screenVideo").srcObject = screenStream;
}

// MICROPHONE
function toggleMic() {
  if (!localStream) return;
  localStream.getAudioTracks()[0].enabled = isMuted;
  isMuted = !isMuted;
}

// CHAT
function sendMessage() {
  const input = document.getElementById("chatInput");
  if (!input.value) return;
  socket.emit("chat-message", input.value);
  input.value = "";
}

socket.on("chat-message", data => {
  const chatBox = document.getElementById("chat");
  if (!chatBox) return;
  chatBox.innerHTML += `<div><b>${data.username}:</b> ${data.message}</div>`;
  chatBox.scrollTop = chatBox.scrollHeight;
});

// USERS
socket.on("user-list", users => {
  const div = document.getElementById("users");
  div.innerHTML = Object.values(users).map(u => `<div>${u}</div>`).join("");
});

// INVITE + LEAVE
function copyInvite() {
  navigator.clipboard.writeText(window.location.origin + "?room=" + roomId);
  alert("Copied!");
}

function leaveRoom() {
  location.reload();
}