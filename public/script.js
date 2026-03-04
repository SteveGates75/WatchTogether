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

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  socket.emit("join-room", { roomId, username });

  document.getElementById("joinScreen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("roomLabel").innerText = "Room: " + roomId;
}

socket.on("existing-users", users => users.forEach(id => createPeer(id, true)));
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
  if (data.type === "answer") await peer.setRemoteDescription(new RTCSessionDescription(data));
  if (data.candidate) await peer.addIceCandidate(new RTCIceCandidate(data));
});

function createPeer(id, initiator) {
  const peer = new RTCPeerConnection(config);
  peers[id] = peer;

  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.ontrack = e => {
    e.streams.forEach(stream => {
      if (stream.getVideoTracks().length > 0) document.getElementById("screenVideo").srcObject = stream;
      if (stream.getAudioTracks().length > 0) {
        const audio = document.createElement("audio");
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
      }
    });
  };

  peer.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { to: id, data: e.candidate });
  };

  if (initiator) {
    peer.createOffer().then(offer => {
      peer.setLocalDescription(offer);
      socket.emit("signal", { to: id, data: offer });
    });
  }
}

async function startScreenShare() {
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: true
  });

  const videoTrack = screenStream.getVideoTracks()[0];

  Object.values(peers).forEach(peer => {
    const sender = peer.getSenders().find(s => s.track.kind === "video");
    if (sender) sender.replaceTrack(videoTrack);
    else peer.addTrack(videoTrack, screenStream);
  });

  document.getElementById("screenVideo").srcObject = screenStream;
}

function toggleMic() {
  if (!localStream) return;
  localStream.getAudioTracks()[0].enabled = isMuted;
  isMuted = !isMuted;
}

function sendMessage() {
  const input = document.getElementById("chatInput");
  if (!input.value) return;
  socket.emit("chat-message", input.value);
  input.value = "";
}

socket.on("chat-message", data => {
  const chat = document.getElementById("chat");
  if (!chat) return;
  chat.innerHTML += `<div><b>${data.username}:</b> ${data.message}</div>`;
  chat.scrollTop = chat.scrollHeight;
});

socket.on("user-list", users => {
  const div = document.getElementById("users");
  div.innerHTML = Object.values(users).map(u => `<div>${u}</div>`).join("");
});

function copyInvite() {
  navigator.clipboard.writeText(window.location.origin + "?room=" + roomId);
  alert("Invite link copied!");
}

function leaveRoom() {
  location.reload();
}